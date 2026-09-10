package adapters

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"shopify-support-platform/internal/appcore"
	"shopify-support-platform/internal/cdp"
)

func TestEnsureLocalHTTPURL(t *testing.T) {
	allowed := []string{
		"http://127.0.0.1:45008/api",
		"http://localhost:54345/api",
		"https://[::1]:50325/api",
	}
	for _, endpoint := range allowed {
		if err := ensureLocalHTTPURL(endpoint); err != nil {
			t.Fatalf("expected local endpoint %q to be allowed: %v", endpoint, err)
		}
	}

	blocked := []string{
		"http://192.168.1.20:45008/api",
		"https://adspower.example.com/api",
		"ws://127.0.0.1:45008/devtools/page/1",
	}
	for _, endpoint := range blocked {
		if err := ensureLocalHTTPURL(endpoint); err == nil {
			t.Fatalf("expected endpoint %q to be blocked", endpoint)
		}
	}
}

func TestZhanfuClientDetectionPrefersConfiguredPath(t *testing.T) {
	configured := writeTestExe(t, filepath.Join(t.TempDir(), "Custom.exe"))
	fallback := writeTestExe(t, filepath.Join(t.TempDir(), "ZhanFu", "站斧.exe"))

	detection := firstExistingZhanfuClient([]zhanfuClientCandidate{
		{Path: configured, Source: "configured"},
		{Path: fallback, Source: "common_path"},
	})

	if detection.Path != configured || detection.Source != "configured" {
		t.Fatalf("expected configured path first, got %+v", detection)
	}
}

func TestZhanfuClientDetectionFallsBackWhenConfiguredPathInvalid(t *testing.T) {
	fallback := writeTestExe(t, filepath.Join(t.TempDir(), "ZhanFu", "站斧.exe"))

	detection := firstExistingZhanfuClient([]zhanfuClientCandidate{
		{Path: filepath.Join(t.TempDir(), "missing.exe"), Source: "configured"},
		{Path: fallback, Source: "common_path"},
	})

	if detection.Path != fallback || detection.Source != "common_path" {
		t.Fatalf("expected fallback path, got %+v", detection)
	}
}

func TestZhanfuClientDetectionReportsNotFound(t *testing.T) {
	detection := firstExistingZhanfuClient([]zhanfuClientCandidate{
		{Path: filepath.Join(t.TempDir(), "missing.exe"), Source: "configured"},
	})
	if detection.Path != "" || len(detection.Checked) != 1 {
		t.Fatalf("expected no path and checked evidence, got %+v", detection)
	}
}

func writeTestExe(t *testing.T, path string) string {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("test"), 0644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestListAdsPowerReadsAllPages(t *testing.T) {
	const total = 250
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/user/list" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		page, _ := strconv.Atoi(r.URL.Query().Get("page"))
		pageSize, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
		if pageSize <= 0 {
			pageSize = 100
		}
		start := (page - 1) * pageSize
		end := start + pageSize
		if end > total {
			end = total
		}
		rows := []map[string]any{}
		for index := start; index < end; index++ {
			rows = append(rows, map[string]any{
				"user_id": fmt.Sprintf("ads-%03d", index+1),
				"name":    fmt.Sprintf("Shop %03d", index+1),
			})
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code": 0,
			"data": map[string]any{"list": rows},
		})
	}))
	defer server.Close()

	shops, err := listAdsPower(map[string]any{
		"base_url":             server.URL,
		"http_port":            serverPort(server.URL),
		"http_timeout_seconds": 2,
		"page_size":            100,
		"api_key":              "test-key",
	}, "default", "AdsPower", nil)
	if err != nil {
		t.Fatalf("listAdsPower failed: %v", err)
	}
	if len(shops) != total {
		t.Fatalf("expected %d shops, got %d", total, len(shops))
	}
	if shops[0].MallID != "ads-001" || shops[len(shops)-1].MallID != "ads-250" {
		t.Fatalf("unexpected first/last shop: %s / %s", shops[0].MallID, shops[len(shops)-1].MallID)
	}
}

