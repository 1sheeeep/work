package appcore

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"shopify-support-platform/internal/winexec"
)

type Core struct {
	rootDir      string
	dataDir      string
	configDir    string
	configPath   string
	logPath      string
	settings     Settings
	logger       *Logger
	openResult   OpenResult
	cache        map[string][]Conversation
	productCache map[string][]ProductCard
	mu           sync.Mutex
	bootstrapped bool
}

const emailIgnoredFingerprintVersion = 2

type emailIgnoredFingerprintStore struct {
	Version      int      `json:"version"`
	Fingerprints []string `json:"fingerprints"`
}

func NewCore() *Core {
	root := detectRootDir()
	data := detectDataDir(root)
	return &Core{
		rootDir:      root,
		dataDir:      data,
		configDir:    filepath.Join(data, "config"),
		configPath:   filepath.Join(data, "config", "settings.json"),
		logPath:      filepath.Join(data, "logs", "runtime.log"),
		cache:        map[string][]Conversation{},
		productCache: map[string][]ProductCard{},
	}
}

func (c *Core) Bootstrap() {
	_ = os.MkdirAll(c.configDir, 0755)
	_ = os.MkdirAll(filepath.Join(c.dataDir, "logs"), 0755)
	_ = os.MkdirAll(filepath.Join(c.dataDir, "cache"), 0755)
	_ = os.MkdirAll(filepath.Join(c.dataDir, "attachments"), 0755)
	hideDirectory(c.dataDir)
	c.logger = NewLogger(c.logPath)
	c.settings = c.loadSettings()
	c.migrateLegacyData()
	c.bootstrapped = true
	c.Log("app.bootstrap", map[string]any{"rootDir": c.rootDir, "dataDir": c.dataDir})
}

func hideDirectory(path string) {
	if runtime.GOOS != "windows" || path == "" {
		return
	}
	cmd := exec.Command("attrib", "+h", path)
	winexec.HideWindow(cmd)
	_ = cmd.Run()
}

func (c *Core) RootDir() string    { return c.rootDir }
func (c *Core) DataDir() string    { return c.dataDir }
func (c *Core) ConfigPath() string { return c.configPath }

func (c *Core) State() BootstrapState {
	c.mu.Lock()
	defer c.mu.Unlock()
	return BootstrapState{
		RootDir:        c.rootDir,
		DataDir:        c.dataDir,
		ConfigPath:     c.configPath,
		LogPath:        c.logPath,
		Settings:       c.settings,
		LastOpenResult: c.openResult,
	}
}

func (c *Core) Settings() Settings {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.settings
}

func (c *Core) SaveSettings(settings Settings) ActionResult {
	c.mu.Lock()
	current := cloneSettings(c.settings)
	merged := mergeSettings(cloneSettings(c.settings), normalizeSettings(settings))
	c.settings = normalizeSettings(preserveSensitiveSettings(current, normalizeSettings(merged)))
	c.mu.Unlock()
	if err := c.writeSettings(c.settings); err != nil {
		c.Log("settings.save.failed", map[string]any{"error": err.Error()})
		return Fail(err.Error())
	}
	c.Log("settings.save.ok", nil)
	return OK(c.settings)
}

func (c *Core) Logger() *Logger { return c.logger }

func (c *Core) Log(event string, details any) {
	if c.logger != nil {
		c.logger.Append(event, details)
	}
}

func (c *Core) TailLogs(maxLines int) string {
	if c.logger == nil {
		return ""
	}
	return c.logger.Tail(maxLines)
}

func (c *Core) SetOpenResult(result OpenResult) {
	c.mu.Lock()
	c.openResult = result
	c.mu.Unlock()
}

func (c *Core) OpenResult() OpenResult {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.openResult
}

func (c *Core) ConversationCache(shop Shop) []Conversation {
	key := shopKey(shop)
	path := filepath.Join(c.dataDir, "cache", safeFileName(key)+".json")
	rewrite := false
	dropped := 0
	invalidFile := false
	c.mu.Lock()
	items := c.cache[key]
	if len(items) == 0 {
		if raw, err := os.ReadFile(path); err == nil {
			if err := json.Unmarshal(raw, &items); err != nil {
				items = nil
				invalidFile = true
				rewrite = true
			}
		}
	}
	if cleaned, count := sanitizeConversationCache(items); count > 0 {
		items = cleaned
		dropped = count
		rewrite = true
	}
	c.cache[key] = items
	out := cloneConversations(items)
	c.mu.Unlock()
	if rewrite {
		_ = writeJSON(path, out)
		c.Log("conversation.cache.sanitized", map[string]any{"shop": shop.DisplayName, "dropped": dropped, "invalid_file": invalidFile})
	}
	return out
}

func (c *Core) StoreConversations(shop Shop, conversations []Conversation) {
	conversations = AnnotateDuplicates(conversations)
	if cleaned, dropped := sanitizeConversationCache(conversations); dropped > 0 {
		conversations = cleaned
		c.Log("conversation.cache.sanitized", map[string]any{"shop": shop.DisplayName, "dropped": dropped})
	}
	key := shopKey(shop)
	c.mu.Lock()
	conversations = mergeRicherConversationDetails(c.cache[key], conversations)
	c.cache[key] = conversations
	c.mu.Unlock()
	path := filepath.Join(c.dataDir, "cache", safeFileName(key)+".json")
	_ = writeJSON(path, conversations)
}

