package platform

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestShopifyAdminClientUpdatesOrderShippingAddress(t *testing.T) {
	var gotInput map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Query     string         `json:"query"`
			Variables map[string]any `json:"variables"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if !strings.Contains(payload.Query, "orderUpdate") {
			t.Fatalf("unexpected mutation: %s", payload.Query)
		}
		gotInput, _ = payload.Variables["input"].(map[string]any)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"orderUpdate":{"order":{"id":"gid://shopify/Order/1","shippingAddress":{"name":"Ada Lovelace","firstName":"Ada","lastName":"Lovelace","address1":"123 Main St","city":"London","countryCode":"GB","formatted":["123 Main St","London","United Kingdom"]}},"userErrors":[]}}}`))
	}))
	defer server.Close()

	client := shopifyAdminClient{HTTPClient: server.Client(), BaseURL: server.URL}
	address, err := client.UpdateOrderShippingAddress(t.Context(), "demo.myshopify.com", "test-token", ShopifyOrderShippingAddressUpdate{
		OrderID: "gid://shopify/Order/1",
		Address: ShopifyShippingAddressInput{
			FirstName: " Ada ", LastName: "Lovelace", Address1: " 123 Main St ",
			City: "London", CountryCode: "gb",
		},
	})
	if err != nil {
		t.Fatalf("UpdateOrderShippingAddress failed: %v", err)
	}
	if address.FirstName != "Ada" || address.CountryCode != "GB" {
		t.Fatalf("unexpected returned address: %#v", address)
	}
	shipping, _ := gotInput["shippingAddress"].(map[string]any)
	if gotInput["id"] != "gid://shopify/Order/1" || shipping["countryCode"] != "GB" || shipping["address1"] != "123 Main St" {
		t.Fatalf("unexpected mutation input: %#v", gotInput)
	}
}

func TestShopifyAdminClientUpdatesFulfillmentTrackingWithoutNotification(t *testing.T) {
	var gotVariables map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Query     string         `json:"query"`
			Variables map[string]any `json:"variables"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if !strings.Contains(payload.Query, "fulfillmentTrackingInfoUpdate") {
			t.Fatalf("unexpected mutation: %s", payload.Query)
		}
		gotVariables = payload.Variables
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"fulfillmentTrackingInfoUpdate":{"fulfillment":{"id":"gid://shopify/Fulfillment/9","status":"SUCCESS","trackingInfo":[{"company":"UPS","number":"1Z123","url":"https://ups.example/1Z123"}]},"userErrors":[]}}}`))
	}))
	defer server.Close()

	client := shopifyAdminClient{HTTPClient: server.Client(), BaseURL: server.URL}
	fulfillment, err := client.UpdateFulfillmentTracking(t.Context(), "demo.myshopify.com", "test-token", ShopifyFulfillmentTrackingUpdate{
		FulfillmentID: "gid://shopify/Fulfillment/9",
		Company:       " UPS ", Number: " 1Z123 ", URL: "https://ups.example/1Z123",
	})
	if err != nil {
		t.Fatalf("UpdateFulfillmentTracking failed: %v", err)
	}
	if fulfillment.ID != "gid://shopify/Fulfillment/9" || fulfillment.TrackingInfo[0].Number != "1Z123" {
		t.Fatalf("unexpected fulfillment: %#v", fulfillment)
	}
	if notified, ok := gotVariables["notifyCustomer"].(bool); !ok || notified {
		t.Fatalf("customer notification must default to false: %#v", gotVariables)
	}
	tracking, _ := gotVariables["trackingInfoInput"].(map[string]any)
	if tracking["company"] != "UPS" || tracking["number"] != "1Z123" {
		t.Fatalf("unexpected tracking input: %#v", tracking)
	}
}

