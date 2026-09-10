package main

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestProductionStorageDoesNotFallBackToFileOrMemory(t *testing.T) {
	t.Setenv("XZDESK_ENVIRONMENT", "production")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("DATA_FILE", filepath.Join(t.TempDir(), "customer-service.json"))
	_, _, _, err := openStore()
	if err == nil || !strings.Contains(err.Error(), "requires PostgreSQL") {
		t.Fatalf("production storage fallback was not rejected: %v", err)
	}
}

func TestLocalStorageKeepsExplicitFileAdapter(t *testing.T) {
	t.Setenv("XZDESK_ENVIRONMENT", "local")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("DATA_FILE", filepath.Join(t.TempDir(), "customer-service.json"))
	store, _, cleanup, err := openStore()
	if err != nil {
		t.Fatalf("local file adapter was rejected: %v", err)
	}
	cleanup()
	if store == nil {
		t.Fatal("local file adapter returned no store")
	}
}
