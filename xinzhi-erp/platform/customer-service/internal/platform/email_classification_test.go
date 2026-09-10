package platform

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestClassifyIncomingEmail(t *testing.T) {
	tests := []struct {
		name       string
		sender     string
		senderName string
		subject    string
		body       string
		want       string
	}{
		{name: "direct customer", sender: "buyer@example.com", subject: "Where is my order?", body: "Please help", want: ConversationKindCustomer},
		{name: "direct customer mentioning payment", sender: "buyer@example.com", subject: "Payment problem with my order", body: "Please help me verify the charge", want: ConversationKindCustomer},
		{name: "direct customer requesting unsubscribe", sender: "buyer@example.com", subject: "Please unsubscribe me", body: "I no longer want product updates", want: ConversationKindCustomer},
		{name: "direct customer asking about login code", sender: "buyer@example.com", subject: "My login code does not work", body: "Please help me access my order", want: ConversationKindCustomer},
		{name: "relayed customer", sender: "no-reply@shopify.com", subject: "New customer message", body: "Customer email: buyer@example.com", want: ConversationKindCustomer},
		{name: "operational notification", sender: "alerts@shopify.com", subject: "Payout status update", body: "Review the payout", want: ConversationKindSystem},
		{name: "marketing", sender: "newsletter@example.com", subject: "Weekly digest", body: "Unsubscribe here", want: ConversationKindCustomer},
		{name: "generic no-reply operational notice", sender: "no-reply@example.com", subject: "Security verification", body: "A new login was detected", want: ConversationKindSystem},
		{name: "Microsoft account notice", sender: "account-security-noreply@accountprotection.microsoft.com", senderName: "Microsoft account team", subject: "New app(s) connected to your Microsoft account", body: "Xzdesk Mail connected", want: ConversationKindSystem},
		{name: "Shopify platform promotion", sender: "email@email.shopify.com", senderName: "Shopify", subject: "Smart Pricing is here", body: "Learn about new features", want: ConversationKindSystem},
		{name: "verification code", sender: "notifications@example.com", senderName: "Example", subject: "Your verification code is 482915", body: "Use this code to sign in", want: ConversationKindSystem},
		{name: "ambiguous automated sender", sender: "alerts@merchant-tools.example", senderName: "Merchant Tools", subject: "Please review the latest update", body: "A new item is available", want: ConversationKindSystem},
		{name: "ambiguous", sender: "", subject: "Notice", body: "Review this item", want: ConversationKindCustomer},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, _ := classifyIncomingEmail(test.sender, test.senderName, test.subject, test.body)
			if got != test.want {
				t.Fatalf("classifyIncomingEmail() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestIncomingEmailReplyAllowed(t *testing.T) {
	for _, email := range []string{
		"mailer-daemon@example.com",
		"postmaster@example.com",
		"",
	} {
		if incomingEmailReplyAllowed(email) {
			t.Errorf("incomingEmailReplyAllowed(%q) = true", email)
		}
	}
	for _, email := range []string{"buyer@example.com", "alerts@example.com", "notification@example.com", "no-reply@example.com", "noreply@example.com", "do-not-reply@example.com"} {
		if !incomingEmailReplyAllowed(email) {
			t.Errorf("incomingEmailReplyAllowed(%q) = false", email)
		}
	}
	if !incomingEmailReplyAllowed("support@example.com", "mailer-daemon@example.com") {
		t.Error("valid Reply-To must make a delivery-daemon message replyable")
	}
}

func TestEmailFilterRequiresHighConfidenceSignals(t *testing.T) {
	tests := []struct {
		name string
		item incomingEmailMessage
		want bool
	}{
		{name: "automated promotion", item: incomingEmailMessage{SenderEmail: "newsletter@example.com", SenderName: "Weekly Newsletter", Subject: "Limited-time offer", Body: "Save 20%. Unsubscribe here."}, want: true},
		{name: "official operational notice", item: incomingEmailMessage{SenderEmail: "notifications@shopify.com", SenderName: "Shopify", Subject: "Payout status update", Body: "Review your payout and account."}, want: false},
		{name: "customer says unsubscribe", item: incomingEmailMessage{SenderEmail: "buyer@example.com", SenderName: "Buyer", Subject: "Please unsubscribe me", Body: "Stop sending product updates."}, want: false},
		{name: "ambiguous automated notice", item: incomingEmailMessage{SenderEmail: "notifications@example.com", SenderName: "Notifications", Subject: "Please review", Body: "A new item is available."}, want: false},
		{name: "preserved Shopify own sender rule", item: incomingEmailMessage{SenderEmail: "store+123@g.shopifyemail.com", SenderName: "Store", Subject: "Customer copy"}, want: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := evaluateIncomingEmailFilter(test.item).Filtered; got != test.want {
				t.Fatalf("evaluateIncomingEmailFilter().Filtered = %v, want %v", got, test.want)
			}
		})
	}
}

func TestGmailSpamMetadataUsesReplyToWithoutBlockingNoReplySender(t *testing.T) {
	message := platformGmailMessage{
		ID:       "message-1",
		ThreadID: "thread-1",
		LabelIDs: []string{"SPAM"},
		Payload: platformGmailPayload{
			Headers: []platformGmailHeader{
				{Name: "From", Value: "Store Notice <no-reply@example.com>"},
				{Name: "Reply-To", Value: "Support Team <support@example.com>"},
				{Name: "Subject", Value: "Order update"},
				{Name: "Message-ID", Value: "<message-1@example.com>"},
			},
			Body: platformGmailBody{Data: base64.RawURLEncoding.EncodeToString([]byte("Your order was shipped."))},
		},
	}
	item := gmailIncomingEmail(message)
	if item.ReplyToEmail != "support@example.com" || item.Metadata["mail_reply_to_email"] != "support@example.com" {
		t.Fatalf("Reply-To was not preserved: %#v", item)
	}
	if item.Metadata["email_folder_origin"] != "spam" || item.Metadata["email_ingress_label"] != "垃圾邮件补漏" {
		t.Fatalf("spam origin was not marked: %#v", item.Metadata)
	}
	if !incomingEmailReplyAllowed(item.ReplyToEmail, item.SenderEmail) {
		t.Fatal("valid Reply-To must remain replyable")
	}
	normalized, err := normalizeMessageContent(Message{Type: MessageTypeText, Body: item.Body, Metadata: item.Metadata})
	if err != nil {
		t.Fatal(err)
	}
	if normalized.Metadata["mail_reply_to_email"] != "support@example.com" ||
		normalized.Metadata["email_ingress_label"] != "垃圾邮件补漏" ||
		normalized.Metadata["email_no_reply_warning"] != "true" {
		t.Fatalf("email routing metadata was not persisted: %#v", normalized.Metadata)
	}
	raw, err := gmailRawThreadReply(Conversation{CustomerEmail: "no-reply@example.com", Subject: "Order update"}, emailReplyTarget{
		CustomerEmail:   item.ReplyToEmail,
		ThreadID:        message.ThreadID,
		HeaderMessageID: "<message-1@example.com>",
	}, "Thanks")
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil || !strings.Contains(string(decoded), "support@example.com") {
		t.Fatalf("Gmail reply did not target Reply-To: %s err=%v", string(decoded), err)
	}
}

func TestAutomatedMarketingFilterRunsBeforeGmailThreadAndAttachmentFetch(t *testing.T) {
	body := base64.RawURLEncoding.EncodeToString([]byte("Limited-time offer. Save 25%. Unsubscribe here."))
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/users/me/messages/message-1" {
			t.Fatalf("filtered mail triggered an unnecessary provider request: %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"id":"message-1","threadId":"thread-1","labelIds":["SPAM"],"internalDate":"1785000000000","payload":{"mimeType":"multipart/mixed","headers":[{"name":"From","value":"Newsletter <newsletter@example.com>"},{"name":"Subject","value":"Limited-time offer"},{"name":"Message-ID","value":"<message-1@example.com>"}],"parts":[{"mimeType":"text/plain","body":{"data":"` + body + `"}},{"mimeType":"image/png","filename":"ad.png","body":{"attachmentId":"attachment-1"}}]}}`))
	}))
	defer provider.Close()
	t.Setenv("GMAIL_API_BASE_URL", provider.URL)

	items, err := expandGmailMessageRefs(context.Background(), "token", "support@example.com", []gmailMessageRef{{ID: "message-1", ThreadID: "thread-1"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Classification != "filtered" || len(items[0].Attachments) != 0 {
		t.Fatalf("marketing mail was not filtered before expansion: %#v", items)
	}
}

func TestShopifyStoreSenderRuleRequiresDisplayName(t *testing.T) {
	for _, test := range []struct {
		name  string
		email string
	}{
		{name: "OddsHarbor", email: "store+76035326052@g.shopifyemail.com"},
		{name: "gxglam", email: "store+80678682878@t.shopifyemail.com"},
		{name: "Any Store", email: "store+123@shopifyemail.com"},
	} {
		if !isDiscardedEmailSender(test.email, test.name) {
			t.Errorf("isDiscardedEmailSender(%q, %q) = false", test.email, test.name)
		}
	}
	for _, test := range []struct {
		name  string
		email string
	}{
		{name: "", email: "store+123@g.shopifyemail.com"},
		{name: "   ", email: "store+123@g.shopifyemail.com"},
		{name: "Any sender name", email: "no-reply@mailer.shopify.com"},
		{name: "Shopify", email: "mailer@shopify.com"},
		{name: "wealbeauty(Shopify)", email: "mailer@shopify.com"},
		{name: "Shopify Support (shopify)", email: "support@shopify.com"},
		{name: "Benjamin E. (shopify)", email: "support@shopify.com"},
		{name: "Shopify Support - No reply", email: "no-reply@shopify.com"},
		{name: "Shopify", email: "email@email.shopify.com"},
		{name: "Shopify Payments", email: "support@shopify.com"},
		{name: "Different sender", email: "mailer@shopify.com"},
		{name: "Shopify", email: "other@shopify.com"},
		{name: "Customer", email: "buyer@g.shopifyemail.com"},
		{name: "Invalid store id", email: "store+abc@g.shopifyemail.com"},
		{name: "Different domain", email: "store+123@example.com"},
		{name: "Microsoft account team", email: "account-security-noreply@accountprotection.microsoft.com"},
	} {
		if isDiscardedEmailSender(test.email, test.name) {
			t.Errorf("isDiscardedEmailSender(%q, %q) = true for a non-blacklisted sender", test.email, test.name)
		}
	}
}

func TestIngestProviderEmailStoresShopifyNoticeAsSystemWithoutDiscarding(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Removed blacklist test"})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeEmail, Provider: "gmail", Address: "support@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	createdConversation, createdMessage, skipped, err := NewServer(store).ingestProviderEmail(ctx, shop.ID, source, incomingEmailMessage{
		ExternalConversationID: "thread-1",
		SourceMessageID:        "message-1",
		SenderName:             "Shopify Support (shopify)",
		SenderEmail:            "support@shopify.com",
		Subject:                "Shopify Support update",
		Body:                   "Please review this message.",
		Classification:         ConversationKindSystem,
		ClassificationReason:   automatedSystemNotificationClassification,
		ReceivedAt:             time.Now().UTC(),
	})
	if err != nil || !createdConversation || !createdMessage || skipped {
		t.Fatalf("ingestProviderEmail() = (%v, %v, %v, %v)", createdConversation, createdMessage, skipped, err)
	}
	conversations, err := store.ListConversations(ctx, ConversationFilter{})
	if err != nil || len(conversations) != 1 {
		t.Fatalf("persisted conversations = %#v, %v", conversations, err)
	}
	if conversations[0].Kind != ConversationKindSystem || conversations[0].ReplyAllowed {
		t.Fatalf("Shopify platform notice was treated as a customer request: %#v", conversations[0])
	}
	messages, err := store.ListMessages(ctx, conversations[0].ID)
	if err != nil || len(messages) != 1 || messages[0].Direction != MessageDirectionSystem {
		t.Fatalf("system notification message = %#v, %v", messages, err)
	}
}

func TestShopifyStoreSenderIsDiscardedButCustomerReplyCreatesConversation(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Reply test"})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeEmail, Provider: "outlook", Address: "support@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(store)
	original := incomingEmailMessage{
		ExternalConversationID: "shopify-thread-1",
		SourceMessageID:        "shopify-message-1",
		CustomerName:           "Store",
		CustomerEmail:          "store+123@g.shopifyemail.com",
		SenderName:             "Store",
		SenderEmail:            "store+123@g.shopifyemail.com",
		Subject:                "[Store] Order #1001 placed by Buyer",
		Body:                   "Order confirmation",
		Direction:              MessageDirectionCustomer,
		ReceivedAt:             time.Now().UTC(),
	}
	createdConversation, createdMessage, skipped, err := server.ingestProviderEmail(ctx, shop.ID, source, original)
	if err != nil || createdConversation || createdMessage || !skipped {
		t.Fatalf("original Shopify sender ingest = (%v, %v, %v, %v)", createdConversation, createdMessage, skipped, err)
	}

	reply := incomingEmailMessage{
		ExternalConversationID: original.ExternalConversationID,
		SourceMessageID:        "customer-message-1",
		CustomerName:           "Buyer",
		CustomerEmail:          "buyer@example.com",
		SenderName:             "Buyer",
		SenderEmail:            "buyer@example.com",
		Subject:                "Re: " + original.Subject,
		Body:                   "I have a question about this order.",
		Direction:              MessageDirectionCustomer,
		Classification:         ConversationKindCustomer,
		ReceivedAt:             time.Now().UTC().Add(time.Minute),
	}
	createdConversation, createdMessage, skipped, err = server.ingestProviderEmail(ctx, shop.ID, source, reply)
	if err != nil || !createdConversation || !createdMessage || skipped {
		t.Fatalf("customer reply ingest = (%v, %v, %v, %v)", createdConversation, createdMessage, skipped, err)
	}
	conversations, err := store.ListConversations(ctx, ConversationFilter{})
	if err != nil || len(conversations) != 1 || conversations[0].CustomerEmail != "buyer@example.com" {
		t.Fatalf("customer reply conversations = %#v, %v", conversations, err)
	}
}

func TestFilterServiceLineConversationsHidesPreviouslyIngestedNoise(t *testing.T) {
	items := []Conversation{
		{ID: "customer", CustomerName: "Buyer", CustomerEmail: "buyer@example.com", Subject: "Where is my order?", Kind: ConversationKindCustomer},
		{ID: "microsoft", CustomerName: "Microsoft account team", CustomerEmail: "account-security-noreply@accountprotection.microsoft.com", Subject: "New app(s) connected to your Microsoft account", Kind: ConversationKindSystem},
		{ID: "shopify", CustomerName: "Shopify", CustomerEmail: "email@email.shopify.com", Subject: "Smart Pricing is here", Kind: ConversationKindCustomer},
		{ID: "shopify-store-sender", CustomerName: "HearthFind", CustomerEmail: "store+76655394979@g.shopifyemail.com", Subject: "Order placed", Kind: ConversationKindCustomer},
		{ID: "relayed-customer", CustomerName: "Buyer (Shopify)", CustomerEmail: "support@shopify.com", Subject: "New customer message", Kind: ConversationKindCustomer, Classification: relayedCustomerInquiryClassification},
	}

	filtered := filterServiceLineConversations(items)
	if len(filtered) != 3 || filtered[0].ID != "customer" || filtered[1].ID != "shopify" || filtered[2].ID != "relayed-customer" {
		t.Fatalf("filterServiceLineConversations() = %#v, want only customer conversations", filtered)
	}
}

func TestConversationListExcludesPreviouslyIngestedServiceLineNoise(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Noise filter"})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeEmail, Provider: "outlook", Address: "support@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	customer, err := store.CreateConversation(ctx, Conversation{ShopID: shop.ID, SourceID: source.ID, CustomerEmail: "buyer@example.com", Subject: "Where is my order?", Kind: ConversationKindCustomer})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateConversation(ctx, Conversation{
		ShopID: shop.ID, SourceID: source.ID, CustomerName: "Shopify Support (shopify)",
		CustomerEmail: "support@shopify.com",
		Subject:       "Shopify service message",
		Kind:          ConversationKindSystem,
	}); err != nil {
		t.Fatal(err)
	}

	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)
	var conversations []Conversation
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations", adminToken, nil, http.StatusOK, &conversations)
	if len(conversations) != 1 || conversations[0].ID != customer.ID {
		t.Fatalf("conversation list = %#v, want only customer conversation", conversations)
	}
}

func TestEmailMessageDirectionAndQuotedHistory(t *testing.T) {
	if got := emailMessageDirection("support@example.com", "support@example.com", nil); got != MessageDirectionAgent {
		t.Fatalf("own mailbox direction = %q", got)
	}
	if got := emailMessageDirection("support@example.com", "buyer@example.com", []string{"SENT"}); got != MessageDirectionAgent {
		t.Fatalf("SENT label direction = %q", got)
	}
	body := "Latest answer\n\nOn Monday, Buyer wrote:\nOlder content"
	if got := stripQuotedEmailHistory(body); got != "Latest answer" {
		t.Fatalf("stripQuotedEmailHistory() = %q", got)
	}

	flattened := "Yes I ordered it and finally received it after two and a half months. From: OddsHarbor <store@example.com> Sent: Friday, April 17, 2026 1:43 PM To: Karen <buyer@example.com> Subject: Regarding your Order #1817 - Shipping Update & Clarification OddsHarbor Hi Karen, I am writing to you regarding your recent order."
	split, ok := splitQuotedEmailHistory(flattened, "Re: Regarding your Order #1817 - Shipping Update & Clarification")
	if !ok {
		t.Fatal("flattened Outlook history was not detected")
	}
	if split.CurrentBody != "Yes I ordered it and finally received it after two and a half months." {
		t.Fatalf("current flattened body = %q", split.CurrentBody)
	}
	if split.QuotedBody != "OddsHarbor Hi Karen, I am writing to you regarding your recent order." {
		t.Fatalf("quoted flattened body = %q", split.QuotedBody)
	}
	if split.SenderEmail != "store@example.com" || split.SentAt.IsZero() {
		t.Fatalf("quoted flattened metadata = %#v", split)
	}
}

func TestSplitQuotedEmailHistoryDoesNotPanicOnTrailingFromHeader(t *testing.T) {
	body := "Current customer reply.\nFrom:"
	split, ok := splitQuotedEmailHistory(body, "Re: Order update")
	if ok {
		t.Fatalf("trailing From header without quoted content must not split: %#v", split)
	}
	if got := stripQuotedEmailHistoryForSubject(body, "Re: Order update"); got != body {
		t.Fatalf("trailing From header changed the message: %q", got)
	}
}

func TestSplitQuotedEmailHistoryUsesLanguageIndependentAttributionStructure(t *testing.T) {
	headers := []string{
		"2026년 7월 27일 (월) 오후 6:30, Floravyne <support@example.com>님이 작성:",
		"Le 27 juillet 2026 à 18:30, Floravyne <support@example.com> a écrit :",
		"2026年7月27日 18:30、Floravyne <support@example.com> からのメッセージ：",
		"El 27/07/2026 a las 18:30, Floravyne <support@example.com> escribió:",
		"Am 27.07.2026 um 18:30 schrieb Floravyne <support@example.com>:",
		"في 27/07/2026 الساعة 18:30، كتب Floravyne <support@example.com>:",
	}
	for _, header := range headers {
		t.Run(header, func(t *testing.T) {
			body := "Thank you. I would like a full refund.\n\n" + header + "\n\nPrevious support reply."
			split, ok := splitQuotedEmailHistory(body, "Re: Order update")
			if !ok {
				t.Fatalf("localized attribution was not split: %q", header)
			}
			if split.CurrentBody != "Thank you. I would like a full refund." ||
				split.QuotedBody != "Previous support reply." ||
				split.SenderEmail != "support@example.com" {
				t.Fatalf("localized attribution split = %#v", split)
			}
		})
	}
}

func TestSplitQuotedEmailHistoryDoesNotTreatOrdinaryEmailAndDateTextAsHistory(t *testing.T) {
	body := "Please contact support@example.com before 7/27/2026:\n\nThis is still part of my request."
	if split, ok := splitQuotedEmailHistory(body, "Help"); ok {
		t.Fatalf("ordinary customer text must not be split: %#v", split)
	}
}

func TestExpandQuotedEmailMessagesForDisplay(t *testing.T) {
	createdAt := time.Date(2026, 7, 16, 9, 47, 32, 0, time.UTC)
	messages := []Message{{
		ID:              "message-1",
		ConversationID:  "conversation-1",
		Direction:       MessageDirectionCustomer,
		Type:            MessageTypeText,
		Body:            "Customer reply. From: Shop <store@example.com> Sent: Friday, April 17, 2026 1:43 PM To: Buyer <buyer@example.com> Subject: Order update Shop Support reply.",
		SourceMessageID: "outlook:message-1",
		CreatedAt:       createdAt,
		Metadata: map[string]string{
			"outlook_message_id":    "message-1",
			messageTranslationZHKey: "客户回复。发件人：Shop <store@example.com> 发送时间：2026-04-17 13:43 收件人：Buyer <buyer@example.com> 主题：订单更新 Shop 客服回复。",
		},
	}}

	got := expandQuotedEmailMessagesForDisplay(messages, "Re: Order update")
	if len(got) != 2 {
		t.Fatalf("display message count = %d, want 2: %#v", len(got), got)
	}
	if got[0].Direction != MessageDirectionAgent || got[0].Body != "Shop Support reply." || got[0].Metadata[displayQuotedHistoryMetadataKey] != "true" {
		t.Fatalf("quoted display message = %#v", got[0])
	}
	if got[0].Metadata[messageTranslationZHKey] != "Shop 客服回复。" || got[0].Metadata[messageTranslationStatusKey] != messageTranslationDone {
		t.Fatalf("quoted display translation = %#v", got[0].Metadata)
	}
	if got[1].Direction != MessageDirectionCustomer || got[1].Body != "Customer reply." || got[1].Metadata[messageTranslationZHKey] != "客户回复。" {
		t.Fatalf("current display message = %#v", got[1])
	}
	if !got[0].CreatedAt.Before(got[1].CreatedAt) {
		t.Fatalf("quoted display timestamp = %s, current = %s", got[0].CreatedAt, got[1].CreatedAt)
	}
}

func TestExpandQuotedEmailMessagesForDisplaySplitsLegacyFlattenedTranslation(t *testing.T) {
	messages := []Message{{
		ID:             "message-legacy",
		ConversationID: "conversation-legacy",
		Direction:      MessageDirectionCustomer,
		Type:           MessageTypeText,
		Body: "Yes I ordered it and finally received it after two and a half months. " +
			"From: OddsHarbor <store@example.com> Sent: Friday, April 17, 2026 1:43 PM " +
			"To: Karen <buyer@example.com> Subject: Regarding your Order #1817 - Shipping Update & Clarification " +
			"OddsHarbor Hi Karen, I am writing to you regarding your recent order #1817.",
		CreatedAt: time.Date(2026, 7, 16, 9, 47, 32, 0, time.UTC),
		Metadata: map[string]string{
			"outlook_message_id": "message-legacy",
			messageTranslationZHKey: "是的，我订购了它，并在两个半月后终于收到了。" +
				"发件人：OddsHarbor <store@example.com> 发送时间：2026年4月17日，星期五，下午1:43 " +
				"收件人：Karen <buyer@example.com> 主题：关于您的订单 #1817 - 运输更新与说明 " +
				"OddsHarbor 您好 Karen，我写信给您是关于您最近的订单 #1817。",
			messageTranslationStatusKey: messageTranslationDone,
		},
	}}

	got := expandQuotedEmailMessagesForDisplay(messages, "Re: Regarding your Order #1817 - Shipping Update & Clarification")
	if len(got) != 2 {
		t.Fatalf("display message count = %d, want 2: %#v", len(got), got)
	}
	if got[0].Direction != MessageDirectionAgent ||
		got[0].Metadata[messageTranslationZHKey] != "OddsHarbor 您好 Karen，我写信给您是关于您最近的订单 #1817。" {
		t.Fatalf("legacy quoted translation was not assigned to the agent message: %#v", got[0])
	}
	if got[1].Direction != MessageDirectionCustomer ||
		got[1].Metadata[messageTranslationZHKey] != "是的，我订购了它，并在两个半月后终于收到了。" {
		t.Fatalf("legacy current translation was not kept on the customer message: %#v", got[1])
	}
}

func TestHTMLToPlainTextPreservesEmailHeaderBoundaries(t *testing.T) {
	htmlBody := `<div>Customer reply.</div><div>From: Shop &lt;store@example.com&gt;</div><div>Sent: Friday, April 17, 2026 1:43 PM</div><div>To: Buyer &lt;buyer@example.com&gt;</div><div>Subject: Order update</div><div>Support reply.</div>`
	plain := htmlToPlainText(htmlBody)
	if !strings.Contains(plain, "\nFrom: Shop <store@example.com>\nSent:") {
		t.Fatalf("HTML email boundaries were flattened: %q", plain)
	}
	if got := stripQuotedEmailHistoryForSubject(plain, "Re: Order update"); got != "Customer reply." {
		t.Fatalf("HTML quoted history strip = %q", got)
	}
}

func TestHTMLToPlainTextDropsStyleAndScriptContent(t *testing.T) {
	htmlBody := `<style>u + .body { height:100%!important; color:red; }</style><script>window.bad = true;</script><div>Payment failed for order #7079.</div>`
	plain := htmlToPlainText(htmlBody)
	if plain != "Payment failed for order #7079." {
		t.Fatalf("HTML email style or script content leaked into text: %q", plain)
	}
}

func TestHTMLToPlainTextMarksProviderQuoteContainersWithoutReadingTheirLanguage(t *testing.T) {
	tests := []string{
		`<div>Current English reply.</div><div class="gmail_quote"><div>Localized attribution</div><div>Previous reply.</div></div>`,
		`<div>Current English reply.</div><div id="divRplyFwdMsg"><div>Localized attribution</div><div>Previous reply.</div></div>`,
		`<div>Current English reply.</div><blockquote><div>Localized attribution</div><div>Previous reply.</div></blockquote>`,
	}
	for _, htmlBody := range tests {
		plain := htmlToPlainText(htmlBody)
		if !strings.Contains(plain, "-----quoted message-----") {
			t.Fatalf("provider quote container marker missing: %q", plain)
		}
		if got := stripQuotedEmailHistoryForSubject(plain, "Re: Order update"); got != "Current English reply." {
			t.Fatalf("current body = %q, want only the new reply", got)
		}
	}
}

func TestGmailThreadHistoryFailureFallsBackToAnchorMessage(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/users/me/messages":
			_, _ = w.Write([]byte(`{"messages":[{"id":"message-1","threadId":"thread-1"}]}`))
		case "/users/me/messages/message-1":
			_, _ = w.Write([]byte(`{"id":"message-1","threadId":"thread-1","labelIds":["INBOX"],"internalDate":"1700000000000","payload":{"mimeType":"text/plain","headers":[{"name":"From","value":"buyer@example.com"},{"name":"Subject","value":"Help"}],"body":{"data":"SGVsbG8"}}}`))
		case "/users/me/threads/thread-1":
			http.Error(w, "thread unavailable", http.StatusBadGateway)
		default:
			http.NotFound(w, r)
		}
	}))
	defer provider.Close()
	t.Setenv("GMAIL_API_BASE_URL", provider.URL)

	messages, err := fetchGmailUnreadEmails(context.Background(), "token", "support@example.com")
	if err != nil {
		t.Fatalf("fetchGmailUnreadEmails() error = %v, want fallback to anchor message", err)
	}
	if len(messages) != 1 || messages[0].SourceMessageID != "gmail:message-1" || messages[0].Body != "Hello" {
		t.Fatalf("Gmail thread history failure did not fall back to anchor: %#v", messages)
	}
}

