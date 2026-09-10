package platform

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"
)

func TestGmailAcceptedCustomerSpamMovesThenRefreshesThreadBeforeCursorAdvance(t *testing.T) {
	body := base64.RawURLEncoding.EncodeToString([]byte("Yes, that was my order."))
	oldBody := base64.RawURLEncoding.EncodeToString([]byte("Earlier order context."))
	modifyCount := 0
	movedBeforeThreadRefresh := false
	gmailServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/users/me/history":
			if r.URL.Query().Get("startHistoryId") != "history-spam-1" || r.URL.Query().Get("labelId") != "" {
				t.Fatalf("spam-aware Gmail history query is wrong: %s", r.URL.RawQuery)
			}
			_, _ = w.Write([]byte(`{"history":[{"messagesAdded":[{"message":{"id":"spam-message-1","threadId":"spam-thread-1"}}]}],"historyId":"history-spam-2"}`))
		case "/users/me/messages/spam-message-1":
			_, _ = w.Write([]byte(`{"id":"spam-message-1","threadId":"spam-thread-1","labelIds":["SPAM","UNREAD"],"internalDate":"1784000000000","payload":{"mimeType":"text/plain","headers":[{"name":"From","value":"Buyer <buyer@example.com>"},{"name":"Subject","value":"Re: Order confirmation"},{"name":"Message-ID","value":"<spam-message-1@example.com>"}],"body":{"data":"` + body + `"}}}`))
		case "/users/me/threads/spam-thread-1":
			if modifyCount != 1 {
				t.Fatalf("Gmail thread was refreshed before the customer message left Spam")
			}
			movedBeforeThreadRefresh = true
			_, _ = w.Write([]byte(`{"id":"spam-thread-1","messages":[{"id":"spam-message-old","threadId":"spam-thread-1","labelIds":["INBOX"],"internalDate":"1782000000000","payload":{"mimeType":"text/plain","headers":[{"name":"From","value":"Buyer <buyer@example.com>"},{"name":"Subject","value":"Earlier order context"},{"name":"Message-ID","value":"<spam-message-old@example.com>"}],"body":{"data":"` + oldBody + `"}}},{"id":"spam-message-1","threadId":"spam-thread-1","labelIds":["INBOX","UNREAD"],"internalDate":"1784000000000","payload":{"mimeType":"text/plain","headers":[{"name":"From","value":"Buyer <buyer@example.com>"},{"name":"Subject","value":"Re: Order confirmation"},{"name":"Message-ID","value":"<spam-message-1@example.com>"}],"body":{"data":"` + body + `"}}}]}`))
		case "/users/me/messages/spam-message-1/modify":
			modifyCount++
			var payload map[string][]string
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode Gmail not-spam payload failed: %v", err)
			}
			if strings.Join(payload["addLabelIds"], ",") != "INBOX" || strings.Join(payload["removeLabelIds"], ",") != "SPAM" {
				t.Fatalf("accepted spam labels are wrong: %#v", payload)
			}
			if strings.Contains(strings.Join(payload["removeLabelIds"], ","), "UNREAD") {
				t.Fatalf("ingest must preserve unread state until the conversation is handled: %#v", payload)
			}
			_, _ = w.Write([]byte(`{"id":"spam-message-1","labelIds":["INBOX","UNREAD"]}`))
		default:
			t.Fatalf("unexpected Gmail API path: %s", r.URL.Path)
		}
	}))
	defer gmailServer.Close()
	t.Setenv("GMAIL_API_BASE_URL", gmailServer.URL)

	store := NewMemoryStore()
	shop, _ := store.CreateShop(context.Background(), Shop{DisplayName: "Accepted Gmail Spam"})
	metadata := newEmailSyncMetadata("support@example.com", "gmail_api", emailInitialImportNow)
	metadata[emailSyncStartedAtKey] = time.UnixMilli(1783000000000).UTC().Format(time.RFC3339Nano)
	metadata[gmailHistoryIDKey] = "history-spam-1"
	metadata[gmailSpamBootstrapAtKey] = time.Now().UTC().Format(time.RFC3339Nano)
	metadata[emailLastReconcileAtKey] = time.Now().UTC().Format(time.RFC3339Nano)
	source, _ := store.CreateShopSource(context.Background(), ShopSource{ShopID: shop.ID, Type: SourceTypeEmail, Provider: "gmail", Address: "support@example.com", Metadata: metadata})
	_, _ = store.SaveEmailInstallation(context.Background(), EmailInstallation{ShopID: shop.ID, Mailbox: source.Address, Provider: "gmail", AccessToken: "token", Scope: defaultGmailScopes, ExpiresAt: time.Now().Add(time.Hour)})

	result := NewServer(store).syncSingleEmailSource(context.Background(), shop.ID, "gmail", source)
	if result.SourcesSucceeded != 1 || result.MessagesCreated != 2 || len(result.Warnings) != 0 || modifyCount != 1 || !movedBeforeThreadRefresh {
		t.Fatalf("accepted Gmail spam was not durably ingested and restored once: result=%#v modifyCount=%d", result, modifyCount)
	}
	updated := mustShopSource(t, store, shop.ID, source.ID)
	if updated.Metadata[gmailHistoryIDKey] != "history-spam-2" {
		t.Fatalf("Gmail cursor did not advance after ingest and not-spam update: %#v", updated.Metadata)
	}
	messages, err := store.ListMessages(context.Background(), stableExternalConversationID(source.ID, "spam-thread-1"))
	if err != nil || len(messages) != 2 || messages[0].Body != "Earlier order context." || messages[1].Body != "Yes, that was my order." {
		t.Fatalf("Gmail spam thread context was not refreshed completely: %#v err=%v", messages, err)
	}
}

func TestOnlyAcceptedGmailCustomerSpamIsMovedToInbox(t *testing.T) {
	base := incomingEmailMessage{
		SourceMessageID: "gmail:message-1",
		Direction:       MessageDirectionCustomer,
		Classification:  ConversationKindCustomer,
		Metadata: map[string]string{
			"gmail_message_id":    "message-1",
			"email_folder_origin": "spam",
		},
	}
	if got := acceptedGmailSpamMessageID("gmail", base); got != "message-1" {
		t.Fatalf("accepted Gmail customer spam id = %q", got)
	}
	filtered := base
	filtered.Classification = "filtered"
	if got := acceptedGmailSpamMessageID("gmail", filtered); got != "" {
		t.Fatalf("filtered spam must stay in Spam, got %q", got)
	}
	agent := base
	agent.Direction = MessageDirectionAgent
	if got := acceptedGmailSpamMessageID("gmail", agent); got != "" {
		t.Fatalf("agent mail must not be moved from Spam, got %q", got)
	}
	inbox := base
	inbox.Metadata = map[string]string{"gmail_message_id": "message-1", "email_folder_origin": "inbox"}
	if got := acceptedGmailSpamMessageID("gmail", inbox); got != "" {
		t.Fatalf("Inbox mail must not trigger a not-spam update, got %q", got)
	}
}

