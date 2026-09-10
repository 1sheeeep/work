package installations

import (
	"context"
	"errors"
	"math"
	"strings"
	"sync"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

const pendingInstallationLifetime = 15 * time.Minute

// Pending credentials are not installations: they have no tenant, canonical
// shop, legacy binding or business permissions. Only the encrypted repository
// persists this type. Never return it from an HTTP endpoint.
type PendingInstallationRecord struct {
	ShopDomain            string
	ShopName              string
	AccessToken           string
	RefreshToken          string
	AccessTokenExpiresAt  time.Time
	RefreshTokenExpiresAt time.Time
	CredentialKeyVersion  string
	Scopes                []string
	AuthorizedAt          time.Time
	ExpiresAt             time.Time
	LinkProofHash         string
}

func (r PendingInstallationRecord) String() string {
	return "pendingInstallation{domain=" + r.ShopDomain + " credentials=[REDACTED]}"
}

func (r PendingInstallationRecord) GoString() string { return r.String() }

type PendingInstallationSummary struct {
	ShopDomain    string    `json:"shopDomain"`
	ShopName      string    `json:"shopName"`
	GrantedScopes []string  `json:"grantedScopes"`
	ExpiresAt     time.Time `json:"expiresAt"`
}

func pendingSummary(record PendingInstallationRecord) *PendingInstallationSummary {
	return &PendingInstallationSummary{
		ShopDomain: record.ShopDomain, ShopName: record.ShopName,
		GrantedScopes: append([]string(nil), record.Scopes...), ExpiresAt: record.ExpiresAt,
	}
}

func validatePendingInstallation(record PendingInstallationRecord) error {
	if record.LinkProofHash != "" && !validNonceHash(record.LinkProofHash) {
		return ErrNativeLinkUnavailable
	}
	domain, ok := shopifyconnector.NormalizeShopDomain(record.ShopDomain)
	if !ok || domain != record.ShopDomain || shopifyconnector.ValidateShopIdentity(shopifyconnector.ShopIdentity{Name: record.ShopName, MyshopifyDomain: domain}) != nil || strings.TrimSpace(record.AccessToken) == "" ||
		strings.TrimSpace(record.RefreshToken) == "" || strings.TrimSpace(record.CredentialKeyVersion) == "" ||
		len(record.Scopes) == 0 || record.AuthorizedAt.IsZero() || !record.ExpiresAt.After(record.AuthorizedAt) ||
		record.ExpiresAt.After(record.AuthorizedAt.Add(pendingInstallationLifetime)) ||
		record.AccessTokenExpiresAt.Before(record.ExpiresAt) || record.RefreshTokenExpiresAt.Before(record.ExpiresAt) {
		return errors.New("pending Shopify installation is invalid")
	}
	return nil
}

// The revision is a small optimistic fence for the shared encrypted snapshot.
// An uninstall/expiry/save during token exchange must prevent a stale result
// from resurrecting credentials. Unrelated concurrent first installs may retry.
func (r *MemoryRepository) GetPendingInstallation(ctx context.Context, domain string) (PendingInstallationRecord, uint64, error) {
	if err := ctx.Err(); err != nil {
		return PendingInstallationRecord{}, 0, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	record, ok := r.pendingInstallations[domain]
	if !ok {
		return PendingInstallationRecord{}, r.pendingRevision, ErrNotFound
	}
	record.Scopes = append([]string(nil), record.Scopes...)
	return record, r.pendingRevision, nil
}

func (r *MemoryRepository) SavePendingInstallation(ctx context.Context, record PendingInstallationRecord, expectedRevision uint64, now time.Time) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := validatePendingInstallation(record); err != nil {
		return err
	}
	if !record.ExpiresAt.After(now) || record.AuthorizedAt.After(now) {
		return ErrRepositoryStale
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.pendingRevision != expectedRevision || r.pendingRevision == math.MaxUint64 {
		return ErrRepositoryStale
	}
	if _, bound := r.domainIndex[record.ShopDomain]; bound {
		return ErrBindingConflict
	}
	record.Scopes = append([]string(nil), record.Scopes...)
	r.pendingInstallations[record.ShopDomain] = record
	r.pendingRevision++
	return nil
}

func (r *MemoryRepository) DiscardPendingInstallation(ctx context.Context, domain string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	normalized, ok := shopifyconnector.NormalizeShopDomain(domain)
	if !ok || normalized != domain {
		return ErrInvalidBinding
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.pendingRevision == math.MaxUint64 {
		return ErrRepositoryStale
	}
	delete(r.pendingInstallations, domain)
	// Advance even when no record exists: exchange may currently be in flight.
	r.pendingRevision++
	return nil
}

func (r *MemoryRepository) PrunePendingInstallations(ctx context.Context, now time.Time) (int, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	count := 0
	for _, record := range r.pendingInstallations {
		if !record.ExpiresAt.After(now) {
			count++
		}
	}
	if count == 0 {
		return 0, nil
	}
	if r.pendingRevision == math.MaxUint64 {
		return 0, ErrRepositoryStale
	}
	for domain, record := range r.pendingInstallations {
		if !record.ExpiresAt.After(now) {
			delete(r.pendingInstallations, domain)
		}
	}
	r.pendingRevision++
	return count, nil
}

func (r *FileRepository) GetPendingInstallation(ctx context.Context, domain string) (PendingInstallationRecord, uint64, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.inner.GetPendingInstallation(ctx, domain)
}

func (r *FileRepository) SavePendingInstallation(ctx context.Context, record PendingInstallationRecord, expectedRevision uint64, now time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	candidate := cloneMemoryRepository(r.inner)
	if err := candidate.SavePendingInstallation(ctx, record, expectedRevision, now); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return r.commit(candidate)
}

func (r *FileRepository) DiscardPendingInstallation(ctx context.Context, domain string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	candidate := cloneMemoryRepository(r.inner)
	if err := candidate.DiscardPendingInstallation(ctx, domain); err != nil {
		return err
	}
	return r.commit(candidate)
}

func (r *FileRepository) PrunePendingInstallations(ctx context.Context, now time.Time) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	candidate := cloneMemoryRepository(r.inner)
	count, err := candidate.PrunePendingInstallations(ctx, now)
	if err != nil || count == 0 {
		return count, err
	}
	if err := r.commit(candidate); err != nil {
		return 0, err
	}
	return count, nil
}

// Called only after the HTTP layer verifies the Shopify ID token. Domain here
// comes from that token, never from an input field, URL parameter or ERP user.
func (s *Service) prepareUnlinkedInstallation(ctx context.Context, domain, sessionToken string) (EmbeddedSessionConnection, error) {
	lock, _ := s.identityLocks.LoadOrStore("pending:"+domain, &sync.Mutex{})
	mutex := lock.(*sync.Mutex)
	mutex.Lock()
	defer mutex.Unlock()
	now := s.now().UTC()
	if _, err := s.repository.PrunePendingInstallations(ctx, now); err != nil {
		return EmbeddedSessionConnection{}, errors.New("pending Shopify cleanup is unavailable")
	}
	record, revision, err := s.repository.GetPendingInstallation(ctx, domain)
	if err == nil && validatePendingInstallation(record) == nil && record.ExpiresAt.After(now) && containsAllScopes(record.Scopes, s.requiredScopes) {
		return EmbeddedSessionConnection{Pending: pendingSummary(record)}, ErrEmbeddedERPLinkRequired
	}
	if err != nil && !errors.Is(err, ErrNotFound) {
		return EmbeddedSessionConnection{}, errors.New("pending Shopify installation is unavailable")
	}
	exchanger, ok := s.exchanger.(SessionTokenExchanger)
	if !ok || !s.requireExpiring || s.shopIdentity == nil {
		return EmbeddedSessionConnection{}, errors.New("pending Shopify authorization is unavailable")
	}
	exchange, err := exchanger.ExchangeSessionToken(ctx, domain, sessionToken)
	if err != nil || validateExpiringOAuthResult(exchange) != nil {
		return EmbeddedSessionConnection{}, errors.New("pending Shopify token exchange failed")
	}
	exchange.Scopes = normalizeScopes(exchange.Scopes)
	if !containsAllScopes(exchange.Scopes, s.requiredScopes) {
		return EmbeddedSessionConnection{}, errors.New("pending Shopify authorization is missing required scopes")
	}
	shop, err := s.shopIdentity.FetchShopIdentity(ctx, domain, strings.TrimSpace(exchange.AccessToken))
	if err != nil || shopifyconnector.ValidateShopIdentity(shop) != nil || !strings.EqualFold(shop.MyshopifyDomain, domain) {
		return EmbeddedSessionConnection{}, errors.New("pending Shopify shop verification failed")
	}
	expires := now.Add(pendingInstallationLifetime)
	accessExpires, refreshExpires := now.Add(exchange.AccessTokenTTL), now.Add(exchange.RefreshTokenTTL)
	if accessExpires.Before(expires) {
		expires = accessExpires
	}
	if refreshExpires.Before(expires) {
		expires = refreshExpires
	}
	record = PendingInstallationRecord{
		ShopDomain: domain, ShopName: strings.TrimSpace(shop.Name),
		AccessToken: strings.TrimSpace(exchange.AccessToken), RefreshToken: strings.TrimSpace(exchange.RefreshToken),
		AccessTokenExpiresAt: accessExpires, RefreshTokenExpiresAt: refreshExpires,
		CredentialKeyVersion: s.credentialKeyVersion, Scopes: exchange.Scopes,
		AuthorizedAt: now, ExpiresAt: expires,
	}
	if err := s.repository.SavePendingInstallation(ctx, record, revision, s.now().UTC()); err != nil {
		return EmbeddedSessionConnection{}, errors.New("pending Shopify installation could not be saved")
	}
	return EmbeddedSessionConnection{Pending: pendingSummary(record)}, ErrEmbeddedERPLinkRequired
}
