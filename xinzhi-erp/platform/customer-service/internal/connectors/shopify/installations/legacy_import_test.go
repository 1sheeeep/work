package installations

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

func TestLegacyImportIsAtomicAndIdempotent(t *testing.T) {
	repository := NewMemoryRepository()
	records := []LegacyInstallationImport{
		legacyImport(identity(), "legacy-shop", "demo.myshopify.com", "shpat_legacy_token_one"),
		legacyImport(shopifyconnector.CanonicalShopIdentity{
			TenantID: testTenantID, ShopID: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
		}, "legacy-shop-two", "demo-two.myshopify.com", "shpat_legacy_token_two"),
	}

	result, err := repository.ImportLegacyInstallations(t.Context(), records)
	if err != nil || result.Total != 2 || result.Imported != 2 || result.AlreadyImported != 0 {
		t.Fatalf("initial import mismatch: %#v err=%v", result, err)
	}
	result, err = repository.ImportLegacyInstallations(t.Context(), records)
	if err != nil || result.Total != 2 || result.Imported != 0 || result.AlreadyImported != 2 {
		t.Fatalf("idempotent rerun mismatch: %#v err=%v", result, err)
	}
	stored, err := repository.GetInstallation(t.Context(), identity())
	if err != nil || stored.AccessToken != "shpat_legacy_token_one" || stored.State != shopifyconnector.InstallationStateInstalled {
		t.Fatalf("stored import mismatch: %#v err=%v", stored, err)
	}
}

func TestLegacyImportRejectsWholeBatchBeforeMutation(t *testing.T) {
	repository := NewMemoryRepository()
	records := []LegacyInstallationImport{
		legacyImport(identity(), "legacy-shop", "demo.myshopify.com", "shpat_legacy_token_one"),
		legacyImport(shopifyconnector.CanonicalShopIdentity{
			TenantID: testTenantID, ShopID: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
		}, "legacy-shop-two", "nested.demo.myshopify.com", "shpat_legacy_token_two"),
	}
	if _, err := repository.ImportLegacyInstallations(t.Context(), records); !errors.Is(err, ErrInvalidLegacyImport) {
		t.Fatalf("invalid batch was accepted: %v", err)
	}
	if _, err := repository.GetInstallation(t.Context(), identity()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("invalid batch partially imported its first record: %v", err)
	}
}

func TestLegacyImportPreflightRejectsEveryRequiredInvalidField(t *testing.T) {
	valid := legacyImport(identity(), "legacy-shop", "demo.myshopify.com", "shpat_legacy_token_one")
	tests := map[string]func(*LegacyInstallationImport){
		"canonical identity": func(record *LegacyInstallationImport) { record.Identity.TenantID = "not-a-uuid" },
		"legacy shop":        func(record *LegacyInstallationImport) { record.LegacyShopID = "legacy\nshop" },
		"hostname":           func(record *LegacyInstallationImport) { record.ShopDomain = "nested.demo.myshopify.com" },
		"token":              func(record *LegacyInstallationImport) { record.AccessToken = "unknown_token" },
		"scope":              func(record *LegacyInstallationImport) { record.Scopes = []string{"admin_everything"} },
		"missing timestamp":  func(record *LegacyInstallationImport) { record.InstalledAt = time.Time{} },
		"reversed timestamp": func(record *LegacyInstallationImport) { record.UpdatedAt = record.InstalledAt.Add(-time.Second) },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			repository := NewMemoryRepository()
			invalid := valid
			invalid.Scopes = append([]string(nil), valid.Scopes...)
			mutate(&invalid)
			if _, err := repository.ImportLegacyInstallations(t.Context(), []LegacyInstallationImport{invalid}); !errors.Is(err, ErrInvalidLegacyImport) {
				t.Fatalf("invalid record was accepted: %v", err)
			}
			if _, err := repository.GetInstallation(t.Context(), identity()); !errors.Is(err, ErrNotFound) {
				t.Fatalf("invalid record mutated repository: %v", err)
			}
		})
	}
}

