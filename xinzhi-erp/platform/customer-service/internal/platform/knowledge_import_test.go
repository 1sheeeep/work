package platform

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"
)

func TestParseKnowledgeWorkbookRecognizesCommonHeaders(t *testing.T) {
	reader := testKnowledgeWorkbook(t, [][]any{
		{"客户问题", "客服回复", "标签"},
		{"包裹为什么还没到？", "请提供订单号，我们会核查最新物流。", "物流, 延迟"},
	})
	rows, issues, err := parseKnowledgeWorkbook(reader)
	if err != nil {
		t.Fatalf("parseKnowledgeWorkbook failed: %v", err)
	}
	if len(issues) != 0 || len(rows) != 1 {
		t.Fatalf("unexpected parse result rows=%#v issues=%#v", rows, issues)
	}
	if rows[0].Title != "包裹为什么还没到？" || rows[0].Answer != "请提供订单号，我们会核查最新物流。" {
		t.Fatalf("unexpected knowledge row: %#v", rows[0])
	}
	if len(rows[0].Tags) != 2 || rows[0].Tags[0] != "物流" || rows[0].Tags[1] != "延迟" {
		t.Fatalf("unexpected tags: %#v", rows[0].Tags)
	}
}

func TestParseKnowledgeWorkbookFallsBackForArbitraryHeaders(t *testing.T) {
	reader := testKnowledgeWorkbook(t, [][]any{
		{"物流方式", "运单号", "首条信息", "最新信息"},
		{"泰嘉物流-美国小包", "ZC53677822999", "Shipment", "Delivered, In/At Mailbox"},
	})
	rows, issues, err := parseKnowledgeWorkbook(reader)
	if err != nil {
		t.Fatalf("parseKnowledgeWorkbook failed: %v", err)
	}
	if len(issues) != 0 || len(rows) != 1 {
		t.Fatalf("unexpected parse result rows=%#v issues=%#v", rows, issues)
	}
	if rows[0].Title != "泰嘉物流-美国小包" {
		t.Fatalf("unexpected fallback title: %q", rows[0].Title)
	}
	for _, expected := range []string{"运单号：ZC53677822999", "首条信息：Shipment", "最新信息：Delivered, In/At Mailbox"} {
		if !strings.Contains(rows[0].Answer, expected) {
			t.Fatalf("fallback answer %q does not contain %q", rows[0].Answer, expected)
		}
	}
}

func TestParseKnowledgeWorkbookFindsHeaderBelowTitleAndMatchesVariants(t *testing.T) {
	reader := testKnowledgeWorkbook(t, [][]any{
		{"Knowledge base export"},
		{},
		{"Customer issue (English)", "Recommended response - EN", "Topic / Labels"},
		{"Can I change my address?", "Please send the correct address before shipment.", "order, change"},
	})
	rows, issues, err := parseKnowledgeWorkbook(reader)
	if err != nil {
		t.Fatalf("parseKnowledgeWorkbook failed: %v", err)
	}
	if len(issues) != 0 || len(rows) != 1 {
		t.Fatalf("unexpected parse result rows=%#v issues=%#v", rows, issues)
	}
	if rows[0].Title != "Can I change my address?" || rows[0].Answer != "Please send the correct address before shipment." {
		t.Fatalf("unexpected variant-header row: %#v", rows[0])
	}
	if len(rows[0].Tags) != 2 {
		t.Fatalf("unexpected variant-header tags: %#v", rows[0].Tags)
	}
}

func TestParseKnowledgeWorkbookPreservesHeaderlessFirstRow(t *testing.T) {
	reader := testKnowledgeWorkbook(t, [][]any{
		{"Where is my order?", "Please provide your order number."},
		{"Can I cancel my order?", "We can cancel it before shipment."},
	})
	rows, issues, err := parseKnowledgeWorkbook(reader)
	if err != nil {
		t.Fatalf("parseKnowledgeWorkbook failed: %v", err)
	}
	if len(issues) != 0 || len(rows) != 2 {
		t.Fatalf("unexpected parse result rows=%#v issues=%#v", rows, issues)
	}
	if rows[0].Title != "Where is my order?" || !strings.Contains(rows[0].Answer, "Please provide your order number.") {
		t.Fatalf("first headerless row was not preserved: %#v", rows[0])
	}
}

