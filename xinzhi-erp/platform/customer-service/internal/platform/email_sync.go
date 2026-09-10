package platform

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"log"
	"net/http"
	"net/mail"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

type emailSyncResult struct {
	Provider             string         `json:"provider"`
	SourcesScanned       int            `json:"sourcesScanned"`
	SourcesSucceeded     int            `json:"sourcesSucceeded"`
	SourcesFailed        int            `json:"sourcesFailed"`
	ConversationsCreated int            `json:"conversationsCreated"`
	MessagesCreated      int            `json:"messagesCreated"`
	MessagesSkipped      int            `json:"messagesSkipped"`
	SystemNotifications  int            `json:"systemNotifications"`
	FilteredMessages     int            `json:"filteredMessages"`
	FilteredByRule       map[string]int `json:"filteredByRule,omitempty"`
	BacklogPending       bool           `json:"backlogPending,omitempty"`
	Warnings             []string       `json:"warnings,omitempty"`
}

type incomingEmailMessage struct {
	ExternalConversationID string
	CustomerName           string
	CustomerEmail          string
	SenderName             string
	SenderEmail            string
	ReplyToName            string
	ReplyToEmail           string
	Subject                string
	Body                   string
	SourceMessageID        string
	Metadata               map[string]string
	Attachments            []incomingEmailAttachment
	ReceivedAt             time.Time
	Direction              string
	Classification         string
	ClassificationReason   string
}

type incomingEmailAttachment struct {
	FileName string
	MIMEType string
	Content  []byte
	Inline   bool
}

const emailSourceSyncTimeout = 45 * time.Second

var emailThreadHistoryFetchTimeout = 8 * time.Second

const (
	emailSyncedSourceMessageIDKey = "mail_synced_source_message_id"
	emailSentReconcileWindow      = 5 * time.Minute
	emailHistoricalImportKey      = "email_historical_import"
	historicalEmailClassification = "historical email import: "
	highFrequencyEmailIsolation   = "high-frequency sender isolated from routing"
)

type emailIngestOptions struct {
	Historical bool
}

type emailExpansionOptions struct {
	ReadOnlyHistorical bool
}

func (s *Server) syncShopEmailProvider(ctx context.Context, shopID string, provider string) (emailSyncResult, error) {
	provider = strings.ToLower(strings.TrimSpace(provider))
	if provider != "gmail" && provider != "outlook" && provider != cuiqiuProvider && provider != standardMailProvider {
		return emailSyncResult{}, fmt.Errorf("%w: unsupported email provider %q", ErrInvalid, provider)
	}
	if _, err := s.store.GetShop(ctx, shopID); err != nil {
		return emailSyncResult{}, err
	}
	sources, err := s.store.ListShopSources(ctx, shopID)
	if err != nil {
		return emailSyncResult{}, err
	}
	result := emailSyncResult{Provider: provider}
	for _, source := range sources {
		if source.Type != SourceTypeEmail || source.Status != SourceStatusActive || strings.ToLower(strings.TrimSpace(source.Provider)) != provider {
			continue
		}
		lock := s.emailSourceSyncLock(source.ID)
		lock.Lock()
		sourceCtx, cancel := context.WithTimeout(ctx, emailSourceSyncTimeout)
		if latest, latestErr := s.store.GetShopSource(sourceCtx, shopID, source.ID); latestErr == nil {
			source = latest
		}
		sourceResult := s.syncSingleEmailSource(sourceCtx, shopID, provider, source)
		cancel()
		lock.Unlock()
		mergeEmailSyncResult(&result, sourceResult)
	}
	if result.SourcesScanned == 0 {
		return emailSyncResult{}, fmt.Errorf("%w: email sync failed: no active %s email channel is configured", ErrInvalid, provider)
	}
	if result.SourcesSucceeded == 0 {
		return emailSyncResult{}, fmt.Errorf("%w: email sync failed for every %s mailbox: %s", ErrInvalid, provider, strings.Join(result.Warnings, "; "))
	}
	return result, nil
}

func (s *Server) syncSingleEmailSource(ctx context.Context, shopID string, provider string, source ShopSource) emailSyncResult {
	result := emailSyncResult{Provider: provider, SourcesScanned: 1}
	installation, err := s.store.GetEmailInstallation(ctx, shopID, source.Address)
	if err != nil {
		authorizationErr := fmt.Errorf("email installation missing: %w", err)
		_ = s.updateEmailSourceSyncState(ctx, source, false, authorizationErr)
		result.SourcesFailed++
		result.Warnings = append(result.Warnings, fmt.Sprintf("%s: mailbox authorization missing: %v", source.Address, err))
		return result
	}
	installation.Provider = provider
	installation, err = s.emailInstallationWithFreshToken(ctx, installation)
	if err != nil {
		_ = s.updateEmailSourceSyncState(ctx, source, false, err)
		result.SourcesFailed++
		result.Warnings = append(result.Warnings, fmt.Sprintf("%s: token refresh failed: %v", source.Address, err))
		return result
	}
	if updatedSource, retryErr := s.retryPendingEmailReadStates(ctx, source, installation); retryErr != nil {
		log.Printf("email sync: pending read-state retry failed for %s: %v", source.Address, retryErr)
		if updatedSource.ID != "" {
			source = updatedSource
		}
	} else {
		source = updatedSource
	}
	conversationExists := func(externalConversationID string) (bool, error) {
		conversationID := stableExternalConversationID(source.ID, externalConversationID)
		if conversationID == "" {
			return false, nil
		}
		_, lookupErr := s.store.GetConversation(ctx, conversationID)
		if errors.Is(lookupErr, ErrNotFound) {
			return false, nil
		}
		return lookupErr == nil, lookupErr
	}
	batch, err := fetchProviderEmailSyncBatch(ctx, provider, installation.AccessToken, source.Address, source, conversationExists)
	if err != nil {
		_ = s.updateEmailSourceSyncState(ctx, source, false, err)
		result.SourcesFailed++
		result.Warnings = append(result.Warnings, fmt.Sprintf("%s: incremental email sync failed: %v", source.Address, err))
		return result
	}
	return s.ingestEmailSyncBatch(ctx, shopID, source, batch, result)
}

func (s *Server) ingestEmailSyncBatch(ctx context.Context, shopID string, source ShopSource, batch emailProviderSyncBatch, result emailSyncResult) emailSyncResult {
	result.BacklogPending = batch.BacklogPending
	ingestStates := map[string]*emailConversationIngestState{}
	batch.Messages = boundIncomingEmailMessages(batch.Messages, emailSyncStart(source), 0)
	quarantined := 0
	lastQuarantineError := ""
	for _, candidate := range batch.Quarantined {
		if _, err := s.saveEmailQuarantineCandidate(ctx, source, candidate); err != nil {
			result.SourcesFailed++
			result.Warnings = append(result.Warnings, source.Address+": save quarantined email failed: "+err.Error())
			_ = s.updateEmailSourceSyncState(ctx, source, false, err)
			return result
		}
		quarantined++
		result.MessagesSkipped++
		lastQuarantineError = candidate.ErrorMessage
	}
	var ingressErr error
	var floodPaused bool
	batch.MetadataUpdates, _, floodPaused, ingressErr = s.applyRollingEmailIngressProtection(ctx, source, batch.Messages, batch.MetadataUpdates)
	if ingressErr != nil {
		result.SourcesFailed++
		result.Warnings = append(result.Warnings, source.Address+": evaluate email ingress rate failed: "+ingressErr.Error())
		_ = s.updateEmailSourceSyncState(ctx, source, false, ingressErr)
		return result
	}
	for _, item := range batch.Messages {
		decision := applyIncomingEmailFilterDecision(&item)
		if item.Classification == "filtered" {
			result.FilteredMessages++
			result.MessagesSkipped++
			if decision.RuleID == "" {
				decision.RuleID = "provider-preclassified"
			}
			if result.FilteredByRule == nil {
				result.FilteredByRule = map[string]int{}
			}
			result.FilteredByRule[decision.RuleID]++
			continue
		}
		if item.Metadata["email_ingress_isolation"] == "high_frequency_sender" {
			item.Classification = ConversationKindSystem
			item.ClassificationReason = highFrequencyEmailIsolation
		}
		conversationID := stableExternalConversationID(source.ID, item.ExternalConversationID)
		state := ingestStates[conversationID]
		if state == nil {
			state = &emailConversationIngestState{}
			ingestStates[conversationID] = state
		}
		createdConversation, createdMessage, skipped, err := s.ingestProviderEmailWithState(ctx, shopID, source, item, state)
		if err != nil {
			candidate, candidateErr := incomingEmailQuarantineCandidate(item, "live_ingest", err)
			if candidateErr != nil {
				result.Warnings = append(result.Warnings, fmt.Sprintf("%s: ingest message %s failed: %v", source.Address, item.SourceMessageID, err))
				continue
			}
			if _, quarantineErr := s.saveEmailQuarantineCandidate(ctx, source, candidate); quarantineErr != nil {
				result.Warnings = append(result.Warnings, fmt.Sprintf("%s: quarantine message %s failed: %v", source.Address, item.SourceMessageID, quarantineErr))
				continue
			}
			quarantined++
			result.MessagesSkipped++
			lastQuarantineError = err.Error()
			continue
		}
		if createdConversation {
			result.ConversationsCreated++
		}
		if createdMessage {
			result.MessagesCreated++
			if item.Classification == ConversationKindSystem {
				result.SystemNotifications++
			}
		}
		if skipped {
			result.MessagesSkipped++
		}
	}
	batch.MetadataUpdates = recordEmailQuarantineMetadata(batch.MetadataUpdates, source, quarantined, lastQuarantineError)
	if len(result.Warnings) > 0 {
		result.SourcesFailed++
		_ = s.updateEmailSourceSyncState(ctx, source, false, errors.New(strings.Join(result.Warnings, "; ")))
		return result
	}
	if result.MessagesCreated > 0 {
		if batch.MetadataUpdates == nil {
			batch.MetadataUpdates = map[string]string{}
		}
		batch.MetadataUpdates["email_last_new_message_at"] = time.Now().UTC().Format(time.RFC3339)
	}
	if result.FilteredMessages > 0 {
		if batch.MetadataUpdates == nil {
			batch.MetadataUpdates = map[string]string{}
		}
		total, _ := strconv.Atoi(strings.TrimSpace(source.Metadata["email_filtered_message_count"]))
		batch.MetadataUpdates["email_filtered_message_count"] = strconv.Itoa(total + result.FilteredMessages)
		batch.MetadataUpdates["email_last_filtered_at"] = time.Now().UTC().Format(time.RFC3339)
		batch.MetadataUpdates["email_filtered_rule_counts"] = mergeEmailFilterRuleCounts(
			source.Metadata["email_filtered_rule_counts"],
			result.FilteredByRule,
		)
	}
	if batch.MetadataUpdates == nil {
		batch.MetadataUpdates = map[string]string{}
	}
	setEmailSyncBacklogMetadata(batch.MetadataUpdates, source.Metadata, batch.BacklogPending)
	if err := s.updateEmailSourceSyncState(ctx, source, true, nil, batch.MetadataUpdates); err != nil {
		result.SourcesFailed++
		result.Warnings = append(result.Warnings, fmt.Sprintf("%s: email cursor state persistence failed: %v", source.Address, err))
		return result
	}
	if floodPaused {
		s.notifyStandardIMAPSupervisor()
		s.recordEmailRuntimeEvent(ctx, EmailRuntimeEvent{
			Category: "flood.paused", Severity: "warning", ShopID: source.ShopID, SourceID: source.ID,
			EntityID: source.ID, Message: fmt.Sprintf("邮箱洪峰触发自动暂停，%s 在 10 分钟窗口内达到 %s 封", batch.MetadataUpdates["email_flood_pause_reason"], batch.MetadataUpdates["email_flood_pause_count"]),
		})
	}
	result.SourcesSucceeded++
	return result
}

