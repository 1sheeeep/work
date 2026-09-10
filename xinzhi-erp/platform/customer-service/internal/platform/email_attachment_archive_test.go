package platform

import (
	"context"
	"testing"
	"time"
)

func TestEmailAttachmentQueueDoesNotClaimTwoJobsForTheSameMailbox(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Attachment Queue"})
	if err != nil {
		t.Fatal(err)
	}
	firstSource, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeEmail, Provider: "gmail", Address: "first@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	secondSource, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeEmail, Provider: "outlook", Address: "second@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	createJob := func(source ShopSource, suffix string, priority int) EmailAttachmentJob {
		conversation, createErr := store.CreateConversation(ctx, Conversation{
			ShopID: shop.ID, SourceID: source.ID, CustomerEmail: suffix + "@example.com", Subject: suffix,
		})
		if createErr != nil {
			t.Fatal(createErr)
		}
		message, _, addErr := store.AddMessage(ctx, Message{
			ConversationID: conversation.ID, Direction: MessageDirectionCustomer, Type: MessageTypeText,
			Body: suffix, SourceMessageID: source.Provider + ":" + suffix,
		})
		if addErr != nil {
			t.Fatal(addErr)
		}
		job, enqueueErr := store.EnqueueEmailAttachmentJob(ctx, EmailAttachmentJob{
			ShopID: shop.ID, SourceID: source.ID, ConversationID: conversation.ID, MessageID: message.ID,
			Provider: source.Provider, ProviderMessageID: suffix, Priority: priority,
		})
		if enqueueErr != nil {
			t.Fatal(enqueueErr)
		}
		return job
	}
	createJob(firstSource, "first-1", 20)
	createJob(firstSource, "first-2", 20)
	secondExpected := createJob(secondSource, "second-1", 10)

	firstClaim, err := store.ClaimEmailAttachmentJob(ctx, nil, time.Now().UTC().Add(time.Second))
	if err != nil || firstClaim.SourceID != firstSource.ID {
		t.Fatalf("first claim should use the higher-priority mailbox: job=%#v err=%v", firstClaim, err)
	}
	secondClaim, err := store.ClaimEmailAttachmentJob(ctx, []string{firstClaim.SourceID}, time.Now().UTC().Add(time.Second))
	if err != nil || secondClaim.ID != secondExpected.ID || secondClaim.SourceID != secondSource.ID {
		t.Fatalf("second worker claimed the running mailbox instead of another mailbox: job=%#v err=%v", secondClaim, err)
	}
}
