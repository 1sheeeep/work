package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestConversationRecordAgentFlowPersistsAfterClose(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var agent User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email: "record-agent@example.com", DisplayName: "Record Agent", Password: "password-123", Role: UserRoleAgent,
	}, http.StatusCreated, &agent)
	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email: "record-agent@example.com", Password: "password-123",
	}, http.StatusOK, &login)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Record Shop"}, http.StatusCreated, &shop)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: agent.ID}, http.StatusCreated, nil)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat}, http.StatusCreated, &source)
	var conversation Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations", adminToken, Conversation{
		ShopID: shop.ID, SourceID: source.ID, CustomerName: "Mia", CustomerEmail: "mia@example.com", Subject: "Order #12345 tracking",
	}, http.StatusCreated, &conversation)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", adminToken, Message{
		Direction: MessageDirectionCustomer, Body: "The order shipped but tracking has not moved.",
	}, http.StatusCreated, nil)

	var automatic Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/record-auto", login.Token, nil, http.StatusOK, &automatic)
	if !automatic.RecordClassified || !automatic.RecordAutoFilled || automatic.RecordSecondary != "物流查询" {
		t.Fatalf("unexpected automatic classification: %#v", automatic)
	}

	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/claim", login.Token, nil, http.StatusOK, nil)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/close", login.Token, nil, http.StatusOK, nil)

	manualInput := conversationRecordRequest{
		Primary: "已发货", Secondary: "物流查询", Tertiary: "查询实时轨迹", Remark: "客户询问订单状态及预计送达日期，客服已回复包裹轨迹。",
	}
	var manual Conversation
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/conversations/"+conversation.ID+"/record", login.Token, manualInput, http.StatusOK, &manual)
	if manual.Status != ConversationStatusClosed || manual.RecordAutoFilled || manual.RecordRemark != manualInput.Remark {
		t.Fatalf("closed record was not saved as a manual edit: %#v", manual)
	}

	var repeatedAuto Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/record-auto", login.Token, nil, http.StatusOK, &repeatedAuto)
	if repeatedAuto.RecordRemark != manualInput.Remark || repeatedAuto.RecordTertiary != manualInput.Tertiary || repeatedAuto.RecordAutoFilled {
		t.Fatalf("automatic classification overwrote a manual edit: %#v", repeatedAuto)
	}

	var records processingRecordsResponse
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/processing-records?shopId="+shop.ID+"&primary=已发货", adminToken, nil, http.StatusOK, &records)
	if records.Summary.Total != 1 || len(records.Items) != 1 || records.Items[0].OrderNumber != "12345" || records.Items[0].AgentID != agent.ID || records.Page != 1 || records.PageSize != 30 {
		t.Fatalf("unexpected processing records: %#v", records)
	}
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/processing-records", adminToken, nil, http.StatusBadRequest, nil)
	now := time.Now()
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.Local).Format("2006-01-02")
	monthEnd := time.Date(now.Year(), now.Month()+1, 0, 0, 0, 0, 0, time.Local).Format("2006-01-02")
	var byMonth processingRecordsResponse
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/processing-records?startDate="+monthStart+"&endDate="+monthEnd, adminToken, nil, http.StatusOK, &byMonth)
	if byMonth.Summary.Total != 1 || len(byMonth.Items) != 1 || byMonth.Items[0].ConversationID != conversation.ID {
		t.Fatalf("monthly processing record filter failed: %#v", byMonth)
	}
	var byAgent processingRecordsResponse
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/processing-records?agentId="+agent.ID+"&channel=chat&pageSize=1", adminToken, nil, http.StatusOK, &byAgent)
	if byAgent.Summary.Total != 1 || len(byAgent.Items) != 1 || byAgent.Items[0].ConversationID != conversation.ID {
		t.Fatalf("agent and channel processing record filter failed: %#v", byAgent)
	}

	req, err := http.NewRequest(http.MethodGet, server.URL+"/api/v1/processing-records/export?shopId="+shop.ID+"&startDate="+monthStart+"&endDate="+monthEnd, nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+adminToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	workbook, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK || !bytes.HasPrefix(workbook, []byte("PK")) || !strings.Contains(resp.Header.Get("Content-Disposition"), ".xlsx") {
		t.Fatalf("unexpected export response: status=%d disposition=%q body=%q", resp.StatusCode, resp.Header.Get("Content-Disposition"), workbook)
	}
}

