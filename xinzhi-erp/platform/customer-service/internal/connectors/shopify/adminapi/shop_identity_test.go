package adminapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClientFetchShopIdentityUsesAuthenticatedReadOnlyQuery(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost ||
			r.Header.Get("X-Shopify-Access-Token") != "shpat_connector_owned" {
			t.Fatalf("unexpected provider request method=%s", r.Method)
		}
		var payload struct {
			Query string `json:"query"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode shop identity request: %v", err)
		}
		if !strings.Contains(payload.Query, "query XZERPShopIdentity") ||
			!strings.Contains(payload.Query, "myshopifyDomain") ||
			strings.Contains(strings.ToLower(payload.Query), "mutation") {
			t.Fatalf("unexpected shop identity query: %s", payload.Query)
		}
		_, _ = w.Write([]byte(`{"data":{"shop":{"name":"  Example Store  ","myshopifyDomain":"example-store.myshopify.com"}}}`))
	}))
	defer server.Close()
	client, err := newClient("2026-07", server.URL, server.Client())
	if err != nil {
		t.Fatalf("newClient failed: %v", err)
	}

	identity, err := client.FetchShopIdentity(
		t.Context(), "example-store.myshopify.com", "shpat_connector_owned")
	if err != nil {
		t.Fatalf("FetchShopIdentity failed: %v", err)
	}
	if identity.Name != "Example Store" ||
		identity.MyshopifyDomain != "example-store.myshopify.com" {
		t.Fatalf("unexpected identity: %#v", identity)
	}
}

func TestClientFetchShopIdentityRejectsInvalidProviderIdentity(t *testing.T) {
	for name, response := range map[string]string{
		"missing shop":   `{"data":{}}`,
		"blank name":     `{"data":{"shop":{"name":" ","myshopifyDomain":"example-store.myshopify.com"}}}`,
		"invalid domain": `{"data":{"shop":{"name":"Example","myshopifyDomain":"example.com"}}}`,
	} {
		t.Run(name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				_, _ = w.Write([]byte(response))
			}))
			defer server.Close()
			client, err := newClient("2026-07", server.URL, server.Client())
			if err != nil {
				t.Fatalf("newClient failed: %v", err)
			}
			if _, err := client.FetchShopIdentity(
				t.Context(), "example-store.myshopify.com", "shpat_connector_owned"); err == nil {
				t.Fatal("invalid shop identity was accepted")
			}
		})
	}
}
