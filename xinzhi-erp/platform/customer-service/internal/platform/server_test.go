package platform

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func startTestEmailOutbox(t *testing.T, server *Server) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	server.StartEmailOutboxMaintenance(ctx)
	t.Cleanup(cancel)
}

func waitForEmailMessageStatus(t *testing.T, store Store, conversationID, messageID, status string) Message {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		message, err := store.GetMessage(context.Background(), conversationID, messageID)
		if err == nil && message.Metadata[emailSendStatusKey] == status {
			return message
		}
		time.Sleep(10 * time.Millisecond)
	}
	message, err := store.GetMessage(context.Background(), conversationID, messageID)
	t.Fatalf("email message %s did not reach %s: message=%#v err=%v", messageID, status, message, err)
	return Message{}
}

func websocketOrigin(baseURL string) string {
	return strings.TrimSuffix(baseURL, "/")
}

func websocketHeaders(baseURL string) http.Header {
	headers := http.Header{}
	headers.Set("Origin", websocketOrigin(baseURL))
	return headers
}

func issueWSTicket(t *testing.T, baseURL string, token string, tenantID ...string) string {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, baseURL+"/api/v1/auth/ws-ticket", nil)
	if err != nil {
		t.Fatalf("create websocket ticket request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Origin", websocketOrigin(baseURL))
	if len(tenantID) > 0 && tenantID[0] != "" {
		req.Header.Set(erpTenantHeader, tenantID[0])
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("issue websocket ticket: %v", err)
	}
	defer resp.Body.Close()
	var result struct {
		Ticket string `json:"ticket"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("decode websocket ticket response: status=%d err=%v", resp.StatusCode, err)
	}
	if resp.StatusCode != http.StatusCreated || result.Ticket == "" {
		t.Fatalf("issue websocket ticket: status=%d result=%#v", resp.StatusCode, result)
	}
	return result.Ticket
}

func dialEventWebSocket(t *testing.T, baseURL string, token string, tenantID ...string) *websocket.Conn {
	t.Helper()
	ticket := issueWSTicket(t, baseURL, token, tenantID...)
	conn, _, err := websocket.DefaultDialer.Dial(
		wsURL(baseURL)+"/ws/events?ticket="+url.QueryEscape(ticket),
		websocketHeaders(baseURL),
	)
	if err != nil {
		t.Fatalf("event websocket dial failed: %v", err)
	}
	return conn
}

func allowAnonymousPublicChat(t *testing.T, baseURL, adminToken, shopID string) {
	t.Helper()
	var sources []ShopSource
	requestJSON(t, http.MethodGet, baseURL+"/api/v1/shops/"+shopID+"/sources", adminToken, nil, http.StatusOK, &sources)
	for _, source := range sources {
		if source.Type != SourceTypeShopifyChat {
			continue
		}
		metadata := source.Metadata
		if metadata == nil {
			metadata = map[string]string{}
		}
		metadata[shopifyChatCustomerLoginRequiredKey] = "false"
		requestJSON(t, http.MethodPatch, baseURL+"/api/v1/shops/"+shopID+"/sources/"+source.ID, adminToken, updateShopSourceRequest{Status: source.Status, Provider: source.Provider, Address: source.Address, Metadata: metadata}, http.StatusOK, nil)
		return
	}
	requestJSON(t, http.MethodPost, baseURL+"/api/v1/shops/"+shopID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat, Metadata: map[string]string{shopifyChatCustomerLoginRequiredKey: "false"}}, http.StatusCreated, nil)
}

func TestConversationUnreadOnlyForAssignedAgent(t *testing.T) {
	unread := map[string]bool{"assigned": true, "open": true}
	assigned := Conversation{ID: "assigned", Status: ConversationStatusAssigned, AssignedAgentID: "agent-1"}
	if !conversationUnreadForUser(assigned, "agent-1", unread) {
		t.Fatal("assigned agent should receive the unread indicator")
	}
	if conversationUnreadForUser(assigned, "agent-2", unread) {
		t.Fatal("other agents must not receive the assigned conversation unread indicator")
	}
	if !conversationUnreadForUser(Conversation{ID: "open", Status: ConversationStatusOpen}, "agent-2", unread) {
		t.Fatal("shared queue conversations should remain unread for eligible agents")
	}
}

func TestServerCreatesAndReadsConversationFlow(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Wealbeauty"}, http.StatusCreated, &shop)

	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat}, http.StatusCreated, &source)
	if source.ID == "" {
		t.Fatal("expected source to be created")
	}

	var conversation Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations", adminToken, Conversation{
		ShopID:       shop.ID,
		SourceID:     source.ID,
		CustomerName: "Mia",
		Subject:      "Sizing help",
	}, http.StatusCreated, &conversation)

	var message Message
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", adminToken, Message{
		Direction: MessageDirectionCustomer,
		Body:      "Which size should I choose?",
	}, http.StatusCreated, &message)
	if message.ConversationID != conversation.ID {
		t.Fatalf("message conversation mismatch: %#v", message)
	}

	var conversations []Conversation
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations?shopId="+shop.ID, adminToken, nil, http.StatusOK, &conversations)
	if len(conversations) != 1 || conversations[0].ID != conversation.ID {
		t.Fatalf("unexpected conversations: %#v", conversations)
	}

	var messages []Message
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", adminToken, nil, http.StatusOK, &messages)
	if len(messages) != 1 || messages[0].Body != "Which size should I choose?" {
		t.Fatalf("unexpected messages: %#v", messages)
	}
}

func TestAgentAssignedScopeAndUnreadConversationLifecycle(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var agent User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{Email: "lifecycle-agent@example.com", DisplayName: "Lifecycle Agent", Password: "agent-password", Role: UserRoleAgent}, http.StatusCreated, &agent)
	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{Email: agent.Email, Password: "agent-password"}, http.StatusOK, &login)
	var assignedShop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Assigned"}, http.StatusCreated, &assignedShop)
	var hiddenShop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Hidden"}, http.StatusCreated, &hiddenShop)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+assignedShop.ID+"/agents", adminToken, assignShopUserRequest{UserID: agent.ID}, http.StatusCreated, nil)

	var assignedShops []Shop
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/shops?scope=assigned", login.Token, nil, http.StatusOK, &assignedShops)
	if len(assignedShops) != 1 || assignedShops[0].ID != assignedShop.ID {
		t.Fatalf("unexpected assigned shops: %#v", assignedShops)
	}

	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+assignedShop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat}, http.StatusCreated, &source)
	var conversation Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations", adminToken, Conversation{ShopID: assignedShop.ID, SourceID: source.ID}, http.StatusCreated, &conversation)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", adminToken, Message{Direction: MessageDirectionCustomer, Body: "Need help"}, http.StatusCreated, nil)

	var conversations []Conversation
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations?scope=assigned", login.Token, nil, http.StatusOK, &conversations)
	if len(conversations) != 1 || !conversations[0].Unread {
		t.Fatalf("expected one unread assigned conversation, got %#v", conversations)
	}

	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/read", login.Token, nil, http.StatusOK, nil)
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations?scope=assigned", login.Token, nil, http.StatusOK, &conversations)
	if len(conversations) != 1 || conversations[0].Unread {
		t.Fatalf("expected conversation to be read, got %#v", conversations)
	}
	if conversations[0].LastMessageDirection != MessageDirectionCustomer {
		t.Fatalf("read customer conversation direction = %q", conversations[0].LastMessageDirection)
	}

	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/claim", login.Token, nil, http.StatusOK, nil)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", login.Token, Message{Direction: MessageDirectionAgent, Body: "Reply"}, http.StatusCreated, nil)
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations?scope=assigned", login.Token, nil, http.StatusOK, &conversations)
	if conversations[0].Unread {
		t.Fatalf("agent reply must not make the conversation unread: %#v", conversations)
	}
	if conversations[0].LastMessageDirection != MessageDirectionAgent {
		t.Fatalf("agent reply direction = %q", conversations[0].LastMessageDirection)
	}

	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", adminToken, Message{Direction: MessageDirectionCustomer, Body: "One more question"}, http.StatusCreated, nil)
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations?scope=assigned", login.Token, nil, http.StatusOK, &conversations)
	if !conversations[0].Unread {
		t.Fatalf("new customer message must make the conversation unread: %#v", conversations)
	}
	if conversations[0].LastMessageDirection != MessageDirectionCustomer {
		t.Fatalf("new customer message direction = %q", conversations[0].LastMessageDirection)
	}
}

func TestSystemAdminCanUseExplicitlyAssignedWorkbenchScope(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)
	var admin User
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/auth/me", adminToken, nil, http.StatusOK, &admin)
	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Admin Hidden Workbench"}, http.StatusCreated, &shop)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: admin.ID}, http.StatusCreated, nil)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat}, http.StatusCreated, &source)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations", adminToken, Conversation{ShopID: shop.ID, SourceID: source.ID}, http.StatusCreated, nil)
	var conversations []Conversation
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations?scope=assigned", adminToken, nil, http.StatusOK, &conversations)
	if len(conversations) != 1 || conversations[0].ShopID != shop.ID {
		t.Fatalf("system admin with an explicit shop assignment should see that workbench queue, got %#v", conversations)
	}
}

func TestServerHealthReportsMemoryStore(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()

	var health struct {
		OK      bool         `json:"ok"`
		Service string       `json:"service"`
		Storage HealthStatus `json:"storage"`
	}
	getJSON(t, server.URL+"/healthz", http.StatusOK, &health)
	if !health.OK || health.Service != "xzdesk" {
		t.Fatalf("unexpected health response: %#v", health)
	}
	if health.Storage.Name != "memory" || !health.Storage.OK {
		t.Fatalf("unexpected storage health: %#v", health.Storage)
	}
}

func TestAdminCanDisableAndEnableShop(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Toggle Shop"}, http.StatusCreated, &shop)

	var disabled Shop
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/shops/"+shop.ID, adminToken, updateShopRequest{Status: ShopStatusDisabled}, http.StatusOK, &disabled)
	if disabled.Status != ShopStatusDisabled || disabled.ID != shop.ID {
		t.Fatalf("expected disabled shop, got %#v", disabled)
	}

	var enabled Shop
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/shops/"+shop.ID, adminToken, updateShopRequest{Status: ShopStatusActive}, http.StatusOK, &enabled)
	if enabled.Status != ShopStatusActive || enabled.ID != shop.ID {
		t.Fatalf("expected enabled shop, got %#v", enabled)
	}
}

func TestAdminCannotDeleteShopWithConnectedChannel(t *testing.T) {
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Connected Shop"}, http.StatusCreated, &shop)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{
		Type:    SourceTypeShopifyAPI,
		Address: "connected-shop.myshopify.com",
	}, http.StatusCreated, &source)
	if _, err := store.SaveShopifyInstallation(context.Background(), ShopifyInstallation{
		ShopID:      shop.ID,
		ShopDomain:  "connected-shop.myshopify.com",
		AccessToken: "shpat_connected",
	}); err != nil {
		t.Fatalf("SaveShopifyInstallation failed: %v", err)
	}

	var payload map[string]string
	requestJSON(t, http.MethodDelete, server.URL+"/api/v1/shops/"+shop.ID, adminToken, nil, http.StatusBadRequest, &payload)
	if !strings.Contains(payload["error"], "请先解绑Shopify后再删除店铺") {
		t.Fatalf("expected connected channel delete error, got %#v", payload)
	}

	var shops []Shop
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/shops", adminToken, nil, http.StatusOK, &shops)
	if len(shops) != 1 || shops[0].ID != shop.ID {
		t.Fatalf("expected shop to remain after blocked delete, got %#v", shops)
	}
}

func TestAdminCanDeleteShopWhenChannelsAreNotConnected(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Disconnected Shop"}, http.StatusCreated, &shop)
	var shopifySource ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyAPI, Status: SourceStatusDisabled}, http.StatusCreated, &shopifySource)
	var emailSource ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeEmail, Status: SourceStatusDisabled}, http.StatusCreated, &emailSource)

	var output map[string]bool
	requestJSON(t, http.MethodDelete, server.URL+"/api/v1/shops/"+shop.ID, adminToken, nil, http.StatusOK, &output)
	if !output["ok"] {
		t.Fatalf("expected delete response ok, got %#v", output)
	}

	var shops []Shop
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/shops", adminToken, nil, http.StatusOK, &shops)
	if len(shops) != 0 {
		t.Fatalf("expected deleted shop to be removed from list, got %#v", shops)
	}
}

func TestAdminCanDeleteShopWithStaleShopifySourceWithoutInstallation(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Stale Shopify Shop"}, http.StatusCreated, &shop)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{
		Type:    SourceTypeShopifyAPI,
		Address: "stale-shop.myshopify.com",
	}, http.StatusCreated, &source)

	var output map[string]bool
	requestJSON(t, http.MethodDelete, server.URL+"/api/v1/shops/"+shop.ID, adminToken, nil, http.StatusOK, &output)
	if !output["ok"] {
		t.Fatalf("expected stale Shopify source not to block deletion, got %#v", output)
	}
}

func TestShopifyConnectionStatusPersistsMissingInstallation(t *testing.T) {
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Uninstalled Shopify Shop"}, http.StatusCreated, &shop)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{
		Type:    SourceTypeShopifyAPI,
		Address: "uninstalled-shop.myshopify.com",
	}, http.StatusCreated, &source)

	var status ShopifyConnectionStatus
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/shops/"+shop.ID+"/shopify/connection", adminToken, nil, http.StatusOK, &status)
	if status.State != "not_installed" {
		t.Fatalf("expected not_installed status, got %#v", status)
	}
	sources, err := store.ListShopSources(context.Background(), shop.ID)
	if err != nil {
		t.Fatalf("ListShopSources failed: %v", err)
	}
	if len(sources) != 1 || sources[0].Status != SourceStatusActive || sources[0].Metadata["apiStatus"] != "invalid_token" || sources[0].Metadata[shopifyConnectionStateKey] != "not_installed" {
		t.Fatalf("expected missing authorization to be persisted without disabling the source, got %#v", sources)
	}
}

func TestShopifyConnectionStatusPersistsRejectedInstallation(t *testing.T) {
	store := NewMemoryStore()
	app := NewServer(store)
	app.shopifyConnectionChecker = func(context.Context, string, string) ShopifyConnectionStatus {
		return ShopifyConnectionStatus{State: "not_installed", Message: "Shopify rejected the stored authorization"}
	}
	server := httptest.NewServer(app.Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Rejected Shopify Shop"}, http.StatusCreated, &shop)
	const domain = "rejected-shop.myshopify.com"
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{
		Type:    SourceTypeShopifyAPI,
		Address: domain,
	}, http.StatusCreated, &source)
	if _, err := store.SaveShopifyInstallation(context.Background(), ShopifyInstallation{
		ShopID:      shop.ID,
		ShopDomain:  domain,
		AccessToken: "shpat_rejected",
	}); err != nil {
		t.Fatalf("SaveShopifyInstallation failed: %v", err)
	}

	var status ShopifyConnectionStatus
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/shops/"+shop.ID+"/shopify/connection", adminToken, nil, http.StatusOK, &status)
	if status.State != "not_installed" {
		t.Fatalf("expected not_installed status, got %#v", status)
	}
	if _, err := store.GetShopifyInstallationByDomain(context.Background(), domain); err != nil {
		t.Fatalf("expected rejected installation to be preserved for reauthorization, got err=%v", err)
	}
	sources, err := store.ListShopSources(context.Background(), shop.ID)
	if err != nil {
		t.Fatalf("ListShopSources failed: %v", err)
	}
	if len(sources) != 1 || sources[0].Status != SourceStatusActive || sources[0].Metadata["apiStatus"] != "invalid_token" || sources[0].Metadata[shopifyConnectionStateKey] != "not_installed" {
		t.Fatalf("expected rejected authorization status to be persisted, got %#v", sources)
	}
}

func TestShopifyBusinessAuthorizationErrorPersistsInvalidStatus(t *testing.T) {
	store := NewMemoryStore()
	shop, err := store.CreateShop(context.Background(), Shop{DisplayName: "Authorization Error", ExternalID: "auth-error.myshopify.com"})
	if err != nil {
		t.Fatalf("CreateShop failed: %v", err)
	}
	if _, err := store.CreateShopSource(context.Background(), ShopSource{
		ShopID: shop.ID, Type: SourceTypeShopifyAPI, Address: "auth-error.myshopify.com",
	}); err != nil {
		t.Fatalf("CreateShopSource failed: %v", err)
	}
	NewServer(store).recordShopifyAPIError(context.Background(), shop.ID, &shopifyAdminHTTPError{StatusCode: http.StatusUnauthorized, Body: "unauthorized"})
	sources, err := store.ListShopSources(context.Background(), shop.ID)
	if err != nil {
		t.Fatalf("ListShopSources failed: %v", err)
	}
	if len(sources) != 1 || sources[0].Metadata["apiStatus"] != "invalid_token" || sources[0].Metadata[shopifyConnectionStateKey] != "not_installed" {
		t.Fatalf("expected business authorization failure to update persisted status, got %#v", sources)
	}
}

func TestAdminCanDeleteShopWithLegacyEmptyEmailSource(t *testing.T) {
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Legacy Empty Mail Shop"}, http.StatusCreated, &shop)
	if _, err := store.CreateShopSource(context.Background(), ShopSource{
		ShopID: shop.ID,
		Type:   SourceTypeEmail,
		Status: SourceStatusActive,
	}); err != nil {
		t.Fatalf("CreateShopSource legacy empty email failed: %v", err)
	}

	var output map[string]bool
	requestJSON(t, http.MethodDelete, server.URL+"/api/v1/shops/"+shop.ID, adminToken, nil, http.StatusOK, &output)
	if !output["ok"] {
		t.Fatalf("expected delete response ok, got %#v", output)
	}
}

func TestAdminCanDeleteShopWithLegacyEmptyShopifyAPISource(t *testing.T) {
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Legacy Empty Shopify Shop"}, http.StatusCreated, &shop)
	if _, err := store.CreateShopSource(context.Background(), ShopSource{
		ShopID: shop.ID,
		Type:   SourceTypeShopifyAPI,
		Status: SourceStatusActive,
	}); err != nil {
		t.Fatalf("CreateShopSource legacy empty Shopify API failed: %v", err)
	}

	var output map[string]bool
	requestJSON(t, http.MethodDelete, server.URL+"/api/v1/shops/"+shop.ID, adminToken, nil, http.StatusOK, &output)
	if !output["ok"] {
		t.Fatalf("expected delete response ok, got %#v", output)
	}
}

func TestDisabledShopBlocksShopifyOrderSearch(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{
		DisplayName: "Disabled API Shop",
		ExternalID:  "disabled-api.myshopify.com",
		Status:      ShopStatusDisabled,
	}, http.StatusCreated, &shop)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{
		Type:    SourceTypeShopifyAPI,
		Address: "disabled-api.myshopify.com",
	}, http.StatusCreated, &source)

	var payload map[string]string
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/shops/"+shop.ID+"/shopify/orders?query=test", adminToken, nil, http.StatusBadRequest, &payload)
	if !strings.Contains(payload["error"], "shop is disabled") {
		t.Fatalf("expected disabled shop error, got %#v", payload)
	}
}

func TestOutlookAuthURLAndCallbackCreatesEmailSource(t *testing.T) {
	tokenServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("expected token POST, got %s", r.Method)
		}
		if err := r.ParseForm(); err != nil {
			t.Fatalf("parse token form failed: %v", err)
		}
		if r.Form.Get("grant_type") != "authorization_code" || r.Form.Get("code") != "code-1" {
			t.Fatalf("unexpected token form: %v", r.Form)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"access-1","refresh_token":"refresh-1","scope":"Mail.ReadWrite Mail.Send","expires_in":3600}`))
	}))
	defer tokenServer.Close()
	meServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer access-1" {
			t.Fatalf("unexpected Graph auth header: %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"mail":"support@store.com","userPrincipalName":"fallback@store.com"}`))
	}))
	defer meServer.Close()
	t.Setenv("OUTLOOK_CLIENT_ID", "client-1")
	t.Setenv("OUTLOOK_CLIENT_SECRET", "secret-1")
	t.Setenv("OUTLOOK_AUTHORIZE_URL", "https://login.example.test/common/oauth2/v2.0/authorize")
	t.Setenv("OUTLOOK_TOKEN_URL", tokenServer.URL)
	t.Setenv("OUTLOOK_ME_URL", meServer.URL)

	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	t.Setenv("OUTLOOK_BASE_URL", server.URL)
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Mail Shop"}, http.StatusCreated, &shop)

	var authURL outlookAuthURLResponse
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/email/outlook/auth-url", adminToken, map[string]string{}, http.StatusOK, &authURL)
	parsed, err := url.Parse(authURL.AuthURL)
	if err != nil {
		t.Fatalf("parse auth url failed: %v", err)
	}
	if parsed.Host != "login.example.test" || parsed.Query().Get("login_hint") != "" {
		t.Fatalf("unexpected auth URL: %s", authURL.AuthURL)
	}
	if parsed.Query().Get("scope") != defaultOutlookScopes || parsed.Query().Get("state") == "" {
		t.Fatalf("auth URL missing Outlook read/write/send scope or state: %s", authURL.AuthURL)
	}

	callback := server.URL + "/outlook/callback?code=code-1&state=" + url.QueryEscape(parsed.Query().Get("state"))
	raw := requestJSON(t, http.MethodGet, callback, "", nil, http.StatusOK, nil)
	if !strings.Contains(string(raw), "support@store.com") {
		t.Fatalf("callback page should include mailbox, got %s", string(raw))
	}

	sources, err := store.ListShopSources(context.Background(), shop.ID)
	if err != nil {
		t.Fatalf("ListShopSources failed: %v", err)
	}
	if len(sources) != 1 || sources[0].Type != SourceTypeEmail || sources[0].Provider != "outlook" || sources[0].Address != "support@store.com" || sources[0].Status != SourceStatusActive {
		t.Fatalf("unexpected email source: %#v", sources)
	}
	installation, err := store.GetEmailInstallation(context.Background(), shop.ID, "support@store.com")
	if err != nil {
		t.Fatalf("GetEmailInstallation failed: %v", err)
	}
	if installation.AccessToken != "access-1" || installation.RefreshToken != "refresh-1" {
		t.Fatalf("unexpected email installation: %#v", installation)
	}
}

