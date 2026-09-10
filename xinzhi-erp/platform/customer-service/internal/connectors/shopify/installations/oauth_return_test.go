package installations

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

func TestShopifyAdminAppURLUsesOnlyNormalizedShopAndSafeAppKey(t *testing.T) {
	for _, tc := range []struct{ shop, key, want string }{
		{"demo.myshopify.com", "app-key", "https://demo.myshopify.com/admin/apps/app-key"},
		{"DEMO.myshopify.com", "test_key", "https://demo.myshopify.com/admin/apps/test_key"},
		{"other.myshopify.com", "abc123", "https://other.myshopify.com/admin/apps/abc123"},
		{"", "app-key", ""}, {"demo.myshopify.com.evil.example", "app-key", ""},
		{"demo.myshopify.com:443", "app-key", ""}, {"demo.myshopify.com/admin", "app-key", ""},
		{"demo.myshopify.com", "", ""}, {"demo.myshopify.com", "../other-app", ""},
		{"demo.myshopify.com", "app?code=secret", ""}, {"demo.myshopify.com", "app#fragment", ""},
		{"demo.myshopify.com", "app\r\nLocation: https://evil.example", ""},
	} {
		t.Run(tc.shop+"/"+tc.key, func(t *testing.T) {
			got, err := shopifyAdminAppURL(tc.shop, tc.key)
			if got != tc.want || (err != nil) != (tc.want == "") {
				t.Fatalf("return target mismatch: got=%q err=%v", got, err)
			}
		})
	}
}

type oauthReturnFailingRepository struct{ Repository }

func (r oauthReturnFailingRepository) CompleteInstallation(context.Context, Binding, InstallationRecord) error {
	return errors.New("fixture persistence failure with secret-value")
}

func TestOAuthReturnRejectsInvalidIncompleteAndFailedCallbacks(t *testing.T) {
	cases := []struct {
		name          string
		mutate        func(url.Values, *http.Request, *Handler, *recordingExchanger)
		rawSuffix     string
		status, calls int
	}{
		{name: "cancelled", mutate: func(q url.Values, _ *http.Request, _ *Handler, _ *recordingExchanger) {
			q.Set("error", "access_denied")
			q.Del("code")
		}, status: 403},
		{name: "error with code is not success", mutate: func(q url.Values, _ *http.Request, _ *Handler, _ *recordingExchanger) {
			q.Set("error", "access_denied")
		}, status: 403},
		{name: "missing code", mutate: func(q url.Values, _ *http.Request, _ *Handler, _ *recordingExchanger) { q.Del("code") }, status: 403},
		{name: "duplicate code", mutate: func(q url.Values, _ *http.Request, _ *Handler, _ *recordingExchanger) { q.Add("code", "another-code") }, status: 403},
		{name: "duplicate shop", mutate: func(q url.Values, _ *http.Request, _ *Handler, _ *recordingExchanger) {
			q.Add("shop", "other.myshopify.com")
		}, status: 403},
		{name: "duplicate state", mutate: func(q url.Values, _ *http.Request, _ *Handler, _ *recordingExchanger) { q.Add("state", q.Get("state")) }, status: 403},
		{name: "duplicate signature", rawSuffix: "&hmac=invalid", status: 403},
		{name: "malformed query", rawSuffix: "&bad=%ZZ", status: 403},
		{name: "unsigned injected parameter", rawSuffix: "&returnTo=https%3A%2F%2Fevil.example", status: 403},
		{name: "cross shop", mutate: func(q url.Values, _ *http.Request, _ *Handler, _ *recordingExchanger) {
			q.Set("shop", "other.myshopify.com")
		}, status: 403},
		{name: "missing browser cookie", mutate: func(_ url.Values, r *http.Request, _ *Handler, _ *recordingExchanger) { r.Header.Del("Cookie") }, status: 403},
		{name: "expired state", mutate: func(_ url.Values, _ *http.Request, h *Handler, _ *recordingExchanger) {
			later := h.now().Add(11 * time.Minute)
			h.now = func() time.Time { return later }
		}, status: 403},
		{name: "unsafe configured key", mutate: func(_ url.Values, _ *http.Request, h *Handler, _ *recordingExchanger) {
			h.config.AppAPIKey = "../wrong-app"
		}, status: 503},
		{name: "provider failure", mutate: func(_ url.Values, _ *http.Request, _ *Handler, e *recordingExchanger) {
			e.err = errors.New("fixture secret-value")
		}, status: 502, calls: 1},
		{name: "insufficient scopes", mutate: func(_ url.Values, _ *http.Request, _ *Handler, e *recordingExchanger) {
			e.result.Scopes = []string{"read_products"}
		}, status: 403, calls: 1},
		{name: "save failure", mutate: func(_ url.Values, _ *http.Request, h *Handler, _ *recordingExchanger) {
			service := h.lifecycle.(*Service)
			service.repository = oauthReturnFailingRepository{service.repository}
		}, status: 502, calls: 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			exchanger := &recordingExchanger{result: OAuthExchangeResult{AccessToken: "shpat_return_fixture", Scopes: []string{"read_orders"}}}
			handler := newTestHandler(t, exchanger)
			server := httptest.NewServer(handler)
			defer server.Close()
			state, cookie := beginBoundBrowserOAuth(t, server.URL)
			q := url.Values{"shop": {"demo.myshopify.com"}, "code": {"fixture-code"}, "state": {state}, "timestamp": {"1785571200"}}
			r := httptest.NewRequest(http.MethodGet, OAuthCallbackPath, nil)
			r.AddCookie(cookie)
			if tc.mutate != nil {
				tc.mutate(q, r, handler, exchanger)
			}
			q.Set("hmac", signShopifyQuery(q, "app-secret"))
			r.URL.RawQuery = q.Encode() + tc.rawSuffix
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, r)
			if response.Code != tc.status || exchanger.calls != tc.calls || response.Header().Get("Location") != "" {
				t.Fatalf("failed callback was treated as success: status=%d calls=%d location=%q", response.Code, exchanger.calls, response.Header().Get("Location"))
			}
			if response.Header().Get("Cache-Control") != "no-store" || response.Header().Get("Referrer-Policy") != "no-referrer" {
				t.Fatal("callback error is cacheable or leaks referrers")
			}
			for _, secret := range []string{"shpat_return_fixture", "fixture-code", "secret-value", state} {
				if strings.Contains(response.Body.String(), secret) {
					t.Fatal("callback error leaked sensitive fixture data")
				}
			}
			if _, err := handler.repository.GetInstallation(t.Context(), identity()); !errors.Is(err, ErrNotFound) {
				t.Fatal("failed callback persisted an installation")
			}
		})
	}
}

