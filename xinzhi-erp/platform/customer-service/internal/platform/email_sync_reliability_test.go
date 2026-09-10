package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"
)

func TestFetchGmailHistoryRefsBatchCheckpointsAtHistoryBoundary(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("startHistoryId"); got != "100" {
			t.Fatalf("startHistoryId = %q, want 100", got)
		}
		history := make([]map[string]any, 0, 3)
		for recordIndex, count := range []int{100, 100, 1} {
			added := make([]map[string]any, 0, count)
			for messageIndex := 0; messageIndex < count; messageIndex++ {
				added = append(added, map[string]any{"message": map[string]any{
					"id": "message-" + strconv.Itoa(recordIndex) + "-" + strconv.Itoa(messageIndex),
				}})
			}
			history = append(history, map[string]any{"id": strconv.Itoa(101 + recordIndex), "messagesAdded": added})
		}
		writeJSONResponse(w, http.StatusOK, map[string]any{"history": history, "historyId": "104"})
	}))
	defer provider.Close()
	t.Setenv("GMAIL_API_BASE_URL", provider.URL)

	refs, cursor, backlog, err := fetchGmailHistoryRefsBatch(context.Background(), "token", "100", false, 200)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 200 || cursor != "102" || !backlog {
		t.Fatalf("batch = refs:%d cursor:%q backlog:%v, want 200/102/true", len(refs), cursor, backlog)
	}
}

func TestFetchOutlookDeltaPagePersistsNextLink(t *testing.T) {
	var provider *httptest.Server
	provider = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSONResponse(w, http.StatusOK, map[string]any{
			"value":           []map[string]string{{"id": "message-1"}},
			"@odata.nextLink": provider.URL + "/delta?page=2",
		})
	}))
	defer provider.Close()
	t.Setenv("OUTLOOK_GRAPH_BASE_URL", provider.URL)

	anchors, cursor, backlog, err := fetchOutlookDeltaPage(context.Background(), "token", provider.URL+"/delta?page=1")
	if err != nil {
		t.Fatal(err)
	}
	if len(anchors) != 1 || cursor != provider.URL+"/delta?page=2" || !backlog {
		t.Fatalf("delta page = anchors:%d cursor:%q backlog:%v", len(anchors), cursor, backlog)
	}
}

func TestRollingEmailIngressProtectionIsolatesThenPausesFlood(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	shop, _ := store.CreateShop(ctx, Shop{DisplayName: "Flood"})
	source, _ := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeEmail, Provider: "gmail", Address: "support@example.com"})
	server := NewServer(store)
	metadata := map[string]string{}
	for batchIndex := 0; batchIndex < 5; batchIndex++ {
		messages := make([]incomingEmailMessage, 101)
		for index := 0; index < 100; index++ {
			messages[index] = incomingEmailMessage{
				SenderEmail: "loop@example.com", Subject: "Automatic reply",
				ExternalConversationID: "thread-" + strconv.Itoa(batchIndex*100+index), Metadata: map[string]string{},
			}
		}
		messages[100] = incomingEmailMessage{SenderEmail: "buyer@example.com", Subject: "Order question", Metadata: map[string]string{}}
		var isolated int
		var paused bool
		var err error
		metadata, isolated, paused, err = server.applyRollingEmailIngressProtection(ctx, source, messages, metadata)
		if err != nil || isolated != 100 {
			t.Fatalf("batch %d protection = isolated:%d paused:%v err:%v", batchIndex, isolated, paused, err)
		}
		if paused != (batchIndex == 4) {
			t.Fatalf("batch %d paused = %v", batchIndex, paused)
		}
		for _, message := range messages[:100] {
			if message.Classification != ConversationKindSystem || message.Metadata["email_ingress_isolation"] != "rolling_rate_limit" {
				t.Fatalf("flood message was not isolated: %#v", message)
			}
		}
		if messages[100].Classification == ConversationKindSystem || messages[100].Metadata["email_ingress_isolation"] != "" {
			t.Fatalf("legitimate message was isolated with the flooding sender: %#v", messages[100])
		}
	}
	if metadata[emailManualPausedByKey] != emailFloodSystemPauseActor || metadata["email_flood_pause_count"] != "500" {
		t.Fatalf("flood pause metadata = %#v", metadata)
	}
	if err := server.updateEmailSourceSyncState(ctx, source, true, nil, metadata); err != nil {
		t.Fatal(err)
	}
	pausedSource, err := store.GetShopSource(ctx, shop.ID, source.ID)
	if err != nil || pausedSource.Metadata["email_sync_status"] != "paused" {
		t.Fatalf("flood pause was overwritten by success state: source=%#v err=%v", pausedSource, err)
	}
}