func TestLegacyImportRejectsDuplicateBatchBindings(t *testing.T) {
	first := legacyImport(identity(), "legacy-shop", "demo.myshopify.com", "shpat_legacy_token_one")
	second := legacyImport(shopifyconnector.CanonicalShopIdentity{
		TenantID: testTenantID, ShopID: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
	}, "legacy-shop", "demo-two.myshopify.com", "shpat_legacy_token_two")
	repository := NewMemoryRepository()
	if _, err := repository.ImportLegacyInstallations(t.Context(), []LegacyInstallationImport{first, second}); !errors.Is(err, ErrLegacyImportConflict) {
		t.Fatalf("duplicate legacy binding was accepted: %v", err)
	}
	if _, err := repository.GetInstallation(t.Context(), identity()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("duplicate batch partially mutated repository: %v", err)
	}
}

func TestLegacyImportRejectsEmptyBatch(t *testing.T) {
	repository := NewMemoryRepository()
	if _, err := repository.ImportLegacyInstallations(t.Context(), nil); !errors.Is(err, ErrInvalidLegacyImport) {
		t.Fatalf("empty import was reported as complete: %v", err)
	}
}

func TestLegacyImportRejectsConflictsWithoutChangingExistingState(t *testing.T) {
	repository := NewMemoryRepository()
	existing := legacyImport(identity(), "legacy-shop", "demo.myshopify.com", "shpat_existing_token")
	if _, err := repository.ImportLegacyInstallations(t.Context(), []LegacyInstallationImport{existing}); err != nil {
		t.Fatalf("seed import failed: %v", err)
	}
	conflicting := existing
	conflicting.AccessToken = "shpat_different_token"
	if _, err := repository.ImportLegacyInstallations(t.Context(), []LegacyInstallationImport{conflicting}); !errors.Is(err, ErrLegacyImportConflict) {
		t.Fatalf("conflicting rerun was accepted: %v", err)
	}
	stored, err := repository.GetInstallation(t.Context(), identity())
	if err != nil || stored.AccessToken != existing.AccessToken {
		t.Fatalf("conflict changed existing token: %#v err=%v", stored, err)
	}
}

func TestFileRepositoryLegacyImportPersistenceFailurePublishesNothing(t *testing.T) {
	path := filepath.Join(t.TempDir(), "connector-installations.enc")
	repository, err := OpenFileRepository(path, bytes.Repeat([]byte{0x71}, 32))
	if err != nil {
		t.Fatalf("OpenFileRepository failed: %v", err)
	}
	if err := os.Mkdir(path, 0o700); err != nil {
		t.Fatalf("create blocking persistence directory: %v", err)
	}
	if _, err := repository.ImportLegacyInstallations(t.Context(), []LegacyInstallationImport{
		legacyImport(identity(), "legacy-shop", "demo.myshopify.com", "shpat_legacy_token"),
	}); err == nil {
		t.Fatal("persistence failure was reported as success")
	}
	if _, err := repository.GetInstallation(t.Context(), identity()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("failed persisted import was visible in memory: %v", err)
	}
}

func TestFileRepositoryStaleHandleCannotOverwriteMigratedGeneration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "connector-installations.enc")
	key := bytes.Repeat([]byte{0x72}, 32)
	migrator, err := OpenFileRepository(path, key)
	if err != nil {
		t.Fatalf("open migrator repository: %v", err)
	}
	staleRuntime, err := OpenFileRepository(path, key)
	if err != nil {
		t.Fatalf("open stale runtime repository: %v", err)
	}
	if _, err := migrator.ImportLegacyInstallations(t.Context(), []LegacyInstallationImport{
		legacyImport(identity(), "legacy-shop", "demo.myshopify.com", "shpat_migrated_generation"),
	}); err != nil {
		t.Fatalf("migration commit failed: %v", err)
	}
	otherIdentity := shopifyconnector.CanonicalShopIdentity{
		TenantID: testTenantID, ShopID: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
	}
	if err := staleRuntime.SaveBinding(t.Context(), Binding{
		Identity: otherIdentity, LegacyShopID: "runtime-new", ShopDomain: "runtime-new.myshopify.com",
	}); !errors.Is(err, ErrRepositoryStale) {
		t.Fatalf("stale runtime writer was not rejected: %v", err)
	}
	reopened, err := OpenFileRepository(path, key)
	if err != nil {
		t.Fatalf("reopen final repository: %v", err)
	}
	record, err := reopened.GetInstallation(t.Context(), identity())
	if err != nil || record.AccessToken != "shpat_migrated_generation" {
		t.Fatalf("stale writer overwrote migrated state: %#v err=%v", record, err)
	}
	if _, err := reopened.ResolveLegacyShopID(t.Context(), otherIdentity); !errors.Is(err, ErrNotFound) {
		t.Fatalf("stale writer unexpectedly published its binding: %v", err)
	}
}

