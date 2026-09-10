package platform

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestParseShopifyThemeEmbedState(t *testing.T) {
	tests := []struct {
		name     string
		settings string
		want     string
	}{
		{
			name:     "enabled",
			settings: `{"current":{"blocks":{"embed":{"type":"shopify://apps/xzdesk/blocks/xinzhi-chat/app-key","disabled":false}}}}`,
			want:     shopifyThemeEmbedEnabled,
		},
		{
			name: "enabled with shopify generated header",
			settings: "\ufeff" + `/*
 * ------------------------------------------------------------
 * IMPORTANT: The contents of this file are auto-generated.
 * ------------------------------------------------------------
 */
{"current":{"blocks":{"embed":{"type":"shopify://apps/xzdesk/blocks/xinzhi-chat/app-key","disabled":false}}}}`,
			want: shopifyThemeEmbedEnabled,
		},
		{
			name:     "disabled",
			settings: `{"current":{"blocks":{"embed":{"type":"shopify://apps/xzdesk/blocks/xinzhi-chat/app-key","disabled":true}}}}`,
			want:     shopifyThemeEmbedDisabled,
		},
		{
			name:     "not added",
			settings: `{"current":{"blocks":{"other":{"type":"shopify://apps/other/blocks/widget/app-key","disabled":false}}}}`,
			want:     shopifyThemeEmbedNotAdded,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, _ := parseShopifyThemeEmbedState(test.settings, defaultShopifyExtensionHandle)
			if got != test.want {
				t.Fatalf("parseShopifyThemeEmbedState()=%q, want %q", got, test.want)
			}
		})
	}
}

func TestShopifyAdminClientCheckThemeEmbed(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Query string `json:"query"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request failed: %v", err)
		}
		if !strings.Contains(payload.Query, shopifyThemeSettingsFilename) {
			t.Fatalf("theme settings file was not requested: %s", payload.Query)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"themes":{"nodes":[{"files":{"nodes":[{"body":{"content":"{\"current\":{\"blocks\":{\"embed\":{\"type\":\"shopify://apps/xzdesk/blocks/xinzhi-chat/app-key\",\"disabled\":false}}}}"}}]}}]}}}`))
	}))
	defer server.Close()

	client := shopifyAdminClient{HTTPClient: server.Client(), BaseURL: server.URL}
	state, message := client.CheckThemeEmbed(t.Context(), "demo.myshopify.com", "shpat_test", defaultShopifyExtensionHandle)
	if state != shopifyThemeEmbedEnabled || message != "" {
		t.Fatalf("unexpected theme embed result: state=%q message=%q", state, message)
	}
}

