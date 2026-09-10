package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	emailHistoryQueued    = "queued"
	emailHistoryRunning   = "running"
	emailHistoryPaused    = "paused"
	emailHistoryCompleted = "completed"
	emailHistoryFailed    = "failed"
	emailHistoryCancelled = "cancelled"
	emailHistoryPageSize  = "25"
	emailHistoryPageDelay = 30 * time.Second
)

type emailHistoryActionRequest struct {
	Action string `json:"action"`
}

type emailHistoryPage struct {
	Messages    []incomingEmailMessage
	Quarantined []emailQuarantineCandidate
	Scanned     int
	NextCursor  string
	Done        bool
}

type outlookHistoryCursor struct {
	NextLink  string            `json:"nextLink,omitempty"`
	FolderIDs map[string]string `json:"folderIds,omitempty"`
}

type outlookMailFolder struct {
	ID string `json:"id"`
}

func (s *Server) handleEmailHistoryImportList(w http.ResponseWriter, r *http.Request, user User, shopID string) {
	if !s.requireModuleShopAccess(w, r, user, DataScopeShops, shopID) {
		return
	}
	if !userHasPermission(user, PermissionShopChannelsManage) {
		writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "shop channel management permission is required"})
		return
	}
	jobs, err := s.store.ListEmailHistoryImportJobs(r.Context(), shopID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSONResponse(w, http.StatusOK, nonNilSlice(jobs))
}

func (s *Server) handleEmailHistoryImportAction(w http.ResponseWriter, r *http.Request, user User, shopID string, sourceID string) {
	if !s.requireModuleShopAccess(w, r, user, DataScopeShops, shopID) {
		return
	}
	if !userHasPermission(user, PermissionShopChannelsManage) {
		writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "shop channel management permission is required"})
		return
	}
	var input emailHistoryActionRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	lock := s.emailHistoryLock(sourceID)
	lock.Lock()
	defer lock.Unlock()
	job, err := s.changeEmailHistoryImport(r.Context(), shopID, sourceID, input.Action)
	if err != nil {
		writeError(w, err)
		return
	}
	s.broadcast(Event{Type: "email_history_import.updated", ShopID: shopID, EntityID: sourceID, Payload: job, CreatedAt: time.Now().UTC()})
	s.notifyEmailHistoryScheduler()
	writeJSONResponse(w, http.StatusOK, job)
}

func (s *Server) notifyEmailHistoryScheduler() {
	select {
	case s.emailHistoryWake <- struct{}{}:
	default:
	}
}

func (s *Server) changeEmailHistoryImport(ctx context.Context, shopID string, sourceID string, action string) (EmailHistoryImportJob, error) {
	source, err := s.store.GetShopSource(ctx, shopID, sourceID)
	if err != nil {
		return EmailHistoryImportJob{}, err
	}
	provider := strings.ToLower(strings.TrimSpace(source.Provider))
	if source.Type != SourceTypeEmail || source.Status != SourceStatusActive || (provider != "gmail" && provider != "outlook" && provider != cuiqiuProvider && provider != standardMailProvider) {
		return EmailHistoryImportJob{}, fmt.Errorf("%w: an active supported email channel is required", ErrInvalid)
	}
	if _, err := s.store.GetEmailInstallation(ctx, shopID, source.Address); err != nil {
		return EmailHistoryImportJob{}, fmt.Errorf("%w: mailbox authorization is unavailable", ErrInvalid)
	}
	existing, getErr := s.store.GetEmailHistoryImportJob(ctx, shopID, sourceID)
	action = strings.ToLower(strings.TrimSpace(action))
	switch action {
	case "start":
		if getErr == nil && (existing.Status == emailHistoryQueued || existing.Status == emailHistoryRunning) {
			return EmailHistoryImportJob{}, fmt.Errorf("%w: full email history import is already running", ErrConflict)
		}
		now := time.Now().UTC()
		return s.store.SaveEmailHistoryImportJob(ctx, EmailHistoryImportJob{
			ID: prefixedID("email_history"), ShopID: shopID, SourceID: sourceID, Provider: provider,
			Mailbox: source.Address, Status: emailHistoryQueued, CreatedAt: now,
		})
	case "pause":
		if getErr != nil || (existing.Status != emailHistoryQueued && existing.Status != emailHistoryRunning) {
			return EmailHistoryImportJob{}, fmt.Errorf("%w: only a running history import can be paused", ErrConflict)
		}
		existing.Status = emailHistoryPaused
		existing.LastError = ""
		return s.store.SaveEmailHistoryImportJob(ctx, existing)
	case "resume":
		if getErr != nil || existing.Status != emailHistoryPaused {
			return EmailHistoryImportJob{}, fmt.Errorf("%w: only a paused history import can be resumed", ErrConflict)
		}
		existing.Status = emailHistoryQueued
		existing.LastError = ""
		return s.store.SaveEmailHistoryImportJob(ctx, existing)
	case "retry":
		if getErr != nil || existing.Status != emailHistoryFailed {
			return EmailHistoryImportJob{}, fmt.Errorf("%w: only a failed history import can be retried", ErrConflict)
		}
		existing.Status = emailHistoryQueued
		existing.LastError = ""
		return s.store.SaveEmailHistoryImportJob(ctx, existing)
	case "cancel":
		if getErr != nil || (existing.Status != emailHistoryQueued && existing.Status != emailHistoryRunning && existing.Status != emailHistoryPaused && existing.Status != emailHistoryFailed) {
			return EmailHistoryImportJob{}, fmt.Errorf("%w: history import cannot be cancelled from its current status", ErrConflict)
		}
		existing.Status = emailHistoryCancelled
		existing.CompletedAt = time.Now().UTC()
		existing.LastError = ""
		return s.store.SaveEmailHistoryImportJob(ctx, existing)
	default:
		return EmailHistoryImportJob{}, fmt.Errorf("%w: action must be start, pause, resume, retry, or cancel", ErrInvalid)
	}
}