func acceptedGmailSpamMessageID(provider string, input incomingEmailMessage) string {
	if !strings.EqualFold(strings.TrimSpace(provider), "gmail") ||
		!strings.EqualFold(strings.TrimSpace(input.Classification), ConversationKindCustomer) ||
		!strings.EqualFold(strings.TrimSpace(input.Metadata["email_folder_origin"]), "spam") {
		return ""
	}
	direction := strings.TrimSpace(input.Direction)
	if direction != "" && direction != MessageDirectionCustomer {
		return ""
	}
	return firstNonEmpty(
		input.Metadata["gmail_message_id"],
		stripEmailMessagePrefix(input.SourceMessageID, "gmail"),
	)
}

func mergeEmailSyncResult(target *emailSyncResult, source emailSyncResult) {
	target.SourcesScanned += source.SourcesScanned
	target.SourcesSucceeded += source.SourcesSucceeded
	target.SourcesFailed += source.SourcesFailed
	target.ConversationsCreated += source.ConversationsCreated
	target.MessagesCreated += source.MessagesCreated
	target.MessagesSkipped += source.MessagesSkipped
	target.SystemNotifications += source.SystemNotifications
	target.FilteredMessages += source.FilteredMessages
	target.BacklogPending = target.BacklogPending || source.BacklogPending
	if len(source.FilteredByRule) > 0 {
		if target.FilteredByRule == nil {
			target.FilteredByRule = map[string]int{}
		}
		for ruleID, count := range source.FilteredByRule {
			target.FilteredByRule[ruleID] += count
		}
	}
	target.Warnings = append(target.Warnings, source.Warnings...)
}

func mergeEmailFilterRuleCounts(existing string, increments map[string]int) string {
	counts := map[string]int{}
	if strings.TrimSpace(existing) != "" {
		_ = json.Unmarshal([]byte(existing), &counts)
	}
	for ruleID, count := range increments {
		ruleID = strings.TrimSpace(ruleID)
		if ruleID != "" && count > 0 {
			counts[ruleID] += count
		}
	}
	encoded, err := json.Marshal(counts)
	if err != nil {
		return "{}"
	}
	return string(encoded)
}

func (s *Server) updateEmailSourceSyncState(ctx context.Context, source ShopSource, success bool, syncErr error, metadataUpdates ...map[string]string) error {
	stateCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	now := time.Now().UTC()
	updated, err := s.store.MutateShopSourceMetadata(stateCtx, source.ShopID, source.ID, func(metadata map[string]string) map[string]string {
		metadata["email_sync_mode"] = "incremental"
		if strings.EqualFold(source.Provider, cuiqiuProvider) {
			metadata["email_sync_interval"] = "webhook+24h_reconcile"
		} else if strings.EqualFold(source.Provider, standardMailProvider) {
			metadata["email_sync_interval"] = standardIMAPSyncInterval(source)
		} else {
			metadata["email_sync_interval"] = "push+24h_reconcile"
		}
		metadata["email_last_sync_at"] = now.Format(time.RFC3339)
		if success && len(metadataUpdates) > 0 {
			metadata = mergeStringMaps(metadata, metadataUpdates[0])
		}
		if success {
			if strings.TrimSpace(metadata[emailManualPausedAtKey]) != "" {
				metadata["email_sync_status"] = "paused"
			} else {
				metadata["email_sync_status"] = "ok"
			}
			metadata["email_last_success_at"] = now.Format(time.RFC3339)
			delete(metadata, "email_last_error")
			metadata = clearEmailRetryState(metadata)
		} else {
			metadata["email_sync_status"] = "error"
			if syncErr != nil {
				metadata["email_last_error"] = truncateEmailPreview(syncErr.Error(), 500)
				metadata = applyEmailRetryFailure(metadata, syncErr, now, false)
			}
		}
		return metadata
	})
	if err == nil && (source.Metadata["email_sync_status"] != updated.Metadata["email_sync_status"] ||
		source.Metadata["email_last_error"] != updated.Metadata["email_last_error"] ||
		source.Metadata[emailRetryStateKey] != updated.Metadata[emailRetryStateKey] ||
		source.Metadata[emailRetryNextAtKey] != updated.Metadata[emailRetryNextAtKey]) {
		s.broadcast(Event{
			Type:      "shop_source.updated",
			ShopID:    updated.ShopID,
			EntityID:  updated.ID,
			Payload:   updated,
			CreatedAt: time.Now().UTC(),
		})
	}
	if err == nil && strings.EqualFold(source.Provider, standardMailProvider) {
		s.notifyStandardIMAPSupervisor()
	}
	return err
}

type emailConversationIngestState struct {
	loaded                   bool
	messages                 []Message
	existingSourceMessageIDs map[string]bool
}

func (s *Server) ingestProviderEmail(ctx context.Context, shopID string, source ShopSource, input incomingEmailMessage) (bool, bool, bool, error) {
	return s.ingestProviderEmailWithStateAndOptions(ctx, shopID, source, input, &emailConversationIngestState{}, emailIngestOptions{})
}

func (s *Server) ingestProviderEmailWithState(ctx context.Context, shopID string, source ShopSource, input incomingEmailMessage, state *emailConversationIngestState) (bool, bool, bool, error) {
	return s.ingestProviderEmailWithStateAndOptions(ctx, shopID, source, input, state, emailIngestOptions{})
}

