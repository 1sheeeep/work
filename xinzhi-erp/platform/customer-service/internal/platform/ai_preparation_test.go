package platform

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestConversationReplyDraftPublishesBeforeChineseReview(t *testing.T) {
	var calls atomic.Int32
	chineseReviewStarted := make(chan struct{})
	releaseChineseReview := make(chan struct{})
	aiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, "invalid payload", http.StatusBadRequest)
			return
		}
		if calls.Add(1) == 1 {
			writeJSONResponse(w, http.StatusOK, map[string]any{
				"choices": []map[string]any{{"message": map[string]string{"content": "The customer-language draft is ready."}}},
			})
			return
		}
		close(chineseReviewStarted)
		<-releaseChineseReview
		writeJSONResponse(w, http.StatusOK, map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": "客户语言草稿已准备好。"}}},
		})
	}))
	defer aiServer.Close()
	t.Setenv("AI_API_KEY", "preparation-test-key")
	t.Setenv("AI_BASE_URL", aiServer.URL)
	t.Setenv("AI_MODEL", "preparation-test-model")

	store := NewMemoryStore()
	ctx := context.Background()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Preparation Shop"})
	if err != nil {
		t.Fatalf("create shop: %v", err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeShopifyChat})
	if err != nil {
		t.Fatalf("create source: %v", err)
	}
	conversation, err := store.CreateConversation(ctx, Conversation{
		ShopID: shop.ID, SourceID: source.ID, Subject: "Product question",
	})
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	message, _, err := store.AddMessage(ctx, Message{
		ConversationID: conversation.ID,
		Direction:      MessageDirectionCustomer,
		Type:           MessageTypeText,
		Body:           "Can you tell me more about this product?",
		Metadata:       map[string]string{aiReplyStatusKey: "queued"},
	})
	if err != nil {
		t.Fatalf("add message: %v", err)
	}

	server := NewServer(store)
	done := make(chan error, 1)
	go func() {
		done <- server.processConversationReplyDraft(context.Background(), conversation.ID, message.ID)
	}()

	select {
	case <-chineseReviewStarted:
	case <-time.After(3 * time.Second):
		t.Fatal("Chinese review did not start")
	}
	published, err := store.GetMessage(ctx, conversation.ID, message.ID)
	if err != nil {
		t.Fatalf("load published draft: %v", err)
	}
	if published.Metadata[aiReplyStatusKey] != messageTranslationDone ||
		published.Metadata[aiReplyTextKey] != "The customer-language draft is ready." ||
		published.Metadata[aiReplyPolicyVersionKey] != currentAIReplyPolicyVersion {
		t.Fatalf("customer-language draft was not published first: %#v", published.Metadata)
	}
	if published.Metadata[aiReplyTextZHKey] != "" {
		t.Fatalf("Chinese review should still be pending: %#v", published.Metadata)
	}

	close(releaseChineseReview)
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("process draft: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("draft processing did not finish")
	}
	completed, err := store.GetMessage(ctx, conversation.ID, message.ID)
	if err != nil {
		t.Fatalf("load completed draft: %v", err)
	}
	if completed.Metadata[aiReplyTextZHKey] != "客户语言草稿已准备好。" {
		t.Fatalf("Chinese review was not saved: %#v", completed.Metadata)
	}
	if calls.Load() != 2 {
		t.Fatalf("AI calls = %d, want draft plus Chinese review", calls.Load())
	}
}

func TestAIReplyDraftCurrentRequiresPolicyVersion(t *testing.T) {
	t.Parallel()
	legacy := Message{Metadata: map[string]string{aiReplyStatusKey: messageTranslationDone}}
	if aiReplyDraftIsCurrent(legacy) {
		t.Fatal("legacy completed draft must be regenerated under the current policy")
	}
	current := Message{Metadata: map[string]string{
		aiReplyStatusKey:        messageTranslationDone,
		aiReplyPolicyVersionKey: currentAIReplyPolicyVersion,
	}}
	if !aiReplyDraftIsCurrent(current) {
		t.Fatal("current policy draft should be reused")
	}
	automaticallySent := Message{Metadata: map[string]string{
		logisticsAutoSendStatusKey: logisticsAutoSendStatusSent,
	}}
	if !aiReplyDraftIsCurrent(automaticallySent) {
		t.Fatal("already sent automatic reply must never be regenerated and resent")
	}
}
