package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
	shopifyinstallations "shopify-support-platform/internal/connectors/shopify/installations"
)

func TestERPConnectionRouteForwardsToIndependentConnectorWithoutLegacyTokenRead(t *testing.T) {
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != "/api/v1/erp-connector/shopify/connection" ||
			r.Header.Get("X-XZ-ERP-Connector-Token") != "service-token" ||
			r.Header.Get(shopifyConnectorForwardedHeader) != "1" {
			t.Fatalf("unexpected upstream request: path=%s token=%q", r.URL.Path, r.Header.Get("X-XZ-ERP-Connector-Token"))
		}
		raw, _ := io.ReadAll(r.Body)
		if bytes.Contains(raw, []byte("service-token")) || bytes.Contains(raw, []byte("shpat_")) {
			t.Fatalf("forwarded body exposed credential: %s", raw)
		}
		writeJSONResponse(w, http.StatusOK, shopifyconnector.ConnectionSummary{
			ContractVersion: shopifyconnector.ContractVersion,
			TenantID:        connectorTestTenantOne, ShopID: connectorTestShopOne,
			State:         shopifyconnector.ConnectionStateConnected,
			GrantedScopes: []string{"read_orders", "write_orders"},
			CheckedAt:     time.Date(2026, 8, 1, 19, 0, 0, 0, time.UTC),
		})
	}))
	defer upstream.Close()
	t.Setenv("XZ_ERP_CONNECTOR_TOKEN", "service-token")
	t.Setenv("SHOPIFY_ADMIN_ACCESS_TOKEN", "shpat_legacy_must_not_be_used")
	t.Setenv("XZ_SHOPIFY_CONNECTOR_INTERNAL_BASE_URL", upstream.URL)
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	request := connectorProbeRequest(connectorTestTenantOne, connectorTestShopOne, "corr-forward")
	var body bytes.Buffer
	_ = json.NewEncoder(&body).Encode(request)
	httpRequest, _ := http.NewRequest(http.MethodPost, server.URL+shopifyConnectorConnectionPath, &body)
	httpRequest.Header.Set("X-XZ-ERP-Connector-Token", "service-token")
	response, err := http.DefaultClient.Do(httpRequest)
	if err != nil {
		t.Fatalf("forwarded request failed: %v", err)
	}
	defer response.Body.Close()
	var summary shopifyconnector.ConnectionSummary
	if response.StatusCode != http.StatusOK || json.NewDecoder(response.Body).Decode(&summary) != nil ||
		summary.ContractVersion != "shopify.connector.connection.v3" || summary.State != shopifyconnector.ConnectionStateConnected {
		t.Fatalf("forwarded response mismatch: status=%d summary=%#v", response.StatusCode, summary)
	}
	if calls.Load() != 1 {
		t.Fatalf("expected one independent connector call, got %d", calls.Load())
	}
}

func TestERPUninstallRouteForwardsOnlyToIndependentConnector(t *testing.T) {
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != shopifyinstallations.UninstallPath ||
			r.Header.Get("X-XZ-ERP-Connector-Token") != "service-token" ||
			r.Header.Get(shopifyConnectorForwardedHeader) != "1" {
			t.Fatalf("unexpected upstream uninstall request: path=%s", r.URL.Path)
		}
		raw, _ := io.ReadAll(r.Body)
		if bytes.Contains(raw, []byte("service-token")) || bytes.Contains(raw, []byte("shpat_")) {
			t.Fatalf("forwarded uninstall body exposed credential: %s", raw)
		}
		writeJSONResponse(w, http.StatusOK, shopifyconnector.InstallationRevokeResult{
			ContractVersion: shopifyconnector.InstallationContractVersion,
			TenantID:        connectorTestTenantOne, ShopID: connectorTestShopOne,
			ShopDomain: "demo.myshopify.com", InstallationRevoked: true,
			SourceDisabled: true, CachesInvalidated: true,
			RevokedAt: time.Date(2026, 8, 22, 0, 0, 0, 0, time.UTC),
		})
	}))
	defer upstream.Close()
	t.Setenv("XZ_ERP_CONNECTOR_TOKEN", "service-token")
	t.Setenv("XZ_SHOPIFY_CONNECTOR_INTERNAL_BASE_URL", upstream.URL)
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()

	request := shopifyconnector.InstallationRevokeRequest{
		Identity: shopifyconnector.CanonicalShopIdentity{
			TenantID: connectorTestTenantOne, ShopID: connectorTestShopOne,
		},
		Context: shopifyconnector.RequestContext{
			CorrelationID: "corr-uninstall-forward", RequestID: "req-uninstall-forward",
		},
	}
	var body bytes.Buffer
	_ = json.NewEncoder(&body).Encode(request)
	httpRequest, _ := http.NewRequest(http.MethodPost, server.URL+shopifyinstallations.UninstallPath, &body)
	httpRequest.Header.Set("X-XZ-ERP-Connector-Token", "service-token")
	response, err := http.DefaultClient.Do(httpRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || calls.Load() != 1 {
		t.Fatalf("forwarded uninstall mismatch: status=%d calls=%d", response.StatusCode, calls.Load())
	}
}

func TestERPProductCatalogRouteForwardsWithoutLegacyTokenRead(t *testing.T) {
	var calls atomic.Int32
	request := forwardProductCatalogRequest("corr-product-forward")
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != shopifyConnectorProductCatalogPath ||
			r.Header.Get("X-XZ-ERP-Connector-Token") != "service-token" ||
			r.Header.Get(shopifyConnectorForwardedHeader) != "1" {
			t.Fatalf("unexpected upstream product request: path=%s", r.URL.Path)
		}
		raw, _ := io.ReadAll(r.Body)
		for _, forbidden := range []string{"service-token", "shpat_legacy", "accessToken"} {
			if bytes.Contains(raw, []byte(forbidden)) {
				t.Fatalf("forwarded product body exposed credential %q: %s", forbidden, raw)
			}
		}
		writeJSONResponse(w, http.StatusOK, shopifyconnector.ConnectedProductCatalogPage(
			request,
			[]shopifyconnector.CatalogProduct{{
				ID: "gid://shopify/Product/1", Title: "Catalog product",
				Variants: []shopifyconnector.CatalogVariant{{ID: "gid://shopify/ProductVariant/2", Title: "Default"}},
			}},
			shopifyconnector.CatalogPageInfo{},
			time.Date(2026, 8, 1, 21, 0, 0, 0, time.UTC),
		))
	}))
	defer upstream.Close()
	t.Setenv("XZ_ERP_CONNECTOR_TOKEN", "service-token")
	t.Setenv("XZ_SHOPIFY_CONNECTOR_INTERNAL_BASE_URL", upstream.URL)
	t.Setenv("SHOPIFY_ADMIN_ACCESS_TOKEN", "shpat_legacy_must_not_be_used")
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	var body bytes.Buffer
	_ = json.NewEncoder(&body).Encode(request)
	httpRequest, _ := http.NewRequest(http.MethodPost, server.URL+shopifyConnectorProductCatalogPath, &body)
	httpRequest.Header.Set("X-XZ-ERP-Connector-Token", "service-token")
	response, err := http.DefaultClient.Do(httpRequest)
	if err != nil {
		t.Fatalf("forwarded product request failed: %v", err)
	}
	defer response.Body.Close()
	var page shopifyconnector.ProductCatalogPage
	if response.StatusCode != http.StatusOK || json.NewDecoder(response.Body).Decode(&page) != nil ||
		shopifyconnector.ValidateProductCatalogPage(request, page) != nil || calls.Load() != 1 {
		t.Fatalf("forwarded product response mismatch: status=%d calls=%d page=%#v", response.StatusCode, calls.Load(), page)
	}
}