func mergeRicherConversationDetails(existing []Conversation, next []Conversation) []Conversation {
	if len(existing) == 0 || len(next) == 0 {
		return next
	}
	out := cloneConversations(next)
	for index := range out {
		current := out[index]
		for _, old := range existing {
			if !sameConversationIdentity(old, current) || old.Source != current.Source {
				continue
			}
			out[index] = preserveRicherConversationFields(old, current)
			break
		}
	}
	return out
}

func preserveRicherConversationFields(old Conversation, next Conversation) Conversation {
	if freshMailAPIConversation(old, next) {
		return preserveLocalConversationFields(old, next)
	}
	if conversationDetailScore(old) <= conversationDetailScore(next) {
		return preserveLocalConversationFields(old, next)
	}
	merged := next
	if len(old.Messages) > len(next.Messages) || messageAssetCount(old.Messages) > messageAssetCount(next.Messages) {
		merged.Messages = old.Messages
	}
	if len(old.RawLines) > len(next.RawLines) {
		merged.RawLines = old.RawLines
	}
	if len(old.CustomerProfileLines) > len(next.CustomerProfileLines) {
		merged.CustomerProfileLines = old.CustomerProfileLines
	}
	if len(old.OrderCartLines) > len(next.OrderCartLines) {
		merged.OrderCartLines = old.OrderCartLines
	}
	if len(old.OrderLinks) > len(next.OrderLinks) {
		merged.OrderLinks = old.OrderLinks
	}
	if len(old.ProductCards) > len(next.ProductCards) {
		merged.ProductCards = old.ProductCards
	}
	if len(old.ProductInterestTitles) > len(next.ProductInterestTitles) {
		merged.ProductInterestTitles = old.ProductInterestTitles
	}
	merged.DataSources = mergeStringSet(old.DataSources, next.DataSources)
	if old.DetailFingerprint != "" && conversationDetailScore(old) > conversationDetailScore(next) {
		merged.DetailFingerprint = old.DetailFingerprint
	}
	if strings.TrimSpace(next.CustomerFullName) == "" {
		merged.CustomerFullName = old.CustomerFullName
	}
	if strings.TrimSpace(next.CustomerEmail) == "" {
		merged.CustomerEmail = old.CustomerEmail
	}
	return preserveLocalConversationFields(old, merged)
}

func freshMailAPIConversation(old Conversation, next Conversation) bool {
	if !hasMailAPIDataSource(next) {
		return false
	}
	nextTime := conversationFreshnessTime(next)
	if nextTime.IsZero() {
		return false
	}
	oldTime := conversationFreshnessTime(old)
	return oldTime.IsZero() || !nextTime.Before(oldTime)
}

func hasMailAPIDataSource(conversation Conversation) bool {
	for _, source := range conversation.DataSources {
		switch strings.ToLower(strings.TrimSpace(source)) {
		case "outlook_api", "gmail_api", "cuiqiu_api":
			return true
		}
	}
	return false
}

func conversationFreshnessTime(conversation Conversation) time.Time {
	for _, value := range []string{conversation.FetchedAt, conversation.LastSeen, conversation.ReceivedAt} {
		if parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(value)); err == nil {
			return parsed
		}
	}
	return time.Time{}
}

func preserveLocalConversationFields(old Conversation, next Conversation) Conversation {
	merged := next
	merged.DataSources = mergeStringSet(old.DataSources, next.DataSources)
	if strings.TrimSpace(merged.AIReply) == "" && strings.TrimSpace(old.AIReply) != "" {
		merged.AIReply = old.AIReply
		merged.AIGenerated = old.AIGenerated
		merged.AICaution = old.AICaution
		merged.AIUsed = old.AIUsed
	}
	if strings.TrimSpace(merged.AITranslation) == "" && conversationTranslationContentHash(merged) == conversationTranslationContentHash(old) {
		merged.AITranslation = old.AITranslation
	}
	if strings.TrimSpace(merged.AITranslation) != "" && merged.AITranslation == old.AITranslation && conversationTranslationContentHash(merged) != conversationTranslationContentHash(old) {
		merged.AITranslation = ""
	}
	if strings.TrimSpace(merged.AIReplyTranslation) == "" {
		merged.AIReplyTranslation = old.AIReplyTranslation
	}
	if !merged.RecordClassified && old.RecordClassified {
		merged.RecordPrimary = old.RecordPrimary
		merged.RecordSecondary = old.RecordSecondary
		merged.RecordTertiary = old.RecordTertiary
		merged.RecordRemark = old.RecordRemark
		merged.RecordClassified = old.RecordClassified
	}
	if len(merged.ProductCards) == 0 && len(old.ProductCards) > 0 {
		merged.ProductCards = old.ProductCards
	}
	if len(merged.ProductInterestTitles) == 0 && len(old.ProductInterestTitles) > 0 {
		merged.ProductInterestTitles = old.ProductInterestTitles
	}
	if strings.TrimSpace(merged.DetailFingerprint) == "" {
		merged.DetailFingerprint = old.DetailFingerprint
	}
	if isTerminalConversationStatus(old.Status) && !isTerminalConversationStatus(merged.Status) {
		merged.Status = old.Status
	}
	if isTerminalConversationStatus(old.SendStatus) && !isTerminalConversationStatus(merged.SendStatus) {
		merged.SendStatus = old.SendStatus
	}
	return merged
}