func TestGmailAuthURLAndCallbackAddsSecondEmailSource(t *testing.T) {
	tokenServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("expected token POST, got %s", r.Method)
		}
		if err := r.ParseForm(); err != nil {
			t.Fatalf("parse token form failed: %v", err)
		}
		if r.Form.Get("grant_type") != "authorization_code" || r.Form.Get("code") != "gmail-code-1" {
			t.Fatalf("unexpected token form: %v", r.Form)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"gmail-access-1","refresh_token":"gmail-refresh-1","scope":"https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send","expires_in":3600}`))
	}))
	defer tokenServer.Close()
	profileServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer gmail-access-1" {
			t.Fatalf("unexpected Gmail auth header: %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"emailAddress":"consulting@store.com"}`))
	}))
	defer profileServer.Close()
	t.Setenv("GMAIL_CLIENT_ID", "gmail-client-1")
	t.Setenv("GMAIL_CLIENT_SECRET", "gmail-secret-1")
	t.Setenv("GMAIL_AUTHORIZE_URL", "https://accounts.example.test/o/oauth2/v2/auth")
	t.Setenv("GMAIL_TOKEN_URL", tokenServer.URL)
	t.Setenv("GMAIL_PROFILE_URL", profileServer.URL)

	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	t.Setenv("GMAIL_BASE_URL", server.URL)
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Multi Mail Shop"}, http.StatusCreated, &shop)
	_, err := store.CreateShopSource(context.Background(), ShopSource{
		ShopID:   shop.ID,
		Type:     SourceTypeEmail,
		Provider: "outlook",
		Address:  "notice@store.com",
		Metadata: map[string]string{"mailbox": "notice@store.com", "auth": "microsoft_graph"},
	})
	if err != nil {
		t.Fatalf("CreateShopSource existing Outlook failed: %v", err)
	}

	var authURL outlookAuthURLResponse
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/email/gmail/auth-url", adminToken, map[string]string{}, http.StatusOK, &authURL)
	parsed, err := url.Parse(authURL.AuthURL)
	if err != nil {
		t.Fatalf("parse auth url failed: %v", err)
	}
	if parsed.Host != "accounts.example.test" {
		t.Fatalf("unexpected auth URL: %s", authURL.AuthURL)
	}
	if parsed.Query().Get("scope") != defaultGmailScopes || parsed.Query().Get("state") == "" {
		t.Fatalf("auth URL missing Gmail scope or state: %s", authURL.AuthURL)
	}

	callback := server.URL + "/gmail/callback?code=gmail-code-1&state=" + url.QueryEscape(parsed.Query().Get("state"))
	raw := requestJSON(t, http.MethodGet, callback, "", nil, http.StatusOK, nil)
	if !strings.Contains(string(raw), "consulting@store.com") {
		t.Fatalf("callback page should include mailbox, got %s", string(raw))
	}

	sources, err := store.ListShopSources(context.Background(), shop.ID)
	if err != nil {
		t.Fatalf("ListShopSources failed: %v", err)
	}
	if len(sources) != 2 {
		t.Fatalf("expected two email sources, got %#v", sources)
	}
	providers := map[string]string{}
	for _, source := range sources {
		providers[source.Address] = source.Provider
	}
	if providers["notice@store.com"] != "outlook" || providers["consulting@store.com"] != "gmail" {
		t.Fatalf("unexpected email sources: %#v", sources)
	}
	installation, err := store.GetEmailInstallation(context.Background(), shop.ID, "consulting@store.com")
	if err != nil {
		t.Fatalf("GetEmailInstallation failed: %v", err)
	}
	if installation.Provider != "gmail" || installation.AccessToken != "gmail-access-1" || installation.RefreshToken != "gmail-refresh-1" {
		t.Fatalf("unexpected Gmail installation: %#v", installation)
	}
}

func TestGmailCallbackRejectsReadonlyOnlyScope(t *testing.T) {
	tokenServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"gmail-access-1","refresh_token":"gmail-refresh-1","scope":"https://www.googleapis.com/auth/gmail.readonly","expires_in":3600}`))
	}))
	defer tokenServer.Close()
	profileServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"emailAddress":"readonly@store.com"}`))
	}))
	defer profileServer.Close()
	t.Setenv("GMAIL_CLIENT_ID", "gmail-client-1")
	t.Setenv("GMAIL_CLIENT_SECRET", "gmail-secret-1")
	t.Setenv("GMAIL_AUTHORIZE_URL", "https://accounts.example.test/o/oauth2/v2/auth")
	t.Setenv("GMAIL_TOKEN_URL", tokenServer.URL)
	t.Setenv("GMAIL_PROFILE_URL", profileServer.URL)

	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	t.Setenv("GMAIL_BASE_URL", server.URL)
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Readonly Gmail Shop"}, http.StatusCreated, &shop)
	var authURL outlookAuthURLResponse
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/email/gmail/auth-url", adminToken, map[string]string{}, http.StatusOK, &authURL)
	parsed, err := url.Parse(authURL.AuthURL)
	if err != nil {
		t.Fatalf("parse auth url failed: %v", err)
	}
	callback := server.URL + "/gmail/callback?code=gmail-code-1&state=" + url.QueryEscape(parsed.Query().Get("state"))
	raw := requestJSON(t, http.MethodGet, callback, "", nil, http.StatusBadRequest, nil)
	if !strings.Contains(string(raw), "Gmail scope incomplete") {
		t.Fatalf("expected incomplete scope failure page, got %s", string(raw))
	}
	if _, err := store.GetEmailInstallation(context.Background(), shop.ID, "readonly@store.com"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("readonly-only Gmail authorization must not be saved, got %v", err)
	}
}

func TestAgentEmailReplySendsViaGmailThreadBeforeRecording(t *testing.T) {
	var sendSeen bool
	var modifySeen bool
	gmailServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer gmail-access-1" {
			t.Fatalf("unexpected Gmail authorization header: %q", r.Header.Get("Authorization"))
		}
		switch r.URL.Path {
		case "/users/me/messages/send":
			sendSeen = true
			if r.Method != http.MethodPost {
				t.Fatalf("expected Gmail send POST, got %s", r.Method)
			}
			var payload struct {
				Raw      string `json:"raw"`
				ThreadID string `json:"threadId"`
			}
			body, _ := io.ReadAll(r.Body)
			if err := json.Unmarshal(body, &payload); err != nil {
				t.Fatalf("decode Gmail send payload failed: %v", err)
			}
			if payload.ThreadID != "thread-1" {
				t.Fatalf("expected Gmail thread reply to thread-1, got %q", payload.ThreadID)
			}
			raw, err := base64.RawURLEncoding.DecodeString(payload.Raw)
			if err != nil {
				t.Fatalf("decode raw Gmail message failed: %v", err)
			}
			if !strings.Contains(string(raw), "<buyer@example.com>") ||
				!strings.Contains(string(raw), "Subject: Re: Order help") ||
				!strings.Contains(string(raw), "In-Reply-To: <customer-msg-1@example.com>") ||
				!strings.Contains(string(raw), "References: <root@example.com> <customer-msg-1@example.com>") {
				t.Fatalf("unexpected raw Gmail message: %s", string(raw))
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"sent-1","threadId":"thread-1"}`))
		case "/users/me/messages/customer-msg-1/modify":
			modifySeen = true
			var payload map[string][]string
			body, _ := io.ReadAll(r.Body)
			if err := json.Unmarshal(body, &payload); err != nil {
				t.Fatalf("decode Gmail modify payload failed: %v", err)
			}
			if strings.Join(payload["removeLabelIds"], ",") != "UNREAD" {
				t.Fatalf("expected UNREAD to be removed, got %+v", payload)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"customer-msg-1"}`))
		default:
			t.Fatalf("unexpected Gmail API path: %s", r.URL.Path)
		}
	}))
	defer gmailServer.Close()
	t.Setenv("GMAIL_API_BASE_URL", gmailServer.URL)

	store := NewMemoryStore()
	platformServer := NewServer(store)
	platformServer.uploadDir = t.TempDir()
	startTestEmailOutbox(t, platformServer)
	server := httptest.NewServer(platformServer.Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)
	var admin User
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/auth/me", adminToken, nil, http.StatusOK, &admin)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Gmail Reply Shop"}, http.StatusCreated, &shop)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: admin.ID}, http.StatusCreated, nil)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{
		Type:     SourceTypeEmail,
		Provider: "gmail",
		Address:  "support@store.com",
	}, http.StatusCreated, &source)
	_, err := store.SaveEmailInstallation(context.Background(), EmailInstallation{
		ShopID:       shop.ID,
		Mailbox:      "support@store.com",
		Provider:     "gmail",
		AccessToken:  "gmail-access-1",
		RefreshToken: "gmail-refresh-1",
		Scope:        defaultGmailScopes,
		ExpiresAt:    time.Now().Add(time.Hour),
	})
	if err != nil {
		t.Fatalf("SaveEmailInstallation failed: %v", err)
	}
	var conversation Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations", adminToken, Conversation{
		ShopID:        shop.ID,
		SourceID:      source.ID,
		CustomerName:  "Buyer",
		CustomerEmail: "buyer@example.com",
		Subject:       "Order help",
	}, http.StatusCreated, &conversation)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/claim", adminToken, nil, http.StatusOK, nil)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", adminToken, Message{
		Direction:       MessageDirectionCustomer,
		Body:            "Where is my order?",
		Metadata:        map[string]string{"gmail_message_id": "customer-msg-1", "gmail_thread_id": "thread-1", "mail_message_id": "<customer-msg-1@example.com>", "mail_references": "<root@example.com>"},
		SourceMessageID: "gmail:customer-msg-1",
	}, http.StatusCreated, nil)

	var reply Message
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", adminToken, Message{
		Direction: MessageDirectionAgent,
		Body:      "We are checking it now.",
	}, http.StatusAccepted, &reply)
	reply = waitForEmailMessageStatus(t, store, conversation.ID, reply.ID, emailSendStatusSent)
	if !sendSeen || !modifySeen {
		t.Fatalf("expected Gmail send and mark-read calls, send=%v modify=%v", sendSeen, modifySeen)
	}
	if reply.Metadata["mail_api_provider"] != "gmail" || reply.Metadata["mail_api_sent_at"] == "" {
		t.Fatalf("expected mail API metadata on stored reply, got %#v", reply.Metadata)
	}
	if reply.Metadata["gmail_thread_id"] != "thread-1" || reply.Metadata["gmail_message_id"] != "sent-1" {
		t.Fatalf("expected Gmail sent identifiers on stored reply, got %#v", reply.Metadata)
	}
}