func TestConversationRecordAutoUsesVerifiedOrderAndLogisticsStatus(t *testing.T) {
	store := NewMemoryStore()
	ctx := context.Background()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Verified Record Shop", ExternalID: "verified-record.myshopify.com"})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeShopifyChat})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateShopSource(ctx, ShopSource{
		ShopID: shop.ID, Type: SourceTypeShopifyAPI, Address: "verified-record.myshopify.com",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveShopifyInstallation(ctx, ShopifyInstallation{
		ShopID: shop.ID, ShopDomain: "verified-record.myshopify.com", AccessToken: "test-shopify-token",
	}); err != nil {
		t.Fatal(err)
	}

	tracker := &fakeLogisticsTracker{}
	platformServer := NewServer(store)
	platformServer.logisticsTracker = tracker
	currentOrderNumber := ""
	currentDisplayStatus := ""
	currentDeliveredAt := ""
	platformServer.publicShopifyOrderSearch = func(_ context.Context, _, _, query string, _ int) (ShopifyOrderSearchResult, error) {
		if query != `email:"buyer@example.com"` && query != "name:#"+currentOrderNumber {
			t.Fatalf("unexpected Shopify query: %q", query)
		}
		if currentOrderNumber == "99999" || currentOrderNumber == "00000" {
			return ShopifyOrderSearchResult{}, nil
		}
		return ShopifyOrderSearchResult{Orders: []ShopifyOrderSummary{{
			ID:                "order-" + currentOrderNumber,
			Name:              "#" + currentOrderNumber,
			Email:             "buyer@example.com",
			FulfillmentStatus: "FULFILLED",
			Fulfillments: []ShopifyFulfillment{{
				Status:        "SUCCESS",
				DisplayStatus: currentDisplayStatus,
				DeliveredAt:   currentDeliveredAt,
				TrackingInfo:  []ShopifyTrackingInfo{{Company: "Other", Number: "TRACK-" + currentOrderNumber}},
			}},
		}}}, nil
	}
	server := httptest.NewServer(platformServer.Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	tests := []struct {
		name          string
		orderNumber   string
		subject       string
		customerText  string
		displayStatus string
		deliveredAt   string
		wantPrimary   string
		wantSecondary string
		wantOrder     bool
	}{
		{
			name:          "Shopify delivered status overrides a generic tracking question",
			orderNumber:   "12345",
			subject:       "Tracking question",
			customerText:  "Where is order #12345?",
			displayStatus: "DELIVERED",
			deliveredAt:   "2026-07-24T12:00:00Z",
			wantPrimary:   "已签收",
			wantOrder:     true,
		},
		{
			name:          "Shopify in-transit status overrides delivered wording",
			orderNumber:   "54321",
			customerText:  "Order #54321 says delivered, but please check the actual tracking.",
			displayStatus: "IN_TRANSIT",
			wantPrimary:   "已发货",
			wantOrder:     true,
		},
		{
			name:          "a unique email-matched order is persisted without an explicit reference",
			orderNumber:   "77777",
			subject:       "Where is my package?",
			customerText:  "Please check my shipment.",
			displayStatus: "OUT_FOR_DELIVERY",
			wantPrimary:   "已发货",
			wantOrder:     true,
		},
		{
			name:         "delivered wording without a verified order is not treated as delivered",
			orderNumber:  "99999",
			customerText: "Order #99999 says delivered.",
			wantPrimary:  "待确认",
		},
		{
			name:          "a successful email lookup with no order is classified as not ordered",
			orderNumber:   "00000",
			subject:       "Product question",
			customerText:  "Do you have this item in blue?",
			wantPrimary:   "未下单",
			wantSecondary: "产品咨询",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			currentOrderNumber = test.orderNumber
			currentDisplayStatus = test.displayStatus
			currentDeliveredAt = test.deliveredAt
			conversation, err := store.CreateConversation(ctx, Conversation{
				ShopID: shop.ID, SourceID: source.ID, CustomerEmail: "buyer@example.com",
				Subject: firstNonEmpty(test.subject, "Order #"+test.orderNumber+" tracking"),
			})
			if err != nil {
				t.Fatal(err)
			}
			if _, _, err := store.AddMessage(ctx, Message{
				ConversationID: conversation.ID, Direction: MessageDirectionCustomer, Type: MessageTypeText, Body: test.customerText,
			}); err != nil {
				t.Fatal(err)
			}

			var automatic Conversation
			requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/record-auto", adminToken, nil, http.StatusOK, &automatic)
			wantSecondary := test.wantSecondary
			if wantSecondary == "" {
				wantSecondary = "物流查询"
			}
			if automatic.RecordPrimary != test.wantPrimary || automatic.RecordSecondary != wantSecondary || !automatic.RecordAutoFilled {
				t.Fatalf("automatic classification did not use verified lifecycle status: %#v", automatic)
			}
			if test.wantOrder && automatic.RecordOrderNumber != "#"+test.orderNumber {
				t.Fatalf("verified order number was not persisted: %#v", automatic)
			}
			if !test.wantOrder && automatic.RecordOrderNumber != "" {
				t.Fatalf("unverified order number must not be persisted: %#v", automatic)
			}
			if tracker.calls.Load() != 0 {
				t.Fatalf("automatic classification must not query an external logistics provider: calls=%d", tracker.calls.Load())
			}
		})
	}
}

