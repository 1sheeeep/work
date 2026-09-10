package platform

import (
	"context"
	"testing"
	"time"
)

func TestOutlookSentReplySyncReconcilesLocalAgentMessage(t *testing.T) {
	store, server, shop, source, conversation := newSentEmailDedupTest(t, "outlook")
	sentAt := time.Date(2026, 7, 16, 14, 37, 35, 0, time.UTC)
	body := "Yes, you can purchase items from our store now."
	local, _, err := store.AddMessage(context.Background(), Message{
		ConversationID: conversation.ID,
		Direction:      MessageDirectionAgent,
		Body:           body,
		Metadata: map[string]string{
			"mail_api_provider":        "outlook",
			"mail_api_mailbox":         source.Address,
			"mail_api_sent_at":         sentAt.Format(time.RFC3339),
			"mail_api_sent_message_id": "outlook:reply:customer-message",
		},
		CreatedAt: sentAt.Add(4 * time.Second),
	})
	if err != nil {
		t.Fatalf("AddMessage failed: %v", err)
	}
	input := incomingEmailMessage{
		ExternalConversationID: "thread-1",
		SenderName:             "Store",
		SenderEmail:            source.Address,
		CustomerName:           "Buyer",
		CustomerEmail:          "buyer@example.com",
		Subject:                "Purchase product",
		Body:                   body,
		SourceMessageID:        "outlook:sent-message",
		ReceivedAt:             sentAt.Add(6 * time.Second),
		Direction:              MessageDirectionAgent,
		Metadata: map[string]string{
			"outlook_message_id":          "sent-message",
			"outlook_conversation_id":     "thread-1",
			"outlook_internet_message_id": "<sent@example.com>",
		},
	}

	_, created, skipped, err := server.ingestProviderEmail(context.Background(), shop.ID, source, input)
	if err != nil || created || !skipped {
		t.Fatalf("expected reconciled Outlook reply, created=%v skipped=%v err=%v", created, skipped, err)
	}
	messages, err := store.ListMessages(context.Background(), conversation.ID)
	if err != nil || len(messages) != 1 {
		t.Fatalf("expected one reconciled message, messages=%#v err=%v", messages, err)
	}
	if messages[0].ID != local.ID ||
		messages[0].Metadata[emailSyncedSourceMessageIDKey] != input.SourceMessageID ||
		messages[0].Metadata["outlook_message_id"] != "sent-message" {
		t.Fatalf("provider identity was not reconciled onto local message: %#v", messages[0])
	}

	_, created, skipped, err = server.ingestProviderEmail(context.Background(), shop.ID, source, input)
	if err != nil || created || !skipped {
		t.Fatalf("expected repeated sync to remain idempotent, created=%v skipped=%v err=%v", created, skipped, err)
	}
	messages, _ = store.ListMessages(context.Background(), conversation.ID)
	if len(messages) != 1 {
		t.Fatalf("repeated sync created a duplicate: %#v", messages)
	}
}

func TestSentReplySyncUsesProviderMessageIDWhenAvailable(t *testing.T) {
	store, server, shop, source, conversation := newSentEmailDedupTest(t, "gmail")
	sentAt := time.Date(2026, 7, 16, 14, 37, 35, 0, time.UTC)
	_, _, err := store.AddMessage(context.Background(), Message{
		ConversationID: conversation.ID,
		Direction:      MessageDirectionAgent,
		Body:           "Your order is on the way.",
		Metadata: map[string]string{
			"mail_api_provider":        "gmail",
			"mail_api_mailbox":         source.Address,
			"mail_api_sent_at":         sentAt.Format(time.RFC3339),
			"mail_api_sent_message_id": "gmail:sent-message",
		},
		CreatedAt: sentAt,
	})
	if err != nil {
		t.Fatalf("AddMessage failed: %v", err)
	}
	_, created, skipped, err := server.ingestProviderEmail(context.Background(), shop.ID, source, incomingEmailMessage{
		ExternalConversationID: "thread-1",
		CustomerName:           "Buyer",
		CustomerEmail:          "buyer@example.com",
		Body:                   "Your order is on the way.",
		SourceMessageID:        "gmail:sent-message",
		ReceivedAt:             sentAt.Add(time.Second),
		Direction:              MessageDirectionAgent,
	})
	if err != nil || created || !skipped {
		t.Fatalf("expected provider message id to suppress duplicate, created=%v skipped=%v err=%v", created, skipped, err)
	}
	messages, _ := store.ListMessages(context.Background(), conversation.ID)
	if len(messages) != 1 {
		t.Fatalf("provider id dedupe created a duplicate: %#v", messages)
	}
}

