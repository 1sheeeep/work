package platform

import (
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"
)

type shopExportData struct {
	Shops       []Shop
	Sources     []ShopSource
	Assignments []ShopAgent
	Users       []User
}

func (s *Server) handleShopExport(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, PermissionShopsExport)
	if !ok {
		return
	}
	ctx := r.Context()
	shops, err := s.store.ListShops(ctx)
	if err != nil {
		writeError(w, err)
		return
	}
	allowed, restricted, err := s.moduleScopeShopIDs(ctx, user, DataScopeShops)
	if err != nil {
		writeError(w, err)
		return
	}
	if restricted {
		shops = filterShopsByIDs(shops, allowed)
	}
	sources, err := s.store.ListShopSources(ctx, "")
	if err != nil {
		writeError(w, err)
		return
	}
	assignments, err := s.store.ListShopAssignments(ctx)
	if err != nil {
		writeError(w, err)
		return
	}
	users, err := s.store.ListUsers(ctx)
	if err != nil {
		writeError(w, err)
		return
	}
	accessibleShopIDs := make(map[string]bool, len(shops))
	for _, shop := range shops {
		accessibleShopIDs[shop.ID] = true
	}
	filteredSources := make([]ShopSource, 0, len(sources))
	for _, source := range sources {
		if accessibleShopIDs[source.ShopID] {
			filteredSources = append(filteredSources, source)
		}
	}
	filteredAssignments := make([]ShopAgent, 0, len(assignments))
	for _, assignment := range assignments {
		if accessibleShopIDs[assignment.ShopID] {
			filteredAssignments = append(filteredAssignments, assignment)
		}
	}
	content, err := buildShopExportWorkbook(shopExportData{
		Shops: shops, Sources: filteredSources, Assignments: filteredAssignments, Users: users,
	})
	if err != nil {
		writeError(w, fmt.Errorf("build shop export workbook: %w", err))
		return
	}
	filename := fmt.Sprintf("Xzdesk_店铺账号信息_%s.xlsx", time.Now().In(shanghaiLocation()).Format("20060102_150405"))
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename*=UTF-8''%s", url.QueryEscape(filename)))
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(content)
}

