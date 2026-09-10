package mailapi

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"
	"time"
)

type emailFilterRow struct {
	Sender           string
	Subject          string
	Snippet          string
	Lines            []string
	FolderLabel      string
	EmailFingerprint string
}

type emailFilterConversation struct {
	CustomerEmail string
	CustomerName  string
	Topic         string
	Preview       string
	RawLines      []string
	Messages      []emailFilterMessage
}

type emailFilterMessage struct {
	Role  string
	Email string
	Text  string
}

func filterGraphMessagesLikeWeb(options map[string]any, messages []graphMessage) ([]graphMessage, int, []string) {
	return filterGraphMessagesLikeWebProvider(options, messages, providerOutlook)
}

func filterGraphMessagesLikeWebProvider(options map[string]any, messages []graphMessage, provider string) ([]graphMessage, int, []string) {
	provider = normalizeProvider(provider)
	ignored := stringSet(stringSliceOption(options, "ignored_fingerprints"))
	cutoff := parseRFC3339Option(stringOption(options, "cutoff"))
	learned := map[string]bool{}
	seen := map[string]bool{}
	ignoredCount := 0
	out := make([]graphMessage, 0, len(messages))
	for _, message := range messages {
		if message.IsRead {
			ignoredCount++
			continue
		}
		if !graphMessageMatchesQuery(message, stringOption(options, "query")) {
			continue
		}
		row := graphMessageFilterRow(message)
		row.EmailFingerprint = emailRowFingerprint(provider, row)
		if !cutoff.IsZero() {
			receivedAt, err := time.Parse(time.RFC3339, strings.TrimSpace(message.ReceivedDateTime))
			if err == nil && receivedAt.Before(cutoff) {
				ignoredCount++
				continue
			}
		}
		if shouldSkipPreviouslyIgnoredEmail(row, ignored) {
			ignoredCount++
			continue
		}
		if isHighConfidencePreDetailIgnoredEmail(row) {
			ignoredCount++
			learned[row.EmailFingerprint] = true
			continue
		}
		key := normalizeSenderValue(strings.Join([]string{provider, row.Sender, row.Subject, row.Snippet}, "\n"))
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		if !shouldKeepEmailConversation(row, graphMessageFilterConversation(message)) {
			ignoredCount++
			continue
		}
		out = append(out, message)
	}
	return out, ignoredCount, sortedKeys(learned)
}

func graphMessageMatchesQuery(message graphMessage, query string) bool {
	query = normalizeSenderValue(query)
	if query == "" {
		return true
	}
	from := message.From.EmailAddress
	body := plainText(message.Body.Content)
	haystack := normalizeSenderValue(strings.Join([]string{
		from.Name,
		from.Address,
		message.Subject,
		message.BodyPreview,
		body,
	}, "\n"))
	for _, term := range strings.Fields(query) {
		if !strings.Contains(haystack, term) {
			return false
		}
	}
	return true
}

func graphMessageFilterRow(message graphMessage) emailFilterRow {
	from := message.From.EmailAddress
	body := plainText(message.Body.Content)
	lines := []string{
		formatSender(from.Name, from.Address),
		message.Subject,
		message.BodyPreview,
		body,
	}
	return emailFilterRow{
		Sender:      formatSender(from.Name, from.Address),
		Subject:     message.Subject,
		Snippet:     firstNonEmpty(message.BodyPreview, truncate(body, 260)),
		Lines:       compactStrings(lines),
		FolderLabel: "Inbox",
	}
}

func graphMessageFilterConversation(message graphMessage) emailFilterConversation {
	from := message.From.EmailAddress
	body := plainText(message.Body.Content)
	if body == "" {
		body = message.BodyPreview
	}
	return emailFilterConversation{
		CustomerEmail: strings.TrimSpace(from.Address),
		CustomerName:  firstNonEmpty(from.Name, from.Address),
		Topic:         message.Subject,
		Preview:       firstNonEmpty(message.BodyPreview, truncate(body, 180)),
		RawLines:      compactStrings([]string{message.Subject, from.Address, body}),
		Messages: []emailFilterMessage{{
			Role:  "customer",
			Email: strings.TrimSpace(from.Address),
			Text:  body,
		}},
	}
}