func TestSentImageReplySyncUsesProviderMessageIDForBodyAndAttachment(t *testing.T) {
	store, server, shop, source, conversation := newSentEmailDedupTest(t, "gmail")
	sentAt := time.Date(2026, 7, 16, 14, 37, 35, 0, time.UTC)
	_, _, err := store.AddMessage(context.Background(), Message{
		ConversationID: conversation.ID,
		Direction:      MessageDirectionAgent,
		Type:           MessageTypeImage,
		Body:           "product.jpg",
		Metadata: map[string]string{
			"url":                      "/api/v1/chat/attachments/att_local.jpg",
			"mimeType":                 "image/jpeg",
			"fileName":                 "product.jpg",
			"mail_api_provider":        "gmail",
			"mail_api_mailbox":         source.Address,
			"mail_api_sent_at":         sentAt.Format(time.RFC3339),
			"mail_api_sent_message_id": "gmail:sent-image",
		},
		CreatedAt: sentAt,
	})
	if err != nil {
		t.Fatalf("AddMessage failed: %v", err)
	}
	_, created, skipped, err := server.ingestProviderEmail(context.Background(), shop.ID, source, incomingEmailMessage{
		ExternalConversationID: "thread-1",
		CustomerName:           "Buyer",
		CustomerEmail:          "buyer@example.com",
		Body:                   "Attached image: product.jpg",
		SourceMessageID:        "gmail:sent-image",
		ReceivedAt:             sentAt.Add(time.Second),
		Direction:              MessageDirectionAgent,
		Attachments: []incomingEmailAttachment{{
			FileName: "product.jpg",
			MIMEType: "image/jpeg",
			Content:  []byte("duplicate-image"),
		}},
	})
	if err != nil || created || !skipped {
		t.Fatalf("expected sent image body and attachment to be deduplicated, created=%v skipped=%v err=%v", created, skipped, err)
	}
	messages, _ := store.ListMessages(context.Background(), conversation.ID)
	if len(messages) != 1 || messages[0].Type != MessageTypeImage {
		t.Fatalf("sent image sync created duplicates: %#v", messages)
	}
}

func TestSentReplySyncDoesNotMergeDistantIdenticalReplies(t *testing.T) {
	store, server, shop, source, conversation := newSentEmailDedupTest(t, "outlook")
	sentAt := time.Date(2026, 7, 16, 14, 0, 0, 0, time.UTC)
	body := "Yes, you can purchase items from our store now."
	_, _, err := store.AddMessage(context.Background(), Message{
		ConversationID: conversation.ID,
		Direction:      MessageDirectionAgent,
		Body:           body,
		Metadata: map[string]string{
			"mail_api_provider": "outlook",
			"mail_api_mailbox":  source.Address,
			"mail_api_sent_at":  sentAt.Format(time.RFC3339),
		},
		CreatedAt: sentAt,
	})
	if err != nil {
		t.Fatalf("AddMessage failed: %v", err)
	}
	_, created, skipped, err := server.ingestProviderEmail(context.Background(), shop.ID, source, incomingEmailMessage{
		ExternalConversationID: "thread-1",
		CustomerName:           "Buyer",
		CustomerEmail:          "buyer@example.com",
		Body:                   body,
		SourceMessageID:        "outlook:later-message",
		ReceivedAt:             sentAt.Add(10 * time.Minute),
		Direction:              MessageDirectionAgent,
	})
	if err != nil || !created || skipped {
		t.Fatalf("expected distant identical reply to remain separate, created=%v skipped=%v err=%v", created, skipped, err)
	}
	messages, _ := store.ListMessages(context.Background(), conversation.ID)
	if len(messages) != 2 {
		t.Fatalf("distant reply was incorrectly merged: %#v", messages)
	}
}

