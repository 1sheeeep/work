package platform

import (
	"testing"
	"time"
)

func TestPostgresEmailStatisticsPaginationIntegration(t *testing.T) {
	ctx, store := openIsolatedPostgresTestStore(t)

	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Email statistics integration", Status: ShopStatusActive, Metadata: map[string]string{"internalNote": "Integration note"}})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{
		ShopID: shop.ID, Type: SourceTypeEmail, Provider: "gmail", Address: "statistics@example.com", Status: SourceStatusActive,
	})
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateConversation(ctx, Conversation{
		ShopID: shop.ID, SourceID: source.ID, CustomerName: "Sender", CustomerEmail: "sender@example.com",
		Subject: "Account notification", Status: ConversationStatusOpen, Kind: ConversationKindSystem,
		Classification: automatedSystemNotificationClassification,
	})
	if err != nil {
		t.Fatal(err)
	}
	baseTime := time.Date(2026, 8, 19, 8, 0, 0, 0, time.UTC)
	for index := 0; index < 3; index++ {
		if _, _, err := store.AddMessage(ctx, Message{
			ConversationID: conversation.ID, Direction: MessageDirectionSystem, Type: MessageTypeText,
			Body: "notification", SenderEmail: "sender@example.com", SourceMessageID: "source-" + string(rune('a'+index)),
			CreatedAt: baseTime.Add(time.Duration(index) * time.Minute),
		}); err != nil {
			t.Fatal(err)
		}
	}

	rows, total, err := store.QueryEmailStatistics(ctx, emailStatisticsFilter{
		ShopID: shop.ID, Search: "sender@example.com", Page: 2, PageSize: 2,
	}, "", true)
	if err != nil {
		t.Fatal(err)
	}
	if total != 3 || len(rows) != 1 || rows[0].Message.SourceMessageID != "source-a" {
		t.Fatalf("page = total:%d rows:%#v", total, rows)
	}
	if rows[0].Shop.Metadata["internalNote"] != "Integration note" {
		t.Fatalf("shop note was not returned: %#v", rows[0].Shop.Metadata)
	}
}
