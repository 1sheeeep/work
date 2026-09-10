package platform

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

func TestHistoricalStatisticsViewsAndAdminExclusion(t *testing.T) {
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	agent := createTestAgent(t, server.URL, adminToken, "history-agent@example.com", "History Agent")
	var supportAdmin User
	adminPermissions := append(defaultPermissionsForRole(UserRoleAdmin), PermissionWorkbenchAccess)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email: "history-admin@example.com", DisplayName: "History Admin", Password: "admin-password",
		Role: UserRoleAdmin, PermissionsCustomized: true, Permissions: adminPermissions,
	}, http.StatusCreated, &supportAdmin)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "History Shop"}, http.StatusCreated, &shop)
	for _, user := range []User{agent, supportAdmin} {
		requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: user.ID}, http.StatusCreated, nil)
	}
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{
		Type: SourceTypeShopifyChat, Status: SourceStatusActive,
	}, http.StatusCreated, &source)

	agentClosed := createHistoricalConversation(t, store, shop.ID, source.ID, agent.ID, "customer@example.com", time.Minute, true)
	if _, err := store.UpdateConversation(context.Background(), agentClosed.ID, ConversationUpdate{
		SetRecord: true, RecordPrimary: "已发货", RecordSecondary: "物流查询", RecordTertiary: "轨迹正常",
		RecordClassified: true, RecordUpdatedBy: agent.ID,
	}); err != nil {
		t.Fatal(err)
	}
	createTestConversationWithCustomer(t, store, shop.ID, source.ID, ConversationStatusAssigned, agent.ID, "customer@example.com", "Repeat customer")
	createHistoricalConversation(t, store, shop.ID, source.ID, supportAdmin.ID, "admin-customer@example.com", 10*time.Minute, true)

	date := time.Now().In(shanghaiLocation()).Format("2006-01-02")
	baseQuery := url.Values{"startDate": {date}, "endDate": {date}, "shopId": {shop.ID}}
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/statistics?"+baseQuery.Encode(), adminToken, nil, http.StatusBadRequest, nil)

	var conversationStats historicalStatisticsResponse
	query := cloneURLValues(baseQuery)
	query.Set("view", statisticsConversation)
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/statistics?"+query.Encode(), adminToken, nil, http.StatusOK, &conversationStats)
	if metricValue(conversationStats.Summary, "created") != 3 || metricValue(conversationStats.Summary, "handled") != 3 || metricValue(conversationStats.Summary, "closed") != 2 {
		t.Fatalf("conversation business volume lost admin-handled data: %#v", conversationStats.Summary)
	}
	if metricValue(conversationStats.Summary, "firstResponse") != 60 {
		t.Fatalf("administrator response changed conversation response metric: %#v", conversationStats.Summary)
	}

	var customerStats historicalStatisticsResponse
	query.Set("view", statisticsCustomer)
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/statistics?"+query.Encode(), adminToken, nil, http.StatusOK, &customerStats)
	if metricValue(customerStats.Summary, "customers") != 2 || metricValue(customerStats.Summary, "repeat") != 1 || metricValue(customerStats.Summary, "conversations") != 3 {
		t.Fatalf("unexpected customer de-duplication: %#v", customerStats.Summary)
	}

	var agentStats historicalStatisticsResponse
	query.Set("view", statisticsAgent)
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/statistics?"+query.Encode(), adminToken, nil, http.StatusOK, &agentStats)
	if len(agentStats.Breakdown) != 1 || agentStats.Breakdown[0].ID != agent.ID {
		t.Fatalf("administrator leaked into agent statistics: %#v", agentStats.Breakdown)
	}
	if metricValue(agentStats.Summary, "handled") != 1 || metricValue(agentStats.Summary, "closed") != 1 {
		t.Fatalf("unexpected agent statistics: %#v", agentStats.Summary)
	}

	var skillStats historicalStatisticsResponse
	query.Set("view", statisticsSkillGroup)
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/statistics?"+query.Encode(), adminToken, nil, http.StatusOK, &skillStats)
	if len(skillStats.Breakdown) != 2 || skillStats.Breakdown[0].ID != SkillGroupConsulting {
		t.Fatalf("unexpected skill group statistics: %#v", skillStats.Breakdown)
	}

	var serviceStats historicalStatisticsResponse
	query.Set("view", statisticsService)
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/statistics?"+query.Encode(), adminToken, nil, http.StatusOK, &serviceStats)
	if metricValue(serviceStats.Summary, "closed") != 2 || metricValue(serviceStats.Summary, "classified") != 1 || metricValue(serviceStats.Summary, "unclassified") != 1 {
		t.Fatalf("unexpected service summary statistics: %#v", serviceStats.Summary)
	}
	if len(serviceStats.Breakdown) != 1 || serviceStats.Breakdown[0].Name != "已发货" || serviceStats.Breakdown[0].Secondary != "物流查询 · 轨迹正常" {
		t.Fatalf("three-level service category was not preserved: %#v", serviceStats.Breakdown)
	}

	var slaStats historicalStatisticsResponse
	query.Set("view", statisticsSLA)
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/statistics?"+query.Encode(), adminToken, nil, http.StatusOK, &slaStats)
	if slaStats.SLASettings == nil || slaStats.SLASettings.FirstResponseMinutes != 30 {
		t.Fatalf("default SLA settings missing: %#v", slaStats.SLASettings)
	}
	if metricValue(slaStats.Summary, "firstSLA") != 100 {
		t.Fatalf("administrator reply should not enter SLA response performance: %#v", slaStats.Summary)
	}

	var saved SLASettings
	requestJSON(t, http.MethodPut, server.URL+"/api/v1/settings/sla", adminToken, SLASettings{
		FirstResponseMinutes: 1, ResponseMinutes: 2, ResolutionMinutes: 60,
	}, http.StatusOK, &saved)
	if saved.FirstResponseMinutes != 1 || saved.ResponseMinutes != 2 || saved.ResolutionMinutes != 60 {
		t.Fatalf("SLA settings were not saved: %#v", saved)
	}
}

