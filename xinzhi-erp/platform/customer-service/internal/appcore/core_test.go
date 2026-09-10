package appcore

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestDetectDataDirUsesProjectHiddenDirForDevRoot(t *testing.T) {
	dir := t.TempDir()
	if err := writeJSON(filepath.Join(dir, "wails.json"), map[string]any{"name": "test"}); err != nil {
		t.Fatal(err)
	}
	got := detectDataDir(dir)
	want := filepath.Join(dir, ".shopify-ai-assistant")
	if got != want {
		t.Fatalf("data dir = %q, want %q", got, want)
	}
}

func TestDetectDataDirUsesAppDataForInstalledRoot(t *testing.T) {
	dir := t.TempDir()
	appData := filepath.Join(t.TempDir(), "AppData")
	t.Setenv("APPDATA", appData)
	got := detectDataDir(dir)
	want := filepath.Join(appData, "XzdeskAgent")
	if got != want {
		t.Fatalf("data dir = %q, want %q", got, want)
	}
}

func TestNormalizeSettingsMirrorsAPIKeyAliases(t *testing.T) {
	got := normalizeSettings(Settings{
		AI:       map[string]any{"apiKey": "ai-key"},
		AdsPower: map[string]any{"apiKey": "ads-key"},
	})
	if got.AI["api_key"] != "ai-key" || got.AI["apiKey"] != "ai-key" {
		t.Fatalf("expected AI key aliases to be mirrored, got %+v", got.AI)
	}
	if got.AdsPower["api_key"] != "ads-key" || got.AdsPower["apiKey"] != "ads-key" {
		t.Fatalf("expected AdsPower key aliases to be mirrored, got %+v", got.AdsPower)
	}

	got = normalizeSettings(Settings{
		AI:       map[string]any{"api_key": "ai-key"},
		AdsPower: map[string]any{"api_key": "ads-key"},
	})
	if got.AI["api_key"] != "ai-key" || got.AI["apiKey"] != "ai-key" {
		t.Fatalf("expected AI canonical key to fill alias, got %+v", got.AI)
	}
	if got.AdsPower["api_key"] != "ads-key" || got.AdsPower["apiKey"] != "ads-key" {
		t.Fatalf("expected AdsPower canonical key to fill alias, got %+v", got.AdsPower)
	}
}

func TestSaveSettingsPreservesSensitiveKeysWhenIncomingSettingsAreBlank(t *testing.T) {
	dir := t.TempDir()
	zhanfuPath := "C:\\ZhanFu\\CustomZhanFu.exe"
	core := &Core{
		dataDir:    dir,
		configDir:  filepath.Join(dir, "config"),
		configPath: filepath.Join(dir, "config", "settings.json"),
		settings: normalizeSettings(Settings{
			AI:       map[string]any{"api_key": "ai-key"},
			AdsPower: map[string]any{"api_key": "ads-key"},
			Zhanfu:   map[string]any{"client_exe_path": zhanfuPath},
		}),
	}

	result := core.SaveSettings(Settings{
		AI:       map[string]any{"api_key": "", "apiKey": ""},
		AdsPower: map[string]any{"api_key": "", "apiKey": ""},
		Zhanfu:   map[string]any{"client_exe_path": "", "clientPath": ""},
	})
	if !result.OK {
		t.Fatalf("save settings failed: %s", result.Error)
	}
	if core.settings.AI["api_key"] != "ai-key" || core.settings.AI["apiKey"] != "ai-key" {
		t.Fatalf("expected AI key to be preserved, got %+v", core.settings.AI)
	}
	if core.settings.AdsPower["api_key"] != "ads-key" || core.settings.AdsPower["apiKey"] != "ads-key" {
		t.Fatalf("expected AdsPower key to be preserved, got %+v", core.settings.AdsPower)
	}
	if core.settings.Zhanfu["client_exe_path"] != zhanfuPath || core.settings.Zhanfu["clientPath"] != zhanfuPath {
		t.Fatalf("expected Zhanfu path to be preserved, got %+v", core.settings.Zhanfu)
	}
}

