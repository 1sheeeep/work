package platform

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

type routingSnapshotStore struct {
	Store
	mu        sync.Mutex
	blockNext bool
	started   chan struct{}
	release   chan struct{}
}

func (s *routingSnapshotStore) blockNextConversationList() (<-chan struct{}, chan<- struct{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.blockNext = true
	s.started = make(chan struct{})
	s.release = make(chan struct{})
	return s.started, s.release
}

func (s *routingSnapshotStore) ListConversations(ctx context.Context, filter ConversationFilter) ([]Conversation, error) {
	items, err := s.Store.ListConversations(ctx, filter)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	if !s.blockNext {
		s.mu.Unlock()
		return items, nil
	}
	s.blockNext = false
	started, release := s.started, s.release
	close(started)
	s.mu.Unlock()
	select {
	case <-release:
		return items, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (s *routingSnapshotStore) CustomerConversationLoads(ctx context.Context) (map[string]int, error) {
	conversations, err := s.Store.ListConversations(ctx, ConversationFilter{})
	if err != nil {
		return nil, err
	}
	loads := map[string]int{}
	for _, conversation := range conversations {
		if conversation.Status == ConversationStatusAssigned && conversation.AssignedAgentID != "" && isCustomerConversation(conversation) {
			loads[conversation.AssignedAgentID]++
		}
	}
	return loads, nil
}

func TestAutomaticRoutingRespectsCapacityAndRefillsAfterClose(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	agents := make([]User, 2)
	tokens := map[string]string{}
	connections := make([]*websocket.Conn, 0, 2)
	for index := range agents {
		email := "routing-agent-" + string(rune('a'+index)) + "@example.com"
		requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
			Email:          email,
			DisplayName:    "Routing Agent",
			Password:       "agent-password",
			Role:           UserRoleAgent,
			ReceptionLimit: 1,
		}, http.StatusCreated, &agents[index])
		var login AuthResult
		requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{Email: email, Password: "agent-password"}, http.StatusOK, &login)
		tokens[agents[index].ID] = login.Token
	}

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Routing Shop"}, http.StatusCreated, &shop)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat}, http.StatusCreated, &source)
	for _, agent := range agents {
		requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: agent.ID}, http.StatusCreated, nil)
		conn := dialEventWebSocket(t, server.URL, tokens[agent.ID])
		connections = append(connections, conn)
		defer conn.Close()
	}

	for index := 0; index < 3; index++ {
		requestJSON(t, http.MethodPost, server.URL+"/api/v1/ingest/conversations", adminToken, ingestConversationRequest{
			ShopID:                 shop.ID,
			SourceID:               source.ID,
			ExternalConversationID: "routing-conversation-" + string(rune('a'+index)),
			Messages: []ingestMessage{{
				Direction: MessageDirectionCustomer,
				Body:      "Customer needs help",
			}},
		}, http.StatusOK, nil)
	}

	var conversations []Conversation
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations", adminToken, nil, http.StatusOK, &conversations)
	assigned := []Conversation{}
	open := []Conversation{}
	for _, conversation := range conversations {
		switch conversation.Status {
		case ConversationStatusAssigned:
			assigned = append(assigned, conversation)
		case ConversationStatusOpen:
			open = append(open, conversation)
		}
	}
	if len(assigned) != 2 || len(open) != 1 {
		t.Fatalf("expected two assigned conversations and one queued conversation, got assigned=%#v open=%#v", assigned, open)
	}

	closing := assigned[0]
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+closing.ID+"/close", tokens[closing.AssignedAgentID], nil, http.StatusOK, nil)

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations", adminToken, nil, http.StatusOK, &conversations)
		assignedCount := 0
		openCount := 0
		closedCount := 0
		for _, conversation := range conversations {
			switch conversation.Status {
			case ConversationStatusAssigned:
				assignedCount++
			case ConversationStatusOpen:
				openCount++
			case ConversationStatusClosed:
				closedCount++
			}
		}
		if assignedCount == 2 && openCount == 0 && closedCount == 1 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("queued conversation was not automatically assigned after capacity was freed: %#v", conversations)
}

