package installations

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

type recordingStandaloneWriteProvider struct {
	calls         []string
	domain, token string
	now           time.Time
	err           error
}

func (p *recordingStandaloneWriteProvider) SetInventoryAvailable(_ context.Context, domain, token string, request shopifyconnector.InventorySetRequest) (shopifyconnector.InventorySetResult, error) {
	p.calls = append(p.calls, "inventory")
	p.domain, p.token = domain, token
	if p.err != nil {
		return shopifyconnector.InventorySetResult{}, p.err
	}
	return shopifyconnector.AppliedInventorySetResult(request, p.now), nil
}

func (p *recordingStandaloneWriteProvider) UpdateOrderShippingAddress(_ context.Context, domain, token string, request shopifyconnector.OrderShippingAddressUpdateRequest) (shopifyconnector.OrderShippingAddressUpdateResult, error) {
	p.calls = append(p.calls, "order-address")
	p.domain, p.token = domain, token
	if p.err != nil {
		return shopifyconnector.OrderShippingAddressUpdateResult{}, p.err
	}
	return shopifyconnector.OrderShippingAddressUpdateResult{
		ContractVersion: shopifyconnector.OrderShippingAddressContractVersion,
		TenantID:        request.Identity.TenantID, ShopID: request.Identity.ShopID,
		OrderID: request.OrderID, Address: request.Address, UpdatedAt: p.now,
	}, nil
}

func TestServiceStandaloneWritesUseConnectorCredentialAndExactScopes(t *testing.T) {
	now := time.Date(2026, 8, 2, 0, 0, 0, 0, time.UTC)
	repository := NewMemoryRepository()
	binding := Binding{Identity: identity(), LegacyShopID: "legacy", ShopDomain: "writes.myshopify.com"}
	seedOrderInstallation(t, repository, binding, "shpat_connector_writes", []string{
		"write_inventory", "read_locations", "write_orders",
	}, now)
	provider := &recordingStandaloneWriteProvider{now: now}
	service := NewServiceWithProviders(repository, nil, &fakeEffects{}, &recordingExchanger{}, nil, nil, nil, nil, nil, nil, provider, provider, nil)
	inventory := standaloneInventoryRequest("writes-owned")
	if _, err := service.SetInventoryAvailable(t.Context(), inventory); err != nil {
		t.Fatalf("inventory write: %v", err)
	}
	if _, err := service.UpdateOrderShippingAddress(t.Context(), standaloneOrderAddressRequest("writes-owned")); err != nil {
		t.Fatalf("order address write: %v", err)
	}
	if len(provider.calls) != 2 || provider.domain != "writes.myshopify.com" || provider.token != "shpat_connector_writes" {
		t.Fatalf("connector credential was not used: calls=%v domain=%q token=%q", provider.calls, provider.domain, provider.token)
	}

	blockedRepository := NewMemoryRepository()
	seedOrderInstallation(t, blockedRepository, binding, "shpat_no_write_scope", []string{"read_inventory", "read_locations"}, now)
	blocked := &recordingStandaloneWriteProvider{now: now}
	blockedService := NewServiceWithProviders(blockedRepository, nil, &fakeEffects{}, &recordingExchanger{}, nil, nil, nil, nil, nil, nil, blocked, blocked, nil)
	_, err := blockedService.SetInventoryAvailable(t.Context(), inventory)
	var safeErr *shopifyconnector.ConnectionProbeError
	if !errors.As(err, &safeErr) || safeErr.Code != shopifyconnector.ErrorCodeForbidden || len(blocked.calls) != 0 {
		t.Fatalf("write scope gate did not fail closed: calls=%v err=%v", blocked.calls, err)
	}
	_, err = blockedService.UpdateOrderShippingAddress(t.Context(), standaloneOrderAddressRequest("blocked-address"))
	if !errors.As(err, &safeErr) || safeErr.Code != shopifyconnector.ErrorCodeForbidden || len(blocked.calls) != 0 {
		t.Fatalf("order write scope gate did not fail closed: calls=%v err=%v", blocked.calls, err)
	}
}

