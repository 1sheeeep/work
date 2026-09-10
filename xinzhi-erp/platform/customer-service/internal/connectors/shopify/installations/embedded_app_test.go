package installations

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

type embeddedCatalogProvider struct {
	productCalls int
	orderCalls   int
}

type embeddedSessionExchanger struct {
	calls  int
	result OAuthExchangeResult
}

type protectedDataAuditFailingRepository struct {
	Repository
	err error
}

func TestEmbeddedAppHomeGuidesPluginSetupButKeepsCustomerServiceBusinessIndependent(t *testing.T) {
	response := httptest.NewRecorder()
	renderEmbeddedApp(response, "app-key", "")
	body := response.Body.String()
	for _, expected := range []string{
		"Connection overview",
		"Connection ready",
		"Action required",
		"Read-only reviewer preview",
		"Required permissions",
		`id="scope-list"`,
		`id="retry-session"`,
		"/shopify/session/products",
		"/shopify/session/orders",
		"Xinzhi Chat setup",
		"/shopify/session/chat-setup",
		"activateAppId",
		"window.shopify.app.extensions",
		`id="chat-workspace-link"`,
		"Use the same ERP account via Customer service in ERP; no second password is required.",
	} {
		if !strings.Contains(body, expected) {
			t.Fatalf("embedded app home omitted %q", expected)
		}
	}
	for _, forbidden := range []string{
		"/customer-service/workbench",
		"window.open(",
		"location.assign(",
		"location.replace(",
	} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("embedded app home still owns customer-service plugin operation %q", forbidden)
		}
	}
}

func (r protectedDataAuditFailingRepository) AppendProtectedDataAccess(
	context.Context,
	ProtectedDataAccessEvent,
) error {
	return r.err
}

func (e *embeddedSessionExchanger) ExchangeOAuthCode(context.Context, string, string) (OAuthExchangeResult, error) {
	return OAuthExchangeResult{}, nil
}

func (e *embeddedSessionExchanger) ExchangeSessionToken(_ context.Context, _ string, _ string) (OAuthExchangeResult, error) {
	e.calls++
	return e.result, nil
}

func (e *embeddedSessionExchanger) RefreshOfflineToken(context.Context, string, string) (OAuthExchangeResult, error) {
	return e.result, nil
}

func (p *embeddedCatalogProvider) FetchProductCatalogPage(_ context.Context, _ string, _ string, request shopifyconnector.ProductCatalogPageRequest) (shopifyconnector.ProductCatalogPage, error) {
	p.productCalls++
	now := time.Now().UTC()
	return shopifyconnector.ConnectedProductCatalogPage(request, []shopifyconnector.CatalogProduct{{
		ID: "gid://shopify/Product/1", Title: "Review product", Status: "ACTIVE",
		Variants: []shopifyconnector.CatalogVariant{{ID: "gid://shopify/ProductVariant/1", Title: "Default"}},
	}}, shopifyconnector.CatalogPageInfo{}, now), nil
}

func (p *embeddedCatalogProvider) FetchOrderCatalogPage(_ context.Context, _ string, _ string, request shopifyconnector.OrderCatalogPageRequest) (shopifyconnector.OrderCatalogPage, error) {
	p.orderCalls++
	now := time.Now().UTC()
	return shopifyconnector.ConnectedOrderCatalogPage(request, []shopifyconnector.CatalogOrder{{
		ID: "gid://shopify/Order/1", Name: "#1001", Email: "private@example.com", CreatedAt: now.Add(-time.Hour).Format(time.RFC3339),
		DisplayFinancialStatus: "PAID", Total: shopifyconnector.CatalogMoney{Amount: "10.00", CurrencyCode: "USD"},
		Customer: shopifyconnector.CatalogCustomer{
			DisplayName: "Ada Lovelace", Email: "private@example.com", Phone: "+15551234567",
		},
		ShippingAddress: shopifyconnector.CatalogMailingAddress{
			Name: "Ada Lovelace", Phone: "+15551234567",
			Formatted: []string{"1 Main Street", "Toronto, Ontario A1A 1A1", "Canada"},
		},
		LineItems: []shopifyconnector.CatalogOrderLine{}, Fulfillments: []shopifyconnector.CatalogFulfillment{},
	}}, shopifyconnector.CatalogPageInfo{}, now), nil
}

