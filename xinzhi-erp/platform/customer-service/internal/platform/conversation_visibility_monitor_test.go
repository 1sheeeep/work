package platform

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestWorkbenchConversationVisibilityHidesOtherAgentsConversations(t *testing.T) {
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	agentA := createTestAgent(t, server.URL, adminToken, "agent-a@example.com", "Agent A")
	agentB := createTestAgent(t, server.URL, adminToken, "agent-b@example.com", "Agent B")
	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Shared Shop"}, http.StatusCreated, &shop)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: agentA.ID}, http.StatusCreated, nil)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: agentB.ID}, http.StatusCreated, nil)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat}, http.StatusCreated, &source)

	queue := createTestConversation(t, store, shop.ID, source.ID, ConversationStatusOpen, "", "Queue")
	ownAssigned := createTestConversation(t, store, shop.ID, source.ID, ConversationStatusAssigned, agentA.ID, "Own assigned")
	otherAssigned := createTestConversation(t, store, shop.ID, source.ID, ConversationStatusAssigned, agentB.ID, "Other assigned")
	ownClosed := createTestConversation(t, store, shop.ID, source.ID, ConversationStatusClosed, agentA.ID, "Own closed")
	otherClosed := createTestConversation(t, store, shop.ID, source.ID, ConversationStatusClosed, agentB.ID, "Other closed")
	if _, _, err := store.AddMessage(context.Background(), Message{
		ConversationID: otherAssigned.ID,
		Direction:      MessageDirectionCustomer,
		Body:           "Private conversation for Agent B",
	}); err != nil {
		t.Fatalf("add private message: %v", err)
	}

	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email: "agent-a@example.com", Password: "agent-password",
	}, http.StatusOK, &login)

	var conversations []Conversation
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations?scope=assigned", login.Token, nil, http.StatusOK, &conversations)
	assertConversationIDs(t, conversations, queue.ID, ownAssigned.ID, ownClosed.ID)
	assertConversationIDsAbsent(t, conversations, otherAssigned.ID, otherClosed.ID)

	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations/"+otherAssigned.ID+"/messages", login.Token, nil, http.StatusForbidden, nil)

	if _, err := store.CreateTransferRequest(context.Background(), TransferRequest{
		ConversationID: otherAssigned.ID,
		ShopID:         shop.ID,
		FromAgentID:    agentB.ID,
		TargetAgentID:  agentA.ID,
	}); err != nil {
		t.Fatalf("create transfer request: %v", err)
	}
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations?scope=assigned", login.Token, nil, http.StatusOK, &conversations)
	assertConversationIDs(t, conversations, queue.ID, ownAssigned.ID, ownClosed.ID, otherAssigned.ID)
}

