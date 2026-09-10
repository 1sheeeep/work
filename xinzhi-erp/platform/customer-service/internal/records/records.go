package records

import (
	"archive/zip"
	"bufio"
	"bytes"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"shopify-support-platform/internal/appcore"
)

type CategoryOption struct {
	Primary   string   `json:"primary"`
	Secondary string   `json:"secondary"`
	Tertiary  []string `json:"tertiary"`
}

type ClassificationDraft struct {
	Primary     string `json:"primary"`
	Secondary   string `json:"secondary"`
	Tertiary    string `json:"tertiary"`
	Remark      string `json:"remark"`
	AutoFilled  bool   `json:"autoFilled"`
	NeedsReview bool   `json:"needsReview"`
}

const (
	PrimaryPendingReview = "待确认"
	PrimaryNotOrdered    = "未下单"
)

type HandledRecord struct {
	Key            string `json:"key"`
	HandledAt      string `json:"handledAt"`
	ReplyDate      string `json:"replyDate"`
	ShopName       string `json:"shopName"`
	ShopKey        string `json:"shopKey"`
	MallID         string `json:"mallId"`
	OrderNumber    string `json:"orderNumber"`
	Email          string `json:"email"`
	Primary        string `json:"primary"`
	Secondary      string `json:"secondary"`
	Tertiary       string `json:"tertiary"`
	InboundChannel string `json:"inboundChannel"`
	Remark         string `json:"remark"`
	Source         string `json:"source"`
	ConversationID string `json:"conversationId"`
	CustomerName   string `json:"customerName"`
	Status         string `json:"status"`
}

type ExportResult struct {
	Path       string `json:"path"`
	RowCount   int    `json:"rowCount"`
	StartDate  string `json:"startDate"`
	EndDate    string `json:"endDate"`
	ExportedAt string `json:"exportedAt"`
}

type Store struct {
	dataDir    string
	configPath string
	recordPath string
}

func NewStore(dataDir string) Store {
	return Store{
		dataDir:    dataDir,
		configPath: filepath.Join(dataDir, "config", "record_categories.json"),
		recordPath: filepath.Join(dataDir, "records", "handled_records.jsonl"),
	}
}

func (s Store) Categories() ([]CategoryOption, error) {
	if err := os.MkdirAll(filepath.Dir(s.configPath), 0755); err != nil {
		return nil, err
	}
	if _, err := os.Stat(s.configPath); os.IsNotExist(err) {
		if err := writeJSON(s.configPath, defaultCategories()); err != nil {
			return nil, err
		}
	}
	raw, err := os.ReadFile(s.configPath)
	if err != nil {
		return nil, err
	}
	var categories []CategoryOption
	if err := json.Unmarshal(raw, &categories); err != nil || len(categories) == 0 {
		categories = defaultCategories()
		_ = writeJSON(s.configPath, categories)
	}
	categories = normalizeCategories(categories)
	if !sameCategorySet(categories, normalizeCategories(defaultCategories())) {
		_ = writeJSON(s.configPath, categories)
	}
	return categories, nil
}

func (s Store) SaveCategories(categories []CategoryOption) ([]CategoryOption, error) {
	categories = normalizeCategories(categories)
	if err := os.MkdirAll(filepath.Dir(s.configPath), 0755); err != nil {
		return nil, err
	}
	if err := writeJSON(s.configPath, categories); err != nil {
		return nil, err
	}
	return categories, nil
}

func (s Store) Classify(conversation appcore.Conversation) ClassificationDraft {
	categories, _ := s.Categories()
	return ValidateDraft(HeuristicClassify(conversation), categories)
}

func (s Store) UpdateDraft(conversation appcore.Conversation, draft ClassificationDraft) (appcore.Conversation, error) {
	categories, err := s.Categories()
	if err != nil {
		return conversation, err
	}
	draft = ValidateDraft(draft, categories)
	conversation.RecordPrimary = draft.Primary
	conversation.RecordSecondary = draft.Secondary
	conversation.RecordTertiary = draft.Tertiary
	conversation.RecordRemark = draft.Remark
	conversation.RecordClassified = true
	return conversation, nil
}

