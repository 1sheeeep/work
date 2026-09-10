package installations

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

func pendingFixture(t *testing.T, repository Repository) (*Service, *Handler, *embeddedSessionExchanger, *embeddedCatalogProvider) {
	t.Helper()
	now := time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC)
	exchanger := &embeddedSessionExchanger{result: OAuthExchangeResult{
		AccessToken: "shpat_pending_synthetic", RefreshToken: "shprt_pending_synthetic",
		AccessTokenTTL: time.Hour, RefreshTokenTTL: 90 * 24 * time.Hour,
		Scopes: []string{"read_products", "read_orders"},
	}}
	catalog := &embeddedCatalogProvider{}
	service := NewServiceWithCatalogs(repository, exchanger.result.Scopes, &fakeEffects{}, exchanger, catalog, catalog)
	service.installationChecker = fixtureInstallationRejected{}
	service.now = func() time.Time { return now }
	service.shopIdentity = fakeShopIdentityProvider{identity: shopifyconnector.ShopIdentity{Name: "Synthetic pending store", MyshopifyDomain: "demo.myshopify.com"}}
	if err := service.RequireExpiringOfflineTokens(exchanger, "test-key-v1", 5*time.Minute); err != nil {
		t.Fatal(err)
	}
	handler, err := NewHandler(RuntimeConfig{
		ServiceToken: "service-token", AppAPIKey: "app-key", AppSecret: "app-secret",
		Scopes: exchanger.result.Scopes, CallbackURL: "https://connector.test/shopify/oauth/callback", StateTTL: 10 * time.Minute,
	}, service, repository)
	if err != nil {
		t.Fatal(err)
	}
	handler.now = service.now
	return service, handler, exchanger, catalog
}

func pendingRequest(t *testing.T, handler *Handler, route, domain string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, route, nil)
	request.Header.Set("Authorization", "Bearer "+signEmbeddedSessionToken(t, "app-key", "app-secret", domain, handler.now()))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func TestManagedInstallAuthorizesBeforeERPBindingWithoutBusinessAccess(t *testing.T) {
	repository := NewMemoryRepository()
	service, handler, exchanger, catalog := pendingFixture(t, repository)
	configurer := &fakeInstallationAppDataConfigurer{}
	service.appDataConfigurer = configurer
	for _, route := range []string{EmbeddedSessionPath, EmbeddedProductsPath, EmbeddedOrdersPath} {
		response := pendingRequest(t, handler, route, "demo.myshopify.com")
		if response.Code != http.StatusConflict || response.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("pending status/headers: %d", response.Code)
		}
		var payload struct {
			State   string                     `json:"state"`
			Code    string                     `json:"code"`
			Pending PendingInstallationSummary `json:"pending"`
		}
		if json.Unmarshal(response.Body.Bytes(), &payload) != nil || payload.State != "AUTHORIZED_UNLINKED" || payload.Code != "INSTALLATION_LINK_REQUIRED" || payload.Pending.ShopDomain != "demo.myshopify.com" || len(payload.Pending.GrantedScopes) != 2 {
			t.Fatal("pending state was not returned")
		}
		for _, forbidden := range []string{"shpat_", "shprt_", "accessToken", "refreshToken", "app-secret", "service-token", "tenantId", "legacyShop", "shopifyInstallShop", `"link"`, `"orders"`, `"products"`} {
			if strings.Contains(response.Body.String(), forbidden) {
				t.Fatalf("pending response exposed forbidden field %q", forbidden)
			}
		}
	}
	if exchanger.calls != 1 || catalog.productCalls != 0 || catalog.orderCalls != 0 || configurer.accessToken != "" {
		t.Fatal("pending authorization repeated exchange or unlocked business/configuration")
	}
	if _, err := repository.ResolveIdentityByDomain(t.Context(), "demo.myshopify.com"); !errors.Is(err, ErrNotFound) {
		t.Fatal("pending authorization created canonical ownership")
	}
	if _, err := repository.GetInstallation(t.Context(), identity()); !errors.Is(err, ErrNotFound) {
		t.Fatal("pending authorization became an installation")
	}
}

