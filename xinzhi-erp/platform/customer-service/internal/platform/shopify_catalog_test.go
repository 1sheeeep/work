package platform

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestShopifyAdminClientSearchProducts(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Query     string         `json:"query"`
			Variables map[string]any `json:"variables"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request failed: %v", err)
		}
		if !strings.Contains(payload.Query, "products(first:") ||
			!strings.Contains(payload.Query, "sortKey: TITLE") ||
			payload.Variables["query"] != "hoodie" {
			t.Fatalf("unexpected product query: %#v", payload)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"data": {
				"shop": {"currencyCode": "USD"},
				"products": {"edges": [{"node": {
					"id": "gid://shopify/Product/1",
					"title": "Support Hoodie",
					"handle": "support-hoodie",
					"onlineStoreUrl": "https://demo.example/products/support-hoodie",
					"featuredMedia": {"preview": {"image": {"url": "https://cdn.example/hoodie.jpg", "altText": "Blue hoodie"}}},
					"variants": {"edges": [{"node": {"id": "gid://shopify/ProductVariant/2", "title": "Blue / M", "sku": "HD-B-M", "availableForSale": true, "price": "39.90"}}]}
				}}]}
			}
		}`))
	}))
	defer server.Close()

	client := shopifyAdminClient{HTTPClient: server.Client(), BaseURL: server.URL}
	result, err := client.SearchProducts(t.Context(), "demo.myshopify.com", "shpat_test", "hoodie", 20)
	if err != nil {
		t.Fatalf("SearchProducts failed: %v", err)
	}
	if len(result.Products) != 1 || len(result.Products[0].Variants) != 1 {
		t.Fatalf("unexpected product result: %#v", result)
	}
	variant := result.Products[0].Variants[0]
	if variant.Price.Amount != "39.90" || variant.Price.CurrencyCode != "USD" || !variant.AvailableForSale {
		t.Fatalf("unexpected product variant: %#v", variant)
	}
}

func TestShopifyAdminClientRecommendationSeedProduct(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Query     string         `json:"query"`
			Variables map[string]any `json:"variables"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request failed: %v", err)
		}
		if !strings.Contains(payload.Query, "sortKey: UPDATED_AT") || payload.Variables["query"] != "status:active handle:featured-item" {
			t.Fatalf("unexpected recommendation seed query: %#v", payload)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"data": {
				"shop": {"currencyCode": "USD"},
				"products": {"edges": [{"node": {
					"id": "gid://shopify/Product/35", "title": "Featured Item", "handle": "featured-item",
					"onlineStoreUrl": "https://demo.example/products/featured-item", "featuredMedia": null,
					"variants": {"edges": [{"node": {"id": "gid://shopify/ProductVariant/69", "title": "Default", "sku": "F-1", "availableForSale": true, "price": "38.00"}}]}
				}}]}
			}
		}`))
	}))
	defer server.Close()

	client := shopifyAdminClient{HTTPClient: server.Client(), BaseURL: server.URL}
	result, err := client.RecommendationSeedProduct(t.Context(), "demo.myshopify.com", "shpat_test", "featured-item")
	if err != nil {
		t.Fatalf("RecommendationSeedProduct failed: %v", err)
	}
	if result == nil || result.ID != "gid://shopify/Product/35" || result.Handle != "featured-item" {
		t.Fatalf("unexpected recommendation seed: %#v", result)
	}
	if result.Variants[0].Price.CurrencyCode != "USD" {
		t.Fatalf("seed currency was not retained: %#v", result)
	}
}

