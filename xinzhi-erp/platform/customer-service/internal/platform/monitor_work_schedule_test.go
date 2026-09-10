package platform

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

func TestMonitorBusinessDurationUsesConfiguredHours(t *testing.T) {
	location := shanghaiLocation()
	schedule := defaultMonitorWorkSchedule()
	schedule.Enabled = true
	schedule.EffectiveFrom = monitorScheduleHistoryStart
	versions := []MonitorWorkSchedule{schedule}

	tests := []struct {
		name  string
		start time.Time
		end   time.Time
		want  time.Duration
	}{
		{
			name:  "message before work starts",
			start: time.Date(2026, 7, 28, 2, 0, 0, 0, location),
			end:   time.Date(2026, 7, 28, 9, 20, 0, 0, location),
			want:  20 * time.Minute,
		},
		{
			name:  "response crosses midnight",
			start: time.Date(2026, 7, 28, 23, 50, 0, 0, location),
			end:   time.Date(2026, 7, 29, 9, 10, 0, 0, location),
			want:  20 * time.Minute,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := monitorBusinessDuration(test.start, test.end, versions); got != test.want {
				t.Fatalf("business duration = %s, want %s", got, test.want)
			}
		})
	}
}

func TestMonitorBusinessDurationSkipsDisabledWeekdays(t *testing.T) {
	location := shanghaiLocation()
	schedule := defaultMonitorWorkSchedule()
	schedule.Enabled = true
	schedule.Weekdays = []int{1, 2, 3, 4, 5}
	schedule.EffectiveFrom = monitorScheduleHistoryStart

	start := time.Date(2026, 7, 31, 23, 50, 0, 0, location) // Friday
	end := time.Date(2026, 8, 3, 9, 10, 0, 0, location)     // Monday
	if got := monitorBusinessDuration(start, end, []MonitorWorkSchedule{schedule}); got != 20*time.Minute {
		t.Fatalf("weekend business duration = %s, want 20m", got)
	}
}

func TestMonitorBusinessDurationKeepsVersionedHistory(t *testing.T) {
	location := shanghaiLocation()
	first := defaultMonitorWorkSchedule()
	first.Enabled = true
	first.EffectiveFrom = monitorScheduleHistoryStart
	second := first
	second.StartMinute = 10 * 60
	second.EffectiveFrom = time.Date(2026, 7, 28, 0, 0, 0, 0, location)
	versions := []MonitorWorkSchedule{first, second}

	beforeChange := monitorBusinessDuration(
		time.Date(2026, 7, 27, 9, 0, 0, 0, location),
		time.Date(2026, 7, 27, 10, 0, 0, 0, location),
		versions,
	)
	afterChange := monitorBusinessDuration(
		time.Date(2026, 7, 28, 9, 0, 0, 0, location),
		time.Date(2026, 7, 28, 10, 30, 0, 0, location),
		versions,
	)
	if beforeChange != time.Hour {
		t.Fatalf("historical duration changed: %s", beforeChange)
	}
	if afterChange != 30*time.Minute {
		t.Fatalf("new version duration = %s, want 30m", afterChange)
	}
}