func (s *Server) ingestProviderEmailWithStateAndOptions(ctx context.Context, shopID string, source ShopSource, input incomingEmailMessage, state *emailConversationIngestState, options emailIngestOptions) (bool, bool, bool, error) {
	if shouldDiscardIncomingEmail(input) {
		return false, false, true, nil
	}
	if options.Historical {
		input.Metadata = mergeStringMaps(input.Metadata, map[string]string{emailHistoricalImportKey: "true"})
	}
	conversationID := stableExternalConversationID(source.ID, input.ExternalConversationID)
	if conversationID == "" {
		return false, false, false, fmt.Errorf("%w: external email conversation id is required", ErrInvalid)
	}
	conversation, err := s.store.GetConversation(ctx, conversationID)
	conversationCreated := false
	classifiedKind := normalizeConversationKind(input.Classification)
	incomingKind := classifiedKind
	direction := input.Direction
	if direction == "" {
		if classifiedKind == ConversationKindSystem {
			direction = MessageDirectionSystem
		} else {
			direction = MessageDirectionCustomer
		}
	} else if classifiedKind == ConversationKindSystem && direction == MessageDirectionCustomer {
		direction = MessageDirectionSystem
	}
	replyAllowed := incomingKind == ConversationKindCustomer && incomingEmailReplyAllowed(input.ReplyToEmail, firstNonEmpty(input.SenderEmail, input.CustomerEmail))
	if errors.Is(err, ErrNotFound) {
		status := ConversationStatusOpen
		classification := input.ClassificationReason
		if options.Historical {
			status = ConversationStatusClosed
			classification = historicalEmailClassification + classification
		}
		conversation, err = s.store.CreateConversation(ctx, Conversation{
			ID:             conversationID,
			ShopID:         shopID,
			SourceID:       source.ID,
			CustomerName:   input.CustomerName,
			CustomerEmail:  input.CustomerEmail,
			Subject:        input.Subject,
			Status:         status,
			Kind:           incomingKind,
			ReplyAllowed:   replyAllowed,
			Classification: classification,
			LastMessageAt:  input.ReceivedAt,
		})
		if err != nil {
			return false, false, false, err
		}
		conversationCreated = true
		state.loaded = true
		state.messages = nil
		state.existingSourceMessageIDs = map[string]bool{}
		s.broadcastConversationEvent(conversation, Event{Type: "conversation.created", ShopID: conversation.ShopID, EntityID: conversation.ID, Payload: conversation, CreatedAt: time.Now().UTC()})
	} else if err != nil {
		return false, false, false, err
	} else if conversation.ShopID != shopID || conversation.SourceID != source.ID {
		return false, false, false, fmt.Errorf("%w: email conversation belongs to a different shop or source", ErrInvalid)
	}
	if !conversationCreated {
		nextKind := normalizeConversationKind(conversation.Kind)
		if nextKind == ConversationKindDepartment {
			nextKind = incomingKind
		} else if incomingKind == ConversationKindCustomer && direction == MessageDirectionCustomer {
			nextKind = ConversationKindCustomer
		}
		nextReplyAllowed := conversation.ReplyAllowed || (nextKind == ConversationKindCustomer && direction == MessageDirectionCustomer && replyAllowed)
		improvedCustomerName := ""
		if incomingKind == ConversationKindCustomer && direction == MessageDirectionCustomer && shouldImproveEmailCustomerName(conversation.CustomerName, input.CustomerName, firstNonEmpty(input.CustomerEmail, conversation.CustomerEmail)) {
			improvedCustomerName = strings.TrimSpace(input.CustomerName)
		}
		clearHistoricalClassification := !options.Historical && isHistoricalEmailConversation(conversation)
		if conversation.Kind != nextKind || conversation.ReplyAllowed != nextReplyAllowed || improvedCustomerName != "" || clearHistoricalClassification {
			previousConversation := conversation
			conversation, err = s.store.UpdateConversation(ctx, conversation.ID, ConversationUpdate{
				SetEmailDisposition: true,
				Kind:                nextKind,
				ReplyAllowed:        nextReplyAllowed,
				Classification:      firstNonEmpty(input.ClassificationReason, conversation.Classification),
				SetCustomerIdentity: improvedCustomerName != "",
				CustomerName:        improvedCustomerName,
				CustomerEmail:       conversation.CustomerEmail,
			})
			if err != nil {
				return false, false, false, err
			}
			s.refillCapacityAfterConversationChange(previousConversation, conversation)
			s.broadcastConversationEvent(conversation, Event{Type: "conversation.updated", ShopID: conversation.ShopID, EntityID: conversation.ID, Payload: conversation, CreatedAt: time.Now().UTC()})
		}
	}
	if !state.loaded {
		state.messages, err = s.store.ListMessages(ctx, conversation.ID)
		if err != nil {
			return conversationCreated, false, false, err
		}
		state.existingSourceMessageIDs = make(map[string]bool, len(state.messages))
		for _, message := range state.messages {
			for _, sourceMessageID := range storedEmailSourceMessageIDs(message) {
				state.existingSourceMessageIDs[sourceMessageID] = true
			}
		}
		state.loaded = true
	}
	existingMessages := state.messages
	existingSourceMessageIDs := state.existingSourceMessageIDs
	bodyCreated := false
	var bodyMessage Message
	sourceMessageExists := input.SourceMessageID != "" && existingSourceMessageIDs[input.SourceMessageID]
	if !sourceMessageExists && direction == MessageDirectionAgent {
		reconciled, reconcileErr := s.reconcileSyncedAgentEmailMessage(ctx, source, input, existingMessages)
		if reconcileErr != nil {
			return conversationCreated, false, false, reconcileErr
		}
		if reconciled {
			sourceMessageExists = true
			existingSourceMessageIDs[input.SourceMessageID] = true
		}
	}
	if input.SourceMessageID == "" || !sourceMessageExists {
		message, updated, err := s.store.AddMessage(ctx, Message{
			ConversationID:  conversation.ID,
			Direction:       direction,
			Body:            input.Body,
			Metadata:        input.Metadata,
			SenderName:      firstNonEmpty(input.SenderName, input.CustomerName),
			SenderEmail:     firstNonEmpty(input.SenderEmail, input.CustomerEmail),
			SourceMessageID: input.SourceMessageID,
			CreatedAt:       input.ReceivedAt,
		})
		if err != nil {
			return conversationCreated, false, false, err
		}
		bodyCreated = true
		bodyMessage = message
		state.messages = append(state.messages, message)
		for _, sourceMessageID := range storedEmailSourceMessageIDs(message) {
			existingSourceMessageIDs[sourceMessageID] = true
		}
		s.broadcastConversationEvent(updated, Event{Type: "message.created", ShopID: updated.ShopID, EntityID: message.ID, Payload: message, CreatedAt: time.Now().UTC()})
	}
	if bodyMessage.ID == "" {
		for _, existing := range state.messages {
			if existing.SourceMessageID == input.SourceMessageID && normalizeMessageType(existing.Type) == MessageTypeText {
				bodyMessage = existing
				break
			}
		}
	}
	attachmentCreated := false
	for index, attachment := range input.Attachments {
		attachmentSourceID := input.SourceMessageID + ":attachment:" + strconv.Itoa(index)
		if existingSourceMessageIDs[attachmentSourceID] {
			continue
		}
		created, updated, err := s.addIncomingEmailAttachment(ctx, conversation, input, attachment, index)
		if err != nil {
			if errors.Is(err, ErrInvalid) {
				log.Printf("email sync: skipped an unsupported, empty, or oversized attachment: %v", err)
				continue
			}
			return conversationCreated, bodyCreated, false, err
		}
		attachmentCreated = true
		state.messages = append(state.messages, created)
		existingSourceMessageIDs[attachmentSourceID] = true
		s.broadcastConversationEvent(updated, Event{Type: "message.created", ShopID: updated.ShopID, EntityID: created.ID, Payload: created, CreatedAt: time.Now().UTC()})
	}
	if bodyMessage.ID != "" && strings.EqualFold(input.Metadata["email_has_attachments"], "true") {
		provider := strings.ToLower(strings.TrimSpace(source.Provider))
		if provider == "gmail" || provider == "outlook" {
			archiveStatus := strings.ToLower(strings.TrimSpace(bodyMessage.Metadata["email_attachment_archive_status"]))
			if archiveStatus != "completed" && archiveStatus != "partial" && archiveStatus != "failed" {
				if err := s.enqueueEmailAttachmentArchive(context.WithoutCancel(ctx), source, bodyMessage, emailAttachmentPriorityBackground); err != nil {
					log.Printf("email attachment queue: enqueue %s failed: %v", bodyMessage.ID, err)
				}
			}
		} else {
			status := "completed"
			archiveError := strings.TrimSpace(input.Metadata["email_attachment_import_error"])
			if archiveError != "" {
				status = "partial"
			}
			_, _ = s.store.UpdateMessageMetadata(context.WithoutCancel(ctx), bodyMessage.ConversationID, bodyMessage.ID, map[string]string{
				"email_attachment_archive_status":       status,
				"email_attachment_archive_error":        archiveError,
				"email_attachment_archive_completed_at": time.Now().UTC().Format(time.RFC3339),
				"email_attachment_count":                strconv.Itoa(len(input.Attachments)),
				"email_attachment_archived_count":       strconv.Itoa(len(input.Attachments)),
			})
		}
	}
	incomingDirection := input.Direction
	if incomingDirection == "" {
		incomingDirection = MessageDirectionCustomer
	}
	if !options.Historical && (bodyCreated || attachmentCreated) && incomingDirection == MessageDirectionCustomer && isCustomerConversation(conversation) {
		if _, _, routeErr := s.tryAutoAssignConversation(ctx, conversation.ID); routeErr != nil {
			log.Printf("email sync: automatic assignment failed for %s: %v", conversation.ID, routeErr)
		}
	}
	return conversationCreated, bodyCreated, !bodyCreated && !attachmentCreated, nil
}

func isHistoricalEmailConversation(conversation Conversation) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(conversation.Classification)), historicalEmailClassification)
}

func isHistoricalEmailMessage(message Message) bool {
	return strings.EqualFold(strings.TrimSpace(message.Metadata[emailHistoricalImportKey]), "true")
}

func shouldImproveEmailCustomerName(current string, candidate string, email string) bool {
	current = strings.TrimSpace(current)
	candidate = strings.TrimSpace(candidate)
	if candidate == "" || strings.EqualFold(current, candidate) || emailLikeCustomerName(candidate, email) {
		return false
	}
	return current == "" || emailLikeCustomerName(current, email)
}

func emailLikeCustomerName(value string, email string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return true
	}
	if strings.Contains(value, "@") {
		return true
	}
	localPart := strings.SplitN(strings.TrimSpace(email), "@", 2)[0]
	if localPart == "" {
		return false
	}
	normalize := func(text string) string {
		text = strings.ToLower(strings.TrimSpace(text))
		return strings.NewReplacer(" ", "", ".", "", "_", "", "-", "").Replace(text)
	}
	return normalize(value) == normalize(localPart)
}

func storedEmailSourceMessageIDs(message Message) []string {
	values := []string{
		strings.TrimSpace(message.SourceMessageID),
		strings.TrimSpace(message.Metadata["mail_api_sent_message_id"]),
		strings.TrimSpace(message.Metadata[emailSyncedSourceMessageIDKey]),
	}
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	if normalizeMessageType(message.Type) == MessageTypeImage {
		for _, value := range []string{
			strings.TrimSpace(message.Metadata["mail_api_sent_message_id"]),
			strings.TrimSpace(message.Metadata[emailSyncedSourceMessageIDKey]),
		} {
			attachmentSourceID := value + ":attachment:0"
			if value != "" && !seen[attachmentSourceID] {
				seen[attachmentSourceID] = true
				out = append(out, attachmentSourceID)
			}
		}
	}
	return out
}

func (s *Server) reconcileSyncedAgentEmailMessage(ctx context.Context, source ShopSource, input incomingEmailMessage, existing []Message) (bool, error) {
	switch strings.ToLower(strings.TrimSpace(source.Provider)) {
	case "outlook":
		return s.reconcileSyncedOutlookAgentMessage(ctx, source, input, existing)
	case "gmail":
		return s.reconcileSyncedGmailAgentMessage(ctx, source, input, existing)
	default:
		return false, nil
	}
}

