package platform

import (
	"net/mail"
	"regexp"
	"strings"
	"time"
)

const relayedCustomerInquiryClassification = "customer request relayed by a system sender"
const automatedSystemNotificationClassification = "automated platform or account notification"
const verificationSystemNotificationClassification = "verification code or authentication notice"
const pendingSystemNotificationClassification = "automated email pending review"
const suspectedMarketingReviewClassification = "suspected marketing email pending review"

var (
	directSupportPattern               = regexp.MustCompile(`(?i)(contact form|customer message|customer inquiry|support request|help request|message from (your|the) store|new message from|order (issue|problem)|refund request|return request|where is my order|tracking (issue|problem))`)
	emailAddressPattern                = regexp.MustCompile(`(?i)[a-z0-9.!#$%&'*+/=?^_` + "`" + `{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+`)
	deliveryDaemonPattern              = regexp.MustCompile(`(?i)(^|[._+\-])(mailer-daemon|postmaster)([._+\-@]|$)`)
	noReplySenderPattern               = regexp.MustCompile(`(?i)(^|[._+\-])(no-?reply|do-?not-?reply|donotreply)([._+\-@]|$)`)
	knownSystemDomainPattern           = regexp.MustCompile(`(?i)(^|\.)(shopify\.com|shopifyemail\.com|accountprotection\.microsoft\.com|engage\.microsoft\.com|service\.tiktok\.com|judge\.me|accounts\.google\.com)$`)
	automatedNotificationSenderPattern = regexp.MustCompile(`(?i)(^|[._+\-])(no-?reply|do-?not-?reply|donotreply|notifications?|alerts?|account-security|security|verify|verification|auth|otp)([._+\-@]|$)`)
	verificationSubjectPattern         = regexp.MustCompile(`(?i)(verification|security|authentication|one[- ]time|login|sign[- ]?in|confirm|验证码|动态码|安全码|登录码|确认码).{0,32}(code|password|pin|验证码|动态码|安全码|登录码|确认码)|\b(otp|2fa|mfa)\b`)
	verificationBodyPattern            = regexp.MustCompile(`(?i)(verification code|security code|authentication code|one[- ]time password|one[- ]time code|login code|sign[- ]?in code|验证码|动态码|安全码|登录码|确认码|\botp\b|\b2fa\b|\bmfa\b)`)
)

func classifyIncomingEmail(senderEmail string, senderName string, subject string, body string) (string, string) {
	if directSupportPattern.MatchString(strings.TrimSpace(subject+"\n"+body)) && emailAddressPattern.MatchString(body) {
		return ConversationKindCustomer, relayedCustomerInquiryClassification
	}
	if isVerificationEmail(senderEmail, subject, body) {
		return ConversationKindSystem, verificationSystemNotificationClassification
	}
	if isAutomatedSystemNotification(senderEmail, subject, body) {
		return ConversationKindSystem, automatedSystemNotificationClassification
	}
	if isLikelyAutomatedNotificationSender(senderEmail) {
		return ConversationKindSystem, pendingSystemNotificationClassification
	}
	return ConversationKindCustomer, "email handled as a normal conversation"
}

func isVerificationEmail(senderEmail string, subject string, body string) bool {
	if !isLikelyAutomatedNotificationSender(senderEmail) {
		return false
	}
	return verificationSubjectPattern.MatchString(strings.TrimSpace(subject)) || verificationBodyPattern.MatchString(strings.TrimSpace(body))
}

func isLikelyAutomatedNotificationSender(senderEmail string) bool {
	address := normalizeEmail(senderEmail)
	localPart, domain, found := strings.Cut(address, "@")
	if !found {
		return automatedNotificationSenderPattern.MatchString(address)
	}
	return automatedNotificationSenderPattern.MatchString(localPart) || knownSystemDomainPattern.MatchString(domain)
}

func isAutomatedSystemNotification(senderEmail string, subject string, body string) bool {
	address := normalizeEmail(senderEmail)
	localPart, domain, found := strings.Cut(address, "@")
	if !found {
		return deliveryDaemonPattern.MatchString(address)
	}
	if deliveryDaemonPattern.MatchString(localPart) || knownSystemDomainPattern.MatchString(domain) {
		return true
	}
	return noReplySenderPattern.MatchString(localPart) && operationalEmailPattern.MatchString(strings.TrimSpace(subject+"\n"+body))
}

func incomingEmailReplyAllowed(replyToEmail string, senderEmail ...string) bool {
	for _, candidate := range append([]string{replyToEmail}, senderEmail...) {
		address := normalizeEmail(candidate)
		if address == "" || deliveryDaemonPattern.MatchString(address) {
			continue
		}
		if parsed, err := mail.ParseAddress(address); err == nil && normalizeEmail(parsed.Address) != "" {
			return true
		}
	}
	return false
}

func filterServiceLineConversations(items []Conversation) []Conversation {
	filtered := make([]Conversation, 0, len(items))
	for _, conversation := range items {
		if normalizeConversationKind(conversation.Kind) != ConversationKindCustomer {
			continue
		}
		if isDiscardedEmailSender(conversation.CustomerEmail, conversation.CustomerName) && conversation.Classification != relayedCustomerInquiryClassification {
			continue
		}
		filtered = append(filtered, conversation)
	}
	return filtered
}

