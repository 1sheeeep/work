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

type recordingRemainingProvider struct {
	calls         []string
	domain, token string
	now           time.Time
	err           error
}

func TestHTTPRuntimeServesRemainingReadsBehindServiceToken(t *testing.T) {
	now := time.Date(2026, 8, 1, 23, 0, 0, 0, time.UTC)
	repository := NewMemoryRepository()
	binding := Binding{Identity: identity(), LegacyShopID: "legacy", ShopDomain: "reads.myshopify.com"}
	scopes := []string{"read_orders", "read_returns", "read_locations", "read_inventory", "read_shopify_payments_disputes"}
	seedOrderInstallation(t, repository, binding, "shpat_runtime_reads", scopes, now)
	provider := &recordingRemainingProvider{now: now}
	service := NewServiceWithReadProviders(repository, scopes, &fakeEffects{}, &recordingExchanger{}, nil, nil, provider, provider, provider, provider)
	handler, err := NewHandler(RuntimeConfig{ServiceToken: "service-token", AppAPIKey: "app-key", AppSecret: "app-secret", Scopes: scopes, CallbackURL: "https://connector.example/shopify/oauth/callback"}, service, repository)
	if err != nil {
		t.Fatal(err)
	}
	context := requestContext("runtime-remaining")
	cases := []struct {
		path    string
		request any
	}{
		{ReturnCatalogPath, shopifyconnector.ReturnCatalogPageRequest{Identity: identity(), Context: context, Limit: 50}},
		{LocationCatalogPath, shopifyconnector.LocationCatalogPageRequest{Identity: identity(), Context: context, Limit: 50}},
		{InventoryLevelPath, shopifyconnector.InventoryLevelReadRequest{Identity: identity(), Context: context, InventoryItemID: "gid://shopify/InventoryItem/1", LocationID: "gid://shopify/Location/2"}},
		{DisputeCatalogPath, shopifyconnector.DisputeCatalogPageRequest{Identity: identity(), Context: context, Limit: 50}},
	}
	for _, test := range cases {
		unauthorized := httptest.NewRequest(http.MethodPost, test.path, bytes.NewReader(encodeJSON(t, test.request)))
		unauthorizedResult := httptest.NewRecorder()
		handler.ServeHTTP(unauthorizedResult, unauthorized)
		if unauthorizedResult.Code != http.StatusForbidden {
			t.Fatalf("unauthorized %s status=%d", test.path, unauthorizedResult.Code)
		}
		authorized := httptest.NewRequest(http.MethodPost, test.path, bytes.NewReader(encodeJSON(t, test.request)))
		authorized.Header.Set(ServiceTokenHeader, "service-token")
		result := httptest.NewRecorder()
		handler.ServeHTTP(result, authorized)
		if result.Code != http.StatusOK {
			t.Fatalf("runtime %s status=%d body=%s", test.path, result.Code, result.Body.String())
		}
	}
	if len(provider.calls) != 4 {
		t.Fatalf("unexpected provider calls: %v", provider.calls)
	}
}

func (p *recordingRemainingProvider) record(kind, domain, token string) {
	p.calls = append(p.calls, kind)
	p.domain, p.token = domain, token
}
func (p *recordingRemainingProvider) FetchReturnCatalogPage(_ context.Context, domain, token string, request shopifyconnector.ReturnCatalogPageRequest) (shopifyconnector.ReturnCatalogPage, error) {
	p.record("return", domain, token)
	if p.err != nil {
		return shopifyconnector.ReturnCatalogPage{}, p.err
	}
	return shopifyconnector.ConnectedReturnCatalogPage(request, []shopifyconnector.CatalogReturn{{ID: "gid://shopify/Return/1", Name: "Return", OrderID: "gid://shopify/Order/2", OrderName: "#2", Status: "OPEN", CreatedAt: p.now.Format(time.RFC3339), TotalQuantity: 1, LineItems: []shopifyconnector.CatalogReturnLine{{ID: "gid://shopify/ReturnLineItem/3", FulfillmentLineID: "gid://shopify/FulfillmentLineItem/4", OrderLineID: "gid://shopify/LineItem/5", Name: "Item", Quantity: 1}}}}, shopifyconnector.CatalogPageInfo{}, p.now), nil
}
func (p *recordingRemainingProvider) FetchLocationCatalogPage(_ context.Context, domain, token string, request shopifyconnector.LocationCatalogPageRequest) (shopifyconnector.LocationCatalogPage, error) {
	p.record("location", domain, token)
	if p.err != nil {
		return shopifyconnector.LocationCatalogPage{}, p.err
	}
	return shopifyconnector.ConnectedLocationCatalogPage(request, []shopifyconnector.CatalogLocation{{ID: "gid://shopify/Location/2", Name: "Warehouse"}}, shopifyconnector.CatalogPageInfo{}, p.now), nil
}
func (p *recordingRemainingProvider) FetchInventoryLevel(_ context.Context, domain, token string, request shopifyconnector.InventoryLevelReadRequest) (shopifyconnector.InventoryLevelSnapshot, error) {
	p.record("inventory", domain, token)
	if p.err != nil {
		return shopifyconnector.InventoryLevelSnapshot{}, p.err
	}
	return shopifyconnector.ConnectedInventoryLevel(request, true, true, 3, nil, p.now), nil
}
func (p *recordingRemainingProvider) FetchDisputeCatalogPage(_ context.Context, domain, token string, request shopifyconnector.DisputeCatalogPageRequest) (shopifyconnector.DisputeCatalogPage, error) {
	p.record("dispute", domain, token)
	if p.err != nil {
		return shopifyconnector.DisputeCatalogPage{}, p.err
	}
	return shopifyconnector.ConnectedDisputeCatalogPage(request, []shopifyconnector.Dispute{{ID: "gid://shopify/ShopifyPaymentsDispute/1", Status: "NEEDS_RESPONSE", Type: "CHARGEBACK", Reason: "fraudulent", Amount: shopifyconnector.CatalogMoney{Amount: "10.00", CurrencyCode: "USD"}, InitiatedAt: p.now.Format(time.RFC3339)}}, shopifyconnector.CatalogPageInfo{}, p.now), nil
}