func (s *Server) StartEmailHistoryImports(ctx context.Context) {
	go func() {
		for {
			retryDelay := time.Duration(0)
			if err := s.scheduleEmailHistoryImports(ctx); err != nil {
				if ctx.Err() == nil {
					log.Printf("email history import: list jobs failed: %v", err)
				}
				retryDelay = 30 * time.Second
			}
			var retry <-chan time.Time
			var timer *time.Timer
			if retryDelay > 0 {
				timer = time.NewTimer(retryDelay)
				retry = timer.C
			}
			select {
			case <-ctx.Done():
				if timer != nil && !timer.Stop() {
					select {
					case <-timer.C:
					default:
					}
				}
				return
			case <-s.emailHistoryWake:
				if timer != nil && !timer.Stop() {
					select {
					case <-timer.C:
					default:
					}
				}
			case <-retry:
			}
		}
	}()
}

func (s *Server) scheduleEmailHistoryImports(ctx context.Context) error {
	jobs, err := s.store.ListEmailHistoryImportJobs(ctx, "")
	if err != nil {
		return err
	}
	for _, job := range jobs {
		if job.Status != emailHistoryQueued && job.Status != emailHistoryRunning {
			continue
		}
		s.emailHistoryRunMu.Lock()
		if s.emailHistoryRunning[job.SourceID] {
			s.emailHistoryRunMu.Unlock()
			continue
		}
		s.emailHistoryRunning[job.SourceID] = true
		s.emailHistoryRunMu.Unlock()
		go func(job EmailHistoryImportJob) {
			defer func() {
				s.emailHistoryRunMu.Lock()
				delete(s.emailHistoryRunning, job.SourceID)
				s.emailHistoryRunMu.Unlock()
			}()
			select {
			case s.emailHistoryLimit <- struct{}{}:
				defer func() { <-s.emailHistoryLimit }()
			case <-ctx.Done():
				return
			}
			s.processEmailHistoryImportPage(ctx, job.SourceID)
			// Full-history imports are low priority. Keep the global worker occupied
			// during the cooldown so another mailbox cannot start immediately after
			// this page releases its live-sync lock.
			timer := time.NewTimer(emailHistoryPageDelay)
			defer timer.Stop()
			select {
			case <-ctx.Done():
			case <-timer.C:
			}
			s.notifyEmailHistoryScheduler()
		}(job)
	}
	return nil
}