func TestOAuthReturnPersistsBeforeRedirectAndReinstallKeepsBinding(t *testing.T) {
	exchanger := &recordingExchanger{result: OAuthExchangeResult{AccessToken: "shpat_return_fixture", Scopes: []string{"read_orders"}}}
	handler := newTestHandler(t, exchanger)
	server := httptest.NewServer(handler)
	defer server.Close()
	for attempt := 0; attempt < 2; attempt++ {
		if attempt == 1 {
			if _, err := handler.lifecycle.Revoke(t.Context(), shopifyconnector.InstallationRevokeRequest{Identity: identity(), Context: requestContext("return-reinstall")}); err != nil {
				t.Fatal("fixture revoke failed")
			}
			exchanger.result.AccessToken = "shpat_reinstalled_fixture"
		}
		state, cookie := beginBoundBrowserOAuth(t, server.URL)
		q := url.Values{
			"shop": {"demo.myshopify.com"}, "code": {"fixture-code"}, "state": {state}, "timestamp": {"1785571200"},
			"host": {"ZXZpbC5leGFtcGxlL2FkbWlu"}, "returnTo": {"https://evil.example/steal"}, "redirect": {"https://other.myshopify.com/admin/apps/other-app"}, "embedded": {"1"},
		}
		q.Set("hmac", signShopifyQuery(q, "app-secret"))
		r := httptest.NewRequest(http.MethodGet, OAuthCallbackPath+"?"+q.Encode(), nil)
		r.AddCookie(cookie)
		r.Host = "evil.example"
		r.Header.Set("X-Forwarded-Host", "evil.example")
		r.Header.Set("Forwarded", "host=evil.example;proto=http")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, r)
		if response.Code != http.StatusSeeOther || response.Header().Get("Location") != "https://demo.myshopify.com/admin/apps/app-key" || exchanger.calls != attempt+1 {
			t.Fatal("callback did not return only the verified store and configured application")
		}
		cookies := response.Result().Cookies()
		if len(cookies) != 1 || cookies[0].Name != oauthBrowserCookieName || cookies[0].MaxAge != -1 || cookies[0].Value != "" || !cookies[0].HttpOnly || !cookies[0].Secure {
			t.Fatal("callback did not clear the hardened browser binding cookie")
		}
		record, err := handler.repository.GetInstallation(t.Context(), identity())
		if err != nil || record.State != shopifyconnector.InstallationStateInstalled || record.AccessToken != exchanger.result.AccessToken || record.LegacyShopID != "legacy-shop" {
			t.Fatal("return preceded successful installation persistence")
		}
		boundIdentity, err := handler.repository.ResolveIdentityByDomain(t.Context(), "demo.myshopify.com")
		if err != nil || boundIdentity != identity() {
			t.Fatal("reinstall changed the canonical store binding")
		}
		for _, forbidden := range []string{"fixture-code", "shpat_", "app-secret", "evil.example", "returnTo", state, q.Get("hmac"), testTenantID, testShopID} {
			if strings.Contains(response.Body.String()+response.Header().Get("Location"), forbidden) {
				t.Fatal("return leaked callback context or accepted an external target")
			}
		}
		// This only simulates Shopify issuing a fresh launch; never follow the
		// redirect to a real shop or manufacture a token in production code.
		token := signEmbeddedSessionToken(t, "app-key", "app-secret", "demo.myshopify.com", handler.now())
		launch := httptest.NewRecorder()
		handler.ServeHTTP(launch, httptest.NewRequest(http.MethodGet, AppLaunchPath+"?"+url.Values{"shop": {"demo.myshopify.com"}, "id_token": {token}}.Encode(), nil))
		if launch.Code != http.StatusOK || !strings.Contains(launch.Header().Get("Content-Security-Policy"), "frame-ancestors https://demo.myshopify.com https://admin.shopify.com;") {
			t.Fatal("fresh synthetic launch rejected by framing policy")
		}
		sessionRequest := httptest.NewRequest(http.MethodPost, EmbeddedSessionPath, nil)
		sessionRequest.Header.Set("Authorization", "Bearer "+token)
		session := httptest.NewRecorder()
		handler.ServeHTTP(session, sessionRequest)
		if session.Code != http.StatusOK || exchanger.calls != attempt+1 {
			t.Fatal("fresh session did not reuse the persisted installation")
		}
		replay := httptest.NewRecorder()
		handler.ServeHTTP(replay, r)
		if replay.Code != http.StatusForbidden || replay.Header().Get("Location") != "" || exchanger.calls != attempt+1 {
			t.Fatal("successful callback could be replayed")
		}
	}
}
