package platform

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestIndependentShopifyAppPublishingAPIsAreNotRouted(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	for _, target := range []struct {
		method string
		path   string
	}{
		{method: http.MethodPost, path: "/api/v1/shopify/onboarding"},
		{method: http.MethodGet, path: "/api/v1/shops/missing/shopify/app-profile"},
		{method: http.MethodPost, path: "/api/v1/shops/missing/shopify/app-profile/deploy"},
	} {
		request, err := http.NewRequest(target.method, server.URL+target.path, strings.NewReader(`{}`))
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Authorization", "Bearer "+adminToken)
		request.Header.Set("Content-Type", "application/json")
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		_ = response.Body.Close()
		if response.StatusCode != http.StatusNotFound && response.StatusCode != http.StatusMethodNotAllowed {
			t.Fatalf("%s %s status=%d, want an unrouted 404/405", target.method, target.path, response.StatusCode)
		}
	}
}

func TestXinzhiSupportChatExtensionUsesThemeSettingsForStorefrontAppearance(t *testing.T) {
	extensionDir := filepath.Join("..", "..", "extensions", "xinzhi-support-chat")
	liquidBytes, err := os.ReadFile(filepath.Join(extensionDir, "blocks", "xinzhi-chat.liquid"))
	if err != nil {
		t.Fatal(err)
	}
	liquid := string(liquidBytes)
	for _, required := range []string{
		`app.metafields.xinzhi_support.service_origin.value`,
		`app.metafields.xinzhi_support.tenant_id.value`,
		`data-shop="{{ shop_reference | escape }}"`,
		`data-tenant-id="{{ tenant_id | escape }}"`,
		`data-storefront-login-url="{{ storefront_login_url | escape }}"`,
		`data-featured-products-enabled="{{ block.settings.show_featured_products }}"`,
		`data-greeting-message="{{ block.settings.greeting_message | escape }}"`,
		`data-launcher-background-color="{{ block.settings.launcher_background_color }}"`,
		`/chat/widget.js`,
	} {
		if !strings.Contains(liquid, required) {
			t.Fatalf("theme extension is missing runtime contract %q", required)
		}
	}
	schemaStart := strings.Index(liquid, "{% schema %}")
	schemaEnd := strings.Index(liquid, "{% endschema %}")
	if schemaStart < 0 || schemaEnd <= schemaStart {
		t.Fatal("theme extension schema is missing")
	}
	var schema struct {
		Name     string `json:"name"`
		Settings []struct {
			Type string `json:"type"`
			ID   string `json:"id"`
		} `json:"settings"`
	}
	if err := json.Unmarshal([]byte(liquid[schemaStart+len("{% schema %}"):schemaEnd]), &schema); err != nil {
		t.Fatalf("theme extension schema is invalid: %v", err)
	}
	if schema.Name != "Support Chat" {
		t.Fatalf("theme editor embed name=%q, want Support Chat without repeating the Xinzhi ERP app name", schema.Name)
	}
	settingIDs := map[string]bool{}
	for _, setting := range schema.Settings {
		if setting.ID != "" {
			settingIDs[setting.ID] = true
		}
	}
	for _, requiredID := range []string{
		"greeting_message",
		"show_featured_products",
		"featured_products",
		"chat_background_color",
		"chat_font_color",
		"launcher_background_color",
		"launcher_text_color",
		"launcher_icon",
		"launcher_label",
		"horizontal_position",
		"vertical_position",
		"inherit_font",
		"border_radius",
	} {
		if !settingIDs[requiredID] {
			t.Fatalf("theme extension is missing Shopify setting %q", requiredID)
		}
	}
	for _, schemaLocale := range []string{"en.default.schema.json", "zh-CN.schema.json"} {
		contents, err := os.ReadFile(filepath.Join(extensionDir, "locales", schemaLocale))
		if err != nil {
			t.Fatalf("theme setting locale is missing: %s: %v", schemaLocale, err)
		}
		var locale map[string]any
		if err := json.Unmarshal(contents, &locale); err != nil {
			t.Fatalf("theme setting locale is invalid: %s: %v", schemaLocale, err)
		}
	}
}

func TestCustomerServiceVisitorSchemesDoNotOverrideShopifyThemeAppearance(t *testing.T) {
	for _, target := range []string{
		filepath.Join("visitor_schemes.go"),
		filepath.Join("static", "chat-widget.js"),
		filepath.Join("..", "..", "frontend", "src", "features", "visitor-schemes", "VisitorSchemesPanel.tsx"),
	} {
		contents, err := os.ReadFile(target)
		if err != nil {
			t.Fatal(err)
		}
		for _, forbidden := range []string{"VisitorWidgetSettings", "widgetGreetingMessage", "visitor-widget-settings"} {
			if strings.Contains(string(contents), forbidden) {
				t.Fatalf("customer-service visitor scheme %s still duplicates Shopify appearance setting %q", target, forbidden)
			}
		}
	}
}

func TestXinzhiSupportChatWidgetCarriesTenantRoutingAcrossPublicRequests(t *testing.T) {
	widget, err := os.ReadFile(filepath.Join("static", "chat-widget.js"))
	if err != nil {
		t.Fatal(err)
	}
	script := string(widget)
	for _, required := range []string{
		`var tenantId = String(dataset.tenantId || "").trim()`,
		`target.searchParams.set("tenant", tenantId)`,
		`sessionURL.searchParams.set("tenant", tenantId)`,
		`socketUrl.searchParams.set("tenant", tenantId)`,
	} {
		if !strings.Contains(script, required) {
			t.Fatalf("widget is missing tenant-safe public routing contract %q", required)
		}
	}
}
