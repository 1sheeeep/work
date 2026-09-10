package installations

import (
	"bytes"
	"os"
	"testing"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

// This fixture is copied only into disposable git archives by the local runner.
// The key and every record are synthetic; no runtime configuration is loaded.
func TestConnectorArchiveRehearsal(t *testing.T) {
	path := os.Getenv("ERP_SYNTHETIC_REHEARSAL_FILE")
	if path == "" {
		t.Fatal("synthetic file required")
	}
	phase := os.Getenv("ERP_SYNTHETIC_REHEARSAL_PHASE")
	before, _ := os.ReadFile(path)
	repository, err := OpenFileRepository(path, bytes.Repeat([]byte{7}, 32))
	if err != nil {
		t.Fatal("synthetic repository open failed")
	}
	binding := Binding{Identity: identity(), LegacyShopID: "rollback-synthetic", ShopDomain: "legacy-fixture.myshopify.com"}
	switch phase {
	case "seed-old":
		now := time.Date(2026, 9, 7, 12, 0, 0, 0, time.UTC)
		err = repository.CompleteInstallation(t.Context(), binding, InstallationRecord{
			Binding: binding, AccessToken: "synthetic-not-a-provider-token", Scopes: []string{"read_orders"},
			State: shopifyconnector.InstallationStateInstalled, InstalledAt: now, UpdatedAt: now,
		})
	case "read", "write-old":
		record, readErr := repository.GetInstallation(t.Context(), identity())
		if readErr != nil || record.ShopDomain != binding.ShopDomain || record.AccessToken != "synthetic-not-a-provider-token" {
			t.Fatal("legacy synthetic installation was not preserved")
		}
		if phase == "write-old" {
			err = repository.SaveBinding(t.Context(), binding)
		}
	default:
		t.Fatal("unexpected rehearsal phase")
	}
	if err != nil {
		t.Fatal("synthetic mutation failed")
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal("synthetic file missing")
	}
	if phase == "read" && !bytes.Equal(before, after) {
		t.Fatal("read unexpectedly changed encrypted file")
	}
	if bytes.Contains(after, []byte("synthetic-not-a-provider-token")) {
		t.Fatal("plaintext persisted")
	}
}