func buildShopExportWorkbook(data shopExportData) ([]byte, error) {
	shops := append([]Shop(nil), data.Shops...)
	sort.Slice(shops, func(i, j int) bool {
		left := strings.ToLower(strings.TrimSpace(shops[i].DisplayName))
		right := strings.ToLower(strings.TrimSpace(shops[j].DisplayName))
		if left == right {
			return shops[i].ID < shops[j].ID
		}
		return left < right
	})
	shopByID := make(map[string]bool, len(shops))
	sourcesByShopID := make(map[string][]ShopSource, len(shops))
	assignmentsByShopID := make(map[string][]ShopAgent, len(shops))
	userByID := make(map[string]User, len(data.Users))
	for _, shop := range shops {
		shopByID[shop.ID] = true
	}
	for _, source := range data.Sources {
		if shopByID[source.ShopID] {
			sourcesByShopID[source.ShopID] = append(sourcesByShopID[source.ShopID], source)
		}
	}
	for _, assignment := range data.Assignments {
		if shopByID[assignment.ShopID] {
			assignmentsByShopID[assignment.ShopID] = append(assignmentsByShopID[assignment.ShopID], assignment)
		}
	}
	for _, user := range data.Users {
		userByID[user.ID] = user
	}

	rows := [][]any{{"账号名称", "Shopify", "绑定 Shopify 店铺", "邮箱", "绑定邮箱", "邮箱服务商", "备注", "客服"}}
	for _, shop := range shops {
		sources := sourcesByShopID[shop.ID]
		sort.Slice(sources, func(i, j int) bool {
			if sources[i].Type != sources[j].Type {
				return sources[i].Type < sources[j].Type
			}
			left := strings.ToLower(firstNonEmpty(strings.TrimSpace(sources[i].Address), strings.TrimSpace(sources[i].Metadata["mailbox"])))
			right := strings.ToLower(firstNonEmpty(strings.TrimSpace(sources[j].Address), strings.TrimSpace(sources[j].Metadata["mailbox"])))
			if left == right {
				return sources[i].ID < sources[j].ID
			}
			return left < right
		})
		shopifySources := make([]ShopSource, 0, 1)
		emailSources := make([]ShopSource, 0)
		for _, source := range sources {
			switch source.Type {
			case SourceTypeShopifyAPI:
				shopifySources = append(shopifySources, source)
			case SourceTypeEmail:
				emailSources = append(emailSources, source)
			}
		}

		shopifyStatus := shopExportShopifySummary(nil)
		shopifyStores := make([]string, 0, len(shopifySources))
		if len(shopifySources) > 0 {
			shopifyStatus = shopExportShopifySummary(&shopifySources[0])
			for index := range shopifySources {
				if domain := shopExportShopifyDomain(shop, &shopifySources[index]); domain != "" {
					shopifyStores = append(shopifyStores, domain)
				}
			}
		} else if domain := shopExportShopifyDomain(shop, nil); domain != "" {
			shopifyStores = append(shopifyStores, domain)
		}

		mailboxes := make([]string, 0, len(emailSources))
		emailProviders := make([]string, 0, len(emailSources))
		for _, source := range emailSources {
			mailboxes = append(mailboxes, firstNonEmpty(strings.TrimSpace(source.Address), strings.TrimSpace(source.Metadata["mailbox"])))
			emailProviders = append(emailProviders, shopExportProvider(source.Provider))
		}

		assignments := assignmentsByShopID[shop.ID]
		sort.Slice(assignments, func(i, j int) bool {
			leftUser := userByID[assignments[i].UserID]
			rightUser := userByID[assignments[j].UserID]
			left := strings.ToLower(defaultString(strings.TrimSpace(leftUser.DisplayName), strings.TrimSpace(leftUser.Email)))
			right := strings.ToLower(defaultString(strings.TrimSpace(rightUser.DisplayName), strings.TrimSpace(rightUser.Email)))
			if left == right {
				return assignments[i].UserID < assignments[j].UserID
			}
			return left < right
		})
		agentNames := make([]string, 0, len(assignments))
		for _, assignment := range assignments {
			user := userByID[assignment.UserID]
			agentNames = append(agentNames, defaultString(strings.TrimSpace(user.DisplayName), strings.TrimSpace(user.Email)))
		}

		rows = append(rows, []any{
			shop.DisplayName,
			shopifyStatus,
			joinShopExportValues(shopifyStores),
			shopExportEmailSummary(emailSources),
			joinShopExportValues(mailboxes),
			joinShopExportValues(emailProviders),
			shopExportCellText(shop.Metadata["internalNote"]),
			joinShopExportValues(agentNames),
		})
	}

	book := excelize.NewFile()
	defer func() { _ = book.Close() }()
	defaultSheet := book.GetSheetName(0)
	_ = book.SetSheetName(defaultSheet, "店铺明细")
	if err := writeShopExportSheet(book, "店铺明细", rows, map[int]float64{
		1: 26, 2: 18, 3: 34, 4: 18, 5: 34, 6: 18, 7: 42, 8: 28,
	}); err != nil {
		return nil, err
	}
	buffer, err := book.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func writeShopExportSheet(book *excelize.File, sheet string, rows [][]any, widths map[int]float64) error {
	for rowIndex, row := range rows {
		for columnIndex, value := range row {
			cell, err := excelize.CoordinatesToCellName(columnIndex+1, rowIndex+1)
			if err != nil {
				return err
			}
			if err := book.SetCellValue(sheet, cell, value); err != nil {
				return err
			}
		}
	}
	maxColumns := 1
	if len(rows) > 0 {
		maxColumns = len(rows[0])
	}
	lastColumn, err := excelize.ColumnNumberToName(maxColumns)
	if err != nil {
		return err
	}
	headerStyle, err := book.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Bold: true, Color: "FFFFFF"},
		Fill:      excelize.Fill{Type: "pattern", Color: []string{"2563EB"}, Pattern: 1},
		Alignment: &excelize.Alignment{Vertical: "center"},
	})
	if err != nil {
		return err
	}
	if err := book.SetCellStyle(sheet, "A1", lastColumn+"1", headerStyle); err != nil {
		return err
	}
	if len(rows) > 1 {
		bodyStyle, styleErr := book.NewStyle(&excelize.Style{Alignment: &excelize.Alignment{Vertical: "top", WrapText: true}})
		if styleErr != nil {
			return styleErr
		}
		if err := book.SetCellStyle(sheet, "A2", lastColumn+strconv.Itoa(len(rows)), bodyStyle); err != nil {
			return err
		}
		for rowIndex := 1; rowIndex < len(rows); rowIndex++ {
			lineCount := 1
			for _, value := range rows[rowIndex] {
				textValue, ok := value.(string)
				if ok && strings.Count(textValue, "\n")+1 > lineCount {
					lineCount = strings.Count(textValue, "\n") + 1
				}
			}
			if lineCount > 5 {
				lineCount = 5
			}
			if err := book.SetRowHeight(sheet, rowIndex+1, float64(lineCount*20)); err != nil {
				return err
			}
		}
	}
	for column := 1; column <= maxColumns; column++ {
		width := 18.0
		if configured, ok := widths[column]; ok {
			width = configured
		}
		name, nameErr := excelize.ColumnNumberToName(column)
		if nameErr != nil {
			return nameErr
		}
		if err := book.SetColWidth(sheet, name, name, width); err != nil {
			return err
		}
	}
	lastRow := len(rows)
	if lastRow < 1 {
		lastRow = 1
	}
	if err := book.AutoFilter(sheet, "A1:"+lastColumn+strconv.Itoa(lastRow), []excelize.AutoFilterOptions{}); err != nil {
		return err
	}
	return book.SetPanes(sheet, &excelize.Panes{Freeze: true, YSplit: 1, TopLeftCell: "A2", ActivePane: "bottomLeft"})
}

