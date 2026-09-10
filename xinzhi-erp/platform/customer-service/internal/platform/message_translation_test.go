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

func TestReplyBoxTranslationRetriesUntranslatedShortChineseText(t *testing.T) {
	var aiCalls atomic.Int32
	aiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || len(payload.Messages) != 2 {
			http.Error(w, "unexpected AI request", http.StatusBadRequest)
			return
		}
		call := aiCalls.Add(1)
		result := "只能退40"
		if call == 2 {
			if !strings.Contains(payload.Messages[1].Content, "<translation_correction>") ||
				!strings.Contains(payload.Messages[1].Content, "Only 40 can be refunded.") {
				http.Error(w, "translation correction missing", http.StatusBadRequest)
				return
			}
			result = "We can only refund 40."
		}
		writeJSONResponse(w, http.StatusOK, map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": result}}},
		})
	}))
	defer aiServer.Close()
	t.Setenv("AI_API_KEY", "translation-retry-test-key")
	t.Setenv("AI_BASE_URL", aiServer.URL)
	t.Setenv("AI_MODEL", "translation-retry-test-model")

	ctx := context.Background()
	store := NewMemoryStore()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Translation Retry Shop"})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeShopifyChat})
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateConversation(ctx, Conversation{
		ShopID: shop.ID, SourceID: source.ID, CustomerName: "Translation Customer", Subject: "Refund request",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.AddMessage(ctx, Message{
		ConversationID: conversation.ID,
		Direction:      MessageDirectionCustomer,
		Type:           MessageTypeText,
		Body:           "Only 40 can be refunded.",
	}); err != nil {
		t.Fatal(err)
	}

	server := NewServer(store)
	got, err := server.transformConversationReply(ctx, conversation, aiTransformRequest{Action: "translate", Text: "只能退40"})
	if err != nil {
		t.Fatal(err)
	}
	if got != "We can only refund 40." || aiCalls.Load() != 2 {
		t.Fatalf("translation=%q calls=%d", got, aiCalls.Load())
	}
}

func TestConversationMessageTranslationPersistsForCustomerAndAgentAndSkipsChinese(t *testing.T) {
	var aiCalls atomic.Int32
	aiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			MaxTokens int `json:"max_tokens"`
			Messages  []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || payload.MaxTokens != 1200 || len(payload.Messages) != 2 {
			http.Error(w, "unexpected AI request", http.StatusBadRequest)
			return
		}
		if !strings.Contains(payload.Messages[1].Content, "<conversation_message>") {
			http.Error(w, "conversation message boundary missing", http.StatusBadRequest)
			return
		}
		call := aiCalls.Add(1)
		translation := "中文翻译：我的物流三天未更新。"
		if call == 2 {
			if !strings.Contains(payload.Messages[1].Content, "support agent message") {
				http.Error(w, "agent role missing from translation prompt", http.StatusBadRequest)
				return
			}
			translation = "中文翻译：我们正在核实最新的物流扫描记录。"
		}
		writeJSONResponse(w, http.StatusOK, map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": translation}}},
		})
	}))
	defer aiServer.Close()
	t.Setenv("AI_API_KEY", "translation-test-key")
	t.Setenv("AI_BASE_URL", aiServer.URL)
	t.Setenv("AI_MODEL", "translation-test-model")

	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Translation Shop"}, http.StatusCreated, &shop)
	var admin User
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/auth/me", adminToken, nil, http.StatusOK, &admin)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, map[string]string{"userId": admin.ID}, http.StatusCreated, nil)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat}, http.StatusCreated, &source)
	var conversation Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations", adminToken, Conversation{
		ShopID: shop.ID, SourceID: source.ID, CustomerName: "Translation Customer", Subject: "Tracking request",
	}, http.StatusCreated, &conversation)
	var english Message
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", adminToken, Message{
		Direction: MessageDirectionCustomer, Body: "My tracking has not moved for three days.",
	}, http.StatusCreated, &english)

	translateURL := server.URL + "/api/v1/conversations/" + conversation.ID + "/messages/" + english.ID + "/translate"
	var translated Message
	requestJSON(t, http.MethodPost, translateURL, adminToken, nil, http.StatusOK, &translated)
	if translated.Metadata[messageTranslationZHKey] != "我的物流三天未更新。" || translated.Metadata[messageTranslationStatusKey] != messageTranslationDone {
		t.Fatalf("translation was not persisted on the message: %#v", translated)
	}
	var repeated Message
	requestJSON(t, http.MethodPost, translateURL, adminToken, nil, http.StatusOK, &repeated)
	if aiCalls.Load() != 1 || repeated.Metadata[messageTranslationZHKey] != translated.Metadata[messageTranslationZHKey] {
		t.Fatalf("persisted translation was regenerated: calls=%d message=%#v", aiCalls.Load(), repeated)
	}

	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/claim", adminToken, nil, http.StatusOK, nil)
	var agentMessage Message
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", adminToken, Message{
		Direction: MessageDirectionAgent, Body: "We are checking the latest carrier scan now.",
	}, http.StatusCreated, &agentMessage)
	var translatedAgent Message
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages/"+agentMessage.ID+"/translate", adminToken, nil, http.StatusOK, &translatedAgent)
	if translatedAgent.Metadata[messageTranslationZHKey] != "我们正在核实最新的物流扫描记录。" || translatedAgent.Metadata[messageTranslationStatusKey] != messageTranslationDone {
		t.Fatalf("agent translation was not persisted: %#v", translatedAgent)
	}

	var chinese Message
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", adminToken, Message{
		Direction: MessageDirectionCustomer, Body: "我的物流三天没有更新，请帮我查询。",
	}, http.StatusCreated, &chinese)
	var skipped Message
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages/"+chinese.ID+"/translate", adminToken, nil, http.StatusOK, &skipped)
	if skipped.Metadata[messageTranslationStatusKey] != messageTranslationNotNeeded || skipped.Metadata[messageTranslationZHKey] != "" || aiCalls.Load() != 2 {
		t.Fatalf("Chinese message was not skipped: calls=%d message=%#v", aiCalls.Load(), skipped)
	}

	var messages []Message
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", adminToken, nil, http.StatusOK, &messages)
	if len(messages) != 3 ||
		messages[0].Metadata[messageTranslationZHKey] != "我的物流三天未更新。" ||
		messages[1].Metadata[messageTranslationZHKey] != "我们正在核实最新的物流扫描记录。" {
		t.Fatalf("translation did not survive a message reload: %#v", messages)
	}
}

