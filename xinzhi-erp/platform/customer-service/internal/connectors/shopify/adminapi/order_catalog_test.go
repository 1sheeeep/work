package adminapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

func TestClientFetchOrderCatalogPaginatesAllLineItemsReadOnly(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != http.MethodPost || r.Header.Get("X-Shopify-Access-Token") != "shpat_connector_order" {
			t.Fatalf("unexpected provider request method=%s token=%q", r.Method, r.Header.Get("X-Shopify-Access-Token"))
		}
		var payload struct {
			Query     string         `json:"query"`
			Variables map[string]any `json:"variables"`
		}
		if json.NewDecoder(r.Body).Decode(&payload) != nil || strings.Contains(strings.ToLower(payload.Query), "mutation") {
			t.Fatalf("invalid or non-read-only order operation: %#v", payload)
		}
		switch calls {
		case 1:
			if !strings.Contains(payload.Query, "query XZERPOrderCatalogPage") ||
				payload.Variables["first"] != float64(25) || payload.Variables["after"] != "orders==" {
				t.Fatalf("unexpected order page request: %#v", payload)
			}
			for _, forbidden := range []string{"customer {", "defaultEmailAddress", "defaultPhoneNumber", "amountSpent"} {
				if strings.Contains(payload.Query, forbidden) {
					t.Fatalf("order query requested read_customers-only field %q", forbidden)
				}
			}
			_, _ = w.Write([]byte(validOrderPageJSON(true, "line-100")))
		case 2:
			if !strings.Contains(payload.Query, "query XZERPOrderLineItemPage") ||
				payload.Variables["id"] != "gid://shopify/Order/100" || payload.Variables["after"] != "line-100" {
				t.Fatalf("unexpected order line page request: %#v", payload)
			}
			_, _ = w.Write([]byte(validOrderLinePageJSON(false, "line-101", "2")))
		default:
			t.Fatalf("unexpected provider request %d", calls)
		}
	}))
	defer server.Close()
	client, err := newClient("2026-07", server.URL, server.Client())
	if err != nil {
		t.Fatalf("newClient failed: %v", err)
	}
	request := orderRequest("provider-order")
	request.Limit = 25
	request.Cursor = "orders=="

	page, err := client.FetchOrderCatalogPage(t.Context(), "orders.myshopify.com", "shpat_connector_order", request)
	if err != nil {
		t.Fatalf("FetchOrderCatalogPage failed: %v", err)
	}
	if calls != 2 || len(page.Orders) != 1 || len(page.Orders[0].LineItems) != 2 ||
		page.Orders[0].LineItems[1].ID != "gid://shopify/LineItem/2" ||
		page.Orders[0].Email != "buyer@example.com" || page.Orders[0].Customer.Email != "buyer@example.com" ||
		page.Orders[0].Customer.DisplayName != "Test Buyer" || page.Orders[0].Customer.Phone != "+12125550123" {
		t.Fatalf("line item pages were not completely merged: calls=%d page=%#v", calls, page)
	}
}

func TestClientRejectsIncompleteOrderLinePagination(t *testing.T) {
	tests := map[string]func(int) string{
		"missing cursor": func(_ int) string { return validOrderPageJSON(true, "") },
		"repeated cursor": func(call int) string {
			if call == 1 {
				return validOrderPageJSON(true, "loop==")
			}
			return validOrderLinePageJSON(true, "loop==", "2")
		},
		"missing parent": func(call int) string {
			if call == 1 {
				return validOrderPageJSON(true, "next==")
			}
			return `{"data":{"order":null}}`
		},
	}
	for name, responseFor := range tests {
		t.Run(name, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				calls++
				_, _ = w.Write([]byte(responseFor(calls)))
			}))
			defer server.Close()
			client, _ := newClient("2026-07", server.URL, server.Client())
			_, err := client.FetchOrderCatalogPage(t.Context(), "orders.myshopify.com", "shpat_connector_order", orderRequest("lines-"+strings.ReplaceAll(name, " ", "-")))
			if !errors.Is(err, errOrderLineItemsIncomplete) {
				t.Fatalf("incomplete order line pagination did not fail closed: calls=%d err=%v", calls, err)
			}
		})
	}
}

