package installations

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestStorefrontSessionProxyVerifiesShopifyAndReturnsPortableCustomerSession(t *testing.T) {
	handler := newTestHandler(t, &recordingExchanger{})
	handler.now = func() time.Time { return time.Date(2026, 8, 21, 14, 0, 0, 0, time.UTC) }
	repository := handler.repository.(*MemoryRepository)
	if err := repository.SaveBinding(t.Context(), Binding{
		Identity: identity(), LegacyShopID: "legacy-shop", ShopDomain: "demo.myshopify.com",
	}); err != nil {
		t.Fatal(err)
	}
	values := url.Values{
		"logged_in_customer_id": {"8173975273657"},
		"path_prefix":           {"/apps/xzdesk"},
		"shop":                  {"demo.myshopify.com"},
		"tenant":                {identity().TenantID},
		"timestamp":             {strconv.FormatInt(handler.now().Unix(), 10)},
	}
	values.Set("signature", appProxySignature(values, "app-secret"))
	request := httptest.NewRequest(http.MethodGet, StorefrontSessionProxyPath+"?"+values.Encode(), nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("storefront proxy status=%d body=%s", response.Code, response.Body.String())
	}
	var session storefrontSessionResponse
	if json.Unmarshal(response.Body.Bytes(), &session) != nil || !session.Authenticated || session.Token == "" {
		t.Fatalf("invalid storefront session response: %s", response.Body.String())
	}
	parts := strings.Split(session.Token, ".")
	if len(parts) != 2 || parts[1] != hmacHexValue("app-secret", parts[0]) {
		t.Fatal("storefront session token signature is invalid")
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		t.Fatal(err)
	}
	var payload storefrontSessionPayload
	if json.Unmarshal(raw, &payload) != nil || payload.Shop != "demo.myshopify.com" ||
		payload.CustomerID != "8173975273657" || payload.IssuedAt != handler.now().Unix() {
		t.Fatalf("unexpected storefront session payload: %#v", payload)
	}
}

func TestStorefrontSessionProxyFailsClosedForWrongTenantOrSignature(t *testing.T) {
	handler := newTestHandler(t, &recordingExchanger{})
	handler.now = func() time.Time { return time.Unix(1787320800, 0).UTC() }
	repository := handler.repository.(*MemoryRepository)
	if err := repository.SaveBinding(t.Context(), Binding{
		Identity: identity(), LegacyShopID: "legacy-shop", ShopDomain: "demo.myshopify.com",
	}); err != nil {
		t.Fatal(err)
	}
	values := url.Values{
		"path_prefix": {"/apps/xzdesk"}, "shop": {"demo.myshopify.com"},
		"tenant": {"cccccccc-cccc-4ccc-8ccc-cccccccccccc"}, "timestamp": {strconv.FormatInt(handler.now().Unix(), 10)},
	}
	values.Set("signature", appProxySignature(values, "app-secret"))
	wrongTenant := httptest.NewRecorder()
	handler.ServeHTTP(wrongTenant, httptest.NewRequest(http.MethodGet, StorefrontSessionProxyPath+"?"+values.Encode(), nil))
	if wrongTenant.Code != http.StatusNotFound {
		t.Fatalf("wrong tenant status=%d body=%s", wrongTenant.Code, wrongTenant.Body.String())
	}
	values.Set("tenant", identity().TenantID)
	values.Set("signature", "invalid")
	invalidSignature := httptest.NewRecorder()
	handler.ServeHTTP(invalidSignature, httptest.NewRequest(http.MethodGet, StorefrontSessionProxyPath+"?"+values.Encode(), nil))
	if invalidSignature.Code != http.StatusUnauthorized {
		t.Fatalf("invalid signature status=%d body=%s", invalidSignature.Code, invalidSignature.Body.String())
	}
}

func appProxySignature(values url.Values, secret string) string {
	keys := make([]string, 0, len(values))
	for key := range values {
		if key != "signature" {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	var payload strings.Builder
	for _, key := range keys {
		payload.WriteString(key)
		payload.WriteString("=")
		payload.WriteString(strings.Join(values[key], ","))
	}
	return hmacHexValue(secret, payload.String())
}