func conversationTranslationContentHash(conversation Conversation) string {
	var b strings.Builder
	b.WriteString(conversation.DetailFingerprint)
	b.WriteByte('\x1d')
	for _, message := range conversation.Messages {
		b.WriteString(message.Role)
		b.WriteByte('\x1f')
		b.WriteString(message.Time)
		b.WriteByte('\x1f')
		b.WriteString(message.SenderName)
		b.WriteByte('\x1f')
		b.WriteString(message.SenderEmail)
		b.WriteByte('\x1f')
		b.WriteString(message.Text)
		for _, asset := range message.Attachments {
			b.WriteByte('\x1f')
			b.WriteString(asset.URL)
			b.WriteByte('|')
			b.WriteString(asset.Path)
			b.WriteByte('|')
			b.WriteString(asset.Source)
		}
		b.WriteByte('\x1e')
	}
	b.WriteByte('\x1d')
	b.WriteString(strings.Join(conversation.RawLines, "\x1e"))
	b.WriteByte('\x1d')
	b.WriteString(conversation.Preview)
	b.WriteByte('\x1d')
	b.WriteString(conversation.Topic)
	return simpleTextHash(b.String())
}

func simpleTextHash(value string) string {
	hash := int32(0)
	for _, char := range value {
		hash = ((hash << 5) - hash) + int32(char)
	}
	return fmt.Sprintf("%d:%d", len(value), hash)
}

func isTerminalConversationStatus(value string) bool {
	status := strings.ToLower(strings.TrimSpace(value))
	return strings.Contains(status, "sent") ||
		strings.Contains(status, "handled") ||
		strings.Contains(status, "processed") ||
		strings.Contains(status, "已发送") ||
		strings.Contains(status, "已处理")
}

func conversationDetailScore(item Conversation) int {
	score := len(item.Messages)*10 + len(item.RawLines)*2 + len(item.CustomerProfileLines) + len(item.OrderCartLines) + len(item.OrderLinks)*2
	score += messageAssetCount(item.Messages) * 15
	for _, source := range item.DataSources {
		switch strings.TrimSpace(strings.ToLower(source)) {
		case "network_messages", "email_dom":
			score += 8
		case "inbox_images", "email_images":
			score += 20
		}
	}
	return score
}

func messageAssetCount(messages []MessageItem) int {
	total := 0
	for _, message := range messages {
		total += len(message.Attachments)
	}
	return total
}

func mergeStringSet(left []string, right []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, values := range [][]string{left, right} {
		for _, value := range values {
			value = strings.TrimSpace(value)
			if value == "" {
				continue
			}
			key := strings.ToLower(value)
			if seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, value)
		}
	}
	return out
}

func (c *Core) ShopProductCards(shop Shop) []ProductCard {
	key := shopKey(shop)
	path := c.productCardsPath(key)
	c.mu.Lock()
	items := c.productCache[key]
	if len(items) == 0 {
		if raw, err := os.ReadFile(path); err == nil {
			raw = bytes.TrimPrefix(raw, []byte{0xEF, 0xBB, 0xBF})
			_ = json.Unmarshal(raw, &items)
		}
		items = normalizeProductCards(items, 50)
		c.productCache[key] = items
	}
	out := cloneProductCards(items)
	c.mu.Unlock()
	return out
}

func (c *Core) StoreShopProductCards(shop Shop, cards []ProductCard) []ProductCard {
	normalized := normalizeProductCards(cards, 50)
	if len(normalized) == 0 {
		return c.ShopProductCards(shop)
	}
	key := shopKey(shop)
	c.mu.Lock()
	c.productCache[key] = normalized
	c.mu.Unlock()
	_ = writeJSON(c.productCardsPath(key), normalized)
	return cloneProductCards(normalized)
}

func (c *Core) productCardsPath(key string) string {
	return filepath.Join(c.dataDir, "cache", "product_links_"+safeFileName(key)+".json")
}

func (c *Core) EmailIgnoredFingerprints(shop Shop) []string {
	key := shopKey(shop)
	path := c.emailIgnorePath(key)
	if raw, err := os.ReadFile(path); err == nil {
		raw = bytes.TrimPrefix(raw, []byte{0xEF, 0xBB, 0xBF})
		var store emailIgnoredFingerprintStore
		if err := json.Unmarshal(raw, &store); err == nil && store.Version == emailIgnoredFingerprintVersion {
			return normalizeStringSet(store.Fingerprints, 2000)
		}
	}
	return nil
}