func TestClientRejectsFulfillmentsBeyondSafeProbe(t *testing.T) {
	fulfillments := make([]map[string]any, orderCatalogFulfillmentLimit+1)
	for index := range fulfillments {
		fulfillments[index] = map[string]any{
			"id": fmt.Sprintf("gid://shopify/Fulfillment/%d", index+1), "trackingInfo": []any{},
		}
	}
	payload := validOrderPageMap(false, "")
	payload["data"].(map[string]any)["orders"].(map[string]any)["edges"].([]any)[0].(map[string]any)["node"].(map[string]any)["fulfillments"] = fulfillments
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(payload)
	}))
	defer server.Close()
	client, _ := newClient("2026-07", server.URL, server.Client())
	_, err := client.FetchOrderCatalogPage(t.Context(), "orders.myshopify.com", "shpat_connector_order", orderRequest("fulfillment-probe"))
	if !errors.Is(err, errOrderFulfillmentsLimited) {
		t.Fatalf("fulfillment overflow was not rejected: %v", err)
	}
}

func TestClientRejectsMissingOrderProviderShape(t *testing.T) {
	mutations := map[string]func(map[string]any){
		"orders":       func(value map[string]any) { delete(value["data"].(map[string]any), "orders") },
		"page info":    func(value map[string]any) { delete(orderConnection(value), "pageInfo") },
		"edges":        func(value map[string]any) { delete(orderConnection(value), "edges") },
		"line items":   func(value map[string]any) { delete(orderNodeMap(value), "lineItems") },
		"fulfillments": func(value map[string]any) { delete(orderNodeMap(value), "fulfillments") },
		"money":        func(value map[string]any) { delete(orderNodeMap(value), "currentTotalPriceSet") },
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			payload := validOrderPageMap(false, "")
			mutate(payload)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				_ = json.NewEncoder(w).Encode(payload)
			}))
			defer server.Close()
			client, _ := newClient("2026-07", server.URL, server.Client())
			if _, err := client.FetchOrderCatalogPage(t.Context(), "orders.myshopify.com", "shpat_connector_order", orderRequest("shape-"+strings.ReplaceAll(name, " ", "-"))); err == nil {
				t.Fatal("missing order provider shape was accepted")
			}
		})
	}
}

func TestClientRejectsProtectedFieldRedactionGraphQLError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"orders":{"pageInfo":{"hasNextPage":false,"endCursor":null},"edges":[{"node":{"id":"gid://shopify/Order/100","email":null,"shippingAddress":null}}]}},"errors":[{"message":"provider detail shpat_must_not_escape","path":["orders","edges",0,"node","email"],"extensions":{"code":"ACCESS_DENIED"}}]}`))
	}))
	defer server.Close()
	client, err := newClient("2026-07", server.URL, server.Client())
	if err != nil {
		t.Fatalf("newClient failed: %v", err)
	}

	_, err = client.FetchOrderCatalogPage(t.Context(), "orders.myshopify.com", "shpat_connector_order", orderRequest("protected-field-redaction"))
	if !errors.Is(err, shopifyconnector.ErrProtectedCustomerDataRequired) ||
		strings.Contains(err.Error(), "provider detail") || strings.Contains(err.Error(), "shpat_") {
		t.Fatalf("protected-field GraphQL error was accepted or leaked: %v", err)
	}
}

func TestClientRejectsProtectedOrderObjectGraphQLError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":null,"errors":[{"message":"provider detail shpat_must_not_escape","path":["orders"],"extensions":{"code":"ACCESS_DENIED","documentation":"https://shopify.dev/docs/apps/launch/protected-customer-data"}}]}`))
	}))
	defer server.Close()
	client, err := newClient("2026-07", server.URL, server.Client())
	if err != nil {
		t.Fatalf("newClient failed: %v", err)
	}

	_, err = client.FetchOrderCatalogPage(t.Context(), "orders.myshopify.com", "shpat_connector_order", orderRequest("protected-order-object"))
	if !errors.Is(err, shopifyconnector.ErrProtectedCustomerDataRequired) ||
		strings.Contains(err.Error(), "provider detail") || strings.Contains(err.Error(), "shpat_") {
		t.Fatalf("protected-order GraphQL error was accepted or leaked: %v", err)
	}
}