func TestVerifiedRecordOrderRequiresAnExactOrUniqueOrder(t *testing.T) {
	orders := []ShopifyOrderSummary{{Name: "#1001"}, {Name: "#1002"}}
	if _, ok := verifiedRecordOrder(orders, "email:buyer@example.com", false); ok {
		t.Fatal("multiple email-matched orders must not be guessed")
	}
	if order, ok := verifiedRecordOrder(orders, "#1002", true); !ok || order.Name != "#1002" {
		t.Fatalf("explicit order was not selected exactly: %#v, %v", order, ok)
	}
	if _, ok := verifiedRecordOrder(orders, "#9999", true); ok {
		t.Fatal("an unmatched explicit order must not fall back to another order")
	}
}

func TestVerifiedRecordPrimaryUsesShopifyOrderStatus(t *testing.T) {
	server := NewServer(NewMemoryStore())
	primary, ok := server.verifiedRecordPrimary(context.Background(), Conversation{}, ShopifyOrderSummary{Name: "#1001", FulfillmentStatus: "UNFULFILLED"}, true)
	if !ok || primary != "未发货" {
		t.Fatalf("verified unfulfilled order lifecycle = %q, %v", primary, ok)
	}
	primary, ok = server.verifiedRecordPrimary(context.Background(), Conversation{}, ShopifyOrderSummary{Name: "#1001"}, true)
	if !ok || primary != "待确认" {
		t.Fatalf("missing Shopify lifecycle must require review: %q, %v", primary, ok)
	}
	if primary, ok := server.verifiedRecordPrimary(context.Background(), Conversation{}, ShopifyOrderSummary{}, false); ok || primary != "" {
		t.Fatalf("unverified order must stay unresolved: %q, %v", primary, ok)
	}
}

func TestVerifiedRecordPrimaryRequiresEveryShopifyFulfillmentToBeDelivered(t *testing.T) {
	tracker := &fakeLogisticsTracker{}
	server := NewServer(NewMemoryStore())
	server.logisticsTracker = tracker
	order := ShopifyOrderSummary{Name: "#1002", Fulfillments: []ShopifyFulfillment{
		{Status: "SUCCESS", DisplayStatus: "DELIVERED", DeliveredAt: "2026-08-05T10:00:00Z"},
		{Status: "SUCCESS", DisplayStatus: "IN_TRANSIT"},
	}}
	primary, ok := server.verifiedRecordPrimary(context.Background(), Conversation{}, order, true)
	if !ok || primary != "已发货" {
		t.Fatalf("partially delivered order lifecycle = %q, %v", primary, ok)
	}
	order.Fulfillments[1].DisplayStatus = "DELIVERED"
	order.Fulfillments[1].DeliveredAt = "2026-08-06T10:00:00Z"
	primary, ok = server.verifiedRecordPrimary(context.Background(), Conversation{}, order, true)
	if !ok || primary != "已签收" {
		t.Fatalf("fully delivered order lifecycle = %q, %v", primary, ok)
	}
	if tracker.calls.Load() != 0 {
		t.Fatalf("Shopify lifecycle classification queried an external tracker: calls=%d", tracker.calls.Load())
	}
}

