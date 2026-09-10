package platform

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestShopifyPrivacyExportAndRedactionCoverCustomerServiceDataAndAttachments(t *testing.T) {
	t.Setenv("XZ_ERP_CONNECTOR_TOKEN", "privacy-service-token")
	store := NewMemoryStore()
	shop, err := store.CreateShop(t.Context(), Shop{
		ID: "00000000-0000-4000-8000-000000000002", DisplayName: "Demo",
		Platform: "shopify", ExternalID: "demo.myshopify.com",
	})
	if err != nil {
		t.Fatalf("create shop: %v", err)
	}
	source, err := store.CreateShopSource(t.Context(), ShopSource{
		ID: "source-demo", ShopID: shop.ID, Type: SourceTypeShopifyChat,
		Address: shop.ExternalID,
	})
	if err != nil {
		t.Fatalf("create source: %v", err)
	}
	matching, err := store.CreateConversation(t.Context(), Conversation{
		ID: "conversation-matching", ShopID: shop.ID, SourceID: source.ID,
		CustomerName: "Mia", CustomerEmail: "MIA@example.com",
	})
	if err != nil {
		t.Fatalf("create matching conversation: %v", err)
	}
	preserved, err := store.CreateConversation(t.Context(), Conversation{
		ID: "conversation-preserved", ShopID: shop.ID, SourceID: source.ID,
		CustomerName: "Other", CustomerEmail: "other@example.com",
	})
	if err != nil {
		t.Fatalf("create preserved conversation: %v", err)
	}
	attachmentName := "att_privacy-test.png"
	if _, _, err := store.AddMessage(t.Context(), Message{
		ID: "message-matching", ConversationID: matching.ID,
		Direction: MessageDirectionCustomer, Type: MessageTypeImage,
		Body: "Customer attachment",
		Metadata: map[string]string{
			publicChatCustomerIDMetadataKey: "6001",
			"url":                           "/api/v1/chat/attachments/" + attachmentName,
			"fileName":                      "proof.png", "mimeType": "image/png",
		},
	}); err != nil {
		t.Fatalf("add matching message: %v", err)
	}
	if _, _, err := store.AddMessage(t.Context(), Message{
		ID: "message-preserved", ConversationID: preserved.ID,
		Direction: MessageDirectionCustomer, Body: "Keep me",
		Metadata: map[string]string{publicChatCustomerIDMetadataKey: "7002"},
	}); err != nil {
		t.Fatalf("add preserved message: %v", err)
	}
	if _, err := store.ReplaceConversationEmailTags(
		t.Context(), matching.ID,
		[]EmailProcessingTag{{Label: "refund", Color: "red"}},
		"agent-1"); err != nil {
		t.Fatalf("create conversation tags: %v", err)
	}
	if _, err := store.CreateKnowledge(t.Context(), KnowledgeEntry{
		ID: "knowledge-matching", Scope: KnowledgeScopeShop,
		ShopID: shop.ID, ConversationID: matching.ID,
		Title: "Customer case", Answer: "Private resolution detail",
		Status: KnowledgeStatusPending,
	}); err != nil {
		t.Fatalf("create conversation knowledge: %v", err)
	}
	matchingTicket, err := store.CreateTicket(t.Context(), Ticket{
		ID: "ticket-matching", Type: TicketTypeCustomer,
		ConversationID: matching.ID, ShopID: shop.ID,
		CustomerRef: "shopify:6001", CustomerEmail: "mia@example.com",
		Title: "Customer request", Description: "Private ticket body",
		Attachments: []TicketAttachment{{
			Name: "proof.png", URL: "/api/v1/chat/attachments/" + attachmentName,
		}},
	})
	if err != nil {
		t.Fatalf("create matching ticket: %v", err)
	}
	if _, err := store.AddTicketComment(t.Context(), TicketComment{
		ID: "comment-matching", TicketID: matchingTicket.ID,
		AuthorID: "agent-1", Body: "Private internal note",
	}); err != nil {
		t.Fatalf("create ticket comment: %v", err)
	}
	if _, err := store.CreateTicket(t.Context(), Ticket{
		ID: "ticket-preserved", Type: TicketTypeCustomer,
		ConversationID: preserved.ID, ShopID: shop.ID,
		CustomerRef: "shopify:7002", CustomerEmail: "other@example.com",
		Title: "Other request", Description: "Keep ticket",
	}); err != nil {
		t.Fatalf("create preserved ticket: %v", err)
	}

	server := NewServer(store)
	server.uploadDir = t.TempDir()
	attachmentContent := []byte("customer attachment content")
	if err := os.WriteFile(
		filepath.Join(server.uploadDir, attachmentName),
		attachmentContent, 0o600); err != nil {
		t.Fatalf("write attachment: %v", err)
	}
	httpServer := httptest.NewServer(server.Routes())
	defer httpServer.Close()

	emailDigest := sha256.Sum256([]byte("mia@example.com"))
	exportRequest := ShopifyPrivacyRequest{
		EventID: "shopify-compliance/customers/data_request/export-1",
		ShopID:  shop.ID, ShopDomain: shop.ExternalID,
		Topic:               shopifyPrivacyTopicCustomerDataRequest,
		CustomerIDs:         []string{"6001"},
		CustomerEmailHashes: []string{hex.EncodeToString(emailDigest[:])},
	}
	var exported shopifyPrivacyExportResponse
	shopifyPrivacyRequestJSON(
		t, httpServer.URL+"/api/v1/internal/customer-service/shopify-compliance/export",
		exportRequest, http.StatusOK, &exported)
	if exported.ContractVersion != shopifyPrivacyContractVersion || exported.RecordCount != 7 {
		t.Fatalf("unexpected export summary: %#v", exported)
	}
	if len(exported.Data.Conversations) != 1 || exported.Data.Conversations[0].ID != matching.ID ||
		len(exported.Data.Messages) != 1 || len(exported.Data.Tickets) != 1 ||
		len(exported.Data.ConversationEmailTags) != 1 ||
		len(exported.Data.KnowledgeEntries) != 1 ||
		len(exported.Data.TicketComments) != 1 || len(exported.Data.Attachments) != 1 {
		t.Fatalf("customer service export coverage mismatch: %#v", exported.Data)
	}
	if !bytes.Equal(exported.Data.Attachments[0].Content, attachmentContent) {
		t.Fatalf("attachment content was not included in export")
	}

	redactRequest := exportRequest
	redactRequest.EventID = "shopify-compliance/customers/redact/redact-1"
	redactRequest.Topic = shopifyPrivacyTopicCustomerRedact
	var first shopifyPrivacyRedactResponse
	shopifyPrivacyRequestJSON(
		t, httpServer.URL+"/api/v1/internal/customer-service/shopify-compliance/redact",
		redactRequest, http.StatusOK, &first)
	if first.RecordCount != 7 || first.AttachmentsDeleted != 1 || first.AlreadyCompleted {
		t.Fatalf("unexpected first redaction result: %#v", first)
	}
	if _, err := os.Stat(filepath.Join(server.uploadDir, attachmentName)); !os.IsNotExist(err) {
		t.Fatalf("attachment was not deleted: %v", err)
	}
	if _, err := store.GetConversation(t.Context(), matching.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("matching conversation still exists: %v", err)
	}
	if _, err := store.GetConversation(t.Context(), preserved.ID); err != nil {
		t.Fatalf("unrelated conversation was removed: %v", err)
	}
	if _, err := store.GetTicket(t.Context(), matchingTicket.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("matching ticket still exists: %v", err)
	}
	if _, err := store.GetKnowledge(t.Context(), "knowledge-matching"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("conversation-derived knowledge still exists: %v", err)
	}
	if _, err := store.GetTicket(t.Context(), "ticket-preserved"); err != nil {
		t.Fatalf("unrelated ticket was removed: %v", err)
	}

	var repeated shopifyPrivacyRedactResponse
	shopifyPrivacyRequestJSON(
		t, httpServer.URL+"/api/v1/internal/customer-service/shopify-compliance/redact",
		redactRequest, http.StatusOK, &repeated)
	if !repeated.AlreadyCompleted || repeated.RecordCount != first.RecordCount {
		t.Fatalf("redaction retry was not idempotent: %#v", repeated)
	}

	shopRedact := ShopifyPrivacyRequest{
		EventID: "shopify-compliance/shop/redact/redact-shop-1",
		ShopID:  shop.ID, ShopDomain: shop.ExternalID,
		Topic: shopifyPrivacyTopicShopRedact,
	}
	var shopResult shopifyPrivacyRedactResponse
	shopifyPrivacyRequestJSON(
		t, httpServer.URL+"/api/v1/internal/customer-service/shopify-compliance/redact",
		shopRedact, http.StatusOK, &shopResult)
	if shopResult.RecordCount != 4 {
		t.Fatalf("shop redaction did not count the shop and remaining data: %#v", shopResult)
	}
	if _, err := store.GetShop(t.Context(), shop.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("shop redaction left the shop record: %v", err)
	}
	if _, err := store.GetTicket(t.Context(), "ticket-preserved"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("shop redaction left the remaining ticket: %v", err)
	}
}

