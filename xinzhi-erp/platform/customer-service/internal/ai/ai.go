package ai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"shopify-support-platform/internal/appcore"
	"shopify-support-platform/internal/knowledge"
	"shopify-support-platform/internal/records"
)

type Client struct {
	settings map[string]any
	store    knowledge.Store
	log      logger
}

type Status struct {
	Enabled     bool   `json:"enabled"`
	BaseURL     string `json:"baseUrl"`
	Model       string `json:"model"`
	KeyVariable string `json:"keyVariable"`
	HasLocalKey bool   `json:"hasLocalKey"`
	HasEnvKey   bool   `json:"hasEnvKey"`
	HasKey      bool   `json:"hasKey"`
	KeySource   string `json:"keySource"`
	Connected   bool   `json:"connected"`
	Error       string `json:"error,omitempty"`
	Message     string `json:"message"`
}

type logger interface {
	Append(event string, details any)
}

func NewClient(settings map[string]any, store knowledge.Store, log logger) Client {
	return Client{settings: settings, store: store, log: log}
}

func ProbeSettings(settings map[string]any) Status {
	key, source, envName, hasLocal, hasEnv := resolveAPIKey(settings)
	status := Status{
		Enabled:     boolSetting(settings, "enabled", false),
		BaseURL:     stringSettingPreserveBlank(settings, "base_url", "https://api.deepseek.com/chat/completions"),
		Model:       stringSettingPreserveBlank(settings, "model", "deepseek-v4-flash"),
		KeyVariable: envName,
		HasLocalKey: hasLocal,
		HasEnvKey:   hasEnv,
		HasKey:      key != "",
		KeySource:   source,
	}
	switch {
	case strings.TrimSpace(status.BaseURL) == "":
		status.Message = "缺少 AI Base URL"
	case strings.TrimSpace(status.Model) == "":
		status.Message = "缺少 AI Model"
	case !status.HasKey:
		status.Message = "缺少 AI API Key"
	default:
		client := Client{settings: settings}
		if _, err := client.callWithTimeout("请只回复：AI 连接正常。", 12); err != nil {
			status.Message = "AI 接入失败"
			status.Error = err.Error()
			return status
		}
		status.Connected = true
		status.Message = "AI 已接入"
	}
	return status
}

func (c Client) Test() (string, error) {
	text, err := c.callWithTimeout("请只回复：AI 连接正常。", 12)
	if err != nil {
		return "", err
	}
	return text, nil
}

func (c Client) GenerateReply(conversation appcore.Conversation) (appcore.Conversation, error) {
	if conversation.CustomerName == "" && conversation.Preview == "" {
		return conversation, fmt.Errorf("会话为空")
	}
	var relevant []appcore.KnowledgeEntry
	var digest string
	forbiddenTerms := forbiddenTermsFromSettings(c.settings)
	if boolSetting(c.settings, "knowledge_enabled", true) {
		relevant = c.store.Relevant(conversation, intSetting(c.settings, "case_limit", 2))
		digest = c.store.Digest(intSetting(c.settings, "digest_char_limit", 1200))
	}
	prompt := buildReplyPrompt(conversation, relevant, digest, forbiddenTerms)
	var reply string
	var caution bool
	if boolSetting(c.settings, "enabled", false) {
		text, err := c.call(prompt)
		if err != nil {
			return conversation, err
		}
		reply = strings.TrimSpace(text)
		if shouldRepairReplyLanguage(conversation, reply) {
			repaired, err := c.call(buildReplyLanguageRepairPrompt(conversation, reply))
			if err != nil {
				return conversation, err
			}
			reply = strings.TrimSpace(repaired)
			if shouldRepairReplyLanguage(conversation, reply) {
				return conversation, fmt.Errorf("AI 回复包含中文，未能稳定转换为客户语种")
			}
		}
		if hits := forbiddenTermHits(reply, forbiddenTerms); len(hits) > 0 {
			repaired, err := c.call(buildForbiddenTermsRepairPrompt(conversation, reply, hits))
			if err == nil {
				reply = strings.TrimSpace(repaired)
				if shouldRepairReplyLanguage(conversation, reply) {
					if languageRepaired, languageErr := c.call(buildReplyLanguageRepairPrompt(conversation, reply)); languageErr == nil {
						reply = strings.TrimSpace(languageRepaired)
					}
				}
			} else if c.log != nil {
				c.log.Append("ai.reply.forbidden_repair.failed", map[string]any{"error": err.Error(), "hits": hits})
			}
			if hits = forbiddenTermHits(reply, forbiddenTerms); len(hits) > 0 {
				caution = true
				if c.log != nil {
					c.log.Append("ai.reply.forbidden_terms.detected", map[string]any{"hits": hits})
				}
			}
		}
	} else {
		reply = fallbackReply(conversation)
		caution = true
	}
	conversation.AIReply = reply
	conversation.AIGenerated = true
	conversation.AICaution = caution || conversation.NeedsReview || conversation.DataConflict
	return conversation, nil
}

