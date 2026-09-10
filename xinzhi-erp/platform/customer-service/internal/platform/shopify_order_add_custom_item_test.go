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

func TestShopifyAdminClientAddsCustomOrderItemAndCommits(t *testing.T) {
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
			_, _ = w.Write([]byte(orderAddCustomItemStateJSON(false)))
		case 2:
			if !strings.Contains(payload.Query, "orderEditBegin") {
				t.Fatalf("unexpected begin operation: %s", payload.Query)
			}
			_, _ = w.Write([]byte(`{"data":{"orderEditBegin":{"calculatedOrder":{"id":"gid://shopify/CalculatedOrder/50","lineItems":{"nodes":[{"id":"gid://shopify/CalculatedLineItem/60","quantity":1,"title":"Other","requiresShipping":true,"taxable":true,"originalUnitPriceSet":{"shopMoney":{"amount":"59.95","currencyCode":"USD"}},"variant":{"id":"gid://shopify/ProductVariant/41"}}],"pageInfo":{"hasNextPage":false}}},"userErrors":[]}}}`))
		case 3:
			price, ok := payload.Variables["price"].(map[string]any)
			if !strings.Contains(payload.Query, "orderEditAddCustomItem") ||
				payload.Variables["title"] != "Gift wrapping" ||
				payload.Variables["quantity"] != float64(2) ||
				payload.Variables["requiresShipping"] != false ||
				payload.Variables["taxable"] != true || !ok ||
				price["amount"] != "12.50" || price["currencyCode"] != "USD" {
				t.Fatalf("unexpected add custom item request: %#v", payload)
			}
			_, _ = w.Write([]byte(`{"data":{"orderEditAddCustomItem":{"calculatedLineItem":{"id":"gid://shopify/CalculatedLineItem/61","quantity":2,"title":"Gift wrapping","requiresShipping":false,"taxable":true,"originalUnitPriceSet":{"shopMoney":{"amount":"12.50","currencyCode":"USD"}},"variant":null},"userErrors":[]}}}`))
		case 4:
			if payload.Variables["notifyCustomer"] != true ||
				payload.Variables["staffNote"] != "Added custom item from XZ ERP" {
				t.Fatalf("unexpected commit variables: %#v", payload.Variables)
			}
			_, _ = w.Write([]byte(orderAddCustomItemCommitJSON()))
		default:
			t.Fatalf("unexpected GraphQL call %d", calls)
		}
	}))
	defer server.Close()

	client := shopifyAdminClient{HTTPClient: server.Client(), BaseURL: server.URL}
	result, err := client.AddOrderCustomItem(
		t.Context(), "demo.myshopify.com", "test-token",
		connectorOrderAddCustomItemRequest(false))
	if err != nil {
		t.Fatalf("AddOrderCustomItem failed: %v", err)
	}
	if calls != 4 || result.RecoveredFromShopify ||
		result.OrderLineID != "gid://shopify/LineItem/31" ||
		result.Quantity != 2 || result.Title != "Gift wrapping" ||
		result.UnitPrice.Amount != "12.50" || result.Total.Amount != "84.95" {
		t.Fatalf("unexpected add custom item result: calls=%d result=%#v", calls, result)
	}
}

func TestShopifyAdminClientRecoversCustomOrderItemOnlyWhenExplicitlyAllowed(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(orderAddCustomItemStateJSON(true)))
	}))
	defer server.Close()

	client := shopifyAdminClient{HTTPClient: server.Client(), BaseURL: server.URL}
	result, err := client.AddOrderCustomItem(
		t.Context(), "demo.myshopify.com", "test-token",
		connectorOrderAddCustomItemRequest(true))
	if err != nil {
		t.Fatalf("AddOrderCustomItem recovery failed: %v", err)
	}
	if calls != 1 || !result.RecoveredFromShopify ||
		result.OrderLineID != "gid://shopify/LineItem/31" {
		t.Fatalf("unexpected recovery result: calls=%d result=%#v", calls, result)
	}

	_, err = client.AddOrderCustomItem(
		t.Context(), "demo.myshopify.com", "test-token",
		connectorOrderAddCustomItemRequest(false))
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("non-recovery duplicate must fail closed: %v", err)
	}
}

