package platform

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

const emailThreadBackfillLimit = 20
const outlookInlineImageBackfillFromVersion = "4"
const emailIncrementalBatchMessageLimit = 200

type emailConversationExists func(externalConversationID string) (bool, error)

type emailProviderSyncBatch struct {
	Messages        []incomingEmailMessage
	Quarantined     []emailQuarantineCandidate
	MetadataUpdates map[string]string
	BacklogPending  bool
}

func fetchProviderEmailSyncBatch(ctx context.Context, provider string, accessToken string, mailbox string, source ShopSource, conversationExists ...emailConversationExists) (emailProviderSyncBatch, error) {
	switch provider {
	case "gmail":
		return fetchGmailSyncBatch(ctx, accessToken, mailbox, source, conversationExists...)
	case "outlook":
		return fetchOutlookSyncBatch(ctx, accessToken, mailbox, source, conversationExists...)
	case cuiqiuProvider:
		return fetchCuiqiuSyncBatch(ctx, accessToken, mailbox, source)
	case standardMailProvider:
		return fetchStandardIMAPSyncBatch(ctx, accessToken, mailbox, source)
	default:
		return emailProviderSyncBatch{}, fmt.Errorf("%w: unsupported email provider %q", ErrInvalid, provider)
	}
}

type gmailSyncProfile struct {
	HistoryID string `json:"historyId"`
}

type gmailHistoryResponse struct {
	History []struct {
		ID            string `json:"id"`
		MessagesAdded []struct {
			Message gmailMessageRef `json:"message"`
		} `json:"messagesAdded"`
	} `json:"history"`
	NextPageToken string `json:"nextPageToken"`
	HistoryID     string `json:"historyId"`
}

func fetchGmailSyncBatch(ctx context.Context, accessToken string, mailbox string, source ShopSource, conversationExists ...emailConversationExists) (emailProviderSyncBatch, error) {
	metadata := source.Metadata
	cursor := strings.TrimSpace(metadata[gmailHistoryIDKey])
	if cursor == "" {
		if metadata[emailSyncVersionKey] != "" && metadata[emailSyncVersionKey] != emailSyncVersionCurrent {
			return recoverGmailSync(ctx, accessToken, mailbox, source, conversationExists...)
		}
		return bootstrapGmailSync(ctx, accessToken, mailbox, source, false)
	}

	includeSpam := strings.TrimSpace(metadata[gmailSpamBootstrapAtKey]) != "" ||
		metadata[emailSyncVersionKey] != emailSyncVersionCurrent
	refs, nextCursor, backlogPending, err := fetchGmailHistoryRefsBatch(ctx, accessToken, cursor, includeSpam, emailIncrementalBatchMessageLimit)
	if err != nil {
		var providerErr *emailProviderHTTPError
		if (errors.As(err, &providerErr) && providerErr.StatusCode == 404) ||
			errors.Is(err, errEmailProviderResponseTooLarge) {
			return recoverGmailSync(ctx, accessToken, mailbox, source, conversationExists...)
		}
		return emailProviderSyncBatch{}, err
	}
	messages, err := expandGmailMessageRefs(ctx, accessToken, mailbox, refs, conversationExists...)
	if err != nil {
		return emailProviderSyncBatch{}, err
	}
	updates := map[string]string{
		emailSyncVersionKey: emailSyncVersionCurrent,
		gmailHistoryIDKey:   firstNonEmpty(nextCursor, cursor),
		"email_sync_mode":   "incremental",
	}
	setEmailSyncBacklogMetadata(updates, metadata, backlogPending)
	if strings.TrimSpace(metadata[gmailSpamBootstrapAtKey]) == "" &&
		metadata[emailSyncVersionKey] != emailSyncVersionCurrent {
		startedAt := emailSyncStart(source)
		query := "in:spam after:" + strconv.FormatInt(startedAt.Unix(), 10)
		spamMessages, spamErr := fetchGmailEmailsByQuery(ctx, accessToken, mailbox, query, 0)
		if spamErr != nil {
			return emailProviderSyncBatch{}, fmt.Errorf("Gmail spam bootstrap failed: %w", spamErr)
		}
		messages = mergeIncomingEmailMessages(messages, boundIncomingEmailMessages(spamMessages, startedAt, 0))
		updates[gmailSpamBootstrapAtKey] = time.Now().UTC().Format(time.RFC3339Nano)
	}
	return emailProviderSyncBatch{Messages: messages, MetadataUpdates: updates, BacklogPending: backlogPending}, nil
}

