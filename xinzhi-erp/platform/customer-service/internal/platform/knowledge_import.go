package platform

import (
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"
	"unicode"

	"github.com/xuri/excelize/v2"
)

const (
	knowledgeImportMaxBytes = 10 << 20
	knowledgeImportMaxRows  = 1000
)

type knowledgeImportIssue struct {
	Sheet   string `json:"sheet,omitempty"`
	Row     int    `json:"row"`
	Message string `json:"message"`
}

type knowledgeImportResult struct {
	Created int                    `json:"created"`
	Skipped int                    `json:"skipped"`
	Failed  int                    `json:"failed"`
	Issues  []knowledgeImportIssue `json:"issues"`
}

type spreadsheetKnowledgeRow struct {
	Sheet  string
	Row    int
	Title  string
	Answer string
	Tags   []string
}

func (s *Server) handleKnowledgeImport(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, PermissionKnowledgeCreate)
	if !ok {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, knowledgeImportMaxBytes+(1<<20))
	if err := r.ParseMultipartForm(2 << 20); err != nil {
		writeError(w, fmt.Errorf("%w: Excel 文件不能超过 10 MB", ErrInvalid))
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, fmt.Errorf("%w: 请选择 Excel 文件", ErrInvalid))
		return
	}
	defer file.Close()
	if header.Size > knowledgeImportMaxBytes || !strings.EqualFold(filepath.Ext(header.Filename), ".xlsx") {
		writeError(w, fmt.Errorf("%w: 仅支持不超过 10 MB 的 .xlsx 文件", ErrInvalid))
		return
	}

	scope := strings.TrimSpace(r.FormValue("scope"))
	if scope == "" {
		scope = KnowledgeScopeShop
	}
	shopID := strings.TrimSpace(r.FormValue("shopId"))
	if scope == KnowledgeScopeGlobal {
		shopID = ""
	}
	if scope != KnowledgeScopeGlobal && scope != KnowledgeScopeShop {
		writeError(w, fmt.Errorf("%w: unsupported knowledge scope", ErrInvalid))
		return
	}
	if scope == KnowledgeScopeShop && shopID == "" {
		writeError(w, fmt.Errorf("%w: shopId is required for shop knowledge", ErrInvalid))
		return
	}
	if !s.requireKnowledgeTargetAccess(w, r, user, scope, shopID) {
		return
	}

	rows, issues, err := parseKnowledgeWorkbook(file)
	if err != nil {
		writeError(w, err)
		return
	}
	commonTags := splitKnowledgeTags(r.FormValue("tags"))
	existing, err := s.store.ListKnowledge(r.Context(), KnowledgeFilter{Scope: scope, ShopID: shopID})
	if err != nil {
		writeError(w, err)
		return
	}
	seen := make(map[string]bool, len(existing)+len(rows))
	for _, entry := range existing {
		seen[knowledgeImportFingerprint(scope, shopID, entry.Title, entry.Answer)] = true
	}

	result := knowledgeImportResult{Issues: issues}
	result.Failed = len(issues)
	status := KnowledgeStatusPending
	reviewedBy := ""
	if userHasPermission(user, PermissionKnowledgeReview) {
		status = KnowledgeStatusPublished
		reviewedBy = user.ID
	}
	for _, row := range rows {
		fingerprint := knowledgeImportFingerprint(scope, shopID, row.Title, row.Answer)
		if seen[fingerprint] {
			result.Skipped++
			continue
		}
		_, createErr := s.store.CreateKnowledge(r.Context(), KnowledgeEntry{
			Scope:       scope,
			ShopID:      shopID,
			Title:       truncateKnowledgeText(row.Title, 180),
			Answer:      truncateKnowledgeText(row.Answer, 8000),
			Tags:        append(append([]string{}, commonTags...), row.Tags...),
			Status:      status,
			SubmittedBy: user.ID,
			ReviewedBy:  reviewedBy,
		})
		if createErr != nil {
			result.Failed++
			appendKnowledgeImportIssue(&result.Issues, knowledgeImportIssue{Sheet: row.Sheet, Row: row.Row, Message: "保存失败"})
			continue
		}
		seen[fingerprint] = true
		result.Created++
	}

	s.broadcast(Event{Type: "knowledge.imported", ShopID: shopID, Payload: result, CreatedAt: time.Now().UTC()})
	writeJSONResponse(w, http.StatusOK, result)
}

