//go:build windows

package winexec

import (
	"testing"
)

func TestDebugPortFromOpenResult(t *testing.T) {
	got := debugPortFromOpenResult(BrowserOpenResult{
		DebuggerAddress: "127.0.0.1:12635",
		WebDriverURL:    "http://127.0.0.1:9222",
	})
	if got != "12635" {
		t.Fatalf("expected debugger address port to win, got %q", got)
	}

	got = debugPortFromOpenResult(BrowserOpenResult{
		WebDriverURL: "http://127.0.0.1:50859/json",
	})
	if got != "50859" {
		t.Fatalf("expected webdriver URL port, got %q", got)
	}
}

func TestCollectPIDsFindsNestedPIDValues(t *testing.T) {
	out := map[uint32]bool{}
	collectPIDs(map[string]any{
		"data": map[string]any{
			"pid":       float64(25612),
			"processId": "30728",
		},
		"not_a_pid": 999,
	}, out)
	if !out[25612] || !out[30728] {
		t.Fatalf("expected nested pid values to be collected, got %#v", out)
	}
	if out[999] {
		t.Fatalf("unexpected non-pid value collected: %#v", out)
	}
}

func TestCommandLineDebugPort(t *testing.T) {
	for _, commandLine := range []string{
		`chrome.exe --remote-debugging-port=12635 --user-data-dir=D:\profile`,
		`chrome.exe --remote-debugging-port "12635" --user-data-dir=D:\profile`,
	} {
		if got := commandLineDebugPort(commandLine); got != "12635" {
			t.Fatalf("expected port 12635 from %q, got %q", commandLine, got)
		}
	}
}

func TestScoreBrowserWindowPrefersTargetTitle(t *testing.T) {
	target := browserWindowCandidate{
		title: "Vitalunahealth - 对话 - Shopify",
		class: "Chrome_WidgetWin_1",
	}
	other := browserWindowCandidate{
		title: "BitBrowser profile list",
		class: "Chrome_WidgetWin_1",
	}
	if scoreBrowserWindow(target, "Vitalunahealth - 对话 - Shopify", "vitalunahealth") <= scoreBrowserWindow(other, "Vitalunahealth - 对话 - Shopify", "vitalunahealth") {
		t.Fatal("expected target window title to score higher than unrelated browser window")
	}
}