func recoverGmailSync(ctx context.Context, accessToken string, mailbox string, source ShopSource, conversationExists ...emailConversationExists) (emailProviderSyncBatch, error) {
	var profile gmailSyncProfile
	if err := getProviderJSON(ctx, accessToken, gmailAPIBase()+"/users/me/profile", &profile); err != nil {
		return emailProviderSyncBatch{}, fmt.Errorf("Gmail synchronization recovery failed: %w", err)
	}
	profile.HistoryID = strings.TrimSpace(profile.HistoryID)
	if profile.HistoryID == "" {
		return emailProviderSyncBatch{}, fmt.Errorf("Gmail synchronization recovery failed: provider returned no historyId")
	}
	startedAt := emailSyncRecoveryStart(source)
	if strings.TrimSpace(source.Metadata[gmailSpamBootstrapAtKey]) == "" {
		startedAt = emailSyncStart(source)
	}
	integrationStartedAt := emailSyncStart(source)
	query := "{in:inbox in:spam} after:" + strconv.FormatInt(startedAt.Unix(), 10)
	messages, err := fetchGmailEmailsByQuery(ctx, accessToken, mailbox, query, 0)
	if err != nil {
		return emailProviderSyncBatch{}, fmt.Errorf("Gmail synchronization recovery failed: %w", err)
	}
	messages = boundIncomingEmailMessages(messages, startedAt, 0)
	return emailProviderSyncBatch{
		Messages: messages,
		MetadataUpdates: map[string]string{
			emailSyncVersionKey:         emailSyncVersionCurrent,
			emailSyncStartedAtKey:       integrationStartedAt.Format(time.RFC3339Nano),
			emailInitialImportKey:       emailInitialImportNow,
			gmailHistoryIDKey:           profile.HistoryID,
			gmailSpamBootstrapAtKey:     time.Now().UTC().Format(time.RFC3339Nano),
			"email_sync_mode":           "incremental",
			"email_cursor_recovered_at": time.Now().UTC().Format(time.RFC3339Nano),
		},
	}, nil
}

