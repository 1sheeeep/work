package platform

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"
)

const (
	aiJobTranslation = "translation"
	aiJobReplyDraft  = "reply_draft"

	aiReplyStatusKey            = "aiReplyStatus"
	aiReplyTextKey              = "aiReplyText"
	aiReplyTextZHKey            = "aiReplyTextZh"
	aiReplyPolicyVersionKey     = "aiReplyPolicyVersion"
	currentAIReplyPolicyVersion = "carrierless-v1"
)

type aiBackgroundJob struct {
	Kind           string
	ConversationID string
	MessageID      string
}

type aiPreparationResponse struct {
	Status string `json:"status"`
	Text   string `json:"text,omitempty"`
	TextZH string `json:"textZh,omitempty"`
}

func (s *Server) startAIBackgroundWorkers() {
	s.aiWorkersOnce.Do(func() {
		for range aiBackgroundWorkerCount {
			go func() {
				for job := range s.aiQueue {
					ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
					s.runAIBackgroundJob(ctx, job)
					cancel()
					s.aiQueuedMu.Lock()
					delete(s.aiQueued, job.Kind+":"+job.MessageID)
					s.aiQueuedMu.Unlock()
				}
			}()
		}
	})
}

func (s *Server) enqueueAIBackground(job aiBackgroundJob) bool {
	if strings.TrimSpace(job.MessageID) == "" || strings.TrimSpace(job.ConversationID) == "" {
		return false
	}
	s.startAIBackgroundWorkers()
	key := job.Kind + ":" + job.MessageID
	s.aiQueuedMu.Lock()
	if s.aiQueued[key] {
		s.aiQueuedMu.Unlock()
		return true
	}
	s.aiQueued[key] = true
	s.aiQueuedMu.Unlock()
	select {
	case s.aiQueue <- job:
		return true
	default:
		s.aiQueuedMu.Lock()
		delete(s.aiQueued, key)
		s.aiQueuedMu.Unlock()
		return false
	}
}

func (s *Server) runAIBackgroundJob(ctx context.Context, job aiBackgroundJob) {
	switch job.Kind {
	case aiJobTranslation:
		if err := s.processMessageTranslation(ctx, job.ConversationID, job.MessageID); err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("background message translation failed for %s: %v", job.MessageID, err)
		}
	case aiJobReplyDraft:
		if err := s.processConversationReplyDraft(ctx, job.ConversationID, job.MessageID); err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("background AI reply preparation failed for %s: %v", job.ConversationID, err)
		}
	}
}

func latestCustomerTextMessage(messages []Message) (Message, bool) {
	for index := len(messages) - 1; index >= 0; index-- {
		message := messages[index]
		if message.Direction == MessageDirectionCustomer && normalizeMessageType(message.Type) == MessageTypeText && strings.TrimSpace(message.Body) != "" {
			return message, true
		}
	}
	return Message{}, false
}

func aiReplyDraftIsCurrent(message Message) bool {
	if message.Metadata[logisticsAutoSendStatusKey] == logisticsAutoSendStatusSent {
		return true
	}
	return message.Metadata[aiReplyStatusKey] == messageTranslationDone &&
		message.Metadata[aiReplyPolicyVersionKey] == currentAIReplyPolicyVersion
}

func queuedAIReplyMetadata() map[string]string {
	return map[string]string{
		aiReplyStatusKey:        "queued",
		aiReplyTextKey:          "",
		aiReplyTextZHKey:        "",
		aiReplyPolicyVersionKey: "",
	}
}

func (s *Server) enqueueConversationReplyDraft(conversation Conversation) {
	if conversation.AssignedAgentID == "" || !isCustomerConversation(conversation) {
		return
	}
	config, err := s.resolveAIConfig(context.Background())
	if err != nil || !config.Enabled || config.APIKey == "" {
		return
	}
	messages, err := s.store.ListMessagePage(context.Background(), conversation.ID, "", 20)
	if err != nil {
		return
	}
	message, ok := latestCustomerTextMessage(messages)
	if !ok || aiReplyDraftIsCurrent(message) || message.Metadata[aiReplyStatusKey] == "queued" || message.Metadata[aiReplyStatusKey] == "processing" {
		return
	}
	_, _ = s.store.UpdateMessageMetadata(context.Background(), conversation.ID, message.ID, queuedAIReplyMetadata())
	if !s.enqueueAIBackground(aiBackgroundJob{Kind: aiJobReplyDraft, ConversationID: conversation.ID, MessageID: message.ID}) {
		_, _ = s.store.UpdateMessageMetadata(context.Background(), conversation.ID, message.ID, map[string]string{aiReplyStatusKey: messageTranslationFailed})
	}
}

