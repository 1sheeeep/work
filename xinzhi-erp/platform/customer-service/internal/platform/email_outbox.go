package platform

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	emailSendStatusKey          = "email_send_status"
	emailSendErrorKey           = "email_send_error"
	emailSendCompletedAtKey     = "email_send_completed_at"
	emailSendStatusQueued       = "queued"
	emailSendStatusSending      = "sending"
	emailSendStatusReconciling  = "reconciling"
	emailSendStatusSent         = "sent"
	emailSendStatusFailed       = "failed"
	emailOutboxWorkerCount      = 4
	emailOutboxRecoveryInterval = 10 * time.Minute
	emailOutboxClaimRetryDelay  = 30 * time.Second
)

func emailSendStillNeedsAttention(message Message) bool {
	switch strings.ToLower(strings.TrimSpace(message.Metadata[emailSendStatusKey])) {
	case emailSendStatusQueued, emailSendStatusSending, emailSendStatusReconciling, emailSendStatusFailed:
		return true
	default:
		return false
	}
}

func (s *Server) beginEmailOutbox(ctx context.Context, source ShopSource, conversation Conversation, input Message, userID string, clientRequestID string) (emailOutboxStore, EmailOutboxRecord, error) {
	store, ok := s.store.(emailOutboxStore)
	if !ok {
		return nil, EmailOutboxRecord{}, fmt.Errorf("email outbox storage is unavailable")
	}
	metadata, err := json.Marshal(input.Metadata)
	if err != nil {
		return nil, EmailOutboxRecord{}, err
	}
	record, err := store.BeginEmailOutbox(ctx, EmailOutboxRecord{
		ShopID: source.ShopID, SourceID: source.ID, ConversationID: conversation.ID,
		ClientRequestID: clientRequestID, RequestedBy: userID, Body: input.Body,
		RequestMetadata: string(metadata),
	})
	return store, record, err
}

func restoreEmailOutboxInput(input Message, record EmailOutboxRecord) (Message, error) {
	var requestMetadata map[string]string
	if err := json.Unmarshal([]byte(record.RequestMetadata), &requestMetadata); err != nil {
		return Message{}, fmt.Errorf("restore email outbox request: %w", err)
	}
	var providerMetadata map[string]string
	if err := json.Unmarshal([]byte(record.ProviderMetadata), &providerMetadata); err != nil {
		return Message{}, fmt.Errorf("restore email outbox provider result: %w", err)
	}
	input.Body = record.Body
	input.Metadata = mergeStringMaps(requestMetadata, providerMetadata)
	return input, nil
}

func encodeEmailOutboxProviderMetadata(metadata map[string]string) string {
	encoded, err := json.Marshal(metadata)
	if err != nil {
		return "{}"
	}
	return string(encoded)
}

func emailSendFailureIsExplicit(sendErr error) bool {
	if sendErr == nil {
		return false
	}
	if errors.Is(sendErr, ErrInvalid) || errors.Is(sendErr, ErrForbidden) || errors.Is(sendErr, ErrNotFound) || errors.Is(sendErr, ErrConflict) {
		return true
	}
	var sendProviderErr *emailSendProviderError
	if errors.As(sendErr, &sendProviderErr) {
		return sendProviderErr.statusCode >= 400 && sendProviderErr.statusCode < 500 && sendProviderErr.statusCode != http.StatusRequestTimeout
	}
	var providerErr *emailProviderHTTPError
	if errors.As(sendErr, &providerErr) {
		return providerErr.StatusCode >= 400 && providerErr.StatusCode < 500 && providerErr.StatusCode != http.StatusRequestTimeout
	}
	message := strings.ToLower(sendErr.Error())
	return strings.Contains(message, "smtp authentication") || strings.Contains(message, "sender rejected") || strings.Contains(message, "recipient rejected")
}

