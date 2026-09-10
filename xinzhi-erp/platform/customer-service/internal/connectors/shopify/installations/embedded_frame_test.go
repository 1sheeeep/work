package installations

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestAppLaunchFramesOnlyVerifiedShop(t *testing.T) {
	now := time.Date(2026, 9, 4, 8, 0, 0, 0, time.UTC)
	signedLaunch := func(shop string, at time.Time) url.Values {
		query := url.Values{"shop": {shop}, "timestamp": {strconv.FormatInt(at.Unix(), 10)}, "host": {"untrusted-host-is-not-a-frame-origin"}, "embedded": {"1"}}
		query.Set("hmac", signShopifyQuery(query, "app-secret"))
		return query
	}
	token := signEmbeddedSessionToken(t, "app-key", "app-secret", "demo.myshopify.com", now)
	otherToken := signEmbeddedSessionToken(t, "app-key", "app-secret", "other.myshopify.com", now)
	olderToken := signEmbeddedSessionToken(t, "app-key", "app-secret", "demo.myshopify.com", now.Add(-10*time.Second))
	queryToken := func(shop, value string) string { return url.Values{"shop": {shop}, "id_token": {value}}.Encode() }
	tampered := signedLaunch("demo.myshopify.com", now)
	tampered.Set("shop", "other.myshopify.com")
	duplicate := signedLaunch("demo.myshopify.com", now)
	duplicate.Add("shop", "other.myshopify.com")
	duplicate.Set("hmac", signShopifyQuery(duplicate, "app-secret"))
	invalidTokenWithHMAC := signedLaunch("demo.myshopify.com", now)
	invalidTokenWithHMAC.Set("id_token", "invalid-token")
	invalidTokenWithHMAC.Set("hmac", signShopifyQuery(invalidTokenWithHMAC, "app-secret"))
	cases := []struct {
		name, query, authorization, wantShop string
	}{
		{name: "public shell"},
		{name: "unsigned shop", query: "shop=demo.myshopify.com"},
		{name: "host cannot grant framing", query: "host=admin.shopify.com"},
		{name: "fresh signed launch", query: signedLaunch("demo.myshopify.com", now).Encode(), wantShop: "demo.myshopify.com"},
		{name: "another signed shop", query: signedLaunch("other.myshopify.com", now).Encode(), wantShop: "other.myshopify.com"},
		{name: "normalized signed shop", query: signedLaunch("DEMO.myshopify.com", now).Encode(), wantShop: "demo.myshopify.com"},
		{name: "tampered shop", query: tampered.Encode()},
		{name: "duplicate signed shops", query: duplicate.Encode()},
		{name: "duplicate id token", query: queryToken("demo.myshopify.com", token) + "&id_token=" + url.QueryEscape(token)},
		{name: "malformed encoding", query: signedLaunch("demo.myshopify.com", now).Encode() + "&bad=%ZZ"},
		{name: "stale signed launch", query: signedLaunch("demo.myshopify.com", now.Add(-6*time.Minute)).Encode()},
		{name: "future signed launch", query: signedLaunch("demo.myshopify.com", now.Add(time.Minute)).Encode()},
		{name: "signed custom domain", query: signedLaunch("untrusted.example", now).Encode()},
		{name: "signed suffix attack", query: signedLaunch("demo.myshopify.com.evil.example", now).Encode()},
		{name: "signed CSP injection", query: signedLaunch("demo.myshopify.com; frame-ancestors *", now).Encode()},
		{name: "query ID token", query: queryToken("demo.myshopify.com", token), wantShop: "demo.myshopify.com"},
		{name: "header ID token", query: "shop=demo.myshopify.com", authorization: "Bearer " + token, wantShop: "demo.myshopify.com"},
		{name: "fresh tokens same shop", query: queryToken("demo.myshopify.com", olderToken), authorization: "Bearer " + token, wantShop: "demo.myshopify.com"},
		{name: "header query disagree", query: queryToken("demo.myshopify.com", otherToken), authorization: "Bearer " + token},
		{name: "query token wrong shop", query: queryToken("other.myshopify.com", token)},
		{name: "header token wrong shop", query: "shop=other.myshopify.com", authorization: "Bearer " + token},
		{name: "expired token", query: queryToken("demo.myshopify.com", signEmbeddedSessionToken(t, "app-key", "app-secret", "demo.myshopify.com", now.Add(-2*time.Minute)))},
		{name: "wrong app token", query: queryToken("demo.myshopify.com", signEmbeddedSessionToken(t, "wrong-app", "app-secret", "demo.myshopify.com", now))},
		{name: "wrong token signature", query: queryToken("demo.myshopify.com", signEmbeddedSessionToken(t, "app-key", "wrong-secret", "demo.myshopify.com", now))},
		{name: "invalid token cannot fall back to HMAC", query: invalidTokenWithHMAC.Encode()},
		{name: "invalid bearer cannot fall back to HMAC", query: signedLaunch("demo.myshopify.com", now).Encode(), authorization: "Bearer invalid-token"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			handler := newTestHandler(t, &recordingExchanger{})
			handler.now = func() time.Time { return now }
			request := httptest.NewRequest(http.MethodGet, AppLaunchPath+"?"+tc.query, nil)
			request.Header.Set("Origin", "https://spoofed.myshopify.com")
			request.Header.Set("Referer", "https://spoofed.myshopify.com/admin")
			if tc.authorization != "" {
				request.Header.Set("Authorization", tc.authorization)
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			want := "'none'"
			if tc.wantShop != "" {
				want = "https://" + tc.wantShop + " https://admin.shopify.com"
			}
			csp := response.Header().Get("Content-Security-Policy")
			if response.Code != http.StatusOK || !strings.Contains(csp, "frame-ancestors "+want+";") || strings.Count(csp, "frame-ancestors") != 1 || strings.Contains(csp, "*") {
				t.Fatalf("unexpected app framing status=%d policy=%s", response.Code, csp)
			}
			if response.Header().Get("Cache-Control") != "no-store" || response.Header().Get("Referrer-Policy") != "no-referrer" || response.Header().Get("X-Frame-Options") != "" || len(response.Result().Cookies()) != 0 {
				t.Fatal("launch must not cache proofs, leak referrers, create sessions or conflict with CSP")
			}
			for _, sensitive := range []string{token, otherToken, "app-secret", "untrusted-host-is-not-a-frame-origin"} {
				if strings.Contains(response.Body.String(), sensitive) {
					t.Fatal("launch proof leaked into HTML")
				}
			}
			// A signed launch does not confer access to session APIs or a workspace.
			api := httptest.NewRecorder()
			handler.ServeHTTP(api, httptest.NewRequest(http.MethodPost, EmbeddedOrdersPath+"?"+tc.query, nil))
			if api.Code != http.StatusUnauthorized {
				t.Fatalf("launch query authenticated the JSON API: %d", api.Code)
			}
		})
	}
}

