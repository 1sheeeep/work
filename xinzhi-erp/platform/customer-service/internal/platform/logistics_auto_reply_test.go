package platform

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

type fakeLogisticsTracker struct {
	result      LogisticsTrackingResult
	calls       atomic.Int32
	lastRequest LogisticsTrackingRequest
}

func (tracker *fakeLogisticsTracker) Provider() string {
	return "fake"
}

func (tracker *fakeLogisticsTracker) Track(_ context.Context, input LogisticsTrackingRequest) (LogisticsTrackingResult, error) {
	tracker.calls.Add(1)
	tracker.lastRequest = input
	return tracker.result, nil
}

func TestIsLogisticsIntent(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		subject string
		body    string
		want    bool
	}{
		{name: "English", body: "Where is my order?", want: true},
		{name: "Chinese", body: "请问我的包裹到哪了？", want: true},
		{name: "French", body: "Je voudrais le suivi de mon colis.", want: true},
		{name: "Spanish", body: "¿Cuál es el estado de entrega de mi pedido?", want: true},
		{name: "Japanese", body: "荷物の追跡をお願いします。", want: true},
		{name: "Korean", body: "배송 추적이 가능한가요?", want: true},
		{name: "Subject", subject: "Re: Shipping status for order #1468", body: "Any update?", want: true},
		{name: "Address change", body: "I need to change the shipping address for my order.", want: false},
		{name: "Refund", body: "I want a refund because the package is delayed.", want: false},
		{name: "Product", body: "Does this shirt come in black?", want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isLogisticsIntent(test.subject, test.body); got != test.want {
				t.Fatalf("isLogisticsIntent(%q, %q) = %v, want %v", test.subject, test.body, got, test.want)
			}
		})
	}
}

func TestLogisticsOrderQueryPrefersExplicitOrder(t *testing.T) {
	t.Parallel()
	conversation := Conversation{CustomerEmail: "buyer@example.com", Subject: "Delivery question"}
	query, explicit := logisticsOrderQuery(conversation, Message{Body: "Can you track order #1468 for me?"})
	if query != "#1468" || !explicit {
		t.Fatalf("query = %q, explicit = %v", query, explicit)
	}
	query, explicit = logisticsOrderQuery(conversation, Message{Body: "Where is my package?"})
	if query != `email:"buyer@example.com"` || explicit {
		t.Fatalf("email query = %q, explicit = %v", query, explicit)
	}
}

func TestLatestLogisticsEventUsesNewestTimestamp(t *testing.T) {
	t.Parallel()
	event, ok := latestLogisticsEvent([]LogisticsTrackingEvent{
		{Time: "2026-07-22T10:00:00+08:00", Description: "Older"},
		{Time: "2026-07-23T12:00:00+08:00", Description: "Newest", Location: "Los Angeles"},
		{Time: "2026-07-24T12:00:00+08:00"},
	})
	if !ok || event.Description != "Newest" {
		t.Fatalf("latest event = %#v, ok = %v", event, ok)
	}
}

func TestFirstOrderTrackingUsesLatestTrackedFulfillmentTimestamp(t *testing.T) {
	t.Parallel()
	order := ShopifyOrderSummary{
		Fulfillments: []ShopifyFulfillment{
			{
				UpdatedAt:    "2026-07-24T10:00:00Z",
				TrackingInfo: []ShopifyTrackingInfo{{Number: "LATEST"}},
			},
			{
				UpdatedAt:    "2026-07-20T10:00:00Z",
				TrackingInfo: []ShopifyTrackingInfo{{Number: "OLDER"}},
			},
		},
	}
	if tracking := firstOrderTracking(order); tracking.Number != "LATEST" {
		t.Fatalf("firstOrderTracking() = %#v, want latest tracked fulfillment", tracking)
	}
}

func TestBuildLogisticsCustomerReplyPromptUsesRawFactsWithoutChineseIntermediate(t *testing.T) {
	t.Parallel()
	event := LogisticsTrackingEvent{
		Time: "2026-07-17T16:01:00+08:00", Status: "InTransit_Other",
		Description: "深圳市，包裹已发出 / In transit", Location: "Shenzhen",
	}
	prompt := buildLogisticsCustomerReplyPrompt(
		Conversation{Subject: "¿Dónde está mi pedido?"},
		Message{Body: "¿Cuál es el estado de entrega?"},
		"#1468",
		"TX123",
		&event,
	)
	for _, expected := range []string{"¿Cuál es el estado de entrega?", "#1468", "TX123", "InTransit_Other", "深圳市，包裹已发出 / In transit", "Shenzhen"} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("prompt is missing raw value %q: %s", expected, prompt)
		}
	}
	for _, rule := range []string{
		"Never mention, infer, or output a shipping carrier",
		"Leave non-Chinese raw field text unchanged",
		"translate only its Chinese text faithfully",
		"do not polish, summarize, normalize, interpret, or rewrite",
	} {
		if !strings.Contains(prompt, rule) {
			t.Fatalf("prompt is missing hard reply rule %q: %s", rule, prompt)
		}
	}
	if strings.Contains(prompt, "您的订单") || strings.Contains(prompt, "物流单号") {
		t.Fatalf("prompt contains a Chinese intermediate reply: %s", prompt)
	}
}

func TestBuildLogisticsCustomerReplyPromptMarksMissingTrackingInformation(t *testing.T) {
	t.Parallel()
	prompt := buildLogisticsCustomerReplyPrompt(
		Conversation{Subject: "Shipping update"},
		Message{Body: "Where is my order?"},
		"#1468",
		"",
		nil,
	)
	if !strings.Contains(prompt, `"has_tracking_information":false`) ||
		!strings.Contains(prompt, `"order_name":"#1468"`) ||
		strings.Contains(prompt, `"latest_event"`) {
		t.Fatalf("unexpected no-tracking prompt: %s", prompt)
	}
}

