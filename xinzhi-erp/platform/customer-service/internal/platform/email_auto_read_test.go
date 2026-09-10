package platform

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestEmailPreviewDoesNotMarkGmailReadUntilClaim(t *testing.T) {
	var modifyCount atomic.Int32
	gmailServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/users/me/messages/gmail-message-1/modify" {
			t.Fatalf("unexpected Gmail read request: %s %s", r.Method, r.URL.Path)
		}
		var payload map[string][]string
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode Gmail modify payload failed: %v", err)
		}
		if strings.Join(payload["removeLabelIds"], ",") != "UNREAD" {
			t.Fatalf("expected Gmail UNREAD label removal, got %#v", payload)
		}
		modifyCount.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"gmail-message-1"}`))
	}))
	defer gmailServer.Close()
	t.Setenv("GMAIL_API_BASE_URL", gmailServer.URL)

	env := newEmailAutoReadTestEnv(t, "gmail", nil)
	conversation := env.createConversation(t)
	message, _, err := env.store.AddMessage(context.Background(), Message{
		ConversationID:  conversation.ID,
		Direction:       MessageDirectionCustomer,
		Body:            "Please help with my order.",
		SourceMessageID: "gmail:gmail-message-1",
		Metadata:        map[string]string{"gmail_message_id": "gmail-message-1"},
	})
	if err != nil {
		t.Fatalf("AddMessage failed: %v", err)
	}

	var readResponse conversationReadResponse
	requestJSON(t, http.MethodPost, env.server.URL+"/api/v1/conversations/"+conversation.ID+"/read", env.token, conversationReadRequest{ThroughMessageID: message.ID}, http.StatusOK, &readResponse)
	if modifyCount.Load() != 0 {
		t.Fatalf("unclaimed preview changed Gmail read state %d time(s)", modifyCount.Load())
	}

	requestJSON(t, http.MethodPost, env.server.URL+"/api/v1/conversations/"+conversation.ID+"/claim", env.token, nil, http.StatusOK, nil)
	if modifyCount.Load() != 0 {
		t.Fatalf("claim must not wait for Gmail read state, got %d provider call(s)", modifyCount.Load())
	}
	queued := mustShopSource(t, env.store, env.shop.ID, env.source.ID)
	if pending := pendingEmailReadMessageIDs(queued.Metadata); len(pending) != 1 || pending[0] != "gmail-message-1" {
		t.Fatalf("claim did not durably queue Gmail read state: %#v", queued.Metadata)
	}
	env.processNextEmailReadJob(t)
	if modifyCount.Load() != 1 {
		t.Fatalf("background retry should mark the current Gmail message read once, got %d", modifyCount.Load())
	}
	updated := mustShopSource(t, env.store, env.shop.ID, env.source.ID)
	if pendingEmailReadMessageIDs(updated.Metadata) != nil || updated.Metadata[emailReadSyncStatusKey] != "ok" {
		t.Fatalf("successful Gmail sync left pending state: %#v", updated.Metadata)
	}
}

func TestAssignedEmailReadSyncStopsAtVisibleOutlookMessage(t *testing.T) {
	var firstCount atomic.Int32
	var secondCount atomic.Int32
	graphServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch {
			t.Fatalf("unexpected Outlook read method: %s", r.Method)
		}
		switch r.URL.Path {
		case "/me/messages/outlook-message-1":
			firstCount.Add(1)
		case "/me/messages/outlook-message-2":
			secondCount.Add(1)
		default:
			t.Fatalf("unexpected Outlook read path: %s", r.URL.Path)
		}
		body, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(body), `"isRead":true`) {
			t.Fatalf("expected Outlook isRead=true payload, got %s", body)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer graphServer.Close()
	t.Setenv("OUTLOOK_GRAPH_BASE_URL", graphServer.URL)

	env := newEmailAutoReadTestEnv(t, "outlook", nil)
	conversation := env.createConversation(t)
	requestJSON(t, http.MethodPost, env.server.URL+"/api/v1/conversations/"+conversation.ID+"/claim", env.token, nil, http.StatusOK, nil)

	first, _, err := env.store.AddMessage(context.Background(), Message{
		ConversationID:  conversation.ID,
		Direction:       MessageDirectionCustomer,
		Body:            "First message",
		SourceMessageID: "outlook:outlook-message-1",
		Metadata:        map[string]string{"outlook_message_id": "outlook-message-1"},
		CreatedAt:       time.Now().UTC().Add(-2 * time.Minute),
	})
	if err != nil {
		t.Fatalf("AddMessage first failed: %v", err)
	}
	second, _, err := env.store.AddMessage(context.Background(), Message{
		ConversationID:  conversation.ID,
		Direction:       MessageDirectionCustomer,
		Body:            "Second message",
		SourceMessageID: "outlook:outlook-message-2",
		Metadata:        map[string]string{"outlook_message_id": "outlook-message-2"},
		CreatedAt:       time.Now().UTC().Add(-time.Minute),
	})
	if err != nil {
		t.Fatalf("AddMessage second failed: %v", err)
	}

	requestJSON(t, http.MethodPost, env.server.URL+"/api/v1/conversations/"+conversation.ID+"/read", env.token, conversationReadRequest{ThroughMessageID: first.ID}, http.StatusOK, nil)
	if firstCount.Load() != 0 || secondCount.Load() != 0 {
		t.Fatalf("read acknowledgement must not wait for Outlook: first=%d second=%d", firstCount.Load(), secondCount.Load())
	}
	env.processNextEmailReadJob(t)
	if firstCount.Load() != 1 || secondCount.Load() != 0 {
		t.Fatalf("first visible boundary queued wrong Outlook messages: first=%d second=%d", firstCount.Load(), secondCount.Load())
	}
	unread, err := env.store.ListUnreadConversationIDs(context.Background(), env.user.ID)
	if err != nil || !containsString(unread, conversation.ID) {
		t.Fatalf("message beyond visible boundary should remain unread: ids=%v err=%v", unread, err)
	}

	requestJSON(t, http.MethodPost, env.server.URL+"/api/v1/conversations/"+conversation.ID+"/read", env.token, conversationReadRequest{ThroughMessageID: second.ID, AfterMessageID: first.ID}, http.StatusOK, nil)
	env.processNextEmailReadJob(t)
	if firstCount.Load() != 1 || secondCount.Load() != 1 {
		t.Fatalf("second visible boundary did not sync both current messages: first=%d second=%d", firstCount.Load(), secondCount.Load())
	}
	unread, err = env.store.ListUnreadConversationIDs(context.Background(), env.user.ID)
	if err != nil || containsString(unread, conversation.ID) {
		t.Fatalf("fully viewed conversation should be locally read: ids=%v err=%v", unread, err)
	}
}

func TestEmailReadFailureQueuesBackgroundRetryWithoutBlockingClaim(t *testing.T) {
	var failModify atomic.Bool
	var modifyCount atomic.Int32
	failModify.Store(true)
	gmailServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/users/me/messages/gmail-retry-1/modify":
			modifyCount.Add(1)
			if failModify.Load() {
				w.WriteHeader(http.StatusServiceUnavailable)
				_, _ = w.Write([]byte(`{"error":"temporary"}`))
				return
			}
			_, _ = w.Write([]byte(`{"id":"gmail-retry-1"}`))
		case "/users/me/history":
			_, _ = w.Write([]byte(`{"history":[],"historyId":"history-2"}`))
		default:
			t.Fatalf("unexpected Gmail polling path: %s", r.URL.Path)
		}
	}))
	defer gmailServer.Close()
	t.Setenv("GMAIL_API_BASE_URL", gmailServer.URL)

	metadata := newEmailSyncMetadata("support@example.com", "gmail_api", emailInitialImportNow)
	metadata[gmailHistoryIDKey] = "history-1"
	metadata[emailLastReconcileAtKey] = time.Now().UTC().Format(time.RFC3339Nano)
	env := newEmailAutoReadTestEnv(t, "gmail", metadata)
	conversation := env.createConversation(t)
	_, _, err := env.store.AddMessage(context.Background(), Message{
		ConversationID:  conversation.ID,
		Direction:       MessageDirectionCustomer,
		Body:            "Retry this read state",
		SourceMessageID: "gmail:gmail-retry-1",
		Metadata:        map[string]string{"gmail_message_id": "gmail-retry-1"},
	})
	if err != nil {
		t.Fatalf("AddMessage failed: %v", err)
	}

	requestJSON(t, http.MethodPost, env.server.URL+"/api/v1/conversations/"+conversation.ID+"/claim", env.token, nil, http.StatusOK, nil)
	if modifyCount.Load() != 0 {
		t.Fatalf("claim must return before the provider attempt, got %d", modifyCount.Load())
	}
	failedSource := mustShopSource(t, env.store, env.shop.ID, env.source.ID)
	if got := pendingEmailReadMessageIDs(failedSource.Metadata); len(got) != 1 || got[0] != "gmail-retry-1" || failedSource.Metadata[emailReadSyncStatusKey] != "pending" {
		t.Fatalf("failed Gmail sync was not queued: %#v", failedSource.Metadata)
	}

	env.processNextEmailReadJob(t)
	if modifyCount.Load() != 1 {
		t.Fatalf("expected one failed background attempt, got %d", modifyCount.Load())
	}
	failModify.Store(false)
	failedSource = mustShopSource(t, env.store, env.shop.ID, env.source.ID)
	result := env.platform.syncSingleEmailSource(context.Background(), env.shop.ID, "gmail", failedSource)
	if result.SourcesSucceeded != 1 || result.SourcesFailed != 0 || len(result.Warnings) != 0 {
		t.Fatalf("polling retry should continue normal sync: %#v", result)
	}
	if modifyCount.Load() != 2 {
		t.Fatalf("expected failed background attempt plus polling retry, got %d", modifyCount.Load())
	}
	retriedSource := mustShopSource(t, env.store, env.shop.ID, env.source.ID)
	if pendingEmailReadMessageIDs(retriedSource.Metadata) != nil || retriedSource.Metadata[emailReadSyncStatusKey] != "ok" || retriedSource.Metadata[emailReadSyncErrorKey] != "" {
		t.Fatalf("successful polling retry did not clear pending state: %#v", retriedSource.Metadata)
	}
}

func TestMissingOutlookMessageIsRemovedFromReadRetryQueue(t *testing.T) {
	graphServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch || r.URL.Path != "/me/messages/moved-or-deleted" {
			t.Fatalf("unexpected Outlook stale read request: %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":{"code":"ErrorItemNotFound","message":"The specified object was not found."}}`))
	}))
	defer graphServer.Close()
	t.Setenv("OUTLOOK_GRAPH_BASE_URL", graphServer.URL)

	env := newEmailAutoReadTestEnv(t, "outlook", nil)
	source, err := env.platform.updatePendingEmailReadMessageIDs(context.Background(), env.source, []string{"moved-or-deleted"}, nil, errors.New("previous failure"))
	if err != nil {
		t.Fatalf("queue stale Outlook read state failed: %v", err)
	}
	installation, err := env.store.GetEmailInstallation(context.Background(), env.shop.ID, env.source.Address)
	if err != nil {
		t.Fatal(err)
	}
	updated, err := env.platform.retryPendingEmailReadStates(context.Background(), source, installation)
	if err != nil {
		t.Fatalf("missing Outlook message should be terminal, got %v", err)
	}
	if pendingEmailReadMessageIDs(updated.Metadata) != nil || updated.Metadata[emailReadSyncStatusKey] != "ok" || updated.Metadata[emailReadSyncErrorKey] != "" {
		t.Fatalf("stale Outlook read state was not cleared: %#v", updated.Metadata)
	}
}