func TestGmailIncrementalSyncIngestsAlreadyReadMessageAndAdvancesCursor(t *testing.T) {
	body := base64.RawURLEncoding.EncodeToString([]byte("Already read, still new"))
	oldBody := base64.RawURLEncoding.EncodeToString([]byte("Before authorization"))
	gmailServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/users/me/history":
			if r.URL.Query().Get("startHistoryId") != "history-10" || r.URL.Query().Get("labelId") != "INBOX" {
				t.Fatalf("unexpected Gmail history query: %s", r.URL.RawQuery)
			}
			_, _ = w.Write([]byte(`{"history":[{"messagesAdded":[{"message":{"id":"message-read","threadId":"thread-read"}}]}],"historyId":"history-11"}`))
		case "/users/me/messages/message-read":
			_, _ = w.Write([]byte(`{"id":"message-read","threadId":"thread-read","labelIds":["INBOX"],"internalDate":"1784000000000","payload":{"mimeType":"text/plain","headers":[{"name":"From","value":"Buyer <buyer@example.com>"},{"name":"Subject","value":"Read before polling"},{"name":"Message-ID","value":"<message-read@example.com>"}],"body":{"data":"` + body + `"}}}`))
		case "/users/me/threads/thread-read":
			_, _ = w.Write([]byte(`{"id":"thread-read","messages":[{"id":"message-old","threadId":"thread-read","labelIds":["INBOX"],"internalDate":"1780000000000","payload":{"mimeType":"text/plain","headers":[{"name":"From","value":"Buyer <buyer@example.com>"},{"name":"Subject","value":"Old context"},{"name":"Message-ID","value":"<message-old@example.com>"}],"body":{"data":"` + oldBody + `"}}},{"id":"message-read","threadId":"thread-read","labelIds":["INBOX"],"internalDate":"1784000000000","payload":{"mimeType":"text/plain","headers":[{"name":"From","value":"Buyer <buyer@example.com>"},{"name":"Subject","value":"Read before polling"},{"name":"Message-ID","value":"<message-read@example.com>"}],"body":{"data":"` + body + `"}}}]}`))
		default:
			t.Fatalf("unexpected Gmail API path: %s", r.URL.Path)
		}
	}))
	defer gmailServer.Close()
	t.Setenv("GMAIL_API_BASE_URL", gmailServer.URL)

	store := NewMemoryStore()
	shop, _ := store.CreateShop(context.Background(), Shop{DisplayName: "Incremental Gmail"})
	metadata := newEmailSyncMetadata("support@example.com", "gmail_api", emailInitialImportNow)
	metadata[emailSyncStartedAtKey] = time.UnixMilli(1783000000000).UTC().Format(time.RFC3339Nano)
	metadata[gmailHistoryIDKey] = "history-10"
	metadata[emailLastReconcileAtKey] = time.Now().UTC().Format(time.RFC3339Nano)
	source, _ := store.CreateShopSource(context.Background(), ShopSource{ShopID: shop.ID, Type: SourceTypeEmail, Provider: "gmail", Address: "support@example.com", Metadata: metadata})
	_, _ = store.SaveEmailInstallation(context.Background(), EmailInstallation{ShopID: shop.ID, Mailbox: source.Address, Provider: "gmail", AccessToken: "token", Scope: defaultGmailScopes, ExpiresAt: time.Now().Add(time.Hour)})

	result := NewServer(store).syncSingleEmailSource(context.Background(), shop.ID, "gmail", source)
	if result.SourcesSucceeded != 1 || result.MessagesCreated != 2 || len(result.Warnings) != 0 {
		t.Fatalf("unexpected Gmail incremental result: %#v", result)
	}
	updated := mustShopSource(t, store, shop.ID, source.ID)
	if updated.Metadata[gmailHistoryIDKey] != "history-11" {
		t.Fatalf("Gmail cursor did not advance after durable ingest: %#v", updated.Metadata)
	}
	messages, err := store.ListMessages(context.Background(), stableExternalConversationID(source.ID, "thread-read"))
	if err != nil || len(messages) != 2 || messages[0].Body != "Before authorization" || messages[1].Body != "Already read, still new" {
		t.Fatalf("already-read Gmail message was not ingested: %#v err=%v", messages, err)
	}
}

func TestExpandOutlookCustomerJunkMovesAndRefreshesWholeConversation(t *testing.T) {
	moveCount := 0
	graphServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/me/messages/junk-message-1/move":
			if r.Method != http.MethodPost {
				t.Fatalf("unexpected Outlook move method: %s", r.Method)
			}
			var payload map[string]string
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || payload["destinationId"] != "inbox" {
				t.Fatalf("unexpected Outlook move payload: %#v err=%v", payload, err)
			}
			moveCount++
			_, _ = w.Write([]byte(`{"id":"inbox-message-1"}`))
		case "/me/messages/inbox-message-1":
			_, _ = w.Write([]byte(`{"id":"inbox-message-1","conversationId":"conversation-junk-1","internetMessageId":"<current@example.com>","subject":"Where is my order?","from":{"emailAddress":{"name":"Buyer","address":"buyer@example.com"}},"receivedDateTime":"2026-07-28T02:00:00Z","body":{"contentType":"text","content":"Please send the tracking status."},"isRead":false,"hasAttachments":false}`))
		case "/me/messages":
			if moveCount != 1 || !strings.Contains(r.URL.Query().Get("$filter"), "conversation-junk-1") {
				t.Fatalf("Outlook conversation was not refreshed after moving from Junk: %s", r.URL.RawQuery)
			}
			_, _ = w.Write([]byte(`{"value":[{"id":"history-message-1","conversationId":"conversation-junk-1","internetMessageId":"<history@example.com>","subject":"Order confirmation","from":{"emailAddress":{"name":"support@example.com","address":"support@example.com"}},"receivedDateTime":"2026-07-20T02:00:00Z","body":{"contentType":"text","content":"Your order is confirmed."},"isRead":true,"hasAttachments":false},{"id":"inbox-message-1","conversationId":"conversation-junk-1","internetMessageId":"<current@example.com>","subject":"Where is my order?","from":{"emailAddress":{"name":"Buyer","address":"buyer@example.com"}},"receivedDateTime":"2026-07-28T02:00:00Z","body":{"contentType":"text","content":"Please send the tracking status."},"isRead":false,"hasAttachments":false}]}`))
		default:
			t.Fatalf("unexpected Outlook API path: %s", r.URL.Path)
		}
	}))
	defer graphServer.Close()
	t.Setenv("OUTLOOK_GRAPH_BASE_URL", graphServer.URL)

	anchor := platformOutlookMessage{
		ID:               "junk-message-1",
		ConversationID:   "conversation-junk-1",
		Subject:          "Where is my order?",
		ReceivedDateTime: "2026-07-28T02:00:00Z",
		BodyPreview:      "Please send the tracking status.",
		FolderOrigin:     "junk",
	}
	anchor.From.EmailAddress.Name = "Buyer"
	anchor.From.EmailAddress.Address = "buyer@example.com"

	messages, err := expandOutlookMessages(context.Background(), "token", "support@example.com", []platformOutlookMessage{anchor}, 0,
		func(string) (bool, error) { return false, nil })
	if err != nil {
		t.Fatalf("expand Outlook customer Junk failed: %v", err)
	}
	if moveCount != 1 || len(messages) != 2 || messages[1].SourceMessageID != "outlook:inbox-message-1" ||
		messages[1].Metadata["email_folder_origin"] != "junk" || messages[1].Classification != ConversationKindCustomer {
		t.Fatalf("Outlook Junk recovery did not preserve complete unread customer context: %#v moveCount=%d", messages, moveCount)
	}
}