func TestERPTenantMuxAuthenticatesComplianceBeforeCreatingTenantStore(t *testing.T) {
	t.Setenv("XZ_ERP_CONNECTOR_TOKEN", "privacy-service-token")
	factory := NewMemoryERPTenantStoreFactory()
	defaultServer := NewServer(NewMemoryStore())
	mux, err := NewERPTenantMux(
		defaultServer, &tokenERPIdentityVerifier{identities: map[string]ERPIdentity{}}, factory, false, nil)
	if err != nil {
		t.Fatalf("create tenant mux: %v", err)
	}
	tenantID := "00000000-0000-4000-8000-000000000001"
	body, _ := json.Marshal(ShopifyPrivacyRequest{
		EventID:     "shopify-compliance/customers/data_request/export-2",
		ShopID:      "00000000-0000-4000-8000-000000000099",
		ShopDomain:  "demo.myshopify.com",
		Topic:       shopifyPrivacyTopicCustomerDataRequest,
		CustomerIDs: []string{"6001"},
	})
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/internal/customer-service/shopify-compliance/export",
		bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(erpTenantHeader, tenantID)
	request.Header.Set("X-XZ-ERP-Connector-Token", "wrong-token")
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden || len(factory.stores) != 0 {
		t.Fatalf("unauthenticated request created tenant state: status=%d stores=%d", response.Code, len(factory.stores))
	}

	tenantStore, err := factory.StoreForTenant(t.Context(), tenantID)
	if err != nil {
		t.Fatalf("create tenant store: %v", err)
	}
	if _, err := tenantStore.CreateShop(t.Context(), Shop{
		ID:          "00000000-0000-4000-8000-000000000099",
		DisplayName: "Tenant A", Platform: "shopify",
		ExternalID: "demo.myshopify.com",
	}); err != nil {
		t.Fatalf("seed tenant shop: %v", err)
	}
	valid := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/internal/customer-service/shopify-compliance/export",
		bytes.NewReader(body))
	valid.Header.Set("Content-Type", "application/json")
	valid.Header.Set(erpTenantHeader, tenantID)
	valid.Header.Set("X-XZ-ERP-Connector-Token", "privacy-service-token")
	validResponse := httptest.NewRecorder()
	mux.ServeHTTP(validResponse, valid)
	if validResponse.Code != http.StatusOK {
		t.Fatalf("tenant-scoped export status=%d body=%s", validResponse.Code, validResponse.Body.String())
	}

	wrongTenant := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/internal/customer-service/shopify-compliance/export",
		bytes.NewReader(body))
	wrongTenant.Header.Set("Content-Type", "application/json")
	wrongTenant.Header.Set(erpTenantHeader, "00000000-0000-4000-8000-000000000003")
	wrongTenant.Header.Set("X-XZ-ERP-Connector-Token", "privacy-service-token")
	wrongTenantResponse := httptest.NewRecorder()
	mux.ServeHTTP(wrongTenantResponse, wrongTenant)
	if wrongTenantResponse.Code != http.StatusNotFound {
		t.Fatalf("cross-tenant export was not isolated: status=%d body=%s", wrongTenantResponse.Code, wrongTenantResponse.Body.String())
	}
}