func TestListShopsDedupesSameAdsPowerProfileAcrossInstances(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/user/list" {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code": 0,
				"data": map[string]any{"list": []map[string]any{
					{"user_id": "k1ad0uoc", "name": "dilyhbu.com-yang09200416@outlook.com-shopify"},
				}},
			})
			return
		}
		if r.URL.Path == "/api/v1/browser/local-active" {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code": 0,
				"data": map[string]any{"list": []map[string]any{}},
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	settings := appcore.Settings{
		Zhanfu:     map[string]any{"http_port": 1, "base_url": "http://127.0.0.1:1"},
		BitBrowser: map[string]any{"http_port": 1, "base_url": "http://127.0.0.1:1"},
		AdsPower: map[string]any{
			"base_url":             server.URL,
			"http_port":            serverPort(server.URL),
			"http_timeout_seconds": 2,
			"api_key":              "test-key",
		},
		AdsPowerInstances: []map[string]any{
			{
				"name":                 "same-api",
				"base_url":             server.URL,
				"http_port":            serverPort(server.URL),
				"http_timeout_seconds": 2,
				"api_key":              "test-key",
			},
		},
	}

	shops, err := ListShops(settings, nil)
	if err != nil {
		t.Fatalf("ListShops failed: %v", err)
	}
	if len(shops) != 1 {
		t.Fatalf("expected duplicate AdsPower profile to be collapsed to 1 shop, got %d: %#v", len(shops), shops)
	}
	if shops[0].MallID != "k1ad0uoc" || shops[0].AdapterName != "adspower" {
		t.Fatalf("unexpected shop after dedupe: %#v", shops[0])
	}
}

func TestAttachOpenShopDoesNotStartAdsPowerWhenProfileNotRunning(t *testing.T) {
	startCalled := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/browser/local-active":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code": 0,
				"data": map[string]any{"list": []map[string]any{}},
			})
		case "/api/v1/browser/start":
			startCalled = true
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "data": map[string]any{}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	_, err := AttachOpenShop(appcore.Settings{
		AdsPower: map[string]any{
			"base_url":             server.URL,
			"http_port":            serverPort(server.URL),
			"http_timeout_seconds": 2,
			"api_key":              "test-key",
		},
	}, appcore.Shop{AdapterName: "adspower", MallID: "ads-001", DisplayName: "Shop"}, nil)
	if err == nil {
		t.Fatal("expected attach to fail for a non-running AdsPower profile")
	}
	if startCalled {
		t.Fatal("must not call AdsPower start when local-active does not include the profile")
	}
}

func TestAttachOpenShopRecoversAdsPowerRunningProfileMissingDevtools(t *testing.T) {
	devtools := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/json/list" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(`[]`))
	}))
	defer devtools.Close()
	devtoolsPort := serverPort(devtools.URL)
	localActiveCalls := 0
	startCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/browser/local-active":
			localActiveCalls++
			row := map[string]any{"user_id": "ads-001"}
			if startCalls > 0 {
				row["debug_port"] = fmt.Sprint(devtoolsPort)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code": 0,
				"data": map[string]any{"list": []map[string]any{row}},
			})
		case "/api/v1/browser/start":
			startCalls++
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code": 0,
				"data": map[string]any{"debug_port": fmt.Sprint(devtoolsPort)},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	result, err := AttachOpenShop(appcore.Settings{
		AdsPower: map[string]any{
			"base_url":             server.URL,
			"http_port":            serverPort(server.URL),
			"http_timeout_seconds": 2,
			"api_key":              "test-key",
		},
	}, appcore.Shop{AdapterName: "adspower", MallID: "ads-001", DisplayName: "Shop"}, nil)
	if err != nil {
		t.Fatalf("expected recovery to attach AdsPower profile: %v", err)
	}
	if startCalls != 1 {
		t.Fatalf("expected exactly one AdsPower start recovery call, got %d", startCalls)
	}
	if localActiveCalls < 2 {
		t.Fatalf("expected local-active to be checked before and after recovery, got %d", localActiveCalls)
	}
	if result.WebDriverURL != "http://127.0.0.1:"+fmt.Sprint(devtoolsPort) {
		t.Fatalf("unexpected recovered webdriver URL: %q", result.WebDriverURL)
	}
}

func TestExtractAdsPowerConnectionReadsNestedWSMap(t *testing.T) {
	webdriverURL, debuggerAddress := extractAdsPowerConnection(map[string]any{
		"user_id": "k1ad0uoc",
		"ws": map[string]any{
			"puppeteer": "ws://127.0.0.1:57558/devtools/browser/1f078c40-9253-4d4d-b357-dbb76790e52b",
			"selenium":  "127.0.0.1:57558",
		},
		"debug_port": "57558",
	})
	if webdriverURL != "http://127.0.0.1:57558" || debuggerAddress != "127.0.0.1:57558" {
		t.Fatalf("unexpected connection: webdriver=%q debugger=%q", webdriverURL, debuggerAddress)
	}
}