func TestAgentEmailReplySendsViaOutlookThreadBeforeRecording(t *testing.T) {
	var replyCalls int
	var patchSeen bool
	graphServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer outlook-access-1" {
			t.Fatalf("unexpected Graph authorization header: %q", r.Header.Get("Authorization"))
		}
		switch r.URL.Path {
		case "/me/messages/outlook-msg-1/reply":
			replyCalls++
			if r.Method != http.MethodPost {
				t.Fatalf("expected Outlook reply POST, got %s", r.Method)
			}
			var payload map[string]string
			body, _ := io.ReadAll(r.Body)
			if err := json.Unmarshal(body, &payload); err != nil {
				t.Fatalf("decode Outlook reply payload failed: %v", err)
			}
			if payload["comment"] != "We are checking it now." {
				t.Fatalf("unexpected Outlook reply payload: %+v", payload)
			}
			w.WriteHeader(http.StatusAccepted)
		case "/me/messages/outlook-msg-1":
			patchSeen = true
			if r.Method != http.MethodPatch {
				t.Fatalf("expected Outlook mark-read PATCH, got %s", r.Method)
			}
			var payload map[string]bool
			body, _ := io.ReadAll(r.Body)
			if err := json.Unmarshal(body, &payload); err != nil {
				t.Fatalf("decode Outlook patch payload failed: %v", err)
			}
			if !payload["isRead"] {
				t.Fatalf("expected Outlook message to be marked read, got %+v", payload)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"outlook-msg-1"}`))
		default:
			t.Fatalf("unexpected Graph path: %s", r.URL.Path)
		}
	}))
	defer graphServer.Close()
	t.Setenv("OUTLOOK_GRAPH_BASE_URL", graphServer.URL)

	store := NewMemoryStore()
	platformServer := NewServer(store)
	startTestEmailOutbox(t, platformServer)
	server := httptest.NewServer(platformServer.Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)
	var admin User
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/auth/me", adminToken, nil, http.StatusOK, &admin)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Outlook Reply Shop"}, http.StatusCreated, &shop)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: admin.ID}, http.StatusCreated, nil)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{
		Type:     SourceTypeEmail,
		Provider: "outlook",
		Address:  "support@store.com",
	}, http.StatusCreated, &source)
	if _, err := store.SaveEmailInstallation(context.Background(), EmailInstallation{
		ShopID:       shop.ID,
		Mailbox:      "support@store.com",
		Provider:     "outlook",
		AccessToken:  "outlook-access-1",
		RefreshToken: "outlook-refresh-1",
		Scope:        defaultOutlookScopes,
		ExpiresAt:    time.Now().Add(time.Hour),
	}); err != nil {
		t.Fatalf("SaveEmailInstallation failed: %v", err)
	}
	var conversation Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations", adminToken, Conversation{
		ShopID:        shop.ID,
		SourceID:      source.ID,
		CustomerName:  "Buyer",
		CustomerEmail: "buyer@example.com",
		Subject:       "Order help",
	}, http.StatusCreated, &conversation)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/claim", adminToken, nil, http.StatusOK, nil)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", adminToken, Message{
		Direction:       MessageDirectionCustomer,
		Body:            "Where is my order?",
		Metadata:        map[string]string{"outlook_message_id": "outlook-msg-1", "outlook_conversation_id": "conv-a", "outlook_internet_message_id": "<outlook-msg-1@example.com>", "mail_message_id": "<outlook-msg-1@example.com>"},
		SourceMessageID: "outlook:outlook-msg-1",
	}, http.StatusCreated, nil)

	var reply Message
	request := Message{
		Direction: MessageDirectionAgent,
		Body:      "We are checking it now.",
		Metadata:  map[string]string{messageClientRequestIDKey: "request-outlook-1"},
	}
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", adminToken, request, http.StatusAccepted, &reply)
	reply = waitForEmailMessageStatus(t, store, conversation.ID, reply.ID, emailSendStatusSent)
	if replyCalls != 1 || !patchSeen {
		t.Fatalf("expected Outlook reply and mark-read calls, reply=%d patch=%v", replyCalls, patchSeen)
	}
	if reply.Metadata["mail_api_provider"] != "outlook" || reply.Metadata["outlook_conversation_id"] != "conv-a" {
		t.Fatalf("expected Outlook metadata on stored reply, got %#v", reply.Metadata)
	}
	var repeated Message
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", adminToken, request, http.StatusOK, &repeated)
	if repeated.ID != reply.ID || replyCalls != 1 {
		t.Fatalf("idempotent retry = %#v calls=%d; want existing message and one provider call", repeated, replyCalls)
	}
}

func TestAgentEmailReplyProviderFailureDoesNotRecordMessage(t *testing.T) {
	gmailServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/users/me/messages/send" {
			t.Fatalf("unexpected Gmail path: %s", r.URL.Path)
		}
		http.Error(w, "provider send failed", http.StatusBadGateway)
	}))
	defer gmailServer.Close()
	t.Setenv("GMAIL_API_BASE_URL", gmailServer.URL)

	store := NewMemoryStore()
	platformServer := NewServer(store)
	startTestEmailOutbox(t, platformServer)
	server := httptest.NewServer(platformServer.Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)
	var admin User
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/auth/me", adminToken, nil, http.StatusOK, &admin)
	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Provider Failure Shop"}, http.StatusCreated, &shop)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: admin.ID}, http.StatusCreated, nil)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{
		Type:     SourceTypeEmail,
		Provider: "gmail",
		Address:  "support@store.com",
	}, http.StatusCreated, &source)
	if _, err := store.SaveEmailInstallation(context.Background(), EmailInstallation{
		ShopID:       shop.ID,
		Mailbox:      "support@store.com",
		Provider:     "gmail",
		AccessToken:  "gmail-access-1",
		RefreshToken: "gmail-refresh-1",
		Scope:        defaultGmailScopes,
		ExpiresAt:    time.Now().Add(time.Hour),
	}); err != nil {
		t.Fatalf("SaveEmailInstallation failed: %v", err)
	}
	var conversation Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations", adminToken, Conversation{
		ShopID:        shop.ID,
		SourceID:      source.ID,
		CustomerEmail: "buyer@example.com",
		Subject:       "Order help",
	}, http.StatusCreated, &conversation)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/claim", adminToken, nil, http.StatusOK, nil)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", adminToken, Message{
		Direction:       MessageDirectionCustomer,
		Body:            "Where is my order?",
		Metadata:        map[string]string{"gmail_message_id": "customer-msg-1", "gmail_thread_id": "thread-1", "mail_message_id": "<customer-msg-1@example.com>"},
		SourceMessageID: "gmail:customer-msg-1",
	}, http.StatusCreated, nil)

	var failedReply Message
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", adminToken, Message{
		Direction: MessageDirectionAgent,
		Body:      "We are checking it now.",
	}, http.StatusAccepted, &failedReply)
	failedReply = waitForEmailMessageStatus(t, store, conversation.ID, failedReply.ID, emailSendStatusReconciling)
	if !strings.Contains(failedReply.Metadata[emailSendErrorKey], "后台核对") {
		t.Fatalf("expected a visible reconciliation state, got %#v", failedReply.Metadata)
	}
	var messages []Message
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", adminToken, nil, http.StatusOK, &messages)
	if len(messages) != 2 || messages[1].Direction != MessageDirectionAgent {
		t.Fatalf("provider uncertainty must keep the local agent reply visible, got %#v", messages)
	}
}

func TestOutlookEmailReplyRefreshesExpiredToken(t *testing.T) {
	tokenServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Fatalf("parse token form failed: %v", err)
		}
		if r.Form.Get("grant_type") != "refresh_token" || r.Form.Get("refresh_token") != "outlook-refresh-1" {
			t.Fatalf("unexpected refresh form: %v", r.Form)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"outlook-access-2","scope":"offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send","expires_in":3600}`))
	}))
	defer tokenServer.Close()
	var replySeen bool
	graphServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer outlook-access-2" {
			t.Fatalf("expected refreshed Outlook token, got %q", r.Header.Get("Authorization"))
		}
		switch r.URL.Path {
		case "/me/messages/outlook-msg-1/reply":
			replySeen = true
			w.WriteHeader(http.StatusAccepted)
		case "/me/messages/outlook-msg-1":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"outlook-msg-1"}`))
		default:
			t.Fatalf("unexpected Graph path: %s", r.URL.Path)
		}
	}))
	defer graphServer.Close()
	t.Setenv("OUTLOOK_CLIENT_ID", "outlook-client-1")
	t.Setenv("OUTLOOK_CLIENT_SECRET", "outlook-secret-1")
	t.Setenv("OUTLOOK_TOKEN_URL", tokenServer.URL)
	t.Setenv("OUTLOOK_GRAPH_BASE_URL", graphServer.URL)

	store := NewMemoryStore()
	platformServer := NewServer(store)
	startTestEmailOutbox(t, platformServer)
	server := httptest.NewServer(platformServer.Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)
	var admin User
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/auth/me", adminToken, nil, http.StatusOK, &admin)
	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Outlook Refresh Reply Shop"}, http.StatusCreated, &shop)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: admin.ID}, http.StatusCreated, nil)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{
		Type:     SourceTypeEmail,
		Provider: "outlook",
		Address:  "support@store.com",
	}, http.StatusCreated, &source)
	if _, err := store.SaveEmailInstallation(context.Background(), EmailInstallation{
		ShopID:       shop.ID,
		Mailbox:      "support@store.com",
		Provider:     "outlook",
		AccessToken:  "expired-access",
		RefreshToken: "outlook-refresh-1",
		Scope:        defaultOutlookScopes,
		ExpiresAt:    time.Now().Add(-time.Minute),
	}); err != nil {
		t.Fatalf("SaveEmailInstallation failed: %v", err)
	}
	var conversation Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations", adminToken, Conversation{
		ShopID:        shop.ID,
		SourceID:      source.ID,
		CustomerEmail: "buyer@example.com",
		Subject:       "Order help",
	}, http.StatusCreated, &conversation)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/claim", adminToken, nil, http.StatusOK, nil)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", adminToken, Message{
		Direction:       MessageDirectionCustomer,
		Body:            "Where is my order?",
		Metadata:        map[string]string{"outlook_message_id": "outlook-msg-1", "outlook_conversation_id": "conv-a", "outlook_internet_message_id": "<outlook-msg-1@example.com>", "mail_message_id": "<outlook-msg-1@example.com>"},
		SourceMessageID: "outlook:outlook-msg-1",
	}, http.StatusCreated, nil)
	var reply Message
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", adminToken, Message{
		Direction: MessageDirectionAgent,
		Body:      "We are checking it now.",
	}, http.StatusAccepted, &reply)
	_ = waitForEmailMessageStatus(t, store, conversation.ID, reply.ID, emailSendStatusSent)
	if !replySeen {
		t.Fatalf("expected Outlook reply call")
	}
	installation, err := store.GetEmailInstallation(context.Background(), shop.ID, "support@store.com")
	if err != nil {
		t.Fatalf("GetEmailInstallation failed: %v", err)
	}
	if installation.AccessToken != "outlook-access-2" || installation.RefreshToken != "outlook-refresh-1" {
		t.Fatalf("expected refreshed access token and preserved refresh token, got %#v", installation)
	}
}

func TestAgentEmailReplyRetriesSameRequestAfterConversationIsClaimed(t *testing.T) {
	sendCount := 0
	gmailServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/users/me/messages/send":
			sendCount++
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"sent-after-claim","threadId":"thread-1"}`))
		case "/users/me/messages/customer-msg-1/modify":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"customer-msg-1"}`))
		default:
			t.Fatalf("unexpected Gmail API path: %s", r.URL.Path)
		}
	}))
	defer gmailServer.Close()
	t.Setenv("GMAIL_API_BASE_URL", gmailServer.URL)

	store := NewMemoryStore()
	platformServer := NewServer(store)
	startTestEmailOutbox(t, platformServer)
	server := httptest.NewServer(platformServer.Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)
	var admin User
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/auth/me", adminToken, nil, http.StatusOK, &admin)
	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Unclaimed Mail Shop"}, http.StatusCreated, &shop)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: admin.ID}, http.StatusCreated, nil)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{
		Type:     SourceTypeEmail,
		Provider: "gmail",
		Address:  "support@store.com",
	}, http.StatusCreated, &source)
	if _, err := store.SaveEmailInstallation(context.Background(), EmailInstallation{
		ShopID:       shop.ID,
		Mailbox:      "support@store.com",
		Provider:     "gmail",
		AccessToken:  "gmail-access-1",
		RefreshToken: "gmail-refresh-1",
		Scope:        defaultGmailScopes,
		ExpiresAt:    time.Now().Add(time.Hour),
	}); err != nil {
		t.Fatalf("SaveEmailInstallation failed: %v", err)
	}
	var conversation Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations", adminToken, Conversation{
		ShopID:        shop.ID,
		SourceID:      source.ID,
		CustomerEmail: "buyer@example.com",
		Subject:       "Order help",
	}, http.StatusCreated, &conversation)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", adminToken, Message{
		Direction:       MessageDirectionCustomer,
		Body:            "Where is my order?",
		Metadata:        map[string]string{"gmail_message_id": "customer-msg-1", "gmail_thread_id": "thread-1", "mail_message_id": "<customer-msg-1@example.com>"},
		SourceMessageID: "gmail:customer-msg-1",
	}, http.StatusCreated, nil)

	request := Message{
		Direction: MessageDirectionAgent,
		Body:      "We are checking it now.",
		Metadata:  map[string]string{messageClientRequestIDKey: "retry-after-claim-1"},
	}
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", adminToken, request, http.StatusConflict, nil)
	if sendCount != 0 {
		t.Fatalf("Gmail API was called before local validation")
	}
	key := emailOutboxKey(conversation.ID, "retry-after-claim-1")
	if _, found := store.emailOutbox[key]; found {
		t.Fatalf("local validation failure must not create an outbox record")
	}

	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/claim", adminToken, nil, http.StatusOK, nil)
	var reply Message
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", adminToken, request, http.StatusAccepted, &reply)
	_ = waitForEmailMessageStatus(t, store, conversation.ID, reply.ID, emailSendStatusSent)
	completed := store.emailOutbox[key]
	if sendCount != 1 || completed.Status != "completed" || completed.Attempts != 1 {
		t.Fatalf("same request was not safely retried after claim: sends=%d outbox=%#v", sendCount, completed)
	}
}

func TestGmailSyncIngestsUnreadThreadMetadata(t *testing.T) {
	messageBody := base64.RawURLEncoding.EncodeToString([]byte("When will this ship?"))
	imageBody := base64.RawURLEncoding.EncodeToString([]byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"))
	messageTimestamp := strconv.FormatInt(time.Now().UTC().Add(-time.Minute).UnixMilli(), 10)
	var sendSeen bool
	var modifyCount int
	gmailServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer gmail-access-1" {
			t.Fatalf("unexpected Gmail authorization header: %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/users/me/profile":
			_, _ = w.Write([]byte(`{"emailAddress":"support@store.com","historyId":"history-1"}`))
		case "/users/me/history":
			if r.URL.Query().Get("startHistoryId") != "history-0" {
				t.Fatalf("unexpected Gmail history query: %s", r.URL.RawQuery)
			}
			_, _ = w.Write([]byte(`{"history":[{"messagesAdded":[{"message":{"id":"gmail-msg-1","threadId":"gmail-thread-1"}}]}],"historyId":"history-1"}`))
		case "/users/me/messages/gmail-msg-1":
			_, _ = w.Write([]byte(`{
				"id":"gmail-msg-1",
				"threadId":"gmail-thread-1",
				"labelIds":["INBOX"],
				"internalDate":"` + messageTimestamp + `",
				"payload":{
					"mimeType":"multipart/mixed",
					"headers":[
						{"name":"From","value":"Mia <mia@example.com>"},
						{"name":"Subject","value":"Where is my order?"},
						{"name":"Message-ID","value":"<gmail-msg-1@example.com>"},
						{"name":"References","value":"<root@example.com>"}
					],
					"parts":[
						{"mimeType":"text/plain","body":{"data":"` + messageBody + `"}},
						{"mimeType":"image/png","filename":"photo.png","body":{"attachmentId":"att-1"}}
					]
				}
			}`))
		case "/users/me/threads/gmail-thread-1":
			_, _ = w.Write([]byte(`{"id":"gmail-thread-1","messages":[{
				"id":"gmail-msg-1","threadId":"gmail-thread-1","internalDate":"` + messageTimestamp + `",
				"payload":{"mimeType":"multipart/mixed","headers":[
					{"name":"From","value":"Mia <mia@example.com>"},{"name":"Subject","value":"Where is my order?"},
					{"name":"Message-ID","value":"<gmail-msg-1@example.com>"},{"name":"References","value":"<root@example.com>"}
				],"parts":[{"mimeType":"text/plain","body":{"data":"` + messageBody + `"}},{"mimeType":"image/png","filename":"photo.png","body":{"attachmentId":"att-1"}}]}
			}]}`))
		case "/users/me/messages/gmail-msg-1/attachments/att-1":
			_, _ = w.Write([]byte(`{"data":"` + imageBody + `"}`))
		case "/users/me/messages/send":
			sendSeen = true
			var payload struct {
				Raw      string `json:"raw"`
				ThreadID string `json:"threadId"`
			}
			body, _ := io.ReadAll(r.Body)
			if err := json.Unmarshal(body, &payload); err != nil {
				t.Fatalf("decode Gmail send payload failed: %v", err)
			}
			if payload.ThreadID != "gmail-thread-1" {
				t.Fatalf("expected reply to original Gmail thread, got %q", payload.ThreadID)
			}
			raw, err := base64.RawURLEncoding.DecodeString(payload.Raw)
			if err != nil {
				t.Fatalf("decode Gmail reply failed: %v", err)
			}
			if !strings.Contains(string(raw), "In-Reply-To: <gmail-msg-1@example.com>") {
				t.Fatalf("reply did not target original Gmail message: %s", string(raw))
			}
			_, _ = w.Write([]byte(`{"id":"sent-after-image","threadId":"gmail-thread-1"}`))
		case "/users/me/messages/gmail-msg-1/modify":
			modifyCount++
			_, _ = w.Write([]byte(`{"id":"gmail-msg-1"}`))
		default:
			t.Fatalf("unexpected Gmail API path: %s", r.URL.Path)
		}
	}))
	defer gmailServer.Close()
	t.Setenv("GMAIL_API_BASE_URL", gmailServer.URL)

	store := NewMemoryStore()
	platformServer := NewServer(store)
	startTestEmailOutbox(t, platformServer)
	server := httptest.NewServer(platformServer.Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)
	var admin User
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/auth/me", adminToken, nil, http.StatusOK, &admin)
	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Gmail Sync Shop"}, http.StatusCreated, &shop)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: admin.ID}, http.StatusCreated, nil)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{
		Type:     SourceTypeEmail,
		Provider: "gmail",
		Address:  "support@store.com",
	}, http.StatusCreated, &source)
	source.Metadata = newEmailSyncMetadata(source.Address, "oauth", emailInitialImportNow)
	source.Metadata[emailSyncStartedAtKey] = time.UnixMilli(1780000000000).UTC().Format(time.RFC3339Nano)
	source.Metadata[gmailHistoryIDKey] = "history-0"
	if _, err := store.UpdateShopSource(context.Background(), shop.ID, source.ID, ShopSource{Metadata: source.Metadata}); err != nil {
		t.Fatalf("seed Gmail cursor failed: %v", err)
	}
	if _, err := store.SaveEmailInstallation(context.Background(), EmailInstallation{
		ShopID:       shop.ID,
		Mailbox:      "support@store.com",
		Provider:     "gmail",
		AccessToken:  "gmail-access-1",
		RefreshToken: "gmail-refresh-1",
		Scope:        defaultGmailScopes,
		ExpiresAt:    time.Now().Add(time.Hour),
	}); err != nil {
		t.Fatalf("SaveEmailInstallation failed: %v", err)
	}
	result, err := platformServer.syncShopEmailProvider(context.Background(), shop.ID, "gmail")
	if err != nil {
		t.Fatalf("syncShopEmailProvider failed: %v", err)
	}
	if result.SourcesScanned != 1 || result.ConversationsCreated != 1 || result.MessagesCreated != 1 || len(result.Warnings) != 0 {
		t.Fatalf("unexpected Gmail sync result: %#v", result)
	}
	var conversations []Conversation
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations?shopId="+shop.ID, adminToken, nil, http.StatusOK, &conversations)
	if len(conversations) != 1 || conversations[0].CustomerEmail != "mia@example.com" || conversations[0].SourceID != source.ID {
		t.Fatalf("unexpected synced conversation: %#v", conversations)
	}
	var messages []Message
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations/"+conversations[0].ID+"/messages", adminToken, nil, http.StatusOK, &messages)
	if len(messages) != 1 || messages[0].SourceMessageID != "gmail:gmail-msg-1" || messages[0].Body != "When will this ship?" || messages[0].Metadata["email_attachment_archive_status"] != "queued" {
		t.Fatalf("unexpected synced message: %#v", messages)
	}
	if messages[0].Metadata["gmail_thread_id"] != "gmail-thread-1" || messages[0].Metadata["mail_message_id"] != "<gmail-msg-1@example.com>" {
		t.Fatalf("Gmail metadata was not preserved: %#v", messages[0].Metadata)
	}
	job, err := store.ClaimEmailAttachmentJob(context.Background(), nil, time.Now().UTC().Add(time.Second))
	if err != nil {
		t.Fatalf("claim Gmail attachment archive failed: %v", err)
	}
	platformServer.processEmailAttachmentArchiveJob(context.Background(), store, job)
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations/"+conversations[0].ID+"/messages", adminToken, nil, http.StatusOK, &messages)
	if len(messages) != 2 {
		t.Fatalf("Gmail attachment was not archived in the background: %#v", messages)
	}
	if messages[1].Type != MessageTypeImage || messages[1].Direction != MessageDirectionCustomer || messages[1].Metadata["url"] == "" || messages[1].Metadata["fileName"] != "photo.png" {
		t.Fatalf("Gmail image attachment was not ingested: %#v", messages[1])
	}
	if messages[1].Metadata["gmail_message_id"] != "gmail-msg-1" || messages[1].Metadata["gmail_thread_id"] != "gmail-thread-1" || messages[1].Metadata["mail_message_id"] != "<gmail-msg-1@example.com>" {
		t.Fatalf("Gmail image attachment did not inherit thread metadata: %#v", messages[1].Metadata)
	}
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversations[0].ID+"/claim", adminToken, nil, http.StatusOK, nil)
	var reply Message
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversations[0].ID+"/messages", adminToken, Message{
		Direction: MessageDirectionAgent,
		Body:      "We are checking this.",
	}, http.StatusAccepted, &reply)
	_ = waitForEmailMessageStatus(t, store, conversations[0].ID, reply.ID, emailSendStatusSent)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/email/gmail/messages/read-state", adminToken, emailReadStateRequest{
		Mailbox:   "support@store.com",
		MessageID: "gmail:gmail-msg-1",
		Read:      true,
	}, http.StatusOK, nil)
	if !sendSeen || modifyCount < 2 {
		t.Fatalf("expected Gmail reply and read-state to use original message, send=%v modifyCount=%d", sendSeen, modifyCount)
	}
}

func TestGmailReadStateRefreshesExpiredToken(t *testing.T) {
	tokenServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Fatalf("parse token form failed: %v", err)
		}
		if r.Form.Get("grant_type") != "refresh_token" || r.Form.Get("refresh_token") != "gmail-refresh-1" {
			t.Fatalf("unexpected refresh form: %v", r.Form)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"gmail-access-2","scope":"https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send","expires_in":3600}`))
	}))
	defer tokenServer.Close()
	var modifySeen bool
	gmailServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer gmail-access-2" {
			t.Fatalf("expected refreshed Gmail token, got %q", r.Header.Get("Authorization"))
		}
		if r.URL.Path != "/users/me/messages/gmail-msg-1/modify" {
			t.Fatalf("unexpected Gmail path: %s", r.URL.Path)
		}
		modifySeen = true
		var payload map[string][]string
		body, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(body, &payload); err != nil {
			t.Fatalf("decode Gmail modify payload failed: %v", err)
		}
		if strings.Join(payload["addLabelIds"], ",") != "UNREAD" {
			t.Fatalf("expected UNREAD to be added, got %+v", payload)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"gmail-msg-1"}`))
	}))
	defer gmailServer.Close()
	t.Setenv("GMAIL_CLIENT_ID", "gmail-client-1")
	t.Setenv("GMAIL_CLIENT_SECRET", "gmail-secret-1")
	t.Setenv("GMAIL_TOKEN_URL", tokenServer.URL)
	t.Setenv("GMAIL_API_BASE_URL", gmailServer.URL)

	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)
	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Gmail Read State Shop"}, http.StatusCreated, &shop)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{
		Type:     SourceTypeEmail,
		Provider: "gmail",
		Address:  "support@store.com",
	}, http.StatusCreated, nil)
	if _, err := store.SaveEmailInstallation(context.Background(), EmailInstallation{
		ShopID:       shop.ID,
		Mailbox:      "support@store.com",
		Provider:     "gmail",
		AccessToken:  "expired-access",
		RefreshToken: "gmail-refresh-1",
		Scope:        defaultGmailScopes,
		ExpiresAt:    time.Now().Add(-time.Minute),
	}); err != nil {
		t.Fatalf("SaveEmailInstallation failed: %v", err)
	}
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/email/gmail/messages/read-state", adminToken, emailReadStateRequest{
		Mailbox:   "support@store.com",
		MessageID: "gmail:gmail-msg-1",
		Read:      false,
	}, http.StatusOK, nil)
	if !modifySeen {
		t.Fatalf("expected Gmail modify call")
	}
	installation, err := store.GetEmailInstallation(context.Background(), shop.ID, "support@store.com")
	if err != nil {
		t.Fatalf("GetEmailInstallation failed: %v", err)
	}
	if installation.AccessToken != "gmail-access-2" || installation.RefreshToken != "gmail-refresh-1" {
		t.Fatalf("expected refreshed access token and preserved refresh token, got %#v", installation)
	}
}

func TestOutlookSyncIngestsUnreadConversationMetadata(t *testing.T) {
	receivedAt := time.Now().UTC().Add(-time.Hour).Format(time.RFC3339)
	var graphServer *httptest.Server
	graphServer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer outlook-access-1" {
			t.Fatalf("unexpected Graph authorization header: %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/me/mailFolders/inbox/messages/delta":
			if r.URL.Query().Get("$deltatoken") != "current" {
				t.Fatalf("unexpected Graph query: %s", r.URL.RawQuery)
			}
			_, _ = w.Write([]byte(`{"value":[{
			"id":"outlook-msg-1",
			"conversationId":"outlook-conv-1",
			"internetMessageId":"<outlook-msg-1@example.com>",
			"subject":"Where is my order?",
			"receivedDateTime":"` + receivedAt + `",
			"bodyPreview":"When will this ship?",
			"from":{"emailAddress":{"name":"Mia","address":"mia@example.com"}},
			"body":{"contentType":"text","content":"When will this ship?"}
		}],"@odata.deltaLink":"` + graphServer.URL + `/me/mailFolders/inbox/messages/delta?$deltatoken=next"}`))
		case "/me/messages":
			_, _ = w.Write([]byte(`{"value":[{"id":"outlook-old","conversationId":"outlook-conv-1","internetMessageId":"<outlook-old@example.com>","subject":"Old context","receivedDateTime":"2026-07-01T12:30:00Z","from":{"emailAddress":{"name":"Mia","address":"mia@example.com"}},"body":{"contentType":"text","content":"Before the import window"}},{"id":"outlook-msg-1","conversationId":"outlook-conv-1","internetMessageId":"<outlook-msg-1@example.com>","subject":"Where is my order?","receivedDateTime":"` + receivedAt + `","bodyPreview":"When will this ship?","from":{"emailAddress":{"name":"Mia","address":"mia@example.com"}},"body":{"contentType":"text","content":"When will this ship?"}}]}`))
		case "/me/mailFolders/sentitems/messages":
			_, _ = w.Write([]byte(`{"value":[]}`))
		default:
			t.Fatalf("unexpected Graph path: %s", r.URL.Path)
		}
	}))
	defer graphServer.Close()
	t.Setenv("OUTLOOK_GRAPH_BASE_URL", graphServer.URL)

	store := NewMemoryStore()
	platformServer := NewServer(store)
	server := httptest.NewServer(platformServer.Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)
	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Outlook Sync Shop"}, http.StatusCreated, &shop)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{
		Type:     SourceTypeEmail,
		Provider: "outlook",
		Address:  "support@store.com",
	}, http.StatusCreated, &source)
	source.Metadata = newEmailSyncMetadata(source.Address, "oauth", emailInitialImportNow)
	source.Metadata[emailSyncStartedAtKey] = time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339Nano)
	source.Metadata[outlookDeltaLinkKey] = graphServer.URL + "/me/mailFolders/inbox/messages/delta?$deltatoken=current"
	if _, err := store.UpdateShopSource(context.Background(), shop.ID, source.ID, ShopSource{Metadata: source.Metadata}); err != nil {
		t.Fatalf("seed Outlook cursor failed: %v", err)
	}
	if _, err := store.SaveEmailInstallation(context.Background(), EmailInstallation{
		ShopID:       shop.ID,
		Mailbox:      "support@store.com",
		Provider:     "outlook",
		AccessToken:  "outlook-access-1",
		RefreshToken: "outlook-refresh-1",
		Scope:        defaultOutlookScopes,
		ExpiresAt:    time.Now().Add(time.Hour),
	}); err != nil {
		t.Fatalf("SaveEmailInstallation failed: %v", err)
	}
	result, err := platformServer.syncShopEmailProvider(context.Background(), shop.ID, "outlook")
	if err != nil {
		t.Fatalf("syncShopEmailProvider failed: %v", err)
	}
	if result.SourcesScanned != 1 || result.ConversationsCreated != 1 || result.MessagesCreated != 2 || len(result.Warnings) != 0 {
		t.Fatalf("unexpected Outlook sync result: %#v", result)
	}
	var conversations []Conversation
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations?shopId="+shop.ID, adminToken, nil, http.StatusOK, &conversations)
	if len(conversations) != 1 || conversations[0].CustomerEmail != "mia@example.com" || conversations[0].SourceID != source.ID {
		t.Fatalf("unexpected synced Outlook conversation: %#v", conversations)
	}
	var messages []Message
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations/"+conversations[0].ID+"/messages", adminToken, nil, http.StatusOK, &messages)
	if len(messages) != 2 || messages[0].SourceMessageID != "outlook:outlook-old" || messages[1].SourceMessageID != "outlook:outlook-msg-1" || messages[1].Body != "When will this ship?" {
		t.Fatalf("unexpected synced Outlook message: %#v", messages)
	}
	if messages[1].Metadata["outlook_conversation_id"] != "outlook-conv-1" || messages[1].Metadata["outlook_internet_message_id"] != "<outlook-msg-1@example.com>" {
		t.Fatalf("Outlook metadata was not preserved: %#v", messages[1].Metadata)
	}
}

func TestEmailSyncConsumesGmailAndOutlookPagination(t *testing.T) {
	var gmailListCalls int
	gmailServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/users/me/profile":
			_, _ = w.Write([]byte(`{"emailAddress":"support@store.com","historyId":"history-agent"}`))
		case "/users/me/messages":
			gmailListCalls++
			if r.URL.Query().Get("q") != "in:inbox is:unread newer_than:7d" || r.URL.Query().Get("maxResults") != "100" {
				t.Fatalf("unexpected Gmail pagination query: %s", r.URL.RawQuery)
			}
			if gmailListCalls == 1 {
				_, _ = w.Write([]byte(`{"messages":[{"id":"gmail-page-1","threadId":"thread-1"}],"nextPageToken":"page-2"}`))
				return
			}
			if r.URL.Query().Get("pageToken") != "page-2" {
				t.Fatalf("expected Gmail pageToken page-2, got %q", r.URL.Query().Get("pageToken"))
			}
			_, _ = w.Write([]byte(`{"messages":[{"id":"gmail-page-2","threadId":"thread-2"}]}`))
		case "/users/me/messages/gmail-page-1":
			_, _ = w.Write([]byte(`{"id":"gmail-page-1","threadId":"thread-1","payload":{"headers":[{"name":"From","value":"One <one@example.com>"},{"name":"Message-ID","value":"<one@example.com>"}],"body":{"data":"b25l"}}}`))
		case "/users/me/messages/gmail-page-2":
			_, _ = w.Write([]byte(`{"id":"gmail-page-2","threadId":"thread-2","payload":{"headers":[{"name":"From","value":"Two <two@example.com>"},{"name":"Message-ID","value":"<two@example.com>"}],"body":{"data":"dHdv"}}}`))
		default:
			t.Fatalf("unexpected Gmail pagination path: %s", r.URL.Path)
		}
	}))
	defer gmailServer.Close()
	t.Setenv("GMAIL_API_BASE_URL", gmailServer.URL)
	gmailMessages, err := fetchGmailUnreadEmails(context.Background(), "gmail-access")
	if err != nil || len(gmailMessages) != 2 || gmailListCalls != 2 {
		t.Fatalf("Gmail pagination failed: messages=%#v calls=%d err=%v", gmailMessages, gmailListCalls, err)
	}

	var graphServer *httptest.Server
	var outlookListCalls int
	graphServer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		outlookListCalls++
		switch r.URL.Path {
		case "/me/mailFolders/inbox/messages":
			_, _ = w.Write([]byte(`{"value":[{"id":"outlook-page-1","conversationId":"conversation-1","internetMessageId":"<one@example.com>","bodyPreview":"short one","body":{"contentType":"text","content":"full body one"}}],"@odata.nextLink":"` + graphServer.URL + `/next"}`))
		case "/next":
			_, _ = w.Write([]byte(`{"value":[{"id":"outlook-page-2","conversationId":"conversation-2","internetMessageId":"<two@example.com>","bodyPreview":"short two","body":{"contentType":"text","content":"full body two"}}]}`))
		default:
			t.Fatalf("unexpected Outlook pagination path: %s", r.URL.Path)
		}
	}))
	defer graphServer.Close()
	t.Setenv("OUTLOOK_GRAPH_BASE_URL", graphServer.URL)
	outlookMessages, err := fetchOutlookUnreadEmails(context.Background(), "outlook-access")
	if err != nil || len(outlookMessages) != 2 || outlookListCalls != 2 {
		t.Fatalf("Outlook pagination failed: messages=%#v calls=%d err=%v", outlookMessages, outlookListCalls, err)
	}
	if outlookMessages[0].Body != "full body one" || outlookMessages[1].Body != "full body two" {
		t.Fatalf("Outlook sync did not preserve full bodies: %#v", outlookMessages)
	}
}

func TestEmailAttachmentRetriesAfterBodyWasStored(t *testing.T) {
	store := NewMemoryStore()
	shop, err := store.CreateShop(context.Background(), Shop{DisplayName: "Attachment Retry Shop"})
	if err != nil {
		t.Fatalf("CreateShop failed: %v", err)
	}
	source, err := store.CreateShopSource(context.Background(), ShopSource{
		ShopID:   shop.ID,
		Type:     SourceTypeEmail,
		Provider: "gmail",
		Address:  "support@store.com",
	})
	if err != nil {
		t.Fatalf("CreateShopSource failed: %v", err)
	}
	platformServer := NewServer(store)
	blockedPath := t.TempDir() + "/not-a-directory"
	if err := os.WriteFile(blockedPath, []byte("blocked"), 0600); err != nil {
		t.Fatalf("create blocked upload path failed: %v", err)
	}
	platformServer.uploadDir = blockedPath
	input := incomingEmailMessage{
		ExternalConversationID: "thread-1",
		CustomerEmail:          "buyer@example.com",
		Body:                   "body stored first",
		SourceMessageID:        "gmail:message-1",
		Attachments: []incomingEmailAttachment{{
			FileName: "photo.png",
			MIMEType: "image/png",
			Content:  []byte("png-content"),
		}},
		ReceivedAt: time.Now().UTC(),
	}
	_, bodyCreated, _, err := platformServer.ingestProviderEmail(context.Background(), shop.ID, source, input)
	if err == nil || !bodyCreated {
		t.Fatalf("expected attachment storage failure after body creation, bodyCreated=%v err=%v", bodyCreated, err)
	}
	platformServer.uploadDir = t.TempDir()
	_, bodyCreated, skipped, err := platformServer.ingestProviderEmail(context.Background(), shop.ID, source, input)
	if err != nil || bodyCreated || skipped {
		t.Fatalf("expected attachment-only retry, bodyCreated=%v skipped=%v err=%v", bodyCreated, skipped, err)
	}
	messages, err := store.ListMessages(context.Background(), stableExternalConversationID(source.ID, input.ExternalConversationID))
	if err != nil || len(messages) != 2 || messages[1].SourceMessageID != "gmail:message-1:attachment:0" {
		t.Fatalf("attachment retry did not complete idempotently: messages=%#v err=%v", messages, err)
	}
}

func TestOversizedEmailAttachmentDoesNotBlockMessageIngest(t *testing.T) {
	store := NewMemoryStore()
	shop, _ := store.CreateShop(context.Background(), Shop{DisplayName: "Oversized Attachment Shop"})
	source, _ := store.CreateShopSource(context.Background(), ShopSource{
		ShopID: shop.ID, Type: SourceTypeEmail, Provider: "gmail", Address: "support@store.com",
	})
	platformServer := NewServer(store)
	platformServer.uploadDir = t.TempDir()
	input := incomingEmailMessage{
		ExternalConversationID: "thread-oversized",
		CustomerEmail:          "buyer@example.com",
		Body:                   "keep this customer message",
		SourceMessageID:        "gmail:message-oversized",
		ReceivedAt:             time.Now().UTC(),
		Attachments: []incomingEmailAttachment{{
			FileName: "oversized.png",
			MIMEType: "image/png",
			Content:  make([]byte, maxEmailAttachmentSize+1),
		}},
	}
	_, created, skipped, err := platformServer.ingestProviderEmail(context.Background(), shop.ID, source, input)
	if err != nil || !created || skipped {
		t.Fatalf("oversized attachment blocked the email body: created=%v skipped=%v err=%v", created, skipped, err)
	}
	messages, err := store.ListMessages(context.Background(), stableExternalConversationID(source.ID, input.ExternalConversationID))
	if err != nil || len(messages) != 1 || messages[0].Body != input.Body {
		t.Fatalf("email body was not preserved after oversized attachment skip: %#v err=%v", messages, err)
	}
}

func TestDisabledEmailSourceBlocksReadStateAndAllFailedSync(t *testing.T) {
	store := NewMemoryStore()
	shop, err := store.CreateShop(context.Background(), Shop{DisplayName: "Disabled Email Shop"})
	if err != nil {
		t.Fatalf("CreateShop failed: %v", err)
	}
	_, err = store.CreateShopSource(context.Background(), ShopSource{
		ShopID:   shop.ID,
		Type:     SourceTypeEmail,
		Provider: "gmail",
		Address:  "support@store.com",
		Status:   SourceStatusDisabled,
	})
	if err != nil {
		t.Fatalf("CreateShopSource failed: %v", err)
	}
	if _, err := store.SaveEmailInstallation(context.Background(), EmailInstallation{
		ShopID:      shop.ID,
		Mailbox:     "support@store.com",
		Provider:    "gmail",
		AccessToken: "gmail-access",
		Scope:       defaultGmailScopes,
		ExpiresAt:   time.Now().Add(time.Hour),
	}); err != nil {
		t.Fatalf("SaveEmailInstallation failed: %v", err)
	}
	platformServer := NewServer(store)
	err = platformServer.setEmailMessageReadState(context.Background(), shop.ID, "gmail", emailReadStateRequest{
		Mailbox:   "support@store.com",
		MessageID: "gmail:message-1",
		Read:      true,
	})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("disabled email source must block provider read-state change, got %v", err)
	}
	_, err = store.CreateShopSource(context.Background(), ShopSource{
		ShopID:   shop.ID,
		Type:     SourceTypeEmail,
		Provider: "gmail",
		Address:  "missing-authorization@store.com",
	})
	if err != nil {
		t.Fatalf("CreateShopSource for failed sync failed: %v", err)
	}
	_, err = platformServer.syncShopEmailProvider(context.Background(), shop.ID, "gmail")
	if !errors.Is(err, ErrInvalid) || !strings.Contains(err.Error(), "email sync failed for every gmail mailbox") {
		t.Fatalf("sync when every active source fails must return failure, got %v", err)
	}
}

func TestGmailCallbackReturnsActionablePageWhenAuthorizationIsDenied(t *testing.T) {
	t.Setenv("GMAIL_CLIENT_ID", "gmail-client-1")
	t.Setenv("GMAIL_CLIENT_SECRET", "gmail-secret-1")
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()

	resp, err := http.Get(server.URL + "/gmail/callback?error=access_denied&error_description=user+cancelled")
	if err != nil {
		t.Fatalf("GET Gmail denied callback failed: %v", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	page := string(raw)
	if resp.StatusCode != http.StatusBadRequest || !strings.Contains(page, "Gmail 授权未完成") || !strings.Contains(page, "返回 Xzdesk") {
		t.Fatalf("unexpected Gmail denial page: status=%d body=%s", resp.StatusCode, page)
	}
	if strings.Contains(page, "access_denied") || strings.Contains(page, "user cancelled") {
		t.Fatalf("Gmail denial page exposed provider details: %s", page)
	}
}

func TestGmailCallbackSanitizesTokenExchangeFailure(t *testing.T) {
	tokenServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "provider-secret-debug-detail", http.StatusBadRequest)
	}))
	defer tokenServer.Close()

	t.Setenv("GMAIL_CLIENT_ID", "gmail-client-1")
	t.Setenv("GMAIL_CLIENT_SECRET", "gmail-secret-1")
	t.Setenv("GMAIL_TOKEN_URL", tokenServer.URL)
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)
	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Gmail Error Shop", Platform: "shopify", ExternalID: "gmail-error-shop.myshopify.com"}, http.StatusCreated, &shop)

	state := signedOutlookState(shop.ID, "gmail-secret-1")
	resp, err := http.Get(server.URL + "/gmail/callback?code=bad-code&state=" + url.QueryEscape(state))
	if err != nil {
		t.Fatalf("GET Gmail token failure callback failed: %v", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	page := string(raw)
	if resp.StatusCode != http.StatusBadGateway || !strings.Contains(page, "Gmail 授权凭证交换失败") || !strings.Contains(page, "重新发起授权") {
		t.Fatalf("unexpected Gmail token failure page: status=%d body=%s", resp.StatusCode, page)
	}
	if strings.Contains(page, "provider-secret-debug-detail") {
		t.Fatalf("Gmail token failure page exposed provider response: %s", page)
	}
}

func TestServerBootstrapStatusAndCORS(t *testing.T) {
	app := NewServer(NewMemoryStore())
	app.ConfigureAllowedOrigins([]string{"https://erp.example.test"})
	server := httptest.NewServer(app.Routes())
	defer server.Close()

	var status struct {
		NeedsBootstrap bool `json:"needsBootstrap"`
	}
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/bootstrap/status", "", nil, http.StatusOK, &status)
	if !status.NeedsBootstrap {
		t.Fatalf("expected bootstrap to be needed: %#v", status)
	}

	req, err := http.NewRequest(http.MethodOptions, server.URL+"/api/v1/shops", nil)
	if err != nil {
		t.Fatalf("create OPTIONS request failed: %v", err)
	}
	req.Header.Set("Origin", "https://erp.example.test")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("OPTIONS failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent || resp.Header.Get("Access-Control-Allow-Origin") != "https://erp.example.test" {
		t.Fatalf("unexpected CORS response: status=%d headers=%v", resp.StatusCode, resp.Header)
	}
}

func TestChatWidgetScriptForcesLauncherFixedPosition(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()

	resp, err := http.Get(server.URL + "/chat/widget.js?shop=demo.myshopify.com")
	if err != nil {
		t.Fatalf("GET widget script failed: %v", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read widget script failed: %v", err)
	}
	script := string(body)
	for _, want := range []string{
		".xzdesk-chat-button{position:fixed!important",
		`button.style.setProperty("position", "fixed", "important")`,
		`button.style.setProperty("bottom", bottom + "px", "important")`,
		`var form = panel.querySelector(".xzdesk-chat-form")`,
		`async function send(body)`,
		`function appendMessages(nextMessages)`,
		`appendMessages([message])`,
		`if (submitButton.disabled) return`,
		`bodyInput.addEventListener("keydown"`,
		`form.requestSubmit()`,
		`message.direction === "agent" ? t("supportTeam")`,
	} {
		if !strings.Contains(script, want) {
			t.Fatalf("widget script is missing %q", want)
		}
	}
	if strings.Contains(script, "form.elements.name") {
		t.Fatal("widget script must not read form.elements.name; it resolves to the form name property in browsers")
	}
	if strings.Contains(script, `form.querySelector('[name="name"]')`) ||
		strings.Contains(script, `form.querySelector('[name="email"]')`) {
		t.Fatal("widget script must not collect contact details for ordinary chat messages")
	}
}

func TestServerEventsWebSocketRequiresAuthAndReceivesEvents(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()

	_, resp, err := websocket.DefaultDialer.Dial(wsURL(server.URL)+"/ws/events", websocketHeaders(server.URL))
	if err == nil {
		t.Fatal("expected websocket dial without token to fail")
	}
	if resp == nil || resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unexpected unauthorized websocket response: resp=%#v err=%v", resp, err)
	}

	adminToken := bootstrapAdmin(t, server.URL)
	conn := dialEventWebSocket(t, server.URL, adminToken)
	defer conn.Close()
	if err := conn.SetReadDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatalf("SetReadDeadline failed: %v", err)
	}

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Event Shop"}, http.StatusCreated, &shop)

	var event Event
	if err := conn.ReadJSON(&event); err != nil {
		t.Fatalf("ReadJSON failed: %v", err)
	}
	if event.Type != "shop.created" || event.ShopID != shop.ID {
		t.Fatalf("unexpected event: %#v", event)
	}
}

func TestPublicChatCreatesConversationAndNotifiesAgent(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var agent User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{Email: "public-event-agent@example.com", DisplayName: "Public Event Agent", Password: "agent-password", Role: UserRoleAgent}, http.StatusCreated, &agent)
	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{Email: agent.Email, Password: "agent-password"}, http.StatusOK, &login)
	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Public Shop", ExternalID: "demo.myshopify.com"}, http.StatusCreated, &shop)
	allowAnonymousPublicChat(t, server.URL, adminToken, shop.ID)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: agent.ID}, http.StatusCreated, nil)

	conn := dialEventWebSocket(t, server.URL, login.Token)
	defer conn.Close()
	if err := conn.SetReadDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatalf("SetReadDeadline failed: %v", err)
	}

	var created publicChatConversationResponse
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/public/chat/conversations", "", publicChatConversationRequest{
		Shop:          "demo.myshopify.com",
		CustomerName:  "Mia",
		CustomerEmail: "mia@example.com",
		Body:          "When will this ship?",
		VisitorID:     "visitor-1",
	}, http.StatusCreated, &created)
	if created.Conversation.ID == "" || created.Conversation.ShopID != shop.ID {
		t.Fatalf("unexpected public conversation: %#v", created.Conversation)
	}
	if created.Source.Type != SourceTypeShopifyChat {
		t.Fatalf("unexpected public chat source: %#v", created.Source)
	}
	if len(created.Messages) != 1 || created.Messages[0].Direction != MessageDirectionCustomer {
		t.Fatalf("unexpected public message response: %#v", created.Messages)
	}

	events := readWebSocketEvents(t, conn, 2)
	if events[0].Type != "conversation.created" || events[1].Type != "message.created" {
		t.Fatalf("unexpected websocket events: %#v", events)
	}
}

func TestPublicChatAssignedAgentSeesUnreadQueueConversation(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var agent User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email:       "agent@example.com",
		DisplayName: "Agent",
		Password:    "agent-password",
		Role:        UserRoleAgent,
	}, http.StatusCreated, &agent)
	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{Email: "agent@example.com", Password: "agent-password"}, http.StatusOK, &login)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Assigned Public Shop", ExternalID: "assigned-public.myshopify.com"}, http.StatusCreated, &shop)
	allowAnonymousPublicChat(t, server.URL, adminToken, shop.ID)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: agent.ID}, http.StatusCreated, nil)

	conn := dialEventWebSocket(t, server.URL, login.Token)
	defer conn.Close()
	if err := conn.SetReadDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatalf("SetReadDeadline failed: %v", err)
	}

	var created publicChatConversationResponse
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/public/chat/conversations", "", publicChatConversationRequest{
		Shop:      "assigned-public.myshopify.com",
		Body:      "New customer question",
		VisitorID: "visitor-assigned-agent",
	}, http.StatusCreated, &created)

	events := make([]Event, 0, 4)
	receivedCreated := false
	receivedMessage := false
	for len(events) < 4 && (!receivedCreated || !receivedMessage) {
		next := readWebSocketEvents(t, conn, 1)[0]
		events = append(events, next)
		if next.EntityID == created.Conversation.ID && next.Type == "conversation.created" {
			receivedCreated = true
		}
		if next.Type == "message.created" && next.Conversation != nil && next.Conversation.ID == created.Conversation.ID {
			receivedMessage = true
		}
	}
	if !receivedCreated || !receivedMessage {
		t.Fatalf("agent did not receive public chat ingress events: %#v", events)
	}

	var conversations []Conversation
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations?scope=assigned", login.Token, nil, http.StatusOK, &conversations)
	if len(conversations) != 1 || conversations[0].ID != created.Conversation.ID || conversations[0].Status != ConversationStatusAssigned || conversations[0].AssignedAgentID != agent.ID || !conversations[0].Unread {
		t.Fatalf("expected one unread automatically assigned conversation, got %#v", conversations)
	}
}

func TestPublicChatFollowUpMessageAcceptsCachedWidgetPayload(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Cached Widget Shop", ExternalID: "cached-widget.myshopify.com"}, http.StatusCreated, &shop)
	allowAnonymousPublicChat(t, server.URL, adminToken, shop.ID)
	var created publicChatConversationResponse
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/public/chat/conversations", "", publicChatConversationRequest{Shop: shop.ExternalID, Body: "First message", VisitorID: "visitor-cached"}, http.StatusCreated, &created)

	var message Message
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/public/chat/conversations/"+created.Conversation.ID+"/messages", "", map[string]string{
		"shop":      shop.ExternalID,
		"body":      "Second message",
		"visitorId": "visitor-cached",
	}, http.StatusCreated, &message)
	if message.Body != "Second message" || message.ConversationID != created.Conversation.ID {
		t.Fatalf("unexpected follow-up message: %#v", message)
	}
}

func TestPublicChatRetriesFirstMessageIdempotently(t *testing.T) {
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Retry Shop", ExternalID: "retry.myshopify.com"}, http.StatusCreated, &shop)
	allowAnonymousPublicChat(t, server.URL, adminToken, shop.ID)
	conn := dialEventWebSocket(t, server.URL, adminToken)
	defer conn.Close()
	input := publicChatConversationRequest{
		Shop:            shop.ExternalID,
		Body:            "Please keep this message",
		VisitorID:       "visitor-retry",
		ClientMessageID: "client_first_001",
	}
	var first publicChatConversationResponse
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/public/chat/conversations", "", input, http.StatusCreated, &first)
	events := readWebSocketEvents(t, conn, 2)
	if events[0].Type != "conversation.created" || events[1].Type != "message.created" {
		t.Fatalf("unexpected initial retry-test events: %#v", events)
	}
	var retried publicChatConversationResponse
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/public/chat/conversations", "", input, http.StatusCreated, &retried)
	if err := conn.SetReadDeadline(time.Now().Add(250 * time.Millisecond)); err != nil {
		t.Fatal(err)
	}
	var duplicate Event
	if err := conn.ReadJSON(&duplicate); err == nil {
		t.Fatalf("idempotent retry broadcast a duplicate event: %#v", duplicate)
	}

	if retried.Conversation.ID != first.Conversation.ID || len(first.Messages) != 1 || len(retried.Messages) != 1 || retried.Messages[0].ID != first.Messages[0].ID {
		t.Fatalf("retried first message was not idempotent: first=%#v retried=%#v", first, retried)
	}
	conversations, err := store.ListConversations(context.Background(), ConversationFilter{ShopID: shop.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(conversations) != 1 {
		t.Fatalf("retry created %d conversations, want 1", len(conversations))
	}
	messages, err := store.ListMessages(context.Background(), first.Conversation.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 1 {
		t.Fatalf("retry stored %d messages, want 1", len(messages))
	}
}

func TestPublicChatRetriesFollowUpMessageIdempotently(t *testing.T) {
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Follow-up Retry Shop", ExternalID: "follow-up-retry.myshopify.com"}, http.StatusCreated, &shop)
	allowAnonymousPublicChat(t, server.URL, adminToken, shop.ID)
	var created publicChatConversationResponse
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/public/chat/conversations", "", publicChatConversationRequest{
		Shop: shop.ExternalID, Body: "First", VisitorID: "visitor-follow-up", ClientMessageID: "client_first_002",
	}, http.StatusCreated, &created)

	path := server.URL + "/api/v1/public/chat/conversations/" + created.Conversation.ID + "/messages"
	input := publicChatMessageRequest{Body: "Same body", VisitorID: "visitor-follow-up", ClientMessageID: "client_follow_001"}
	var first Message
	requestJSON(t, http.MethodPost, path, "", input, http.StatusCreated, &first)
	var retried Message
	requestJSON(t, http.MethodPost, path, "", input, http.StatusCreated, &retried)
	if retried.ID != first.ID {
		t.Fatalf("retried follow-up message id=%q want %q", retried.ID, first.ID)
	}
	var distinct Message
	input.ClientMessageID = "client_follow_002"
	requestJSON(t, http.MethodPost, path, "", input, http.StatusCreated, &distinct)
	if distinct.ID == first.ID {
		t.Fatal("different client message ids must create different messages")
	}
	messages, err := store.ListMessages(context.Background(), created.Conversation.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 3 {
		t.Fatalf("stored %d messages, want initial plus two distinct follow-ups", len(messages))
	}
}

func TestPublicChatRejectsInvalidClientMessageID(t *testing.T) {
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Invalid ID Shop", ExternalID: "invalid-id.myshopify.com"}, http.StatusCreated, &shop)
	allowAnonymousPublicChat(t, server.URL, adminToken, shop.ID)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/public/chat/conversations", "", publicChatConversationRequest{
		Shop: shop.ExternalID, Body: "Do not store", VisitorID: "visitor-invalid", ClientMessageID: "invalid client id",
	}, http.StatusBadRequest, nil)

	conversations, err := store.ListConversations(context.Background(), ConversationFilter{ShopID: shop.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(conversations) != 0 {
		t.Fatalf("invalid client message id created conversations: %#v", conversations)
	}
}

func TestPublicChatMatchesExistingChatSourceDomain(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Source Domain Shop"}, http.StatusCreated, &shop)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{
		Type:     SourceTypeShopifyChat,
		Provider: "xzdesk_widget",
		Address:  "source-domain.myshopify.com",
	}, http.StatusCreated, &source)
	allowAnonymousPublicChat(t, server.URL, adminToken, shop.ID)

	var created publicChatConversationResponse
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/public/chat/conversations", "", publicChatConversationRequest{
		Shop:      "source-domain.myshopify.com",
		Body:      "Can you help?",
		VisitorID: "visitor-source-domain",
	}, http.StatusCreated, &created)

	if created.Conversation.ShopID != shop.ID || created.Source.ID != source.ID {
		t.Fatalf("public chat did not resolve the existing chat source: %#v", created)
	}
}

func TestPublicChatMatchesExistingShopifyAPISourceDomain(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "API Domain Shop"}, http.StatusCreated, &shop)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{
		Type:     SourceTypeShopifyAPI,
		Provider: "shopify_app",
		Address:  "api-domain.myshopify.com",
	}, http.StatusCreated, &source)
	allowAnonymousPublicChat(t, server.URL, adminToken, shop.ID)

	var created publicChatConversationResponse
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/public/chat/conversations", "", publicChatConversationRequest{
		Shop:      "api-domain.myshopify.com",
		Body:      "Can you help?",
		VisitorID: "visitor-api-domain",
	}, http.StatusCreated, &created)

	if created.Conversation.ShopID != shop.ID {
		t.Fatalf("public chat did not resolve the existing Shopify API source shop: %#v", created)
	}
	if created.Source.ID == source.ID || created.Source.Type != SourceTypeShopifyChat || created.Source.ShopID != shop.ID {
		t.Fatalf("public chat should create/use a chat source on the matched API source shop: %#v", created.Source)
	}
}

func TestPublicChatHeartbeatRecordsWidgetRuntime(t *testing.T) {
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)
	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Widget Runtime Shop", ExternalID: "widget-runtime.myshopify.com"}, http.StatusCreated, &shop)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat, Provider: "xzdesk_widget", Address: "widget-runtime.myshopify.com"}, http.StatusCreated, &source)
	conn := dialEventWebSocket(t, server.URL, adminToken)
	defer conn.Close()
	if err := conn.SetReadDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatalf("SetReadDeadline failed: %v", err)
	}
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/public/chat/heartbeat", "", publicChatHeartbeatRequest{Shop: "widget-runtime.myshopify.com"}, http.StatusOK, nil)
	var event Event
	if err := conn.ReadJSON(&event); err != nil {
		t.Fatalf("ReadJSON failed: %v", err)
	}
	if event.Type != "shopify_widget.heartbeat" || event.ShopID != shop.ID || event.EntityID != source.ID {
		t.Fatalf("unexpected widget heartbeat event: %#v", event)
	}
	sources, err := store.ListShopSources(t.Context(), shop.ID)
	if err != nil {
		t.Fatalf("ListShopSources failed: %v", err)
	}
	if len(sources) != 1 {
		t.Fatalf("unexpected sources: %#v", sources)
	}
	lastSeen, err := time.Parse(time.RFC3339, sources[0].Metadata["widgetLastSeenAt"])
	if err != nil || time.Since(lastSeen) > time.Minute {
		t.Fatalf("widget heartbeat was not recorded: value=%q err=%v", sources[0].Metadata["widgetLastSeenAt"], err)
	}
}

func TestShouldBroadcastWidgetHeartbeat(t *testing.T) {
	now := time.Now().UTC()
	if !shouldBroadcastWidgetHeartbeat(nil, now) {
		t.Fatal("expected first widget heartbeat to be broadcast")
	}
	if shouldBroadcastWidgetHeartbeat(map[string]string{"widgetLastSeenAt": now.Add(-14 * time.Minute).Format(time.RFC3339)}, now) {
		t.Fatal("did not expect a recent widget heartbeat to be broadcast again")
	}
	if !shouldBroadcastWidgetHeartbeat(map[string]string{"widgetLastSeenAt": now.Add(-15 * time.Minute).Format(time.RFC3339)}, now) {
		t.Fatal("expected the periodic widget heartbeat update to be broadcast")
	}
}

func TestPublicChatStartsInSharedShopQueue(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var agent User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email:       "agent@example.com",
		DisplayName: "Agent",
		Password:    "agent-password",
		Role:        UserRoleAgent,
	}, http.StatusCreated, &agent)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Reception Shop", ExternalID: "reception.myshopify.com"}, http.StatusCreated, &shop)
	allowAnonymousPublicChat(t, server.URL, adminToken, shop.ID)
	var assignment ShopAgent
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: agent.ID}, http.StatusCreated, &assignment)

	var created publicChatConversationResponse
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/public/chat/conversations", "", publicChatConversationRequest{
		Shop:          "reception.myshopify.com",
		CustomerName:  "Mia",
		CustomerEmail: "mia@example.com",
		Body:          "I need help with my order.",
		VisitorID:     "visitor-reception",
	}, http.StatusCreated, &created)

	if created.Conversation.Status != ConversationStatusOpen || created.Conversation.AssignedAgentID != "" {
		t.Fatalf("public conversation did not enter the shared queue: %#v", created.Conversation)
	}
}

func TestServerCanDisableAndEnableShopSource(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Source Shop"}, http.StatusCreated, &shop)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat}, http.StatusCreated, &source)

	var disabled ShopSource
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/shops/"+shop.ID+"/sources/"+source.ID, adminToken, updateShopSourceRequest{
		Status: SourceStatusDisabled,
	}, http.StatusOK, &disabled)
	if disabled.Status != SourceStatusDisabled {
		t.Fatalf("source was not disabled: %#v", disabled)
	}

	var output map[string]string
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/public/chat/config?shop="+shop.ID, "", nil, http.StatusBadRequest, &output)

	var enabled ShopSource
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/shops/"+shop.ID+"/sources/"+source.ID, adminToken, updateShopSourceRequest{
		Status: SourceStatusActive,
	}, http.StatusOK, &enabled)
	if enabled.Status != SourceStatusActive {
		t.Fatalf("source was not enabled: %#v", enabled)
	}
}

func TestServerPersistsInstantAnswersInChatSourceMetadata(t *testing.T) {
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{
		DisplayName: "Instant Answer Shop",
		ExternalID:  "instant-answer.myshopify.com",
	}, http.StatusCreated, &shop)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat}, http.StatusCreated, &source)

	answersJSON := `[{"id":"track_order","title":"Track my order","answer":"Please provide your order number and email address.","enabled":true,"sort":0}]`
	var updated ShopSource
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/shops/"+shop.ID+"/sources/"+source.ID, adminToken, updateShopSourceRequest{
		Metadata: map[string]string{
			"instantAnswersEnabled": "true",
			"instantAnswersJson":    answersJSON,
		},
	}, http.StatusOK, &updated)
	if updated.Metadata["instantAnswersEnabled"] != "true" || updated.Metadata["instantAnswersJson"] != answersJSON {
		t.Fatalf("instant answers metadata was not saved: %#v", updated.Metadata)
	}
	allowAnonymousPublicChat(t, server.URL, adminToken, shop.ID)

	var config publicChatConfigResponse
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/public/chat/config?shop="+shop.ID, "", nil, http.StatusOK, &config)
	if config.Source.ID != source.ID {
		t.Fatalf("public chat config returned wrong source: %#v", config.Source)
	}
	if config.Source.Metadata["instantAnswersEnabled"] != "true" || config.Source.Metadata["instantAnswersJson"] != answersJSON {
		t.Fatalf("public chat config did not return instant answers metadata: %#v", config.Source.Metadata)
	}

	var answered publicChatSelfServiceResponse
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/public/chat/instant-answer", "", publicChatInstantAnswerRequest{
		Shop:          shop.ID,
		AnswerID:      "track_order",
		CustomerName:  "Mia",
		CustomerEmail: "mia@example.com",
		VisitorID:     "visitor-instant-answer",
	}, http.StatusOK, &answered)
	if len(answered.Messages) != 2 {
		t.Fatalf("instant answer should create customer and system messages: %#v", answered.Messages)
	}
	if answered.Messages[0].Direction != MessageDirectionCustomer || answered.Messages[0].Body != "Track my order" {
		t.Fatalf("instant answer customer message mismatch: %#v", answered.Messages[0])
	}
	if answered.Messages[1].Direction != MessageDirectionSystem || answered.Messages[1].Body != "Please provide your order number and email address." {
		t.Fatalf("instant answer system message mismatch: %#v", answered.Messages[1])
	}
	conversations, err := store.ListConversations(context.Background(), ConversationFilter{ShopID: shop.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(conversations) != 0 {
		t.Fatalf("instant answer must not persist a conversation: %#v", conversations)
	}
}

func TestServerCanDisableEnableAndDeleteAgent(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var agent User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email:       "agent@example.com",
		DisplayName: "Agent",
		Password:    "agent-password",
		Role:        UserRoleAgent,
	}, http.StatusCreated, &agent)

	var disabled User
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/users/"+agent.ID, adminToken, updateUserRequest{
		Status: UserStatusDisabled,
	}, http.StatusOK, &disabled)
	if disabled.Status != UserStatusDisabled {
		t.Fatalf("agent was not disabled: %#v", disabled)
	}

	var enabled User
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/users/"+agent.ID, adminToken, updateUserRequest{
		Status: UserStatusActive,
	}, http.StatusOK, &enabled)
	if enabled.Status != UserStatusActive {
		t.Fatalf("agent was not enabled: %#v", enabled)
	}

	var ok map[string]bool
	requestJSON(t, http.MethodDelete, server.URL+"/api/v1/users/"+agent.ID, adminToken, nil, http.StatusOK, &ok)
	if !ok["ok"] {
		t.Fatalf("delete response was not ok: %#v", ok)
	}

	var users []User
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/users", adminToken, nil, http.StatusOK, &users)
	for _, user := range users {
		if user.ID == agent.ID {
			t.Fatalf("deleted agent still listed: %#v", users)
		}
	}
}

func TestServerProtectsCurrentAdminFromDelete(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var me User
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/auth/me", adminToken, nil, http.StatusOK, &me)
	var output map[string]string
	requestJSON(t, http.MethodDelete, server.URL+"/api/v1/users/"+me.ID, adminToken, nil, http.StatusBadRequest, &output)
}

func TestServerProtectsSystemAdminFromOtherAdmins(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	ownerToken := bootstrapAdmin(t, server.URL)

	var owner User
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/auth/me", ownerToken, nil, http.StatusOK, &owner)
	var admin User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", ownerToken, createUserRequest{
		Email:       "admin@example.com",
		DisplayName: "Admin",
		Password:    "admin-password",
		Role:        UserRoleAdmin,
	}, http.StatusCreated, &admin)

	var secondAdmin AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email:    "admin@example.com",
		Password: "admin-password",
	}, http.StatusOK, &secondAdmin)

	var output map[string]string
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/users/"+owner.ID, secondAdmin.Token, updateUserRequest{
		Status: UserStatusDisabled,
	}, http.StatusBadRequest, &output)
	requestJSON(t, http.MethodDelete, server.URL+"/api/v1/users/"+owner.ID, secondAdmin.Token, nil, http.StatusBadRequest, &output)

	var ok map[string]bool
	requestJSON(t, http.MethodDelete, server.URL+"/api/v1/users/"+admin.ID, ownerToken, nil, http.StatusOK, &ok)
	if !ok["ok"] {
		t.Fatalf("delete created admin response was not ok: %#v", ok)
	}
}

func TestAgentReplyNotifiesPublicChatWebSocket(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Public Shop"}, http.StatusCreated, &shop)
	var admin User
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/auth/me", adminToken, nil, http.StatusOK, &admin)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: admin.ID}, http.StatusCreated, nil)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat}, http.StatusCreated, &source)
	allowAnonymousPublicChat(t, server.URL, adminToken, shop.ID)

	var created publicChatConversationResponse
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/public/chat/conversations", "", publicChatConversationRequest{
		Shop:      shop.ID,
		Body:      "Can you help?",
		VisitorID: "visitor-2",
	}, http.StatusCreated, &created)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+created.Conversation.ID+"/claim", adminToken, nil, http.StatusOK, nil)

	chatConn, _, err := websocket.DefaultDialer.Dial(wsURL(server.URL)+"/ws/chat?conversationId="+created.Conversation.ID, websocketHeaders(server.URL))
	if err != nil {
		t.Fatalf("public chat websocket dial failed: %v", err)
	}
	defer chatConn.Close()
	if err := chatConn.SetReadDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatalf("SetReadDeadline failed: %v", err)
	}

	var reply Message
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+created.Conversation.ID+"/messages", adminToken, Message{
		Direction:  MessageDirectionAgent,
		Body:       "Yes, checking this now.",
		SenderName: "Owner",
	}, http.StatusCreated, &reply)

	var event Event
	if err := chatConn.ReadJSON(&event); err != nil {
		t.Fatalf("ReadJSON failed: %v", err)
	}
	if event.Type != "message.created" || event.EntityID != reply.ID {
		t.Fatalf("unexpected public websocket event: %#v", event)
	}
	if event.Conversation == nil || len(created.Messages) != 1 || !event.Conversation.CustomerLastMessageAt.Equal(created.Messages[0].CreatedAt) || event.Conversation.LastMessageDirection != MessageDirectionAgent {
		t.Fatalf("agent reply event lost conversation ordering fields: %#v", event.Conversation)
	}

	var secondReply Message
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+created.Conversation.ID+"/messages", adminToken, Message{
		Direction:  MessageDirectionAgent,
		Body:       "I still have the conversation open.",
		SenderName: "Owner",
	}, http.StatusCreated, &secondReply)
	if err := chatConn.ReadJSON(&event); err != nil {
		t.Fatalf("ReadJSON for second reply failed: %v", err)
	}
	if event.Type != "message.created" || event.EntityID != secondReply.ID || event.Conversation == nil || !event.Conversation.CustomerLastMessageAt.Equal(created.Messages[0].CreatedAt) || event.Conversation.LastMessageDirection != MessageDirectionAgent {
		t.Fatalf("second agent reply event lost conversation ordering fields: %#v", event)
	}
}

func TestPublicChatWebSocketHeartbeatKeepsAgentEventsFlowing(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Heartbeat Shop"}, http.StatusCreated, &shop)
	var admin User
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/auth/me", adminToken, nil, http.StatusOK, &admin)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: admin.ID}, http.StatusCreated, nil)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat}, http.StatusCreated, &source)
	allowAnonymousPublicChat(t, server.URL, adminToken, shop.ID)

	var created publicChatConversationResponse
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/public/chat/conversations", "", publicChatConversationRequest{
		Shop:      shop.ID,
		Body:      "Heartbeat check",
		VisitorID: "visitor-heartbeat",
	}, http.StatusCreated, &created)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+created.Conversation.ID+"/claim", adminToken, nil, http.StatusOK, nil)

	chatConn, _, err := websocket.DefaultDialer.Dial(wsURL(server.URL)+"/ws/chat?conversationId="+created.Conversation.ID, websocketHeaders(server.URL))
	if err != nil {
		t.Fatalf("public chat websocket dial failed: %v", err)
	}
	defer chatConn.Close()
	if err := chatConn.WriteMessage(websocket.TextMessage, []byte("ping")); err != nil {
		t.Fatalf("heartbeat write failed: %v", err)
	}
	if err := chatConn.SetReadDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatalf("SetReadDeadline failed: %v", err)
	}

	var reply Message
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+created.Conversation.ID+"/messages", adminToken, Message{
		Direction:  MessageDirectionAgent,
		Body:       "Heartbeat received.",
		SenderName: "Owner",
	}, http.StatusCreated, &reply)

	var event Event
	if err := chatConn.ReadJSON(&event); err != nil {
		t.Fatalf("ReadJSON failed after heartbeat: %v", err)
	}
	if event.Type != "message.created" || event.EntityID != reply.ID {
		t.Fatalf("unexpected public websocket event after heartbeat: %#v", event)
	}
}

func TestAgentCanUploadAndReadChatImage(t *testing.T) {
	platformServer := NewServer(NewMemoryStore())
	platformServer.uploadDir = t.TempDir()
	server := httptest.NewServer(platformServer.Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var admin User
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/auth/me", adminToken, nil, http.StatusOK, &admin)
	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Image Shop"}, http.StatusCreated, &shop)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: admin.ID}, http.StatusCreated, nil)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat}, http.StatusCreated, &source)
	var conversation Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations", adminToken, Conversation{ShopID: shop.ID, SourceID: source.ID}, http.StatusCreated, &conversation)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/claim", adminToken, nil, http.StatusOK, nil)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("image", "pixel.png")
	if err != nil {
		t.Fatalf("CreateFormFile failed: %v", err)
	}
	_, _ = part.Write([]byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"))
	_ = writer.WriteField("caption", "Reference image")
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart failed: %v", err)
	}
	req, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/attachments", &body)
	if err != nil {
		t.Fatalf("NewRequest failed: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+adminToken)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("upload request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		raw, _ := io.ReadAll(resp.Body)
		t.Fatalf("unexpected upload status %d: %s", resp.StatusCode, raw)
	}
	var message Message
	if err := json.NewDecoder(resp.Body).Decode(&message); err != nil {
		t.Fatalf("decode upload response failed: %v", err)
	}
	if message.Type != MessageTypeImage || message.Metadata["url"] == "" || message.Body != "Reference image" {
		t.Fatalf("unexpected image message: %#v", message)
	}

	imageResp, err := http.Get(server.URL + message.Metadata["url"])
	if err != nil {
		t.Fatalf("read image failed: %v", err)
	}
	defer imageResp.Body.Close()
	if imageResp.StatusCode != http.StatusOK || imageResp.Header.Get("Content-Type") != "image/png" {
		t.Fatalf("unexpected image response: status=%d content-type=%q", imageResp.StatusCode, imageResp.Header.Get("Content-Type"))
	}
	var productMessage Message
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", adminToken, Message{
		Direction: MessageDirectionAgent,
		Type:      MessageTypeProduct,
		Body:      "Recommended product",
		Metadata: map[string]string{
			"productId":      "gid://shopify/Product/1",
			"productTitle":   "Example product",
			"onlineStoreUrl": "https://example.myshopify.com/products/example",
		},
	}, http.StatusCreated, &productMessage)
	if productMessage.Type != MessageTypeProduct || productMessage.Metadata["productTitle"] != "Example product" {
		t.Fatalf("Shopify product message was not recorded: %#v", productMessage)
	}

	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", adminToken, Message{
		Direction: MessageDirectionAgent,
		Type:      MessageTypeProduct,
		Body:      "Unsafe product",
		Metadata:  map[string]string{"onlineStoreUrl": "javascript:alert(1)"},
	}, http.StatusBadRequest, nil)
}

func TestCustomerCanUploadChatImagesAndFiles(t *testing.T) {
	platformServer := NewServer(NewMemoryStore())
	platformServer.uploadDir = t.TempDir()
	server := httptest.NewServer(platformServer.Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{
		DisplayName: "Customer Attachment Shop",
		ExternalID:  "customer-attachments.myshopify.com",
	}, http.StatusCreated, &shop)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{
		Type:    SourceTypeShopifyChat,
		Address: shop.ExternalID,
	}, http.StatusCreated, &source)
	allowAnonymousPublicChat(t, server.URL, adminToken, shop.ID)

	upload := func(fileName string, content []byte, conversationID string, clientMessageID string, expectedStatus int) (publicChatConversationResponse, string) {
		t.Helper()
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		part, err := writer.CreateFormFile("file", fileName)
		if err != nil {
			t.Fatalf("CreateFormFile failed: %v", err)
		}
		if _, err := part.Write(content); err != nil {
			t.Fatalf("write attachment failed: %v", err)
		}
		_ = writer.WriteField("shop", shop.ExternalID)
		_ = writer.WriteField("conversationId", conversationID)
		_ = writer.WriteField("visitorId", "visitor-attachment")
		_ = writer.WriteField("caption", "Customer proof")
		_ = writer.WriteField("clientMessageId", clientMessageID)
		if err := writer.Close(); err != nil {
			t.Fatalf("close multipart failed: %v", err)
		}
		req, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/public/chat/attachments", &body)
		if err != nil {
			t.Fatalf("NewRequest failed: %v", err)
		}
		req.Header.Set("Content-Type", writer.FormDataContentType())
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("upload request failed: %v", err)
		}
		defer resp.Body.Close()
		raw, err := io.ReadAll(resp.Body)
		if err != nil {
			t.Fatalf("read upload response failed: %v", err)
		}
		if resp.StatusCode != expectedStatus {
			t.Fatalf("unexpected upload status %d: %s", resp.StatusCode, raw)
		}
		var result publicChatConversationResponse
		if expectedStatus == http.StatusCreated {
			if err := json.Unmarshal(raw, &result); err != nil {
				t.Fatalf("decode upload response failed: %v", err)
			}
		}
		return result, string(raw)
	}

	pdfContent := []byte("%PDF-1.4\ncustomer invoice\n%%EOF")
	pdf, _ := upload("invoice.pdf", pdfContent, "", "attachment-client-1", http.StatusCreated)
	if pdf.Conversation.ID == "" || len(pdf.Messages) != 1 || pdf.Messages[0].Type != MessageTypeFile {
		t.Fatalf("customer PDF did not create a file message: %#v", pdf)
	}
	fileURL := pdf.Messages[0].Metadata["url"]
	if fileURL == "" || pdf.Messages[0].Metadata["fileName"] != "invoice.pdf" || pdf.Messages[0].Metadata["fileSize"] == "" {
		t.Fatalf("customer PDF metadata is incomplete: %#v", pdf.Messages[0])
	}
	retriedPDF, _ := upload("invoice.pdf", pdfContent, "", "attachment-client-1", http.StatusCreated)
	if retriedPDF.Conversation.ID != pdf.Conversation.ID || len(retriedPDF.Messages) != 1 || retriedPDF.Messages[0].ID != pdf.Messages[0].ID {
		t.Fatalf("attachment retry created a duplicate: first=%#v retry=%#v", pdf, retriedPDF)
	}

	image, _ := upload("proof.png", []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"), pdf.Conversation.ID, "attachment-client-2", http.StatusCreated)
	if image.Conversation.ID != pdf.Conversation.ID || len(image.Messages) != 1 || image.Messages[0].Type != MessageTypeImage {
		t.Fatalf("customer image did not stay in the existing conversation: %#v", image)
	}

	resp, err := http.Get(server.URL + fileURL + "?name=invoice.pdf")
	if err != nil {
		t.Fatalf("GET customer attachment failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK ||
		!strings.HasPrefix(resp.Header.Get("Content-Type"), "application/pdf") ||
		!strings.Contains(resp.Header.Get("Content-Disposition"), "invoice.pdf") ||
		resp.Header.Get("Cache-Control") != "private, max-age=3600" {
		t.Fatalf("unexpected customer attachment response: status=%d headers=%v", resp.StatusCode, resp.Header)
	}

	_, rejected := upload("unsafe.pdf", []byte("<html><script>alert(1)</script></html>"), pdf.Conversation.ID, "attachment-client-3", http.StatusBadRequest)
	if !strings.Contains(rejected, "does not match its PDF extension") {
		t.Fatalf("unsafe attachment rejection was unclear: %s", rejected)
	}
}

func TestEmailConversationImageAttachmentSendsViaGmailBeforeRecording(t *testing.T) {
	var sendCount int
	var modifySeen bool
	gmailServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer gmail-access-1" {
			t.Fatalf("unexpected Gmail authorization header: %q", r.Header.Get("Authorization"))
		}
		switch r.URL.Path {
		case "/users/me/messages/send":
			sendCount++
			var payload struct {
				Raw      string `json:"raw"`
				ThreadID string `json:"threadId"`
			}
			body, _ := io.ReadAll(r.Body)
			if err := json.Unmarshal(body, &payload); err != nil {
				t.Fatalf("decode Gmail send payload failed: %v", err)
			}
			if payload.ThreadID != "thread-1" {
				t.Fatalf("expected Gmail thread reply to thread-1, got %q", payload.ThreadID)
			}
			raw, err := base64.RawURLEncoding.DecodeString(payload.Raw)
			if err != nil {
				t.Fatalf("decode raw Gmail attachment message failed: %v", err)
			}
			rawText := string(raw)
			if !strings.Contains(rawText, "In-Reply-To: <customer-msg-1@example.com>") ||
				!strings.Contains(rawText, "Content-Disposition: attachment; filename=\"pixel.png\"") ||
				!strings.Contains(rawText, "Content-Type: image/png") {
				t.Fatalf("unexpected Gmail attachment message: %s", rawText)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"sent-image-1","threadId":"thread-1"}`))
		case "/users/me/messages/customer-msg-1/modify":
			modifySeen = true
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"customer-msg-1"}`))
		default:
			t.Fatalf("unexpected Gmail API path: %s", r.URL.Path)
		}
	}))
	defer gmailServer.Close()
	t.Setenv("GMAIL_API_BASE_URL", gmailServer.URL)

	platformServer := NewServer(NewMemoryStore())
	platformServer.uploadDir = t.TempDir()
	startTestEmailOutbox(t, platformServer)
	server := httptest.NewServer(platformServer.Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var admin User
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/auth/me", adminToken, nil, http.StatusOK, &admin)
	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Email Image Shop"}, http.StatusCreated, &shop)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: admin.ID}, http.StatusCreated, nil)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{
		Type:     SourceTypeEmail,
		Provider: "gmail",
		Address:  "support@store.com",
	}, http.StatusCreated, &source)
	if _, err := platformServer.store.SaveEmailInstallation(context.Background(), EmailInstallation{
		ShopID:       shop.ID,
		Mailbox:      "support@store.com",
		Provider:     "gmail",
		AccessToken:  "gmail-access-1",
		RefreshToken: "gmail-refresh-1",
		Scope:        defaultGmailScopes,
		ExpiresAt:    time.Now().Add(time.Hour),
	}); err != nil {
		t.Fatalf("SaveEmailInstallation failed: %v", err)
	}
	var conversation Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations", adminToken, Conversation{
		ShopID:        shop.ID,
		SourceID:      source.ID,
		CustomerEmail: "buyer@example.com",
		Subject:       "Order help",
	}, http.StatusCreated, &conversation)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/claim", adminToken, nil, http.StatusOK, nil)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", adminToken, Message{
		Direction:       MessageDirectionCustomer,
		Body:            "Please see attached.",
		Metadata:        map[string]string{"gmail_message_id": "customer-msg-1", "gmail_thread_id": "thread-1", "mail_message_id": "<customer-msg-1@example.com>"},
		SourceMessageID: "gmail:customer-msg-1",
	}, http.StatusCreated, nil)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("image", "pixel.png")
	if err != nil {
		t.Fatalf("CreateFormFile failed: %v", err)
	}
	_, _ = part.Write([]byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"))
	_ = writer.WriteField("clientRequestId", "attachment-request-1")
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart failed: %v", err)
	}
	req, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/attachments", &body)
	if err != nil {
		t.Fatalf("NewRequest failed: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+adminToken)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("upload request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		raw, _ := io.ReadAll(resp.Body)
		t.Fatalf("unexpected upload status %d: %s", resp.StatusCode, raw)
	}
	var message Message
	if err := json.NewDecoder(resp.Body).Decode(&message); err != nil {
		t.Fatalf("decode upload response failed: %v", err)
	}
	message = waitForEmailMessageStatus(t, platformServer.store, conversation.ID, message.ID, emailSendStatusSent)
	if sendCount != 1 || !modifySeen {
		t.Fatalf("expected one Gmail attachment send and mark-read call, sends=%d modify=%v", sendCount, modifySeen)
	}
	if message.Type != MessageTypeImage || message.Metadata["gmail_message_id"] != "sent-image-1" || message.Metadata["gmail_thread_id"] != "thread-1" {
		t.Fatalf("expected stored image with Gmail metadata, got %#v", message)
	}
	var retryBody bytes.Buffer
	retryWriter := multipart.NewWriter(&retryBody)
	retryPart, _ := retryWriter.CreateFormFile("image", "pixel.png")
	_, _ = retryPart.Write([]byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"))
	_ = retryWriter.WriteField("clientRequestId", "attachment-request-1")
	_ = retryWriter.Close()
	retryRequest, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/attachments", &retryBody)
	retryRequest.Header.Set("Authorization", "Bearer "+adminToken)
	retryRequest.Header.Set("Content-Type", retryWriter.FormDataContentType())
	retryResponse, err := http.DefaultClient.Do(retryRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer retryResponse.Body.Close()
	var retried Message
	if err := json.NewDecoder(retryResponse.Body).Decode(&retried); err != nil || retryResponse.StatusCode != http.StatusOK || retried.ID != message.ID || sendCount != 1 {
		t.Fatalf("attachment retry was not idempotent: status=%d message=%#v sends=%d err=%v", retryResponse.StatusCode, retried, sendCount, err)
	}
}

func TestEmailConversationImageAttachmentSendsViaOutlookBeforeRecording(t *testing.T) {
	var createReplySeen bool
	var attachmentSeen bool
	var sendSeen bool
	graphServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer outlook-access-1" {
			t.Fatalf("unexpected Graph authorization header: %q", r.Header.Get("Authorization"))
		}
		switch r.URL.Path {
		case "/me/messages/outlook-msg-1/createReply":
			createReplySeen = true
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"draft-1"}`))
		case "/me/messages/draft-1/attachments":
			attachmentSeen = true
			var payload map[string]string
			body, _ := io.ReadAll(r.Body)
			if err := json.Unmarshal(body, &payload); err != nil {
				t.Fatalf("decode Outlook attachment failed: %v", err)
			}
			if payload["name"] != "pixel.png" || payload["contentType"] != "image/png" || payload["contentBytes"] == "" {
				t.Fatalf("unexpected Outlook attachment payload: %+v", payload)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"attachment-1"}`))
		case "/me/messages/draft-1/send":
			sendSeen = true
			w.WriteHeader(http.StatusAccepted)
		case "/me/messages/outlook-msg-1":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"outlook-msg-1"}`))
		default:
			t.Fatalf("unexpected Graph path: %s", r.URL.Path)
		}
	}))
	defer graphServer.Close()
	t.Setenv("OUTLOOK_GRAPH_BASE_URL", graphServer.URL)

	platformServer := NewServer(NewMemoryStore())
	platformServer.uploadDir = t.TempDir()
	startTestEmailOutbox(t, platformServer)
	server := httptest.NewServer(platformServer.Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var admin User
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/auth/me", adminToken, nil, http.StatusOK, &admin)
	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Outlook Image Shop"}, http.StatusCreated, &shop)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: admin.ID}, http.StatusCreated, nil)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{
		Type:     SourceTypeEmail,
		Provider: "outlook",
		Address:  "support@store.com",
	}, http.StatusCreated, &source)
	if _, err := platformServer.store.SaveEmailInstallation(context.Background(), EmailInstallation{
		ShopID:       shop.ID,
		Mailbox:      "support@store.com",
		Provider:     "outlook",
		AccessToken:  "outlook-access-1",
		RefreshToken: "outlook-refresh-1",
		Scope:        defaultOutlookScopes,
		ExpiresAt:    time.Now().Add(time.Hour),
	}); err != nil {
		t.Fatalf("SaveEmailInstallation failed: %v", err)
	}
	var conversation Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations", adminToken, Conversation{
		ShopID:        shop.ID,
		SourceID:      source.ID,
		CustomerEmail: "buyer@example.com",
		Subject:       "Order help",
	}, http.StatusCreated, &conversation)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/claim", adminToken, nil, http.StatusOK, nil)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", adminToken, Message{
		Direction:       MessageDirectionCustomer,
		Body:            "Please see attached.",
		Metadata:        map[string]string{"outlook_message_id": "outlook-msg-1", "outlook_conversation_id": "conv-a", "outlook_internet_message_id": "<outlook-msg-1@example.com>", "mail_message_id": "<outlook-msg-1@example.com>"},
		SourceMessageID: "outlook:outlook-msg-1",
	}, http.StatusCreated, nil)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("image", "pixel.png")
	if err != nil {
		t.Fatalf("CreateFormFile failed: %v", err)
	}
	_, _ = part.Write([]byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"))
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart failed: %v", err)
	}
	req, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/attachments", &body)
	if err != nil {
		t.Fatalf("NewRequest failed: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+adminToken)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("upload request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		raw, _ := io.ReadAll(resp.Body)
		t.Fatalf("unexpected upload status %d: %s", resp.StatusCode, raw)
	}
	var message Message
	if err := json.NewDecoder(resp.Body).Decode(&message); err != nil {
		t.Fatalf("decode upload response failed: %v", err)
	}
	message = waitForEmailMessageStatus(t, platformServer.store, conversation.ID, message.ID, emailSendStatusSent)
	if !createReplySeen || !attachmentSeen || !sendSeen {
		t.Fatalf("expected Outlook attachment flow, createReply=%v attachment=%v send=%v", createReplySeen, attachmentSeen, sendSeen)
	}
	if message.Type != MessageTypeImage || message.Metadata["outlook_message_id"] != "draft-1" || message.Metadata["outlook_conversation_id"] != "conv-a" {
		t.Fatalf("expected stored image with Outlook metadata, got %#v", message)
	}
}

