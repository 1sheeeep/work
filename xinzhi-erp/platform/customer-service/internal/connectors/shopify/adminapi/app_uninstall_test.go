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

func TestClientUninstallAppUsesAuthenticatedMutation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("X-Shopify-Access-Token") != "shpat_connector_owned" {
			t.Fatalf("unexpected provider request method=%s", r.Method)
		}
		var payload struct {
			Query string `json:"query"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode uninstall request: %v", err)
		}
		if !strings.Contains(payload.Query, "mutation XZERPAppUninstall") || !strings.Contains(payload.Query, "appUninstall") {
			t.Fatalf("unexpected uninstall mutation: %s", payload.Query)
		}
		_, _ = w.Write([]byte(`{"data":{"appUninstall":{"app":{"id":"gid://shopify/App/1"},"userErrors":[]}}}`))
	}))
	defer server.Close()
	client, err := newClient("2026-07", server.URL, server.Client())
	if err != nil {
		t.Fatalf("newClient failed: %v", err)
	}
	if err := client.UninstallApp(t.Context(), "example-store.myshopify.com", "shpat_connector_owned"); err != nil {
		t.Fatalf("UninstallApp failed: %v", err)
	}
}

func TestClientUninstallAppClassifiesProviderFailures(t *testing.T) {
	for name, fixture := range map[string]struct {
		status int
		body   string
		want   error
	}{
		"already absent": {
			status: http.StatusOK,
			body:   `{"data":{"appUninstall":{"app":null,"userErrors":[{"code":"APP_NOT_INSTALLED","message":"private detail"}]}}}`,
			want:   shopifyconnector.ErrProviderAppNotInstalled,
		},
		"insufficient permission": {
			status: http.StatusOK,
			body:   `{"data":{"appUninstall":{"app":null,"userErrors":[{"code":"USER_PERMISSIONS_INSUFFICIENT","message":"private detail"}]}}}`,
			want:   shopifyconnector.ErrProviderAuthorization,
		},
		"expired token": {
			status: http.StatusUnauthorized,
			body:   `{}`,
			want:   shopifyconnector.ErrProviderAuthorization,
		},
	} {
		t.Run(name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(fixture.status)
				_, _ = w.Write([]byte(fixture.body))
			}))
			defer server.Close()
			client, err := newClient("2026-07", server.URL, server.Client())
			if err != nil {
				t.Fatalf("newClient failed: %v", err)
			}
			err = client.UninstallApp(t.Context(), "example-store.myshopify.com", "shpat_connector_owned")
			if !errors.Is(err, fixture.want) {
				t.Fatalf("expected %v, got %v", fixture.want, err)
			}
		})
	}
}