func TestEmailReadPendingAndSourceSyncMetadataDoNotOverwriteEachOther(t *testing.T) {
	env := newEmailAutoReadTestEnv(t, "gmail", map[string]string{gmailHistoryIDKey: "history-1"})
	staleSource := env.source
	if _, err := env.platform.updatePendingEmailReadMessageIDs(context.Background(), staleSource, []string{"pending-1"}, nil, errors.New("temporary provider failure")); err != nil {
		t.Fatalf("queue pending read failed: %v", err)
	}
	if err := env.platform.updateEmailSourceSyncState(context.Background(), staleSource, true, nil, map[string]string{gmailHistoryIDKey: "history-2"}); err != nil {
		t.Fatalf("update polling metadata failed: %v", err)
	}
	updated := mustShopSource(t, env.store, env.shop.ID, env.source.ID)
	if got := pendingEmailReadMessageIDs(updated.Metadata); len(got) != 1 || got[0] != "pending-1" {
		t.Fatalf("polling metadata update removed pending read state: %#v", updated.Metadata)
	}
	if updated.Metadata[gmailHistoryIDKey] != "history-2" {
		t.Fatalf("polling cursor was not updated: %#v", updated.Metadata)
	}

	if _, err := env.platform.updatePendingEmailReadMessageIDs(context.Background(), staleSource, []string{"pending-2"}, []string{"pending-1"}, errors.New("second provider failure")); err != nil {
		t.Fatalf("replace attempted pending read failed: %v", err)
	}
	updated = mustShopSource(t, env.store, env.shop.ID, env.source.ID)
	if got := pendingEmailReadMessageIDs(updated.Metadata); len(got) != 1 || got[0] != "pending-2" {
		t.Fatalf("pending read mutation did not preserve the current set: %#v", updated.Metadata)
	}
	if updated.Metadata[gmailHistoryIDKey] != "history-2" {
		t.Fatalf("pending read update regressed polling cursor: %#v", updated.Metadata)
	}
}

