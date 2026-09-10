package platform

import (
	"context"
	"strings"
	"time"
)

func (s *Server) reconcileSyncedOutlookAgentMessage(ctx context.Context, source ShopSource, input incomingEmailMessage, existing []Message) (bool, error) {
	sourceMessageID := strings.TrimSpace(input.SourceMessageID)
	incomingBody := comparableEmailBody(input.Body)
	if sourceMessageID == "" || incomingBody == "" || input.ReceivedAt.IsZero() {
		return false, nil
	}
	mailbox := normalizeEmail(source.Address)
	bestIndex := -1
	bestDistance := emailSentReconcileWindow + time.Nanosecond
	for index, candidate := range existing {
		if candidate.Direction != MessageDirectionAgent || normalizeMessageType(candidate.Type) != MessageTypeText {
			continue
		}
		if strings.TrimSpace(candidate.Metadata[emailSyncedSourceMessageIDKey]) != "" ||
			strings.ToLower(strings.TrimSpace(candidate.Metadata["mail_api_provider"])) != "outlook" {
			continue
		}
		candidateMailbox := normalizeEmail(candidate.Metadata["mail_api_mailbox"])
		if mailbox != "" && candidateMailbox != "" && candidateMailbox != mailbox {
			continue
		}
		sentAt, ok := parseEmailSyncTime(candidate.Metadata["mail_api_sent_at"])
		if !ok || comparableEmailBody(candidate.Body) != incomingBody {
			continue
		}
		distance := input.ReceivedAt.Sub(sentAt)
		if distance < 0 {
			distance = -distance
		}
		if distance <= emailSentReconcileWindow && distance < bestDistance {
			bestIndex = index
			bestDistance = distance
		}
	}
	if bestIndex < 0 {
		return false, nil
	}
	patch := cloneStringMap(input.Metadata)
	if patch == nil {
		patch = map[string]string{}
	}
	patch[emailSyncedSourceMessageIDKey] = sourceMessageID
	_, err := s.store.UpdateMessageMetadata(ctx, existing[bestIndex].ConversationID, existing[bestIndex].ID, patch)
	if err != nil {
		return false, err
	}
	return true, nil
}

func (s *Server) persistOutlookAgentReply(ctx context.Context, conversation Conversation, input Message, userID string) (Message, Conversation, bool, error) {
	sentAt, ok := parseEmailSyncTime(input.Metadata["mail_api_sent_at"])
	body := comparableEmailBody(input.Body)
	if ok && body != "" {
		messages, err := s.store.ListMessages(ctx, conversation.ID)
		if err != nil {
			return Message{}, Conversation{}, false, err
		}
		mailbox := normalizeEmail(input.Metadata["mail_api_mailbox"])
		outlookConversationID := strings.TrimSpace(input.Metadata["outlook_conversation_id"])
		bestIndex := -1
		bestDistance := emailSentReconcileWindow + time.Nanosecond
		for index, candidate := range messages {
			if candidate.Direction != MessageDirectionAgent ||
				normalizeMessageType(candidate.Type) != normalizeMessageType(input.Type) ||
				!strings.HasPrefix(strings.TrimSpace(candidate.SourceMessageID), "outlook:") ||
				comparableEmailBody(candidate.Body) != body {
				continue
			}
			if mailbox != "" && normalizeEmail(candidate.SenderEmail) != "" && normalizeEmail(candidate.SenderEmail) != mailbox {
				continue
			}
			candidateConversationID := strings.TrimSpace(candidate.Metadata["outlook_conversation_id"])
			if outlookConversationID != "" && candidateConversationID != "" && candidateConversationID != outlookConversationID {
				continue
			}
			distance := candidate.CreatedAt.Sub(sentAt)
			if distance < 0 {
				distance = -distance
			}
			if distance <= emailSentReconcileWindow && distance < bestDistance {
				bestIndex = index
				bestDistance = distance
			}
		}
		if bestIndex >= 0 {
			patch := cloneStringMap(input.Metadata)
			if patch == nil {
				patch = map[string]string{}
			}
			patch[emailSyncedSourceMessageIDKey] = messages[bestIndex].SourceMessageID
			patch[messageAgentIDMetadataKey] = strings.TrimSpace(userID)
			message, err := s.store.UpdateMessageMetadata(ctx, conversation.ID, messages[bestIndex].ID, patch)
			if err != nil {
				return Message{}, Conversation{}, false, err
			}
			return message, conversation, true, nil
		}
	}
	message, updated, err := s.store.AddAgentMessage(ctx, input, userID)
	return message, updated, false, err
}
