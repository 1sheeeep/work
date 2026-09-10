package platform

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type emailQuarantinePayload struct {
	Kind        string                `json:"kind"`
	Message     *incomingEmailMessage `json:"message,omitempty"`
	RawRFC822   string                `json:"rawRfc822,omitempty"`
	Mailbox     string                `json:"mailbox,omitempty"`
	UIDValidity uint32                `json:"uidValidity,omitempty"`
	UID         uint32                `json:"uid,omitempty"`
}

type emailQuarantineCandidate struct {
	SourceMessageID string
	Stage           string
	ErrorMessage    string
	Payload         emailQuarantinePayload
}

func incomingEmailQuarantineCandidate(message incomingEmailMessage, stage string, ingestErr error) (emailQuarantineCandidate, error) {
	if strings.TrimSpace(message.SourceMessageID) == "" || ingestErr == nil {
		return emailQuarantineCandidate{}, fmt.Errorf("%w: quarantine message identity and error are required", ErrInvalid)
	}
	copyMessage := message
	return emailQuarantineCandidate{
		SourceMessageID: message.SourceMessageID,
		Stage:           stage,
		ErrorMessage:    ingestErr.Error(),
		Payload:         emailQuarantinePayload{Kind: "incoming", Message: &copyMessage},
	}, nil
}

func standardIMAPQuarantineCandidate(mailbox string, uidValidity uint32, uid uint32, stage string, parseErr error, raw []byte) emailQuarantineCandidate {
	payload := emailQuarantinePayload{Kind: "standard_imap_rfc822", Mailbox: normalizeEmail(mailbox), UIDValidity: uidValidity, UID: uid}
	if len(raw) > 0 && len(raw) <= standardMailMaxMessageSize {
		payload.RawRFC822 = base64.StdEncoding.EncodeToString(raw)
	}
	return emailQuarantineCandidate{
		SourceMessageID: fmt.Sprintf("%s:%d:%d", standardMailProvider, uidValidity, uid),
		Stage:           stage,
		ErrorMessage:    parseErr.Error(),
		Payload:         payload,
	}
}

func (s *Server) saveEmailQuarantineCandidate(ctx context.Context, source ShopSource, candidate emailQuarantineCandidate) (EmailQuarantineRecord, error) {
	store, ok := s.store.(emailQuarantineStore)
	if !ok {
		return EmailQuarantineRecord{}, fmt.Errorf("email quarantine storage is unavailable")
	}
	payload, err := json.Marshal(candidate.Payload)
	if err != nil {
		return EmailQuarantineRecord{}, err
	}
	return store.SaveEmailQuarantine(ctx, EmailQuarantineRecord{
		ShopID: source.ShopID, SourceID: source.ID, Provider: source.Provider,
		SourceMessageID: candidate.SourceMessageID, Stage: candidate.Stage,
		ErrorMessage: candidate.ErrorMessage, Payload: string(payload),
	})
}

