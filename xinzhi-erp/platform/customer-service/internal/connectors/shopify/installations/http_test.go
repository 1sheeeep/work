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
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

type recordingExchanger struct {
	calls  int
	domain string
	code   string
	result OAuthExchangeResult
	err    error
}

func (e *recordingExchanger) ExchangeOAuthCode(_ context.Context, domain string, code string) (OAuthExchangeResult, error) {
	e.calls++
	e.domain, e.code = domain, code
	return e.result, e.err
}

func TestHTTPRuntimeRequiresExistingServiceTokenForInternalRoutes(t *testing.T) {
	handler := newTestHandler(t, &recordingExchanger{})
	server := httptest.NewServer(handler)
	defer server.Close()

	body := encodeJSON(t, OAuthStartRequest{
		Identity: identity(), Context: requestContext("start"), LegacyShopID: "legacy-shop", ShopDomain: "demo.myshopify.com",
	})
	for _, token := range []string{"", "wrong-token"} {
		req, err := http.NewRequest(http.MethodPost, server.URL+OAuthStartPath, bytes.NewReader(body))
		if err != nil {
			t.Fatalf("NewRequest failed: %v", err)
		}
		if token != "" {
			req.Header.Set(ServiceTokenHeader, token)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("request failed: %v", err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("token %q: expected 403, got %d", token, resp.StatusCode)
		}
	}
}

func TestProtectedDataAccessListIsTokenProtectedBoundedAndCustomerValueFree(t *testing.T) {
	handler := newTestHandler(t, &recordingExchanger{})
	repository, ok := handler.repository.(*MemoryRepository)
	if !ok {
		t.Fatal("test handler repository type changed")
	}
	now := time.Date(2026, 8, 6, 4, 0, 0, 0, time.UTC)
	for index := 0; index < 101; index++ {
		if err := repository.AppendProtectedDataAccess(t.Context(), ProtectedDataAccessEvent{
			ID: fmt.Sprintf("embedded-%024d", index), Identity: identity(),
			ActorID: "shopify-user:123", Surface: "embeddedOrderPreview",
			FieldSet: "name,address,phone,email", RecordCount: index % 11,
			OccurredAt: now.Add(time.Duration(index) * time.Second),
		}); err != nil {
			t.Fatalf("seed protected-data access event %d: %v", index, err)
		}
	}

	unauthorized := httptest.NewRecorder()
	handler.ServeHTTP(unauthorized, httptest.NewRequest(
		http.MethodGet, ProtectedDataAccessListPath, nil))
	if unauthorized.Code != http.StatusForbidden {
		t.Fatalf("unauthorized protected-data access list status=%d", unauthorized.Code)
	}

	invalidQuery := httptest.NewRequest(
		http.MethodGet, ProtectedDataAccessListPath+"?limit=100", nil)
	invalidQuery.Header.Set(ServiceTokenHeader, "service-token")
	invalidQueryResponse := httptest.NewRecorder()
	handler.ServeHTTP(invalidQueryResponse, invalidQuery)
	if invalidQueryResponse.Code != http.StatusBadRequest {
		t.Fatalf("protected-data access query was accepted: status=%d", invalidQueryResponse.Code)
	}

	request := httptest.NewRequest(http.MethodGet, ProtectedDataAccessListPath, nil)
	request.Header.Set(ServiceTokenHeader, "service-token")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("protected-data access list status=%d headers=%v body=%s", response.Code, response.Header(), response.Body.String())
	}
	var payload struct {
		Events []ProtectedDataAccessEvent `json:"events"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil || len(payload.Events) != 100 {
		t.Fatalf("protected-data access list is not bounded: count=%d err=%v", len(payload.Events), err)
	}
	if payload.Events[0].ID != "embedded-000000000000000000000001" ||
		payload.Events[99].ID != "embedded-000000000000000000000100" {
		t.Fatalf("protected-data access list did not return the latest fixed window: first=%s last=%s", payload.Events[0].ID, payload.Events[99].ID)
	}
	for _, forbidden := range []string{"private@example.com", "+15551234567", "Ada Lovelace", "1 Main Street"} {
		if strings.Contains(response.Body.String(), forbidden) {
			t.Fatalf("protected-data access list leaked customer value %q: %s", forbidden, response.Body.String())
		}
	}
}

func TestHTTPRuntimeCompletesOAuthInsideConnectorWithoutSecretResponse(t *testing.T) {
	exchanger := &recordingExchanger{result: OAuthExchangeResult{
		AccessToken: "shpat_callback_secret", Scopes: []string{"read_orders"},
	}}
	handler := newTestHandler(t, exchanger)
	server := httptest.NewServer(handler)
	defer server.Close()

	startBody := encodeJSON(t, OAuthStartRequest{
		Identity: identity(), Context: requestContext("oauth"), LegacyShopID: "legacy-shop", ShopDomain: "demo.myshopify.com",
	})
	startReq, _ := http.NewRequest(http.MethodPost, server.URL+OAuthStartPath, bytes.NewReader(startBody))
	startReq.Header.Set(ServiceTokenHeader, "service-token")
	startResp, err := http.DefaultClient.Do(startReq)
	if err != nil {
		t.Fatalf("OAuth start failed: %v", err)
	}
	defer startResp.Body.Close()
	if startResp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(startResp.Body)
		t.Fatalf("OAuth start status=%d body=%s", startResp.StatusCode, raw)
	}
	var start OAuthStartResult
	if err := json.NewDecoder(startResp.Body).Decode(&start); err != nil {
		t.Fatalf("decode OAuth start: %v", err)
	}
	browserStartURL, err := url.Parse(start.AuthorizationURL)
	if err != nil || browserStartURL.Path != OAuthAuthorizePath || browserStartURL.Query().Get("grant") == "" {
		t.Fatalf("invalid connector browser authorization URL: %q err=%v", start.AuthorizationURL, err)
	}
	for _, forbidden := range []string{"service-token", testTenantID, testShopID, "legacy-shop", "app-secret"} {
		if strings.Contains(start.AuthorizationURL, forbidden) {
			t.Fatalf("browser authorization URL leaked %q: %s", forbidden, start.AuthorizationURL)
		}
	}
	browserClient := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	browserResp, err := browserClient.Get(server.URL + browserStartURL.RequestURI())
	if err != nil {
		t.Fatalf("connector browser authorization failed: %v", err)
	}
	defer browserResp.Body.Close()
	if browserResp.StatusCode != http.StatusFound || len(browserResp.Cookies()) != 1 || browserResp.Header.Get("Referrer-Policy") != "no-referrer" {
		t.Fatalf("expected connector browser binding redirect, got status=%d cookies=%#v", browserResp.StatusCode, browserResp.Cookies())
	}
	browserCookie := browserResp.Cookies()[0]
	if browserCookie.Name != oauthBrowserCookieName || !browserCookie.HttpOnly || !browserCookie.Secure || browserCookie.SameSite != http.SameSiteLaxMode || browserCookie.Path != "/" {
		t.Fatalf("browser binding cookie is not hardened: %#v", browserCookie)
	}
	secondBrowserResp, err := browserClient.Get(server.URL + browserStartURL.RequestURI())
	if err != nil {
		t.Fatalf("second browser authorization request failed: %v", err)
	}
	_ = secondBrowserResp.Body.Close()
	if secondBrowserResp.StatusCode != http.StatusForbidden {
		t.Fatalf("bound one-time grant was reusable by another browser: status=%d", secondBrowserResp.StatusCode)
	}
	shopifyAuthorizeURL, err := url.Parse(browserResp.Header.Get("Location"))
	if err != nil || shopifyAuthorizeURL.Host != "demo.myshopify.com" || shopifyAuthorizeURL.Query().Get("state") == "" {
		t.Fatalf("invalid Shopify authorization redirect: %q err=%v", browserResp.Header.Get("Location"), err)
	}

	query := url.Values{
		"shop":      {"demo.myshopify.com"},
		"code":      {"provider-authorization-code"},
		"state":     {shopifyAuthorizeURL.Query().Get("state")},
		"timestamp": {"1785571200"},
	}
	query.Set("hmac", signShopifyQuery(query, "app-secret"))
	callbackReq, _ := http.NewRequest(http.MethodGet, server.URL+OAuthCallbackPath+"?"+query.Encode(), nil)
	callbackReq.AddCookie(browserCookie)
	callbackResp, err := browserClient.Do(callbackReq)
	if err != nil {
		t.Fatalf("OAuth callback failed: %v", err)
	}
	defer callbackResp.Body.Close()
	raw, _ := io.ReadAll(callbackResp.Body)
	if callbackResp.StatusCode != http.StatusSeeOther || callbackResp.Header.Get("Referrer-Policy") != "no-referrer" {
		t.Fatalf("OAuth callback status=%d body=%s", callbackResp.StatusCode, raw)
	}
	if !strings.HasPrefix(callbackResp.Header.Get("Content-Type"), "text/html") ||
		!strings.Contains(callbackResp.Header.Get("Content-Security-Policy"), "default-src 'none'") ||
		callbackResp.Header.Get("Location") != "https://demo.myshopify.com/admin/apps/app-key" {
		t.Fatalf("OAuth callback did not return the Shopify application: headers=%v body=%s", callbackResp.Header, raw)
	}
	if exchanger.domain != "demo.myshopify.com" || exchanger.code != "provider-authorization-code" {
		t.Fatalf("exchange did not terminate in connector: domain=%q code=%q", exchanger.domain, exchanger.code)
	}
	for _, secret := range []string{"shpat_callback_secret", "provider-authorization-code", "accessToken", "access_token"} {
		if bytes.Contains(raw, []byte(secret)) {
			t.Fatalf("callback leaked %q: %s", secret, raw)
		}
	}
}

func TestHTTPRuntimeRejectsCrossBrowserCallbackAndConsumedStateReplay(t *testing.T) {
	exchanger := &recordingExchanger{result: OAuthExchangeResult{AccessToken: "shpat_secret", Scopes: []string{"read_orders"}}}
	handler := newTestHandler(t, exchanger)
	server := httptest.NewServer(handler)
	defer server.Close()
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	state, cookie := beginBoundBrowserOAuth(t, server.URL)
	maliciousQuery := url.Values{"shop": {"evil.demo.myshopify.com"}, "code": {"provider-code"}, "state": {state}, "timestamp": {"1785571200"}}
	maliciousQuery.Set("hmac", signShopifyQuery(maliciousQuery, "app-secret"))
	maliciousRequest, _ := http.NewRequest(http.MethodGet, server.URL+OAuthCallbackPath+"?"+maliciousQuery.Encode(), nil)
	maliciousRequest.AddCookie(cookie)
	maliciousResponse, err := client.Do(maliciousRequest)
	if err != nil {
		t.Fatalf("malicious callback domain request failed: %v", err)
	}
	_ = maliciousResponse.Body.Close()
	if maliciousResponse.StatusCode != http.StatusForbidden || exchanger.calls != 0 {
		t.Fatalf("malicious callback domain was accepted: status=%d calls=%d", maliciousResponse.StatusCode, exchanger.calls)
	}

	query := url.Values{"shop": {"demo.myshopify.com"}, "code": {"provider-code"}, "state": {state}, "timestamp": {"1785571200"}}
	query.Set("hmac", signShopifyQuery(query, "app-secret"))
	callbackURL := server.URL + OAuthCallbackPath + "?" + query.Encode()

	crossBrowser, err := client.Get(callbackURL)
	if err != nil {
		t.Fatalf("cross-browser callback failed: %v", err)
	}
	_ = crossBrowser.Body.Close()
	if crossBrowser.StatusCode != http.StatusForbidden || exchanger.calls != 0 {
		t.Fatalf("cross-browser callback was accepted: status=%d calls=%d", crossBrowser.StatusCode, exchanger.calls)
	}

	boundRequest, _ := http.NewRequest(http.MethodGet, callbackURL, nil)
	boundRequest.AddCookie(cookie)
	boundResponse, err := client.Do(boundRequest)
	if err != nil {
		t.Fatalf("bound callback failed: %v", err)
	}
	_ = boundResponse.Body.Close()
	if boundResponse.StatusCode != http.StatusSeeOther || exchanger.calls != 1 {
		t.Fatalf("bound callback failed: status=%d calls=%d", boundResponse.StatusCode, exchanger.calls)
	}

	replayRequest, _ := http.NewRequest(http.MethodGet, callbackURL, nil)
	replayRequest.AddCookie(cookie)
	replayResponse, err := client.Do(replayRequest)
	if err != nil {
		t.Fatalf("replay callback failed: %v", err)
	}
	_ = replayResponse.Body.Close()
	if replayResponse.StatusCode != http.StatusForbidden || exchanger.calls != 1 {
		t.Fatalf("consumed state replay was accepted: status=%d calls=%d", replayResponse.StatusCode, exchanger.calls)
	}
}

func TestHTTPRuntimeSanitizesProviderFailure(t *testing.T) {
	exchanger := &recordingExchanger{err: errors.New("provider rejected shpat_secret diagnostic")}
	handler := newTestHandler(t, exchanger)
	server := httptest.NewServer(handler)
	defer server.Close()
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	state, cookie := beginBoundBrowserOAuth(t, server.URL)
	query := url.Values{"shop": {"demo.myshopify.com"}, "code": {"code-secret"}, "state": {state}, "timestamp": {"1785571200"}}
	query.Set("hmac", signShopifyQuery(query, "app-secret"))
	request, _ := http.NewRequest(http.MethodGet, server.URL+OAuthCallbackPath+"?"+query.Encode(), nil)
	request.AddCookie(cookie)
	response, err := client.Do(request)
	if err != nil {
		t.Fatalf("provider failure callback failed: %v", err)
	}
	defer response.Body.Close()
	raw, _ := io.ReadAll(response.Body)
	if response.StatusCode != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d: %s", response.StatusCode, raw)
	}
	if strings.Contains(string(raw), "shpat_") || strings.Contains(string(raw), "provider rejected") || strings.Contains(string(raw), "code-secret") {
		t.Fatalf("provider failure leaked internal detail: %s", raw)
	}
}

func TestHTTPRuntimeRejectsMaliciousShopDomainBeforeGrantCreation(t *testing.T) {
	handler := newTestHandler(t, &recordingExchanger{})
	server := httptest.NewServer(handler)
	defer server.Close()
	body := encodeJSON(t, OAuthStartRequest{
		Identity: identity(), Context: requestContext("bad-domain"), LegacyShopID: "legacy-shop",
		ShopDomain: "evil.demo.myshopify.com",
	})
	request, _ := http.NewRequest(http.MethodPost, server.URL+OAuthStartPath, bytes.NewReader(body))
	request.Header.Set(ServiceTokenHeader, "service-token")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("malicious domain request failed: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("malicious domain accepted: status=%d", response.StatusCode)
	}
}

func TestHTTPRuntimeStrictOfflineModeDoesNotIssueAnUnusableOAuthLink(t *testing.T) {
	repository := NewMemoryRepository()
	service := NewService(
		repository,
		[]string{"read_orders"},
		&fakeEffects{},
		&recordingExchanger{})
	handler, err := NewHandler(RuntimeConfig{
		ServiceToken: "service-token",
		AppAPIKey:    "xz-erp-local-not-configured",
		AppSecret:    "xz-erp-local-not-configured",
		Scopes:       []string{"read_orders"},
		CallbackURL:  "https://local.invalid/shopify/oauth/callback",
	}, service, repository)
	if err != nil {
		t.Fatalf("NewHandler failed: %v", err)
	}
	body := encodeJSON(t, OAuthStartRequest{
		Identity: identity(), Context: requestContext("strict-offline"),
		LegacyShopID: "legacy-shop", ShopDomain: "demo.myshopify.com",
	})
	request := httptest.NewRequest(http.MethodPost, OAuthStartPath, bytes.NewReader(body))
	request.Header.Set(ServiceTokenHeader, "service-token")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusBadGateway ||
		strings.Contains(response.Body.String(), "authorizationUrl") ||
		strings.Contains(response.Body.String(), "not-configured") {
		t.Fatalf("strict offline OAuth start did not fail safely: status=%d body=%s",
			response.Code, response.Body.String())
	}
}

func TestHTTPRuntimeRevokesInstalledCredentialFromVerifiedUninstallWebhook(t *testing.T) {
	repository := NewMemoryRepository()
	now := time.Now().UTC()
	binding := Binding{Identity: identity(), LegacyShopID: "legacy-shop", ShopDomain: "demo.myshopify.com"}
	if err := repository.CompleteInstallation(t.Context(), binding, InstallationRecord{
		Binding: binding, AccessToken: "shpat_webhook_secret", ShopName: "Demo",
		Scopes: []string{"read_orders"}, State: shopifyconnector.InstallationStateInstalled,
		InstalledAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("seed installation: %v", err)
	}
	service := NewService(repository, []string{"read_orders"}, NewConnectorOnlyRevocationEffects(), &recordingExchanger{})
	service.installationChecker = fixtureInstallationRejected{}
	handler, err := NewHandler(RuntimeConfig{
		ServiceToken: "service-token", AppAPIKey: "app-key", AppSecret: "app-secret",
		Scopes: []string{"read_orders"}, CallbackURL: "https://connector.example/shopify/oauth/callback",
	}, service, repository)
	if err != nil {
		t.Fatalf("NewHandler failed: %v", err)
	}
	raw := []byte(`{"id":123,"myshopify_domain":"demo.myshopify.com"}`)

	invalid := httptest.NewRequest(http.MethodPost, AppUninstalledWebhookPath, bytes.NewReader(raw))
	invalid.Header.Set("Content-Type", "application/json")
	invalid.Header.Set("X-Shopify-Topic", "app/uninstalled")
	invalid.Header.Set("X-Shopify-Shop-Domain", "demo.myshopify.com")
	invalid.Header.Set("X-Shopify-Hmac-Sha256", shopifyWebhookHMAC(raw, "wrong-secret"))
	invalidResponse := httptest.NewRecorder()
	handler.ServeHTTP(invalidResponse, invalid)
	if invalidResponse.Code != http.StatusUnauthorized {
		t.Fatalf("invalid HMAC status=%d body=%s", invalidResponse.Code, invalidResponse.Body.String())
	}
	before, _ := repository.GetInstallation(t.Context(), identity())
	if before.State != shopifyconnector.InstallationStateInstalled || before.AccessToken == "" {
		t.Fatalf("invalid webhook changed installation: %#v", before)
	}

	for attempt := 0; attempt < 2; attempt++ {
		request := httptest.NewRequest(http.MethodPost, AppUninstalledWebhookPath, bytes.NewReader(raw))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("X-Shopify-Topic", "app/uninstalled")
		request.Header.Set("X-Shopify-Shop-Domain", "demo.myshopify.com")
		request.Header.Set("X-Shopify-Webhook-Id", "webhook-123")
		request.Header.Set("X-Shopify-Hmac-Sha256", shopifyWebhookHMAC(raw, "app-secret"))
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusNoContent {
			t.Fatalf("attempt %d status=%d body=%s", attempt, response.Code, response.Body.String())
		}
	}
	after, _ := repository.GetInstallation(t.Context(), identity())
	if after.State != shopifyconnector.InstallationStateRevoked || after.AccessToken != "" || after.RefreshToken != "" || !after.EffectsApplied {
		t.Fatalf("verified uninstall did not revoke installation safely: %#v", after)
	}
	events, err := repository.ListOutbox(t.Context())
	if err != nil || len(events) != 1 || events[0].Topic != "app/uninstalled" {
		t.Fatalf("uninstall outbox event mismatch: events=%#v err=%v", events, err)
	}
}

func TestHTTPRuntimeAcceptsComplianceWebhookWithoutPersistingContactData(t *testing.T) {
	repository := NewMemoryRepository()
	now := time.Now().UTC()
	binding := Binding{Identity: identity(), LegacyShopID: "legacy-shop", ShopDomain: "demo.myshopify.com"}
	if err := repository.CompleteInstallation(t.Context(), binding, InstallationRecord{
		Binding: binding, AccessToken: "token", State: shopifyconnector.InstallationStateInstalled,
		Scopes: []string{"read_orders"}, InstalledAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("seed installation: %v", err)
	}
	service := NewService(repository, []string{"read_orders"}, NewConnectorOnlyRevocationEffects(), &recordingExchanger{})
	handler, err := NewHandler(RuntimeConfig{
		ServiceToken: "service-token", AppAPIKey: "app-key", AppSecret: "app-secret",
		Scopes: []string{"read_orders"}, CallbackURL: "https://connector.example/shopify/oauth/callback",
	}, service, repository)
	if err != nil {
		t.Fatalf("NewHandler failed: %v", err)
	}
	raw := []byte(`{"shop_id":456,"shop_domain":"demo.myshopify.com","customer":{"id":123,"email":"private@example.com","phone":"+15551234567"},"orders_requested":[9,8]}`)
	for attempt := 0; attempt < 2; attempt++ {
		request := httptest.NewRequest(http.MethodPost, ComplianceWebhookPath, bytes.NewReader(raw))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("X-Shopify-Topic", "customers/data_request")
		request.Header.Set("X-Shopify-Shop-Domain", "demo.myshopify.com")
		request.Header.Set("X-Shopify-Webhook-Id", "compliance-123")
		request.Header.Set("X-Shopify-Hmac-Sha256", shopifyWebhookHMAC(raw, "app-secret"))
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusNoContent {
			t.Fatalf("attempt %d status=%d body=%s", attempt, response.Code, response.Body.String())
		}
	}
	events, err := repository.ListOutbox(t.Context())
	if err != nil || len(events) != 1 {
		t.Fatalf("compliance outbox mismatch: events=%#v err=%v", events, err)
	}
	encoded, _ := json.Marshal(events)
	if bytes.Contains(encoded, []byte("private@example.com")) || bytes.Contains(encoded, []byte("+15551234567")) {
		t.Fatalf("compliance outbox persisted contact data: %s", encoded)
	}
	wantReferences := []string{
		"customer:123",
		"customer_email_sha256:" + complianceCustomerEmailHash("private@example.com"),
		"order:8", "order:9", "shop:456",
	}
	if strings.Join(events[0].ReferenceIDs, ",") != strings.Join(wantReferences, ",") {
		t.Fatalf("reference IDs = %#v, want %#v", events[0].ReferenceIDs, wantReferences)
	}

	unauthorized := httptest.NewRecorder()
	handler.ServeHTTP(unauthorized, httptest.NewRequest(http.MethodGet, ComplianceRequestListPath, nil))
	if unauthorized.Code != http.StatusForbidden {
		t.Fatalf("unauthorized compliance list status=%d", unauthorized.Code)
	}

	listRequest := httptest.NewRequest(http.MethodGet, ComplianceRequestListPath, nil)
	listRequest.Header.Set(ServiceTokenHeader, "service-token")
	listResponse := httptest.NewRecorder()
	handler.ServeHTTP(listResponse, listRequest)
	if listResponse.Code != http.StatusOK || listResponse.Header().Get("Cache-Control") != "no-store" ||
		!bytes.Contains(listResponse.Body.Bytes(), []byte(`"id":"`+events[0].ID+`"`)) ||
		bytes.Contains(listResponse.Body.Bytes(), []byte("private@example.com")) {
		t.Fatalf("pending compliance list is invalid: status=%d body=%s", listResponse.Code, listResponse.Body.String())
	}

	complete := func(outcome string) *httptest.ResponseRecorder {
		body, _ := json.Marshal(map[string]string{"eventId": events[0].ID, "outcome": outcome})
		request := httptest.NewRequest(http.MethodPost, ComplianceCompletePath, bytes.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set(ServiceTokenHeader, "service-token")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return response
	}
	if response := complete("deleted"); response.Code != http.StatusBadRequest {
		t.Fatalf("incompatible compliance outcome status=%d body=%s", response.Code, response.Body.String())
	}
	if response := complete("exported"); response.Code != http.StatusOK ||
		!bytes.Contains(response.Body.Bytes(), []byte(`"alreadyCompleted":false`)) {
		t.Fatalf("compliance completion status=%d body=%s", response.Code, response.Body.String())
	}
	if response := complete("exported"); response.Code != http.StatusOK ||
		!bytes.Contains(response.Body.Bytes(), []byte(`"alreadyCompleted":true`)) {
		t.Fatalf("idempotent compliance completion status=%d body=%s", response.Code, response.Body.String())
	}
	if response := complete("not_found"); response.Code != http.StatusConflict {
		t.Fatalf("conflicting compliance completion status=%d body=%s", response.Code, response.Body.String())
	}
	listRequest = httptest.NewRequest(http.MethodGet, ComplianceRequestListPath, nil)
	listRequest.Header.Set(ServiceTokenHeader, "service-token")
	listResponse = httptest.NewRecorder()
	handler.ServeHTTP(listResponse, listRequest)
	if listResponse.Code != http.StatusOK || !bytes.Contains(listResponse.Body.Bytes(), []byte(`"requests":[]`)) {
		t.Fatalf("completed request remained pending: status=%d body=%s", listResponse.Code, listResponse.Body.String())
	}
}

func TestHTTPRuntimeUsesOrdersToRedactForCustomerRedaction(t *testing.T) {
	repository := NewMemoryRepository()
	now := time.Now().UTC()
	binding := Binding{Identity: identity(), LegacyShopID: "legacy-shop", ShopDomain: "demo.myshopify.com"}
	if err := repository.CompleteInstallation(t.Context(), binding, InstallationRecord{
		Binding: binding, AccessToken: "token", State: shopifyconnector.InstallationStateInstalled,
		Scopes: []string{"read_orders"}, InstalledAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("seed installation: %v", err)
	}
	service := NewService(repository, []string{"read_orders"}, NewConnectorOnlyRevocationEffects(), &recordingExchanger{})
	handler, err := NewHandler(RuntimeConfig{
		ServiceToken: "service-token", AppAPIKey: "app-key", AppSecret: "app-secret",
		Scopes: []string{"read_orders"}, CallbackURL: "https://connector.example/shopify/oauth/callback",
	}, service, repository)
	if err != nil {
		t.Fatalf("NewHandler failed: %v", err)
	}
	raw := []byte(`{"shop_id":456,"shop_domain":"demo.myshopify.com","customer":{"id":123},"orders_requested":[7],"orders_to_redact":[9,8]}`)
	request := httptest.NewRequest(http.MethodPost, ComplianceWebhookPath, bytes.NewReader(raw))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Shopify-Topic", "customers/redact")
	request.Header.Set("X-Shopify-Shop-Domain", "demo.myshopify.com")
	request.Header.Set("X-Shopify-Webhook-Id", "redact-123")
	request.Header.Set("X-Shopify-Hmac-Sha256", shopifyWebhookHMAC(raw, "app-secret"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	events, err := repository.ListOutbox(t.Context())
	if err != nil || len(events) != 1 {
		t.Fatalf("compliance outbox mismatch: events=%#v err=%v", events, err)
	}
	wantReferences := []string{"customer:123", "order:8", "order:9", "shop:456"}
	if strings.Join(events[0].ReferenceIDs, ",") != strings.Join(wantReferences, ",") {
		t.Fatalf("reference IDs = %#v, want %#v", events[0].ReferenceIDs, wantReferences)
	}
}

func TestHTTPRuntimeAppLaunchRendersEmbeddedAppHome(t *testing.T) {
	handler := newTestHandler(t, &recordingExchanger{})
	request := httptest.NewRequest(http.MethodGet, AppLaunchPath, nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	body := response.Body.String()
	if response.Code != http.StatusOK || !strings.HasPrefix(response.Header().Get("Content-Type"), "text/html") ||
		!strings.Contains(body, `<meta name="shopify-api-key" content="app-key">`) ||
		!strings.Contains(body, `https://cdn.shopify.com/shopifycloud/app-bridge.js`) ||
		!strings.Contains(body, EmbeddedSessionPath) || !strings.Contains(body, EmbeddedProductsPath) || !strings.Contains(body, EmbeddedOrdersPath) {
		t.Fatalf("embedded app home is incomplete: status=%d headers=%v body=%s", response.Code, response.Header(), body)
	}
	if response.Header().Get("X-Frame-Options") != "" ||
		!strings.Contains(response.Header().Get("Content-Security-Policy"), "frame-ancestors 'none'") {
		t.Fatalf("unsigned public shell must not permit framing: headers=%v", response.Header())
	}
	if !strings.Contains(body, `<html lang="en">`) ||
		!strings.Contains(body, `id="language-toggle"`) ||
		!strings.Contains(body, `SHOPIFY CONNECTOR`) ||
		!strings.Contains(body, `Connection overview`) ||
		!strings.Contains(body, `Connection ready`) ||
		!strings.Contains(body, `Action required`) ||
		!strings.Contains(body, `id="scope-count"`) ||
		!strings.Contains(body, `id="scope-list"`) ||
		!strings.Contains(body, `Required permissions`) ||
		!strings.Contains(body, `id="retry-session"`) ||
		!strings.Contains(body, `Shopify authorized · ERP linking pending`) ||
		!strings.Contains(body, `INSTALLATION_LINK_REQUIRED`) ||
		!strings.Contains(body, `SHOPIFY_PRODUCTS_UNAVAILABLE:"productsUnavailable"`) ||
		!strings.Contains(body, `SHOPIFY_ORDERS_UNAVAILABLE:"ordersUnavailable"`) ||
		!strings.Contains(body, `requiredScopes`) ||
		!strings.Contains(body, `grantedScopes`) ||
		!strings.Contains(body, `id="erp-action"`) ||
		!strings.Contains(body, `Check current Shopify permissions`) ||
		!strings.Contains(body, `shopify://admin/settings/apps`) ||
		!strings.Contains(body, `Credential last updated`) ||
		!strings.Contains(body, `Read-only reviewer preview`) ||
		!strings.Contains(body, `Product preview`) ||
		!strings.Contains(body, `Order fulfillment preview`) ||
		!strings.Contains(body, `Read products`) ||
		!strings.Contains(body, `Read orders`) ||
		!strings.Contains(body, `Not run yet`) ||
		!strings.Contains(body, `recipient:"Recipient"`) ||
		!strings.Contains(body, `address:"Shipping address"`) ||
		!strings.Contains(body, `phone:"Phone"`) ||
		!strings.Contains(body, `email:"Email"`) ||
		!strings.Contains(body, `Business operations remain in Xinzhi ERP`) ||
		!strings.Contains(body, `merchant-authorized order fulfillment and support`) ||
		!strings.Contains(body, `new URLSearchParams(location.search).get("locale")`) {
		t.Fatalf("embedded app home is not reviewer-ready in English: %s", body)
	}
	if strings.Count(body, `loadProducts()`) != 1 || strings.Count(body, `loadOrders()`) != 1 ||
		strings.Contains(body, `Promise.all([loadProducts(),loadOrders()`) {
		t.Fatalf("embedded app home must read reviewer previews only after an explicit button action: %s", body)
	}
	for _, forbidden := range []string{
		`Storefront support chat`,
		`/customer-service/workbench`,
		`No second Shopify authorization is required`,
		`does not request theme-reading access`,
		`window.open(`,
		`location.assign(`,
		`location.replace(`,
	} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("embedded app home must not embed independent business operations or auto-navigate: %q", forbidden)
		}
	}
	if strings.Contains(body, "read_themes") {
		t.Fatalf("theme embed status must not require read_themes: %s", body)
	}
	if strings.Contains(body, "read_shopify_payments_dispute_evidences") || strings.Contains(body, "write_shopify_payments_dispute_evidences") {
		t.Fatalf("embedded app home contains denied dispute-evidence scopes: %s", body)
	}
	if !strings.Contains(body, `target="_top"`) || !strings.Contains(body, `target.origin!==location.origin`) ||
		!strings.Contains(body, `setConnectionState(complete?"ready":"warning"`) {
		t.Fatalf("embedded app home must keep navigation manual and distinguish complete from incomplete authorization: %s", body)
	}
}

