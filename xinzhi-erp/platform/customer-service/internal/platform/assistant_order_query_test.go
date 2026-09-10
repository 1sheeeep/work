package platform

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestConversationOrderQueryUsesCustomerEmailEvenWithExplicitOrder(t *testing.T) {
	conversation := Conversation{
		CustomerEmail: "repeat-customer@example.com",
		Subject:       "Re: Shipping update for order #TX-1001",
	}
	if got := conversationOrderQuery(conversation); got != `email:"repeat-customer@example.com"` {
		t.Fatalf("conversationOrderQuery() = %q, want exact customer email", got)
	}
}

func TestConversationOrderQueryFallsBackToCustomerEmail(t *testing.T) {
	conversation := Conversation{
		CustomerEmail: "repeat-customer@example.com",
		Subject:       "Where is my latest order?",
	}
	if got := conversationOrderQuery(conversation); got != `email:"repeat-customer@example.com"` {
		t.Fatalf("conversationOrderQuery() = %q, want customer email", got)
	}
}

func TestConversationOrderQueryDoesNotUseNameOrOrderWithoutEmail(t *testing.T) {
	conversation := Conversation{CustomerName: "Repeated Name", Subject: "Order #1001"}
	if got := conversationOrderQuery(conversation); got != "" {
		t.Fatalf("conversationOrderQuery() = %q, want no query without customer email", got)
	}
}

func TestOrdersForConversationFiltersByEmailAndSelectsExplicitOrder(t *testing.T) {
	server, conversation := newAssistantOrderTestServer(t)
	calls := 0
	server.publicShopifyOrderSearch = func(_ context.Context, _, _, query string, limit int) (ShopifyOrderSearchResult, error) {
		calls++
		if query != `email:"buyer@example.com"` || limit != 20 {
			t.Fatalf("unexpected Shopify query: %q limit=%d", query, limit)
		}
		return ShopifyOrderSearchResult{Orders: []ShopifyOrderSummary{
			{ID: "wrong-order", Name: "#3094", Email: "someone-else@example.com"},
			{ID: "changed-email", Name: "#1055", Email: "old-address@example.com", Customer: ShopifyCustomer{Email: "buyer@example.com"}},
			{ID: "right-order", Name: "#1055", Customer: ShopifyCustomer{Email: "buyer@example.com"}},
		}}, nil
	}

	orders := server.ordersForConversation(t.Context(), conversation)
	if calls != 1 || len(orders) != 1 || orders[0].ID != "right-order" {
		t.Fatalf("ordersForConversation() = %#v calls=%d, want only verified #1055", orders, calls)
	}
}

func TestVerifiedOrdersRejectsTargetedOrderWithDifferentEmail(t *testing.T) {
	server, conversation := newAssistantOrderTestServer(t)
	server.publicShopifyOrderSearch = func(_ context.Context, _, _, query string, _ int) (ShopifyOrderSearchResult, error) {
		switch query {
		case `email:"buyer@example.com"`:
			return ShopifyOrderSearchResult{}, nil
		case "name:#1055":
			return ShopifyOrderSearchResult{Orders: []ShopifyOrderSummary{{
				ID: "wrong-customer", Name: "#1055", Email: "someone-else@example.com",
			}}}, nil
		default:
			t.Fatalf("unexpected Shopify query: %q", query)
			return ShopifyOrderSearchResult{}, nil
		}
	}

	orders, err := server.verifiedShopifyOrdersForConversation(t.Context(), conversation, "#1055", 3)
	if !errors.Is(err, ErrNotFound) || len(orders) != 0 {
		t.Fatalf("verifiedShopifyOrdersForConversation() = %#v, %v; want ErrNotFound", orders, err)
	}
}

func TestGenerateConversationDraftOmitsCarrierAndRetriesPolicyViolation(t *testing.T) {
	server, baseConversation := newAssistantOrderTestServer(t)
	ctx := t.Context()
	sources, err := server.store.ListShopSources(ctx, baseConversation.ShopID)
	if err != nil || len(sources) == 0 {
		t.Fatalf("list shop sources: %v", err)
	}
	conversation, err := server.store.CreateConversation(ctx, Conversation{
		ShopID: baseConversation.ShopID, SourceID: sources[0].ID,
		CustomerEmail: "buyer@example.com", Subject: "Re: shipment for order #1055",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := server.store.AddMessage(ctx, Message{
		ConversationID: conversation.ID, Direction: MessageDirectionCustomer, Type: MessageTypeText,
		Body: "Please send me the latest update in English.",
	}); err != nil {
		t.Fatal(err)
	}
	server.publicShopifyOrderSearch = func(_ context.Context, _, _, _ string, _ int) (ShopifyOrderSearchResult, error) {
		return ShopifyOrderSearchResult{Orders: []ShopifyOrderSummary{{
			ID: "order-1055", Name: "#1055", Email: "buyer@example.com",
			Fulfillments: []ShopifyFulfillment{{TrackingInfo: []ShopifyTrackingInfo{{
				Company: "桐溪供应链-美国专线", Number: "TX1055", URL: "https://www.17track.net/en?nums=TX1055",
			}}}},
		}}}, nil
	}

	var calls atomic.Int32
	aiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || len(payload.Messages) != 2 {
			http.Error(w, "invalid AI request", http.StatusBadRequest)
			return
		}
		prompt := payload.Messages[1].Content
		if strings.Contains(prompt, "桐溪供应链-美国专线") || !strings.Contains(prompt, "TX1055") {
			http.Error(w, "carrier leaked or tracking number missing", http.StatusBadRequest)
			return
		}
		call := calls.Add(1)
		if call == 2 && !strings.Contains(prompt, "<output_correction>") {
			http.Error(w, "policy correction missing", http.StatusBadRequest)
			return
		}
		content := "Your order #1055 is in transit. Tracking number: TX1055."
		if call == 1 {
			content = "Your order shipped via 桐溪供应链-美国专线. Tracking number: TX1055."
		}
		writeJSONResponse(w, http.StatusOK, map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": content}}},
		})
	}))
	defer aiServer.Close()
	t.Setenv("AI_API_KEY", "carrier-policy-test-key")
	t.Setenv("AI_BASE_URL", aiServer.URL)
	t.Setenv("AI_MODEL", "carrier-policy-test-model")

	result, err := server.generateConversationDraft(ctx, conversation, "")
	if err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 || strings.Contains(result.Text, "桐溪供应链-美国专线") || strings.ContainsRune(result.Text, '桐') {
		t.Fatalf("guarded draft = %#v, calls=%d", result, calls.Load())
	}
}

func newAssistantOrderTestServer(t *testing.T) (*Server, Conversation) {
	t.Helper()
	store := NewMemoryStore()
	shop, err := store.CreateShop(t.Context(), Shop{DisplayName: "Order Test Shop", ExternalID: "order-test.myshopify.com"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateShopSource(t.Context(), ShopSource{
		ShopID: shop.ID, Type: SourceTypeShopifyAPI, Address: "order-test.myshopify.com",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveShopifyInstallation(t.Context(), ShopifyInstallation{
		ShopID: shop.ID, ShopDomain: "order-test.myshopify.com", AccessToken: "test-token",
	}); err != nil {
		t.Fatal(err)
	}
	return NewServer(store), Conversation{
		ShopID: shop.ID, CustomerEmail: "buyer@example.com", Subject: "Re: shipment for order #1055",
	}
}
