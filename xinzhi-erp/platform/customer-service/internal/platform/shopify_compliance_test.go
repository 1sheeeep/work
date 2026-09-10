package platform

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestShopifyComplianceWebhookQueuesMinimalIdempotentTicket(t *testing.T) {
	const raw = `{"shop_id":954889,"shop_domain":"demo.myshopify.com","orders_requested":[299938,280263],"customer":{"id":191167,"email":"private@example.com","phone":"555-625-1199"},"data_request":{"id":9999}}`
	server, store, shop := newShopifyComplianceTestServer(t)

	for range 2 {
		recorder := httptest.NewRecorder()
		request := newShopifyComplianceRequest(raw, shopifyCustomersDataRequestTopic, "delivery-1", "client-secret")
		server.handleShopifyComplianceWebhook(recorder, request)
		if recorder.Code != http.StatusOK {
			t.Fatalf("unexpected status %d body=%s", recorder.Code, recorder.Body.String())
		}
	}

	tickets, err := store.ListTickets(t.Context(), TicketFilter{ShopID: shop.ID})
	if err != nil {
		t.Fatalf("ListTickets failed: %v", err)
	}
	if len(tickets) != 1 {
		t.Fatalf("duplicate webhook delivery created %d tickets: %#v", len(tickets), tickets)
	}
	ticket := tickets[0]
	if ticket.Category != shopifyComplianceTicketCategory ||
		ticket.Type != TicketTypeInternal ||
		ticket.Priority != "urgent" ||
		ticket.CreatedBy != shopifyComplianceWebhookActor ||
		ticket.AssignedAgentID != "user-compliance-admin" ||
		ticket.CustomerEmail != "" ||
		ticket.DueAt == nil ||
		time.Until(*ticket.DueAt) < 29*24*time.Hour {
		t.Fatalf("unexpected compliance ticket: %#v", ticket)
	}
	if strings.Contains(ticket.Description, "private@example.com") || strings.Contains(ticket.Description, "555-625-1199") {
		t.Fatalf("compliance ticket retained unnecessary PII: %s", ticket.Description)
	}
	var description shopifyComplianceTicketDescription
	if err := json.Unmarshal([]byte(ticket.Description), &description); err != nil {
		t.Fatalf("decode compliance ticket description: %v", err)
	}
	if description.Topic != shopifyCustomersDataRequestTopic ||
		description.ShopifyCustomer != "191167" ||
		description.DataRequestID != "9999" ||
		len(description.OrderIDs) != 2 ||
		description.OrderIDs[0] != "299938" {
		t.Fatalf("unexpected compliance ticket description: %#v", description)
	}
}

func TestShopifyComplianceWebhookRejectsInvalidHMAC(t *testing.T) {
	const raw = `{"shop_id":954889,"shop_domain":"demo.myshopify.com"}`
	server, store, shop := newShopifyComplianceTestServer(t)
	recorder := httptest.NewRecorder()
	request := newShopifyComplianceRequest(raw, shopifyShopRedactTopic, "delivery-invalid", "wrong-secret")
	server.handleShopifyComplianceWebhook(recorder, request)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected invalid HMAC status 401, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	tickets, err := store.ListTickets(t.Context(), TicketFilter{ShopID: shop.ID})
	if err != nil || len(tickets) != 0 {
		t.Fatalf("invalid HMAC created compliance tickets: tickets=%#v err=%v", tickets, err)
	}
}

