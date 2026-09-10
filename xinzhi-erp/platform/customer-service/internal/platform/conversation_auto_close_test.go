package platform

import (
	"context"
	"testing"
	"time"
)

func TestMemoryStoreCloseInactiveCustomerConversations(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()

	chatAgentLast := createAssignedAutoCloseConversation(t, store, SourceTypeShopifyChat, "agent-1")
	if _, _, err := store.AddAgentMessage(ctx, Message{ConversationID: chatAgentLast.ID, Body: "Anything else?"}, "agent-1"); err != nil {
		t.Fatalf("AddAgentMessage for chat failed: %v", err)
	}
	if _, _, err := store.AddMessage(ctx, Message{ConversationID: chatAgentLast.ID, Direction: MessageDirectionSystem, Body: "Ticket status updated"}); err != nil {
		t.Fatalf("AddMessage workflow event failed: %v", err)
	}

	chatCustomerLast := createAssignedAutoCloseConversation(t, store, SourceTypeShopifyChat, "agent-2")
	if _, _, err := store.AddMessage(ctx, Message{ConversationID: chatCustomerLast.ID, Direction: MessageDirectionCustomer, Body: "Still waiting."}); err != nil {
		t.Fatalf("AddMessage for chat failed: %v", err)
	}

	emailAgentLast := createAssignedAutoCloseConversation(t, store, SourceTypeEmail, "agent-3")
	if _, _, err := store.AddAgentMessage(ctx, Message{ConversationID: emailAgentLast.ID, Body: "Email reply."}, "agent-3"); err != nil {
		t.Fatalf("AddAgentMessage for email failed: %v", err)
	}

	closed, err := store.CloseInactiveCustomerConversations(ctx, time.Now().UTC().Add(time.Minute))
	if err != nil {
		t.Fatalf("CloseInactiveCustomerConversations failed: %v", err)
	}
	closedIDs := map[string]bool{}
	for _, conversation := range closed {
		closedIDs[conversation.ID] = true
	}
	if len(closed) != 2 || !closedIDs[chatAgentLast.ID] || !closedIDs[emailAgentLast.ID] {
		t.Fatalf("closed = %#v, want chat %s and email %s", closed, chatAgentLast.ID, emailAgentLast.ID)
	}
	assertConversationStatus(t, store, chatAgentLast.ID, ConversationStatusClosed)
	assertConversationStatus(t, store, chatCustomerLast.ID, ConversationStatusAssigned)
	assertConversationStatus(t, store, emailAgentLast.ID, ConversationStatusClosed)
}

func TestMemoryStoreDoesNotCloseAgentReplyBeforeTimeout(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	conversation := createAssignedAutoCloseConversation(t, store, SourceTypeEmail, "agent-1")
	if _, _, err := store.AddAgentMessage(ctx, Message{ConversationID: conversation.ID, Body: "Email reply."}, "agent-1"); err != nil {
		t.Fatalf("AddAgentMessage failed: %v", err)
	}
	closed, err := store.CloseInactiveCustomerConversations(ctx, time.Now().UTC().Add(-customerReplyTimeout))
	if err != nil {
		t.Fatalf("CloseInactiveCustomerConversations failed: %v", err)
	}
	if len(closed) != 0 {
		t.Fatalf("closed = %#v, want none before timeout", closed)
	}
	assertConversationStatus(t, store, conversation.ID, ConversationStatusAssigned)
}

func TestMemoryStoreSystemEventDoesNotDelayCustomerInactivityTimeout(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	conversation := createAssignedAutoCloseConversation(t, store, SourceTypeShopifyChat, "agent-1")
	now := time.Now().UTC()
	if _, _, err := store.AddAgentMessage(ctx, Message{
		ConversationID: conversation.ID, Body: "Anything else?", CreatedAt: now.Add(-6 * time.Minute),
	}, "agent-1"); err != nil {
		t.Fatalf("AddAgentMessage failed: %v", err)
	}
	if _, _, err := store.AddMessage(ctx, Message{
		ConversationID: conversation.ID, Direction: MessageDirectionSystem, Body: "Ticket status updated", CreatedAt: now,
	}); err != nil {
		t.Fatalf("AddMessage system event failed: %v", err)
	}
	closed, err := store.CloseInactiveCustomerConversations(ctx, now.Add(-customerReplyTimeout))
	if err != nil {
		t.Fatalf("CloseInactiveCustomerConversations failed: %v", err)
	}
	if len(closed) != 1 || closed[0].ID != conversation.ID {
		t.Fatalf("closed = %#v, want %s", closed, conversation.ID)
	}
}

