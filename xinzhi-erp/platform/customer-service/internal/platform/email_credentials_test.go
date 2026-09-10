package platform

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEmailCredentialEnvelopeRoundTripAndLegacyRead(t *testing.T) {
	t.Setenv("AI_SETTINGS_ENCRYPTION_KEY", "email-credential-test-key")
	encrypted, err := encryptEmailCredential("provider-secret")
	if err != nil {
		t.Fatal(err)
	}
	if encrypted == "provider-secret" || !isEncryptedEmailCredential(encrypted) {
		t.Fatalf("credential was not encrypted: %q", encrypted)
	}
	plain, err := decryptEmailCredential(encrypted)
	if err != nil || plain != "provider-secret" {
		t.Fatalf("credential round trip = %q, %v", plain, err)
	}
	legacy, err := decryptEmailCredential("legacy-plaintext")
	if err != nil || legacy != "legacy-plaintext" {
		t.Fatalf("legacy credential compatibility = %q, %v", legacy, err)
	}
}

func TestFileStorePersistsEmailCredentialsEncrypted(t *testing.T) {
	t.Setenv("AI_SETTINGS_ENCRYPTION_KEY", "email-file-store-test-key")
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "customer-service.json")
	store, err := OpenFileStore(path)
	if err != nil {
		t.Fatal(err)
	}
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Encrypted Email Store"})
	if err != nil {
		t.Fatal(err)
	}
	saved, err := store.SaveEmailInstallation(ctx, EmailInstallation{
		ShopID: shop.ID, Mailbox: "support@example.com", Provider: "outlook",
		AccessToken: "email-access-secret", RefreshToken: "email-refresh-secret",
	})
	if err != nil {
		t.Fatal(err)
	}
	if saved.AccessToken != "email-access-secret" || saved.RefreshToken != "email-refresh-secret" {
		t.Fatalf("SaveEmailInstallation returned encrypted credentials: %#v", saved)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "email-access-secret") || strings.Contains(string(raw), "email-refresh-secret") {
		t.Fatal("file-store snapshot persisted plaintext email credentials")
	}
	if !strings.Contains(string(raw), emailCredentialEnvelopePrefix) {
		t.Fatal("file-store snapshot is missing the email credential envelope")
	}
	reopened, err := OpenFileStore(path)
	if err != nil {
		t.Fatal(err)
	}
	installation, err := reopened.GetEmailInstallation(ctx, shop.ID, "support@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if installation.AccessToken != "email-access-secret" || installation.RefreshToken != "email-refresh-secret" {
		t.Fatalf("GetEmailInstallation did not decrypt credentials: %#v", installation)
	}
}

func TestFileStoreMigratesLegacyPlaintextEmailCredentials(t *testing.T) {
	t.Setenv("AI_SETTINGS_ENCRYPTION_KEY", "email-file-store-migration-key")
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "legacy-customer-service.json")
	store, err := OpenFileStore(path)
	if err != nil {
		t.Fatal(err)
	}
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Legacy Email Store"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.MemoryStore.SaveEmailInstallation(ctx, EmailInstallation{
		ShopID: shop.ID, Mailbox: "legacy@example.com", Provider: "gmail",
		AccessToken: "legacy-access-secret", RefreshToken: "legacy-refresh-secret",
	}); err != nil {
		t.Fatal(err)
	}
	nextRevision, err := store.persistSnapshot(ctx, store.snapshot(), store.revision)
	if err != nil {
		t.Fatal(err)
	}
	store.revision = nextRevision
	legacyRaw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(legacyRaw), "legacy-access-secret") {
		t.Fatal("legacy fixture did not contain plaintext credentials")
	}
	if err := store.MigrateEmailInstallationCredentials(ctx); err != nil {
		t.Fatal(err)
	}
	migratedRaw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(migratedRaw), "legacy-access-secret") || strings.Contains(string(migratedRaw), "legacy-refresh-secret") {
		t.Fatal("legacy plaintext credentials remained after migration")
	}
	installation, err := store.GetEmailInstallation(ctx, shop.ID, "legacy@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if installation.AccessToken != "legacy-access-secret" || installation.RefreshToken != "legacy-refresh-secret" {
		t.Fatalf("migrated credentials were not readable: %#v", installation)
	}
}