func (c Client) TranslateCustomerContext(conversation appcore.Conversation) (appcore.Conversation, error) {
	text := translationContext(conversation)
	if text == "" {
		text = conversation.Preview
	}
	if text == "" {
		return conversation, fmt.Errorf("没有可翻译的对话内容")
	}
	result, err := c.translate("把下面完整客服对话历史翻译成简洁中文。必须同时翻译客户消息和店铺/客服已发出的消息；保留说话方 Customer/Store、时间、订单号、邮箱、金额、物流号和链接，不要总结、不要省略上下文：\n\n" + text)
	if err != nil {
		return conversation, err
	}
	conversation.AITranslation = result
	return conversation, nil
}

func translationContext(conversation appcore.Conversation) string {
	var b strings.Builder
	if len(conversation.Messages) > 0 {
		for _, message := range messagesForTranslation(conversation) {
			role := strings.TrimSpace(message.Role)
			if role == "" {
				role = "customer"
			}
			if strings.EqualFold(role, "store") {
				role = "Store"
			} else if strings.EqualFold(role, "customer") {
				role = "Customer"
			}
			timeText := strings.TrimSpace(message.Time)
			if timeText != "" {
				fmt.Fprintf(&b, "%s [%s]: %s\n", role, timeText, message.Text)
			} else {
				fmt.Fprintf(&b, "%s: %s\n", role, message.Text)
			}
		}
		return strings.TrimSpace(b.String())
	}
	return strings.TrimSpace(strings.Join(conversation.RawLines, "\n"))
}

func messagesForTranslation(conversation appcore.Conversation) []appcore.MessageItem {
	messages := conversation.Messages
	return append([]appcore.MessageItem(nil), messages...)
}

func clockMinutes(value string) (int, bool) {
	match := regexp.MustCompile(`(\d{1,2}):(\d{2})`).FindStringSubmatch(value)
	if len(match) < 3 {
		return 0, false
	}
	hour, err1 := strconv.Atoi(match[1])
	minute, err2 := strconv.Atoi(match[2])
	if err1 != nil || err2 != nil || hour < 0 || hour > 23 || minute < 0 || minute > 59 {
		return 0, false
	}
	lower := strings.ToLower(value)
	if strings.Contains(lower, "pm") || strings.Contains(value, "下午") || strings.Contains(value, "涓嬪崍") {
		if hour < 12 {
			hour += 12
		}
	}
	if (strings.Contains(lower, "am") || strings.Contains(value, "上午") || strings.Contains(value, "涓婂崍")) && hour == 12 {
		hour = 0
	}
	return hour*60 + minute, true
}

func (c Client) TranslateReplyBoxText(text string, conversation appcore.Conversation, target string) (string, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return "", fmt.Errorf("回复内容为空")
	}
	target = strings.TrimSpace(strings.ToLower(target))
	if target != "zh" && target != "customer" {
		return "", fmt.Errorf("unsupported translation target: %s", target)
	}
	return c.translate(buildReplyBoxTranslationPrompt(text, conversation, target))
}

func (c Client) SummarizeKnowledge(reason string) (string, error) {
	entries, err := c.store.List(false)
	if err != nil {
		return "", err
	}
	if len(entries) == 0 {
		return "", fmt.Errorf("知识库为空")
	}
	var b strings.Builder
	for i, entry := range entries {
		if i >= 80 {
			break
		}
		fmt.Fprintf(&b, "问题：%s\n回复：%s\n备注：%s\n\n", entry.ProblemSummary, entry.ReplyText, entry.Notes)
	}
	prompt := "请把以下客服知识库整理成可供 AI 回复参考的中文摘要，按问题类型归纳，保留禁忌和固定话术，不要编造：\n\n" + b.String()
	var summary string
	if boolSetting(c.settings, "enabled", false) {
		text, err := c.call(prompt)
		if err != nil {
			return "", err
		}
		summary = text
	} else {
		summary = "AI 未启用，已整理出本地摘要：\n" + truncate(b.String(), 1200)
	}
	if err := c.store.SaveDigest(summary, stringSetting(c.settings, "model", ""), reason); err != nil {
		return "", err
	}
	return summary, nil
}