func TestLatestCustomerClassificationBodyExcludesAgentHistoryQuotesAndSignature(t *testing.T) {
	base := time.Date(2026, time.August, 6, 10, 0, 0, 0, time.UTC)
	messages := []Message{
		{Direction: MessageDirectionCustomer, Body: "Where is my tracking?", CreatedAt: base},
		{Direction: MessageDirectionAgent, Body: "We can offer a coupon and refund.", CreatedAt: base.Add(time.Minute)},
		{Direction: MessageDirectionCustomer, Body: `<p>The product arrived damaged.</p><blockquote>Old tracking conversation</blockquote><p>Best regards,</p><p>Ada</p>`, CreatedAt: base.Add(2 * time.Minute)},
		{Direction: MessageDirectionAgent, Body: "Latest agent response must not be classified.", CreatedAt: base.Add(3 * time.Minute)},
	}
	got := latestCustomerClassificationBody("Re: Order update", messages)
	if got != "The product arrived damaged." {
		t.Fatalf("latest customer classification body = %q", got)
	}
}

func TestRecordOrderBackfillPersistsVerifiedOrderWithoutChangingHandlingTime(t *testing.T) {
	store := NewMemoryStore()
	ctx := context.Background()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Historical Record Shop", ExternalID: "historical-record.myshopify.com"})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeEmail})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeShopifyAPI, Address: "historical-record.myshopify.com"}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveShopifyInstallation(ctx, ShopifyInstallation{
		ShopID: shop.ID, ShopDomain: "historical-record.myshopify.com", AccessToken: "test-shopify-token",
	}); err != nil {
		t.Fatal(err)
	}

	handledAt := time.Date(2026, time.August, 2, 9, 30, 0, 0, time.UTC)
	conversation, err := store.CreateConversation(ctx, Conversation{
		ShopID: shop.ID, SourceID: source.ID, CustomerEmail: "history@example.com", Subject: "Delivery question",
		RecordPrimary: "已发货", RecordSecondary: "物流查询", RecordTertiary: "查询实时轨迹",
		RecordClassified: true, RecordAutoFilled: true, RecordUpdatedAt: handledAt, RecordUpdatedBy: "agent-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.AddMessage(ctx, Message{
		ConversationID: conversation.ID, Direction: MessageDirectionCustomer, Type: MessageTypeText, Body: "Please check order #24680.",
	}); err != nil {
		t.Fatal(err)
	}
	before, err := store.GetConversation(ctx, conversation.ID)
	if err != nil {
		t.Fatal(err)
	}

	platformServer := NewServer(store)
	platformServer.publicShopifyOrderSearch = func(_ context.Context, _, _, query string, _ int) (ShopifyOrderSearchResult, error) {
		if query != `email:"history@example.com"` {
			t.Fatalf("unexpected Shopify query: %q", query)
		}
		return ShopifyOrderSearchResult{Orders: []ShopifyOrderSummary{{
			Name: "#24680", Email: "history@example.com", FulfillmentStatus: "FULFILLED",
			Fulfillments: []ShopifyFulfillment{{Status: "SUCCESS", DisplayStatus: "IN_TRANSIT"}},
		}}}, nil
	}
	result := platformServer.backfillConversationRecordOrders(ctx, 0)
	if result.Candidates != 1 || result.Updated != 1 || result.Failed != 0 {
		t.Fatalf("unexpected backfill result: %#v", result)
	}
	after, err := store.GetConversation(ctx, conversation.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.RecordOrderNumber != "#24680" {
		t.Fatalf("verified historical order was not stored: %#v", after)
	}
	if after.RecordPrimary != "已发货" {
		t.Fatalf("verified historical lifecycle was not stored: %#v", after)
	}
	if !after.RecordUpdatedAt.Equal(handledAt) || !after.UpdatedAt.Equal(before.UpdatedAt) || after.RecordUpdatedBy != "agent-1" {
		t.Fatalf("backfill changed historical handling metadata: before=%#v after=%#v", before, after)
	}
}