type emailAutoReadTestEnv struct {
	store    *MemoryStore
	platform *Server
	server   *httptest.Server
	token    string
	user     User
	shop     Shop
	source   ShopSource
}

func (env emailAutoReadTestEnv) processNextEmailReadJob(t *testing.T) {
	t.Helper()
	job, err := env.store.ClaimEmailSyncJob(context.Background(), env.source.Provider, time.Now().UTC().Add(time.Second))
	if err != nil {
		t.Fatalf("claim queued read-state job failed: %v", err)
	}
	env.platform.processEmailSyncJob(context.Background(), env.store, job)
}

func newEmailAutoReadTestEnv(t *testing.T, provider string, metadata map[string]string) emailAutoReadTestEnv {
	t.Helper()
	store := NewMemoryStore()
	platformServer := NewServer(store)
	httpServer := httptest.NewServer(platformServer.Routes())
	t.Cleanup(httpServer.Close)
	token := bootstrapAdmin(t, httpServer.URL)
	var user User
	requestJSON(t, http.MethodGet, httpServer.URL+"/api/v1/auth/me", token, nil, http.StatusOK, &user)
	shop, err := store.CreateShop(context.Background(), Shop{DisplayName: "Email read sync"})
	if err != nil {
		t.Fatalf("CreateShop failed: %v", err)
	}
	if _, err := store.AssignUserToShop(context.Background(), shop.ID, user.ID); err != nil {
		t.Fatalf("AssignUserToShop failed: %v", err)
	}
	source, err := store.CreateShopSource(context.Background(), ShopSource{
		ShopID:   shop.ID,
		Type:     SourceTypeEmail,
		Provider: provider,
		Address:  "support@example.com",
		Metadata: metadata,
	})
	if err != nil {
		t.Fatalf("CreateShopSource failed: %v", err)
	}
	scope := defaultGmailScopes
	if provider == "outlook" {
		scope = defaultOutlookScopes
	}
	if _, err := store.SaveEmailInstallation(context.Background(), EmailInstallation{
		ShopID:      shop.ID,
		Mailbox:     source.Address,
		Provider:    provider,
		AccessToken: "access-token",
		Scope:       scope,
		ExpiresAt:   time.Now().UTC().Add(time.Hour),
	}); err != nil {
		t.Fatalf("SaveEmailInstallation failed: %v", err)
	}
	return emailAutoReadTestEnv{store: store, platform: platformServer, server: httpServer, token: token, user: user, shop: shop, source: source}
}

func (e emailAutoReadTestEnv) createConversation(t *testing.T) Conversation {
	t.Helper()
	conversation, err := e.store.CreateConversation(context.Background(), Conversation{
		ShopID:        e.shop.ID,
		SourceID:      e.source.ID,
		CustomerName:  "Customer",
		CustomerEmail: "customer@example.com",
		Subject:       "Order help",
		Kind:          ConversationKindCustomer,
		ReplyAllowed:  true,
	})
	if err != nil {
		t.Fatalf("CreateConversation failed: %v", err)
	}
	return conversation
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
