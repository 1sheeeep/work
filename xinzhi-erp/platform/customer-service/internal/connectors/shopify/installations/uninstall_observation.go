package installations

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

type InstallationChecker interface {
	CheckCurrentInstallation(context.Context, string, string) error
}

func (s *Service) ConfigureInstallationChecker(checker InstallationChecker) error {
	if s == nil || checker == nil {
		return errors.New("Shopify installation checker configuration is invalid")
	}
	s.installationChecker = checker
	return nil
}

// Transient, server-only CAS evidence. Never populated from HTTP input or
// persisted in a receipt. The pending revision fences first-association races.
type uninstallObservation struct {
	credentialHash  string
	pendingRevision uint64
	preserve        bool
}

func uninstallCredentialHash(record InstallationRecord, exists bool) string {
	if !exists {
		return ""
	}
	// Includes generation/state and both rotating credentials. Hash only; no
	// raw credential escapes into the webhook receipt or diagnostics.
	raw, err := json.Marshal(record)
	if err != nil {
		return ""
	}
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:])
}

func (r *MemoryRepository) HasUninstallWebhook(ctx context.Context, delivery UninstallWebhook) (bool, error) {
	keys, err := delivery.keys()
	if err != nil {
		return false, err
	}
	if err := ctx.Err(); err != nil {
		return false, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, key := range keys {
		if r.uninstallReceiptIndex[key] != "" {
			return true, nil
		}
	}
	event, ok := r.outbox["shopify-revocation/shopify-uninstall:"+delivery.DeliveryID]
	return ok && event.ShopDomain == delivery.ShopDomain && event.Identity == r.bindings[r.domainIndex[delivery.ShopDomain]].Identity &&
		event.Kind == "shopify.installation.revoked" && event.Topic == "app/uninstalled", nil
}

func (r *FileRepository) HasUninstallWebhook(ctx context.Context, delivery UninstallWebhook) (bool, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.inner.HasUninstallWebhook(ctx, delivery)
}

func (s *Service) observeUninstall(ctx context.Context, identity shopifyconnector.CanonicalShopIdentity, domain string) (*uninstallObservation, error) {
	pending, revision, pendingErr := s.repository.GetPendingInstallation(ctx, domain)
	if pendingErr != nil && !errors.Is(pendingErr, ErrNotFound) {
		return nil, pendingErr
	}
	observation := &uninstallObservation{pendingRevision: revision}
	if identity != (shopifyconnector.CanonicalShopIdentity{}) {
		current, err := s.repository.GetInstallation(ctx, identity)
		if errors.Is(err, ErrNotFound) {
			return observation, nil
		}
		if err != nil {
			return nil, err
		}
		observation.credentialHash = uninstallCredentialHash(current, true)
		if observation.credentialHash == "" {
			return nil, ErrInvalidBinding
		}
		if current.State == shopifyconnector.InstallationStateRevoked {
			return observation, nil
		}
		if current.State != shopifyconnector.InstallationStateInstalled {
			return nil, ErrRepositoryStale
		}
		active, checked, err := s.currentAuthorizationActive(ctx, current)
		if err != nil {
			return nil, err
		}
		// Fence exactly the record checked (or our own persisted rotation), never
		// adopt an arbitrary newer record after an external request completes.
		observation.credentialHash = uninstallCredentialHash(checked, true)
		if observation.credentialHash == "" {
			return nil, ErrInvalidBinding
		}
		observation.preserve = active
		return observation, nil
	}
	if pendingErr == nil && pending.ExpiresAt.After(s.now().UTC()) {
		if s.installationChecker == nil {
			return nil, errors.New("Shopify installation checker unavailable")
		}
		err := s.installationChecker.CheckCurrentInstallation(ctx, domain, pending.AccessToken)
		if err != nil && !errors.Is(err, shopifyconnector.ErrProviderTokenRejected) {
			return nil, err
		}
		observation.preserve = err == nil
	}
	return observation, nil
}

func (s *Service) currentAuthorizationActive(ctx context.Context, record InstallationRecord) (bool, InstallationRecord, error) {
	if s.installationChecker == nil || strings.TrimSpace(record.AccessToken) == "" {
		return false, record, errors.New("Shopify installation checker unavailable")
	}
	err := s.installationChecker.CheckCurrentInstallation(ctx, record.ShopDomain, record.AccessToken)
	if err == nil {
		return true, record, nil
	}
	if !errors.Is(err, shopifyconnector.ErrProviderTokenRejected) {
		return false, record, err
	}
	// A rejected fresh credential plus a verified uninstall event can be
	// retired locally. Expiry alone cannot justify deleting a new refresh token.
	if !s.requireExpiring || s.now().UTC().Before(record.AccessTokenExpiresAt.Add(-s.refreshSkew)) {
		return false, record, nil
	}
	rotated, refreshed, refreshErr := s.providerAccessToken(ctx, record)
	if errors.Is(refreshErr, ErrOfflineRefreshInactive) {
		return false, record, nil
	}
	if refreshErr != nil {
		return false, record, refreshErr
	}
	err = s.installationChecker.CheckCurrentInstallation(ctx, record.ShopDomain, refreshed)
	if errors.Is(err, shopifyconnector.ErrProviderTokenRejected) {
		return false, rotated, nil
	}
	return err == nil, rotated, err
}

const uninstallObservationTimeout = 3 * time.Second