func TestRecordLifecycleBackfillSeparatesNotOrderedAndPreservesManualRecords(t *testing.T) {
	store := NewMemoryStore()
	ctx := context.Background()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Backfill Shop", ExternalID: "backfill-shop.myshopify.com"})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeEmail})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateShopSource(ctx, ShopSource{ShopID: shop.ID, Type: SourceTypeShopifyAPI, Address: "backfill-shop.myshopify.com"}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveShopifyInstallation(ctx, ShopifyInstallation{
		ShopID: shop.ID, ShopDomain: "backfill-shop.myshopify.com", AccessToken: "test-shopify-token",
	}); err != nil {
		t.Fatal(err)
	}

	createRecord := func(email string, autoFilled bool) Conversation {
		conversation, createErr := store.CreateConversation(ctx, Conversation{
			ShopID: shop.ID, SourceID: source.ID, CustomerEmail: email, Subject: "Product question",
			RecordPrimary: "未发货", RecordSecondary: "产品咨询", RecordTertiary: "产品信息咨询",
			RecordClassified: true, RecordAutoFilled: autoFilled, RecordUpdatedBy: "agent-1",
		})
		if createErr != nil {
			t.Fatal(createErr)
		}
		if _, _, messageErr := store.AddMessage(ctx, Message{
			ConversationID: conversation.ID, Direction: MessageDirectionCustomer, Type: MessageTypeText, Body: "Do you have this item in blue?",
		}); messageErr != nil {
			t.Fatal(messageErr)
		}
		return conversation
	}
	automatic := createRecord("automatic@example.com", true)
	manual := createRecord("manual@example.com", false)

	platformServer := NewServer(store)
	platformServer.publicShopifyOrderSearch = func(_ context.Context, _, _, query string, _ int) (ShopifyOrderSearchResult, error) {
		if query != `email:"automatic@example.com"` {
			t.Fatalf("unexpected Shopify query: %q", query)
		}
		return ShopifyOrderSearchResult{}, nil
	}
	result := platformServer.backfillConversationRecordOrders(ctx, 0)
	if result.Candidates != 1 || result.Updated != 1 || result.Failed != 0 {
		t.Fatalf("unexpected backfill result: %#v", result)
	}
	afterAutomatic, err := store.GetConversation(ctx, automatic.ID)
	if err != nil {
		t.Fatal(err)
	}
	if afterAutomatic.RecordPrimary != "未下单" || !afterAutomatic.RecordAutoFilled {
		t.Fatalf("automatic historical record was not corrected safely: %#v", afterAutomatic)
	}
	repeated := platformServer.backfillConversationRecordOrders(ctx, 0)
	if repeated.Candidates != 0 || repeated.Updated != 0 || repeated.Failed != 0 {
		t.Fatalf("already corrected not-ordered record was queried again: %#v", repeated)
	}
	afterManual, err := store.GetConversation(ctx, manual.ID)
	if err != nil {
		t.Fatal(err)
	}
	if afterManual.RecordPrimary != "未发货" || afterManual.RecordAutoFilled {
		t.Fatalf("manual historical record was changed: %#v", afterManual)
	}
}

func TestConversationRecordAutoGeneratesAIRemarkWithoutOverwritingManualEdit(t *testing.T) {
	var aiCalls atomic.Int32
	aiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var payload struct {
			MaxTokens int `json:"max_tokens"`
		}
		_ = json.Unmarshal(body, &payload)
		if payload.MaxTokens == 240 {
			aiCalls.Add(1)
		}
		if r.Header.Get("Authorization") != "Bearer test-ai-key" {
			t.Fatalf("unexpected AI authorization header: %q", r.Header.Get("Authorization"))
		}
		writeJSONResponse(w, http.StatusOK, map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": "客户询问订单物流停滞；客服尚未回复；后续需核查最新轨迹。"}}},
		})
	}))
	defer aiServer.Close()
	t.Setenv("AI_API_KEY", "test-ai-key")
	t.Setenv("AI_BASE_URL", aiServer.URL)
	t.Setenv("AI_MODEL", "test-model")

	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "AI Remark Shop"}, http.StatusCreated, &shop)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat}, http.StatusCreated, &source)
	var conversation Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations", adminToken, Conversation{
		ShopID: shop.ID, SourceID: source.ID, CustomerName: "AI Remark Customer", Subject: "Order #88231 tracking",
	}, http.StatusCreated, &conversation)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", adminToken, Message{
		Direction: MessageDirectionCustomer, Body: "My tracking has not moved for five days.",
	}, http.StatusCreated, nil)

	var automatic Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/record-auto", adminToken, nil, http.StatusOK, &automatic)
	if automatic.RecordRemark != "客户询问订单物流停滞；客服尚未回复；后续需核查最新轨迹。" || !automatic.RecordAutoFilled {
		t.Fatalf("AI remark was not saved as an automatic draft: %#v", automatic)
	}

	manualRemark := "客户反馈物流五天未更新，已转交物流组，明日继续跟进。"
	var manual Conversation
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/conversations/"+conversation.ID+"/record", adminToken, conversationRecordRequest{
		Primary: automatic.RecordPrimary, Secondary: automatic.RecordSecondary, Tertiary: automatic.RecordTertiary, Remark: manualRemark,
	}, http.StatusOK, &manual)
	if manual.RecordAutoFilled || manual.RecordRemark != manualRemark {
		t.Fatalf("manual remark was not stored as authoritative: %#v", manual)
	}

	var repeated Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/record-auto", adminToken, nil, http.StatusOK, &repeated)
	if repeated.RecordRemark != manualRemark || repeated.RecordAutoFilled || aiCalls.Load() != 1 {
		t.Fatalf("automatic remark overwrote or regenerated a manual edit: calls=%d conversation=%#v", aiCalls.Load(), repeated)
	}
}