func parseKnowledgeWorkbook(reader io.Reader) ([]spreadsheetKnowledgeRow, []knowledgeImportIssue, error) {
	book, err := excelize.OpenReader(reader, excelize.Options{
		UnzipSizeLimit:    64 << 20,
		UnzipXMLSizeLimit: 16 << 20,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("%w: 无法读取 Excel 文件", ErrInvalid)
	}
	defer book.Close()

	result := make([]spreadsheetKnowledgeRow, 0, knowledgeImportMaxRows)
	issues := []knowledgeImportIssue{}
	processed := 0
	for _, sheet := range book.GetSheetList() {
		rows, getErr := book.GetRows(sheet)
		if getErr != nil {
			return nil, nil, fmt.Errorf("%w: 无法读取工作表", ErrInvalid)
		}
		if firstNonEmptyRow(rows) < 0 {
			continue
		}
		sheetResult, sheetIssues, sheetProcessed := parseKnowledgeSheet(sheet, rows, knowledgeImportMaxRows-processed)
		result = append(result, sheetResult...)
		for _, issue := range sheetIssues {
			appendKnowledgeImportIssue(&issues, issue)
		}
		processed += sheetProcessed
		if processed >= knowledgeImportMaxRows {
			break
		}
	}
	if len(result) == 0 {
		return nil, issues, fmt.Errorf("%w: Excel 中没有可导入的知识内容", ErrInvalid)
	}
	return result, issues, nil
}

func parseKnowledgeSheet(sheet string, sheetRows [][]string, limit int) ([]spreadsheetKnowledgeRow, []knowledgeImportIssue, int) {
	if limit <= 0 {
		return nil, nil, 0
	}
	headerIndex := detectKnowledgeHeaderRow(sheetRows)
	dataStart := firstNonEmptyRow(sheetRows)
	headers := generatedKnowledgeHeaders(sheetRows)
	if headerIndex >= 0 {
		headers = trimSpreadsheetRow(sheetRows[headerIndex])
		dataStart = headerIndex + 1
	}
	if dataStart < 0 {
		return nil, nil, 0
	}
	if headerIndex < 0 && nextNonEmptyRow(sheetRows, dataStart+1) < 0 && nonEmptyKnowledgeCells(sheetRows[dataStart]) < 2 {
		return nil, nil, 0
	}

	questionColumn := findKnowledgeColumn(headers, knowledgeQuestionHeaders, knowledgeQuestionHeaderKeywords)
	answerColumn := findKnowledgeColumn(headers, knowledgeAnswerHeaders, knowledgeAnswerHeaderKeywords)
	tagsColumn := findKnowledgeColumn(headers, knowledgeTagsHeaders, knowledgeTagsHeaderKeywords)
	result := make([]spreadsheetKnowledgeRow, 0, min(len(sheetRows)-dataStart, limit))
	issues := []knowledgeImportIssue{}

	processed := 0
	for index := dataStart; index < len(sheetRows) && processed < limit; index++ {
		values := trimSpreadsheetRow(sheetRows[index])
		if rowIsEmpty(values) {
			continue
		}
		processed++
		titleColumn := questionColumn
		if titleColumn < 0 || spreadsheetCell(values, titleColumn) == "" {
			titleColumn = firstKnowledgeValueColumn(values, answerColumn, tagsColumn)
		}
		title := spreadsheetCell(values, titleColumn)
		answer := spreadsheetCell(values, answerColumn)
		if answer == "" {
			answer = formatKnowledgeRow(headers, values, titleColumn, tagsColumn)
		}
		if title == "" && answer != "" {
			title = truncateKnowledgeText(answer, 180)
		}
		if title == "" || answer == "" {
			appendKnowledgeImportIssue(&issues, knowledgeImportIssue{Sheet: sheet, Row: index + 1, Message: "无法识别问题场景或回复内容"})
			continue
		}
		result = append(result, spreadsheetKnowledgeRow{
			Sheet:  sheet,
			Row:    index + 1,
			Title:  title,
			Answer: answer,
			Tags:   splitKnowledgeTags(spreadsheetCell(values, tagsColumn)),
		})
	}
	return result, issues, processed
}

var knowledgeQuestionHeaders = headerSet(
	"问题", "客户问题", "常见问题", "问题场景", "场景", "咨询场景", "客户咨询", "标题", "主题",
	"客户诉求", "问题描述", "用户问题", "意图",
	"question", "issue", "problem", "scenario", "title", "subject", "query", "prompt", "intent",
	"customer question", "customer message", "customer request",
)

var knowledgeAnswerHeaders = headerSet(
	"答案", "回复", "客服回复", "标准回复", "参考回复", "批准话术", "话术", "处理方案", "解决方案", "回复内容",
	"客服建议", "处理建议",
	"answer", "reply", "response", "solution", "resolution", "content", "completion",
	"approved reply", "support reply", "recommended response",
)

var knowledgeTagsHeaders = headerSet("标签", "分类", "关键词", "类目", "tags", "tag", "category", "keywords", "label", "topic")

var knowledgeQuestionHeaderKeywords = normalizedHeaders(
	"问题", "场景", "咨询", "标题", "主题", "客户诉求", "问题描述", "意图",
	"question", "issue", "problem", "scenario", "title", "subject", "query", "prompt", "intent", "customerrequest",
)

var knowledgeAnswerHeaderKeywords = normalizedHeaders(
	"答案", "回复", "话术", "处理方案", "解决方案", "回复内容", "客服建议", "处理建议",
	"answer", "reply", "response", "solution", "resolution", "completion", "supportreply", "recommendedresponse",
)

var knowledgeTagsHeaderKeywords = normalizedHeaders(
	"标签", "分类", "关键词", "类目", "tag", "category", "keyword", "label", "topic",
)

func headerSet(values ...string) map[string]bool {
	result := make(map[string]bool, len(values))
	for _, value := range values {
		result[normalizeKnowledgeHeader(value)] = true
	}
	return result
}

func normalizedHeaders(values ...string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		result = append(result, normalizeKnowledgeHeader(value))
	}
	return result
}