func (s *Server) addIncomingEmailAttachment(ctx context.Context, conversation Conversation, input incomingEmailMessage, attachment incomingEmailAttachment, index int) (Message, Conversation, error) {
	if len(attachment.Content) == 0 || len(attachment.Content) > maxEmailAttachmentSize {
		return Message{}, Conversation{}, fmt.Errorf("%w: email attachment must be between 1 byte and 25 MB", ErrInvalid)
	}
	originalName := filepath.Base(strings.TrimSpace(attachment.FileName))
	if originalName == "." {
		originalName = ""
	}
	if originalName == "" {
		originalName = fmt.Sprintf("email-attachment-%d", index+1)
		if extension, ok := chatImageExtensions[strings.ToLower(strings.TrimSpace(attachment.MIMEType))]; ok {
			originalName += extension
		}
	}
	mimeType := strings.ToLower(strings.TrimSpace(attachment.MIMEType))
	fileName, filePath, spec, err := s.saveEmailAttachment(attachment.Content, originalName, mimeType)
	if err != nil {
		return Message{}, Conversation{}, fmt.Errorf("email attachment ingest failed: %w", err)
	}
	sourceMessageID := input.SourceMessageID + ":attachment:" + strconv.Itoa(index)
	metadata := map[string]string{
		"url":                          "/api/v1/chat/attachments/" + fileName,
		"mimeType":                     spec.MIMEType,
		"fileName":                     originalName,
		"fileSize":                     strconv.Itoa(len(attachment.Content)),
		"email_attachment_stored_name": fileName,
	}
	if attachment.Inline {
		metadata["email_attachment_inline"] = "true"
	}
	metadata = mergeStringMaps(metadata, input.Metadata)
	direction := input.Direction
	if direction == "" {
		direction = MessageDirectionCustomer
	}
	messageType := MessageTypeFile
	if spec.Image {
		messageType = MessageTypeImage
	}
	message, updated, err := s.store.AddMessage(ctx, Message{
		ConversationID:  conversation.ID,
		Direction:       direction,
		Type:            messageType,
		Body:            originalName,
		SenderName:      firstNonEmpty(input.SenderName, input.CustomerName),
		SenderEmail:     firstNonEmpty(input.SenderEmail, input.CustomerEmail),
		SourceMessageID: sourceMessageID,
		CreatedAt:       input.ReceivedAt,
		Metadata:        metadata,
	})
	if err != nil {
		_ = os.Remove(filePath)
		return Message{}, Conversation{}, err
	}
	return message, updated, nil
}

func fetchProviderUnreadEmails(ctx context.Context, provider string, accessToken string, mailbox string) ([]incomingEmailMessage, error) {
	switch provider {
	case "gmail":
		return fetchGmailUnreadEmails(ctx, accessToken, mailbox)
	case "outlook":
		return fetchOutlookUnreadEmails(ctx, accessToken, mailbox)
	default:
		return nil, fmt.Errorf("%w: unsupported email provider %q", ErrInvalid, provider)
	}
}

func (s *Server) setEmailMessageReadState(ctx context.Context, shopID string, provider string, input emailReadStateRequest) error {
	provider = strings.ToLower(strings.TrimSpace(provider))
	messageID := strings.TrimSpace(input.MessageID)
	mailbox := normalizeEmail(input.Mailbox)
	if provider != "gmail" && provider != "outlook" && provider != cuiqiuProvider && provider != standardMailProvider {
		return fmt.Errorf("%w: unsupported email provider %q", ErrInvalid, provider)
	}
	if mailbox == "" || messageID == "" {
		return fmt.Errorf("%w: mailbox and messageId are required", ErrInvalid)
	}
	sources, err := s.store.ListShopSources(ctx, shopID)
	if err != nil {
		return err
	}
	activeSourceFound := false
	for _, source := range sources {
		if source.Type == SourceTypeEmail && source.Status == SourceStatusActive && normalizeEmail(source.Address) == mailbox && strings.EqualFold(strings.TrimSpace(source.Provider), provider) {
			activeSourceFound = true
			break
		}
	}
	if !activeSourceFound {
		return fmt.Errorf("%w: email read-state update failed: matching active email channel was not found", ErrInvalid)
	}
	installation, err := s.store.GetEmailInstallation(ctx, shopID, mailbox)
	if err != nil {
		return err
	}
	installation.Provider = provider
	installation, err = s.emailInstallationWithFreshToken(ctx, installation)
	if err != nil {
		return err
	}
	switch provider {
	case "gmail":
		if err := validateGmailGrantedScopes(installation.Scope); err != nil {
			return err
		}
		return setGmailMessageRead(ctx, installation.AccessToken, stripEmailMessagePrefix(messageID, "gmail"), input.Read)
	case "outlook":
		if err := validateOutlookGrantedScopes(installation.Scope); err != nil {
			return err
		}
		return setOutlookMessageRead(ctx, installation.AccessToken, stripEmailMessagePrefix(messageID, "outlook"), input.Read)
	case cuiqiuProvider:
		var source ShopSource
		for _, candidate := range sources {
			if candidate.Type == SourceTypeEmail && candidate.Status == SourceStatusActive && normalizeEmail(candidate.Address) == mailbox && strings.EqualFold(candidate.Provider, cuiqiuProvider) {
				source = candidate
				break
			}
		}
		config, err := cuiqiuConfigFrom(source, installation)
		if err != nil {
			return err
		}
		return setCuiqiuMessageRead(ctx, config, stripEmailMessagePrefix(messageID, cuiqiuProvider), input.Read)
	case standardMailProvider:
		var source ShopSource
		for _, candidate := range sources {
			if candidate.Type == SourceTypeEmail && candidate.Status == SourceStatusActive && normalizeEmail(candidate.Address) == mailbox && strings.EqualFold(candidate.Provider, standardMailProvider) {
				source = candidate
				break
			}
		}
		config, err := standardMailConfigFrom(source, installation)
		if err != nil {
			return err
		}
		return setStandardIMAPMessageRead(ctx, config, stripEmailMessagePrefix(messageID, standardMailProvider), input.Read)
	default:
		return fmt.Errorf("%w: unsupported email provider %q", ErrInvalid, provider)
	}
}

type gmailMessageRef struct {
	ID       string `json:"id"`
	ThreadID string `json:"threadId"`
}

type gmailListResponse struct {
	Messages      []gmailMessageRef `json:"messages"`
	NextPageToken string            `json:"nextPageToken"`
}

type platformGmailMessage struct {
	ID           string               `json:"id"`
	ThreadID     string               `json:"threadId"`
	LabelIDs     []string             `json:"labelIds"`
	Snippet      string               `json:"snippet"`
	InternalDate string               `json:"internalDate"`
	Payload      platformGmailPayload `json:"payload"`
}

type platformGmailThread struct {
	ID       string                 `json:"id"`
	Messages []platformGmailMessage `json:"messages"`
}

type platformGmailPayload struct {
	PartID   string                 `json:"partId"`
	MimeType string                 `json:"mimeType"`
	Filename string                 `json:"filename"`
	Headers  []platformGmailHeader  `json:"headers"`
	Body     platformGmailBody      `json:"body"`
	Parts    []platformGmailPayload `json:"parts"`
}

type platformGmailHeader struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type platformGmailBody struct {
	AttachmentID string `json:"attachmentId"`
	Data         string `json:"data"`
	Size         int    `json:"size"`
}

func fetchGmailUnreadEmails(ctx context.Context, accessToken string, mailboxes ...string) ([]incomingEmailMessage, error) {
	mailbox := ""
	if len(mailboxes) > 0 {
		mailbox = mailboxes[0]
	}
	return fetchGmailEmailsByQuery(ctx, accessToken, mailbox, "in:inbox is:unread newer_than:7d", 0)
}

func fetchGmailEmailsByQuery(ctx context.Context, accessToken string, mailbox string, query string, limit int) ([]incomingEmailMessage, error) {
	refs := make([]gmailMessageRef, 0)
	pageToken := ""
	seenPageTokens := map[string]bool{}
	anchorsProcessed := 0
	for {
		values := url.Values{}
		values.Set("q", strings.TrimSpace(query))
		values.Set("maxResults", "100")
		if pageToken != "" {
			values.Set("pageToken", pageToken)
		}
		listURL := gmailAPIBase() + "/users/me/messages?" + values.Encode()
		var listed gmailListResponse
		if err := getProviderJSON(ctx, accessToken, listURL, &listed); err != nil {
			return nil, err
		}
		for _, ref := range listed.Messages {
			if limit > 0 && anchorsProcessed >= limit {
				break
			}
			if strings.TrimSpace(ref.ID) == "" {
				continue
			}
			anchorsProcessed++
			refs = append(refs, ref)
		}
		if limit > 0 && anchorsProcessed >= limit {
			break
		}
		nextPageToken := strings.TrimSpace(listed.NextPageToken)
		if nextPageToken == "" {
			break
		}
		if seenPageTokens[nextPageToken] {
			return nil, fmt.Errorf("Gmail unread email sync failed: repeated nextPageToken")
		}
		seenPageTokens[nextPageToken] = true
		pageToken = nextPageToken
	}
	return expandGmailMessageRefs(ctx, accessToken, mailbox, refs)
}

func expandGmailMessageRefs(ctx context.Context, accessToken string, mailbox string, refs []gmailMessageRef, conversationExists ...emailConversationExists) ([]incomingEmailMessage, error) {
	return expandGmailMessageRefsWithOptions(ctx, accessToken, mailbox, refs, emailExpansionOptions{}, conversationExists...)
}

