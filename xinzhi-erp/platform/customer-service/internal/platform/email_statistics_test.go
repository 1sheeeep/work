package platform

import (
	"archive/zip"
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/xuri/excelize/v2"
)

func TestParseEmailStatisticsFilterCapsPageSizeForInteractiveLists(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/v1/email-statistics?pageSize=1000", nil)
	filter, err := parseEmailStatisticsFilter(request)
	if err != nil {
		t.Fatal(err)
	}
	if filter.PageSize != 100 {
		t.Fatalf("page size = %d, want clamp to 100", filter.PageSize)
	}
	request = httptest.NewRequest(http.MethodGet, "/api/v1/email-statistics?pageSize=5000", nil)
	filter, err = parseEmailStatisticsFilter(request)
	if err != nil {
		t.Fatal(err)
	}
	if filter.PageSize != 100 {
		t.Fatalf("oversized page size = %d, want clamp to 100", filter.PageSize)
	}
}

func TestFormatEmailStatisticsOriginalTimePreservesSourceClock(t *testing.T) {
	fallback := time.Date(2026, time.August, 11, 2, 30, 0, 0, time.UTC)
	cases := map[string]string{
		"Mon, 11 Aug 2026 10:30:00 +0800": "2026-08-11 10:30",
		"2026-08-11T02:30:00Z":            "2026-08-11 02:30",
		"2026-08-11T10:30:00+08:00":       "2026-08-11 10:30",
		"":                                "2026-08-11 02:30",
	}
	for original, want := range cases {
		if got := formatEmailStatisticsOriginalTime(original, fallback); got != want {
			t.Fatalf("formatEmailStatisticsOriginalTime(%q) = %q, want %q", original, got, want)
		}
	}
}

func TestParseEmailStatisticsFilterUsesBeijingDateBoundaries(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/v1/email-statistics/exports?startDate=2026-08-11&endDate=2026-08-11", nil)
	filter, err := parseEmailStatisticsFilter(request)
	if err != nil {
		t.Fatal(err)
	}
	wantStart := time.Date(2026, time.August, 10, 16, 0, 0, 0, time.UTC)
	wantEnd := time.Date(2026, time.August, 11, 16, 0, 0, 0, time.UTC)
	if !filter.Start.Equal(wantStart) || !filter.EndExclusive.Equal(wantEnd) {
		t.Fatalf("email statistics date range is not Beijing time: start=%s end=%s", filter.Start, filter.EndExclusive)
	}
}

func TestValidateEmailStatisticsExportFilterRequiresDatesWithoutRangeLimit(t *testing.T) {
	wideRange := emailStatisticsFilter{
		Start:        time.Date(2020, time.January, 1, 0, 0, 0, 0, time.UTC),
		EndExclusive: time.Date(2026, time.September, 1, 0, 0, 0, 0, time.UTC),
	}
	if err := validateEmailStatisticsExportFilter(wideRange); err != nil {
		t.Fatalf("export date span should not be limited: %v", err)
	}
	if err := validateEmailStatisticsExportFilter(emailStatisticsFilter{}); err == nil {
		t.Fatal("export without a date range should be rejected")
	}
}

func TestEmailStatisticsOptionsMarksOnlyConnectedStandardMailboxSyncable(t *testing.T) {
	shops := []Shop{{ID: "shop-1", DisplayName: "Store One"}}
	sources := []ShopSource{
		{ID: "standard-active", ShopID: "shop-1", Type: SourceTypeEmail, Provider: standardMailProvider, Address: "active@163.com", Status: SourceStatusActive},
		{ID: "standard-disconnected", ShopID: "shop-1", Type: SourceTypeEmail, Provider: standardMailProvider, Address: "disconnected@126.com", Status: SourceStatusActive, Metadata: map[string]string{emailDisconnectedAtKey: time.Now().UTC().Format(time.RFC3339)}},
		{ID: "standard-inactive", ShopID: "shop-1", Type: SourceTypeEmail, Provider: standardMailProvider, Address: "inactive@qq.com", Status: SourceStatusDisabled},
		{ID: "gmail-active", ShopID: "shop-1", Type: SourceTypeEmail, Provider: "gmail", Address: "active@gmail.com", Status: SourceStatusActive},
	}

	_, mailboxes, _ := emailStatisticsOptions(shops, sources, false, nil)
	syncable := map[string]bool{}
	connected := map[string]bool{}
	for _, mailbox := range mailboxes {
		syncable[mailbox.ID] = mailbox.Syncable
		connected[mailbox.ID] = mailbox.Connected
	}
	if !syncable["standard-active"] {
		t.Fatal("active connected standard mailbox should support manual receive")
	}
	for _, id := range []string{"standard-disconnected", "standard-inactive", "gmail-active"} {
		if syncable[id] {
			t.Fatalf("mailbox %s must not support manual receive", id)
		}
	}
	if !connected["standard-active"] || !connected["gmail-active"] {
		t.Fatal("active mailboxes should remain selectable as connected accounts")
	}
	if connected["standard-disconnected"] || connected["standard-inactive"] {
		t.Fatal("disconnected mailboxes should remain selectable but must be marked disconnected")
	}
}