func TestServerIngestConversationIsIdempotent(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Ingest Shop"}, http.StatusCreated, &shop)

	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeEmail, Provider: "outlook"}, http.StatusCreated, &source)

	receivedAt := time.Date(2026, 7, 4, 12, 30, 0, 0, time.UTC)
	input := ingestConversationRequest{
		ShopID:                 shop.ID,
		SourceID:               source.ID,
		ExternalConversationID: "mail-thread-123",
		CustomerName:           "Mia",
		CustomerEmail:          "mia@example.com",
		Subject:                "Where is my order?",
		Messages: []ingestMessage{{
			Direction:       MessageDirectionCustomer,
			Body:            "When will this ship?",
			SenderEmail:     "mia@example.com",
			SourceMessageID: "mail-message-1",
			CreatedAt:       receivedAt,
		}},
	}

	var first ingestConversationResponse
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/ingest/conversations", adminToken, input, http.StatusOK, &first)
	if !first.ConversationCreated || first.MessagesCreated != 1 || first.MessagesSkipped != 0 {
		t.Fatalf("unexpected first ingest response: %#v", first)
	}
	if first.Conversation.ID == "" || first.Conversation.CustomerEmail != "mia@example.com" {
		t.Fatalf("unexpected ingested conversation: %#v", first.Conversation)
	}
	if len(first.Messages) != 1 || first.Messages[0].SourceMessageID != "mail-message-1" || !first.Messages[0].CreatedAt.Equal(receivedAt) {
		t.Fatalf("unexpected ingested message: %#v", first.Messages)
	}

	var second ingestConversationResponse
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/ingest/conversations", adminToken, input, http.StatusOK, &second)
	if second.ConversationCreated || second.MessagesCreated != 0 || second.MessagesSkipped != 1 {
		t.Fatalf("unexpected duplicate ingest response: %#v", second)
	}

	var conversations []Conversation
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations?shopId="+shop.ID, adminToken, nil, http.StatusOK, &conversations)
	if len(conversations) != 1 || conversations[0].ID != first.Conversation.ID {
		t.Fatalf("unexpected conversations after duplicate ingest: %#v", conversations)
	}

	var messages []Message
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations/"+first.Conversation.ID+"/messages", adminToken, nil, http.StatusOK, &messages)
	if len(messages) != 1 || messages[0].Body != "When will this ship?" {
		t.Fatalf("unexpected messages after duplicate ingest: %#v", messages)
	}
}

