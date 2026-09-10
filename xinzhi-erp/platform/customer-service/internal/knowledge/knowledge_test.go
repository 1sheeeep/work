package knowledge

import (
	"os"
	"path/filepath"
	"testing"

	"shopify-support-platform/internal/appcore"
)

func TestKnowledgeAddExportImportDedupes(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir, nil)
	conversation := appcore.Conversation{
		ID:            "c1",
		CustomerName:  "Ada",
		CustomerEmail: "ada@example.com",
		Source:        "inbox",
		Preview:       "Where is my order?",
		RawLines:      []string{"customer: where is my order?"},
	}
	entry, err := store.Add(conversation, "We will check this for you.", appcore.Shop{DisplayName: "Demo", MallID: "m1"}, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if entry.ID == "" {
		t.Fatal("entry id is empty")
	}
	exportPath := filepath.Join(dir, "export.json")
	if _, err := store.Export(exportPath); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Import(exportPath); err != nil {
		t.Fatal(err)
	}
	entries, err := store.List(true)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("entries = %d, want deduped 1", len(entries))
	}
}

func TestRelevantKnowledgeScoresMatchingConversation(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir, nil)
	conversation := appcore.Conversation{ID: "c1", Source: "gmail", CustomerName: "Ada", CustomerEmail: "ada@example.com", Preview: "refund request for order"}
	if _, err := store.Add(conversation, "We can help with the refund request.", appcore.Shop{}, "refund request", ""); err != nil {
		t.Fatal(err)
	}
	got := store.Relevant(conversation, 1)
	if len(got) != 1 {
		t.Fatalf("relevant count = %d, want 1", len(got))
	}
}

func TestKnowledgeKeepsInboxDisplayName(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir, nil)
	entry, err := store.Add(appcore.Conversation{
		ID:               "c-display-name",
		CustomerName:     "Clarabell Lamberty",
		CustomerFullName: "LambertyClarabell",
		CustomerEmail:    "c1l9a6r9y@yahoo.com",
		Source:           "inbox",
		Preview:          "Order status",
	}, "We can help.", appcore.Shop{DisplayName: "Demo"}, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if entry.CustomerName != "Clarabell Lamberty" {
		t.Fatalf("customerName = %q, want inbox display name", entry.CustomerName)
	}
}

func TestKnowledgeImportJSONL(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "legacy_import.jsonl")
	if err := os.WriteFile(source, []byte(`{"id":"legacy-1","enabled":true,"createdAt":"2026-06-12T00:00:00Z","source":"inbox","customerName":"Ada","problemSummary":"refund","replyText":"We can help."}`+"\n"), 0644); err != nil {
		t.Fatal(err)
	}
	store := NewStore(dir, nil)
	result, err := store.Import(source)
	if err != nil {
		t.Fatal(err)
	}
	if result["added_count"] != 1 {
		t.Fatalf("added_count = %v, want 1", result["added_count"])
	}
	entries, err := store.List(true)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].ID != "legacy-1" {
		t.Fatalf("unexpected entries: %#v", entries)
	}
}
