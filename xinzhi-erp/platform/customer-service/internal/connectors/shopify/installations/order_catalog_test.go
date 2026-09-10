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

type recordingOrderCatalogProvider struct {
	page   shopifyconnector.OrderCatalogPage
	err    error
	calls  int
	domain string
	token  string
}

func (p *recordingOrderCatalogProvider) FetchOrderCatalogPage(
	_ context.Context,
	domain string,
	token string,
	_ shopifyconnector.OrderCatalogPageRequest,
) (shopifyconnector.OrderCatalogPage, error) {
	p.calls++
	p.domain = domain
	p.token = token
	return p.page, p.err
}

func TestServiceOrderCatalogUsesConnectorOwnedInstallationAndWriteScopeImplication(t *testing.T) {
	now := time.Date(2026, 8, 1, 23, 0, 0, 0, time.UTC)
	request := connectorOrderRequest("order-owned")
	repository := NewMemoryRepository()
	binding := Binding{Identity: identity(), LegacyShopID: "legacy-shop", ShopDomain: "orders.myshopify.com"}
	seedOrderInstallation(t, repository, binding, "shpat_connector_order", []string{"write_orders"}, now)
	provider := &recordingOrderCatalogProvider{page: connectedOrderPage(request, now)}
	service := NewServiceWithCatalogs(repository, nil, &fakeEffects{}, &recordingExchanger{}, nil, provider)

	page, err := service.FetchOrderCatalogPage(t.Context(), request)
	if err != nil {
		t.Fatalf("FetchOrderCatalogPage failed: %v", err)
	}
	if provider.calls != 1 || provider.domain != "orders.myshopify.com" ||
		provider.token != "shpat_connector_order" || page.State != shopifyconnector.OrderCatalogStateConnected {
		t.Fatalf("connector-owned order catalog mismatch: provider=%#v page=%#v", provider, page)
	}
}

func TestServiceOrderCatalogFailsClosedWithoutInstallationScopeOrProvider(t *testing.T) {
	now := time.Date(2026, 8, 1, 23, 0, 0, 0, time.UTC)
	request := connectorOrderRequest("order-fail-closed")
	binding := Binding{Identity: identity(), LegacyShopID: "legacy-shop", ShopDomain: "orders.myshopify.com"}

	missingProvider := &recordingOrderCatalogProvider{}
	missingService := NewServiceWithCatalogs(NewMemoryRepository(), nil, &fakeEffects{}, &recordingExchanger{}, nil, missingProvider)
	page, err := missingService.FetchOrderCatalogPage(t.Context(), request)
	if err != nil || page.State != shopifyconnector.OrderCatalogStateNotConfigured || missingProvider.calls != 0 {
		t.Fatalf("missing order installation did not close safely: page=%#v calls=%d err=%v", page, missingProvider.calls, err)
	}

	revokedRepository := NewMemoryRepository()
	seedOrderInstallation(t, revokedRepository, binding, "shpat_revoked_order", []string{"read_orders"}, now)
	if _, _, err := revokedRepository.MarkRevoked(t.Context(), request.Identity, now); err != nil {
		t.Fatalf("revoke order installation: %v", err)
	}
	revokedProvider := &recordingOrderCatalogProvider{}
	revokedService := NewServiceWithCatalogs(revokedRepository, nil, &fakeEffects{}, &recordingExchanger{}, nil, revokedProvider)
	page, err = revokedService.FetchOrderCatalogPage(t.Context(), request)
	if err != nil || page.State != shopifyconnector.OrderCatalogStateNotConfigured || revokedProvider.calls != 0 {
		t.Fatalf("revoked order installation did not close safely: page=%#v calls=%d err=%v", page, revokedProvider.calls, err)
	}

	noScopeRepository := NewMemoryRepository()
	seedOrderInstallation(t, noScopeRepository, binding, "shpat_no_order_scope", []string{"read_products"}, now)
	noScopeProvider := &recordingOrderCatalogProvider{}
	noScopeService := NewServiceWithCatalogs(noScopeRepository, nil, &fakeEffects{}, &recordingExchanger{}, nil, noScopeProvider)
	_, err = noScopeService.FetchOrderCatalogPage(t.Context(), request)
	var safeErr *shopifyconnector.ConnectionProbeError
	if !errors.As(err, &safeErr) || safeErr.Code != shopifyconnector.ErrorCodeForbidden || noScopeProvider.calls != 0 {
		t.Fatalf("missing read_orders did not fail closed: calls=%d err=%#v", noScopeProvider.calls, safeErr)
	}

	configuredRepository := NewMemoryRepository()
	seedOrderInstallation(t, configuredRepository, binding, "shpat_configured_order", []string{"read_orders"}, now)
	configuredService := NewService(configuredRepository, nil, &fakeEffects{}, &recordingExchanger{})
	_, err = configuredService.FetchOrderCatalogPage(t.Context(), request)
	if !errors.As(err, &safeErr) || safeErr.Code != shopifyconnector.ErrorCodeUnavailable {
		t.Fatalf("missing order provider did not fail closed: %T %v", err, err)
	}
}