func TestServerBootstrapLoginMeAndLogout(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()

	var bootstrap AuthResult
	raw := requestJSON(t, http.MethodPost, server.URL+"/api/v1/bootstrap/admin", "", createUserRequest{
		Email:       " Owner@Example.com ",
		DisplayName: "Owner",
		Password:    "password-123",
	}, http.StatusCreated, &bootstrap)
	if bootstrap.Token == "" || bootstrap.User.Role != UserRoleAdmin || bootstrap.User.Email != "owner@example.com" {
		t.Fatalf("unexpected bootstrap response: %#v", bootstrap)
	}
	if bytes.Contains(raw, []byte("passwordHash")) || bytes.Contains(raw, []byte("password-123")) {
		t.Fatalf("bootstrap response leaked password data: %s", string(raw))
	}

	var conflict map[string]string
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/bootstrap/admin", "", createUserRequest{
		Email:    "second@example.com",
		Password: "password-123",
	}, http.StatusConflict, &conflict)

	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email:    "OWNER@example.com",
		Password: "password-123",
	}, http.StatusOK, &login)
	if login.Token == "" || login.Token == bootstrap.Token {
		t.Fatalf("login should issue a fresh token: bootstrap=%q login=%q", bootstrap.Token, login.Token)
	}

	var me User
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/auth/me", login.Token, nil, http.StatusOK, &me)
	if me.ID != login.User.ID || me.PasswordHash != "" {
		t.Fatalf("unexpected me response: %#v", me)
	}

	var users []User
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/users", login.Token, nil, http.StatusOK, &users)
	if len(users) != 1 || users[0].ID != login.User.ID {
		t.Fatalf("unexpected users response: %#v", users)
	}

	var logout map[string]bool
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/logout", login.Token, nil, http.StatusOK, &logout)
	if !logout["ok"] {
		t.Fatalf("unexpected logout response: %#v", logout)
	}
	var unauthorized map[string]string
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/auth/me", login.Token, nil, http.StatusUnauthorized, &unauthorized)
}

