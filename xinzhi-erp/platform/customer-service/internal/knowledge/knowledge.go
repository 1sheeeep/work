package knowledge

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"shopify-support-platform/internal/appcore"
)

const exportFormatVersion = 1

type Store struct {
	dataDir string
	log     logger
}

type logger interface {
	Append(event string, details any)
}

func NewStore(dataDir string, log logger) Store {
	return Store{dataDir: dataDir, log: log}
}

func (s Store) knowledgePath() string { return filepath.Join(s.dataDir, "knowledge_base.jsonl") }
func (s Store) digestPath() string    { return filepath.Join(s.dataDir, "knowledge_digest.json") }

func (s Store) Add(conversation appcore.Conversation, replyText string, shop appcore.Shop, problemSummary string, notes string) (appcore.KnowledgeEntry, error) {
	reply := strings.TrimSpace(replyText)
	if reply == "" {
		return appcore.KnowledgeEntry{}, fmt.Errorf("\u56de\u590d\u5185\u5bb9\u4e3a\u7a7a\uff0c\u4e0d\u80fd\u52a0\u5165\u77e5\u8bc6\u5e93")
	}
	entry := appcore.KnowledgeEntry{
		ID:             stableID(time.Now().Format(time.RFC3339Nano) + conversation.ID + reply),
		Enabled:        true,
		CreatedAt:      time.Now().Format(time.RFC3339),
		Source:         conversation.Source,
		ShopName:       shop.DisplayName,
		MallID:         shop.MallID,
		CustomerName:   conversation.CustomerName,
		CustomerEmail:  conversation.CustomerEmail,
		Topic:          conversation.Topic,
		ProblemSummary: firstNonEmpty(strings.TrimSpace(problemSummary), truncate(conversation.Preview, 240)),
		ContextExcerpt: truncate(conversationText(conversation), 4000),
		ReplyText:      reply,
		Notes:          strings.TrimSpace(notes),
	}
	if err := os.MkdirAll(filepath.Dir(s.knowledgePath()), 0755); err != nil {
		return appcore.KnowledgeEntry{}, err
	}
	f, err := os.OpenFile(s.knowledgePath(), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return appcore.KnowledgeEntry{}, err
	}
	defer f.Close()
	raw, _ := json.Marshal(entry)
	_, err = f.Write(append(raw, '\n'))
	if err == nil && s.log != nil {
		s.log.Append("knowledge.added", map[string]any{"id": entry.ID, "source": entry.Source, "customer": entry.CustomerName})
	}
	_ = os.Remove(s.digestPath())
	return entry, err
}

func (s Store) List(includeDisabled bool) ([]appcore.KnowledgeEntry, error) {
	path := s.knowledgePath()
	f, err := os.Open(path)
	if os.IsNotExist(err) {
		return []appcore.KnowledgeEntry{}, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var entries []appcore.KnowledgeEntry
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var entry appcore.KnowledgeEntry
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			continue
		}
		if includeDisabled || entry.Enabled {
			entries = append(entries, entry)
		}
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].CreatedAt > entries[j].CreatedAt })
	return entries, scanner.Err()
}

func (s Store) Disable(id string) (bool, error) {
	return s.rewrite(id, func(entry *appcore.KnowledgeEntry) bool {
		entry.Enabled = false
		return true
	})
}

func (s Store) Delete(id string) (bool, error) {
	entries, err := s.List(true)
	if err != nil {
		return false, err
	}
	var kept []appcore.KnowledgeEntry
	changed := false
	for _, entry := range entries {
		if entry.ID == id {
			changed = true
			continue
		}
		kept = append(kept, entry)
	}
	if changed {
		err = s.writeAll(kept)
		_ = os.Remove(s.digestPath())
	}
	return changed, err
}