func (c Client) ClassifyRecord(conversation appcore.Conversation, categories []records.CategoryOption) (records.ClassificationDraft, error) {
	if !boolSetting(c.settings, "enabled", false) {
		return records.ClassificationDraft{}, fmt.Errorf("AI 未启用")
	}
	rawCategories, _ := json.Marshal(categories)
	prompt := "请为下面跨境电商客服会话选择处理记录分类。只能从给定分类字典中选择，不要创造新分类。只返回 JSON，格式：{\"primary\":\"\",\"secondary\":\"\",\"tertiary\":\"\",\"remark\":\"\"}。\n\n分类字典：\n" +
		string(rawCategories) +
		"\n\n会话：\n来源：" + conversation.Source +
		"\n店铺：" + conversation.ShopName +
		"\n客户：" + conversation.CustomerName +
		"\n邮箱：" + conversation.CustomerEmail +
		"\n主题：" + conversation.Topic +
		"\n预览：" + conversation.Preview +
		"\n订单/购物车：\n" + strings.Join(conversation.OrderCartLines, "\n") +
		"\n消息：\n" + conversationContext(conversation)
	text, err := c.callWithTimeout(prompt, 18)
	if err != nil {
		return records.ClassificationDraft{}, err
	}
	text = strings.TrimSpace(text)
	text = strings.TrimPrefix(text, "```json")
	text = strings.TrimPrefix(text, "```")
	text = strings.TrimSuffix(text, "```")
	text = strings.TrimSpace(text)
	var draft records.ClassificationDraft
	if err := json.Unmarshal([]byte(text), &draft); err != nil {
		if start := strings.Index(text, "{"); start >= 0 {
			if end := strings.LastIndex(text, "}"); end > start {
				err = json.Unmarshal([]byte(text[start:end+1]), &draft)
			}
		}
		if err != nil {
			return records.ClassificationDraft{}, err
		}
	}
	draft.AutoFilled = true
	return records.ValidateDraft(draft, categories), nil
}

func (c Client) translate(prompt string) (string, error) {
	if boolSetting(c.settings, "enabled", false) {
		return c.call(prompt)
	}
	return "AI 未启用，无法调用在线翻译。请在设置中启用 AI 并配置 API Key。", nil
}

func (c Client) call(prompt string) (string, error) {
	return c.callWithTimeout(prompt, intSetting(c.settings, "timeout_seconds", 45))
}

func (c Client) callWithTimeout(prompt string, timeoutSeconds int) (string, error) {
	baseURL := stringSetting(c.settings, "base_url", "https://api.deepseek.com/chat/completions")
	model := stringSetting(c.settings, "model", "deepseek-v4-flash")
	apiKey, _, _, _, _ := resolveAPIKey(c.settings)
	if apiKey == "" {
		return "", fmt.Errorf("缺少 AI API Key，请设置环境变量或在本机配置中填写")
	}
	payload := map[string]any{
		"model": model,
		"messages": []map[string]string{
			{"role": "system", "content": "你是跨境电商客服助手。只根据给出的上下文回复，不编造物流、退款、订单状态。"},
			{"role": "user", "content": prompt},
		},
		"temperature": floatSetting(c.settings, "temperature", 0.2),
	}
	raw, _ := json.Marshal(payload)
	req, err := http.NewRequest(http.MethodPost, baseURL, bytes.NewReader(raw))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)
	if timeoutSeconds <= 0 {
		timeoutSeconds = 12
	}
	client := http.Client{Timeout: time.Duration(timeoutSeconds) * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("AI HTTP %d", resp.StatusCode)
	}
	var decoded struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return "", err
	}
	if len(decoded.Choices) == 0 {
		return "", fmt.Errorf("AI 没有返回内容")
	}
	return strings.TrimSpace(decoded.Choices[0].Message.Content), nil
}

func buildReplyBoxTranslationPrompt(text string, conversation appcore.Conversation, target string) string {
	targetLabel := "中文"
	targetRule := "把【回复框当前文本】翻译成中文核对稿。"
	if target == "customer" {
		targetLabel = "客户进线语种"
		targetRule = "把【回复框当前文本】翻译成客户进线所使用的语言。请根据客户本人消息判断客户主要语言，优先最近客户消息的语言；不要固定为英语，无法判断时才使用英语。"
	}
	var b strings.Builder
	b.WriteString("请只处理【回复框当前文本】，输出纯翻译结果，不要解释。\n")
	fmt.Fprintf(&b, "目标语言：%s。\n", targetLabel)
	b.WriteString(targetRule)
	b.WriteString("\n\n翻译标准：忠实自然翻译。内容、事实、承诺、范围不能变；可以按目标语言习惯调整语序、语法、标点和基础称呼，让收件人读起来自然。")
	b.WriteString("不允许新增解释、补偿、承诺、物流判断或订单状态判断；不允许把短回复扩写成一大段；不要加入会话上下文里有但回复框当前文本没有的信息。")
	b.WriteString("保留订单号、金额、链接、日期、产品名、国家缩写、物流号等关键信息。\n\n")
	contextText := conversationContext(conversation)
	if contextText != "" {
		b.WriteString("会话上下文（仅用于判断客户语言，不要加入译文）：\n")
		b.WriteString(contextText)
		b.WriteString("\n\n")
	}
	b.WriteString("回复框当前文本：\n")
	b.WriteString(text)
	return b.String()
}

