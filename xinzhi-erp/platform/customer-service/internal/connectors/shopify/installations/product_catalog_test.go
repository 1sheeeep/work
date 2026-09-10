package installations

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

type recordingProductCatalogProvider struct {
	page   shopifyconnector.ProductCatalogPage
	err    error
	calls  int
	domain string
	token  string
}

func (p *recordingProductCatalogProvider) FetchProductCatalogPage(
	_ context.Context,
	domain string,
	token string,
	_ shopifyconnector.ProductCatalogPageRequest,
) (shopifyconnector.ProductCatalogPage, error) {
	p.calls++
	p.domain = domain
	p.token = token
	return p.page, p.err
}

func TestServiceProductCatalogUsesConnectorOwnedInstallationAndWriteScopeImplication(t *testing.T) {
	now := time.Date(2026, 8, 1, 20, 0, 0, 0, time.UTC)
	request := connectorProductRequest("product-owned")
	repository := NewMemoryRepository()
	binding := Binding{Identity: identity(), LegacyShopID: "legacy-shop", ShopDomain: "catalog.myshopify.com"}
	if err := repository.CompleteInstallation(t.Context(), binding, InstallationRecord{
		Binding: binding, AccessToken: "shpat_connector_product_token", Scopes: []string{"write_products"},
		State: shopifyconnector.InstallationStateInstalled, InstalledAt: now.Add(-time.Hour), UpdatedAt: now.Add(-time.Hour),
	}); err != nil {
		t.Fatalf("seed connector installation: %v", err)
	}
	provider := &recordingProductCatalogProvider{page: shopifyconnector.ConnectedProductCatalogPage(
		request,
		[]shopifyconnector.CatalogProduct{{
			ID: "gid://shopify/Product/1", Title: "Catalog product",
			Variants: []shopifyconnector.CatalogVariant{{ID: "gid://shopify/ProductVariant/2", Title: "Default"}},
		}},
		shopifyconnector.CatalogPageInfo{},
		now,
	)}
	service := NewServiceWithProductCatalog(repository, nil, &fakeEffects{}, &recordingExchanger{}, provider)

	page, err := service.FetchProductCatalogPage(t.Context(), request)
	if err != nil {
		t.Fatalf("FetchProductCatalogPage failed: %v", err)
	}
	if provider.calls != 1 || provider.domain != "catalog.myshopify.com" ||
		provider.token != "shpat_connector_product_token" ||
		page.ContractVersion != shopifyconnector.ProductCatalogContractVersion ||
		page.TenantID != request.Identity.TenantID || page.ShopID != request.Identity.ShopID ||
		page.State != shopifyconnector.ProductCatalogStateConnected || len(page.Products) != 1 {
		t.Fatalf("connector-owned catalog mismatch: provider=%#v page=%#v", provider, page)
	}
	raw, _ := json.Marshal(page)
	for _, forbidden := range []string{"shpat_", "catalog.myshopify.com", "accessToken"} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatalf("product response leaked connector credential fact %q: %s", forbidden, raw)
		}
	}
}