func (s Store) Upsert(conversation appcore.Conversation, status string, handledAt time.Time) (HandledRecord, error) {
	if handledAt.IsZero() {
		handledAt = time.Now()
	}
	categories, err := s.Categories()
	if err != nil {
		return HandledRecord{}, err
	}
	draft := ValidateDraft(ClassificationDraft{
		Primary:   conversation.RecordPrimary,
		Secondary: conversation.RecordSecondary,
		Tertiary:  conversation.RecordTertiary,
		Remark:    conversation.RecordRemark,
	}, categories)
	record := HandledRecord{
		Key:            RecordKey(conversation),
		HandledAt:      handledAt.Format(time.RFC3339),
		ReplyDate:      formatReplyDate(handledAt),
		ShopName:       firstNonEmpty(conversation.ShopName, conversation.ShopKey, "未知店铺"),
		ShopKey:        conversation.ShopKey,
		MallID:         conversation.MallID,
		OrderNumber:    ExtractOrderNumber(conversation),
		Email:          strings.TrimSpace(conversation.CustomerEmail),
		Primary:        draft.Primary,
		Secondary:      draft.Secondary,
		Tertiary:       draft.Tertiary,
		InboundChannel: inboundChannel(conversation.Source),
		Remark:         strings.TrimSpace(draft.Remark),
		Source:         conversation.Source,
		ConversationID: firstNonEmpty(conversation.ConversationID, conversation.ID),
		CustomerName:   firstNonEmpty(conversation.CustomerName, conversation.CustomerFullName),
		Status:         status,
	}
	if record.Key == "" {
		record.Key = stableID(record.ShopName + "|" + record.Source + "|" + record.Email + "|" + record.CustomerName)
	}
	if err := s.upsertRecord(record); err != nil {
		return HandledRecord{}, err
	}
	return record, nil
}

func (s Store) Export(startDate string, endDate string, destination string) (ExportResult, error) {
	start, end, err := normalizeDateRange(startDate, endDate)
	if err != nil {
		return ExportResult{}, err
	}
	records, err := s.recordsInRange(start, end)
	if err != nil {
		return ExportResult{}, err
	}
	if strings.TrimSpace(destination) == "" {
		destination = filepath.Join(s.dataDir, "exports", defaultExportFileName(start, end))
	}
	if !strings.EqualFold(filepath.Ext(destination), ".xlsx") {
		destination += ".xlsx"
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0755); err != nil {
		return ExportResult{}, err
	}
	if err := writeXLSX(destination, records); err != nil {
		return ExportResult{}, err
	}
	return ExportResult{
		Path:       destination,
		RowCount:   len(records),
		StartDate:  start.Format("2006-01-02"),
		EndDate:    end.Format("2006-01-02"),
		ExportedAt: time.Now().Format(time.RFC3339),
	}, nil
}

func (s Store) upsertRecord(record HandledRecord) error {
	if err := os.MkdirAll(filepath.Dir(s.recordPath), 0755); err != nil {
		return err
	}
	records, err := s.readAll()
	if err != nil {
		return err
	}
	replaced := false
	for index := range records {
		if records[index].Key == record.Key {
			records[index] = record
			replaced = true
			break
		}
	}
	if !replaced {
		records = append(records, record)
	}
	tmp := s.recordPath + ".tmp"
	file, err := os.Create(tmp)
	if err != nil {
		return err
	}
	enc := json.NewEncoder(file)
	for _, item := range records {
		if err := enc.Encode(item); err != nil {
			_ = file.Close()
			return err
		}
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, s.recordPath)
}

func (s Store) recordsInRange(start time.Time, end time.Time) ([]HandledRecord, error) {
	records, err := s.readAll()
	if err != nil {
		return nil, err
	}
	var out []HandledRecord
	for _, record := range records {
		handledAt, err := time.Parse(time.RFC3339, record.HandledAt)
		if err != nil {
			continue
		}
		day := localDay(handledAt)
		if day.Before(start) || day.After(end) {
			continue
		}
		out = append(out, record)
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].HandledAt < out[j].HandledAt
	})
	return out, nil
}

func (s Store) readAll() ([]HandledRecord, error) {
	file, err := os.Open(s.recordPath)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer file.Close()
	var records []HandledRecord
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var record HandledRecord
		if json.Unmarshal([]byte(line), &record) == nil && record.Key != "" {
			records = append(records, record)
		}
	}
	return records, scanner.Err()
}