func TestNormalizeSettingsDoesNotInjectFixedZhanfuClientPath(t *testing.T) {
	got := normalizeSettings(Settings{})
	if got.Zhanfu["client_exe_path"] == "D:\\soft\\ZhanFu\\站斧.exe" {
		t.Fatalf("normalizeSettings should not inject host-specific Zhanfu path: %+v", got.Zhanfu)
	}
	if value, ok := got.Zhanfu["client_exe_path"]; ok && value != "" {
		t.Fatalf("expected blank Zhanfu client path until auto-detected, got %+v", got.Zhanfu)
	}
}

func TestAnnotateDuplicates(t *testing.T) {
	items := []Conversation{
		{ID: "1", Source: "inbox", CustomerName: "Ada", Preview: "Where is my order?"},
		{ID: "2", Source: "inbox", CustomerName: "Ada", Preview: "Where is my order?"},
		{ID: "3", Source: "gmail", CustomerName: "Ada", Preview: "Where is my order?"},
	}
	got := AnnotateDuplicates(items)
	if got[0].DuplicateCount != 2 || got[0].DuplicateIndex != 1 || got[1].DuplicateIndex != 2 {
		t.Fatalf("inbox duplicates not annotated: %+v", got[:2])
	}
	if got[2].DuplicateCount != 1 || got[2].DuplicateIndex != 1 {
		t.Fatalf("different source should not be duplicate: %+v", got[2])
	}
}

func TestAnnotateDuplicatesPrefersEmailIdentity(t *testing.T) {
	items := []Conversation{
		{ID: "1", Source: "inbox", CustomerName: "Inavasdeleon@yahoo.com", CustomerEmail: "inavasdeleon@yahoo.com", Preview: "Hello"},
		{ID: "2", Source: "inbox", CustomerName: "Your cart currently has:", CustomerEmail: "inavasdeleon@yahoo.com", Preview: "70K+ SOLD"},
	}
	got := AnnotateDuplicates(items)
	if got[0].DuplicateCount != 2 || got[1].DuplicateCount != 2 {
		t.Fatalf("expected same email to be treated as duplicate identity: %+v", got)
	}
}

func TestAnnotateDuplicatesKeepsEmailThreadsSeparate(t *testing.T) {
	items := []Conversation{
		{ID: "1", Source: "outlook", ConversationID: "thread-a", CustomerEmail: "ada@example.com", Topic: "Order #1", Preview: "Where is order 1?"},
		{ID: "2", Source: "outlook", ConversationID: "thread-b", CustomerEmail: "ada@example.com", Topic: "Order #2", Preview: "Where is order 2?"},
	}
	got := AnnotateDuplicates(items)
	if got[0].DuplicateCount != 1 || got[1].DuplicateCount != 1 {
		t.Fatalf("different email threads should not be duplicate: %+v", got)
	}
}

func TestConversationCacheDropsUnverifiedInboxRows(t *testing.T) {
	dir := t.TempDir()
	core := &Core{dataDir: dir, cache: map[string][]Conversation{}}
	shop := Shop{AdapterName: "zhanfu", AdapterInstance: "default", MallID: "3072028", DisplayName: "test-shop"}
	core.StoreConversations(shop, []Conversation{
		{
			ID:             "preview-only",
			Source:         "inbox",
			CustomerName:   "Preview Only",
			DetailLoaded:   false,
			DataSources:    []string{"playwright", "unverified_inbox_row"},
			DataConflict:   true,
			NeedsReview:    true,
			ConversationID: "",
		},
		{
			ID:           "real-detail",
			Source:       "inbox",
			CustomerName: "Real Detail",
			DetailLoaded: true,
			Messages:     []MessageItem{{Role: "customer", Text: "Hello"}},
		},
	})

	got := core.ConversationCache(shop)
	if len(got) != 1 || got[0].ID != "real-detail" {
		t.Fatalf("cache should keep only verified detail, got %+v", got)
	}
}