func TestShopifyAdminClientSearchOrders(t *testing.T) {
	var gotToken string
	var gotQuery string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotToken = r.Header.Get("X-Shopify-Access-Token")
		var payload struct {
			Query     string         `json:"query"`
			Variables map[string]any `json:"variables"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request failed: %v", err)
		}
		gotQuery, _ = payload.Variables["query"].(string)
		if !strings.Contains(payload.Query, "displayStatus") || !strings.Contains(payload.Query, "deliveredAt") {
			t.Fatalf("Shopify fulfillment lifecycle fields were not requested: %s", payload.Query)
		}
		if !strings.Contains(payload.Query, "presentmentMoney") || strings.Contains(payload.Query, "shopMoney") {
			t.Fatalf("order query must request only Shopify presentment currency amounts: %s", payload.Query)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"data": {
				"orders": {
					"edges": [{
						"node": {
							"id": "gid://shopify/Order/1",
							"legacyResourceId": 6233657999545,
							"name": "#1001",
							"email": "mia@example.com",
							"sourceName": "web",
							"createdAt": "2026-07-04T10:00:00Z",
							"displayFinancialStatus": "PAID",
							"displayFulfillmentStatus": "FULFILLED",
							"paymentGatewayNames": ["Shopify Payments"],
							"currentTotalPriceSet": {"shopMoney": {"amount": "32.89", "currencyCode": "USD"}, "presentmentMoney": {"amount": "45.00", "currencyCode": "CAD"}},
							"currentSubtotalPriceSet": {"shopMoney": {"amount": "32.89", "currencyCode": "USD"}, "presentmentMoney": {"amount": "45.00", "currencyCode": "CAD"}},
							"currentShippingPriceSet": {"shopMoney": {"amount": "0.00", "currencyCode": "USD"}, "presentmentMoney": {"amount": "0.00", "currencyCode": "CAD"}},
							"currentTotalAdditionalFeesSet": {"shopMoney": {"amount": "0.00", "currencyCode": "USD"}, "presentmentMoney": {"amount": "0.00", "currencyCode": "CAD"}},
							"shippingAddress": {"name": "Mia Recipient", "firstName": "Mia", "lastName": "Recipient", "address1": "123 Main St", "city": "Austin", "provinceCode": "TX", "countryCode": "US", "zip": "78701", "phone": "+15557654321", "formatted": ["Mia Recipient", "123 Main St", "Austin TX 78701", "United States"]},
							"customer": {
								"id": "gid://shopify/Customer/8173975273657",
								"displayName": "Mia",
								"createdAt": "2026-02-13T08:00:00Z",
								"defaultEmailAddress": {"emailAddress": "mia@example.com"},
								"defaultPhoneNumber": {"phoneNumber": "+15551234567"},
								"amountSpent": {"amount": "128.50", "currencyCode": "USD"},
								"defaultAddress": {"formattedArea": "Boqueron"},
								"lastOrder": {
									"id": "gid://shopify/Order/6233657999545",
									"name": "#1603",
									"email": "mia@example.com",
									"sourceName": "web",
									"createdAt": "2026-07-04T10:00:00Z",
									"displayFinancialStatus": "PAID",
									"displayFulfillmentStatus": "FULFILLED",
									"paymentGatewayNames": ["Shopify Payments"],
									"currentTotalPriceSet": {"shopMoney": {"amount": "32.89", "currencyCode": "USD"}, "presentmentMoney": {"amount": "45.00", "currencyCode": "CAD"}},
									"currentSubtotalPriceSet": {"shopMoney": {"amount": "32.89", "currencyCode": "USD"}, "presentmentMoney": {"amount": "45.00", "currencyCode": "CAD"}},
									"currentShippingPriceSet": {"shopMoney": {"amount": "0.00", "currencyCode": "USD"}, "presentmentMoney": {"amount": "0.00", "currencyCode": "CAD"}},
									"currentTotalAdditionalFeesSet": {"shopMoney": {"amount": "0.00", "currencyCode": "USD"}, "presentmentMoney": {"amount": "0.00", "currencyCode": "CAD"}},
									"shippingAddress": {"name": "Mia Recipient", "phone": "+15557654321", "formatted": ["123 Main St", "Austin TX 78701", "United States"]},
									"lineItems": {"edges": [
										{"node": {"name": "Widget", "quantity": 2, "sku": "W-1", "variantTitle": "Blue", "requiresShipping": true, "discountedTotalSet": {"shopMoney": {"amount": "29.90", "currencyCode": "USD"}, "presentmentMoney": {"amount": "40.00", "currencyCode": "CAD"}}}},
										{"node": {"name": "Shipping protection", "quantity": 1, "sku": "INS-1", "requiresShipping": true, "discountedTotalSet": {"shopMoney": {"amount": "2.99", "currencyCode": "USD"}, "presentmentMoney": {"amount": "5.00", "currencyCode": "CAD"}}}}
									]}
								}
							},
							"lineItems": {"edges": [
								{"node": {"name": "Widget", "quantity": 2, "sku": "W-1", "variantTitle": "Blue", "requiresShipping": true, "discountedTotalSet": {"shopMoney": {"amount": "29.90", "currencyCode": "USD"}, "presentmentMoney": {"amount": "40.00", "currencyCode": "CAD"}}}},
								{"node": {"name": "Shipping protection", "quantity": 1, "sku": "INS-1", "requiresShipping": true, "discountedTotalSet": {"shopMoney": {"amount": "2.99", "currencyCode": "USD"}, "presentmentMoney": {"amount": "5.00", "currencyCode": "CAD"}}}}
							]},
							"fulfillments": [{"id": "gid://shopify/Fulfillment/9", "status": "SUCCESS", "displayStatus": "DELIVERED", "createdAt": "2026-07-04T11:00:00Z", "updatedAt": "2026-07-04T12:00:00Z", "deliveredAt": "2026-07-05T12:00:00Z", "trackingInfo": [{"company": "UPS", "number": "1Z", "url": "https://track.example/1Z"}]}]
						}
					}]
				}
			}
		}`))
	}))
	defer server.Close()

	client := shopifyAdminClient{HTTPClient: server.Client(), BaseURL: server.URL}
	result, err := client.SearchOrders(t.Context(), "demo.myshopify.com", "shpat_test", "email:mia@example.com", 5)
	if err != nil {
		t.Fatalf("SearchOrders failed: %v", err)
	}
	if gotToken != "shpat_test" || gotQuery != "email:mia@example.com" {
		t.Fatalf("unexpected request token=%q query=%q", gotToken, gotQuery)
	}
	if len(result.Orders) != 1 {
		t.Fatalf("expected one order, got %#v", result)
	}
	order := result.Orders[0]
	if order.Name != "#1001" || order.Total.Amount != "45.00" || order.Total.CurrencyCode != "CAD" || len(order.LineItems) != 2 || len(order.Fulfillments) != 1 {
		t.Fatalf("unexpected order summary: %#v", order)
	}
	if order.ProductSubtotal.Amount != "40.00" || order.ProductSubtotal.CurrencyCode != "CAD" || order.Shipping.Amount != "0.00" || order.AdditionalFees.Amount != "5.00" {
		t.Fatalf("order amount breakdown was not parsed: %#v", order)
	}
	if order.ShippingAddress.Name != "Mia Recipient" || order.ShippingAddress.Phone != "+15557654321" || len(order.ShippingAddress.Formatted) != 4 {
		t.Fatalf("shipping contact was not parsed: %#v", order.ShippingAddress)
	}
	if order.SourceName != "web" {
		t.Fatalf("unexpected order source: %#v", order)
	}
	if len(order.PaymentGateways) != 1 || order.PaymentGateways[0] != "Shopify Payments" {
		t.Fatalf("payment gateways were not parsed: %#v", order.PaymentGateways)
	}
	if order.LegacyResourceID != "6233657999545" || order.AdminURL != "https://admin.shopify.com/store/demo/orders/6233657999545" {
		t.Fatalf("unexpected order admin link: %#v", order)
	}
	if order.Customer.DefaultAddress != "Boqueron" || order.Customer.TotalSpent.Amount != "128.50" || order.Customer.TotalSpent.CurrencyCode != "USD" {
		t.Fatalf("customer profile details were not parsed: %#v", order.Customer)
	}
	if order.Customer.LastOrder == nil || order.Customer.LastOrder.LegacyResourceID != "6233657999545" || order.Customer.LastOrder.AdminURL != "https://admin.shopify.com/store/demo/orders/6233657999545" {
		t.Fatalf("customer last order was not parsed: %#v", order.Customer.LastOrder)
	}
	if order.Customer.LastOrder.SourceName != "web" {
		t.Fatalf("customer last order source was not parsed: %#v", order.Customer.LastOrder)
	}
	if order.Customer.LastOrder.Total.CurrencyCode != "CAD" || order.Customer.LastOrder.ProductSubtotal.Amount != "40.00" || order.Customer.LastOrder.AdditionalFees.Amount != "5.00" || order.Customer.LastOrder.ShippingAddress.Phone != "+15557654321" {
		t.Fatalf("customer last order details were not parsed: %#v", order.Customer.LastOrder)
	}
	if order.Fulfillments[0].ID != "gid://shopify/Fulfillment/9" || order.Fulfillments[0].TrackingInfo[0].Number != "1Z" {
		t.Fatalf("tracking info was not parsed: %#v", order.Fulfillments)
	}
	if order.Fulfillments[0].DisplayStatus != "DELIVERED" || order.Fulfillments[0].DeliveredAt != "2026-07-05T12:00:00Z" {
		t.Fatalf("Shopify fulfillment lifecycle was not parsed: %#v", order.Fulfillments[0])
	}
}

