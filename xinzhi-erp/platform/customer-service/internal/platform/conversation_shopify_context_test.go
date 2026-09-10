package platform

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestConversationShopifyContextUsesStoredOrderAndHandler(t *testing.T) {
	store := NewMemoryStore()
	shop, err := store.CreateShop(t.Context(), Shop{DisplayName: "HearthFind", Status: ShopStatusActive})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(t.Context(), ShopSource{ShopID: shop.ID, Type: SourceTypeEmail})
	if err != nil {
		t.Fatal(err)
	}
	app := NewServer(store)
	server := httptest.NewServer(app.Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	passwordHash, err := hashPassword("agent-password")
	if err != nil {
		t.Fatal(err)
	}
	agent, err := store.CreateUser(t.Context(), User{DisplayName: "Original Agent", Email: "agent@example.com", Role: UserRoleAgent, PasswordHash: passwordHash})
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateConversation(t.Context(), Conversation{
		ShopID: shop.ID, SourceID: source.ID, CustomerName: "Ivan Thornton", CustomerEmail: "itt@fmgwealth.com",
		Subject: "RE: Order #3800 confirmed", Status: ConversationStatusClosed, AssignedAgentID: agent.ID,
		Kind: ConversationKindCustomer, ReplyAllowed: true, RecordOrderNumber: "#3800",
	})
	if err != nil {
		t.Fatal(err)
	}

	app.storeShopifyOrderSnapshot(shop.ID, shopifyOrderSyncSnapshot{
		Orders: []ShopifyOrderSummary{
			{ID: "order-3900", Name: "#3900", Email: conversation.CustomerEmail, CreatedAt: "2026-08-13T00:00:00Z"},
			{ID: "order-3800", Name: "#3800", Email: "changed@example.com", CreatedAt: "2026-08-12T00:00:00Z", FinancialStatus: "PAID"},
		},
		State: ShopifyOrderSyncState{ShopID: shop.ID, ShopName: shop.DisplayName, State: "ok", LastSuccessAt: "2026-08-14T11:36:27Z"},
	})
	var result ConversationShopifyContext
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations/"+conversation.ID+"/shopify-context", adminToken, nil, http.StatusOK, &result)
	if result.ShopID != shop.ID || result.ShopName != shop.DisplayName {
		t.Fatalf("unexpected shop context: %#v", result)
	}
	if result.AssignedAgentID != agent.ID || result.AssignedAgentName != agent.DisplayName {
		t.Fatalf("unexpected handler context: %#v", result)
	}
	if result.OrderNumber != "#3800" || result.Order == nil || result.Order.ID != "order-3800" {
		t.Fatalf("stored order association was not preserved: %#v", result)
	}
	if result.SnapshotAt != "2026-08-14T11:36:27Z" {
		t.Fatalf("unexpected snapshot timestamp: %#v", result)
	}
}

func TestConversationShopifyContextSubjectMatchRequiresCustomerEmail(t *testing.T) {
	conversation := Conversation{CustomerEmail: "buyer@example.com"}
	orders := []ShopifyOrderSummary{
		{ID: "wrong", Name: "#3800", Email: "other@example.com"},
		{ID: "right", Name: "#3800", Email: "buyer@example.com"},
	}
	order, ok := conversationOrderFromSnapshot(orders, conversation, "", "#3800")
	if !ok || order.ID != "right" {
		t.Fatalf("subject-derived order must be verified by customer email: %#v, %v", order, ok)
	}
}