func TestAutomaticRoutingRerunsWhenTriggeredDuringActiveFill(t *testing.T) {
	baseStore := NewMemoryStore()
	store := &routingSnapshotStore{Store: baseStore}
	app := NewServer(store)
	server := httptest.NewServer(app.Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var agent User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email: "routing-rerun-agent@example.com", Password: "agent-password", Role: UserRoleAgent,
		ReceptionLimit: 2,
	}, http.StatusCreated, &agent)
	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email: "routing-rerun-agent@example.com", Password: "agent-password",
	}, http.StatusOK, &login)
	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Routing Rerun Shop"}, http.StatusCreated, &shop)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat}, http.StatusCreated, &source)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: agent.ID}, http.StatusCreated, nil)
	conn := dialEventWebSocket(t, server.URL, login.Token)
	defer conn.Close()

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		app.routingJobsMu.Lock()
		_, running := app.routingJobs[agent.ID]
		app.routingJobsMu.Unlock()
		if !running {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	started, release := store.blockNextConversationList()
	app.fillAgentCapacityAsync(agent.ID)
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("first routing fill did not reach the queued-conversation snapshot")
	}
	conversation, err := baseStore.CreateConversation(t.Context(), Conversation{
		ShopID: shop.ID, SourceID: source.ID, Kind: ConversationKindCustomer,
		CustomerName: "Queued Customer", CustomerEmail: "queued@example.com",
	})
	if err != nil {
		t.Fatalf("create conversation while fill is active: %v", err)
	}
	app.fillAgentCapacityAsync(agent.ID)
	close(release)

	deadline = time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		stored, getErr := baseStore.GetConversation(t.Context(), conversation.ID)
		if getErr != nil {
			t.Fatalf("get rerun conversation: %v", getErr)
		}
		if stored.Status == ConversationStatusAssigned && stored.AssignedAgentID == agent.ID {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	stored, _ := baseStore.GetConversation(t.Context(), conversation.ID)
	t.Fatalf("routing trigger received during an active fill was not rerun: %#v", stored)
}

func TestManualClaimCanExceedReceptionLimitWithoutChangingAutomaticCapacity(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var agent User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email:          "manual-overload-agent@example.com",
		DisplayName:    "Manual Overload Agent",
		Password:       "agent-password",
		Role:           UserRoleAgent,
		ReceptionLimit: 1,
	}, http.StatusCreated, &agent)
	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email:    "manual-overload-agent@example.com",
		Password: "agent-password",
	}, http.StatusOK, &login)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Manual Overload Shop"}, http.StatusCreated, &shop)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat}, http.StatusCreated, &source)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: agent.ID}, http.StatusCreated, nil)

	for index := 0; index < 2; index++ {
		var conversation Conversation
		requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations", adminToken, Conversation{
			ShopID:   shop.ID,
			SourceID: source.ID,
		}, http.StatusCreated, &conversation)
		requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/claim", login.Token, nil, http.StatusOK, nil)
	}

	conn := dialEventWebSocket(t, server.URL, login.Token)
	defer conn.Close()

	requestJSON(t, http.MethodPost, server.URL+"/api/v1/ingest/conversations", adminToken, ingestConversationRequest{
		ShopID:                 shop.ID,
		SourceID:               source.ID,
		ExternalConversationID: "automatic-conversation-after-manual-overload",
		Messages: []ingestMessage{{
			Direction: MessageDirectionCustomer,
			Body:      "Customer needs help",
		}},
	}, http.StatusOK, nil)

	var conversations []Conversation
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations", adminToken, nil, http.StatusOK, &conversations)
	assignedCount := 0
	openCount := 0
	for _, conversation := range conversations {
		switch conversation.Status {
		case ConversationStatusAssigned:
			assignedCount++
		case ConversationStatusOpen:
			openCount++
		}
	}
	if assignedCount != 2 || openCount != 1 {
		t.Fatalf("expected manual overload to keep two assigned and automatic ingress queued, got assigned=%d open=%d conversations=%#v", assignedCount, openCount, conversations)
	}
}

