package adminapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

func TestChatWidgetAppDataConfigurerWritesTenantAndSelectedOrigin(t *testing.T) {
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("X-Shopify-Access-Token") != "shpat_test_secret" {
			t.Fatal("Admin API access token header was not forwarded")
		}
		var request struct {
			Query     string         `json:"query"`
			Variables map[string]any `json:"variables"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		switch calls {
		case 1:
			if !strings.Contains(request.Query, "currentAppInstallation") {
				t.Fatalf("unexpected first query: %s", request.Query)
			}
			_, _ = w.Write([]byte(`{"data":{"currentAppInstallation":{"id":"gid://shopify/AppInstallation/99"}}}`))
		case 2:
			if !strings.Contains(request.Query, "metafieldsSet") {
				t.Fatalf("unexpected second query: %s", request.Query)
			}
			raw, _ := json.Marshal(request.Variables)
			value := string(raw)
			for _, required := range []string{
				`"value":"https://kf-uat.xzkj.ai"`,
				`"value":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"`,
				`"ownerId":"gid://shopify/AppInstallation/99"`,
			} {
				if !strings.Contains(value, required) {
					t.Fatalf("metafield input is missing %s: %s", required, value)
				}
			}
			_, _ = w.Write([]byte(`{"data":{"metafieldsSet":{"metafields":[{"namespace":"xinzhi_support","key":"service_origin","value":"https://kf-uat.xzkj.ai"},{"namespace":"xinzhi_support","key":"tenant_id","value":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}],"userErrors":[]}}}`))
		default:
			t.Fatalf("unexpected Admin API call %d", calls)
		}
	}))
	defer server.Close()

	client, err := newClient("2026-07", server.URL, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	configurer, err := NewChatWidgetAppDataConfigurer(
		client,
		"https://kf.xzkj.ai",
		"review-store.myshopify.com=https://kf-uat.xzkj.ai",
	)
	if err != nil {
		t.Fatal(err)
	}
	err = configurer.ConfigureInstallationAppData(
		t.Context(),
		"review-store.myshopify.com",
		"shpat_test_secret",
		shopifyconnector.CanonicalShopIdentity{
			TenantID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
			ShopID:   "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
		},
	)
	if err != nil {
		t.Fatalf("ConfigureInstallationAppData failed: %v", err)
	}
	if calls != 2 {
		t.Fatalf("Admin API calls=%d want=2", calls)
	}
}

func TestChatWidgetAppDataConfigurerRejectsUnsafeConfiguration(t *testing.T) {
	client, err := newClient("2026-07", "https://admin.example.test/graphql", http.DefaultClient)
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		origin    string
		overrides string
	}{
		{origin: "http://kf.xzkj.ai"},
		{origin: "https://kf.xzkj.ai/path"},
		{origin: "https://kf.xzkj.ai", overrides: "not-shopify.example=https://kf-uat.xzkj.ai"},
		{origin: "https://kf.xzkj.ai", overrides: "demo.myshopify.com=http://kf-uat.xzkj.ai"},
		{origin: "https://kf.xzkj.ai", overrides: "demo.myshopify.com=https://one.example,demo.myshopify.com=https://two.example"},
	} {
		if _, err := NewChatWidgetAppDataConfigurer(client, test.origin, test.overrides); err == nil {
			t.Fatalf("unsafe config was accepted: origin=%q overrides=%q", test.origin, test.overrides)
		}
	}
}

func TestChatWidgetAppDataConfigurerRedactsProviderUserError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Query string `json:"query"`
		}
		_ = json.NewDecoder(r.Body).Decode(&request)
		if strings.Contains(request.Query, "currentAppInstallation") {
			_, _ = w.Write([]byte(`{"data":{"currentAppInstallation":{"id":"gid://shopify/AppInstallation/99"}}}`))
			return
		}
		_, _ = w.Write([]byte(`{"data":{"metafieldsSet":{"metafields":[],"userErrors":[{"code":"INVALID","field":["metafields"],"message":"provider secret detail"}]}}}`))
	}))
	defer server.Close()
	client, _ := newClient("2026-07", server.URL, server.Client())
	configurer, _ := NewChatWidgetAppDataConfigurer(client, "https://kf.xzkj.ai", "")
	err := configurer.ConfigureInstallationAppData(
		t.Context(), "demo.myshopify.com", "shpat_test_secret",
		shopifyconnector.CanonicalShopIdentity{TenantID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},
	)
	if err == nil || strings.Contains(err.Error(), "provider secret detail") || strings.Contains(err.Error(), "shpat_test_secret") {
		t.Fatalf("provider details were not safely redacted: %v", err)
	}
}

func TestChatSetupReadVerifiesBothMetafieldsAndNeverWrites(t *testing.T) {
	for _, tc := range []struct {
		name, response string
		matches, fails bool
	}{
		{"match", `{"data":{"currentAppInstallation":{"serviceOrigin":{"value":"https://support-uat.example.test"},"tenant":{"value":"tenant-fixture"}}}}`, true, false},
		{"wrong tenant", `{"data":{"currentAppInstallation":{"serviceOrigin":{"value":"https://support-uat.example.test"},"tenant":{"value":"other"}}}}`, false, false},
		{"wrong origin", `{"data":{"currentAppInstallation":{"serviceOrigin":{"value":"https://attacker.invalid"},"tenant":{"value":"tenant-fixture"}}}}`, false, false},
		{"missing data", `{"data":{"currentAppInstallation":{"serviceOrigin":null,"tenant":null}}}`, false, false},
		{"missing installation", `{"data":{"currentAppInstallation":null}}`, false, true},
		{"provider error", `{"errors":[{"message":"synthetic-provider-secret"}]}`, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				var body struct {
					Query string `json:"query"`
				}
				if json.NewDecoder(r.Body).Decode(&body) != nil || body.Query != chatWidgetAppDataQuery || strings.Contains(body.Query, "mutation") {
					t.Error("expected exact read-only app-data query")
				}
				_, _ = w.Write([]byte(tc.response))
			}))
			defer server.Close()
			client, _ := newClient("2026-07", server.URL, server.Client())
			configurer, _ := NewChatWidgetAppDataConfigurer(client, "https://support.example.test", "review.myshopify.com=https://support-uat.example.test")
			origin, matches, err := configurer.ReadInstallationChatSetup(t.Context(), "review.myshopify.com", "synthetic-access-token", shopifyconnector.CanonicalShopIdentity{TenantID: "tenant-fixture"})
			if matches != tc.matches || (err != nil) != tc.fails || calls != 1 {
				t.Fatalf("unexpected match=%v failure=%v calls=%d", matches, err != nil, calls)
			}
			if matches && origin != "https://support-uat.example.test" || !matches && origin != "" {
				t.Fatal("unverified or incorrect service destination")
			}
			if err != nil && strings.Contains(err.Error(), "synthetic-provider-secret") {
				t.Fatal("raw provider error exposed")
			}
		})
	}
}
