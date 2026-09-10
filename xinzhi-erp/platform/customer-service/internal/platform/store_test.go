package platform

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestMemoryStoreShopSourceConversationMessageFlow(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()

	shop, err := store.CreateShop(ctx, Shop{DisplayName: "PoshPebble"})
	if err != nil {
		t.Fatalf("CreateShop failed: %v", err)
	}
	if shop.ID == "" {
		t.Fatal("CreateShop returned empty ID")
	}

	source, err := store.CreateShopSource(ctx, ShopSource{
		ShopID:   shop.ID,
		Type:     SourceTypeShopifyChat,
		Provider: "shopify_app",
	})
	if err != nil {
		t.Fatalf("CreateShopSource failed: %v", err)
	}

	conversation, err := store.CreateConversation(ctx, Conversation{
		ShopID:        shop.ID,
		SourceID:      source.ID,
		CustomerName:  "Carlos",
		CustomerEmail: "carlos@example.com",
		Subject:       "Product question",
	})
	if err != nil {
		t.Fatalf("CreateConversation failed: %v", err)
	}

	message, updated, err := store.AddMessage(ctx, Message{
		ConversationID: conversation.ID,
		Direction:      MessageDirectionCustomer,
		Body:           "Is this item still available?",
		SenderName:     "Carlos",
		SenderEmail:    "carlos@example.com",
	})
	if err != nil {
		t.Fatalf("AddMessage failed: %v", err)
	}
	if message.ID == "" {
		t.Fatal("AddMessage returned empty ID")
	}
	if updated.LastMessageAt.Before(conversation.LastMessageAt) {
		t.Fatalf("conversation LastMessageAt moved backwards: before=%s after=%s", conversation.LastMessageAt, updated.LastMessageAt)
	}

	conversations, err := store.ListConversations(ctx, ConversationFilter{ShopID: shop.ID})
	if err != nil {
		t.Fatalf("ListConversations failed: %v", err)
	}
	if len(conversations) != 1 || conversations[0].ID != conversation.ID {
		t.Fatalf("ListConversations returned %#v", conversations)
	}

	messages, err := store.ListMessages(ctx, conversation.ID)
	if err != nil {
		t.Fatalf("ListMessages failed: %v", err)
	}
	if len(messages) != 1 || messages[0].Body != "Is this item still available?" {
		t.Fatalf("ListMessages returned %#v", messages)
	}
}