func TestServiceRemainingReadProviderFailureIsRedacted(t *testing.T) {
	now := time.Date(2026, 8, 1, 23, 0, 0, 0, time.UTC)
	repository := NewMemoryRepository()
	binding := Binding{Identity: identity(), LegacyShopID: "legacy", ShopDomain: "reads.myshopify.com"}
	seedOrderInstallation(t, repository, binding, "shpat_secret_remaining", []string{"read_locations"}, now)
	provider := &recordingRemainingProvider{now: now, err: errors.New("provider detail shpat_secret_remaining")}
	service := NewServiceWithReadProviders(repository, nil, &fakeEffects{}, &recordingExchanger{}, nil, nil, nil, provider, nil, nil)
	request := shopifyconnector.LocationCatalogPageRequest{Identity: identity(), Context: requestContext("remaining-redacted"), Limit: 50}
	_, err := service.FetchLocationCatalogPage(t.Context(), request)
	var safeErr *shopifyconnector.ConnectionProbeError
	if !errors.As(err, &safeErr) || safeErr.Code != shopifyconnector.ErrorCodeUnavailable || strings.Contains(err.Error(), "shpat_secret_remaining") || strings.Contains(err.Error(), "provider detail") {
		t.Fatalf("provider failure leaked: %#v %v", safeErr, err)
	}
}

func TestServiceRemainingReadsUseConnectorCredentialAndExactScopes(t *testing.T) {
	now := time.Date(2026, 8, 1, 23, 0, 0, 0, time.UTC)
	repository := NewMemoryRepository()
	binding := Binding{Identity: identity(), LegacyShopID: "legacy", ShopDomain: "reads.myshopify.com"}
	seedOrderInstallation(t, repository, binding, "shpat_connector_reads", []string{"read_orders", "write_returns", "read_locations", "write_inventory", "read_shopify_payments_disputes"}, now)
	provider := &recordingRemainingProvider{now: now}
	service := NewServiceWithReadProviders(repository, nil, &fakeEffects{}, &recordingExchanger{}, nil, nil, provider, provider, provider, provider)
	context := requestContext("remaining-owned")
	_, err1 := service.FetchReturnCatalogPage(t.Context(), shopifyconnector.ReturnCatalogPageRequest{Identity: identity(), Context: context, Limit: 50})
	_, err2 := service.FetchLocationCatalogPage(t.Context(), shopifyconnector.LocationCatalogPageRequest{Identity: identity(), Context: context, Limit: 50})
	_, err3 := service.FetchInventoryLevel(t.Context(), shopifyconnector.InventoryLevelReadRequest{Identity: identity(), Context: context, InventoryItemID: "gid://shopify/InventoryItem/1", LocationID: "gid://shopify/Location/2"})
	_, err4 := service.FetchDisputeCatalogPage(t.Context(), shopifyconnector.DisputeCatalogPageRequest{Identity: identity(), Context: context, Limit: 50})
	if err1 != nil || err2 != nil || err3 != nil || err4 != nil || len(provider.calls) != 4 || provider.domain != "reads.myshopify.com" || provider.token != "shpat_connector_reads" {
		t.Fatalf("connector-owned reads failed calls=%v domain=%q token=%q errors=%v/%v/%v/%v", provider.calls, provider.domain, provider.token, err1, err2, err3, err4)
	}

	noScope := NewMemoryRepository()
	seedOrderInstallation(t, noScope, binding, "shpat_no_scopes", []string{"read_products"}, now)
	blocked := &recordingRemainingProvider{now: now}
	blockedService := NewServiceWithReadProviders(noScope, nil, &fakeEffects{}, &recordingExchanger{}, nil, nil, blocked, blocked, blocked, blocked)
	_, err := blockedService.FetchInventoryLevel(t.Context(), shopifyconnector.InventoryLevelReadRequest{Identity: identity(), Context: context, InventoryItemID: "gid://shopify/InventoryItem/1", LocationID: "gid://shopify/Location/2"})
	var safeErr *shopifyconnector.ConnectionProbeError
	if !errors.As(err, &safeErr) || safeErr.Code != shopifyconnector.ErrorCodeForbidden || len(blocked.calls) != 0 {
		t.Fatalf("scope gate failed closed incorrectly calls=%v err=%v", blocked.calls, err)
	}
}
