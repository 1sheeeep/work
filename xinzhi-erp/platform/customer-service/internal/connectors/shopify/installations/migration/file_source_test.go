package migration

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestReadFileSnapshotUsesKnownLegacyShapeAndCanonicalMetadata(t *testing.T) {
	installedAt := time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC)
	snapshot := map[string]any{
		"shops": map[string]any{
			"legacy-shop": map[string]any{
				"id": "legacy-shop", "metadata": map[string]string{
					"erpTenantId":        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
					"erpCanonicalShopId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
				},
			},
		},
		"installations": map[string]any{
			"demo.myshopify.com": map[string]any{
				"shopId": "legacy-shop", "shopDomain": "demo.myshopify.com",
				"accessToken": "shpat_known_legacy_token", "scope": "write_orders, read_orders",
				"installedAt": installedAt, "updatedAt": installedAt.Add(time.Hour),
			},
		},
	}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}
	path := filepath.Join(t.TempDir(), "legacy.json")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}

	result, err := ReadFileSnapshot(path, NewCredentialDecoder(""))
	if err != nil || len(result.Records) != 1 {
		t.Fatalf("ReadFileSnapshot mismatch: %#v err=%v", result, err)
	}
	record := result.Records[0]
	if record.Identity.TenantID != "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" ||
		record.Identity.ShopID != "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" ||
		record.LegacyShopID != "legacy-shop" || record.ShopDomain != "demo.myshopify.com" ||
		record.AccessToken != "shpat_known_legacy_token" {
		t.Fatalf("decoded record mismatch: %#v", record)
	}
}

func TestReadFileSnapshotRejectsMissingCanonicalMappingWithoutLeakingSource(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.json")
	raw := []byte(`{"shops":{"legacy-shop":{"id":"legacy-shop","metadata":{}}},"installations":{"secret-shop.myshopify.com":{"shopId":"legacy-shop","shopDomain":"secret-shop.myshopify.com","accessToken":"shpat_secret_legacy_token","scope":"read_orders","installedAt":"2026-07-01T12:00:00Z","updatedAt":"2026-07-01T13:00:00Z"}}}`)
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}
	_, err := ReadFileSnapshot(path, NewCredentialDecoder(""))
	if err == nil {
		t.Fatal("missing canonical mapping was accepted")
	}
	if containsAny(err.Error(), "secret-shop", "shpat_secret", path) {
		t.Fatalf("source error leaked migration material: %v", err)
	}
}

func TestReadFileSnapshotRejectsMapKeyDomainMismatch(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.json")
	raw := []byte(`{"shops":{"legacy-shop":{"id":"legacy-shop","metadata":{"erpTenantId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","erpCanonicalShopId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}}},"installations":{"other.myshopify.com":{"shopId":"legacy-shop","shopDomain":"demo.myshopify.com","accessToken":"shpat_secret_legacy_token","scope":"read_orders","installedAt":"2026-07-01T12:00:00Z","updatedAt":"2026-07-01T13:00:00Z"}}}`)
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}
	if _, err := ReadFileSnapshot(path, NewCredentialDecoder("")); err == nil {
		t.Fatal("legacy map key/domain mismatch was accepted")
	}
}

func TestReadFileSnapshotRejectsEmptyInstallationSet(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.json")
	if err := os.WriteFile(path, []byte(`{"shops":{},"installations":{}}`), 0o600); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}
	if _, err := ReadFileSnapshot(path, NewCredentialDecoder("")); !errors.Is(err, ErrLegacySnapshotUnavailable) {
		t.Fatalf("empty FileStore snapshot was reported as complete: %v", err)
	}
}

func containsAny(value string, needles ...string) bool {
	for _, needle := range needles {
		if needle != "" && len(value) >= len(needle) {
			for index := 0; index+len(needle) <= len(value); index++ {
				if value[index:index+len(needle)] == needle {
					return true
				}
			}
		}
	}
	return false
}