func formatSender(name string, email string) string {
	name = strings.TrimSpace(name)
	email = strings.TrimSpace(email)
	if name != "" && email != "" {
		return name + " <" + email + ">"
	}
	return firstNonEmpty(email, name)
}

func isDefiniteNonCustomerEmail(row emailFilterRow) bool {
	haystack := rowHaystack(row)
	email := firstEmail(haystack)
	text := normalizeSenderValue(haystack)
	senderName := normalizeSenderValue(senderDisplayFromHeader(row.Sender))
	if isShopifyInboxCustomerNotification(text) {
		return false
	}
	if isReplyableReviewNotice(text) || hasCustomerReplyBeforeQuotedStoreRelay(row) {
		return false
	}
	if isShopifyOperationalNotification(text, senderName) || isShopifyOrderNotification(row, text) || isStoreOutboundAutoNotice(row, text) {
		return true
	}
	if (email == "service@paypal.com" || strings.Contains(senderName, "paypal")) && regexp.MustCompile(`(?i)activity report|report available|download|statement|account`).MatchString(text) {
		return true
	}
	if senderName == "facebook" || strings.HasSuffix(email, "@facebookmail.com") {
		return regexp.MustCompile(`(?i)business manager|partner request|meta|verified|page notification|security`).MatchString(text)
	}
	if regexp.MustCompile(`(?i)tiktok|tik tok|tiktokmail|account\.tiktok`).MatchString(text) {
		return true
	}
	if regexp.MustCompile(`(?i)findhealthclinics|your listing is live|listing is live|directory listing`).MatchString(text) {
		return true
	}
	if isAttachmentOnlySender(senderName) || hasShopifyStoreRelayHeader(row) {
		return true
	}
	if regexp.MustCompile(`(?i)^(google|openai|airwallex|meta for business|facebook|x|shopify billing|the jobber team|maxwell from jobber|jobber grants|littlefindsco|microsoft account team)$`).MatchString(senderName) {
		return true
	}
	if regexp.MustCompile(`(?i)account-security-noreply@accountprotection\.microsoft\.com`).MatchString(email) {
		return true
	}
	if regexp.MustCompile(`(?i)business manager partner request|activity report available|site report|seo audit|meta verified|your listing is live`).MatchString(text) {
		return true
	}
	if regexp.MustCompile(`(?i)performance[-\s]?based partnership|commission|generate sales|drive\s+\d+[\s-]*(?:to\s+)?\d*\s*orders|collab|collaboration|whatsapp number|upfront fees|retainers|extra\s+\d+[\s-]*(?:to\s+)?\d*\s*orders|orders/week|steady flow of visitors|unlock\s+\d+\s+orders|partnership opportunity|website analysis|quick look`).MatchString(text) {
		return true
	}
	if isMarketingOrToolPromotion(text, senderName, email) {
		return true
	}
	if hasStrongCustomerIntent(text) {
		return false
	}
	return false
}

func isHighConfidencePreDetailIgnoredEmail(row emailFilterRow) bool {
	haystack := rowHaystack(row)
	email := firstEmail(haystack)
	text := normalizeSenderValue(haystack)
	senderName := normalizeSenderValue(senderDisplayFromHeader(row.Sender))
	if isShopifyInboxCustomerNotification(text) {
		return false
	}
	if isReplyableReviewNotice(text) || hasCustomerReplyBeforeQuotedStoreRelay(row) {
		return false
	}
	if isShopifyOperationalNotification(text, senderName) || hasShopifyStoreRelayHeader(row) {
		return true
	}
	if regexp.MustCompile(`(?i)tiktok|tik tok|tiktokmail|account\.tiktok`).MatchString(text) {
		return true
	}
	if senderName == "facebook" || strings.HasSuffix(email, "@facebookmail.com") {
		return true
	}
	if regexp.MustCompile(`(?i)^(google|openai|airwallex|meta for business|facebook|x|shopify billing|microsoft account team)$`).MatchString(senderName) {
		return true
	}
	if regexp.MustCompile(`(?i)account-security-noreply@accountprotection\.microsoft\.com`).MatchString(email) {
		return true
	}
	return isAttachmentOnlySender(senderName)
}