func TestProductCatalogHTTPClientRejectsMalformedContractIdentityStateAndShape(t *testing.T) {
	request := forwardProductCatalogRequest("corr-product-strict")
	valid := map[string]any{
		"contractVersion": shopifyconnector.ProductCatalogContractVersion,
		"tenantId":        request.Identity.TenantID, "shopId": request.Identity.ShopID,
		"state": "CONNECTED", "pageInfo": map[string]any{"hasNextPage": false},
		"fetchedAt": "2026-08-01T21:00:00Z",
		"products": []any{map[string]any{
			"id": "gid://shopify/Product/1", "title": "Product",
			"variants": []any{map[string]any{"id": "gid://shopify/ProductVariant/2", "title": "Default", "availableForSale": true, "inventoryTracked": false}},
		}},
	}
	tests := map[string]func(map[string]any){
		"contract":          func(value map[string]any) { value["contractVersion"] = "shopify.connector.product_catalog.v2" },
		"tenant":            func(value map[string]any) { value["tenantId"] = connectorTestTenantTwo },
		"state":             func(value map[string]any) { value["state"] = "UNKNOWN" },
		"missing products":  func(value map[string]any) { delete(value, "products") },
		"missing page info": func(value map[string]any) { delete(value, "pageInfo") },
		"missing fetchedAt": func(value map[string]any) { delete(value, "fetchedAt") },
		"unknown field":     func(value map[string]any) { value["accessToken"] = "shpat_forbidden" },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			payload := make(map[string]any, len(valid))
			for key, value := range valid {
				payload[key] = value
			}
			mutate(payload)
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				_ = json.NewEncoder(w).Encode(payload)
			}))
			defer upstream.Close()
			reader, err := newShopifyProductCatalogHTTPReader(upstream.URL, "service-token", upstream.Client())
			if err != nil {
				t.Fatalf("new product reader: %v", err)
			}
			_, err = reader.FetchProductCatalogPage(t.Context(), request)
			var safeErr *shopifyconnector.ConnectionProbeError
			if !errors.As(err, &safeErr) || safeErr.Code != shopifyconnector.ErrorCodeUnavailable {
				t.Fatalf("malformed product response did not fail closed: %T %v", err, err)
			}
		})
	}
}

func TestERPOrderCatalogRouteForwardsWithoutLegacyTokenRead(t *testing.T) {
	var calls atomic.Int32
	request := forwardOrderCatalogRequest("corr-order-forward")
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != shopifyConnectorOrderCatalogPath ||
			r.Header.Get("X-XZ-ERP-Connector-Token") != "service-token" ||
			r.Header.Get(shopifyConnectorForwardedHeader) != "1" {
			t.Fatalf("unexpected upstream order request: path=%s", r.URL.Path)
		}
		raw, _ := io.ReadAll(r.Body)
		for _, forbidden := range []string{"service-token", "shpat_legacy", "accessToken"} {
			if bytes.Contains(raw, []byte(forbidden)) {
				t.Fatalf("forwarded order body exposed credential %q: %s", forbidden, raw)
			}
		}
		writeJSONResponse(w, http.StatusOK, forwardConnectedOrderPage(request))
	}))
	defer upstream.Close()
	t.Setenv("XZ_ERP_CONNECTOR_TOKEN", "service-token")
	t.Setenv("XZ_SHOPIFY_CONNECTOR_INTERNAL_BASE_URL", upstream.URL)
	t.Setenv("SHOPIFY_ADMIN_ACCESS_TOKEN", "shpat_legacy_must_not_be_used")
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	var body bytes.Buffer
	_ = json.NewEncoder(&body).Encode(request)
	httpRequest, _ := http.NewRequest(http.MethodPost, server.URL+shopifyConnectorOrderCatalogPath, &body)
	httpRequest.Header.Set("X-XZ-ERP-Connector-Token", "service-token")
	response, err := http.DefaultClient.Do(httpRequest)
	if err != nil {
		t.Fatalf("forwarded order request failed: %v", err)
	}
	defer response.Body.Close()
	var page shopifyconnector.OrderCatalogPage
	if response.StatusCode != http.StatusOK || json.NewDecoder(response.Body).Decode(&page) != nil ||
		shopifyconnector.ValidateOrderCatalogPage(request, page) != nil || calls.Load() != 1 {
		t.Fatalf("forwarded order response mismatch: status=%d calls=%d page=%#v", response.StatusCode, calls.Load(), page)
	}
}

func TestERPStandaloneWriteRoutesForwardWithoutLegacyTokenRead(t *testing.T) {
	now := time.Date(2026, 8, 2, 0, 0, 0, 0, time.UTC)
	inventory := forwardInventorySetRequest("standalone-write")
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("X-XZ-ERP-Connector-Token") != "service-token" || r.Header.Get(shopifyConnectorForwardedHeader) != "1" {
			t.Fatal("safe connector headers missing")
		}
		raw, _ := io.ReadAll(r.Body)
		for _, forbidden := range []string{"service-token", "shpat_legacy", "accessToken"} {
			if bytes.Contains(raw, []byte(forbidden)) {
				t.Fatalf("forwarded write body exposed %q: %s", forbidden, raw)
			}
		}
		switch r.URL.Path {
		case shopifyConnectorInventorySetPath:
			writeJSONResponse(w, http.StatusOK, shopifyconnector.AppliedInventorySetResult(inventory, now))
		default:
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
	}))
	defer upstream.Close()
	t.Setenv("XZ_ERP_CONNECTOR_TOKEN", "service-token")
	t.Setenv("XZ_SHOPIFY_CONNECTOR_INTERNAL_BASE_URL", upstream.URL)
	t.Setenv("SHOPIFY_ADMIN_ACCESS_TOKEN", "shpat_legacy_must_not_be_used")
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	for _, test := range []struct {
		path string
		body any
	}{{shopifyConnectorInventorySetPath, inventory}} {
		var body bytes.Buffer
		_ = json.NewEncoder(&body).Encode(test.body)
		req, _ := http.NewRequest(http.MethodPost, server.URL+test.path, &body)
		req.Header.Set("X-XZ-ERP-Connector-Token", "service-token")
		response, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("forward %s: %v", test.path, err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("forward %s status=%d", test.path, response.StatusCode)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("unexpected upstream calls: %d", calls.Load())
	}
}

