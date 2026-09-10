package installations

import (
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) { return f(request) }

func TestShopifyOAuthExchangerPostsOnlyFromConnectorRuntime(t *testing.T) {
	var gotURL, gotBody string
	exchanger := NewShopifyOAuthExchanger("app-key", "app-secret", &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		gotURL = request.URL.String()
		raw, _ := io.ReadAll(request.Body)
		gotBody = string(raw)
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"access_token":"shpat_provider_secret","expires_in":3600,"refresh_token":"shprt_provider_secret","refresh_token_expires_in":7776000,"scope":"write_orders,read_orders"}`))}, nil
	})})
	result, err := exchanger.ExchangeOAuthCode(t.Context(), "demo.myshopify.com", "oauth-code")
	if err != nil {
		t.Fatalf("ExchangeOAuthCode failed: %v", err)
	}
	if gotURL != "https://demo.myshopify.com/admin/oauth/access_token" || !strings.Contains(gotBody, "code=oauth-code") || !strings.Contains(gotBody, "client_secret=app-secret") || !strings.Contains(gotBody, "expiring=1") {
		t.Fatalf("unexpected provider exchange request: url=%q body=%s", gotURL, gotBody)
	}
	if result.AccessToken != "shpat_provider_secret" || result.RefreshToken != "shprt_provider_secret" || result.AccessTokenTTL != time.Hour || len(result.Scopes) != 2 {
		t.Fatalf("unexpected provider result: %#v", result)
	}
}

func TestShopifyOAuthExchangerDoesNotReturnProviderBodyOnFailure(t *testing.T) {
	exchanger := NewShopifyOAuthExchanger("app-key", "app-secret", &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusUnauthorized, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"error":"shpat_secret diagnostic"}`))}, nil
	})})
	_, err := exchanger.ExchangeOAuthCode(t.Context(), "demo.myshopify.com", "oauth-code")
	if err == nil {
		t.Fatal("provider failure was accepted")
	}
	if strings.Contains(err.Error(), "shpat_") || strings.Contains(err.Error(), "diagnostic") {
		t.Fatalf("provider body escaped exchanger: %v", err)
	}
}

func TestShopifyOAuthExchangerRejectsNonCanonicalShopifyHostnameBeforeNetwork(t *testing.T) {
	called := false
	exchanger := NewShopifyOAuthExchanger("app-key", "app-secret", &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		called = true
		return nil, errors.New("must not be called")
	})})
	for _, domain := range []string{"evil.demo.myshopify.com", " demo.myshopify.com", "demo.myshopify.com\\evil", "démø.myshopify.com"} {
		if _, err := exchanger.ExchangeOAuthCode(t.Context(), domain, "oauth-code"); err == nil {
			t.Fatalf("invalid provider hostname accepted: %q", domain)
		}
	}
	if called {
		t.Fatal("invalid provider hostname reached network transport")
	}
}

func TestShopifyOAuthExchangerRefreshesExpiringOfflineCredential(t *testing.T) {
	var gotBody string
	exchanger := NewShopifyOAuthExchanger("app-key", "app-secret", &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		raw, _ := io.ReadAll(request.Body)
		gotBody = string(raw)
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"access_token":"shpat_rotated","expires_in":3600,"refresh_token":"shprt_rotated","refresh_token_expires_in":7776000,"scope":"read_orders"}`))}, nil
	})})
	result, err := exchanger.RefreshOfflineToken(t.Context(), "demo.myshopify.com", "shprt_previous")
	if err != nil {
		t.Fatalf("RefreshOfflineToken failed: %v", err)
	}
	if !strings.Contains(gotBody, "grant_type=refresh_token") || !strings.Contains(gotBody, "refresh_token=shprt_previous") ||
		result.AccessToken != "shpat_rotated" || result.RefreshToken != "shprt_rotated" {
		t.Fatalf("unexpected refresh request/result: body=%q result=%#v", gotBody, result)
	}
}

func TestShopifyOAuthExchangerUsesOfficialSessionTokenExchangeParameters(t *testing.T) {
	var gotContentType, gotBody string
	exchanger := NewShopifyOAuthExchanger("app-key", "app-secret", &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		gotContentType = request.Header.Get("Content-Type")
		raw, _ := io.ReadAll(request.Body)
		gotBody = string(raw)
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"access_token":"shpat_embedded","expires_in":3600,"refresh_token":"shprt_embedded","refresh_token_expires_in":7776000,"scope":"read_products,read_orders"}`))}, nil
	})})
	result, err := exchanger.ExchangeSessionToken(t.Context(), "demo.myshopify.com", "signed.session.token")
	if err != nil {
		t.Fatalf("ExchangeSessionToken failed: %v", err)
	}
	for _, field := range []string{
		"grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Atoken-exchange",
		"subject_token=signed.session.token",
		"subject_token_type=urn%3Aietf%3Aparams%3Aoauth%3Atoken-type%3Aid_token",
		"requested_token_type=urn%3Ashopify%3Aparams%3Aoauth%3Atoken-type%3Aoffline-access-token",
		"expiring=1",
	} {
		if !strings.Contains(gotBody, field) {
			t.Fatalf("session exchange body is missing %q: %s", field, gotBody)
		}
	}
	if gotContentType != "application/x-www-form-urlencoded" || result.AccessToken != "shpat_embedded" || result.RefreshToken != "shprt_embedded" {
		t.Fatalf("unexpected session exchange request/result: contentType=%q body=%q result=%#v", gotContentType, gotBody, result)
	}
}