func TestEmbeddedSessionRejectsInvalidSignatureAndUnavailableManagedExchange(t *testing.T) {
	handler := newTestHandler(t, &recordingExchanger{})
	handler.now = func() time.Time { return time.Date(2026, 8, 3, 14, 0, 0, 0, time.UTC) }
	valid := signEmbeddedSessionToken(t, "app-key", "app-secret", "demo.myshopify.com", handler.now())

	invalidRequest := httptest.NewRequest(http.MethodPost, EmbeddedSessionPath, nil)
	invalidRequest.Header.Set("Authorization", "Bearer "+valid+"invalid")
	invalidResponse := httptest.NewRecorder()
	handler.ServeHTTP(invalidResponse, invalidRequest)
	if invalidResponse.Code != http.StatusUnauthorized || !strings.Contains(invalidResponse.Body.String(), "INVALID_SHOPIFY_SESSION") {
		t.Fatalf("invalid session was accepted: status=%d body=%s", invalidResponse.Code, invalidResponse.Body.String())
	}

	unboundRequest := httptest.NewRequest(http.MethodPost, EmbeddedSessionPath, nil)
	unboundRequest.Header.Set("Authorization", "Bearer "+valid)
	unboundResponse := httptest.NewRecorder()
	handler.ServeHTTP(unboundResponse, unboundRequest)
	if unboundResponse.Code != http.StatusServiceUnavailable || !strings.Contains(unboundResponse.Body.String(), "SHOPIFY_SESSION_UNAVAILABLE") ||
		strings.Contains(unboundResponse.Body.String(), "shopifyInstallShop") {
		t.Fatalf("unconfigured exchange must not pretend authorization succeeded: status=%d body=%s", unboundResponse.Code, unboundResponse.Body.String())
	}
}

func TestEmbeddedSessionExchangesAndPersistsExpiringOfflineCredentialOnce(t *testing.T) {
	now := time.Date(2026, 8, 3, 14, 0, 0, 0, time.UTC)
	repository := NewMemoryRepository()
	binding := Binding{Identity: identity(), LegacyShopID: "legacy-shop", ShopDomain: "demo.myshopify.com"}
	if err := repository.SaveBinding(t.Context(), binding); err != nil {
		t.Fatalf("save binding: %v", err)
	}
	exchanger := &embeddedSessionExchanger{result: OAuthExchangeResult{
		AccessToken: "shpat_embedded", RefreshToken: "shprt_embedded",
		AccessTokenTTL: time.Hour, RefreshTokenTTL: 90 * 24 * time.Hour,
		Scopes: []string{"read_products", "read_orders"},
	}}
	service := NewService(repository, []string{"read_products", "read_orders"}, &fakeEffects{}, exchanger)
	service.now = func() time.Time { return now }
	if err := service.RequireExpiringOfflineTokens(exchanger, "key-v1", 5*time.Minute); err != nil {
		t.Fatalf("RequireExpiringOfflineTokens: %v", err)
	}
	for attempt := 0; attempt < 2; attempt++ {
		connection, err := service.ConnectEmbeddedSession(t.Context(), "demo.myshopify.com", "signed.session.token")
		if err != nil || connection.Summary.State != shopifyconnector.InstallationStateInstalled {
			t.Fatalf("attempt %d connection=%#v err=%v", attempt, connection, err)
		}
	}
	if exchanger.calls != 1 {
		t.Fatalf("valid stored installation triggered repeated token exchange: calls=%d", exchanger.calls)
	}
	record, err := repository.GetInstallation(t.Context(), identity())
	if err != nil || record.AccessToken != "shpat_embedded" || record.RefreshToken != "shprt_embedded" ||
		record.CredentialKeyVersion != "key-v1" || !record.AccessTokenExpiresAt.Equal(now.Add(time.Hour)) {
		t.Fatalf("expiring embedded credential was not persisted correctly: record=%#v err=%v", record, err)
	}
}

func TestEmbeddedSessionReportsStoredPartialAuthorizationWithoutFailingTheConsole(t *testing.T) {
	now := time.Date(2026, 8, 17, 10, 0, 0, 0, time.UTC)
	repository := NewMemoryRepository()
	binding := Binding{Identity: identity(), LegacyShopID: "legacy-shop", ShopDomain: "demo.myshopify.com"}
	if err := repository.CompleteInstallation(t.Context(), binding, InstallationRecord{
		Binding: binding, AccessToken: "shpat_partial", Scopes: []string{"read_products"},
		ShopName: "Review Store", State: shopifyconnector.InstallationStateInstalled,
		InstalledAt: now.Add(-time.Hour), UpdatedAt: now.Add(-time.Hour),
	}); err != nil {
		t.Fatalf("seed partial installation: %v", err)
	}
	exchanger := &embeddedSessionExchanger{}
	service := NewService(repository, []string{"read_products", "read_orders"}, &fakeEffects{}, exchanger)
	service.now = func() time.Time { return now }

	connection, err := service.ConnectEmbeddedSession(t.Context(), "demo.myshopify.com", "signed.session.token")
	if err != nil || strings.Join(connection.Summary.GrantedScopes, ",") != "read_products" ||
		connection.Summary.ShopName != "Review Store" {
		t.Fatalf("partial authorization was not returned to the connector console: connection=%#v err=%v", connection, err)
	}
	if exchanger.calls != 0 {
		t.Fatalf("viewing a partial authorization must not start an implicit reauthorization: calls=%d", exchanger.calls)
	}
}

