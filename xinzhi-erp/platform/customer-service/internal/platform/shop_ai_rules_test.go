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

func TestAssignedAgentCanMaintainShopAIReplyRules(t *testing.T) {
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var agent User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email:       "rules-agent@example.com",
		DisplayName: "Rules Agent",
		Password:    "agent-password",
		Role:        UserRoleAgent,
	}, http.StatusCreated, &agent)

	var assignedShop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Assigned Rules Shop"}, http.StatusCreated, &assignedShop)
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/shops/"+assignedShop.ID, adminToken, updateShopRequest{
		Metadata: map[string]string{"internalNote": "preserve me"},
	}, http.StatusOK, &assignedShop)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+assignedShop.ID+"/agents", adminToken, assignShopUserRequest{UserID: agent.ID}, http.StatusCreated, nil)

	var hiddenShop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Hidden Rules Shop"}, http.StatusCreated, &hiddenShop)

	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email: "rules-agent@example.com", Password: "agent-password",
	}, http.StatusOK, &login)

	rulesURL := server.URL + "/api/v1/shops/" + assignedShop.ID + "/ai-reply-rules"
	var empty shopAIReplyRulesResponse
	requestJSON(t, http.MethodGet, rulesURL, login.Token, nil, http.StatusOK, &empty)
	if empty.Rules != "" {
		t.Fatalf("expected empty initial rules, got %#v", empty)
	}

	var updated shopAIReplyRulesResponse
	requestJSON(t, http.MethodPatch, rulesURL, login.Token, shopAIReplyRulesRequest{
		Rules: "  Keep replies concise. \r\n\r\n Refunds require manual approval.  ",
	}, http.StatusOK, &updated)
	if updated.Rules != "Keep replies concise.\nRefunds require manual approval." {
		t.Fatalf("rules were not normalized: %#v", updated)
	}
	if updated.UpdatedBy != agent.ID || updated.UpdatedByName != agent.DisplayName || updated.UpdatedAt == "" {
		t.Fatalf("rule audit metadata missing: %#v", updated)
	}

	stored, err := store.GetShop(context.Background(), assignedShop.ID)
	if err != nil {
		t.Fatalf("load updated shop: %v", err)
	}
	if stored.Metadata["internalNote"] != "preserve me" {
		t.Fatalf("unrelated shop metadata was overwritten: %#v", stored.Metadata)
	}
	if stored.Metadata[shopAIReplyRulesKey] != updated.Rules {
		t.Fatalf("rules were not persisted: %#v", stored.Metadata)
	}

	requestJSON(t, http.MethodGet, server.URL+"/api/v1/shops/"+hiddenShop.ID+"/ai-reply-rules", login.Token, nil, http.StatusForbidden, nil)
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/shops/"+hiddenShop.ID+"/ai-reply-rules", login.Token, shopAIReplyRulesRequest{Rules: "Should fail."}, http.StatusForbidden, nil)
}

func TestNormalizeShopAIReplyRulesLimitsInput(t *testing.T) {
	if _, err := normalizeShopAIReplyRules(strings.Repeat("a", maxShopAIReplyRulesLength+1)); err == nil {
		t.Fatal("expected oversized rule text to be rejected")
	}
	if _, err := normalizeShopAIReplyRules(strings.Repeat("rule\n", maxShopAIReplyRuleLines+1)); err == nil {
		t.Fatal("expected too many rule lines to be rejected")
	}
}