func (c *Core) MergeEmailIgnoredFingerprints(shop Shop, fingerprints []string) int {
	next := normalizeStringSet(fingerprints, 2000)
	if len(next) == 0 {
		return 0
	}
	key := shopKey(shop)
	current := c.EmailIgnoredFingerprints(shop)
	merged := normalizeStringSet(append(current, next...), 2000)
	if len(merged) == len(current) {
		return 0
	}
	_ = writeJSON(c.emailIgnorePath(key), emailIgnoredFingerprintStore{
		Version:      emailIgnoredFingerprintVersion,
		Fingerprints: merged,
	})
	return len(merged) - len(current)
}

func (c *Core) emailIgnorePath(key string) string {
	return filepath.Join(c.dataDir, "cache", "email_ignored_"+safeFileName(key)+".json")
}

func (c *Core) EmailScanState(shop Shop) EmailScanState {
	key := shopKey(shop)
	path := c.emailStatePath(key)
	var state EmailScanState
	if raw, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(raw, &state)
	}
	return state
}

func (c *Core) SaveEmailScanState(shop Shop, state EmailScanState) {
	key := shopKey(shop)
	if strings.TrimSpace(state.UpdatedAt) == "" {
		state.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	}
	_ = writeJSON(c.emailStatePath(key), state)
}

func (c *Core) emailStatePath(key string) string {
	return filepath.Join(c.dataDir, "cache", "email_state_"+safeFileName(key)+".json")
}

func (c *Core) AllCachedConversations() []Conversation {
	c.mu.Lock()
	defer c.mu.Unlock()
	var out []Conversation
	for _, items := range c.cache {
		out = append(out, items...)
	}
	return out
}

func (c *Core) MarkHandled(conversationID string) bool {
	if strings.TrimSpace(conversationID) == "" {
		return false
	}
	changed := false
	pendingWrites := map[string][]Conversation{}
	c.mu.Lock()
	for key, conversations := range c.cache {
		shopChanged := false
		for index := range conversations {
			if conversations[index].ID == conversationID || conversations[index].ConversationID == conversationID {
				conversations[index].Status = "manual_done"
				changed = true
				shopChanged = true
			}
		}
		if shopChanged {
			c.cache[key] = conversations
			pendingWrites[key] = cloneConversations(conversations)
		}
	}
	c.mu.Unlock()
	for key, conversations := range pendingWrites {
		path := filepath.Join(c.dataDir, "cache", safeFileName(key)+".json")
		_ = writeJSON(path, conversations)
	}
	return changed
}

func (c *Core) UpdateConversation(updated Conversation) bool {
	if updated.ID == "" && updated.ConversationID == "" {
		return false
	}
	pendingWrites := map[string][]Conversation{}
	c.mu.Lock()
	for key, conversations := range c.cache {
		shopChanged := false
		for index := range conversations {
			if sameConversationIdentity(conversations[index], updated) {
				conversations[index] = updated
				shopChanged = true
			}
		}
		if shopChanged {
			c.cache[key] = conversations
			pendingWrites[key] = cloneConversations(conversations)
		}
	}
	c.mu.Unlock()
	for key, conversations := range pendingWrites {
		path := filepath.Join(c.dataDir, "cache", safeFileName(key)+".json")
		_ = writeJSON(path, conversations)
	}
	return len(pendingWrites) > 0
}

func sameConversationIdentity(left Conversation, right Conversation) bool {
	leftShop := strings.TrimSpace(left.ShopKey)
	rightShop := strings.TrimSpace(right.ShopKey)
	if leftShop != "" && rightShop != "" && leftShop != rightShop {
		return false
	}
	if strings.TrimSpace(right.ID) != "" && left.ID == right.ID {
		return true
	}
	if strings.TrimSpace(right.ConversationID) != "" && left.ConversationID == right.ConversationID {
		return true
	}
	return false
}

func cloneConversations(conversations []Conversation) []Conversation {
	out := make([]Conversation, len(conversations))
	copy(out, conversations)
	return out
}

func cloneProductCards(cards []ProductCard) []ProductCard {
	out := make([]ProductCard, len(cards))
	copy(out, cards)
	return out
}

func normalizeProductCards(cards []ProductCard, limit int) []ProductCard {
	if limit <= 0 {
		limit = 5
	}
	out := make([]ProductCard, 0, limit)
	seen := map[string]bool{}
	for _, card := range cards {
		title := strings.TrimSpace(card.Title)
		url := strings.TrimSpace(card.URL)
		if url == "" {
			continue
		}
		key := strings.ToLower(url)
		if seen[key] {
			continue
		}
		seen[key] = true
		card.Title = title
		card.URL = url
		card.ImageURL = normalizeProductImageURL(card.ImageURL)
		out = append(out, card)
		if len(out) >= limit {
			break
		}
	}
	return out
}

func normalizeProductImageURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if strings.HasPrefix(raw, "//") {
		return "https:" + raw
	}
	return raw
}

func sanitizeConversationCache(conversations []Conversation) ([]Conversation, int) {
	if len(conversations) == 0 {
		return conversations, 0
	}
	out := make([]Conversation, 0, len(conversations))
	dropped := 0
	for _, conversation := range conversations {
		if invalidUnverifiedInboxRow(conversation) || invalidNonUnreadInboxQueueItem(conversation) {
			dropped++
			continue
		}
		out = append(out, conversation)
	}
	return out, dropped
}

