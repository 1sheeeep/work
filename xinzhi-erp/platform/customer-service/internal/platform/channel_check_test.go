package platform

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestCuiqiuChannelCheckVerifiesReceiveAndSendWithoutSendingMail(t *testing.T) {
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/message/list" {
			http.NotFound(w, r)
			return
		}
		_ = r.ParseMultipartForm(1 << 20)
		_, _ = w.Write([]byte(`{"code":200,"data":{"list":[],"total":0}}`))
	}))
	defer api.Close()
	originalClient := cuiqiuHTTPClient
	originalSMTPCheck := verifyCuiqiuSMTPConnection
	cuiqiuHTTPClient = api.Client()
	smtpFailure := errors.New("535 5.7.8 actual SMTP authentication failure")
	smtpChecks := 0
	verifyCuiqiuSMTPConnection = func(cuiqiuConfig) error {
		smtpChecks++
		return smtpFailure
	}
	t.Cleanup(func() {
		cuiqiuHTTPClient = originalClient
		verifyCuiqiuSMTPConnection = originalSMTPCheck
	})
	store := NewMemoryStore()
	shop, _ := store.CreateShop(context.Background(), Shop{DisplayName: "Cuiqiu Check Shop"})
	source, _ := store.CreateShopSource(context.Background(), ShopSource{
		ShopID: shop.ID, Type: SourceTypeEmail, Provider: cuiqiuProvider, Address: "support@fastmo.cn", Status: SourceStatusActive,
		Metadata: map[string]string{
			cuiqiuAPIBaseKey: api.URL, cuiqiuMailIDKey: "mail-1", cuiqiuSMTPHostKey: "smtp.fastmo.cn", cuiqiuSMTPPortKey: "465", cuiqiuSMTPModeKey: "tls",
		},
	})
	if _, err := store.SaveEmailInstallation(context.Background(), EmailInstallation{
		ShopID: shop.ID, Mailbox: source.Address, Provider: cuiqiuProvider, AccessToken: "token", RefreshToken: "password",
	}); err != nil {
		t.Fatal(err)
	}
	err := NewServer(store).checkEmailSourceHealth(context.Background(), source, false)
	if !errors.Is(err, smtpFailure) || !strings.Contains(err.Error(), "actual SMTP authentication failure") || smtpChecks != 1 {
		t.Fatalf("health check = %v, SMTP checks=%d", err, smtpChecks)
	}
	updated, _ := store.GetShopSource(context.Background(), shop.ID, source.ID)
	if updated.Metadata[emailHealthStatusKey] != "error" || !strings.Contains(updated.Metadata[emailHealthErrorKey], "actual SMTP authentication failure") {
		t.Fatalf("actual SMTP failure was not persisted: %#v", updated.Metadata)
	}
}

func TestManualChannelCheckReturnsSavedResultWhenNoChannelsConfigured(t *testing.T) {
	store := NewMemoryStore()
	platformServer := NewServer(store)
	server := httptest.NewServer(platformServer.Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "No Channels"}, http.StatusCreated, &shop)
	var result shopChannelCheckResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/channels/check", adminToken, nil, http.StatusOK, &result)
	if result.HasChannels || result.Healthy || len(result.Email) != 0 {
		t.Fatalf("unexpected empty channel check result: %#v", result)
	}
}

func TestScheduledChannelCheckSkipsEmailHealthChecks(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Scheduled Shopify Check"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateShopSource(ctx, ShopSource{
		ShopID: shop.ID, Type: SourceTypeEmail, Provider: "gmail", Address: "support@example.com",
	}); err != nil {
		t.Fatal(err)
	}

	result, err := NewServer(store).checkShopChannelsWithEmail(ctx, shop.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	if result.HasChannels || len(result.Email) != 0 {
		t.Fatalf("scheduled Shopify check included email channels: %#v", result)
	}
}