func normalizeKnowledgeHeader(value string) string {
	var builder strings.Builder
	for _, current := range strings.ToLower(strings.TrimSpace(value)) {
		if unicode.IsLetter(current) || unicode.IsNumber(current) {
			builder.WriteRune(current)
		}
	}
	return builder.String()
}

func findKnowledgeColumn(headers []string, candidates map[string]bool, keywords []string) int {
	for index, header := range headers {
		normalized := normalizeKnowledgeHeader(header)
		if candidates[normalized] {
			return index
		}
	}
	for index, header := range headers {
		normalized := normalizeKnowledgeHeader(header)
		for _, keyword := range keywords {
			if keyword != "" && strings.Contains(normalized, keyword) {
				return index
			}
		}
	}
	return -1
}

func detectKnowledgeHeaderRow(rows [][]string) int {
	first := firstNonEmptyRow(rows)
	if first < 0 {
		return -1
	}
	last := min(len(rows), first+12)
	bestIndex := -1
	bestScore := 0
	bestHasQuestionAndAnswer := false
	for index := first; index < last; index++ {
		headers := trimSpreadsheetRow(rows[index])
		if rowIsEmpty(headers) || !looksLikeKnowledgeHeaderRow(headers) {
			continue
		}
		score := 0
		questionColumn := findKnowledgeColumn(headers, knowledgeQuestionHeaders, knowledgeQuestionHeaderKeywords)
		answerColumn := findKnowledgeColumn(headers, knowledgeAnswerHeaders, knowledgeAnswerHeaderKeywords)
		if questionColumn >= 0 {
			score += 2
		}
		if answerColumn >= 0 {
			score += 2
		}
		if findKnowledgeColumn(headers, knowledgeTagsHeaders, knowledgeTagsHeaderKeywords) >= 0 {
			score++
		}
		if score > bestScore && nextNonEmptyRow(rows, index+1) >= 0 {
			bestIndex = index
			bestScore = score
			bestHasQuestionAndAnswer = questionColumn >= 0 && answerColumn >= 0 && questionColumn != answerColumn
		}
	}
	if bestHasQuestionAndAnswer {
		return bestIndex
	}
	for index := first; index < last; index++ {
		if looksLikeUnrecognizedKnowledgeHeaderRow(rows[index]) && nextNonEmptyRow(rows, index+1) >= 0 {
			return index
		}
	}
	return -1
}

