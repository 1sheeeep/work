package platform

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
	shopifyinstallations "shopify-support-platform/internal/connectors/shopify/installations"
)

func TestStoreShopifyConnectorBindingResolverRequiresUniqueExplicitBinding(t *testing.T) {
	store := NewMemoryStore()
	implicitShop, err := store.CreateShop(t.Context(), Shop{
		ID:          connectorTestShopOne,
		DisplayName: "Implicit Shop",
		Status:      ShopStatusActive,
		Metadata:    map[string]string{"erpTenantId": connectorTestTenantOne},
	})
	if err != nil {
		t.Fatalf("CreateShop implicit failed: %v", err)
	}
	resolver := storeShopifyConnectorBindingResolver{store: store}
	identity := shopifyconnector.CanonicalShopIdentity{TenantID: connectorTestTenantOne, ShopID: connectorTestShopOne}
	if resolved, err := resolver.ResolveLegacyShopID(t.Context(), identity); !errors.Is(err, errShopifyConnectorBindingNotFound) || resolved != "" {
		t.Fatalf("implicit shop ID fallback must fail closed: resolved=%q err=%v shop=%#v", resolved, err, implicitShop)
	}

	first, err := store.CreateShop(t.Context(), Shop{
		DisplayName: "First Explicit Shop",
		Status:      ShopStatusActive,
		Metadata: map[string]string{
			"erpTenantId": connectorTestTenantOne, "erpCanonicalShopId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
		},
	})
	if err != nil {
		t.Fatalf("CreateShop first explicit failed: %v", err)
	}
	second, err := store.CreateShop(t.Context(), Shop{
		DisplayName: "Second Explicit Shop",
		Status:      ShopStatusActive,
		Metadata: map[string]string{
			"erpTenantId": connectorTestTenantOne, "erpCanonicalShopId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
		},
	})
	if err != nil {
		t.Fatalf("CreateShop second explicit failed: %v", err)
	}
	duplicateIdentity := shopifyconnector.CanonicalShopIdentity{TenantID: connectorTestTenantOne, ShopID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}
	if resolved, err := resolver.ResolveLegacyShopID(t.Context(), duplicateIdentity); !errors.Is(err, errShopifyConnectorBindingNotFound) || resolved != "" {
		t.Fatalf("duplicate binding must fail closed: resolved=%q err=%v shops=%q,%q", resolved, err, first.ID, second.ID)
	}
}

func TestConnectorRevocationEffectsRequireCanonicalBindingAndAreIdempotent(t *testing.T) {
	t.Setenv("XZ_ERP_CONNECTOR_TOKEN", "expected-token")
	store := NewMemoryStore()
	shop, err := store.CreateShop(t.Context(), Shop{
		DisplayName: "Bound Shopify Shop", Status: ShopStatusActive,
		Metadata: map[string]string{
			"erpTenantId": connectorTestTenantOne, "erpCanonicalShopId": connectorTestShopOne,
			"shopifyDomain": "demo.myshopify.com",
		},
	})
	if err != nil {
		t.Fatalf("CreateShop failed: %v", err)
	}
	source, err := store.CreateShopSource(t.Context(), ShopSource{
		ShopID: shop.ID, Type: SourceTypeShopifyAPI, Provider: "shopify_admin",
		Address: "demo.myshopify.com", Status: SourceStatusActive,
		Metadata: map[string]string{"shopifyDomain": "demo.myshopify.com"},
	})
	if err != nil {
		t.Fatalf("CreateShopSource failed: %v", err)
	}
	providerOnlySource, err := store.CreateShopSource(t.Context(), ShopSource{
		ShopID: shop.ID, Type: SourceTypeShopifyChat, Provider: "shopify_admin",
		Address: "demo.myshopify.com", Status: SourceStatusActive,
		Metadata: map[string]string{"shopifyDomain": "demo.myshopify.com"},
	})
	if err != nil {
		t.Fatalf("CreateShopSource provider-only legacy fixture failed: %v", err)
	}
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	record := shopifyinstallations.RevocationRecord{
		Identity:     shopifyconnector.CanonicalShopIdentity{TenantID: connectorTestTenantOne, ShopID: connectorTestShopOne},
		LegacyShopID: shop.ID, ShopDomain: "demo.myshopify.com",
		Context: shopifyconnector.RequestContext{CorrelationID: "corr-revoke-effects", RequestID: "request-revoke-effects"},
	}
	maliciousRecord := record
	maliciousRecord.ShopDomain = "evil.demo.myshopify.com"
	var maliciousBody bytes.Buffer
	if err := json.NewEncoder(&maliciousBody).Encode(maliciousRecord); err != nil {
		t.Fatalf("encode malicious request failed: %v", err)
	}
	maliciousRequest, _ := http.NewRequest(http.MethodPost, server.URL+shopifyinstallations.RevocationEffectsPath, &maliciousBody)
	maliciousRequest.Header.Set("X-XZ-ERP-Connector-Token", "expected-token")
	maliciousResponse, err := http.DefaultClient.Do(maliciousRequest)
	if err != nil {
		t.Fatalf("malicious revocation effects request failed: %v", err)
	}
	_ = maliciousResponse.Body.Close()
	if maliciousResponse.StatusCode != http.StatusBadRequest {
		t.Fatalf("malicious domain must fail closed with 400, got %d", maliciousResponse.StatusCode)
	}
	sources, err := store.ListShopSources(t.Context(), shop.ID)
	if err != nil || len(sources) != 2 {
		t.Fatalf("malicious domain changed source state: %#v err=%v", sources, err)
	}
	for _, current := range sources {
		if current.Status != SourceStatusActive {
			t.Fatalf("malicious domain disabled source %q: %#v", current.ID, current)
		}
	}
	for attempt := 0; attempt < 2; attempt++ {
		var body bytes.Buffer
		if err := json.NewEncoder(&body).Encode(record); err != nil {
			t.Fatalf("encode request failed: %v", err)
		}
		req, _ := http.NewRequest(http.MethodPost, server.URL+shopifyinstallations.RevocationEffectsPath, &body)
		req.Header.Set("X-XZ-ERP-Connector-Token", "expected-token")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("revocation effects request failed: %v", err)
		}
		var result shopifyinstallations.RevocationEffectsResult
		decodeErr := json.NewDecoder(resp.Body).Decode(&result)
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusOK || decodeErr != nil || !result.SourceDisabled || !result.CachesInvalidated {
			t.Fatalf("attempt %d: status=%d result=%#v decodeErr=%v", attempt, resp.StatusCode, result, decodeErr)
		}
	}
	sources, err = store.ListShopSources(t.Context(), shop.ID)
	if err != nil || len(sources) != 2 {
		t.Fatalf("source was not deterministically disabled: %#v err=%v", sources, err)
	}
	disabled := map[string]bool{}
	for _, current := range sources {
		disabled[current.ID] = current.Status == SourceStatusDisabled
	}
	if !disabled[source.ID] || !disabled[providerOnlySource.ID] {
		t.Fatalf("connector-recognized source remained active: %#v", sources)
	}
}

