package platform

import (
	"testing"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

func TestERPManagedShopifyConnectionStatusUsesConnectorFactsWithoutCredentials(t *testing.T) {
	checkedAt := time.Date(2026, time.August, 2, 6, 30, 0, 0, time.UTC)
	status := erpManagedShopifyConnectionStatus(shopifyconnector.ConnectionSummary{
		State:         shopifyconnector.ConnectionStateConnected,
		GrantedScopes: []string{"read_orders", "read_themes"},
		ShopName:      "ERP Store",
		ShopDomain:    "erp-store.myshopify.com",
		CheckedAt:     checkedAt,
	}, "fallback.myshopify.com")

	if status.State != "installed" || status.ShopDomain != "erp-store.myshopify.com" ||
		status.AppDeployStatus != ShopifyAppDeployReady || status.ThemeEmbedState != shopifyThemeEmbedUnavailable ||
		status.CheckedAt != checkedAt || status.Scope != "read_orders,read_themes" {
		t.Fatalf("unexpected ERP-managed Shopify status: %+v", status)
	}
}

func TestERPManagedShopifySourceDetectionIsExplicit(t *testing.T) {
	if !isERPManagedShopifySource([]ShopSource{{
		Type:     SourceTypeShopifyAPI,
		Metadata: map[string]string{"connectionMode": "xz_erp_app"},
	}}) {
		t.Fatal("expected ERP-managed source")
	}
	if isERPManagedShopifySource([]ShopSource{{
		Type:     SourceTypeShopifyAPI,
		Metadata: map[string]string{"connectionMode": "deterministic_fake"},
	}}) {
		t.Fatal("local demo source must not use the real ERP connector status path")
	}
}
