package main

import (
	"bytes"
	"encoding/base64"
	"path/filepath"
	"testing"

	shopifyinstallations "shopify-support-platform/internal/connectors/shopify/installations"
)

func TestRuntimeConfigurationUsesExistingConnectorTokenAndRequiresEncryptedRepository(t *testing.T) {
	t.Setenv("XZ_ERP_CONNECTOR_TOKEN", "")
	t.Setenv("ERP_XZ_ERP_APP_CONNECTOR_TOKEN", "erp-service-token")
	t.Setenv("SHOPIFY_APP_API_KEY", "app-key")
	t.Setenv("SHOPIFY_APP_API_SECRET", "app-secret")
	t.Setenv("SHOPIFY_APP_SCOPES", "read_orders,write_orders")
	t.Setenv("SHOPIFY_CONNECTOR_CALLBACK_URL", "https://connector.example/shopify/oauth/callback")
	t.Setenv("SHOPIFY_CONNECTOR_DATA_FILE", filepath.Join(t.TempDir(), "installations.enc"))
	t.Setenv("SHOPIFY_CONNECTOR_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0x42}, 32)))

	config, repository, err := runtimeFromEnvironment()
	if err != nil {
		t.Fatalf("runtimeFromEnvironment failed: %v", err)
	}
	if config.ServiceToken != "erp-service-token" || len(config.Scopes) != 2 || repository == nil {
		t.Fatalf("unexpected runtime configuration: config=%#v repository=%T", config, repository)
	}
}

func TestDecodeEncryptionKeyRejectsNon32ByteMaterial(t *testing.T) {
	if _, err := decodeEncryptionKey(base64.StdEncoding.EncodeToString([]byte("too-short"))); err == nil {
		t.Fatal("short encryption key was accepted")
	}
}

func TestCatalogProvidersRequireExplicitShopifyAppAPIVersion(t *testing.T) {
	t.Setenv("SHOPIFY_APP_API_VERSION", "")
	if _, err := catalogProviderFromEnvironment(); err == nil {
		t.Fatal("missing SHOPIFY_APP_API_VERSION was accepted")
	}
	t.Setenv("SHOPIFY_APP_API_VERSION", "2026-07")
	if _, err := catalogProviderFromEnvironment(); err != nil {
		t.Fatalf("valid Shopify App API version was rejected: %v", err)
	}
}

func TestRevocationEffectsRequireAnExplicitDeploymentMode(t *testing.T) {
	t.Setenv("SHOPIFY_CONNECTOR_REVOCATION_EFFECTS_MODE", "")
	if _, err := revocationEffectsFromEnvironment("service-token"); err == nil {
		t.Fatal("missing revocation effects mode was accepted")
	}

	t.Setenv("SHOPIFY_CONNECTOR_REVOCATION_EFFECTS_MODE", "connector-only")
	effects, err := revocationEffectsFromEnvironment("service-token")
	if err != nil {
		t.Fatalf("connector-only revocation effects were rejected: %v", err)
	}
	if _, ok := effects.(*shopifyinstallations.ConnectorOnlyRevocationEffects); !ok {
		t.Fatalf("unexpected connector-only effects implementation: %T", effects)
	}

	t.Setenv("SHOPIFY_CONNECTOR_REVOCATION_EFFECTS_MODE", "customer-service")
	t.Setenv("XZ_CUSTOMER_SERVICE_INTERNAL_BASE_URL", "")
	if _, err := revocationEffectsFromEnvironment("service-token"); err == nil {
		t.Fatal("customer-service mode accepted a missing endpoint")
	}
}