func shopExportShopifyDomain(shop Shop, source *ShopSource) string {
	if source != nil {
		if domain := firstNonEmpty(strings.TrimSpace(source.Metadata["shopifyDomain"]), strings.TrimSpace(source.Address)); domain != "" {
			return domain
		}
	}
	return firstNonEmpty(strings.TrimSpace(shop.Metadata["shopifyDomain"]), strings.TrimSpace(shop.Metadata["domain"]), strings.TrimSpace(shop.ExternalID))
}

func shopExportShopifySummary(source *ShopSource) string {
	if source == nil {
		return "未配置"
	}
	if source.Status == SourceStatusDisabled {
		return "接入已停用"
	}
	state := strings.TrimSpace(source.Metadata["connectionState"])
	if state == "not_installed" || source.Metadata["apiStatus"] == "invalid_token" {
		return "待授权"
	}
	if state == "unknown" {
		return "检测失败"
	}
	switch strings.TrimSpace(source.Metadata["appDeployStatus"]) {
	case "failed":
		return "发布失败"
	case "pending":
		return "待发布"
	case "running":
		return "发布中"
	case "ready":
		if source.Metadata["themeEmbedState"] == "enabled" {
			return "接入正常"
		}
	}
	if source.Metadata["themeEmbedState"] == "disabled" || source.Metadata["themeEmbedState"] == "not_added" {
		return "待启用插件"
	}
	if state == "installed" || shopExportSourceConnected(*source) {
		return "已接入，待检测"
	}
	return "未配置"
}

func shopExportEmailSummary(sources []ShopSource) string {
	connected := make([]ShopSource, 0, len(sources))
	for _, source := range sources {
		if shopExportSourceConnected(source) {
			connected = append(connected, source)
		}
	}
	if len(connected) == 0 {
		return "邮箱未配置"
	}
	blocked, backlog, isolated, healthy, pending := 0, 0, 0, 0, 0
	for _, source := range connected {
		metadata := source.Metadata
		if metadata[emailManualPausedAtKey] != "" || metadata[emailRetryStateKey] == emailRetryStateRiskBlocked || metadata[emailRetryStateKey] == emailRetryStateReauthorizationNeeded {
			blocked++
		}
		if metadata["email_sync_backlog_pending"] == "true" {
			backlog++
		}
		if raw := strings.TrimSpace(metadata["email_high_frequency_last_at"]); raw != "" {
			if isolatedAt, err := time.Parse(time.RFC3339Nano, raw); err == nil && time.Since(isolatedAt) <= 24*time.Hour {
				isolated++
			}
		}
		provider := strings.ToLower(strings.TrimSpace(source.Provider))
		if metadata["email_health_status"] == "error" || metadata["email_sync_status"] == "error" {
			continue
		}
		if metadata["email_health_status"] != "ok" || (provider != cuiqiuProvider && metadata["email_notification_status"] != "ok") {
			pending++
		} else {
			healthy++
		}
	}
	if blocked > 0 {
		return fmt.Sprintf("需处理 %d/%d", blocked, len(connected))
	}
	if backlog > 0 {
		return fmt.Sprintf("追平积压 %d/%d", backlog, len(connected))
	}
	if isolated > 0 {
		return fmt.Sprintf("高频隔离 %d/%d", isolated, len(connected))
	}
	if healthy == len(connected) {
		if len(connected) == 1 {
			return "邮箱已接入"
		}
		return fmt.Sprintf("邮箱已接入 %d", len(connected))
	}
	if pending == len(connected) {
		if len(connected) == 1 {
			return "推送检测中"
		}
		return fmt.Sprintf("推送检测中 %d", len(connected))
	}
	if healthy == 0 {
		if len(connected) == 1 {
			return "邮箱异常"
		}
		return fmt.Sprintf("邮箱异常 %d", len(connected))
	}
	return fmt.Sprintf("部分异常 %d/%d", healthy, len(connected))
}

func shopExportSourceConnected(source ShopSource) bool {
	if source.Status != SourceStatusActive {
		return false
	}
	switch source.Type {
	case SourceTypeEmail:
		return firstNonEmpty(strings.TrimSpace(source.Address), strings.TrimSpace(source.Metadata["mailbox"])) != ""
	case SourceTypeShopifyAPI:
		return firstNonEmpty(strings.TrimSpace(source.Address), strings.TrimSpace(source.Metadata["shopifyDomain"])) != ""
	default:
		return true
	}
}

func shopExportProvider(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "gmail":
		return "Gmail"
	case "outlook":
		return "Outlook"
	case cuiqiuProvider:
		return "脆球邮箱"
	case standardMailProvider:
		return "标准IMAP邮箱"
	default:
		return strings.TrimSpace(value)
	}
}

func shopExportCellText(value string) string {
	const excelTextLimit = 32000
	runes := []rune(strings.TrimSpace(value))
	if len(runes) <= excelTextLimit {
		return string(runes)
	}
	return string(runes[:excelTextLimit]) + "…"
}

func joinShopExportValues(values []string) string {
	const excelTextLimit = 32000
	cleaned := make([]string, 0, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			cleaned = append(cleaned, value)
		}
	}
	joined := strings.Join(cleaned, "\n")
	runes := []rune(joined)
	if len(runes) <= excelTextLimit {
		return joined
	}
	return string(runes[:excelTextLimit]) + "…"
}
