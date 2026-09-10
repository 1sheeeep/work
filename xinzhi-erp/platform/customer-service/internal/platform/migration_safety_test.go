package platform

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestLegacyEmailMigrationPreservesCurrentSystemClassifications(t *testing.T) {
	raw, err := migrationFiles.ReadFile("migrations/022_unify_email_conversations.sql")
	if err != nil {
		t.Fatal(err)
	}
	migration := string(raw)
	for _, required := range []string{
		"data_migration_markers",
		automatedSystemNotificationClassification,
		verificationSystemNotificationClassification,
		pendingSystemNotificationClassification,
	} {
		if !strings.Contains(migration, required) {
			t.Fatalf("legacy email migration is missing safety guard %q", required)
		}
	}
}

func TestEmailOutboxConflictMigrationOnlyRequeuesDefinitelyUnsentReplies(t *testing.T) {
	raw, err := migrationFiles.ReadFile("migrations/057_reclassify_local_email_outbox_conflicts.sql")
	if err != nil {
		t.Fatal(err)
	}
	migration := string(raw)
	for _, required := range []string{
		"status = 'ambiguous'",
		"provider_metadata = '{}'::jsonb",
		"message_id = ''",
		"conflict: conversation must be claimed before replying",
	} {
		if !strings.Contains(migration, required) {
			t.Fatalf("email outbox conflict migration is missing safety guard %q", required)
		}
	}
}

func TestPostgresLegacyEmailMigrationPreservesCurrentSystemConversation(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	migrationDatabaseURL := os.Getenv("XZDESK_DATABASE_MIGRATION_URL")
	if databaseURL == "" || migrationDatabaseURL == "" {
		t.Skip("customer-service PostgreSQL test URLs are not set")
	}
	ctx := context.Background()
	store, err := OpenPostgresStore(ctx, PostgresStoreConfig{
		DatabaseURL:          databaseURL,
		MigrationDatabaseURL: migrationDatabaseURL,
		Schema:               CustomerServiceDatabaseSchema,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	shop, err := store.CreateShop(ctx, Shop{DisplayName: prefixedID("migration-safety-shop")})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{
		ShopID: shop.ID, Type: SourceTypeEmail, Provider: "outlook", Address: prefixedID("migration-safety") + "@example.com",
	})
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateConversation(ctx, Conversation{
		ShopID: shop.ID, SourceID: source.ID, CustomerEmail: "no-reply@example.com",
		Subject: "System notification", Kind: ConversationKindSystem,
		Classification: pendingSystemNotificationClassification,
	})
	if err != nil {
		t.Fatal(err)
	}
	migrationDB, err := openCustomerServiceDatabase(migrationDatabaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer migrationDB.Close()
	if _, err := migrationDB.ExecContext(ctx, `DELETE FROM data_migration_markers WHERE name = '022_unify_email_conversations'`); err != nil {
		t.Fatal(err)
	}
	migration, err := migrationFiles.ReadFile("migrations/022_unify_email_conversations.sql")
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if _, err := migrationDB.ExecContext(ctx, string(migration)); err != nil {
			t.Fatal(err)
		}
	}
	got, err := store.GetConversation(ctx, conversation.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Kind != ConversationKindSystem || got.Classification != pendingSystemNotificationClassification {
		t.Fatalf("current system email was changed by a repeated legacy migration: %#v", got)
	}
}
