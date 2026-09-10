package platform

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestGmailPushValidatesOIDCAndRecordsNotification(t *testing.T) {
	const (
		mailbox        = "support@example.com"
		audience       = "https://example.com/webhooks/email/gmail"
		serviceAccount = "push@example-project.iam.gserviceaccount.com"
	)
	tokenInfo := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("id_token") != "valid-token" {
			t.Fatalf("unexpected tokeninfo token")
		}
		writeJSONResponse(w, http.StatusOK, map[string]any{
			"aud":            audience,
			"email":          serviceAccount,
			"email_verified": true,
			"iss":            "https://accounts.google.com",
			"exp":            time.Now().Add(time.Hour).Unix(),
		})
	}))
	defer tokenInfo.Close()
	t.Setenv("GMAIL_PUBSUB_TOPIC", "projects/example/topics/gmail")
	t.Setenv("GMAIL_PUBSUB_AUDIENCE", audience)
	t.Setenv("GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL", serviceAccount)
	t.Setenv("GMAIL_PUBSUB_TOKENINFO_URL", tokenInfo.URL)

	store := NewMemoryStore()
	shop, err := store.CreateShop(context.Background(), Shop{DisplayName: "Push Shop", Status: ShopStatusActive})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(context.Background(), ShopSource{
		ShopID: shop.ID, Type: SourceTypeEmail, Provider: "gmail", Address: mailbox, Status: SourceStatusActive,
		Metadata: map[string]string{gmailHistoryIDKey: "100"},
	})
	if err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(map[string]any{"emailAddress": mailbox, "historyId": 101})
	envelope := gmailPubSubEnvelope{}
	envelope.Message.Data = base64.StdEncoding.EncodeToString(payload)
	raw, _ := json.Marshal(envelope)
	request := httptest.NewRequest(http.MethodPost, gmailPushPath, bytes.NewReader(raw))
	request.Header.Set("Authorization", "Bearer valid-token")
	response := httptest.NewRecorder()

	NewServer(store).Routes().ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	updated, err := store.GetShopSource(context.Background(), shop.ID, source.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Metadata[gmailPushReceivedAtKey] == "" || updated.Metadata[emailNotificationStatusKey] != "ok" {
		t.Fatalf("Gmail push state was not recorded: %#v", updated.Metadata)
	}
}

func TestDecodeGmailPushDataAcceptsStringAndNumericHistoryID(t *testing.T) {
	for _, testCase := range []struct {
		name    string
		payload string
	}{
		{name: "string", payload: `{"emailAddress":"support@example.com","historyId":"9876543210"}`},
		{name: "number", payload: `{"emailAddress":"support@example.com","historyId":9876543210}`},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			encoded := base64.RawURLEncoding.EncodeToString([]byte(testCase.payload))
			data, err := decodeGmailPushData(encoded)
			if err != nil {
				t.Fatal(err)
			}
			if data.EmailAddress != "support@example.com" || data.HistoryID != "9876543210" {
				t.Fatalf("decoded push data = %#v", data)
			}
		})
	}
}

func TestDecodeGmailPushDataRejectsInvalidHistoryIDType(t *testing.T) {
	payload := `{"emailAddress":"support@example.com","historyId":9876.5}`
	encoded := base64.RawURLEncoding.EncodeToString([]byte(payload))
	if _, err := decodeGmailPushData(encoded); err == nil {
		t.Fatal("expected invalid decimal historyId to be rejected")
	}
}

func TestGmailPushRejectsMismatchedOIDCClaims(t *testing.T) {
	tokenInfo := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSONResponse(w, http.StatusOK, map[string]any{
			"aud": "https://wrong.example/webhook", "email": "wrong@example.com",
			"email_verified": true, "iss": "https://accounts.google.com", "exp": time.Now().Add(time.Hour).Unix(),
		})
	}))
	defer tokenInfo.Close()
	t.Setenv("GMAIL_PUBSUB_TOPIC", "projects/example/topics/gmail")
	t.Setenv("GMAIL_PUBSUB_AUDIENCE", "https://example.com/webhooks/email/gmail")
	t.Setenv("GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL", "push@example-project.iam.gserviceaccount.com")
	t.Setenv("GMAIL_PUBSUB_TOKENINFO_URL", tokenInfo.URL)

	request := httptest.NewRequest(http.MethodPost, gmailPushPath, strings.NewReader(`{"message":{"data":"e30="}}`))
	request.Header.Set("Authorization", "Bearer invalid-claims")
	response := httptest.NewRecorder()
	NewServer(NewMemoryStore()).Routes().ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.Code)
	}
}