func TestAppLaunchRejectsRepeatedAuthorizationHeaders(t *testing.T) {
	handler := newTestHandler(t, &recordingExchanger{})
	token := signEmbeddedSessionToken(t, "app-key", "app-secret", "demo.myshopify.com", handler.now())
	request := httptest.NewRequest(http.MethodGet, AppLaunchPath+"?shop=demo.myshopify.com", nil)
	request.Header.Add("Authorization", "Bearer "+token)
	request.Header.Add("Authorization", "Bearer "+token)
	if handler.embeddedFrameShop(request) != "" {
		t.Fatal("ambiguous authorization headers accepted")
	}
}

func TestStandalonePublicPagesDenyFraming(t *testing.T) {
	handler := newTestHandler(t, &recordingExchanger{})
	handler.config = readyPublicPageConfig()
	for _, path := range []string{PrivacyPolicyPath, TermsPath, DataProcessingTermsPath, DataDeletionPath, SupportPath, ReviewerGuidePath} {
		t.Run(path, func(t *testing.T) {
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
			if response.Code != http.StatusOK || !strings.Contains(response.Header().Get("Content-Security-Policy"), "frame-ancestors 'none';") || response.Header().Get("X-Frame-Options") != "DENY" || response.Header().Get("X-Content-Type-Options") != "nosniff" || response.Header().Get("Referrer-Policy") != "no-referrer" {
				t.Fatalf("public page framing protection missing: status=%d headers=%v", response.Code, response.Header())
			}
		})
	}
}