func TestConversationRecordAutoRefreshesAfterNewMessagesWhenClosed(t *testing.T) {
	var aiCalls atomic.Int32
	aiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			MaxTokens int `json:"max_tokens"`
			Messages  []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || payload.MaxTokens != 240 || len(payload.Messages) != 2 {
			http.Error(w, "unexpected AI request", http.StatusBadRequest)
			return
		}
		if !strings.Contains(payload.Messages[1].Content, "<conversation_data>") || len([]rune(payload.Messages[1].Content)) > 12000 {
			http.Error(w, "unbounded or malformed AI prompt", http.StatusBadRequest)
			return
		}
		call := aiCalls.Add(1)
		content := "客户询问物流停滞，尚待客服核查。"
		if call == 2 {
			content = "**客服备注：客户询问物流停滞；客服已确认正在核查；后续需回复最新轨迹。**"
		}
		writeJSONResponse(w, http.StatusOK, map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": content}}},
		})
	}))
	defer aiServer.Close()
	t.Setenv("AI_API_KEY", "test-ai-key")
	t.Setenv("AI_BASE_URL", aiServer.URL)
	t.Setenv("AI_MODEL", "test-model")

	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "AI Refresh Shop"}, http.StatusCreated, &shop)
	var agent User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email: "ai-refresh-agent@example.com", DisplayName: "AI Refresh Agent", Password: "password-123", Role: UserRoleAgent,
	}, http.StatusCreated, &agent)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: agent.ID}, http.StatusCreated, nil)
	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email: agent.Email, Password: "password-123",
	}, http.StatusOK, &login)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat}, http.StatusCreated, &source)
	var conversation Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations", adminToken, Conversation{
		ShopID: shop.ID, SourceID: source.ID, CustomerName: "Refresh Customer", Subject: "Order #77881 tracking",
	}, http.StatusCreated, &conversation)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", adminToken, Message{
		Direction: MessageDirectionCustomer, Body: "Tracking has not moved for four days.",
	}, http.StatusCreated, nil)

	var initial Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/record-auto", login.Token, nil, http.StatusOK, &initial)
	if initial.RecordRemark != "客户询问物流停滞，尚待客服核查。" || !initial.RecordAutoFilled {
		t.Fatalf("initial AI remark was not saved: %#v", initial)
	}

	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/claim", login.Token, nil, http.StatusOK, nil)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", login.Token, Message{
		Direction: MessageDirectionAgent, Body: "I am checking the latest carrier scan now.",
	}, http.StatusCreated, nil)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/close", login.Token, nil, http.StatusOK, nil)

	var final Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/record-auto?final=true", login.Token, nil, http.StatusOK, &final)
	if final.RecordRemark != initial.RecordRemark || !final.RecordAutoFilled || aiCalls.Load() != 1 {
		t.Fatalf("automatic record should run only once: calls=%d conversation=%#v", aiCalls.Load(), final)
	}
}