func buildReplyPrompt(conversation appcore.Conversation, entries []appcore.KnowledgeEntry, digest string, forbiddenTerms []string) string {
	var b strings.Builder
	b.WriteString("请为以下客户会话生成一段可直接发送的客服回复。必须全程使用客户进线所使用的语言：如果客户使用西班牙语就用西班牙语回复，如果客户使用英语就用英语回复，其他语言同理；不要默认翻译成英文。严禁在非中文客户回复里混入中文固定话术、中文签名、中文客服备注或知识库中文原句；知识库和分类备注只作参考，必须翻译/转写成客户语种后再使用。要求：礼貌、简洁、先回应客户问题；不确定的信息要请客户提供或说明会人工确认；不要编造订单状态、物流状态、价格或承诺；只输出回复正文，不要解释。\n\n")
	if len(forbiddenTerms) > 0 {
		b.WriteString("AI forbidden words/phrases: do not include the following exact words or phrases in the reply, and avoid making the same risky promise in equivalent wording:\n")
		for _, term := range forbiddenTerms {
			fmt.Fprintf(&b, "- %s\n", term)
		}
		b.WriteString("\n")
	}
	fmt.Fprintf(&b, "来源：%s\n客户：%s\n邮箱：%s\n主题：%s\n预览：%s\n", conversation.Source, conversation.CustomerName, conversation.CustomerEmail, conversation.Topic, conversation.Preview)
	contextText := conversationContext(conversation)
	if contextText != "" {
		b.WriteString("\n聊天/邮件上下文：\n")
		b.WriteString(contextText)
	}
	if len(conversation.OrderCartLines) > 0 {
		b.WriteString("\n订单/购物车信息：\n")
		b.WriteString(strings.Join(conversation.OrderCartLines, "\n"))
	}
	if digest != "" {
		b.WriteString("\n知识库摘要：\n")
		b.WriteString(digest)
	}
	if len(entries) > 0 {
		b.WriteString("\n相似案例：\n")
		for _, entry := range entries {
			fmt.Fprintf(&b, "- 问题：%s\n  参考回复：%s\n", entry.ProblemSummary, entry.ReplyText)
		}
	}
	return b.String()
}

func buildForbiddenTermsRepairPrompt(conversation appcore.Conversation, reply string, hits []string) string {
	var b strings.Builder
	b.WriteString("Rewrite the customer service reply so it can be sent directly to the customer. Keep the same facts, language, tone, and useful next steps, but remove or replace these forbidden words/phrases and avoid equivalent risky promises:\n")
	for _, hit := range hits {
		fmt.Fprintf(&b, "- %s\n", hit)
	}
	b.WriteString("\nDo not add new promises, order status, tracking status, refund guarantees, medical conclusions, or liability admissions. Output only the revised reply body.\n\n")
	contextText := conversationContext(conversation)
	if contextText != "" {
		b.WriteString("Conversation context for language and facts:\n")
		b.WriteString(contextText)
		b.WriteString("\n\n")
	}
	b.WriteString("Reply to revise:\n")
	b.WriteString(reply)
	return b.String()
}

func buildReplyLanguageRepairPrompt(conversation appcore.Conversation, reply string) string {
	var b strings.Builder
	b.WriteString("下面这段客服回复混入了中文。请在不新增、不删除事实和承诺的前提下，把整段回复改成客户进线所使用的语言。")
	b.WriteString("必须保留订单号、金额、链接、日期、产品名、国家缩写、物流号；不要解释；只输出可直接发送的回复正文；非中文客户回复中不得出现中文字符。\n\n")
	contextText := conversationContext(conversation)
	if contextText != "" {
		b.WriteString("客户会话上下文（仅用于判断客户语种）：\n")
		b.WriteString(contextText)
		b.WriteString("\n\n")
	}
	b.WriteString("需要修复的回复：\n")
	b.WriteString(reply)
	return b.String()
}