func TestMemoryStoreRejectsDuplicateBusinessAccountName(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	if _, err := store.CreateShop(ctx, Shop{DisplayName: "floravyne"}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateShop(ctx, Shop{DisplayName: "  FLORAVYNE  "}); !errors.Is(err, ErrConflict) {
		t.Fatalf("duplicate business account error = %v, want conflict", err)
	}
	shops, err := store.ListShops(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(shops) != 1 {
		t.Fatalf("duplicate business account was created: %#v", shops)
	}
}

func TestMemoryStoreListConversationsUsesLatestCustomerMessageTime(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Priority Shop"})
	if err != nil {
		t.Fatalf("CreateShop failed: %v", err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeShopifyChat})
	if err != nil {
		t.Fatalf("CreateShopSource failed: %v", err)
	}
	conversation, err := store.CreateConversation(ctx, Conversation{ShopID: shop.ID, SourceID: source.ID})
	if err != nil {
		t.Fatalf("CreateConversation failed: %v", err)
	}
	customerAt := conversation.CreatedAt.Add(time.Minute)
	agentAt := customerAt.Add(time.Hour)
	if _, _, err := store.AddMessage(ctx, Message{ConversationID: conversation.ID, Direction: MessageDirectionCustomer, Body: "Need help", CreatedAt: customerAt}); err != nil {
		t.Fatalf("AddMessage customer failed: %v", err)
	}
	if _, _, err := store.AddMessage(ctx, Message{ConversationID: conversation.ID, Direction: MessageDirectionAgent, Body: "How can I help?", CreatedAt: agentAt}); err != nil {
		t.Fatalf("AddMessage agent failed: %v", err)
	}
	items, err := store.ListConversations(ctx, ConversationFilter{ShopID: shop.ID})
	if err != nil {
		t.Fatalf("ListConversations failed: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("ListConversations returned %#v", items)
	}
	if !items[0].CustomerLastMessageAt.Equal(customerAt) {
		t.Fatalf("CustomerLastMessageAt = %s, want %s", items[0].CustomerLastMessageAt, customerAt)
	}
	if !items[0].LastMessageAt.Equal(agentAt) {
		t.Fatalf("LastMessageAt = %s, want %s", items[0].LastMessageAt, agentAt)
	}
	if items[0].LastMessageDirection != MessageDirectionAgent {
		t.Fatalf("LastMessageDirection = %q, want %q", items[0].LastMessageDirection, MessageDirectionAgent)
	}
}

func TestMemoryStoreInternalSystemMessageDoesNotActAsCustomerReply(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Workflow Shop"})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeShopifyChat})
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateConversation(ctx, Conversation{ShopID: shop.ID, SourceID: source.ID})
	if err != nil {
		t.Fatal(err)
	}
	passwordHash, err := hashPassword("workflow-agent-password")
	if err != nil {
		t.Fatal(err)
	}
	agent, err := store.CreateUser(ctx, User{Email: "workflow-agent@example.com", Role: UserRoleAgent, PasswordHash: passwordHash})
	if err != nil {
		t.Fatal(err)
	}
	customerAt := conversation.CreatedAt.Add(time.Minute)
	customerMessage, _, err := store.AddMessage(ctx, Message{
		ConversationID: conversation.ID,
		Direction:      MessageDirectionCustomer,
		Body:           "Please help",
		CreatedAt:      customerAt,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.ClaimConversation(ctx, conversation.ID, agent.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.MarkConversationRead(ctx, agent.ID, conversation.ID, customerMessage.CreatedAt); err != nil {
		t.Fatal(err)
	}
	closed, err := store.CloseConversation(ctx, conversation.ID, agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, updated, err := store.AddMessage(ctx, Message{
		ConversationID: conversation.ID,
		Direction:      MessageDirectionSystem,
		Body:           "Ticket T-100 was resolved",
		CreatedAt:      customerAt.Add(time.Minute),
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Status != ConversationStatusClosed || updated.AssignedAgentID != closed.AssignedAgentID {
		t.Fatalf("internal system message changed conversation ownership: %#v", updated)
	}
	unread, err := store.ListUnreadConversationIDs(ctx, agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	if containsString(unread, conversation.ID) {
		t.Fatalf("internal system message made customer conversation unread: %#v", unread)
	}
	items, err := store.ListConversations(ctx, ConversationFilter{ShopID: shop.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || !items[0].CustomerLastMessageAt.Equal(customerAt) {
		t.Fatalf("system message changed customer activity time: %#v", items)
	}
}

func TestMemoryStoreResponseSamplesKeepReplyingAgentAcrossTransfer(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Response Metrics Shop"})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeShopifyChat})
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateConversation(ctx, Conversation{ShopID: shop.ID, SourceID: source.ID})
	if err != nil {
		t.Fatal(err)
	}
	start := conversation.CreatedAt.Add(time.Minute)
	if _, _, err := store.AddMessage(ctx, Message{ConversationID: conversation.ID, Direction: MessageDirectionCustomer, Body: "First question", CreatedAt: start}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ClaimConversation(ctx, conversation.ID, "agent-1"); err != nil {
		t.Fatal(err)
	}
	firstReply, _, err := store.AddAgentMessage(ctx, Message{ConversationID: conversation.ID, Body: "First answer", CreatedAt: start.Add(time.Minute)}, "agent-1")
	if err != nil {
		t.Fatal(err)
	}
	if firstReply.Metadata[messageAgentIDMetadataKey] != "agent-1" {
		t.Fatalf("agent identity was not persisted on reply: %#v", firstReply.Metadata)
	}
	if _, err := store.UpdateConversation(ctx, conversation.ID, ConversationUpdate{SetAssignedAgentID: true, AssignedAgentID: "agent-2"}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.AddMessage(ctx, Message{ConversationID: conversation.ID, Direction: MessageDirectionCustomer, Body: "Second question", CreatedAt: start.Add(2 * time.Minute)}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.AddAgentMessage(ctx, Message{ConversationID: conversation.ID, Body: "Second answer", CreatedAt: start.Add(3 * time.Minute)}, "agent-2"); err != nil {
		t.Fatal(err)
	}
	samples, err := store.ListResponseSamples(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(samples) != 2 || samples[0].AgentID != "agent-1" || samples[1].AgentID != "agent-2" {
		t.Fatalf("response samples were attributed to the current assignee instead of each replying agent: %#v", samples)
	}
}

func TestMemoryStoreAgentReplyKeepsRealtimeConversationOrderingFields(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Realtime Reply Shop"})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeEmail})
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateConversation(ctx, Conversation{ShopID: shop.ID, SourceID: source.ID})
	if err != nil {
		t.Fatal(err)
	}
	customerAt := time.Now().UTC().Add(-time.Minute).Truncate(time.Millisecond)
	if _, _, err := store.AddMessage(ctx, Message{ConversationID: conversation.ID, Direction: MessageDirectionCustomer, Body: "Where is my order?", CreatedAt: customerAt}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ClaimConversation(ctx, conversation.ID, "agent-1"); err != nil {
		t.Fatal(err)
	}
	_, updated, err := store.AddAgentMessage(ctx, Message{ConversationID: conversation.ID, Body: "I am checking it now.", CreatedAt: customerAt.Add(time.Minute)}, "agent-1")
	if err != nil {
		t.Fatal(err)
	}
	if !updated.CustomerLastMessageAt.Equal(customerAt) || updated.LastMessageDirection != MessageDirectionAgent {
		t.Fatalf("agent reply returned incomplete realtime ordering fields: %#v", updated)
	}
}

func TestMemoryStoreClosedAtSurvivesRecordUpdatesAndClearsOnReopen(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Closed At Shop"})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeShopifyChat})
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateConversation(ctx, Conversation{ShopID: shop.ID, SourceID: source.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.ClaimConversation(ctx, conversation.ID, "agent-1"); err != nil {
		t.Fatal(err)
	}
	closed, err := store.CloseConversation(ctx, conversation.ID, "agent-1")
	if err != nil {
		t.Fatal(err)
	}
	if closed.ClosedAt.IsZero() {
		t.Fatal("closed conversation did not persist its close time")
	}
	updated, err := store.UpdateConversation(ctx, conversation.ID, ConversationUpdate{
		SetRecord:        true,
		RecordPrimary:    "已发货",
		RecordClassified: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !updated.ClosedAt.Equal(closed.ClosedAt) {
		t.Fatalf("record update changed close time: before=%s after=%s", closed.ClosedAt, updated.ClosedAt)
	}
	reopened, err := store.ReopenConversation(ctx, conversation.ID, "agent-1")
	if err != nil {
		t.Fatal(err)
	}
	if !reopened.ClosedAt.IsZero() {
		t.Fatalf("reopened conversation retained stale close time: %s", reopened.ClosedAt)
	}
}

func TestMemoryStorePreservesStructuredMessageContent(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Structured Shop"})
	if err != nil {
		t.Fatalf("CreateShop failed: %v", err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeShopifyChat})
	if err != nil {
		t.Fatalf("CreateShopSource failed: %v", err)
	}
	conversation, err := store.CreateConversation(ctx, Conversation{ShopID: shop.ID, SourceID: source.ID})
	if err != nil {
		t.Fatalf("CreateConversation failed: %v", err)
	}
	message, _, err := store.AddMessage(ctx, Message{
		ConversationID: conversation.ID,
		Type:           MessageTypeProduct,
		Body:           "Support Hoodie",
		Metadata:       map[string]string{"productId": "gid://shopify/Product/1", "price": "39.90"},
	})
	if err != nil {
		t.Fatalf("AddMessage failed: %v", err)
	}
	if message.Type != MessageTypeProduct || message.Metadata["price"] != "39.90" {
		t.Fatalf("structured message was not preserved: %#v", message)
	}
	if _, _, err := store.AddMessage(ctx, Message{
		ConversationID: conversation.ID,
		Type:           MessageTypeProduct,
		Body:           "Unsafe product",
		Metadata:       map[string]string{"onlineStoreUrl": "javascript:alert(1)"},
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("unsafe product URL must be rejected, got %v", err)
	}
}

func TestMemoryStoreKnowledgeScopesAndDuplicateConversationGuard(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Knowledge Shop"})
	if err != nil {
		t.Fatalf("CreateShop failed: %v", err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeShopifyChat})
	if err != nil {
		t.Fatalf("CreateShopSource failed: %v", err)
	}
	conversation, err := store.CreateConversation(ctx, Conversation{ShopID: shop.ID, SourceID: source.ID})
	if err != nil {
		t.Fatalf("CreateConversation failed: %v", err)
	}
	if _, err := store.CreateKnowledge(ctx, KnowledgeEntry{Scope: KnowledgeScopeShop, Title: "Shipping", Answer: "We will check."}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("expected missing shop to be invalid, got %v", err)
	}
	entry, err := store.CreateKnowledge(ctx, KnowledgeEntry{Scope: KnowledgeScopeShop, ShopID: shop.ID, Title: "Shipping", Answer: "We will check.", Tags: []string{" shipping ", "Shipping"}, ConversationID: conversation.ID})
	if err != nil {
		t.Fatalf("CreateKnowledge failed: %v", err)
	}
	if entry.Status != KnowledgeStatusPending || len(entry.Tags) != 1 || entry.Tags[0] != "shipping" {
		t.Fatalf("unexpected knowledge entry: %#v", entry)
	}
	if _, err := store.CreateKnowledge(ctx, KnowledgeEntry{Scope: KnowledgeScopeShop, ShopID: shop.ID, Title: "Duplicate", Answer: "No", ConversationID: conversation.ID}); !errors.Is(err, ErrConflict) {
		t.Fatalf("expected duplicate conversation knowledge conflict, got %v", err)
	}
	published, err := store.UpdateKnowledge(ctx, entry.ID, KnowledgeUpdate{Status: KnowledgeStatusPublished, ReviewedBy: "admin"})
	if err != nil {
		t.Fatalf("UpdateKnowledge failed: %v", err)
	}
	if published.Status != KnowledgeStatusPublished || published.ReviewedBy != "admin" || published.ReviewedAt.IsZero() {
		t.Fatalf("expected published reviewed entry, got %#v", published)
	}
	count, err := store.CountKnowledge(ctx, KnowledgeFilter{ShopID: shop.ID, Status: KnowledgeStatusPublished})
	if err != nil || count != 1 {
		t.Fatalf("expected one published shop knowledge entry, count=%d err=%v", count, err)
	}
	if err := store.DeleteKnowledge(ctx, entry.ID); err != nil {
		t.Fatalf("DeleteKnowledge failed: %v", err)
	}
	if _, err := store.GetKnowledge(ctx, entry.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted knowledge must not remain available, got %v", err)
	}
	if err := store.DeleteKnowledge(ctx, entry.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleting missing knowledge must return ErrNotFound, got %v", err)
	}
}

func TestMemoryStoreSharedQueueOwnershipAndCustomerReopen(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Shared Queue Shop"})
	if err != nil {
		t.Fatalf("CreateShop failed: %v", err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeShopifyChat})
	if err != nil {
		t.Fatalf("CreateShopSource failed: %v", err)
	}
	conversation, err := store.CreateConversation(ctx, Conversation{ShopID: shop.ID, SourceID: source.ID})
	if err != nil {
		t.Fatalf("CreateConversation failed: %v", err)
	}

	claimed, err := store.ClaimConversation(ctx, conversation.ID, "agent-1")
	if err != nil {
		t.Fatalf("ClaimConversation failed: %v", err)
	}
	if claimed.Status != ConversationStatusAssigned || claimed.AssignedAgentID != "agent-1" {
		t.Fatalf("unexpected claim result: %#v", claimed)
	}
	if _, err := store.ClaimConversation(ctx, conversation.ID, "agent-2"); !errors.Is(err, ErrConflict) {
		t.Fatalf("expected second claim to conflict, got %v", err)
	}
	if _, _, err := store.AddAgentMessage(ctx, Message{ConversationID: conversation.ID, Body: "Wrong owner"}, "agent-2"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("expected non-owner reply to be forbidden, got %v", err)
	}
	if _, _, err := store.AddAgentMessage(ctx, Message{ConversationID: conversation.ID, Body: "Owner reply"}, "agent-1"); err != nil {
		t.Fatalf("owner AddAgentMessage failed: %v", err)
	}
	if _, err := store.CloseConversation(ctx, conversation.ID, "agent-2"); !errors.Is(err, ErrConflict) {
		t.Fatalf("expected non-owner close to conflict, got %v", err)
	}
	closed, err := store.CloseConversation(ctx, conversation.ID, "agent-1")
	if err != nil || closed.Status != ConversationStatusClosed {
		t.Fatalf("CloseConversation failed: conversation=%#v err=%v", closed, err)
	}

	_, reopenedByCustomer, err := store.AddMessage(ctx, Message{
		ConversationID: conversation.ID,
		Direction:      MessageDirectionCustomer,
		Body:           "I still need help.",
	})
	if err != nil {
		t.Fatalf("AddMessage failed: %v", err)
	}
	if reopenedByCustomer.Status != ConversationStatusOpen || reopenedByCustomer.AssignedAgentID != "" {
		t.Fatalf("customer message did not return conversation to shared queue: %#v", reopenedByCustomer)
	}
}

func TestMemoryStoreCustomerReplyRestoresOriginalAssignedAgent(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Return Customer Shop"})
	if err != nil {
		t.Fatalf("CreateShop failed: %v", err)
	}
	passwordHash, err := hashPassword("return-agent-password")
	if err != nil {
		t.Fatalf("hashPassword failed: %v", err)
	}
	agent, err := store.CreateUser(ctx, User{Email: "return-agent@example.com", DisplayName: "Return Agent", Role: UserRoleAgent, PasswordHash: passwordHash})
	if err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}
	if _, err := store.AssignUserToShop(ctx, shop.ID, agent.ID); err != nil {
		t.Fatalf("AssignUserToShop failed: %v", err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeShopifyChat})
	if err != nil {
		t.Fatalf("CreateShopSource failed: %v", err)
	}
	conversation, err := store.CreateConversation(ctx, Conversation{ShopID: shop.ID, SourceID: source.ID})
	if err != nil {
		t.Fatalf("CreateConversation failed: %v", err)
	}
	if _, err := store.ClaimConversation(ctx, conversation.ID, agent.ID); err != nil {
		t.Fatalf("ClaimConversation failed: %v", err)
	}
	if _, err := store.CloseConversation(ctx, conversation.ID, agent.ID); err != nil {
		t.Fatalf("CloseConversation failed: %v", err)
	}
	_, reopened, err := store.AddMessage(ctx, Message{ConversationID: conversation.ID, Direction: MessageDirectionCustomer, Body: "I need more help."})
	if err != nil {
		t.Fatalf("AddMessage failed: %v", err)
	}
	if reopened.Status != ConversationStatusOpen || reopened.AssignedAgentID != "" {
		t.Fatalf("customer reply should return the conversation to the routing queue: %#v", reopened)
	}
}

func TestMemoryStoreConcurrentClaimHasSingleWinner(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Concurrent Shop"})
	if err != nil {
		t.Fatalf("CreateShop failed: %v", err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeShopifyChat})
	if err != nil {
		t.Fatalf("CreateShopSource failed: %v", err)
	}
	conversation, err := store.CreateConversation(ctx, Conversation{ShopID: shop.ID, SourceID: source.ID})
	if err != nil {
		t.Fatalf("CreateConversation failed: %v", err)
	}

	start := make(chan struct{})
	results := make(chan error, 2)
	var wait sync.WaitGroup
	for _, agentID := range []string{"agent-1", "agent-2"} {
		wait.Add(1)
		go func(id string) {
			defer wait.Done()
			<-start
			_, claimErr := store.ClaimConversation(ctx, conversation.ID, id)
			results <- claimErr
		}(agentID)
	}
	close(start)
	wait.Wait()
	close(results)

	successes := 0
	conflicts := 0
	for claimErr := range results {
		switch {
		case claimErr == nil:
			successes++
		case errors.Is(claimErr, ErrConflict):
			conflicts++
		default:
			t.Fatalf("unexpected claim error: %v", claimErr)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("expected one winner and one conflict, successes=%d conflicts=%d", successes, conflicts)
	}
}

func TestMemoryStoreRejectsSourceForMissingShop(t *testing.T) {
	_, err := NewMemoryStore().CreateShopSource(context.Background(), ShopSource{
		ShopID: "missing",
		Type:   SourceTypeEmail,
	})
	if err != ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestMemoryStoreDoesNotDefaultEmptyEmailSourceToConnected(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Mail Setup Shop"})
	if err != nil {
		t.Fatalf("CreateShop failed: %v", err)
	}
	emptyEmail, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeEmail})
	if err != nil {
		t.Fatalf("CreateShopSource empty email failed: %v", err)
	}
	if emptyEmail.Status != SourceStatusDisabled {
		t.Fatalf("empty email source should default disabled, got %#v", emptyEmail)
	}
	connectedEmail, err := store.CreateShopSource(ctx, ShopSource{
		ShopID:   shop.ID,
		Type:     SourceTypeEmail,
		Provider: "outlook",
		Address:  "support@example.com",
	})
	if err != nil {
		t.Fatalf("CreateShopSource connected email failed: %v", err)
	}
	if connectedEmail.Status != SourceStatusActive {
		t.Fatalf("email source with address should default active, got %#v", connectedEmail)
	}
}

func TestMemoryStoreDoesNotDefaultEmptyShopifyAPISourceToConnected(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Shopify Setup Shop"})
	if err != nil {
		t.Fatalf("CreateShop failed: %v", err)
	}
	emptyShopify, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeShopifyAPI})
	if err != nil {
		t.Fatalf("CreateShopSource empty Shopify API failed: %v", err)
	}
	if emptyShopify.Status != SourceStatusDisabled {
		t.Fatalf("empty Shopify API source should default disabled, got %#v", emptyShopify)
	}
	connectedShopify, err := store.CreateShopSource(ctx, ShopSource{
		ShopID:   shop.ID,
		Type:     SourceTypeShopifyAPI,
		Provider: "shopify_admin",
		Address:  "demo.myshopify.com",
	})
	if err != nil {
		t.Fatalf("CreateShopSource connected Shopify API failed: %v", err)
	}
	if connectedShopify.Status != SourceStatusActive {
		t.Fatalf("Shopify API source with domain should default active, got %#v", connectedShopify)
	}
}

func TestMemoryStoreUserSessionFlow(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()

	hash, err := hashPassword("password-123")
	if err != nil {
		t.Fatalf("hashPassword failed: %v", err)
	}
	user, err := store.CreateUser(ctx, User{
		Email:        " Agent@Example.com ",
		DisplayName:  "Agent",
		Role:         UserRoleAgent,
		PasswordHash: hash,
	})
	if err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}
	if user.Email != "agent@example.com" || user.Status != UserStatusActive || user.ReceptionLimit != 50 {
		t.Fatalf("unexpected user defaults: %#v", user)
	}

	if _, err := store.CreateUser(ctx, User{Email: "agent@example.com", PasswordHash: hash}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("expected duplicate email ErrInvalid, got %v", err)
	}

	token := hashSessionToken("session-token")
	session, err := store.CreateSession(ctx, Session{UserID: user.ID, TokenHash: token})
	if err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}
	if session.ID == "" || session.ExpiresAt.IsZero() {
		t.Fatalf("unexpected session defaults: %#v", session)
	}

	gotSession, gotUser, err := store.GetSessionByTokenHash(ctx, token)
	if err != nil {
		t.Fatalf("GetSessionByTokenHash failed: %v", err)
	}
	if gotSession.ID != session.ID || gotUser.ID != user.ID {
		t.Fatalf("unexpected session lookup: session=%#v user=%#v", gotSession, gotUser)
	}

	if err := store.DeleteSession(ctx, token); err != nil {
		t.Fatalf("DeleteSession failed: %v", err)
	}
	if _, _, err := store.GetSessionByTokenHash(ctx, token); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound after delete, got %v", err)
	}
}

func TestMemoryStoreShopAgentAssignmentFlow(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()

	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Assigned Shop"})
	if err != nil {
		t.Fatalf("CreateShop failed: %v", err)
	}
	hash, err := hashPassword("password-123")
	if err != nil {
		t.Fatalf("hashPassword failed: %v", err)
	}
	user, err := store.CreateUser(ctx, User{Email: "agent@example.com", PasswordHash: hash})
	if err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}

	assignment, err := store.AssignUserToShop(ctx, shop.ID, user.ID)
	if err != nil {
		t.Fatalf("AssignUserToShop failed: %v", err)
	}
	if assignment.ShopID != shop.ID || assignment.UserID != user.ID {
		t.Fatalf("unexpected assignment: %#v", assignment)
	}

	users, err := store.ListShopUsers(ctx, shop.ID)
	if err != nil {
		t.Fatalf("ListShopUsers failed: %v", err)
	}
	if len(users) != 1 || users[0].ID != user.ID {
		t.Fatalf("unexpected shop users: %#v", users)
	}

	shopIDs, err := store.ListUserShopIDs(ctx, user.ID)
	if err != nil {
		t.Fatalf("ListUserShopIDs failed: %v", err)
	}
	if len(shopIDs) != 1 || shopIDs[0] != shop.ID {
		t.Fatalf("unexpected user shop ids: %#v", shopIDs)
	}

	if err := store.UnassignUserFromShop(ctx, shop.ID, user.ID); err != nil {
		t.Fatalf("UnassignUserFromShop failed: %v", err)
	}
	shopIDs, err = store.ListUserShopIDs(ctx, user.ID)
	if err != nil {
		t.Fatalf("ListUserShopIDs after unassign failed: %v", err)
	}
	if len(shopIDs) != 0 {
		t.Fatalf("expected no assignments after unassign, got %#v", shopIDs)
	}
}

func TestMemoryStoreUpdateAndDeleteUser(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()

	hash, err := hashPassword("password-123")
	if err != nil {
		t.Fatalf("hashPassword failed: %v", err)
	}
	user, err := store.CreateUser(ctx, User{Email: "agent@example.com", PasswordHash: hash})
	if err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}
	updated, err := store.UpdateUser(ctx, user.ID, User{Status: UserStatusDisabled})
	if err != nil {
		t.Fatalf("UpdateUser failed: %v", err)
	}
	if updated.Status != UserStatusDisabled {
		t.Fatalf("user was not disabled: %#v", updated)
	}

	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Assigned Shop"})
	if err != nil {
		t.Fatalf("CreateShop failed: %v", err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeShopifyChat})
	if err != nil {
		t.Fatalf("CreateShopSource failed: %v", err)
	}
	if _, err := store.AssignUserToShop(ctx, shop.ID, user.ID); err != nil {
		t.Fatalf("AssignUserToShop failed: %v", err)
	}
	conversation, err := store.CreateConversation(ctx, Conversation{
		ShopID:          shop.ID,
		SourceID:        source.ID,
		Status:          ConversationStatusAssigned,
		AssignedAgentID: user.ID,
	})
	if err != nil {
		t.Fatalf("CreateConversation failed: %v", err)
	}
	if err := store.DeleteUser(ctx, user.ID); err != nil {
		t.Fatalf("DeleteUser failed: %v", err)
	}
	if _, err := store.GetUser(ctx, user.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected deleted user ErrNotFound, got %v", err)
	}
	shopUsers, err := store.ListShopUsers(ctx, shop.ID)
	if err != nil {
		t.Fatalf("ListShopUsers failed: %v", err)
	}
	if len(shopUsers) != 0 {
		t.Fatalf("expected assignment cleanup, got %#v", shopUsers)
	}
	gotConversation, err := store.GetConversation(ctx, conversation.ID)
	if err != nil {
		t.Fatalf("GetConversation failed: %v", err)
	}
	if gotConversation.AssignedAgentID != "" || gotConversation.Status != ConversationStatusOpen {
		t.Fatalf("conversation assignment was not cleared: %#v", gotConversation)
	}
}

func TestFileStorePersistsUsersAndShops(t *testing.T) {
	t.Setenv("AI_SETTINGS_ENCRYPTION_KEY", "file-store-persistence-test-key")
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "platform-data.json")

	store, err := OpenFileStore(path)
	if err != nil {
		t.Fatalf("OpenFileStore failed: %v", err)
	}
	hash, err := hashPassword("password-123")
	if err != nil {
		t.Fatalf("hashPassword failed: %v", err)
	}
	user, err := store.CreateUser(ctx, User{
		Email:        "owner@example.com",
		DisplayName:  "Owner",
		Role:         UserRoleAdmin,
		PasswordHash: hash,
	})
	if err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Persistent Shop"})
	if err != nil {
		t.Fatalf("CreateShop failed: %v", err)
	}
	token := hashSessionToken("persistent-session")
	session, err := store.CreateSession(ctx, Session{UserID: user.ID, TokenHash: token})
	if err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}
	shopifyInstall, err := store.SaveShopifyInstallation(ctx, ShopifyInstallation{
		ShopID:      shop.ID,
		ShopDomain:  "persistent-shop.myshopify.com",
		AccessToken: "shopify-token",
		Scope:       "read_orders",
	})
	if err != nil {
		t.Fatalf("SaveShopifyInstallation failed: %v", err)
	}
	appProfile, err := store.SaveShopifyAppProfile(ctx, ShopifyAppProfile{
		ShopID:                   shop.ID,
		ShopDomain:               shopifyInstall.ShopDomain,
		ClientID:                 "persistent-client-id",
		EncryptedClientSecret:    "encrypted-client-secret",
		EncryptedAutomationToken: "encrypted-automation-token",
		ExtensionHandle:          defaultShopifyExtensionHandle,
		DeployStatus:             ShopifyAppDeployReady,
		DeployVersion:            "xzdesk-persistent",
	})
	if err != nil {
		t.Fatalf("SaveShopifyAppProfile failed: %v", err)
	}
	emailInstall, err := store.SaveEmailInstallation(ctx, EmailInstallation{
		ShopID:       shop.ID,
		Mailbox:      "support@example.com",
		Provider:     "outlook",
		AccessToken:  "email-access",
		RefreshToken: "email-refresh",
		Scope:        "Mail.Read",
	})
	if err != nil {
		t.Fatalf("SaveEmailInstallation failed: %v", err)
	}

	reopened, err := OpenFileStore(path)
	if err != nil {
		t.Fatalf("reopen OpenFileStore failed: %v", err)
	}
	gotUser, err := reopened.FindUserByEmail(ctx, user.Email)
	if err != nil {
		t.Fatalf("FindUserByEmail after reopen failed: %v", err)
	}
	if gotUser.ID != user.ID {
		t.Fatalf("unexpected reopened user: %#v", gotUser)
	}
	if gotUser.PasswordHash != hash {
		t.Fatalf("reopened user lost password hash")
	}
	gotSession, gotSessionUser, err := reopened.GetSessionByTokenHash(ctx, token)
	if err != nil {
		t.Fatalf("GetSessionByTokenHash after reopen failed: %v", err)
	}
	if gotSession.ID != session.ID || gotSession.TokenHash != token || gotSessionUser.ID != user.ID {
		t.Fatalf("unexpected reopened session: session=%#v user=%#v", gotSession, gotSessionUser)
	}
	gotShop, err := reopened.GetShop(ctx, shop.ID)
	if err != nil {
		t.Fatalf("GetShop after reopen failed: %v", err)
	}
	if gotShop.DisplayName != shop.DisplayName {
		t.Fatalf("unexpected reopened shop: %#v", gotShop)
	}
	gotShopifyInstall, err := reopened.GetShopifyInstallationByDomain(ctx, shopifyInstall.ShopDomain)
	if err != nil {
		t.Fatalf("GetShopifyInstallationByDomain after reopen failed: %v", err)
	}
	if gotShopifyInstall.AccessToken != shopifyInstall.AccessToken {
		t.Fatalf("reopened Shopify installation lost access token: %#v", gotShopifyInstall)
	}
	gotAppProfile, err := reopened.GetShopifyAppProfile(ctx, appProfile.ShopID)
	if err != nil {
		t.Fatalf("GetShopifyAppProfile after reopen failed: %v", err)
	}
	if gotAppProfile.ClientID != appProfile.ClientID || gotAppProfile.EncryptedClientSecret != appProfile.EncryptedClientSecret || gotAppProfile.EncryptedAutomationToken != appProfile.EncryptedAutomationToken || gotAppProfile.DeployStatus != ShopifyAppDeployReady {
		t.Fatalf("reopened Shopify App profile lost encrypted credentials or deploy state: %#v", gotAppProfile)
	}
	gotEmailInstall, err := reopened.GetEmailInstallation(ctx, emailInstall.ShopID, emailInstall.Mailbox)
	if err != nil {
		t.Fatalf("GetEmailInstallation after reopen failed: %v", err)
	}
	if gotEmailInstall.AccessToken != emailInstall.AccessToken || gotEmailInstall.RefreshToken != emailInstall.RefreshToken {
		t.Fatalf("reopened email installation lost tokens: %#v", gotEmailInstall)
	}
}

func TestFileStorePersistsConcurrentConversationOperations(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "shared-queue.json")
	store, err := OpenFileStore(path)
	if err != nil {
		t.Fatalf("OpenFileStore failed: %v", err)
	}
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Persistent Shared Queue"})
	if err != nil {
		t.Fatalf("CreateShop failed: %v", err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeShopifyChat})
	if err != nil {
		t.Fatalf("CreateShopSource failed: %v", err)
	}
	first, err := store.CreateConversation(ctx, Conversation{ShopID: shop.ID, SourceID: source.ID})
	if err != nil {
		t.Fatalf("CreateConversation first failed: %v", err)
	}
	second, err := store.CreateConversation(ctx, Conversation{ShopID: shop.ID, SourceID: source.ID})
	if err != nil {
		t.Fatalf("CreateConversation second failed: %v", err)
	}

	start := make(chan struct{})
	results := make(chan error, 2)
	var wait sync.WaitGroup
	for _, item := range []struct {
		conversationID string
		agentID        string
	}{{first.ID, "agent-1"}, {second.ID, "agent-2"}} {
		wait.Add(1)
		go func(conversationID string, agentID string) {
			defer wait.Done()
			<-start
			_, claimErr := store.ClaimConversation(ctx, conversationID, agentID)
			results <- claimErr
		}(item.conversationID, item.agentID)
	}
	close(start)
	wait.Wait()
	close(results)
	for claimErr := range results {
		if claimErr != nil {
			t.Fatalf("concurrent ClaimConversation failed: %v", claimErr)
		}
	}

	if _, _, err := store.AddAgentMessage(ctx, Message{ConversationID: first.ID, Body: "Owner reply"}, "agent-1"); err != nil {
		t.Fatalf("AddAgentMessage failed: %v", err)
	}
	if _, err := store.CloseConversation(ctx, first.ID, "agent-1"); err != nil {
		t.Fatalf("CloseConversation failed: %v", err)
	}
	if _, _, err := store.AddMessage(ctx, Message{ConversationID: first.ID, Direction: MessageDirectionCustomer, Body: "Customer returned"}); err != nil {
		t.Fatalf("customer AddMessage failed: %v", err)
	}

	reopened, err := OpenFileStore(path)
	if err != nil {
		t.Fatalf("reopen FileStore failed: %v", err)
	}
	firstAfterRestart, err := reopened.GetConversation(ctx, first.ID)
	if err != nil {
		t.Fatalf("GetConversation first failed: %v", err)
	}
	if firstAfterRestart.Status != ConversationStatusOpen || firstAfterRestart.AssignedAgentID != "" {
		t.Fatalf("customer return was not persisted: %#v", firstAfterRestart)
	}
	secondAfterRestart, err := reopened.GetConversation(ctx, second.ID)
	if err != nil {
		t.Fatalf("GetConversation second failed: %v", err)
	}
	if secondAfterRestart.Status != ConversationStatusAssigned || secondAfterRestart.AssignedAgentID != "agent-2" {
		t.Fatalf("concurrent claim was not persisted: %#v", secondAfterRestart)
	}
	messages, err := reopened.ListMessages(ctx, first.ID)
	if err != nil {
		t.Fatalf("ListMessages failed: %v", err)
	}
	if len(messages) != 2 {
		t.Fatalf("unexpected persisted messages: %#v", messages)
	}
}