func TestSetEmailSourceManualPausePreservesConnectionAndCursor(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Pause mailbox", Status: ShopStatusActive})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{
		ShopID: shop.ID, Type: SourceTypeEmail, Provider: "gmail", Address: "support@example.com", Status: SourceStatusActive,
		Metadata: map[string]string{gmailHistoryIDKey: "12345"},
	})
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(store)
	paused, err := server.setEmailSourceManualPause(ctx, shop.ID, source.ID, true, "admin-1")
	if err != nil {
		t.Fatal(err)
	}
	if paused.Status != SourceStatusActive || paused.Metadata[gmailHistoryIDKey] != "12345" || paused.Metadata[emailManualPausedAtKey] == "" {
		t.Fatalf("pause changed connection or cursor: %#v", paused)
	}
	resumed, err := server.setEmailSourceManualPause(ctx, shop.ID, source.ID, false, "admin-1")
	if err != nil {
		t.Fatal(err)
	}
	if resumed.Metadata[emailManualPausedAtKey] != "" || resumed.Metadata[gmailHistoryIDKey] != "12345" {
		t.Fatalf("resume did not preserve cursor: %#v", resumed.Metadata)
	}
}

func TestOutlookMissedLifecycleRecordsRecoveryCheckpoint(t *testing.T) {
	t.Setenv("PUBLIC_BASE_URL", "https://example.com")
	t.Setenv("OUTLOOK_WEBHOOK_SECRET", "test-webhook-secret")
	ctx := context.Background()
	store := NewMemoryStore()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Missed", Status: ShopStatusActive})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{
		ShopID: shop.ID, Type: SourceTypeEmail, Provider: "outlook", Address: "support@example.com", Status: SourceStatusActive,
		Metadata: map[string]string{outlookSubscriptionIDKey: "subscription-missed"},
	})
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(store)
	cfg := defaultOutlookPushSettings()
	body, _ := json.Marshal(map[string]any{"value": []map[string]any{{
		"subscriptionId": "subscription-missed",
		"clientState":    outlookClientState(cfg, source),
		"lifecycleEvent": "missed",
	}}})
	request := httptest.NewRequest(http.MethodPost, outlookPushPath, bytes.NewReader(body))
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, request)
	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d body = %s", response.Code, response.Body.String())
	}
	updated, err := store.GetShopSource(ctx, shop.ID, source.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Metadata["outlook_missed_notification_at"] == "" {
		t.Fatalf("missed lifecycle was not recorded: %#v", updated.Metadata)
	}
}

func TestSetEmailSyncBacklogMetadataPreservesStartUntilCaughtUp(t *testing.T) {
	started := time.Date(2026, 8, 19, 10, 0, 0, 0, time.UTC).Format(time.RFC3339Nano)
	updates := map[string]string{}
	setEmailSyncBacklogMetadata(updates, map[string]string{emailSyncBacklogSinceKey: started}, true)
	if updates[emailSyncBacklogPendingKey] != "true" || updates[emailSyncBacklogSinceKey] != started {
		t.Fatalf("backlog start changed: %#v", updates)
	}
	setEmailSyncBacklogMetadata(updates, updates, false)
	if updates[emailSyncBacklogPendingKey] != "false" || updates[emailSyncBacklogSinceKey] != "" {
		t.Fatalf("backlog completion was not recorded: %#v", updates)
	}
}

