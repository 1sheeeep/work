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

func TestShopifyAdminClientAddsFixedOrderLineDiscountAndCommits(t *testing.T) {
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
			_, _ = w.Write([]byte(orderLineDiscountStateJSON(false)))
		case 2:
			_, _ = w.Write([]byte(`{"data":{"orderEditBegin":{"calculatedOrder":{"id":"gid://shopify/CalculatedOrder/50","lineItems":{"nodes":[{"id":"gid://shopify/CalculatedLineItem/60","quantity":2,"title":"Product","originalUnitPriceSet":{"shopMoney":{"amount":"25.00","currencyCode":"USD"}},"totalDiscountSet":{"shopMoney":{"amount":"0.00","currencyCode":"USD"}},"variant":{"id":"gid://shopify/ProductVariant/41"}}],"pageInfo":{"hasNextPage":false}}},"userErrors":[]}}}`))
		case 3:
			discount, ok := payload.Variables["discount"].(map[string]any)
			fixed, fixedOK := discount["fixedValue"].(map[string]any)
			if !strings.Contains(payload.Query, "orderEditAddLineItemDiscount") ||
				payload.Variables["lineItemId"] != "gid://shopify/CalculatedLineItem/60" ||
				!ok || !fixedOK || discount["description"] != "VIP adjustment" ||
				fixed["amount"] != "5.00" || fixed["currencyCode"] != "USD" {
				t.Fatalf("unexpected discount request: %#v", payload)
			}
			_, _ = w.Write([]byte(`{"data":{"orderEditAddLineItemDiscount":{"calculatedLineItem":{"id":"gid://shopify/CalculatedLineItem/60","quantity":2,"variant":{"id":"gid://shopify/ProductVariant/41"}},"addedDiscountStagedChange":{"id":"gid://shopify/OrderStagedChangeAddLineItemDiscount/70","description":"VIP adjustment","value":{"__typename":"MoneyV2","amount":"5.00","currencyCode":"USD"}},"userErrors":[]}}}`))
		case 4:
			if payload.Variables["notifyCustomer"] != true ||
				payload.Variables["staffNote"] != "Line discount applied from XZ ERP" {
				t.Fatalf("unexpected commit variables: %#v", payload.Variables)
			}
			_, _ = w.Write([]byte(orderLineDiscountCommitJSON()))
		default:
			t.Fatalf("unexpected GraphQL call %d", calls)
		}
	}))
	defer server.Close()

	client := shopifyAdminClient{HTTPClient: server.Client(), BaseURL: server.URL}
	result, err := client.AddOrderLineDiscount(
		t.Context(), "demo.myshopify.com", "test-token",
		connectorOrderLineDiscountRequest(false))
	if err != nil {
		t.Fatalf("AddOrderLineDiscount failed: %v", err)
	}
	if calls != 4 || result.RecoveredFromShopify ||
		result.DiscountTotal.Amount != "5.00" || result.Total.Amount != "45.00" ||
		result.FixedValue == nil || result.FixedValue.Amount != "5.00" {
		t.Fatalf("unexpected discount result: calls=%d result=%#v", calls, result)
	}
}

func TestShopifyAdminClientRecoversOnlyExactOrderLineDiscount(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(orderLineDiscountStateJSON(true)))
	}))
	defer server.Close()

	client := shopifyAdminClient{HTTPClient: server.Client(), BaseURL: server.URL}
	result, err := client.AddOrderLineDiscount(
		t.Context(), "demo.myshopify.com", "test-token",
		connectorOrderLineDiscountRequest(true))
	if err != nil || calls != 1 || !result.RecoveredFromShopify {
		t.Fatalf("discount recovery failed: calls=%d result=%#v err=%v", calls, result, err)
	}

	_, err = client.AddOrderLineDiscount(
		t.Context(), "demo.myshopify.com", "test-token",
		connectorOrderLineDiscountRequest(false))
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("unexpected existing discount must fail closed: %v", err)
	}
}