func TestAgentCanUpdateOwnRoutingSettings(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var agent User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email:          "routing-settings-agent@example.com",
		DisplayName:    "Routing Settings Agent",
		Password:       "agent-password",
		Role:           UserRoleAgent,
		ReceptionLimit: 10,
	}, http.StatusCreated, &agent)

	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email:    "routing-settings-agent@example.com",
		Password: "agent-password",
	}, http.StatusOK, &login)

	var updated User
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/auth/me/routing", login.Token, updateUserRequest{
		ReceptionLimit: intPtr(5),
	}, http.StatusOK, &updated)
	if updated.ReceptionLimit != 5 {
		t.Fatalf("expected patched reception limit 5, got %#v", updated)
	}

	var me User
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/auth/me", login.Token, nil, http.StatusOK, &me)
	if me.ReceptionLimit != 5 {
		t.Fatalf("expected /auth/me to return reception limit 5, got %#v", me)
	}
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/auth/me/routing", login.Token, map[string]any{
		"receptionOrder": "latest",
	}, http.StatusOK, &updated)
	if updated.ReceptionLimit != 5 {
		t.Fatalf("legacy reception order input must be ignored without changing the limit, got %#v", updated)
	}

}

func TestAgentReceptionPresenceStopsOnlyNewAssignments(t *testing.T) {
	app := NewServer(NewMemoryStore())
	server := httptest.NewServer(app.Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var agent User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email: "presence-agent@example.com", DisplayName: "Presence Agent", Password: "agent-password",
		Role: UserRoleAgent, ReceptionLimit: 2,
	}, http.StatusCreated, &agent)
	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email: "presence-agent@example.com", Password: "agent-password",
	}, http.StatusOK, &login)
	if !login.User.ReceptionOnline {
		t.Fatalf("explicit login must default the agent to online: %#v", login.User)
	}

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Presence Shop"}, http.StatusCreated, &shop)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat}, http.StatusCreated, &source)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: agent.ID}, http.StatusCreated, nil)

	conn := dialEventWebSocket(t, server.URL, login.Token)
	defer conn.Close()

	ingest := func(externalID string) {
		requestJSON(t, http.MethodPost, server.URL+"/api/v1/ingest/conversations", adminToken, ingestConversationRequest{
			ShopID: shop.ID, SourceID: source.ID, ExternalConversationID: externalID,
			Messages: []ingestMessage{{Direction: MessageDirectionCustomer, Body: "Customer needs help"}},
		}, http.StatusOK, nil)
	}
	ingest("presence-before-offline")

	var presence User
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/auth/me/presence", login.Token, receptionPresenceRequest{Online: false}, http.StatusOK, &presence)
	if presence.ReceptionOnline {
		t.Fatalf("expected manual presence change to persist offline: %#v", presence)
	}
	ingest("presence-while-offline")

	var conversations []Conversation
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations", adminToken, nil, http.StatusOK, &conversations)
	assignedCount, openCount := 0, 0
	for _, conversation := range conversations {
		if conversation.Status == ConversationStatusAssigned && conversation.AssignedAgentID == agent.ID {
			assignedCount++
		}
		if conversation.Status == ConversationStatusOpen && conversation.AssignedAgentID == "" {
			openCount++
		}
	}
	if assignedCount != 1 || openCount != 1 {
		t.Fatalf("offline must preserve existing work and stop only new assignments, assigned=%d open=%d conversations=%#v", assignedCount, openCount, conversations)
	}

	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/auth/me/presence", login.Token, receptionPresenceRequest{Online: true}, http.StatusOK, &presence)
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations", adminToken, nil, http.StatusOK, &conversations)
		if len(conversations) == 2 && conversations[0].Status == ConversationStatusAssigned && conversations[1].Status == ConversationStatusAssigned {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("going online did not refill available capacity: %#v", conversations)
}

