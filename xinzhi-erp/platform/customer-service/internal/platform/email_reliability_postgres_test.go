package platform

import (
	"testing"
	"time"
)

func TestPostgresEmailReliabilityStores(t *testing.T) {
	ctx, store := openIsolatedPostgresTestStore(t)
	passwordHash, _ := hashPassword("email-reliability-test")
	user, err := store.CreateUser(ctx, User{
		Email: prefixedID("email-reliability") + "@example.com", DisplayName: "Email Reliability", Role: UserRoleAdmin, PasswordHash: passwordHash,
	})
	if err != nil {
		t.Fatal(err)
	}
	shop, err := store.CreateShop(ctx, Shop{DisplayName: prefixedID("Email Reliability")})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeEmail, Provider: "gmail", Address: prefixedID("mailbox") + "@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateConversation(ctx, Conversation{ShopID: shop.ID, SourceID: source.ID, CustomerEmail: "buyer@example.com", Subject: "Reliability"})
	if err != nil {
		t.Fatal(err)
	}
	message, _, err := store.AddMessage(ctx, Message{
		ConversationID: conversation.ID, Direction: MessageDirectionCustomer, Type: MessageTypeText,
		Body: "message with attachment", SourceMessageID: "gmail:attachment-message-1",
		Metadata: map[string]string{"gmail_message_id": "attachment-message-1", "email_has_attachments": "true"},
	})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := store.EnqueueEmailSyncJob(ctx, EmailSyncJob{ShopID: shop.ID, SourceID: source.ID, Provider: "gmail", Priority: emailSyncPriorityPush, Reason: "test"}); err != nil {
		t.Fatal(err)
	}
	job, err := store.ClaimEmailSyncJob(ctx, "gmail", time.Now().UTC())
	if err != nil || job.SourceID != source.ID {
		t.Fatalf("claim email sync job: job=%#v err=%v", job, err)
	}
	if err := store.FinishEmailSyncJob(ctx, source.ID, false, time.Time{}, ""); err != nil {
		t.Fatal(err)
	}

	attachmentJob, err := store.EnqueueEmailAttachmentJob(ctx, EmailAttachmentJob{
		ShopID: shop.ID, SourceID: source.ID, ConversationID: conversation.ID, MessageID: message.ID,
		Provider: "gmail", ProviderMessageID: "attachment-message-1", Priority: emailAttachmentPriorityBackground,
	})
	if err != nil {
		t.Fatal(err)
	}
	claimedAttachment, err := store.ClaimEmailAttachmentJob(ctx, nil, time.Now().UTC().Add(time.Second))
	if err != nil || claimedAttachment.ID != attachmentJob.ID || claimedAttachment.Attempts != 1 {
		t.Fatalf("claim email attachment job: job=%#v err=%v", claimedAttachment, err)
	}
	if err := store.FinishEmailAttachmentJob(ctx, message.ID, time.Time{}, ""); err != nil {
		t.Fatal(err)
	}

	counts, err := store.AddEmailIngressRateObservations(ctx, source.ID, []emailIngressRateObservation{{DimensionType: "mailbox", DimensionKey: "mailbox:test", Count: 3}}, time.Now().UTC(), emailIngressWindowDuration)
	if err != nil || len(counts) != 1 || counts[0].Count != 3 {
		t.Fatalf("email rate window: counts=%#v err=%v", counts, err)
	}
	quarantine, err := store.SaveEmailQuarantine(ctx, EmailQuarantineRecord{
		ShopID: shop.ID, SourceID: source.ID, Provider: "gmail", SourceMessageID: "message-1", Stage: "test", ErrorMessage: "parse failed", Payload: `{}`,
	})
	if err != nil {
		t.Fatal(err)
	}
	if count, err := store.CountEmailQuarantine(ctx, source.ID, "quarantined"); err != nil || count != 1 {
		t.Fatalf("quarantine count=%d err=%v", count, err)
	}
	if err := store.ResolveEmailQuarantine(ctx, quarantine.ID); err != nil {
		t.Fatal(err)
	}

	outbox, err := store.BeginEmailOutbox(ctx, EmailOutboxRecord{
		ShopID: shop.ID, SourceID: source.ID, ConversationID: conversation.ID, ClientRequestID: "request-1", RequestedBy: user.ID, Body: "reply", RequestMetadata: `{}`,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetEmailOutboxState(ctx, outbox.ID, "completed", `{}`, "", "message-1"); err != nil {
		t.Fatal(err)
	}
	interrupted, err := store.BeginEmailOutbox(ctx, EmailOutboxRecord{
		ShopID: shop.ID, SourceID: source.ID, ConversationID: conversation.ID, ClientRequestID: "request-2", RequestedBy: user.ID, Body: "reply", RequestMetadata: `{}`,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetEmailOutboxState(ctx, interrupted.ID, "sending", `{}`, "", ""); err != nil {
		t.Fatal(err)
	}
	if recovered, err := store.RecoverEmailOutbox(ctx, time.Now().UTC().Add(time.Second)); err != nil || len(recovered) != 1 || recovered[0].Status != "ambiguous" {
		t.Fatalf("recover interrupted outbox=%#v err=%v", recovered, err)
	}

	export, err := store.CreateEmailExportJob(ctx, EmailExportJob{RequestedBy: user.ID, Filter: `{}`, ExpiresAt: time.Now().UTC().Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	claimedExport, err := store.ClaimEmailExportJob(ctx)
	if err != nil || claimedExport.ID != export.ID {
		t.Fatalf("claim email export: job=%#v err=%v", claimedExport, err)
	}
	progressedExport, err := store.UpdateEmailExportProgress(ctx, export.ID, "补取附件", 2, 1, 1, 0)
	if err != nil || progressedExport.ProgressStage != "补取附件" || progressedExport.AttachmentTotal != 2 || progressedExport.AttachmentProcessed != 1 {
		t.Fatalf("update email export attachment progress: job=%#v err=%v", progressedExport, err)
	}
	if _, err := store.FinishEmailExportJob(ctx, export.ID, emailExportStatusCompleted, "test.zip", "C:/test/email-exports/test.zip", 1, ""); err != nil {
		t.Fatal(err)
	}

	event, err := store.SaveEmailRuntimeEvent(ctx, EmailRuntimeEvent{Category: "sync.failed", Severity: "error", SourceID: source.ID, Message: "test event"})
	if err != nil {
		t.Fatal(err)
	}
	events, err := store.ListEmailRuntimeEvents(ctx, 10)
	if err != nil || len(events) == 0 || events[0].ID != event.ID {
		t.Fatalf("runtime events=%#v err=%v", events, err)
	}
}
