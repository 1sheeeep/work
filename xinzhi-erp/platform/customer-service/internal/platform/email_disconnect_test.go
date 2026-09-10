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

func TestDisconnectEmailSourcePreservesConversationHistory(t *testing.T) {
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Email Shop"}, http.StatusCreated, &shop)
	source, err := store.CreateShopSource(context.Background(), ShopSource{
		ShopID:   shop.ID,
		Type:     SourceTypeEmail,
		Provider: "outlook",
		Address:  "support@example.com",
		Metadata: map[string]string{
			"mailbox": "support@example.com",
			"auth":    "microsoft_graph",
		},
	})
	if err != nil {
		t.Fatalf("CreateShopSource failed: %v", err)
	}
	if _, err := store.SaveEmailInstallation(context.Background(), EmailInstallation{
		ShopID:       shop.ID,
		Mailbox:      source.Address,
		Provider:     "outlook",
		AccessToken:  "access-token",
		RefreshToken: "refresh-token",
		ExpiresAt:    time.Now().UTC().Add(time.Hour),
	}); err != nil {
		t.Fatalf("SaveEmailInstallation failed: %v", err)
	}
	conversation, err := store.CreateConversation(context.Background(), Conversation{
		ShopID:        shop.ID,
		SourceID:      source.ID,
		CustomerName:  "Historical Customer",
		CustomerEmail: "customer@example.com",
		Subject:       "Historical email",
	})
	if err != nil {
		t.Fatalf("CreateConversation failed: %v", err)
	}
	if _, _, err := store.AddMessage(context.Background(), Message{
		ConversationID: conversation.ID,
		Direction:      MessageDirectionCustomer,
		Body:           "Keep this message",
	}); err != nil {
		t.Fatalf("AddMessage failed: %v", err)
	}

	var result emailDisconnectResponse
	requestJSON(t, http.MethodDelete, server.URL+"/api/v1/shops/"+shop.ID+"/email/sources/"+source.ID, adminToken, nil, http.StatusOK, &result)
	if result.Source.Status != SourceStatusDisabled {
		t.Fatalf("source status=%q want=%q", result.Source.Status, SourceStatusDisabled)
	}
	if result.Source.Metadata[emailDisconnectedAtKey] == "" {
		t.Fatal("expected disconnected timestamp")
	}
	if _, err := store.GetEmailInstallation(context.Background(), shop.ID, source.Address); !errors.Is(err, ErrNotFound) {
		t.Fatalf("email installation should be deleted, got %v", err)
	}
	storedConversation, err := store.GetConversation(context.Background(), conversation.ID)
	if err != nil || storedConversation.SourceID != source.ID {
		t.Fatalf("historical conversation was not preserved: conversation=%#v err=%v", storedConversation, err)
	}
	messages, err := store.ListMessages(context.Background(), conversation.ID)
	if err != nil || len(messages) != 1 || messages[0].Body != "Keep this message" {
		t.Fatalf("historical messages were not preserved: messages=%#v err=%v", messages, err)
	}
}

func TestMarkEmailAuthorizationPendingRestoresDisconnectedSource(t *testing.T) {
	metadata := markEmailAuthorizationPending(map[string]string{
		"mailbox":                  "support@example.com",
		emailDisconnectedAtKey:     time.Now().UTC().Format(time.RFC3339Nano),
		emailDisconnectedReasonKey: "manual",
	}, "support@example.com", "microsoft_graph")
	if metadata[emailDisconnectedAtKey] != "" || metadata[emailDisconnectedReasonKey] != "" {
		t.Fatalf("disconnected markers should be cleared during reauthorization: %#v", metadata)
	}
}

func TestStopGmailNotificationsUsesProviderStopEndpoint(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/users/me/stop" {
			t.Fatalf("unexpected provider request: %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer gmail-access-token" {
			t.Fatalf("unexpected authorization header: %q", r.Header.Get("Authorization"))
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer provider.Close()
	t.Setenv("GMAIL_API_BASE_URL", provider.URL)

	server := NewServer(NewMemoryStore())
	err := server.stopEmailProviderNotifications(context.Background(), ShopSource{Provider: "gmail"}, EmailInstallation{
		Provider:    "gmail",
		AccessToken: "gmail-access-token",
		ExpiresAt:   time.Now().UTC().Add(time.Hour),
	})
	if err != nil {
		t.Fatalf("stopEmailProviderNotifications failed: %v", err)
	}
}

func TestStopOutlookNotificationsDeletesEverySubscription(t *testing.T) {
	deleted := map[string]bool{}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete || !strings.HasPrefix(r.URL.Path, "/subscriptions/") {
			t.Fatalf("unexpected provider request: %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer outlook-access-token" {
			t.Fatalf("unexpected authorization header: %q", r.Header.Get("Authorization"))
		}
		deleted[strings.TrimPrefix(r.URL.Path, "/subscriptions/")] = true
		w.WriteHeader(http.StatusNoContent)
	}))
	defer provider.Close()
	t.Setenv("OUTLOOK_GRAPH_BASE_URL", provider.URL)

	server := NewServer(NewMemoryStore())
	err := server.stopEmailProviderNotifications(context.Background(), ShopSource{
		Provider: "outlook",
		Metadata: map[string]string{
			outlookSubscriptionIDKey:     "inbox-subscription",
			outlookJunkSubscriptionIDKey: "junk-subscription",
		},
	}, EmailInstallation{
		Provider:    "outlook",
		AccessToken: "outlook-access-token",
		ExpiresAt:   time.Now().UTC().Add(time.Hour),
	})
	if err != nil {
		t.Fatalf("stopEmailProviderNotifications failed: %v", err)
	}
	if !deleted["inbox-subscription"] || !deleted["junk-subscription"] || len(deleted) != 2 {
		t.Fatalf("unexpected deleted subscriptions: %#v", deleted)
	}
}