func TestExtractAdsPowerConnectionReadsPuppeteerWS(t *testing.T) {
	webdriverURL, debuggerAddress := extractAdsPowerConnection(map[string]any{
		"ws": map[string]any{
			"puppeteer": "ws://127.0.0.1:57558/devtools/browser/abc",
		},
	})
	if webdriverURL != "http://127.0.0.1:57558" || debuggerAddress != "127.0.0.1:57558" {
		t.Fatalf("unexpected connection from puppeteer ws: webdriver=%q debugger=%q", webdriverURL, debuggerAddress)
	}
}

func TestExtractAdsPowerConnectionReadsDebugPortFallback(t *testing.T) {
	webdriverURL, debuggerAddress := extractAdsPowerConnection(map[string]any{
		"debug_port": "57558",
	})
	if webdriverURL != "http://127.0.0.1:57558" || debuggerAddress != "127.0.0.1:57558" {
		t.Fatalf("unexpected connection from debug_port: webdriver=%q debugger=%q", webdriverURL, debuggerAddress)
	}
}

func TestExtractWebdriverInfoReadsBitBrowserOpenResponse(t *testing.T) {
	webdriverURL, debuggerAddress := extractWebdriverInfo(flatten(map[string]any{
		"ws":   "ws://127.0.0.1:50859/devtools/browser/ee40130f-157c-4df2-a6cd-11ba230382c2",
		"http": "127.0.0.1:50859",
		"pid":  25612,
	}))
	if webdriverURL != "http://127.0.0.1:50859" || debuggerAddress != "127.0.0.1:50859" {
		t.Fatalf("unexpected BitBrowser connection: webdriver=%q debugger=%q", webdriverURL, debuggerAddress)
	}
}

func TestExtractWebdriverInfoReadsNestedWSAndHTTP(t *testing.T) {
	webdriverURL, debuggerAddress := extractWebdriverInfo(flatten(map[string]any{
		"data": map[string]any{
			"ws":   "ws://127.0.0.1:50859/devtools/browser/abc",
			"http": "http://127.0.0.1:50859",
		},
	}))
	if webdriverURL != "http://127.0.0.1:50859" || debuggerAddress != "127.0.0.1:50859" {
		t.Fatalf("unexpected nested connection: webdriver=%q debugger=%q", webdriverURL, debuggerAddress)
	}
}

func TestTargetsMatchShopFromOpenShopifyPage(t *testing.T) {
	shop := appcore.Shop{DisplayName: "amarnis.com-Buuukxxi2647@outlook.com-shopify", MallID: "3072962"}
	targets := []cdp.Target{
		{Title: "New Tab", URL: "chrome://newtab/"},
		{Title: "Amarnis - Orders - Shopify", URL: "https://admin.shopify.com/store/ibapbf-44/orders/7332385521948"},
	}
	if !targetsMatchShop(targets, shop) {
		t.Fatalf("expected Shopify target title/url to match shop display name")
	}
}

func TestDebugPortOwnersLocksSharedDomainPortToBrowserID(t *testing.T) {
	owners := debugPortOwners([]map[string]any{
		{
			"Name":        "zhanfubrowser.exe",
			"CommandLine": `"zhanfubrowser.exe" --browser_id=3071803 --remote-debugging-port=12643 --user-data-dir="C:\Temp\profile"`,
		},
		{
			"Name":        "zhanfubrowser.exe",
			"CommandLine": `"zhanfubrowser.exe" --type=renderer --remote-debugging-port=12643 --user-data-dir="C:\Temp\profile"`,
		},
	})
	if owners["12643"] != "3071803" {
		t.Fatalf("expected port 12643 owner 3071803, got %q", owners["12643"])
	}
	if owners["12643"] == "3073024" {
		t.Fatalf("port owner must not be reassigned to another Floravyne profile")
	}
}

func TestDebugProcessAllowedCoversGenericChromiumBrowsers(t *testing.T) {
	allowed := []struct {
		name string
		cmd  string
	}{
		{name: "msedge.exe", cmd: `msedge.exe --remote-debugging-port=9222`},
		{name: "brave.exe", cmd: `brave.exe --remote-debugging-port=9223`},
		{name: "SunBrowser.exe", cmd: `SunBrowser.exe --remote-debugging-port=9224`},
	}
	for _, item := range allowed {
		if !debugProcessAllowed(item.name, item.cmd) {
			t.Fatalf("expected %s to be allowed as a Chromium CDP browser", item.name)
		}
	}
}

func serverPort(rawURL string) int {
	_, portText, _ := net.SplitHostPort(strings.TrimPrefix(rawURL, "http://"))
	port, _ := strconv.Atoi(portText)
	return port
}