func TestEmailSyncQueueCoalescesAndRerunsEventsReceivedWhileRunning(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	shop, _ := store.CreateShop(ctx, Shop{DisplayName: "Queue"})
	source, _ := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeEmail, Provider: "gmail", Address: "support@example.com"})
	now := time.Now().UTC()
	_, err := store.EnqueueEmailSyncJob(ctx, EmailSyncJob{ShopID: shop.ID, SourceID: source.ID, Provider: "gmail", Priority: emailSyncPriorityReconcile, Reason: "reconciliation", AvailableAt: now})
	if err != nil {
		t.Fatal(err)
	}
	coalesced, err := store.EnqueueEmailSyncJob(ctx, EmailSyncJob{ShopID: shop.ID, SourceID: source.ID, Provider: "gmail", Priority: emailSyncPriorityPush, Reason: "push", AvailableAt: now})
	if err != nil || coalesced.Priority != emailSyncPriorityPush || len(store.emailSyncJobs) != 1 {
		t.Fatalf("queue did not coalesce: job=%#v count=%d err=%v", coalesced, len(store.emailSyncJobs), err)
	}
	claimed, err := store.ClaimEmailSyncJob(ctx, "gmail", now.Add(time.Second))
	if err != nil || claimed.Status != "running" || claimed.Attempts != 1 {
		t.Fatalf("claim = %#v err=%v", claimed, err)
	}
	_, err = store.EnqueueEmailSyncJob(ctx, EmailSyncJob{ShopID: shop.ID, SourceID: source.ID, Provider: "gmail", Priority: emailSyncPriorityPush, Reason: "push while running", AvailableAt: now})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.FinishEmailSyncJob(ctx, source.ID, false, time.Time{}, ""); err != nil {
		t.Fatal(err)
	}
	rerun, err := store.ClaimEmailSyncJob(ctx, "gmail", time.Now().Add(time.Second))
	if err != nil || rerun.Attempts != 2 {
		t.Fatalf("event received while running was lost: job=%#v err=%v", rerun, err)
	}
}

func TestEmailSyncQueueSleepsUntilPersistedFutureRetry(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	shop, _ := store.CreateShop(ctx, Shop{DisplayName: "Future retry", Status: ShopStatusActive})
	next := time.Now().UTC().Add(2 * time.Hour).Truncate(time.Second)
	source, _ := store.CreateShopSource(ctx, ShopSource{
		ShopID: shop.ID, Type: SourceTypeEmail, Provider: standardMailProvider, Address: "support@126.com", Status: SourceStatusActive,
		Metadata: map[string]string{emailRetryStateKey: emailRetryStateWaiting, emailRetryNextAtKey: next.Format(time.RFC3339Nano), standardMailServiceKey: "netease"},
	})
	server := NewServer(store)
	if err := server.enqueueEmailSourceSync(ctx, source, "provider retry", next); err != nil {
		t.Fatal(err)
	}
	job, ok := store.emailSyncJobs[source.ID]
	availableAt, nextErr := store.NextEmailSyncJobAvailableAt(ctx, standardMailProvider)
	if !ok || !job.AvailableAt.Equal(next) || job.Reason != "provider retry" || nextErr != nil || !availableAt.Equal(next) {
		t.Fatalf("future retry was not durably scheduled: %#v", job)
	}
}

func TestProviderRetryAfterIsPersistedInsteadOfBlockingWorker(t *testing.T) {
	calls := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.Header().Set("Retry-After", "3600")
		http.Error(w, `{"error":"rate_limited"}`, http.StatusTooManyRequests)
	}))
	defer provider.Close()
	started := time.Now()
	var target map[string]any
	err := getProviderJSON(context.Background(), "token", provider.URL, &target)
	if err == nil || calls != 1 || time.Since(started) > time.Second {
		t.Fatalf("long Retry-After blocked inline: calls=%d elapsed=%s err=%v", calls, time.Since(started), err)
	}
	var providerErr *emailProviderHTTPError
	if !errors.As(err, &providerErr) || providerErr.RetryAfter != "3600" {
		t.Fatalf("Retry-After was not preserved: %v", err)
	}
}