func TestGmailAttachmentArchiveRunsAfterBodySync(t *testing.T) {
	body := base64.RawURLEncoding.EncodeToString([]byte("body first"))
	image := base64.RawURLEncoding.EncodeToString([]byte("png-image"))
	gmailServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/users/me/history":
			_, _ = w.Write([]byte(`{"history":[{"messagesAdded":[{"message":{"id":"message-image","threadId":"thread-image"}}]}],"historyId":"history-21"}`))
		case "/users/me/messages/message-image":
			_, _ = w.Write([]byte(gmailImageMessageJSON("message-image", "thread-image", body, image)))
		case "/users/me/threads/thread-image":
			_, _ = w.Write([]byte(`{"id":"thread-image","messages":[` + gmailImageMessageJSON("message-image", "thread-image", body, image) + `]}`))
		default:
			t.Fatalf("unexpected Gmail API path: %s", r.URL.Path)
		}
	}))
	defer gmailServer.Close()
	t.Setenv("GMAIL_API_BASE_URL", gmailServer.URL)

	store := NewMemoryStore()
	shop, _ := store.CreateShop(context.Background(), Shop{DisplayName: "Cursor Safety"})
	metadata := newEmailSyncMetadata("support@example.com", "gmail_api", emailInitialImportNow)
	metadata[emailSyncStartedAtKey] = time.UnixMilli(1783000000000).UTC().Format(time.RFC3339Nano)
	metadata[gmailHistoryIDKey] = "history-20"
	metadata[emailLastReconcileAtKey] = time.Now().UTC().Format(time.RFC3339Nano)
	source, _ := store.CreateShopSource(context.Background(), ShopSource{ShopID: shop.ID, Type: SourceTypeEmail, Provider: "gmail", Address: "support@example.com", Metadata: metadata})
	_, _ = store.SaveEmailInstallation(context.Background(), EmailInstallation{ShopID: shop.ID, Mailbox: source.Address, Provider: "gmail", AccessToken: "token", Scope: defaultGmailScopes, ExpiresAt: time.Now().Add(time.Hour)})
	server := NewServer(store)
	blockedPath := t.TempDir() + "/blocked"
	if err := os.WriteFile(blockedPath, []byte("not a directory"), 0600); err != nil {
		t.Fatal(err)
	}
	server.uploadDir = blockedPath
	synced := server.syncSingleEmailSource(context.Background(), shop.ID, "gmail", source)
	if synced.SourcesSucceeded != 1 || synced.MessagesCreated != 1 || synced.MessagesSkipped != 0 || len(synced.Warnings) != 0 {
		t.Fatalf("message body should sync without waiting for attachment storage, got %#v", synced)
	}
	afterSync := mustShopSource(t, store, shop.ID, source.ID)
	if afterSync.Metadata[gmailHistoryIDKey] != "history-21" || afterSync.Metadata["email_quarantine_pending_count"] != "" {
		t.Fatalf("cursor or queue-independent sync state was not persisted: %#v", afterSync.Metadata)
	}
	conversationID := stableExternalConversationID(source.ID, "thread-image")
	messages, err := store.ListMessages(context.Background(), conversationID)
	if err != nil || len(messages) != 1 || messages[0].Metadata["email_attachment_archive_status"] != "queued" {
		t.Fatalf("body was not stored before the background attachment: %#v err=%v", messages, err)
	}
	if len(store.emailAttachmentJobs) != 1 {
		t.Fatalf("attachment archive job was not queued: %#v", store.emailAttachmentJobs)
	}
	server.uploadDir = t.TempDir()
	job, err := store.ClaimEmailAttachmentJob(context.Background(), nil, time.Now().UTC().Add(time.Second))
	if err != nil {
		t.Fatalf("claim attachment archive job failed: %v", err)
	}
	server.processEmailAttachmentArchiveJob(context.Background(), store, job)
	if len(store.emailAttachmentJobs) != 0 {
		t.Fatalf("completed attachment archive job was not removed: %#v", store.emailAttachmentJobs)
	}
	messages, err = store.ListMessages(context.Background(), conversationID)
	if err != nil || len(messages) != 2 || messages[1].Type != MessageTypeImage {
		t.Fatalf("background archive produced incomplete or duplicate messages: %#v err=%v", messages, err)
	}
}

func TestGmailIncrementalSyncSkipsMissingHistoryMessageAndAdvancesCursor(t *testing.T) {
	gmailServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/users/me/history":
			_, _ = w.Write([]byte(`{"history":[{"messagesAdded":[{"message":{"id":"missing-message","threadId":"thread-missing"}}]}],"historyId":"history-31"}`))
		case "/users/me/messages/missing-message":
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":{"code":404,"message":"Requested entity was not found.","status":"NOT_FOUND"}}`))
		default:
			t.Fatalf("unexpected Gmail API path: %s", r.URL.Path)
		}
	}))
	defer gmailServer.Close()
	t.Setenv("GMAIL_API_BASE_URL", gmailServer.URL)

	store := NewMemoryStore()
	shop, _ := store.CreateShop(context.Background(), Shop{DisplayName: "Missing Gmail Ref"})
	metadata := newEmailSyncMetadata("support@example.com", "gmail_api", emailInitialImportNow)
	metadata[emailSyncStartedAtKey] = time.UnixMilli(1783000000000).UTC().Format(time.RFC3339Nano)
	metadata[gmailHistoryIDKey] = "history-30"
	source, _ := store.CreateShopSource(context.Background(), ShopSource{ShopID: shop.ID, Type: SourceTypeEmail, Provider: "gmail", Address: "support@example.com", Metadata: metadata})
	_, _ = store.SaveEmailInstallation(context.Background(), EmailInstallation{ShopID: shop.ID, Mailbox: source.Address, Provider: "gmail", AccessToken: "token", Scope: defaultGmailScopes, ExpiresAt: time.Now().Add(time.Hour)})

	result := NewServer(store).syncSingleEmailSource(context.Background(), shop.ID, "gmail", source)
	if result.SourcesSucceeded != 1 || result.MessagesCreated != 0 || len(result.Warnings) != 0 {
		t.Fatalf("missing Gmail history ref should not fail mailbox sync: %#v", result)
	}
	updated := mustShopSource(t, store, shop.ID, source.ID)
	if updated.Metadata[gmailHistoryIDKey] != "history-31" || updated.Metadata["email_sync_status"] != "ok" {
		t.Fatalf("Gmail cursor/status not updated after skipped missing ref: %#v", updated.Metadata)
	}
}