func (s Store) Export(destination string) (map[string]any, error) {
	if strings.TrimSpace(destination) == "" {
		destination = filepath.Join(s.dataDir, "knowledge_export_"+time.Now().Format("20060102_150405")+".json")
	}
	entries, err := s.List(true)
	if err != nil {
		return nil, err
	}
	payload := map[string]any{
		"format_version": exportFormatVersion,
		"exported_at":    time.Now().Format(time.RFC3339),
		"app_name":       "Xzdesk Agent",
		"entry_count":    len(entries),
		"entries":        entries,
	}
	raw, _ := json.MarshalIndent(payload, "", "  ")
	if err := os.MkdirAll(filepath.Dir(destination), 0755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(destination, raw, 0644); err != nil {
		return nil, err
	}
	payload["path"] = destination
	if s.log != nil {
		s.log.Append("knowledge.exported", map[string]any{"path": destination, "entry_count": len(entries)})
	}
	return payload, nil
}

func (s Store) Import(source string) (map[string]any, error) {
	source = strings.TrimSpace(source)
	if source == "" {
		return nil, fmt.Errorf("\u8bf7\u9009\u62e9\u5bfc\u5165\u6587\u4ef6\u8def\u5f84")
	}
	raw, err := os.ReadFile(source)
	if err != nil {
		return nil, err
	}
	entriesToImport, err := decodeImportEntries(raw)
	if err != nil {
		return nil, err
	}
	existing, err := s.List(true)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	for _, entry := range existing {
		seen[fingerprint(entry)] = true
	}
	added := 0
	for _, entry := range entriesToImport {
		if entry.ID == "" {
			entry.ID = stableID(time.Now().Format(time.RFC3339Nano) + entry.ReplyText)
		}
		if entry.CreatedAt == "" {
			entry.CreatedAt = time.Now().Format(time.RFC3339)
		}
		if !seen[fingerprint(entry)] {
			existing = append(existing, entry)
			seen[fingerprint(entry)] = true
			added++
		}
	}
	if added > 0 {
		if err := s.writeAll(existing); err != nil {
			return nil, err
		}
		_ = os.Remove(s.digestPath())
	}
	result := map[string]any{"source_path": source, "imported_count": len(entriesToImport), "added_count": added, "total_count": len(existing)}
	if s.log != nil {
		s.log.Append("knowledge.imported", result)
	}
	return result, nil
}

func decodeImportEntries(raw []byte) ([]appcore.KnowledgeEntry, error) {
	var payload struct {
		FormatVersion int                      `json:"format_version"`
		Entries       []appcore.KnowledgeEntry `json:"entries"`
	}
	if err := json.Unmarshal(raw, &payload); err == nil && len(payload.Entries) > 0 {
		if payload.FormatVersion != 0 && payload.FormatVersion != exportFormatVersion {
			return nil, fmt.Errorf("\u77e5\u8bc6\u5e93\u5305\u7248\u672c\u4e0d\u652f\u6301")
		}
		return payload.Entries, nil
	}
	var entries []appcore.KnowledgeEntry
	scanner := bufio.NewScanner(strings.NewReader(string(raw)))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var entry appcore.KnowledgeEntry
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			return nil, fmt.Errorf("\u77e5\u8bc6\u5e93\u5bfc\u5165\u683c\u5f0f\u4e0d\u652f\u6301")
		}
		entries = append(entries, entry)
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if len(entries) == 0 {
		return nil, fmt.Errorf("\u77e5\u8bc6\u5e93\u5bfc\u5165\u6587\u4ef6\u4e3a\u7a7a")
	}
	return entries, nil
}

func (s Store) Relevant(conversation appcore.Conversation, limit int) []appcore.KnowledgeEntry {
	if limit <= 0 {
		limit = 3
	}
	entries, _ := s.List(false)
	type scored struct {
		score float64
		entry appcore.KnowledgeEntry
	}
	var rows []scored
	for _, entry := range entries {
		score := scoreEntry(entry, conversation)
		if score > 0.02 {
			rows = append(rows, scored{score: score, entry: entry})
		}
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].score > rows[j].score })
	if len(rows) > limit {
		rows = rows[:limit]
	}
	out := make([]appcore.KnowledgeEntry, len(rows))
	for i, row := range rows {
		out[i] = row.entry
	}
	return out
}

func (s Store) Digest(charLimit int) string {
	raw, err := os.ReadFile(s.digestPath())
	if err != nil {
		return ""
	}
	var payload map[string]any
	if json.Unmarshal(raw, &payload) != nil {
		return ""
	}
	text := strings.TrimSpace(fmt.Sprint(payload["summary"]))
	if charLimit <= 0 {
		charLimit = 1200
	}
	return truncate(text, charLimit)
}

func (s Store) DigestMeta() map[string]any {
	raw, err := os.ReadFile(s.digestPath())
	if err != nil {
		return map[string]any{}
	}
	var payload map[string]any
	if json.Unmarshal(raw, &payload) != nil {
		return map[string]any{}
	}
	return payload
}