func TestEmbeddedCatalogRoutesUseSessionIdentityAndExposeNecessaryOrderContactData(t *testing.T) {
	now := time.Date(2026, 8, 3, 14, 0, 0, 0, time.UTC)
	repository := NewMemoryRepository()
	binding := Binding{Identity: identity(), LegacyShopID: "legacy-shop", ShopDomain: "demo.myshopify.com"}
	if err := repository.CompleteInstallation(t.Context(), binding, InstallationRecord{
		Binding: binding, AccessToken: "shpat_embedded_secret", Scopes: []string{"read_products", "read_orders"},
		ShopName: "Review Store", State: shopifyconnector.InstallationStateInstalled,
		InstalledAt: now.Add(-time.Hour), UpdatedAt: now.Add(-time.Hour),
	}); err != nil {
		t.Fatalf("seed installation: %v", err)
	}
	provider := &embeddedCatalogProvider{}
	service := NewServiceWithCatalogs(repository, []string{"read_products", "read_orders"}, &fakeEffects{}, &recordingExchanger{}, provider, provider)
	handler, err := NewHandler(RuntimeConfig{
		ServiceToken: "service-token", AppAPIKey: "app-key", AppSecret: "app-secret",
		Scopes: []string{"read_products", "read_orders"}, CallbackURL: "https://connector.example/shopify/oauth/callback",
	}, service, repository)
	if err != nil {
		t.Fatalf("NewHandler failed: %v", err)
	}
	handler.now = func() time.Time { return now }
	token := signEmbeddedSessionToken(t, "app-key", "app-secret", "demo.myshopify.com", now)

	for _, path := range []string{EmbeddedSessionPath, EmbeddedProductsPath, EmbeddedOrdersPath} {
		request := httptest.NewRequest(http.MethodPost, path, nil)
		request.Header.Set("Authorization", "Bearer "+token)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("%s status=%d body=%s", path, response.Code, response.Body.String())
		}
		body := response.Body.String()
		if strings.Contains(body, "shpat_") || strings.Contains(body, testTenantID) || strings.Contains(body, testShopID) {
			t.Fatalf("%s leaked internal credentials or identifiers: %s", path, body)
		}
		if path == EmbeddedSessionPath {
			for _, expected := range []string{
				`"state":"CONNECTED"`,
				`"shopDomain":"demo.myshopify.com"`,
				`"shopName":"Review Store"`,
				`"grantedScopes":["read_orders","read_products"]`,
				`"requiredScopes":["read_orders","read_products"]`,
				`"erpLinkURL":"/shops?shopifyInstallShop=demo.myshopify.com"`,
			} {
				if !strings.Contains(body, expected) {
					t.Fatalf("%s omitted connector-console field %q: %s", path, expected, body)
				}
			}
		} else if path == EmbeddedOrdersPath {
			for _, expected := range []string{"Ada Lovelace", "private@example.com", "+15551234567", "1 Main Street", "Toronto, Ontario A1A 1A1", "Canada"} {
				if !strings.Contains(body, expected) {
					t.Fatalf("%s did not expose required fulfillment field %q: %s", path, expected, body)
				}
			}
		} else if strings.Contains(body, "private@example.com") {
			t.Fatalf("%s exposed order contact data outside the order endpoint: %s", path, body)
		}
	}
	if provider.productCalls != 1 || provider.orderCalls != 1 {
		t.Fatalf("embedded catalogs were not fetched exactly once: products=%d orders=%d", provider.productCalls, provider.orderCalls)
	}
	events, err := repository.ListProtectedDataAccess(t.Context())
	if err != nil || len(events) != 1 {
		t.Fatalf("embedded order access audit mismatch: events=%#v err=%v", events, err)
	}
	event := events[0]
	if event.Identity != identity() || event.ActorID != "shopify-user:1" ||
		event.Surface != "embeddedOrderPreview" || event.FieldSet != "name,address,phone,email" ||
		event.RecordCount != 1 || event.OccurredAt != now {
		t.Fatalf("embedded order access audit metadata mismatch: %#v", event)
	}
	for _, forbidden := range []string{"Ada Lovelace", "private@example.com", "+15551234567", "1 Main Street"} {
		if strings.Contains(event.String(), forbidden) {
			t.Fatalf("embedded order access audit leaked customer data %q: %s", forbidden, event.String())
		}
	}
}