func TestGmailVersionMismatchContinuesFromExistingHistoryCursor(t *testing.T) {
	gmailServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/users/me/history":
			if r.URL.Query().Get("startHistoryId") != "history-old" {
				t.Fatalf("version mismatch must continue from the old Gmail cursor: %s", r.URL.RawQuery)
			}
			_, _ = w.Write([]byte(`{"history":[],"historyId":"history-fresh"}`))
		case "/users/me/messages":
			if !strings.Contains(r.URL.Query().Get("q"), "in:spam") {
				t.Fatalf("unexpected Gmail migration query: %s", r.URL.RawQuery)
			}
			_, _ = w.Write([]byte(`{"messages":[]}`))
		default:
			t.Fatalf("unexpected Gmail API path: %s", r.URL.Path)
		}
	}))
	defer gmailServer.Close()
	t.Setenv("GMAIL_API_BASE_URL", gmailServer.URL)

	source := ShopSource{Provider: "gmail", Address: "support@example.com", Metadata: newEmailSyncMetadata("support@example.com", "gmail_api", emailInitialImportNow)}
	source.Metadata[emailSyncVersionKey] = "old"
	source.Metadata[gmailHistoryIDKey] = "history-old"
	batch, err := fetchGmailSyncBatch(context.Background(), "token", source.Address, source)
	if err != nil {
		t.Fatalf("Gmail version cursor continuation failed: %v", err)
	}
	if len(batch.Messages) != 0 || batch.MetadataUpdates[gmailHistoryIDKey] != "history-fresh" || batch.MetadataUpdates[emailSyncVersionKey] != emailSyncVersionCurrent {
		t.Fatalf("Gmail version cursor metadata is wrong: %#v messages=%#v", batch.MetadataUpdates, batch.Messages)
	}
}

func TestGmailHistoryTimeoutDoesNotResetCursor(t *testing.T) {
	profileCalled := false
	gmailServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/users/me/history":
			<-r.Context().Done()
		case "/users/me/profile":
			profileCalled = true
			t.Fatal("a history timeout must not reset the Gmail cursor")
		default:
			t.Fatalf("unexpected Gmail API path: %s", r.URL.Path)
		}
	}))
	defer gmailServer.Close()
	t.Setenv("GMAIL_API_BASE_URL", gmailServer.URL)

	source := ShopSource{Provider: "gmail", Address: "support@example.com", Metadata: newEmailSyncMetadata("support@example.com", "gmail_api", emailInitialImportNow)}
	source.Metadata[gmailHistoryIDKey] = "history-old"
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	if _, err := fetchGmailSyncBatch(ctx, "token", source.Address, source); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Gmail history timeout must be returned for retry, got %v", err)
	}
	if profileCalled {
		t.Fatal("Gmail history timeout unexpectedly rebuilt the baseline")
	}
}

func TestGmailThreadHistoryTimeoutFallsBackToAnchorAndAdvancesCursor(t *testing.T) {
	body := base64.RawURLEncoding.EncodeToString([]byte("new reply"))
	previousTimeout := emailThreadHistoryFetchTimeout
	emailThreadHistoryFetchTimeout = 10 * time.Millisecond
	t.Cleanup(func() { emailThreadHistoryFetchTimeout = previousTimeout })

	gmailServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/users/me/history":
			_, _ = w.Write([]byte(`{"history":[{"messagesAdded":[{"message":{"id":"message-new","threadId":"thread-slow"}}]}],"historyId":"history-41"}`))
		case "/users/me/messages/message-new":
			_, _ = w.Write([]byte(`{"id":"message-new","threadId":"thread-slow","labelIds":["INBOX"],"internalDate":"1784000000000","payload":{"mimeType":"text/plain","headers":[{"name":"From","value":"Buyer <buyer@example.com>"},{"name":"Subject","value":"Slow history"},{"name":"Message-ID","value":"<message-new@example.com>"}],"body":{"data":"` + body + `"}}}`))
		case "/users/me/threads/thread-slow":
			<-r.Context().Done()
		default:
			t.Fatalf("unexpected Gmail API path: %s", r.URL.Path)
		}
	}))
	defer gmailServer.Close()
	t.Setenv("GMAIL_API_BASE_URL", gmailServer.URL)

	store := NewMemoryStore()
	shop, _ := store.CreateShop(context.Background(), Shop{DisplayName: "Slow Gmail Thread"})
	metadata := newEmailSyncMetadata("support@example.com", "gmail_api", emailInitialImportNow)
	metadata[emailSyncStartedAtKey] = time.UnixMilli(1783000000000).UTC().Format(time.RFC3339Nano)
	metadata[gmailHistoryIDKey] = "history-40"
	source, _ := store.CreateShopSource(context.Background(), ShopSource{ShopID: shop.ID, Type: SourceTypeEmail, Provider: "gmail", Address: "support@example.com", Metadata: metadata})
	_, _ = store.SaveEmailInstallation(context.Background(), EmailInstallation{ShopID: shop.ID, Mailbox: source.Address, Provider: "gmail", AccessToken: "token", Scope: defaultGmailScopes, ExpiresAt: time.Now().Add(time.Hour)})

	result := NewServer(store).syncSingleEmailSource(context.Background(), shop.ID, "gmail", source)
	if result.SourcesSucceeded != 1 || result.MessagesCreated != 1 || len(result.Warnings) != 0 {
		t.Fatalf("slow Gmail thread history should fall back to anchor: %#v", result)
	}
	updated := mustShopSource(t, store, shop.ID, source.ID)
	if updated.Metadata[gmailHistoryIDKey] != "history-41" || updated.Metadata["email_sync_status"] != "ok" {
		t.Fatalf("Gmail cursor/status not updated after thread timeout fallback: %#v", updated.Metadata)
	}
	messages, err := store.ListMessages(context.Background(), stableExternalConversationID(source.ID, "thread-slow"))
	if err != nil || len(messages) != 1 || messages[0].Body != "new reply" {
		t.Fatalf("fallback anchor message not ingested: %#v err=%v", messages, err)
	}
}