func TestOutlookThreadHistoryFailureIsReturned(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/me/mailFolders/inbox/messages":
			_, _ = w.Write([]byte(`{"value":[{"id":"message-1","conversationId":"conversation-1","subject":"Help","receivedDateTime":"2026-07-14T00:00:00Z","body":{"contentType":"text","content":"Hello"},"from":{"emailAddress":{"name":"Buyer","address":"buyer@example.com"}}}]}`))
		case "/me/messages":
			http.Error(w, "thread unavailable", http.StatusBadGateway)
		default:
			http.NotFound(w, r)
		}
	}))
	defer provider.Close()
	t.Setenv("OUTLOOK_GRAPH_BASE_URL", provider.URL)

	if _, err := fetchOutlookUnreadEmails(context.Background(), "token", "support@example.com"); err == nil || !strings.Contains(err.Error(), "thread history") {
		t.Fatalf("fetchOutlookUnreadEmails() error = %v, want explicit thread history failure", err)
	}
}

func TestEmailMailboxOwnership(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	shopOne, err := store.CreateShop(ctx, Shop{DisplayName: "One"})
	if err != nil {
		t.Fatal(err)
	}
	shopTwo, err := store.CreateShop(ctx, Shop{DisplayName: "Two"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveEmailInstallation(ctx, EmailInstallation{ShopID: shopOne.ID, Mailbox: "support@example.com", Provider: "GMAIL", AccessToken: "one"}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveEmailInstallation(ctx, EmailInstallation{ShopID: shopTwo.ID, Mailbox: "SUPPORT@example.com", Provider: "outlook", AccessToken: "two"}); !errors.Is(err, ErrConflict) {
		t.Fatalf("second shop mailbox bind error = %v, want conflict", err)
	}
}

func TestSystemConversationRejectsAgentReply(t *testing.T) {
	err := validateAgentEmailOperation(Conversation{
		Status: ConversationStatusAssigned, AssignedAgentID: "agent-1", Kind: ConversationKindSystem, ReplyAllowed: false,
	}, "agent-1")
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("validateAgentEmailOperation() = %v, want forbidden", err)
	}
}

func TestSystemNotificationIsUnread(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "System Notice Shop"})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeEmail, Provider: "outlook", Address: "support@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateConversation(ctx, Conversation{ShopID: shop.ID, SourceID: source.ID, Kind: ConversationKindSystem, ReplyAllowed: false})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.AddMessage(ctx, Message{ConversationID: conversation.ID, Direction: MessageDirectionSystem, Body: "Payout review required"}); err != nil {
		t.Fatal(err)
	}
	unread, err := store.ListUnreadConversationIDs(ctx, "agent-1")
	if err != nil || len(unread) != 1 || unread[0] != conversation.ID {
		t.Fatalf("system notification unread IDs = %#v, %v", unread, err)
	}
}