func bootstrapGmailSync(ctx context.Context, accessToken string, mailbox string, source ShopSource, recovering bool) (emailProviderSyncBatch, error) {
	var profile gmailSyncProfile
	if err := getProviderJSON(ctx, accessToken, gmailAPIBase()+"/users/me/profile", &profile); err != nil {
		return emailProviderSyncBatch{}, fmt.Errorf("Gmail synchronization baseline failed: %w", err)
	}
	profile.HistoryID = strings.TrimSpace(profile.HistoryID)
	if profile.HistoryID == "" {
		return emailProviderSyncBatch{}, fmt.Errorf("Gmail synchronization baseline failed: provider returned no historyId")
	}

	startedAt, hasStartedAt := parseEmailSyncTime(source.Metadata[emailSyncStartedAtKey])
	if !hasStartedAt || recovering || source.Metadata[emailSyncVersionKey] != emailSyncVersionCurrent {
		startedAt = time.Now().UTC()
	}
	updates := map[string]string{
		emailSyncVersionKey:     emailSyncVersionCurrent,
		emailSyncStartedAtKey:   startedAt.Format(time.RFC3339Nano),
		emailInitialImportKey:   emailInitialImportNow,
		gmailHistoryIDKey:       profile.HistoryID,
		gmailSpamBootstrapAtKey: time.Now().UTC().Format(time.RFC3339Nano),
		"email_sync_mode":       "incremental",
	}
	if recovering {
		updates["email_cursor_recovered_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	}
	return emailProviderSyncBatch{MetadataUpdates: updates}, nil
}

func fetchGmailHistoryRefs(ctx context.Context, accessToken string, startHistoryID string) ([]gmailMessageRef, string, error) {
	return fetchGmailHistoryRefsForScope(ctx, accessToken, startHistoryID, false)
}

func fetchGmailHistoryRefsForScope(ctx context.Context, accessToken string, startHistoryID string, includeSpam bool) ([]gmailMessageRef, string, error) {
	refs, cursor, _, err := fetchGmailHistoryRefsBatch(ctx, accessToken, startHistoryID, includeSpam, 0)
	return refs, cursor, err
}

func fetchGmailHistoryRefsBatch(ctx context.Context, accessToken string, startHistoryID string, includeSpam bool, limit int) ([]gmailMessageRef, string, bool, error) {
	pageToken := ""
	seenPageTokens := map[string]bool{}
	seenMessages := map[string]bool{}
	refs := make([]gmailMessageRef, 0)
	latestHistoryID := strings.TrimSpace(startHistoryID)
	for {
		values := url.Values{}
		values.Set("startHistoryId", startHistoryID)
		values.Set("historyTypes", "messageAdded")
		if !includeSpam {
			values.Set("labelId", "INBOX")
		}
		values.Set("maxResults", "100")
		if pageToken != "" {
			values.Set("pageToken", pageToken)
		}
		var parsed gmailHistoryResponse
		if err := getProviderJSON(ctx, accessToken, gmailAPIBase()+"/users/me/history?"+values.Encode(), &parsed); err != nil {
			return nil, "", false, err
		}
		responseHistoryID := strings.TrimSpace(parsed.HistoryID)
		for historyIndex, history := range parsed.History {
			if limit > 0 && len(refs) >= limit && strings.TrimSpace(latestHistoryID) != strings.TrimSpace(startHistoryID) {
				return refs, latestHistoryID, true, nil
			}
			for _, added := range history.MessagesAdded {
				ref := added.Message
				if strings.TrimSpace(ref.ID) == "" || seenMessages[ref.ID] {
					continue
				}
				seenMessages[ref.ID] = true
				refs = append(refs, ref)
			}
			if strings.TrimSpace(history.ID) != "" {
				latestHistoryID = strings.TrimSpace(history.ID)
			}
			if limit > 0 && len(refs) >= limit && strings.TrimSpace(latestHistoryID) != strings.TrimSpace(startHistoryID) &&
				(historyIndex < len(parsed.History)-1 || strings.TrimSpace(parsed.NextPageToken) != "") {
				return refs, latestHistoryID, true, nil
			}
		}
		nextPageToken := strings.TrimSpace(parsed.NextPageToken)
		if nextPageToken == "" {
			if responseHistoryID != "" {
				latestHistoryID = responseHistoryID
			}
			break
		}
		if seenPageTokens[nextPageToken] {
			return nil, "", false, fmt.Errorf("Gmail incremental sync failed: repeated nextPageToken")
		}
		seenPageTokens[nextPageToken] = true
		pageToken = nextPageToken
	}
	return refs, latestHistoryID, false, nil
}

type outlookDeltaResponse struct {
	Value     []platformOutlookMessage `json:"value"`
	NextLink  string                   `json:"@odata.nextLink"`
	DeltaLink string                   `json:"@odata.deltaLink"`
}

func fetchOutlookSyncBatch(ctx context.Context, accessToken string, mailbox string, source ShopSource, conversationExists ...emailConversationExists) (emailProviderSyncBatch, error) {
	inbox, err := fetchOutlookFolderSync(ctx, accessToken, mailbox, source, "inbox", "inbox", outlookDeltaLinkKey, false, conversationExists...)
	if err != nil {
		return emailProviderSyncBatch{}, err
	}
	junk := emailProviderSyncBatch{MetadataUpdates: map[string]string{}}
	if strings.TrimSpace(source.Metadata[outlookJunkDeltaLinkKey]) != "" ||
		source.Metadata[emailSyncVersionKey] != emailSyncVersionCurrent {
		junk, err = fetchOutlookFolderSync(ctx, accessToken, mailbox, source, "junkemail", "junk", outlookJunkDeltaLinkKey, true, conversationExists...)
		if err != nil {
			return emailProviderSyncBatch{}, err
		}
	}
	inlineImageBackfill := emailProviderSyncBatch{}
	if strings.TrimSpace(source.Metadata[emailSyncVersionKey]) == outlookInlineImageBackfillFromVersion {
		inlineImageBackfill.Messages, err = fetchRecentOutlookInlineImageCandidates(ctx, accessToken, mailbox, source, conversationExists...)
		if err != nil {
			return emailProviderSyncBatch{}, fmt.Errorf("Outlook inline image backfill failed: %w", err)
		}
	}
	updates := mergeStringMaps(inbox.MetadataUpdates, junk.MetadataUpdates)
	updates[emailSyncVersionKey] = emailSyncVersionCurrent
	updates["email_sync_mode"] = "incremental"
	return emailProviderSyncBatch{
		Messages:        mergeIncomingEmailMessages(inbox.Messages, junk.Messages, inlineImageBackfill.Messages),
		MetadataUpdates: updates,
		BacklogPending:  inbox.BacklogPending || junk.BacklogPending,
	}, nil
}

func fetchRecentOutlookInlineImageCandidates(ctx context.Context, accessToken string, mailbox string, source ShopSource, conversationExists ...emailConversationExists) ([]incomingEmailMessage, error) {
	since := time.Now().UTC().Add(-7 * 24 * time.Hour)
	if startedAt := emailSyncStart(source); startedAt.After(since) {
		since = startedAt
	}
	values := url.Values{}
	values.Set("$filter", "receivedDateTime ge "+since.Format(time.RFC3339))
	values.Set("$orderby", "receivedDateTime desc")
	values.Set("$top", outlookMessagePageSize)
	values.Set("$select", outlookAnchorSelect)
	endpoint := outlookGraphBase() + "/me/mailFolders/inbox/messages?" + values.Encode()
	var page outlookUnreadResponse
	if err := getProviderJSON(ctx, accessToken, endpoint, &page); err != nil {
		return nil, err
	}
	setOutlookFolderOrigin(page.Value, "inbox")
	return expandOutlookMessages(ctx, accessToken, mailbox, page.Value, emailThreadBackfillLimit, conversationExists...)
}

func bootstrapOutlookSync(ctx context.Context, accessToken string, mailbox string, source ShopSource, recovering bool, conversationExists ...emailConversationExists) (emailProviderSyncBatch, error) {
	inbox, err := bootstrapOutlookFolderSync(ctx, accessToken, mailbox, source, "inbox", "inbox", outlookDeltaLinkKey, recovering, conversationExists...)
	if err != nil {
		return emailProviderSyncBatch{}, err
	}
	junk, err := bootstrapOutlookFolderSync(ctx, accessToken, mailbox, source, "junkemail", "junk", outlookJunkDeltaLinkKey, false, conversationExists...)
	if err != nil {
		return emailProviderSyncBatch{}, err
	}
	updates := mergeStringMaps(inbox.MetadataUpdates, junk.MetadataUpdates)
	updates[emailSyncVersionKey] = emailSyncVersionCurrent
	updates["email_sync_mode"] = "incremental"
	return emailProviderSyncBatch{
		Messages:        mergeIncomingEmailMessages(inbox.Messages, junk.Messages),
		MetadataUpdates: updates,
	}, nil
}

func fetchOutlookFolderSync(ctx context.Context, accessToken string, mailbox string, source ShopSource, folderID string, origin string, cursorKey string, bootstrapFromIntegration bool, conversationExists ...emailConversationExists) (emailProviderSyncBatch, error) {
	cursor := strings.TrimSpace(source.Metadata[cursorKey])
	if cursor == "" {
		recovering := !bootstrapFromIntegration && source.Metadata[emailSyncVersionKey] != "" && source.Metadata[emailSyncVersionKey] != emailSyncVersionCurrent
		return bootstrapOutlookFolderSync(ctx, accessToken, mailbox, source, folderID, origin, cursorKey, recovering, conversationExists...)
	}
	anchors, nextCursor, backlogPending, err := fetchOutlookDeltaPage(ctx, accessToken, cursor)
	if err != nil {
		var providerErr *emailProviderHTTPError
		if (errors.As(err, &providerErr) && providerErr.StatusCode == 410) ||
			errors.Is(err, errEmailProviderResponseTooLarge) {
			return bootstrapOutlookFolderSync(ctx, accessToken, mailbox, source, folderID, origin, cursorKey, true, conversationExists...)
		}
		return emailProviderSyncBatch{}, err
	}
	setOutlookFolderOrigin(anchors, origin)
	messages, err := expandOutlookMessages(ctx, accessToken, mailbox, anchors, 0, conversationExists...)
	if err != nil {
		return emailProviderSyncBatch{}, err
	}
	return emailProviderSyncBatch{
		Messages: messages,
		MetadataUpdates: map[string]string{
			cursorKey: nextCursor,
		},
		BacklogPending: backlogPending,
	}, nil
}

func bootstrapOutlookFolderSync(ctx context.Context, accessToken string, mailbox string, source ShopSource, folderID string, origin string, cursorKey string, recovering bool, conversationExists ...emailConversationExists) (emailProviderSyncBatch, error) {
	startedAt, hasStartedAt := parseEmailSyncTime(source.Metadata[emailSyncStartedAtKey])
	if recovering {
		startedAt = emailSyncRecoveryStart(source)
	} else if !hasStartedAt {
		startedAt = time.Now().UTC()
	}
	integrationStartedAt := emailSyncStart(source)
	if !hasStartedAt {
		integrationStartedAt = startedAt
	}
	values := url.Values{}
	values.Set("changeType", "created")
	values.Set("$filter", "receivedDateTime ge "+startedAt.Format(time.RFC3339))
	values.Set("$top", outlookMessagePageSize)
	values.Set("$select", outlookAnchorSelect)
	endpoint := outlookGraphBase() + "/me/mailFolders/" + url.PathEscape(folderID) + "/messages/delta?" + values.Encode()
	anchors, deltaLink, backlogPending, err := fetchOutlookDeltaPage(ctx, accessToken, endpoint)
	if err != nil {
		return emailProviderSyncBatch{}, err
	}
	setOutlookFolderOrigin(anchors, origin)
	messages, err := expandOutlookMessages(ctx, accessToken, mailbox, anchors, 0, conversationExists...)
	if err != nil {
		return emailProviderSyncBatch{}, err
	}
	messages = boundIncomingEmailMessages(messages, startedAt, 0)
	updates := map[string]string{
		emailSyncVersionKey:   emailSyncVersionCurrent,
		emailSyncStartedAtKey: integrationStartedAt.Format(time.RFC3339Nano),
		emailInitialImportKey: emailInitialImportNow,
		cursorKey:             deltaLink,
		"email_sync_mode":     "incremental",
	}
	if recovering {
		updates["email_cursor_recovered_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	}
	setEmailSyncBacklogMetadata(updates, source.Metadata, backlogPending)
	return emailProviderSyncBatch{Messages: messages, MetadataUpdates: updates, BacklogPending: backlogPending}, nil
}

func setOutlookFolderOrigin(messages []platformOutlookMessage, origin string) {
	for index := range messages {
		messages[index].FolderOrigin = origin
	}
}

func mergeIncomingEmailMessages(groups ...[]incomingEmailMessage) []incomingEmailMessage {
	seen := map[string]bool{}
	out := make([]incomingEmailMessage, 0)
	for _, group := range groups {
		for _, message := range group {
			key := strings.TrimSpace(message.SourceMessageID)
			if key == "" {
				key = message.ExternalConversationID + "|" + message.ReceivedAt.UTC().Format(time.RFC3339Nano) + "|" + message.Subject
			}
			if seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, message)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].ReceivedAt.Before(out[j].ReceivedAt) })
	return out
}

func fetchOutlookDeltaAnchors(ctx context.Context, accessToken string, endpoint string) ([]platformOutlookMessage, string, error) {
	var anchors []platformOutlookMessage
	seen := map[string]bool{}
	for endpoint != "" {
		normalized, err := normalizeOutlookPageURL(endpoint)
		if err != nil {
			return nil, "", err
		}
		if seen[normalized] {
			return nil, "", fmt.Errorf("Outlook incremental sync failed: repeated page URL")
		}
		seen[normalized] = true
		var parsed outlookDeltaResponse
		if err := getProviderJSON(ctx, accessToken, normalized, &parsed); err != nil {
			return nil, "", err
		}
		anchors = append(anchors, parsed.Value...)
		if strings.TrimSpace(parsed.NextLink) != "" {
			endpoint = parsed.NextLink
			continue
		}
		deltaLink := strings.TrimSpace(parsed.DeltaLink)
		if deltaLink == "" {
			return nil, "", fmt.Errorf("Outlook incremental sync failed: provider returned no deltaLink")
		}
		normalizedDelta, err := normalizeOutlookPageURL(deltaLink)
		if err != nil {
			return nil, "", err
		}
		return anchors, normalizedDelta, nil
	}
	return nil, "", fmt.Errorf("Outlook incremental sync failed: empty delta endpoint")
}

func fetchOutlookDeltaPage(ctx context.Context, accessToken string, endpoint string) ([]platformOutlookMessage, string, bool, error) {
	normalized, err := normalizeOutlookPageURL(endpoint)
	if err != nil {
		return nil, "", false, err
	}
	var parsed outlookDeltaResponse
	if err := getProviderJSON(ctx, accessToken, normalized, &parsed); err != nil {
		return nil, "", false, err
	}
	if nextLink := strings.TrimSpace(parsed.NextLink); nextLink != "" {
		next, err := normalizeOutlookPageURL(nextLink)
		if err != nil {
			return nil, "", false, err
		}
		return parsed.Value, next, true, nil
	}
	deltaLink := strings.TrimSpace(parsed.DeltaLink)
	if deltaLink == "" {
		return nil, "", false, fmt.Errorf("Outlook incremental sync failed: provider returned neither nextLink nor deltaLink")
	}
	next, err := normalizeOutlookPageURL(deltaLink)
	if err != nil {
		return nil, "", false, err
	}
	return parsed.Value, next, false, nil
}

func setEmailSyncBacklogMetadata(updates map[string]string, existing map[string]string, pending bool) {
	if updates == nil {
		return
	}
	updates[emailSyncBacklogPendingKey] = strconv.FormatBool(pending)
	if pending {
		updates[emailSyncBacklogSinceKey] = firstNonEmpty(strings.TrimSpace(existing[emailSyncBacklogSinceKey]), time.Now().UTC().Format(time.RFC3339Nano))
		return
	}
	updates[emailSyncBacklogSinceKey] = ""
}

func normalizeOutlookPageURL(raw string) (string, error) {
	base, err := url.Parse(outlookGraphBase())
	if err != nil {
		return "", fmt.Errorf("Outlook API base URL is invalid: %w", err)
	}
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", fmt.Errorf("Outlook incremental page URL is invalid: %w", err)
	}
	if !parsed.IsAbs() {
		parsed = base.ResolveReference(parsed)
	}
	if !strings.EqualFold(parsed.Scheme, base.Scheme) || !strings.EqualFold(parsed.Host, base.Host) {
		return "", fmt.Errorf("Outlook incremental page URL points outside the configured Microsoft Graph endpoint")
	}
	basePath := strings.TrimRight(base.Path, "/")
	if basePath != "" && !strings.HasPrefix(parsed.Path, basePath+"/") && parsed.Path != basePath {
		return "", fmt.Errorf("Outlook incremental page URL is outside the configured Microsoft Graph API path")
	}
	return parsed.String(), nil
}

func emailSyncStart(source ShopSource) time.Time {
	if startedAt, ok := parseEmailSyncTime(source.Metadata[emailSyncStartedAtKey]); ok {
		return startedAt
	}
	return source.CreatedAt.UTC()
}

func boundIncomingEmailMessages(messages []incomingEmailMessage, since time.Time, limit int) []incomingEmailMessage {
	eligibleConversations := map[string]bool{}
	for _, message := range messages {
		if since.IsZero() || !message.ReceivedAt.Before(since) {
			if conversationID := strings.TrimSpace(message.ExternalConversationID); conversationID != "" {
				eligibleConversations[conversationID] = true
			}
		}
	}
	bounded := make([]incomingEmailMessage, 0, len(messages))
	for _, message := range messages {
		conversationID := strings.TrimSpace(message.ExternalConversationID)
		if !since.IsZero() && message.ReceivedAt.Before(since) &&
			(conversationID == "" || !eligibleConversations[conversationID]) {
			continue
		}
		bounded = append(bounded, message)
	}
	sort.SliceStable(bounded, func(i, j int) bool { return bounded[i].ReceivedAt.Before(bounded[j].ReceivedAt) })
	if limit > 0 && len(bounded) > limit {
		bounded = bounded[len(bounded)-limit:]
	}
	return bounded
}

func emailSyncRecoveryStart(source ShopSource) time.Time {
	for _, key := range []string{"email_last_success_at", "email_last_sync_at", emailSyncStartedAtKey} {
		if value, ok := parseEmailSyncTime(source.Metadata[key]); ok {
			return value.Add(-time.Minute)
		}
	}
	if !source.CreatedAt.IsZero() {
		return source.CreatedAt.UTC().Add(-time.Minute)
	}
	return time.Now().UTC()
}