func (s *Server) processEmailHistoryImportPage(parent context.Context, sourceID string) {
	historyLock := s.emailHistoryLock(sourceID)
	historyLock.Lock()
	job, err := s.store.GetEmailHistoryImportJob(parent, "", sourceID)
	if err != nil || (job.Status != emailHistoryQueued && job.Status != emailHistoryRunning) {
		historyLock.Unlock()
		return
	}
	ctx, cancel := context.WithTimeout(parent, 3*time.Minute)
	defer cancel()
	job.Status = emailHistoryRunning
	if job.StartedAt.IsZero() {
		job.StartedAt = time.Now().UTC()
	}
	job.LastError = ""
	if job, err = s.store.SaveEmailHistoryImportJob(ctx, job); err != nil {
		historyLock.Unlock()
		return
	}
	historyLock.Unlock()
	sourceLock := s.emailSourceSyncLock(sourceID)
	sourceLock.Lock()
	defer sourceLock.Unlock()
	source, err := s.store.GetShopSource(ctx, job.ShopID, job.SourceID)
	if err != nil || source.Status != SourceStatusActive || source.Type != SourceTypeEmail {
		s.failEmailHistoryImport(parent, job, fmt.Errorf("email channel is no longer active"))
		return
	}
	installation, err := s.store.GetEmailInstallation(ctx, job.ShopID, source.Address)
	if err == nil {
		installation.Provider = job.Provider
		installation, err = s.emailInstallationWithFreshToken(ctx, installation)
	}
	if err != nil {
		s.failEmailHistoryImport(parent, job, fmt.Errorf("mailbox authorization failed: %w", err))
		return
	}
	page, err := fetchEmailHistoryPage(ctx, job, source, installation)
	if err != nil {
		if job.Cursor != "" && (isEmailProviderHTTPStatus(err, http.StatusBadRequest) || isEmailProviderHTTPStatus(err, http.StatusGone)) {
			s.resetExpiredEmailHistoryCursor(parent, job)
			return
		}
		s.failEmailHistoryImport(parent, job, err)
		return
	}
	job.MessagesScanned += page.Scanned
	quarantined := 0
	lastQuarantineError := ""
	for _, candidate := range page.Quarantined {
		if _, quarantineErr := s.saveEmailQuarantineCandidate(ctx, source, candidate); quarantineErr != nil {
			s.failEmailHistoryImport(parent, job, fmt.Errorf("save quarantined historical message: %w", quarantineErr))
			return
		}
		quarantined++
		lastQuarantineError = candidate.ErrorMessage
	}
	states := map[string]*emailConversationIngestState{}
	for _, item := range page.Messages {
		decision := applyIncomingEmailFilterDecision(&item)
		if item.Classification == "filtered" || decision.Filtered {
			job.FilteredMessages++
			job.MessagesSkipped++
			continue
		}
		conversationID := stableExternalConversationID(source.ID, item.ExternalConversationID)
		state := states[conversationID]
		if state == nil {
			state = &emailConversationIngestState{}
			states[conversationID] = state
		}
		createdConversation, createdMessage, skipped, ingestErr := s.ingestProviderEmailWithStateAndOptions(ctx, job.ShopID, source, item, state, emailIngestOptions{Historical: true})
		if ingestErr != nil {
			candidate, candidateErr := incomingEmailQuarantineCandidate(item, "history_ingest", ingestErr)
			if candidateErr != nil {
				s.failEmailHistoryImport(parent, job, fmt.Errorf("historical message ingest failed: %w", ingestErr))
				return
			}
			if _, quarantineErr := s.saveEmailQuarantineCandidate(ctx, source, candidate); quarantineErr != nil {
				s.failEmailHistoryImport(parent, job, fmt.Errorf("save quarantined historical message: %w", quarantineErr))
				return
			}
			quarantined++
			lastQuarantineError = ingestErr.Error()
			job.MessagesSkipped++
			continue
		}
		if createdConversation {
			job.ConversationsCreated++
		}
		if createdMessage {
			job.MessagesImported++
		}
		if skipped {
			job.MessagesSkipped++
		}
	}
	if quarantined > 0 {
		_, _ = s.store.MutateShopSourceMetadata(context.WithoutCancel(ctx), source.ShopID, source.ID, func(metadata map[string]string) map[string]string {
			return recordEmailQuarantineMetadata(metadata, source, quarantined, lastQuarantineError)
		})
		job.MessagesSkipped += len(page.Quarantined)
	}
	job.PagesProcessed++
	job.Cursor = page.NextCursor
	if page.Done {
		job.Status = emailHistoryCompleted
		job.CompletedAt = time.Now().UTC()
	} else {
		job.Status = emailHistoryQueued
	}
	job.LastError = ""
	historyLock.Lock()
	defer historyLock.Unlock()
	latest, latestErr := s.store.GetEmailHistoryImportJob(context.WithoutCancel(ctx), job.ShopID, job.SourceID)
	if latestErr != nil || latest.ID != job.ID {
		return
	}
	latest.PagesProcessed = job.PagesProcessed
	latest.MessagesScanned = job.MessagesScanned
	latest.MessagesImported = job.MessagesImported
	latest.MessagesSkipped = job.MessagesSkipped
	latest.FilteredMessages = job.FilteredMessages
	latest.ConversationsCreated = job.ConversationsCreated
	latest.Cursor = job.Cursor
	latest.LastError = ""
	if latest.Status == emailHistoryCancelled {
		// Keep the user's cancellation while recording work already completed by the in-flight page.
	} else if page.Done {
		latest.Status = emailHistoryCompleted
		latest.CompletedAt = job.CompletedAt
	} else if latest.Status != emailHistoryPaused {
		latest.Status = emailHistoryQueued
	}
	updated, err := s.store.SaveEmailHistoryImportJob(context.WithoutCancel(ctx), latest)
	if err == nil {
		s.broadcast(Event{Type: "email_history_import.updated", ShopID: updated.ShopID, EntityID: updated.SourceID, Payload: updated, CreatedAt: time.Now().UTC()})
	}
}

