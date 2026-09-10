package platform

import (
	"strconv"
	"strings"
	"time"
)

const displayQuotedHistoryMetadataKey = "displayQuotedHistory"

func expandQuotedEmailMessagesForDisplay(messages []Message, subject string) []Message {
	if len(messages) == 0 {
		return messages
	}
	out := make([]Message, 0, len(messages))
	for _, message := range messages {
		out = append(out, expandQuotedEmailMessageForDisplay(message, subject, messages, 0)...)
	}
	return out
}

func expandQuotedEmailMessageForDisplay(message Message, subject string, all []Message, depth int) []Message {
	if depth >= 6 || normalizeMessageType(message.Type) != MessageTypeText || (depth == 0 && !isProviderEmailMessage(message)) {
		return []Message{message}
	}
	split, ok := splitQuotedEmailHistory(message.Body, subject)
	if !ok {
		return []Message{message}
	}

	current := cloneMessageForDisplay(message)
	current.Body = split.CurrentBody
	quotedTranslation := ""
	if translation := current.Metadata[messageTranslationZHKey]; translation != "" {
		if translatedSplit, translatedOK := splitQuotedEmailHistory(translation, subject); translatedOK {
			current.Metadata[messageTranslationZHKey] = translatedSplit.CurrentBody
			quotedTranslation = trimTranslatedQuotedSubject(translatedSplit.QuotedBody, split.SenderName)
		}
	}
	if quotedEmailBodyAlreadyStored(split.QuotedBody, message.ID, all) {
		return []Message{current}
	}

	quotedSuffix := ":quoted:" + strconv.Itoa(depth+1)
	quotedCreatedAt := split.SentAt
	if quotedCreatedAt.IsZero() {
		quotedCreatedAt = message.CreatedAt.Add(-time.Duration(depth+1) * time.Nanosecond)
	}
	quoted := Message{
		ID:              message.ID + quotedSuffix,
		ConversationID:  message.ConversationID,
		Direction:       oppositeEmailDirection(message.Direction),
		Type:            MessageTypeText,
		Body:            split.QuotedBody,
		SenderName:      split.SenderName,
		SenderEmail:     split.SenderEmail,
		SourceMessageID: message.SourceMessageID + quotedSuffix,
		CreatedAt:       quotedCreatedAt,
		Metadata: map[string]string{
			displayQuotedHistoryMetadataKey: "true",
		},
	}
	if quotedTranslation != "" {
		quoted.Metadata[messageTranslationZHKey] = quotedTranslation
		quoted.Metadata[messageTranslationStatusKey] = messageTranslationDone
	}
	quotedParts := expandQuotedEmailMessageForDisplay(quoted, firstNonEmpty(split.QuotedSubject, subject), all, depth+1)
	return append(quotedParts, current)
}

func trimTranslatedQuotedSubject(body string, senderName string) string {
	body = strings.TrimSpace(body)
	senderName = strings.TrimSpace(senderName)
	if body == "" || senderName == "" {
		return body
	}
	if index := indexFold(body, senderName); index > 0 && index <= 300 {
		return strings.TrimSpace(body[index:])
	}
	return body
}

func cloneMessageForDisplay(message Message) Message {
	cloned := message
	cloned.Metadata = cloneStringMap(message.Metadata)
	return cloned
}

func isProviderEmailMessage(message Message) bool {
	return message.Metadata["gmail_message_id"] != "" || message.Metadata["outlook_message_id"] != "" || message.Metadata[standardMailProvider+"_message_id"] != ""
}

func oppositeEmailDirection(direction string) string {
	if direction == MessageDirectionAgent {
		return MessageDirectionCustomer
	}
	return MessageDirectionAgent
}

func quotedEmailBodyAlreadyStored(quotedBody string, currentID string, messages []Message) bool {
	quoted := comparableEmailBody(quotedBody)
	if len(quoted) < 24 {
		return false
	}
	for _, candidate := range messages {
		if candidate.ID == currentID || normalizeMessageType(candidate.Type) != MessageTypeText {
			continue
		}
		body := comparableEmailBody(candidate.Body)
		if len(body) >= 24 && (strings.Contains(quoted, body) || strings.Contains(body, quoted)) {
			return true
		}
	}
	return false
}

func comparableEmailBody(value string) string {
	value = stripQuotedEmailHistory(value)
	return strings.ToLower(strings.Join(strings.Fields(value), ""))
}

func cleanProviderEmailBody(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	lower := strings.ToLower(value)
	cssSignals := 0
	for _, marker := range []string{"!important", "font-family:", "line-height:", "@media", "display:", "height:", "color:"} {
		if strings.Contains(lower, marker) {
			cssSignals++
		}
	}
	if cssSignals < 2 || !strings.Contains(value, "{") || !strings.Contains(value, "}") {
		return value
	}
	if lastRule := strings.LastIndex(value, "}"); lastRule >= 0 {
		return strings.TrimSpace(value[lastRule+1:])
	}
	return ""
}
