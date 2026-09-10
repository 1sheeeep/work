package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	emailReadRetryNextAtKey       = "email_read_sync_next_at"
	emailReadRetryFailureCountKey = "email_read_sync_failure_count"
	emailReadRetryStateKey        = "email_read_sync_retry_state"
	emailReadPendingMaxIDs        = 1000
)

const (
	emailReadPendingIDsKey = "email_read_pending_message_ids"
	emailReadSyncStatusKey = "email_read_sync_status"
	emailReadSyncErrorKey  = "email_read_sync_error"
	emailReadSyncAtKey     = "email_read_sync_at"
	emailReadSyncTimeout   = 5 * time.Second
)

type conversationReadRequest struct {
	ThroughMessageID string `json:"throughMessageId"`
	AfterMessageID   string `json:"afterMessageId"`
}

type conversationReadResponse struct {
	OK               bool `json:"ok"`
	EmailReadSynced  bool `json:"emailReadSynced"`
	EmailReadPending bool `json:"emailReadPending"`
}

func conversationMessagesThrough(messages []Message, throughMessageID string) ([]Message, time.Time, error) {
	throughMessageID = strings.TrimSpace(throughMessageID)
	if len(messages) == 0 {
		if throughMessageID != "" {
			return nil, time.Time{}, fmt.Errorf("%w: read boundary message was not found", ErrInvalid)
		}
		return nil, time.Now().UTC(), nil
	}
	end := len(messages) - 1
	if throughMessageID != "" {
		end = -1
		for index, message := range messages {
			if message.ID == throughMessageID {
				end = index
				break
			}
		}
		if end < 0 {
			return nil, time.Time{}, fmt.Errorf("%w: read boundary message was not found", ErrInvalid)
		}
	}
	readAt := messages[end].CreatedAt
	if readAt.IsZero() {
		readAt = time.Now().UTC()
	}
	return messages[:end+1], readAt, nil
}

func conversationMessagesAfter(messages []Message, afterMessageID string) []Message {
	afterMessageID = strings.TrimSpace(afterMessageID)
	if afterMessageID == "" {
		return messages
	}
	for index, message := range messages {
		if message.ID == afterMessageID {
			return messages[index+1:]
		}
	}
	return messages
}

func (s *Server) markHandledEmailMessagesRead(ctx context.Context, userID string, conversation Conversation, messages []Message) (bool, error) {
	if conversation.Status != ConversationStatusAssigned || strings.TrimSpace(conversation.AssignedAgentID) != strings.TrimSpace(userID) {
		return true, nil
	}
	return s.markEmailMessagesRead(ctx, conversation, messages)
}

func (s *Server) markEmailMessagesRead(ctx context.Context, conversation Conversation, messages []Message) (bool, error) {
	source, err := s.store.GetShopSource(ctx, conversation.ShopID, conversation.SourceID)
	if err != nil {
		return false, err
	}
	if source.Type != SourceTypeEmail {
		return true, nil
	}
	provider := strings.ToLower(strings.TrimSpace(source.Provider))
	messageIDs := mergeUniqueStrings(pendingEmailReadMessageIDs(source.Metadata), providerReadMessageIDs(provider, messages))
	if len(messageIDs) == 0 {
		return true, nil
	}
	updated, err := s.updatePendingEmailReadMessageIDs(ctx, source, messageIDs, nil, nil)
	if err != nil {
		return false, err
	}
	if err := s.enqueueEmailSourceSync(ctx, updated, "read-state", time.Now().UTC()); err != nil {
		return false, err
	}
	return false, nil
}

func (s *Server) retryPendingEmailReadStates(ctx context.Context, source ShopSource, installation EmailInstallation) (ShopSource, error) {
	messageIDs := pendingEmailReadMessageIDs(source.Metadata)
	if len(messageIDs) == 0 {
		return source, nil
	}
	return s.flushEmailReadMessageIDs(ctx, source, installation, messageIDs)
}

func (s *Server) flushEmailReadMessageIDs(ctx context.Context, source ShopSource, installation EmailInstallation, messageIDs []string) (ShopSource, error) {
	provider := strings.ToLower(strings.TrimSpace(source.Provider))
	var scopeErr error
	switch provider {
	case "gmail":
		scopeErr = validateGmailGrantedScopes(installation.Scope)
	case "outlook":
		scopeErr = validateOutlookGrantedScopes(installation.Scope)
	case standardMailProvider:
		_, scopeErr = standardMailConfigFrom(source, installation)
	default:
		scopeErr = fmt.Errorf("%w: unsupported email provider %q", ErrInvalid, provider)
	}
	if scopeErr != nil {
		updated, persistErr := s.updatePendingEmailReadMessageIDs(ctx, source, messageIDs, nil, scopeErr)
		return updated, firstNonNilError(scopeErr, persistErr)
	}

	failed := make([]string, 0)
	var lastErr error
	providerCtx, cancel := context.WithTimeout(ctx, emailReadSyncTimeout)
	defer cancel()
	for _, messageID := range mergeUniqueStrings(messageIDs) {
		var err error
		switch provider {
		case "gmail":
			err = setGmailMessageRead(providerCtx, installation.AccessToken, messageID, true)
		case "outlook":
			err = setOutlookMessageRead(providerCtx, installation.AccessToken, messageID, true)
		case standardMailProvider:
			var config standardMailConfig
			config, err = standardMailConfigFrom(source, installation)
			if err == nil {
				err = setStandardIMAPMessageRead(providerCtx, config, messageID, true)
			}
		}
		if err != nil {
			if isEmailProviderHTTPStatus(err, http.StatusNotFound) {
				continue
			}
			failed = append(failed, messageID)
			lastErr = err
		}
	}
	updated, persistErr := s.updatePendingEmailReadMessageIDs(ctx, source, failed, messageIDs, lastErr)
	if persistErr != nil {
		return updated, persistErr
	}
	if len(failed) > 0 {
		return updated, fmt.Errorf("email read-state sync deferred for %d message(s): %w", len(failed), lastErr)
	}
	return updated, nil
}