func expandGmailMessageRefsWithOptions(ctx context.Context, accessToken string, mailbox string, refs []gmailMessageRef, options emailExpansionOptions, conversationExists ...emailConversationExists) ([]incomingEmailMessage, error) {
	var out []incomingEmailMessage
	seenBackfilledThreads := map[string]bool{}
	for _, ref := range refs {
		if ref.ThreadID != "" && seenBackfilledThreads[ref.ThreadID] {
			continue
		}
		var message platformGmailMessage
		messageURL := gmailAPIBase() + "/users/me/messages/" + url.PathEscape(ref.ID) + "?format=full"
		if err := getProviderJSON(ctx, accessToken, messageURL, &message); err != nil {
			if isEmailProviderHTTPStatus(err, http.StatusNotFound) {
				continue
			}
			return nil, err
		}
		folderOrigin := gmailFolderOrigin(message.LabelIDs)
		if options.ReadOnlyHistorical && folderOrigin == "" {
			folderOrigin = "archive"
		}
		if mailbox != "" && folderOrigin == "" {
			continue
		}
		anchor := gmailIncomingEmail(message)
		if folderOrigin != "" {
			anchor.Metadata["email_folder_origin"] = folderOrigin
		}
		anchor.SenderName = anchor.CustomerName
		anchor.SenderEmail = anchor.CustomerEmail
		anchor.Direction = emailMessageDirection(mailbox, anchor.SenderEmail, message.LabelIDs)
		classification, reason := classifyIncomingEmail(anchor.SenderEmail, anchor.SenderName, anchor.Subject, anchor.Body)
		anchor.Classification = classification
		anchor.ClassificationReason = reason
		decision := applyIncomingEmailFilterDecision(&anchor)
		if decision.Filtered {
			out = append(out, anchor)
			continue
		}
		if options.ReadOnlyHistorical {
			anchor.Body = stripQuotedEmailHistoryForSubject(anchor.Body, anchor.Subject)
			out = append(out, anchor)
			continue
		}
		movedFromSpam := acceptedGmailSpamMessageID("gmail", anchor) != ""
		if movedFromSpam {
			if err := setGmailMessageNotSpam(ctx, accessToken, message.ID); err != nil {
				return nil, fmt.Errorf("Gmail customer spam recovery failed for %s: %w", message.ID, err)
			}
		}
		threadID := firstNonEmpty(message.ThreadID, ref.ThreadID, message.ID)
		exists, err := resolveEmailConversationExists(threadID, conversationExists)
		if err != nil {
			return nil, err
		}
		if (mailbox == "" || exists) && !movedFromSpam {
			anchor.Direction = emailMessageDirection(mailbox, anchor.SenderEmail, message.LabelIDs)
			anchor.Body = stripQuotedEmailHistoryForSubject(anchor.Body, anchor.Subject)
			out = append(out, anchor)
			continue
		}
		if seenBackfilledThreads[threadID] {
			continue
		}
		seenBackfilledThreads[threadID] = true
		thread := platformGmailThread{Messages: []platformGmailMessage{message}}
		threadURL := gmailAPIBase() + "/users/me/threads/" + url.PathEscape(threadID) + "?format=full"
		threadCtx, cancel := context.WithTimeout(ctx, emailThreadHistoryFetchTimeout)
		err = getProviderJSON(threadCtx, accessToken, threadURL, &thread)
		cancel()
		if err != nil {
			if movedFromSpam {
				return nil, fmt.Errorf("Gmail customer spam thread refresh failed for %s: %w", threadID, err)
			}
			out = append(out, anchor)
			continue
		}
		if len(thread.Messages) == 0 {
			out = append(out, anchor)
			continue
		}
		sort.SliceStable(thread.Messages, func(i, j int) bool {
			return gmailInternalDate(thread.Messages[i].InternalDate).Before(gmailInternalDate(thread.Messages[j].InternalDate))
		})
		if len(thread.Messages) > emailThreadBackfillLimit {
			thread.Messages = thread.Messages[len(thread.Messages)-emailThreadBackfillLimit:]
		}
		for _, threadMessage := range thread.Messages {
			if threadMessage.ID == message.ID && gmailFolderOrigin(threadMessage.LabelIDs) == "" {
				threadMessage.LabelIDs = message.LabelIDs
			}
			item := gmailIncomingEmail(threadMessage)
			item.CustomerName = anchor.CustomerName
			item.CustomerEmail = anchor.CustomerEmail
			item.SenderName, item.SenderEmail = parseMailAddress(gmailHeader(threadMessage.Payload.Headers, "From"))
			item.Direction = emailMessageDirection(mailbox, item.SenderEmail, threadMessage.LabelIDs)
			item.Classification = classification
			item.ClassificationReason = reason
			if decision.Review {
				item.Classification = ConversationKindSystem
				item.ClassificationReason = suspectedMarketingReviewClassification
			}
			if movedFromSpam && threadMessage.ID == message.ID {
				item.Metadata["email_folder_origin"] = "spam"
				item.Metadata["email_ingress_label"] = "垃圾邮件补漏"
			}
			item.Body = stripQuotedEmailHistoryForSubject(item.Body, item.Subject)
			if applyIncomingEmailFilterDecision(&item).Filtered {
				out = append(out, item)
				continue
			}
			out = append(out, item)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].ReceivedAt.Before(out[j].ReceivedAt) })
	return out, nil
}

type gmailAttachmentResponse struct {
	Data string `json:"data"`
}

func fetchGmailImageAttachments(ctx context.Context, accessToken string, messageID string, payload platformGmailPayload) ([]incomingEmailAttachment, error) {
	var out []incomingEmailAttachment
	if _, ok := chatImageExtensions[strings.ToLower(strings.TrimSpace(payload.MimeType))]; ok {
		content := decodeGmailBodyBytes(payload.Body.Data)
		if len(content) == 0 && payload.Body.AttachmentID != "" {
			var parsed gmailAttachmentResponse
			endpoint := gmailAPIBase() + "/users/me/messages/" + url.PathEscape(messageID) + "/attachments/" + url.PathEscape(payload.Body.AttachmentID)
			if err := getProviderJSON(ctx, accessToken, endpoint, &parsed); err != nil {
				return nil, err
			}
			content = decodeGmailBodyBytes(parsed.Data)
		}
		if len(content) > 0 {
			out = append(out, incomingEmailAttachment{FileName: payload.Filename, MIMEType: payload.MimeType, Content: content})
		}
	}
	for _, part := range payload.Parts {
		nested, err := fetchGmailImageAttachments(ctx, accessToken, messageID, part)
		if err != nil {
			return nil, err
		}
		out = append(out, nested...)
	}
	return out, nil
}

func fetchGmailAllAttachments(ctx context.Context, accessToken string, messageID string, payload platformGmailPayload) ([]incomingEmailAttachment, []string, error) {
	out := []incomingEmailAttachment{}
	warnings := []string{}
	var walk func(platformGmailPayload) error
	walk = func(part platformGmailPayload) error {
		fileName := strings.TrimSpace(part.Filename)
		disposition := strings.ToLower(gmailHeader(part.Headers, "Content-Disposition"))
		contentID := strings.TrimSpace(gmailHeader(part.Headers, "Content-ID"))
		isAttachment := fileName != "" || strings.Contains(disposition, "attachment") || strings.Contains(disposition, "inline") || contentID != ""
		if isAttachment && !strings.HasPrefix(strings.ToLower(part.MimeType), "multipart/") {
			if fileName == "" {
				fileName = "inline-" + firstNonEmpty(strings.TrimSpace(part.PartID), strconv.Itoa(len(out)+1))
				if extension, ok := chatImageExtensions[strings.ToLower(strings.TrimSpace(part.MimeType))]; ok {
					fileName += extension
				}
			}
			if part.Body.Size > maxEmailAttachmentSize {
				warnings = append(warnings, fmt.Sprintf("%s exceeds the 25 MB attachment limit", fileName))
			} else {
				content := decodeGmailBodyBytes(part.Body.Data)
				if len(content) == 0 && part.Body.AttachmentID != "" {
					var parsed gmailAttachmentResponse
					endpoint := gmailAPIBase() + "/users/me/messages/" + url.PathEscape(messageID) + "/attachments/" + url.PathEscape(part.Body.AttachmentID)
					if err := getProviderJSONWithLimit(ctx, accessToken, endpoint, &parsed, (maxEmailAttachmentSize*4/3)+(2<<20)); err != nil {
						if isEmailProviderHTTPStatus(err, http.StatusNotFound) || isEmailProviderHTTPStatus(err, http.StatusGone) {
							warnings = append(warnings, fileName+" no longer exists on the email provider")
							return nil
						}
						return err
					}
					content = decodeGmailBodyBytes(parsed.Data)
				}
				if len(content) == 0 {
					warnings = append(warnings, fileName+" did not contain downloadable data")
				} else if len(content) > maxEmailAttachmentSize {
					warnings = append(warnings, fmt.Sprintf("%s exceeds the 25 MB attachment limit", fileName))
				} else {
					out = append(out, incomingEmailAttachment{FileName: fileName, MIMEType: part.MimeType, Content: content, Inline: strings.Contains(disposition, "inline") || (contentID != "" && !strings.Contains(disposition, "attachment"))})
				}
			}
		}
		for _, nested := range part.Parts {
			if err := walk(nested); err != nil {
				return err
			}
		}
		return nil
	}
	if err := walk(payload); err != nil {
		return out, warnings, err
	}
	return out, warnings, nil
}

func gmailIncomingEmail(message platformGmailMessage) incomingEmailMessage {
	fromName, fromEmail := parseMailAddress(gmailHeader(message.Payload.Headers, "From"))
	replyToName, replyToEmail := parseMailAddress(gmailHeader(message.Payload.Headers, "Reply-To"))
	subject := gmailHeader(message.Payload.Headers, "Subject")
	messageID := gmailHeader(message.Payload.Headers, "Message-ID")
	references := gmailHeader(message.Payload.Headers, "References")
	if references == "" {
		references = gmailHeader(message.Payload.Headers, "In-Reply-To")
	}
	body := firstNonEmpty(gmailPayloadText(message.Payload), html.UnescapeString(message.Snippet), "(empty email)")
	receivedAt := gmailInternalDate(message.InternalDate)
	originalReceivedAt := firstNonEmpty(gmailHeader(message.Payload.Headers, "Date"), receivedAt.Format(time.RFC3339Nano))
	metadata := map[string]string{
		"gmail_message_id":           message.ID,
		"gmail_thread_id":            message.ThreadID,
		"mail_message_id":            messageID,
		"mail_references":            references,
		"email_received_at_original": originalReceivedAt,
	}
	if attachmentNames := gmailPayloadAttachmentNames(message.Payload); len(attachmentNames) > 0 {
		metadata["email_has_attachments"] = "true"
		metadata["email_attachment_names"] = strings.Join(attachmentNames, "\n")
	}
	if replyToEmail != "" {
		metadata["mail_reply_to_email"] = replyToEmail
		metadata["mail_reply_to_name"] = replyToName
	}
	if origin := gmailFolderOrigin(message.LabelIDs); origin != "" {
		metadata["email_folder_origin"] = origin
		if origin == "spam" {
			metadata["email_ingress_label"] = "垃圾邮件补漏"
		}
	}
	if noReplySenderPattern.MatchString(fromEmail) {
		metadata["email_no_reply_warning"] = "true"
	}
	return incomingEmailMessage{
		ExternalConversationID: message.ThreadID,
		CustomerName:           fromName,
		CustomerEmail:          fromEmail,
		ReplyToName:            replyToName,
		ReplyToEmail:           replyToEmail,
		Subject:                subject,
		Body:                   body,
		SourceMessageID:        "gmail:" + message.ID,
		ReceivedAt:             receivedAt,
		Metadata:               metadata,
	}
}

