package installations

import (
	"context"
	"crypto/subtle"
	"errors"
	"math"
	"time"

	"github.com/google/uuid"
	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

const NativeLinkContractVersion = "shopify.connector.native_link.v1"

var ErrNativeLinkUnavailable = errors.New("Shopify native linking proof is unavailable")

// Proof is a short-lived handoff capability, never a Shopify credential or ERP
// login. The native ERP server must authenticate its user, authorize this exact
// tenant/shop and obtain explicit confirmation BEFORE calling ConsumeNativeLink.
// Request IDs are tracing metadata; the proof + actor + binding is the retry key.
type NativeLinkRequest struct {
	Identity     shopifyconnector.CanonicalShopIdentity `json:"identity"`
	Context      shopifyconnector.RequestContext        `json:"context"`
	LegacyShopID string                                 `json:"legacyShopId"`
	ShopDomain   string                                 `json:"shopDomain"`
	ActorID      string                                 `json:"actorId"`
	Proof        string                                 `json:"proof"`
}

func (r NativeLinkRequest) String() string   { return "nativeLink{proof=[REDACTED]}" }
func (r NativeLinkRequest) GoString() string { return r.String() }

type NativeLinkGrant struct {
	ContractVersion string                     `json:"contractVersion"`
	Proof           string                     `json:"proof"`
	Pending         PendingInstallationSummary `json:"pending"`
}

func (g NativeLinkGrant) String() string   { return "nativeLinkGrant{proof=[REDACTED]}" }
func (g NativeLinkGrant) GoString() string { return g.String() }

func linkProofHash(proof string) (string, error) {
	if !validOpaqueSecret(proof) {
		return "", ErrNativeLinkUnavailable
	}
	return hashOpaqueValue(proof), nil
}

func sameLinkHash(a, b string) bool {
	return validNonceHash(a) && validNonceHash(b) && subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

func validateNativeLinkReceipt(record InstallationRecord) error {
	if record.NativeLinkProofHash == "" && record.NativeLinkActorID == "" && record.NativeLinkExpiresAt.IsZero() && !record.NativeLinkPending {
		return nil
	}
	actor, err := uuid.Parse(record.NativeLinkActorID)
	if !validNonceHash(record.NativeLinkProofHash) || err != nil || actor == uuid.Nil || actor.String() != record.NativeLinkActorID ||
		!record.NativeLinkExpiresAt.After(record.InstalledAt) || record.NativeLinkExpiresAt.After(record.InstalledAt.Add(pendingInstallationLifetime)) {
		return ErrNativeLinkUnavailable
	}
	return nil
}

func validateNativeLinkRequest(request NativeLinkRequest) (Binding, string, error) {
	actor, err := uuid.Parse(request.ActorID)
	if err != nil || actor == uuid.Nil || actor.String() != request.ActorID ||
		shopifyconnector.ValidateRequest(shopifyconnector.ConnectionProbeRequest{Identity: request.Identity, Context: request.Context}) != nil {
		return Binding{}, "", ErrInvalidBinding
	}
	binding := Binding{Identity: request.Identity, LegacyShopID: request.LegacyShopID, ShopDomain: request.ShopDomain}
	normalized, err := validateAndNormalizeBinding(binding)
	if err != nil || normalized != binding {
		return Binding{}, "", ErrInvalidBinding
	}
	hash, err := linkProofHash(request.Proof)
	return binding, hash, err
}

// Only called with the domain obtained from a verified Shopify session. Issuing
// a new proof replaces the previous proof without extending the authorization TTL.
func (s *Service) IssueNativeLink(ctx context.Context, domain string) (NativeLinkGrant, error) {
	record, revision, err := s.repository.GetPendingInstallation(ctx, domain)
	if err != nil || validatePendingInstallation(record) != nil || !record.ExpiresAt.After(s.now()) ||
		!containsAllScopes(record.Scopes, s.requiredScopes) {
		return NativeLinkGrant{}, ErrNativeLinkUnavailable
	}
	proof, err := randomOpaqueValue(32)
	if err != nil {
		return NativeLinkGrant{}, errors.New("Shopify native linking is unavailable")
	}
	record.LinkProofHash, _ = linkProofHash(proof)
	if err := s.repository.SavePendingInstallation(ctx, record, revision, s.now().UTC()); err != nil {
		return NativeLinkGrant{}, err
	}
	return NativeLinkGrant{ContractVersion: NativeLinkContractVersion, Proof: proof, Pending: *pendingSummary(record)}, nil
}

// A preview exposes only the verified Shopify identity, never the target ERP
// identity, credentials, or receipt actor. Consumed proofs cannot be previewed.
func (r *MemoryRepository) InspectNativeLink(ctx context.Context, proof string, now time.Time) (PendingInstallationSummary, error) {
	if err := ctx.Err(); err != nil {
		return PendingInstallationSummary{}, err
	}
	hash, err := linkProofHash(proof)
	if err != nil {
		return PendingInstallationSummary{}, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if err := ctx.Err(); err != nil {
		return PendingInstallationSummary{}, err
	}
	for _, pending := range r.pendingInstallations {
		if sameLinkHash(pending.LinkProofHash, hash) && validatePendingInstallation(pending) == nil && pending.ExpiresAt.After(now) {
			if _, bound := r.domainIndex[pending.ShopDomain]; !bound {
				return *pendingSummary(pending), nil
			}
		}
	}
	return PendingInstallationSummary{}, ErrNativeLinkUnavailable
}

// Atomic compare-and-consume: ownership, canonical/legacy indexes, credential
// promotion and the retry receipt are committed together. No domain-only claim.
func (r *MemoryRepository) ConsumeNativeLink(ctx context.Context, request NativeLinkRequest, scopes []string, now time.Time) (InstallationRecord, error) {
	if err := ctx.Err(); err != nil {
		return InstallationRecord{}, err
	}
	binding, hash, err := validateNativeLinkRequest(request)
	if err != nil {
		return InstallationRecord{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	key := identityKey(binding.Identity)
	if installed, ok := r.installations[key]; ok {
		if installed.Binding == binding && installed.State == shopifyconnector.InstallationStateInstalled &&
			sameLinkHash(installed.NativeLinkProofHash, hash) && installed.NativeLinkActorID == request.ActorID &&
			installed.NativeLinkExpiresAt.After(now) && containsAllScopes(installed.Scopes, scopes) {
			installed.Scopes = append([]string(nil), installed.Scopes...)
			return installed, nil
		}
		return InstallationRecord{}, ErrNativeLinkUnavailable
	}
	pending, ok := r.pendingInstallations[binding.ShopDomain]
	if !ok || !sameLinkHash(pending.LinkProofHash, hash) || validatePendingInstallation(pending) != nil ||
		!pending.ExpiresAt.After(now) || pending.AuthorizedAt.After(now) || !containsAllScopes(pending.Scopes, scopes) {
		return InstallationRecord{}, ErrNativeLinkUnavailable
	}
	// Even a separately saved identical binding must not turn into an implicit
	// domain claim. Its existing OAuth path owns that lifecycle.
	if _, bound := r.domainIndex[binding.ShopDomain]; bound {
		return InstallationRecord{}, ErrBindingConflict
	}
	if err := r.checkBindingLocked(binding); err != nil {
		return InstallationRecord{}, err
	}
	if r.pendingRevision == math.MaxUint64 {
		return InstallationRecord{}, ErrRepositoryStale
	}
	if err := ctx.Err(); err != nil {
		return InstallationRecord{}, err
	}
	record := InstallationRecord{
		Binding: binding, ShopName: pending.ShopName, AccessToken: pending.AccessToken,
		RefreshToken: pending.RefreshToken, AccessTokenExpiresAt: pending.AccessTokenExpiresAt,
		RefreshTokenExpiresAt: pending.RefreshTokenExpiresAt, CredentialKeyVersion: pending.CredentialKeyVersion,
		Scopes: append([]string(nil), pending.Scopes...), State: shopifyconnector.InstallationStateInstalled,
		InstalledAt: now.UTC(), UpdatedAt: now.UTC(), NativeLinkPending: true,
		NativeLinkProofHash: hash, NativeLinkActorID: request.ActorID, NativeLinkExpiresAt: pending.ExpiresAt,
	}
	if err := r.saveBindingLocked(binding); err != nil {
		return InstallationRecord{}, err
	}
	r.installations[key] = record
	delete(r.pendingInstallations, binding.ShopDomain)
	r.pendingRevision++
	record.Scopes = append([]string(nil), record.Scopes...)
	return record, nil
}

func (r *MemoryRepository) FinishNativeLink(ctx context.Context, expected InstallationRecord, now time.Time) (InstallationRecord, error) {
	if err := ctx.Err(); err != nil {
		return InstallationRecord{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return InstallationRecord{}, err
	}
	key := identityKey(expected.Identity)
	record, ok := r.installations[key]
	if !ok || record.Binding != expected.Binding || record.State != shopifyconnector.InstallationStateInstalled ||
		!sameLinkHash(record.NativeLinkProofHash, expected.NativeLinkProofHash) || !record.InstalledAt.Equal(expected.InstalledAt) ||
		record.NativeLinkActorID != expected.NativeLinkActorID || now.Before(record.UpdatedAt) {
		return InstallationRecord{}, ErrRepositoryStale
	}
	record.NativeLinkPending = false
	record.UpdatedAt = now.UTC()
	r.installations[key] = record
	record.Scopes = append([]string(nil), record.Scopes...)
	return record, nil
}

func (r *FileRepository) InspectNativeLink(ctx context.Context, proof string, now time.Time) (PendingInstallationSummary, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.inner.InspectNativeLink(ctx, proof, now)
}

func (r *FileRepository) ConsumeNativeLink(ctx context.Context, request NativeLinkRequest, scopes []string, now time.Time) (InstallationRecord, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	candidate := cloneMemoryRepository(r.inner)
	record, err := candidate.ConsumeNativeLink(ctx, request, scopes, now)
	if err != nil {
		return InstallationRecord{}, err
	}
	if err := ctx.Err(); err != nil {
		return InstallationRecord{}, err
	}
	if err := r.commit(candidate); err != nil {
		return InstallationRecord{}, err
	}
	return record, nil
}

func (r *FileRepository) FinishNativeLink(ctx context.Context, expected InstallationRecord, now time.Time) (InstallationRecord, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	candidate := cloneMemoryRepository(r.inner)
	record, err := candidate.FinishNativeLink(ctx, expected, now)
	if err != nil {
		return InstallationRecord{}, err
	}
	if err := ctx.Err(); err != nil {
		return InstallationRecord{}, err
	}
	if err := r.commit(candidate); err != nil {
		return InstallationRecord{}, err
	}
	return record, nil
}

func (s *Service) ConfirmNativeLink(ctx context.Context, request NativeLinkRequest) (shopifyconnector.InstallationSummary, error) {
	if _, _, err := validateNativeLinkRequest(request); err != nil {
		return shopifyconnector.InstallationSummary{}, err
	}
	unlock := s.lockIdentity(request.Identity)
	defer unlock()
	record, err := s.repository.ConsumeNativeLink(ctx, request, s.requiredScopes, s.now().UTC())
	if err != nil {
		return shopifyconnector.InstallationSummary{}, err
	}
	record, err = s.finishNativeLink(ctx, record)
	if err != nil {
		return shopifyconnector.InstallationSummary{}, err
	}
	return summary(record), nil
}

// Caller holds the identity lock. Persisted ownership never rolls back when the
// external write times out: retry the same idempotent app-data assignment. Reads
// remain closed until FinishNativeLink succeeds; revoked installs cannot revive.
func (s *Service) finishNativeLink(ctx context.Context, record InstallationRecord) (InstallationRecord, error) {
	if !record.NativeLinkPending {
		return record, nil
	}
	if s.appDataConfigurer == nil {
		return InstallationRecord{}, errors.New("Shopify native link configuration is unavailable")
	}
	refreshed, _, err := s.providerAccessToken(ctx, record)
	if err != nil {
		return InstallationRecord{}, errors.New("Shopify native link configuration is unavailable")
	}
	if err := s.appDataConfigurer.ConfigureInstallationAppData(ctx, refreshed.ShopDomain, refreshed.AccessToken, refreshed.Identity); err != nil {
		return InstallationRecord{}, errors.New("Shopify native link configuration is unavailable")
	}
	return s.repository.FinishNativeLink(ctx, refreshed, s.now().UTC())
}
