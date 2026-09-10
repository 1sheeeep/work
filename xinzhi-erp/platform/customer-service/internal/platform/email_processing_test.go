package platform

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func TestEmailProcessingWorkflowAndCustomerIsolation(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Operations Store"})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{
		ShopID: shop.ID, Type: SourceTypeEmail, Provider: "outlook", Address: "ops@example.com",
	})
	if err != nil {
		t.Fatal(err)
	}
	chatSource, err := store.CreateShopSource(ctx, ShopSource{
		ShopID: shop.ID, Type: SourceTypeShopifyChat, Provider: "xzdesk_widget", Address: "operations.myshopify.com",
	})
	if err != nil {
		t.Fatal(err)
	}
	chatConversation, err := store.CreateConversation(ctx, Conversation{
		ShopID: shop.ID, SourceID: chatSource.ID, Subject: "Online chat", Kind: ConversationKindSystem,
		Classification: "self-service order lookup", ReplyAllowed: false,
	})
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateConversation(ctx, Conversation{
		ShopID: shop.ID, SourceID: source.ID, CustomerName: "Account Security", CustomerEmail: "alerts@example.com",
		Subject: "Your verification code is 482915", Kind: ConversationKindSystem,
		Classification: verificationSystemNotificationClassification,
	})
	if err != nil {
		t.Fatal(err)
	}
	message, _, err := store.AddMessage(ctx, Message{
		ConversationID: conversation.ID, Direction: MessageDirectionSystem, Type: MessageTypeText,
		Body: "Use verification code 482915 to sign in.", SenderName: "Account Security", SenderEmail: "alerts@example.com",
	})
	if err != nil {
		t.Fatal(err)
	}
	otherConversation, err := store.CreateConversation(ctx, Conversation{
		ShopID: shop.ID, SourceID: source.ID, CustomerName: "Unknown Sender", CustomerEmail: "unknown@example.com",
		Subject: "Unclear store update", Kind: ConversationKindSystem,
		Classification: pendingSystemNotificationClassification,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.AddMessage(ctx, Message{
		ConversationID: otherConversation.ID, Direction: MessageDirectionSystem, Type: MessageTypeText,
		Body: "Please review this message manually.", SenderName: "Unknown Sender", SenderEmail: "unknown@example.com",
	}); err != nil {
		t.Fatal(err)
	}

	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var page emailProcessingPage
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/email-processing?status=open", adminToken, nil, http.StatusOK, &page)
	if page.Total != 2 || page.OpenCount != 2 || len(page.Items) != 2 {
		t.Fatalf("unexpected email processing page: %#v", page)
	}
	categoriesByConversationID := make(map[string]string, len(page.Items))
	for _, item := range page.Items {
		categoriesByConversationID[item.Conversation.ID] = item.Category
	}
	if categoriesByConversationID[conversation.ID] != emailProcessingCategoryVerification {
		t.Fatalf("verification email category was not retained: %#v", page.Items)
	}
	if categoriesByConversationID[otherConversation.ID] != emailProcessingCategoryOther {
		t.Fatalf("unclear email was not classified as other: %#v", page.Items)
	}
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/email-processing?status=pending", adminToken, nil, http.StatusBadRequest, nil)
	var allPage emailProcessingPage
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/email-processing", adminToken, nil, http.StatusOK, &allPage)
	if allPage.Total != 2 || allPage.OpenCount != 2 {
		t.Fatalf("email processing queue counts are incorrect: %#v", allPage)
	}
	for _, search := range []string{"Operations Store", "ops@example.com"} {
		var searchPage emailProcessingPage
		requestJSON(t, http.MethodGet, server.URL+"/api/v1/email-processing?search="+url.QueryEscape(search), adminToken, nil, http.StatusOK, &searchPage)
		if searchPage.Total != 2 || len(searchPage.Items) != 2 {
			t.Fatalf("email processing search %q did not find both shop emails: %#v", search, searchPage)
		}
	}
	for _, search := range []string{"Account Security", "alerts@example.com", "482915"} {
		var searchPage emailProcessingPage
		requestJSON(t, http.MethodGet, server.URL+"/api/v1/email-processing?search="+url.QueryEscape(search), adminToken, nil, http.StatusOK, &searchPage)
		if searchPage.Total != 1 || len(searchPage.Items) != 1 || searchPage.Items[0].Conversation.ID != conversation.ID {
			t.Fatalf("email processing search %q did not find the expected message: %#v", search, searchPage)
		}
	}

	var customerConversations []Conversation
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations", adminToken, nil, http.StatusOK, &customerConversations)
	if len(customerConversations) != 0 {
		t.Fatalf("system email leaked into customer workbench: %#v", customerConversations)
	}
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/email-processing/"+chatConversation.ID, adminToken, nil, http.StatusNotFound, nil)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/email-processing/"+chatConversation.ID+"/handled", adminToken, nil, http.StatusNotFound, nil)

	var detail emailProcessingDetail
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/email-processing/"+conversation.ID, adminToken, nil, http.StatusOK, &detail)
	if len(detail.Messages) != 1 || detail.Messages[0].ID != message.ID {
		t.Fatalf("unexpected email detail: %#v", detail)
	}

	var handled emailProcessingActionResponse
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/email-processing/"+conversation.ID+"/handled", adminToken, nil, http.StatusOK, &handled)
	if handled.Item.Conversation.Status != ConversationStatusClosed || !handled.EmailReadSynced {
		t.Fatalf("unexpected handled response: %#v", handled)
	}
	_, reopenedByMessage, err := store.AddMessage(ctx, Message{
		ConversationID: conversation.ID, Direction: MessageDirectionSystem, Type: MessageTypeText,
		Body: "A newer account notification arrived.", SenderName: "Account Security", SenderEmail: "alerts@example.com",
	})
	if err != nil {
		t.Fatal(err)
	}
	if reopenedByMessage.Status != ConversationStatusOpen {
		t.Fatalf("new system notification did not reopen handled thread: %#v", reopenedByMessage)
	}
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/email-processing/"+conversation.ID+"/handled", adminToken, nil, http.StatusOK, &handled)

	var reopened emailProcessingActionResponse
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/email-processing/"+conversation.ID+"/reopen", adminToken, nil, http.StatusOK, &reopened)
	if reopened.Item.Conversation.Status != ConversationStatusOpen {
		t.Fatalf("unexpected reopened response: %#v", reopened)
	}

	var promoted struct {
		Conversation Conversation `json:"conversation"`
	}
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/email-processing/"+conversation.ID+"/promote", adminToken, nil, http.StatusOK, &promoted)
	if promoted.Conversation.Kind != ConversationKindCustomer || promoted.Conversation.Status != ConversationStatusOpen {
		t.Fatalf("unexpected promoted conversation: %#v", promoted.Conversation)
	}
	messages, err := store.ListMessages(ctx, conversation.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 2 || messages[0].Direction != MessageDirectionCustomer || messages[1].Direction != MessageDirectionCustomer {
		t.Fatalf("promoted messages were not converted to customer direction: %#v", messages)
	}
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/email-processing/"+conversation.ID, adminToken, nil, http.StatusNotFound, nil)
}

func TestEmailProcessingDetailKeepsOriginalAndTranslatesProviderEmailOnDemand(t *testing.T) {
	var aiCalls atomic.Int32
	aiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || len(payload.Messages) != 2 ||
			!strings.Contains(payload.Messages[1].Content, "Payment failed for order #7079") ||
			strings.Contains(payload.Messages[1].Content, "!important") {
			http.Error(w, "unexpected provider email translation input", http.StatusBadRequest)
			return
		}
		aiCalls.Add(1)
		writeJSONResponse(w, http.StatusOK, map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": "订单 #7079 付款失败，请检查账单。"}}},
		})
	}))
	defer aiServer.Close()
	t.Setenv("AI_API_KEY", "email-processing-translation-test-key")
	t.Setenv("AI_BASE_URL", aiServer.URL)
	t.Setenv("AI_MODEL", "email-processing-translation-test-model")

	ctx := context.Background()
	store := NewMemoryStore()
	passwordHash, err := hashPassword("email-processing-translation-admin")
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.CreateUser(ctx, User{
		Email: "email-processing-translation-admin@example.com", Role: UserRoleAdmin, PasswordHash: passwordHash,
	})
	if err != nil {
		t.Fatal(err)
	}
	shop, _ := store.CreateShop(ctx, Shop{DisplayName: "Translation Store"})
	source, _ := store.CreateShopSource(ctx, ShopSource{
		ShopID: shop.ID, Type: SourceTypeEmail, Provider: "outlook", Address: "ops@example.com",
	})
	conversation, _ := store.CreateConversation(ctx, Conversation{
		ShopID: shop.ID, SourceID: source.ID, CustomerName: "Shopify", CustomerEmail: "notifications@example.com",
		Subject: "Payment notice", Kind: ConversationKindSystem, Classification: automatedSystemNotificationClassification,
	})
	message, _, err := store.AddMessage(ctx, Message{
		ConversationID: conversation.ID, Direction: MessageDirectionSystem, Type: MessageTypeText,
		Body:       "u + .body { height:100%!important; line-height:100%!important; } Payment failed for order #7079. Check billing.",
		Metadata:   map[string]string{"outlook_message_id": "provider-message-1"},
		SenderName: "Shopify", SenderEmail: "notifications@example.com",
	})
	if err != nil {
		t.Fatal(err)
	}

	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email: "email-processing-translation-admin@example.com", Password: "email-processing-translation-admin",
	}, http.StatusOK, &login)

	var detail emailProcessingDetail
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/email-processing/"+conversation.ID, login.Token, nil, http.StatusOK, &detail)
	if len(detail.Messages) != 1 || strings.Contains(detail.Messages[0].Body, "!important") ||
		detail.Messages[0].Body != "Payment failed for order #7079. Check billing." {
		t.Fatalf("provider style artifacts were not removed from email detail: %#v", detail.Messages)
	}

	storedBeforeClick, err := store.GetMessage(ctx, conversation.ID, message.ID)
	if err != nil {
		t.Fatal(err)
	}
	if aiCalls.Load() != 0 || storedBeforeClick.Metadata[messageTranslationStatusKey] != "" || storedBeforeClick.Metadata[messageTranslationZHKey] != "" {
		t.Fatalf("opening email detail must not translate automatically: calls=%d message=%#v", aiCalls.Load(), storedBeforeClick)
	}

	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages/"+message.ID+"/translate", login.Token, nil, http.StatusForbidden, nil)
	var translated Message
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/email-processing/"+conversation.ID+"/messages/"+message.ID+"/translate", login.Token, nil, http.StatusOK, &translated)
	if translated.Metadata[messageTranslationZHKey] != "订单 #7079 付款失败，请检查账单。" ||
		translated.Metadata[messageTranslationStatusKey] != messageTranslationDone || aiCalls.Load() != 1 {
		t.Fatalf("provider system email translation was not persisted on demand: calls=%d message=%#v", aiCalls.Load(), translated)
	}
}