func RecordKey(conversation appcore.Conversation) string {
	identity := firstNonEmpty(conversation.ConversationID, conversation.ID, conversation.SourceURL, conversation.CustomerEmail+"|"+conversation.Preview)
	if strings.TrimSpace(identity) == "" {
		return ""
	}
	return stableID(strings.Join([]string{
		strings.ToLower(strings.TrimSpace(conversation.ShopKey)),
		strings.ToLower(strings.TrimSpace(conversation.Source)),
		strings.ToLower(strings.TrimSpace(identity)),
	}, "|"))
}

func HeuristicClassify(conversation appcore.Conversation) ClassificationDraft {
	text := strings.ToLower(strings.Join([]string{
		conversation.Topic,
		conversation.Preview,
		conversation.CustomerName,
		conversation.CustomerEmail,
		strings.Join(conversation.RawLines, "\n"),
		messageText(conversation.Messages),
		strings.Join(conversation.OrderCartLines, "\n"),
	}, "\n"))
	// The first-level category is an order lifecycle fact. Message wording can
	// describe an old status, quote an agent, or simply be wrong, so intent
	// heuristics must never promote it to 未发货/已发货/已签收. The platform
	// replaces this value only after it has verified the matching Shopify order.
	primary := PrimaryPendingReview
	switch {
	case containsAny(text, "refund", "return", "exchange", "cancel", "退款", "退货", "取消", "换货", "售后", "broken", "damage", "missing item", "complaint"):
		return ClassificationDraft{Primary: primary, Secondary: "售后问题", Tertiary: "退款退货咨询", AutoFilled: true}
	case containsAny(text, "tracking", "track", "logistics", "shipment", "shipped", "fulfilled", "delivered", "signed for", "delivery completed", "物流", "轨迹", "运输", "发货", "配送", "已签收", "已妥投", "妥投", "签收完成"):
		tertiary := "查询实时轨迹"
		if containsAny(text, "lost", "missing", "not received", "haven't received", "没有收到", "未收到", "丢件") {
			tertiary = "丢件怀疑"
		}
		return ClassificationDraft{Primary: primary, Secondary: "物流查询", Tertiary: tertiary, AutoFilled: true}
	case containsAny(text, "coupon", "discount", "expensive", "price", "优惠", "优惠券", "价格", "太贵", "折扣"):
		return ClassificationDraft{Primary: primary, Secondary: "产品咨询", Tertiary: "价格贵要优惠券", AutoFilled: true}
	case containsAny(text, "buy one get one", "free one", "bogo", "买一送一", "送一"):
		return ClassificationDraft{Primary: primary, Secondary: "产品咨询", Tertiary: "产品是否买一送一", AutoFilled: true}
	case containsAny(text, "product", "item", "size", "color", "商品", "产品", "尺码", "颜色"):
		return ClassificationDraft{Primary: primary, Secondary: "产品咨询", Tertiary: "产品信息咨询", AutoFilled: true}
	case containsAny(text, "order", "#", "订单"):
		return ClassificationDraft{Primary: primary, Secondary: "物流查询", Tertiary: "订单状态查询", AutoFilled: true}
	default:
		return ClassificationDraft{Primary: primary, Secondary: "产品咨询", Tertiary: "产品信息咨询", AutoFilled: true, NeedsReview: true}
	}
}

func ValidateDraft(draft ClassificationDraft, categories []CategoryOption) ClassificationDraft {
	draft.Primary = strings.TrimSpace(draft.Primary)
	draft.Secondary = strings.TrimSpace(draft.Secondary)
	draft.Tertiary = strings.TrimSpace(draft.Tertiary)
	draft.Remark = strings.TrimSpace(draft.Remark)
	primaries, secondaries, tertiaries := categoryDimensions(categories)
	if len(primaries) == 0 || len(secondaries) == 0 || len(tertiaries) == 0 {
		return draft
	}
	if draft.Primary != PrimaryPendingReview && !containsCategoryValue(primaries, draft.Primary) {
		draft.Primary = primaries[0]
		draft.NeedsReview = true
	}
	if !containsCategoryValue(secondaries, draft.Secondary) {
		draft.Secondary = secondaries[0]
		draft.NeedsReview = true
	}
	if !containsCategoryValue(tertiaries, draft.Tertiary) {
		draft.Tertiary = tertiaries[0]
		draft.NeedsReview = true
	}
	return draft
}