func TestClientDoesNotMisclassifyOtherGraphQLErrorsAsProtectedData(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"orders":null},"errors":[{"message":"provider detail shpat_must_not_escape","path":["orders"],"extensions":{"code":"ACCESS_DENIED"}}]}`))
	}))
	defer server.Close()
	client, _ := newClient("2026-07", server.URL, server.Client())

	_, err := client.FetchOrderCatalogPage(t.Context(), "orders.myshopify.com", "shpat_connector_order", orderRequest("non-protected-access-denied"))
	if err == nil || errors.Is(err, shopifyconnector.ErrProtectedCustomerDataRequired) ||
		strings.Contains(err.Error(), "provider detail") || strings.Contains(err.Error(), "shpat_") {
		t.Fatalf("non-protected GraphQL error was misclassified or leaked: %v", err)
	}
}

func validOrderPageJSON(hasNext bool, cursor string) string {
	raw, _ := json.Marshal(validOrderPageMap(hasNext, cursor))
	return string(raw)
}

func validOrderPageMap(hasNext bool, cursor string) map[string]any {
	return map[string]any{"data": map[string]any{"orders": map[string]any{
		"pageInfo": map[string]any{"hasNextPage": false, "endCursor": "orders-done=="},
		"edges": []any{map[string]any{"node": map[string]any{
			"id": "gid://shopify/Order/100", "legacyResourceId": 100, "name": "#1001",
			"email": "buyer@example.com", "createdAt": "2026-08-01T20:00:00Z", "paymentGatewayNames": []any{"shopify_payments"},
			"currentTotalPriceSet": moneyBag(), "currentSubtotalPriceSet": moneyBag(), "currentShippingPriceSet": moneyBag(),
			"shippingAddress": map[string]any{
				"name": "Test Buyer", "phone": "+12125550123", "formatted": []any{"123 Staple St", "New York NY 10013"},
			},
			"lineItems": map[string]any{
				"pageInfo": map[string]any{"hasNextPage": hasNext, "endCursor": cursor},
				"edges":    []any{map[string]any{"node": validOrderLineMap("1")}},
			},
			"fulfillments": []any{},
		}}},
	}}}
}

func validOrderLinePageJSON(hasNext bool, cursor, id string) string {
	raw, _ := json.Marshal(map[string]any{"data": map[string]any{"order": map[string]any{
		"lineItems": map[string]any{
			"pageInfo": map[string]any{"hasNextPage": hasNext, "endCursor": cursor},
			"edges":    []any{map[string]any{"node": validOrderLineMap(id)}},
		},
	}}})
	return string(raw)
}

func validOrderLineMap(id string) map[string]any {
	return map[string]any{
		"id": "gid://shopify/LineItem/" + id, "name": "Product", "title": "Product", "quantity": 1,
		"discountedTotalSet": moneyBag(), "originalUnitPriceSet": moneyBag(),
	}
}

func moneyBag() map[string]any {
	return map[string]any{"shopMoney": map[string]any{"amount": "10.00", "currencyCode": "USD"}}
}

func orderConnection(value map[string]any) map[string]any {
	return value["data"].(map[string]any)["orders"].(map[string]any)
}

func orderNodeMap(value map[string]any) map[string]any {
	return orderConnection(value)["edges"].([]any)[0].(map[string]any)["node"].(map[string]any)
}

func orderRequest(correlationID string) shopifyconnector.OrderCatalogPageRequest {
	return shopifyconnector.OrderCatalogPageRequest{
		Identity: shopifyconnector.CanonicalShopIdentity{TenantID: productTestTenant, ShopID: productTestShop},
		Context:  shopifyconnector.RequestContext{CorrelationID: correlationID, RequestID: "request-order"},
		Limit:    50,
	}
}