func TestLegacyShopOwnershipMetadataNoLongerChangesEmailRouting(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	shop, err := store.CreateShop(ctx, Shop{
		DisplayName: "Finance Shared Mailbox",
		Platform:    "business",
		Metadata: map[string]string{
			"account_owner_type": "department",
			"account_department": "财务部",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{
		ShopID: shop.ID, Type: SourceTypeEmail, Provider: "cuiqiu", Address: "finance@example.com",
	})
	if err != nil {
		t.Fatal(err)
	}
	platformServer := NewServer(store)
	createdConversation, createdMessage, skipped, err := platformServer.ingestProviderEmail(ctx, shop.ID, source, incomingEmailMessage{
		ExternalConversationID: "finance-thread-1",
		SourceMessageID:        "finance-message-1",
		CustomerName:           "Vendor",
		CustomerEmail:          "vendor@example.com",
		SenderName:             "Vendor",
		SenderEmail:            "vendor@example.com",
		Subject:                "Invoice confirmation",
		Body:                   "Please confirm receipt of invoice 2026-0815.",
		Classification:         ConversationKindCustomer,
		ClassificationReason:   "email handled as a normal conversation",
		ReceivedAt:             time.Now().UTC(),
	})
	if err != nil || !createdConversation || !createdMessage || skipped {
		t.Fatalf("department email ingest = (%v, %v, %v, %v)", createdConversation, createdMessage, skipped, err)
	}
	conversations, err := store.ListConversations(ctx, ConversationFilter{ShopID: shop.ID})
	if err != nil || len(conversations) != 1 {
		t.Fatalf("department conversations = %#v, %v", conversations, err)
	}
	if conversations[0].Kind != ConversationKindCustomer || !conversations[0].ReplyAllowed {
		t.Fatalf("legacy ownership metadata still changed content-based routing: %#v", conversations[0])
	}

	server := httptest.NewServer(platformServer.Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)
	var statistics emailStatisticsPage
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/email-statistics", adminToken, nil, http.StatusOK, &statistics)
	if statistics.Total != 0 || len(statistics.Items) != 0 {
		t.Fatalf("customer email leaked into email statistics: %#v", statistics)
	}
	var processing emailProcessingPage
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/email-processing", adminToken, nil, http.StatusOK, &processing)
	if processing.Total != 0 || len(processing.Items) != 0 {
		t.Fatalf("department email leaked into email processing: %#v", processing)
	}
	var workbench []Conversation
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations", adminToken, nil, http.StatusOK, &workbench)
	if len(workbench) != 1 || workbench[0].ID != conversations[0].ID {
		t.Fatalf("customer email did not enter the workbench: %#v", workbench)
	}
	var workbenchShops []Shop
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/shops?scope=workbench", adminToken, nil, http.StatusOK, &workbenchShops)
	if len(workbenchShops) != 1 || workbenchShops[0].ID != shop.ID {
		t.Fatalf("legacy ownership metadata still hid the shop from the workbench: %#v", workbenchShops)
	}
}

func TestEmailStatisticsListDetailExportAndScope(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Finance Store", Metadata: map[string]string{"internalNote": "风控店铺，深圳客服组"}})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{
		ShopID: shop.ID, Type: SourceTypeEmail, Provider: "gmail", Address: "finance@example.com",
	})
	if err != nil {
		t.Fatal(err)
	}
	receivedAt := time.Date(2026, time.August, 11, 2, 30, 0, 0, time.UTC)
	conversation, err := store.CreateConversation(ctx, Conversation{
		ShopID: shop.ID, SourceID: source.ID, CustomerName: "Shopify", CustomerEmail: "mailer@shopify.com",
		Subject: "Payout completed", Kind: ConversationKindSystem, Classification: automatedSystemNotificationClassification,
	})
	if err != nil {
		t.Fatal(err)
	}
	message, _, err := store.AddMessage(ctx, Message{
		ConversationID: conversation.ID, Direction: MessageDirectionSystem, Type: MessageTypeText,
		Body: "The complete payout amount is USD 128.50.", SenderName: "Shopify", SenderEmail: "mailer@shopify.com",
		SourceMessageID: "gmail:message-1", CreatedAt: receivedAt,
		Metadata: map[string]string{
			"mail_message_id":            "<message-1@shopify.com>",
			"mail_reply_to_email":        "support@shopify.com",
			"email_received_at_original": "2026-08-11T02:30:00Z",
			"email_has_attachments":      "true",
			"email_attachment_names":     "statement.pdf",
			messageTranslationZHKey:      "完整付款金额为 128.50 美元。",
			messageTranslationStatusKey:  messageTranslationDone,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.AddMessage(ctx, Message{
		ConversationID: conversation.ID, Direction: MessageDirectionSystem, Type: MessageTypeImage,
		Body: "chart.png", SenderName: "Shopify", SenderEmail: "mailer@shopify.com",
		SourceMessageID: "gmail:message-1:attachment:0", CreatedAt: receivedAt,
		Metadata: map[string]string{"url": "/api/v1/chat/attachments/emailatt_test.png", "mimeType": "image/png", "fileName": "chart.png"},
	}); err != nil {
		t.Fatal(err)
	}

	customerConversation, err := store.CreateConversation(ctx, Conversation{
		ShopID: shop.ID, SourceID: source.ID, CustomerEmail: "buyer@example.com", Subject: "Where is my order?", Kind: ConversationKindCustomer,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.AddMessage(ctx, Message{ConversationID: customerConversation.ID, Direction: MessageDirectionCustomer, Body: "Customer question", CreatedAt: receivedAt}); err != nil {
		t.Fatal(err)
	}
	marketingConversation, err := store.CreateConversation(ctx, Conversation{
		ShopID: shop.ID, SourceID: source.ID, CustomerEmail: "offers@example.com", Subject: "Limited offer",
		Kind: ConversationKindSystem, Classification: suspectedMarketingReviewClassification,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.AddMessage(ctx, Message{ConversationID: marketingConversation.ID, Direction: MessageDirectionSystem, Body: "Advertisement", CreatedAt: receivedAt}); err != nil {
		t.Fatal(err)
	}

	otherShop, err := store.CreateShop(ctx, Shop{DisplayName: "Other Store"})
	if err != nil {
		t.Fatal(err)
	}
	otherSource, err := store.CreateShopSource(ctx, ShopSource{ShopID: otherShop.ID, Type: SourceTypeEmail, Provider: "outlook", Address: "other@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	otherConversation, err := store.CreateConversation(ctx, Conversation{ShopID: otherShop.ID, SourceID: otherSource.ID, CustomerEmail: "alerts@example.com", Subject: "Security alert", Kind: ConversationKindSystem})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.AddMessage(ctx, Message{ConversationID: otherConversation.ID, Direction: MessageDirectionSystem, Body: "A new login was detected.", SourceMessageID: "outlook:message-2", CreatedAt: receivedAt.Add(time.Hour)}); err != nil {
		t.Fatal(err)
	}

	platformServer := NewServer(store)
	platformServer.uploadDir = t.TempDir()
	if err := os.WriteFile(filepath.Join(platformServer.uploadDir, "emailatt_test.png"), []byte("png attachment"), 0o640); err != nil {
		t.Fatal(err)
	}
	exportContext, stopExports := context.WithCancel(context.Background())
	platformServer.StartEmailStatisticsExports(exportContext)
	t.Cleanup(stopExports)
	server := httptest.NewServer(platformServer.Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var page emailStatisticsPage
	listURL := server.URL + "/api/v1/email-statistics?shopId=" + url.QueryEscape(shop.ID) + "&startDate=2026-08-11&endDate=2026-08-11"
	requestJSON(t, http.MethodGet, listURL, adminToken, nil, http.StatusOK, &page)
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].MessageID != message.ID {
		t.Fatalf("unexpected email statistics page: %#v", page)
	}
	item := page.Items[0]
	if item.UniqueID != "gmail:message-1" || item.Mailbox != "finance@example.com" || item.Recipient != "finance@example.com" ||
		item.ShopName != "Finance Store" || item.ShopNote != "风控店铺，深圳客服组" || item.ReceivedAtDisplay != "2026-08-11 02:30" || !item.HasAttachments || len(item.AttachmentNames) != 2 || item.Status != ConversationStatusOpen {
		t.Fatalf("email statistics fields are incomplete: %#v", item)
	}

	var searched emailStatisticsPage
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/email-statistics?search="+url.QueryEscape("128.50"), adminToken, nil, http.StatusOK, &searched)
	if searched.Total != 1 || searched.Items[0].MessageID != message.ID {
		t.Fatalf("full-body search did not find the email: %#v", searched)
	}

	var detail emailStatisticsDetail
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/email-statistics/"+conversation.ID+"/messages/"+message.ID, adminToken, nil, http.StatusOK, &detail)
	if detail.Body != "The complete payout amount is USD 128.50." || strings.Contains(detail.Body, "完整付款金额") || detail.Record.ReplyTo != "support@shopify.com" {
		t.Fatalf("email statistics detail is incomplete: %#v", detail)
	}

	tags := []EmailProcessingTag{{Label: "财务跟进", Color: "blue"}}
	var savedTags []EmailProcessingTag
	requestJSON(t, http.MethodPut, server.URL+"/api/v1/email-statistics/"+conversation.ID+"/tags", adminToken, map[string]any{"tags": tags}, http.StatusOK, &savedTags)
	if len(savedTags) != 1 || savedTags[0] != tags[0] {
		t.Fatalf("email statistics tags were not saved: %#v", savedTags)
	}
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/email-statistics/"+conversation.ID+"/messages/"+message.ID, adminToken, nil, http.StatusOK, &detail)
	if len(detail.Record.Tags) != 1 || detail.Record.Tags[0] != tags[0] {
		t.Fatalf("email statistics detail did not return shared tags: %#v", detail.Record.Tags)
	}

	var statisticsAction map[string]string
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/email-statistics/"+conversation.ID+"/handled", adminToken, nil, http.StatusOK, &statisticsAction)
	if statisticsAction["status"] != ConversationStatusClosed {
		t.Fatalf("email statistics handled action returned unexpected status: %#v", statisticsAction)
	}
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/email-statistics/"+conversation.ID+"/reopen", adminToken, nil, http.StatusOK, &statisticsAction)
	if statisticsAction["status"] != ConversationStatusOpen {
		t.Fatalf("email statistics reopen action returned unexpected status: %#v", statisticsAction)
	}

	var handled emailProcessingActionResponse
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/email-processing/"+conversation.ID+"/handled", adminToken, nil, http.StatusOK, &handled)
	var handledPage emailStatisticsPage
	requestJSON(t, http.MethodGet, listURL, adminToken, nil, http.StatusOK, &handledPage)
	if handled.Item.Conversation.Status != ConversationStatusClosed || handledPage.Total != 1 || len(handledPage.Items) != 1 || handledPage.Items[0].Status != ConversationStatusClosed {
		t.Fatalf("email statistics status did not follow email processing handled state: action=%#v statistics=%#v", handled, handledPage)
	}
	var closedFiltered emailStatisticsPage
	requestJSON(t, http.MethodGet, listURL+"&status="+ConversationStatusClosed, adminToken, nil, http.StatusOK, &closedFiltered)
	if closedFiltered.Total != 1 || len(closedFiltered.Items) != 1 || closedFiltered.Items[0].MessageID != message.ID {
		t.Fatalf("email statistics closed filter did not follow email processing state: %#v", closedFiltered)
	}

	var exportJob emailExportJobResponse
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/email-statistics/exports?shopId="+url.QueryEscape(shop.ID)+"&startDate=2026-08-11&endDate=2026-08-11", adminToken, nil, http.StatusAccepted, &exportJob)
	deadline := time.Now().Add(5 * time.Second)
	for exportJob.Status != emailExportStatusCompleted && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
		requestJSON(t, http.MethodGet, server.URL+"/api/v1/email-statistics/exports/"+exportJob.ID, adminToken, nil, http.StatusOK, &exportJob)
	}
	if exportJob.Status != emailExportStatusCompleted || exportJob.RowCount != 1 {
		t.Fatalf("email statistics background export did not complete: %#v", exportJob)
	}
	exportRequest, err := http.NewRequest(http.MethodGet, server.URL+"/api/v1/email-statistics/exports/"+exportJob.ID+"/download", nil)
	if err != nil {
		t.Fatal(err)
	}
	exportRequest.Header.Set("Authorization", "Bearer "+adminToken)
	exportResponse, err := http.DefaultClient.Do(exportRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer exportResponse.Body.Close()
	archiveBytes, err := io.ReadAll(exportResponse.Body)
	if err != nil {
		t.Fatal(err)
	}
	if exportResponse.StatusCode != http.StatusOK || !bytes.HasPrefix(archiveBytes, []byte("PK")) || !strings.Contains(exportResponse.Header.Get("Content-Disposition"), ".zip") {
		t.Fatalf("unexpected email statistics export: status=%d disposition=%q", exportResponse.StatusCode, exportResponse.Header.Get("Content-Disposition"))
	}
	archive, err := zip.NewReader(bytes.NewReader(archiveBytes), int64(len(archiveBytes)))
	if err != nil {
		t.Fatal(err)
	}
	var workbookBytes []byte
	attachmentFound := false
	for _, file := range archive.File {
		if file.Name == "邮件统计.xlsx" {
			reader, openErr := file.Open()
			if openErr != nil {
				t.Fatal(openErr)
			}
			workbookBytes, err = io.ReadAll(reader)
			_ = reader.Close()
			if err != nil {
				t.Fatal(err)
			}
		}
		if strings.HasPrefix(file.Name, "附件/") && strings.HasSuffix(file.Name, "/chart.png") {
			attachmentFound = true
		}
	}
	if len(workbookBytes) == 0 || !attachmentFound {
		t.Fatalf("ZIP did not contain the workbook and attachment: files=%v", func() []string {
			names := make([]string, 0, len(archive.File))
			for _, file := range archive.File {
				names = append(names, file.Name)
			}
			return names
		}())
	}
	book, err := excelize.OpenReader(bytes.NewReader(workbookBytes))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = book.Close() }()
	subjectHeader, _ := book.GetCellValue("邮件统计", "F1")
	subject, _ := book.GetCellValue("邮件统计", "F2")
	bodyHeader, _ := book.GetCellValue("邮件统计", "G1")
	body, _ := book.GetCellValue("邮件统计", "G2")
	receivedHeader, _ := book.GetCellValue("邮件统计", "E1")
	receivedTime, _ := book.GetCellValue("邮件统计", "E2")
	shopNoteHeader, _ := book.GetCellValue("邮件统计", "J1")
	exportedShopNote, _ := book.GetCellValue("邮件统计", "J2")
	attachmentCountHeader, _ := book.GetCellValue("邮件统计", "L1")
	attachmentCount, _ := book.GetCellValue("邮件统计", "L2")
	statusHeader, _ := book.GetCellValue("邮件统计", "N1")
	exportedStatus, _ := book.GetCellValue("邮件统计", "N2")
	originalTime, _ := book.GetCellValue("邮件统计", "O2")
	attachmentDirectoryHeader, _ := book.GetCellValue("邮件统计", "Q1")
	attachmentDirectory, _ := book.GetCellValue("邮件统计", "Q2")
	attachmentResultHeader, _ := book.GetCellValue("邮件统计", "R1")
	attachmentResult, _ := book.GetCellValue("邮件统计", "R2")
	exportDate, _ := book.GetCellValue("邮件统计", "S1")
	bodyStyleID, err := book.GetCellStyle("邮件统计", "G2")
	if err != nil {
		t.Fatal(err)
	}
	bodyStyle, err := book.GetStyle(bodyStyleID)
	if err != nil {
		t.Fatal(err)
	}
	bodyRowHeight, err := book.GetRowHeight("邮件统计", 2)
	if err != nil {
		t.Fatal(err)
	}
	if subjectHeader != "邮件主题" || subject != "Payout completed" || bodyHeader != "邮件正文" || !strings.Contains(body, "USD 128.50") || strings.Contains(body, "完整付款金额") || strings.Contains(body, subject) ||
		receivedHeader != "收件时间" || receivedTime != "2026-08-11 02:30" || shopNoteHeader != "店铺备注" || exportedShopNote != "风控店铺，深圳客服组" || originalTime != "2026-08-11T02:30:00Z" || exportDate != "导出日期" ||
		attachmentCountHeader != "附件数量" || attachmentCount != "2" || attachmentDirectoryHeader != "附件目录" || !strings.HasPrefix(attachmentDirectory, "附件/") ||
		attachmentResultHeader != "附件导出结果" || !strings.HasPrefix(attachmentResult, "部分成功 1/2") ||
		statusHeader != "处理状态" || exportedStatus != "已处理" ||
		bodyStyle.Alignment == nil || bodyStyle.Alignment.WrapText || bodyStyle.Alignment.Indent != 1 || bodyRowHeight != 20 {
		t.Fatalf("email statistics workbook did not retain the required full fields: subjectHeader=%q subject=%q bodyHeader=%q body=%q receivedHeader=%q receivedTime=%q shopNoteHeader=%q shopNote=%q originalTime=%q statusHeader=%q status=%q export=%q",
			subjectHeader, subject, bodyHeader, body, receivedHeader, receivedTime, shopNoteHeader, exportedShopNote, originalTime, statusHeader, exportedStatus, exportDate)
	}

	var reopened emailProcessingActionResponse
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/email-processing/"+conversation.ID+"/reopen", adminToken, nil, http.StatusOK, &reopened)
	var reopenedPage emailStatisticsPage
	requestJSON(t, http.MethodGet, listURL, adminToken, nil, http.StatusOK, &reopenedPage)
	if reopened.Item.Conversation.Status != ConversationStatusOpen || reopenedPage.Total != 1 || len(reopenedPage.Items) != 1 || reopenedPage.Items[0].Status != ConversationStatusOpen {
		t.Fatalf("email statistics status did not follow email processing reopened state: action=%#v statistics=%#v", reopened, reopenedPage)
	}

	var permittedAgent User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email: "finance-agent@example.com", DisplayName: "Finance Agent", Password: "agent-password", Role: UserRoleAgent,
		Department: DepartmentFinance,
	}, http.StatusCreated, &permittedAgent)
	if permittedAgent.Department != DepartmentFinance || permittedAgent.SkillGroup != "" || permittedAgent.PermissionsCustomized ||
		len(permittedAgent.Permissions) != 1 || permittedAgent.Permissions[0] != PermissionEmailStatisticsView {
		t.Fatalf("finance department defaults are incorrect: %#v", permittedAgent)
	}
	if _, err := store.AssignUserToShop(ctx, shop.ID, permittedAgent.ID); err != nil {
		t.Fatal(err)
	}
	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{Email: permittedAgent.Email, Password: "agent-password"}, http.StatusOK, &login)
	var scoped emailStatisticsPage
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/email-statistics", login.Token, nil, http.StatusOK, &scoped)
	if scoped.Total != 1 || len(scoped.Shops) != 1 || scoped.Shops[0].ID != shop.ID || len(scoped.Mailboxes) != 1 {
		t.Fatalf("email statistics agent scope leaked another shop: %#v", scoped)
	}
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/email-statistics/"+otherConversation.ID+"/messages/missing", login.Token, nil, http.StatusForbidden, nil)

	all := AccessScopeAll
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/users/"+permittedAgent.ID, adminToken, updateUserRequest{
		WorkbenchShopScope: &all,
	}, http.StatusOK, &permittedAgent)
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/email-statistics", login.Token, nil, http.StatusOK, &scoped)
	if scoped.Total != 2 || len(scoped.Shops) != 2 || len(scoped.Mailboxes) != 2 {
		t.Fatalf("all email statistics scope did not ignore shop assignments: %#v", scoped)
	}
}