func gmailPayloadAttachmentNames(payload platformGmailPayload) []string {
	out := []string{}
	seen := map[string]bool{}
	var walk func(platformGmailPayload)
	walk = func(part platformGmailPayload) {
		name := strings.TrimSpace(part.Filename)
		key := strings.ToLower(name)
		if name != "" && !seen[key] {
			seen[key] = true
			out = append(out, name)
		}
		for _, nested := range part.Parts {
			walk(nested)
		}
	}
	walk(payload)
	return out
}

func gmailFolderOrigin(labels []string) string {
	for _, label := range labels {
		if strings.EqualFold(strings.TrimSpace(label), "SPAM") {
			return "spam"
		}
	}
	for _, label := range labels {
		if strings.EqualFold(strings.TrimSpace(label), "INBOX") {
			return "inbox"
		}
	}
	return ""
}

type outlookUnreadResponse struct {
	Value    []platformOutlookMessage `json:"value"`
	NextLink string                   `json:"@odata.nextLink"`
}

type platformOutlookMessage struct {
	ID                string `json:"id"`
	ConversationID    string `json:"conversationId"`
	InternetMessageID string `json:"internetMessageId"`
	Subject           string `json:"subject"`
	ReceivedDateTime  string `json:"receivedDateTime"`
	BodyPreview       string `json:"bodyPreview"`
	HasAttachments    bool   `json:"hasAttachments"`
	IsRead            bool   `json:"isRead"`
	ParentFolderID    string `json:"parentFolderId"`
	FolderOrigin      string `json:"-"`
	Body              struct {
		ContentType string `json:"contentType"`
		Content     string `json:"content"`
	} `json:"body"`
	From struct {
		EmailAddress struct {
			Name    string `json:"name"`
			Address string `json:"address"`
		} `json:"emailAddress"`
	} `json:"from"`
	ReplyTo []struct {
		EmailAddress struct {
			Name    string `json:"name"`
			Address string `json:"address"`
		} `json:"emailAddress"`
	} `json:"replyTo"`
}

const (
	outlookMessagePageSize    = "20"
	outlookAnchorSelect       = "id,conversationId,internetMessageId,subject,from,replyTo,receivedDateTime,bodyPreview,isRead,hasAttachments,parentFolderId"
	outlookFullMessageSelect  = "id,conversationId,internetMessageId,subject,from,replyTo,receivedDateTime,bodyPreview,body,isRead,hasAttachments,parentFolderId"
	emailProviderMaxJSONBytes = int64(16 << 20)
)

var errEmailProviderResponseTooLarge = errors.New("email provider JSON response is too large")

func fetchOutlookUnreadEmails(ctx context.Context, accessToken string, mailboxes ...string) ([]incomingEmailMessage, error) {
	mailbox := ""
	if len(mailboxes) > 0 {
		mailbox = mailboxes[0]
	}
	values := url.Values{}
	values.Set("$filter", "isRead eq false and receivedDateTime ge "+time.Now().UTC().Add(-7*24*time.Hour).Format(time.RFC3339))
	values.Set("$top", outlookMessagePageSize)
	values.Set("$select", outlookAnchorSelect)
	endpoint := outlookGraphBase() + "/me/mailFolders/inbox/messages?" + values.Encode()
	anchors, err := listOutlookMessages(ctx, accessToken, endpoint)
	if err != nil {
		return nil, err
	}
	return expandOutlookMessages(ctx, accessToken, mailbox, anchors, 0)
}

func expandOutlookMessages(ctx context.Context, accessToken string, mailbox string, anchors []platformOutlookMessage, limit int, conversationExists ...emailConversationExists) ([]incomingEmailMessage, error) {
	return expandOutlookMessagesWithOptions(ctx, accessToken, mailbox, anchors, limit, emailExpansionOptions{}, conversationExists...)
}

func expandOutlookMessagesWithOptions(ctx context.Context, accessToken string, mailbox string, anchors []platformOutlookMessage, limit int, options emailExpansionOptions, conversationExists ...emailConversationExists) ([]incomingEmailMessage, error) {
	var out []incomingEmailMessage
	seenBackfilledConversations := map[string]bool{}
	originByMessageID := make(map[string]string, len(anchors))
	for _, anchor := range anchors {
		if anchor.ID != "" && anchor.FolderOrigin != "" {
			originByMessageID[anchor.ID] = anchor.FolderOrigin
		}
	}
	anchorsProcessed := 0
	for _, message := range anchors {
		if limit > 0 && anchorsProcessed >= limit {
			break
		}
		if strings.TrimSpace(message.ID) == "" {
			continue
		}
		anchorsProcessed++
		anchor := outlookIncomingEmail(message)
		anchor.SenderName = anchor.CustomerName
		anchor.SenderEmail = anchor.CustomerEmail
		classification, reason := classifyIncomingEmail(anchor.SenderEmail, anchor.SenderName, anchor.Subject, anchor.Body)
		anchor.Classification = classification
		anchor.ClassificationReason = reason
		decision := applyIncomingEmailFilterDecision(&anchor)
		if decision.Filtered {
			out = append(out, anchor)
			continue
		}
		if options.ReadOnlyHistorical {
			fullMessage, fetchErr := fetchOutlookMessage(ctx, accessToken, message.ID)
			contentTruncated := false
			if fetchErr != nil {
				if !errors.Is(fetchErr, errEmailProviderResponseTooLarge) {
					return nil, fetchErr
				}
				fullMessage = message
				contentTruncated = true
			}
			fullMessage.FolderOrigin = message.FolderOrigin
			anchor = outlookIncomingEmail(fullMessage)
			anchor.SenderName = strings.TrimSpace(fullMessage.From.EmailAddress.Name)
			anchor.SenderEmail = normalizeEmail(fullMessage.From.EmailAddress.Address)
			anchor.Direction = emailMessageDirection(mailbox, anchor.SenderEmail, nil)
			anchor.Classification = classification
			anchor.ClassificationReason = reason
			anchor.Body = stripQuotedEmailHistoryForSubject(anchor.Body, anchor.Subject)
			if contentTruncated {
				anchor.Metadata["outlook_content_truncated"] = "true"
			}
			out = append(out, anchor)
			continue
		}
		movedFromJunk := false
		if strings.EqualFold(strings.TrimSpace(message.FolderOrigin), "junk") &&
			anchor.Classification == ConversationKindCustomer &&
			emailMessageDirection(mailbox, anchor.SenderEmail, nil) == MessageDirectionCustomer {
			moved, moveErr := moveOutlookMessageToInbox(ctx, accessToken, message.ID)
			if moveErr != nil {
				return nil, fmt.Errorf("Outlook customer junk recovery failed for %s: %w", message.ID, moveErr)
			}
			fullMoved, fetchErr := fetchOutlookMessage(ctx, accessToken, moved.ID)
			if fetchErr != nil {
				return nil, fmt.Errorf("Outlook customer junk refresh failed for %s: %w", moved.ID, fetchErr)
			}
			fullMoved.FolderOrigin = "junk"
			message = fullMoved
			anchor = outlookIncomingEmail(fullMoved)
			anchor.SenderName = strings.TrimSpace(fullMoved.From.EmailAddress.Name)
			anchor.SenderEmail = normalizeEmail(fullMoved.From.EmailAddress.Address)
			anchor.Direction = emailMessageDirection(mailbox, anchor.SenderEmail, nil)
			anchor.Classification = classification
			anchor.ClassificationReason = reason
			movedFromJunk = true
		}
		conversationID := firstNonEmpty(message.ConversationID, message.ID)
		exists, err := resolveEmailConversationExists(conversationID, conversationExists)
		if err != nil {
			return nil, err
		}
		if mailbox == "" || exists {
			fullMessage := message
			contentTruncated := false
			if mailbox != "" && !movedFromJunk {
				fullMessage, err = fetchOutlookMessage(ctx, accessToken, message.ID)
				if err != nil {
					if !errors.Is(err, errEmailProviderResponseTooLarge) {
						return nil, err
					}
					fullMessage = message
					contentTruncated = true
				}
				fullMessage.FolderOrigin = message.FolderOrigin
			}
			anchor = outlookIncomingEmail(fullMessage)
			anchor.SenderName = strings.TrimSpace(fullMessage.From.EmailAddress.Name)
			anchor.SenderEmail = normalizeEmail(fullMessage.From.EmailAddress.Address)
			anchor.Direction = emailMessageDirection(mailbox, anchor.SenderEmail, nil)
			anchor.Classification = classification
			anchor.ClassificationReason = reason
			anchor.Body = stripQuotedEmailHistoryForSubject(anchor.Body, anchor.Subject)
			if contentTruncated {
				anchor.Metadata["outlook_content_truncated"] = "true"
			}
			if applyIncomingEmailFilterDecision(&anchor).Filtered {
				out = append(out, anchor)
				continue
			}
			out = append(out, anchor)
			continue
		}
		if seenBackfilledConversations[conversationID] {
			continue
		}
		seenBackfilledConversations[conversationID] = true
		threadMessages, err := fetchOutlookThreadMessages(ctx, accessToken, conversationID)
		if err != nil {
			if isOutlookThreadBackfillRecoverable(err) {
				item, fallbackErr := fetchOutlookFallbackAnchorMessage(ctx, accessToken, mailbox, message, classification, reason)
				if fallbackErr != nil {
					if isEmailProviderHTTPStatus(fallbackErr, http.StatusNotFound) {
						continue
					}
					return nil, fmt.Errorf("Outlook thread history fallback failed for %s: %w", conversationID, fallbackErr)
				}
				out = append(out, item)
				continue
			}
			return nil, fmt.Errorf("Outlook thread history sync failed for %s: %w", conversationID, err)
		}
		if len(threadMessages) == 0 {
			return nil, fmt.Errorf("Outlook thread history sync failed for %s: provider returned no messages", conversationID)
		}
		for _, threadMessage := range threadMessages {
			threadMessage.FolderOrigin = originByMessageID[threadMessage.ID]
			if movedFromJunk && threadMessage.ID == message.ID {
				threadMessage.FolderOrigin = "junk"
			}
			item := outlookIncomingEmail(threadMessage)
			item.CustomerName = anchor.CustomerName
			item.CustomerEmail = anchor.CustomerEmail
			item.SenderName = strings.TrimSpace(threadMessage.From.EmailAddress.Name)
			item.SenderEmail = normalizeEmail(threadMessage.From.EmailAddress.Address)
			item.Direction = emailMessageDirection(mailbox, item.SenderEmail, nil)
			item.Classification = classification
			item.ClassificationReason = reason
			if decision.Review {
				item.Classification = ConversationKindSystem
				item.ClassificationReason = suspectedMarketingReviewClassification
			}
			item.Body = stripQuotedEmailHistoryForSubject(item.Body, item.Subject)
			if applyIncomingEmailFilterDecision(&item).Filtered {
				out = append(out, item)
				continue
			}
			out = append(out, item)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].ReceivedAt.Before(out[j].ReceivedAt) })
	return out, nil
}