func TestEmailProcessingCategoryDoesNotTreatUnknownContentAsPlatformNotification(t *testing.T) {
	unknown := Conversation{Subject: "Online chat", Classification: "self-service order lookup"}
	if got := emailProcessingCategory(unknown, nil); got != emailProcessingCategoryOther {
		t.Fatalf("unknown system content category = %q, want %q", got, emailProcessingCategoryOther)
	}
	platformNotice := Conversation{Subject: "General account update", Classification: automatedSystemNotificationClassification}
	if got := emailProcessingCategory(platformNotice, nil); got != emailProcessingCategoryPlatform {
		t.Fatalf("explicit platform notification category = %q, want %q", got, emailProcessingCategoryPlatform)
	}
}

func TestEmailProcessingTagsAndShopifyOfficialDomain(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Tagged Store"})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{
		ShopID: shop.ID, Type: SourceTypeEmail, Provider: "gmail", Address: "ops@example.com",
	})
	if err != nil {
		t.Fatal(err)
	}
	official, err := store.CreateConversation(ctx, Conversation{
		ShopID: shop.ID, SourceID: source.ID, CustomerName: "Shopify", CustomerEmail: "mailer@notify.shopify.com",
		Subject: "Payout notice", Kind: ConversationKindSystem,
	})
	if err != nil {
		t.Fatal(err)
	}
	lookalike, err := store.CreateConversation(ctx, Conversation{
		ShopID: shop.ID, SourceID: source.ID, CustomerName: "Lookalike", CustomerEmail: "mailer@shopify.com.evil.test",
		Subject: "Not official", Kind: ConversationKindSystem,
	})
	if err != nil {
		t.Fatal(err)
	}

	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var initial emailProcessingPage
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/email-processing", adminToken, nil, http.StatusOK, &initial)
	if len(initial.TagOptions) != 0 {
		t.Fatalf("new tag filter should be empty: %#v", initial.TagOptions)
	}
	items := map[string]emailProcessingItem{}
	for _, item := range initial.Items {
		items[item.Conversation.ID] = item
	}
	if !items[official.ID].ShopifyOfficial || items[lookalike.ID].ShopifyOfficial {
		t.Fatalf("Shopify domain identification was not strict: official=%#v lookalike=%#v", items[official.ID], items[lookalike.ID])
	}

	inputTags := []EmailProcessingTag{{Label: "财务跟进", Color: "red"}, {Label: "重点", Color: "blue"}}
	var updated emailProcessingItem
	requestJSON(t, http.MethodPut, server.URL+"/api/v1/email-processing/"+official.ID+"/tags", adminToken,
		map[string]any{"tags": inputTags}, http.StatusOK, &updated)
	if len(updated.Tags) != 2 || updated.Tags[0] != inputTags[0] || updated.Tags[1] != inputTags[1] {
		t.Fatalf("tags were not saved: %#v", updated.Tags)
	}

	var filtered emailProcessingPage
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/email-processing?tag="+url.QueryEscape("财务跟进"), adminToken, nil, http.StatusOK, &filtered)
	if filtered.Total != 1 || len(filtered.Items) != 1 || filtered.Items[0].Conversation.ID != official.ID || len(filtered.TagOptions) != 2 {
		t.Fatalf("tag filter did not return the tagged thread: %#v", filtered)
	}
	var detail emailProcessingDetail
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/email-processing/"+official.ID, adminToken, nil, http.StatusOK, &detail)
	if len(detail.Item.Tags) != 2 || detail.Item.Tags[0].Label != "财务跟进" {
		t.Fatalf("detail did not retain thread tags: %#v", detail.Item.Tags)
	}

	requestJSON(t, http.MethodPut, server.URL+"/api/v1/email-processing/"+official.ID+"/tags", adminToken,
		map[string]any{"tags": []EmailProcessingTag{{Label: "重点", Color: "purple"}, {Label: "重点", Color: "green"}}}, http.StatusOK, &updated)
	if len(updated.Tags) != 1 || updated.Tags[0].Color != "green" {
		t.Fatalf("duplicate tag update was not normalized: %#v", updated.Tags)
	}
	requestJSON(t, http.MethodPut, server.URL+"/api/v1/email-processing/"+official.ID+"/tags", adminToken,
		map[string]any{"tags": []EmailProcessingTag{{Label: "非法颜色", Color: "pink"}}}, http.StatusBadRequest, nil)
	requestJSON(t, http.MethodPut, server.URL+"/api/v1/email-processing/"+official.ID+"/tags", adminToken,
		map[string]any{"tags": []EmailProcessingTag{
			{Label: "一", Color: "red"}, {Label: "二", Color: "orange"}, {Label: "三", Color: "yellow"},
			{Label: "四", Color: "green"}, {Label: "五", Color: "blue"}, {Label: "六", Color: "purple"},
		}}, http.StatusBadRequest, nil)
	requestJSON(t, http.MethodPut, server.URL+"/api/v1/email-processing/"+official.ID+"/tags", adminToken,
		map[string]any{"tags": []EmailProcessingTag{{Label: "这是超过十二个字符的邮件标签名称", Color: "red"}}}, http.StatusBadRequest, nil)
}