func TestConversationCacheFreshMailAPIResultOverridesOlderCachedDetail(t *testing.T) {
	dir := t.TempDir()
	core := &Core{dataDir: dir, cache: map[string][]Conversation{}}
	shop := Shop{AdapterName: "zhanfu", AdapterInstance: "default", MallID: "3072028", DisplayName: "test-shop"}
	old := Conversation{
		ID:             "outlook:m1",
		Source:         "outlook",
		ConversationID: "thread-1",
		EmailThreadID:  "thread-1",
		FetchedAt:      "2026-07-02T01:00:00Z",
		LastSeen:       "2026-07-02T00:50:00Z",
		DataSources:    []string{"outlook_api"},
		Messages: []MessageItem{
			{Role: "customer", Text: "old customer text"},
			{Role: "store", Text: "old store text"},
			{Role: "customer", Text: "old extra text"},
		},
		AIReply:          "old ai reply",
		RecordPrimary:    "未发货",
		RecordClassified: true,
	}
	core.StoreConversations(shop, []Conversation{old})

	next := Conversation{
		ID:             "outlook:m1",
		Source:         "outlook",
		ConversationID: "thread-1",
		EmailThreadID:  "thread-1",
		FetchedAt:      "2026-07-02T02:00:00Z",
		LastSeen:       "2026-07-02T01:50:00Z",
		DataSources:    []string{"outlook_api"},
		Messages: []MessageItem{
			{Role: "customer", Text: "new latest page text"},
		},
	}
	core.StoreConversations(shop, []Conversation{next})

	got := core.ConversationCache(shop)
	if len(got) != 1 {
		t.Fatalf("expected one cached conversation, got %+v", got)
	}
	if len(got[0].Messages) != 1 || got[0].Messages[0].Text != "new latest page text" {
		t.Fatalf("expected fresh API detail to override old cached messages, got %+v", got[0].Messages)
	}
	if got[0].AIReply != "old ai reply" || !got[0].RecordClassified || got[0].RecordPrimary != "未发货" {
		t.Fatalf("expected local AI and classification state to be preserved, got %+v", got[0])
	}
}

func TestConversationCacheClearsStaleAITranslationWhenMessagesChange(t *testing.T) {
	dir := t.TempDir()
	core := &Core{dataDir: dir, cache: map[string][]Conversation{}}
	shop := Shop{AdapterName: "zhanfu", AdapterInstance: "default", MallID: "3072028", DisplayName: "test-shop"}
	old := Conversation{
		ID:             "inbox:1",
		Source:         "inbox",
		ConversationID: "thread-1",
		Messages:       []MessageItem{{Role: "customer", Text: "Where is my order?"}},
		AITranslation:  "translated old message",
	}
	core.StoreConversations(shop, []Conversation{old})
	core.StoreConversations(shop, []Conversation{{
		ID:             "inbox:1",
		Source:         "inbox",
		ConversationID: "thread-1",
		Messages:       []MessageItem{{Role: "customer", Text: "I want to return it."}},
	}})

	got := core.ConversationCache(shop)
	if len(got) != 1 {
		t.Fatalf("expected one cached conversation, got %+v", got)
	}
	if got[0].AITranslation != "" {
		t.Fatalf("expected stale translation to be cleared, got %q", got[0].AITranslation)
	}
}

func TestConversationCachePreservesAITranslationWhenMessagesUnchanged(t *testing.T) {
	dir := t.TempDir()
	core := &Core{dataDir: dir, cache: map[string][]Conversation{}}
	shop := Shop{AdapterName: "zhanfu", AdapterInstance: "default", MallID: "3072028", DisplayName: "test-shop"}
	old := Conversation{
		ID:             "inbox:1",
		Source:         "inbox",
		ConversationID: "thread-1",
		Messages:       []MessageItem{{Role: "customer", Text: "Where is my order?"}},
		AITranslation:  "translated old message",
	}
	core.StoreConversations(shop, []Conversation{old})
	core.StoreConversations(shop, []Conversation{{
		ID:             "inbox:1",
		Source:         "inbox",
		ConversationID: "thread-1",
		Messages:       []MessageItem{{Role: "customer", Text: "Where is my order?"}},
	}})

	got := core.ConversationCache(shop)
	if len(got) != 1 {
		t.Fatalf("expected one cached conversation, got %+v", got)
	}
	if got[0].AITranslation != old.AITranslation {
		t.Fatalf("expected translation to be preserved, got %q", got[0].AITranslation)
	}
}