func fetchOutlookThreadMessages(ctx context.Context, accessToken string, conversationID string) ([]platformOutlookMessage, error) {
	filter := "conversationId eq '" + strings.ReplaceAll(conversationID, "'", "''") + "'"
	values := url.Values{}
	values.Set("$filter", filter)
	values.Set("$top", outlookMessagePageSize)
	values.Set("$select", outlookFullMessageSelect)
	var page outlookUnreadResponse
	if err := getProviderJSON(ctx, accessToken, outlookGraphBase()+"/me/messages?"+values.Encode(), &page); err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	out := make([]platformOutlookMessage, 0, len(page.Value))
	for _, item := range page.Value {
		if item.ID == "" || seen[item.ID] {
			continue
		}
		seen[item.ID] = true
		out = append(out, item)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].ReceivedDateTime < out[j].ReceivedDateTime })
	return out, nil
}

func fetchOutlookFallbackAnchorMessage(ctx context.Context, accessToken string, mailbox string, message platformOutlookMessage, classification string, reason string) (incomingEmailMessage, error) {
	fullMessage := message
	contentTruncated := false
	if strings.TrimSpace(fullMessage.Body.Content) == "" {
		fetched, err := fetchOutlookMessage(ctx, accessToken, message.ID)
		if err != nil {
			if !errors.Is(err, errEmailProviderResponseTooLarge) {
				return incomingEmailMessage{}, err
			}
			contentTruncated = true
		} else {
			fullMessage = fetched
			fullMessage.FolderOrigin = message.FolderOrigin
		}
	}
	item := outlookIncomingEmail(fullMessage)
	item.SenderName = strings.TrimSpace(fullMessage.From.EmailAddress.Name)
	item.SenderEmail = normalizeEmail(fullMessage.From.EmailAddress.Address)
	item.Direction = emailMessageDirection(mailbox, item.SenderEmail, nil)
	item.Classification = classification
	item.ClassificationReason = reason
	item.Body = stripQuotedEmailHistoryForSubject(item.Body, item.Subject)
	if applyIncomingEmailFilterDecision(&item).Filtered {
		return item, nil
	}
	if contentTruncated {
		item.Metadata["outlook_content_truncated"] = "true"
	}
	return item, nil
}

func fetchOutlookMessage(ctx context.Context, accessToken string, messageID string) (platformOutlookMessage, error) {
	values := url.Values{}
	values.Set("$select", outlookFullMessageSelect)
	var message platformOutlookMessage
	endpoint := outlookGraphBase() + "/me/messages/" + url.PathEscape(messageID) + "?" + values.Encode()
	if err := getProviderJSON(ctx, accessToken, endpoint, &message); err != nil {
		return platformOutlookMessage{}, err
	}
	return message, nil
}

func moveOutlookMessageToInbox(ctx context.Context, accessToken string, messageID string) (platformOutlookMessage, error) {
	messageID = strings.TrimSpace(messageID)
	if messageID == "" {
		return platformOutlookMessage{}, fmt.Errorf("Outlook message move failed: empty message id")
	}
	payload, _ := json.Marshal(map[string]string{"destinationId": "inbox"})
	endpoint := outlookGraphBase() + "/me/messages/" + url.PathEscape(messageID) + "/move"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(string(payload)))
	if err != nil {
		return platformOutlookMessage{}, err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(accessToken))
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	resp, err := emailProviderHTTPClient.Do(req)
	if err != nil {
		return platformOutlookMessage{}, fmt.Errorf("Outlook message move failed: %w", err)
	}
	body, readErr := readEmailProviderResponseBody(resp.Body, emailProviderMaxJSONBytes)
	_ = resp.Body.Close()
	if readErr != nil {
		return platformOutlookMessage{}, readErr
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return platformOutlookMessage{}, &emailProviderHTTPError{StatusCode: resp.StatusCode, Status: resp.Status, Body: compactResponseBody(body), RetryAfter: resp.Header.Get("Retry-After")}
	}
	var moved platformOutlookMessage
	if err := json.Unmarshal(body, &moved); err != nil {
		return platformOutlookMessage{}, fmt.Errorf("Outlook message move returned invalid JSON: %w", err)
	}
	if strings.TrimSpace(moved.ID) == "" {
		return platformOutlookMessage{}, fmt.Errorf("Outlook message move returned no new message id")
	}
	return moved, nil
}

func resolveEmailConversationExists(externalConversationID string, callbacks []emailConversationExists) (bool, error) {
	if len(callbacks) == 0 || callbacks[0] == nil {
		return false, nil
	}
	return callbacks[0](externalConversationID)
}

func listOutlookMessages(ctx context.Context, accessToken string, endpoint string) ([]platformOutlookMessage, error) {
	out := make([]platformOutlookMessage, 0)
	seen := map[string]bool{}
	for endpoint != "" {
		if seen[endpoint] {
			return nil, fmt.Errorf("repeated @odata.nextLink")
		}
		seen[endpoint] = true
		var parsed outlookUnreadResponse
		if err := getProviderJSON(ctx, accessToken, endpoint, &parsed); err != nil {
			return nil, err
		}
		out = append(out, parsed.Value...)
		endpoint = strings.TrimSpace(parsed.NextLink)
	}
	return out, nil
}

type outlookAttachmentResponse struct {
	NextLink string `json:"@odata.nextLink"`
	Value    []struct {
		ODataType    string `json:"@odata.type"`
		ID           string `json:"id"`
		Name         string `json:"name"`
		ContentType  string `json:"contentType"`
		ContentBytes string `json:"contentBytes"`
		Size         int    `json:"size"`
		IsInline     bool   `json:"isInline"`
	} `json:"value"`
}

var outlookInlineImageCIDPattern = regexp.MustCompile(`(?is)<img\b[^>]*\bsrc\s*=\s*(?:"[^"]*cid:|'[^']*cid:|[^\s>]*cid:)`)

func outlookMessageMayHaveImageAttachments(message platformOutlookMessage) bool {
	return message.HasAttachments || outlookInlineImageCIDPattern.MatchString(message.Body.Content)
}

func fetchOutlookImageAttachments(ctx context.Context, accessToken string, messageID string) ([]incomingEmailAttachment, error) {
	// contentBytes belongs to fileAttachment, not the base attachment type.
	// Selecting it on the mixed attachment collection makes Microsoft Graph
	// reject the whole request before returning any attachments.
	endpoint := outlookGraphBase() + "/me/messages/" + url.PathEscape(messageID) + "/attachments"
	var parsed outlookAttachmentResponse
	if err := getProviderJSON(ctx, accessToken, endpoint, &parsed); err != nil {
		return nil, err
	}
	var out []incomingEmailAttachment
	for _, attachment := range parsed.Value {
		if _, ok := chatImageExtensions[strings.ToLower(strings.TrimSpace(attachment.ContentType))]; !ok {
			continue
		}
		raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(attachment.ContentBytes))
		if err != nil || len(raw) == 0 {
			continue
		}
		out = append(out, incomingEmailAttachment{FileName: attachment.Name, MIMEType: attachment.ContentType, Content: raw})
	}
	return out, nil
}

func fetchOutlookAllAttachments(ctx context.Context, accessToken string, messageID string) ([]incomingEmailAttachment, []string, error) {
	endpoint := outlookGraphBase() + "/me/messages/" + url.PathEscape(messageID) + "/attachments?%24top=1"
	out := []incomingEmailAttachment{}
	warnings := []string{}
	seenPages := map[string]bool{}
	for page := 0; endpoint != "" && page < 1000; page++ {
		if seenPages[endpoint] {
			return out, warnings, fmt.Errorf("Outlook attachment pagination repeated the same page")
		}
		seenPages[endpoint] = true
		var parsed outlookAttachmentResponse
		if err := getProviderJSONWithLimit(ctx, accessToken, endpoint, &parsed, (maxEmailAttachmentSize*4/3)+(4<<20)); err != nil {
			return out, warnings, err
		}
		for _, attachment := range parsed.Value {
			name := firstNonEmpty(strings.TrimSpace(attachment.Name), fmt.Sprintf("attachment-%d", len(out)+len(warnings)+1))
			if attachment.Size > maxEmailAttachmentSize {
				warnings = append(warnings, fmt.Sprintf("%s exceeds the 25 MB attachment limit", name))
				continue
			}
			raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(attachment.ContentBytes))
			if err != nil || len(raw) == 0 {
				warnings = append(warnings, name+" did not contain downloadable file data")
				continue
			}
			if len(raw) > maxEmailAttachmentSize {
				warnings = append(warnings, fmt.Sprintf("%s exceeds the 25 MB attachment limit", name))
				continue
			}
			out = append(out, incomingEmailAttachment{FileName: name, MIMEType: attachment.ContentType, Content: raw, Inline: attachment.IsInline})
		}
		endpoint = strings.TrimSpace(parsed.NextLink)
	}
	if endpoint != "" {
		return out, warnings, fmt.Errorf("Outlook attachment count exceeded the safety limit")
	}
	return out, warnings, nil
}