func TestStandaloneWriteHTTPClientsRejectMalformedIdentityAndShape(t *testing.T) {
	inventory := forwardInventorySetRequest("standalone-strict")
	tests := []struct {
		name    string
		path    string
		payload map[string]any
		call    func(*shopifyConnectorHTTPClient) error
	}{
		{"inventory identity", shopifyConnectorInventorySetPath, map[string]any{"contractVersion": shopifyconnector.InventorySetContractVersion, "tenantId": connectorTestTenantTwo, "shopId": inventory.Identity.ShopID, "outcome": "APPLIED", "inventoryItemId": inventory.InventoryItemID, "locationId": inventory.LocationID, "expectedAvailable": inventory.ExpectedAvailable, "targetAvailable": inventory.TargetAvailable, "updatedAt": "2026-08-02T00:00:00Z"}, func(c *shopifyConnectorHTTPClient) error {
			_, err := (&shopifyInventorySetHTTPWriter{connector: c}).SetInventoryAvailable(t.Context(), inventory)
			return err
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _ = json.NewEncoder(w).Encode(test.payload) }))
			defer upstream.Close()
			client, err := newShopifyConnectorHTTPClient(upstream.URL, "service-token", upstream.Client())
			if err != nil {
				t.Fatal(err)
			}
			var safeErr *shopifyconnector.ConnectionProbeError
			if err := test.call(client); !errors.As(err, &safeErr) || safeErr.Code != shopifyconnector.ErrorCodeUnavailable {
				t.Fatalf("malformed response accepted: %v", err)
			}
		})
	}
}

func TestShopifyConnectorHTTPClientPreservesOnlyWhitelistedSafeErrors(t *testing.T) {
	request := forwardInventorySetRequest("safe-error-contract")
	tests := []struct {
		name      string
		status    int
		code      shopifyconnector.ErrorCode
		retryable bool
	}{
		{"invalid", http.StatusBadRequest, shopifyconnector.ErrorCodeInvalidRequest, false},
		{"forbidden", http.StatusForbidden, shopifyconnector.ErrorCodeForbidden, false},
		{"protected-customer-data", http.StatusForbidden, shopifyconnector.ErrorCodeProtectedCustomerDataRequired, false},
		{"canceled", http.StatusRequestTimeout, shopifyconnector.ErrorCodeCanceled, false},
		{"timeout", http.StatusGatewayTimeout, shopifyconnector.ErrorCodeTimeout, true},
		{"unavailable", http.StatusBadGateway, shopifyconnector.ErrorCodeUnavailable, true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				writeJSONResponse(w, test.status, map[string]any{"code": test.code, "message": "provider-looking detail shpat_must_not_escape", "retryable": test.retryable, "correlationId": request.Context.CorrelationID})
			}))
			defer upstream.Close()
			client, _ := newShopifyConnectorHTTPClient(upstream.URL, "service-token", upstream.Client())
			_, err := (&shopifyInventorySetHTTPWriter{connector: client}).SetInventoryAvailable(t.Context(), request)
			var safeErr *shopifyconnector.ConnectionProbeError
			if !errors.As(err, &safeErr) || safeErr.Code != test.code || safeErr.Retryable != test.retryable || safeErr.CorrelationID != request.Context.CorrelationID || strings.Contains(err.Error(), "shpat_") || strings.Contains(err.Error(), "provider-looking") {
				t.Fatalf("safe error contract was not preserved/redacted: %#v %v", safeErr, err)
			}
		})
	}

	malformed := []string{
		`{"code":"INVALID_REQUEST","message":"safe","retryable":false,"correlationId":"safe-error-contract","accessToken":"shpat_forbidden"}`,
		`{"code":"INVALID_REQUEST","message":"safe","retryable":false,"correlationId":"safe-error-contract"} {}`,
		`{"code":"INVALID_REQUEST","message":"safe","retryable":true,"correlationId":"safe-error-contract"}`,
		`{"code":"FORBIDDEN","message":"safe","retryable":false,"correlationId":"wrong-correlation"}`,
	}
	for index, body := range malformed {
		t.Run(fmt.Sprintf("malformed-%d", index), func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(body))
			}))
			defer upstream.Close()
			client, _ := newShopifyConnectorHTTPClient(upstream.URL, "service-token", upstream.Client())
			_, err := (&shopifyInventorySetHTTPWriter{connector: client}).SetInventoryAvailable(t.Context(), request)
			var safeErr *shopifyconnector.ConnectionProbeError
			if !errors.As(err, &safeErr) || safeErr.Code != shopifyconnector.ErrorCodeUnavailable || !safeErr.Retryable {
				t.Fatalf("malformed error was trusted: %#v %v", safeErr, err)
			}
		})
	}
}

type rejectingFulfillmentProvider struct {
	calls atomic.Int32
	err   error
}

func (p *rejectingFulfillmentProvider) PublishFulfillment(_ context.Context, _, _ string, _ shopifyconnector.FulfillmentPublishRequest) (shopifyconnector.FulfillmentPublishResult, error) {
	p.calls.Add(1)
	return shopifyconnector.FulfillmentPublishResult{}, p.err
}

