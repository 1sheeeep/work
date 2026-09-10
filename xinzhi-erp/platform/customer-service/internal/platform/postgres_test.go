package platform

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"
)

func TestPostgresConstraintErrorClassifiers(t *testing.T) {
	if isForeignKeyError(nil) {
		t.Fatal("nil must not be classified as a foreign key error")
	}
	if isUniqueConstraintError(nil) {
		t.Fatal("nil must not be classified as a unique constraint error")
	}
	if !isForeignKeyError(errors.New("insert failed (SQLSTATE 23503)")) {
		t.Fatal("expected SQLSTATE 23503 to be classified as a foreign key error")
	}
	if !isUniqueConstraintError(errors.New("insert failed (SQLSTATE 23505)")) {
		t.Fatal("expected SQLSTATE 23505 to be classified as a unique constraint error")
	}
}

func TestPostgresConversationMetadataUpdateCannotUndoConcurrentClaim(t *testing.T) {
	ctx, store := openIsolatedPostgresTestStore(t)
	passwordHash, err := hashPassword("conversation-update-race")
	if err != nil {
		t.Fatal(err)
	}
	user, err := store.CreateUser(ctx, User{
		Email: prefixedID("conversation-update-race") + "@example.com", DisplayName: "Conversation Update Race", Role: UserRoleAgent, PasswordHash: passwordHash,
	})
	if err != nil {
		t.Fatal(err)
	}
	shop, err := store.CreateShop(ctx, Shop{DisplayName: prefixedID("Conversation Update Race")})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeEmail, Provider: "outlook", Address: prefixedID("race") + "@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateConversation(ctx, Conversation{ShopID: shop.ID, SourceID: source.ID, CustomerEmail: "buyer@example.com", Subject: "Concurrent claim"})
	if err != nil {
		t.Fatal(err)
	}

	claimTx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	claimCommitted := false
	defer func() {
		if !claimCommitted {
			_ = claimTx.Rollback()
		}
	}()
	if _, err := claimTx.ExecContext(ctx, `
		UPDATE conversations
		SET status=$2, assigned_agent_id=$3, updated_at=$4
		WHERE id=$1
	`, conversation.ID, ConversationStatusAssigned, user.ID, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}

	type updateResult struct {
		conversation Conversation
		err          error
	}
	result := make(chan updateResult, 1)
	go func() {
		updated, updateErr := store.UpdateConversation(ctx, conversation.ID, ConversationUpdate{
			SetEmailDisposition: true,
			Kind:                ConversationKindCustomer,
			ReplyAllowed:        true,
			Classification:      "customer email",
		})
		result <- updateResult{conversation: updated, err: updateErr}
	}()

	deadline := time.Now().Add(3 * time.Second)
	for {
		var waiting bool
		err = store.db.QueryRowContext(ctx, `
			SELECT EXISTS (
			  SELECT 1
			  FROM pg_stat_activity
			  WHERE pid <> pg_backend_pid()
			    AND datname = current_database()
			    AND wait_event_type = 'Lock'
			    AND query ILIKE '%UPDATE conversations%'
			)
		`).Scan(&waiting)
		if err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("metadata update did not wait on the concurrent claim lock")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := claimTx.Commit(); err != nil {
		t.Fatal(err)
	}
	claimCommitted = true

	select {
	case got := <-result:
		if got.err != nil {
			t.Fatal(got.err)
		}
		if got.conversation.Status != ConversationStatusAssigned || got.conversation.AssignedAgentID != user.ID {
			t.Fatalf("background metadata update undid the concurrent claim: %#v", got.conversation)
		}
		if !got.conversation.ReplyAllowed || got.conversation.Classification != "customer email" {
			t.Fatalf("metadata update was not applied: %#v", got.conversation)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("metadata update did not finish after the claim committed")
	}
}

func TestPostgresConversationArchiveQuery(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	migrationDatabaseURL := os.Getenv("XZDESK_DATABASE_MIGRATION_URL")
	if databaseURL == "" || migrationDatabaseURL == "" {
		t.Skip("customer-service PostgreSQL test URLs are not set")
	}
	ctx := context.Background()
	store, err := OpenPostgresStore(ctx, PostgresStoreConfig{
		DatabaseURL:          databaseURL,
		MigrationDatabaseURL: migrationDatabaseURL,
		Schema:               CustomerServiceDatabaseSchema,
	})
	if err != nil {
		t.Fatalf("OpenPostgresStore failed: %v", err)
	}
	defer store.Close()
	passwordHash, err := hashPassword("archive-query-password")
	if err != nil {
		t.Fatal(err)
	}
	user, err := store.CreateUser(ctx, User{
		Email: prefixedID("archive-query") + "@example.com", DisplayName: "Archive Query Agent", Role: UserRoleAgent, PasswordHash: passwordHash,
	})
	if err != nil {
		t.Fatal(err)
	}
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Postgres Archive Query"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AssignUserToShop(ctx, shop.ID, user.ID); err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeShopifyChat})
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateConversation(ctx, Conversation{
		ShopID: shop.ID, SourceID: source.ID, CustomerName: "Archive Search Customer", CustomerEmail: "archive@example.com",
		Subject: "Archived query", Status: ConversationStatusClosed, AssignedAgentID: user.ID, Kind: ConversationKindCustomer,
	})
	if err != nil {
		t.Fatal(err)
	}
	filter := ConversationFilter{
		ShopID: shop.ID, Status: ConversationStatusClosed, Kind: ConversationKindCustomer, Search: "Archive Search",
		WorkbenchUserID: user.ID, WorkbenchShopUserID: user.ID, ServiceLineOnly: true, Page: 1, PageSize: 1,
	}
	total, err := store.CountConversations(ctx, filter)
	if err != nil || total != 1 {
		t.Fatalf("CountConversations failed: total=%d err=%v", total, err)
	}
	items, err := store.ListConversations(ctx, filter)
	if err != nil || len(items) != 1 || items[0].ID != conversation.ID {
		t.Fatalf("ListConversations failed: items=%#v err=%v", items, err)
	}
}

func TestPostgresStoreContract(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is not set")
	}
	ctx := context.Background()
	store, err := OpenPostgresStore(ctx, PostgresStoreConfig{
		DatabaseURL:          databaseURL,
		MigrationDatabaseURL: os.Getenv("XZDESK_DATABASE_MIGRATION_URL"),
		Schema:               os.Getenv("XZDESK_DATABASE_SCHEMA"),
	})
	if err != nil {
		t.Fatalf("OpenPostgresStore failed: %v", err)
	}
	defer store.Close()

	passwordHash, err := hashPassword("password-123")
	if err != nil {
		t.Fatalf("hashPassword failed: %v", err)
	}
	user, err := store.CreateUser(ctx, User{
		Email:        prefixedID("postgres-agent") + "@example.com",
		DisplayName:  "Postgres Agent",
		Role:         UserRoleAgent,
		PasswordHash: passwordHash,
	})
	if err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}
	targetUser, err := store.CreateUser(ctx, User{
		Email:        prefixedID("postgres-target-agent") + "@example.com",
		DisplayName:  "Postgres Target Agent",
		Role:         UserRoleAgent,
		PasswordHash: passwordHash,
	})
	if err != nil {
		t.Fatalf("CreateUser target failed: %v", err)
	}
	configuredUser, err := store.CreateUser(ctx, User{
		Email:        prefixedID("postgres-configured-agent") + "@example.com",
		DisplayName:  "Postgres Configured Agent",
		Role:         UserRoleAgent,
		ShopScope:    AccessScopeAll,
		SetShopScope: true,
		PasswordHash: passwordHash,
	})
	if err != nil {
		t.Fatalf("CreateUser configured target failed: %v", err)
	}
	configuredUser, err = store.GetUser(ctx, configuredUser.ID)
	if err != nil || configuredUser.ShopScope != AccessScopeAll {
		t.Fatalf("configured agent scope was overwritten: user=%#v err=%v", configuredUser, err)
	}
	session, err := store.CreateSession(ctx, Session{UserID: user.ID, TokenHash: hashSessionToken("postgres-session")})
	if err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}
	gotSession, gotUser, err := store.GetSessionByTokenHash(ctx, session.TokenHash)
	if err != nil {
		t.Fatalf("GetSessionByTokenHash failed: %v", err)
	}
	if gotSession.ID != session.ID || gotUser.ID != user.ID {
		t.Fatalf("unexpected session lookup: session=%#v user=%#v", gotSession, gotUser)
	}
	if gotUser.ReceptionLimit != defaultAgentCapacity {
		t.Fatalf("session lookup lost routing settings: %#v", gotUser)
	}

	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Postgres Contract Shop"})
	if err != nil {
		t.Fatalf("CreateShop failed: %v", err)
	}
	assignment, err := store.AssignUserToShop(ctx, shop.ID, user.ID)
	if err != nil {
		t.Fatalf("AssignUserToShop failed: %v", err)
	}
	if assignment.ShopID != shop.ID || assignment.UserID != user.ID {
		t.Fatalf("unexpected assignment: %#v", assignment)
	}
	if _, err := store.AssignUserToShop(ctx, shop.ID, targetUser.ID); err != nil {
		t.Fatalf("AssignUserToShop target failed: %v", err)
	}
	assignedUsers, err := store.ListShopUsers(ctx, shop.ID)
	if err != nil {
		t.Fatalf("ListShopUsers failed: %v", err)
	}
	if len(assignedUsers) != 2 {
		t.Fatalf("unexpected assigned users: %#v", assignedUsers)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeShopifyChat})
	if err != nil {
		t.Fatalf("CreateShopSource failed: %v", err)
	}
	conversation, err := store.CreateConversation(ctx, Conversation{
		ShopID:            shop.ID,
		SourceID:          source.ID,
		CustomerName:      "Postgres Customer",
		Subject:           "Persistence check",
		RecordOrderNumber: "PG-CONTRACT-ORDER-1",
	})
	if err != nil {
		t.Fatalf("CreateConversation failed: %v", err)
	}
	updatedConversation, err := store.ClaimConversation(ctx, conversation.ID, user.ID)
	if err != nil {
		t.Fatalf("ClaimConversation failed: %v", err)
	}
	if updatedConversation.Status != ConversationStatusAssigned || updatedConversation.AssignedAgentID != user.ID {
		t.Fatalf("unexpected updated conversation: %#v", updatedConversation)
	}
	transferredConversation, err := store.TransferConversation(ctx, conversation.ID, user.ID, targetUser.ID)
	if err != nil {
		t.Fatalf("TransferConversation to target failed: %v", err)
	}
	if transferredConversation.AssignedAgentID != targetUser.ID || transferredConversation.RecordOrderNumber != conversation.RecordOrderNumber {
		t.Fatalf("unexpected transferred conversation: %#v", transferredConversation)
	}
	transferredConversation, err = store.TransferConversation(ctx, conversation.ID, targetUser.ID, user.ID)
	if err != nil {
		t.Fatalf("TransferConversation back to owner failed: %v", err)
	}
	if transferredConversation.AssignedAgentID != user.ID || transferredConversation.RecordOrderNumber != conversation.RecordOrderNumber {
		t.Fatalf("unexpected returned conversation: %#v", transferredConversation)
	}
	acceptanceTicket, err := store.CreateTicket(ctx, Ticket{
		Type:               TicketTypeCustomer,
		ConversationID:     conversation.ID,
		ShopID:             shop.ID,
		Title:              "Postgres conversation handoff",
		Description:        "Verify accepting a customer ticket preserves conversation fields.",
		Status:             TicketStatusOpen,
		AssignedAgentID:    targetUser.ID,
		HandoffFromAgentID: user.ID,
		RequiresAcceptance: true,
		CreatedBy:          user.ID,
	})
	if err != nil {
		t.Fatalf("CreateTicket for conversation handoff failed: %v", err)
	}
	acceptedTicket, acceptedConversation, err := store.AcceptTicket(ctx, acceptanceTicket.ID, targetUser.ID)
	if err != nil {
		t.Fatalf("AcceptTicket for conversation handoff failed: %v", err)
	}
	if acceptedTicket.Status != TicketStatusInProgress || acceptedConversation == nil || acceptedConversation.AssignedAgentID != targetUser.ID || acceptedConversation.RecordOrderNumber != conversation.RecordOrderNumber {
		t.Fatalf("unexpected accepted ticket or conversation: ticket=%#v conversation=%#v", acceptedTicket, acceptedConversation)
	}
	transferredConversation, err = store.TransferConversation(ctx, conversation.ID, targetUser.ID, user.ID)
	if err != nil {
		t.Fatalf("TransferConversation after ticket acceptance failed: %v", err)
	}
	if _, err := store.ClaimConversation(ctx, conversation.ID, "another-agent"); !errors.Is(err, ErrConflict) {
		t.Fatalf("expected conflicting claim, got %v", err)
	}
	closedConversation, err := store.CloseConversation(ctx, conversation.ID, user.ID)
	if err != nil || closedConversation.Status != ConversationStatusClosed {
		t.Fatalf("CloseConversation failed: conversation=%#v err=%v", closedConversation, err)
	}
	customerMessage, reopenedConversation, err := store.AddMessage(ctx, Message{ConversationID: conversation.ID, Body: "Stored in postgres"})
	if err != nil {
		t.Fatalf("AddMessage failed: %v", err)
	} else if reopenedConversation.Status != ConversationStatusOpen || reopenedConversation.AssignedAgentID != "" {
		t.Fatalf("customer message did not return the conversation to the routing queue: %#v", reopenedConversation)
	}
	if reopenedConversation.CustomerLastMessageAt.IsZero() || reopenedConversation.CustomerLastMessageAt.Sub(customerMessage.CreatedAt).Abs() > time.Millisecond || reopenedConversation.LastMessageDirection != MessageDirectionCustomer {
		t.Fatalf("customer message returned incomplete realtime ordering fields: %#v", reopenedConversation)
	}
	customerActivityAt := reopenedConversation.CustomerLastMessageAt
	if _, err := store.ClaimConversation(ctx, conversation.ID, user.ID); err != nil {
		t.Fatalf("ClaimConversation before realtime reply failed: %v", err)
	}
	_, replyConversation, err := store.AddAgentMessage(ctx, Message{ConversationID: conversation.ID, Body: "Postgres reply"}, user.ID)
	if err != nil {
		t.Fatalf("AddAgentMessage failed: %v", err)
	}
	if !replyConversation.CustomerLastMessageAt.Equal(customerActivityAt) || replyConversation.LastMessageDirection != MessageDirectionAgent {
		t.Fatalf("agent reply returned incomplete realtime ordering fields: %#v", replyConversation)
	}
	messages, err := store.ListMessages(ctx, conversation.ID)
	if err != nil {
		t.Fatalf("ListMessages failed: %v", err)
	}
	if len(messages) != 2 || messages[0].Body != "Stored in postgres" || messages[1].Body != "Postgres reply" {
		t.Fatalf("unexpected messages: %#v", messages)
	}

	knowledge, err := store.CreateKnowledge(ctx, KnowledgeEntry{
		Scope:       KnowledgeScopeShop,
		ShopID:      shop.ID,
		Title:       "Postgres knowledge timestamp",
		Answer:      "Pending entries must persist a null reviewed_at value.",
		Status:      KnowledgeStatusPending,
		SubmittedBy: user.ID,
	})
	if err != nil {
		t.Fatalf("CreateKnowledge failed: %v", err)
	}
	if !knowledge.ReviewedAt.IsZero() {
		t.Fatalf("pending knowledge unexpectedly has a review time: %#v", knowledge)
	}
	knowledge, err = store.UpdateKnowledge(ctx, knowledge.ID, KnowledgeUpdate{
		Status:     KnowledgeStatusPublished,
		ReviewedBy: user.ID,
	})
	if err != nil {
		t.Fatalf("UpdateKnowledge failed: %v", err)
	}
	if knowledge.ReviewedAt.IsZero() {
		t.Fatalf("published knowledge is missing its review time: %#v", knowledge)
	}
	if err := store.DeleteKnowledge(ctx, knowledge.ID); err != nil {
		t.Fatalf("DeleteKnowledge failed: %v", err)
	}
	if _, err := store.GetKnowledge(ctx, knowledge.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted knowledge must not remain available, got %v", err)
	}
}