func outlookIncomingEmail(message platformOutlookMessage) incomingEmailMessage {
	body := firstNonEmpty(htmlToPlainText(message.Body.Content), message.BodyPreview, "(empty email)")
	receivedAt, _ := time.Parse(time.RFC3339, message.ReceivedDateTime)
	if receivedAt.IsZero() {
		receivedAt = time.Now().UTC()
	}
	replyToName := ""
	replyToEmail := ""
	if len(message.ReplyTo) > 0 {
		replyToName = strings.TrimSpace(message.ReplyTo[0].EmailAddress.Name)
		replyToEmail = normalizeEmail(message.ReplyTo[0].EmailAddress.Address)
	}
	metadata := map[string]string{
		"outlook_message_id":          message.ID,
		"outlook_conversation_id":     message.ConversationID,
		"outlook_internet_message_id": message.InternetMessageID,
		"mail_message_id":             message.InternetMessageID,
		"email_received_at_original":  strings.TrimSpace(message.ReceivedDateTime),
	}
	// Microsoft Graph reports hasAttachments=false for inline-only files. A CID
	// reference in the HTML body is therefore also enough to schedule the
	// background attachment archive.
	if outlookMessageMayHaveImageAttachments(message) {
		metadata["email_has_attachments"] = "true"
	}
	if replyToEmail != "" {
		metadata["mail_reply_to_email"] = replyToEmail
		metadata["mail_reply_to_name"] = replyToName
	}
	if origin := strings.ToLower(strings.TrimSpace(message.FolderOrigin)); origin != "" {
		metadata["email_folder_origin"] = origin
		if origin == "junk" {
			metadata["email_ingress_label"] = "垃圾邮件补漏"
		}
	}
	fromEmail := normalizeEmail(message.From.EmailAddress.Address)
	if noReplySenderPattern.MatchString(fromEmail) {
		metadata["email_no_reply_warning"] = "true"
	}
	return incomingEmailMessage{
		ExternalConversationID: message.ConversationID,
		CustomerName:           strings.TrimSpace(message.From.EmailAddress.Name),
		CustomerEmail:          fromEmail,
		ReplyToName:            replyToName,
		ReplyToEmail:           replyToEmail,
		Subject:                message.Subject,
		Body:                   body,
		SourceMessageID:        "outlook:" + message.ID,
		ReceivedAt:             receivedAt,
		Metadata:               metadata,
	}
}

var emailProviderHTTPClient = &http.Client{Timeout: 20 * time.Second}

type emailProviderHTTPError struct {
	StatusCode int
	Status     string
	Body       string
	RetryAfter string
}

func (e *emailProviderHTTPError) Error() string {
	return "email provider request failed: " + strings.TrimSpace(e.Status+" "+e.Body)
}

func isEmailProviderHTTPStatus(err error, statusCode int) bool {
	var providerErr *emailProviderHTTPError
	return errors.As(err, &providerErr) && providerErr.StatusCode == statusCode
}

func isOutlookThreadBackfillRecoverable(err error) bool {
	if errors.Is(err, errEmailProviderResponseTooLarge) {
		return true
	}
	var providerErr *emailProviderHTTPError
	if !errors.As(err, &providerErr) {
		return false
	}
	if providerErr.StatusCode == http.StatusNotFound {
		return true
	}
	body := strings.ToLower(providerErr.Body)
	return providerErr.StatusCode == http.StatusBadRequest && strings.Contains(body, "inefficientfilter")
}

func getProviderJSON(ctx context.Context, accessToken string, endpoint string, target any) error {
	return getProviderJSONWithLimit(ctx, accessToken, endpoint, target, emailProviderMaxJSONBytes)
}

func getProviderJSONWithLimit(ctx context.Context, accessToken string, endpoint string, target any, maxBytes int64) error {
	for attempt := 0; attempt < 3; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(accessToken))
		req.Header.Set("Accept", "application/json")
		resp, err := emailProviderHTTPClient.Do(req)
		if err != nil {
			if attempt < 2 {
				if waitErr := waitEmailProviderRetry(ctx, time.Duration(attempt+1)*200*time.Millisecond); waitErr != nil {
					return waitErr
				}
				continue
			}
			return err
		}
		body, readErr := readEmailProviderResponseBody(resp.Body, maxBytes)
		_ = resp.Body.Close()
		if readErr != nil {
			if errors.Is(readErr, errEmailProviderResponseTooLarge) {
				return readErr
			}
			if attempt < 2 {
				if waitErr := waitEmailProviderRetry(ctx, time.Duration(attempt+1)*200*time.Millisecond); waitErr != nil {
					return waitErr
				}
				continue
			}
			return readErr
		}
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			var decodeErr error
			if strings.TrimSpace(string(body)) == "" {
				decodeErr = fmt.Errorf("email provider returned an empty JSON response")
			} else if err := json.Unmarshal(body, target); err != nil {
				decodeErr = fmt.Errorf("email provider returned invalid JSON: %w", err)
			}
			if decodeErr == nil {
				return nil
			}
			if attempt < 2 {
				if waitErr := waitEmailProviderRetry(ctx, time.Duration(attempt+1)*200*time.Millisecond); waitErr != nil {
					return waitErr
				}
				continue
			}
			return decodeErr
		}
		providerErr := &emailProviderHTTPError{StatusCode: resp.StatusCode, Status: resp.Status, Body: compactResponseBody(body), RetryAfter: resp.Header.Get("Retry-After")}
		if attempt < 2 && (resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500) {
			delay := emailProviderRetryDelay(resp.Header.Get("Retry-After"), attempt)
			if delay > 2*time.Second {
				return providerErr
			}
			if waitErr := waitEmailProviderRetry(ctx, delay); waitErr != nil {
				return waitErr
			}
			continue
		}
		return providerErr
	}
	return fmt.Errorf("email provider read failed after retries")
}

func readEmailProviderResponseBody(reader io.Reader, maxBytes int64) ([]byte, error) {
	if maxBytes <= 0 {
		return nil, fmt.Errorf("email provider response limit must be positive")
	}
	body, err := io.ReadAll(io.LimitReader(reader, maxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("email provider response read failed: %w", err)
	}
	if int64(len(body)) > maxBytes {
		return nil, fmt.Errorf("%w: exceeded the %d MiB safety limit", errEmailProviderResponseTooLarge, maxBytes>>20)
	}
	return body, nil
}

func emailProviderRetryDelay(retryAfter string, attempt int) time.Duration {
	delay := time.Duration(attempt+1) * 300 * time.Millisecond
	if seconds, err := strconv.Atoi(strings.TrimSpace(retryAfter)); err == nil && seconds > 0 {
		delay = time.Duration(seconds) * time.Second
	} else if when, err := http.ParseTime(strings.TrimSpace(retryAfter)); err == nil {
		delay = time.Until(when)
	}
	if delay < 0 {
		return 0
	}
	return delay
}

func waitEmailProviderRetry(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func gmailHeader(headers []platformGmailHeader, name string) string {
	for _, header := range headers {
		if strings.EqualFold(strings.TrimSpace(header.Name), name) {
			return strings.TrimSpace(header.Value)
		}
	}
	return ""
}

func gmailPayloadText(payload platformGmailPayload) string {
	if strings.HasPrefix(strings.ToLower(payload.MimeType), "text/plain") {
		if decoded := decodeGmailBody(payload.Body.Data); decoded != "" {
			return decoded
		}
	}
	for _, part := range payload.Parts {
		if text := gmailPayloadText(part); text != "" {
			return text
		}
	}
	if strings.HasPrefix(strings.ToLower(payload.MimeType), "text/html") {
		return htmlToPlainText(decodeGmailBody(payload.Body.Data))
	}
	return ""
}

func decodeGmailBody(data string) string {
	return strings.TrimSpace(string(decodeGmailBodyBytes(data)))
}

func decodeGmailBodyBytes(data string) []byte {
	data = strings.TrimSpace(data)
	if data == "" {
		return nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(data)
	if err != nil {
		raw, err = base64.URLEncoding.DecodeString(data)
	}
	if err != nil {
		return nil
	}
	return raw
}

func gmailInternalDate(value string) time.Time {
	millis, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	if err != nil || millis <= 0 {
		return time.Now().UTC()
	}
	return time.UnixMilli(millis).UTC()
}

func parseMailAddress(value string) (string, string) {
	parsed, err := mail.ParseAddress(strings.TrimSpace(value))
	if err != nil {
		return "", normalizeEmail(value)
	}
	return strings.TrimSpace(parsed.Name), normalizeEmail(parsed.Address)
}

var (
	htmlQuotedHistoryPattern = regexp.MustCompile(`(?is)<blockquote\b[^>]*>|<div\b[^>]*(?:\bid\s*=\s*["']?divRplyFwdMsg|\bclass\s*=\s*["'][^"']*(?:gmail_quote|yahoo_quoted|protonmail_quote)[^"']*["'])[^>]*>`)
	htmlNonContentPattern    = regexp.MustCompile(`(?is)<(?:style|script|noscript)\b[^>]*>.*?</(?:style|script|noscript)\s*>`)
	htmlBreakPattern         = regexp.MustCompile(`(?i)<\s*br\s*/?\s*>|</\s*(?:p|div|li|tr|h[1-6]|blockquote)\s*>`)
	htmlTagPattern           = regexp.MustCompile(`<[^>]+>`)
)

func htmlToPlainText(value string) string {
	value = htmlNonContentPattern.ReplaceAllString(value, " ")
	value = htmlQuotedHistoryPattern.ReplaceAllString(value, "\n-----quoted message-----\n")
	value = htmlBreakPattern.ReplaceAllString(value, "\n")
	value = htmlTagPattern.ReplaceAllString(value, " ")
	value = html.UnescapeString(value)
	value = strings.ReplaceAll(value, "\r\n", "\n")
	lines := strings.Split(value, "\n")
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.Join(strings.Fields(line), " ")
		if line == "" {
			if len(out) > 0 && out[len(out)-1] != "" {
				out = append(out, "")
			}
			continue
		}
		out = append(out, line)
	}
	return strings.TrimSpace(strings.Join(out, "\n"))
}