func filterOperationalCustomerConversations(items []Conversation) []Conversation {
	serviceLine := filterServiceLineConversations(items)
	filtered := make([]Conversation, 0, len(serviceLine))
	for _, conversation := range serviceLine {
		if !isHistoricalEmailConversation(conversation) {
			filtered = append(filtered, conversation)
		}
	}
	return filtered
}

func isEffectiveRoutingConversation(conversation Conversation) bool {
	if normalizeConversationKind(conversation.Kind) != ConversationKindCustomer || isHistoricalEmailConversation(conversation) {
		return false
	}
	return !isDiscardedEmailSender(conversation.CustomerEmail, conversation.CustomerName) || conversation.Classification == relayedCustomerInquiryClassification
}

func emailMessageDirection(mailbox string, senderEmail string, labels []string) string {
	for _, label := range labels {
		if strings.EqualFold(strings.TrimSpace(label), "SENT") {
			return MessageDirectionAgent
		}
	}
	if normalizeEmail(mailbox) != "" && normalizeEmail(mailbox) == normalizeEmail(senderEmail) {
		return MessageDirectionAgent
	}
	return MessageDirectionCustomer
}

type quotedEmailHistory struct {
	CurrentBody   string
	QuotedBody    string
	SenderName    string
	SenderEmail   string
	QuotedSubject string
	SentAt        time.Time
}

var (
	flattenedEmailHeaderPattern    = regexp.MustCompile(`(?is)(?:from:|发件人[:：])\s*(.+?)\s+(?:sent:|发送时间[:：]|日期[:：])\s*(.+?)\s+(?:to:|收件人[:：])\s*(.+?)\s+(?:subject:|主题[:：])\s*`)
	onWrotePattern                 = regexp.MustCompile(`(?is)(?:^|\s)(?:on .{1,240}? wrote:|在 .{1,240}?写道[:：])\s*`)
	quotedAttributionNumberPattern = regexp.MustCompile(`\d+`)
)

func stripQuotedEmailHistory(body string) string {
	if split, ok := splitQuotedEmailHistory(body, ""); ok {
		return split.CurrentBody
	}
	return strings.TrimSpace(strings.ReplaceAll(body, "\r\n", "\n"))
}

func stripQuotedEmailHistoryForSubject(body string, subject string) string {
	if split, ok := splitQuotedEmailHistory(body, subject); ok {
		return split.CurrentBody
	}
	return strings.TrimSpace(strings.ReplaceAll(body, "\r\n", "\n"))
}

