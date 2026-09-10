package platform

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestShopifyAuthorizationStatusReportsOnlyMissingFeatureScopes(t *testing.T) {
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var missingShop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Missing refund", ExternalID: "missing-refund.myshopify.com"}, http.StatusCreated, &missingShop)
	if _, err := store.SaveShopifyInstallation(t.Context(), ShopifyInstallation{
		ShopID: missingShop.ID, ShopDomain: missingShop.ExternalID, AccessToken: "missing-token",
		Scope: strings.Join([]string{shopifyReturnReadScope, shopifyOrderWriteScope}, ","),
	}); err != nil {
		t.Fatal(err)
	}

	var completeShop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Complete refund", ExternalID: "complete-refund.myshopify.com"}, http.StatusCreated, &completeShop)
	if _, err := store.SaveShopifyInstallation(t.Context(), ShopifyInstallation{
		ShopID: completeShop.ID, ShopDomain: completeShop.ExternalID, AccessToken: "complete-token",
		Scope: strings.Join([]string{shopifyReturnWriteScope, shopifyOrderWriteScope}, ","),
	}); err != nil {
		t.Fatal(err)
	}

	var pendingShop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Pending install", ExternalID: "pending-install.myshopify.com"}, http.StatusCreated, &pendingShop)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Email only"}, http.StatusCreated, nil)

	var result struct {
		Feature string                       `json:"feature"`
		Shops   []ShopifyAuthorizationStatus `json:"shops"`
	}
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/shopify/authorization-status?feature=refund", adminToken, nil, http.StatusOK, &result)
	if result.Feature != shopifyAuthorizationFeatureRefund || len(result.Shops) != 3 {
		t.Fatalf("unexpected authorization result: %#v", result)
	}
	byID := map[string]ShopifyAuthorizationStatus{}
	for _, status := range result.Shops {
		byID[status.ShopID] = status
	}
	missing := byID[missingShop.ID]
	if !missing.Installed || !missing.NeedsReauthorization || len(missing.MissingScopes) != 1 || missing.MissingScopes[0] != shopifyReturnWriteScope {
		t.Fatalf("unexpected missing-shop status: %#v", missing)
	}
	complete := byID[completeShop.ID]
	if !complete.Installed || complete.NeedsReauthorization || len(complete.MissingScopes) != 0 {
		t.Fatalf("unexpected complete-shop status: %#v", complete)
	}
	pending := byID[pendingShop.ID]
	if pending.Installed || !pending.NeedsReauthorization || len(pending.MissingScopes) != 3 {
		t.Fatalf("unexpected pending-shop status: %#v", pending)
	}
}

func TestShopifyDisputeAuthorizationDoesNotRequireRestrictedEvidenceScopes(t *testing.T) {
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Disputes", ExternalID: "disputes.myshopify.com"}, http.StatusCreated, &shop)
	if _, err := store.SaveShopifyInstallation(t.Context(), ShopifyInstallation{ShopID: shop.ID, ShopDomain: shop.ExternalID, AccessToken: "token", Scope: shopifyDisputeReadScope}); err != nil {
		t.Fatal(err)
	}

	var result struct {
		Shops []ShopifyAuthorizationStatus `json:"shops"`
	}
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/shopify/authorization-status?feature=dispute", adminToken, nil, http.StatusOK, &result)
	if len(result.Shops) != 1 || result.Shops[0].NeedsReauthorization || len(result.Shops[0].MissingScopes) != 0 {
		t.Fatalf("unexpected dispute authorization: %#v", result.Shops)
	}
}

func TestShopifyAuthorizationStatusRejectsUnknownFeature(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/shopify/authorization-status?feature=unknown", adminToken, nil, http.StatusBadRequest, nil)
}
