package installations

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

func TestFileRepositoryEncryptsTokenAndSurvivesRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "connector-installations.enc")
	key := bytes.Repeat([]byte{0x5a}, 32)
	repository, err := OpenFileRepository(path, key)
	if err != nil {
		t.Fatalf("OpenFileRepository failed: %v", err)
	}
	now := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)
	binding := Binding{Identity: identity(), LegacyShopID: "legacy-shop", ShopDomain: "demo.myshopify.com"}
	if err := repository.CompleteInstallation(t.Context(), binding, InstallationRecord{
		Binding: binding, AccessToken: "shpat_plaintext_must_not_reach_disk",
		Scopes: []string{"read_orders"}, State: shopifyconnector.InstallationStateInstalled,
		InstalledAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("CompleteInstallation failed: %v", err)
	}
	accessEvent := ProtectedDataAccessEvent{
		ID: "embedded-abcdefghijklmnopqrstuvwx", Identity: identity(),
		ActorID: "shopify-user:123", Surface: "embeddedOrderPreview",
		FieldSet: "name,address,phone,email", RecordCount: 1, OccurredAt: now,
	}
	if err := repository.AppendProtectedDataAccess(t.Context(), accessEvent); err != nil {
		t.Fatalf("AppendProtectedDataAccess failed: %v", err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile failed: %v", err)
	}
	if bytes.Contains(raw, []byte("shpat_plaintext_must_not_reach_disk")) || bytes.Contains(raw, []byte("demo.myshopify.com")) ||
		bytes.Contains(raw, []byte("shopify-user:123")) || bytes.Contains(raw, []byte("name,address,phone,email")) {
		t.Fatalf("encrypted repository exposed installation plaintext: %s", raw)
	}
	if err := repository.SaveBinding(t.Context(), binding); err != nil {
		t.Fatalf("second persisted mutation failed: %v", err)
	}

	reopened, err := OpenFileRepository(path, key)
	if err != nil {
		t.Fatalf("reopen failed: %v", err)
	}
	record, err := reopened.GetInstallation(t.Context(), identity())
	if err != nil || record.AccessToken != "shpat_plaintext_must_not_reach_disk" || record.ShopDomain != "demo.myshopify.com" {
		t.Fatalf("reopened record mismatch: %#v err=%v", record, err)
	}
	resolved, err := reopened.ResolveCanonicalIdentity(t.Context(), "legacy-shop")
	if err != nil || resolved != identity() {
		t.Fatalf("reopened binding mismatch: %#v err=%v", resolved, err)
	}
	accessEvents, err := reopened.ListProtectedDataAccess(t.Context())
	if err != nil || len(accessEvents) != 1 || accessEvents[0] != accessEvent {
		t.Fatalf("reopened protected-data access event mismatch: %#v err=%v", accessEvents, err)
	}
	if err := reopened.AppendProtectedDataAccess(t.Context(), accessEvent); !errors.Is(err, ErrRepositoryStale) {
		t.Fatalf("append-only protected-data access event was overwritten: %v", err)
	}
}

func TestFileRepositoryRejectsWrongKeyWithoutOverwritingData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "connector-installations.enc")
	key := bytes.Repeat([]byte{0x31}, 32)
	repository, err := OpenFileRepository(path, key)
	if err != nil {
		t.Fatalf("OpenFileRepository failed: %v", err)
	}
	if err := repository.SaveBinding(t.Context(), Binding{Identity: identity(), LegacyShopID: "legacy-shop", ShopDomain: "demo.myshopify.com"}); err != nil {
		t.Fatalf("SaveBinding failed: %v", err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile before failed: %v", err)
	}
	if _, err := OpenFileRepository(path, bytes.Repeat([]byte{0x32}, 32)); err == nil {
		t.Fatal("wrong encryption key was accepted")
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile after failed: %v", err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("failed open with wrong key modified connector data")
	}
}

