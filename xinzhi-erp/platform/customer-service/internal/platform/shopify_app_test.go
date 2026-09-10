package platform

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestShopifyStateAndCallbackHMAC(t *testing.T) {
	secret := "test-secret"
	shop := "demo.myshopify.com"
	state := signedShopifyState(shop, secret)
	if !verifySignedShopifyState(state, shop, secret) {
		t.Fatal("expected signed state to verify")
	}
	if verifySignedShopifyState(state, "other.myshopify.com", secret) {
		t.Fatal("state verified for wrong shop")
	}

	values := url.Values{}
	values.Set("shop", shop)
	values.Set("code", "code-123")
	values.Set("state", state)
	values.Set("timestamp", "1783180000")
	values.Set("hmac", hmacHex(secret, "code=code-123&shop=demo.myshopify.com&state="+state+"&timestamp=1783180000"))
	if !verifyShopifyCallbackHMAC(values, secret) {
		t.Fatalf("expected callback HMAC to verify")
	}
	values.Set("code", "tampered")
	if verifyShopifyCallbackHMAC(values, secret) {
		t.Fatal("HMAC verified after tampering")
	}
}

func TestShopifyInstallRejectsExternalAuthorizationTarget(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/auth?shop=example.com", nil)
	NewServer(NewMemoryStore()).handleShopifyInstall(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("external authorization target returned %d, want %d", recorder.Code, http.StatusBadRequest)
	}
	if location := recorder.Header().Get("Location"); location != "" {
		t.Fatalf("external authorization target produced redirect %q", location)
	}
}

func TestShopifyAuthorizationBindingUsesSelectedProfileAcrossDomainCanonicalization(t *testing.T) {
	t.Setenv("SHOPIFY_CREDENTIALS_ENCRYPTION_KEY", "test-encryption-key-with-enough-entropy")
	store := NewMemoryStore()
	shop, err := store.CreateShop(context.Background(), Shop{DisplayName: "Demo", ExternalID: "old-handle.myshopify.com"})
	if err != nil {
		t.Fatalf("CreateShop failed: %v", err)
	}
	secret, err := encryptShopifyCredential("per-shop-client-secret")
	if err != nil {
		t.Fatalf("encrypt client secret: %v", err)
	}
	automationToken, err := encryptShopifyCredential("per-shop-automation-token")
	if err != nil {
		t.Fatalf("encrypt automation token: %v", err)
	}
	profile, err := store.SaveShopifyAppProfile(context.Background(), ShopifyAppProfile{
		ShopID: shop.ID, ShopDomain: "old-handle.myshopify.com", ClientID: "1234567890abcdef1234567890abcdef",
		EncryptedClientSecret: secret, EncryptedAutomationToken: automationToken, DeployStatus: ShopifyAppDeployReady,
	})
	if err != nil {
		t.Fatalf("SaveShopifyAppProfile failed: %v", err)
	}

	server := NewServer(store)
	reference := signedShopifyProfileReference(profile.ShopID, "per-shop-client-secret")
	cfg, state, err := server.shopifyAuthorizationContext(context.Background(), "authorization-handle.myshopify.com", reference)
	if err != nil {
		t.Fatalf("shopifyAuthorizationContext failed: %v", err)
	}
	if cfg.APIKey != profile.ClientID {
		t.Fatalf("authorization used the wrong app profile: %#v", cfg)
	}
	callbackCfg, targetShopID, err := server.shopifyCallbackContext(context.Background(), "canonical-handle.myshopify.com", state)
	if err != nil {
		t.Fatalf("shopifyCallbackContext failed after Shopify canonicalized the domain: %v", err)
	}
	if targetShopID != shop.ID || callbackCfg.APIKey != profile.ClientID {
		t.Fatalf("callback lost the selected Xzdesk shop binding: target=%q cfg=%#v", targetShopID, callbackCfg)
	}
}