func TestServerRejectsShortBootstrapPassword(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()

	var output map[string]string
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/bootstrap/admin", "", createUserRequest{
		Email:    "owner@example.com",
		Password: "short",
	}, http.StatusBadRequest, &output)
}

func TestServerListEndpointsReturnEmptyArrays(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()

	adminToken := bootstrapAdmin(t, server.URL)

	rawShops := requestJSON(t, http.MethodGet, server.URL+"/api/v1/shops", adminToken, nil, http.StatusOK, nil)
	if string(bytes.TrimSpace(rawShops)) != "[]" {
		t.Fatalf("expected empty shops array, got %s", string(rawShops))
	}

	rawConversations := requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations", adminToken, nil, http.StatusOK, nil)
	if string(bytes.TrimSpace(rawConversations)) != "[]" {
		t.Fatalf("expected empty conversations array, got %s", string(rawConversations))
	}

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Empty Shop"}, http.StatusCreated, &shop)
	rawSources := requestJSON(t, http.MethodGet, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, nil, http.StatusOK, nil)
	if string(bytes.TrimSpace(rawSources)) != "[]" {
		t.Fatalf("expected empty sources array, got %s", string(rawSources))
	}
	rawAgents := requestJSON(t, http.MethodGet, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, nil, http.StatusOK, nil)
	if string(bytes.TrimSpace(rawAgents)) != "[]" {
		t.Fatalf("expected empty shop agents array, got %s", string(rawAgents))
	}

	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat}, http.StatusCreated, &source)
	var conversation Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations", adminToken, Conversation{ShopID: shop.ID, SourceID: source.ID}, http.StatusCreated, &conversation)
	rawMessages := requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", adminToken, nil, http.StatusOK, nil)
	if string(bytes.TrimSpace(rawMessages)) != "[]" {
		t.Fatalf("expected empty messages array, got %s", string(rawMessages))
	}
}