func TestRelevantKnowledgePrioritizesStoreKnowledge(t *testing.T) {
	store := NewMemoryStore()
	ctx := context.Background()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Knowledge Priority Shop"})
	if err != nil {
		t.Fatalf("create shop: %v", err)
	}
	for index := 0; index < 4; index++ {
		if _, err := store.CreateKnowledge(ctx, KnowledgeEntry{
			Scope: KnowledgeScopeGlobal, Title: "shipping global", Answer: "global", Status: KnowledgeStatusPublished,
		}); err != nil {
			t.Fatalf("create global knowledge: %v", err)
		}
		if _, err := store.CreateKnowledge(ctx, KnowledgeEntry{
			Scope: KnowledgeScopeShop, ShopID: shop.ID, Title: "shipping store", Answer: "store", Status: KnowledgeStatusPublished,
		}); err != nil {
			t.Fatalf("create store knowledge: %v", err)
		}
	}

	entries, err := NewServer(store).relevantKnowledge(ctx, shop.ID, []Message{{Direction: MessageDirectionCustomer, Body: "shipping"}})
	if err != nil {
		t.Fatalf("load relevant knowledge: %v", err)
	}
	if len(entries) != 6 {
		t.Fatalf("expected three store and three global entries, got %d", len(entries))
	}
	for index, entry := range entries {
		if index < 3 && entry.Scope != KnowledgeScopeShop {
			t.Fatalf("store knowledge must come first: %#v", entries)
		}
		if index >= 3 && entry.Scope != KnowledgeScopeGlobal {
			t.Fatalf("global knowledge must follow store knowledge: %#v", entries)
		}
	}
}

func TestConversationDraftAppliesShopRulesInSingleRequest(t *testing.T) {
	var calls atomic.Int32
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
		calls.Add(1)
		prompt := payload.Messages[1].Content
		for _, required := range []string{
			"Factual priority: verified live Shopify data first, then store knowledge, then global knowledge.",
			"Keep replies under 10 words.",
			"Store knowledge references:",
			"Global knowledge references:",
			"Please answer the current question.",
		} {
			if !strings.Contains(prompt, required) {
				http.Error(w, "draft prompt missing "+required, http.StatusBadRequest)
				return
			}
		}
		if strings.Contains(prompt, "Do not repeat this quoted history.") {
			http.Error(w, "quoted email history leaked into the draft prompt", http.StatusBadRequest)
			return
		}
		writeJSONResponse(w, http.StatusOK, map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": "Short compliant reply."}}},
		})
	}))
	defer aiServer.Close()
	t.Setenv("AI_API_KEY", "rules-test-key")
	t.Setenv("AI_BASE_URL", aiServer.URL)
	t.Setenv("AI_MODEL", "rules-test-model")

	store := NewMemoryStore()
	ctx := context.Background()
	shop, err := store.CreateShop(ctx, Shop{
		DisplayName: "Draft Rules Shop",
		Metadata:    map[string]string{shopAIReplyRulesKey: "Keep replies under 10 words."},
	})
	if err != nil {
		t.Fatalf("create shop: %v", err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeShopifyChat})
	if err != nil {
		t.Fatalf("create source: %v", err)
	}
	conversation, err := store.CreateConversation(ctx, Conversation{ShopID: shop.ID, SourceID: source.ID, Subject: "Shipping question"})
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	if _, _, err := store.AddMessage(ctx, Message{ConversationID: conversation.ID, Direction: MessageDirectionCustomer, Body: "When will this ship?"}); err != nil {
		t.Fatalf("append message: %v", err)
	}
	if _, _, err := store.AddMessage(ctx, Message{
		ConversationID: conversation.ID,
		Direction:      MessageDirectionCustomer,
		Body:           "Please answer the current question. From: Store <store@example.com> Sent: Friday, April 17, 2026 1:43 PM To: Buyer <buyer@example.com> Subject: Shipping question Do not repeat this quoted history.",
	}); err != nil {
		t.Fatalf("append quoted message: %v", err)
	}
	if _, err := store.CreateKnowledge(ctx, KnowledgeEntry{
		Scope: KnowledgeScopeShop, ShopID: shop.ID, Title: "Shipping", Answer: "Store shipping answer.", Status: KnowledgeStatusPublished,
	}); err != nil {
		t.Fatalf("create store knowledge: %v", err)
	}
	if _, err := store.CreateKnowledge(ctx, KnowledgeEntry{
		Scope: KnowledgeScopeGlobal, Title: "Greeting", Answer: "Global greeting.", Status: KnowledgeStatusPublished,
	}); err != nil {
		t.Fatalf("create global knowledge: %v", err)
	}

	result, err := NewServer(store).generateConversationDraft(ctx, conversation, "")
	if err != nil {
		t.Fatalf("generate draft: %v", err)
	}
	if result.Text != "Short compliant reply." || calls.Load() != 1 {
		t.Fatalf("draft should use one rule-aware AI request: calls=%d result=%#v", calls.Load(), result)
	}
}