func TestShopifyOrderAddCustomItemAdapterRequiresEveryScope(t *testing.T) {
	store := NewMemoryStore()
	shop, _ := store.CreateShop(t.Context(), Shop{
		DisplayName: "Custom Item Shop", Status: ShopStatusActive,
		Metadata: map[string]string{"shopifyDomain": "orders.myshopify.com"},
	})
	_, _ = store.SaveShopifyInstallation(t.Context(), ShopifyInstallation{
		ShopID: shop.ID, ShopDomain: "orders.myshopify.com", AccessToken: "shpat_owned",
		Scope: shopifyOrderReadScope + "," + shopifyOrderEditReadScope,
	})
	request := connectorOrderAddCustomItemRequest(false)
	called := false
	adapter := newShopifyOrderAddCustomItemAdapterWithUpdater(
		testShopifyConnectorBindingResolver{bindings: map[shopifyconnector.CanonicalShopIdentity]string{
			request.Identity: shop.ID,
		}},
		store,
		func(context.Context, string, string) string { return "shpat_owned" },
		func(context.Context, string, string, shopifyconnector.OrderAddCustomItemRequest) (shopifyconnector.OrderAddCustomItemResult, error) {
			called = true
			return shopifyconnector.OrderAddCustomItemResult{}, nil
		},
	)
	_, err := adapter.AddOrderCustomItem(t.Context(), request)
	var safeErr *shopifyconnector.ConnectionProbeError
	if !errors.As(err, &safeErr) || safeErr.Code != shopifyconnector.ErrorCodeForbidden ||
		called || strings.Contains(err.Error(), "shpat_owned") {
		t.Fatalf("missing write scope did not fail closed: called=%v err=%v", called, err)
	}
}

func connectorOrderAddCustomItemRequest(recoverExisting bool) shopifyconnector.OrderAddCustomItemRequest {
	return shopifyconnector.OrderAddCustomItemRequest{
		Identity: shopifyconnector.CanonicalShopIdentity{
			TenantID: "f6000000-0000-4000-8000-000000000001",
			ShopID:   "f6000000-0000-4000-8000-000000000002",
		},
		Context: shopifyconnector.RequestContext{
			CorrelationID: "order-custom-correlation-1",
			RequestID:     "order-custom-request-1",
		},
		OrderID: "gid://shopify/Order/10", Title: "Gift wrapping",
		UnitPrice: shopifyconnector.CatalogMoney{Amount: "12.50", CurrencyCode: "USD"},
		Quantity:  2, Taxable: true, NotifyCustomer: true,
		RecoverExisting: recoverExisting,
		IdempotencyKey:  "web.order-custom-10",
	}
}

func orderAddCustomItemStateJSON(withCustomItem bool) string {
	line := `{"id":"gid://shopify/LineItem/30","currentQuantity":1,"sku":"OTHER","name":"Other","title":"Other","requiresShipping":true,"taxable":true,"originalUnitPriceSet":{"shopMoney":{"amount":"59.95","currencyCode":"USD"}},"variant":{"id":"gid://shopify/ProductVariant/41"}}`
	if withCustomItem {
		line += `,{"id":"gid://shopify/LineItem/31","currentQuantity":2,"sku":"","name":"Gift wrapping","title":"Gift wrapping","requiresShipping":false,"taxable":true,"originalUnitPriceSet":{"shopMoney":{"amount":"12.50","currencyCode":"USD"}},"variant":null}`
	}
	return `{"data":{"order":{"id":"gid://shopify/Order/10","totalPriceSet":{"shopMoney":{"amount":"84.95","currencyCode":"USD"}},"lineItems":{"nodes":[` + line + `],"pageInfo":{"hasNextPage":false}}}}}`
}

func orderAddCustomItemCommitJSON() string {
	return `{"data":{"orderEditCommit":{"order":{"id":"gid://shopify/Order/10","totalPriceSet":{"shopMoney":{"amount":"84.95","currencyCode":"USD"}},"lineItems":{"nodes":[{"id":"gid://shopify/LineItem/30","currentQuantity":1,"sku":"OTHER","name":"Other","title":"Other","requiresShipping":true,"taxable":true,"originalUnitPriceSet":{"shopMoney":{"amount":"59.95","currencyCode":"USD"}},"variant":{"id":"gid://shopify/ProductVariant/41"}},{"id":"gid://shopify/LineItem/31","currentQuantity":2,"sku":"","name":"Gift wrapping","title":"Gift wrapping","requiresShipping":false,"taxable":true,"originalUnitPriceSet":{"shopMoney":{"amount":"12.50","currencyCode":"USD"}},"variant":null}],"pageInfo":{"hasNextPage":false}}},"userErrors":[]}}}`
}