func TestFileRepositoryPersistsComplianceCompletionIdempotently(t *testing.T) {
	path := filepath.Join(t.TempDir(), "connector-installations.enc")
	key := bytes.Repeat([]byte{0x71}, 32)
	repository, err := OpenFileRepository(path, key)
	if err != nil {
		t.Fatalf("OpenFileRepository failed: %v", err)
	}
	now := time.Date(2026, 8, 6, 2, 0, 0, 0, time.UTC)
	event := OutboxEvent{
		ID: "shopify-compliance/customers/redact/test-delivery", Kind: "shopify.compliance.requested",
		Identity: identity(), ShopDomain: "demo.myshopify.com", Topic: "customers/redact",
		ReferenceIDs: []string{"customer:123", "shop:456"}, OccurredAt: now,
	}
	if err := repository.EnqueueOutbox(t.Context(), event); err != nil {
		t.Fatalf("EnqueueOutbox failed: %v", err)
	}
	completed, already, err := repository.CompleteOutbox(t.Context(), event.ID, "anonymized", now.Add(time.Minute))
	if err != nil || already || completed.CompletedAt == nil || completed.Outcome != "anonymized" {
		t.Fatalf("CompleteOutbox mismatch: event=%#v already=%v err=%v", completed, already, err)
	}

	reopened, err := OpenFileRepository(path, key)
	if err != nil {
		t.Fatalf("reopen failed: %v", err)
	}
	events, err := reopened.ListOutbox(t.Context())
	if err != nil || len(events) != 1 || events[0].CompletedAt == nil || events[0].Outcome != "anonymized" {
		t.Fatalf("persisted completion mismatch: events=%#v err=%v", events, err)
	}
	if _, already, err := reopened.CompleteOutbox(t.Context(), event.ID, "anonymized", now.Add(2*time.Minute)); err != nil || !already {
		t.Fatalf("idempotent persisted completion failed: already=%v err=%v", already, err)
	}
	if _, _, err := reopened.CompleteOutbox(t.Context(), event.ID, "deleted", now.Add(2*time.Minute)); !errors.Is(err, ErrRepositoryStale) {
		t.Fatalf("conflicting persisted completion was accepted: %v", err)
	}
}

func TestFileRepositoryPersistsAndConsumesBrowserBoundOAuthGrantOnce(t *testing.T) {
	path := filepath.Join(t.TempDir(), "connector-installations.enc")
	key := bytes.Repeat([]byte{0x44}, 32)
	repository, err := OpenFileRepository(path, key)
	if err != nil {
		t.Fatalf("OpenFileRepository failed: %v", err)
	}
	now := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)
	grant := OAuthGrant{
		ID: strings.Repeat("A", 43), Identity: identity(), Context: requestContext("persisted-grant"),
		LegacyShopID: "legacy-shop", ShopDomain: "demo.myshopify.com", ExpiresAt: now.Add(10 * time.Minute),
	}
	if err := repository.CreateOAuthGrant(t.Context(), grant); err != nil {
		t.Fatalf("CreateOAuthGrant failed: %v", err)
	}
	repository, err = OpenFileRepository(path, key)
	if err != nil {
		t.Fatalf("reopen before bind failed: %v", err)
	}
	browserHash := strings.Repeat("a", 64)
	otherBrowserHash := strings.Repeat("b", 64)
	if _, err := repository.BindOAuthGrant(t.Context(), grant.ID, browserHash, now); err != nil {
		t.Fatalf("BindOAuthGrant failed: %v", err)
	}
	repository, err = OpenFileRepository(path, key)
	if err != nil {
		t.Fatalf("reopen before consume failed: %v", err)
	}
	if _, err := repository.ConsumeOAuthGrant(t.Context(), grant.ID, otherBrowserHash, grant.ShopDomain, now); !errors.Is(err, ErrOAuthGrantForbidden) {
		t.Fatalf("cross-browser grant consumption was accepted: %v", err)
	}
	if _, err := repository.ConsumeOAuthGrant(t.Context(), grant.ID, browserHash, grant.ShopDomain, now); err != nil {
		t.Fatalf("ConsumeOAuthGrant failed: %v", err)
	}
	repository, err = OpenFileRepository(path, key)
	if err != nil {
		t.Fatalf("reopen after consume failed: %v", err)
	}
	if _, err := repository.ConsumeOAuthGrant(t.Context(), grant.ID, browserHash, grant.ShopDomain, now); !errors.Is(err, ErrOAuthGrantForbidden) {
		t.Fatalf("consumed grant replay was accepted: %v", err)
	}
}

func TestFileRepositoryFirstWriteFailureDoesNotPublishInstallationOrBinding(t *testing.T) {
	path := filepath.Join(t.TempDir(), "connector-installations.enc")
	repository, err := OpenFileRepository(path, bytes.Repeat([]byte{0x61}, 32))
	if err != nil {
		t.Fatalf("OpenFileRepository failed: %v", err)
	}
	if err := os.Mkdir(path, 0o700); err != nil {
		t.Fatalf("create blocking persistence directory: %v", err)
	}
	now := time.Date(2026, 8, 1, 13, 0, 0, 0, time.UTC)
	binding := Binding{Identity: identity(), LegacyShopID: "legacy-shop", ShopDomain: "demo.myshopify.com"}
	err = repository.CompleteInstallation(t.Context(), binding, InstallationRecord{
		Binding: binding, AccessToken: "shpat_failed_first_write", Scopes: []string{"read_orders"},
		State: shopifyconnector.InstallationStateInstalled, InstalledAt: now, UpdatedAt: now,
	})
	if err == nil {
		t.Fatal("first persistence failure was reported as success")
	}
	if _, getErr := repository.GetInstallation(t.Context(), identity()); !errors.Is(getErr, ErrNotFound) {
		t.Fatalf("failed first write published installation in memory: %v", getErr)
	}
	if _, resolveErr := repository.ResolveCanonicalIdentity(t.Context(), "legacy-shop"); !errors.Is(resolveErr, ErrNotFound) {
		t.Fatalf("failed first write published binding in memory: %v", resolveErr)
	}
}