func TestPendingManagedInstallRejectsUnverifiedOrCrossShopRequest(t *testing.T) {
	for _, tokenKind := range []string{"missing", "tampered", "wrong-audience", "expired"} {
		t.Run(tokenKind, func(t *testing.T) {
			repository := NewMemoryRepository()
			_, handler, exchanger, _ := pendingFixture(t, repository)
			token := signEmbeddedSessionToken(t, "app-key", "app-secret", "demo.myshopify.com", handler.now())
			switch tokenKind {
			case "missing":
				token = ""
			case "tampered":
				token += "bad"
			case "wrong-audience":
				token = signEmbeddedSessionToken(t, "other-app", "app-secret", "demo.myshopify.com", handler.now())
			case "expired":
				token = signEmbeddedSessionToken(t, "app-key", "app-secret", "demo.myshopify.com", handler.now().Add(-time.Hour))
			}
			request := httptest.NewRequest(http.MethodPost, EmbeddedSessionPath+"?shop=other.myshopify.com", nil)
			request.Header.Set("Authorization", "Bearer "+token)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusUnauthorized || exchanger.calls != 0 {
				t.Fatal("unverified request initiated authorization")
			}
		})
	}
	repository := NewMemoryRepository()
	_, handler, _, _ := pendingFixture(t, repository)
	response := pendingRequest(t, handler, EmbeddedSessionPath+"?shop=other.myshopify.com", "demo.myshopify.com")
	if response.Code != http.StatusConflict {
		t.Fatal("verified request failed")
	}
	if _, _, err := repository.GetPendingInstallation(t.Context(), "other.myshopify.com"); !errors.Is(err, ErrNotFound) {
		t.Fatal("URL shop overrode signed shop")
	}
}

func TestPendingManagedInstallFailsClosedOnProviderAndScopeErrors(t *testing.T) {
	for _, scenario := range []string{"missing-scope", "invalid-lifetime", "wrong-shop", "missing-shop-provider", "provider-error", "legacy-token-mode", "cancelled"} {
		t.Run(scenario, func(t *testing.T) {
			repository := NewMemoryRepository()
			service, _, exchanger, _ := pendingFixture(t, repository)
			ctx := t.Context()
			switch scenario {
			case "missing-scope":
				exchanger.result.Scopes = []string{"read_products"}
			case "invalid-lifetime":
				exchanger.result.AccessTokenTTL = 0
			case "wrong-shop":
				service.shopIdentity = fakeShopIdentityProvider{identity: shopifyconnector.ShopIdentity{Name: "Other", MyshopifyDomain: "other.myshopify.com"}}
			case "missing-shop-provider":
				service.shopIdentity = nil
			case "provider-error":
				service.shopIdentity = fakeShopIdentityProvider{err: errors.New("shpat_private provider failure")}
			case "legacy-token-mode":
				service.requireExpiring = false
			case "cancelled":
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(ctx)
				cancel()
			}
			result, err := service.ConnectEmbeddedSession(ctx, "demo.myshopify.com", "synthetic-session")
			if err == nil || errors.Is(err, ErrEmbeddedERPLinkRequired) || result.Pending != nil || strings.Contains(err.Error(), "shpat_") {
				t.Fatal("invalid authorization was accepted or leaked provider details")
			}
			if _, _, err := repository.GetPendingInstallation(t.Context(), "demo.myshopify.com"); !errors.Is(err, ErrNotFound) {
				t.Fatal("failed authorization was persisted")
			}
		})
	}
}

func TestPendingManagedInstallSerializesRepeatedLaunchesAndExpires(t *testing.T) {
	repository := NewMemoryRepository()
	service, _, exchanger, _ := pendingFixture(t, repository)
	var workers sync.WaitGroup
	for i := 0; i < 8; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			result, err := service.ConnectEmbeddedSession(t.Context(), "demo.myshopify.com", "synthetic-session")
			if !errors.Is(err, ErrEmbeddedERPLinkRequired) || result.Pending == nil {
				t.Error("launch did not yield pending state")
			}
		}()
	}
	workers.Wait()
	if exchanger.calls != 1 {
		t.Fatal("concurrent launches repeatedly rotated credentials")
	}
	now := service.now().Add(pendingInstallationLifetime)
	service.now = func() time.Time { return now }
	result, err := service.ConnectEmbeddedSession(t.Context(), "demo.myshopify.com", "new-synthetic-session")
	if !errors.Is(err, ErrEmbeddedERPLinkRequired) || result.Pending == nil || exchanger.calls != 2 || !result.Pending.ExpiresAt.After(now) {
		t.Fatal("expired pending state was reused")
	}
}

