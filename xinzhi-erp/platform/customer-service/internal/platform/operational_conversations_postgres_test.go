package platform

import (
	"testing"
)

func TestPostgresOperationalConversationQueryExcludesHistoryAndNotifications(t *testing.T) {
	ctx, store := openIsolatedPostgresTestStore(t)

	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Operational query integration", Status: ShopStatusActive})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeEmail, Status: SourceStatusActive})
	if err != nil {
		t.Fatal(err)
	}
	operational, err := store.CreateConversation(ctx, Conversation{
		ShopID: shop.ID, SourceID: source.ID, CustomerName: "Customer", CustomerEmail: "customer@example.com",
		Subject: "Need help", Status: ConversationStatusOpen, Kind: ConversationKindCustomer,
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, conversation := range []Conversation{
		{ShopID: shop.ID, SourceID: source.ID, CustomerName: "History", CustomerEmail: "history@example.com", Subject: "Old mail", Status: ConversationStatusClosed, Kind: ConversationKindCustomer, Classification: historicalEmailClassification + "normal conversation"},
		{ShopID: shop.ID, SourceID: source.ID, CustomerName: "Shopify", CustomerEmail: "store+123@shopifyemail.com", Subject: "Platform notice", Status: ConversationStatusOpen, Kind: ConversationKindCustomer},
		{ShopID: shop.ID, SourceID: source.ID, CustomerName: "System", CustomerEmail: "system@example.com", Subject: "System", Status: ConversationStatusOpen, Kind: ConversationKindSystem},
	} {
		if _, err := store.CreateConversation(ctx, conversation); err != nil {
			t.Fatal(err)
		}
	}

	items, err := store.ListOperationalCustomerConversations(ctx, ConversationFilter{ShopID: shop.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].ID != operational.ID {
		t.Fatalf("operational conversations = %#v", items)
	}
	if !items[0].CustomerLastMessageAt.Equal(items[0].LastMessageAt) {
		t.Fatalf("customer last message = %v, want %v", items[0].CustomerLastMessageAt, items[0].LastMessageAt)
	}
}