func TestAgentDisconnectStopsAssignmentsUntilReconnectWithoutChangingOnlineIntent(t *testing.T) {
	app := NewServer(NewMemoryStore())
	server := httptest.NewServer(app.Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var agent User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email: "disconnect-agent@example.com", Password: "agent-password", Role: UserRoleAgent,
	}, http.StatusCreated, &agent)
	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email: "disconnect-agent@example.com", Password: "agent-password",
	}, http.StatusOK, &login)
	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Disconnect Shop"}, http.StatusCreated, &shop)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat}, http.StatusCreated, &source)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: agent.ID}, http.StatusCreated, nil)

	conn := dialEventWebSocket(t, server.URL, login.Token)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/ingest/conversations", adminToken, ingestConversationRequest{
		ShopID: shop.ID, SourceID: source.ID, ExternalConversationID: "disconnect-preserves-work",
		Messages: []ingestMessage{{Direction: MessageDirectionCustomer, Body: "Keep this assigned"}},
	}, http.StatusOK, nil)
	_ = conn.Close()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if !app.connectedUserIDs()[agent.ID] {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	stored, err := app.store.GetUser(t.Context(), agent.ID)
	if err != nil || !stored.ReceptionOnline {
		t.Fatalf("transport disconnect must preserve the agent's online intent, user=%#v err=%v", stored, err)
	}
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/ingest/conversations", adminToken, ingestConversationRequest{
		ShopID: shop.ID, SourceID: source.ID, ExternalConversationID: "queued-while-disconnected",
		Messages: []ingestMessage{{Direction: MessageDirectionCustomer, Body: "Wait for reconnect"}},
	}, http.StatusOK, nil)
	var conversations []Conversation
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations", adminToken, nil, http.StatusOK, &conversations)
	assignedCount, openCount := 0, 0
	for _, conversation := range conversations {
		if conversation.Status == ConversationStatusAssigned && conversation.AssignedAgentID == agent.ID {
			assignedCount++
		}
		if conversation.Status == ConversationStatusOpen && conversation.AssignedAgentID == "" {
			openCount++
		}
	}
	if assignedCount != 1 || openCount != 1 {
		t.Fatalf("disconnect must preserve current work and stop new assignments, assigned=%d open=%d conversations=%#v", assignedCount, openCount, conversations)
	}

	reconnected := dialEventWebSocket(t, server.URL, login.Token)
	defer reconnected.Close()
	deadline = time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations", adminToken, nil, http.StatusOK, &conversations)
		assignedCount = 0
		for _, conversation := range conversations {
			if conversation.Status == ConversationStatusAssigned && conversation.AssignedAgentID == agent.ID {
				assignedCount++
			}
		}
		if assignedCount == 2 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if assignedCount != 2 {
		t.Fatalf("reconnect must refill queued work while online intent remains enabled: %#v", conversations)
	}

	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/logout", login.Token, nil, http.StatusOK, nil)
	stored, err = app.store.GetUser(t.Context(), agent.ID)
	if err != nil || stored.ReceptionOnline {
		t.Fatalf("logout must set reception offline, user=%#v err=%v", stored, err)
	}
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations", adminToken, nil, http.StatusOK, &conversations)
	assignedCount = 0
	for _, conversation := range conversations {
		if conversation.Status == ConversationStatusAssigned && conversation.AssignedAgentID == agent.ID {
			assignedCount++
		}
	}
	if len(conversations) != 2 || assignedCount != 2 {
		t.Fatalf("logout must not release existing work: %#v", conversations)
	}
}

func TestAdminCanUpdateOwnRoutingSettings(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var updated User
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/auth/me/routing", adminToken, updateUserRequest{
		ReceptionLimit: intPtr(5),
	}, http.StatusOK, &updated)
	if updated.ReceptionLimit != 5 {
		t.Fatalf("expected admin reception limit 5, got %#v", updated)
	}

	var me User
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/auth/me", adminToken, nil, http.StatusOK, &me)
	if me.ReceptionLimit != 5 {
		t.Fatalf("expected /auth/me to return admin reception limit 5, got %#v", me)
	}
}