func pendingWebhook(domain string, valid bool) *http.Request {
	raw := []byte(`{"myshopify_domain":"` + domain + `"}`)
	request := httptest.NewRequest(http.MethodPost, AppUninstalledWebhookPath, bytes.NewReader(raw))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Shopify-Topic", "app/uninstalled")
	request.Header.Set("X-Shopify-Shop-Domain", domain)
	request.Header.Set("X-Shopify-Webhook-Id", "fixture-pending-uninstall")
	mac := hmac.New(sha256.New, []byte("app-secret"))
	_, _ = mac.Write(raw)
	signature := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	if !valid {
		signature = "invalid"
	}
	request.Header.Set("X-Shopify-Hmac-Sha256", signature)
	return request
}

func TestUninstallClearsUnlinkedCredentialsAndFencesStaleExchange(t *testing.T) {
	repository := NewMemoryRepository()
	_, handler, _, _ := pendingFixture(t, repository)
	pendingRequest(t, handler, EmbeddedSessionPath, "demo.myshopify.com")
	record, revision, err := repository.GetPendingInstallation(t.Context(), "demo.myshopify.com")
	if err != nil {
		t.Fatal(err)
	}
	invalid := httptest.NewRecorder()
	handler.ServeHTTP(invalid, pendingWebhook(record.ShopDomain, false))
	if invalid.Code != http.StatusUnauthorized {
		t.Fatal("invalid webhook accepted")
	}
	if _, _, err := repository.GetPendingInstallation(t.Context(), record.ShopDomain); err != nil {
		t.Fatal("invalid webhook cleared pending state")
	}
	for i := 0; i < 2; i++ {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, pendingWebhook(record.ShopDomain, true))
		if response.Code != http.StatusNoContent {
			t.Fatal("pending uninstall not acknowledged")
		}
	}
	if _, _, err := repository.GetPendingInstallation(t.Context(), record.ShopDomain); !errors.Is(err, ErrNotFound) {
		t.Fatal("uninstall retained pending credential")
	}
	if err := repository.SavePendingInstallation(t.Context(), record, revision, handler.now()); !errors.Is(err, ErrRepositoryStale) {
		t.Fatal("stale exchange resurrected credentials")
	}
}

func TestPendingFileRepositoryEncryptionRestartExpiryAndStaleWriter(t *testing.T) {
	file := filepath.Join(t.TempDir(), "connector.enc")
	key := bytes.Repeat([]byte{7}, 32)
	repository, err := OpenFileRepository(file, key)
	if err != nil {
		t.Fatal(err)
	}
	service, handler, _, _ := pendingFixture(t, repository)
	response := pendingRequest(t, handler, EmbeddedSessionPath, "demo.myshopify.com")
	if response.Code != http.StatusConflict {
		t.Fatal("file authorization failed")
	}
	record, _, err := repository.GetPendingInstallation(t.Context(), "demo.myshopify.com")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{record.AccessToken, record.RefreshToken, record.ShopDomain} {
		if bytes.Contains(raw, []byte(secret)) {
			t.Fatal("encrypted repository exposed plaintext")
		}
	}
	if strings.Contains(fmt.Sprintf("%v %#v", record, record), record.AccessToken) || strings.Contains(fmt.Sprintf("%#v", record), record.RefreshToken) {
		t.Fatal("pending debug formatting exposed credentials")
	}
	reopened, err := OpenFileRepository(file, key)
	if err != nil {
		t.Fatal(err)
	}
	restored, _, err := reopened.GetPendingInstallation(t.Context(), record.ShopDomain)
	if err != nil || restored.AccessToken != record.AccessToken || restored.RefreshToken != record.RefreshToken {
		t.Fatal("pending credential did not survive restart")
	}
	if err := reopened.DiscardPendingInstallation(t.Context(), "other.myshopify.com"); err != nil {
		t.Fatal(err)
	}
	if err := repository.DiscardPendingInstallation(t.Context(), record.ShopDomain); !errors.Is(err, ErrRepositoryStale) {
		t.Fatal("stale writer overwrote newer file")
	}
	if _, _, err := repository.GetPendingInstallation(t.Context(), record.ShopDomain); err != nil {
		t.Fatal("failed persistence changed live state")
	}
	count, err := reopened.PrunePendingInstallations(t.Context(), service.now().Add(pendingInstallationLifetime))
	if err != nil || count != 1 {
		t.Fatal("expiry cleanup failed")
	}
	final, err := OpenFileRepository(file, key)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := final.GetPendingInstallation(t.Context(), record.ShopDomain); !errors.Is(err, ErrNotFound) {
		t.Fatal("expired credential survived cleanup/restart")
	}
}