func looksLikeKnowledgeHeaderRow(row []string) bool {
	nonEmpty := 0
	for _, value := range row {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		nonEmpty++
		if len([]rune(value)) > 40 || strings.ContainsAny(value, "\r\n。！？?!") {
			return false
		}
	}
	return nonEmpty >= 2
}

func looksLikeUnrecognizedKnowledgeHeaderRow(row []string) bool {
	if !looksLikeKnowledgeHeaderRow(row) {
		return false
	}
	matches := 0
	for _, value := range row {
		normalized := normalizeKnowledgeHeader(value)
		for _, keyword := range knowledgeGenericHeaderKeywords {
			if strings.Contains(normalized, keyword) {
				matches++
				break
			}
		}
	}
	return matches >= 2
}

var knowledgeGenericHeaderKeywords = normalizedHeaders(
	"问题", "场景", "咨询", "标题", "主题", "诉求", "意图", "答案", "回复", "话术", "方案", "标签", "分类", "关键词",
	"方式", "单号", "编号", "信息", "内容", "状态", "名称", "日期", "时间", "类型", "类别", "备注", "描述", "说明",
	"客户", "订单", "商品", "物流", "原因", "结果", "建议", "语言",
	"question", "issue", "problem", "scenario", "title", "subject", "query", "prompt", "intent", "answer", "reply", "response",
	"solution", "resolution", "tag", "keyword", "label", "topic",
	"method", "number", "info", "content", "status", "name", "date", "time", "type", "category", "note", "description",
	"customer", "order", "product", "shipping", "reason", "result", "language",
)

func nonEmptyKnowledgeCells(row []string) int {
	count := 0
	for _, value := range row {
		if strings.TrimSpace(value) != "" {
			count++
		}
	}
	return count
}

func nextNonEmptyRow(rows [][]string, start int) int {
	for index := start; index < len(rows); index++ {
		if !rowIsEmpty(rows[index]) {
			return index
		}
	}
	return -1
}

func generatedKnowledgeHeaders(rows [][]string) []string {
	columns := 0
	for _, row := range rows {
		columns = max(columns, len(row))
	}
	headers := make([]string, columns)
	for index := range headers {
		headers[index] = fmt.Sprintf("第%d列", index+1)
	}
	return headers
}

func firstNonEmptyRow(rows [][]string) int {
	for index, row := range rows {
		if !rowIsEmpty(row) {
			return index
		}
	}
	return -1
}

func trimSpreadsheetRow(row []string) []string {
	result := make([]string, len(row))
	for index, value := range row {
		result[index] = strings.TrimSpace(value)
	}
	return result
}

func rowIsEmpty(row []string) bool {
	for _, value := range row {
		if strings.TrimSpace(value) != "" {
			return false
		}
	}
	return true
}

func spreadsheetCell(row []string, column int) string {
	if column < 0 || column >= len(row) {
		return ""
	}
	return strings.TrimSpace(row[column])
}

func firstKnowledgeValueColumn(values []string, excluded ...int) int {
	blocked := map[int]bool{}
	for _, column := range excluded {
		blocked[column] = true
	}
	for index, value := range values {
		if !blocked[index] && strings.TrimSpace(value) != "" {
			return index
		}
	}
	return -1
}

func formatKnowledgeRow(headers []string, values []string, excluded ...int) string {
	blocked := map[int]bool{}
	for _, column := range excluded {
		blocked[column] = true
	}
	parts := []string{}
	for index, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || blocked[index] {
			continue
		}
		header := spreadsheetCell(headers, index)
		if header == "" {
			header = fmt.Sprintf("第%d列", index+1)
		}
		parts = append(parts, header+"："+value)
	}
	return strings.Join(parts, "\n")
}

func splitKnowledgeTags(value string) []string {
	return normalizeKnowledgeTags(strings.FieldsFunc(value, func(current rune) bool {
		switch current {
		case ',', '，', ';', '；', '\n', '\r':
			return true
		default:
			return false
		}
	}))
}

func knowledgeImportFingerprint(scope, shopID, title, answer string) string {
	normalize := func(value string) string {
		return strings.ToLower(strings.Join(strings.Fields(value), " "))
	}
	return scope + "\x00" + shopID + "\x00" + normalize(title) + "\x00" + normalize(answer)
}

func appendKnowledgeImportIssue(issues *[]knowledgeImportIssue, issue knowledgeImportIssue) {
	if len(*issues) < 50 {
		*issues = append(*issues, issue)
	}
}
