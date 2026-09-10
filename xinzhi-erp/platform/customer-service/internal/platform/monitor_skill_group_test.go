package platform

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

func TestSkillGroupTransferVisibilityIsRestricted(t *testing.T) {
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	origin := createTestAgent(t, server.URL, adminToken, "origin@example.com", "Origin")
	consulting := createTestAgent(t, server.URL, adminToken, "consulting-target@example.com", "Consulting Target")
	var afterSales User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email: "after-sales-target@example.com", DisplayName: "After Sales Target", Password: "agent-password",
		Role: UserRoleAgent, SkillGroup: SkillGroupAfterSales,
	}, http.StatusCreated, &afterSales)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Transfer Shop"}, http.StatusCreated, &shop)
	for _, agent := range []User{origin, consulting, afterSales} {
		requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: agent.ID}, http.StatusCreated, nil)
	}
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat, Status: SourceStatusActive}, http.StatusCreated, &source)
	conversation := createTestConversation(t, store, shop.ID, source.ID, ConversationStatusAssigned, origin.ID, "Transfer by skill")
	if _, err := store.CreateTransferRequest(context.Background(), TransferRequest{
		ConversationID: conversation.ID, ShopID: shop.ID, FromAgentID: origin.ID, TargetSkillGroup: SkillGroupAfterSales,
	}); err != nil {
		t.Fatalf("create skill group transfer: %v", err)
	}

	afterItems, err := store.ListConversations(context.Background(), ConversationFilter{WorkbenchUserID: afterSales.ID, WorkbenchSkillGroup: afterSales.SkillGroup})
	if err != nil || len(afterItems) != 1 || afterItems[0].ID != conversation.ID {
		t.Fatalf("after-sales agent should see transfer: items=%#v err=%v", afterItems, err)
	}
	consultingItems, err := store.ListConversations(context.Background(), ConversationFilter{WorkbenchUserID: consulting.ID, WorkbenchSkillGroup: consulting.SkillGroup})
	if err != nil {
		t.Fatalf("list consulting conversations: %v", err)
	}
	if len(consultingItems) != 0 {
		t.Fatalf("consulting agent should not see after-sales transfer: %#v", consultingItems)
	}
}

func TestMonitorFiltersByShopAndSkillGroup(t *testing.T) {
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	consulting := createTestAgent(t, server.URL, adminToken, "consulting@example.com", "Consulting")
	var afterSales User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email: "after-sales@example.com", DisplayName: "After Sales", Password: "agent-password",
		Role: UserRoleAgent, SkillGroup: SkillGroupAfterSales,
	}, http.StatusCreated, &afterSales)
	unassigned := createTestAgent(t, server.URL, adminToken, "unassigned@example.com", "Unassigned")

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Scoped Shop"}, http.StatusCreated, &shop)
	for _, agent := range []User{consulting, afterSales} {
		requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: agent.ID}, http.StatusCreated, nil)
	}
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat, Status: SourceStatusActive}, http.StatusCreated, &source)
	createTestConversation(t, store, shop.ID, source.ID, ConversationStatusAssigned, consulting.ID, "Consulting conversation")
	createTestConversation(t, store, shop.ID, source.ID, ConversationStatusAssigned, afterSales.ID, "After-sales conversation")
	createTestConversation(t, store, shop.ID, source.ID, ConversationStatusOpen, "", "Shared queue")

	var overview monitorOverviewResponse
	query := url.Values{"shopId": {shop.ID}, "skillGroup": {SkillGroupAfterSales}}
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/monitor/overview?"+query.Encode(), adminToken, nil, http.StatusOK, &overview)
	if overview.Totals.Agents != 1 || overview.Totals.Shops != 1 || overview.Totals.Assigned != 1 || overview.Totals.Queued != 1 {
		t.Fatalf("unexpected skill group totals: %#v", overview.Totals)
	}
	if len(overview.AgentOptions) != 1 || overview.AgentOptions[0].ID != afterSales.ID || overview.AgentOptions[0].SkillGroup != SkillGroupAfterSales {
		t.Fatalf("unexpected skill group agent options: %#v", overview.AgentOptions)
	}
	if len(overview.Agents) != 1 || overview.Agents[0].ID != afterSales.ID {
		t.Fatalf("unexpected skill group agents: %#v", overview.Agents)
	}
	if len(overview.SkillGroups) != 1 || overview.SkillGroups[0].Name != SkillGroupAfterSales || overview.SkillGroups[0].Agents != 1 {
		t.Fatalf("unexpected skill group rows: %#v", overview.SkillGroups)
	}
	for _, option := range overview.AgentOptions {
		if option.ID == consulting.ID || option.ID == unassigned.ID {
			t.Fatalf("shop and skill filter leaked another agent: %#v", overview.AgentOptions)
		}
	}
}