func containsCategoryValue(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func ExtractOrderNumber(conversation appcore.Conversation) string {
	values := []string{conversation.Topic, conversation.Preview, conversation.SourceURL}
	for _, link := range conversation.OrderLinks {
		values = append(values, link.Label, link.URL)
	}
	values = append(values, conversation.OrderCartLines...)
	values = append(values, conversation.RawLines...)
	for _, message := range conversation.Messages {
		values = append(values, message.Text)
	}
	patterns := []*regexp.Regexp{
		regexp.MustCompile(`#\s*(\d{3,})`),
		regexp.MustCompile(`(?i)\border\s*#?\s*(\d{3,})`),
		regexp.MustCompile(`/orders/(\d{3,})`),
	}
	for _, value := range values {
		unescaped, _ := url.QueryUnescape(value)
		for _, text := range []string{value, unescaped} {
			for _, pattern := range patterns {
				if match := pattern.FindStringSubmatch(text); len(match) > 1 {
					return "#" + match[1]
				}
			}
		}
	}
	return "/"
}

func normalizeDateRange(startDate string, endDate string) (time.Time, time.Time, error) {
	now := localDay(time.Now())
	start, err := parseDay(startDate)
	if err != nil {
		start = now
	}
	end, err := parseDay(endDate)
	if err != nil {
		end = start
	}
	if end.Before(start) {
		start, end = end, start
	}
	return start, end, nil
}

func parseDay(value string) (time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, fmt.Errorf("empty date")
	}
	return time.ParseInLocation("2006-01-02", value, time.Local)
}

func localDay(value time.Time) time.Time {
	local := value.In(time.Local)
	return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.Local)
}

func defaultExportFileName(start time.Time, end time.Time) string {
	return fmt.Sprintf("客服处理记录_%s_%s.xlsx", start.Format("20060102"), end.Format("20060102"))
}

func formatReplyDate(value time.Time) string {
	local := value.In(time.Local)
	return fmt.Sprintf("%d月%d日", local.Month(), local.Day())
}

func defaultCategories() []CategoryOption {
	return []CategoryOption{
		{Primary: "已发货", Secondary: "产品咨询", Tertiary: []string{"产品信息咨询", "价格贵要优惠券", "产品是否买一送一", "购物车/支付问题"}},
		{Primary: "已发货", Secondary: "物流查询", Tertiary: []string{"查询实时轨迹", "订单状态查询", "催促物流更新", "丢件怀疑", "已妥投未收到"}},
		{Primary: "已发货", Secondary: "售后问题", Tertiary: []string{"退款退货咨询", "商品损坏反馈", "补发换货咨询", "投诉差评风险"}},
		{Primary: "已签收", Secondary: "产品咨询", Tertiary: []string{"产品信息咨询", "价格贵要优惠券", "产品是否买一送一", "购物车/支付问题"}},
		{Primary: "已签收", Secondary: "物流查询", Tertiary: []string{"查询实时轨迹", "订单状态查询", "催促物流更新", "丢件怀疑", "已妥投未收到"}},
		{Primary: "已签收", Secondary: "售后问题", Tertiary: []string{"退款退货咨询", "商品损坏反馈", "补发换货咨询", "投诉差评风险"}},
		{Primary: "未发货", Secondary: "产品咨询", Tertiary: []string{"产品信息咨询", "价格贵要优惠券", "产品是否买一送一", "购物车/支付问题"}},
		{Primary: "未发货", Secondary: "物流查询", Tertiary: []string{"订单状态查询", "催促发货", "询问发货时间", "修改收货信息"}},
		{Primary: "未发货", Secondary: "售后问题", Tertiary: []string{"退款退货咨询", "取消订单咨询", "补发换货咨询", "投诉差评风险"}},
		{Primary: PrimaryNotOrdered, Secondary: "产品咨询", Tertiary: []string{"产品信息咨询", "价格贵要优惠券", "产品是否买一送一", "购物车/支付问题"}},
		{Primary: PrimaryNotOrdered, Secondary: "物流查询", Tertiary: []string{"订单状态查询", "催促发货", "询问发货时间", "修改收货信息"}},
		{Primary: PrimaryNotOrdered, Secondary: "售后问题", Tertiary: []string{"退款退货咨询", "取消订单咨询", "补发换货咨询", "投诉差评风险"}},
	}
}