func shouldSkipPreviouslyIgnoredEmail(row emailFilterRow, ignored map[string]bool) bool {
	return row.EmailFingerprint != "" && ignored[row.EmailFingerprint] && isHighConfidencePreDetailIgnoredEmail(row)
}

func shouldKeepEmailConversation(row emailFilterRow, conversation emailFilterConversation) bool {
	if isStoreOutboundAutoConversation(row, conversation) {
		return false
	}
	folder := normalizeSenderValue(row.FolderLabel)
	hasCustomerRequest := hasDirectCustomerRequestMessage(row, conversation)
	detailText := emailConversationDetailText(row, conversation)
	detailRow := emailFilterRow{
		Sender:      firstNonEmpty(row.Sender, conversation.CustomerName),
		Subject:     firstNonEmpty(row.Subject, conversation.Topic),
		Snippet:     detailText,
		Lines:       []string{detailText},
		FolderLabel: row.FolderLabel,
	}
	if regexp.MustCompile(`(?i)spam|junk|垃圾`).MatchString(folder) {
		text := normalizeSenderValue(detailText)
		return hasCustomerRequest || isReplyableReviewNotice(text) || hasStrongCustomerIntent(text)
	}
	if hasCustomerRequest {
		return true
	}
	if hasShopifyStoreRelayEmail(detailText) && hasNonStoreCustomerMessage(conversation) {
		return true
	}
	if isDefiniteNonCustomerEmail(detailRow) {
		return false
	}
	return true
}

func isStoreOutboundAutoConversation(row emailFilterRow, conversation emailFilterConversation) bool {
	detailText := emailConversationDetailText(row, conversation)
	if !isStoreOutboundAutoNotice(row, normalizeSenderValue(detailText)) {
		return false
	}
	for _, message := range conversation.Messages {
		if message.Role == "store" {
			continue
		}
		messageText := normalizeSenderValue(message.Email + "\n" + message.Text)
		if messageText != "" && !isStoreOutboundAutoNotice(row, messageText) {
			return false
		}
	}
	return true
}

func hasDirectCustomerRequestMessage(row emailFilterRow, conversation emailFilterConversation) bool {
	for _, message := range conversation.Messages {
		if message.Role == "store" || isShopifyStoreRelayEmail(message.Email) {
			continue
		}
		text := message.Email + "\n" + message.Text
		if isStoreOutboundAutoNotice(row, normalizeSenderValue(text)) {
			continue
		}
		if hasDirectCustomerSupportIntent(text) {
			return true
		}
	}
	return false
}

func hasNonStoreCustomerMessage(conversation emailFilterConversation) bool {
	if isShopifyStoreRelayEmail(conversation.CustomerEmail) {
		return false
	}
	for _, message := range conversation.Messages {
		if message.Role == "store" || isShopifyStoreRelayEmail(message.Email) {
			continue
		}
		if normalizeSenderValue(message.Text) != "" {
			return true
		}
	}
	return false
}

func rowHaystack(row emailFilterRow) string {
	return strings.Join(append([]string{row.Sender, row.Subject, row.Snippet}, row.Lines...), "\n")
}

func isShopifyInboxCustomerNotification(text string) bool {
	return regexp.MustCompile(`(?i)\byou have a new message from\b|sent via inbox|reply in inbox|this conversation hasn['’]t been assigned to anyone|manage notification settings`).MatchString(text)
}