func TestERPConnectorRequiresExplicitToken(t *testing.T) {
	t.Setenv("XZ_ERP_CONNECTOR_TOKEN", "")
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()

	resp, err := http.Post(server.URL+"/api/v1/erp-connector/shopify/connection", "application/json", strings.NewReader(`{}`))
	if err != nil {
		t.Fatalf("connector request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("expected disabled connector to return 503, got %d", resp.StatusCode)
	}
}

func TestERPConnectorRejectsInvalidToken(t *testing.T) {
	t.Setenv("XZ_ERP_CONNECTOR_TOKEN", "expected-token")
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()

	req, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/erp-connector/shopify/connection", strings.NewReader(`{}`))
	if err != nil {
		t.Fatalf("new request failed: %v", err)
	}
	req.Header.Set("X-XZ-ERP-Connector-Token", "wrong-token")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("connector request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected invalid token to return 403, got %d", resp.StatusCode)
	}
}

func TestERPConnectorAcceptsExistingERPServiceTokenFallback(t *testing.T) {
	t.Setenv("XZ_ERP_CONNECTOR_TOKEN", "")
	t.Setenv("ERP_XZ_ERP_APP_CONNECTOR_TOKEN", "erp-service-token")
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/erp-connector/shopify/connection", strings.NewReader(`{}`))
	req.Header.Set("X-XZ-ERP-Connector-Token", "erp-service-token")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("connector request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected authenticated invalid request to return 400, got %d", resp.StatusCode)
	}
}

func TestERPConnectorProductCatalogFailsClosedWithoutIndependentRuntime(t *testing.T) {
	t.Setenv("XZ_ERP_CONNECTOR_TOKEN", "expected-token")
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()

	request := shopifyconnector.ProductCatalogPageRequest{
		Identity: shopifyconnector.CanonicalShopIdentity{
			TenantID: connectorTestTenantOne,
			ShopID:   connectorTestShopOne,
		},
		Context: shopifyconnector.RequestContext{
			CorrelationID: "corr-erp-catalog",
			RequestID:     "request-erp-catalog",
		},
		Limit: 50,
	}
	var body bytes.Buffer
	if err := json.NewEncoder(&body).Encode(request); err != nil {
		t.Fatalf("encode request failed: %v", err)
	}
	req, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/erp-connector/shopify/product-catalog", &body)
	if err != nil {
		t.Fatalf("new request failed: %v", err)
	}
	req.Header.Set("X-XZ-ERP-Connector-Token", "expected-token")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("connector request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("expected missing independent runtime to fail closed, got %d", resp.StatusCode)
	}
	raw, _ := io.ReadAll(resp.Body)
	if strings.Contains(string(raw), "XZ_SHOPIFY_CONNECTOR_INTERNAL_BASE_URL") ||
		strings.Contains(string(raw), "expected-token") {
		t.Fatalf("missing runtime error leaked internal configuration: %s", raw)
	}
}