func TestShopifyAdminClientRecommendedProducts(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/recommendations/products.json" {
			t.Fatalf("unexpected recommendation request: %s %s", r.Method, r.URL.Path)
		}
		if r.URL.Query().Get("product_id") != "35" || r.URL.Query().Get("limit") != "10" || r.URL.Query().Get("intent") != "related" {
			t.Fatalf("unexpected recommendation parameters: %s", r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"intent": "related",
			"products": [{
				"id": 72, "title": "Related Item", "handle": "related-item", "url": "/products/related-item",
				"featured_image": "//cdn.example/related.jpg",
				"variants": [{"id": 73, "title": "Blue", "sku": "R-B", "available": true, "price": 3990}]
			}]
		}`))
	}))
	defer server.Close()

	client := shopifyAdminClient{HTTPClient: server.Client(), StorefrontBaseURL: server.URL}
	result, err := client.RecommendedProducts(t.Context(), "demo.myshopify.com", "gid://shopify/Product/35", "USD", 10)
	if err != nil {
		t.Fatalf("RecommendedProducts failed: %v", err)
	}
	if len(result.Products) != 1 || result.Products[0].ID != "gid://shopify/Product/72" || result.Products[0].ImageURL != "https://cdn.example/related.jpg" {
		t.Fatalf("unexpected recommended products: %#v", result.Products)
	}
	variant := result.Products[0].Variants[0]
	if variant.ID != "gid://shopify/ProductVariant/73" || variant.Price.Amount != "39.90" || variant.Price.CurrencyCode != "USD" {
		t.Fatalf("unexpected recommended variant: %#v", variant)
	}
}

func TestShopifyAdminClientSearchCustomer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Query     string         `json:"query"`
			Variables map[string]any `json:"variables"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request failed: %v", err)
		}
		if payload.Variables["query"] != `email:"mia@example.com"` {
			t.Fatalf("customer query was not exact: %#v", payload.Variables)
		}
		if !strings.Contains(payload.Query, "displayStatus") || !strings.Contains(payload.Query, "deliveredAt") {
			t.Fatalf("customer order fulfillment lifecycle fields were not requested: %s", payload.Query)
		}
		if !strings.Contains(payload.Query, "presentmentMoney") || strings.Contains(payload.Query, "shopMoney") {
			t.Fatalf("customer order query must request only Shopify presentment currency amounts: %s", payload.Query)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"data": {"customers": {"edges": [{"node": {
				"id": "gid://shopify/Customer/3",
				"displayName": "Mia Customer",
				"defaultEmailAddress": {"emailAddress": "mia@example.com"},
				"defaultPhoneNumber": {"phoneNumber": "+15551234567"},
				"createdAt": "2026-01-02T03:04:05Z",
				"verifiedEmail": true,
				"tags": ["VIP", "Wholesale"],
				"amountSpent": {"amount": "128.50", "currencyCode": "USD"},
				"defaultAddress": {"formattedArea": "Austin, TX"},
				"lastOrder": {
					"id": "gid://shopify/Order/99",
					"legacyResourceId": 99,
					"name": "#1099",
					"email": "mia@example.com",
					"sourceName": "web",
					"createdAt": "2026-01-10T03:04:05Z",
					"displayFinancialStatus": "PAID",
					"displayFulfillmentStatus": "FULFILLED",
					"currentTotalPriceSet": {"shopMoney": {"amount": "44.99", "currencyCode": "USD"}, "presentmentMoney": {"amount": "61.00", "currencyCode": "CAD"}},
					"currentSubtotalPriceSet": {"shopMoney": {"amount": "44.99", "currencyCode": "USD"}, "presentmentMoney": {"amount": "61.00", "currencyCode": "CAD"}},
					"currentShippingPriceSet": {"shopMoney": {"amount": "0.00", "currencyCode": "USD"}, "presentmentMoney": {"amount": "0.00", "currencyCode": "CAD"}},
					"currentTotalAdditionalFeesSet": {"shopMoney": {"amount": "0.00", "currencyCode": "USD"}, "presentmentMoney": {"amount": "0.00", "currencyCode": "CAD"}},
					"shippingAddress": {"name": "Mia Recipient", "phone": "+15557654321", "formatted": ["123 Main St", "Austin TX 78701", "United States"]},
					"lineItems": {"edges": [
						{"node": {"name": "Archive Item", "quantity": 1, "sku": "ARC-1", "variantTitle": "Default Title", "requiresShipping": true, "discountedTotalSet": {"shopMoney": {"amount": "42.00", "currencyCode": "USD"}, "presentmentMoney": {"amount": "56.00", "currencyCode": "CAD"}}}},
						{"node": {"name": "Package Protection", "quantity": 1, "sku": "PROTECT-1", "requiresShipping": false, "discountedTotalSet": {"shopMoney": {"amount": "2.99", "currencyCode": "USD"}, "presentmentMoney": {"amount": "5.00", "currencyCode": "CAD"}}}}
					]},
					"fulfillments": [{"status": "SUCCESS", "displayStatus": "IN_TRANSIT", "trackingInfo": [{"company": "USPS", "number": "9400", "url": "https://tracking.example/9400"}]}]
				}
			}}]}}
		}`))
	}))
	defer server.Close()

	client := shopifyAdminClient{HTTPClient: server.Client(), BaseURL: server.URL}
	result, err := client.SearchCustomer(t.Context(), "demo.myshopify.com", "shpat_test", "mia@example.com")
	if err != nil {
		t.Fatalf("SearchCustomer failed: %v", err)
	}
	if result.Customer == nil || result.Customer.Email != "mia@example.com" || result.Customer.Phone != "+15551234567" {
		t.Fatalf("unexpected customer result: %#v", result)
	}
	if result.Customer.TotalSpent.Amount != "128.50" || result.Customer.TotalSpent.CurrencyCode != "USD" || len(result.Customer.Tags) != 2 {
		t.Fatalf("customer details were not parsed: %#v", result.Customer)
	}
	if result.Customer.LastOrder == nil || result.Customer.LastOrder.Name != "#1099" || len(result.Customer.LastOrder.LineItems) != 2 || len(result.Customer.LastOrder.Fulfillments) != 1 {
		t.Fatalf("customer last order details were not parsed: %#v", result.Customer.LastOrder)
	}
	if result.Customer.LastOrder.SourceName != "web" {
		t.Fatalf("customer last order source was not parsed: %#v", result.Customer.LastOrder)
	}
	if result.Customer.LastOrder.Fulfillments[0].TrackingInfo[0].Number != "9400" {
		t.Fatalf("customer last order tracking was not parsed: %#v", result.Customer.LastOrder)
	}
	if result.Customer.LastOrder.Fulfillments[0].DisplayStatus != "IN_TRANSIT" {
		t.Fatalf("customer last order fulfillment status was not parsed: %#v", result.Customer.LastOrder)
	}
	if result.Customer.LastOrder.Total.Amount != "61.00" || result.Customer.LastOrder.Total.CurrencyCode != "CAD" || result.Customer.LastOrder.ProductSubtotal.Amount != "56.00" || result.Customer.LastOrder.AdditionalFees.Amount != "5.00" || result.Customer.LastOrder.ShippingAddress.Phone != "+15557654321" {
		t.Fatalf("customer last order amount or contact details were not parsed: %#v", result.Customer.LastOrder)
	}
}

func TestShopifyAdminClientGetsCustomerByID(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Query     string         `json:"query"`
			Variables map[string]any `json:"variables"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request failed: %v", err)
		}
		if !strings.Contains(payload.Query, "customer(id: $id)") || payload.Variables["id"] != "gid://shopify/Customer/8173975273657" {
			t.Fatalf("unexpected customer by ID query: %#v", payload)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"customer":{"id":"gid://shopify/Customer/8173975273657","displayName":"Mia Customer","createdAt":"2026-01-02T03:04:05Z","verifiedEmail":true,"defaultEmailAddress":{"emailAddress":"mia@example.com"},"defaultPhoneNumber":{"phoneNumber":"+15551234567"},"defaultAddress":{"formattedArea":"Austin, TX"}}}}`))
	}))
	defer server.Close()

	client := shopifyAdminClient{HTTPClient: server.Client(), BaseURL: server.URL}
	result, err := client.GetCustomer(t.Context(), "demo.myshopify.com", "shpat_test", "8173975273657")
	if err != nil {
		t.Fatalf("GetCustomer failed: %v", err)
	}
	if result.Customer == nil || result.Customer.DisplayName != "Mia Customer" || result.Customer.Email != "mia@example.com" || result.Customer.Phone != "+15551234567" {
		t.Fatalf("unexpected customer by ID result: %#v", result)
	}
}

func TestShopifyAdminClientSearchCustomerRejectsNonExactEmail(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"data": {"customers": {"edges": [{"node": {
				"id": "gid://shopify/Customer/4",
				"displayName": "Wrong Customer",
				"defaultEmailAddress": {"emailAddress": "other@example.com"},
				"createdAt": "2026-01-02T03:04:05Z",
				"verifiedEmail": true,
				"tags": [],
				"amountSpent": {"amount": "0", "currencyCode": "USD"},
				"lastOrder": null
			}}]}}
		}`))
	}))
	defer server.Close()

	client := shopifyAdminClient{HTTPClient: server.Client(), BaseURL: server.URL}
	result, err := client.SearchCustomer(t.Context(), "demo.myshopify.com", "shpat_test", "mia@example.com")
	if err != nil {
		t.Fatalf("SearchCustomer failed: %v", err)
	}
	if result.Customer != nil {
		t.Fatalf("non-exact customer must not be returned: %#v", result.Customer)
	}
}