func invalidUnverifiedInboxRow(conversation Conversation) bool {
	if !strings.EqualFold(strings.TrimSpace(conversation.Source), "inbox") {
		return false
	}
	if conversation.DetailLoaded || len(conversation.Messages) > 0 || len(conversation.RawLines) > 0 {
		return false
	}
	hasUnverifiedSource := false
	for _, source := range conversation.DataSources {
		if strings.EqualFold(strings.TrimSpace(source), "unverified_inbox_row") {
			hasUnverifiedSource = true
			break
		}
	}
	return hasUnverifiedSource
}

func invalidNonUnreadInboxQueueItem(conversation Conversation) bool {
	if !strings.EqualFold(strings.TrimSpace(conversation.Source), "inbox") {
		return false
	}
	if !pendingQueueConversation(conversation) {
		return false
	}
	sourceURL := strings.ToLower(strings.TrimSpace(conversation.SourceURL))
	return strings.Contains(sourceURL, "/conversations/open/") || strings.Contains(sourceURL, "/conversations/closed/")
}

func pendingQueueConversation(conversation Conversation) bool {
	status := strings.ToLower(strings.TrimSpace(conversation.Status + " " + conversation.SendStatus))
	if status == "" {
		return true
	}
	return !strings.Contains(status, "sent") &&
		!strings.Contains(status, "handled") &&
		!strings.Contains(status, "processed") &&
		!strings.Contains(status, "已发送") &&
		!strings.Contains(status, "已处理")
}

func (c *Core) loadSettings() Settings {
	settings := defaultSettings()
	raw, err := os.ReadFile(c.configPath)
	if err == nil {
		var loaded Settings
		if json.Unmarshal(raw, &loaded) == nil {
			settings = mergeSettings(settings, normalizeSettings(loaded))
		}
	} else {
		legacy := filepath.Join("D:\\shopify-ai-assistant", "config", "settings.json")
		if legacyRaw, legacyErr := os.ReadFile(legacy); legacyErr == nil {
			var legacyMap map[string]any
			if json.Unmarshal(legacyRaw, &legacyMap) == nil {
				settings = settingsFromLegacy(legacyMap)
				c.Log("settings.legacy.loaded", map[string]any{"path": legacy})
			}
		}
	}
	settings = normalizeSettings(settings)
	_ = c.writeSettings(settings)
	return settings
}

func (c *Core) writeSettings(settings Settings) error {
	return writeJSON(c.configPath, settings)
}

func (c *Core) migrateLegacyData() {
	legacyData := filepath.Join("D:\\shopify-ai-assistant", "data")
	if _, err := os.Stat(legacyData); err != nil {
		return
	}
	for _, name := range []string{"knowledge_base.jsonl", "local_ai_config.json", "knowledge_digest.json"} {
		src := filepath.Join(legacyData, name)
		dst := filepath.Join(c.dataDir, name)
		if _, err := os.Stat(dst); err == nil {
			continue
		}
		if bytes, err := os.ReadFile(src); err == nil {
			_ = os.WriteFile(dst, bytes, 0644)
			c.Log("legacy.copy.ok", map[string]any{"file": name})
		}
	}
}

func detectRootDir() string {
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		if filepath.Base(dir) == "bin" && filepath.Base(filepath.Dir(dir)) == "build" {
			return filepath.Dir(filepath.Dir(dir))
		}
		if filepath.Base(dir) != "go-build" {
			return dir
		}
	}
	if wd, err := os.Getwd(); err == nil {
		return wd
	}
	if appData := os.Getenv("APPDATA"); appData != "" {
		return filepath.Join(appData, "XzdeskAgent")
	}
	return "."
}

func detectDataDir(root string) string {
	if _, err := os.Stat(filepath.Join(root, "wails.json")); err == nil {
		return filepath.Join(root, ".shopify-ai-assistant")
	}
	if appData := os.Getenv("APPDATA"); appData != "" {
		return filepath.Join(appData, "XzdeskAgent")
	}
	return filepath.Join(root, ".shopify-ai-assistant")
}