func TestPostgresCloseInactiveCustomerConversationsIntegration(t *testing.T) {
	ctx, store := openIsolatedPostgresTestStore(t)
	passwordHash, err := hashPassword("auto-close-password")
	if err != nil {
		t.Fatal(err)
	}
	agent, err := store.CreateUser(ctx, User{Email: prefixedID("auto-close") + "@example.com", Role: UserRoleAgent, PasswordHash: passwordHash})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	wantClosed := map[string]bool{}
	for _, sourceType := range []string{SourceTypeShopifyChat, SourceTypeEmail} {
		shop, createErr := store.CreateShop(ctx, Shop{DisplayName: "Auto close integration " + sourceType})
		if createErr != nil {
			t.Fatal(createErr)
		}
		source, createErr := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: sourceType})
		if createErr != nil {
			t.Fatal(createErr)
		}
		conversation, createErr := store.CreateConversation(ctx, Conversation{ShopID: shop.ID, SourceID: source.ID, Kind: ConversationKindCustomer})
		if createErr != nil {
			t.Fatal(createErr)
		}
		conversation, createErr = store.ClaimConversation(ctx, conversation.ID, agent.ID)
		if createErr != nil {
			t.Fatal(createErr)
		}
		if _, _, createErr = store.AddAgentMessage(ctx, Message{ConversationID: conversation.ID, Body: "Anything else?", CreatedAt: now.Add(-6 * time.Minute)}, agent.ID); createErr != nil {
			t.Fatal(createErr)
		}
		if sourceType == SourceTypeShopifyChat {
			if _, _, createErr = store.AddMessage(ctx, Message{ConversationID: conversation.ID, Direction: MessageDirectionSystem, Body: "Ticket updated", CreatedAt: now}); createErr != nil {
				t.Fatal(createErr)
			}
		}
		wantClosed[conversation.ID] = true
	}

	closed, err := store.CloseInactiveCustomerConversations(ctx, now.Add(-customerReplyTimeout))
	if err != nil {
		t.Fatal(err)
	}
	for _, conversation := range closed {
		delete(wantClosed, conversation.ID)
	}
	if len(wantClosed) != 0 {
		t.Fatalf("PostgreSQL auto-close missed conversations: %#v", wantClosed)
	}
}

func createAssignedAutoCloseConversation(t *testing.T, store *MemoryStore, sourceType string, agentID string) Conversation {
	t.Helper()
	ctx := context.Background()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Auto-close shop " + agentID})
	if err != nil {
		t.Fatalf("CreateShop failed: %v", err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: sourceType})
	if err != nil {
		t.Fatalf("CreateShopSource failed: %v", err)
	}
	conversation, err := store.CreateConversation(ctx, Conversation{
		ShopID:   shop.ID,
		SourceID: source.ID,
	})
	if err != nil {
		t.Fatalf("CreateConversation failed: %v", err)
	}
	conversation, err = store.ClaimConversation(ctx, conversation.ID, agentID)
	if err != nil {
		t.Fatalf("ClaimConversation failed: %v", err)
	}
	return conversation
}

func assertConversationStatus(t *testing.T, store *MemoryStore, conversationID string, want string) {
	t.Helper()
	conversation, err := store.GetConversation(context.Background(), conversationID)
	if err != nil {
		t.Fatalf("GetConversation(%s) failed: %v", conversationID, err)
	}
	if conversation.Status != want {
		t.Fatalf("conversation %s status = %q, want %q", conversationID, conversation.Status, want)
	}
}
