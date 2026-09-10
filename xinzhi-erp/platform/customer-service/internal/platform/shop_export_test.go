package platform

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"
)

func TestShopExportIncludesOnlyPageAndBoundChannelDataAndRequiresPermission(t *testing.T) {
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{
		DisplayName: "Detailed Export Shop",
		Platform:    "shopify",
		ExternalID:  "detailed-export.myshopify.com",
		Metadata: map[string]string{
			"internalNote":        "深圳客服组重点店铺",
			"aiReplyRules":        "退款问题先核对订单状态",
			"shopifyDomain":       "detailed-export.myshopify.com",
			"client_secret":       "do-not-export-client-secret",
			"encryptedCredential": "do-not-export-encrypted-credential",
		},
	}, http.StatusCreated, &shop)
	agent := createTestAgent(t, server.URL, adminToken, "export-agent@example.com", "Export Agent")
	if _, err := store.AssignUserToShop(t.Context(), shop.ID, agent.ID); err != nil {
		t.Fatal(err)
	}
	secondAgent := createTestAgent(t, server.URL, adminToken, "second-export-agent@example.com", "Second Export Agent")
	if _, err := store.AssignUserToShop(t.Context(), shop.ID, secondAgent.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateShopSource(t.Context(), ShopSource{
		ShopID: shop.ID, Type: SourceTypeShopifyAPI, Provider: "shopify_admin", Address: "detailed-export.myshopify.com",
		Metadata: map[string]string{
			"connectionState": "installed", "themeEmbedState": "enabled", "appDeployStatus": "ready", "appDeployVersion": "v12",
			"access_token": "do-not-export-access-token",
		},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateShopSource(t.Context(), ShopSource{
		ShopID: shop.ID, Type: SourceTypeEmail, Provider: "outlook", Address: "billing@detailed-export.example",
		Metadata: map[string]string{
			"email_sync_status": "retrying", "email_health_status": "degraded", "refresh_token": "do-not-export-second-refresh-token",
		},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateShopSource(t.Context(), ShopSource{
		ShopID: shop.ID, Type: SourceTypeEmail, Provider: "gmail", Address: "support@detailed-export.example",
		Metadata: map[string]string{
			"email_sync_status": "ok", "email_health_status": "ok", "email_notification_status": "ok", "refresh_token": "do-not-export-refresh-token",
		},
	}); err != nil {
		t.Fatal(err)
	}

	request, err := http.NewRequest(http.MethodGet, server.URL+"/api/v1/shops/export", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+adminToken)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	workbookBytes, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || !bytes.HasPrefix(workbookBytes, []byte("PK")) {
		t.Fatalf("unexpected shop export response: status=%d body=%q", response.StatusCode, workbookBytes)
	}
	if response.Header.Get("Content-Type") != "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || !strings.Contains(response.Header.Get("Content-Disposition"), ".xlsx") {
		t.Fatalf("unexpected shop export headers: type=%q disposition=%q", response.Header.Get("Content-Type"), response.Header.Get("Content-Disposition"))
	}
	book, err := excelize.OpenReader(bytes.NewReader(workbookBytes))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = book.Close() }()
	if actual := strings.Join(book.GetSheetList(), ","); actual != "店铺明细" {
		t.Fatalf("unexpected shop export sheets: %s", actual)
	}
	rows, err := book.GetRows("店铺明细")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 {
		t.Fatalf("shop export should have one header row and one row per shop, got %d rows", len(rows))
	}
	if len(rows[1]) != len(rows[0]) {
		t.Fatalf("shop export header has %d columns but shop row has %d", len(rows[0]), len(rows[1]))
	}
	expectedHeaders := []string{"账号名称", "Shopify", "绑定 Shopify 店铺", "邮箱", "绑定邮箱", "邮箱服务商", "备注", "客服"}
	if strings.Join(rows[0], "|") != strings.Join(expectedHeaders, "|") {
		t.Fatalf("unexpected compact shop export headers: %#v", rows[0])
	}
	headerIndexes := make(map[string]int, len(rows[0]))
	for index, header := range rows[0] {
		headerIndexes[header] = index
	}
	if mailboxCell := rows[1][headerIndexes["绑定邮箱"]]; mailboxCell != "billing@detailed-export.example\nsupport@detailed-export.example" {
		t.Fatalf("multiple mailboxes should be merged into the same shop row in stable order, got %q", mailboxCell)
	}
	if providerCell := rows[1][headerIndexes["邮箱服务商"]]; providerCell != "Outlook\nGmail" {
		t.Fatalf("mailbox providers should keep the same order, got %q", providerCell)
	}
	if agentCell := rows[1][headerIndexes["客服"]]; agentCell != "Export Agent\nSecond Export Agent" {
		t.Fatalf("multiple agents should be merged into the same shop row in stable order, got %q", agentCell)
	}
	if emailStatus := rows[1][headerIndexes["邮箱"]]; emailStatus != "部分异常 1/2" {
		t.Fatalf("email status should match the page summary, got %q", emailStatus)
	}
	allCells := strings.Builder{}
	for _, row := range rows {
		allCells.WriteString(strings.Join(row, "\t"))
		allCells.WriteByte('\n')
	}
	exported := allCells.String()
	for _, expected := range []string{
		"Detailed Export Shop", "深圳客服组重点店铺", "detailed-export.myshopify.com", "接入正常",
		"support@detailed-export.example", "billing@detailed-export.example", "Gmail", "Outlook", "Export Agent", "Second Export Agent",
	} {
		if !strings.Contains(exported, expected) {
			t.Fatalf("shop export is missing %q: %s", expected, exported)
		}
	}
	for _, forbidden := range []string{
		"do-not-export-client-secret", "do-not-export-encrypted-credential", "do-not-export-access-token", "do-not-export-refresh-token",
		"do-not-export-second-refresh-token", "退款问题先核对订单状态", "export-agent@example.com", "second-export-agent@example.com",
		"账号ID", "归属", "邮件同步状态", "客服登录邮箱",
	} {
		if strings.Contains(exported, forbidden) {
			t.Fatalf("shop export leaked sensitive value %q", forbidden)
		}
	}

	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email: "export-agent@example.com", Password: "agent-password",
	}, http.StatusOK, &login)
	forbiddenRequest, err := http.NewRequest(http.MethodGet, server.URL+"/api/v1/shops/export", nil)
	if err != nil {
		t.Fatal(err)
	}
	forbiddenRequest.Header.Set("Authorization", "Bearer "+login.Token)
	forbiddenResponse, err := http.DefaultClient.Do(forbiddenRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer forbiddenResponse.Body.Close()
	if forbiddenResponse.StatusCode != http.StatusForbidden {
		t.Fatalf("shop export without permission status=%d, want %d", forbiddenResponse.StatusCode, http.StatusForbidden)
	}
}

func TestShopExportHonorsShopDataScope(t *testing.T) {
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var assignedShop, hiddenShop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Assigned Export Shop"}, http.StatusCreated, &assignedShop)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Hidden Export Shop"}, http.StatusCreated, &hiddenShop)
	var exporter User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email: "scoped-exporter@example.com", DisplayName: "Scoped Exporter", Password: "export-password", Role: UserRoleAgent,
		PermissionsCustomized: true, Permissions: []string{PermissionShopsView, PermissionShopsExport}, ShopScope: AccessScopeAssigned,
	}, http.StatusCreated, &exporter)
	if _, err := store.AssignUserToShop(t.Context(), assignedShop.ID, exporter.ID); err != nil {
		t.Fatal(err)
	}
	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email: "scoped-exporter@example.com", Password: "export-password",
	}, http.StatusOK, &login)

	request, err := http.NewRequest(http.MethodGet, server.URL+"/api/v1/shops/export", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+login.Token)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	workbookBytes, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("scoped shop export status=%d body=%s", response.StatusCode, workbookBytes)
	}
	book, err := excelize.OpenReader(bytes.NewReader(workbookBytes))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = book.Close() }()
	rows, err := book.GetRows("店铺明细")
	if err != nil {
		t.Fatal(err)
	}
	exported := ""
	for _, row := range rows {
		exported += strings.Join(row, "\t") + "\n"
	}
	if !strings.Contains(exported, assignedShop.DisplayName) || strings.Contains(exported, hiddenShop.DisplayName) {
		t.Fatalf("shop export did not honor assigned scope: %s", exported)
	}
}