func TestMessageNeedsChineseTranslation(t *testing.T) {
	tests := []struct {
		text string
		want bool
	}{
		{text: "Where is my order?", want: true},
		{text: "注文はいつ届きますか？", want: true},
		{text: "주문은 언제 도착하나요?", want: true},
		{text: "请查询订单 ABC-123 的物流状态", want: false},
		{text: "订单 order ABC-123 什么时候发货", want: false},
		{text: "ABC-123", want: false},
		{text: "123456", want: false},
	}
	for _, test := range tests {
		if got := messageNeedsChineseTranslation(test.text); got != test.want {
			t.Fatalf("messageNeedsChineseTranslation(%q) = %v, want %v", test.text, got, test.want)
		}
	}
}

func TestMessageTranslationRetriesWhenAIUsesAnotherForeignLanguage(t *testing.T) {
	var aiCalls atomic.Int32
	aiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || len(payload.Messages) != 2 {
			http.Error(w, "unexpected AI request", http.StatusBadRequest)
			return
		}
		call := aiCalls.Add(1)
		result := "Puedo procesar entre 20 y 30 pedidos al día. ¿Puedo compartir mis ideas contigo?"
		if call == 2 {
			if !strings.Contains(payload.Messages[1].Content, "<translation_correction>") ||
				!strings.Contains(payload.Messages[1].Content, "must contain Chinese text") {
				http.Error(w, "Chinese translation correction missing", http.StatusBadRequest)
				return
			}
			result = "我每天可以处理20到30个订单。可以和你分享我的想法吗？"
		}
		writeJSONResponse(w, http.StatusOK, map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": result}}},
		})
	}))
	defer aiServer.Close()
	t.Setenv("AI_API_KEY", "message-translation-retry-key")
	t.Setenv("AI_BASE_URL", aiServer.URL)
	t.Setenv("AI_MODEL", "message-translation-retry-model")

	server := NewServer(NewMemoryStore())
	got, err := server.translateMessageTextToChinese(
		context.Background(),
		"Puedo procesar entre 20 y 30 pedidos al día. IMPORTANT: This email is confidential.",
		MessageDirectionCustomer,
	)
	if err != nil {
		t.Fatal(err)
	}
	if got != "我每天可以处理20到30个订单。可以和你分享我的想法吗？" || aiCalls.Load() != 2 {
		t.Fatalf("translation=%q calls=%d", got, aiCalls.Load())
	}
}