func TestOutlookVersionMismatchContinuesFromExistingDeltaCursor(t *testing.T) {
	var graphServer *httptest.Server
	graphServer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/me/mailFolders/inbox/messages/delta":
			if r.URL.Query().Get("$deltatoken") != "old" {
				t.Fatalf("version mismatch must continue from the old Outlook delta cursor")
			}
			_, _ = w.Write([]byte(`{"value":[],"@odata.deltaLink":"` + graphServer.URL + `/me/mailFolders/inbox/messages/delta?$deltatoken=fresh"}`))
		case "/me/mailFolders/junkemail/messages/delta":
			_, _ = w.Write([]byte(`{"value":[],"@odata.deltaLink":"` + graphServer.URL + `/me/mailFolders/junkemail/messages/delta?$deltatoken=fresh"}`))
		default:
			t.Fatalf("unexpected Graph path: %s", r.URL.Path)
		}
	}))
	defer graphServer.Close()
	t.Setenv("OUTLOOK_GRAPH_BASE_URL", graphServer.URL)

	source := ShopSource{Provider: "outlook", Address: "support@example.com", Metadata: newEmailSyncMetadata("support@example.com", "microsoft_graph", emailInitialImportNow)}
	source.Metadata[emailSyncVersionKey] = "old"
	source.Metadata[outlookDeltaLinkKey] = graphServer.URL + "/me/mailFolders/inbox/messages/delta?$deltatoken=old"
	batch, err := fetchOutlookSyncBatch(context.Background(), "token", source.Address, source)
	if err != nil {
		t.Fatalf("Outlook version cursor continuation failed: %v", err)
	}
	if len(batch.Messages) != 0 || !strings.Contains(batch.MetadataUpdates[outlookDeltaLinkKey], "fresh") ||
		!strings.Contains(batch.MetadataUpdates[outlookJunkDeltaLinkKey], "fresh") ||
		batch.MetadataUpdates[emailSyncVersionKey] != emailSyncVersionCurrent {
		t.Fatalf("Outlook version cursor metadata is wrong: %#v messages=%#v", batch.MetadataUpdates, batch.Messages)
	}
}

func TestOutlookExpiredDeltaCursorRecoversRecentReadMessage(t *testing.T) {
	var graphServer *httptest.Server
	graphServer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/me/mailFolders/inbox/messages/delta":
			if r.URL.Query().Get("$deltatoken") == "expired" {
				w.WriteHeader(http.StatusGone)
				_, _ = w.Write([]byte(`{"error":{"code":"syncStateNotFound"}}`))
				return
			}
			if r.URL.Query().Get("$top") != outlookMessagePageSize {
				t.Fatalf("unexpected Outlook delta page size: %s", r.URL.RawQuery)
			}
			if selected := r.URL.Query().Get("$select"); selected != outlookAnchorSelect || strings.Contains(","+selected+",", ",body,") {
				t.Fatalf("Outlook delta must use lightweight anchors, got %q", selected)
			}
			if filter := r.URL.Query().Get("$filter"); !strings.Contains(filter, "2026-07-20T07:58:00Z") {
				t.Fatalf("Outlook recovery did not resume from the last successful checkpoint with overlap: %q", filter)
			}
			_, _ = w.Write([]byte(`{"value":[{"id":"message-recovered","conversationId":"conversation-recovered","internetMessageId":"<recovered@example.com>","subject":"Recovered","from":{"emailAddress":{"name":"Buyer","address":"buyer@example.com"}},"receivedDateTime":"2026-07-20T08:00:00Z","bodyPreview":"recovered preview","isRead":true,"hasAttachments":false}],"@odata.deltaLink":"` + graphServer.URL + `/me/mailFolders/inbox/messages/delta?$deltatoken=fresh"}`))
		case "/me/messages/message-recovered":
			_, _ = w.Write([]byte(`{"id":"message-recovered","conversationId":"conversation-recovered","internetMessageId":"<recovered@example.com>","subject":"Recovered","from":{"emailAddress":{"name":"Buyer","address":"buyer@example.com"}},"receivedDateTime":"2026-07-20T08:00:00Z","body":{"contentType":"text","content":"recovered full body"},"isRead":true,"hasAttachments":false}`))
		default:
			t.Fatalf("unexpected Graph path: %s", r.URL.Path)
		}
	}))
	defer graphServer.Close()
	t.Setenv("OUTLOOK_GRAPH_BASE_URL", graphServer.URL)

	source := ShopSource{Provider: "outlook", Address: "support@example.com", Metadata: newEmailSyncMetadata("support@example.com", "microsoft_graph", emailInitialImportNow)}
	source.Metadata[outlookDeltaLinkKey] = graphServer.URL + "/me/mailFolders/inbox/messages/delta?$deltatoken=expired"
	source.Metadata["email_last_success_at"] = "2026-07-20T07:59:00Z"
	batch, err := fetchOutlookSyncBatch(context.Background(), "token", source.Address, source, func(string) (bool, error) { return true, nil })
	if err != nil {
		t.Fatalf("Outlook delta recovery failed: %v", err)
	}
	if len(batch.Messages) != 1 || batch.Messages[0].Body != "recovered full body" {
		t.Fatalf("Outlook recovery lost the message after the previous checkpoint: %#v", batch.Messages)
	}
	if !strings.Contains(batch.MetadataUpdates[outlookDeltaLinkKey], "fresh") || batch.MetadataUpdates["email_cursor_recovered_at"] == "" {
		t.Fatalf("Outlook recovery metadata is incomplete: %#v", batch.MetadataUpdates)
	}
}

func TestOutlookThreadBackfillFallsBackWhenConversationFilterIsInefficient(t *testing.T) {
	var graphServer *httptest.Server
	graphServer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/me/mailFolders/inbox/messages/delta":
			_, _ = w.Write([]byte(`{"value":[{"id":"message-1","conversationId":"conversation-1","internetMessageId":"<message-1@example.com>","subject":"Need help","from":{"emailAddress":{"name":"Buyer","address":"buyer@example.com"}},"receivedDateTime":"2026-07-20T08:00:00Z","bodyPreview":"preview","isRead":false,"hasAttachments":false}],"@odata.deltaLink":"` + graphServer.URL + `/me/mailFolders/inbox/messages/delta?$deltatoken=fresh"}`))
		case "/me/messages":
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":{"code":"InefficientFilter","message":"The restriction or sort order is too complex for this operation."}}`))
		case "/me/messages/message-1":
			_, _ = w.Write([]byte(`{"id":"message-1","conversationId":"conversation-1","internetMessageId":"<message-1@example.com>","subject":"Need help","from":{"emailAddress":{"name":"Buyer","address":"buyer@example.com"}},"receivedDateTime":"2026-07-20T08:00:00Z","body":{"contentType":"text","content":"full body"},"isRead":false,"hasAttachments":false}`))
		default:
			t.Fatalf("unexpected Graph path: %s", r.URL.Path)
		}
	}))
	defer graphServer.Close()
	t.Setenv("OUTLOOK_GRAPH_BASE_URL", graphServer.URL)

	source := ShopSource{Provider: "outlook", Address: "support@example.com", Metadata: newEmailSyncMetadata("support@example.com", "microsoft_graph", emailInitialImportNow)}
	source.Metadata[outlookDeltaLinkKey] = graphServer.URL + "/me/mailFolders/inbox/messages/delta?$deltatoken=old"
	batch, err := fetchOutlookSyncBatch(context.Background(), "token", source.Address, source)
	if err != nil {
		t.Fatalf("Outlook fallback sync failed: %v", err)
	}
	if len(batch.Messages) != 1 || batch.Messages[0].Body != "full body" || batch.Messages[0].ExternalConversationID != "conversation-1" {
		t.Fatalf("Outlook fallback did not preserve the anchor message: %#v", batch.Messages)
	}
	if !strings.Contains(batch.MetadataUpdates[outlookDeltaLinkKey], "fresh") {
		t.Fatalf("Outlook cursor did not advance after fallback: %#v", batch.MetadataUpdates)
	}
}

