package platform

import (
	"context"
	"os"
	"testing"
)

func openIsolatedPostgresTestStore(t *testing.T) (context.Context, *PostgresStore) {
	t.Helper()
	runtimeURL := os.Getenv("TEST_DATABASE_URL")
	migrationURL := os.Getenv("TEST_MIGRATION_DATABASE_URL")
	if runtimeURL == "" || migrationURL == "" {
		t.Skip("isolated PostgreSQL TEST_DATABASE_URL and TEST_MIGRATION_DATABASE_URL are not configured")
	}
	ctx := context.Background()
	store, err := OpenPostgresStore(ctx, PostgresStoreConfig{
		DatabaseURL:          runtimeURL,
		MigrationDatabaseURL: migrationURL,
		Schema:               CustomerServiceDatabaseSchema,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return ctx, store
}