func emailSendDisplayError(sendErr error) string {
	var sendProviderErr *emailSendProviderError
	if errors.As(sendErr, &sendProviderErr) {
		return fmt.Sprintf("%s%s失败（HTTP %d），请检查邮箱授权或配置后重试", sendProviderErr.provider, sendProviderErr.operation, sendProviderErr.statusCode)
	}
	var providerErr *emailProviderHTTPError
	if errors.As(sendErr, &providerErr) {
		return fmt.Sprintf("邮件服务请求失败（HTTP %d），请检查邮箱授权或配置后重试", providerErr.StatusCode)
	}
	if errors.Is(sendErr, ErrInvalid) || errors.Is(sendErr, ErrForbidden) || errors.Is(sendErr, ErrConflict) || errors.Is(sendErr, ErrNotFound) {
		return truncateEmailPreview(sendErr.Error(), 300)
	}
	return "邮件发送失败，请检查邮箱连接后重试"
}

func (s *Server) enqueueAgentEmailMessage(ctx context.Context, source ShopSource, conversation Conversation, input Message, user User, clientRequestID string) (Message, Conversation, bool, error) {
	if strings.TrimSpace(input.Body) == "" {
		return Message{}, Conversation{}, false, fmt.Errorf("%w: body is required", ErrInvalid)
	}
	if err := validateAgentEmailOperation(conversation, user.ID); err != nil {
		return Message{}, Conversation{}, false, err
	}
	lock := s.emailSourceSyncLock(source.ID)
	lock.Lock()
	defer lock.Unlock()

	store, outbox, err := s.beginEmailOutbox(ctx, source, conversation, input, user.ID, clientRequestID)
	if err != nil {
		return Message{}, Conversation{}, false, err
	}
	existing, found, err := s.agentMessageByClientRequestID(ctx, conversation.ID, clientRequestID)
	if err != nil {
		return Message{}, Conversation{}, false, err
	}
	switch outbox.Status {
	case "completed":
		if !found {
			return Message{}, Conversation{}, false, fmt.Errorf("%w: completed email send record is missing its local message", ErrConflict)
		}
		return existing, conversation, true, nil
	case "sent":
		if found {
			_, _ = store.SetEmailOutboxState(ctx, outbox.ID, "completed", outbox.ProviderMetadata, "", existing.ID)
			return existing, conversation, true, nil
		}
		input, err = restoreEmailOutboxInput(input, outbox)
		if err != nil {
			return Message{}, Conversation{}, false, err
		}
		message, updated, reconciled, persistErr := s.persistAgentEmailReply(ctx, conversation, input, user.ID)
		if persistErr != nil {
			return Message{}, Conversation{}, false, persistErr
		}
		_, _ = store.SetEmailOutboxState(ctx, outbox.ID, "completed", outbox.ProviderMetadata, "", message.ID)
		return message, updated, reconciled, nil
	case "sending", "ambiguous":
		if !found {
			return Message{}, Conversation{}, false, fmt.Errorf("%w: email send result is pending reconciliation", ErrConflict)
		}
		return existing, conversation, true, nil
	case "pending":
	default:
		return Message{}, Conversation{}, false, fmt.Errorf("%w: unsupported email outbox state", ErrConflict)
	}

	if found {
		patch := mergeStringMaps(input.Metadata, map[string]string{
			emailSendStatusKey: emailSendStatusQueued,
			emailSendErrorKey:  "",
		})
		existing, err = s.store.UpdateMessageMetadata(ctx, conversation.ID, existing.ID, patch)
		if err != nil {
			return Message{}, Conversation{}, false, err
		}
		outbox, err = store.SetEmailOutboxState(ctx, outbox.ID, "pending", "{}", "", existing.ID)
		if err != nil {
			return Message{}, Conversation{}, false, err
		}
		return existing, conversation, true, nil
	}

	input.Metadata = mergeStringMaps(input.Metadata, map[string]string{
		messageClientRequestIDKey: clientRequestID,
		emailSendStatusKey:        emailSendStatusQueued,
		emailSendErrorKey:         "",
	})
	message, updated, err := s.store.AddAgentMessage(ctx, input, user.ID)
	if err != nil {
		return Message{}, Conversation{}, false, err
	}
	if _, err = store.SetEmailOutboxState(ctx, outbox.ID, "pending", "{}", "", message.ID); err != nil {
		return Message{}, Conversation{}, false, err
	}
	return message, updated, false, nil
}

func (s *Server) signalEmailOutboxWorker() {
	select {
	case s.emailOutboxWake <- struct{}{}:
	default:
	}
}