func TestFileRepositoryStaleMigratorCannotOverwriteRuntimeGeneration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "connector-installations.enc")
	key := bytes.Repeat([]byte{0x73}, 32)
	staleMigrator, err := OpenFileRepository(path, key)
	if err != nil {
		t.Fatalf("open stale migrator repository: %v", err)
	}
	runtimeRepository, err := OpenFileRepository(path, key)
	if err != nil {
		t.Fatalf("open runtime repository: %v", err)
	}
	if err := runtimeRepository.SaveBinding(t.Context(), Binding{
		Identity: identity(), LegacyShopID: "runtime-binding", ShopDomain: "runtime.myshopify.com",
	}); err != nil {
		t.Fatalf("runtime commit failed: %v", err)
	}
	if _, err := staleMigrator.ImportLegacyInstallations(t.Context(), []LegacyInstallationImport{
		legacyImport(shopifyconnector.CanonicalShopIdentity{
			TenantID: testTenantID, ShopID: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
		}, "legacy-shop", "demo.myshopify.com", "shpat_migrated_generation"),
	}); !errors.Is(err, ErrRepositoryStale) {
		t.Fatalf("stale migrator was not rejected: %v", err)
	}
	reopened, err := OpenFileRepository(path, key)
	if err != nil {
		t.Fatalf("reopen final repository: %v", err)
	}
	resolved, err := reopened.ResolveCanonicalIdentity(t.Context(), "runtime-binding")
	if err != nil || resolved != identity() {
		t.Fatalf("stale migrator overwrote runtime state: %#v err=%v", resolved, err)
	}
}

func TestFileRepositoryFailsClosedWhileCrossProcessLockIsHeld(t *testing.T) {
	path := filepath.Join(t.TempDir(), "connector-installations.enc")
	repository, err := OpenFileRepository(path, bytes.Repeat([]byte{0x74}, 32))
	if err != nil {
		t.Fatalf("open repository: %v", err)
	}
	release, err := acquireRepositoryFileLock(path + ".lock")
	if err != nil {
		t.Fatalf("acquire external lock: %v", err)
	}
	binding := Binding{Identity: identity(), LegacyShopID: "legacy-shop", ShopDomain: "demo.myshopify.com"}
	if err := repository.SaveBinding(t.Context(), binding); err == nil {
		release()
		t.Fatal("writer proceeded while cross-process lock was held")
	}
	if _, err := repository.ResolveCanonicalIdentity(t.Context(), "legacy-shop"); !errors.Is(err, ErrNotFound) {
		release()
		t.Fatalf("lock failure published candidate state: %v", err)
	}
	release()
	if err := repository.SaveBinding(t.Context(), binding); err != nil {
		t.Fatalf("writer did not recover after lock release: %v", err)
	}
}

func TestLegacyImportTypesRedactSecretsAndIdentities(t *testing.T) {
	record := legacyImport(identity(), "secret-legacy-shop", "secret-shop.myshopify.com", "shpat_secret_token")
	raw, err := json.Marshal(record)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}
	combined := string(raw) + " " + record.String() + " " + record.GoString()
	for _, secret := range []string{"secret-legacy-shop", "secret-shop.myshopify.com", "shpat_secret_token", testTenantID, testShopID} {
		if strings.Contains(combined, secret) {
			t.Fatalf("migration record exposed sensitive value %q: %s", secret, combined)
		}
	}
}

func legacyImport(identity shopifyconnector.CanonicalShopIdentity, legacyShopID, domain, token string) LegacyInstallationImport {
	installedAt := time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC)
	return LegacyInstallationImport{
		Identity: identity, LegacyShopID: legacyShopID, ShopDomain: domain, AccessToken: token,
		Scopes: []string{"read_orders", "write_orders"}, InstalledAt: installedAt, UpdatedAt: installedAt.Add(time.Hour),
	}
}