func TestEmbeddedOrderPreviewFailsClosedWhenAccessAuditCannotPersist(t *testing.T) {
	now := time.Date(2026, 8, 3, 14, 0, 0, 0, time.UTC)
	repository := NewMemoryRepository()
	binding := Binding{Identity: identity(), LegacyShopID: "legacy-shop", ShopDomain: "demo.myshopify.com"}
	if err := repository.CompleteInstallation(t.Context(), binding, InstallationRecord{
		Binding: binding, AccessToken: "shpat_embedded_secret", Scopes: []string{"read_orders"},
		ShopName: "Review Store", State: shopifyconnector.InstallationStateInstalled,
		InstalledAt: now.Add(-time.Hour), UpdatedAt: now.Add(-time.Hour),
	}); err != nil {
		t.Fatalf("seed installation: %v", err)
	}
	provider := &embeddedCatalogProvider{}
	service := NewServiceWithCatalogs(repository, []string{"read_orders"}, &fakeEffects{}, &recordingExchanger{}, provider, provider)
	handlerRepository := protectedDataAuditFailingRepository{
		Repository: repository, err: errors.New("fixture private@example.com audit failure"),
	}
	handler, err := NewHandler(RuntimeConfig{
		ServiceToken: "service-token", AppAPIKey: "app-key", AppSecret: "app-secret",
		Scopes: []string{"read_orders"}, CallbackURL: "https://connector.example/shopify/oauth/callback",
	}, service, handlerRepository)
	if err != nil {
		t.Fatalf("NewHandler failed: %v", err)
	}
	handler.now = func() time.Time { return now }
	request := httptest.NewRequest(http.MethodPost, EmbeddedOrdersPath, nil)
	request.Header.Set("Authorization", "Bearer "+signEmbeddedSessionToken(
		t, "app-key", "app-secret", "demo.myshopify.com", now))
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusServiceUnavailable ||
		!strings.Contains(response.Body.String(), "PROTECTED_DATA_AUDIT_UNAVAILABLE") {
		t.Fatalf("audit failure did not fail closed: status=%d body=%s", response.Code, response.Body.String())
	}
	for _, forbidden := range []string{"Ada Lovelace", "private@example.com", "+15551234567", "1 Main Street", "audit failure"} {
		if strings.Contains(response.Body.String(), forbidden) {
			t.Fatalf("audit failure response leaked private data %q: %s", forbidden, response.Body.String())
		}
	}
	events, err := repository.ListProtectedDataAccess(t.Context())
	if err != nil || len(events) != 0 {
		t.Fatalf("failed audit write published an event: events=%#v err=%v", events, err)
	}
}

func TestVerifyEmbeddedSessionTokenRejectsWrongAudienceIssuerAndExpiry(t *testing.T) {
	now := time.Date(2026, 8, 3, 14, 0, 0, 0, time.UTC)
	valid := signEmbeddedSessionToken(t, "app-key", "app-secret", "demo.myshopify.com", now)
	if claims, err := verifyEmbeddedSessionToken(valid, "app-key", "app-secret", now); err != nil || claims.ShopDomain() != "demo.myshopify.com" {
		t.Fatalf("valid session token rejected: claims=%#v err=%v", claims, err)
	}
	if _, err := verifyEmbeddedSessionToken(valid, "wrong-key", "app-secret", now); err == nil {
		t.Fatal("wrong audience was accepted")
	}
	expired := signEmbeddedSessionToken(t, "app-key", "app-secret", "demo.myshopify.com", now.Add(-2*time.Minute))
	if _, err := verifyEmbeddedSessionToken(expired, "app-key", "app-secret", now); err == nil {
		t.Fatal("expired token was accepted")
	}
	if embeddedActorID("123456") != "shopify-user:123456" ||
		embeddedActorID("gid://shopify/User/123456") != "shopify-user:123456" ||
		embeddedActorID("gid://shopify/User/not-a-number") != "" {
		t.Fatal("embedded actor normalization accepted an unsafe identity")
	}
}

func signEmbeddedSessionToken(t *testing.T, audience string, secret string, domain string, now time.Time) string {
	t.Helper()
	header, err := json.Marshal(map[string]string{"alg": "HS256", "typ": "JWT"})
	if err != nil {
		t.Fatalf("marshal header: %v", err)
	}
	destinationURL := "https://" + domain
	adminURL := destinationURL + "/admin"
	payload, err := json.Marshal(embeddedSessionClaims{
		Audience: audience, Dest: destinationURL, Issuer: adminURL, IssuedAt: now.Unix(), NotBefore: now.Unix(),
		ExpiresAt: now.Add(time.Minute).Unix(), SessionID: "session-id", Subject: "gid://shopify/User/1",
	})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	unsigned := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(unsigned))
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