func TestParseKnowledgeWorkbookPreservesShortHeaderlessFirstRow(t *testing.T) {
	reader := testKnowledgeWorkbook(t, [][]any{
		{"退货条件", "未发货可退"},
		{"退款时间", "通常三至五天"},
	})
	rows, issues, err := parseKnowledgeWorkbook(reader)
	if err != nil {
		t.Fatalf("parseKnowledgeWorkbook failed: %v", err)
	}
	if len(issues) != 0 || len(rows) != 2 {
		t.Fatalf("unexpected short headerless result rows=%#v issues=%#v", rows, issues)
	}
	if rows[0].Title != "退货条件" || !strings.Contains(rows[0].Answer, "未发货可退") {
		t.Fatalf("first short headerless row was not preserved: %#v", rows[0])
	}
}

func TestParseKnowledgeWorkbookImportsAllSheets(t *testing.T) {
	reader := testKnowledgeWorkbookSheets(t, [][][]any{
		{
			{"Question", "Answer"},
			{"Question from sheet one?", "Answer from sheet one."},
		},
		{
			{"问题场景", "标准回复"},
			{"第二个工作表的问题", "第二个工作表的回复"},
		},
	})
	rows, issues, err := parseKnowledgeWorkbook(reader)
	if err != nil {
		t.Fatalf("parseKnowledgeWorkbook failed: %v", err)
	}
	if len(issues) != 0 || len(rows) != 2 {
		t.Fatalf("unexpected multi-sheet result rows=%#v issues=%#v", rows, issues)
	}
	if rows[0].Sheet == rows[1].Sheet {
		t.Fatalf("expected rows from different sheets: %#v", rows)
	}
}

func TestKnowledgeExcelImportCreatesPendingEntries(t *testing.T) {
	platformServer := NewServer(NewMemoryStore())
	server := httptest.NewServer(platformServer.Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Knowledge Import Shop"}, http.StatusCreated, &shop)
	var importer User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email:                 "knowledge-importer@example.com",
		DisplayName:           "Knowledge Importer",
		Password:              "importer-password",
		Role:                  UserRoleAgent,
		Permissions:           []string{PermissionKnowledgeCreate},
		PermissionsCustomized: true,
		DataScopes:            map[string]string{DataScopeKnowledge: AccessScopeAll},
	}, http.StatusCreated, &importer)
	var importerLogin AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email: "knowledge-importer@example.com", Password: "importer-password",
	}, http.StatusOK, &importerLogin)
	workbook := testKnowledgeWorkbook(t, [][]any{
		{"Question", "Answer"},
		{"Where is my order?", "Please share your order number."},
		{"Where is my order?", "Please share your order number."},
	})

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "knowledge.xlsx")
	if err != nil {
		t.Fatalf("CreateFormFile failed: %v", err)
	}
	if _, err := io.Copy(part, workbook); err != nil {
		t.Fatalf("copy workbook failed: %v", err)
	}
	_ = writer.WriteField("scope", KnowledgeScopeShop)
	_ = writer.WriteField("shopId", shop.ID)
	_ = writer.WriteField("tags", "shipping")
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart failed: %v", err)
	}

	req, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/knowledge/import", &body)
	if err != nil {
		t.Fatalf("NewRequest failed: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+importerLogin.Token)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("import request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		t.Fatalf("unexpected import status %d: %s", resp.StatusCode, raw)
	}
	var result knowledgeImportResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("decode import result failed: %v", err)
	}
	if result.Created != 1 || result.Skipped != 1 || result.Failed != 0 {
		t.Fatalf("unexpected import result: %#v", result)
	}

	entries, err := platformServer.store.ListKnowledge(t.Context(), KnowledgeFilter{ShopID: shop.ID, Status: KnowledgeStatusPending})
	if err != nil || len(entries) != 1 || entries[0].Tags[0] != "shipping" {
		t.Fatalf("unexpected stored knowledge entries=%#v err=%v", entries, err)
	}
	for _, title := range []string{"Delivery delay", "Damaged item"} {
		if _, err := platformServer.store.CreateKnowledge(t.Context(), KnowledgeEntry{
			Scope: KnowledgeScopeShop, ShopID: shop.ID, Title: title, Answer: "Approved answer",
		}); err != nil {
			t.Fatalf("create paginated knowledge failed: %v", err)
		}
	}
	var page knowledgePageResponse
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/knowledge?shopId="+shop.ID+"&scope=shop&status=pending&page=1&pageSize=2", adminToken, nil, http.StatusOK, &page)
	if len(page.Items) != 2 || page.Total != 3 || page.TotalPages != 2 || page.Page != 1 || page.PageSize != 2 {
		t.Fatalf("unexpected knowledge page: %#v", page)
	}
}