func DefaultCategories() []CategoryOption {
	return normalizeCategories(defaultCategories())
}

func NormalizeCategories(categories []CategoryOption) []CategoryOption {
	return normalizeCategories(categories)
}

func normalizeCategories(categories []CategoryOption) []CategoryOption {
	primaries, secondaries, tertiaries := categoryDimensions(categories)
	if len(primaries) == 0 || len(secondaries) == 0 || len(tertiaries) == 0 {
		return nil
	}
	out := make([]CategoryOption, 0, len(primaries)*len(secondaries))
	for _, primary := range primaries {
		for _, secondary := range secondaries {
			out = append(out, CategoryOption{
				Primary:   primary,
				Secondary: secondary,
				Tertiary:  append([]string(nil), tertiaries...),
			})
		}
	}
	return out
}

func categoryDimensions(categories []CategoryOption) ([]string, []string, []string) {
	var primaries []string
	var secondaries []string
	var tertiaries []string
	seenPrimaries := map[string]bool{}
	seenSecondaries := map[string]bool{}
	seenTertiaries := map[string]bool{}
	for _, option := range categories {
		appendUniqueTrimmed(&primaries, seenPrimaries, option.Primary)
		appendUniqueTrimmed(&secondaries, seenSecondaries, option.Secondary)
		for _, tertiary := range option.Tertiary {
			appendUniqueTrimmed(&tertiaries, seenTertiaries, tertiary)
		}
	}
	return primaries, secondaries, tertiaries
}

func appendUniqueTrimmed(values *[]string, seen map[string]bool, value string) {
	value = strings.TrimSpace(value)
	if value == "" || seen[value] {
		return
	}
	seen[value] = true
	*values = append(*values, value)
}

func sameCategorySet(left []CategoryOption, right []CategoryOption) bool {
	leftRaw, _ := json.Marshal(left)
	rightRaw, _ := json.Marshal(right)
	return string(leftRaw) == string(rightRaw)
}

func writeJSON(path string, data any) error {
	raw, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(raw, '\n'), 0644)
}

func writeXLSX(path string, records []HandledRecord) error {
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()
	return writeXLSXTo(file, records)
}

func BuildXLSX(records []HandledRecord) ([]byte, error) {
	var output bytes.Buffer
	if err := writeXLSXTo(&output, records); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}

func writeXLSXTo(output io.Writer, records []HandledRecord) error {
	zw := zip.NewWriter(output)
	files := map[string]string{
		"[Content_Types].xml":        contentTypesXML,
		"_rels/.rels":                relsXML,
		"xl/workbook.xml":            workbookXML,
		"xl/_rels/workbook.xml.rels": workbookRelsXML,
		"xl/styles.xml":              stylesXML,
		"xl/worksheets/sheet1.xml":   worksheetXML(records),
	}
	for name, body := range files {
		w, err := zw.Create(name)
		if err != nil {
			return err
		}
		if _, err := io.WriteString(w, body); err != nil {
			return err
		}
	}
	return zw.Close()
}

func cloneCategories(categories []CategoryOption) []CategoryOption {
	out := make([]CategoryOption, len(categories))
	for index, category := range categories {
		out[index] = category
		out[index].Tertiary = append([]string(nil), category.Tertiary...)
	}
	return out
}

