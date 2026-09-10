package adminapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

func TestClientRemainingReadsAreQueryOnlyAndStrict(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Shopify-Access-Token") != "shpat_connector_owned" {
			t.Fatal("connector credential missing")
		}
		var payload struct {
			Query string `json:"query"`
		}
		_ = json.NewDecoder(r.Body).Decode(&payload)
		if strings.Contains(strings.ToLower(payload.Query), "mutation") || !strings.HasPrefix(strings.TrimSpace(payload.Query), "query ") {
			t.Fatalf("non-read operation: %s", payload.Query)
		}
		switch {
		case strings.Contains(payload.Query, "XZERPLocationCatalogPage"):
			_, _ = w.Write([]byte(`{"data":{"locations":{"pageInfo":{"hasNextPage":false},"nodes":[{"id":"gid://shopify/Location/2","name":"Warehouse","isActive":true,"fulfillsOnlineOrders":true,"hasActiveInventory":true,"isFulfillmentService":false,"address":{"countryCode":"US"}}]}}}`))
		case strings.Contains(payload.Query, "XZERPInventoryLevel"):
			_, _ = w.Write([]byte(`{"data":{"inventoryItem":{"id":"gid://shopify/InventoryItem/1","tracked":true,"inventoryLevel":{"isActive":true,"location":{"id":"gid://shopify/Location/2"},"quantities":[{"name":"available","quantity":7},{"name":"on_hand","quantity":9}]}}}}`))
		case strings.Contains(payload.Query, "XZERPDisputes"):
			_, _ = w.Write([]byte(`{"data":{"disputes":{"pageInfo":{"hasNextPage":false},"nodes":[{"id":"gid://shopify/ShopifyPaymentsDispute/1","status":"NEEDS_RESPONSE","type":"CHARGEBACK","initiatedAt":"2026-08-01T00:00:00Z","amount":{"amount":"10.00","currencyCode":"USD"},"reasonDetails":{"reason":"fraudulent"}}]}}}`))
		default:
			t.Fatalf("unexpected query: %s", payload.Query)
		}
	}))
	defer server.Close()
	client, err := newClient("2026-07", server.URL, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	identity := shopifyconnector.CanonicalShopIdentity{TenantID: productTestTenant, ShopID: productTestShop}
	context := shopifyconnector.RequestContext{CorrelationID: "remaining-reads", RequestID: "remaining-request"}
	if _, err := client.FetchLocationCatalogPage(t.Context(), "catalog.myshopify.com", "shpat_connector_owned", shopifyconnector.LocationCatalogPageRequest{Identity: identity, Context: context, Limit: 50}); err != nil {
		t.Fatalf("location: %v", err)
	}
	if _, err := client.FetchInventoryLevel(t.Context(), "catalog.myshopify.com", "shpat_connector_owned", shopifyconnector.InventoryLevelReadRequest{Identity: identity, Context: context, InventoryItemID: "gid://shopify/InventoryItem/1", LocationID: "gid://shopify/Location/2"}); err != nil {
		t.Fatalf("inventory: %v", err)
	}
	if _, err := client.FetchDisputeCatalogPage(t.Context(), "catalog.myshopify.com", "shpat_connector_owned", shopifyconnector.DisputeCatalogPageRequest{Identity: identity, Context: context, Limit: 50}); err != nil {
		t.Fatalf("disputes: %v", err)
	}
}