func (s Store) SaveDigest(summary string, model string, reason string) error {
	entries, _ := s.List(false)
	payload := map[string]any{
		"updated_at":  time.Now().Format(time.RFC3339),
		"entry_count": len(entries),
		"model":       model,
		"reason":      reason,
		"summary":     strings.TrimSpace(summary),
	}
	raw, _ := json.MarshalIndent(payload, "", "  ")
	if err := os.MkdirAll(filepath.Dir(s.digestPath()), 0755); err != nil {
		return err
	}
	return os.WriteFile(s.digestPath(), raw, 0644)
}

func (s Store) rewrite(id string, mutate func(*appcore.KnowledgeEntry) bool) (bool, error) {
	entries, err := s.List(true)
	if err != nil {
		return false, err
	}
	changed := false
	for i := range entries {
		if entries[i].ID == id {
			changed = mutate(&entries[i])
			break
		}
	}
	if changed {
		err = s.writeAll(entries)
		_ = os.Remove(s.digestPath())
	}
	return changed, err
}

func (s Store) writeAll(entries []appcore.KnowledgeEntry) error {
	if err := os.MkdirAll(filepath.Dir(s.knowledgePath()), 0755); err != nil {
		return err
	}
	f, err := os.Create(s.knowledgePath())
	if err != nil {
		return err
	}
	defer f.Close()
	for _, entry := range entries {
		raw, _ := json.Marshal(entry)
		if _, err := f.Write(append(raw, '\n')); err != nil {
			return err
		}
	}
	return nil
}

func conversationText(conversation appcore.Conversation) string {
	parts := []string{
		conversation.CustomerName, conversation.CustomerFullName, conversation.CustomerEmail,
		conversation.Topic, conversation.Preview, conversationMessageText(conversation),
		strings.Join(conversation.CustomerProfileLines, "\n"), strings.Join(conversation.OrderCartLines, "\n"),
	}
	return strings.Join(parts, "\n")
}

func conversationMessageText(conversation appcore.Conversation) string {
	if len(conversation.Messages) == 0 {
		return strings.Join(conversation.RawLines, "\n")
	}
	var lines []string
	for _, message := range conversation.Messages {
		text := strings.TrimSpace(message.Text)
		if text == "" {
			continue
		}
		role := strings.TrimSpace(message.Role)
		if role == "" {
			role = "customer"
		}
		if strings.TrimSpace(message.Time) != "" {
			lines = append(lines, fmt.Sprintf("%s [%s]: %s", role, message.Time, text))
		} else {
			lines = append(lines, fmt.Sprintf("%s: %s", role, text))
		}
	}
	if len(lines) == 0 {
		return strings.Join(conversation.RawLines, "\n")
	}
	return strings.Join(lines, "\n")
}

func scoreEntry(entry appcore.KnowledgeEntry, conversation appcore.Conversation) float64 {
	source := tokenSet(conversationText(conversation))
	target := tokenSet(entry.ProblemSummary + "\n" + entry.Topic + "\n" + entry.ContextExcerpt + "\n" + entry.ReplyText + "\n" + entry.Notes)
	if len(source) == 0 || len(target) == 0 {
		return 0
	}
	overlap := 0
	for token := range source {
		if target[token] {
			overlap++
		}
	}
	score := float64(overlap) / float64(max(8, min(len(source), len(target))))
	if entry.Source == conversation.Source {
		score += 0.08
	}
	if conversation.CustomerEmail != "" && strings.EqualFold(entry.CustomerEmail, conversation.CustomerEmail) {
		score += 0.25
	}
	return score
}

func tokenSet(value string) map[string]bool {
	tokens := regexp.MustCompile(`[\pL\pN@.#-]{3,}`).FindAllString(strings.ToLower(value), -1)
	out := map[string]bool{}
	for _, token := range tokens {
		out[token] = true
	}
	return out
}

func fingerprint(entry appcore.KnowledgeEntry) string {
	return stableID(strings.ToLower(entry.Source + "\n" + entry.Topic + "\n" + entry.ProblemSummary + "\n" + entry.CustomerEmail + "\n" + entry.ReplyText))
}

func stableID(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func truncate(value string, limit int) string {
	if limit <= 0 || len([]rune(value)) <= limit {
		return value
	}
	runes := []rune(value)
	return string(runes[:limit])
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
