package platform

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestSeventeenTrackRequestOmitsShopifyCarrierName(t *testing.T) {
	payload := seventeenTrackRequest(" 1Z999 ", "UPS")
	if got := payload["number"]; got != "1Z999" {
		t.Fatalf("number = %v, want 1Z999", got)
	}
	if _, ok := payload["carrier"]; ok {
		t.Fatalf("carrier name must not be sent as a 17TRACK carrier code: %#v", payload)
	}
	if _, ok := payload["cacheLevel"]; ok {
		t.Fatalf("standard payload must not include Instant cacheLevel: %#v", payload)
	}
}

func TestSeventeenTrackRequestIncludesNumericCarrierCode(t *testing.T) {
	payload := seventeenTrackRequest("RR123", " 3011 ")
	if got := payload["carrier"]; got != 3011 {
		t.Fatalf("carrier = %v, want 3011", got)
	}
}

func TestSeventeenTrackUsesStandardDetailsBeforeRegister(t *testing.T) {
	var mu sync.Mutex
	paths := []string{}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		paths = append(paths, r.URL.Path)
		mu.Unlock()
		if r.URL.Path != "/gettrackinfo" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		writeJSONResponse(w, http.StatusOK, map[string]any{
			"code": 0,
			"data": map[string]any{"accepted": []any{map[string]any{
				"number": "ZS18742872599",
				"track_info": map[string]any{
					"latest_status": map[string]any{"status": "InTransit"},
					"latest_event": map[string]any{
						"time_iso": "2026-07-19T10:46:27Z", "description": "Destination transit", "location": "Los Angeles USA",
					},
				},
			}}},
		})
	}))
	defer provider.Close()

	tracker := newSeventeenTrackTestService(t, provider.URL)
	result, err := tracker.Track(context.Background(), LogisticsTrackingRequest{TrackingNumber: "ZS18742872599", Carrier: "China Post"})
	if err != nil {
		t.Fatalf("Track failed: %v", err)
	}
	if result.Status != "InTransit" || len(result.Events) != 1 {
		t.Fatalf("unexpected result: %#v", result)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(paths) != 1 || paths[0] != "/gettrackinfo" {
		t.Fatalf("paths = %#v, want only /gettrackinfo", paths)
	}
}

func TestSeventeenTrackUsesStandardDetailsAfterRegister(t *testing.T) {
	var mu sync.Mutex
	paths := []string{}
	getTrackCalls := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		paths = append(paths, r.URL.Path)
		mu.Unlock()
		switch r.URL.Path {
		case "/gettrackinfo":
			getTrackCalls++
			if getTrackCalls == 1 {
				writeJSONResponse(w, http.StatusOK, map[string]any{"code": 0, "data": map[string]any{"accepted": []any{}, "rejected": []any{map[string]any{"number": "NEW123"}}}})
				return
			}
			writeJSONResponse(w, http.StatusOK, map[string]any{
				"code": 0,
				"data": map[string]any{"accepted": []any{map[string]any{
					"number": "NEW123",
					"track_info": map[string]any{
						"latest_status": map[string]any{"status": "InTransit"},
						"latest_event":  map[string]any{"time_iso": "2026-07-23T12:00:00Z", "description": "Package moving"},
					},
				}}},
			})
		case "/register":
			writeJSONResponse(w, http.StatusOK, map[string]any{"code": 0, "data": map[string]any{"accepted": []any{map[string]any{"number": "NEW123"}}}})
		default:
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
	}))
	defer provider.Close()

	tracker := newSeventeenTrackTestService(t, provider.URL)
	result, err := tracker.Track(context.Background(), LogisticsTrackingRequest{TrackingNumber: "NEW123"})
	if err != nil {
		t.Fatalf("Track failed: %v", err)
	}
	if result.Status != "InTransit" || len(result.Events) != 1 {
		t.Fatalf("unexpected registered result: %#v", result)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(paths) != 3 || paths[0] != "/gettrackinfo" || paths[1] != "/register" || paths[2] != "/gettrackinfo" {
		t.Fatalf("paths = %#v, want gettrackinfo, register, then gettrackinfo", paths)
	}
}

func TestSeventeenTrackMergesConcurrentRequestsForSameNumber(t *testing.T) {
	var calls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/gettrackinfo" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		calls.Add(1)
		time.Sleep(50 * time.Millisecond)
		writeJSONResponse(w, http.StatusOK, map[string]any{
			"code": 0,
			"data": map[string]any{"accepted": []any{map[string]any{
				"number": "SHARED123",
				"track_info": map[string]any{
					"latest_status": map[string]any{"status": "InTransit"},
					"latest_event":  map[string]any{"time_iso": "2026-07-25T01:00:00Z", "description": "Shared result"},
				},
			}}},
		})
	}))
	defer provider.Close()

	tracker := newSeventeenTrackTestService(t, provider.URL)
	start := make(chan struct{})
	var group sync.WaitGroup
	for range 8 {
		group.Add(1)
		go func() {
			defer group.Done()
			<-start
			result, err := tracker.Track(context.Background(), LogisticsTrackingRequest{TrackingNumber: "SHARED123"})
			if err != nil || len(result.Events) != 1 {
				t.Errorf("Track returned result=%#v err=%v", result, err)
			}
		}()
	}
	close(start)
	group.Wait()
	if got := calls.Load(); got != 1 {
		t.Fatalf("provider calls = %d, want 1", got)
	}
}

