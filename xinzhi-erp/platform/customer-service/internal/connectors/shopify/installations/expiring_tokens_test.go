package installations

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

type expiringTokenManager struct {
	exchange OAuthExchangeResult
	refresh  OAuthExchangeResult
	calls    atomic.Int32
}

func (m *expiringTokenManager) ExchangeOAuthCode(context.Context, string, string) (OAuthExchangeResult, error) {
	return m.exchange, nil
}

func (m *expiringTokenManager) RefreshOfflineToken(context.Context, string, string) (OAuthExchangeResult, error) {
	m.calls.Add(1)
	return m.refresh, nil
}

func TestExpiringOfflineCredentialIsStoredAndRotatedAtomically(t *testing.T) {
	now := time.Date(2026, 8, 3, 10, 0, 0, 0, time.UTC)
	manager := &expiringTokenManager{
		exchange: OAuthExchangeResult{
			AccessToken: "shpat_initial", RefreshToken: "shprt_initial",
			AccessTokenTTL: time.Hour, RefreshTokenTTL: 90 * 24 * time.Hour,
			Scopes: []string{"read_orders"},
		},
		refresh: OAuthExchangeResult{
			AccessToken: "shpat_rotated", RefreshToken: "shprt_rotated",
			AccessTokenTTL: time.Hour, RefreshTokenTTL: 90 * 24 * time.Hour,
			Scopes: []string{"read_orders"},
		},
	}
	repository := NewMemoryRepository()
	service := NewService(repository, []string{"read_orders"}, NewConnectorOnlyRevocationEffects(), manager)
	service.now = func() time.Time { return now }
	if err := service.RequireExpiringOfflineTokens(manager, "kms-v1", 5*time.Minute); err != nil {
		t.Fatalf("RequireExpiringOfflineTokens failed: %v", err)
	}
	_, err := service.CompleteOAuth(t.Context(), shopifyconnector.CompleteOAuthRequest{
		Identity: identity(), Context: requestContext("expiring"), LegacyShopID: "legacy-shop",
		ShopDomain: "demo.myshopify.com", AuthorizationCode: "authorization-code",
	})
	if err != nil {
		t.Fatalf("CompleteOAuth failed: %v", err)
	}
	stored, err := repository.GetInstallation(t.Context(), identity())
	if err != nil || stored.RefreshToken != "shprt_initial" || stored.CredentialKeyVersion != "kms-v1" ||
		!stored.AccessTokenExpiresAt.Equal(now.Add(time.Hour)) {
		t.Fatalf("unexpected stored expiring credential: %#v err=%v", stored, err)
	}

	service.now = func() time.Time { return now.Add(56 * time.Minute) }
	rotated, token, err := service.providerAccessToken(t.Context(), stored)
	if err != nil || token != "shpat_rotated" || rotated.RefreshToken != "shprt_rotated" || manager.calls.Load() != 1 {
		t.Fatalf("unexpected rotated credential: record=%#v token=%q calls=%d err=%v", rotated, token, manager.calls.Load(), err)
	}
	_, err = repository.RotateCredential(t.Context(), identity(), "shprt_initial", manager.refresh, "kms-v1", now.Add(57*time.Minute))
	if !errors.Is(err, ErrRepositoryStale) {
		t.Fatalf("stale refresh token replaced a committed credential: %v", err)
	}
}

func TestExpiringOfflineCredentialRejectsLegacyOAuthResponse(t *testing.T) {
	manager := &expiringTokenManager{exchange: OAuthExchangeResult{AccessToken: "shpat_legacy", Scopes: []string{"read_orders"}}}
	repository := NewMemoryRepository()
	service := NewService(repository, []string{"read_orders"}, NewConnectorOnlyRevocationEffects(), manager)
	if err := service.RequireExpiringOfflineTokens(manager, "kms-v1", time.Minute); err != nil {
		t.Fatalf("RequireExpiringOfflineTokens failed: %v", err)
	}
	_, err := service.CompleteOAuth(t.Context(), shopifyconnector.CompleteOAuthRequest{
		Identity: identity(), Context: requestContext("legacy-rejected"), LegacyShopID: "legacy-shop",
		ShopDomain: "demo.myshopify.com", AuthorizationCode: "authorization-code",
	})
	if err == nil {
		t.Fatal("legacy non-expiring OAuth response was accepted")
	}
	if _, getErr := repository.GetInstallation(t.Context(), identity()); !errors.Is(getErr, ErrNotFound) {
		t.Fatalf("rejected credential was persisted: %v", getErr)
	}
}
