package installations

import (
	"bytes"
	"context"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

type recoveryExchanger struct {
	embeddedSessionExchanger
	refreshCalls int
	refreshErr   error
	exchangeErr  error
	onExchange   func()
}

func (e *recoveryExchanger) RefreshOfflineToken(context.Context, string, string) (OAuthExchangeResult, error) {
	e.refreshCalls++
	return e.result, e.refreshErr
}

func (e *recoveryExchanger) ExchangeSessionToken(ctx context.Context, domain, token string) (OAuthExchangeResult, error) {
	if e.onExchange != nil {
		e.onExchange()
	}
	e.calls++
	if domain != "demo.myshopify.com" || token != "verified-session-fixture" {
		return OAuthExchangeResult{}, errors.New("unexpected session")
	}
	return e.result, e.exchangeErr
}

func recoveryFixture(t *testing.T, repo Repository) (*Service, *recoveryExchanger, InstallationRecord) {
	t.Helper()
	now := time.Date(2026, 9, 5, 10, 0, 0, 0, time.UTC)
	exchanger := &recoveryExchanger{embeddedSessionExchanger: embeddedSessionExchanger{result: OAuthExchangeResult{
		AccessToken: "synthetic-new-access", RefreshToken: "synthetic-new-refresh", AccessTokenTTL: time.Hour, RefreshTokenTTL: 90 * 24 * time.Hour, Scopes: []string{"read_products"},
	}}, refreshErr: ErrOfflineRefreshInactive}
	s := NewService(repo, []string{"read_products"}, &fakeEffects{}, exchanger)
	s.now = func() time.Time { return now }
	if err := s.RequireExpiringOfflineTokens(exchanger, "key-v1", 5*time.Minute); err != nil {
		t.Fatal(err)
	}
	record := InstallationRecord{Binding: Binding{Identity: identity(), LegacyShopID: "legacy-shop", ShopDomain: "demo.myshopify.com"},
		AccessToken: "synthetic-old-access", RefreshToken: "synthetic-old-refresh", AccessTokenExpiresAt: now.Add(-time.Minute), RefreshTokenExpiresAt: now.Add(time.Hour),
		CredentialKeyVersion: "key-v1", ShopName: "Existing shop", Scopes: []string{"read_products"}, State: shopifyconnector.InstallationStateInstalled,
		InstalledAt: now.Add(-48 * time.Hour), UpdatedAt: now.Add(-time.Hour), NativeLinkProofHash: strings.Repeat("a", 64), NativeLinkActorID: nativeActor, NativeLinkExpiresAt: now.Add(-48*time.Hour + 10*time.Minute)}
	if err := repo.CompleteInstallation(t.Context(), record.Binding, record); err != nil {
		t.Fatal(err)
	}
	return s, exchanger, record
}

func TestEmbeddedRecoveryPreservesOwnershipAndReceiptAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "recovery.enc")
	key := bytes.Repeat([]byte{8}, 32)
	repo, err := OpenFileRepository(path, key)
	if err != nil {
		t.Fatal(err)
	}
	s, e, before := recoveryFixture(t, repo)
	for attempt := 0; attempt < 2; attempt++ {
		connection, err := s.ConnectEmbeddedSession(t.Context(), before.ShopDomain, "verified-session-fixture")
		if err != nil || connection.Identity != before.Identity {
			t.Fatalf("recovery attempt %d failed", attempt)
		}
		reopened, err := OpenFileRepository(path, key)
		if err != nil {
			t.Fatal(err)
		}
		s.repository = reopened
	}
	after, err := s.repository.GetInstallation(t.Context(), before.Identity)
	if err != nil || after.Binding != before.Binding || after.InstalledAt != before.InstalledAt || after.ShopName != before.ShopName || after.NativeLinkProofHash != before.NativeLinkProofHash || after.NativeLinkActorID != before.NativeLinkActorID || after.NativeLinkExpiresAt != before.NativeLinkExpiresAt {
		t.Fatal("recovery changed canonical ownership or native receipt")
	}
	if after.RefreshToken != e.result.RefreshToken || e.calls != 1 || e.refreshCalls != 1 {
		t.Fatal("credential not recovered exactly once")
	}
}

