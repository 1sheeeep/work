package adminapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

func TestClientFetchCustomerCatalogPageIsReadOnlyAndComplete(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("X-Shopify-Access-Token") != "shpat_customer" {
			t.Fatalf("unexpected provider request method=%s token=%q", r.Method, r.Header.Get("X-Shopify-Access-Token"))
		}
		var payload struct {
			Query     string         `json:"query"`
			Variables map[string]any `json:"variables"`
		}
		if json.NewDecoder(r.Body).Decode(&payload) != nil || strings.Contains(strings.ToLower(payload.Query), "mutation") {
			t.Fatalf("invalid or non-read-only customer operation: %#v", payload)
		}
		if !strings.Contains(payload.Query, "query XZERPCustomerCatalogPage") ||
			payload.Variables["first"] != float64(20) || payload.Variables["after"] != "customer==" ||
			payload.Variables["query"] != "mia@example.com" || payload.Variables["sortKey"] != "RELEVANCE" {
			t.Fatalf("unexpected customer page request: %#v", payload)
		}
		_, _ = w.Write([]byte(`{"data":{"customers":{"pageInfo":{"hasNextPage":false,"endCursor":"customer-1"},"edges":[{"node":{"id":"gid://shopify/Customer/1","legacyResourceId":"1","displayName":"Mia Customer","createdAt":"2026-01-02T03:04:05Z","updatedAt":"2026-08-14T05:06:07Z","verifiedEmail":true,"tags":["VIP"],"numberOfOrders":"3","amountSpent":{"amount":"120.50","currencyCode":"USD"},"defaultEmailAddress":{"emailAddress":"mia@example.com"},"defaultPhoneNumber":{"phoneNumber":"+15551234567"},"defaultAddress":{"city":"Austin","province":"Texas","country":"United States","countryCode":"US"},"lastOrder":{"id":"gid://shopify/Order/9","name":"#1009","createdAt":"2026-08-10T01:02:03Z","displayFinancialStatus":"PAID","displayFulfillmentStatus":"FULFILLED","currentTotalPriceSet":{"shopMoney":{"amount":"40.00","currencyCode":"USD"}}}}}]}}}`))
	}))
	defer server.Close()
	client, err := newClient("2026-07", server.URL, server.Client())
	if err != nil {
		t.Fatalf("newClient failed: %v", err)
	}
	request := customerRequest("customer-catalog")
	request.Limit = 20
	request.Cursor = "customer=="
	request.Query = "mia@example.com"
	page, err := client.FetchCustomerCatalogPage(t.Context(), "customers.myshopify.com", "shpat_customer", request)
	if err != nil {
		t.Fatalf("FetchCustomerCatalogPage failed: %v", err)
	}
	if len(page.Customers) != 1 || page.Customers[0].Email != "mia@example.com" ||
		page.Customers[0].NumberOfOrders != "3" || page.Customers[0].LastOrder == nil ||
		page.Customers[0].LastOrder.Name != "#1009" || page.Customers[0].DefaultLocation.CountryCode != "US" {
		t.Fatalf("customer page was not normalized: %#v", page)
	}
}

func TestClientClassifiesProtectedCustomerDataDenial(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"data":{"customers":null},"errors":[{"message":"This app is not approved to use the email field","path":["customers","edges",0,"node","defaultEmailAddress"],"extensions":{"code":"ACCESS_DENIED","documentation":"https://shopify.dev/docs/apps/launch/protected-customer-data"}}]}`))
	}))
	defer server.Close()
	client, err := newClient("2026-07", server.URL, server.Client())
	if err != nil {
		t.Fatalf("newClient failed: %v", err)
	}
	_, err = client.FetchCustomerCatalogPage(t.Context(), "customers.myshopify.com", "token", customerRequest("customer-protected"))
	if !errors.Is(err, shopifyconnector.ErrProtectedCustomerDataRequired) {
		t.Fatalf("error = %v, want protected customer data classification", err)
	}
}

func customerRequest(correlationID string) shopifyconnector.CustomerCatalogPageRequest {
	return shopifyconnector.CustomerCatalogPageRequest{
		Identity: shopifyconnector.CanonicalShopIdentity{TenantID: productTestTenant, ShopID: productTestShop},
		Context:  shopifyconnector.RequestContext{CorrelationID: correlationID, RequestID: "request-customer"},
		Limit:    50,
	}
}
