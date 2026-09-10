package platform

import (
	"context"
	"strings"
	"time"
)

func (s *Server) reconcileSyncedGmailAgentMessage(ctx context.Context, source ShopSource, input incomingEmailMessage, existing []Message) (bool, error) {
	sourceMessageID := strings.TrimSpace(input.SourceMessageID)
	incomingBody := comparableEmailBody(input.Body)
	if sourceMessageID == "" || incomingBody == "" || input.ReceivedAt.IsZero() {
		return false, nil
	}
	mailbox := normalizeEmail(source.Address)
	bestIndex := -1
	bestDistance := emailSentReconcileWindow + time.Nanosecond
	for index, candidate := range existing {
		if candidate.Direction != MessageDirectionAgent || strings.TrimSpace(candidate.Metadata[emailSyncedSourceMessageIDKey]) != "" ||
			strings.ToLower(strings.TrimSpace(candidate.Metadata["mail_api_provider"])) != "gmail" ||
			strings.ToLower(strings.TrimSpace(candidate.Metadata[emailSendStatusKey])) != emailSendStatusReconciling {
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
	return err == nil, err
}

func (s *Server) persistGmailAgentReply(ctx context.Context, conversation Conversation, input Message, userID string) (Message, Conversation, bool, error) {
	sourceMessageID := strings.TrimSpace(input.Metadata["mail_api_sent_message_id"])
	if strings.HasPrefix(sourceMessageID, "gmail:") {
		input.SourceMessageID = sourceMessageID
	}
	if input.ID == "" {
		input.ID = prefixedID("msg")
	}
	message, updated, err := s.store.AddAgentMessage(ctx, input, userID)
	if err != nil {
		return Message{}, Conversation{}, false, err
	}
	reconciled := message.ID != input.ID
	if input.SourceMessageID == "" {
		return message, updated, reconciled, nil
	}
	patch := cloneStringMap(input.Metadata)
	if patch == nil {
		patch = map[string]string{}
	}
	patch[emailSyncedSourceMessageIDKey] = input.SourceMessageID
	patch[messageAgentIDMetadataKey] = strings.TrimSpace(userID)
	message, err = s.store.UpdateMessageMetadata(ctx, conversation.ID, message.ID, patch)
	if err != nil {
		return Message{}, Conversation{}, false, err
	}
	return message, updated, reconciled, nil
}