func TestEmbeddedRecoveryOnlyFollowsTerminalRefresh(t *testing.T) {
	for _, scenario := range []string{"healthy", "refresh-success", "refresh-unknown", "expired-refresh", "missing-credential", "exchange-error", "missing-scope"} {
		t.Run(scenario, func(t *testing.T) {
			repo := NewMemoryRepository()
			s, e, before := recoveryFixture(t, repo)
			wantExchange, wantSuccess := 0, false
			switch scenario {
			case "healthy":
				before.AccessTokenExpiresAt = s.now().Add(time.Hour)
				wantSuccess = true
			case "refresh-success":
				e.refreshErr = nil
				wantSuccess = true
			case "refresh-unknown":
				e.refreshErr = errors.New("synthetic-sensitive-provider-error")
			case "expired-refresh":
				before.RefreshTokenExpiresAt = s.now().Add(-time.Second)
				wantExchange = 1
				wantSuccess = true
			case "missing-credential":
				before.RefreshToken = ""
			case "exchange-error":
				e.exchangeErr = errors.New("synthetic-sensitive-provider-error")
				wantExchange = 1
			case "missing-scope":
				e.result.Scopes = []string{"read_orders"}
				wantExchange = 1
			}
			if err := repo.CompleteInstallation(t.Context(), before.Binding, before); err != nil {
				t.Fatal(err)
			}
			_, err := s.ConnectEmbeddedSession(t.Context(), before.ShopDomain, "verified-session-fixture")
			if (err == nil) != wantSuccess || e.calls != wantExchange {
				t.Fatalf("unexpected recovery success=%v exchange=%d", err == nil, e.calls)
			}
			if err != nil && strings.Contains(err.Error(), "synthetic-sensitive") {
				t.Fatal("provider error leaked")
			}
			if !wantSuccess {
				after, _ := repo.GetInstallation(t.Context(), before.Identity)
				if after.AccessToken != before.AccessToken || after.RefreshToken != before.RefreshToken || after.Binding != before.Binding {
					t.Fatal("failed recovery changed stored credential")
				}
			}
		})
	}
}

type recoveryCommitUnknownRepository struct {
	Repository
	once bool
}

func (r *recoveryCommitUnknownRepository) RotateCredential(ctx context.Context, i shopifyconnector.CanonicalShopIdentity, expected string, replacement OAuthExchangeResult, key string, now time.Time) (InstallationRecord, error) {
	record, err := r.Repository.RotateCredential(ctx, i, expected, replacement, key, now)
	if err == nil && !r.once {
		r.once = true
		return InstallationRecord{}, errors.New("unknown committed response")
	}
	return record, err
}

func TestEmbeddedRecoveryUnknownCommitReusesPersistedCredential(t *testing.T) {
	repo := &recoveryCommitUnknownRepository{Repository: NewMemoryRepository()}
	s, e, before := recoveryFixture(t, repo)
	if _, err := s.ConnectEmbeddedSession(t.Context(), before.ShopDomain, "verified-session-fixture"); err == nil {
		t.Fatal("unknown result reported success")
	}
	if _, err := s.ConnectEmbeddedSession(t.Context(), before.ShopDomain, "verified-session-fixture"); err != nil {
		t.Fatal("retry failed")
	}
	if e.calls != 1 {
		t.Fatal("unknown commit retry exchanged again")
	}
}