func emailConversationDetailText(row emailFilterRow, conversation emailFilterConversation) string {
	parts := []string{rowHaystack(row), conversation.CustomerEmail, conversation.Topic, conversation.Preview}
	parts = append(parts, conversation.RawLines...)
	for _, message := range conversation.Messages {
		parts = append(parts, message.Text)
	}
	return strings.Join(compactStrings(parts), "\n")
}

func isAttachmentOnlySender(senderName string) bool {
	return regexp.MustCompile(`(?i)^(附件|附件：|attachment|attachments?)$`).MatchString(senderName)
}

func isReplyableReviewNotice(text string) bool {
	return regexp.MustCompile(`(?i)judge\.me|left (?:a )?\d star review|replying directly to this email|review notification`).MatchString(text)
}

func isMarketingOrToolPromotion(text string, senderName string, email string) bool {
	source := senderName + "\n" + email + "\n" + text
	if regexp.MustCompile(`(?i)\bjobber\b`).MatchString(source) && regexp.MustCompile(`(?i)\b(track time|access job details|reduce your admin time|batch invoicing|automating your incoming requests|helping you solve problems)\b`).MatchString(text) {
		return true
	}
	return regexp.MustCompile(`(?i)\b(get|save)\s+\d{1,3}%\s+off\b|\b\d{1,3}%\s+off code\b|\boffer ends\b|\blimited[-\s]?time offer\b|\bfree trial\b|\bbook a demo\b|\bschedule a demo\b|\bwebinar\b|\bnewsletter\b|\bsubscribe\b|\bunsubscribe\b|\bmarketing emails?\b|\bproduct update\b|\bnew feature\b|\bready to checkout\b|\bcomplete your order\b|\byou left (?:an|your) order\b|\bclaim your coupon\b|\bfree shipping\b|\bshopping cart\b|\bgrant applications?\b|\bgift card\b|\bshare your feedback\b|\bhelp us improve\b`).MatchString(text)
}

func isShopifyOperationalNotification(text string, senderName string) bool {
	if regexp.MustCompile(`(?i)\bshopify\b`).MatchString(senderName) && regexp.MustCompile(`(?i)已更改付款设置|更改[了的]?[^\n]{0,80}支付设置|付款设置|支付设置|\bpayment\s+settings?\b|\bpayment\s+service\s+provider\b|airwallex[\s\S]{0,160}(?:结账|支付|付款|卡|停用|更改|deactivat|accept|card|checkout|payment)|(?:联系|contact)\s*shopify\s*(?:支持团队|support)`).MatchString(text) {
		return true
	}
	if !regexp.MustCompile(`(?i)\bshopify\b`).MatchString(senderName) {
		return false
	}
	return regexp.MustCompile(`(?i)产品\s*(?:csv\s*)?文件[\s\S]{0,120}导入[\s\S]{0,120}已完成|产品导入已完成|\bproduct\s+csv\b[\s\S]{0,120}\bimport(?:ed)?\b[\s\S]{0,120}\bcomplete(?:d)?\b|\bproduct\s+import(?:ed)?\b[\s\S]{0,120}\bcomplete(?:d)?\b|\bsuccessfully\s+imported\b[\s\S]{0,80}\bproducts?\b`).MatchString(text)
}