func TestEnsureShopifyAppInstallationBindsVerifiedDomainToSelectedShop(t *testing.T) {
	t.Setenv("SHOPIFY_CREDENTIALS_ENCRYPTION_KEY", "test-encryption-key-with-enough-entropy")
	ctx := context.Background()
	store := NewMemoryStore()
	shop, err := store.CreateShop(ctx, Shop{
		DisplayName: "Configured Name", Platform: "shopify", ExternalID: "old-handle.myshopify.com",
		Metadata: map[string]string{"shopifyDomain": "old-handle.myshopify.com"},
	})
	if err != nil {
		t.Fatalf("CreateShop failed: %v", err)
	}
	secret, _ := encryptShopifyCredential("per-shop-client-secret")
	automationToken, _ := encryptShopifyCredential("per-shop-automation-token")
	if _, err := store.SaveShopifyAppProfile(ctx, ShopifyAppProfile{
		ShopID: shop.ID, ShopDomain: "old-handle.myshopify.com", ClientID: "1234567890abcdef1234567890abcdef",
		EncryptedClientSecret: secret, EncryptedAutomationToken: automationToken, DeployStatus: ShopifyAppDeployReady,
	}); err != nil {
		t.Fatalf("SaveShopifyAppProfile failed: %v", err)
	}
	server := NewServer(store)
	server.shopifyConnectionChecker = func(context.Context, string, string) ShopifyConnectionStatus {
		return ShopifyConnectionStatus{
			State: "installed", ShopifyStoreID: "gid://shopify/Shop/123", ShopDomain: "canonical-handle.myshopify.com", ShopName: "Shopify Name",
		}
	}

	updated, source, installation, err := server.ensureShopifyAppInstallationForShop(ctx, shop.ID, "authorization-handle.myshopify.com", shopifyOAuthTokenResponse{
		AccessToken: "shpat_test", Scope: "read_orders",
	})
	if err != nil {
		t.Fatalf("ensureShopifyAppInstallationForShop failed: %v", err)
	}
	if updated.ID != shop.ID || updated.ExternalID != "canonical-handle.myshopify.com" || updated.Metadata["shopifyStoreID"] != "gid://shopify/Shop/123" {
		t.Fatalf("selected shop was not updated with Shopify's verified identity: %#v", updated)
	}
	if source.ShopID != shop.ID || source.Address != "canonical-handle.myshopify.com" || installation.ShopID != shop.ID || installation.ShopDomain != "canonical-handle.myshopify.com" {
		t.Fatalf("authorization was not persisted on the selected shop: source=%#v installation=%#v", source, installation)
	}
	storedProfile, err := store.GetShopifyAppProfile(ctx, shop.ID)
	if err != nil || storedProfile.ShopDomain != "canonical-handle.myshopify.com" {
		t.Fatalf("app profile domain was not reconciled after authorization: profile=%#v err=%v", storedProfile, err)
	}
}

func TestEnsureShopifyAppInstallationRejectsDomainBoundToAnotherShop(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	target, err := store.CreateShop(ctx, Shop{DisplayName: "Target"})
	if err != nil {
		t.Fatalf("CreateShop target failed: %v", err)
	}
	other, err := store.CreateShop(ctx, Shop{DisplayName: "Other", ExternalID: "canonical.myshopify.com"})
	if err != nil {
		t.Fatalf("CreateShop other failed: %v", err)
	}
	if _, err := store.SaveShopifyInstallation(ctx, ShopifyInstallation{ShopID: other.ID, ShopDomain: "canonical.myshopify.com", AccessToken: "existing"}); err != nil {
		t.Fatalf("SaveShopifyInstallation failed: %v", err)
	}
	server := NewServer(store)
	server.shopifyConnectionChecker = func(context.Context, string, string) ShopifyConnectionStatus {
		return ShopifyConnectionStatus{State: "installed", ShopDomain: "canonical.myshopify.com", ShopifyStoreID: "gid://shopify/Shop/999"}
	}
	_, _, _, err = server.ensureShopifyAppInstallationForShop(ctx, target.ID, "alias.myshopify.com", shopifyOAuthTokenResponse{AccessToken: "new"})
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("expected duplicate Shopify binding conflict, got %v", err)
	}
}

