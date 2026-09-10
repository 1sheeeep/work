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

const (
	productTestTenant = "11111111-1111-4111-8111-111111111111"
	productTestShop   = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
)

func TestClientFetchProductCatalogPaginatesAllVariantsReadOnly(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Method != http.MethodPost || r.Header.Get("X-Shopify-Access-Token") != "shpat_connector_owned" {
			t.Fatalf("unexpected provider request method=%s token=%q", r.Method, r.Header.Get("X-Shopify-Access-Token"))
		}
		var payload struct {
			Query     string         `json:"query"`
			Variables map[string]any `json:"variables"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode provider request: %v", err)
		}
		normalized := strings.ToLower(strings.TrimSpace(payload.Query))
		if !strings.HasPrefix(normalized, "query ") || strings.Contains(normalized, "mutation") {
			t.Fatalf("product catalog operation is not read-only: %s", payload.Query)
		}
		w.Header().Set("Content-Type", "application/json")
		switch requests {
		case 1:
			if !strings.Contains(payload.Query, "query XZERPProductCatalogPage") ||
				payload.Variables["first"] != float64(25) || payload.Variables["after"] != "outer==" ||
				payload.Variables["query"] != "status:active" {
				t.Fatalf("unexpected product page request: %#v", payload)
			}
			_, _ = w.Write([]byte(`{"data":{"shop":{"currencyCode":"USD"},"products":{"pageInfo":{"hasNextPage":false,"endCursor":"done=="},"edges":[{"node":{"id":"gid://shopify/Product/100","legacyResourceId":100,"title":"Catalog Hoodie","handle":"catalog-hoodie","status":"ACTIVE","vendor":"XZ","productType":"Apparel","updatedAt":"2026-08-01T00:00:00Z","variants":{"pageInfo":{"hasNextPage":true,"endCursor":"variant-100"},"edges":[{"node":{"id":"gid://shopify/ProductVariant/1","title":"First","price":"39.90","availableForSale":true}}]}}}]}}}`))
		case 2:
			if !strings.Contains(payload.Query, "query XZERPProductVariantPage") ||
				payload.Variables["id"] != "gid://shopify/Product/100" || payload.Variables["after"] != "variant-100" {
				t.Fatalf("unexpected variant page request: %#v", payload)
			}
			_, _ = w.Write([]byte(`{"data":{"product":{"variants":{"pageInfo":{"hasNextPage":false,"endCursor":"variant-101"},"edges":[{"node":{"id":"gid://shopify/ProductVariant/2","title":"Second","price":"39.90","inventoryItem":{"id":"gid://shopify/InventoryItem/3","tracked":true}}}]}}}}`))
		default:
			t.Fatalf("unexpected provider request %d", requests)
		}
	}))
	defer server.Close()
	client, err := newClient("2026-07", server.URL, server.Client())
	if err != nil {
		t.Fatalf("newClient failed: %v", err)
	}
	request := productRequest("provider-product")
	request.Limit = 25
	request.Cursor = "outer=="
	request.Query = "status:active"

	page, err := client.FetchProductCatalogPage(t.Context(), "catalog.myshopify.com", "shpat_connector_owned", request)
	if err != nil {
		t.Fatalf("FetchProductCatalogPage failed: %v", err)
	}
	if requests != 2 || len(page.Products) != 1 || len(page.Products[0].Variants) != 2 ||
		page.Products[0].Variants[1].InventoryItemID != "gid://shopify/InventoryItem/3" {
		t.Fatalf("variant pages were not completely merged: requests=%d page=%#v", requests, page)
	}
}

func TestClientRejectsMissingAndRepeatedVariantCursor(t *testing.T) {
	tests := map[string]func(int) string{
		"missing": func(_ int) string {
			return `{"data":{"shop":{"currencyCode":"USD"},"products":{"pageInfo":{"hasNextPage":false},"edges":[{"node":{"id":"gid://shopify/Product/1","title":"Product","variants":{"pageInfo":{"hasNextPage":true},"edges":[]}}}]}}}`
		},
		"repeated": func(call int) string {
			if call == 1 {
				return `{"data":{"shop":{"currencyCode":"USD"},"products":{"pageInfo":{"hasNextPage":false},"edges":[{"node":{"id":"gid://shopify/Product/1","title":"Product","variants":{"pageInfo":{"hasNextPage":true,"endCursor":"loop=="},"edges":[]}}}]}}}`
			}
			return `{"data":{"product":{"variants":{"pageInfo":{"hasNextPage":true,"endCursor":"loop=="},"edges":[]}}}}`
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
			client, err := newClient("2026-07", server.URL, server.Client())
			if err != nil {
				t.Fatalf("newClient failed: %v", err)
			}
			_, err = client.FetchProductCatalogPage(t.Context(), "catalog.myshopify.com", "shpat_connector_owned", productRequest("cursor-"+name))
			if !errors.Is(err, errProductVariantsIncomplete) {
				t.Fatalf("incomplete pagination did not fail closed: calls=%d err=%v", calls, err)
			}
		})
	}
}

func TestClientRejectsMissingProviderResponseShape(t *testing.T) {
	responses := map[string]string{
		"shop":              `{"data":{"products":{"pageInfo":{"hasNextPage":false},"edges":[]}}}`,
		"products":          `{"data":{"shop":{"currencyCode":"USD"}}}`,
		"product page info": `{"data":{"shop":{"currencyCode":"USD"},"products":{"edges":[]}}}`,
		"product edges":     `{"data":{"shop":{"currencyCode":"USD"},"products":{"pageInfo":{"hasNextPage":false}}}}`,
		"variants":          `{"data":{"shop":{"currencyCode":"USD"},"products":{"pageInfo":{"hasNextPage":false},"edges":[{"node":{"id":"gid://shopify/Product/1","title":"Product"}}]}}}`,
		"variant page info": `{"data":{"shop":{"currencyCode":"USD"},"products":{"pageInfo":{"hasNextPage":false},"edges":[{"node":{"id":"gid://shopify/Product/1","title":"Product","variants":{"edges":[]}}}]}}}`,
		"variant edges":     `{"data":{"shop":{"currencyCode":"USD"},"products":{"pageInfo":{"hasNextPage":false},"edges":[{"node":{"id":"gid://shopify/Product/1","title":"Product","variants":{"pageInfo":{"hasNextPage":false}}}}]}}}`,
	}
	for name, response := range responses {
		t.Run(name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				_, _ = w.Write([]byte(response))
			}))
			defer server.Close()
			client, err := newClient("2026-07", server.URL, server.Client())
			if err != nil {
				t.Fatalf("newClient failed: %v", err)
			}
			if _, err := client.FetchProductCatalogPage(t.Context(), "catalog.myshopify.com", "shpat_connector_owned", productRequest("shape-"+name)); err == nil {
				t.Fatal("missing provider response shape was accepted")
			}
		})
	}
}

func TestClientRejectsInvalidConfigurationAndRedirects(t *testing.T) {
	if _, err := NewClient("latest", http.DefaultClient); err == nil {
		t.Fatal("invalid Admin API version was accepted")
	}
	redirectTargetCalls := 0
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		redirectTargetCalls++
	}))
	defer target.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer redirect.Close()
	client, err := newClient("2026-07", redirect.URL, redirect.Client())
	if err != nil {
		t.Fatalf("newClient failed: %v", err)
	}
	_, err = client.FetchProductCatalogPage(t.Context(), "catalog.myshopify.com", "shpat_connector_owned", productRequest("redirect"))
	if err == nil || redirectTargetCalls != 0 {
		t.Fatalf("provider redirect was followed: calls=%d err=%v", redirectTargetCalls, err)
	}
}

func TestGraphQLErrorKeepsOnlyBoundedSafeDiagnosticFields(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":null,"errors":[{"message":"provider detail shpat_must_not_escape","extensions":{"code":"undefinedField","typeName":"ReturnLineItem","fieldName":"returnReasonDefinition"}}]}`))
	}))
	defer server.Close()
	client, err := newClient("2026-07", server.URL, server.Client())
	if err != nil {
		t.Fatalf("newClient failed: %v", err)
	}

	var data map[string]any
	err = client.queryGraphQL(t.Context(), "catalog.myshopify.com", "shpat_connector_owned", "query SafeDiagnostic { shop { name } }", map[string]any{}, &data)
	if err == nil || strings.Contains(err.Error(), "provider detail") || strings.Contains(err.Error(), "shpat_") {
		t.Fatalf("provider GraphQL detail leaked: %v", err)
	}
	var safeDiagnostic interface{ SafeDiagnostic() string }
	if !errors.As(err, &safeDiagnostic) || safeDiagnostic.SafeDiagnostic() != "graphql_undefinedField_ReturnLineItem_returnReasonDefinition" {
		t.Fatalf("safe GraphQL diagnostic missing: %v", err)
	}
}

func productRequest(correlationID string) shopifyconnector.ProductCatalogPageRequest {
	return shopifyconnector.ProductCatalogPageRequest{
		Identity: shopifyconnector.CanonicalShopIdentity{TenantID: productTestTenant, ShopID: productTestShop},
		Context:  shopifyconnector.RequestContext{CorrelationID: correlationID, RequestID: "request-product"},
		Limit:    50,
	}
}
