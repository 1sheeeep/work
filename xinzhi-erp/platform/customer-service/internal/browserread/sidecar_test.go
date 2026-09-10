package browserread

import (
	"context"
	"errors"
	"strings"
	"testing"

	"shopify-support-platform/internal/appcore"
)

func TestReadInboxRejectsNonLocalCDP(t *testing.T) {
	_, err := ReadInbox(context.Background(), appcore.OpenResult{WebDriverURL: "http://203.0.113.10:9222"}, appcore.Shop{DisplayName: "Demo"}, false, true, nil)
	if err == nil {
		t.Fatalf("expected non-local CDP endpoint to be rejected")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "loopback") && !strings.Contains(strings.ToLower(err.Error()), "local") {
		t.Fatalf("expected local endpoint error, got %v", err)
	}
}

func TestIsCDPConnectFailureRecognizesTransientConnectionErrors(t *testing.T) {
	cases := []string{
		"CDP connection failed after retries: browserType.connectOverCDP: Timeout 15000ms exceeded",
		"playwright sidecar failed: Error: connect ECONNREFUSED 127.0.0.1:9222",
		"read failed: ECONNRESET",
		"read failed: socket hang up",
		"DevTools connection timeout",
		"cdp_handshake_timeout: connectOverCDP did not finish within 8000ms",
		"cdp_http_list_unavailable: http://127.0.0.1:9222/json/list failed: timeout",
		"cdp_no_targets: CDP /json/list returned no browser pages",
	}
	for _, message := range cases {
		if !IsCDPConnectFailure(errors.New(message)) {
			t.Fatalf("expected CDP failure to be recognized: %s", message)
		}
	}
}

func TestIsCDPConnectFailureRejectsParserErrors(t *testing.T) {
	cases := []string{
		"calibration failed: no structured unread rows found",
		"Outlook unread row parser failed",
		"Shopify Inbox unread view has no conversations",
	}
	for _, message := range cases {
		if IsCDPConnectFailure(errors.New(message)) {
			t.Fatalf("expected non-CDP failure to be ignored: %s", message)
		}
	}
}