func TestEnsureShopifyAppInstallationCreatesShopSourceAndInstallation(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	server := NewServer(store)
	connectionChecks := 0
	server.shopifyConnectionChecker = func(context.Context, string, string) ShopifyConnectionStatus {
		connectionChecks++
		return ShopifyConnectionStatus{State: "installed", ShopDomain: "demo.myshopify.com", ShopName: "Demo Shop"}
	}
	shop, source, installation, err := server.ensureShopifyAppInstallation(ctx, "demo.myshopify.com", shopifyOAuthTokenResponse{
		AccessToken: "shpat_test",
		Scope:       "read_orders",
	})
	if err != nil {
		t.Fatalf("ensureShopifyAppInstallation failed: %v", err)
	}
	if shop.ID == "" || normalizeShopifyDomain(shop.ExternalID) != "demo.myshopify.com" || shop.DisplayName != "Demo Shop" {
		t.Fatalf("unexpected shop: %#v", shop)
	}
	if source.Type != SourceTypeShopifyAPI || normalizeShopifyDomain(source.Address) != "demo.myshopify.com" {
		t.Fatalf("unexpected source: %#v", source)
	}
	if source.Metadata[shopifyConnectionStateKey] != "installed" || source.Metadata["apiStatus"] != "connected" || source.Metadata[shopifyConnectionCheckedAtKey] == "" {
		t.Fatalf("expected successful authorization status to be persisted: %#v", source.Metadata)
	}
	if connectionChecks != 1 {
		t.Fatalf("authorization should refresh connection status exactly once, got %d checks", connectionChecks)
	}
	if installation.ShopID != shop.ID || installation.AccessToken != "shpat_test" {
		t.Fatalf("unexpected installation: %#v", installation)
	}

	got, err := store.GetShopifyInstallationByDomain(ctx, "https://demo.myshopify.com")
	if err != nil {
		t.Fatalf("GetShopifyInstallationByDomain failed: %v", err)
	}
	if got.AccessToken != "shpat_test" {
		t.Fatalf("unexpected token: %#v", got)
	}
}

func TestShopifyAppConfigSupportsRiskProjectEnvNames(t *testing.T) {
	t.Setenv("SHOPIFY_APP_API_KEY", "")
	t.Setenv("SHOPIFY_APP_API_SECRET", "")
	t.Setenv("SHOPIFY_API_KEY", "client-id")
	t.Setenv("SHOPIFY_API_SECRET", "client-secret")
	t.Setenv("PUBLIC_BASE_URL", "https://support.example.com")
	t.Setenv("SHOPIFY_SCOPES", "read_orders")
	cfg, err := shopifyAppConfig()
	if err != nil {
		t.Fatalf("shopifyAppConfig failed: %v", err)
	}
	if cfg.APIKey != "client-id" || cfg.Secret != "client-secret" || cfg.RedirectURI(httptest.NewRequest(http.MethodGet, "http://local/auth", nil)) != "https://support.example.com/auth/callback" {
		t.Fatalf("unexpected config: %#v", cfg)
	}
	for _, required := range []string{shopifyReturnWriteScope, shopifyDisputeReadScope} {
		if !shopifyScopeIncludes(cfg.Scopes, required) {
			t.Fatalf("configured scopes did not include required scope %q: %s", required, cfg.Scopes)
		}
	}
}

func TestMergeShopifyAppScopesPreservesConfiguredScopesWithoutDuplicates(t *testing.T) {
	got := mergeShopifyAppScopes("read_orders,custom_scope,read_orders", "write_returns,custom_scope")
	if got != "read_orders,custom_scope,write_returns" {
		t.Fatalf("unexpected merged scopes: %s", got)
	}
}

func TestPublicShopifyAppDoesNotFallBackToLegacyCredentialsOrScopes(t *testing.T) {
	t.Setenv("SHOPIFY_APP_DISTRIBUTION", shopifyDistributionPublic)
	t.Setenv("SHOPIFY_APP_API_KEY", "")
	t.Setenv("SHOPIFY_APP_API_SECRET", "")
	t.Setenv("SHOPIFY_APP_SCOPES", "")
	t.Setenv("SHOPIFY_APP_API_VERSION", "")
	t.Setenv("SHOPIFY_API_KEY", "legacy-client-id")
	t.Setenv("SHOPIFY_API_SECRET", "legacy-client-secret")
	t.Setenv("SHOPIFY_SCOPES", "read_customers")
	t.Setenv("SHOPIFY_API_VERSION", "2026-01")

	if _, err := shopifyAppConfig(); err == nil {
		t.Fatal("public app unexpectedly accepted legacy credentials")
	}
	cfg := shopifyBaseSettings()
	if cfg.Scopes != defaultShopifyAppScopes {
		t.Fatalf("public app inherited legacy scopes: %q", cfg.Scopes)
	}
	if cfg.APIVersion != shopifyPublicAdminAPIVersion {
		t.Fatalf("public app inherited legacy API version: %q", cfg.APIVersion)
	}
}

