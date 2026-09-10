package sourcepage

import (
	"strings"
	"testing"

	"shopify-support-platform/internal/appcore"
	"shopify-support-platform/internal/cdp"
)

func TestValidateConversationLinkAllowsStorefrontOrderLink(t *testing.T) {
	got, err := validateConversationLink(appcore.Conversation{
		SourceURL: "https://inbox.shopify.com/store/example-store/conversations/unread/example-conversation",
	}, "https://shop.example.com/123/orders/example-order/authenticate?key=example-test-key")
	if err != nil {
		t.Fatalf("expected storefront order link to be allowed: %v", err)
	}
	if !strings.Contains(got, "/orders/example-order/authenticate") {
		t.Fatalf("unexpected validated link: %q", got)
	}
}

func TestValidateOpenResultForConversationBlocksWrongBrowserEnvironment(t *testing.T) {
	conversation := appcore.Conversation{
		ShopKey:  "test-shop",
		ShopName: "shop.example.com-agent@example.com-shopify",
		MallID:   "123",
	}
	openResult := appcore.OpenResult{
		AdapterName:     "bitbrowser",
		AdapterInstance: "default",
		MallID:          "456",
		ShopName:        "other@example.com-shopify",
		WebDriverURL:    "http://127.0.0.1:50859",
	}
	if err := ValidateOpenResultForConversation(openResult, conversation); err == nil {
		t.Fatal("expected wrong browser environment to be blocked")
	}
}

func TestValidateOpenResultForConversationBlocksMissingBrowserIdentity(t *testing.T) {
	conversation := appcore.Conversation{
		ShopKey:  "test-shop",
		ShopName: "shop.example.com-agent@example.com-shopify",
		MallID:   "123",
	}
	openResult := appcore.OpenResult{
		WebDriverURL: "http://127.0.0.1:12635",
	}
	if err := ValidateOpenResultForConversation(openResult, conversation); err == nil {
		t.Fatal("expected missing browser identity to be blocked")
	}
}

func TestSourceActionsValidateBrowserEnvironmentBeforeCDP(t *testing.T) {
	conversation := appcore.Conversation{
		ShopKey:        "test-shop",
		ShopName:       "shop.example.com-agent@example.com-shopify",
		MallID:         "123",
		Source:         "inbox",
		ConversationID: "gid://shopify/Conversation/123",
		SourceURL:      "https://inbox.shopify.com/store/vitaluna/conversations/123",
	}
	wrongOpenResult := appcore.OpenResult{
		AdapterName:     "bitbrowser",
		AdapterInstance: "default",
		MallID:          "456",
		ShopName:        "other@example.com-shopify",
		WebDriverURL:    "http://127.0.0.1:1",
	}
	if err := OpenSource(wrongOpenResult, conversation); err == nil {
		t.Fatal("expected OpenSource to block wrong browser before opening a target")
	}
	if err := BringToFront(wrongOpenResult, conversation); err == nil {
		t.Fatal("expected BringToFront to block wrong browser before listing targets")
	}
}

func TestValidateOpenResultForConversationAllowsMatchingEnvironment(t *testing.T) {
	conversation := appcore.Conversation{
		ShopKey:  "test-shop",
		ShopName: "shop.example.com-agent@example.com-shopify",
		MallID:   "123",
	}
	openResult := appcore.OpenResult{
		AdapterName:     "zhanfu",
		AdapterInstance: "default",
		MallID:          "123",
		ShopName:        "shop.example.com-agent@example.com-shopify",
		WebDriverURL:    "http://127.0.0.1:12635",
	}
	if err := ValidateOpenResultForConversation(openResult, conversation); err != nil {
		t.Fatalf("expected matching environment to be allowed: %v", err)
	}
}