func defaultSettings() Settings {
	return Settings{
		ActiveAdapter: "zhanfu",
		Zhanfu: map[string]any{
			"base_url":                           "http://127.0.0.1:45008",
			"transport":                          "http",
			"http_port":                          45008,
			"http_timeout_seconds":               60,
			"startup_timeout_seconds":            20,
			"browser_startup_timeout_seconds":    60,
			"webdriver_timeout_seconds":          12,
			"page_size":                          100,
			"auto_start":                         false,
			"auto_start_requires_running_client": false,
			"auto_restart_for_api":               false,
			"restart_grace_seconds":              8,
			"client_exe_path":                    "",
		},
		BitBrowser: map[string]any{
			"base_url":             "http://127.0.0.1:54345",
			"http_port":            54345,
			"http_timeout_seconds": 12,
			"page_size":            100,
			"auto_detect":          true,
			"open_queue":           true,
		},
		AdsPower: map[string]any{
			"base_url":             "http://127.0.0.1:50325",
			"http_port":            50325,
			"http_timeout_seconds": 12,
			"page_size":            100,
			"auto_detect":          true,
			"api_key_env":          "ADSPOWER_API_KEY",
			"api_key":              "",
		},
		ZhanfuInstances:     []map[string]any{},
		BitBrowserInstances: []map[string]any{},
		AdsPowerInstances:   []map[string]any{},
		AI: map[string]any{
			"provider":        "deepseek",
			"enabled":         true,
			"base_url":        "https://api.deepseek.com/chat/completions",
			"model":           "deepseek-v4-flash",
			"api_key_env":     "DEEPSEEK_API_KEY",
			"api_key":         "",
			"timeout_seconds": 45,
			"temperature":     0.2,
		},
		Knowledge: map[string]any{
			"enabled":                true,
			"auto_digest":            true,
			"digest_interval_days":   7,
			"digest_min_new_entries": 20,
			"case_limit":             2,
			"digest_char_limit":      1200,
			"forbidden_terms":        []string{},
		},
		Mail: map[string]any{
			"provider":                  "outlook",
			"api_read_enabled":          true,
			"auto_web_fallback_enabled": false,
			"outlook_client_id":         "3a7e1407-e470-472c-b09b-8ba1d3940793",
			"redirect_uri":              "http://localhost:8400/",
			"adapter_modes": map[string]any{
				"zhanfu":     "api_direct",
				"bitbrowser": "api_proxy",
				"adspower":   "api_proxy",
			},
			"disabled_api_shop_ids": []any{},
			"proxy_bindings":        []map[string]any{},
			"gmail":                 map[string]any{"enabled": false},
		},
	}
}

func normalizeSettings(settings Settings) Settings {
	if settings.Zhanfu == nil {
		settings.Zhanfu = map[string]any{}
	}
	if settings.BitBrowser == nil {
		settings.BitBrowser = map[string]any{}
	}
	if settings.AdsPower == nil {
		settings.AdsPower = map[string]any{}
	}
	if settings.AI == nil {
		settings.AI = map[string]any{}
	}
	if settings.Knowledge == nil {
		settings.Knowledge = map[string]any{}
	}
	if settings.Mail == nil {
		settings.Mail = map[string]any{}
	}
	settings.Zhanfu["base_url"] = "http://127.0.0.1:45008"
	settings.Zhanfu["http_port"] = 45008
	mirrorZhanfuClientPathAlias(settings.Zhanfu)
	settings.BitBrowser["base_url"] = "http://127.0.0.1:54345"
	settings.BitBrowser["http_port"] = 54345
	settings.AdsPower["base_url"] = "http://127.0.0.1:50325"
	settings.AdsPower["http_port"] = 50325
	settings.AdsPower["api_key_env"] = "ADSPOWER_API_KEY"
	if stringFromMap(settings.AdsPower, "api_key") == "" && stringFromMap(settings.AdsPower, "apiKey") == "" {
		for _, item := range settings.AdsPowerInstances {
			if key := stringFromMap(item, "api_key"); key != "" {
				settings.AdsPower["api_key"] = key
				settings.AdsPower["apiKey"] = key
				break
			}
			if key := stringFromMap(item, "apiKey"); key != "" {
				settings.AdsPower["api_key"] = key
				settings.AdsPower["apiKey"] = key
				break
			}
		}
	}
	mirrorSensitiveKeyAlias(settings.AdsPower)
	settings.AI["provider"] = "deepseek"
	if _, ok := settings.AI["enabled"]; !ok {
		settings.AI["enabled"] = true
	}
	settings.AI["base_url"] = "https://api.deepseek.com/chat/completions"
	settings.AI["model"] = "deepseek-v4-flash"
	settings.AI["api_key_env"] = "DEEPSEEK_API_KEY"
	mirrorSensitiveKeyAlias(settings.AI)
	if stringFromMap(settings.Mail, "provider") == "" {
		settings.Mail["provider"] = "outlook"
	}
	if _, ok := settings.Mail["api_read_enabled"]; !ok {
		settings.Mail["api_read_enabled"] = true
	}
	if _, ok := settings.Mail["auto_web_fallback_enabled"]; !ok {
		settings.Mail["auto_web_fallback_enabled"] = false
	}
	if stringFromMap(settings.Mail, "outlook_client_id") == "" {
		settings.Mail["outlook_client_id"] = "3a7e1407-e470-472c-b09b-8ba1d3940793"
	}
	if stringFromMap(settings.Mail, "redirect_uri") == "" {
		settings.Mail["redirect_uri"] = "http://localhost:8400/"
	}
	if _, ok := settings.Mail["proxy_bindings"]; !ok {
		settings.Mail["proxy_bindings"] = []map[string]any{}
	}
	if _, ok := settings.Mail["disabled_api_shop_ids"]; !ok {
		settings.Mail["disabled_api_shop_ids"] = []any{}
	}
	if _, ok := settings.Mail["adapter_modes"]; !ok {
		settings.Mail["adapter_modes"] = map[string]any{
			"zhanfu":     "api_direct",
			"bitbrowser": "api_proxy",
			"adspower":   "api_proxy",
		}
	}
	if _, ok := settings.Mail["gmail"]; !ok {
		settings.Mail["gmail"] = map[string]any{"enabled": false}
	}
	return settings
}

