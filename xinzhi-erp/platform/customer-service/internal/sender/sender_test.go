package sender

import (
	"encoding/json"
	"testing"

	"shopify-support-platform/internal/appcore"
	"shopify-support-platform/internal/cdp"
)

func TestScoreTargetRequiresSpecificSignals(t *testing.T) {
	conversation := appcore.Conversation{
		Source:         "inbox",
		CustomerName:   "Ada Customer",
		ConversationID: "abc123",
		SourceURL:      "https://inbox.shopify.com/store/demo/conversations/abc123",
	}
	target := cdp.Target{URL: conversation.SourceURL, Title: "Ada Customer"}
	if score := scoreTarget(target, conversation, "Demo"); score < 100 {
		t.Fatalf("score = %d, want strong match", score)
	}
	weak := cdp.Target{URL: "https://mail.google.com", Title: "Inbox"}
	if score := scoreTarget(weak, conversation, "Demo"); score >= 35 {
		t.Fatalf("weak score = %d, should not pass send threshold", score)
	}
}

func TestSelectInboxSendTargetUsesExactConversationURL(t *testing.T) {
	sourceURL := "https://inbox.shopify.com/store/1f1s6n-tx/conversations/unread/abc?context=conversation_list_item_pressed"
	target, ok := selectInboxSendTarget([]cdp.Target{
		{ID: "same-store-list", URL: "https://inbox.shopify.com/store/1f1s6n-tx/conversations/unread"},
		{ID: "exact", URL: sourceURL},
	}, sourceURL)
	if !ok || target.ID != "exact" {
		t.Fatalf("expected exact conversation target, got ok=%v id=%q", ok, target.ID)
	}
}

func TestSelectInboxSendTargetFallsBackToSameStoreInboxPage(t *testing.T) {
	sourceURL := "https://inbox.shopify.com/store/1f1s6n-tx/conversations/unread/abc?context=conversation_list_item_pressed"
	target, ok := selectInboxSendTarget([]cdp.Target{
		{ID: "other-store", URL: "https://inbox.shopify.com/store/other-store/conversations/unread"},
		{ID: "same-store-list", URL: "https://inbox.shopify.com/store/1f1s6n-tx/conversations/unread"},
	}, sourceURL)
	if !ok || target.ID != "same-store-list" {
		t.Fatalf("expected same-store inbox target, got ok=%v id=%q", ok, target.ID)
	}
}

func TestSelectInboxSendTargetDoesNotUseDifferentStore(t *testing.T) {
	sourceURL := "https://inbox.shopify.com/store/1f1s6n-tx/conversations/unread/abc?context=conversation_list_item_pressed"
	_, ok := selectInboxSendTarget([]cdp.Target{
		{ID: "other-store", URL: "https://inbox.shopify.com/store/other-store/conversations/unread"},
		{ID: "admin-same-store", URL: "https://admin.shopify.com/store/1f1s6n-tx/apps/shopify-inbox/shopify_chat"},
	}, sourceURL)
	if ok {
		t.Fatal("expected different-store and admin targets not to be used by send fallback")
	}
}

func TestExtractInboxConversationIDIgnoresContextQuery(t *testing.T) {
	rawURL := "https://inbox.shopify.com/store/gxuh4b-5n/conversations/unread/019f0606-6b7b-700a-8ff4-c08c65371b9a?context=conversation_list_item_pressed"
	if got := extractInboxConversationID(rawURL); got != "019f0606-6b7b-700a-8ff4-c08c65371b9a" {
		t.Fatalf("conversation id = %q", got)
	}
}

func TestExtractInboxConversationIDSupportsOpenAndClosedURLs(t *testing.T) {
	for _, rawURL := range []string{
		"https://inbox.shopify.com/store/demo/conversations/open/open-1",
		"https://inbox.shopify.com/store/demo/conversations/closed/closed-1",
	} {
		if got := extractInboxConversationID(rawURL); got == "" {
			t.Fatalf("expected conversation id from %s", rawURL)
		}
	}
}

func TestSelectEmailSendTargetAllowsProviderPageWithoutCustomerInTitle(t *testing.T) {
	conversation := appcore.Conversation{
		Source:       "outlook",
		CustomerName: "hu qiang",
		Preview:      "Can the product be purchased now?",
	}
	target, ok := selectEmailSendTarget([]cdp.Target{
		{ID: "shopify", URL: "https://admin.shopify.com/store/demo/apps/shopify-inbox/shopify_chat", Title: "Shopify Inbox"},
		{ID: "outlook", URL: "https://outlook.live.com/mail/junkemail/id/abc", Title: "垃圾邮件 - Vian Vi - Outlook"},
	}, conversation)
	if !ok || target.ID != "outlook" {
		t.Fatalf("expected Outlook target, got ok=%v id=%q", ok, target.ID)
	}
}