func TestPendingFileSaveFailureDoesNotMutateLiveRepository(t *testing.T) {
	parent := filepath.Join(t.TempDir(), "blocked")
	repository, err := OpenFileRepository(filepath.Join(parent, "connector.enc"), bytes.Repeat([]byte{8}, 32))
	if err != nil {
		t.Fatal(err)
	}
	// Synthetic filesystem failure wholly inside this test's temporary folder.
	if err := os.WriteFile(parent, []byte("not a directory"), 0600); err != nil {
		t.Fatal(err)
	}
	_, handler, _, _ := pendingFixture(t, repository)
	response := pendingRequest(t, handler, EmbeddedSessionPath, "demo.myshopify.com")
	if response.Code != http.StatusServiceUnavailable {
		t.Fatal("failed file commit reported authorization success")
	}
	if _, _, err := repository.GetPendingInstallation(t.Context(), "demo.myshopify.com"); !errors.Is(err, ErrNotFound) {
		t.Fatal("failed file commit mutated live state")
	}
}

func TestShopRedactClearsPendingStateWithoutInventingTenantOutbox(t *testing.T) {
	repository := NewMemoryRepository()
	_, handler, _, _ := pendingFixture(t, repository)
	pendingRequest(t, handler, EmbeddedSessionPath, "demo.myshopify.com")
	raw := []byte(`{"shop_id":123,"shop_domain":"demo.myshopify.com"}`)
	mac := hmac.New(sha256.New, []byte("app-secret"))
	_, _ = mac.Write(raw)
	for _, valid := range []bool{false, true} {
		request := httptest.NewRequest(http.MethodPost, ComplianceWebhookPath, bytes.NewReader(raw))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("X-Shopify-Topic", "shop/redact")
		request.Header.Set("X-Shopify-Shop-Domain", "demo.myshopify.com")
		signature := "invalid"
		if valid {
			signature = base64.StdEncoding.EncodeToString(mac.Sum(nil))
		}
		request.Header.Set("X-Shopify-Hmac-Sha256", signature)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		_, _, err := repository.GetPendingInstallation(t.Context(), "demo.myshopify.com")
		if !valid && (response.Code != http.StatusUnauthorized || err != nil) {
			t.Fatal("invalid redact cleared pending state")
		}
		if valid && (response.Code != http.StatusNoContent || !errors.Is(err, ErrNotFound)) {
			t.Fatal("verified redact retained pending credential")
		}
	}
	events, err := repository.ListOutbox(t.Context())
	if err != nil || len(events) != 0 {
		t.Fatal("unbound shop fabricated a tenant-scoped outbox event")
	}
}

type pendingFailureRepository struct {
	Repository
	failSave    bool
	failDiscard bool
}

type pendingBlockingExchanger struct {
	started chan struct{}
	release chan struct{}
	result  OAuthExchangeResult
}

func (e *pendingBlockingExchanger) ExchangeOAuthCode(context.Context, string, string) (OAuthExchangeResult, error) {
	return OAuthExchangeResult{}, errors.New("unused in managed installation")
}

func (e *pendingBlockingExchanger) ExchangeSessionToken(ctx context.Context, _, _ string) (OAuthExchangeResult, error) {
	close(e.started)
	select {
	case <-e.release:
		return e.result, nil
	case <-ctx.Done():
		return OAuthExchangeResult{}, ctx.Err()
	}
}