func shouldRepairReplyLanguage(conversation appcore.Conversation, reply string) bool {
	reply = strings.TrimSpace(reply)
	if reply == "" || !containsHan(reply) {
		return false
	}
	return !customerLikelyChinese(conversation)
}

func customerLikelyChinese(conversation appcore.Conversation) bool {
	var b strings.Builder
	for _, message := range conversation.Messages {
		if message.Role == "customer" {
			b.WriteString(message.Text)
			b.WriteString("\n")
		}
	}
	if b.Len() == 0 {
		b.WriteString(conversation.Preview)
		b.WriteString("\n")
		b.WriteString(conversation.Topic)
	}
	return containsHan(b.String())
}

func containsHan(value string) bool {
	return regexp.MustCompile(`[\x{3400}-\x{9fff}\x{f900}-\x{faff}]`).MatchString(value)
}

func conversationContext(conversation appcore.Conversation) string {
	if len(conversation.Messages) > 0 {
		return translationContext(conversation)
	}
	return strings.TrimSpace(strings.Join(conversation.RawLines, "\n"))
}

func fallbackReply(conversation appcore.Conversation) string {
	name := strings.TrimSpace(conversation.CustomerName)
	if name == "" {
		name = "there"
	}
	return fmt.Sprintf("Hi %s,\n\nThank you for reaching out. We have received your message and will check the details for you. Could you please share any related order number or screenshots if available?\n\nBest regards,", name)
}

func resolveAPIKey(settings map[string]any) (key string, source string, envName string, hasLocal bool, hasEnv bool) {
	envName = stringSetting(settings, "api_key_env", "DEEPSEEK_API_KEY")
	localKey := strings.TrimSpace(stringSetting(settings, "api_key", ""))
	envKey := strings.TrimSpace(os.Getenv(envName))
	hasLocal = localKey != ""
	hasEnv = envKey != ""
	switch {
	case hasLocal:
		return localKey, "local", envName, true, hasEnv
	case hasEnv:
		return envKey, "env", envName, false, true
	default:
		return "", "missing", envName, false, false
	}
}

func forbiddenTermsFromSettings(settings map[string]any) []string {
	if settings == nil {
		return nil
	}
	return normalizeForbiddenTerms(settings["forbidden_terms"])
}

func normalizeForbiddenTerms(value any) []string {
	seen := map[string]bool{}
	var out []string
	add := func(raw string) {
		for _, part := range strings.FieldsFunc(raw, func(r rune) bool { return r == '\n' || r == '\r' }) {
			term := strings.TrimSpace(part)
			if term == "" {
				continue
			}
			key := strings.ToLower(term)
			if seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, term)
		}
	}
	switch typed := value.(type) {
	case []string:
		for _, item := range typed {
			add(item)
		}
	case []any:
		for _, item := range typed {
			add(fmt.Sprint(item))
		}
	case string:
		add(typed)
	}
	return out
}

func forbiddenTermHits(reply string, terms []string) []string {
	reply = strings.TrimSpace(reply)
	if reply == "" || len(terms) == 0 {
		return nil
	}
	lowerReply := strings.ToLower(reply)
	var hits []string
	for _, term := range normalizeForbiddenTerms(terms) {
		if strings.Contains(lowerReply, strings.ToLower(term)) {
			hits = append(hits, term)
		}
	}
	return hits
}

func stringSetting(settings map[string]any, key string, fallback string) string {
	if settings == nil || settings[key] == nil || fmt.Sprint(settings[key]) == "" {
		return fallback
	}
	return fmt.Sprint(settings[key])
}

func stringSettingPreserveBlank(settings map[string]any, key string, fallback string) string {
	if settings == nil {
		return fallback
	}
	value, ok := settings[key]
	if !ok || value == nil {
		return fallback
	}
	return fmt.Sprint(value)
}

func intSetting(settings map[string]any, key string, fallback int) int {
	switch value := settings[key].(type) {
	case int:
		return value
	case float64:
		return int(value)
	case json.Number:
		out, _ := value.Int64()
		return int(out)
	default:
		return fallback
	}
}

func floatSetting(settings map[string]any, key string, fallback float64) float64 {
	switch value := settings[key].(type) {
	case float64:
		return value
	case int:
		return float64(value)
	case json.Number:
		out, _ := value.Float64()
		return out
	default:
		return fallback
	}
}

func boolSetting(settings map[string]any, key string, fallback bool) bool {
	if value, ok := settings[key].(bool); ok {
		return value
	}
	return fallback
}

func truncate(value string, limit int) string {
	runes := []rune(value)
	if limit <= 0 || len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}