func TestFulfillmentPublishFullHTTPChainPreservesDefiniteErrors(t *testing.T) {
	now := time.Date(2026, 8, 2, 1, 0, 0, 0, time.UTC)
	for _, test := range []struct {
		name        string
		scopes      []string
		providerErr error
		wantStatus  int
		wantCode    shopifyconnector.ErrorCode
		wantCalls   int32
	}{
		{"invalid", []string{"write_merchant_managed_fulfillment_orders"}, shopifyconnector.ErrInvalidFulfillment, http.StatusBadRequest, shopifyconnector.ErrorCodeInvalidRequest, 1},
		{"provider-forbidden", []string{"write_merchant_managed_fulfillment_orders"}, shopifyconnector.ErrProviderAuthorization, http.StatusForbidden, shopifyconnector.ErrorCodeForbidden, 1},
		{"scope-forbidden", []string{"read_orders"}, errors.New("must not be called"), http.StatusForbidden, shopifyconnector.ErrorCodeForbidden, 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			repository := shopifyinstallations.NewMemoryRepository()
			identity := shopifyconnector.CanonicalShopIdentity{TenantID: connectorTestTenantOne, ShopID: connectorTestShopOne}
			binding := shopifyinstallations.Binding{Identity: identity, LegacyShopID: "legacy", ShopDomain: "fulfillment.myshopify.com"}
			record := shopifyinstallations.InstallationRecord{Binding: binding, AccessToken: "shpat_connector_owned", Scopes: test.scopes, State: shopifyconnector.InstallationStateInstalled, InstalledAt: now, UpdatedAt: now}
			if err := repository.CompleteInstallation(t.Context(), binding, record); err != nil {
				t.Fatal(err)
			}
			provider := &rejectingFulfillmentProvider{err: test.providerErr}
			service := shopifyinstallations.NewServiceWithProviders(repository, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, provider)
			runtime, err := shopifyinstallations.NewHandler(shopifyinstallations.RuntimeConfig{ServiceToken: "service-token", AppAPIKey: "app-key", AppSecret: "app-secret", Scopes: []string{"write_merchant_managed_fulfillment_orders"}, CallbackURL: "https://connector.example/shopify/oauth/callback"}, service, repository)
			if err != nil {
				t.Fatal(err)
			}
			upstream := httptest.NewServer(runtime)
			defer upstream.Close()
			t.Setenv("XZ_ERP_CONNECTOR_TOKEN", "service-token")
			t.Setenv("XZ_SHOPIFY_CONNECTOR_INTERNAL_BASE_URL", upstream.URL)
			t.Setenv("SHOPIFY_ADMIN_ACCESS_TOKEN", "shpat_legacy_must_not_be_used")
			customer := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
			defer customer.Close()
			request := forwardFulfillmentRequest("full-chain-" + test.name)
			var body bytes.Buffer
			_ = json.NewEncoder(&body).Encode(request)
			httpRequest, _ := http.NewRequest(http.MethodPost, customer.URL+shopifyConnectorFulfillmentPath, &body)
			httpRequest.Header.Set("X-XZ-ERP-Connector-Token", "service-token")
			response, err := http.DefaultClient.Do(httpRequest)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			var safeErr shopifyconnector.ConnectionProbeError
			if json.NewDecoder(response.Body).Decode(&safeErr) != nil || response.StatusCode != test.wantStatus || response.Header.Get("Cache-Control") != "no-store" || safeErr.Code != test.wantCode || safeErr.Retryable || safeErr.CorrelationID != request.Context.CorrelationID || provider.calls.Load() != test.wantCalls || strings.Contains(safeErr.Message, "shpat_") {
				t.Fatalf("fulfillment full-chain error mismatch status=%d error=%#v calls=%d", response.StatusCode, safeErr, provider.calls.Load())
			}
		})
	}
}

func TestOrderCatalogHTTPClientRejectsMalformedContractIdentityStateAndShape(t *testing.T) {
	request := forwardOrderCatalogRequest("corr-order-strict")
	tests := map[string]func(map[string]any){
		"contract":          func(value map[string]any) { value["contractVersion"] = "shopify.connector.order_catalog.v2" },
		"tenant":            func(value map[string]any) { value["tenantId"] = connectorTestTenantTwo },
		"state":             func(value map[string]any) { value["state"] = "UNKNOWN" },
		"missing orders":    func(value map[string]any) { delete(value, "orders") },
		"missing page info": func(value map[string]any) { delete(value, "pageInfo") },
		"missing fetchedAt": func(value map[string]any) { delete(value, "fetchedAt") },
		"missing lines":     func(value map[string]any) { delete(value["orders"].([]any)[0].(map[string]any), "lineItems") },
		"missing fulfills":  func(value map[string]any) { delete(value["orders"].([]any)[0].(map[string]any), "fulfillments") },
		"unknown field":     func(value map[string]any) { value["accessToken"] = "shpat_forbidden" },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			payload := forwardOrderPayload(request)
			mutate(payload)
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				_ = json.NewEncoder(w).Encode(payload)
			}))
			defer upstream.Close()
			reader, err := newShopifyOrderCatalogHTTPReader(upstream.URL, "service-token", upstream.Client())
			if err != nil {
				t.Fatalf("new order reader: %v", err)
			}
			_, err = reader.FetchOrderCatalogPage(t.Context(), request)
			var safeErr *shopifyconnector.ConnectionProbeError
			if !errors.As(err, &safeErr) || safeErr.Code != shopifyconnector.ErrorCodeUnavailable {
				t.Fatalf("malformed order response did not fail closed: %T %v", err, err)
			}
		})
	}
}

func TestConnectionForwardRejectsRepeatedHopBeforeCallingTarget(t *testing.T) {
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		calls.Add(1)
	}))
	defer upstream.Close()
	t.Setenv("XZ_ERP_CONNECTOR_TOKEN", "service-token")
	t.Setenv("XZ_SHOPIFY_CONNECTOR_INTERNAL_BASE_URL", upstream.URL)
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	request := connectorProbeRequest(connectorTestTenantOne, connectorTestShopOne, "corr-hop-guard")
	var body bytes.Buffer
	_ = json.NewEncoder(&body).Encode(request)
	httpRequest, _ := http.NewRequest(http.MethodPost, server.URL+shopifyConnectorConnectionPath, &body)
	httpRequest.Header.Set("X-XZ-ERP-Connector-Token", "service-token")
	httpRequest.Header.Set(shopifyConnectorForwardedHeader, "1")
	response, err := http.DefaultClient.Do(httpRequest)
	if err != nil {
		t.Fatalf("repeated-hop guard request failed: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusBadGateway || calls.Load() != 0 {
		t.Fatalf("repeated forwarding hop was not rejected: status=%d calls=%d", response.StatusCode, calls.Load())
	}
}

func TestProductCatalogForwardRejectsRepeatedHopBeforeCallingTarget(t *testing.T) {
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		calls.Add(1)
	}))
	defer upstream.Close()
	t.Setenv("XZ_ERP_CONNECTOR_TOKEN", "service-token")
	t.Setenv("XZ_SHOPIFY_CONNECTOR_INTERNAL_BASE_URL", upstream.URL)
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	request := forwardProductCatalogRequest("corr-product-hop-guard")
	var body bytes.Buffer
	_ = json.NewEncoder(&body).Encode(request)
	httpRequest, _ := http.NewRequest(http.MethodPost, server.URL+shopifyConnectorProductCatalogPath, &body)
	httpRequest.Header.Set("X-XZ-ERP-Connector-Token", "service-token")
	httpRequest.Header.Set(shopifyConnectorForwardedHeader, "1")
	response, err := http.DefaultClient.Do(httpRequest)
	if err != nil {
		t.Fatalf("product repeated-hop guard request failed: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusBadGateway || calls.Load() != 0 {
		t.Fatalf("product repeated forwarding hop was not rejected: status=%d calls=%d", response.StatusCode, calls.Load())
	}
}