func TestEmailProviderRetryGateIsolatesOneMailboxAndEscalatesIndependentFailures(t *testing.T) {
	server := NewServer(NewMemoryStore())
	next := time.Now().UTC().Add(10 * time.Minute)
	failure := func(sourceID string) {
		server.setEmailProviderRetryGate("outlook", ShopSource{ID: sourceID, Metadata: map[string]string{
			emailRetryErrorCodeKey: "provider_unavailable",
			emailRetryNextAtKey:    next.Format(time.RFC3339Nano),
		}})
	}
	failure("mailbox-a")
	got, blocked := server.emailProviderRetryGate("outlook", "mailbox-a", time.Now().UTC())
	if !blocked || !got.Equal(next) {
		t.Fatalf("mailbox retry gate = %s, %v; want %s, true", got, blocked, next)
	}
	if _, blocked := server.emailProviderRetryGate("outlook", "mailbox-b", time.Now().UTC()); blocked {
		t.Fatal("one failed mailbox must not pause its peers")
	}
	failure("mailbox-b")
	failure("mailbox-c")
	if got, blocked := server.emailProviderRetryGate("outlook", "mailbox-d", time.Now().UTC()); !blocked || !got.Equal(next) {
		t.Fatalf("three independent failures should open the provider gate: %s, %v", got, blocked)
	}
	server.clearEmailProviderRetryGate("outlook", "mailbox-a")
	if _, blocked := server.emailProviderRetryGate("outlook", "mailbox-a", time.Now().UTC()); !blocked {
		t.Fatal("clearing one mailbox must not close an active provider-wide recovery window")
	}
}

func TestEmailReadRetryQueueIsBoundedAndBackedOff(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	shop, _ := store.CreateShop(ctx, Shop{DisplayName: "Read retry"})
	source, _ := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeEmail, Provider: "gmail", Address: "support@example.com"})
	ids := make([]string, 1100)
	for index := range ids {
		ids[index] = "message-" + strconv.Itoa(index)
	}
	updated, err := NewServer(store).updatePendingEmailReadMessageIDs(ctx, source, ids, nil, errors.New("temporary provider failure"))
	if err != nil {
		t.Fatal(err)
	}
	pending := pendingEmailReadMessageIDs(updated.Metadata)
	if len(pending) != emailReadPendingMaxIDs || pending[0] != "message-100" || updated.Metadata[emailReadRetryNextAtKey] == "" || updated.Metadata[emailReadRetryFailureCountKey] != "1" {
		t.Fatalf("read retry was not bounded/backed off: pending=%d first=%q metadata=%#v", len(pending), pending[0], updated.Metadata)
	}
}