func TestConversationRecordManualEditWinsWhileAIRequestIsInFlight(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	var startOnce sync.Once
	aiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		startOnce.Do(func() { close(started) })
		<-release
		writeJSONResponse(w, http.StatusOK, map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": "AI 返回的旧备注"}}},
		})
	}))
	defer aiServer.Close()
	t.Setenv("AI_API_KEY", "test-ai-key")
	t.Setenv("AI_BASE_URL", aiServer.URL)
	t.Setenv("AI_MODEL", "test-model")

	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "AI Race Shop"}, http.StatusCreated, &shop)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat}, http.StatusCreated, &source)
	var conversation Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations", adminToken, Conversation{
		ShopID: shop.ID, SourceID: source.ID, CustomerName: "Race Customer", Subject: "Order #99112 tracking",
	}, http.StatusCreated, &conversation)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", adminToken, Message{
		Direction: MessageDirectionCustomer, Body: "Please check my tracking.",
	}, http.StatusCreated, nil)
	if _, err := store.UpdateConversation(context.Background(), conversation.ID, ConversationUpdate{
		SetRecord: true, RecordPrimary: "已发货", RecordSecondary: "物流查询", RecordTertiary: "查询实时轨迹",
		RecordClassified: true, RecordAutoFilled: true, RecordUpdatedBy: "system",
	}); err != nil {
		t.Fatal(err)
	}

	type autoResult struct {
		conversation Conversation
		err          error
	}
	result := make(chan autoResult, 1)
	go func() {
		req, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/record-auto", nil)
		if err != nil {
			result <- autoResult{err: err}
			return
		}
		req.Header.Set("Authorization", "Bearer "+adminToken)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			result <- autoResult{err: err}
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			result <- autoResult{err: fmt.Errorf("record-auto status %d: %s", resp.StatusCode, body)}
			return
		}
		var updated Conversation
		err = json.NewDecoder(resp.Body).Decode(&updated)
		result <- autoResult{conversation: updated, err: err}
	}()

	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("AI request did not start")
	}

	manualRemark := "客服已人工核查，明日反馈最新物流轨迹。"
	var manual Conversation
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/conversations/"+conversation.ID+"/record", adminToken, conversationRecordRequest{
		Primary: "已发货", Secondary: "物流查询", Tertiary: "查询实时轨迹", Remark: manualRemark,
	}, http.StatusOK, &manual)
	close(release)

	var automatic autoResult
	select {
	case automatic = <-result:
	case <-time.After(3 * time.Second):
		t.Fatal("record-auto request did not finish")
	}
	if automatic.err != nil {
		t.Fatal(automatic.err)
	}
	stored, err := store.GetConversation(context.Background(), conversation.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.RecordRemark != manualRemark || stored.RecordAutoFilled {
		t.Fatalf("in-flight AI response overwrote the manual edit: response=%#v stored=%#v", automatic.conversation, stored)
	}
}

func TestRecordCategoryManagementSavesIndependentValues(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var categories []RecordCategoryOption
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/settings/record-categories", adminToken, nil, http.StatusOK, &categories)
	if len(categories) != 12 {
		t.Fatalf("expected twelve category groups, got %#v", categories)
	}
	for index := range categories {
		categories[index].Tertiary = []string{"定制咨询"}
	}
	var saved []RecordCategoryOption
	requestJSON(t, http.MethodPut, server.URL+"/api/v1/settings/record-categories", adminToken, recordCategoriesRequest{Categories: categories}, http.StatusOK, &saved)
	if len(saved[0].Tertiary) != 1 || saved[0].Tertiary[0] != "定制咨询" {
		t.Fatalf("category values were merged instead of replaced: %#v", saved[0])
	}

	var manager User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email: "category-manager@example.com", DisplayName: "Category Manager", Password: "password-123", Role: UserRoleAdmin,
		PermissionsCustomized: true, Permissions: []string{PermissionRecordCategoriesManage},
	}, http.StatusCreated, &manager)
	var managerLogin AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{Email: manager.Email, Password: "password-123"}, http.StatusOK, &managerLogin)
	for index := range saved {
		saved[index].Tertiary = []string{"定制咨询", "管理员新增分类"}
	}
	requestJSON(t, http.MethodPut, server.URL+"/api/v1/settings/record-categories", managerLogin.Token, recordCategoriesRequest{Categories: saved}, http.StatusOK, &saved)
	if len(saved[0].Tertiary) != 2 || saved[0].Tertiary[1] != "管理员新增分类" {
		t.Fatalf("custom-permission admin could not save category values: %#v", saved[0])
	}

	var agent User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email: "category-agent@example.com", DisplayName: "Category Agent", Password: "password-123", Role: UserRoleAgent,
	}, http.StatusCreated, &agent)
	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{Email: agent.Email, Password: "password-123"}, http.StatusOK, &login)
	raw, _ := json.Marshal(recordCategoriesRequest{Categories: saved})
	req, _ := http.NewRequest(http.MethodPut, server.URL+"/api/v1/settings/record-categories", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+login.Token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("agent unexpectedly changed global categories: status=%d body=%s", resp.StatusCode, body)
	}
}