func (s *Server) updateEmailOutboxMessage(ctx context.Context, record EmailOutboxRecord, patch map[string]string) (Message, error) {
	message, err := s.store.UpdateMessageMetadata(ctx, record.ConversationID, record.MessageID, patch)
	if err != nil {
		return Message{}, err
	}
	conversation, err := s.store.GetConversation(ctx, record.ConversationID)
	if err == nil {
		s.broadcastConversationEvent(conversation, Event{
			Type: "message.updated", ShopID: conversation.ShopID, EntityID: message.ID,
			Payload: message, CreatedAt: time.Now().UTC(),
		})
	}
	return message, nil
}

func (s *Server) processEmailOutbox(ctx context.Context, store emailOutboxStore, record EmailOutboxRecord) {
	conversation, err := s.store.GetConversation(ctx, record.ConversationID)
	if err != nil {
		s.failEmailOutbox(ctx, store, record, nil, fmt.Errorf("conversation unavailable: %w", err))
		return
	}
	user, err := s.store.GetUser(ctx, record.RequestedBy)
	if err != nil {
		s.failEmailOutbox(ctx, store, record, nil, fmt.Errorf("sender unavailable: %w", err))
		return
	}
	message, err := s.store.GetMessage(ctx, record.ConversationID, record.MessageID)
	if err != nil {
		s.failEmailOutbox(ctx, store, record, nil, fmt.Errorf("queued message unavailable: %w", err))
		return
	}
	request, err := restoreEmailOutboxInput(message, record)
	if err != nil {
		s.failEmailOutbox(ctx, store, record, nil, err)
		return
	}
	_, _ = s.updateEmailOutboxMessage(ctx, record, map[string]string{
		emailSendStatusKey: emailSendStatusSending,
		emailSendErrorKey:  "",
	})

	var providerMetadata map[string]string
	if normalizeMessageType(request.Type) == MessageTypeImage {
		_, filePath, fileErr := s.storedChatAttachmentFile(request.Metadata["url"])
		if fileErr != nil {
			s.failEmailOutbox(ctx, store, record, nil, fmt.Errorf("queued attachment unavailable: %w", fileErr))
			return
		}
		content, readErr := os.ReadFile(filePath)
		if readErr != nil {
			s.failEmailOutbox(ctx, store, record, nil, fmt.Errorf("queued attachment unavailable: %w", readErr))
			return
		}
		providerMetadata, err = s.sendAgentEmailAttachmentReply(ctx, conversation, emailAttachmentInput{
			FileName: request.Metadata["fileName"], MIMEType: request.Metadata["mimeType"],
			Content: content, Body: request.Body,
		}, user)
	} else {
		request.Type = MessageTypeText
		providerMetadata, err = s.sendAgentEmailReply(ctx, conversation, request, user)
	}
	if err != nil {
		s.failEmailOutbox(ctx, store, record, providerMetadata, err)
		return
	}

	patch := mergeStringMaps(providerMetadata, map[string]string{
		emailSendStatusKey:      emailSendStatusSent,
		emailSendErrorKey:       "",
		emailSendCompletedAtKey: time.Now().UTC().Format(time.RFC3339),
	})
	if _, err = s.updateEmailOutboxMessage(ctx, record, patch); err != nil {
		_, _ = store.SetEmailOutboxState(ctx, record.ID, "ambiguous", encodeEmailOutboxProviderMetadata(providerMetadata), err.Error(), record.MessageID)
		return
	}
	if _, err = store.SetEmailOutboxState(ctx, record.ID, "completed", encodeEmailOutboxProviderMetadata(providerMetadata), "", record.MessageID); err != nil {
		log.Printf("email outbox: save completion failed for %s: %v", record.ID, err)
	}
}