func TestShopifyInstallRequestsDefaultScopes(t *testing.T) {
	const expectedScopes = "read_all_orders,read_customers,read_locations,read_products,read_shopify_payments_disputes,write_inventory,write_merchant_managed_fulfillment_orders,write_order_edits,write_orders,write_returns"
	t.Setenv("SHOPIFY_CREDENTIALS_ENCRYPTION_KEY", "test-encryption-key-with-enough-entropy")
	t.Setenv("SHOPIFY_APP_SCOPES", "")
	t.Setenv("SHOPIFY_SCOPES", "")
	t.Setenv("PUBLIC_BASE_URL", "https://support.example.com")
	store := NewMemoryStore()
	shop, err := store.CreateShop(context.Background(), Shop{DisplayName: "Demo", ExternalID: "demo.myshopify.com"})
	if err != nil {
		t.Fatalf("CreateShop failed: %v", err)
	}
	secret, err := encryptShopifyCredential("per-shop-client-secret")
	if err != nil {
		t.Fatalf("encrypt client secret: %v", err)
	}
	token, err := encryptShopifyCredential("per-shop-automation-token")
	if err != nil {
		t.Fatalf("encrypt automation token: %v", err)
	}
	if _, err := store.SaveShopifyAppProfile(context.Background(), ShopifyAppProfile{
		ShopID: shop.ID, ShopDomain: "demo.myshopify.com", ClientID: "per-shop-client-id",
		EncryptedClientSecret: secret, EncryptedAutomationToken: token, DeployStatus: ShopifyAppDeployReady,
	}); err != nil {
		t.Fatalf("SaveShopifyAppProfile failed: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/auth?shop=demo.myshopify.com", nil)
	rec := httptest.NewRecorder()
	NewServer(store).handleShopifyInstall(rec, req)
	if rec.Code != http.StatusFound {
		t.Fatalf("unexpected status %d body=%s", rec.Code, rec.Body.String())
	}
	redirectURL, err := url.Parse(rec.Header().Get("Location"))
	if err != nil {
		t.Fatalf("parse redirect URL: %v", err)
	}
	if got := redirectURL.Query().Get("scope"); got != expectedScopes {
		t.Fatalf("unexpected default scopes: %q", got)
	}
	if defaultShopifyAppScopes != expectedScopes {
		t.Fatalf("default scope constant drifted: %q", defaultShopifyAppScopes)
	}
}

func TestRegisterShopifyUninstalledWebhookUsesGraphQLAdminAPI(t *testing.T) {
	originalClient := http.DefaultClient
	t.Cleanup(func() { http.DefaultClient = originalClient })
	var requestBody string
	http.DefaultClient = &http.Client{Transport: shopifyAppRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.Method != http.MethodPost || request.URL.String() != "https://demo.myshopify.com/admin/api/2026-07/graphql.json" {
			t.Fatalf("unexpected Shopify request: %s %s", request.Method, request.URL)
		}
		if request.Header.Get("X-Shopify-Access-Token") != "shpat_test" {
			t.Fatal("missing Shopify access token")
		}
		raw, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatalf("read request body: %v", err)
		}
		requestBody = string(raw)
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     make(http.Header),
			Body: io.NopCloser(strings.NewReader(
				`{"data":{"webhookSubscriptionCreate":{"webhookSubscription":{"id":"gid://shopify/WebhookSubscription/1"},"userErrors":[]}}}`)),
		}, nil
	})}
	cfg := shopifyAppSettings{BaseURL: "https://app.example.com", APIVersion: "2026-07"}
	if err := registerShopifyAppUninstalledWebhook(t.Context(), "demo.myshopify.com", "shpat_test", cfg); err != nil {
		t.Fatalf("register uninstall webhook: %v", err)
	}
	if !strings.Contains(requestBody, "webhookSubscriptionCreate") ||
		!strings.Contains(requestBody, "APP_UNINSTALLED") ||
		!strings.Contains(requestBody, "https://app.example.com/webhooks/shopify/app/uninstalled") {
		t.Fatalf("unexpected GraphQL request body: %s", requestBody)
	}
}

type shopifyAppRoundTripFunc func(*http.Request) (*http.Response, error)