func TestValidRecordSelectionAllowsIndependentCombination(t *testing.T) {
	categories := []RecordCategoryOption{
		{Primary: "一级 A", Secondary: "二级 A", Tertiary: []string{"三级 A"}},
		{Primary: "一级 B", Secondary: "二级 B", Tertiary: []string{"三级 B"}},
	}
	if !validRecordSelection(categories, "一级 A", "二级 B", "三级 B") {
		t.Fatal("independent category combination should be valid")
	}
	if validRecordSelection(categories, "不存在", "二级 B", "三级 B") {
		t.Fatal("unknown category value should be invalid")
	}
}

func TestValidRecordTransitionPreservesDeletedHistoricalValues(t *testing.T) {
	categories := []RecordCategoryOption{{Primary: "新一级", Secondary: "新二级", Tertiary: []string{"新三级"}}}
	conversation := Conversation{RecordPrimary: "旧一级", RecordSecondary: "旧二级", RecordTertiary: "旧三级"}
	if !validRecordTransition(categories, conversation, "旧一级", "旧二级", "旧三级") {
		t.Fatal("unchanged historical category values should remain valid")
	}
	if !validRecordTransition(categories, conversation, "新一级", "旧二级", "旧三级") {
		t.Fatal("one independent category should be replaceable without clearing other historical values")
	}
	if validRecordTransition(categories, conversation, "未知一级", "旧二级", "旧三级") {
		t.Fatal("new unknown category value should be invalid")
	}
}

func TestExtractRecordOrderNumber(t *testing.T) {
	tests := map[string]string{
		"Order #12345 tracking":                "12345",
		"Please cancel order #77519":           "77519",
		"Order number AB-1299 needs attention": "AB-1299",
		"Tracking update for #ZX-9981":         "ZX-9981",
		"Package 55231 has not moved":          "55231",
		"Please help with my package":          "",
	}

	for subject, expected := range tests {
		if actual := extractRecordOrderNumber(subject); actual != expected {
			t.Fatalf("extractRecordOrderNumber(%q) = %q, want %q", subject, actual, expected)
		}
	}
}

func TestConditionalAutoClassificationDoesNotOverwriteManualRecord(t *testing.T) {
	store := NewMemoryStore()
	shop, err := store.CreateShop(context.Background(), Shop{DisplayName: "Race Test", ExternalID: "race-test.myshopify.com"})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(context.Background(), ShopSource{ShopID: shop.ID, Type: SourceTypeShopifyChat, Provider: "xzdesk"})
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateConversation(context.Background(), Conversation{ShopID: shop.ID, SourceID: source.ID, CustomerName: "Race Customer", Subject: "Order #99881 tracking"})
	if err != nil {
		t.Fatal(err)
	}

	manual, err := store.UpdateConversation(context.Background(), conversation.ID, ConversationUpdate{
		SetRecord: true, RecordPrimary: "未发货", RecordSecondary: "售后问题", RecordTertiary: "退款退货咨询",
		RecordRemark: "人工备注", RecordClassified: true, RecordUpdatedBy: "user_admin",
	})
	if err != nil {
		t.Fatal(err)
	}
	afterAuto, err := store.UpdateConversation(context.Background(), conversation.ID, ConversationUpdate{
		SetRecord: true, OnlyIfRecordUnclassified: true, RecordPrimary: "已发货", RecordSecondary: "物流查询",
		RecordTertiary: "查询实时轨迹", RecordClassified: true, RecordAutoFilled: true, RecordUpdatedBy: "user_admin",
	})
	if err != nil {
		t.Fatal(err)
	}
	if afterAuto.RecordRemark != manual.RecordRemark || afterAuto.RecordPrimary != manual.RecordPrimary || afterAuto.RecordAutoFilled {
		t.Fatalf("conditional auto classification overwrote manual record: %#v", afterAuto)
	}
}
