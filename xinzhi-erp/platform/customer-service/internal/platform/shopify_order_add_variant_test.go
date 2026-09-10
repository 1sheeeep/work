package platform

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

func TestShopifyAdminClientAddsOrderVariantAndCommits(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var payload struct {
			Query     string         `json:"query"`
			Variables map[string]any `json:"variables"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		switch calls {
		case 1:
			_, _ = w.Write([]byte(orderAddVariantStateJSON(false)))
		case 2:
			if !strings.Contains(payload.Query, "orderEditBegin") {
				t.Fatalf("unexpected begin operation: %s", payload.Query)
			}
			_, _ = w.Write([]byte(`{"data":{"orderEditBegin":{"calculatedOrder":{"id":"gid://shopify/CalculatedOrder/50","lineItems":{"nodes":[{"id":"gid://shopify/CalculatedLineItem/60","quantity":1,"variant":{"id":"gid://shopify/ProductVariant/41"}}],"pageInfo":{"hasNextPage":false}}},"userErrors":[]}}}`))
		case 3:
			if !strings.Contains(payload.Query, "orderEditAddVariant") ||
				payload.Variables["variantId"] != "gid://shopify/ProductVariant/40" ||
				payload.Variables["quantity"] != float64(2) {
				t.Fatalf("unexpected add variant request: %#v", payload)
			}
			_, _ = w.Write([]byte(`{"data":{"orderEditAddVariant":{"calculatedLineItem":{"id":"gid://shopify/CalculatedLineItem/61","quantity":2,"sku":"ERP-RED","title":"Travel Bag","variantTitle":"Red","originalUnitPriceSet":{"shopMoney":{"amount":"12.50","currencyCode":"USD"}},"variant":{"id":"gid://shopify/ProductVariant/40"}},"userErrors":[]}}}`))
		case 4:
			if payload.Variables["notifyCustomer"] != true {
				t.Fatalf("unexpected commit variables: %#v", payload.Variables)
			}
			_, _ = w.Write([]byte(orderAddVariantCommitJSON()))
		default:
			t.Fatalf("unexpected GraphQL call %d", calls)
		}
	}))
	defer server.Close()

	client := shopifyAdminClient{HTTPClient: server.Client(), BaseURL: server.URL}
	result, err := client.AddOrderVariant(
		t.Context(), "demo.myshopify.com", "test-token",
		connectorOrderAddVariantRequest(false))
	if err != nil {
		t.Fatalf("AddOrderVariant failed: %v", err)
	}
	if calls != 4 || result.RecoveredFromShopify ||
		result.OrderLineID != "gid://shopify/LineItem/31" ||
		result.Quantity != 2 || result.SKU != "ERP-RED" ||
		result.Title != "Travel Bag - Red" ||
		result.UnitPrice.Amount != "12.50" || result.Total.Amount != "84.95" {
		t.Fatalf("unexpected add variant result: calls=%d result=%#v", calls, result)
	}
}

func TestShopifyAdminClientRecoversAddedVariantOnlyWhenExplicitlyAllowed(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(orderAddVariantStateJSON(true)))
	}))
	defer server.Close()

	client := shopifyAdminClient{HTTPClient: server.Client(), BaseURL: server.URL}
	result, err := client.AddOrderVariant(
		t.Context(), "demo.myshopify.com", "test-token",
		connectorOrderAddVariantRequest(true))
	if err != nil {
		t.Fatalf("AddOrderVariant recovery failed: %v", err)
	}
	if calls != 1 || !result.RecoveredFromShopify ||
		result.OrderLineID != "gid://shopify/LineItem/31" || result.Quantity != 2 {
		t.Fatalf("unexpected recovery result: calls=%d result=%#v", calls, result)
	}

	_, err = client.AddOrderVariant(
		t.Context(), "demo.myshopify.com", "test-token",
		connectorOrderAddVariantRequest(false))
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("non-recovery duplicate must fail closed: %v", err)
	}
}

func TestShopifyOrderAddVariantAdapterRequiresEveryScope(t *testing.T) {
	store := NewMemoryStore()
	shop, _ := store.CreateShop(t.Context(), Shop{
		DisplayName: "Order Add Shop", Status: ShopStatusActive,
		Metadata: map[string]string{"shopifyDomain": "orders.myshopify.com"},
	})
	_, _ = store.SaveShopifyInstallation(t.Context(), ShopifyInstallation{
		ShopID: shop.ID, ShopDomain: "orders.myshopify.com", AccessToken: "shpat_owned",
		Scope: shopifyOrderReadScope + "," + shopifyOrderEditReadScope,
	})
	request := connectorOrderAddVariantRequest(false)
	called := false
	adapter := newShopifyOrderAddVariantAdapterWithUpdater(
		testShopifyConnectorBindingResolver{bindings: map[shopifyconnector.CanonicalShopIdentity]string{
			request.Identity: shop.ID,
		}},
		store,
		func(context.Context, string, string) string { return "shpat_owned" },
		func(context.Context, string, string, shopifyconnector.OrderAddVariantRequest) (shopifyconnector.OrderAddVariantResult, error) {
			called = true
			return shopifyconnector.OrderAddVariantResult{}, nil
		},
	)
	_, err := adapter.AddOrderVariant(t.Context(), request)
	var safeErr *shopifyconnector.ConnectionProbeError
	if !errors.As(err, &safeErr) || safeErr.Code != shopifyconnector.ErrorCodeForbidden ||
		called || strings.Contains(err.Error(), "shpat_owned") {
		t.Fatalf("missing write scope did not fail closed: called=%v err=%v", called, err)
	}
}

func connectorOrderAddVariantRequest(recoverExisting bool) shopifyconnector.OrderAddVariantRequest {
	return shopifyconnector.OrderAddVariantRequest{
		Identity: shopifyconnector.CanonicalShopIdentity{
			TenantID: "f6000000-0000-4000-8000-000000000001",
			ShopID:   "f6000000-0000-4000-8000-000000000002",
		},
		Context: shopifyconnector.RequestContext{
			CorrelationID: "order-add-correlation-1",
			RequestID:     "order-add-request-1",
		},
		OrderID: "gid://shopify/Order/10", VariantID: "gid://shopify/ProductVariant/40",
		Quantity: 2, NotifyCustomer: true, RecoverExisting: recoverExisting,
		IdempotencyKey: "web.order-add-10",
	}
}

func orderAddVariantStateJSON(withVariant bool) string {
	line := `{"id":"gid://shopify/LineItem/30","currentQuantity":1,"sku":"OTHER","name":"Other","title":"Other","originalUnitPriceSet":{"shopMoney":{"amount":"59.95","currencyCode":"USD"}},"variant":{"id":"gid://shopify/ProductVariant/41"}}`
	if withVariant {
		line += `,{"id":"gid://shopify/LineItem/31","currentQuantity":2,"sku":"ERP-RED","name":"Travel Bag - Red","title":"Travel Bag","variantTitle":"Red","originalUnitPriceSet":{"shopMoney":{"amount":"12.50","currencyCode":"USD"}},"variant":{"id":"gid://shopify/ProductVariant/40"}}`
	}
	return `{"data":{"order":{"id":"gid://shopify/Order/10","totalPriceSet":{"shopMoney":{"amount":"84.95","currencyCode":"USD"}},"lineItems":{"nodes":[` + line + `],"pageInfo":{"hasNextPage":false}}}}}`
}

func orderAddVariantCommitJSON() string {
	return `{"data":{"orderEditCommit":{"order":{"id":"gid://shopify/Order/10","totalPriceSet":{"shopMoney":{"amount":"84.95","currencyCode":"USD"}},"lineItems":{"nodes":[{"id":"gid://shopify/LineItem/30","currentQuantity":1,"sku":"OTHER","name":"Other","title":"Other","originalUnitPriceSet":{"shopMoney":{"amount":"59.95","currencyCode":"USD"}},"variant":{"id":"gid://shopify/ProductVariant/41"}},{"id":"gid://shopify/LineItem/31","currentQuantity":2,"sku":"ERP-RED","name":"Travel Bag - Red","title":"Travel Bag","variantTitle":"Red","originalUnitPriceSet":{"shopMoney":{"amount":"12.50","currencyCode":"USD"}},"variant":{"id":"gid://shopify/ProductVariant/40"}}],"pageInfo":{"hasNextPage":false}}},"userErrors":[]}}}`
}