func (s *Server) failEmailOutbox(ctx context.Context, store emailOutboxStore, record EmailOutboxRecord, providerMetadata map[string]string, sendErr error) {
	state := "ambiguous"
	messageStatus := emailSendStatusReconciling
	displayError := "发送结果正在后台核对，请勿重复发送这一封"
	if emailSendFailureIsExplicit(sendErr) {
		state = "failed"
		messageStatus = emailSendStatusFailed
		displayError = emailSendDisplayError(sendErr)
	}
	providerJSON := encodeEmailOutboxProviderMetadata(providerMetadata)
	_, _ = store.SetEmailOutboxState(context.WithoutCancel(ctx), record.ID, state, providerJSON, displayError, record.MessageID)
	patch := mergeStringMaps(providerMetadata, map[string]string{
		emailSendStatusKey: messageStatus,
		emailSendErrorKey:  displayError,
	})
	_, _ = s.updateEmailOutboxMessage(context.WithoutCancel(ctx), record, patch)
	s.recordEmailRuntimeEvent(context.WithoutCancel(ctx), EmailRuntimeEvent{
		Category: "outbox." + state, Severity: "error", ShopID: record.ShopID, SourceID: record.SourceID,
		EntityID: record.ID, Message: displayError,
	})
}

func (s *Server) reconcileAmbiguousEmailOutbox(ctx context.Context, store emailOutboxStore) {
	records, err := store.ListAmbiguousEmailOutbox(ctx, 100)
	if err != nil {
		if ctx.Err() == nil {
			log.Printf("email outbox: list pending reconciliation failed: %v", err)
		}
		return
	}
	for _, record := range records {
		message, messageErr := s.store.GetMessage(ctx, record.ConversationID, record.MessageID)
		if messageErr != nil || strings.TrimSpace(message.Metadata[emailSyncedSourceMessageIDKey]) == "" {
			continue
		}
		patch := map[string]string{
			emailSendStatusKey:      emailSendStatusSent,
			emailSendErrorKey:       "",
			emailSendCompletedAtKey: time.Now().UTC().Format(time.RFC3339),
		}
		_, _ = s.updateEmailOutboxMessage(ctx, record, patch)
		_, _ = store.SetEmailOutboxState(ctx, record.ID, "completed", record.ProviderMetadata, "", record.MessageID)
	}
}

func (s *Server) StartEmailOutboxMaintenance(ctx context.Context) {
	store, ok := s.store.(emailOutboxStore)
	if !ok {
		return
	}
	for range emailOutboxWorkerCount {
		go func() {
			processAvailable := true
			for {
				if !processAvailable {
					select {
					case <-ctx.Done():
						return
					case <-s.emailOutboxWake:
					}
				}
				processAvailable = false
				claimFailed := false
				for {
					record, claimErr := store.ClaimPendingEmailOutbox(ctx)
					if errors.Is(claimErr, ErrNotFound) {
						break
					}
					if claimErr != nil {
						if ctx.Err() == nil {
							log.Printf("email outbox: claim failed: %v", claimErr)
						}
						claimFailed = true
						break
					}
					s.processEmailOutbox(ctx, store, record)
				}
				if claimFailed {
					timer := time.NewTimer(emailOutboxClaimRetryDelay)
					select {
					case <-ctx.Done():
						if !timer.Stop() {
							select {
							case <-timer.C:
							default:
							}
						}
						return
					case <-s.emailOutboxWake:
						if !timer.Stop() {
							select {
							case <-timer.C:
							default:
							}
						}
					case <-timer.C:
					}
					processAvailable = true
				}
			}
		}()
	}
	go func() {
		ticker := time.NewTicker(emailOutboxRecoveryInterval)
		defer ticker.Stop()
		recoverStale := func() {
			records, err := store.RecoverEmailOutbox(ctx, time.Now().UTC().Add(-10*time.Minute))
			if err != nil {
				if ctx.Err() == nil {
					log.Printf("email outbox: recover interrupted sends failed: %v", err)
				}
				return
			}
			for _, record := range records {
				_, _ = s.updateEmailOutboxMessage(ctx, record, map[string]string{
					emailSendStatusKey: emailSendStatusReconciling,
					emailSendErrorKey:  "发送结果正在后台核对，请勿重复发送这一封",
				})
				s.recordEmailRuntimeEvent(ctx, EmailRuntimeEvent{
					Category: "outbox.ambiguous", Severity: "error", ShopID: record.ShopID, SourceID: record.SourceID,
					EntityID: record.ID, Message: "邮件发送在保存服务商结果前中断；请勿直接重发",
				})
			}
			s.reconcileAmbiguousEmailOutbox(ctx, store)
		}
		recoverStale()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				recoverStale()
			}
		}
	}()
}