func TestEmailOutboxRecoversSentResultWithoutCreatingAnotherSend(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	input := EmailOutboxRecord{ShopID: "shop-1", SourceID: "source-1", ConversationID: "conversation-1", ClientRequestID: "request-1", RequestedBy: "user-1", Body: "reply", RequestMetadata: `{}`}
	record, err := store.BeginEmailOutbox(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	record, _ = store.SetEmailOutboxState(ctx, record.ID, "sending", `{}`, "", "")
	record, _ = store.SetEmailOutboxState(ctx, record.ID, "sent", `{"providerMessageId":"provider-1"}`, "", "")
	recovered, err := store.BeginEmailOutbox(ctx, input)
	if err != nil || recovered.ID != record.ID || recovered.Status != "sent" || recovered.Attempts != 1 {
		t.Fatalf("sent outbox result was not recovered: %#v err=%v", recovered, err)
	}
	completed, err := store.SetEmailOutboxState(ctx, recovered.ID, "completed", recovered.ProviderMetadata, "", "message-1")
	if err != nil || completed.Status != "completed" || completed.MessageID != "message-1" {
		t.Fatalf("outbox completion failed: %#v err=%v", completed, err)
	}
}

func TestEmailOutboxMarksInterruptedSendAmbiguous(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	record, _ := store.BeginEmailOutbox(ctx, EmailOutboxRecord{ShopID: "shop-1", SourceID: "source-1", ConversationID: "conversation-1", ClientRequestID: "request-1", RequestedBy: "user-1", Body: "reply", RequestMetadata: `{}`})
	record, _ = store.SetEmailOutboxState(ctx, record.ID, "sending", `{}`, "", "")
	key := emailOutboxKey(record.ConversationID, record.ClientRequestID)
	record.UpdatedAt = time.Now().UTC().Add(-11 * time.Minute)
	store.emailOutbox[key] = record
	recovered, err := store.RecoverEmailOutbox(ctx, time.Now().UTC().Add(-10*time.Minute))
	if err != nil || len(recovered) != 1 || recovered[0].Status != "ambiguous" {
		t.Fatalf("interrupted send recovery=%#v err=%v", recovered, err)
	}
	if emailSendFailureIsExplicit(&emailProviderHTTPError{StatusCode: http.StatusInternalServerError}) {
		t.Fatal("provider 5xx must remain ambiguous because the send result is unknown")
	}
	if !emailSendFailureIsExplicit(newEmailSendProviderError("Gmail", "send", http.StatusUnauthorized, "401 Unauthorized", nil)) {
		t.Fatal("provider 4xx must be reported as an explicit failure because the provider rejected the request")
	}
	if emailSendFailureIsExplicit(newEmailSendProviderError("Gmail", "send", http.StatusRequestTimeout, "408 Request Timeout", nil)) {
		t.Fatal("provider timeout must remain ambiguous because the send result is unknown")
	}
	if !emailSendFailureIsExplicit(fmt.Errorf("%w: conversation must be claimed before replying", ErrConflict)) {
		t.Fatal("local conversation conflicts must remain retryable because no provider send occurred")
	}
}

func TestEmailOutboxClaimsInMailboxOrderWithoutBlockingOtherMailboxes(t *testing.T) {
	store := NewMemoryStore()
	ctx := context.Background()
	begin := func(sourceID, requestID, messageID string) EmailOutboxRecord {
		record, err := store.BeginEmailOutbox(ctx, EmailOutboxRecord{
			ShopID: "shop-1", SourceID: sourceID, ConversationID: "conversation-" + sourceID,
			ClientRequestID: requestID, RequestedBy: "user-1", Body: requestID, RequestMetadata: `{}`,
		})
		if err != nil {
			t.Fatalf("BeginEmailOutbox failed: %v", err)
		}
		record, err = store.SetEmailOutboxState(ctx, record.ID, "pending", `{}`, "", messageID)
		if err != nil {
			t.Fatalf("SetEmailOutboxState failed: %v", err)
		}
		return record
	}
	firstA := begin("source-a", "request-a-1", "message-a-1")
	secondA := begin("source-a", "request-a-2", "message-a-2")
	firstB := begin("source-b", "request-b-1", "message-b-1")

	claimedA, err := store.ClaimPendingEmailOutbox(ctx)
	if err != nil || claimedA.ID != firstA.ID {
		t.Fatalf("first claim = %#v err=%v; want first source-a message", claimedA, err)
	}
	claimedB, err := store.ClaimPendingEmailOutbox(ctx)
	if err != nil || claimedB.ID != firstB.ID {
		t.Fatalf("second claim = %#v err=%v; want independent source-b message", claimedB, err)
	}
	if _, err = store.SetEmailOutboxState(ctx, claimedA.ID, "completed", `{}`, "", claimedA.MessageID); err != nil {
		t.Fatalf("complete first source-a message: %v", err)
	}
	claimedSecondA, err := store.ClaimPendingEmailOutbox(ctx)
	if err != nil || claimedSecondA.ID != secondA.ID {
		t.Fatalf("third claim = %#v err=%v; want second source-a message", claimedSecondA, err)
	}
}

func TestEmailRuntimeEventsPersistAndExpire(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	old := time.Now().UTC().Add(-31 * 24 * time.Hour)
	_, _ = store.SaveEmailRuntimeEvent(ctx, EmailRuntimeEvent{Category: "sync.failed", Severity: "error", Message: "old", CreatedAt: old})
	_, _ = store.SaveEmailRuntimeEvent(ctx, EmailRuntimeEvent{Category: "flood.paused", Severity: "warning", Message: "current"})
	deleted, err := store.DeleteEmailRuntimeEventsBefore(ctx, time.Now().UTC().Add(-emailRuntimeEventRetention))
	if err != nil || deleted != 1 {
		t.Fatalf("event cleanup = %d err=%v", deleted, err)
	}
	events, err := store.ListEmailRuntimeEvents(ctx, 10)
	if err != nil || len(events) != 1 || events[0].Message != "current" {
		t.Fatalf("events = %#v err=%v", events, err)
	}
}