func TestGmailPushUpdatesEveryShopUsingTheMailbox(t *testing.T) {
	const (
		mailbox        = "shared@example.com"
		audience       = "https://example.com/webhooks/email/gmail"
		serviceAccount = "push@example-project.iam.gserviceaccount.com"
	)
	tokenInfo := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSONResponse(w, http.StatusOK, map[string]any{
			"aud": audience, "email": serviceAccount, "email_verified": true,
			"iss": "https://accounts.google.com", "exp": time.Now().Add(time.Hour).Unix(),
		})
	}))
	defer tokenInfo.Close()
	t.Setenv("GMAIL_PUBSUB_TOPIC", "projects/example/topics/gmail")
	t.Setenv("GMAIL_PUBSUB_AUDIENCE", audience)
	t.Setenv("GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL", serviceAccount)
	t.Setenv("GMAIL_PUBSUB_TOKENINFO_URL", tokenInfo.URL)

	store := NewMemoryStore()
	var sources []ShopSource
	for _, name := range []string{"Shared Mailbox A", "Shared Mailbox B"} {
		shop, err := store.CreateShop(context.Background(), Shop{DisplayName: name, Status: ShopStatusActive})
		if err != nil {
			t.Fatal(err)
		}
		source, err := store.CreateShopSource(context.Background(), ShopSource{
			ShopID: shop.ID, Type: SourceTypeEmail, Provider: "gmail", Address: mailbox, Status: SourceStatusActive,
		})
		if err != nil {
			t.Fatal(err)
		}
		sources = append(sources, source)
	}
	payload, _ := json.Marshal(gmailPushData{EmailAddress: mailbox, HistoryID: "101"})
	envelope := gmailPubSubEnvelope{}
	envelope.Message.Data = base64.StdEncoding.EncodeToString(payload)
	raw, _ := json.Marshal(envelope)
	request := httptest.NewRequest(http.MethodPost, gmailPushPath, bytes.NewReader(raw))
	request.Header.Set("Authorization", "Bearer shared-mailbox-token")
	response := httptest.NewRecorder()

	NewServer(store).Routes().ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	for _, source := range sources {
		updated, err := store.GetShopSource(context.Background(), source.ShopID, source.ID)
		if err != nil {
			t.Fatal(err)
		}
		if updated.Metadata[gmailPushReceivedAtKey] == "" {
			t.Fatalf("Gmail push was not recorded for source %s", source.ID)
		}
	}
}

func TestOutlookPushValidationAndClientState(t *testing.T) {
	t.Setenv("PUBLIC_BASE_URL", "https://example.com")
	t.Setenv("OUTLOOK_WEBHOOK_SECRET", "test-webhook-secret")

	store := NewMemoryStore()
	shop, err := store.CreateShop(context.Background(), Shop{DisplayName: "Outlook Push Shop", Status: ShopStatusActive})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(context.Background(), ShopSource{
		ShopID: shop.ID, Type: SourceTypeEmail, Provider: "outlook", Address: "support@example.com", Status: SourceStatusActive,
		Metadata: map[string]string{outlookSubscriptionIDKey: "subscription-1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(store)

	validationRequest := httptest.NewRequest(http.MethodPost, outlookPushPath+"?validationToken=hello%20world", nil)
	validationResponse := httptest.NewRecorder()
	server.Routes().ServeHTTP(validationResponse, validationRequest)
	if validationResponse.Code != http.StatusOK || validationResponse.Body.String() != "hello world" {
		t.Fatalf("validation response = %d %q", validationResponse.Code, validationResponse.Body.String())
	}

	cfg := defaultOutlookPushSettings()
	body, _ := json.Marshal(map[string]any{"value": []map[string]any{{
		"subscriptionId":                 "subscription-1",
		"subscriptionExpirationDateTime": time.Now().Add(time.Hour).UTC().Format(time.RFC3339Nano),
		"clientState":                    outlookClientState(cfg, source),
		"changeType":                     "created",
		"resource":                       "Users/example/Messages/message-1",
		"tenantId":                       "tenant-1",
		"resourceData": map[string]any{
			"@odata.type": "#Microsoft.Graph.Message",
			"@odata.id":   "Users/example/Messages/message-1",
			"id":          "message-1",
		},
	}}})
	request := httptest.NewRequest(http.MethodPost, outlookPushPath, bytes.NewReader(body))
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, request)
	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	updated, err := store.GetShopSource(context.Background(), shop.ID, source.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Metadata[outlookPushReceivedAtKey] == "" || updated.Metadata[emailNotificationStatusKey] != "ok" {
		t.Fatalf("Outlook push state was not recorded: %#v", updated.Metadata)
	}
}

func TestRenewGmailWatchUsesInboxTopicAndPersistsExpiration(t *testing.T) {
	var received map[string]any
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/users/me/watch" || r.Method != http.MethodPost {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer access-token" {
			t.Fatalf("missing bearer token")
		}
		raw, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(raw, &received); err != nil {
			t.Fatal(err)
		}
		writeJSONResponse(w, http.StatusOK, map[string]any{
			"historyId":  "9001",
			"expiration": time.Now().Add(7 * 24 * time.Hour).UnixMilli(),
		})
	}))
	defer provider.Close()
	t.Setenv("GMAIL_API_BASE_URL", provider.URL)
	source := ShopSource{Metadata: newEmailSyncMetadata("support@example.com", "gmail_api", emailInitialImportNow)}
	updates, err := renewGmailWatch(context.Background(), "access-token", source, gmailPushSettings{
		Topic: "projects/example/topics/gmail",
	})
	if err != nil {
		t.Fatal(err)
	}
	if received["topicName"] != "projects/example/topics/gmail" {
		t.Fatalf("topicName = %#v", received["topicName"])
	}
	labels, _ := received["labelIds"].([]any)
	if len(labels) != 2 || labels[0] != "INBOX" || labels[1] != "SPAM" {
		t.Fatalf("labelIds = %#v", received["labelIds"])
	}
	if updates[gmailHistoryIDKey] != "" || updates[gmailWatchExpirationKey] == "" {
		t.Fatalf("watch updates = %#v", updates)
	}
}

