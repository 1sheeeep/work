package platform

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

func TestShopifyAdminClientEditsOrderLineQuantityAndCommits(t *testing.T) {
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
			_, _ = w.Write([]byte(orderLineStateJSON(2)))
		case 2:
			if !strings.Contains(payload.Query, "orderEditBegin") {
				t.Fatalf("unexpected begin operation: %s", payload.Query)
			}
			_, _ = w.Write([]byte(`{"data":{"orderEditBegin":{"calculatedOrder":{"id":"gid://shopify/CalculatedOrder/50","lineItems":{"nodes":[{"id":"gid://shopify/CalculatedLineItem/60","quantity":2,"variant":{"id":"gid://shopify/ProductVariant/40"}}],"pageInfo":{"hasNextPage":false}}},"userErrors":[]}}}`))
		case 3:
			if payload.Variables["quantity"] != float64(1) || payload.Variables["restock"] != true {
				t.Fatalf("unexpected quantity variables: %#v", payload.Variables)
			}
			_, _ = w.Write([]byte(`{"data":{"orderEditSetQuantity":{"calculatedLineItem":{"id":"gid://shopify/CalculatedLineItem/60","quantity":1,"variant":{"id":"gid://shopify/ProductVariant/40"}},"userErrors":[]}}}`))
		case 4:
			if payload.Variables["notifyCustomer"] != true {
				t.Fatalf("unexpected commit variables: %#v", payload.Variables)
			}
			_, _ = w.Write([]byte(`{"data":{"orderEditCommit":{"order":{"id":"gid://shopify/Order/10","totalPriceSet":{"shopMoney":{"amount":"49.95","currencyCode":"USD"}},"lineItems":{"nodes":[{"id":"gid://shopify/LineItem/30","currentQuantity":1,"variant":{"id":"gid://shopify/ProductVariant/40"}}],"pageInfo":{"hasNextPage":false}}},"userErrors":[]}}}`))
		default:
			t.Fatalf("unexpected GraphQL call %d", calls)
		}
	}))
	defer server.Close()

	client := shopifyAdminClient{HTTPClient: server.Client(), BaseURL: server.URL}
	result, err := client.UpdateOrderLineQuantity(
		t.Context(), "demo.myshopify.com", "test-token",
		connectorOrderEditQuantityRequest())
	if err != nil {
		t.Fatalf("UpdateOrderLineQuantity failed: %v", err)
	}
	if calls != 4 || result.RecoveredFromShopify || result.Quantity != 1 ||
		result.Total.Amount != "49.95" || result.Total.CurrencyCode != "USD" {
		t.Fatalf("unexpected quantity result: calls=%d result=%#v", calls, result)
	}
}

func TestShopifyAdminClientRecoversExactOrderLineQuantityWithoutMutation(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(orderLineStateJSON(1)))
	}))
	defer server.Close()

	client := shopifyAdminClient{HTTPClient: server.Client(), BaseURL: server.URL}
	result, err := client.UpdateOrderLineQuantity(
		t.Context(), "demo.myshopify.com", "test-token",
		connectorOrderEditQuantityRequest())
	if err != nil {
		t.Fatalf("UpdateOrderLineQuantity recovery failed: %v", err)
	}
	if calls != 1 || !result.RecoveredFromShopify || result.Quantity != 1 ||
		result.Total.Amount != "59.95" || result.Total.CurrencyCode != "USD" {
		t.Fatalf("unexpected recovery result: calls=%d result=%#v", calls, result)
	}
}

func TestShopifyOrderEditQuantityAdapterRequiresEveryScope(t *testing.T) {
	store := NewMemoryStore()
	shop, _ := store.CreateShop(t.Context(), Shop{
		DisplayName: "Order Edit Shop", Status: ShopStatusActive,
		Metadata: map[string]string{"shopifyDomain": "orders.myshopify.com"},
	})
	_, _ = store.SaveShopifyInstallation(t.Context(), ShopifyInstallation{
		ShopID: shop.ID, ShopDomain: "orders.myshopify.com", AccessToken: "shpat_owned",
		Scope: shopifyOrderReadScope + "," + shopifyOrderEditReadScope,
	})
	request := connectorOrderEditQuantityRequest()
	called := false
	adapter := newShopifyOrderEditQuantityAdapterWithUpdater(
		testShopifyConnectorBindingResolver{bindings: map[shopifyconnector.CanonicalShopIdentity]string{
			request.Identity: shop.ID,
		}},
		store,
		func(context.Context, string, string) string { return "shpat_owned" },
		func(context.Context, string, string, shopifyconnector.OrderEditQuantityRequest) (shopifyconnector.OrderEditQuantityResult, error) {
			called = true
			return shopifyconnector.OrderEditQuantityResult{}, nil
		},
	)
	_, err := adapter.UpdateOrderLineQuantity(t.Context(), request)
	var safeErr *shopifyconnector.ConnectionProbeError
	if !errors.As(err, &safeErr) || safeErr.Code != shopifyconnector.ErrorCodeForbidden ||
		called || strings.Contains(err.Error(), "shpat_owned") {
		t.Fatalf("missing write scope did not fail closed: called=%v err=%v", called, err)
	}
}

func connectorOrderEditQuantityRequest() shopifyconnector.OrderEditQuantityRequest {
	return shopifyconnector.OrderEditQuantityRequest{
		Identity: shopifyconnector.CanonicalShopIdentity{
			TenantID: "f6000000-0000-4000-8000-000000000001",
			ShopID:   "f6000000-0000-4000-8000-000000000002",
		},
		Context: shopifyconnector.RequestContext{
			CorrelationID: "order-edit-correlation-1",
			RequestID:     "order-edit-request-1",
		},
		OrderID: "gid://shopify/Order/10", OrderLineID: "gid://shopify/LineItem/30",
		VariantID: "gid://shopify/ProductVariant/40", ExpectedQuantity: 2,
		Quantity: 1, Restock: true, NotifyCustomer: true,
		IdempotencyKey: "web.order-edit-10",
	}
}

func orderLineStateJSON(quantity int) string {
	return `{"data":{"order":{"id":"gid://shopify/Order/10","totalPriceSet":{"shopMoney":{"amount":"59.95","currencyCode":"USD"}},"lineItems":{"nodes":[{"id":"gid://shopify/LineItem/30","currentQuantity":` +
		fmt.Sprint(quantity) + `,"variant":{"id":"gid://shopify/ProductVariant/40"}}],"pageInfo":{"hasNextPage":false}}}}}`
}