func TestServiceProductCatalogFailsClosedWithoutInstallationScopeOrProvider(t *testing.T) {
	now := time.Date(2026, 8, 1, 20, 0, 0, 0, time.UTC)
	request := connectorProductRequest("product-fail-closed")
	binding := Binding{Identity: identity(), LegacyShopID: "legacy-shop", ShopDomain: "catalog.myshopify.com"}

	missingProvider := &recordingProductCatalogProvider{}
	missingService := NewServiceWithProductCatalog(NewMemoryRepository(), nil, &fakeEffects{}, &recordingExchanger{}, missingProvider)
	page, err := missingService.FetchProductCatalogPage(t.Context(), request)
	if err != nil || page.State != shopifyconnector.ProductCatalogStateNotConfigured || missingProvider.calls != 0 {
		t.Fatalf("missing installation must return not configured without provider: page=%#v calls=%d err=%v", page, missingProvider.calls, err)
	}

	revokedRepository := NewMemoryRepository()
	if err := revokedRepository.CompleteInstallation(t.Context(), binding, InstallationRecord{
		Binding: binding, AccessToken: "shpat_revoked", Scopes: []string{"read_products"},
		State: shopifyconnector.InstallationStateInstalled, InstalledAt: now.Add(-time.Hour), UpdatedAt: now.Add(-time.Hour),
	}); err != nil {
		t.Fatalf("seed installation to revoke: %v", err)
	}
	if _, _, err := revokedRepository.MarkRevoked(t.Context(), request.Identity, now); err != nil {
		t.Fatalf("revoke installation: %v", err)
	}
	revokedProvider := &recordingProductCatalogProvider{}
	revokedService := NewServiceWithProductCatalog(revokedRepository, nil, &fakeEffects{}, &recordingExchanger{}, revokedProvider)
	page, err = revokedService.FetchProductCatalogPage(t.Context(), request)
	if err != nil || page.State != shopifyconnector.ProductCatalogStateNotConfigured || revokedProvider.calls != 0 {
		t.Fatalf("revoked installation must return not configured without provider: page=%#v calls=%d err=%v", page, revokedProvider.calls, err)
	}

	noScopeRepository := NewMemoryRepository()
	if err := noScopeRepository.CompleteInstallation(t.Context(), binding, InstallationRecord{
		Binding: binding, AccessToken: "shpat_no_product_scope", Scopes: []string{"read_orders"},
		State: shopifyconnector.InstallationStateInstalled, InstalledAt: now.Add(-time.Hour), UpdatedAt: now.Add(-time.Hour),
	}); err != nil {
		t.Fatalf("seed no-scope installation: %v", err)
	}
	noScopeProvider := &recordingProductCatalogProvider{}
	noScopeService := NewServiceWithProductCatalog(noScopeRepository, nil, &fakeEffects{}, &recordingExchanger{}, noScopeProvider)
	_, err = noScopeService.FetchProductCatalogPage(t.Context(), request)
	var safeErr *shopifyconnector.ConnectionProbeError
	if !errors.As(err, &safeErr) || safeErr.Code != shopifyconnector.ErrorCodeForbidden || noScopeProvider.calls != 0 {
		t.Fatalf("missing read_products did not fail closed: calls=%d err=%#v", noScopeProvider.calls, safeErr)
	}

	configuredRepository := NewMemoryRepository()
	if err := configuredRepository.CompleteInstallation(t.Context(), binding, InstallationRecord{
		Binding: binding, AccessToken: "shpat_configured", Scopes: []string{"read_products"},
		State: shopifyconnector.InstallationStateInstalled, InstalledAt: now.Add(-time.Hour), UpdatedAt: now.Add(-time.Hour),
	}); err != nil {
		t.Fatalf("seed configured installation: %v", err)
	}
	configuredService := NewService(configuredRepository, nil, &fakeEffects{}, &recordingExchanger{})
	_, err = configuredService.FetchProductCatalogPage(t.Context(), request)
	if !errors.As(err, &safeErr) || safeErr.Code != shopifyconnector.ErrorCodeUnavailable {
		t.Fatalf("missing provider configuration did not fail closed: %T %v", err, err)
	}
}