func TestMonitorWorkScheduleFirstEnableRecalculatesHistory(t *testing.T) {
	store := NewMemoryStore()
	ctx := context.Background()
	if _, err := store.SaveMonitorWorkSchedule(ctx, MonitorWorkSchedule{
		Enabled: false, StartMinute: 8 * 60, EndMinute: 18 * 60, Weekdays: []int{1, 2, 3, 4, 5, 6, 7},
	}); err != nil {
		t.Fatal(err)
	}
	firstEnabled, err := store.SaveMonitorWorkSchedule(ctx, MonitorWorkSchedule{
		Enabled: true, StartMinute: 9 * 60, EndMinute: 24 * 60, Weekdays: []int{1, 2, 3, 4, 5, 6, 7},
	})
	if err != nil {
		t.Fatal(err)
	}
	versions, err := store.ListMonitorWorkScheduleVersions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(versions) != 1 || !firstEnabled.EffectiveFrom.Equal(monitorScheduleHistoryStart) {
		t.Fatalf("first enable must replace pre-enable versions and start at history boundary: %#v", versions)
	}
	if _, err := store.SaveMonitorWorkSchedule(ctx, MonitorWorkSchedule{
		Enabled: true, StartMinute: 10 * 60, EndMinute: 24 * 60, Weekdays: []int{1, 2, 3, 4, 5, 6, 7},
	}); err != nil {
		t.Fatal(err)
	}
	versions, err = store.ListMonitorWorkScheduleVersions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(versions) != 2 || !versions[1].EffectiveFrom.After(monitorScheduleHistoryStart) {
		t.Fatalf("later changes must append an effective-dated version: %#v", versions)
	}
}

func TestResponseMetricsUseMonitorWorkSchedule(t *testing.T) {
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)
	agent := createTestAgent(t, server.URL, adminToken, "schedule-metrics@example.com", "Schedule Metrics")

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Schedule Shop"}, http.StatusCreated, &shop)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: agent.ID}, http.StatusCreated, nil)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat, Status: SourceStatusActive}, http.StatusCreated, &source)

	requestJSON(t, http.MethodPut, server.URL+"/api/v1/settings/monitor-work-schedule", adminToken, monitorWorkScheduleRequest{
		Enabled: true, StartMinute: 0, EndMinute: 24 * 60, Weekdays: []int{1, 2, 3, 4, 5, 6, 7},
	}, http.StatusOK, nil)

	historicalConversation, err := store.CreateConversation(context.Background(), Conversation{ShopID: shop.ID, SourceID: source.ID})
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateConversation(context.Background(), Conversation{ShopID: shop.ID, SourceID: source.ID})
	if err != nil {
		t.Fatal(err)
	}
	todayStart, _ := shanghaiDayBounds(time.Now().UTC())
	replyAt := time.Now().UTC().Add(-time.Minute)
	customerAt := replyAt.Add(-20 * time.Minute)
	if customerAt.Before(todayStart) {
		customerAt = todayStart
		replyAt = todayStart.Add(20 * time.Minute)
	}
	historicalCustomerAt := todayStart.AddDate(0, 0, -1).Add(10 * time.Hour)
	if _, _, err := store.AddMessage(context.Background(), Message{
		ConversationID: historicalConversation.ID, Direction: MessageDirectionCustomer, Body: "Historical message", CreatedAt: historicalCustomerAt,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ClaimConversation(context.Background(), historicalConversation.ID, agent.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.AddAgentMessage(context.Background(), Message{
		ConversationID: historicalConversation.ID, Body: "Historical reply", CreatedAt: historicalCustomerAt.Add(4 * time.Hour),
	}, agent.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.AddMessage(context.Background(), Message{
		ConversationID: conversation.ID, Direction: MessageDirectionCustomer, Body: "Today's message", CreatedAt: customerAt,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ClaimConversation(context.Background(), conversation.ID, agent.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.AddAgentMessage(context.Background(), Message{
		ConversationID: conversation.ID, Body: "Today's reply", CreatedAt: replyAt,
	}, agent.ID); err != nil {
		t.Fatal(err)
	}

	var metrics responseMetricsResponse
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/monitor/response-metrics?shopId="+url.QueryEscape(shop.ID), adminToken, nil, http.StatusOK, &metrics)
	if metrics.AverageResponseSec != (20*time.Minute).Seconds() || metrics.FirstResponseSec != (20*time.Minute).Seconds() {
		t.Fatalf("response metrics did not use today's work-schedule-adjusted replies: %#v", metrics)
	}
	if len(metrics.Metrics) != 1 || metrics.Metrics[0].ResponseCount != 1 {
		t.Fatalf("historical response leaked into real-time metrics: %#v", metrics.Metrics)
	}
}