func TestERPManagedShopifyHealthUsesExistingChatSourceHeartbeat(t *testing.T) {
	now := time.Now().UTC()
	sources := []ShopSource{{
		Type: SourceTypeShopifyChat, Status: SourceStatusActive,
		Metadata: map[string]string{"widgetLastSeenAt": now.Add(-10 * time.Minute).Format(time.RFC3339)},
	}}
	if !shopifyChatWidgetRecentlyLoaded(sources, now) {
		t.Fatal("expected a recent active chat-source heartbeat to be healthy")
	}
	sources[0].Metadata["widgetLastSeenAt"] = now.Add(-31 * time.Minute).Format(time.RFC3339)
	if shopifyChatWidgetRecentlyLoaded(sources, now) {
		t.Fatal("expected a stale chat-source heartbeat to require plugin attention")
	}
	sources[0].Status = SourceStatusDisabled
	sources[0].Metadata["widgetLastSeenAt"] = now.Format(time.RFC3339)
	if shopifyChatWidgetRecentlyLoaded(sources, now) {
		t.Fatal("expected a disabled chat source to stay unhealthy")
	}
}

func TestChannelCheckReportsPartialEmailFailure(t *testing.T) {
	gmailServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/users/me/profile" {
			t.Fatalf("channel check fetched mailbox data: %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") == "Bearer failed-token" {
			http.Error(w, `{"error":{"message":"invalid credentials"}}`, http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"emailAddress":"healthy@example.com","historyId":"history-next"}`))
	}))
	defer gmailServer.Close()
	t.Setenv("GMAIL_API_BASE_URL", gmailServer.URL)
	t.Setenv("GMAIL_PUBSUB_TOPIC", "projects/example/topics/gmail")
	t.Setenv("GMAIL_PUBSUB_AUDIENCE", "https://example.com/webhooks/email/gmail")
	t.Setenv("GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL", "push@example-project.iam.gserviceaccount.com")

	ctx := context.Background()
	store := NewMemoryStore()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Partial Email Check"})
	if err != nil {
		t.Fatal(err)
	}
	for index, mailbox := range []string{"healthy@example.com", "failed@example.com"} {
		metadata := newEmailSyncMetadata(mailbox, "gmail_api", emailInitialImportNow)
		metadata[gmailHistoryIDKey] = "history-current"
		metadata[emailLastReconcileAtKey] = time.Now().UTC().Format(time.RFC3339)
		metadata[gmailWatchRenewedAtKey] = time.Now().UTC().Format(time.RFC3339)
		metadata[gmailWatchExpirationKey] = time.Now().UTC().Add(7 * 24 * time.Hour).Format(time.RFC3339)
		metadata[gmailWatchScopeKey] = "inbox+spam-v1"
		source, createErr := store.CreateShopSource(ctx, ShopSource{
			ShopID: shop.ID, Type: SourceTypeEmail, Provider: "gmail", Address: mailbox, Metadata: metadata,
		})
		if createErr != nil {
			t.Fatal(createErr)
		}
		token := "healthy-token"
		if index == 1 {
			token = "failed-token"
		}
		if _, saveErr := store.SaveEmailInstallation(ctx, EmailInstallation{
			ShopID: shop.ID, Mailbox: source.Address, Provider: "gmail", AccessToken: token,
			Scope: defaultGmailScopes, ExpiresAt: time.Now().UTC().Add(time.Hour),
		}); saveErr != nil {
			t.Fatal(saveErr)
		}
	}

	result, err := NewServer(store).checkShopChannels(ctx, shop.ID)
	if err != nil {
		t.Fatal(err)
	}
	if result.Healthy || len(result.Email) != 1 {
		t.Fatalf("partial email failure should make the channel check unhealthy: %#v", result)
	}
	email := result.Email[0]
	if email.SourcesChecked != 2 || email.SourcesHealthy != 1 || email.SourcesFailed != 1 {
		t.Fatalf("unexpected partial email result: %#v", email)
	}
	conversations, err := store.ListConversations(ctx, ConversationFilter{ShopID: shop.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(conversations) != 0 {
		t.Fatalf("channel check imported conversations: %#v", conversations)
	}
}