func TestConversationCacheDropsPendingNonUnreadInboxRows(t *testing.T) {
	dir := t.TempDir()
	core := &Core{dataDir: dir, cache: map[string][]Conversation{}}
	shop := Shop{AdapterName: "zhanfu", AdapterInstance: "default", MallID: "3072028", DisplayName: "test-shop"}
	core.StoreConversations(shop, []Conversation{
		{
			ID:             "closed-pending",
			Source:         "inbox",
			CustomerName:   "Closed Customer",
			Status:         "pending",
			ConversationID: "closed-1",
			SourceURL:      "https://inbox.shopify.com/store/demo/conversations/closed/closed-1",
			Messages:       []MessageItem{{Role: "customer", Text: "Old closed message"}},
		},
		{
			ID:             "open-pending",
			Source:         "inbox",
			CustomerName:   "Open Customer",
			Status:         "pending",
			ConversationID: "open-1",
			SourceURL:      "https://inbox.shopify.com/store/demo/conversations/open/open-1",
			Messages:       []MessageItem{{Role: "customer", Text: "Old open message"}},
		},
		{
			ID:             "unread-pending",
			Source:         "inbox",
			CustomerName:   "Unread Customer",
			Status:         "pending",
			ConversationID: "unread-1",
			SourceURL:      "https://inbox.shopify.com/store/demo/conversations/unread/unread-1",
			Messages:       []MessageItem{{Role: "customer", Text: "New unread message"}},
		},
		{
			ID:             "closed-handled",
			Source:         "inbox",
			CustomerName:   "Handled Customer",
			Status:         "handled",
			ConversationID: "closed-2",
			SourceURL:      "https://inbox.shopify.com/store/demo/conversations/closed/closed-2",
			Messages:       []MessageItem{{Role: "customer", Text: "Handled history"}},
		},
		{
			ID:             "email-open-url",
			Source:         "gmail",
			CustomerName:   "Mail Customer",
			Status:         "pending",
			ConversationID: "mail-1",
			SourceURL:      "https://inbox.shopify.com/store/demo/conversations/open/open-2",
			Messages:       []MessageItem{{Role: "customer", Text: "Email message"}},
		},
	})

	got := core.ConversationCache(shop)
	ids := map[string]bool{}
	for _, item := range got {
		ids[item.ID] = true
	}
	if ids["closed-pending"] || ids["open-pending"] {
		t.Fatalf("pending open/closed inbox rows should be dropped, got %+v", got)
	}
	for _, id := range []string{"unread-pending", "closed-handled", "email-open-url"} {
		if !ids[id] {
			t.Fatalf("expected %s to be retained, got %+v", id, got)
		}
	}
}

func TestConversationCacheRewritesInvalidJSON(t *testing.T) {
	dir := t.TempDir()
	core := &Core{dataDir: dir, cache: map[string][]Conversation{}}
	shop := Shop{AdapterName: "zhanfu", AdapterInstance: "default", MallID: "3072028", DisplayName: "test-shop"}
	path := filepath.Join(dir, "cache", safeFileName(shopKey(shop))+".json")
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(`[{"id":"broken","lastSeen":"bad quote}]`), 0644); err != nil {
		t.Fatal(err)
	}

	got := core.ConversationCache(shop)
	if len(got) != 0 {
		t.Fatalf("invalid cache should be ignored, got %+v", got)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "[]" {
		t.Fatalf("invalid cache should be rewritten as empty JSON array, got %q", string(raw))
	}
}