func TestShopifyPrivacyRedactionReceiptSurvivesFileStoreRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "tenant.json")
	store, err := OpenFileStore(path)
	if err != nil {
		t.Fatalf("open file store: %v", err)
	}
	shop, err := store.CreateShop(t.Context(), Shop{
		ID: "shop-restart", DisplayName: "Restart",
		Platform: "shopify", ExternalID: "restart.myshopify.com",
	})
	if err != nil {
		t.Fatalf("create shop: %v", err)
	}
	source, err := store.CreateShopSource(t.Context(), ShopSource{
		ID: "source-restart", ShopID: shop.ID,
		Type: SourceTypeShopifyChat, Address: shop.ExternalID,
	})
	if err != nil {
		t.Fatalf("create source: %v", err)
	}
	conversation, err := store.CreateConversation(t.Context(), Conversation{
		ID: "conversation-restart", ShopID: shop.ID, SourceID: source.ID,
	})
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	if _, _, err := store.AddMessage(t.Context(), Message{
		ID: "message-restart", ConversationID: conversation.ID,
		Direction: MessageDirectionCustomer, Body: "Delete after restart",
		Metadata: map[string]string{publicChatCustomerIDMetadataKey: "9001"},
	}); err != nil {
		t.Fatalf("create message: %v", err)
	}
	request := ShopifyPrivacyRequest{
		EventID: "shopify-compliance/customers/redact/restart-1",
		ShopID:  shop.ID, ShopDomain: shop.ExternalID,
		Topic:       shopifyPrivacyTopicCustomerRedact,
		CustomerIDs: []string{"9001"},
	}
	receipt, err := store.RedactShopifyPrivacy(t.Context(), request)
	if err != nil || receipt.RecordCount != 2 || receipt.FilesDeleted {
		t.Fatalf("first redaction receipt mismatch: %#v err=%v", receipt, err)
	}
	reopened, err := OpenFileStore(path)
	if err != nil {
		t.Fatalf("reopen file store: %v", err)
	}
	restored, err := reopened.RedactShopifyPrivacy(t.Context(), request)
	if err != nil || restored.RequestFingerprint != receipt.RequestFingerprint || restored.RecordCount != receipt.RecordCount {
		t.Fatalf("redaction receipt did not survive restart: %#v err=%v", restored, err)
	}
	if _, err := reopened.AcknowledgeShopifyPrivacyFilesDeleted(
		t.Context(), request.EventID, restored.RequestFingerprint); err != nil {
		t.Fatalf("acknowledge file deletion: %v", err)
	}
	reopenedAgain, err := OpenFileStore(path)
	if err != nil {
		t.Fatalf("reopen acknowledged store: %v", err)
	}
	completed, err := reopenedAgain.RedactShopifyPrivacy(t.Context(), request)
	if err != nil || !completed.FilesDeleted {
		t.Fatalf("completed receipt did not survive restart: %#v err=%v", completed, err)
	}
}

func shopifyPrivacyRequestJSON(
	t *testing.T,
	endpoint string,
	payload ShopifyPrivacyRequest,
	expectedStatus int,
	target any) {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	request, err := http.NewRequestWithContext(
		context.Background(), http.MethodPost, endpoint, bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("create request: %v", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-XZ-ERP-Connector-Token", "privacy-service-token")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("send request: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != expectedStatus {
		t.Fatalf("status=%d want=%d", response.StatusCode, expectedStatus)
	}
	if target != nil && json.NewDecoder(response.Body).Decode(target) != nil {
		t.Fatalf("decode response failed")
	}
}