func TestServiceOrderCatalogRedactsProviderFailure(t *testing.T) {
	now := time.Date(2026, 8, 1, 23, 0, 0, 0, time.UTC)
	request := connectorOrderRequest("order-provider-failure")
	repository := NewMemoryRepository()
	binding := Binding{Identity: identity(), LegacyShopID: "legacy-shop", ShopDomain: "orders.myshopify.com"}
	seedOrderInstallation(t, repository, binding, "shpat_secret_order", []string{"read_orders"}, now)
	provider := &recordingOrderCatalogProvider{err: errors.New("provider raw detail shpat_secret_order")}
	service := NewServiceWithCatalogs(repository, nil, &fakeEffects{}, &recordingExchanger{}, nil, provider)

	_, err := service.FetchOrderCatalogPage(t.Context(), request)
	var safeErr *shopifyconnector.ConnectionProbeError
	if !errors.As(err, &safeErr) || safeErr.Code != shopifyconnector.ErrorCodeUnavailable ||
		strings.Contains(err.Error(), "shpat_secret_order") || strings.Contains(err.Error(), "provider raw") {
		t.Fatalf("order provider failure was not redacted: %#v %v", safeErr, err)
	}
}

func TestServiceOrderCatalogPreservesProtectedCustomerDataRequirement(t *testing.T) {
	now := time.Date(2026, 8, 1, 23, 0, 0, 0, time.UTC)
	request := connectorOrderRequest("order-protected-data")
	repository := NewMemoryRepository()
	binding := Binding{Identity: identity(), LegacyShopID: "legacy-shop", ShopDomain: "orders.myshopify.com"}
	seedOrderInstallation(t, repository, binding, "shpat_secret_order", []string{"read_orders"}, now)
	provider := &recordingOrderCatalogProvider{err: shopifyconnector.ErrProtectedCustomerDataRequired}
	service := NewServiceWithCatalogs(repository, nil, &fakeEffects{}, &recordingExchanger{}, nil, provider)

	_, err := service.FetchOrderCatalogPage(t.Context(), request)
	var safeErr *shopifyconnector.ConnectionProbeError
	if !errors.As(err, &safeErr) ||
		safeErr.Code != shopifyconnector.ErrorCodeProtectedCustomerDataRequired ||
		safeErr.Retryable || strings.Contains(err.Error(), "shpat_") {
		t.Fatalf("protected customer data requirement was not preserved safely: %#v %v", safeErr, err)
	}
}

func TestHTTPRuntimeOrderCatalogRequiresServiceToken(t *testing.T) {
	now := time.Date(2026, 8, 1, 23, 0, 0, 0, time.UTC)
	request := connectorOrderRequest("runtime-order")
	repository := NewMemoryRepository()
	binding := Binding{Identity: identity(), LegacyShopID: "legacy-shop", ShopDomain: "orders.myshopify.com"}
	seedOrderInstallation(t, repository, binding, "shpat_runtime_order", []string{"read_orders"}, now)
	provider := &recordingOrderCatalogProvider{page: connectedOrderPage(request, now)}
	service := NewServiceWithCatalogs(repository, []string{"read_orders"}, &fakeEffects{}, &recordingExchanger{}, nil, provider)
	handler, err := NewHandler(RuntimeConfig{
		ServiceToken: "service-token", AppAPIKey: "app-key", AppSecret: "app-secret",
		Scopes: []string{"read_orders"}, CallbackURL: "https://connector.example/shopify/oauth/callback",
	}, service, repository)
	if err != nil {
		t.Fatalf("NewHandler failed: %v", err)
	}
	body := encodeJSON(t, request)
	unauthorized := httptest.NewRequest(http.MethodPost, OrderCatalogPath, bytes.NewReader(body))
	unauthorizedResponse := httptest.NewRecorder()
	handler.ServeHTTP(unauthorizedResponse, unauthorized)
	if unauthorizedResponse.Code != http.StatusForbidden || provider.calls != 0 {
		t.Fatalf("unauthorized order request reached provider: status=%d calls=%d", unauthorizedResponse.Code, provider.calls)
	}
	authorized := httptest.NewRequest(http.MethodPost, OrderCatalogPath, bytes.NewReader(body))
	authorized.Header.Set(ServiceTokenHeader, "service-token")
	authorizedResponse := httptest.NewRecorder()
	handler.ServeHTTP(authorizedResponse, authorized)
	if authorizedResponse.Code != http.StatusOK || provider.calls != 1 {
		t.Fatalf("authorized order request failed: status=%d calls=%d body=%s", authorizedResponse.Code, provider.calls, authorizedResponse.Body.String())
	}
}

func seedOrderInstallation(t *testing.T, repository *MemoryRepository, binding Binding, token string, scopes []string, now time.Time) {
	t.Helper()
	if err := repository.CompleteInstallation(t.Context(), binding, InstallationRecord{
		Binding: binding, AccessToken: token, Scopes: scopes,
		State: shopifyconnector.InstallationStateInstalled, InstalledAt: now.Add(-time.Hour), UpdatedAt: now.Add(-time.Hour),
	}); err != nil {
		t.Fatalf("seed order installation: %v", err)
	}
}

func connectorOrderRequest(correlationID string) shopifyconnector.OrderCatalogPageRequest {
	return shopifyconnector.OrderCatalogPageRequest{
		Identity: identity(), Context: requestContext(correlationID), Limit: 50,
	}
}

func connectedOrderPage(request shopifyconnector.OrderCatalogPageRequest, now time.Time) shopifyconnector.OrderCatalogPage {
	return shopifyconnector.ConnectedOrderCatalogPage(request, []shopifyconnector.CatalogOrder{{
		ID: "gid://shopify/Order/1", Name: "#1001", CreatedAt: now.Add(-time.Hour).Format(time.RFC3339),
		PaymentGatewayNames: []string{}, Total: shopifyconnector.CatalogMoney{Amount: "10.00", CurrencyCode: "USD"},
		LineItems: []shopifyconnector.CatalogOrderLine{}, Fulfillments: []shopifyconnector.CatalogFulfillment{},
	}}, shopifyconnector.CatalogPageInfo{}, now)
}
