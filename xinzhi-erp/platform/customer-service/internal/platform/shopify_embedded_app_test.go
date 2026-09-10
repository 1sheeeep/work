package platform

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestShopifyEmbeddedAppCopyMatchesFirstReviewScope(t *testing.T) {
	page := renderShopifyEmbeddedApp("public-client-id", "demo.myshopify.com")
	if !strings.Contains(page, "Xinzhi ERP") || strings.Contains(page, "XZ ERP") {
		t.Fatalf("embedded app product name is inconsistent")
	}
	for _, expected := range []string{"商品导入", "订单处理", "退货与履约", "拒付概览"} {
		if !strings.Contains(page, expected) {
			t.Fatalf("embedded app omitted reviewed capability %q", expected)
		}
	}
	if !strings.Contains(page, "此页面仅用于验证 Shopify API 连接") ||
		!strings.Contains(page, "独立的 Xinzhi ERP Web 后台") {
		t.Fatalf("embedded connection home does not state the external ERP management boundary")
	}
	for _, excluded := range []string{"库存双向同步", "客户服务", "结算核对"} {
		if strings.Contains(page, excluded) {
			t.Fatalf("embedded app advertised out-of-scope capability %q", excluded)
		}
	}
}

func TestShopifySessionExchangeRedactsConfigurationFailure(t *testing.T) {
	t.Setenv("SHOPIFY_APP_DISTRIBUTION", shopifyDistributionPublic)
	t.Setenv("SHOPIFY_APP_API_KEY", "")
	t.Setenv("SHOPIFY_APP_API_SECRET", "")
	t.Setenv("SHOPIFY_API_KEY", "")
	t.Setenv("SHOPIFY_API_SECRET", "")

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/shopify/session/exchange", strings.NewReader(`{}`))
	NewServer(NewMemoryStore()).handleShopifySessionExchange(recorder, request)

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected configuration failure status 503, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	if strings.Contains(recorder.Body.String(), "SHOPIFY_API_SECRET") ||
		strings.Contains(recorder.Body.String(), "required") ||
		!strings.Contains(recorder.Body.String(), "SHOPIFY_APP_NOT_CONFIGURED") {
		t.Fatalf("configuration failure was not safely mapped: %s", recorder.Body.String())
	}
}