func TestShopifyAdminClientSearchOrdersPaginatesOrderAndLastOrderLines(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var payload struct {
			Query     string         `json:"query"`
			Variables map[string]any `json:"variables"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request failed: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		switch calls {
		case 1:
			if strings.Count(payload.Query, "lineItems(first: 10)") != 2 ||
				strings.Count(payload.Query, "fulfillments(first: 11)") != 2 ||
				strings.Count(payload.Query, "pageInfo { hasNextPage endCursor }") < 2 {
				t.Fatalf("search query does not expose safe nested read boundaries: %s", payload.Query)
			}
			_, _ = w.Write([]byte(`{"data":{"orders":{"edges":[{"node":{"id":"gid://shopify/Order/1","name":"#1001","lineItems":{"edges":[],"pageInfo":{"hasNextPage":true,"endCursor":"order-lines-10"}},"fulfillments":[],"customer":{"id":"gid://shopify/Customer/1","lastOrder":{"id":"gid://shopify/Order/2","name":"#1000","lineItems":{"edges":[],"pageInfo":{"hasNextPage":true,"endCursor":"last-order-lines-10"}},"fulfillments":[]}}}}]}}}`))
		case 2:
			if !strings.Contains(payload.Query, "query XZERPOrderLineItemPage") ||
				payload.Variables["id"] != "gid://shopify/Order/1" || payload.Variables["after"] != "order-lines-10" {
				t.Fatalf("unexpected current-order continuation: %#v", payload)
			}
			_, _ = w.Write([]byte(`{"data":{"order":{"lineItems":{"edges":[{"node":{"id":"gid://shopify/LineItem/101","name":"Current order continuation","quantity":1}}],"pageInfo":{"hasNextPage":false,"endCursor":"order-lines-11"}}}}}`))
		case 3:
			if !strings.Contains(payload.Query, "query XZERPOrderLineItemPage") ||
				payload.Variables["id"] != "gid://shopify/Order/2" || payload.Variables["after"] != "last-order-lines-10" {
				t.Fatalf("unexpected last-order continuation: %#v", payload)
			}
			_, _ = w.Write([]byte(`{"data":{"order":{"lineItems":{"edges":[{"node":{"id":"gid://shopify/LineItem/201","name":"Last order continuation","quantity":1}}],"pageInfo":{"hasNextPage":false,"endCursor":"last-order-lines-11"}}}}}`))
		default:
			t.Fatalf("unexpected request %d", calls)
		}
	}))
	defer server.Close()

	client := shopifyAdminClient{HTTPClient: server.Client(), BaseURL: server.URL}
	result, err := client.SearchOrders(t.Context(), "demo.myshopify.com", "shpat_test", "name:#1001", 5)
	if err != nil {
		t.Fatalf("SearchOrders failed: %v", err)
	}
	if calls != 3 || len(result.Orders) != 1 || len(result.Orders[0].LineItems) != 1 ||
		result.Orders[0].Customer.LastOrder == nil || len(result.Orders[0].Customer.LastOrder.LineItems) != 1 {
		t.Fatalf("nested order details were not completed: calls=%d result=%#v", calls, result)
	}
}

func TestShopifyAdminClientSearchOrdersRejectsUnpageableFulfillmentOverflow(t *testing.T) {
	tests := []struct {
		name      string
		lastOrder bool
	}{
		{name: "current order"},
		{name: "customer last order", lastOrder: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				calls++
				fulfillments := make([]map[string]any, shopifyOrderCatalogFulfillmentLimit+1)
				for index := range fulfillments {
					fulfillments[index] = map[string]any{"id": "gid://shopify/Fulfillment/overflow-probe"}
				}
				node := map[string]any{
					"id":           "gid://shopify/Order/1",
					"lineItems":    map[string]any{"edges": []any{}, "pageInfo": map[string]any{"hasNextPage": false}},
					"fulfillments": []any{},
				}
				if test.lastOrder {
					node["customer"] = map[string]any{
						"lastOrder": map[string]any{
							"id": "gid://shopify/Order/2", "lineItems": map[string]any{"edges": []any{}, "pageInfo": map[string]any{"hasNextPage": false}}, "fulfillments": fulfillments,
						},
					}
				} else {
					node["fulfillments"] = fulfillments
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]any{
					"data": map[string]any{"orders": map[string]any{"edges": []any{map[string]any{"node": node}}}},
				})
			}))
			defer server.Close()

			client := shopifyAdminClient{HTTPClient: server.Client(), BaseURL: server.URL}
			_, err := client.SearchOrders(t.Context(), "demo.myshopify.com", "shpat_test", "name:#1001", 5)
			if !errors.Is(err, errShopifyOrderCatalogFulfillmentsTruncated) || calls != 1 {
				t.Fatalf("fulfillment overflow must fail before returning partial search data: calls=%d err=%v", calls, err)
			}
		})
	}
}

func TestShopifyOrderSearchCacheIsSharedForOneDay(t *testing.T) {
	store := &shopifyCustomerCacheTestStore{Store: NewMemoryStore(), entries: make(map[string]externalCacheEntry)}
	server := NewServer(store)
	calls := 0
	server.publicShopifyOrderSearch = func(_ context.Context, _, _, query string, limit int) (ShopifyOrderSearchResult, error) {
		calls++
		return ShopifyOrderSearchResult{Orders: []ShopifyOrderSummary{{ID: "order-1", Name: "#1001"}}}, nil
	}

	first, err := server.searchShopifyOrdersCached(t.Context(), "shop-1", "demo.myshopify.com", "token", "email:buyer@example.com", 5)
	if err != nil || len(first.Orders) != 1 {
		t.Fatalf("first cached search failed: result=%#v err=%v", first, err)
	}
	second, err := server.searchShopifyOrdersCached(t.Context(), "shop-1", "demo.myshopify.com", "token", "email:buyer@example.com", 5)
	if err != nil || len(second.Orders) != 1 || calls != 1 {
		t.Fatalf("repeated search was not cached: result=%#v calls=%d err=%v", second, calls, err)
	}
	for _, entry := range store.entries {
		if entry.ExpiresAt.Sub(entry.FetchedAt) != 24*time.Hour {
			t.Fatalf("order cache lifetime = %s, want 24h", entry.ExpiresAt.Sub(entry.FetchedAt))
		}
	}
}

func TestShopifyOrderAmountBreakdownClassifiesProtectionLineItems(t *testing.T) {
	tests := []struct {
		name             string
		subtotal         ShopifyMoney
		officialFees     ShopifyMoney
		lineItems        []ShopifyLineItem
		productAmount    string
		additionalAmount string
	}{
		{
			name:         "shipping protection is an additional service even when marked shippable",
			subtotal:     ShopifyMoney{Amount: "83.96", CurrencyCode: "USD"},
			officialFees: ShopifyMoney{Amount: "0.00", CurrencyCode: "USD"},
			lineItems: []ShopifyLineItem{
				{Name: "250th Anniversary Chess Set", RequiresShipping: true, DiscountedTotal: ShopifyMoney{Amount: "79.97", CurrencyCode: "USD"}},
				{Name: "Shipping protection", RequiresShipping: true, DiscountedTotal: ShopifyMoney{Amount: "3.99", CurrencyCode: "USD"}},
			},
			productAmount:    "79.97",
			additionalAmount: "3.99",
		},
		{
			name:         "ordinary non-shippable product remains merchandise",
			subtotal:     ShopifyMoney{Amount: "12.00", CurrencyCode: "USD"},
			officialFees: ShopifyMoney{Amount: "0.00", CurrencyCode: "USD"},
			lineItems: []ShopifyLineItem{
				{Name: "Digital guide", RequiresShipping: false, DiscountedTotal: ShopifyMoney{Amount: "12.00", CurrencyCode: "USD"}},
			},
			productAmount:    "12.00",
			additionalAmount: "0.00",
		},
		{
			name:         "recognized service line adds to official fees",
			subtotal:     ShopifyMoney{Amount: "31.99", CurrencyCode: "USD"},
			officialFees: ShopifyMoney{Amount: "1.00", CurrencyCode: "USD"},
			lineItems: []ShopifyLineItem{
				{Name: "Package Insurance", DiscountedTotal: ShopifyMoney{Amount: "2.99", CurrencyCode: "USD"}},
			},
			productAmount:    "29.00",
			additionalAmount: "3.99",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			product, additional := shopifyOrderAmountBreakdown(test.subtotal, test.officialFees, test.lineItems)
			if product.Amount != test.productAmount || additional.Amount != test.additionalAmount {
				t.Fatalf("unexpected breakdown product=%#v additional=%#v", product, additional)
			}
		})
	}
}

func TestShopifyDomainAndEnvKey(t *testing.T) {
	if got := normalizeShopifyDomain("https://demo.myshopify.com/admin"); got != "demo.myshopify.com" {
		t.Fatalf("unexpected normalized domain: %q", got)
	}
	if got := normalizeShopifyDomain("https://admin.shopify.com/store/demo/settings/domains"); got != "demo.myshopify.com" {
		t.Fatalf("unexpected admin URL normalized domain: %q", got)
	}
	if got := normalizeShopifyDomain("admin.shopify.com/store/demo/orders"); got != "demo.myshopify.com" {
		t.Fatalf("unexpected admin path normalized domain: %q", got)
	}
	if got := normalizeShopifyDomain("https://admin.shopify.com/settings"); got != "" {
		t.Fatalf("admin URL without a store should not normalize: %q", got)
	}
	if got := normalizeShopifyDomain("demo"); got != "demo.myshopify.com" {
		t.Fatalf("unexpected short normalized domain: %q", got)
	}
	if got := normalizeShopifyDomain("shop.example.com/admin"); got != "shop.example.com" {
		t.Fatalf("custom subdomain should remain available to non-OAuth matching: %q", got)
	}
	for input, want := range map[string]string{
		"demo":               "demo.myshopify.com",
		"demo.myshopify.com": "demo.myshopify.com",
		"https://admin.shopify.com/store/demo/settings/domains": "demo.myshopify.com",
	} {
		if got := normalizeShopifyOAuthTarget(input); got != want {
			t.Errorf("Shopify OAuth address %q normalized to %q, want %q", input, got, want)
		}
	}
	for _, invalid := range []string{
		"https://example.com/store/demo",
		"https://admin.shopify.com/settings",
		"https://admin.shopify.com/store/demo.myshopify.com/settings",
		"https://nested.demo.myshopify.com/admin",
		"https://demo.myshopify.com:8443/admin",
		"https://user@example.com@demo.myshopify.com/admin",
		"bad_handle",
		"-demo",
	} {
		if got := normalizeShopifyOAuthTarget(invalid); got != "" {
			t.Errorf("invalid Shopify address %q normalized to %q", invalid, got)
		}
	}
	if got := shopifyEnvKey("demo-store.myshopify.com"); got != "DEMO_STORE_MYSHOPIFY_COM" {
		t.Fatalf("unexpected env key: %q", got)
	}
	if got := shopifyAdminOrderURL("demo-store.myshopify.com", "6233657999545"); got != "https://admin.shopify.com/store/demo-store/orders/6233657999545" {
		t.Fatalf("unexpected admin order URL: %q", got)
	}
}