func splitQuotedEmailHistory(body string, subject string) (quotedEmailHistory, bool) {
	body = strings.ReplaceAll(body, "\r\n", "\n")
	lines := strings.Split(body, "\n")
	for index, line := range lines {
		if index == 0 {
			continue
		}
		trimmed := strings.TrimSpace(line)
		lower := strings.ToLower(trimmed)
		if strings.HasPrefix(lower, "-----original message-----") ||
			strings.HasPrefix(lower, "-----quoted message-----") ||
			strings.HasPrefix(lower, "from:") ||
			strings.HasPrefix(lower, "发件人:") || strings.HasPrefix(lower, "发件人：") ||
			(strings.HasPrefix(lower, "on ") && strings.HasSuffix(lower, " wrote:")) ||
			(strings.HasPrefix(trimmed, "在 ") && (strings.HasSuffix(trimmed, "写道：") || strings.HasSuffix(trimmed, "写道:"))) {
			candidate := strings.TrimSpace(strings.Join(lines[:index], "\n"))
			if candidate == "" {
				continue
			}
			quotedStart := index + 1
			senderName := ""
			senderEmail := ""
			quotedSubject := ""
			var sentAt time.Time
			if strings.HasPrefix(lower, "-----original message-----") && quotedStart < len(lines) {
				trimmed = strings.TrimSpace(lines[quotedStart])
				lower = strings.ToLower(trimmed)
			}
			if strings.HasPrefix(lower, "from:") || strings.HasPrefix(lower, "发件人:") || strings.HasPrefix(lower, "发件人：") {
				senderName, senderEmail = parseMailAddress(strings.TrimSpace(trimmed[strings.IndexAny(trimmed, ":：")+1:]))
				quotedStart++
				for quotedStart < len(lines) {
					header := strings.TrimSpace(lines[quotedStart])
					headerLower := strings.ToLower(header)
					quotedStart++
					if strings.HasPrefix(headerLower, "sent:") || strings.HasPrefix(headerLower, "发送时间:") || strings.HasPrefix(headerLower, "发送时间：") || strings.HasPrefix(headerLower, "日期:") || strings.HasPrefix(headerLower, "日期：") {
						sentAt = parseQuotedEmailTime(strings.TrimSpace(header[strings.IndexAny(header, ":：")+1:]))
					}
					if strings.HasPrefix(headerLower, "subject:") || strings.HasPrefix(headerLower, "主题:") || strings.HasPrefix(headerLower, "主题：") {
						quotedSubject = strings.TrimSpace(header[strings.IndexAny(header, ":：")+1:])
						break
					}
				}
			}
			if quotedStart > len(lines) {
				quotedStart = len(lines)
			}
			quotedBody := strings.TrimSpace(strings.Join(lines[quotedStart:], "\n"))
			if quotedBody != "" {
				return quotedEmailHistory{
					CurrentBody:   candidate,
					QuotedBody:    quotedBody,
					SenderName:    senderName,
					SenderEmail:   senderEmail,
					QuotedSubject: quotedSubject,
					SentAt:        sentAt,
				}, true
			}
		}
		if senderEmail, ok := genericQuotedEmailAttribution(lines, index); ok {
			currentBody := strings.TrimSpace(strings.Join(lines[:index], "\n"))
			quotedBody := strings.TrimSpace(strings.Join(lines[index+1:], "\n"))
			if currentBody != "" && quotedBody != "" {
				return quotedEmailHistory{
					CurrentBody: currentBody,
					QuotedBody:  quotedBody,
					SenderEmail: senderEmail,
				}, true
			}
		}
	}

	if match := flattenedEmailHeaderPattern.FindStringSubmatchIndex(body); len(match) >= 6 {
		currentBody := strings.TrimSpace(body[:match[0]])
		if currentBody != "" {
			senderValue := strings.TrimSpace(body[match[2]:match[3]])
			senderName, senderEmail := parseMailAddress(senderValue)
			sentAt := parseQuotedEmailTime(strings.TrimSpace(body[match[4]:match[5]]))
			remainder := strings.TrimSpace(body[match[1]:])
			quotedSubject := ""
			if baseSubject := baseEmailSubject(subject); baseSubject != "" {
				if subjectIndex := indexFold(remainder, baseSubject); subjectIndex >= 0 && subjectIndex <= 16 {
					quotedSubject = strings.TrimSpace(remainder[:subjectIndex+len(baseSubject)])
					remainder = strings.TrimSpace(remainder[subjectIndex+len(baseSubject):])
				}
			}
			if remainder != "" {
				return quotedEmailHistory{
					CurrentBody:   currentBody,
					QuotedBody:    remainder,
					SenderName:    senderName,
					SenderEmail:   senderEmail,
					QuotedSubject: quotedSubject,
					SentAt:        sentAt,
				}, true
			}
		}
	}

	if match := onWrotePattern.FindStringIndex(body); len(match) == 2 {
		currentBody := strings.TrimSpace(body[:match[0]])
		quotedBody := strings.TrimSpace(body[match[1]:])
		if currentBody != "" && quotedBody != "" {
			return quotedEmailHistory{CurrentBody: currentBody, QuotedBody: quotedBody}, true
		}
	}
	return quotedEmailHistory{}, false
}

func genericQuotedEmailAttribution(lines []string, index int) (string, bool) {
	if index <= 0 || index >= len(lines)-1 || strings.TrimSpace(lines[index-1]) != "" {
		return "", false
	}
	line := strings.TrimSpace(lines[index])
	if line == "" || len([]rune(line)) > 500 || (!strings.HasSuffix(line, ":") && !strings.HasSuffix(line, "：")) {
		return "", false
	}
	emailLocation := emailAddressPattern.FindStringIndex(line)
	if len(emailLocation) != 2 ||
		!strings.Contains(line[:emailLocation[0]], "<") ||
		!strings.Contains(line[emailLocation[1]:], ">") {
		return "", false
	}
	if len(quotedAttributionNumberPattern.FindAllString(line, -1)) < 2 {
		return "", false
	}
	return normalizeEmail(line[emailLocation[0]:emailLocation[1]]), true
}

func baseEmailSubject(value string) string {
	value = strings.TrimSpace(value)
	for {
		lower := strings.ToLower(value)
		trimmed := value
		for _, prefix := range []string{"re:", "fw:", "fwd:", "回复:", "回复：", "转发:", "转发："} {
			if strings.HasPrefix(lower, strings.ToLower(prefix)) {
				trimmed = strings.TrimSpace(value[len(prefix):])
				break
			}
		}
		if trimmed == value {
			return value
		}
		value = trimmed
	}
}

func indexFold(value string, search string) int {
	return strings.Index(strings.ToLower(value), strings.ToLower(search))
}

func parseQuotedEmailTime(value string) time.Time {
	if parsed, err := mail.ParseDate(strings.TrimSpace(value)); err == nil {
		return parsed.UTC()
	}
	for _, layout := range []string{
		"Monday, January 2, 2006 3:04 PM",
		"Monday, January 2, 2006 at 3:04 PM",
		"January 2, 2006 3:04 PM",
		"1/2/2006 3:04 PM",
		"2006-01-02 15:04",
	} {
		if parsed, err := time.ParseInLocation(layout, strings.TrimSpace(value), time.Local); err == nil {
			return parsed.UTC()
		}
	}
	return time.Time{}
}

func truncateEmailPreview(value string, maxRunes int) string {
	value = strings.TrimSpace(value)
	if maxRunes <= 0 {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= maxRunes {
		return value
	}
	return string(runes[:maxRunes])
}