func TestERPConnectorOrderCatalogFailsClosedWithoutIndependentRuntime(t *testing.T) {
	t.Setenv("XZ_ERP_CONNECTOR_TOKEN", "expected-token")
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()

	request := shopifyconnector.OrderCatalogPageRequest{
		Identity: shopifyconnector.CanonicalShopIdentity{
			TenantID: connectorTestTenantOne,
			ShopID:   connectorTestShopOne,
		},
		Context: shopifyconnector.RequestContext{
			CorrelationID: "corr-erp-orders",
			RequestID:     "request-erp-orders",
		},
		Limit: 50,
	}
	var body bytes.Buffer
	if err := json.NewEncoder(&body).Encode(request); err != nil {
		t.Fatalf("encode request failed: %v", err)
	}
	req, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/erp-connector/shopify/order-catalog", &body)
	if err != nil {
		t.Fatalf("new request failed: %v", err)
	}
	req.Header.Set("X-XZ-ERP-Connector-Token", "expected-token")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("connector request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("expected missing independent runtime to fail closed, got %d", resp.StatusCode)
	}
	raw, _ := io.ReadAll(resp.Body)
	if strings.Contains(string(raw), "XZ_SHOPIFY_CONNECTOR_INTERNAL_BASE_URL") ||
		strings.Contains(string(raw), "expected-token") {
		t.Fatalf("missing runtime error leaked internal configuration: %s", raw)
	}
}

func TestERPConnectorLocationCatalogFailsClosedForUnmappedCanonicalShop(t *testing.T) {
	t.Setenv("XZ_ERP_CONNECTOR_TOKEN", "expected-token")
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()

	request := connectorLocationCatalogRequest("corr-erp-locations")
	var body bytes.Buffer
	if err := json.NewEncoder(&body).Encode(request); err != nil {
		t.Fatalf("encode request failed: %v", err)
	}
	req, err := http.NewRequest(
		http.MethodPost,
		server.URL+"/api/v1/erp-connector/shopify/location-catalog",
		&body)
	if err != nil {
		t.Fatalf("new request failed: %v", err)
	}
	req.Header.Set("X-XZ-ERP-Connector-Token", "expected-token")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("connector request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("expected missing independent runtime to fail closed, got %d", resp.StatusCode)
	}
	raw, _ := io.ReadAll(resp.Body)
	if strings.Contains(string(raw), "XZ_SHOPIFY_CONNECTOR_INTERNAL_BASE_URL") || strings.Contains(string(raw), "expected-token") {
		t.Fatalf("missing runtime error leaked internal configuration: %s", raw)
	}
}

func connectorLocationCatalogRequest(correlationID string) shopifyconnector.LocationCatalogPageRequest {
	return shopifyconnector.LocationCatalogPageRequest{
		Identity: shopifyconnector.CanonicalShopIdentity{TenantID: connectorTestTenantOne, ShopID: connectorTestShopOne},
		Context:  shopifyconnector.RequestContext{CorrelationID: correlationID, RequestID: "request-erp-locations"},
		Limit:    50,
	}
}

func connectorOrderAddressRequest(
	tenantID string,
	shopID string,
) shopifyconnector.OrderShippingAddressUpdateRequest {
	return shopifyconnector.OrderShippingAddressUpdateRequest{
		Identity: shopifyconnector.CanonicalShopIdentity{
			TenantID: tenantID,
			ShopID:   shopID,
		},
		Context: shopifyconnector.RequestContext{
			CorrelationID: "corr-address",
			RequestID:     "request-address",
		},
		OrderID:        "gid://shopify/Order/123",
		IdempotencyKey: "address-command-1",
		Address: shopifyconnector.CatalogMailingAddress{
			FirstName:   "Ada",
			LastName:    "Lovelace",
			Address1:    "1 Main Street",
			City:        "Toronto",
			CountryCode: "CA",
			Zip:         "A1A1A1",
		},
	}
}

func TestERPConnectorOrderAddressMutationFailsClosedForUnmappedCanonicalShop(t *testing.T) {
	t.Setenv("XZ_ERP_CONNECTOR_TOKEN", "expected-token")
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()

	request := connectorOrderAddressRequest(
		connectorTestTenantOne, connectorTestShopOne)
	var body bytes.Buffer
	if err := json.NewEncoder(&body).Encode(request); err != nil {
		t.Fatalf("encode request failed: %v", err)
	}
	req, err := http.NewRequest(
		http.MethodPost,
		server.URL+"/api/v1/erp-connector/shopify/order-shipping-address",
		&body)
	if err != nil {
		t.Fatalf("new request failed: %v", err)
	}
	req.Header.Set("X-XZ-ERP-Connector-Token", "expected-token")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("connector request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("expected unavailable connector to fail closed with 502, got %d", resp.StatusCode)
	}
	var safeErr shopifyconnector.ConnectionProbeError
	if err := json.NewDecoder(resp.Body).Decode(&safeErr); err != nil {
		t.Fatalf("decode error failed: %v", err)
	}
	if safeErr.Code != shopifyconnector.ErrorCodeUnavailable ||
		strings.Contains(safeErr.Message, request.Address.Address1) {
		t.Fatalf("mutation error was not safely minimized: %#v", safeErr)
	}
}