func TestShopifyOrderLineDiscountAdapterRequiresEveryScope(t *testing.T) {
	store := NewMemoryStore()
	shop, _ := store.CreateShop(t.Context(), Shop{
		DisplayName: "Discount Shop", Status: ShopStatusActive,
		Metadata: map[string]string{"shopifyDomain": "orders.myshopify.com"},
	})
	_, _ = store.SaveShopifyInstallation(t.Context(), ShopifyInstallation{
		ShopID: shop.ID, ShopDomain: "orders.myshopify.com", AccessToken: "shpat_owned",
		Scope: shopifyOrderReadScope + "," + shopifyOrderEditReadScope,
	})
	request := connectorOrderLineDiscountRequest(false)
	called := false
	adapter := newShopifyOrderLineDiscountAdapterWithWriter(
		testShopifyConnectorBindingResolver{bindings: map[shopifyconnector.CanonicalShopIdentity]string{
			request.Identity: shop.ID,
		}}, store,
		func(context.Context, string, string) string { return "shpat_owned" },
		func(context.Context, string, string, shopifyconnector.OrderLineDiscountRequest) (shopifyconnector.OrderLineDiscountResult, error) {
			called = true
			return shopifyconnector.OrderLineDiscountResult{}, nil
		},
	)
	_, err := adapter.AddOrderLineDiscount(t.Context(), request)
	var safeErr *shopifyconnector.ConnectionProbeError
	if !errors.As(err, &safeErr) || safeErr.Code != shopifyconnector.ErrorCodeForbidden ||
		called || strings.Contains(err.Error(), "shpat_owned") {
		t.Fatalf("missing write scope did not fail closed: called=%v err=%v", called, err)
	}
}

func connectorOrderLineDiscountRequest(recoverExisting bool) shopifyconnector.OrderLineDiscountRequest {
	fixed := shopifyconnector.CatalogMoney{Amount: "5.00", CurrencyCode: "USD"}
	return shopifyconnector.OrderLineDiscountRequest{
		Identity: shopifyconnector.CanonicalShopIdentity{
			TenantID: "f6000000-0000-4000-8000-000000000001",
			ShopID:   "f6000000-0000-4000-8000-000000000002",
		},
		Context: shopifyconnector.RequestContext{
			CorrelationID: "order-discount-correlation-1",
			RequestID:     "order-discount-request-1",
		},
		OrderID: "gid://shopify/Order/10", OrderLineID: "gid://shopify/LineItem/30",
		VariantID: "gid://shopify/ProductVariant/41", ExpectedQuantity: 2,
		ExpectedDiscountTotal: shopifyconnector.CatalogMoney{Amount: "0.00", CurrencyCode: "USD"},
		Description:           "VIP adjustment", DiscountType: shopifyconnector.OrderLineDiscountTypeFixed,
		FixedValue: &fixed, NotifyCustomer: true, RecoverExisting: recoverExisting,
		IdempotencyKey: "web.order-discount-10",
	}
}

func orderLineDiscountStateJSON(withDiscount bool) string {
	discountTotal := "0.00"
	allocations := "[]"
	total := "50.00"
	if withDiscount {
		discountTotal = "5.00"
		total = "45.00"
		allocations = `[{"allocatedAmountSet":{"shopMoney":{"amount":"5.00","currencyCode":"USD"}},"discountApplication":{"__typename":"ManualDiscountApplication","title":"VIP adjustment","description":"VIP adjustment","value":{"__typename":"MoneyV2","amount":"5.00","currencyCode":"USD"}}}]`
	}
	return `{"data":{"order":{"id":"gid://shopify/Order/10","totalPriceSet":{"shopMoney":{"amount":"` + total + `","currencyCode":"USD"}},"lineItems":{"nodes":[{"id":"gid://shopify/LineItem/30","currentQuantity":2,"sku":"SKU-1","name":"Product","title":"Product","originalUnitPriceSet":{"shopMoney":{"amount":"25.00","currencyCode":"USD"}},"totalDiscountSet":{"shopMoney":{"amount":"` + discountTotal + `","currencyCode":"USD"}},"discountAllocations":` + allocations + `,"variant":{"id":"gid://shopify/ProductVariant/41"}}],"pageInfo":{"hasNextPage":false}}}}}`
}

func orderLineDiscountCommitJSON() string {
	return `{"data":{"orderEditCommit":{"order":{"id":"gid://shopify/Order/10","totalPriceSet":{"shopMoney":{"amount":"45.00","currencyCode":"USD"}},"lineItems":{"nodes":[{"id":"gid://shopify/LineItem/30","currentQuantity":2,"sku":"SKU-1","name":"Product","title":"Product","originalUnitPriceSet":{"shopMoney":{"amount":"25.00","currencyCode":"USD"}},"totalDiscountSet":{"shopMoney":{"amount":"5.00","currencyCode":"USD"}},"discountAllocations":[{"allocatedAmountSet":{"shopMoney":{"amount":"5.00","currencyCode":"USD"}},"discountApplication":{"__typename":"ManualDiscountApplication","title":"VIP adjustment","description":"VIP adjustment","value":{"__typename":"MoneyV2","amount":"5.00","currencyCode":"USD"}}}],"variant":{"id":"gid://shopify/ProductVariant/41"}}],"pageInfo":{"hasNextPage":false}}},"userErrors":[]}}}`
}