func TestMonitorConversationEndpointsAreAdminOnlyAndPaginated(t *testing.T) {
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	agent := createTestAgent(t, server.URL, adminToken, "monitor-agent@example.com", "Monitor Agent")
	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Monitor Shop"}, http.StatusCreated, &shop)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: agent.ID}, http.StatusCreated, nil)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{
		Type: SourceTypeEmail, Provider: "outlook", Address: "monitor@example.com", Status: SourceStatusActive,
	}, http.StatusCreated, &source)

	first := createTestConversation(t, store, shop.ID, source.ID, ConversationStatusAssigned, agent.ID, "Order one")
	createTestConversation(t, store, shop.ID, source.ID, ConversationStatusOpen, "", "Order two")
	createTestConversation(t, store, shop.ID, source.ID, ConversationStatusClosed, agent.ID, "Order three")
	if _, _, err := store.AddMessage(context.Background(), Message{
		ConversationID: first.ID,
		Direction:      MessageDirectionCustomer,
		Body:           "Where is my order?",
	}); err != nil {
		t.Fatalf("add monitor message: %v", err)
	}

	requestJSON(t, http.MethodGet, server.URL+"/api/v1/monitor/conversations", adminToken, nil, http.StatusBadRequest, nil)

	var overview monitorOverviewResponse
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/monitor/overview?shopId="+shop.ID, adminToken, nil, http.StatusOK, &overview)
	if overview.Totals.Agents != 1 || overview.Totals.Shops != 1 || overview.Totals.Queued != 1 || overview.Totals.Assigned != 1 {
		t.Fatalf("unexpected monitor overview totals: %#v", overview.Totals)
	}
	if len(overview.AgentOptions) != 1 || overview.AgentOptions[0].ID != agent.ID {
		t.Fatalf("shop filter should only expose assigned agents: %#v", overview.AgentOptions)
	}
	var monitoredAgent *monitorOverviewAgent
	for index := range overview.Agents {
		if overview.Agents[index].ID == agent.ID {
			monitoredAgent = &overview.Agents[index]
			break
		}
	}
	if monitoredAgent == nil || monitoredAgent.Assigned != 1 || monitoredAgent.Queued != 1 {
		t.Fatalf("unexpected monitor agent overview: %#v", overview.Agents)
	}
	if len(overview.Shops) != 1 || overview.Shops[0].ID != shop.ID || !overview.Shops[0].EmailReady {
		t.Fatalf("unexpected monitor shop overview: %#v", overview.Shops)
	}

	query := url.Values{"shopId": {shop.ID}, "pageSize": {"2"}, "page": {"1"}}
	var page monitorConversationPage
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/monitor/conversations?"+query.Encode(), adminToken, nil, http.StatusOK, &page)
	if page.Total != 3 || len(page.Items) != 2 || page.Page != 1 || page.PageSize != 2 {
		t.Fatalf("unexpected monitor page: %#v", page)
	}
	if page.Summary.Open != 1 || page.Summary.Assigned != 1 || page.Summary.Closed != 1 {
		t.Fatalf("unexpected monitor summary: %#v", page.Summary)
	}
	for _, item := range page.Items {
		if item.ShopName != shop.DisplayName || item.SourceType != "email" {
			t.Fatalf("monitor item context missing: %#v", item)
		}
	}

	agentQuery := url.Values{"agentId": {agent.ID}}
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/monitor/conversations?"+agentQuery.Encode(), adminToken, nil, http.StatusOK, &page)
	if page.Total != 2 {
		t.Fatalf("expected assigned and closed conversations for agent filter, got %#v", page)
	}
	for _, item := range page.Items {
		if item.AssignedAgentID != agent.ID {
			t.Fatalf("agent filter returned another assignee: %#v", item)
		}
	}

	combinedQuery := url.Values{"shopId": {shop.ID}, "agentId": {agent.ID}, "status": {ConversationStatusAssigned}}
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/monitor/conversations?"+combinedQuery.Encode(), adminToken, nil, http.StatusOK, &page)
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].ID != first.ID {
		t.Fatalf("combined shop and agent filter returned unexpected page: %#v", page)
	}

	var messages []Message
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/monitor/conversations/"+first.ID+"/messages", adminToken, nil, http.StatusOK, &messages)
	if len(messages) != 1 || messages[0].Body != "Where is my order?" {
		t.Fatalf("unexpected monitor messages: %#v", messages)
	}

	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email: "monitor-agent@example.com", Password: "agent-password",
	}, http.StatusOK, &login)
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/monitor/conversations?"+query.Encode(), login.Token, nil, http.StatusForbidden, nil)
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/monitor/conversations/"+first.ID+"/messages", login.Token, nil, http.StatusForbidden, nil)
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/monitor/overview?shopId="+shop.ID, login.Token, nil, http.StatusForbidden, nil)
}

func createTestAgent(t *testing.T, serverURL string, adminToken string, email string, name string) User {
	t.Helper()
	var agent User
	requestJSON(t, http.MethodPost, serverURL+"/api/v1/users", adminToken, createUserRequest{
		Email:       email,
		DisplayName: name,
		Password:    "agent-password",
		Role:        UserRoleAgent,
	}, http.StatusCreated, &agent)
	return agent
}

func createTestConversation(t *testing.T, store Store, shopID string, sourceID string, status string, agentID string, subject string) Conversation {
	t.Helper()
	conversation, err := store.CreateConversation(context.Background(), Conversation{
		ShopID:          shopID,
		SourceID:        sourceID,
		CustomerName:    subject,
		Subject:         subject,
		Status:          status,
		AssignedAgentID: agentID,
	})
	if err != nil {
		t.Fatalf("create conversation %q: %v", subject, err)
	}
	return conversation
}

func assertConversationIDs(t *testing.T, conversations []Conversation, expected ...string) {
	t.Helper()
	actual := map[string]bool{}
	for _, conversation := range conversations {
		actual[conversation.ID] = true
	}
	for _, id := range expected {
		if !actual[id] {
			t.Fatalf("expected conversation %s in %#v", id, conversations)
		}
	}
	if len(actual) != len(expected) {
		t.Fatalf("unexpected conversations: %#v", conversations)
	}
}

func assertConversationIDsAbsent(t *testing.T, conversations []Conversation, unexpected ...string) {
	t.Helper()
	actual := map[string]bool{}
	for _, conversation := range conversations {
		actual[conversation.ID] = true
	}
	for _, id := range unexpected {
		if actual[id] {
			t.Fatalf("conversation %s must be hidden: %#v", id, conversations)
		}
	}
}