func isShopifyOrderNotification(row emailFilterRow, text string) bool {
	if hasCustomerReplyBeforeQuotedStoreRelay(row) {
		return false
	}
	subject := normalizeSenderValue(row.Subject)
	source := normalizeSenderValue(rowHaystack(row))
	storeRelay := hasShopifyStoreRelayHeader(row)
	chineseOrderSubject := regexp.MustCompile(`(?i)^\[[^\]]+\][\s\S]{0,140}下(?:了|的)订单\s*#?\d+`).MatchString(subject)
	shopifyOrderBody := regexp.MustCompile(`(?i)查看订单|订单摘要|无需发货|sku:|shopify payments|order summary`).MatchString(source)
	englishOrderNotification := regexp.MustCompile(`(?i)\b(?:placed|created)\s+(?:an?\s+)?order\s*#?\d+|\border\s+#\d+\s+(?:confirmed|created)\b`).MatchString(source)
	return (storeRelay || chineseOrderSubject || englishOrderNotification) && shopifyOrderBody
}

func isStoreOutboundAutoNotice(row emailFilterRow, text string) bool {
	subject := normalizeSenderValue(row.Subject)
	source := normalizeSenderValue(strings.Join(append([]string{row.Sender, row.Subject, row.Snippet}, append(row.Lines, text)...), "\n"))
	storeRelay := hasShopifyStoreRelayEmail(source)
	deliveryFailureNotice := regexp.MustCompile(`(?i)\bdelivery failed\b|\bplease contact fedex\b|\bunable to be delivered\b|\breturned to (?:the )?(?:local )?(?:fedex|ups|usps|dhl|carrier|post office)\b|\breschedule delivery\b|\bhold it for pickup\b`).MatchString(source)
	storeTemplate := regexp.MustCompile(`(?i)\bdear\s+[a-z][a-z .'-]{0,60},[\s\S]{0,500}\byour order\s*#?\d+[\s\S]{0,800}\b(?:customer support team|best regards|sorry for the inconvenience|thank you for your understanding)\b`).MatchString(source)
	return deliveryFailureNotice && (storeRelay || storeTemplate || regexp.MustCompile(`(?i)^delivery failed\b`).MatchString(subject) && storeTemplate)
}

func hasCustomerReplyBeforeQuotedStoreRelay(row emailFilterRow) bool {
	source := rowHaystack(row)
	if !hasShopifyStoreRelayEmail(source) {
		return false
	}
	quote := regexp.MustCompile(`(?i)\bon\s+(?:mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday),?[\s\S]{0,240}\bwrote:|-----\s*original message\s*-----|from:\s*[\s\S]{0,120}store\+\d+@(?:[a-z0-9-]+\.)?shopifyemail\.com`).FindStringIndex(source)
	if quote == nil {
		return false
	}
	return hasDirectCustomerSupportIntent(source[:quote[0]])
}

func hasShopifyStoreRelayHeader(row emailFilterRow) bool {
	for _, line := range append([]string{row.Sender}, row.Lines...) {
		text := strings.TrimSpace(line)
		if regexp.MustCompile(`(?i)\bwrote:|original message`).MatchString(text) {
			continue
		}
		if regexp.MustCompile(`(?im)^[^<@\n]+\s*<\s*store\+\d+@(?:[a-z0-9-]+\.)?shopifyemail\.com\s*>`).MatchString(text) {
			return true
		}
	}
	return false
}

func hasDirectCustomerSupportIntent(text string) bool {
	return regexp.MustCompile(`(?i)\b(?:i|we)\s+(?:haven't|have not|haven’t|didn't|did not|never)\s+(?:received|got|get)\b|\bhaven't\s+received\b|\bhave not\s+received\b|\bnot\s+received\b|\bwhere\s+is\s+(?:my|the)\s+order\b|\bcan you tell me where\b|\bproduce\s+my\s+order\b|\brefund\b|\bmoney\s+back\b|\breturn\b|\bexchange\b|\bcancel\b|\bmissing\b|\bdamaged\b|\bbroken\b|\bwrong\s+item\b|\bscam\b|\blied?\b|\btracking\b[\s\S]{0,80}\b(?:not|no|missing|wrong|delayed|stuck)\b|\bpackage\b[\s\S]{0,80}\b(?:not|missing|delayed|lost)\b`).MatchString(text)
}