func worksheetXML(records []HandledRecord) string {
	headers := []string{"回复日期", "店铺名称", "订单号", "邮箱", "一级分类", "二级分类", "三级分类", "进线方式", "备注"}
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`)
	b.WriteString(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`)
	b.WriteString(`<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`)
	b.WriteString(`<cols><col min="1" max="1" width="14" customWidth="1"/><col min="2" max="2" width="22" customWidth="1"/><col min="3" max="3" width="14" customWidth="1"/><col min="4" max="4" width="32" customWidth="1"/><col min="5" max="7" width="16" customWidth="1"/><col min="8" max="8" width="14" customWidth="1"/><col min="9" max="9" width="34" customWidth="1"/></cols>`)
	b.WriteString(`<sheetData>`)
	writeRow(&b, 1, headers, []int{1, 1, 1, 1, 1, 1, 1, 1, 1})
	for index, record := range records {
		row := []string{record.ReplyDate, record.ShopName, record.OrderNumber, record.Email, record.Primary, record.Secondary, record.Tertiary, record.InboundChannel, record.Remark}
		styles := []int{0, 0, 0, 0, primaryStyle(record.Primary), secondaryStyle(record.Secondary), tertiaryStyle(record.Tertiary), channelStyle(record.InboundChannel), 0}
		writeRow(&b, index+2, row, styles)
	}
	lastRow := len(records) + 1
	if lastRow < 1 {
		lastRow = 1
	}
	b.WriteString(`</sheetData>`)
	b.WriteString(`<autoFilter ref="A1:I` + strconv.Itoa(lastRow) + `"/>`)
	b.WriteString(`<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>`)
	b.WriteString(`</worksheet>`)
	return b.String()
}

func writeRow(b *strings.Builder, rowIndex int, values []string, styles []int) {
	b.WriteString(`<row r="` + strconv.Itoa(rowIndex) + `">`)
	for index, value := range values {
		ref := columnName(index+1) + strconv.Itoa(rowIndex)
		style := 0
		if index < len(styles) {
			style = styles[index]
		}
		b.WriteString(`<c r="` + ref + `"`)
		if style > 0 {
			b.WriteString(` s="` + strconv.Itoa(style) + `"`)
		}
		b.WriteString(` t="inlineStr"><is><t>`)
		b.WriteString(xmlEscape(value))
		b.WriteString(`</t></is></c>`)
	}
	b.WriteString(`</row>`)
}

func columnName(index int) string {
	name := ""
	for index > 0 {
		index--
		name = string(rune('A'+index%26)) + name
		index /= 26
	}
	return name
}

func primaryStyle(value string) int {
	if value == "已发货" || value == "已签收" {
		return 2
	}
	return 3
}

func secondaryStyle(value string) int {
	if strings.Contains(value, "物流") {
		return 4
	}
	if strings.Contains(value, "产品") || strings.Contains(value, "订单") {
		return 5
	}
	return 6
}

func tertiaryStyle(value string) int {
	if strings.Contains(value, "丢件") || strings.Contains(value, "售后") || strings.Contains(value, "退款") {
		return 7
	}
	if strings.Contains(value, "轨迹") || strings.Contains(value, "物流") {
		return 8
	}
	return 9
}

func channelStyle(value string) int {
	if value == "店铺" || value == "Inbox" {
		return 10
	}
	return 0
}

func xmlEscape(value string) string {
	var b strings.Builder
	_ = xml.EscapeText(&b, []byte(value))
	return b.String()
}

func inboundChannel(source string) string {
	switch strings.ToLower(strings.TrimSpace(source)) {
	case "gmail", "outlook", "email", "cuiqiu":
		return "邮箱"
	case "inbox":
		return "店铺"
	case "fastmo":
		return "店铺"
	default:
		return "其他"
	}
}

func messageText(messages []appcore.MessageItem) string {
	var lines []string
	for _, message := range messages {
		lines = append(lines, message.Text)
	}
	return strings.Join(lines, "\n")
}

func containsAny(text string, values ...string) bool {
	for _, value := range values {
		if strings.Contains(text, strings.ToLower(value)) {
			return true
		}
	}
	return false
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func stableID(value string) string {
	sum := sha1.Sum([]byte(value))
	return hex.EncodeToString(sum[:])
}

const contentTypesXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`

const relsXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`

const workbookXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="处理记录" sheetId="1" r:id="rId1"/></sheets></workbook>`

const workbookRelsXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`

const stylesXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="11"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9EAF7"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8F1FF"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFCE4D6"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFC7CE"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFEB9C"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF4CCCC"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDEBFF"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD9E2EC"/></left><right style="thin"><color rgb="FFD9E2EC"/></right><top style="thin"><color rgb="FFD9E2EC"/></top><bottom style="thin"><color rgb="FFD9E2EC"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="11"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="7" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="8" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="9" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="10" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`