func TestEmbeddedRecoveryCannotUndoRevocationOrNewCredential(t *testing.T) {
	for _, revoke := range []bool{true, false} {
		t.Run(map[bool]string{true: "revoked", false: "rotated"}[revoke], func(t *testing.T) {
			repo := NewMemoryRepository()
			s, e, before := recoveryFixture(t, repo)
			e.onExchange = func() {
				if revoke {
					_, _, err := repo.MarkRevoked(t.Context(), before.Identity, s.now())
					if err != nil {
						t.Fatal(err)
					}
				} else {
					replacement := e.result
					replacement.RefreshToken = "synthetic-concurrent-refresh"
					_, err := repo.RotateCredential(t.Context(), before.Identity, before.RefreshToken, replacement, "key-v1", s.now())
					if err != nil {
						t.Fatal(err)
					}
				}
			}
			if _, err := s.ConnectEmbeddedSession(t.Context(), before.ShopDomain, "verified-session-fixture"); err == nil {
				t.Fatal("stale recovery succeeded")
			}
			after, _ := repo.GetInstallation(t.Context(), before.Identity)
			if revoke && after.State != shopifyconnector.InstallationStateRevoked || !revoke && after.RefreshToken != "synthetic-concurrent-refresh" {
				t.Fatal("late recovery overwrote current state")
			}
		})
	}
}

func TestEmbeddedRecoveryPendingConfigurationRetainsReceiptAndCredential(t *testing.T) {
	repo := NewMemoryRepository()
	s, e, before := recoveryFixture(t, repo)
	before.NativeLinkPending = true
	if err := repo.CompleteInstallation(t.Context(), before.Binding, before); err != nil {
		t.Fatal(err)
	}
	s.appDataConfigurer = nativeLinkConfigurerFunc(func(context.Context, string, string, shopifyconnector.CanonicalShopIdentity) error {
		return errors.New("configuration unavailable")
	})
	if _, err := s.ConnectEmbeddedSession(t.Context(), before.ShopDomain, "verified-session-fixture"); err == nil {
		t.Fatal("pending configuration unlocked")
	}
	after, _ := repo.GetInstallation(t.Context(), before.Identity)
	if !after.NativeLinkPending || after.NativeLinkProofHash != before.NativeLinkProofHash || after.RefreshToken != e.result.RefreshToken {
		t.Fatal("pending receipt or recovered token lost")
	}
	s.appDataConfigurer = &fakeInstallationAppDataConfigurer{}
	if _, err := s.ConnectEmbeddedSession(t.Context(), before.ShopDomain, "verified-session-fixture"); err != nil {
		t.Fatal("configuration retry failed")
	}
	if e.calls != 1 {
		t.Fatal("configuration retry exchanged again")
	}
}

func TestEmbeddedRecoveryConcurrentSessionsExchangeOnce(t *testing.T) {
	s, e, before := recoveryFixture(t, NewMemoryRepository())
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := s.ConnectEmbeddedSession(t.Context(), before.ShopDomain, "verified-session-fixture")
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal("concurrent recovery failed")
		}
	}
	if e.calls != 1 {
		t.Fatal("concurrent recovery exchanged multiple credentials")
	}
}

func TestEmbeddedRecoveryRejectsWrongShopAndCancelledContext(t *testing.T) {
	for _, scenario := range []string{"wrong-shop", "cancelled-before", "cancelled-after"} {
		t.Run(scenario, func(t *testing.T) {
			repo := NewMemoryRepository()
			s, e, before := recoveryFixture(t, repo)
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			switch scenario {
			case "wrong-shop":
				s.shopIdentity = fakeShopIdentityProvider{identity: shopifyconnector.ShopIdentity{Name: "Other shop", MyshopifyDomain: "other.myshopify.com"}}
			case "cancelled-before":
				cancel()
			case "cancelled-after":
				e.onExchange = cancel
			}
			if _, err := s.ConnectEmbeddedSession(ctx, before.ShopDomain, "verified-session-fixture"); err == nil {
				t.Fatal("unsafe recovery succeeded")
			}
			after, _ := repo.GetInstallation(t.Context(), before.Identity)
			if after.RefreshToken != before.RefreshToken || after.Binding != before.Binding {
				t.Fatal("unsafe recovery changed credential or owner")
			}
			if scenario == "cancelled-before" && e.calls != 0 {
				t.Fatal("cancelled request exchanged credentials")
			}
		})
	}
}