func hasStrongCustomerIntent(text string) bool {
	return regexp.MustCompile(`(?i)order|ordered|purchase|purchased|bought|delivery|deliver|shipping|tracking|package|parcel|refund|return|exchange|cancel|address|where is|haven't received|not received|damaged|broken|wrong item|missing|confirm your|are you taking orders|take orders|pedido|recibido|no lo he recibido|entrega|env[ií]o|reembolso|devolver|订单|物流|退款|退货|换货|地址|收到|未收到`).MatchString(text)
}

func hasShopifyStoreRelayEmail(value string) bool {
	for _, email := range allEmails(value) {
		if isShopifyStoreRelayEmail(email) {
			return true
		}
	}
	return false
}

func isShopifyStoreRelayEmail(email string) bool {
	return regexp.MustCompile(`(?i)^store\+\d+@(?:[a-z0-9-]+\.)?shopifyemail\.com$`).MatchString(strings.TrimSpace(email))
}

func normalizeSenderValue(value string) string {
	value = strings.ReplaceAll(value, "\u00a0", " ")
	value = strings.NewReplacer("“", `"`, "”", `"`, "‘", "'", "’", "'").Replace(value)
	value = regexp.MustCompile(`\s+`).ReplaceAllString(value, " ")
	return strings.ToLower(strings.TrimSpace(value))
}

func senderDisplayFromHeader(value string) string {
	text := strings.TrimSpace(strings.ReplaceAll(value, "\u00a0", " "))
	if match := regexp.MustCompile(`^(.*?)\s*<[^>]+>`).FindStringSubmatch(text); len(match) > 1 {
		return strings.Trim(strings.TrimSpace(match[1]), `"'`)
	}
	text = regexp.MustCompile(`(?i)[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}`).ReplaceAllString(text, "")
	text = strings.NewReplacer("<", "", ">", "").Replace(text)
	return strings.TrimSpace(text)
}

func firstEmail(value string) string {
	match := regexp.MustCompile(`(?i)[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}`).FindString(value)
	return strings.ToLower(match)
}

func allEmails(value string) []string {
	matches := regexp.MustCompile(`(?i)[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}`).FindAllString(value, -1)
	out := make([]string, 0, len(matches))
	for _, match := range matches {
		out = append(out, strings.ToLower(match))
	}
	return out
}

func emailRowFingerprint(provider string, row emailFilterRow) string {
	parts := []string{provider, row.Sender, row.Subject, row.Snippet}
	for index, value := range parts {
		parts[index] = normalizeSenderValue(value)
	}
	sum := sha1.Sum([]byte(strings.Join(parts, "\n")))
	return hex.EncodeToString(sum[:])
}

func graphDateTimeOffset(value string) string {
	parsed := parseRFC3339Option(value)
	if parsed.IsZero() {
		return ""
	}
	return parsed.UTC().Format(time.RFC3339)
}

func parseRFC3339Option(value string) time.Time {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}
	}
	return parsed
}

func stringSliceOption(values map[string]any, key string) []string {
	if values == nil {
		return nil
	}
	switch typed := values[key].(type) {
	case []string:
		return typed
	case []any:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			if value := strings.TrimSpace(fmt.Sprint(item)); value != "" && value != "<nil>" {
				out = append(out, value)
			}
		}
		return out
	case string:
		if strings.TrimSpace(typed) == "" {
			return nil
		}
		return []string{typed}
	default:
		return nil
	}
}

func stringSet(values []string) map[string]bool {
	out := map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			out[value] = true
		}
	}
	return out
}

func sortedKeys(values map[string]bool) []string {
	out := make([]string, 0, len(values))
	for key := range values {
		out = append(out, key)
	}
	for i := 0; i < len(out); i++ {
		for j := i + 1; j < len(out); j++ {
			if out[j] < out[i] {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	return out
}

func compactStrings(values []string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" && value != "<nil>" {
			out = append(out, value)
		}
	}
	return out
}
