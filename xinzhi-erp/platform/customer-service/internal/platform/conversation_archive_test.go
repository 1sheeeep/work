package platform

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

func TestClosedConversationArchiveUsesRealTotalAndUnboundedPagination(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Archive Store"})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{
		ShopID: shop.ID, Type: SourceTypeShopifyChat, Provider: "xzdesk_widget", Address: "archive.myshopify.com",
	})
	if err != nil {
		t.Fatal(err)
	}

	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)
	var agent User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email: "archive-agent@example.com", DisplayName: "Archive Agent", Password: "agent-password", Role: UserRoleAgent,
	}, http.StatusCreated, &agent)
	if _, err := store.AssignUserToShop(ctx, shop.ID, agent.ID); err != nil {
		t.Fatal(err)
	}

	baseTime := time.Now().UTC().Add(-24 * time.Hour)
	for index := 0; index < 205; index++ {
		_, err := store.CreateConversation(ctx, Conversation{
			ShopID: shop.ID, SourceID: source.ID, CustomerName: fmt.Sprintf("Archived Customer %03d", index),
			CustomerEmail: fmt.Sprintf("customer-%03d@example.com", index), Subject: fmt.Sprintf("Archive case %03d", index),
			Status: ConversationStatusClosed, AssignedAgentID: agent.ID, Kind: ConversationKindCustomer, ReplyAllowed: true,
			LastMessageAt: baseTime.Add(time.Duration(index) * time.Minute), ClosedAt: baseTime.Add(time.Duration(index) * time.Minute),
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	if _, err := store.CreateConversation(ctx, Conversation{
		ShopID: shop.ID, SourceID: source.ID, CustomerName: "Automated Store Sender", CustomerEmail: "store+123@notice.shopifyemail.com",
		Subject: "Discarded sender", Status: ConversationStatusClosed, AssignedAgentID: agent.ID, Kind: ConversationKindCustomer,
	}); err != nil {
		t.Fatal(err)
	}

	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email: "archive-agent@example.com", Password: "agent-password",
	}, http.StatusOK, &login)
	type pageResponse struct {
		Items      []Conversation `json:"items"`
		Page       int            `json:"page"`
		PageSize   int            `json:"pageSize"`
		Total      int            `json:"total"`
		TotalPages int            `json:"totalPages"`
	}
	var first pageResponse
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations?includeTotal=true&status=closed&scope=assigned&page=1&pageSize=100", login.Token, nil, http.StatusOK, &first)
	if first.Total != 205 || first.TotalPages != 3 || len(first.Items) != 100 {
		t.Fatalf("first archive page was capped or counted incorrectly: %#v", first)
	}
	var last pageResponse
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations?includeTotal=true&status=closed&scope=assigned&page=3&pageSize=100", login.Token, nil, http.StatusOK, &last)
	if last.Total != 205 || len(last.Items) != 5 {
		t.Fatalf("last archive page was not reachable: %#v", last)
	}
	var searched pageResponse
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations?includeTotal=true&status=closed&scope=assigned&page=1&pageSize=100&search="+url.QueryEscape("Archived Customer 204"), login.Token, nil, http.StatusOK, &searched)
	if searched.Total != 1 || len(searched.Items) != 1 || searched.Items[0].CustomerName != "Archived Customer 204" {
		t.Fatalf("archive search did not cover all pages: %#v", searched)
	}
	var legacy []Conversation
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations?scope=assigned&page=1&pageSize=10", login.Token, nil, http.StatusOK, &legacy)
	if len(legacy) != 10 {
		t.Fatalf("legacy conversation list response changed unexpectedly: %d", len(legacy))
	}
	assigned, err := store.CreateConversation(ctx, Conversation{
		ShopID: shop.ID, SourceID: source.ID, CustomerName: "Active Customer", CustomerEmail: "active@example.com",
		Subject: "Active case", Status: ConversationStatusAssigned, AssignedAgentID: agent.ID, Kind: ConversationKindCustomer, ReplyAllowed: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	queued, err := store.CreateConversation(ctx, Conversation{
		ShopID: shop.ID, SourceID: source.ID, CustomerName: "Queued Customer", CustomerEmail: "queued@example.com",
		Subject: "Queued case", Status: ConversationStatusOpen, Kind: ConversationKindCustomer, ReplyAllowed: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateConversation(ctx, Conversation{
		ShopID: shop.ID, SourceID: source.ID, CustomerName: "Imported Customer", CustomerEmail: "imported@example.com",
		Subject: "Imported case", Status: ConversationStatusAssigned, AssignedAgentID: agent.ID, Kind: ConversationKindCustomer,
		Classification: historicalEmailClassification + "normal conversation",
	}); err != nil {
		t.Fatal(err)
	}
	var active []Conversation
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations?scope=assigned&activeOnly=true&page=1&pageSize=10", login.Token, nil, http.StatusOK, &active)
	if len(active) != 2 || active[0].ID == "" || active[1].ID == "" {
		t.Fatalf("active workbench list mixed in closed or historical records: %#v", active)
	}
	activeIDs := map[string]bool{active[0].ID: true, active[1].ID: true}
	if !activeIDs[assigned.ID] || !activeIDs[queued.ID] {
		t.Fatalf("active workbench list omitted active records: %#v", active)
	}
	var summary conversationSummaryResponse
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations/summary?scope=assigned", login.Token, nil, http.StatusOK, &summary)
	if summary.Assigned != 1 || summary.Open != 1 || summary.Closed != 205 || summary.ActiveLoad != 1 || summary.Capacity != defaultAgentCapacity {
		t.Fatalf("workbench summary did not use the effective routing scope: %#v", summary)
	}
	if summary.RoutingReasons[queued.ID] != RoutingReasonAgentsDisconnected {
		t.Fatalf("queued conversation reason = %q, want %q", summary.RoutingReasons[queued.ID], RoutingReasonAgentsDisconnected)
	}
}