func recordEmailQuarantineMetadata(metadata map[string]string, source ShopSource, count int, lastError string) map[string]string {
	if count <= 0 {
		return metadata
	}
	if metadata == nil {
		metadata = map[string]string{}
	}
	previousRaw := source.Metadata["email_quarantine_count"]
	if strings.TrimSpace(metadata["email_quarantine_count"]) != "" {
		previousRaw = metadata["email_quarantine_count"]
	}
	previous, _ := parseNonNegativeInt(previousRaw)
	metadata["email_quarantine_count"] = fmt.Sprintf("%d", previous+count)
	pendingRaw := source.Metadata["email_quarantine_pending_count"]
	if strings.TrimSpace(metadata["email_quarantine_pending_count"]) != "" {
		pendingRaw = metadata["email_quarantine_pending_count"]
	}
	pending, _ := parseNonNegativeInt(pendingRaw)
	metadata["email_quarantine_pending_count"] = fmt.Sprintf("%d", pending+count)
	metadata["email_quarantine_last_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	metadata["email_quarantine_last_error"] = truncateEmailPreview(lastError, 300)
	return metadata
}

type emailQuarantineRetryResult struct {
	Examined  int      `json:"examined"`
	Resolved  int      `json:"resolved"`
	Remaining int      `json:"remaining"`
	Errors    []string `json:"errors,omitempty"`
}

func (s *Server) retryEmailQuarantine(ctx context.Context, shopID string, sourceID string) (emailQuarantineRetryResult, error) {
	store, ok := s.store.(emailQuarantineStore)
	if !ok {
		return emailQuarantineRetryResult{}, fmt.Errorf("email quarantine storage is unavailable")
	}
	lock := s.emailSourceSyncLock(sourceID)
	lock.Lock()
	defer lock.Unlock()
	source, err := s.store.GetShopSource(ctx, strings.TrimSpace(shopID), strings.TrimSpace(sourceID))
	if err != nil {
		return emailQuarantineRetryResult{}, err
	}
	records, err := store.ListEmailQuarantine(ctx, source.ID, "quarantined", 25)
	if err != nil {
		return emailQuarantineRetryResult{}, err
	}
	result := emailQuarantineRetryResult{Examined: len(records)}
	states := map[string]*emailConversationIngestState{}
	for _, record := range records {
		var payload emailQuarantinePayload
		if err := json.Unmarshal([]byte(record.Payload), &payload); err != nil {
			result.Errors = append(result.Errors, record.SourceMessageID+": stored payload is invalid")
			continue
		}
		var message incomingEmailMessage
		switch payload.Kind {
		case "incoming":
			if payload.Message == nil {
				result.Errors = append(result.Errors, record.SourceMessageID+": stored message is unavailable")
				continue
			}
			message = *payload.Message
		case "standard_imap_rfc822":
			if payload.RawRFC822 == "" {
				result.Errors = append(result.Errors, record.SourceMessageID+": original message cannot be retried automatically")
				continue
			}
			raw, decodeErr := base64.StdEncoding.DecodeString(payload.RawRFC822)
			if decodeErr != nil {
				result.Errors = append(result.Errors, record.SourceMessageID+": stored RFC822 data is invalid")
				continue
			}
			message, err = parseStandardMailMessage(payload.Mailbox, payload.UIDValidity, payload.UID, time.Now().UTC(), nil, raw)
			if err != nil {
				result.Errors = append(result.Errors, record.SourceMessageID+": "+truncateEmailPreview(err.Error(), 160))
				continue
			}
		default:
			result.Errors = append(result.Errors, record.SourceMessageID+": unsupported quarantine payload")
			continue
		}
		conversationID := stableExternalConversationID(source.ID, message.ExternalConversationID)
		state := states[conversationID]
		if state == nil {
			state = &emailConversationIngestState{}
			states[conversationID] = state
		}
		_, _, _, ingestErr := s.ingestProviderEmailWithStateAndOptions(ctx, source.ShopID, source, message, state, emailIngestOptions{Historical: strings.HasPrefix(record.Stage, "history_")})
		if ingestErr != nil {
			candidate, _ := incomingEmailQuarantineCandidate(message, record.Stage, ingestErr)
			_, _ = s.saveEmailQuarantineCandidate(ctx, source, candidate)
			result.Errors = append(result.Errors, record.SourceMessageID+": "+truncateEmailPreview(ingestErr.Error(), 160))
			continue
		}
		if err := store.ResolveEmailQuarantine(ctx, record.ID); err != nil {
			result.Errors = append(result.Errors, record.SourceMessageID+": resolve state failed")
			continue
		}
		result.Resolved++
	}
	remaining, countErr := store.CountEmailQuarantine(ctx, source.ID, "quarantined")
	if countErr == nil {
		result.Remaining = remaining
	}
	_, _ = s.store.MutateShopSourceMetadata(context.WithoutCancel(ctx), source.ShopID, source.ID, func(metadata map[string]string) map[string]string {
		metadata["email_quarantine_pending_count"] = fmt.Sprintf("%d", result.Remaining)
		if result.Remaining == 0 {
			delete(metadata, "email_quarantine_last_error")
		}
		return metadata
	})
	return result, nil
}