func TestRenewOutlookSubscriptionCreatesAuthenticatedState(t *testing.T) {
	received := map[string]map[string]string{}
	requestCount := 0
	graph := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/subscriptions" || r.Method != http.MethodPost {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		raw, _ := io.ReadAll(r.Body)
		var payload map[string]string
		if err := json.Unmarshal(raw, &payload); err != nil {
			t.Fatal(err)
		}
		requestCount++
		received[payload["resource"]] = payload
		writeJSONResponse(w, http.StatusCreated, outlookSubscriptionResponse{
			ID:                 "subscription-new-" + strconv.Itoa(requestCount),
			ExpirationDateTime: time.Now().Add(outlookSubscriptionLifetime).UTC().Format(time.RFC3339),
		})
	}))
	defer graph.Close()
	t.Setenv("OUTLOOK_GRAPH_BASE_URL", graph.URL)
	source := ShopSource{ID: "source-1", Metadata: map[string]string{}}
	cfg := outlookPushSettings{NotificationURL: "https://example.com/webhooks/email/outlook", Secret: "secret"}
	updates, err := renewOutlookSubscription(context.Background(), "access-token", source, cfg)
	if err != nil {
		t.Fatal(err)
	}
	inbox := received["/me/mailFolders('inbox')/messages"]
	junk := received["/me/mailFolders('junkemail')/messages"]
	if inbox["notificationUrl"] != cfg.NotificationURL ||
		inbox["lifecycleNotificationUrl"] != cfg.NotificationURL ||
		inbox["clientState"] != outlookClientState(cfg, source) ||
		junk["notificationUrl"] != cfg.NotificationURL {
		t.Fatalf("subscription request = %#v", received)
	}
	if updates[outlookSubscriptionIDKey] == "" ||
		updates[outlookJunkSubscriptionIDKey] == "" ||
		updates[outlookSubscriptionStateFingerprintKey] != outlookClientStateFingerprint(cfg, source) {
		t.Fatalf("subscription updates = %#v", updates)
	}
}