func TestServiceProductCatalogRedactsProviderFailure(t *testing.T) {
	now := time.Date(2026, 8, 1, 20, 0, 0, 0, time.UTC)
	request := connectorProductRequest("product-provider-failure")
	repository := NewMemoryRepository()
	binding := Binding{Identity: identity(), LegacyShopID: "legacy-shop", ShopDomain: "catalog.myshopify.com"}
	if err := repository.CompleteInstallation(t.Context(), binding, InstallationRecord{
		Binding: binding, AccessToken: "shpat_secret", Scopes: []string{"read_products"},
		State: shopifyconnector.InstallationStateInstalled, InstalledAt: now.Add(-time.Hour), UpdatedAt: now.Add(-time.Hour),
	}); err != nil {
		t.Fatalf("seed connector installation: %v", err)
	}
	provider := &recordingProductCatalogProvider{err: errors.New("provider raw detail shpat_secret")}
	service := NewServiceWithProductCatalog(repository, nil, &fakeEffects{}, &recordingExchanger{}, provider)

	_, err := service.FetchProductCatalogPage(t.Context(), request)
	var safeErr *shopifyconnector.ConnectionProbeError
	if !errors.As(err, &safeErr) || safeErr.Code != shopifyconnector.ErrorCodeUnavailable ||
		strings.Contains(err.Error(), "shpat_secret") || strings.Contains(err.Error(), "provider raw") {
		t.Fatalf("provider failure was not redacted: %#v %v", safeErr, err)
	}
}

func TestHTTPRuntimeProductCatalogRequiresServiceToken(t *testing.T) {
	now := time.Date(2026, 8, 1, 20, 0, 0, 0, time.UTC)
	request := connectorProductRequest("runtime-product")
	repository := NewMemoryRepository()
	binding := Binding{Identity: identity(), LegacyShopID: "legacy-shop", ShopDomain: "catalog.myshopify.com"}
	if err := repository.CompleteInstallation(t.Context(), binding, InstallationRecord{
		Binding: binding, AccessToken: "shpat_runtime_product", Scopes: []string{"read_products"},
		State: shopifyconnector.InstallationStateInstalled, InstalledAt: now.Add(-time.Hour), UpdatedAt: now.Add(-time.Hour),
	}); err != nil {
		t.Fatalf("seed connector installation: %v", err)
	}
	provider := &recordingProductCatalogProvider{page: shopifyconnector.ConnectedProductCatalogPage(request, []shopifyconnector.CatalogProduct{{
		ID: "gid://shopify/Product/1", Title: "Catalog product", Variants: []shopifyconnector.CatalogVariant{},
	}}, shopifyconnector.CatalogPageInfo{}, now)}
	service := NewServiceWithProductCatalog(repository, []string{"read_products"}, &fakeEffects{}, &recordingExchanger{}, provider)
	handler, err := NewHandler(RuntimeConfig{
		ServiceToken: "service-token", AppAPIKey: "app-key", AppSecret: "app-secret",
		Scopes: []string{"read_products"}, CallbackURL: "https://connector.example/shopify/oauth/callback",
	}, service, repository)
	if err != nil {
		t.Fatalf("NewHandler failed: %v", err)
	}
	body := encodeJSON(t, request)

	unauthorized := httptest.NewRequest(http.MethodPost, ProductCatalogPath, bytes.NewReader(body))
	unauthorizedResponse := httptest.NewRecorder()
	handler.ServeHTTP(unauthorizedResponse, unauthorized)
	if unauthorizedResponse.Code != http.StatusForbidden || provider.calls != 0 {
		t.Fatalf("unauthorized product request reached provider: status=%d calls=%d", unauthorizedResponse.Code, provider.calls)
	}
	authorized := httptest.NewRequest(http.MethodPost, ProductCatalogPath, bytes.NewReader(body))
	authorized.Header.Set(ServiceTokenHeader, "service-token")
	authorizedResponse := httptest.NewRecorder()
	handler.ServeHTTP(authorizedResponse, authorized)
	if authorizedResponse.Code != http.StatusOK || provider.calls != 1 {
		t.Fatalf("authorized product request failed: status=%d calls=%d body=%s", authorizedResponse.Code, provider.calls, authorizedResponse.Body.String())
	}
}

func connectorProductRequest(correlationID string) shopifyconnector.ProductCatalogPageRequest {
	return shopifyconnector.ProductCatalogPageRequest{
		Identity: identity(),
		Context:  requestContext(correlationID),
		Limit:    50,
	}
}