func TestGetProviderJSONRetriesTruncatedSuccessResponse(t *testing.T) {
	attempts := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		attempts++
		w.Header().Set("Content-Type", "application/json")
		if attempts == 1 {
			_, _ = w.Write([]byte(`{"value":[`))
			return
		}
		_, _ = w.Write([]byte(`{"value":["ok"]}`))
	}))
	defer server.Close()

	var parsed struct {
		Value []string `json:"value"`
	}
	if err := getProviderJSON(context.Background(), "token", server.URL, &parsed); err != nil {
		t.Fatalf("provider JSON retry failed: %v", err)
	}
	if attempts != 2 || len(parsed.Value) != 1 || parsed.Value[0] != "ok" {
		t.Fatalf("unexpected provider retry result: attempts=%d parsed=%#v", attempts, parsed)
	}
}

func TestReadEmailProviderResponseBodyRejectsOversizedPayload(t *testing.T) {
	_, err := readEmailProviderResponseBody(strings.NewReader(strings.Repeat("x", 33)), 32)
	if err == nil || !errors.Is(err, errEmailProviderResponseTooLarge) || !strings.Contains(err.Error(), "exceeded") {
		t.Fatalf("expected explicit oversized response error, got %v", err)
	}
}

func TestFetchOutlookSyncBatchRecoversOversizedDeltaCursor(t *testing.T) {
	oldCursorRequests := 0
	var graphServer *httptest.Server
	graphServer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/delta-old" {
			oldCursorRequests++
			_, _ = w.Write([]byte(`{"value":["` + strings.Repeat("x", int(emailProviderMaxJSONBytes)) + `"]}`))
			return
		}
		if r.URL.Path == "/me/mailFolders/inbox/messages/delta" {
			_, _ = w.Write([]byte(`{"value":[],"@odata.deltaLink":"` + graphServer.URL + `/delta-new"}`))
			return
		}
		t.Fatalf("unexpected Graph path: %s", r.URL.Path)
	}))
	defer graphServer.Close()
	t.Setenv("OUTLOOK_GRAPH_BASE_URL", graphServer.URL)

	source := ShopSource{
		CreatedAt: time.Now().UTC().Add(-time.Hour),
		Metadata: map[string]string{
			outlookDeltaLinkKey:   graphServer.URL + "/delta-old",
			emailSyncVersionKey:   emailSyncVersionCurrent,
			emailSyncStartedAtKey: time.Now().UTC().Add(-time.Hour).Format(time.RFC3339Nano),
			"email_last_sync_at":  time.Now().UTC().Add(-time.Minute).Format(time.RFC3339Nano),
		},
	}
	batch, err := fetchOutlookSyncBatch(context.Background(), "token", "support@example.com", source)
	if err != nil {
		t.Fatal(err)
	}
	if oldCursorRequests != 1 {
		t.Fatalf("oversized cursor was retried %d times, want 1", oldCursorRequests)
	}
	if batch.MetadataUpdates[outlookDeltaLinkKey] != graphServer.URL+"/delta-new" ||
		batch.MetadataUpdates["email_cursor_recovered_at"] == "" {
		t.Fatalf("Outlook cursor was not recovered: %#v", batch.MetadataUpdates)
	}
}

func TestExpandOutlookMessagesUsesPreviewWhenDetailIsOversized(t *testing.T) {
	detailRequests := 0
	graphServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/me/messages/message-large" {
			t.Fatalf("unexpected Graph path: %s", r.URL.Path)
		}
		detailRequests++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"body":{"content":"` + strings.Repeat("x", int(emailProviderMaxJSONBytes)) + `"}}`))
	}))
	defer graphServer.Close()
	t.Setenv("OUTLOOK_GRAPH_BASE_URL", graphServer.URL)

	anchor := platformOutlookMessage{
		ID:               "message-large",
		ConversationID:   "conversation-large",
		Subject:          "Large email",
		ReceivedDateTime: time.Now().UTC().Format(time.RFC3339),
		BodyPreview:      "Readable preview",
	}
	anchor.From.EmailAddress.Name = "Customer"
	anchor.From.EmailAddress.Address = "customer@example.com"

	messages, err := expandOutlookMessages(context.Background(), "token", "support@example.com", []platformOutlookMessage{anchor}, 0,
		func(string) (bool, error) { return true, nil })
	if err != nil {
		t.Fatal(err)
	}
	if detailRequests != 1 {
		t.Fatalf("oversized detail was retried %d times, want 1", detailRequests)
	}
	if len(messages) != 1 || messages[0].Body != "Readable preview" ||
		messages[0].Metadata["outlook_content_truncated"] != "true" {
		t.Fatalf("oversized Outlook message did not use its preview: %#v", messages)
	}
}

func TestFetchOutlookImageAttachmentsAvoidsDerivedContentBytesSelect(t *testing.T) {
	image := base64.StdEncoding.EncodeToString([]byte("png-image"))
	graphServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/me/messages/message-1/attachments" {
			t.Fatalf("unexpected Graph path: %s", r.URL.Path)
		}
		if selected := r.URL.Query().Get("$select"); selected != "" {
			t.Fatalf("attachment collection must not select derived properties, got %q", selected)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"value":[{"@odata.type":"#microsoft.graph.fileAttachment","name":"proof.png","contentType":"image/png","contentBytes":"` + image + `"},{"@odata.type":"#microsoft.graph.referenceAttachment","name":"cloud-link","contentType":null}]}`))
	}))
	defer graphServer.Close()
	t.Setenv("OUTLOOK_GRAPH_BASE_URL", graphServer.URL)

	attachments, err := fetchOutlookImageAttachments(context.Background(), "token", "message-1")
	if err != nil {
		t.Fatalf("fetch Outlook image attachments failed: %v", err)
	}
	if len(attachments) != 1 || attachments[0].FileName != "proof.png" || string(attachments[0].Content) != "png-image" {
		t.Fatalf("unexpected Outlook attachments: %#v", attachments)
	}
}

