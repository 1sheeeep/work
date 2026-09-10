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

func TestCurrentInstallationCheckStrictProviderResponses(t *testing.T) {
	valid := `{"data":{"currentAppInstallation":{"id":"gid://shopify/AppInstallation/123"},"shop":{"myshopifyDomain":"demo.myshopify.com"}}}`
	for _, tc := range []struct {
		name             string
		status           int
		body             string
		active, rejected bool
	}{
		{"active", 200, valid, true, false},
		{"token-rejected", 401, `{"error":"synthetic-provider-secret"}`, false, true},
		{"forbidden-is-unknown", 403, `{"error":"synthetic-provider-secret"}`, false, false},
		{"rate-limit-is-unknown", 429, `{"error":"synthetic-provider-secret"}`, false, false},
		{"outage-is-unknown", 503, `{"error":"synthetic-provider-secret"}`, false, false},
		{"null-is-not-absence", 200, `{"data":{"currentAppInstallation":null}}`, false, false},
		{"wrong-shop", 200, strings.ReplaceAll(valid, "demo.myshopify.com", "other.myshopify.com"), false, false},
		{"wrong-gid", 200, strings.ReplaceAll(valid, "AppInstallation/123", "Shop/123"), false, false},
		{"invalid-id", 200, strings.ReplaceAll(valid, "AppInstallation/123", "AppInstallation/invalid"), false, false},
		{"partial-errors", 200, `{"data":{"currentAppInstallation":{"id":"gid://shopify/AppInstallation/123"}},"errors":[{"message":"synthetic-provider-secret"}]}`, false, false},
		{"invalid-json", 200, `synthetic-provider-secret`, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "POST" || r.Header.Get("X-Shopify-Access-Token") != "synthetic-access" {
					t.Error("incorrect installation probe authentication")
				}
				var body struct {
					Query string `json:"query"`
				}
				if json.NewDecoder(r.Body).Decode(&body) != nil || body.Query != currentInstallationQuery || strings.Contains(body.Query, "mutation") {
					t.Error("probe was not the fixed read-only query")
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()
			client, err := newClient("2026-07", server.URL, server.Client())
			if err != nil {
				t.Fatal(err)
			}
			err = client.CheckCurrentInstallation(t.Context(), "demo.myshopify.com", "synthetic-access")
			if (err == nil) != tc.active || errors.Is(err, shopifyconnector.ErrProviderTokenRejected) != tc.rejected {
				t.Fatalf("unexpected response classification: %v", err)
			}
			if err != nil && strings.Contains(err.Error(), "synthetic") {
				t.Fatal("provider content leaked")
			}
			if tc.rejected && !errors.Is(err, shopifyconnector.ErrProviderAuthorization) {
				t.Fatal("existing authorization error compatibility lost")
			}
		})
	}
}