func TestSeventeenTrackPendingSnapshotExpiresBeforeCompletedSnapshot(t *testing.T) {
	store := &shopifyCustomerCacheTestStore{Store: NewMemoryStore(), entries: make(map[string]externalCacheEntry)}
	server := NewServer(store)
	tracker := server.seventeenTrack()
	now := time.Now().UTC()

	tracker.save(t.Context(), LogisticsTrackingResult{TrackingNumber: "PENDING-1", Status: "pending"})
	pending := store.entries[externalCacheKey(seventeenTrackCacheNamespace, "", "PENDING-1")]
	if remaining := pending.ExpiresAt.Sub(now); remaining < 50*time.Minute || remaining > 70*time.Minute {
		t.Fatalf("pending snapshot should expire in about one hour, remaining=%v", remaining)
	}

	tracker.save(t.Context(), LogisticsTrackingResult{
		TrackingNumber: "DELIVERED-1",
		Status:         "delivered",
		Events:         []LogisticsTrackingEvent{{Time: "2026-07-25T12:00:00Z", Status: "Delivered"}},
	})
	completed := store.entries[externalCacheKey(seventeenTrackCacheNamespace, "", "DELIVERED-1")]
	if remaining := completed.ExpiresAt.Sub(now); remaining < 89*24*time.Hour {
		t.Fatalf("completed snapshot should remain reusable for the order lifecycle, remaining=%v", remaining)
	}
}

func newSeventeenTrackTestService(t *testing.T, baseURL string) *seventeenTrackService {
	t.Helper()
	t.Setenv("AI_SETTINGS_ENCRYPTION_KEY", "test-only-encryption-secret")
	t.Setenv("SEVENTEENTRACK_BASE_URL", baseURL)
	store := NewMemoryStore()
	server := NewServer(store)
	if _, err := server.saveLogisticsSettings(context.Background(), logisticsSettingsRequest{Enabled: true, APIKey: "test-key"}); err != nil {
		t.Fatalf("saveLogisticsSettings failed: %v", err)
	}
	tracker := &seventeenTrackService{server: server, client: http.DefaultClient}
	server.logisticsTracker = tracker
	return tracker
}

func TestParseSeventeenTrackResult(t *testing.T) {
	raw, err := json.Marshal(map[string]any{
		"code": 0,
		"data": map[string]any{
			"accepted": []any{map[string]any{
				"number": "RR123",
				"track_info": map[string]any{
					"latest_status": map[string]any{"status": "Delivered"},
					"latest_event": map[string]any{
						"time_iso":    "2026-07-22T10:00:00+08:00",
						"description": "Delivered to mailbox",
						"location":    "Shanghai",
					},
					"tracking": map[string]any{
						"providers": []any{map[string]any{
							"events": []any{
								map[string]any{"time_iso": "2026-07-22T10:00:00+08:00", "description": "Delivered to mailbox", "location": "Shanghai"},
								map[string]any{"time": "09:30:00"},
								map[string]any{"time_iso": "2026-07-21T08:00:00+08:00", "description": "Out for delivery", "location": "Shanghai"},
							},
						}},
					},
				},
			}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	result, ok := parseSeventeenTrackResult(raw, "RR123", "UPS")
	if !ok {
		t.Fatal("expected tracking result")
	}
	if result.Status != "Delivered" || result.Carrier != "UPS" {
		t.Fatalf("unexpected result: %#v", result)
	}
	if len(result.Events) != 2 {
		t.Fatalf("events = %d, want 2: %#v", len(result.Events), result.Events)
	}
	if result.Events[0].Description != "Delivered to mailbox" || result.Events[1].Description != "Out for delivery" {
		t.Fatalf("unexpected event order: %#v", result.Events)
	}
}

func TestNormalizeSeventeenTrackResultFiltersEmptyEvents(t *testing.T) {
	result := LogisticsTrackingResult{
		Configured:     true,
		Provider:       "17TRACK",
		TrackingNumber: "ZS18791832199",
		Events: []LogisticsTrackingEvent{
			{Time: "2026-07-23T12:00:00+08:00", Status: "InTransit_Other", Description: "Arrived at processing center", Location: "Los Angeles USA"},
			{Time: "17:01:40"},
			{Time: "16:59:29"},
		},
	}
	normalizeSeventeenTrackResult(&result)

	if len(result.Events) != 1 {
		t.Fatalf("events = %d, want 1: %#v", len(result.Events), result.Events)
	}
	if result.Events[0].Description != "Arrived at processing center" {
		t.Fatalf("unexpected cached event: %#v", result.Events[0])
	}
}

func TestDedupeEventsSortsByActualTimestamp(t *testing.T) {
	events := dedupeEvents([]LogisticsTrackingEvent{
		{Time: "2026-07-25T00:30:00+08:00", Description: "Earlier absolute time"},
		{Time: "2026-07-24T18:00:00Z", Description: "Later absolute time"},
	})
	if len(events) != 2 {
		t.Fatalf("dedupeEvents returned %#v", events)
	}
	if events[0].Description != "Later absolute time" {
		t.Fatalf("events were sorted lexically instead of chronologically: %#v", events)
	}
}