type shopifyCustomerCacheTestStore struct {
	Store
	entries map[string]externalCacheEntry
}

func (s *shopifyCustomerCacheTestStore) GetExternalCache(_ context.Context, key string) (externalCacheEntry, error) {
	entry, ok := s.entries[key]
	if !ok {
		return externalCacheEntry{}, ErrNotFound
	}
	return entry, nil
}

func (s *shopifyCustomerCacheTestStore) SaveExternalCache(_ context.Context, key string, _ string, _ string, payload []byte, fetchedAt time.Time, expiresAt time.Time) error {
	if s.entries == nil {
		s.entries = make(map[string]externalCacheEntry)
	}
	s.entries[key] = externalCacheEntry{Payload: append([]byte(nil), payload...), FetchedAt: fetchedAt, ExpiresAt: expiresAt}
	return nil
}

func (s *shopifyCustomerCacheTestStore) DeleteExpiredExternalCache(_ context.Context, _ time.Time) (int, error) {
	return 0, nil
}

func TestShopifyCustomerCachePreservesLatestOrder(t *testing.T) {
	store := &shopifyCustomerCacheTestStore{Store: NewMemoryStore(), entries: make(map[string]externalCacheEntry)}
	server := NewServer(store)
	key := externalCacheKey(shopifyCustomerCacheNamespace, "shop-1", "mia@example.com")
	want := ShopifyCustomerSearchResult{Customer: &ShopifyCustomerProfile{
		ID:          "gid://shopify/Customer/3",
		DisplayName: "Mia Customer",
		Email:       "mia@example.com",
		LastOrder: &ShopifyLastOrder{
			ID:   "gid://shopify/Order/99",
			Name: "#1099",
		},
	}}

	server.saveExternalCache(t.Context(), shopifyCustomerCacheNamespace, "shop-1", key, want, shopifyCustomerCacheTTL)
	got, ok := server.loadShopifyCustomerCache(t.Context(), key)
	if !ok || got.Customer == nil || got.Customer.DisplayName != "Mia Customer" || got.Customer.LastOrder == nil || got.Customer.LastOrder.Name != "#1099" {
		t.Fatalf("cached customer latest order was not preserved: ok=%v result=%#v", ok, got)
	}
}

func TestShopifyBusinessDataCacheTTLsAreDaily(t *testing.T) {
	if shopifyProductRecommendationTTL != 24*time.Hour {
		t.Fatalf("product recommendation TTL = %s, want 24h", shopifyProductRecommendationTTL)
	}
	if shopifyProductSearchCacheTTL != 24*time.Hour {
		t.Fatalf("product search TTL = %s, want 24h", shopifyProductSearchCacheTTL)
	}
	if shopifyCustomerCacheTTL != 24*time.Hour {
		t.Fatalf("customer cache TTL = %s, want 24h", shopifyCustomerCacheTTL)
	}
	if shopifyOrderCacheTTL != 24*time.Hour {
		t.Fatalf("order cache TTL = %s, want 24h", shopifyOrderCacheTTL)
	}
}