func TestOutlookSubscriptionRemovedClearsState(t *testing.T) {
	t.Setenv("PUBLIC_BASE_URL", "https://example.com")
	t.Setenv("OUTLOOK_WEBHOOK_SECRET", "test-webhook-secret")

	store := NewMemoryStore()
	shop, err := store.CreateShop(context.Background(), Shop{DisplayName: "Outlook Lifecycle Shop", Status: ShopStatusActive})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(context.Background(), ShopSource{
		ShopID: shop.ID, Type: SourceTypeEmail, Provider: "outlook", Address: "support@example.com", Status: SourceStatusActive,
		Metadata: map[string]string{
			outlookSubscriptionIDKey:               "subscription-removed",
			outlookSubscriptionExpirationKey:       time.Now().Add(time.Hour).Format(time.RFC3339),
			outlookSubscriptionRenewedAtKey:        time.Now().Format(time.RFC3339),
			outlookSubscriptionStateFingerprintKey: "old-fingerprint",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	cfg := defaultOutlookPushSettings()
	body, _ := json.Marshal(outlookNotificationEnvelope{Value: []outlookNotification{{
		SubscriptionID: "subscription-removed",
		ClientState:    outlookClientState(cfg, source),
		LifecycleEvent: "subscriptionRemoved",
	}}})
	request := httptest.NewRequest(http.MethodPost, outlookPushPath, bytes.NewReader(body))
	response := httptest.NewRecorder()

	NewServer(store).Routes().ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	updated, err := store.GetShopSource(context.Background(), shop.ID, source.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Metadata[outlookSubscriptionIDKey] != "" ||
		updated.Metadata[outlookSubscriptionExpirationKey] != "" ||
		updated.Metadata[outlookSubscriptionStateFingerprintKey] != "" {
		t.Fatalf("removed subscription state was retained: %#v", updated.Metadata)
	}
}

func TestInitializeGmailBaselineDoesNotImportMessages(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/users/me/profile" {
			t.Fatalf("baseline requested message data: %s", r.URL.Path)
		}
		writeJSONResponse(w, http.StatusOK, map[string]string{
			"emailAddress": "support@example.com",
			"historyId":    "history-baseline",
		})
	}))
	defer provider.Close()
	t.Setenv("GMAIL_API_BASE_URL", provider.URL)

	ctx := context.Background()
	store := NewMemoryStore()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Gmail Baseline", Status: ShopStatusActive})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{
		ShopID: shop.ID, Type: SourceTypeEmail, Provider: "gmail", Address: "support@example.com", Status: SourceStatusActive,
		Metadata: newEmailSyncMetadata("support@example.com", "gmail_api", emailInitialImportRecent),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveEmailInstallation(ctx, EmailInstallation{
		ShopID: shop.ID, Mailbox: source.Address, Provider: "gmail", AccessToken: "access-token",
		Scope: defaultGmailScopes, ExpiresAt: time.Now().UTC().Add(time.Hour),
	}); err != nil {
		t.Fatal(err)
	}

	if err := NewServer(store).initializeEmailSourceBaseline(ctx, source); err != nil {
		t.Fatal(err)
	}
	updated, err := store.GetShopSource(ctx, shop.ID, source.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Metadata[gmailHistoryIDKey] != "history-baseline" || updated.Metadata[emailInitialImportKey] != emailInitialImportNow {
		t.Fatalf("unexpected Gmail baseline metadata: %#v", updated.Metadata)
	}
	conversations, err := store.ListConversations(ctx, ConversationFilter{ShopID: shop.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(conversations) != 0 {
		t.Fatalf("authorization baseline imported conversations: %#v", conversations)
	}
}

func TestInitializeOutlookBaselineDoesNotExpandThreadMessages(t *testing.T) {
	var provider *httptest.Server
	provider = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/me/mailFolders/inbox/messages/delta" && r.URL.Path != "/me/mailFolders/junkemail/messages/delta" {
			t.Fatalf("baseline requested message or thread data: %s", r.URL.Path)
		}
		folder := "inbox"
		if strings.Contains(r.URL.Path, "junkemail") {
			folder = "junkemail"
		}
		writeJSONResponse(w, http.StatusOK, map[string]any{
			"value":            []any{},
			"@odata.deltaLink": provider.URL + "/me/mailFolders/" + folder + "/messages/delta?$deltatoken=baseline",
		})
	}))
	defer provider.Close()
	t.Setenv("OUTLOOK_GRAPH_BASE_URL", provider.URL)

	ctx := context.Background()
	store := NewMemoryStore()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Outlook Baseline", Status: ShopStatusActive})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{
		ShopID: shop.ID, Type: SourceTypeEmail, Provider: "outlook", Address: "support@example.com", Status: SourceStatusActive,
		Metadata: newEmailSyncMetadata("support@example.com", "microsoft_graph", emailInitialImportRecent),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveEmailInstallation(ctx, EmailInstallation{
		ShopID: shop.ID, Mailbox: source.Address, Provider: "outlook", AccessToken: "access-token",
		Scope: defaultOutlookScopes, ExpiresAt: time.Now().UTC().Add(time.Hour),
	}); err != nil {
		t.Fatal(err)
	}

	if err := NewServer(store).initializeEmailSourceBaseline(ctx, source); err != nil {
		t.Fatal(err)
	}
	updated, err := store.GetShopSource(ctx, shop.ID, source.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Metadata[outlookDeltaLinkKey] == "" || updated.Metadata[outlookJunkDeltaLinkKey] == "" || updated.Metadata[emailInitialImportKey] != emailInitialImportNow {
		t.Fatalf("unexpected Outlook baseline metadata: %#v", updated.Metadata)
	}
	conversations, err := store.ListConversations(ctx, ConversationFilter{ShopID: shop.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(conversations) != 0 {
		t.Fatalf("authorization baseline imported conversations: %#v", conversations)
	}
}