func TestOrderCatalogForwardRejectsRepeatedHopBeforeCallingTarget(t *testing.T) {
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		calls.Add(1)
	}))
	defer upstream.Close()
	t.Setenv("XZ_ERP_CONNECTOR_TOKEN", "service-token")
	t.Setenv("XZ_SHOPIFY_CONNECTOR_INTERNAL_BASE_URL", upstream.URL)
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	request := forwardOrderCatalogRequest("corr-order-hop-guard")
	var body bytes.Buffer
	_ = json.NewEncoder(&body).Encode(request)
	httpRequest, _ := http.NewRequest(http.MethodPost, server.URL+shopifyConnectorOrderCatalogPath, &body)
	httpRequest.Header.Set("X-XZ-ERP-Connector-Token", "service-token")
	httpRequest.Header.Set(shopifyConnectorForwardedHeader, "1")
	response, err := http.DefaultClient.Do(httpRequest)
	if err != nil {
		t.Fatalf("order repeated-hop guard request failed: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusBadGateway || calls.Load() != 0 {
		t.Fatalf("order repeated forwarding hop was not rejected: status=%d calls=%d", response.StatusCode, calls.Load())
	}
}

func forwardProductCatalogRequest(correlationID string) shopifyconnector.ProductCatalogPageRequest {
	return shopifyconnector.ProductCatalogPageRequest{
		Identity: shopifyconnector.CanonicalShopIdentity{TenantID: connectorTestTenantOne, ShopID: connectorTestShopOne},
		Context:  shopifyconnector.RequestContext{CorrelationID: correlationID, RequestID: "request-product-forward"},
		Limit:    50,
	}
}

func forwardOrderCatalogRequest(correlationID string) shopifyconnector.OrderCatalogPageRequest {
	return shopifyconnector.OrderCatalogPageRequest{
		Identity: shopifyconnector.CanonicalShopIdentity{TenantID: connectorTestTenantOne, ShopID: connectorTestShopOne},
		Context:  shopifyconnector.RequestContext{CorrelationID: correlationID, RequestID: "request-order-forward"},
		Limit:    50,
	}
}

func forwardInventorySetRequest(correlationID string) shopifyconnector.InventorySetRequest {
	return shopifyconnector.InventorySetRequest{Identity: shopifyconnector.CanonicalShopIdentity{TenantID: connectorTestTenantOne, ShopID: connectorTestShopOne}, Context: shopifyconnector.RequestContext{CorrelationID: correlationID, RequestID: "inventory-write"}, InventoryItemID: "gid://shopify/InventoryItem/1", LocationID: "gid://shopify/Location/2", ExpectedAvailable: 3, TargetAvailable: 4, IdempotencyKey: "inventory-command-1", ReferenceDocumentURI: "xz-erp://inventory-publications/5e267b48-1b17-4cba-af71-8d9e1226f517"}
}

func forwardFulfillmentRequest(correlationID string) shopifyconnector.FulfillmentPublishRequest {
	return shopifyconnector.FulfillmentPublishRequest{
		Identity: shopifyconnector.CanonicalShopIdentity{TenantID: connectorTestTenantOne, ShopID: connectorTestShopOne},
		Context:  shopifyconnector.RequestContext{CorrelationID: correlationID, RequestID: "request-" + correlationID},
		OrderID:  "gid://shopify/Order/1", IdempotencyKey: "fulfillment-command-1", NotifyCustomer: true,
		Tracking: shopifyconnector.CatalogTrackingInfo{Company: "UPS", Number: "1Z123", URL: "https://track.example/1Z123"},
		Lines:    []shopifyconnector.FulfillmentLineInput{{OrderLineID: "gid://shopify/LineItem/40", Quantity: 2}},
	}
}

func forwardConnectedOrderPage(request shopifyconnector.OrderCatalogPageRequest) shopifyconnector.OrderCatalogPage {
	return shopifyconnector.ConnectedOrderCatalogPage(request, []shopifyconnector.CatalogOrder{{
		ID: "gid://shopify/Order/1", Name: "#1001", CreatedAt: "2026-08-01T20:00:00Z",
		PaymentGatewayNames: []string{}, Total: shopifyconnector.CatalogMoney{Amount: "10.00", CurrencyCode: "USD"},
		LineItems:    []shopifyconnector.CatalogOrderLine{{ID: "gid://shopify/LineItem/2", Name: "Product", Quantity: 1}},
		Fulfillments: []shopifyconnector.CatalogFulfillment{},
	}}, shopifyconnector.CatalogPageInfo{}, time.Date(2026, 8, 1, 23, 0, 0, 0, time.UTC))
}

func forwardOrderPayload(request shopifyconnector.OrderCatalogPageRequest) map[string]any {
	return map[string]any{
		"contractVersion": shopifyconnector.OrderCatalogContractVersion,
		"tenantId":        request.Identity.TenantID, "shopId": request.Identity.ShopID,
		"state": "CONNECTED", "pageInfo": map[string]any{"hasNextPage": false},
		"fetchedAt": "2026-08-01T23:00:00Z",
		"orders": []any{map[string]any{
			"id": "gid://shopify/Order/1", "name": "#1001", "createdAt": "2026-08-01T20:00:00Z",
			"paymentGatewayNames": []any{}, "total": map[string]any{"amount": "10.00", "currencyCode": "USD"},
			"lineItems": []any{}, "fulfillments": []any{},
		}},
	}
}