func stringFromMap(values map[string]any, key string) string {
	if values == nil {
		return ""
	}
	value, ok := values[key]
	if !ok || value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func mirrorSensitiveKeyAlias(values map[string]any) {
	if values == nil {
		return
	}
	canonical := stringFromMap(values, "api_key")
	alias := stringFromMap(values, "apiKey")
	if canonical == "" && alias != "" {
		values["api_key"] = alias
		return
	}
	if canonical != "" && alias == "" {
		values["apiKey"] = canonical
	}
}

func mirrorZhanfuClientPathAlias(values map[string]any) {
	if values == nil {
		return
	}
	canonical := stringFromMap(values, "client_exe_path")
	alias := stringFromMap(values, "clientPath")
	if canonical == "" && alias != "" {
		values["client_exe_path"] = alias
		return
	}
	if canonical != "" && alias == "" {
		values["clientPath"] = canonical
	}
}

func mergeSettings(base Settings, override Settings) Settings {
	if override.ActiveAdapter != "" {
		base.ActiveAdapter = override.ActiveAdapter
	}
	base.Zhanfu = mergeMap(base.Zhanfu, override.Zhanfu)
	base.BitBrowser = mergeMap(base.BitBrowser, override.BitBrowser)
	base.AdsPower = mergeMap(base.AdsPower, override.AdsPower)
	if override.ZhanfuInstances != nil {
		base.ZhanfuInstances = override.ZhanfuInstances
	}
	if override.BitBrowserInstances != nil {
		base.BitBrowserInstances = override.BitBrowserInstances
	}
	if override.AdsPowerInstances != nil {
		base.AdsPowerInstances = override.AdsPowerInstances
	}
	base.AI = mergeMap(base.AI, override.AI)
	base.Knowledge = mergeMap(base.Knowledge, override.Knowledge)
	base.Mail = mergeMap(base.Mail, override.Mail)
	base.Raw = override.Raw
	return base
}

func settingsFromLegacy(raw map[string]any) Settings {
	settings := defaultSettings()
	if value, ok := raw["active_adapter"].(string); ok && value != "" {
		settings.ActiveAdapter = value
	}
	copyMap := func(target *map[string]any, key string) {
		if value, ok := raw[key].(map[string]any); ok {
			*target = mergeMap(*target, value)
		}
	}
	copyMap(&settings.Zhanfu, "zhanfu")
	copyMap(&settings.BitBrowser, "bitbrowser")
	copyMap(&settings.AdsPower, "adspower")
	copyMap(&settings.AI, "ai")
	copyMap(&settings.Knowledge, "knowledge")
	copyMap(&settings.Mail, "mail")
	settings.ZhanfuInstances = legacyList(raw["zhanfu_instances"])
	settings.BitBrowserInstances = legacyList(raw["bitbrowser_instances"])
	settings.AdsPowerInstances = legacyList(raw["adspower_instances"])
	settings.Raw = raw
	return settings
}

func legacyList(value any) []map[string]any {
	items, _ := value.([]any)
	out := []map[string]any{}
	for _, item := range items {
		if row, ok := item.(map[string]any); ok {
			out = append(out, row)
		}
	}
	return out
}

func mergeMap(base map[string]any, override map[string]any) map[string]any {
	if base == nil {
		base = map[string]any{}
	}
	for key, value := range override {
		base[key] = value
	}
	return base
}

func preserveSensitiveSettings(current Settings, next Settings) Settings {
	next.Zhanfu = preserveSensitiveKeys(current.Zhanfu, next.Zhanfu, "client_exe_path", "clientPath")
	next.AdsPower = preserveSensitiveKeys(current.AdsPower, next.AdsPower, "api_key", "apiKey")
	next.AI = preserveSensitiveKeys(current.AI, next.AI, "api_key", "apiKey")
	next.Mail = preserveMailSensitiveSettings(current.Mail, next.Mail)
	for i := range next.AdsPowerInstances {
		if i < len(current.AdsPowerInstances) {
			next.AdsPowerInstances[i] = preserveSensitiveKeys(current.AdsPowerInstances[i], next.AdsPowerInstances[i], "api_key", "apiKey")
		}
	}
	return next
}

func cloneSettings(settings Settings) Settings {
	return Settings{
		ActiveAdapter:       settings.ActiveAdapter,
		Zhanfu:              cloneMap(settings.Zhanfu),
		BitBrowser:          cloneMap(settings.BitBrowser),
		AdsPower:            cloneMap(settings.AdsPower),
		ZhanfuInstances:     cloneMapList(settings.ZhanfuInstances),
		BitBrowserInstances: cloneMapList(settings.BitBrowserInstances),
		AdsPowerInstances:   cloneMapList(settings.AdsPowerInstances),
		AI:                  cloneMap(settings.AI),
		Knowledge:           cloneMap(settings.Knowledge),
		Mail:                cloneMap(settings.Mail),
		Raw:                 cloneMap(settings.Raw),
	}
}

func preserveMailSensitiveSettings(current map[string]any, next map[string]any) map[string]any {
	next = preserveSensitiveKeys(current, next, "outlook_client_id")
	currentBindings := mailBindingList(current)
	nextBindings := mailBindingList(next)
	for i, nextBinding := range nextBindings {
		currentBinding := findMailBinding(currentBindings, mapString(nextBinding, "mall_id"), mapString(nextBinding, "email"))
		if currentBinding == nil && i < len(currentBindings) {
			currentBinding = currentBindings[i]
		}
		if currentBinding == nil {
			continue
		}
		nextBindings[i] = preserveSensitiveKeys(currentBinding, nextBinding, "proxy_url", "access_token", "refresh_token")
	}
	if len(nextBindings) > 0 {
		next["proxy_bindings"] = nextBindings
	}
	return next
}

func mailBindingList(values map[string]any) []map[string]any {
	if values == nil {
		return nil
	}
	raw, ok := values["proxy_bindings"]
	if !ok || raw == nil {
		return nil
	}
	if typed, ok := raw.([]map[string]any); ok {
		return typed
	}
	items, ok := raw.([]any)
	if !ok {
		return nil
	}
	out := []map[string]any{}
	for _, item := range items {
		if row, ok := item.(map[string]any); ok {
			out = append(out, row)
		}
	}
	return out
}

func findMailBinding(bindings []map[string]any, mallID string, email string) map[string]any {
	email = strings.ToLower(strings.TrimSpace(email))
	for _, binding := range bindings {
		if mallID != "" && mapString(binding, "mall_id") == mallID {
			return binding
		}
		if email != "" && strings.ToLower(mapString(binding, "email")) == email {
			return binding
		}
	}
	return nil
}

func cloneMap(values map[string]any) map[string]any {
	if values == nil {
		return nil
	}
	out := make(map[string]any, len(values))
	for key, value := range values {
		out[key] = value
	}
	return out
}

func cloneMapList(values []map[string]any) []map[string]any {
	if values == nil {
		return nil
	}
	out := make([]map[string]any, 0, len(values))
	for _, value := range values {
		out = append(out, cloneMap(value))
	}
	return out
}

func preserveSensitiveKeys(current map[string]any, next map[string]any, keys ...string) map[string]any {
	if next == nil {
		next = map[string]any{}
	}
	for _, key := range keys {
		if strings.TrimSpace(mapString(next, key)) != "" {
			continue
		}
		if value := strings.TrimSpace(mapString(current, key)); value != "" {
			next[key] = value
		}
	}
	return next
}

func mapString(values map[string]any, key string) string {
	if values == nil {
		return ""
	}
	value, ok := values[key]
	if !ok || value == nil {
		return ""
	}
	return strings.TrimSpace(strings.Trim(fmt.Sprint(value), `"`))
}

func writeJSON(path string, value any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, payload, 0644)
}

