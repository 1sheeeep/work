package platform

import (
	"testing"
)

func TestPostgresEmailProcessingPaginationIntegration(t *testing.T) {
	ctx, store := openIsolatedPostgresTestStore(t)

	passwordHash, err := hashPassword("email-processing-password")
	if err != nil {
		t.Fatal(err)
	}
	user, err := store.CreateUser(ctx, User{Email: prefixedID("email-processing") + "@example.com", Role: UserRoleAgent, PasswordHash: passwordHash})
	if err != nil {
		t.Fatal(err)
	}
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Email processing integration", Status: ShopStatusActive})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AssignUserToShop(ctx, shop.ID, user.ID); err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{
		ShopID: shop.ID, Type: SourceTypeEmail, Provider: "gmail", Address: "processing@example.com", Status: SourceStatusActive,
	})
	if err != nil {
		t.Fatal(err)
	}
	for index, subject := range []string{"Security alert", "Payment invoice"} {
		conversation, createErr := store.CreateConversation(ctx, Conversation{
			ShopID: shop.ID, SourceID: source.ID, CustomerName: "Platform Sender", CustomerEmail: "alerts@example.com",
			Subject: subject, Status: ConversationStatusOpen, Kind: ConversationKindSystem,
		})
		if createErr != nil {
			t.Fatal(createErr)
		}
		if _, _, createErr = store.AddMessage(ctx, Message{
			ConversationID: conversation.ID, Direction: MessageDirectionSystem, Type: MessageTypeText,
			Body: "Integration preview " + subject,
		}); createErr != nil {
			t.Fatal(createErr)
		}
		if index == 0 {
			if _, createErr = store.ReplaceConversationEmailTags(ctx, conversation.ID, []EmailProcessingTag{{Label: "Urgent", Color: "red"}}, user.ID); createErr != nil {
				t.Fatal(createErr)
			}
		}
	}

	rows, total, openCount, tagOptions, err := store.QueryEmailProcessing(ctx, emailProcessingFilter{
		ShopID: shop.ID, Search: "alerts@example.com", Page: 1, PageSize: 1,
	}, user.ID, user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if total != 2 || openCount != 2 || len(rows) != 1 || rows[0].LatestBody == "" || !rows[0].Conversation.Unread {
		t.Fatalf("page = total:%d open:%d rows:%#v", total, openCount, rows)
	}
	if len(tagOptions) != 1 || tagOptions[0].Label != "Urgent" {
		t.Fatalf("tag options = %#v", tagOptions)
	}

	tagged, taggedTotal, _, _, err := store.QueryEmailProcessing(ctx, emailProcessingFilter{
		ShopID: shop.ID, Tag: "urgent", Page: 1, PageSize: 30,
	}, user.ID, user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if taggedTotal != 1 || len(tagged) != 1 || len(tagged[0].Tags) != 1 || tagged[0].Tags[0].Label != "Urgent" {
		t.Fatalf("tagged page = total:%d rows:%#v", taggedTotal, tagged)
	}
}