func TestRemainingReadRoutesForwardWithoutLegacyTokenRead(t *testing.T) {
	identity := shopifyconnector.CanonicalShopIdentity{TenantID: connectorTestTenantOne, ShopID: connectorTestShopOne}
	context := shopifyconnector.RequestContext{CorrelationID: "corr-read-stage", RequestID: "request-read-stage"}
	now := time.Date(2026, 8, 1, 23, 30, 0, 0, time.UTC)
	returnRequest := shopifyconnector.ReturnCatalogPageRequest{Identity: identity, Context: context, Limit: 50}
	customerRequest := shopifyconnector.CustomerCatalogPageRequest{Identity: identity, Context: context, Limit: 50}
	locationRequest := shopifyconnector.LocationCatalogPageRequest{Identity: identity, Context: context, Limit: 50}
	inventoryRequest := shopifyconnector.InventoryLevelReadRequest{Identity: identity, Context: context, InventoryItemID: "gid://shopify/InventoryItem/1", LocationID: "gid://shopify/Location/2"}
	disputeRequest := shopifyconnector.DisputeCatalogPageRequest{Identity: identity, Context: context, Limit: 50}
	tests := []struct {
		name, path        string
		request, response any
	}{
		{"returns", shopifyConnectorReturnCatalogPath, returnRequest, shopifyconnector.ConnectedReturnCatalogPage(returnRequest, []shopifyconnector.CatalogReturn{{ID: "gid://shopify/Return/1", Name: "Return #1", OrderID: "gid://shopify/Order/2", OrderName: "#1002", Status: "OPEN", CreatedAt: now.Format(time.RFC3339), TotalQuantity: 1, LineItems: []shopifyconnector.CatalogReturnLine{{ID: "gid://shopify/ReturnLineItem/3", FulfillmentLineID: "gid://shopify/FulfillmentLineItem/4", OrderLineID: "gid://shopify/LineItem/5", Name: "Item", Quantity: 1}}}}, shopifyconnector.CatalogPageInfo{}, now)},
		{"customers", shopifyConnectorCustomerCatalogPath, customerRequest, shopifyconnector.ConnectedCustomerCatalogPage(customerRequest, []shopifyconnector.CatalogCustomer{{ID: "gid://shopify/Customer/1", DisplayName: "Mia Customer", CreatedAt: now.Format(time.RFC3339), UpdatedAt: now.Format(time.RFC3339), Tags: []string{}, NumberOfOrders: "3", TotalSpent: shopifyconnector.CatalogMoney{Amount: "120.50", CurrencyCode: "USD"}}}, shopifyconnector.CatalogPageInfo{}, now)},
		{"locations", shopifyConnectorLocationCatalogPath, locationRequest, shopifyconnector.ConnectedLocationCatalogPage(locationRequest, []shopifyconnector.CatalogLocation{{ID: "gid://shopify/Location/2", Name: "Warehouse", CountryCode: "US"}}, shopifyconnector.CatalogPageInfo{}, now)},
		{"inventory", shopifyConnectorInventoryLevelPath, inventoryRequest, shopifyconnector.ConnectedInventoryLevel(inventoryRequest, true, true, 7, nil, now)},
		{"disputes", shopifyConnectorDisputeCatalogPath, disputeRequest, shopifyconnector.ConnectedDisputeCatalogPage(disputeRequest, []shopifyconnector.Dispute{{ID: "gid://shopify/ShopifyPaymentsDispute/1", Status: "NEEDS_RESPONSE", Type: "CHARGEBACK", Reason: "fraudulent", Amount: shopifyconnector.CatalogMoney{Amount: "10.00", CurrencyCode: "USD"}, InitiatedAt: now.Format(time.RFC3339)}}, shopifyconnector.CatalogPageInfo{}, now)},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			calls := 0
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.URL.Path != test.path || r.Header.Get("X-XZ-ERP-Connector-Token") != "service-token" || r.Header.Get(shopifyConnectorForwardedHeader) != "1" {
					t.Fatalf("unexpected forward request: %s", r.URL.Path)
				}
				raw, _ := io.ReadAll(r.Body)
				if bytes.Contains(raw, []byte("service-token")) || bytes.Contains(raw, []byte("shpat_")) || bytes.Contains(raw, []byte("accessToken")) {
					t.Fatalf("credential crossed boundary: %s", raw)
				}
				writeJSONResponse(w, http.StatusOK, test.response)
			}))
			defer upstream.Close()
			t.Setenv("XZ_ERP_CONNECTOR_TOKEN", "service-token")
			t.Setenv("XZ_SHOPIFY_CONNECTOR_INTERNAL_BASE_URL", upstream.URL)
			t.Setenv("SHOPIFY_ADMIN_ACCESS_TOKEN", "shpat_legacy_must_not_be_used")
			server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
			defer server.Close()
			var body bytes.Buffer
			_ = json.NewEncoder(&body).Encode(test.request)
			req, _ := http.NewRequest(http.MethodPost, server.URL+test.path, &body)
			req.Header.Set("X-XZ-ERP-Connector-Token", "service-token")
			response, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			if response.StatusCode != http.StatusOK || calls != 1 {
				raw, _ := io.ReadAll(response.Body)
				t.Fatalf("forward failed status=%d calls=%d body=%s", response.StatusCode, calls, raw)
			}
		})
	}
}

func TestFulfillmentPublishRouteForwardsWithoutLegacyTokenRead(t *testing.T) {
	request := forwardFulfillmentRequest("fulfillment-forward")
	now := time.Date(2026, 8, 2, 3, 0, 0, 0, time.UTC)
	result := shopifyconnector.FulfillmentPublishResult{
		ContractVersion: shopifyconnector.FulfillmentPublishContractVersion,
		TenantID:        request.Identity.TenantID, ShopID: request.Identity.ShopID,
		OrderID: request.OrderID, FulfillmentIDs: []string{"gid://shopify/Fulfillment/50"},
		Tracking: request.Tracking, UpdatedAt: now,
	}
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != shopifyConnectorFulfillmentPath || r.Header.Get("X-XZ-ERP-Connector-Token") != "service-token" || r.Header.Get(shopifyConnectorForwardedHeader) != "1" {
			t.Fatalf("unexpected fulfillment forward: path=%s headers=%v", r.URL.Path, r.Header)
		}
		raw, _ := io.ReadAll(r.Body)
		if bytes.Contains(raw, []byte("service-token")) || bytes.Contains(raw, []byte("shpat_")) || bytes.Contains(raw, []byte("accessToken")) {
			t.Fatalf("credential crossed fulfillment boundary: %s", raw)
		}
		writeJSONResponse(w, http.StatusOK, result)
	}))
	defer upstream.Close()
	t.Setenv("XZ_ERP_CONNECTOR_TOKEN", "service-token")
	t.Setenv("XZ_SHOPIFY_CONNECTOR_INTERNAL_BASE_URL", upstream.URL)
	t.Setenv("SHOPIFY_ADMIN_ACCESS_TOKEN", "shpat_legacy_must_not_be_used")
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	var body bytes.Buffer
	_ = json.NewEncoder(&body).Encode(request)
	httpRequest, _ := http.NewRequest(http.MethodPost, server.URL+shopifyConnectorFulfillmentPath, &body)
	httpRequest.Header.Set("X-XZ-ERP-Connector-Token", "service-token")
	response, err := http.DefaultClient.Do(httpRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || response.Header.Get("Cache-Control") != "no-store" || calls != 1 {
		raw, _ := io.ReadAll(response.Body)
		t.Fatalf("fulfillment forward failed status=%d calls=%d body=%s", response.StatusCode, calls, raw)
	}

	rawRequest, _ := json.Marshal(request)
	for _, malformed := range [][]byte{
		append(append([]byte(nil), rawRequest...), []byte(` {}`)...),
		[]byte(strings.TrimSuffix(string(rawRequest), "}") + `,"accessToken":"shpat_forbidden"}`),
	} {
		httpRequest, _ := http.NewRequest(http.MethodPost, server.URL+shopifyConnectorFulfillmentPath, bytes.NewReader(malformed))
		httpRequest.Header.Set("X-XZ-ERP-Connector-Token", "service-token")
		response, err := http.DefaultClient.Do(httpRequest)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusBadRequest || response.Header.Get("Cache-Control") != "no-store" || calls != 1 {
			t.Fatalf("malformed customer-service request crossed boundary status=%d calls=%d", response.StatusCode, calls)
		}
	}

	httpRequest, _ = http.NewRequest(http.MethodPost, server.URL+shopifyConnectorFulfillmentPath, bytes.NewReader(rawRequest))
	httpRequest.Header.Set("X-XZ-ERP-Connector-Token", "service-token")
	httpRequest.Header.Set(shopifyConnectorForwardedHeader, "1")
	repeated, err := http.DefaultClient.Do(httpRequest)
	if err != nil {
		t.Fatal(err)
	}
	repeated.Body.Close()
	if repeated.StatusCode != http.StatusBadGateway || repeated.Header.Get("Cache-Control") != "no-store" || calls != 1 {
		t.Fatalf("repeated forwarding hop was accepted status=%d calls=%d", repeated.StatusCode, calls)
	}

	t.Setenv("XZ_SHOPIFY_CONNECTOR_INTERNAL_BASE_URL", server.URL)
	httpRequest, _ = http.NewRequest(http.MethodPost, server.URL+shopifyConnectorFulfillmentPath, bytes.NewReader(rawRequest))
	httpRequest.Header.Set("X-XZ-ERP-Connector-Token", "service-token")
	recursive, err := http.DefaultClient.Do(httpRequest)
	if err != nil {
		t.Fatal(err)
	}
	recursive.Body.Close()
	if recursive.StatusCode != http.StatusBadGateway || recursive.Header.Get("Cache-Control") != "no-store" || calls != 1 {
		t.Fatalf("recursive forwarding target was accepted status=%d calls=%d", recursive.StatusCode, calls)
	}
}