func TestFileRepositoryExistingStateWriteFailureKeepsLastCommittedMemoryAndDisk(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "connector-installations.enc")
	key := bytes.Repeat([]byte{0x62}, 32)
	repository, err := OpenFileRepository(path, key)
	if err != nil {
		t.Fatalf("OpenFileRepository failed: %v", err)
	}
	now := time.Date(2026, 8, 1, 13, 0, 0, 0, time.UTC)
	binding := Binding{Identity: identity(), LegacyShopID: "legacy-shop", ShopDomain: "demo.myshopify.com"}
	if err := repository.CompleteInstallation(t.Context(), binding, InstallationRecord{
		Binding: binding, AccessToken: "shpat_last_committed", Scopes: []string{"read_orders"},
		State: shopifyconnector.InstallationStateInstalled, InstalledAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("initial CompleteInstallation failed: %v", err)
	}
	committed, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read committed repository: %v", err)
	}

	failurePath := filepath.Join(directory, "persistence-target-is-directory")
	if err := os.Mkdir(failurePath, 0o700); err != nil {
		t.Fatalf("create blocking persistence directory: %v", err)
	}
	repository.path = failurePath
	grant := OAuthGrant{
		ID: strings.Repeat("A", 43), Identity: identity(), Context: requestContext("failed-grant"),
		LegacyShopID: "legacy-shop", ShopDomain: "demo.myshopify.com", ExpiresAt: now.Add(time.Minute),
	}
	if err := repository.CreateOAuthGrant(t.Context(), grant); err == nil {
		t.Fatal("failed OAuth grant persistence was reported as success")
	}
	stored, err := repository.GetInstallation(t.Context(), identity())
	if err != nil || stored.AccessToken != "shpat_last_committed" || stored.State != shopifyconnector.InstallationStateInstalled {
		t.Fatalf("failed write changed committed installation: %#v err=%v", stored, err)
	}
	if _, err := repository.BindOAuthGrant(t.Context(), grant.ID, strings.Repeat("a", 64), now); !errors.Is(err, ErrOAuthGrantForbidden) {
		t.Fatalf("failed write published OAuth grant in memory: %v", err)
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(committed, after) {
		t.Fatalf("failed write changed last committed disk state: equal=%v err=%v", bytes.Equal(committed, after), err)
	}
	reopened, err := OpenFileRepository(path, key)
	if err != nil {
		t.Fatalf("reopen committed repository failed: %v", err)
	}
	reopenedRecord, err := reopened.GetInstallation(t.Context(), identity())
	if err != nil || reopenedRecord.AccessToken != "shpat_last_committed" {
		t.Fatalf("disk state diverged after failed write: %#v err=%v", reopenedRecord, err)
	}
}

func TestFileRepositoryWriteFailureDoesNotDependOnReload(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "connector-installations.enc")
	repository, err := OpenFileRepository(path, bytes.Repeat([]byte{0x63}, 32))
	if err != nil {
		t.Fatalf("OpenFileRepository failed: %v", err)
	}
	binding := Binding{Identity: identity(), LegacyShopID: "legacy-shop", ShopDomain: "demo.myshopify.com"}
	if err := repository.SaveBinding(t.Context(), binding); err != nil {
		t.Fatalf("initial SaveBinding failed: %v", err)
	}
	failurePath := filepath.Join(directory, "unreadable-as-file")
	if err := os.Mkdir(failurePath, 0o700); err != nil {
		t.Fatalf("create blocking persistence directory: %v", err)
	}
	repository.path = failurePath
	if _, err := os.ReadFile(repository.path); err == nil {
		t.Fatal("test persistence path unexpectedly supports repository reload")
	}
	otherIdentity := shopifyconnector.CanonicalShopIdentity{
		TenantID: testTenantID, ShopID: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
	}
	if err := repository.SaveBinding(t.Context(), Binding{
		Identity: otherIdentity, LegacyShopID: "other-legacy", ShopDomain: "other.myshopify.com",
	}); err == nil {
		t.Fatal("persistence failure with unavailable reload was reported as success")
	}
	resolved, err := repository.ResolveCanonicalIdentity(t.Context(), "legacy-shop")
	if err != nil || resolved != identity() {
		t.Fatalf("last committed binding was lost: %#v err=%v", resolved, err)
	}
	if _, err := repository.ResolveCanonicalIdentity(t.Context(), "other-legacy"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("failed candidate binding escaped into memory: %v", err)
	}
}