func TestActiveConversationCanSubmitEditedKnowledgeScenario(t *testing.T) {
	platformServer := NewServer(NewMemoryStore())
	server := httptest.NewServer(platformServer.Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Conversation Knowledge Shop"}, http.StatusCreated, &shop)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat}, http.StatusCreated, &source)
	var conversation Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations", adminToken, Conversation{ShopID: shop.ID, SourceID: source.ID, Status: ConversationStatusOpen}, http.StatusCreated, &conversation)

	var entry KnowledgeEntry
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/knowledge", adminToken, submitConversationKnowledgeRequest{
		Title:  "Customer asks whether expedited delivery is available",
		Answer: "Expedited delivery availability depends on the checkout options shown for the destination.",
		Tags:   []string{"shipping", "checkout"},
	}, http.StatusCreated, &entry)
	if entry.Status != KnowledgeStatusPublished || entry.ConversationID != conversation.ID || entry.Title == "" || len(entry.Tags) != 2 {
		t.Fatalf("unexpected submitted knowledge: %#v", entry)
	}
}

func TestConversationKnowledgeFallbackSkipsQuotedHistory(t *testing.T) {
	platformServer := NewServer(NewMemoryStore())
	server := httptest.NewServer(platformServer.Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Conversation Knowledge Fallback Shop"}, http.StatusCreated, &shop)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat}, http.StatusCreated, &source)
	var conversation Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations", adminToken, Conversation{ShopID: shop.ID, SourceID: source.ID, Status: ConversationStatusOpen}, http.StatusCreated, &conversation)

	if _, _, err := platformServer.store.AddMessage(t.Context(), Message{
		ConversationID: conversation.ID,
		Direction:      MessageDirectionCustomer,
		Type:           MessageTypeText,
		Body:           "Where is my order?\n\nOn Mon, Jul 20, 2026 at 10:00 AM Shop Support <support@example.com> wrote:\n> Previous reply",
		Metadata:       map[string]string{"gmail_message_id": "message-1"},
	}); err != nil {
		t.Fatalf("add customer message failed: %v", err)
	}
	if _, _, err := platformServer.store.AddMessage(t.Context(), Message{
		ConversationID: conversation.ID,
		Direction:      MessageDirectionAgent,
		Type:           MessageTypeText,
		Body:           "Please provide your order number.",
	}); err != nil {
		t.Fatalf("add agent message failed: %v", err)
	}
	var entry KnowledgeEntry
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/knowledge", adminToken, submitConversationKnowledgeRequest{}, http.StatusCreated, &entry)
	if entry.Title != "Where is my order?" || entry.Answer != "Please provide your order number." {
		t.Fatalf("unexpected fallback knowledge: %#v", entry)
	}
}

func testKnowledgeWorkbook(t *testing.T, rows [][]any) *bytes.Reader {
	t.Helper()
	return testKnowledgeWorkbookSheets(t, [][][]any{rows})
}

func testKnowledgeWorkbookSheets(t *testing.T, sheets [][][]any) *bytes.Reader {
	t.Helper()
	book := excelize.NewFile()
	for sheetIndex, rows := range sheets {
		sheet := book.GetSheetName(0)
		if sheetIndex > 0 {
			sheet = fmt.Sprintf("Sheet%d", sheetIndex+1)
			if _, err := book.NewSheet(sheet); err != nil {
				t.Fatalf("NewSheet failed: %v", err)
			}
		}
		for index, row := range rows {
			cell, err := excelize.CoordinatesToCellName(1, index+1)
			if err != nil {
				t.Fatalf("CoordinatesToCellName failed: %v", err)
			}
			if err := book.SetSheetRow(sheet, cell, &row); err != nil {
				t.Fatalf("SetSheetRow failed: %v", err)
			}
		}
	}
	buffer, err := book.WriteToBuffer()
	if err != nil {
		t.Fatalf("WriteToBuffer failed: %v", err)
	}
	if err := book.Close(); err != nil {
		t.Fatalf("close workbook failed: %v", err)
	}
	return bytes.NewReader(buffer.Bytes())
}