func TestFetchOutlookAllAttachmentsPaginatesDocumentsAndInlineImages(t *testing.T) {
	pdf := base64.StdEncoding.EncodeToString([]byte("pdf-data"))
	image := base64.StdEncoding.EncodeToString([]byte("image-data"))
	requests := 0
	graphServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.URL.Path != "/me/messages/message-all/attachments" || r.URL.Query().Get("$top") != "1" {
			t.Fatalf("unexpected Graph attachment request: %s", r.URL.String())
		}
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Query().Get("page") == "2" {
			_, _ = w.Write([]byte(`{"value":[{"@odata.type":"#microsoft.graph.fileAttachment","id":"inline-1","name":"photo.png","contentType":"image/png","size":10,"isInline":true,"contentBytes":"` + image + `"}]}`))
			return
		}
		next := graphServerURLForRequest(r) + "/me/messages/message-all/attachments?%24top=1&page=2"
		_, _ = w.Write([]byte(`{"@odata.nextLink":"` + next + `","value":[{"@odata.type":"#microsoft.graph.fileAttachment","id":"document-1","name":"statement.pdf","contentType":"application/pdf","size":8,"contentBytes":"` + pdf + `"}]}`))
	}))
	defer graphServer.Close()
	t.Setenv("OUTLOOK_GRAPH_BASE_URL", graphServer.URL)

	attachments, warnings, err := fetchOutlookAllAttachments(context.Background(), "token", "message-all")
	if err != nil {
		t.Fatalf("fetch Outlook attachments failed: %v", err)
	}
	if requests != 2 || len(warnings) != 0 || len(attachments) != 2 || attachments[0].FileName != "statement.pdf" || string(attachments[0].Content) != "pdf-data" ||
		attachments[1].FileName != "photo.png" || string(attachments[1].Content) != "image-data" || !attachments[1].Inline {
		t.Fatalf("unexpected paged Outlook attachments: requests=%d attachments=%#v warnings=%#v", requests, attachments, warnings)
	}
}

func graphServerURLForRequest(r *http.Request) string {
	return "http://" + r.Host
}