func TestFulfillmentHTTPPublisherRejectsMalformedResponse(t *testing.T) {
	request := forwardFulfillmentRequest("fulfillment-strict")
	valid := map[string]any{
		"contractVersion": shopifyconnector.FulfillmentPublishContractVersion,
		"tenantId":        request.Identity.TenantID, "shopId": request.Identity.ShopID,
		"orderId": request.OrderID, "fulfillmentIds": []string{"gid://shopify/Fulfillment/50"},
		"tracking": request.Tracking, "recoveredFromShopify": false,
		"updatedAt": "2026-08-02T03:00:00Z",
	}
	for name, mutate := range map[string]func(map[string]any){
		"version":     func(value map[string]any) { value["contractVersion"] = "shopify.connector.fulfillment_publish.v2" },
		"tenant":      func(value map[string]any) { value["tenantId"] = connectorTestTenantTwo },
		"missing ids": func(value map[string]any) { delete(value, "fulfillmentIds") },
		"duplicate shape": func(value map[string]any) {
			value["fulfillmentIds"] = []string{"gid://shopify/Fulfillment/50", "gid://shopify/Fulfillment/50"}
		},
		"unknown field": func(value map[string]any) { value["accessToken"] = "shpat_forbidden" },
	} {
		t.Run(name, func(t *testing.T) {
			payload := make(map[string]any, len(valid))
			for key, value := range valid {
				payload[key] = value
			}
			mutate(payload)
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				_ = json.NewEncoder(w).Encode(payload)
			}))
			defer upstream.Close()
			client, _ := newShopifyConnectorHTTPClient(upstream.URL, "service-token", upstream.Client())
			_, err := (&shopifyFulfillmentHTTPPublisher{connector: client}).PublishFulfillment(t.Context(), request)
			var safeErr *shopifyconnector.ConnectionProbeError
			if !errors.As(err, &safeErr) || safeErr.Code != shopifyconnector.ErrorCodeUnavailable || !safeErr.Retryable || strings.Contains(err.Error(), "shpat_") {
				t.Fatalf("malformed fulfillment response escaped: %#v %v", safeErr, err)
			}
		})
	}
}

func TestOrderAddressRouteForwardsWithoutLegacyTokenRead(t *testing.T) {
	request := forwardOrderAddressRequest("address-forward")
	result := shopifyconnector.OrderShippingAddressUpdateResult{
		ContractVersion: shopifyconnector.OrderShippingAddressContractVersion,
		TenantID:        request.Identity.TenantID, ShopID: request.Identity.ShopID,
		OrderID: request.OrderID, Address: request.Address,
		UpdatedAt: time.Date(2026, 8, 2, 4, 0, 0, 0, time.UTC),
	}
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != shopifyConnectorOrderAddressPath || r.Header.Get("X-XZ-ERP-Connector-Token") != "service-token" || r.Header.Get(shopifyConnectorForwardedHeader) != "1" {
			t.Fatalf("unexpected order address forward: path=%s headers=%v", r.URL.Path, r.Header)
		}
		raw, _ := io.ReadAll(r.Body)
		if bytes.Contains(raw, []byte("service-token")) || bytes.Contains(raw, []byte("shpat_")) || bytes.Contains(raw, []byte("accessToken")) {
			t.Fatalf("credential crossed order address boundary: %s", raw)
		}
		writeJSONResponse(w, http.StatusOK, result)
	}))
	defer upstream.Close()
	t.Setenv("XZ_ERP_CONNECTOR_TOKEN", "service-token")
	t.Setenv("XZ_SHOPIFY_CONNECTOR_INTERNAL_BASE_URL", upstream.URL)
	t.Setenv("SHOPIFY_ADMIN_ACCESS_TOKEN", "shpat_legacy_must_not_be_used")
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	var body bytes.Buffer
	_ = json.NewEncoder(&body).Encode(request)
	httpRequest, _ := http.NewRequest(http.MethodPost, server.URL+shopifyConnectorOrderAddressPath, &body)
	httpRequest.Header.Set("X-XZ-ERP-Connector-Token", "service-token")
	response, err := http.DefaultClient.Do(httpRequest)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK || response.Header.Get("Cache-Control") != "no-store" || calls != 1 {
		t.Fatalf("order address forward failed status=%d calls=%d", response.StatusCode, calls)
	}

	var repeatedBody bytes.Buffer
	_ = json.NewEncoder(&repeatedBody).Encode(request)
	repeatedRequest, _ := http.NewRequest(http.MethodPost, server.URL+shopifyConnectorOrderAddressPath, &repeatedBody)
	repeatedRequest.Header.Set("X-XZ-ERP-Connector-Token", "service-token")
	repeatedRequest.Header.Set(shopifyConnectorForwardedHeader, "1")
	repeated, err := http.DefaultClient.Do(repeatedRequest)
	if err != nil {
		t.Fatal(err)
	}
	repeated.Body.Close()
	if repeated.StatusCode != http.StatusBadGateway || calls != 1 {
		t.Fatalf("repeated order address hop was accepted status=%d calls=%d", repeated.StatusCode, calls)
	}
}