func ShopKey(shop Shop) string {
	return shop.AdapterName + "_" + shop.AdapterInstance + "_" + shop.MallID
}

func shopKey(shop Shop) string {
	return ShopKey(shop)
}

func safeFileName(value string) string {
	out := make([]rune, 0, len(value))
	for _, ch := range value {
		if ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9' || ch == '-' || ch == '_' {
			out = append(out, ch)
		} else {
			out = append(out, '_')
		}
	}
	if len(out) == 0 {
		return time.Now().Format("20060102150405")
	}
	return string(out)
}

func normalizeStringSet(items []string, limit int) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(items))
	for _, item := range items {
		item = strings.TrimSpace(item)
		if item == "" || seen[item] {
			continue
		}
		seen[item] = true
		out = append(out, item)
	}
	if limit > 0 && len(out) > limit {
		out = out[len(out)-limit:]
	}
	return out
}

func AnnotateDuplicates(conversations []Conversation) []Conversation {
	counts := map[string]int{}
	for _, item := range conversations {
		counts[duplicateKey(item)]++
	}
	seen := map[string]int{}
	out := make([]Conversation, len(conversations))
	for i, item := range conversations {
		key := duplicateKey(item)
		seen[key]++
		item.DuplicateIndex = seen[key]
		item.DuplicateCount = counts[key]
		out[i] = item
	}
	return out
}

func duplicateKey(item Conversation) string {
	shopPrefix := strings.ToLower(strings.TrimSpace(item.ShopKey))
	if shopPrefix != "" {
		shopPrefix += "|"
	}
	source := strings.ToLower(strings.TrimSpace(item.Source))
	if isEmailConversationSource(source) {
		if identity := strings.ToLower(strings.TrimSpace(firstNonEmpty(item.ConversationID, item.SourceURL, item.ID))); identity != "" {
			return strings.ToLower(strings.TrimSpace(shopPrefix + source + "|message|" + identity))
		}
	}
	if email := strings.ToLower(strings.TrimSpace(item.CustomerEmail)); email != "" {
		return strings.ToLower(strings.TrimSpace(shopPrefix + item.Source + "|email|" + email))
	}
	key := strings.ToLower(strings.TrimSpace(shopPrefix + item.Source + "|" + item.CustomerName + "|" + item.Preview))
	if key == "||" {
		return item.ID
	}
	return key
}

func isEmailConversationSource(source string) bool {
	switch strings.ToLower(strings.TrimSpace(source)) {
	case "gmail", "outlook", "fastmo", "cuiqiu":
		return true
	default:
		return false
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