func (s *Server) failEmailHistoryImport(ctx context.Context, job EmailHistoryImportJob, importErr error) {
	if ctx.Err() != nil {
		return
	}
	lock := s.emailHistoryLock(job.SourceID)
	lock.Lock()
	defer lock.Unlock()
	latest, err := s.store.GetEmailHistoryImportJob(ctx, job.ShopID, job.SourceID)
	if err != nil || latest.ID != job.ID || latest.Status == emailHistoryPaused || latest.Status == emailHistoryCancelled {
		return
	}
	latest.Status = emailHistoryFailed
	latest.LastError = truncateEmailPreview(importErr.Error(), 500)
	updated, err := s.store.SaveEmailHistoryImportJob(context.WithoutCancel(ctx), latest)
	if err == nil {
		s.broadcast(Event{Type: "email_history_import.updated", ShopID: updated.ShopID, EntityID: updated.SourceID, Payload: updated, CreatedAt: time.Now().UTC()})
	}
}

func (s *Server) resetExpiredEmailHistoryCursor(ctx context.Context, job EmailHistoryImportJob) {
	if ctx.Err() != nil {
		return
	}
	lock := s.emailHistoryLock(job.SourceID)
	lock.Lock()
	defer lock.Unlock()
	latest, err := s.store.GetEmailHistoryImportJob(ctx, job.ShopID, job.SourceID)
	if err != nil || latest.ID != job.ID || latest.Status == emailHistoryPaused || latest.Status == emailHistoryCancelled {
		return
	}
	latest.Cursor = ""
	latest.Status = emailHistoryQueued
	latest.LastError = "provider cursor expired; restarted safely with duplicate protection"
	_, _ = s.store.SaveEmailHistoryImportJob(context.WithoutCancel(ctx), latest)
}

func fetchEmailHistoryPage(ctx context.Context, job EmailHistoryImportJob, source ShopSource, installation EmailInstallation) (emailHistoryPage, error) {
	switch job.Provider {
	case "gmail":
		return fetchGmailHistoryPage(ctx, installation.AccessToken, job.Mailbox, job.Cursor)
	case "outlook":
		return fetchOutlookHistoryPage(ctx, installation.AccessToken, job.Mailbox, job.Cursor)
	case cuiqiuProvider:
		return fetchCuiqiuHistoryPage(ctx, job, source, installation)
	case standardMailProvider:
		return fetchStandardIMAPHistoryPage(ctx, job, source, installation)
	default:
		return emailHistoryPage{}, fmt.Errorf("%w: unsupported email provider %q", ErrInvalid, job.Provider)
	}
}