func TestAutomaticRoutingIgnoresHiddenAndHistoricalAssignedRecords(t *testing.T) {
	store := NewMemoryStore()
	app := NewServer(store)
	server := httptest.NewServer(app.Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var agent User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email: "effective-load-agent@example.com", DisplayName: "Effective Load Agent", Password: "agent-password",
		Role: UserRoleAgent, ReceptionLimit: 1,
	}, http.StatusCreated, &agent)
	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email: "effective-load-agent@example.com", Password: "agent-password",
	}, http.StatusOK, &login)
	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Effective Load Shop"}, http.StatusCreated, &shop)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat}, http.StatusCreated, &source)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: agent.ID}, http.StatusCreated, nil)

	for _, conversation := range []Conversation{
		{
			ShopID: shop.ID, SourceID: source.ID, CustomerName: "Shopify", CustomerEmail: "store+123@notice.shopifyemail.com",
			Subject: "Hidden relay", Status: ConversationStatusAssigned, AssignedAgentID: agent.ID, Kind: ConversationKindCustomer,
		},
		{
			ShopID: shop.ID, SourceID: source.ID, CustomerName: "Imported", CustomerEmail: "imported@example.com",
			Subject: "Historical", Status: ConversationStatusAssigned, AssignedAgentID: agent.ID, Kind: ConversationKindCustomer,
			Classification: historicalEmailClassification + "normal conversation",
		},
	} {
		if _, err := store.CreateConversation(t.Context(), conversation); err != nil {
			t.Fatal(err)
		}
	}
	ticket := issueWSTicket(t, server.URL, login.Token)
	conn, _, err := websocket.DefaultDialer.Dial(wsURL(server.URL)+"/ws/events?ticket="+url.QueryEscape(ticket), websocketHeaders(server.URL))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()

	requestJSON(t, http.MethodPost, server.URL+"/api/v1/ingest/conversations", adminToken, ingestConversationRequest{
		ShopID: shop.ID, SourceID: source.ID, ExternalConversationID: "effective-load-customer",
		Messages: []ingestMessage{{Direction: MessageDirectionCustomer, Body: "Please help"}},
	}, http.StatusOK, nil)

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		loads, loadErr := app.customerConversationLoads(t.Context())
		if loadErr != nil {
			t.Fatal(loadErr)
		}
		if loads[agent.ID] == 1 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	loads, err := app.customerConversationLoads(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if loads[agent.ID] != 1 {
		t.Fatalf("effective load = %d, want 1", loads[agent.ID])
	}
	conversations, err := store.ListConversations(t.Context(), ConversationFilter{Status: ConversationStatusAssigned, AssignedAgentID: agent.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(conversations) != 3 {
		t.Fatalf("excluded records should remain stored while consuming no capacity: %#v", conversations)
	}
}

func TestAdminNeverJoinsAutomaticRoutingEvenWhenPermissionIsEnabled(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	workbenchPermissions := []string{
		PermissionWorkbenchAccess,
		PermissionConversationClaim,
		PermissionConversationReply,
	}
	var manager User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email:                 "routing-manager@example.com",
		DisplayName:           "Routing Manager",
		Password:              "agent-password",
		Role:                  UserRoleAdmin,
		ReceptionLimit:        1,
		Permissions:           workbenchPermissions,
		PermissionsCustomized: true,
		ShopScope:             AccessScopeAssigned,
		ConversationScope:     AccessScopeAssigned,
	}, http.StatusCreated, &manager)
	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email: "routing-manager@example.com", Password: "agent-password",
	}, http.StatusOK, &login)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Manager Routing Shop"}, http.StatusCreated, &shop)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat}, http.StatusCreated, &source)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: manager.ID}, http.StatusCreated, nil)

	conn := dialEventWebSocket(t, server.URL, login.Token)
	defer conn.Close()

	requestJSON(t, http.MethodPost, server.URL+"/api/v1/ingest/conversations", adminToken, ingestConversationRequest{
		ShopID: shop.ID, SourceID: source.ID, ExternalConversationID: "manager-routing-opt-in",
		Messages: []ingestMessage{{Direction: MessageDirectionCustomer, Body: "Need help"}},
	}, http.StatusOK, nil)
	var conversations []Conversation
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations", adminToken, nil, http.StatusOK, &conversations)
	if len(conversations) != 1 || conversations[0].Status != ConversationStatusOpen || conversations[0].AssignedAgentID != "" {
		t.Fatalf("manager without automatic reception permission must leave the conversation queued: %#v", conversations)
	}

	autoPermissions := append(append([]string(nil), workbenchPermissions...), PermissionAutoReception)
	customized := true
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/users/"+manager.ID, adminToken, updateUserRequest{
		Permissions: &autoPermissions, PermissionsCustomized: &customized,
	}, http.StatusOK, &manager)

	time.Sleep(100 * time.Millisecond)
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations", adminToken, nil, http.StatusOK, &conversations)
	if len(conversations) != 1 || conversations[0].Status != ConversationStatusOpen || conversations[0].AssignedAgentID != "" {
		t.Fatalf("system management account must remain outside automatic routing: %#v", conversations)
	}
}

func intPtr(value int) *int {
	return &value
}