func shopifyWebhookHMAC(raw []byte, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(raw)
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

func newTestHandler(t *testing.T, exchanger OAuthExchanger) *Handler {
	t.Helper()
	repository := NewMemoryRepository()
	service := NewService(repository, []string{"read_orders"}, &fakeEffects{}, exchanger)
	service.installationChecker = fixtureInstallationRejected{}
	handler, err := NewHandler(RuntimeConfig{
		ServiceToken: "service-token", AppAPIKey: "app-key", AppSecret: "app-secret",
		Scopes: []string{"read_orders"}, CallbackURL: "https://connector.example/shopify/oauth/callback",
		StateTTL: 10 * time.Minute,
	}, service, repository)
	if err != nil {
		t.Fatalf("NewHandler failed: %v", err)
	}
	return handler
}

func encodeJSON(t *testing.T, value any) []byte {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("json.Marshal failed: %v", err)
	}
	return raw
}

func beginBoundBrowserOAuth(t *testing.T, serverURL string) (string, *http.Cookie) {
	t.Helper()
	startBody := encodeJSON(t, OAuthStartRequest{
		Identity: identity(), Context: requestContext("browser-bound"), LegacyShopID: "legacy-shop", ShopDomain: "demo.myshopify.com",
	})
	startRequest, _ := http.NewRequest(http.MethodPost, serverURL+OAuthStartPath, bytes.NewReader(startBody))
	startRequest.Header.Set(ServiceTokenHeader, "service-token")
	startResponse, err := http.DefaultClient.Do(startRequest)
	if err != nil {
		t.Fatalf("OAuth start failed: %v", err)
	}
	defer startResponse.Body.Close()
	var start OAuthStartResult
	if startResponse.StatusCode != http.StatusOK || json.NewDecoder(startResponse.Body).Decode(&start) != nil {
		t.Fatalf("OAuth start failed: status=%d", startResponse.StatusCode)
	}
	browserStartURL, err := url.Parse(start.AuthorizationURL)
	if err != nil {
		t.Fatalf("parse browser start URL: %v", err)
	}
	browserClient := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	browserResponse, err := browserClient.Get(serverURL + browserStartURL.RequestURI())
	if err != nil {
		t.Fatalf("browser authorization start failed: %v", err)
	}
	defer browserResponse.Body.Close()
	cookies := browserResponse.Cookies()
	shopifyURL, parseErr := url.Parse(browserResponse.Header.Get("Location"))
	if browserResponse.StatusCode != http.StatusFound || len(cookies) != 1 || parseErr != nil || shopifyURL.Query().Get("state") == "" {
		t.Fatalf("browser binding failed: status=%d cookies=%#v location=%q err=%v", browserResponse.StatusCode, cookies, browserResponse.Header.Get("Location"), parseErr)
	}
	return shopifyURL.Query().Get("state"), cookies[0]
}