func TestShopifySessionExchangeRedactsProviderFailure(t *testing.T) {
	const (
		apiKey = "public-client-id"
		secret = "public-client-secret"
	)
	t.Setenv("SHOPIFY_APP_DISTRIBUTION", shopifyDistributionPublic)
	t.Setenv("SHOPIFY_APP_API_KEY", apiKey)
	t.Setenv("SHOPIFY_APP_API_SECRET", secret)

	var diagnostic bytes.Buffer
	previousOutput := log.Writer()
	previousFlags := log.Flags()
	log.SetOutput(&diagnostic)
	log.SetFlags(0)
	t.Cleanup(func() {
		log.SetOutput(previousOutput)
		log.SetFlags(previousFlags)
	})

	server := NewServer(NewMemoryStore())
	server.shopifySessionTokenExchange = func(context.Context, string, string, shopifyAppSettings) (shopifyOAuthTokenResponse, error) {
		return shopifyOAuthTokenResponse{}, errors.New("provider payload leaked shpat_sensitive")
	}
	now := time.Now().UTC()
	token := signedShopifySessionToken(t, secret, shopifySessionClaims{
		Audience:  apiKey,
		Dest:      "https://demo.myshopify.com",
		ExpiresAt: now.Add(time.Minute).Unix(),
		IssuedAt:  now.Add(-time.Second).Unix(),
		Issuer:    "https://demo.myshopify.com/admin",
		NotBefore: now.Add(-time.Second).Unix(),
		SessionID: "session-id",
		Subject:   "gid://shopify/User/1",
	})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/shopify/session/exchange", strings.NewReader(`{}`))
	request.Header.Set("Authorization", "Bearer "+token)
	server.handleShopifySessionExchange(recorder, request)

	if recorder.Code != http.StatusBadGateway {
		t.Fatalf("expected provider failure status 502, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	if strings.Contains(recorder.Body.String(), "shpat_sensitive") ||
		strings.Contains(recorder.Body.String(), "provider payload") ||
		!strings.Contains(recorder.Body.String(), "SHOPIFY_SESSION_EXCHANGE_FAILED") {
		t.Fatalf("provider failure was not safely mapped: %s", recorder.Body.String())
	}
	if !strings.Contains(diagnostic.String(), "shopify session exchange failed") ||
		!strings.Contains(diagnostic.String(), "provider payload leaked") {
		t.Fatalf("provider failure was not retained in server diagnostics: %s", diagnostic.String())
	}
	if strings.Contains(diagnostic.String(), "shpat_sensitive") ||
		strings.Contains(diagnostic.String(), secret) ||
		strings.Contains(diagnostic.String(), token) {
		t.Fatalf("server diagnostics leaked Shopify credentials: %s", diagnostic.String())
	}
}

func TestShopifySessionExchangeRedactsInstallationFailure(t *testing.T) {
	const (
		apiKey      = "public-client-id"
		secret      = "public-client-secret"
		accessToken = "shpat_install_sensitive"
	)
	t.Setenv("SHOPIFY_APP_DISTRIBUTION", shopifyDistributionPublic)
	t.Setenv("SHOPIFY_APP_API_KEY", apiKey)
	t.Setenv("SHOPIFY_APP_API_SECRET", secret)
	t.Setenv("SHOPIFY_CREDENTIALS_ENCRYPTION_KEY", "session-install-test-key")

	var diagnostic bytes.Buffer
	previousOutput := log.Writer()
	previousFlags := log.Flags()
	log.SetOutput(&diagnostic)
	log.SetFlags(0)
	t.Cleanup(func() {
		log.SetOutput(previousOutput)
		log.SetFlags(previousFlags)
	})

	store := failingShopifyInstallationStore{
		Store: NewMemoryStore(),
		err:   errors.New("database unavailable while saving " + accessToken),
	}
	server := NewServer(store)
	server.shopifyConnectionChecker = func(context.Context, string, string) ShopifyConnectionStatus {
		return ShopifyConnectionStatus{State: "not_installed"}
	}
	server.shopifySessionTokenExchange = func(context.Context, string, string, shopifyAppSettings) (shopifyOAuthTokenResponse, error) {
		return shopifyOAuthTokenResponse{AccessToken: accessToken, Scope: "read_orders"}, nil
	}
	now := time.Now().UTC()
	token := signedShopifySessionToken(t, secret, shopifySessionClaims{
		Audience: apiKey, Dest: "https://demo.myshopify.com",
		ExpiresAt: now.Add(time.Minute).Unix(), IssuedAt: now.Add(-time.Second).Unix(),
		Issuer: "https://demo.myshopify.com/admin", NotBefore: now.Add(-time.Second).Unix(),
		SessionID: "session-id", Subject: "gid://shopify/User/1",
	})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/shopify/session/exchange", strings.NewReader(`{}`))
	request.Header.Set("Authorization", "Bearer "+token)
	server.handleShopifySessionExchange(recorder, request)

	if recorder.Code != http.StatusInternalServerError ||
		!strings.Contains(recorder.Body.String(), "SHOPIFY_INSTALLATION_FAILED") ||
		strings.Contains(recorder.Body.String(), "database unavailable") ||
		strings.Contains(recorder.Body.String(), accessToken) {
		t.Fatalf("installation failure was not safely mapped: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(diagnostic.String(), "shopify installation persistence failed") ||
		!strings.Contains(diagnostic.String(), "database unavailable") ||
		strings.Contains(diagnostic.String(), accessToken) ||
		strings.Contains(diagnostic.String(), secret) ||
		strings.Contains(diagnostic.String(), token) {
		t.Fatalf("installation diagnostics were incomplete or unsafe: %s", diagnostic.String())
	}
}

type failingShopifyInstallationStore struct {
	Store
	err error
}

func (s failingShopifyInstallationStore) SaveShopifyInstallation(context.Context, ShopifyInstallation) (ShopifyInstallation, error) {
	return ShopifyInstallation{}, s.err
}

func signedShopifySessionToken(t *testing.T, secret string, claims shopifySessionClaims) string {
	t.Helper()
	header, err := json.Marshal(map[string]string{"alg": "HS256", "typ": "JWT"})
	if err != nil {
		t.Fatalf("marshal Shopify session header: %v", err)
	}
	payload, err := json.Marshal(claims)
	if err != nil {
		t.Fatalf("marshal Shopify session claims: %v", err)
	}
	encodedHeader := base64.RawURLEncoding.EncodeToString(header)
	encodedPayload := base64.RawURLEncoding.EncodeToString(payload)
	unsigned := encodedHeader + "." + encodedPayload
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(unsigned))
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
