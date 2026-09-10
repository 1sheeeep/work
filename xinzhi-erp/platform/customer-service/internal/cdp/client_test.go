package cdp

import (
	"net/url"
	"strings"
	"testing"
)

func TestEnsureLoopbackEndpoint(t *testing.T) {
	allowed := []string{
		"http://127.0.0.1:45008/json/list",
		"http://localhost:45008/json/list",
		"ws://[::1]:45008/devtools/page/1",
	}
	for _, endpoint := range allowed {
		if err := ensureLoopbackEndpoint(endpoint); err != nil {
			t.Fatalf("expected loopback endpoint %q to be allowed: %v", endpoint, err)
		}
	}

	blocked := []string{
		"http://192.168.1.20:45008/json/list",
		"ws://example.com/devtools/page/1",
		"https://shopify.com/admin",
	}
	for _, endpoint := range blocked {
		if err := ensureLoopbackEndpoint(endpoint); err == nil {
			t.Fatalf("expected non-local endpoint %q to be blocked", endpoint)
		}
	}
}

func TestTargetPriorityPrefersUnreadInbox(t *testing.T) {
	targets := []Target{
		{URL: "https://admin.shopify.com/store/demo"},
		{URL: "https://inbox.shopify.com/store/demo/conversations/open/abc"},
		{URL: "https://inbox.shopify.com/store/demo/conversations/unread"},
	}
	best := targets[0]
	for _, target := range targets[1:] {
		if targetPriority(target) < targetPriority(best) {
			best = target
		}
	}
	if best.URL != "https://inbox.shopify.com/store/demo/conversations/unread" {
		t.Fatalf("expected unread inbox target to be preferred, got %s", best.URL)
	}
}

func TestCreateTargetURLEncodesOAuthQuery(t *testing.T) {
	targetURL := "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?client_id=client-id&response_type=code&scope=offline_access+User.Read+Mail.ReadWrite+Mail.Send&state=abc"
	endpoint := createTargetURL("http://127.0.0.1:12643/", targetURL)

	if strings.Contains(endpoint, "&scope=") {
		t.Fatalf("target URL query leaked into DevTools endpoint: %s", endpoint)
	}
	parsed, err := url.Parse(endpoint)
	if err != nil {
		t.Fatal(err)
	}
	got, err := url.QueryUnescape(parsed.RawQuery)
	if err != nil {
		t.Fatal(err)
	}
	if got != targetURL {
		t.Fatalf("expected encoded target URL to round-trip\nwant: %s\n got: %s", targetURL, got)
	}
}