func TestShopifyAdminClientNormalizes17TrackTrackingURL(t *testing.T) {
	var gotVariables map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Variables map[string]any `json:"variables"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		gotVariables = payload.Variables
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"fulfillmentTrackingInfoUpdate":{"fulfillment":{"id":"gid://shopify/Fulfillment/9","trackingInfo":[{"company":"UPS","number":"1Z123","url":"https://www.17track.net/zh-cn"}]},"userErrors":[]}}}`))
	}))
	defer server.Close()

	client := shopifyAdminClient{HTTPClient: server.Client(), BaseURL: server.URL}
	fulfillment, err := client.UpdateFulfillmentTracking(t.Context(), "demo.myshopify.com", "test-token", ShopifyFulfillmentTrackingUpdate{
		FulfillmentID: "gid://shopify/Fulfillment/9",
		Company:       "UPS",
		Number:        "1Z123",
		URL:           "https://www.17track.net/zh-cn",
	})
	if err != nil {
		t.Fatalf("UpdateFulfillmentTracking failed: %v", err)
	}
	trackingInput, _ := gotVariables["trackingInfoInput"].(map[string]any)
	if got := trackingInput["url"]; got != shopifyInternationalTrackingURL {
		t.Fatalf("tracking input URL = %#v, want %q", got, shopifyInternationalTrackingURL)
	}
	if got := fulfillment.TrackingInfo[0].URL; got != shopifyInternationalTrackingURL {
		t.Fatalf("returned tracking URL = %q, want %q", got, shopifyInternationalTrackingURL)
	}
}

func TestShopifyOrderMutationValidation(t *testing.T) {
	if _, err := normalizeShopifyOrderShippingAddressUpdate(ShopifyOrderShippingAddressUpdate{
		OrderID: "gid://shopify/Order/1",
		Address: ShopifyShippingAddressInput{Address1: "123 Main", City: "Austin", CountryCode: "USA"},
	}); err == nil {
		t.Fatal("expected invalid country code to be rejected")
	}
	if _, err := normalizeShopifyFulfillmentTrackingUpdate(ShopifyFulfillmentTrackingUpdate{
		FulfillmentID: "gid://shopify/Fulfillment/1", Number: "TRACK-1", URL: "javascript:alert(1)",
	}); err == nil {
		t.Fatal("expected unsafe tracking URL to be rejected")
	}
}

func TestShopifyOrderMutationAccessDoesNotRequireDedicatedPermission(t *testing.T) {
	store := NewMemoryStore()
	shop, err := store.CreateShop(t.Context(), Shop{DisplayName: "Assigned order mutation shop"})
	if err != nil {
		t.Fatalf("CreateShop failed: %v", err)
	}
	hash, err := hashPassword("password-123")
	if err != nil {
		t.Fatalf("hashPassword failed: %v", err)
	}
	user, err := store.CreateUser(t.Context(), User{
		Email:                 "assigned-order-editor@example.com",
		Role:                  UserRoleAgent,
		PasswordHash:          hash,
		PermissionsCustomized: true,
		Permissions:           []string{PermissionWorkbenchAccess},
	})
	if err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}
	if _, err := store.AssignUserToShop(t.Context(), shop.ID, user.ID); err != nil {
		t.Fatalf("AssignUserToShop failed: %v", err)
	}

	server := NewServer(store)
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPatch, "/api/v1/shops/"+shop.ID+"/shopify/orders/shipping-address", nil)
	if !server.requireShopifyOrderMutationAccess(response, request, user, shop.ID) {
		t.Fatalf("assigned workbench user was denied order mutation access: status=%d body=%s", response.Code, response.Body.String())
	}

	if err := store.UnassignUserFromShop(t.Context(), shop.ID, user.ID); err != nil {
		t.Fatalf("UnassignUserFromShop failed: %v", err)
	}
	deniedResponse := httptest.NewRecorder()
	deniedRequest := httptest.NewRequest(http.MethodPatch, "/api/v1/shops/"+shop.ID+"/shopify/orders/shipping-address", nil)
	if server.requireShopifyOrderMutationAccess(deniedResponse, deniedRequest, user, shop.ID) {
		t.Fatal("unassigned workbench user unexpectedly received order mutation access")
	}
	if deniedResponse.Code != http.StatusForbidden {
		t.Fatalf("unassigned user status = %d, want %d", deniedResponse.Code, http.StatusForbidden)
	}
}