func fetchGmailHistoryPage(ctx context.Context, accessToken string, mailbox string, pageToken string) (emailHistoryPage, error) {
	values := url.Values{}
	values.Set("q", "in:anywhere -in:sent -in:drafts -in:trash")
	values.Set("includeSpamTrash", "true")
	values.Set("maxResults", emailHistoryPageSize)
	if strings.TrimSpace(pageToken) != "" {
		values.Set("pageToken", pageToken)
	}
	var listed gmailListResponse
	if err := getProviderJSON(ctx, accessToken, gmailAPIBase()+"/users/me/messages?"+values.Encode(), &listed); err != nil {
		return emailHistoryPage{}, err
	}
	messages, err := expandGmailMessageRefsWithOptions(ctx, accessToken, mailbox, listed.Messages, emailExpansionOptions{ReadOnlyHistorical: true})
	if err != nil {
		return emailHistoryPage{}, err
	}
	next := strings.TrimSpace(listed.NextPageToken)
	return emailHistoryPage{Messages: messages, Scanned: len(listed.Messages), NextCursor: next, Done: next == ""}, nil
}

func fetchOutlookHistoryPage(ctx context.Context, accessToken string, mailbox string, encodedCursor string) (emailHistoryPage, error) {
	cursor := outlookHistoryCursor{}
	if strings.TrimSpace(encodedCursor) != "" {
		if err := json.Unmarshal([]byte(encodedCursor), &cursor); err != nil {
			return emailHistoryPage{}, fmt.Errorf("invalid Outlook history cursor: %w", err)
		}
	}
	if cursor.FolderIDs == nil {
		cursor.FolderIDs = map[string]string{}
		for _, name := range []string{"inbox", "junkemail", "archive", "sentitems", "drafts", "deleteditems", "outbox"} {
			var folder outlookMailFolder
			err := getProviderJSON(ctx, accessToken, outlookGraphBase()+"/me/mailFolders/"+name+"?$select=id", &folder)
			if err != nil && !isEmailProviderHTTPStatus(err, http.StatusNotFound) {
				return emailHistoryPage{}, err
			}
			if folder.ID != "" {
				cursor.FolderIDs[name] = folder.ID
			}
		}
	}
	endpoint := strings.TrimSpace(cursor.NextLink)
	if endpoint == "" {
		values := url.Values{}
		values.Set("$orderby", "receivedDateTime desc")
		values.Set("$top", emailHistoryPageSize)
		values.Set("$select", outlookAnchorSelect)
		endpoint = outlookGraphBase() + "/me/messages?" + values.Encode()
	}
	var listed outlookUnreadResponse
	if err := getProviderJSON(ctx, accessToken, endpoint, &listed); err != nil {
		return emailHistoryPage{}, err
	}
	excluded := map[string]bool{}
	for _, name := range []string{"sentitems", "drafts", "deleteditems", "outbox"} {
		if id := cursor.FolderIDs[name]; id != "" {
			excluded[id] = true
		}
	}
	anchors := make([]platformOutlookMessage, 0, len(listed.Value))
	for _, message := range listed.Value {
		if excluded[message.ParentFolderID] {
			continue
		}
		switch message.ParentFolderID {
		case cursor.FolderIDs["inbox"]:
			message.FolderOrigin = "inbox"
		case cursor.FolderIDs["junkemail"]:
			message.FolderOrigin = "junk"
		case cursor.FolderIDs["archive"]:
			message.FolderOrigin = "archive"
		default:
			message.FolderOrigin = "mailbox"
		}
		anchors = append(anchors, message)
	}
	messages, err := expandOutlookMessagesWithOptions(ctx, accessToken, mailbox, anchors, 0, emailExpansionOptions{ReadOnlyHistorical: true})
	if err != nil {
		return emailHistoryPage{}, err
	}
	next := strings.TrimSpace(listed.NextLink)
	nextCursor := ""
	if next != "" {
		cursor.NextLink = next
		encoded, marshalErr := json.Marshal(cursor)
		if marshalErr != nil {
			return emailHistoryPage{}, marshalErr
		}
		nextCursor = string(encoded)
	}
	return emailHistoryPage{Messages: messages, Scanned: len(listed.Value), NextCursor: nextCursor, Done: next == ""}, nil
}