func TestServerUsersRequiresAdmin(t *testing.T) {
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()

	var admin AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/bootstrap/admin", "", createUserRequest{
		Email:    "owner@example.com",
		Password: "password-123",
	}, http.StatusCreated, &admin)

	hash, err := hashPassword("agent-password")
	if err != nil {
		t.Fatalf("hashPassword failed: %v", err)
	}
	if _, err := store.CreateUser(context.Background(), User{
		Email:        "agent@example.com",
		DisplayName:  "Agent",
		Role:         UserRoleAgent,
		PasswordHash: hash,
	}); err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}

	var agent AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email:    "agent@example.com",
		Password: "agent-password",
	}, http.StatusOK, &agent)

	var forbidden map[string]string
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/users", agent.Token, nil, http.StatusForbidden, &forbidden)
}

func TestServerAgentOnlySeesAssignedShopConversations(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var agent User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email:       "agent@example.com",
		DisplayName: "Agent",
		Password:    "agent-password",
		Role:        UserRoleAgent,
	}, http.StatusCreated, &agent)

	var firstShop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Assigned Shop"}, http.StatusCreated, &firstShop)
	var firstSource ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+firstShop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat}, http.StatusCreated, &firstSource)
	var firstConversation Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations", adminToken, Conversation{ShopID: firstShop.ID, SourceID: firstSource.ID, CustomerName: "Assigned Customer"}, http.StatusCreated, &firstConversation)

	var secondShop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Hidden Shop"}, http.StatusCreated, &secondShop)
	var secondSource ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+secondShop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat}, http.StatusCreated, &secondSource)
	var secondConversation Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations", adminToken, Conversation{ShopID: secondShop.ID, SourceID: secondSource.ID, CustomerName: "Hidden Customer"}, http.StatusCreated, &secondConversation)

	var assignment ShopAgent
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+firstShop.ID+"/agents", adminToken, assignShopUserRequest{UserID: agent.ID}, http.StatusCreated, &assignment)
	if assignment.ShopID != firstShop.ID || assignment.UserID != agent.ID {
		t.Fatalf("unexpected assignment: %#v", assignment)
	}

	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{Email: "agent@example.com", Password: "agent-password"}, http.StatusOK, &login)

	var shops []Shop
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/shops", login.Token, nil, http.StatusOK, &shops)
	if len(shops) != 1 || shops[0].ID != firstShop.ID {
		t.Fatalf("agent saw unexpected shops: %#v", shops)
	}

	var conversations []Conversation
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations", login.Token, nil, http.StatusOK, &conversations)
	if len(conversations) != 1 || conversations[0].ID != firstConversation.ID {
		t.Fatalf("agent saw unexpected conversations: %#v", conversations)
	}

	var forbidden map[string]string
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations/"+secondConversation.ID+"/messages", login.Token, nil, http.StatusForbidden, &forbidden)

	var disabled Shop
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/shops/"+firstShop.ID, adminToken, updateShopRequest{Status: ShopStatusDisabled}, http.StatusOK, &disabled)
	if disabled.Status != ShopStatusDisabled {
		t.Fatalf("expected disabled shop, got %#v", disabled)
	}

	var shopsAfterDisable []Shop
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/shops", login.Token, nil, http.StatusOK, &shopsAfterDisable)
	if len(shopsAfterDisable) != 0 {
		t.Fatalf("agent saw disabled shop: %#v", shopsAfterDisable)
	}

	var conversationsAfterDisable []Conversation
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations", login.Token, nil, http.StatusOK, &conversationsAfterDisable)
	if len(conversationsAfterDisable) != 0 {
		t.Fatalf("agent saw disabled shop conversations: %#v", conversationsAfterDisable)
	}

	requestJSON(t, http.MethodGet, server.URL+"/api/v1/shops/"+firstShop.ID+"/sources", login.Token, nil, http.StatusForbidden, &forbidden)
}