func TestHistoricalStatisticsExport(t *testing.T) {
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	date := time.Now().In(shanghaiLocation()).Format("2006-01-02")
	query := url.Values{"view": {statisticsConversation}, "startDate": {date}, "endDate": {date}}
	request, err := http.NewRequest(http.MethodGet, server.URL+"/api/v1/statistics/export?"+query.Encode(), nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+adminToken)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("unexpected export status: %d", response.StatusCode)
	}
	if contentType := response.Header.Get("Content-Type"); contentType != "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" {
		t.Fatalf("unexpected export content type: %q", contentType)
	}
	buffer := make([]byte, 2)
	if _, err := response.Body.Read(buffer); err != nil {
		t.Fatal(err)
	}
	if string(buffer) != "PK" {
		t.Fatalf("export is not an XLSX zip: %q", string(buffer))
	}
}

func createHistoricalConversation(t *testing.T, store Store, shopID, sourceID, assigneeID, email string, responseAfter time.Duration, closeConversation bool) Conversation {
	t.Helper()
	conversation, err := store.CreateConversation(context.Background(), Conversation{
		ShopID: shopID, SourceID: sourceID, CustomerName: email, CustomerEmail: email,
	})
	if err != nil {
		t.Fatal(err)
	}
	customerAt := conversation.CreatedAt
	if _, _, err := store.AddMessage(context.Background(), Message{
		ConversationID: conversation.ID, Direction: MessageDirectionCustomer, Body: "Need help", CreatedAt: customerAt,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ClaimConversation(context.Background(), conversation.ID, assigneeID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.AddAgentMessage(context.Background(), Message{
		ConversationID: conversation.ID, Body: "Resolved", CreatedAt: customerAt.Add(responseAfter),
	}, assigneeID); err != nil {
		t.Fatal(err)
	}
	if closeConversation {
		conversation, err = store.CloseConversation(context.Background(), conversation.ID, assigneeID)
		if err != nil {
			t.Fatal(err)
		}
	}
	return conversation
}

func createTestConversationWithCustomer(t *testing.T, store Store, shopID, sourceID, status, agentID, email, subject string) Conversation {
	t.Helper()
	conversation, err := store.CreateConversation(context.Background(), Conversation{
		ShopID: shopID, SourceID: sourceID, CustomerName: subject, CustomerEmail: email,
		Status: status, AssignedAgentID: agentID, Subject: subject,
	})
	if err != nil {
		t.Fatal(err)
	}
	return conversation
}

func metricValue(items []historicalStatMetric, key string) float64 {
	for _, item := range items {
		if item.Key == key {
			return item.Value
		}
	}
	return -1
}

func cloneURLValues(input url.Values) url.Values {
	out := url.Values{}
	for key, values := range input {
		out[key] = append([]string(nil), values...)
	}
	return out
}