func TestShopifyComplianceWebhookAcceptsUnknownShopWithoutPersistingPII(t *testing.T) {
	const raw = `{"shop_id":954889,"shop_domain":"unknown.myshopify.com","customer":{"id":191167,"email":"private@example.com"}}`
	t.Setenv("SHOPIFY_APP_DISTRIBUTION", shopifyDistributionPublic)
	t.Setenv("SHOPIFY_APP_API_KEY", "client-id")
	t.Setenv("SHOPIFY_APP_API_SECRET", "client-secret")
	store := NewMemoryStore()
	server := NewServer(store)
	recorder := httptest.NewRecorder()
	request := newShopifyComplianceRequest(raw, shopifyCustomersRedactTopic, "delivery-unknown", "client-secret")
	request.Header.Set("X-Shopify-Shop-Domain", "unknown.myshopify.com")
	server.handleShopifyComplianceWebhook(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("unknown shop should be acknowledged safely, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	tickets, err := store.ListTickets(t.Context(), TicketFilter{})
	if err != nil || len(tickets) != 0 {
		t.Fatalf("unknown shop created tickets: tickets=%#v err=%v", tickets, err)
	}
}

func TestShopifyComplianceWebhookRetriesWhenNoPrivacyOwnerExists(t *testing.T) {
	const raw = `{"shop_id":954889,"shop_domain":"demo.myshopify.com","customer":{"id":191167}}`
	t.Setenv("SHOPIFY_APP_DISTRIBUTION", shopifyDistributionPublic)
	t.Setenv("SHOPIFY_APP_API_KEY", "client-id")
	t.Setenv("SHOPIFY_APP_API_SECRET", "client-secret")
	store := NewMemoryStore()
	if _, err := store.CreateShop(t.Context(), Shop{
		DisplayName: "Demo Shop",
		ExternalID:  "demo.myshopify.com",
		Metadata:    map[string]string{"shopifyDomain": "demo.myshopify.com"},
	}); err != nil {
		t.Fatalf("CreateShop failed: %v", err)
	}
	recorder := httptest.NewRecorder()
	request := newShopifyComplianceRequest(raw, shopifyCustomersRedactTopic, "delivery-no-owner", "client-secret")
	NewServer(store).handleShopifyComplianceWebhook(recorder, request)
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected missing privacy owner to return 503, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	if strings.Contains(recorder.Body.String(), "owner") || strings.Contains(recorder.Body.String(), "configured") {
		t.Fatalf("internal owner error leaked to webhook response: %s", recorder.Body.String())
	}
}

func TestShopifyComplianceWebhookRequiresJSONAndKnownTopic(t *testing.T) {
	server, _, _ := newShopifyComplianceTestServer(t)

	badContentType := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/webhooks/shopify/compliance", strings.NewReader(`{}`))
	request.Header.Set("Content-Type", "text/plain")
	server.handleShopifyComplianceWebhook(badContentType, request)
	if badContentType.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("expected status 415, got %d", badContentType.Code)
	}

	const raw = `{"shop_id":954889,"shop_domain":"demo.myshopify.com"}`
	badTopic := httptest.NewRecorder()
	request = newShopifyComplianceRequest(raw, "orders/create", "delivery-topic", "client-secret")
	server.handleShopifyComplianceWebhook(badTopic, request)
	if badTopic.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400 for unrelated topic, got %d body=%s", badTopic.Code, badTopic.Body.String())
	}
}

func newShopifyComplianceTestServer(t *testing.T) (*Server, *MemoryStore, Shop) {
	t.Helper()
	t.Setenv("SHOPIFY_APP_DISTRIBUTION", shopifyDistributionPublic)
	t.Setenv("SHOPIFY_APP_API_KEY", "client-id")
	t.Setenv("SHOPIFY_APP_API_SECRET", "client-secret")
	store := NewMemoryStore()
	if _, err := store.CreateUser(t.Context(), User{
		ID:           "user-compliance-admin",
		Email:        "privacy-admin@example.test",
		DisplayName:  "Privacy Admin",
		Role:         UserRoleAdmin,
		Status:       UserStatusActive,
		SystemAdmin:  true,
		PasswordHash: "not-used-in-test",
	}); err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}
	shop, err := store.CreateShop(t.Context(), Shop{
		DisplayName: "Demo Shop",
		ExternalID:  "demo.myshopify.com",
		Metadata:    map[string]string{"shopifyDomain": "demo.myshopify.com"},
	})
	if err != nil {
		t.Fatalf("CreateShop failed: %v", err)
	}
	return NewServer(store), store, shop
}

func newShopifyComplianceRequest(raw string, topic string, webhookID string, secret string) *http.Request {
	request := httptest.NewRequest(http.MethodPost, "/webhooks/shopify/compliance", strings.NewReader(raw))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Shopify-Shop-Domain", "demo.myshopify.com")
	request.Header.Set("X-Shopify-Topic", topic)
	request.Header.Set("X-Shopify-Webhook-Id", webhookID)
	request.Header.Set("X-Shopify-Hmac-Sha256", webhookHMAC(secret, raw))
	return request
}