func TestAssignedAgentCannotManuallySyncButCanMarkEmailReadState(t *testing.T) {
	var modifySeen bool
	gmailServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer gmail-access-1" {
			t.Fatalf("unexpected Gmail authorization header: %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/users/me/messages/gmail-msg-1/modify":
			modifySeen = true
			var payload map[string][]string
			body, _ := io.ReadAll(r.Body)
			if err := json.Unmarshal(body, &payload); err != nil {
				t.Fatalf("decode Gmail modify payload failed: %v", err)
			}
			if strings.Join(payload["removeLabelIds"], ",") != "UNREAD" {
				t.Fatalf("expected read-state call to remove UNREAD, got %+v", payload)
			}
			_, _ = w.Write([]byte(`{"id":"gmail-msg-1"}`))
		default:
			t.Fatalf("unexpected Gmail API path: %s", r.URL.Path)
		}
	}))
	defer gmailServer.Close()
	t.Setenv("GMAIL_API_BASE_URL", gmailServer.URL)

	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var agent User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email:       "agent@example.com",
		DisplayName: "Agent",
		Password:    "agent-password",
		Role:        UserRoleAgent,
	}, http.StatusCreated, &agent)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Assigned Mail Shop"}, http.StatusCreated, &shop)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{
		Type:     SourceTypeEmail,
		Provider: "gmail",
		Address:  "support@store.com",
	}, http.StatusCreated, &source)
	if source.ID == "" {
		t.Fatal("expected email source to be created")
	}
	if _, err := store.SaveEmailInstallation(context.Background(), EmailInstallation{
		ShopID:       shop.ID,
		Mailbox:      "support@store.com",
		Provider:     "gmail",
		AccessToken:  "gmail-access-1",
		RefreshToken: "gmail-refresh-1",
		Scope:        defaultGmailScopes,
		ExpiresAt:    time.Now().Add(time.Hour),
	}); err != nil {
		t.Fatalf("SaveEmailInstallation failed: %v", err)
	}
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: agent.ID}, http.StatusCreated, nil)

	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{Email: "agent@example.com", Password: "agent-password"}, http.StatusOK, &login)

	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/email/gmail/sync", login.Token, map[string]string{}, http.StatusNotFound, nil)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/email/gmail/messages/read-state", login.Token, emailReadStateRequest{
		Mailbox:   "support@store.com",
		MessageID: "gmail:gmail-msg-1",
		Read:      true,
	}, http.StatusOK, nil)
	if !modifySeen {
		t.Fatal("expected assigned agent read-state API call")
	}
}

func TestUnassignedAgentCannotUseRemovedSyncOrMarkEmailReadState(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var agent User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email:       "agent@example.com",
		DisplayName: "Agent",
		Password:    "agent-password",
		Role:        UserRoleAgent,
	}, http.StatusCreated, &agent)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Unassigned Mail Shop"}, http.StatusCreated, &shop)

	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{Email: "agent@example.com", Password: "agent-password"}, http.StatusOK, &login)

	var forbidden map[string]string
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/email/gmail/sync", login.Token, map[string]string{}, http.StatusForbidden, &forbidden)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/email/gmail/messages/read-state", login.Token, emailReadStateRequest{
		Mailbox:   "support@store.com",
		MessageID: "gmail:gmail-msg-1",
		Read:      true,
	}, http.StatusForbidden, &forbidden)
}

func TestServerMultiAgentSharedQueueClaimAndOwnership(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var agent User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email:       "agent@example.com",
		DisplayName: "Agent",
		Password:    "agent-password",
		Role:        UserRoleAgent,
	}, http.StatusCreated, &agent)
	var otherAgent User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email:       "other@example.com",
		DisplayName: "Other",
		Password:    "agent-password",
		Role:        UserRoleAgent,
	}, http.StatusCreated, &otherAgent)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Assigned Shop"}, http.StatusCreated, &shop)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat}, http.StatusCreated, &source)
	var conversation Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations", adminToken, Conversation{
		ShopID:       shop.ID,
		SourceID:     source.ID,
		CustomerName: "Assigned Customer",
	}, http.StatusCreated, &conversation)
	var assignment ShopAgent
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: agent.ID}, http.StatusCreated, &assignment)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: otherAgent.ID}, http.StatusCreated, nil)

	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{Email: "agent@example.com", Password: "agent-password"}, http.StatusOK, &login)
	var otherLogin AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{Email: "other@example.com", Password: "agent-password"}, http.StatusOK, &otherLogin)

	var claimed Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/claim", login.Token, nil, http.StatusOK, &claimed)
	if claimed.Status != ConversationStatusAssigned || claimed.AssignedAgentID != agent.ID {
		t.Fatalf("unexpected claimed conversation: %#v", claimed)
	}

	var forbidden map[string]string
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/claim", otherLogin.Token, nil, http.StatusForbidden, &forbidden)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", otherLogin.Token, Message{
		Direction: MessageDirectionAgent,
		Body:      "I should not be able to reply.",
	}, http.StatusForbidden, &forbidden)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", login.Token, Message{
		Direction: MessageDirectionAgent,
		Body:      "I own this conversation.",
	}, http.StatusCreated, nil)

	var closed Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/close", login.Token, nil, http.StatusOK, &closed)
	if closed.Status != ConversationStatusClosed || closed.AssignedAgentID != agent.ID {
		t.Fatalf("unexpected closed conversation: %#v", closed)
	}

	var conflict map[string]string
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", login.Token, Message{
		Direction: MessageDirectionAgent,
		Body:      "Closed conversations are read only.",
	}, http.StatusConflict, &conflict)

	var reopened Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/reopen", login.Token, nil, http.StatusOK, &reopened)
	if reopened.Status != ConversationStatusAssigned || reopened.AssignedAgentID != agent.ID {
		t.Fatalf("unexpected reopened conversation: %#v", reopened)
	}
}

func TestConversationClaimBroadcastsOwnershipChangeToAllShopAgents(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	agents := make([]User, 2)
	tokens := make([]string, 2)
	for index := range agents {
		email := fmt.Sprintf("claim-event-agent-%d@example.com", index+1)
		requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
			Email: email, DisplayName: email, Password: "agent-password", Role: UserRoleAgent,
		}, http.StatusCreated, &agents[index])
		var login AuthResult
		requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{Email: email, Password: "agent-password"}, http.StatusOK, &login)
		tokens[index] = login.Token
		requestJSON(t, http.MethodPatch, server.URL+"/api/v1/auth/me/presence", login.Token, receptionPresenceRequest{Online: false}, http.StatusOK, nil)
	}

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Claim Event Shop"}, http.StatusCreated, &shop)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat}, http.StatusCreated, &source)
	for _, agent := range agents {
		requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: agent.ID}, http.StatusCreated, nil)
	}

	connections := make([]*websocket.Conn, 2)
	for index := range connections {
		conn := dialEventWebSocket(t, server.URL, tokens[index])
		connections[index] = conn
		defer conn.Close()
		if err := conn.SetReadDeadline(time.Now().Add(3 * time.Second)); err != nil {
			t.Fatalf("SetReadDeadline failed: %v", err)
		}
	}

	var conversation Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations", adminToken, Conversation{
		ShopID: shop.ID, SourceID: source.ID, CustomerName: "Queued Customer", Kind: ConversationKindCustomer,
	}, http.StatusCreated, &conversation)
	for _, conn := range connections {
		created := readWebSocketEvents(t, conn, 1)
		if created[0].Type != "conversation.created" {
			t.Fatalf("unexpected queue event: %#v", created[0])
		}
	}

	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/claim", tokens[0], nil, http.StatusOK, nil)
	for _, conn := range connections {
		events := readWebSocketEvents(t, conn, 1)
		if events[0].Type != "conversation.claimed" || events[0].Conversation == nil || events[0].Conversation.AssignedAgentID != agents[0].ID {
			t.Fatalf("shop agent did not receive ownership event: %#v", events[0])
		}
	}
}

func TestServerAdminCannotAssignConversationToUnassignedAgent(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var agent User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email:       "agent@example.com",
		DisplayName: "Agent",
		Password:    "agent-password",
		Role:        UserRoleAgent,
	}, http.StatusCreated, &agent)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Shop"}, http.StatusCreated, &shop)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat}, http.StatusCreated, &source)
	var conversation Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations", adminToken, Conversation{ShopID: shop.ID, SourceID: source.ID}, http.StatusCreated, &conversation)

	var output map[string]string
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/conversations/"+conversation.ID, adminToken, updateConversationRequest{
		Status:          stringPtr(ConversationStatusAssigned),
		AssignedAgentID: stringPtr(agent.ID),
	}, http.StatusBadRequest, &output)
}

func getJSON(t *testing.T, url string, wantStatus int, output any) {
	t.Helper()
	requestJSON(t, http.MethodGet, url, "", nil, wantStatus, output)
}

func bootstrapAdmin(t *testing.T, serverURL string) string {
	t.Helper()
	var admin AuthResult
	requestJSON(t, http.MethodPost, serverURL+"/api/v1/bootstrap/admin", "", createUserRequest{
		Email:                 "owner@example.com",
		DisplayName:           "Owner",
		Password:              "password-123",
		Permissions:           append([]string(nil), allPermissions...),
		PermissionsCustomized: true,
		ShopScope:             AccessScopeAll,
		WorkbenchShopScope:    AccessScopeAll,
		ConversationScope:     AccessScopeAll,
	}, http.StatusCreated, &admin)
	if admin.Token == "" {
		t.Fatal("bootstrap returned empty token")
	}
	return admin.Token
}

func requestJSON(t *testing.T, method string, url string, token string, input any, wantStatus int, output any) []byte {
	return requestJSONWithHeaders(t, method, url, token, nil, input, wantStatus, output)
}

func requestJSONWithHeaders(t *testing.T, method string, url string, token string, headers http.Header, input any, wantStatus int, output any) []byte {
	t.Helper()
	var body io.Reader
	if input != nil {
		raw, err := json.Marshal(input)
		if err != nil {
			t.Fatalf("marshal failed: %v", err)
		}
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		t.Fatalf("%s %s request failed: %v", method, url, err)
	}
	if input != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for name, values := range headers {
		for _, value := range values {
			req.Header.Add(name, value)
		}
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s failed: %v", method, url, err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read response failed: %v", err)
	}
	if resp.StatusCode != wantStatus {
		t.Fatalf("%s %s status=%d want=%d body=%s", method, url, resp.StatusCode, wantStatus, string(raw))
	}
	if output != nil {
		if err := json.Unmarshal(raw, output); err != nil {
			t.Fatalf("decode response failed: %v body=%s", err, string(raw))
		}
	}
	return raw
}

func readWebSocketEvents(t *testing.T, conn *websocket.Conn, count int) []Event {
	t.Helper()
	events := make([]Event, 0, count)
	for len(events) < count {
		var event Event
		if err := conn.ReadJSON(&event); err != nil {
			t.Fatalf("ReadJSON failed: %v", err)
		}
		events = append(events, event)
	}
	return events
}

func stringPtr(value string) *string {
	return &value
}

func wsURL(serverURL string) string {
	return "ws" + strings.TrimPrefix(serverURL, "http")
}