func TestFetchGmailAllAttachmentsIncludesDocumentsAndInlineImages(t *testing.T) {
	image := base64.RawURLEncoding.EncodeToString([]byte("inline-image"))
	gmailServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/users/me/messages/message-all/attachments/missing-1" {
			http.NotFound(w, r)
			return
		}
		if r.URL.Path != "/users/me/messages/message-all/attachments/image-1" {
			t.Fatalf("unexpected Gmail attachment request: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":"` + image + `"}`))
	}))
	defer gmailServer.Close()
	t.Setenv("GMAIL_API_BASE_URL", gmailServer.URL)
	payload := platformGmailPayload{MimeType: "multipart/mixed", Parts: []platformGmailPayload{
		{PartID: "1", MimeType: "application/pdf", Filename: "statement.pdf", Headers: []platformGmailHeader{{Name: "Content-Disposition", Value: "attachment"}}, Body: platformGmailBody{Data: base64.RawURLEncoding.EncodeToString([]byte("pdf-data")), Size: 8}},
		{PartID: "2", MimeType: "image/png", Filename: "photo.png", Headers: []platformGmailHeader{{Name: "Content-Disposition", Value: "inline"}, {Name: "Content-ID", Value: "<photo>"}}, Body: platformGmailBody{AttachmentID: "image-1", Size: 12}},
		{PartID: "3", MimeType: "application/pdf", Filename: "missing.pdf", Headers: []platformGmailHeader{{Name: "Content-Disposition", Value: "attachment"}}, Body: platformGmailBody{AttachmentID: "missing-1", Size: 10}},
	}}

	attachments, warnings, err := fetchGmailAllAttachments(context.Background(), "token", "message-all", payload)
	if err != nil {
		t.Fatalf("fetch Gmail attachments failed: %v", err)
	}
	if len(warnings) != 1 || !strings.Contains(warnings[0], "missing.pdf") || len(attachments) != 2 || attachments[0].FileName != "statement.pdf" || string(attachments[0].Content) != "pdf-data" ||
		attachments[1].FileName != "photo.png" || string(attachments[1].Content) != "inline-image" || !attachments[1].Inline {
		t.Fatalf("unexpected Gmail attachments: attachments=%#v warnings=%#v", attachments, warnings)
	}
}

func TestExpandOutlookMessageQueuesCIDInlineImagesWhenHasAttachmentsIsFalse(t *testing.T) {
	attachmentRequests := 0
	graphServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/me/messages/message-inline":
			_, _ = w.Write([]byte(`{
				"id":"message-inline",
				"conversationId":"conversation-inline",
				"internetMessageId":"<inline@example.com>",
				"subject":"Damaged product",
				"from":{"emailAddress":{"name":"Buyer","address":"buyer@example.com"}},
				"receivedDateTime":"2026-07-28T01:00:00Z",
				"body":{"contentType":"html","content":"<p>Photos attached.</p><img src=\"cid:image001.jpg\">"},
				"hasAttachments":false
			}`))
		case "/me/messages/message-inline/attachments":
			attachmentRequests++
			_, _ = w.Write([]byte(`{"value":[]}`))
		default:
			t.Fatalf("unexpected Graph path: %s", r.URL.Path)
		}
	}))
	defer graphServer.Close()
	t.Setenv("OUTLOOK_GRAPH_BASE_URL", graphServer.URL)

	anchor := platformOutlookMessage{
		ID:               "message-inline",
		ConversationID:   "conversation-inline",
		Subject:          "Damaged product",
		ReceivedDateTime: "2026-07-28T01:00:00Z",
		HasAttachments:   false,
	}
	anchor.From.EmailAddress.Name = "Buyer"
	anchor.From.EmailAddress.Address = "buyer@example.com"

	messages, err := expandOutlookMessages(context.Background(), "token", "support@example.com", []platformOutlookMessage{anchor}, 0,
		func(string) (bool, error) { return true, nil })
	if err != nil {
		t.Fatalf("expand Outlook inline image message failed: %v", err)
	}
	if len(messages) != 1 || len(messages[0].Attachments) != 0 || messages[0].Metadata["email_has_attachments"] != "true" || attachmentRequests != 0 {
		t.Fatalf("inline Outlook image should be deferred to the archive queue: %#v requests=%d", messages, attachmentRequests)
	}
}

func TestRecentOutlookInlineImageBackfillQueuesExistingConversation(t *testing.T) {
	attachmentRequests := 0
	graphServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/me/mailFolders/inbox/messages":
			if r.URL.Query().Get("$orderby") != "receivedDateTime desc" || r.URL.Query().Get("$top") != outlookMessagePageSize {
				t.Fatalf("unexpected inline image backfill query: %s", r.URL.RawQuery)
			}
			_, _ = w.Write([]byte(`{"value":[{
				"id":"message-backfill",
				"conversationId":"conversation-backfill",
				"subject":"Photos",
				"from":{"emailAddress":{"name":"Buyer","address":"buyer@example.com"}},
				"receivedDateTime":"2026-07-28T02:00:00Z",
				"bodyPreview":"Photos attached",
				"hasAttachments":false
			}]}`))
		case "/me/messages/message-backfill":
			_, _ = w.Write([]byte(`{
				"id":"message-backfill",
				"conversationId":"conversation-backfill",
				"subject":"Photos",
				"from":{"emailAddress":{"name":"Buyer","address":"buyer@example.com"}},
				"receivedDateTime":"2026-07-28T02:00:00Z",
				"body":{"contentType":"html","content":"<p>Photos attached</p><IMG SRC='CID:photo.jpg'>"},
				"hasAttachments":false
			}`))
		case "/me/messages/message-backfill/attachments":
			attachmentRequests++
			_, _ = w.Write([]byte(`{"value":[]}`))
		default:
			t.Fatalf("unexpected Graph path: %s", r.URL.Path)
		}
	}))
	defer graphServer.Close()
	t.Setenv("OUTLOOK_GRAPH_BASE_URL", graphServer.URL)

	source := ShopSource{
		Provider:  "outlook",
		CreatedAt: time.Now().UTC().Add(-24 * time.Hour),
		Metadata:  map[string]string{emailSyncStartedAtKey: time.Now().UTC().Add(-24 * time.Hour).Format(time.RFC3339Nano)},
	}
	messages, err := fetchRecentOutlookInlineImageCandidates(context.Background(), "token", "support@example.com", source,
		func(string) (bool, error) { return true, nil })
	if err != nil {
		t.Fatalf("Outlook inline image backfill failed: %v", err)
	}
	if len(messages) != 1 || len(messages[0].Attachments) != 0 || messages[0].Metadata["email_has_attachments"] != "true" || attachmentRequests != 0 {
		t.Fatalf("Outlook inline image backfill should defer attachment storage: %#v requests=%d", messages, attachmentRequests)
	}
}

func TestFetchGmailImageAttachmentsSupportsInlineBodyData(t *testing.T) {
	image := base64.RawURLEncoding.EncodeToString([]byte("inline-png"))
	payload := platformGmailPayload{
		MimeType: "multipart/related",
		Parts: []platformGmailPayload{
			{
				MimeType: "image/png",
				Filename: "inline.png",
				Body:     platformGmailBody{Data: image},
			},
		},
	}

	attachments, err := fetchGmailImageAttachments(context.Background(), "token", "gmail-inline", payload)
	if err != nil {
		t.Fatalf("fetch Gmail inline image failed: %v", err)
	}
	if len(attachments) != 1 || attachments[0].FileName != "inline.png" || string(attachments[0].Content) != "inline-png" {
		t.Fatalf("inline Gmail image was not decoded: %#v", attachments)
	}
}

func TestEmailAuthorizationStateCarriesInitialImportChoice(t *testing.T) {
	state := signedEmailState("shop-1", emailInitialImportRecent, "secret")
	shopID, mode, ok := verifySignedEmailState(state, "secret")
	if !ok || shopID != "shop-1" || mode != emailInitialImportRecent {
		t.Fatalf("email auth state did not preserve import mode: shop=%q mode=%q ok=%v", shopID, mode, ok)
	}
	if _, _, ok := verifySignedEmailState(state, "wrong-secret"); ok {
		t.Fatal("email auth state accepted the wrong signature")
	}
	parsed, err := url.Parse("https://example.test/?state=" + url.QueryEscape(state))
	if err != nil || parsed.Query().Get("state") != state {
		t.Fatalf("email auth state is not URL-safe: %v", err)
	}
}

func TestBoundIncomingEmailMessagesAppliesFinalWindowAndNewestLimit(t *testing.T) {
	since := time.Date(2026, 7, 7, 0, 0, 0, 0, time.UTC)
	messages := []incomingEmailMessage{{SourceMessageID: "too-old", ReceivedAt: since.Add(-time.Second)}}
	for index := 0; index < 150; index++ {
		messages = append(messages, incomingEmailMessage{ReceivedAt: since.Add(time.Duration(index) * time.Minute)})
	}

	bounded := boundIncomingEmailMessages(messages, since, emailThreadBackfillLimit)
	if len(bounded) != emailThreadBackfillLimit {
		t.Fatalf("expected final import cap %d, got %d", emailThreadBackfillLimit, len(bounded))
	}
	if !bounded[0].ReceivedAt.Equal(since.Add(130*time.Minute)) || !bounded[len(bounded)-1].ReceivedAt.Equal(since.Add(149*time.Minute)) {
		t.Fatalf("expected newest messages inside the window, got %s through %s", bounded[0].ReceivedAt, bounded[len(bounded)-1].ReceivedAt)
	}
}

func TestBoundIncomingEmailMessagesKeepsOlderContextForRecentConversation(t *testing.T) {
	since := time.Date(2026, 7, 7, 0, 0, 0, 0, time.UTC)
	messages := []incomingEmailMessage{
		{ExternalConversationID: "recent-thread", SourceMessageID: "old-context", ReceivedAt: since.Add(-24 * time.Hour)},
		{ExternalConversationID: "recent-thread", SourceMessageID: "new-anchor", ReceivedAt: since.Add(time.Minute)},
		{ExternalConversationID: "old-thread", SourceMessageID: "unrelated-old", ReceivedAt: since.Add(-time.Hour)},
	}
	bounded := boundIncomingEmailMessages(messages, since, 0)
	if len(bounded) != 2 || bounded[0].SourceMessageID != "old-context" || bounded[1].SourceMessageID != "new-anchor" {
		t.Fatalf("thread history boundary dropped valid context or kept unrelated history: %#v", bounded)
	}
}

func gmailImageMessageJSON(messageID string, threadID string, body string, image string) string {
	return `{"id":"` + messageID + `","threadId":"` + threadID + `","labelIds":["INBOX"],"internalDate":"1784000000000","payload":{"mimeType":"multipart/mixed","headers":[{"name":"From","value":"Buyer <buyer@example.com>"},{"name":"Subject","value":"Image help"},{"name":"Message-ID","value":"<image@example.com>"}],"parts":[{"mimeType":"text/plain","body":{"data":"` + body + `"}},{"mimeType":"image/png","filename":"proof.png","body":{"data":"` + image + `"}}]}}`
}

func mustShopSource(t *testing.T, store Store, shopID string, sourceID string) ShopSource {
	t.Helper()
	sources, err := store.ListShopSources(context.Background(), shopID)
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range sources {
		if source.ID == sourceID {
			return source
		}
	}
	t.Fatalf("source %s not found", sourceID)
	return ShopSource{}
}
