package adminapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

func TestClientInventoryWriteUsesConnectorCredentialAndPreservesIdempotency(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("X-Shopify-Access-Token") != "shpat_connector_write" {
			t.Fatal("connector credential missing")
		}
		var payload struct {
			Query     string         `json:"query"`
			Variables map[string]any `json:"variables"`
		}
		_ = json.NewDecoder(r.Body).Decode(&payload)
		switch {
		case strings.Contains(payload.Query, "XZERPInventorySet"):
			if payload.Variables["idempotencyKey"] != "inventory-command-1" {
				t.Fatalf("inventory idempotency key missing: %#v", payload.Variables)
			}
			_, _ = w.Write([]byte(`{"data":{"inventorySetQuantities":{"inventoryAdjustmentGroup":{"createdAt":"2026-08-02T00:00:00Z","changes":[{"name":"available","delta":1,"quantityAfterChange":4}]},"userErrors":[]}}}`))
		default:
			t.Fatalf("unexpected operation: %s", payload.Query)
		}
	}))
	defer server.Close()
	client, err := newClient("2026-07", server.URL, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	client.now = func() time.Time { return time.Date(2026, 8, 2, 0, 0, 0, 0, time.UTC) }
	if _, err := client.SetInventoryAvailable(t.Context(), "writes.myshopify.com", "shpat_connector_write", adminInventoryRequest()); err != nil {
		t.Fatalf("inventory write: %v", err)
	}
	if calls != 1 {
		t.Fatalf("unexpected provider calls: %d", calls)
	}
}

func TestClientInventoryWriteRejectsMissingAdjustmentShape(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"data":{"inventorySetQuantities":{"userErrors":[]}}}`))
	}))
	defer server.Close()
	client, _ := newClient("2026-07", server.URL, server.Client())
	if _, err := client.SetInventoryAvailable(t.Context(), "writes.myshopify.com", "token", adminInventoryRequest()); err == nil {
		t.Fatal("missing adjustment shape was accepted")
	}
}

func TestClientUpdatesOrderShippingAddressWithStrictResponseValidation(t *testing.T) {
	request := adminOrderAddressRequest()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Shopify-Access-Token") != "shpat_connector_write" {
			t.Fatal("connector credential missing")
		}
		var payload struct {
			Query     string         `json:"query"`
			Variables map[string]any `json:"variables"`
		}
		if json.NewDecoder(r.Body).Decode(&payload) != nil || !strings.Contains(payload.Query, "XZERPOrderShippingAddressUpdate") {
			t.Fatal("unexpected order address request")
		}
		input := payload.Variables["input"].(map[string]any)
		if input["id"] != request.OrderID || input["shippingAddress"].(map[string]any)["countryCode"] != "CA" {
			t.Fatalf("request correlation was lost: %#v", payload.Variables)
		}
		_, _ = w.Write([]byte(`{"data":{"orderUpdate":{"order":{"id":"gid://shopify/Order/123","updatedAt":"2026-08-02T01:02:03Z","shippingAddress":{"name":"Ada Lovelace","firstName":"Ada","lastName":"Lovelace","company":"","address1":"1 Main","address2":"","city":"Toronto","province":"Ontario","provinceCode":"ON","country":"Canada","countryCode":"CA","zip":"A1A1A1","phone":"","formatted":["1 Main","Toronto ON A1A1A1"]}},"userErrors":[]}}}`))
	}))
	defer server.Close()
	client, _ := newClient("2026-07", server.URL, server.Client())
	result, err := client.UpdateOrderShippingAddress(t.Context(), "writes.myshopify.com", "shpat_connector_write", request)
	if err != nil || result.OrderID != request.OrderID || result.Address.City != "Toronto" || result.UpdatedAt.Format(time.RFC3339) != "2026-08-02T01:02:03Z" {
		t.Fatalf("unexpected address result: %#v err=%v", result, err)
	}
}

func TestClientOrderShippingAddressFailsClosedOnProviderContradictions(t *testing.T) {
	validOrder := `{"id":"gid://shopify/Order/123","updatedAt":"2026-08-02T01:02:03Z","shippingAddress":{"name":"Ada Lovelace","firstName":"Ada","lastName":"Lovelace","company":"","address1":"1 Main","address2":"","city":"Toronto","province":"Ontario","provinceCode":"ON","country":"Canada","countryCode":"CA","zip":"A1A1A1","phone":"","formatted":[]}}`
	for _, test := range []struct {
		name        string
		payload     string
		wantInvalid bool
	}{
		{"provider rejection", `{"data":{"orderUpdate":{"order":null,"userErrors":[{"field":["input"],"message":"private provider detail"}]}}}`, true},
		{"contradictory success", `{"data":{"orderUpdate":{"order":` + validOrder + `,"userErrors":[{"field":["input"],"message":"contradiction"}]}}}`, false},
		{"mismatched address", `{"data":{"orderUpdate":{"order":{"id":"gid://shopify/Order/123","updatedAt":"2026-08-02T01:02:03Z","shippingAddress":{"firstName":"Ada","lastName":"Lovelace","address1":"1 Main","city":"Ottawa","provinceCode":"ON","countryCode":"CA","zip":"A1A1A1","formatted":[]}},"userErrors":[]}}}`, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(test.payload)) }))
			defer server.Close()
			client, _ := newClient("2026-07", server.URL, server.Client())
			_, err := client.UpdateOrderShippingAddress(t.Context(), "writes.myshopify.com", "token", adminOrderAddressRequest())
			var safeErr *shopifyconnector.ConnectionProbeError
			isInvalid := errors.As(err, &safeErr) && safeErr.Code == shopifyconnector.ErrorCodeInvalidRequest
			if err == nil || isInvalid != test.wantInvalid || strings.Contains(err.Error(), "private provider detail") {
				t.Fatalf("unexpected error semantics: %#v %v", safeErr, err)
			}
		})
	}
}

func adminInventoryRequest() shopifyconnector.InventorySetRequest {
	return shopifyconnector.InventorySetRequest{
		Identity:        shopifyconnector.CanonicalShopIdentity{TenantID: productTestTenant, ShopID: productTestShop},
		Context:         shopifyconnector.RequestContext{CorrelationID: "write-provider", RequestID: "write-request"},
		InventoryItemID: "gid://shopify/InventoryItem/1", LocationID: "gid://shopify/Location/2",
		ExpectedAvailable: 3, TargetAvailable: 4, IdempotencyKey: "inventory-command-1",
		ReferenceDocumentURI: "xz-erp://inventory-publications/5e267b48-1b17-4cba-af71-8d9e1226f517",
	}
}

func adminOrderAddressRequest() shopifyconnector.OrderShippingAddressUpdateRequest {
	return shopifyconnector.OrderShippingAddressUpdateRequest{
		Identity: shopifyconnector.CanonicalShopIdentity{TenantID: productTestTenant, ShopID: productTestShop},
		Context:  shopifyconnector.RequestContext{CorrelationID: "address-provider", RequestID: "address-request"},
		OrderID:  "gid://shopify/Order/123", IdempotencyKey: "address-command-1",
		Address: shopifyconnector.CatalogMailingAddress{FirstName: "Ada", LastName: "Lovelace", Address1: "1 Main", City: "Toronto", ProvinceCode: "ON", CountryCode: "CA", Zip: "A1A1A1"},
	}
}
