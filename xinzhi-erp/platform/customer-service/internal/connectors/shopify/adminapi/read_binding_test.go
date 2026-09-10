package adminapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const bindingFactsJSON = `{"data":{"shop":{"id":"gid://shopify/Shop/123","name":"Synthetic shop","myshopifyDomain":"synthetic-preparation.myshopify.com"},"currentAppInstallation":{"id":"gid://shopify/AppInstallation/456","app":{"apiKey":"synthetic-app-1"},"accessScopes":[{"handle":"write_orders"},{"handle":"read_products"}]}}}`

func TestReadBindingFactsQueriesCurrentInstallationWithoutMutation(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Query string `json:"query"`
		}
		if r.Method != "POST" || r.Header.Get("X-Shopify-Access-Token") != "synthetic-owner-token" || json.NewDecoder(r.Body).Decode(&body) != nil {
			t.Error("invalid read request")
		}
		if body.Query != readBindingQuery || strings.Contains(strings.ToLower(body.Query), "mutation") {
			t.Error("unexpected operation")
		}
		_, _ = w.Write([]byte(bindingFactsJSON))
	}))
	defer s.Close()
	c, err := newClient("2026-07", s.URL, s.Client())
	if err != nil {
		t.Fatal(err)
	}
	facts, err := c.FetchReadBindingFacts(t.Context(), "synthetic-preparation.myshopify.com", "synthetic-owner-token")
	if err != nil || facts.ShopID != "gid://shopify/Shop/123" || facts.InstallationID != "gid://shopify/AppInstallation/456" || facts.AppClientID != "synthetic-app-1" || strings.Join(facts.GrantedScopes, ",") != "read_products,write_orders" {
		t.Fatalf("invalid facts: %v", err)
	}
}

func TestReadBindingFactsRejectsIncompleteOrWrongLiveEvidence(t *testing.T) {
	for name, body := range map[string]string{
		"missing installation": `{"data":{"shop":{"id":"gid://shopify/Shop/123","name":"Synthetic shop","myshopifyDomain":"synthetic-preparation.myshopify.com"}}}`,
		"missing scopes":       strings.ReplaceAll(bindingFactsJSON, `"accessScopes":[{"handle":"write_orders"},{"handle":"read_products"}]`, `"accessScopes":null`),
		"wrong domain":         strings.ReplaceAll(bindingFactsJSON, "synthetic-preparation.myshopify.com", "other.myshopify.com"),
		"wrong shop gid":       strings.ReplaceAll(bindingFactsJSON, "Shop/123", "Order/123"),
		"zero install gid":     strings.ReplaceAll(bindingFactsJSON, "AppInstallation/456", "AppInstallation/0"),
		"missing app":          strings.ReplaceAll(bindingFactsJSON, `{"apiKey":"synthetic-app-1"}`, "null"),
		"duplicate scope":      strings.ReplaceAll(bindingFactsJSON, "read_products", "write_orders"),
		"malformed scope":      strings.ReplaceAll(bindingFactsJSON, "read_products", "read products"),
		"upstream error":       `{"errors":[{"message":"synthetic-secret-do-not-return"}]}`,
	} {
		t.Run(name, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(body)) }))
			defer s.Close()
			c, _ := newClient("2026-07", s.URL, s.Client())
			_, err := c.FetchReadBindingFacts(t.Context(), "synthetic-preparation.myshopify.com", "synthetic-owner-token")
			if err == nil || strings.Contains(err.Error(), "synthetic-secret") {
				t.Fatal("invalid live evidence accepted or leaked")
			}
		})
	}
}

func TestReadBindingFactsPreservesAuthoritativeEmptyScopes(t *testing.T) {
	body := strings.ReplaceAll(bindingFactsJSON, `[{"handle":"write_orders"},{"handle":"read_products"}]`, `[]`)
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(body)) }))
	defer s.Close()
	c, _ := newClient("2026-07", s.URL, s.Client())
	facts, err := c.FetchReadBindingFacts(t.Context(), "synthetic-preparation.myshopify.com", "synthetic-owner-token")
	if err != nil || facts.GrantedScopes == nil || len(facts.GrantedScopes) != 0 {
		t.Fatal("empty grants confused with unknown grants")
	}
}