func TestSelectEmailSendTargetRejectsWrongProvider(t *testing.T) {
	conversation := appcore.Conversation{Source: "gmail", CustomerName: "Ada"}
	_, ok := selectEmailSendTarget([]cdp.Target{
		{ID: "outlook", URL: "https://outlook.live.com/mail/inbox", Title: "Outlook"},
		{ID: "worker", URL: "https://mail.google.com/mail/u/0/sw.js?offline_allowed=1", Title: "Service Worker https://mail.google.com/mail/u/0/sw.js"},
	}, conversation)
	if ok {
		t.Fatal("expected wrong provider and service worker targets to be rejected")
	}
}

func TestSelectEmailSendTargetPrefersExactSourceURL(t *testing.T) {
	conversation := appcore.Conversation{
		Source:    "outlook",
		SourceURL: "https://outlook.live.com/mail/inbox/id/AQMkExact",
		Preview:   "Can the product be purchased now?",
	}
	target, ok := selectEmailSendTarget([]cdp.Target{
		{ID: "current-outlook", URL: "https://outlook.live.com/mail/inbox/id/AQMkWrong", Title: "Outlook"},
		{ID: "exact", URL: conversation.SourceURL, Title: "Outlook"},
	}, conversation)
	if !ok || target.ID != "exact" {
		t.Fatalf("expected exact source URL target, got ok=%v id=%q", ok, target.ID)
	}
}

func TestSelectEmailSendTargetManualEmailRestrictsMailboxPage(t *testing.T) {
	conversation := appcore.Conversation{
		Source:       "outlook",
		SourceURL:    "https://outlook.live.com/mail/inbox/id/AQMkExact",
		EmailAccount: "support@outlook.com",
		Preview:      "Can the product be purchased now?",
	}
	target, ok := selectEmailSendTarget([]cdp.Target{
		{ID: "old-exact", URL: conversation.SourceURL, Title: "Outlook"},
		{ID: "configured", URL: "https://outlook.live.com/mail/inbox", Title: "support@outlook.com - Outlook"},
	}, conversation, "support@outlook.com")
	if !ok || target.ID != "configured" {
		t.Fatalf("expected configured mailbox target, got ok=%v id=%q", ok, target.ID)
	}
}

func TestSelectEmailSendTargetManualEmailRequiresMatchingMailboxPage(t *testing.T) {
	conversation := appcore.Conversation{
		Source:       "gmail",
		SourceURL:    "https://mail.google.com/mail/u/0/#inbox/abc",
		EmailAccount: "support@gmail.com",
	}
	_, ok := selectEmailSendTarget([]cdp.Target{
		{ID: "other", URL: "https://mail.google.com/mail/u/0/#inbox", Title: "other@gmail.com - Gmail"},
	}, conversation, "support@gmail.com")
	if ok {
		t.Fatal("expected manual mailbox selection to reject non-matching mailbox page")
	}
}

func TestEmailAddressMismatchAllowedOnlyForVerifiedEmailDetail(t *testing.T) {
	allowed := appcore.Conversation{Source: "gmail", DetailLoaded: true}
	if !emailAddressMismatchAllowed(allowed, 2) {
		t.Fatal("expected verified Gmail detail with multiple signals to allow hidden email address")
	}
	if emailAddressMismatchAllowed(appcore.Conversation{Source: "gmail", DetailLoaded: false}, 2) {
		t.Fatal("expected non-detail Gmail page to remain blocked")
	}
	if emailAddressMismatchAllowed(appcore.Conversation{Source: "gmail", DetailLoaded: true}, 1) {
		t.Fatal("expected weak Gmail detail match to remain blocked")
	}
	if emailAddressMismatchAllowed(appcore.Conversation{Source: "inbox", DetailLoaded: true}, 2) {
		t.Fatal("expected Shopify Inbox to keep its separate send validation")
	}
}

func TestConversationSendJSONIncludesEmailSendContext(t *testing.T) {
	conversation := appcore.Conversation{
		Source:         "gmail",
		SourceURL:      "https://mail.google.com/mail/u/0/#inbox/abc",
		ConversationID: "abc",
		CustomerName:   "Hu Qiang",
		Preview:        "Hello, I would like to return this order.",
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(conversationSendJSON(conversation)), &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	for key, want := range map[string]string{
		"source":         conversation.Source,
		"sourceUrl":      conversation.SourceURL,
		"conversationId": conversation.ConversationID,
	} {
		if got := payload[key]; got != want {
			t.Fatalf("%s = %q, want %q", key, got, want)
		}
	}
}

func TestEmailSendVerificationFailureClassification(t *testing.T) {
	if !isSoftEmailSendVerificationFailure("sent reply was not found in the current email thread") {
		t.Fatal("expected missing thread echo to be a soft verification warning")
	}
	if isSoftEmailSendVerificationFailure("reply text is still in the composer; the email page did not confirm it was sent") {
		t.Fatal("expected text still in composer to remain a hard failure")
	}
	if isSoftEmailSendVerificationFailure("send button was not found") {
		t.Fatal("expected unrelated send verification failures to remain hard failures")
	}
}