func TestHTTPRuntimeServesStandaloneWritesBehindServiceToken(t *testing.T) {
	now := time.Date(2026, 8, 2, 0, 0, 0, 0, time.UTC)
	repository := NewMemoryRepository()
	binding := Binding{Identity: identity(), LegacyShopID: "legacy", ShopDomain: "writes.myshopify.com"}
	scopes := []string{"write_inventory", "read_locations", "write_orders"}
	seedOrderInstallation(t, repository, binding, "shpat_runtime_writes", scopes, now)
	provider := &recordingStandaloneWriteProvider{now: now}
	service := NewServiceWithProviders(repository, scopes, &fakeEffects{}, &recordingExchanger{}, nil, nil, nil, nil, nil, nil, provider, provider, nil)
	handler, err := NewHandler(RuntimeConfig{ServiceToken: "service-token", AppAPIKey: "app-key", AppSecret: "app-secret", Scopes: scopes, CallbackURL: "https://connector.example/shopify/oauth/callback"}, service, repository)
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		path string
		body any
	}{
		{InventorySetPath, standaloneInventoryRequest("runtime-write")},
		{OrderShippingAddressPath, standaloneOrderAddressRequest("runtime-write")},
	} {
		unauthorized := httptest.NewRequest(http.MethodPost, test.path, bytes.NewReader(encodeJSON(t, test.body)))
		unauthorizedResult := httptest.NewRecorder()
		handler.ServeHTTP(unauthorizedResult, unauthorized)
		if unauthorizedResult.Code != http.StatusForbidden {
			t.Fatalf("unauthorized %s status=%d", test.path, unauthorizedResult.Code)
		}
		authorized := httptest.NewRequest(http.MethodPost, test.path, bytes.NewReader(encodeJSON(t, test.body)))
		authorized.Header.Set(ServiceTokenHeader, "service-token")
		result := httptest.NewRecorder()
		handler.ServeHTTP(result, authorized)
		if result.Code != http.StatusOK {
			t.Fatalf("runtime %s status=%d body=%s", test.path, result.Code, result.Body.String())
		}
	}
}

func TestServiceStandaloneWriteProviderFailureIsRedacted(t *testing.T) {
	now := time.Date(2026, 8, 2, 0, 0, 0, 0, time.UTC)
	repository := NewMemoryRepository()
	binding := Binding{Identity: identity(), LegacyShopID: "legacy", ShopDomain: "writes.myshopify.com"}
	seedOrderInstallation(t, repository, binding, "shpat_secret_write", []string{"write_inventory", "read_locations"}, now)
	provider := &recordingStandaloneWriteProvider{now: now, err: errors.New("provider detail shpat_secret_write")}
	service := NewServiceWithProviders(repository, nil, &fakeEffects{}, &recordingExchanger{}, nil, nil, nil, nil, nil, nil, provider, nil, nil)
	_, err := service.SetInventoryAvailable(t.Context(), standaloneInventoryRequest("write-redacted"))
	var safeErr *shopifyconnector.ConnectionProbeError
	if !errors.As(err, &safeErr) || safeErr.Code != shopifyconnector.ErrorCodeUnavailable || strings.Contains(err.Error(), "shpat_secret_write") || strings.Contains(err.Error(), "provider detail") {
		t.Fatalf("provider failure leaked: %#v %v", safeErr, err)
	}
}

func standaloneInventoryRequest(correlation string) shopifyconnector.InventorySetRequest {
	return shopifyconnector.InventorySetRequest{
		Identity: identity(), Context: requestContext(correlation),
		InventoryItemID: "gid://shopify/InventoryItem/1", LocationID: "gid://shopify/Location/2",
		ExpectedAvailable: 3, TargetAvailable: 4, IdempotencyKey: "inventory-command-1",
		ReferenceDocumentURI: "xz-erp://inventory-publications/5e267b48-1b17-4cba-af71-8d9e1226f517",
	}
}

func standaloneOrderAddressRequest(correlation string) shopifyconnector.OrderShippingAddressUpdateRequest {
	return shopifyconnector.OrderShippingAddressUpdateRequest{
		Identity: identity(), Context: requestContext(correlation),
		OrderID: "gid://shopify/Order/123", IdempotencyKey: "address-command-1",
		Address: shopifyconnector.CatalogMailingAddress{FirstName: "Ada", LastName: "Lovelace", Address1: "1 Main", City: "Toronto", ProvinceCode: "ON", CountryCode: "CA", Zip: "A1A1A1"},
	}
}