func (s *Server) handleConversationAIPrepare(w http.ResponseWriter, r *http.Request, conversation Conversation) {
	messages, err := s.store.ListMessagePage(r.Context(), conversation.ID, "", 20)
	if err != nil {
		writeError(w, err)
		return
	}
	message, ok := latestCustomerTextMessage(messages)
	if !ok {
		writeJSONResponse(w, http.StatusOK, aiPreparationResponse{Status: "not_available"})
		return
	}
	status := message.Metadata[aiReplyStatusKey]
	if status == "" || (status == messageTranslationDone && !aiReplyDraftIsCurrent(message)) {
		status = "queued"
		message, err = s.store.UpdateMessageMetadata(r.Context(), conversation.ID, message.ID, queuedAIReplyMetadata())
		if err != nil {
			writeError(w, err)
			return
		}
		if !s.enqueueAIBackground(aiBackgroundJob{Kind: aiJobReplyDraft, ConversationID: conversation.ID, MessageID: message.ID}) {
			status = messageTranslationFailed
			message, _ = s.store.UpdateMessageMetadata(r.Context(), conversation.ID, message.ID, map[string]string{aiReplyStatusKey: status})
		}
	}
	writeJSONResponse(w, http.StatusOK, aiPreparationResponse{Status: status, Text: message.Metadata[aiReplyTextKey], TextZH: message.Metadata[aiReplyTextZHKey]})
}

func (s *Server) processConversationReplyDraft(ctx context.Context, conversationID string, messageID string) error {
	conversation, err := s.store.GetConversation(ctx, conversationID)
	if err != nil {
		return err
	}
	message, err := s.store.GetMessage(ctx, conversationID, messageID)
	if err != nil {
		return err
	}
	if aiReplyDraftIsCurrent(message) {
		return nil
	}
	message, err = s.store.UpdateMessageMetadata(ctx, conversationID, messageID, map[string]string{aiReplyStatusKey: "processing"})
	if err != nil {
		return err
	}
	if handled, logisticsErr := s.processLogisticsAutoDraft(ctx, conversation, message); handled {
		return logisticsErr
	}
	draft, err := s.generateConversationDraft(ctx, conversation, "")
	if err != nil {
		_, _ = s.store.UpdateMessageMetadata(ctx, conversationID, messageID, map[string]string{aiReplyStatusKey: messageTranslationFailed})
		return err
	}
	updated, err := s.store.UpdateMessageMetadata(ctx, conversationID, messageID, map[string]string{
		aiReplyStatusKey:        messageTranslationDone,
		aiReplyTextKey:          draft.Text,
		aiReplyPolicyVersionKey: currentAIReplyPolicyVersion,
	})
	if err != nil {
		return err
	}
	s.broadcastConversationEvent(conversation, Event{Type: "message.updated", ShopID: conversation.ShopID, EntityID: updated.ID, Payload: updated, CreatedAt: time.Now().UTC()})

	textZH, translationErr := s.transformConversationReply(ctx, conversation, aiTransformRequest{Action: "translate_zh", Text: draft.Text})
	if translationErr != nil {
		log.Printf("background AI draft Chinese review failed for %s: %v", conversationID, translationErr)
		return nil
	}
	updated, err = s.store.UpdateMessageMetadata(ctx, conversationID, messageID, map[string]string{aiReplyTextZHKey: textZH})
	if err != nil {
		return err
	}
	s.broadcastConversationEvent(conversation, Event{Type: "message.updated", ShopID: conversation.ShopID, EntityID: updated.ID, Payload: updated, CreatedAt: time.Now().UTC()})
	return nil
}