func (function shopifyAppRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func TestShopifyUninstallWebhookDeletesInstallationAndDisablesSource(t *testing.T) {
	t.Setenv("SHOPIFY_API_KEY", "client-id")
	t.Setenv("SHOPIFY_API_SECRET", "client-secret")
	t.Setenv("PUBLIC_BASE_URL", "https://support.example.com")

	store := NewMemoryStore()
	server := NewServer(store)
	server.shopifyConnectionChecker = func(context.Context, string, string) ShopifyConnectionStatus {
		return ShopifyConnectionStatus{State: "installed", ShopDomain: "demo.myshopify.com", ShopName: "Demo Shop"}
	}
	shop, _, _, err := server.ensureShopifyAppInstallation(context.Background(), "demo.myshopify.com", shopifyOAuthTokenResponse{
		AccessToken: "shpat_test",
		Scope:       "read_orders",
	})
	if err != nil {
		t.Fatalf("ensureShopifyAppInstallation failed: %v", err)
	}
	raw := `{"id":123}`
	req := httptest.NewRequest(http.MethodPost, "/webhooks/shopify/app/uninstalled", strings.NewReader(raw))
	req.Header.Set("X-Shopify-Shop-Domain", "demo.myshopify.com")
	req.Header.Set("X-Shopify-Hmac-Sha256", webhookHMAC("client-secret", raw))
	rec := httptest.NewRecorder()
	server.handleShopifyAppUninstalled(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status %d body=%s", rec.Code, rec.Body.String())
	}
	if _, err := store.GetShopifyInstallationByDomain(context.Background(), "demo.myshopify.com"); err != ErrNotFound {
		t.Fatalf("expected installation to be deleted for shop %s, got err=%v", shop.ID, err)
	}
	sources, err := store.ListShopSources(context.Background(), shop.ID)
	if err != nil {
		t.Fatalf("ListShopSources failed: %v", err)
	}
	if len(sources) != 1 || sources[0].Status != SourceStatusDisabled {
		t.Fatalf("expected Shopify API source to be disabled after uninstall, got %#v", sources)
	}
	_, source, _, err := server.ensureShopifyAppInstallation(context.Background(), "demo.myshopify.com", shopifyOAuthTokenResponse{
		AccessToken: "shpat_new",
		Scope:       "read_orders",
	})
	if err != nil {
		t.Fatalf("ensureShopifyAppInstallation reinstall failed: %v", err)
	}
	if source.ID != sources[0].ID || source.Status != SourceStatusActive {
		t.Fatalf("expected reinstall to reactivate existing source, got %#v", source)
	}
}

func TestShopifyOrderWebhookQueuesIncrementalSync(t *testing.T) {
	t.Setenv("SHOPIFY_API_KEY", "client-id")
	t.Setenv("SHOPIFY_API_SECRET", "client-secret")
	t.Setenv("PUBLIC_BASE_URL", "https://support.example.com")
	store := NewMemoryStore()
	server := NewServer(store)
	server.shopifyConnectionChecker = func(context.Context, string, string) ShopifyConnectionStatus {
		return ShopifyConnectionStatus{State: "installed", ShopDomain: "orders.myshopify.com", ShopName: "Orders"}
	}
	shop, _, _, err := server.ensureShopifyAppInstallation(context.Background(), "orders.myshopify.com", shopifyOAuthTokenResponse{AccessToken: "shpat_test", Scope: "read_orders"})
	if err != nil {
		t.Fatal(err)
	}
	var queries []string
	server.shopifyOrderPageSearch = func(_ context.Context, _, _, query string, _ int, _ string) (shopifyOrderPage, error) {
		queries = append(queries, query)
		return shopifyOrderPage{}, nil
	}
	workerCtx, cancelWorkers := context.WithCancel(t.Context())
	defer cancelWorkers()
	server.StartShopifyOrderSync(workerCtx)
	raw := `{"id":456}`
	req := httptest.NewRequest(http.MethodPost, "/webhooks/shopify/orders", strings.NewReader(raw))
	req.Header.Set("X-Shopify-Shop-Domain", "orders.myshopify.com")
	req.Header.Set("X-Shopify-Hmac-Sha256", webhookHMAC("client-secret", raw))
	req.Header.Set("X-Shopify-Webhook-Id", "webhook-456")
	req.Header.Set("X-Shopify-Topic", "orders/updated")
	rec := httptest.NewRecorder()
	server.handleShopifyOrderWebhook(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("unexpected status %d body=%s", rec.Code, rec.Body.String())
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if state := server.loadShopifyOrderSnapshot(context.Background(), shop).State; state.State == "ok" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if state := server.loadShopifyOrderSnapshot(context.Background(), shop).State; state.State != "ok" {
		t.Fatalf("webhook sync did not complete: %#v", state)
	}
	if len(queries) != 1 || queries[0] != "id:456" {
		t.Fatalf("webhook should target one order, got queries %#v", queries)
	}
	duplicate := httptest.NewRequest(http.MethodPost, "/webhooks/shopify/orders", strings.NewReader(raw))
	duplicate.Header = req.Header.Clone()
	duplicateRec := httptest.NewRecorder()
	server.handleShopifyOrderWebhook(duplicateRec, duplicate)
	if duplicateRec.Code != http.StatusOK || !strings.Contains(duplicateRec.Body.String(), `"duplicate":true`) {
		t.Fatalf("duplicate webhook was not acknowledged without requeue: status=%d body=%s", duplicateRec.Code, duplicateRec.Body.String())
	}
	time.Sleep(25 * time.Millisecond)
	if len(queries) != 1 {
		t.Fatalf("duplicate webhook triggered another sync: %#v", queries)
	}
}

func TestSyncShopifyDisplayNamePreservesConfiguredName(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	server := NewServer(store)
	shop, err := store.CreateShop(ctx, Shop{
		DisplayName: "Support Team Store",
		Platform:    "shopify",
		ExternalID:  "demo.myshopify.com",
		Metadata:    map[string]string{"shopifyDomain": "demo.myshopify.com"},
	})
	if err != nil {
		t.Fatalf("CreateShop failed: %v", err)
	}
	updated, changed, err := server.syncShopifyDisplayName(ctx, shop, "demo.myshopify.com", "Shopify Store Name")
	if err != nil {
		t.Fatalf("syncShopifyDisplayName failed: %v", err)
	}
	if changed || updated.DisplayName != "Support Team Store" {
		t.Fatalf("configured display name was overwritten: %#v", updated)
	}
}

func TestSyncShopifyDisplayNameUpdatesAddressPlaceholder(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	server := NewServer(store)
	shop, err := store.CreateShop(ctx, Shop{
		DisplayName: "demo.myshopify.com",
		Platform:    "shopify",
		ExternalID:  "demo.myshopify.com",
		Metadata:    map[string]string{"shopifyDomain": "demo.myshopify.com"},
	})
	if err != nil {
		t.Fatalf("CreateShop failed: %v", err)
	}
	updated, changed, err := server.syncShopifyDisplayName(ctx, shop, "demo.myshopify.com", "Demo Shop")
	if err != nil {
		t.Fatalf("syncShopifyDisplayName failed: %v", err)
	}
	if !changed || updated.DisplayName != "Demo Shop" {
		t.Fatalf("Shopify address placeholder was not replaced: %#v", updated)
	}
}

func TestShopDisplayNameIsShopifyAddress(t *testing.T) {
	if !shopDisplayNameIsShopifyAddress("https://demo.myshopify.com/", "demo.myshopify.com") {
		t.Fatal("expected Shopify address placeholder to match")
	}
	if !shopDisplayNameIsShopifyAddress("demo", "demo.myshopify.com") {
		t.Fatal("expected bare Shopify handle placeholder to match")
	}
	if shopDisplayNameIsShopifyAddress("Demo Shop", "demo.myshopify.com") {
		t.Fatal("did not expect a store name to match the Shopify address")
	}
}

func TestShopifyWebhookHMAC(t *testing.T) {
	raw := []byte(`{"id":123}`)
	header := webhookHMAC("secret", string(raw))
	if !verifyShopifyWebhookHMAC(raw, header, "secret") {
		t.Fatal("expected webhook HMAC to verify")
	}
	if verifyShopifyWebhookHMAC(raw, header, "other") {
		t.Fatal("webhook HMAC verified with wrong secret")
	}
}

func TestShopifyUninstalledWebhookTreatsDuplicateGraphQLSubscriptionAsIdempotent(t *testing.T) {
	originalClient := http.DefaultClient
	t.Cleanup(func() { http.DefaultClient = originalClient })
	http.DefaultClient = &http.Client{Transport: shopifyAppRoundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     make(http.Header),
			Body: io.NopCloser(strings.NewReader(
				`{"data":{"webhookSubscriptionCreate":{"webhookSubscription":null,"userErrors":[{"field":["webhookSubscription","uri"],"message":"Address for this topic has already been taken"}]}}}`)),
		}, nil
	})}
	cfg := shopifyAppSettings{BaseURL: "https://app.example.com", APIVersion: "2026-07"}
	if err := registerShopifyAppUninstalledWebhook(t.Context(), "demo.myshopify.com", "shpat_test", cfg); err != nil {
		t.Fatalf("duplicate uninstall webhook should be idempotent: %v", err)
	}
}

func webhookHMAC(secret string, raw string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(raw))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}