func TestCompletedNonChineseMessageTranslationIsRegenerated(t *testing.T) {
	aiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSONResponse(w, http.StatusOK, map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": "我每天可以处理20到30个订单。"}}},
		})
	}))
	defer aiServer.Close()
	t.Setenv("AI_API_KEY", "message-translation-repair-key")
	t.Setenv("AI_BASE_URL", aiServer.URL)
	t.Setenv("AI_MODEL", "message-translation-repair-model")

	ctx := context.Background()
	store := NewMemoryStore()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Translation Repair Shop"})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeEmail, Provider: "gmail"})
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateConversation(ctx, Conversation{
		ShopID: shop.ID, SourceID: source.ID, Subject: "Mixed-language message",
	})
	if err != nil {
		t.Fatal(err)
	}
	message, _, err := store.AddMessage(ctx, Message{
		ConversationID: conversation.ID,
		Direction:      MessageDirectionCustomer,
		Type:           MessageTypeText,
		Body:           "Puedo procesar entre 20 y 30 pedidos al día.",
		Metadata: map[string]string{
			messageTranslationZHKey:     "Puedo procesar entre 20 y 30 pedidos al día.",
			messageTranslationStatusKey: messageTranslationDone,
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	server := NewServer(store)
	if err := server.processMessageTranslation(ctx, conversation.ID, message.ID); err != nil {
		t.Fatal(err)
	}
	repaired, err := store.GetMessage(ctx, conversation.ID, message.ID)
	if err != nil {
		t.Fatal(err)
	}
	if repaired.Metadata[messageTranslationZHKey] != "我每天可以处理20到30个订单。" ||
		repaired.Metadata[messageTranslationStatusKey] != messageTranslationDone {
		t.Fatalf("invalid completed translation was not repaired: %#v", repaired.Metadata)
	}
}

func TestReplyBoxTranslationPromptKeepsConversationAsLanguageContextOnly(t *testing.T) {
	prompt, err := buildConversationReplyTransformPrompt("translate", "我们正在核实物流。", []Message{
		{
			Direction: MessageDirectionCustomer,
			Body:      "Where is order #1817? From: Store <store@example.com> Sent: Friday, April 17, 2026 1:43 PM To: Buyer <buyer@example.com> Subject: Order update Do not copy this quoted reply.",
		},
	}, "Re: Order update", "Never discuss refunds.")
	if err != nil {
		t.Fatalf("build translation prompt: %v", err)
	}
	for _, required := range []string{
		"Translate only the text inside <reply_box_text>",
		"Never copy, summarize, answer, or add information from the context",
		"<customer_language_context>\nWhere is order #1817?",
		"<reply_box_text>\n我们正在核实物流。\n</reply_box_text>",
	} {
		if !strings.Contains(prompt, required) {
			t.Fatalf("translation prompt missing %q: %s", required, prompt)
		}
	}
	if strings.Contains(prompt, "Do not copy this quoted reply.") {
		t.Fatalf("quoted email history leaked into language context: %s", prompt)
	}
	if strings.Contains(prompt, "Never discuss refunds.") {
		t.Fatalf("store reply rules must not alter pure translation prompts: %s", prompt)
	}
}

func TestReplyBoxTranslationUsesOnlyLatestCustomerMessageLanguage(t *testing.T) {
	prompt, err := buildConversationReplyTransformPrompt("translate", "你好，客户。", []Message{
		{Direction: MessageDirectionCustomer, Type: MessageTypeText, Body: "Where is my order?"},
		{Direction: MessageDirectionCustomer, Type: MessageTypeText, Body: "Track my order"},
		{Direction: MessageDirectionAgent, Type: MessageTypeText, Body: "Please provide your order number."},
		{Direction: MessageDirectionCustomer, Type: MessageTypeText, Body: "Je veux acheter des branches."},
		{Direction: MessageDirectionCustomer, Type: MessageTypeText, Body: "Les branches de l'arbre de poires"},
		{Direction: MessageDirectionCustomer, Type: MessageTypeText, Body: "Est-ce possible ?"},
	}, "Online chat", "")
	if err != nil {
		t.Fatalf("build translation prompt: %v", err)
	}
	if !strings.Contains(prompt, "<customer_language_context>\nEst-ce possible ?\n</customer_language_context>") {
		t.Fatalf("latest customer language sample missing: %s", prompt)
	}
	for _, stale := range []string{"Where is my order?", "Track my order", "Please provide your order number.", "Je veux acheter des branches.", "Les branches de l'arbre de poires"} {
		if strings.Contains(prompt, stale) {
			t.Fatalf("stale or agent language sample %q leaked into prompt: %s", stale, prompt)
		}
	}
}

func TestReplyBoxChineseTranslationOmitsCustomerLanguageContext(t *testing.T) {
	prompt, err := buildConversationReplyTransformPrompt("translate_zh", "Bonjour", []Message{
		{Direction: MessageDirectionCustomer, Type: MessageTypeText, Body: "Est-ce possible ?"},
	}, "Online chat", "")
	if err != nil {
		t.Fatalf("build Chinese translation prompt: %v", err)
	}
	if strings.Contains(prompt, "customer_language_context") || strings.Contains(prompt, "Est-ce possible ?") {
		t.Fatalf("fixed Chinese translation should not include customer language context: %s", prompt)
	}
}

func TestRewritePromptIncludesStoreReplyRules(t *testing.T) {
	prompt, err := buildConversationReplyTransformPrompt("rewrite", "We can refund this today.", nil, "", "Refunds require manual approval.\nKeep replies under 80 words.")
	if err != nil {
		t.Fatalf("build rewrite prompt: %v", err)
	}
	for _, required := range []string{
		"<mandatory_store_reply_rules>",
		"Refunds require manual approval.",
		"Keep replies under 80 words.",
		"<reply_box_text>\nWe can refund this today.\n</reply_box_text>",
	} {
		if !strings.Contains(prompt, required) {
			t.Fatalf("rewrite prompt missing %q: %s", required, prompt)
		}
	}
}

func TestLogisticsReplyPromptUsesRawFactsWithoutChineseIntermediate(t *testing.T) {
	raw := `{"orderNumber":"#1044","trackingNumber":"SDH0098255640","carrier":"闪电猴-美狮敏感专线","providerStatus":"InTransit","latestEvent":{"status":"InTransit_Other","description":"清关完成 / Customs clearance completed","location":"US"}}`
	prompt, err := buildConversationReplyTransformPrompt("logistics_reply", raw, []Message{{
		Direction: MessageDirectionCustomer,
		Type:      MessageTypeText,
		Body:      "¿Dónde está mi pedido?",
	}}, "Order #1044", "")
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{
		"Use only the raw logistics facts",
		"language used by the customer",
		"¿Dónde está mi pedido?",
		`"trackingNumber":"SDH0098255640"`,
		`"providerStatus":"InTransit"`,
		`"description":"清关完成 / Customs clearance completed"`,
		"Never mention, infer, or output a carrier",
		"translate only its Chinese text faithfully",
		"do not polish, summarize, normalize, interpret, or rewrite",
	} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("logistics reply prompt is missing %q: %s", expected, prompt)
		}
	}
	if strings.Contains(prompt, "最新物流进度") || strings.Contains(prompt, "物流单号：") {
		t.Fatalf("logistics reply prompt rebuilt a Chinese customer-facing intermediate: %s", prompt)
	}
	if strings.Contains(prompt, "闪电猴-美狮敏感专线") || strings.Contains(prompt, `"carrier":`) {
		t.Fatalf("logistics reply prompt leaked the carrier fact: %s", prompt)
	}
	carriers := logisticsReplyCarrierNames(raw)
	if len(carriers) != 1 || carriers[0] != "闪电猴-美狮敏感专线" {
		t.Fatalf("carrier guard facts = %#v", carriers)
	}
}

func TestCustomerReplyPolicyRejectsCarrierAndUnexpectedChinese(t *testing.T) {
	t.Parallel()
	if !customerReplyViolatesPolicy("Shipped via Fast Carrier.", "Where is my order?", []string{"Fast Carrier"}) {
		t.Fatal("known carrier must be rejected")
	}
	if !customerReplyViolatesPolicy("Tracking update: 清关完成", "Where is my order?", nil) {
		t.Fatal("Chinese residue must be rejected for an English customer")
	}
	if customerReplyViolatesPolicy("Tracking update: Customs clearance completed", "Where is my order?", nil) {
		t.Fatal("clean English reply must pass")
	}
	if customerReplyViolatesPolicy("If you have any other questions, let us know.", "Where is my order?", []string{"Other"}) {
		t.Fatal("Shopify's placeholder carrier must not match ordinary reply text")
	}
	if customerReplyViolatesPolicy("物流更新：清关完成", "请查询我的物流", nil) {
		t.Fatal("Chinese is valid when the customer uses Chinese")
	}
}