func TestProcessLogisticsAutoDraftAndCooldown(t *testing.T) {
	var aiCalls atomic.Int32
	aiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		aiCalls.Add(1)
		var payload struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || len(payload.Messages) != 2 {
			http.Error(w, "unexpected AI request", http.StatusBadRequest)
			return
		}
		if !strings.Contains(payload.Messages[1].Content, "ZS123456789") ||
			!strings.Contains(payload.Messages[1].Content, "Los Angeles") ||
			!strings.Contains(payload.Messages[1].Content, "¿Cuál es el estado de entrega de mi pedido?") ||
			strings.Contains(payload.Messages[1].Content, "<reply_box_text>") {
			http.Error(w, "verified logistics facts are missing", http.StatusBadRequest)
			return
		}
		writeJSONResponse(w, http.StatusOK, map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": "Su pedido llegó al centro de Los Ángeles. Número de seguimiento: ZS123456789."}}},
		})
	}))
	defer aiServer.Close()
	t.Setenv("AI_API_KEY", "auto-draft-test-key")
	t.Setenv("AI_BASE_URL", aiServer.URL)
	t.Setenv("AI_MODEL", "auto-draft-test-model")

	store := NewMemoryStore()
	ctx := context.Background()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Auto Draft Shop", ExternalID: "auto-draft.myshopify.com"})
	if err != nil {
		t.Fatal(err)
	}
	chatSource, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeShopifyChat})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeShopifyAPI, Address: "auto-draft.myshopify.com"}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveShopifyInstallation(ctx, ShopifyInstallation{
		ShopID: shop.ID, ShopDomain: "auto-draft.myshopify.com", AccessToken: "test-shopify-token",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveLogisticsSettings(ctx, LogisticsSettings{
		Enabled: true, AutoDraftEnabled: true, ChatEnabled: true, GmailEnabled: true, OutlookEnabled: true,
		BaseURL: logisticsBaseURL(), ReplyCooldownHours: 24,
	}); err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateConversation(ctx, Conversation{
		ShopID: shop.ID, SourceID: chatSource.ID, CustomerEmail: "buyer@example.com",
		Subject: "¿Dónde está mi pedido?", Status: ConversationStatusAssigned, AssignedAgentID: "agent-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	firstMessage, _, err := store.AddMessage(ctx, Message{
		ConversationID: conversation.ID, Direction: MessageDirectionCustomer, Type: MessageTypeText, Body: "¿Cuál es el estado de entrega de mi pedido?",
	})
	if err != nil {
		t.Fatal(err)
	}

	tracker := &fakeLogisticsTracker{result: LogisticsTrackingResult{
		Configured: true,
		Events: []LogisticsTrackingEvent{
			{Time: "2026-07-22T10:00:00+08:00", Description: "Older event"},
			{Time: "2026-07-23T12:00:00+08:00", Description: "Arrived at processing center", Location: "Los Angeles"},
		},
	}}
	server := NewServer(store)
	server.logisticsTracker = tracker
	server.publicShopifyOrderSearch = func(_ context.Context, _, _, query string, _ int) (ShopifyOrderSearchResult, error) {
		if query != `email:"buyer@example.com"` {
			t.Fatalf("unexpected Shopify query: %q", query)
		}
		return ShopifyOrderSearchResult{Orders: []ShopifyOrderSummary{{
			ID: "order-1", Name: "#1468", Email: "buyer@example.com",
			Fulfillments: []ShopifyFulfillment{{TrackingInfo: []ShopifyTrackingInfo{{Company: "Other", Number: "ZS123456789"}}}},
		}}}, nil
	}

	handled, err := server.processLogisticsAutoDraft(ctx, conversation, firstMessage)
	if err != nil || !handled {
		t.Fatalf("processLogisticsAutoDraft() handled=%v err=%v", handled, err)
	}
	updated, err := store.GetMessage(ctx, conversation.ID, firstMessage.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Metadata[aiReplyStatusKey] != messageTranslationDone ||
		updated.Metadata[aiReplyKindKey] != logisticsAutoReplyKind ||
		updated.Metadata[aiReplyPolicyVersionKey] != currentAIReplyPolicyVersion {
		t.Fatalf("unexpected reply metadata: %#v", updated.Metadata)
	}
	if !strings.Contains(updated.Metadata[aiReplyTextKey], "Los Ángeles") || updated.Metadata[aiReplyTextZHKey] != "" {
		t.Fatalf("unexpected reply texts: %#v", updated.Metadata)
	}

	secondMessage, _, err := store.AddMessage(ctx, Message{
		ConversationID: conversation.ID, Direction: MessageDirectionCustomer, Type: MessageTypeText, Body: "¿Hay alguna actualización de entrega?",
	})
	if err != nil {
		t.Fatal(err)
	}
	handled, err = server.processLogisticsAutoDraft(ctx, conversation, secondMessage)
	if err != nil || !handled {
		t.Fatalf("rate-limited process handled=%v err=%v", handled, err)
	}
	rateLimited, err := store.GetMessage(ctx, conversation.ID, secondMessage.ID)
	if err != nil {
		t.Fatal(err)
	}
	if rateLimited.Metadata[aiReplyStatusKey] != "rate_limited" {
		t.Fatalf("second message was not rate limited: %#v", rateLimited.Metadata)
	}
	if tracker.calls.Load() != 1 || aiCalls.Load() != 1 {
		t.Fatalf("cooldown repeated external calls: tracker=%d ai=%d", tracker.calls.Load(), aiCalls.Load())
	}
}