func TestFileStorePersistsConversationEmailTags(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "store.json")
	store, err := OpenFileStore(path)
	if err != nil {
		t.Fatal(err)
	}
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Persistent Store"})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{
		ShopID: shop.ID, Type: SourceTypeEmail, Provider: "outlook", Address: "ops@example.com",
	})
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateConversation(ctx, Conversation{
		ShopID: shop.ID, SourceID: source.ID, CustomerEmail: "mailer@shopify.com", Kind: ConversationKindSystem,
	})
	if err != nil {
		t.Fatal(err)
	}
	want := []EmailProcessingTag{{Label: "财务", Color: "orange"}}
	if _, err := store.ReplaceConversationEmailTags(ctx, conversation.ID, want, "admin"); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenFileStore(path)
	if err != nil {
		t.Fatal(err)
	}
	all, err := reopened.ListConversationEmailTags(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(all[conversation.ID]) != 1 || all[conversation.ID][0] != want[0] {
		t.Fatalf("file store did not persist conversation tags: %#v", all)
	}
}

func TestEmailProcessingPermissionsAndAssignedShopScope(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	assignedShop, err := store.CreateShop(ctx, Shop{DisplayName: "Assigned Store"})
	if err != nil {
		t.Fatal(err)
	}
	otherShop, err := store.CreateShop(ctx, Shop{DisplayName: "Other Store"})
	if err != nil {
		t.Fatal(err)
	}
	assignedSource, err := store.CreateShopSource(ctx, ShopSource{
		ShopID: assignedShop.ID, Type: SourceTypeEmail, Provider: "gmail", Address: "assigned@example.com",
	})
	if err != nil {
		t.Fatal(err)
	}
	otherSource, err := store.CreateShopSource(ctx, ShopSource{
		ShopID: otherShop.ID, Type: SourceTypeEmail, Provider: "outlook", Address: "other@example.com",
	})
	if err != nil {
		t.Fatal(err)
	}
	assignedConversation, err := store.CreateConversation(ctx, Conversation{
		ShopID: assignedShop.ID, SourceID: assignedSource.ID, CustomerEmail: "alerts@example.com",
		Subject: "Assigned notification", Kind: ConversationKindSystem,
	})
	if err != nil {
		t.Fatal(err)
	}
	otherConversation, err := store.CreateConversation(ctx, Conversation{
		ShopID: otherShop.ID, SourceID: otherSource.ID, CustomerEmail: "alerts@example.com",
		Subject: "Other notification", Kind: ConversationKindSystem,
	})
	if err != nil {
		t.Fatal(err)
	}

	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var defaultAdmin User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email: "default-admin@example.com", DisplayName: "Default Admin", Password: "admin-password", Role: UserRoleAdmin,
	}, http.StatusCreated, &defaultAdmin)
	var defaultAdminLogin AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email: "default-admin@example.com", Password: "admin-password",
	}, http.StatusOK, &defaultAdminLogin)
	var adminPage emailProcessingPage
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/email-processing", defaultAdminLogin.Token, nil, http.StatusOK, &adminPage)
	if adminPage.Total != 2 || len(adminPage.Shops) != 2 || len(adminPage.Mailboxes) != 2 {
		t.Fatalf("default administrator did not receive global email access: %#v", adminPage)
	}

	var restrictedAdmin User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email: "restricted-admin@example.com", DisplayName: "Restricted Admin", Password: "admin-password", Role: UserRoleAdmin,
		Permissions: []string{PermissionTicketsView}, PermissionsCustomized: true,
	}, http.StatusCreated, &restrictedAdmin)
	var restrictedAdminLogin AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email: "restricted-admin@example.com", Password: "admin-password",
	}, http.StatusOK, &restrictedAdminLogin)
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/email-processing", restrictedAdminLogin.Token, nil, http.StatusForbidden, nil)

	var defaultAgent User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email: "default-agent@example.com", DisplayName: "Default Agent", Password: "agent-password", Role: UserRoleAgent,
	}, http.StatusCreated, &defaultAgent)
	var defaultAgentLogin AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email: "default-agent@example.com", Password: "agent-password",
	}, http.StatusOK, &defaultAgentLogin)
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/email-processing", defaultAgentLogin.Token, nil, http.StatusForbidden, nil)

	var permittedAgent User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email: "email-processing-agent@example.com", DisplayName: "Email Agent", Password: "agent-password",
		Role: UserRoleAgent, Permissions: []string{PermissionEmailProcessingManage}, PermissionsCustomized: true,
	}, http.StatusCreated, &permittedAgent)
	if _, err := store.AssignUserToShop(ctx, assignedShop.ID, permittedAgent.ID); err != nil {
		t.Fatal(err)
	}
	var permittedAgentLogin AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email: "email-processing-agent@example.com", Password: "agent-password",
	}, http.StatusOK, &permittedAgentLogin)
	var agentPage emailProcessingPage
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/email-processing", permittedAgentLogin.Token, nil, http.StatusOK, &agentPage)
	if agentPage.Total != 1 || len(agentPage.Items) != 1 || agentPage.Items[0].Conversation.ID != assignedConversation.ID ||
		len(agentPage.Shops) != 1 || agentPage.Shops[0].ID != assignedShop.ID ||
		len(agentPage.Mailboxes) != 1 || agentPage.Mailboxes[0].ID != assignedSource.ID {
		t.Fatalf("agent email access was not limited to assigned shops: %#v", agentPage)
	}
	var inaccessibleShopPage emailProcessingPage
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/email-processing?shopId="+otherShop.ID, permittedAgentLogin.Token, nil, http.StatusOK, &inaccessibleShopPage)
	if inaccessibleShopPage.Total != 0 || len(inaccessibleShopPage.Items) != 0 || len(inaccessibleShopPage.Shops) != 1 || len(inaccessibleShopPage.Mailboxes) != 1 {
		t.Fatalf("agent filter leaked an unassigned shop: %#v", inaccessibleShopPage)
	}
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/email-processing/"+assignedConversation.ID, permittedAgentLogin.Token, nil, http.StatusOK, &emailProcessingDetail{})
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/email-processing/"+otherConversation.ID, permittedAgentLogin.Token, nil, http.StatusForbidden, nil)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/email-processing/"+assignedConversation.ID+"/messages/missing/translate", permittedAgentLogin.Token, nil, http.StatusNotFound, nil)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/email-processing/"+otherConversation.ID+"/messages/missing/translate", permittedAgentLogin.Token, nil, http.StatusForbidden, nil)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/email-processing/"+otherConversation.ID+"/handled", permittedAgentLogin.Token, nil, http.StatusForbidden, nil)
	requestJSON(t, http.MethodPut, server.URL+"/api/v1/email-processing/"+assignedConversation.ID+"/tags", permittedAgentLogin.Token,
		map[string]any{"tags": []EmailProcessingTag{{Label: "跟进", Color: "blue"}}}, http.StatusOK, &emailProcessingItem{})
	requestJSON(t, http.MethodPut, server.URL+"/api/v1/email-processing/"+otherConversation.ID+"/tags", permittedAgentLogin.Token,
		map[string]any{"tags": []EmailProcessingTag{{Label: "越权", Color: "red"}}}, http.StatusForbidden, nil)
}
