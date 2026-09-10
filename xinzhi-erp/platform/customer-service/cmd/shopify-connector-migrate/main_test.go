package main

import (
	"bytes"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
	shopifyinstallations "shopify-support-platform/internal/connectors/shopify/installations"
)

func TestMigrationConfigRequiresExactlyOneExplicitLegacySource(t *testing.T) {
	setMinimumMigrationEnvironment(t)
	t.Setenv("SHOPIFY_LEGACY_DATA_FILE", "legacy.json")
	if _, err := configFromEnvironment(); err != nil {
		t.Fatalf("file source config rejected: %v", err)
	}
	t.Setenv("SHOPIFY_LEGACY_DATABASE_URL", "postgres://synthetic.invalid/database")
	if _, err := configFromEnvironment(); err == nil {
		t.Fatal("simultaneous legacy sources were accepted")
	}
	t.Setenv("SHOPIFY_LEGACY_DATA_FILE", "")
	if _, err := configFromEnvironment(); err != nil {
		t.Fatalf("PostgreSQL source config rejected: %v", err)
	}
	t.Setenv("SHOPIFY_LEGACY_DATABASE_URL", "")
	if _, err := configFromEnvironment(); err == nil {
		t.Fatal("missing legacy source was accepted")
	}
}

func TestMigrationConfigDoesNotUseBusinessOrFallbackCredentialEnvironment(t *testing.T) {
	setMinimumMigrationEnvironment(t)
	t.Setenv("SHOPIFY_LEGACY_DATA_FILE", "legacy.json")
	t.Setenv("AI_SETTINGS_ENCRYPTION_KEY", "must-not-be-used")
	t.Setenv("SHOPIFY_CREDENTIALS_ENCRYPTION_KEY", "must-not-be-used")
	t.Setenv("SHOPIFY_ADMIN_ACCESS_TOKEN", "shpat_must_not_be_used")
	config, err := configFromEnvironment()
	if err != nil {
		t.Fatalf("configFromEnvironment failed: %v", err)
	}
	if config.LegacyCredentialSecret != "" {
		t.Fatal("migration config used an unauthorized credential-key fallback")
	}
}

func TestWriteMigrationResultContainsOnlySafeCountsAndStatus(t *testing.T) {
	var output bytes.Buffer
	if err := writeMigrationResult(&output, shopifyinstallations.LegacyImportResult{Total: 3, Imported: 2, AlreadyImported: 1}); err != nil {
		t.Fatalf("writeMigrationResult failed: %v", err)
	}
	value := output.String()
	for _, expected := range []string{`"status":"complete"`, `"total":3`, `"imported":2`, `"alreadyImported":1`} {
		if !strings.Contains(value, expected) {
			t.Fatalf("safe output missing %s: %s", expected, value)
		}
	}
	for _, forbidden := range []string{"domain", "tenant", "shopId", "token", "key", "ciphertext", "error"} {
		if strings.Contains(strings.ToLower(value), strings.ToLower(forbidden)) {
			t.Fatalf("safe output contains forbidden field %q: %s", forbidden, value)
		}
	}
}

func TestRunMigratesSyntheticFileSnapshotIntoConnectorRepository(t *testing.T) {
	directory := t.TempDir()
	legacyPath := filepath.Join(directory, "legacy.json")
	targetPath := filepath.Join(directory, "connector.enc")
	targetKey := bytes.Repeat([]byte{0x53}, 32)
	t.Setenv("SHOPIFY_CONNECTOR_DATA_FILE", targetPath)
	t.Setenv("SHOPIFY_CONNECTOR_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(targetKey))
	t.Setenv("SHOPIFY_LEGACY_DATA_FILE", legacyPath)
	t.Setenv("SHOPIFY_LEGACY_DATABASE_URL", "")
	t.Setenv("SHOPIFY_LEGACY_CREDENTIALS_ENCRYPTION_KEY", "")
	raw := []byte(`{"shops":{"legacy-shop":{"id":"legacy-shop","metadata":{"erpTenantId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","erpCanonicalShopId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}}},"installations":{"demo.myshopify.com":{"shopId":"legacy-shop","shopDomain":"demo.myshopify.com","accessToken":"shpat_synthetic_legacy_token","scope":"read_orders,write_orders","installedAt":"2026-07-01T12:00:00Z","updatedAt":"2026-07-01T13:00:00Z"}}}`)
	if err := os.WriteFile(legacyPath, raw, 0o600); err != nil {
		t.Fatalf("write synthetic source: %v", err)
	}
	var output bytes.Buffer
	if err := run(t.Context(), &output); err != nil {
		t.Fatalf("run failed: %v", err)
	}
	if !strings.Contains(output.String(), `"status":"complete"`) || !strings.Contains(output.String(), `"imported":1`) {
		t.Fatalf("safe output mismatch: %s", output.String())
	}
	repository, err := shopifyinstallations.OpenFileRepository(targetPath, targetKey)
	if err != nil {
		t.Fatalf("open migrated target: %v", err)
	}
	record, err := repository.GetInstallation(t.Context(), shopifyconnector.CanonicalShopIdentity{
		TenantID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ShopID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
	})
	if err != nil || record.AccessToken != "shpat_synthetic_legacy_token" {
		t.Fatalf("migrated record mismatch: %#v err=%v", record, err)
	}
}

func TestRunRejectsEmptySourceWithoutSuccessOutput(t *testing.T) {
	directory := t.TempDir()
	legacyPath := filepath.Join(directory, "legacy.json")
	targetPath := filepath.Join(directory, "connector.enc")
	t.Setenv("SHOPIFY_CONNECTOR_DATA_FILE", targetPath)
	t.Setenv("SHOPIFY_CONNECTOR_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0x54}, 32)))
	t.Setenv("SHOPIFY_LEGACY_DATA_FILE", legacyPath)
	t.Setenv("SHOPIFY_LEGACY_DATABASE_URL", "")
	if err := os.WriteFile(legacyPath, []byte(`{"shops":{},"installations":{}}`), 0o600); err != nil {
		t.Fatalf("write empty synthetic source: %v", err)
	}
	var output bytes.Buffer
	if err := run(t.Context(), &output); err == nil {
		t.Fatal("empty migration source was reported as complete")
	}
	if output.Len() != 0 {
		t.Fatalf("failed migration emitted success output: %s", output.String())
	}
	if _, err := os.Stat(targetPath); !os.IsNotExist(err) {
		t.Fatalf("empty migration unexpectedly persisted a target: %v", err)
	}
}

func setMinimumMigrationEnvironment(t *testing.T) {
	t.Helper()
	for _, key := range []string{
		"SHOPIFY_LEGACY_DATA_FILE", "SHOPIFY_LEGACY_DATABASE_URL", "SHOPIFY_LEGACY_CREDENTIALS_ENCRYPTION_KEY",
		"AI_SETTINGS_ENCRYPTION_KEY", "SHOPIFY_CREDENTIALS_ENCRYPTION_KEY", "SHOPIFY_ADMIN_ACCESS_TOKEN",
	} {
		t.Setenv(key, "")
	}
	t.Setenv("SHOPIFY_CONNECTOR_DATA_FILE", "connector.enc")
	t.Setenv("SHOPIFY_CONNECTOR_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0x52}, 32)))
}