func TestLocalAgentSendReconcilesMessageAlreadySyncedFromGmail(t *testing.T) {
	store, server, _, source, conversation := newSentEmailDedupTest(t, "gmail")
	sentAt := time.Date(2026, 7, 16, 17, 3, 7, 0, time.UTC)
	body := "Thank you for reaching out! You can purchase from our online store."
	synced, _, err := store.AddMessage(context.Background(), Message{
		ConversationID:  conversation.ID,
		Direction:       MessageDirectionAgent,
		Body:            body,
		SenderName:      "Store",
		SenderEmail:     source.Address,
		SourceMessageID: "gmail:sent-message",
		CreatedAt:       sentAt,
		Metadata: map[string]string{
			"gmail_message_id":      "sent-message",
			"gmail_thread_id":       "thread-1",
			"gmail_conversation_id": "thread-1",
		},
	})
	if err != nil {
		t.Fatalf("AddMessage failed: %v", err)
	}
	reconciled, _, ok, err := server.persistGmailAgentReply(context.Background(), conversation, Message{
		ConversationID: conversation.ID,
		Direction:      MessageDirectionAgent,
		Body:           body,
		Metadata: map[string]string{
			"mail_api_provider":        "gmail",
			"mail_api_mailbox":         source.Address,
			"mail_api_sent_at":         sentAt.Format(time.RFC3339),
			"mail_api_sent_message_id": "gmail:sent-message",
			"gmail_thread_id":          "thread-1",
		},
	}, "")
	if err != nil || !ok {
		t.Fatalf("expected already-synced Gmail message to reconcile, ok=%v err=%v", ok, err)
	}
	if reconciled.ID != synced.ID ||
		reconciled.Metadata["mail_api_sent_message_id"] != "gmail:sent-message" ||
		reconciled.Metadata[emailSyncedSourceMessageIDKey] != "gmail:sent-message" {
		t.Fatalf("local send metadata was not merged into synced message: %#v", reconciled)
	}
	messages, _ := store.ListMessages(context.Background(), conversation.ID)
	if len(messages) != 1 {
		t.Fatalf("reconciliation created a duplicate: %#v", messages)
	}
}

func TestGmailDoesNotUseOutlookBodyTimeFallback(t *testing.T) {
	store, server, shop, source, conversation := newSentEmailDedupTest(t, "gmail")
	sentAt := time.Date(2026, 7, 16, 17, 3, 7, 0, time.UTC)
	body := "Same wording, but this is a separate Gmail message."
	_, _, err := store.AddMessage(context.Background(), Message{
		ConversationID: conversation.ID,
		Direction:      MessageDirectionAgent,
		Body:           body,
		Metadata: map[string]string{
			"mail_api_provider":        "gmail",
			"mail_api_mailbox":         source.Address,
			"mail_api_sent_at":         sentAt.Format(time.RFC3339),
			"mail_api_sent_message_id": "gmail:first-message",
		},
		CreatedAt: sentAt,
	})
	if err != nil {
		t.Fatalf("AddMessage failed: %v", err)
	}
	_, created, skipped, err := server.ingestProviderEmail(context.Background(), shop.ID, source, incomingEmailMessage{
		ExternalConversationID: "thread-1",
		CustomerName:           "Buyer",
		CustomerEmail:          "buyer@example.com",
		Body:                   body,
		SourceMessageID:        "gmail:second-message",
		ReceivedAt:             sentAt.Add(time.Second),
		Direction:              MessageDirectionAgent,
	})
	if err != nil || !created || skipped {
		t.Fatalf("Gmail must only deduplicate by message id, created=%v skipped=%v err=%v", created, skipped, err)
	}
	messages, _ := store.ListMessages(context.Background(), conversation.ID)
	if len(messages) != 2 {
		t.Fatalf("separate Gmail message ids were incorrectly merged: %#v", messages)
	}
}