func (s *Server) updatePendingEmailReadMessageIDs(ctx context.Context, source ShopSource, add []string, remove []string, syncErr error) (ShopSource, error) {
	add = mergeUniqueStrings(add)
	removeSet := map[string]bool{}
	for _, messageID := range mergeUniqueStrings(remove) {
		removeSet[messageID] = true
	}
	return s.store.MutateShopSourceMetadata(ctx, source.ShopID, source.ID, func(metadata map[string]string) map[string]string {
		pending := pendingEmailReadMessageIDs(metadata)
		kept := make([]string, 0, len(pending)+len(add))
		for _, messageID := range pending {
			if !removeSet[messageID] {
				kept = append(kept, messageID)
			}
		}
		kept = mergeUniqueStrings(kept, add)
		if len(kept) > emailReadPendingMaxIDs {
			kept = kept[len(kept)-emailReadPendingMaxIDs:]
		}
		if len(kept) == 0 {
			delete(metadata, emailReadPendingIDsKey)
			delete(metadata, emailReadSyncErrorKey)
			metadata[emailReadSyncStatusKey] = "ok"
			delete(metadata, emailReadRetryNextAtKey)
			delete(metadata, emailReadRetryFailureCountKey)
			delete(metadata, emailReadRetryStateKey)
		} else {
			raw, _ := json.Marshal(kept)
			metadata[emailReadPendingIDsKey] = string(raw)
			metadata[emailReadSyncStatusKey] = "pending"
			if syncErr != nil {
				metadata[emailReadSyncErrorKey] = truncateEmailPreview(syncErr.Error(), 500)
				state := emailRetryStateForError(syncErr)
				metadata[emailReadRetryStateKey] = state
				failureCount, _ := strconv.Atoi(metadata[emailReadRetryFailureCountKey])
				failureCount++
				metadata[emailReadRetryFailureCountKey] = strconv.Itoa(failureCount)
				if emailRetryStateIsPermanent(state) {
					delete(metadata, emailReadRetryNextAtKey)
				} else {
					metadata[emailReadRetryNextAtKey] = time.Now().UTC().Add(emailRetryDelayWithJitter(syncErr, failureCount, time.Now().UTC(), source.Address+":read")).Format(time.RFC3339Nano)
				}
			}
		}
		metadata[emailReadSyncAtKey] = time.Now().UTC().Format(time.RFC3339Nano)
		return metadata
	})
}

func providerReadMessageIDs(provider string, messages []Message) []string {
	ids := make([]string, 0, len(messages))
	for _, message := range messages {
		if !isInboundMessageDirection(message.Direction) || strings.Contains(message.SourceMessageID, ":attachment:") {
			continue
		}
		var messageID string
		switch provider {
		case "gmail":
			messageID = firstNonEmpty(message.Metadata["gmail_message_id"], sourceMessageIDForProvider(message.SourceMessageID, "gmail"))
		case "outlook":
			messageID = firstNonEmpty(message.Metadata["outlook_message_id"], sourceMessageIDForProvider(message.SourceMessageID, "outlook"))
		case standardMailProvider:
			messageID = firstNonEmpty(message.Metadata[standardMailProvider+"_message_id"], sourceMessageIDForProvider(message.SourceMessageID, standardMailProvider))
		}
		if strings.TrimSpace(messageID) != "" {
			ids = append(ids, strings.TrimSpace(messageID))
		}
	}
	return mergeUniqueStrings(ids)
}

func sourceMessageIDForProvider(sourceMessageID string, provider string) string {
	value := strings.TrimSpace(sourceMessageID)
	prefix := strings.ToLower(strings.TrimSpace(provider)) + ":"
	if strings.HasPrefix(strings.ToLower(value), prefix) {
		return value[len(prefix):]
	}
	return ""
}

func pendingEmailReadMessageIDs(metadata map[string]string) []string {
	if len(metadata) == 0 || strings.TrimSpace(metadata[emailReadPendingIDsKey]) == "" {
		return nil
	}
	var ids []string
	if err := json.Unmarshal([]byte(metadata[emailReadPendingIDsKey]), &ids); err != nil {
		return nil
	}
	return mergeUniqueStrings(ids)
}

func mergeUniqueStrings(groups ...[]string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, group := range groups {
		for _, value := range group {
			value = strings.TrimSpace(value)
			if value == "" || seen[value] {
				continue
			}
			seen[value] = true
			out = append(out, value)
		}
	}
	return out
}

func firstNonNilError(primary error, secondary error) error {
	if primary != nil && secondary != nil {
		return fmt.Errorf("%v; pending-state persistence failed: %w", primary, secondary)
	}
	if primary != nil {
		return primary
	}
	return secondary
}