func TestResponseMetricsRemainWithReplyingAgentAfterTransfer(t *testing.T) {
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	firstAgent := createTestAgent(t, server.URL, adminToken, "metrics-first@example.com", "Metrics First")
	secondAgent := createTestAgent(t, server.URL, adminToken, "metrics-second@example.com", "Metrics Second")
	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Metrics Shop"}, http.StatusCreated, &shop)
	for _, agent := range []User{firstAgent, secondAgent} {
		requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: agent.ID}, http.StatusCreated, nil)
	}
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat, Status: SourceStatusActive}, http.StatusCreated, &source)
	conversation, err := store.CreateConversation(context.Background(), Conversation{ShopID: shop.ID, SourceID: source.ID})
	if err != nil {
		t.Fatal(err)
	}
	// Keep the synthetic reply within Shanghai today, including runs near midnight.
	todayStart, _ := shanghaiDayBounds(time.Now().UTC())
	replyAt := todayStart.Add(12 * time.Hour)
	customerAt := replyAt.Add(-time.Minute)
	if _, _, err := store.AddMessage(context.Background(), Message{ConversationID: conversation.ID, Direction: MessageDirectionCustomer, Body: "Need help", CreatedAt: customerAt}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ClaimConversation(context.Background(), conversation.ID, firstAgent.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.AddAgentMessage(context.Background(), Message{ConversationID: conversation.ID, Body: "Handled by first agent", CreatedAt: replyAt}, firstAgent.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.UpdateConversation(context.Background(), conversation.ID, ConversationUpdate{SetAssignedAgentID: true, AssignedAgentID: secondAgent.ID}); err != nil {
		t.Fatal(err)
	}

	var metrics responseMetricsResponse
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/monitor/response-metrics?shopId="+url.QueryEscape(shop.ID), adminToken, nil, http.StatusOK, &metrics)
	var firstMetric *responseMetric
	for index := range metrics.Metrics {
		if metrics.Metrics[index].UserID == firstAgent.ID {
			firstMetric = &metrics.Metrics[index]
			break
		}
	}
	if firstMetric == nil || firstMetric.ResponseCount != 1 || firstMetric.ConversationCount != 1 {
		t.Fatalf("transferred response was not attributed to the replying agent: %#v", metrics.Metrics)
	}
}

func TestMonitorExcludesAdminsFromPersonnelStatsButKeepsBusinessVolume(t *testing.T) {
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	agent := createTestAgent(t, server.URL, adminToken, "business-agent@example.com", "Business Agent")
	var supportAdmin User
	adminPermissions := append(defaultPermissionsForRole(UserRoleAdmin), PermissionWorkbenchAccess)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email: "support-admin@example.com", DisplayName: "Support Admin", Password: "admin-password",
		Role: UserRoleAdmin, PermissionsCustomized: true, Permissions: adminPermissions,
	}, http.StatusCreated, &supportAdmin)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Business Volume Shop"}, http.StatusCreated, &shop)
	for _, user := range []User{agent, supportAdmin} {
		requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: user.ID}, http.StatusCreated, nil)
	}
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{
		Type: SourceTypeShopifyChat, Status: SourceStatusActive,
	}, http.StatusCreated, &source)

	now := time.Now().UTC()
	agentConversation, err := store.CreateConversation(context.Background(), Conversation{ShopID: shop.ID, SourceID: source.ID})
	if err != nil {
		t.Fatal(err)
	}
	// The metric uses the reply's Shanghai date, not a rolling time window.
	// Anchor this synthetic sample inside today instead of subtracting from now.
	todayStart, _ := shanghaiDayBounds(now)
	agentReplyAt := todayStart.Add(12 * time.Hour)
	agentCustomerAt := agentReplyAt.Add(-time.Minute)
	if _, _, err := store.AddMessage(context.Background(), Message{
		ConversationID: agentConversation.ID, Direction: MessageDirectionCustomer, Body: "Agent question", CreatedAt: agentCustomerAt,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ClaimConversation(context.Background(), agentConversation.ID, agent.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.AddAgentMessage(context.Background(), Message{
		ConversationID: agentConversation.ID, Body: "Agent answer", CreatedAt: agentReplyAt,
	}, agent.ID); err != nil {
		t.Fatal(err)
	}

	adminCustomerAt := now.Add(-2 * time.Hour)
	adminConversation, err := store.CreateConversation(context.Background(), Conversation{
		ShopID: shop.ID, SourceID: source.ID, LastMessageAt: adminCustomerAt,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.AddMessage(context.Background(), Message{
		ConversationID: adminConversation.ID, Direction: MessageDirectionCustomer, Body: "Admin question", CreatedAt: adminCustomerAt,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ClaimConversation(context.Background(), adminConversation.ID, supportAdmin.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.AddAgentMessage(context.Background(), Message{
		ConversationID: adminConversation.ID, Body: "Admin answer", CreatedAt: adminCustomerAt.Add(time.Hour),
	}, supportAdmin.ID); err != nil {
		t.Fatal(err)
	}

	createTestConversation(t, store, shop.ID, source.ID, ConversationStatusClosed, supportAdmin.ID, "Admin closed")
	createTestConversation(t, store, shop.ID, source.ID, ConversationStatusOpen, "", "Shared queue")

	var overview monitorOverviewResponse
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/monitor/overview?shopId="+url.QueryEscape(shop.ID), adminToken, nil, http.StatusOK, &overview)
	if overview.Totals.Agents != 1 || overview.Totals.Assigned != 2 || overview.Totals.Queued != 1 || overview.Totals.ClosedToday != 1 || overview.Totals.Anomaly != 1 {
		t.Fatalf("business totals must retain admin-handled conversations: %#v", overview.Totals)
	}
	if len(overview.AgentOptions) != 1 || overview.AgentOptions[0].ID != agent.ID {
		t.Fatalf("administrator leaked into agent filter: %#v", overview.AgentOptions)
	}
	if len(overview.Agents) != 1 || overview.Agents[0].ID != agent.ID || overview.Agents[0].Assigned != 1 || overview.Agents[0].Anomaly != 0 {
		t.Fatalf("administrator leaked into personnel statistics: %#v", overview.Agents)
	}
	if len(overview.Shops) != 1 || overview.Shops[0].Assigned != 2 || overview.Shops[0].ClosedToday != 1 || overview.Shops[0].Anomaly != 1 {
		t.Fatalf("shop totals lost admin-handled conversations: %#v", overview.Shops)
	}
	if len(overview.Shops[0].AgentNames) != 1 || overview.Shops[0].AgentNames[0] != agent.DisplayName {
		t.Fatalf("administrator leaked into responsible-agent names: %#v", overview.Shops[0].AgentNames)
	}

	var metrics responseMetricsResponse
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/monitor/response-metrics?shopId="+url.QueryEscape(shop.ID), adminToken, nil, http.StatusOK, &metrics)
	if len(metrics.Metrics) != 1 || metrics.Metrics[0].UserID != agent.ID || metrics.Metrics[0].ResponseCount != 1 {
		t.Fatalf("administrator reply leaked into response metrics: %#v", metrics)
	}
	if metrics.AverageResponseSec != 60 || metrics.FirstResponseSec != 60 {
		t.Fatalf("administrator reply changed aggregate response duration: %#v", metrics)
	}

	requestJSON(t, http.MethodGet, server.URL+"/api/v1/monitor/conversations?agentId="+url.QueryEscape(supportAdmin.ID), adminToken, nil, http.StatusBadRequest, nil)
}

func TestUserSkillGroupDefaultsAndAdminExclusion(t *testing.T) {
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	agent := createTestAgent(t, server.URL, adminToken, "default-skill@example.com", "Default Skill")
	if agent.SkillGroup != SkillGroupConsulting {
		t.Fatalf("expected default skill group %q, got %#v", SkillGroupConsulting, agent)
	}
	afterSales := SkillGroupAfterSales
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/users/"+agent.ID, adminToken, updateUserRequest{SkillGroup: &afterSales}, http.StatusOK, &agent)
	if agent.SkillGroup != SkillGroupAfterSales {
		t.Fatalf("expected updated skill group, got %#v", agent)
	}
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/users/"+agent.ID, adminToken, updateUserRequest{Role: UserRoleAdmin}, http.StatusOK, &agent)
	if agent.SkillGroup != "" {
		t.Fatalf("administrator should not have a skill group: %#v", agent)
	}
}

func TestShanghaiCalendarBoundaries(t *testing.T) {
	start, err := parseRecordDate("2026-07-24", false)
	if err != nil {
		t.Fatalf("parse start date: %v", err)
	}
	end, err := parseRecordDate("2026-07-24", true)
	if err != nil {
		t.Fatalf("parse end date: %v", err)
	}
	if got := start.UTC(); !got.Equal(time.Date(2026, 7, 23, 16, 0, 0, 0, time.UTC)) {
		t.Fatalf("unexpected Shanghai day start: %s", got)
	}
	if got := end.UTC(); !got.Equal(time.Date(2026, 7, 24, 15, 59, 59, int(time.Second-time.Nanosecond), time.UTC)) {
		t.Fatalf("unexpected Shanghai day end: %s", got)
	}
	monitorStart, monitorEnd := shanghaiDayBounds(time.Date(2026, 7, 24, 12, 0, 0, 0, time.UTC))
	if !monitorStart.UTC().Equal(time.Date(2026, 7, 23, 16, 0, 0, 0, time.UTC)) ||
		!monitorEnd.UTC().Equal(time.Date(2026, 7, 24, 16, 0, 0, 0, time.UTC)) {
		t.Fatalf("unexpected monitor day bounds: %s - %s", monitorStart, monitorEnd)
	}
}

func TestShanghaiDayBoundsAroundMidnight(t *testing.T) {
	for _, test := range []struct {
		name  string
		now   string
		start string
		end   string
	}{
		{"before midnight", "2026-09-05T23:59:59.999999999+08:00", "2026-09-04T16:00:00Z", "2026-09-05T16:00:00Z"},
		{"at midnight", "2026-09-06T00:00:00+08:00", "2026-09-05T16:00:00Z", "2026-09-06T16:00:00Z"},
		{"previous failing time", "2026-09-06T00:05:00+08:00", "2026-09-05T16:00:00Z", "2026-09-06T16:00:00Z"},
		{"UTC input", "2026-09-05T16:05:00Z", "2026-09-05T16:00:00Z", "2026-09-06T16:00:00Z"},
		{"month boundary", "2026-10-01T00:00:00+08:00", "2026-09-30T16:00:00Z", "2026-10-01T16:00:00Z"},
		{"year boundary", "2027-01-01T00:00:00+08:00", "2026-12-31T16:00:00Z", "2027-01-01T16:00:00Z"},
		{"leap day", "2028-02-29T23:59:59.999999999+08:00", "2028-02-28T16:00:00Z", "2028-02-29T16:00:00Z"},
	} {
		t.Run(test.name, func(t *testing.T) {
			now, err := time.Parse(time.RFC3339Nano, test.now)
			if err != nil {
				t.Fatal(err)
			}
			start, end := shanghaiDayBounds(now)
			if start.UTC().Format(time.RFC3339Nano) != test.start || end.UTC().Format(time.RFC3339Nano) != test.end {
				t.Fatalf("unexpected Shanghai bounds for %s: %s - %s", test.now, start, end)
			}
			if now.Before(start) || !now.Before(end) || end.Sub(start) != 24*time.Hour {
				t.Fatalf("day must contain now in [start, end): %s - %s; now=%s", start, end, now)
			}
		})
	}
}