func TestIncomingEmailImprovesEmailLikeCustomerName(t *testing.T) {
	store, server, shop, source, conversation := newSentEmailDedupTest(t, "gmail")
	_, err := store.UpdateConversation(context.Background(), conversation.ID, ConversationUpdate{
		SetCustomerIdentity: true,
		CustomerName:        "buyer",
		CustomerEmail:       "buyer@example.com",
	})
	if err != nil {
		t.Fatalf("UpdateConversation failed: %v", err)
	}

	conversationCreated, messageCreated, skipped, err := server.ingestProviderEmail(context.Background(), shop.ID, source, incomingEmailMessage{
		ExternalConversationID: "thread-1",
		SenderName:             "Mia Buyer",
		SenderEmail:            "buyer@example.com",
		CustomerName:           "Mia Buyer",
		CustomerEmail:          "buyer@example.com",
		Subject:                "Purchase product",
		Body:                   "Where is my order?",
		SourceMessageID:        "gmail:customer-name-1",
		ReceivedAt:             time.Date(2026, 7, 16, 14, 0, 0, 0, time.UTC),
		Direction:              MessageDirectionCustomer,
	})
	if err != nil || conversationCreated || !messageCreated || skipped {
		t.Fatalf("unexpected ingest result: conversationCreated=%v messageCreated=%v skipped=%v err=%v", conversationCreated, messageCreated, skipped, err)
	}
	updated, err := store.GetConversation(context.Background(), conversation.ID)
	if err != nil || updated.CustomerName != "Mia Buyer" {
		t.Fatalf("email-like customer name was not improved: conversation=%#v err=%v", updated, err)
	}

	_, _, _, err = server.ingestProviderEmail(context.Background(), shop.ID, source, incomingEmailMessage{
		ExternalConversationID: "thread-1",
		SenderName:             "Another Name",
		SenderEmail:            "buyer@example.com",
		CustomerName:           "Another Name",
		CustomerEmail:          "buyer@example.com",
		Subject:                "Purchase product",
		Body:                   "Thanks",
		SourceMessageID:        "gmail:customer-name-2",
		ReceivedAt:             time.Date(2026, 7, 16, 14, 5, 0, 0, time.UTC),
		Direction:              MessageDirectionCustomer,
	})
	if err != nil {
		t.Fatalf("second ingest failed: %v", err)
	}
	updated, _ = store.GetConversation(context.Background(), conversation.ID)
	if updated.CustomerName != "Mia Buyer" {
		t.Fatalf("an existing real customer name was overwritten: %#v", updated)
	}
}

func newSentEmailDedupTest(t *testing.T, provider string) (*MemoryStore, *Server, Shop, ShopSource, Conversation) {
	t.Helper()
	store := NewMemoryStore()
	shop, err := store.CreateShop(context.Background(), Shop{DisplayName: "Sent Email Dedup"})
	if err != nil {
		t.Fatalf("CreateShop failed: %v", err)
	}
	source, err := store.CreateShopSource(context.Background(), ShopSource{
		ShopID:   shop.ID,
		Type:     SourceTypeEmail,
		Provider: provider,
		Address:  "support@example.com",
	})
	if err != nil {
		t.Fatalf("CreateShopSource failed: %v", err)
	}
	conversation, err := store.CreateConversation(context.Background(), Conversation{
		ID:            stableExternalConversationID(source.ID, "thread-1"),
		ShopID:        shop.ID,
		SourceID:      source.ID,
		CustomerName:  "Buyer",
		CustomerEmail: "buyer@example.com",
		Subject:       "Purchase product",
		Status:        ConversationStatusOpen,
		Kind:          ConversationKindCustomer,
		ReplyAllowed:  true,
		LastMessageAt: time.Date(2026, 7, 16, 13, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("CreateConversation failed: %v", err)
	}
	return store, NewServer(store), shop, source, conversation
}