func TestEmailIgnoredFingerprintsPersistPerShop(t *testing.T) {
	dir := t.TempDir()
	core := &Core{dataDir: dir, cache: map[string][]Conversation{}}
	shop := Shop{AdapterName: "zhanfu", AdapterInstance: "default", MallID: "3072028", DisplayName: "test-shop"}
	added := core.MergeEmailIgnoredFingerprints(shop, []string{"abc", "abc", "def"})
	if added != 2 {
		t.Fatalf("expected 2 new ignored fingerprints, got %d", added)
	}
	got := core.EmailIgnoredFingerprints(shop)
	if len(got) != 2 || got[0] != "abc" || got[1] != "def" {
		t.Fatalf("unexpected ignored fingerprints: %+v", got)
	}
	path := core.emailIgnorePath(shopKey(shop))
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var stored emailIgnoredFingerprintStore
	if err := json.Unmarshal(raw, &stored); err != nil {
		t.Fatal(err)
	}
	if stored.Version != emailIgnoredFingerprintVersion || len(stored.Fingerprints) != 2 {
		t.Fatalf("unexpected stored ignored fingerprint format: %+v", stored)
	}
	added = core.MergeEmailIgnoredFingerprints(shop, []string{"def"})
	if added != 0 {
		t.Fatalf("duplicate ignored fingerprint should not be added, got %d", added)
	}
}

func TestEmailIgnoredFingerprintsLegacyFormatsExpire(t *testing.T) {
	dir := t.TempDir()
	core := &Core{dataDir: dir, cache: map[string][]Conversation{}}
	shop := Shop{AdapterName: "zhanfu", AdapterInstance: "default", MallID: "3072028", DisplayName: "test-shop"}
	path := core.emailIgnorePath(shopKey(shop))
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(`["old-shaunee-fingerprint"]`), 0644); err != nil {
		t.Fatal(err)
	}
	if got := core.EmailIgnoredFingerprints(shop); len(got) != 0 {
		t.Fatalf("legacy array fingerprints should expire, got %+v", got)
	}
	if err := writeJSON(path, emailIgnoredFingerprintStore{Version: emailIgnoredFingerprintVersion - 1, Fingerprints: []string{"old-version"}}); err != nil {
		t.Fatal(err)
	}
	if got := core.EmailIgnoredFingerprints(shop); len(got) != 0 {
		t.Fatalf("old version fingerprints should expire, got %+v", got)
	}
	if err := writeJSON(path, emailIgnoredFingerprintStore{Version: emailIgnoredFingerprintVersion, Fingerprints: []string{"new", "new", "valid"}}); err != nil {
		t.Fatal(err)
	}
	got := core.EmailIgnoredFingerprints(shop)
	if len(got) != 2 || got[0] != "new" || got[1] != "valid" {
		t.Fatalf("new version fingerprints should load, got %+v", got)
	}
}

func TestEmailScanStatePersistsPerShop(t *testing.T) {
	dir := t.TempDir()
	core := &Core{dataDir: dir, cache: map[string][]Conversation{}}
	shop := Shop{AdapterName: "zhanfu", AdapterInstance: "default", MallID: "3072028", DisplayName: "test-shop"}
	state := EmailScanState{
		LastSuccessfulEmailScanAt: "2026-06-22T10:00:00Z",
		Provider:                  "gmail",
		Mailbox:                   "test-shop",
		LastStatus:                "ready",
		LastCount:                 2,
		LastIgnored:               3,
	}
	core.SaveEmailScanState(shop, state)
	got := core.EmailScanState(shop)
	if got.LastSuccessfulEmailScanAt != state.LastSuccessfulEmailScanAt || got.Provider != "gmail" || got.LastCount != 2 || got.LastIgnored != 3 {
		t.Fatalf("unexpected email scan state: %+v", got)
	}
	path := filepath.Join(dir, "cache", "email_state_"+safeFileName(shopKey(shop))+".json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var stored EmailScanState
	if err := json.Unmarshal(raw, &stored); err != nil {
		t.Fatal(err)
	}
	if stored.UpdatedAt == "" {
		t.Fatalf("expected updatedAt to be set in persisted state: %+v", stored)
	}
}