func TestSelectReusableTargetActivatesExactURL(t *testing.T) {
	targetURL := "https://inbox.shopify.com/store/1f1s6n-tx/conversations/open/abc"
	target, action, ok := selectReusableTarget([]cdp.Target{
		{ID: "exact", URL: targetURL + "/"},
	}, targetURL)
	if !ok || target.ID != "exact" || action != reusableTargetActivate {
		t.Fatalf("expected exact target activation, got ok=%v id=%q action=%q", ok, target.ID, action)
	}
}

func TestSelectReusableTargetNavigatesSameStoreInboxPage(t *testing.T) {
	targetURL := "https://inbox.shopify.com/store/1f1s6n-tx/conversations/open/target"
	target, action, ok := selectReusableTarget([]cdp.Target{
		{ID: "other", URL: "https://inbox.shopify.com/store/other-store/conversations/open/abc"},
		{ID: "same-inbox", URL: "https://inbox.shopify.com/store/1f1s6n-tx/conversations/open/current"},
	}, targetURL)
	if !ok || target.ID != "same-inbox" || action != reusableTargetNavigate {
		t.Fatalf("expected same-store inbox navigation, got ok=%v id=%q action=%q", ok, target.ID, action)
	}
}

func TestSelectReusableTargetFallsBackToSameStoreAdminInbox(t *testing.T) {
	targetURL := "https://inbox.shopify.com/store/1f1s6n-tx/conversations/open/target"
	target, action, ok := selectReusableTarget([]cdp.Target{
		{ID: "admin-inbox", URL: "https://admin.shopify.com/store/1f1s6n-tx/apps/shopify-inbox/shopify_chat"},
	}, targetURL)
	if !ok || target.ID != "admin-inbox" || action != reusableTargetNavigate {
		t.Fatalf("expected admin inbox navigation, got ok=%v id=%q action=%q", ok, target.ID, action)
	}
}

func TestSelectReusableTargetDoesNotReuseDifferentStoreInbox(t *testing.T) {
	targetURL := "https://inbox.shopify.com/store/1f1s6n-tx/conversations/open/target"
	_, _, ok := selectReusableTarget([]cdp.Target{
		{ID: "other", URL: "https://inbox.shopify.com/store/other-store/conversations/open/current"},
		{ID: "other-admin", URL: "https://admin.shopify.com/store/other-store/apps/shopify-inbox/shopify_chat"},
	}, targetURL)
	if ok {
		t.Fatal("expected different-store inbox targets not to be reused")
	}
}

func TestSelectReusableTargetNavigatesSameStoreAdminAllowedPage(t *testing.T) {
	targetURL := "https://admin.shopify.com/store/1f1s6n-tx/orders/123"
	target, action, ok := selectReusableTarget([]cdp.Target{
		{ID: "admin-inbox", URL: "https://admin.shopify.com/store/1f1s6n-tx/apps/shopify-inbox/shopify_chat"},
		{ID: "admin-order", URL: "https://admin.shopify.com/store/1f1s6n-tx/orders/999"},
	}, targetURL)
	if !ok || target.ID != "admin-order" || action != reusableTargetNavigate {
		t.Fatalf("expected same-store admin allowed navigation, got ok=%v id=%q action=%q", ok, target.ID, action)
	}
}

func TestSelectReusableTargetOnlyReusesExactStorefrontOrderLink(t *testing.T) {
	targetURL := "https://vitalunahealth.com/71812513977/orders/target/authenticate?key=abc"
	target, action, ok := selectReusableTarget([]cdp.Target{
		{ID: "exact", URL: targetURL},
		{ID: "other-order", URL: "https://vitalunahealth.com/71812513977/orders/other/authenticate?key=def"},
	}, targetURL)
	if !ok || target.ID != "exact" || action != reusableTargetActivate {
		t.Fatalf("expected exact storefront order activation, got ok=%v id=%q action=%q", ok, target.ID, action)
	}
	_, _, ok = selectReusableTarget([]cdp.Target{
		{ID: "other-order", URL: "https://vitalunahealth.com/71812513977/orders/other/authenticate?key=def"},
	}, targetURL)
	if ok {
		t.Fatal("expected non-exact storefront order link not to be reused")
	}
}