func TestUninstallDuringPendingTokenExchangeCannotResurrectCredential(t *testing.T) {
	repository := NewMemoryRepository()
	service, handler, original, _ := pendingFixture(t, repository)
	blocking := &pendingBlockingExchanger{started: make(chan struct{}), release: make(chan struct{}), result: original.result}
	service.exchanger = blocking
	defer func() {
		select {
		case <-blocking.release:
		default:
			close(blocking.release)
		}
	}()
	done := make(chan error, 1)
	go func() {
		_, err := service.ConnectEmbeddedSession(t.Context(), "demo.myshopify.com", "synthetic-session")
		done <- err
	}()
	select {
	case <-blocking.started:
	case <-time.After(5 * time.Second):
		t.Fatal("exchange never started")
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, pendingWebhook("demo.myshopify.com", true))
	if response.Code != http.StatusNoContent {
		t.Fatal("in-flight uninstall failed")
	}
	close(blocking.release)
	select {
	case err := <-done:
		if err == nil || errors.Is(err, ErrEmbeddedERPLinkRequired) {
			t.Fatal("stale completion acknowledged pending authorization")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("exchange did not finish")
	}
	if _, _, err := repository.GetPendingInstallation(t.Context(), "demo.myshopify.com"); !errors.Is(err, ErrNotFound) {
		t.Fatal("uninstall race restored credentials")
	}
	// A subsequent valid provider exchange can start a new installation; it
	// still creates no tenant or canonical shop and unlocks no business data.
	service.exchanger = original
	if response := pendingRequest(t, handler, EmbeddedSessionPath, "demo.myshopify.com"); response.Code != http.StatusConflict {
		t.Fatal("new authorization could not recover after uninstall")
	}
}

func TestPendingAuthorizationCannotOverwriteCanonicalBinding(t *testing.T) {
	repository := NewMemoryRepository()
	service, handler, _, _ := pendingFixture(t, repository)
	pendingRequest(t, handler, EmbeddedSessionPath, "demo.myshopify.com")
	record, revision, err := repository.GetPendingInstallation(t.Context(), "demo.myshopify.com")
	if err != nil {
		t.Fatal(err)
	}
	binding := Binding{Identity: identity(), LegacyShopID: "legacy-existing", ShopDomain: record.ShopDomain}
	if err := repository.SaveBinding(t.Context(), binding); err != nil {
		t.Fatal(err)
	}
	if err := repository.SavePendingInstallation(t.Context(), record, revision, service.now()); !errors.Is(err, ErrBindingConflict) {
		t.Fatal("pending save accepted an already-owned domain")
	}
	if _, err := repository.GetInstallation(t.Context(), identity()); !errors.Is(err, ErrNotFound) {
		t.Fatal("saving a binding promoted pending credentials")
	}
	if err := repository.CompleteInstallation(t.Context(), binding, InstallationRecord{
		Binding: binding, AccessToken: "shpat_separate_explicit_oauth", Scopes: record.Scopes,
		State: shopifyconnector.InstallationStateInstalled, InstalledAt: service.now(), UpdatedAt: service.now(),
	}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := repository.GetPendingInstallation(t.Context(), record.ShopDomain); !errors.Is(err, ErrNotFound) {
		t.Fatal("explicit installation retained obsolete pending credential")
	}
	installed, err := repository.GetInstallation(t.Context(), identity())
	if err != nil || installed.AccessToken == record.AccessToken {
		t.Fatal("pending credential implicitly became canonical")
	}
}

func (r pendingFailureRepository) SavePendingInstallation(ctx context.Context, record PendingInstallationRecord, revision uint64, now time.Time) error {
	if r.failSave {
		return errors.New("synthetic persistence failure")
	}
	return r.Repository.SavePendingInstallation(ctx, record, revision, now)
}
func (r pendingFailureRepository) DiscardPendingInstallation(ctx context.Context, domain string) error {
	if r.failDiscard {
		return errors.New("synthetic persistence failure")
	}
	return r.Repository.DiscardPendingInstallation(ctx, domain)
}

func (r pendingFailureRepository) RecordUninstallWebhook(ctx context.Context, delivery UninstallWebhook, identity shopifyconnector.CanonicalShopIdentity, now time.Time) (UninstallWebhookReceipt, bool, error) {
	if r.failDiscard {
		return UninstallWebhookReceipt{}, false, errors.New("synthetic persistence failure")
	}
	return r.Repository.RecordUninstallWebhook(ctx, delivery, identity, now)
}

func TestPendingPersistenceFailuresNeverAcknowledgeSuccess(t *testing.T) {
	for _, failure := range []string{"save", "discard"} {
		t.Run(failure, func(t *testing.T) {
			inner := NewMemoryRepository()
			repository := pendingFailureRepository{Repository: inner, failSave: failure == "save", failDiscard: failure == "discard"}
			_, handler, _, _ := pendingFixture(t, repository)
			response := pendingRequest(t, handler, EmbeddedSessionPath, "demo.myshopify.com")
			if failure == "save" {
				if response.Code != http.StatusServiceUnavailable || strings.Contains(response.Body.String(), "AUTHORIZED_UNLINKED") {
					t.Fatal("save failure looked authorized")
				}
				return
			}
			if response.Code != http.StatusConflict {
				t.Fatal("setup failed")
			}
			webhook := httptest.NewRecorder()
			handler.ServeHTTP(webhook, pendingWebhook("demo.myshopify.com", true))
			if webhook.Code != http.StatusServiceUnavailable {
				t.Fatal("failed deletion suppressed webhook retry")
			}
			if _, _, err := inner.GetPendingInstallation(t.Context(), "demo.myshopify.com"); err != nil {
				t.Fatal("failed deletion mutated live state")
			}
		})
	}
}