func TestOrderAddressHTTPWriterRejectsMalformedResponse(t *testing.T) {
	request := forwardOrderAddressRequest("address-strict")
	valid := map[string]any{
		"contractVersion": shopifyconnector.OrderShippingAddressContractVersion,
		"tenantId":        request.Identity.TenantID, "shopId": request.Identity.ShopID,
		"orderId": request.OrderID, "address": request.Address,
		"updatedAt": "2026-08-02T04:00:00Z",
	}
	for name, mutate := range map[string]func(map[string]any){
		"version": func(value map[string]any) { value["contractVersion"] = "shopify.connector.order_shipping_address.v2" },
		"tenant":  func(value map[string]any) { value["tenantId"] = connectorTestTenantTwo },
		"address": func(value map[string]any) {
			address := request.Address
			address.City = "Ottawa"
			value["address"] = address
		},
		"missing address": func(value map[string]any) { delete(value, "address") },
		"unknown field":   func(value map[string]any) { value["accessToken"] = "shpat_forbidden" },
	} {
		t.Run(name, func(t *testing.T) {
			payload := make(map[string]any, len(valid))
			for key, value := range valid {
				payload[key] = value
			}
			mutate(payload)
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _ = json.NewEncoder(w).Encode(payload) }))
			defer upstream.Close()
			client, _ := newShopifyConnectorHTTPClient(upstream.URL, "service-token", upstream.Client())
			_, err := (&shopifyOrderAddressHTTPWriter{connector: client}).UpdateOrderShippingAddress(t.Context(), request)
			var safeErr *shopifyconnector.ConnectionProbeError
			if !errors.As(err, &safeErr) || safeErr.Code != shopifyconnector.ErrorCodeUnavailable || !safeErr.Retryable || strings.Contains(err.Error(), "shpat_") {
				t.Fatalf("malformed order address response escaped: %#v %v", safeErr, err)
			}
		})
	}
}

func TestConnectionHTTPClientRejectsMalformedVersionStateAndIdentity(t *testing.T) {
	request := connectorProbeRequest(connectorTestTenantOne, connectorTestShopOne, "corr-strict-client")
	valid := map[string]any{
		"contractVersion": "shopify.connector.connection.v3",
		"tenantId":        connectorTestTenantOne, "shopId": connectorTestShopOne,
		"state": "CONNECTED", "grantedScopes": []string{"read_orders"},
		"checkedAt": "2026-08-01T19:00:00Z",
	}
	tests := map[string]func(map[string]any){
		"unknown version":   func(value map[string]any) { value["contractVersion"] = "shopify.connector.connection.v2" },
		"legacy version":    func(value map[string]any) { value["contractVersion"] = "shopify.connector.connection.v1" },
		"unknown state":     func(value map[string]any) { value["state"] = "UNKNOWN" },
		"tenant mismatch":   func(value map[string]any) { value["tenantId"] = connectorTestTenantTwo },
		"shop mismatch":     func(value map[string]any) { value["shopId"] = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
		"missing scopes":    func(value map[string]any) { delete(value, "grantedScopes") },
		"null scopes":       func(value map[string]any) { value["grantedScopes"] = nil },
		"legacy capability": func(value map[string]any) { value["capabilities"] = map[string]bool{"themeEmbedReady": false} },
		"missing checkedAt": func(value map[string]any) { delete(value, "checkedAt") },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			payload := make(map[string]any, len(valid))
			for key, value := range valid {
				payload[key] = value
			}
			mutate(payload)
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				_ = json.NewEncoder(w).Encode(payload)
			}))
			defer upstream.Close()
			client, err := newShopifyConnectionHTTPProbe(upstream.URL, "service-token", http.DefaultClient)
			if err != nil {
				t.Fatalf("new client failed: %v", err)
			}
			_, err = client.ProbeConnection(t.Context(), request)
			var safeErr *shopifyconnector.ConnectionProbeError
			if !errors.As(err, &safeErr) || safeErr.Code != shopifyconnector.ErrorCodeUnavailable {
				t.Fatalf("invalid response did not fail closed: %T %v", err, err)
			}
		})
	}
}

func TestConnectionForwardRejectsRecursiveAndInsecureBaseURLs(t *testing.T) {
	if _, err := newShopifyConnectionHTTPProbe("http://connector.example", "service-token", http.DefaultClient); err == nil {
		t.Fatal("non-loopback HTTP connector base URL was accepted")
	}
	t.Setenv("XZ_ERP_CONNECTOR_TOKEN", "service-token")
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	t.Setenv("XZ_SHOPIFY_CONNECTOR_INTERNAL_BASE_URL", server.URL)
	request := connectorProbeRequest(connectorTestTenantOne, connectorTestShopOne, "corr-loop-guard")
	var body bytes.Buffer
	_ = json.NewEncoder(&body).Encode(request)
	httpRequest, _ := http.NewRequest(http.MethodPost, server.URL+shopifyConnectorConnectionPath, &body)
	httpRequest.Header.Set("X-XZ-ERP-Connector-Token", "service-token")
	response, err := http.DefaultClient.Do(httpRequest)
	if err != nil {
		t.Fatalf("recursive guard request failed: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusBadGateway {
		t.Fatalf("recursive connector target was not rejected: status=%d", response.StatusCode)
	}
	raw, _ := io.ReadAll(response.Body)
	for _, forbidden := range []string{server.URL, "service-token", "recursive"} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatalf("recursive failure leaked internal detail %q: %s", forbidden, raw)
		}
	}
}

func forwardOrderAddressRequest(correlation string) shopifyconnector.OrderShippingAddressUpdateRequest {
	return shopifyconnector.OrderShippingAddressUpdateRequest{
		Identity: shopifyconnector.CanonicalShopIdentity{TenantID: connectorTestTenantOne, ShopID: connectorTestShopOne},
		Context:  shopifyconnector.RequestContext{CorrelationID: correlation, RequestID: correlation + "-request"},
		OrderID:  "gid://shopify/Order/123", IdempotencyKey: "address-command-1",
		Address: shopifyconnector.CatalogMailingAddress{FirstName: "Ada", LastName: "Lovelace", Address1: "1 Main", City: "Toronto", ProvinceCode: "ON", CountryCode: "CA", Zip: "A1A1A1"},
	}
}