func TestClientReturnCatalogCompletesNestedPagesBeforeReturning(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var payload struct {
			Query     string         `json:"query"`
			Variables map[string]any `json:"variables"`
		}
		_ = json.NewDecoder(r.Body).Decode(&payload)
		if strings.Contains(strings.ToLower(payload.Query), "mutation") {
			t.Fatal("return catalog attempted mutation")
		}
		switch calls {
		case 1:
			if payload.Variables["returnsFirst"] != float64(returnCatalogOrderReturnsPageSize) || strings.Contains(payload.Query, "returnLineItems") {
				t.Fatalf("return catalog first page is not cost-bounded: %#v", payload)
			}
			_, _ = w.Write([]byte(`{"data":{"orders":{"pageInfo":{"hasNextPage":false},"nodes":[{"id":"gid://shopify/Order/1","name":"#1001","returns":{"pageInfo":{"hasNextPage":true,"endCursor":"return-1"},"nodes":[]}}]}}}`))
		case 2:
			if payload.Variables["first"] != float64(returnOrderReturnsPageSize) || strings.Contains(payload.Query, "returnLineItems") {
				t.Fatalf("nested return page is not cost-bounded: %#v", payload)
			}
			_, _ = w.Write([]byte(`{"data":{"order":{"returns":{"pageInfo":{"hasNextPage":false},"nodes":[{"id":"gid://shopify/Return/2","name":"Return #2","status":"OPEN","createdAt":"2026-08-01T00:00:00Z","totalQuantity":2}]}}}}`))
		case 3:
			if payload.Variables["first"] != float64(returnLineItemsPageSize) || !strings.Contains(payload.Query, "XZERPReturnLineItemFirstPage") {
				t.Fatalf("return line first page is not independently paged: %#v", payload)
			}
			_, _ = w.Write([]byte(`{"data":{"return":{"returnLineItems":{"pageInfo":{"hasNextPage":true,"endCursor":"line-1"},"nodes":[{"id":"gid://shopify/ReturnLineItem/3","quantity":1,"processableQuantity":1,"processedQuantity":0,"refundableQuantity":1,"refundedQuantity":0,"fulfillmentLineItem":{"id":"gid://shopify/FulfillmentLineItem/4","lineItem":{"id":"gid://shopify/LineItem/5","name":"First"}}}]}}}}`))
		case 4:
			_, _ = w.Write([]byte(`{"data":{"return":{"returnLineItems":{"pageInfo":{"hasNextPage":false},"nodes":[{"id":"gid://shopify/ReturnLineItem/6","quantity":1,"processableQuantity":1,"processedQuantity":0,"refundableQuantity":1,"refundedQuantity":0,"fulfillmentLineItem":{"id":"gid://shopify/FulfillmentLineItem/7","lineItem":{"id":"gid://shopify/LineItem/8","name":"Second"}}}]}}}}`))
		default:
			t.Fatal("unexpected extra request")
		}
	}))
	defer server.Close()
	client, _ := newClient("2026-07", server.URL, server.Client())
	request := shopifyconnector.ReturnCatalogPageRequest{Identity: shopifyconnector.CanonicalShopIdentity{TenantID: productTestTenant, ShopID: productTestShop}, Context: shopifyconnector.RequestContext{CorrelationID: "return-pages", RequestID: "return-request"}, Limit: 50}
	page, err := client.FetchReturnCatalogPage(t.Context(), "catalog.myshopify.com", "shpat_connector_owned", request)
	if err != nil || calls != 4 || len(page.Returns) != 1 || len(page.Returns[0].LineItems) != 2 {
		t.Fatalf("nested returns incomplete calls=%d page=%#v err=%v", calls, page, err)
	}
}

func TestClientReturnCatalogRejectsRepeatedNestedCursor(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		if calls == 1 {
			_, _ = w.Write([]byte(`{"data":{"orders":{"pageInfo":{"hasNextPage":false},"nodes":[{"id":"gid://shopify/Order/1","name":"#1","returns":{"pageInfo":{"hasNextPage":true,"endCursor":"loop"},"nodes":[]}}]}}}`))
			return
		}
		_, _ = w.Write([]byte(`{"data":{"order":{"returns":{"pageInfo":{"hasNextPage":true,"endCursor":"loop"},"nodes":[]}}}}`))
	}))
	defer server.Close()
	client, _ := newClient("2026-07", server.URL, server.Client())
	request := shopifyconnector.ReturnCatalogPageRequest{Identity: shopifyconnector.CanonicalShopIdentity{TenantID: productTestTenant, ShopID: productTestShop}, Context: shopifyconnector.RequestContext{CorrelationID: "return-loop", RequestID: "return-request"}, Limit: 50}
	if _, err := client.FetchReturnCatalogPage(t.Context(), "catalog.myshopify.com", "token", request); err == nil || calls < 2 {
		t.Fatalf("repeated cursor accepted calls=%d err=%v", calls, err)
	}
}
