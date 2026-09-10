package platform

import (
	"context"
	"fmt"
	"net/http"
	"net/mail"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"
)

type emailStatisticsRecord struct {
	ConversationID         string               `json:"conversationId"`
	MessageID              string               `json:"messageId"`
	UniqueID               string               `json:"uniqueId"`
	Mailbox                string               `json:"mailbox"`
	SenderName             string               `json:"senderName,omitempty"`
	SenderEmail            string               `json:"senderEmail,omitempty"`
	Recipient              string               `json:"recipient"`
	ReceivedAt             time.Time            `json:"receivedAt"`
	ReceivedAtDisplay      string               `json:"receivedAtDisplay"`
	OriginalReceivedAt     string               `json:"originalReceivedAt,omitempty"`
	Subject                string               `json:"subject"`
	Preview                string               `json:"preview"`
	Provider               string               `json:"provider"`
	ShopID                 string               `json:"shopId"`
	SourceID               string               `json:"sourceId"`
	ShopName               string               `json:"shopName"`
	ShopNote               string               `json:"shopNote,omitempty"`
	HasAttachments         bool                 `json:"hasAttachments"`
	AttachmentNames        []string             `json:"attachmentNames"`
	AttachmentCount        int                  `json:"attachmentCount"`
	AttachmentDirectory    string               `json:"attachmentDirectory,omitempty"`
	AttachmentExportResult string               `json:"attachmentExportResult,omitempty"`
	Category               string               `json:"category"`
	Status                 string               `json:"status"`
	Tags                   []EmailProcessingTag `json:"tags"`
	MessageHeaderID        string               `json:"messageHeaderId,omitempty"`
	ReplyTo                string               `json:"replyTo,omitempty"`
}

type emailStatisticsDetail struct {
	Record emailStatisticsRecord `json:"record"`
	Body   string                `json:"body"`
}

type emailStatisticsPage struct {
	Items      []emailStatisticsRecord `json:"items"`
	Page       int                     `json:"page"`
	PageSize   int                     `json:"pageSize"`
	Total      int                     `json:"total"`
	TotalPages int                     `json:"totalPages"`
	Shops      []emailProcessingOption `json:"shops"`
	Mailboxes  []emailProcessingOption `json:"mailboxes"`
	Providers  []string                `json:"providers"`
}

type emailStatisticsFilter struct {
	ShopID       string
	SourceID     string
	Provider     string
	Category     string
	Status       string
	Search       string
	StartDate    string
	EndDate      string
	Start        time.Time
	EndExclusive time.Time
	Page         int
	PageSize     int
}

type emailStatisticsData struct {
	Records   []emailStatisticsRecord
	Bodies    map[string]string
	Total     int
	Shops     []emailProcessingOption
	Mailboxes []emailProcessingOption
	Providers []string
}

const emailStatisticsExportMaxRows = 100_000

func emailStatisticsConversationKind(kind string) bool {
	kind = normalizeConversationKind(kind)
	return kind == ConversationKindSystem || kind == ConversationKindDepartment
}

type emailStatisticsQueryRow struct {
	Conversation    Conversation
	Shop            Shop
	Source          ShopSource
	Message         Message
	Tags            []EmailProcessingTag
	AttachmentNames []string
}

type emailStatisticsQueryStore interface {
	QueryEmailStatistics(ctx context.Context, filter emailStatisticsFilter, scopeUserID string, paginate bool) ([]emailStatisticsQueryRow, int, error)
}

type emailStatisticsRefreshResponse struct {
	Synced               bool   `json:"synced"`
	Mailbox              string `json:"mailbox"`
	MessagesCreated      int    `json:"messagesCreated"`
	ConversationsCreated int    `json:"conversationsCreated"`
}

func (s *Server) handleEmailStatistics(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, PermissionEmailStatisticsView)
	if !ok {
		return
	}
	filter, err := parseEmailStatisticsFilter(r)
	if err != nil {
		writeError(w, err)
		return
	}
	data, err := s.emailStatisticsData(r.Context(), user, filter, true)
	if err != nil {
		writeError(w, err)
		return
	}
	totalPages := (data.Total + filter.PageSize - 1) / filter.PageSize
	if totalPages == 0 {
		totalPages = 1
	}
	page := filter.Page
	if page > totalPages {
		page = totalPages
	}
	writeJSONResponse(w, http.StatusOK, emailStatisticsPage{
		Items: nonNilSlice(data.Records), Page: page, PageSize: filter.PageSize,
		Total: data.Total, TotalPages: totalPages, Shops: nonNilSlice(data.Shops),
		Mailboxes: nonNilSlice(data.Mailboxes), Providers: nonNilSlice(data.Providers),
	})
}

func (s *Server) handleEmailStatisticsRefresh(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, PermissionEmailStatisticsView)
	if !ok {
		return
	}
	var input struct {
		Mailbox  string `json:"mailbox"`
		SourceID string `json:"sourceId"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.refreshEmailStatisticsSource(r.Context(), user, input.SourceID, input.Mailbox)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSONResponse(w, http.StatusOK, result)
}

func (s *Server) refreshEmailStatisticsSource(ctx context.Context, user User, sourceID string, mailbox string) (emailStatisticsRefreshResponse, error) {
	mailbox = normalizeEmail(mailbox)
	sourceID = strings.TrimSpace(sourceID)
	parsed, err := mail.ParseAddress(mailbox)
	if err != nil || normalizeEmail(parsed.Address) != mailbox {
		return emailStatisticsRefreshResponse{}, fmt.Errorf("%w: a complete mailbox address is required", ErrInvalid)
	}
	response := emailStatisticsRefreshResponse{Mailbox: mailbox}
	sources, err := s.store.ListShopSources(ctx, "")
	if err != nil {
		return emailStatisticsRefreshResponse{}, err
	}
	for _, source := range sources {
		if source.Type != SourceTypeEmail || source.Status != SourceStatusActive || normalizeEmail(sourceEmailAddress(source)) != mailbox || (sourceID != "" && source.ID != sourceID) {
			continue
		}
		allowed, accessErr := s.userCanAccessEmailStatisticsShop(ctx, user, source.ShopID)
		if accessErr != nil {
			return emailStatisticsRefreshResponse{}, accessErr
		}
		if !allowed {
			return emailStatisticsRefreshResponse{}, ErrForbidden
		}
		if !strings.EqualFold(source.Provider, standardMailProvider) {
			return response, nil
		}
		lock := s.emailSourceSyncLock(source.ID)
		lock.Lock()
		defer lock.Unlock()
		syncCtx, cancel := context.WithTimeout(ctx, emailSourceSyncTimeout)
		defer cancel()
		latest, getErr := s.store.GetShopSource(syncCtx, source.ShopID, source.ID)
		if getErr != nil {
			return emailStatisticsRefreshResponse{}, getErr
		}
		result := s.syncSingleEmailSource(syncCtx, latest.ShopID, standardMailProvider, latest)
		if result.SourcesFailed > 0 {
			return emailStatisticsRefreshResponse{}, fmt.Errorf("refresh mailbox failed: %s", strings.Join(result.Warnings, "; "))
		}
		response.Synced = true
		response.MessagesCreated = result.MessagesCreated
		response.ConversationsCreated = result.ConversationsCreated
		return response, nil
	}
	return response, nil
}

func (s *Server) handleEmailStatisticsSubroutes(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, PermissionEmailStatisticsView)
	if !ok {
		return
	}
	parts := splitPath(strings.TrimPrefix(r.URL.Path, "/api/v1/email-statistics/"))
	if len(parts) == 3 && parts[1] == "messages" && r.Method == http.MethodGet {
		detail, err := s.emailStatisticsDetail(r.Context(), user, parts[0], parts[2])
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSONResponse(w, http.StatusOK, detail)
		return
	}
	if len(parts) != 2 {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	conversation, err := s.emailStatisticsConversation(r.Context(), user, parts[0])
	if err != nil {
		writeError(w, err)
		return
	}
	switch {
	case parts[1] == "tags" && r.Method == http.MethodPut:
		var input struct {
			Tags []EmailProcessingTag `json:"tags"`
		}
		if !decodeJSON(w, r, &input) {
			return
		}
		tags, normalizeErr := normalizeEmailProcessingTags(input.Tags)
		if normalizeErr != nil {
			writeError(w, normalizeErr)
			return
		}
		tags, err = s.store.ReplaceConversationEmailTags(r.Context(), conversation.ID, tags, user.ID)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSONResponse(w, http.StatusOK, nonNilSlice(tags))
	case parts[1] == "handled" && r.Method == http.MethodPost:
		conversation, err = s.store.UpdateConversation(r.Context(), conversation.ID, ConversationUpdate{Status: ConversationStatusClosed})
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSONResponse(w, http.StatusOK, map[string]string{"status": ConversationStatusClosed})
	case parts[1] == "reopen" && r.Method == http.MethodPost:
		conversation, err = s.store.UpdateConversation(r.Context(), conversation.ID, ConversationUpdate{Status: ConversationStatusOpen})
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSONResponse(w, http.StatusOK, map[string]string{"status": ConversationStatusOpen})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func validateEmailStatisticsExportFilter(filter emailStatisticsFilter) error {
	if filter.Start.IsZero() || filter.EndExclusive.IsZero() {
		return fmt.Errorf("%w: 导出前请选择日期范围", ErrInvalid)
	}
	return nil
}

func parseEmailStatisticsFilter(r *http.Request) (emailStatisticsFilter, error) {
	query := r.URL.Query()
	filter := emailStatisticsFilter{
		ShopID: strings.TrimSpace(query.Get("shopId")), SourceID: strings.TrimSpace(query.Get("sourceId")),
		Provider: strings.ToLower(strings.TrimSpace(query.Get("provider"))), Category: strings.TrimSpace(query.Get("category")),
		Status: strings.TrimSpace(query.Get("status")), Search: strings.ToLower(strings.TrimSpace(query.Get("search"))),
		StartDate: strings.TrimSpace(query.Get("startDate")), EndDate: strings.TrimSpace(query.Get("endDate")),
		Page: positiveQueryInt(query.Get("page"), 1), PageSize: positiveQueryInt(query.Get("pageSize"), 50),
	}
	if filter.PageSize > 100 {
		filter.PageSize = 100
	}
	if filter.Status != "" && filter.Status != ConversationStatusOpen && filter.Status != ConversationStatusClosed {
		return emailStatisticsFilter{}, fmt.Errorf("%w: unsupported email statistics status", ErrInvalid)
	}
	if filter.Category != "" && !isEmailProcessingCategory(filter.Category) {
		return emailStatisticsFilter{}, fmt.Errorf("%w: unsupported email statistics category", ErrInvalid)
	}
	if (filter.StartDate == "") != (filter.EndDate == "") {
		return emailStatisticsFilter{}, fmt.Errorf("%w: startDate and endDate must be provided together", ErrInvalid)
	}
	if filter.StartDate != "" {
		location := shanghaiLocation()
		start, err := time.ParseInLocation("2006-01-02", filter.StartDate, location)
		if err != nil {
			return emailStatisticsFilter{}, fmt.Errorf("%w: invalid startDate", ErrInvalid)
		}
		end, err := time.ParseInLocation("2006-01-02", filter.EndDate, location)
		if err != nil || end.Before(start) {
			return emailStatisticsFilter{}, fmt.Errorf("%w: invalid endDate", ErrInvalid)
		}
		filter.Start = start.UTC()
		filter.EndExclusive = end.AddDate(0, 0, 1).UTC()
	}
	return filter, nil
}

func (s *Server) emailStatisticsData(ctx context.Context, user User, filter emailStatisticsFilter, paginate bool) (emailStatisticsData, error) {
	shops, err := s.store.ListShops(ctx)
	if err != nil {
		return emailStatisticsData{}, err
	}
	shopsByID := make(map[string]Shop, len(shops))
	for _, shop := range shops {
		shopsByID[shop.ID] = shop
	}
	allowedShopIDs := map[string]bool{}
	restricted := user.Role != UserRoleAdmin && effectiveWorkbenchShopScope(user.WorkbenchShopScope) != AccessScopeAll
	if restricted {
		assigned, assignedErr := s.store.ListUserShopIDs(ctx, user.ID)
		if assignedErr != nil {
			return emailStatisticsData{}, assignedErr
		}
		allowedShopIDs = stringSet(assigned)
	}
	sources, err := s.store.ListShopSources(ctx, "")
	if err != nil {
		return emailStatisticsData{}, err
	}
	sourcesByID := make(map[string]ShopSource, len(sources))
	for _, source := range sources {
		sourcesByID[source.ID] = source
	}
	if queryStore, ok := s.store.(emailStatisticsQueryStore); ok {
		scopeUserID := ""
		if restricted {
			scopeUserID = user.ID
		}
		rows, total, queryErr := queryStore.QueryEmailStatistics(ctx, filter, scopeUserID, paginate)
		if queryErr != nil {
			return emailStatisticsData{}, queryErr
		}
		records := make([]emailStatisticsRecord, 0, len(rows))
		bodies := make(map[string]string, len(rows))
		for _, row := range rows {
			attachments := map[string][]string{}
			if sourceMessageID := strings.TrimSpace(row.Message.SourceMessageID); sourceMessageID != "" && len(row.AttachmentNames) > 0 {
				attachments[sourceMessageID] = append([]string(nil), row.AttachmentNames...)
			}
			status := ConversationStatusOpen
			if row.Conversation.Status == ConversationStatusClosed {
				status = ConversationStatusClosed
			}
			record := buildEmailStatisticsRecord(row.Conversation, row.Shop, row.Source, row.Message, attachments,
				emailProcessingCategory(row.Conversation, nil), status, row.Tags)
			records = append(records, record)
			bodies[emailStatisticsBodyKey(record.ConversationID, record.MessageID)] = row.Message.Body
		}
		shopOptions, mailboxOptions, providers := emailStatisticsOptions(shops, sources, restricted, allowedShopIDs)
		return emailStatisticsData{Records: records, Bodies: bodies, Total: total, Shops: shopOptions, Mailboxes: mailboxOptions, Providers: providers}, nil
	}
	conversations := []Conversation{}
	for _, kind := range []string{ConversationKindSystem, ConversationKindDepartment} {
		items, listErr := s.store.ListConversations(ctx, ConversationFilter{
			ShopID: filter.ShopID, SourceID: filter.SourceID, Kind: kind,
		})
		if listErr != nil {
			return emailStatisticsData{}, listErr
		}
		conversations = append(conversations, items...)
	}
	tagsByConversationID, err := s.store.ListConversationEmailTags(ctx)
	if err != nil {
		return emailStatisticsData{}, err
	}
	records := []emailStatisticsRecord{}
	bodies := map[string]string{}
	for _, conversation := range conversations {
		source, exists := sourcesByID[conversation.SourceID]
		if !exists || source.Type != SourceTypeEmail || (restricted && !allowedShopIDs[conversation.ShopID]) {
			continue
		}
		if conversation.Classification == suspectedMarketingReviewClassification {
			continue
		}
		provider := strings.ToLower(strings.TrimSpace(source.Provider))
		if filter.Provider != "" && provider != filter.Provider {
			continue
		}
		status := ConversationStatusOpen
		if conversation.Status == ConversationStatusClosed {
			status = ConversationStatusClosed
		}
		if filter.Status != "" && status != filter.Status {
			continue
		}
		messages, messageErr := s.store.ListMessages(ctx, conversation.ID)
		if messageErr != nil {
			return emailStatisticsData{}, messageErr
		}
		category := emailProcessingCategory(conversation, messages)
		if filter.Category != "" && category != filter.Category {
			continue
		}
		attachments := emailStatisticsAttachments(messages)
		for _, message := range messages {
			if !isEmailStatisticsMessage(message) || (!filter.Start.IsZero() && (message.CreatedAt.Before(filter.Start) || !message.CreatedAt.Before(filter.EndExclusive))) {
				continue
			}
			record := buildEmailStatisticsRecord(conversation, shopsByID[conversation.ShopID], source, message, attachments, category, status, tagsByConversationID[conversation.ID])
			if filter.Search != "" && !emailStatisticsMatchesSearch(record, message.Body, filter.Search) {
				continue
			}
			records = append(records, record)
			bodies[emailStatisticsBodyKey(record.ConversationID, record.MessageID)] = message.Body
		}
	}
	sort.SliceStable(records, func(i, j int) bool {
		if records[i].ReceivedAt.Equal(records[j].ReceivedAt) {
			return records[i].UniqueID > records[j].UniqueID
		}
		return records[i].ReceivedAt.After(records[j].ReceivedAt)
	})
	total := len(records)
	if !paginate && total > emailStatisticsExportMaxRows {
		return emailStatisticsData{}, fmt.Errorf("%w: 导出结果超过 %d 封，请缩小日期范围或增加筛选条件", ErrInvalid, emailStatisticsExportMaxRows)
	}
	if paginate {
		totalPages := (total + filter.PageSize - 1) / filter.PageSize
		if totalPages == 0 {
			totalPages = 1
		}
		page := filter.Page
		if page > totalPages {
			page = totalPages
		}
		start := (page - 1) * filter.PageSize
		end := start + filter.PageSize
		if start > total {
			start = total
		}
		if end > total {
			end = total
		}
		records = records[start:end]
	}
	shopOptions, mailboxOptions, providers := emailStatisticsOptions(shops, sources, restricted, allowedShopIDs)
	return emailStatisticsData{Records: records, Bodies: bodies, Total: total, Shops: shopOptions, Mailboxes: mailboxOptions, Providers: providers}, nil
}

func emailStatisticsOptions(shops []Shop, sources []ShopSource, restricted bool, allowedShopIDs map[string]bool) ([]emailProcessingOption, []emailProcessingOption, []string) {
	shopOptions := []emailProcessingOption{}
	for _, shop := range shops {
		if restricted && !allowedShopIDs[shop.ID] {
			continue
		}
		shopOptions = append(shopOptions, emailProcessingOption{ID: shop.ID, Label: shop.DisplayName})
	}
	sort.Slice(shopOptions, func(i, j int) bool {
		return strings.ToLower(shopOptions[i].Label) < strings.ToLower(shopOptions[j].Label)
	})
	mailboxOptions := []emailProcessingOption{}
	providerSet := map[string]bool{}
	for _, source := range sources {
		if source.Type != SourceTypeEmail || (restricted && !allowedShopIDs[source.ShopID]) {
			continue
		}
		provider := strings.ToLower(strings.TrimSpace(source.Provider))
		providerSet[provider] = true
		connected := source.Status == SourceStatusActive && strings.TrimSpace(source.Metadata[emailDisconnectedAtKey]) == ""
		syncable := connected && provider == standardMailProvider
		mailboxOptions = append(mailboxOptions, emailProcessingOption{ID: source.ID, Label: source.Address, ShopID: source.ShopID, Provider: provider, Connected: connected, Syncable: syncable})
	}
	sort.Slice(mailboxOptions, func(i, j int) bool {
		return strings.ToLower(mailboxOptions[i].Label) < strings.ToLower(mailboxOptions[j].Label)
	})
	providers := []string{}
	for provider := range providerSet {
		if provider != "" {
			providers = append(providers, provider)
		}
	}
	sort.Strings(providers)
	return shopOptions, mailboxOptions, providers
}

func isEmailStatisticsMessage(message Message) bool {
	if message.Direction == MessageDirectionAgent || normalizeMessageType(message.Type) != MessageTypeText {
		return false
	}
	return !strings.Contains(strings.TrimSpace(message.SourceMessageID), ":attachment:")
}

func buildEmailStatisticsRecord(conversation Conversation, shop Shop, source ShopSource, message Message, attachments map[string][]string, category string, status string, tags []EmailProcessingTag) emailStatisticsRecord {
	uniqueID := firstNonEmpty(strings.TrimSpace(message.SourceMessageID), strings.TrimSpace(message.Metadata["mail_message_id"]), message.ID)
	names := append([]string(nil), attachments[strings.TrimSpace(message.SourceMessageID)]...)
	for _, name := range strings.Split(message.Metadata["email_attachment_names"], "\n") {
		name = strings.TrimSpace(name)
		if name != "" {
			names = append(names, name)
		}
	}
	names = uniqueStrings(names)
	attachmentCount := len(names)
	if storedCount, err := strconv.Atoi(strings.TrimSpace(message.Metadata["email_attachment_count"])); err == nil && storedCount > attachmentCount {
		attachmentCount = storedCount
	}
	body := cleanProviderEmailBody(message.Body)
	preview := truncateEmailPreview(strings.Join(strings.Fields(body), " "), 180)
	originalReceivedAt := strings.TrimSpace(message.Metadata["email_received_at_original"])
	return emailStatisticsRecord{
		ConversationID: conversation.ID, MessageID: message.ID, UniqueID: uniqueID,
		Mailbox: source.Address, SenderName: firstNonEmpty(message.SenderName, conversation.CustomerName),
		SenderEmail: firstNonEmpty(message.SenderEmail, conversation.CustomerEmail), Recipient: source.Address,
		ReceivedAt: message.CreatedAt, ReceivedAtDisplay: formatEmailStatisticsOriginalTime(originalReceivedAt, message.CreatedAt),
		OriginalReceivedAt: originalReceivedAt,
		Subject:            conversation.Subject, Preview: preview, Provider: strings.ToLower(strings.TrimSpace(source.Provider)),
		ShopID: conversation.ShopID, SourceID: source.ID, ShopName: shop.DisplayName, ShopNote: strings.TrimSpace(shop.Metadata["internalNote"]),
		HasAttachments:  strings.EqualFold(message.Metadata["email_has_attachments"], "true") || attachmentCount > 0,
		AttachmentNames: nonNilSlice(names), AttachmentCount: attachmentCount, Category: category, Status: status,
		Tags:            nonNilSlice(append([]EmailProcessingTag(nil), tags...)),
		MessageHeaderID: message.Metadata["mail_message_id"], ReplyTo: message.Metadata["mail_reply_to_email"],
	}
}

func formatEmailStatisticsOriginalTime(original string, fallback time.Time) string {
	original = strings.TrimSpace(original)
	if original != "" {
		if parsed, err := mail.ParseDate(original); err == nil {
			return parsed.Format("2006-01-02 15:04")
		}
		for _, layout := range []string{time.RFC3339Nano, time.RFC3339} {
			if parsed, err := time.Parse(layout, original); err == nil {
				return parsed.Format("2006-01-02 15:04")
			}
		}
	}
	if fallback.IsZero() {
		return "-"
	}
	return fallback.Format("2006-01-02 15:04")
}

func emailStatisticsAttachments(messages []Message) map[string][]string {
	out := map[string][]string{}
	for _, message := range messages {
		if normalizeMessageType(message.Type) != MessageTypeImage && normalizeMessageType(message.Type) != MessageTypeFile {
			continue
		}
		sourceID := strings.TrimSpace(message.SourceMessageID)
		index := strings.LastIndex(sourceID, ":attachment:")
		if index <= 0 {
			continue
		}
		base := sourceID[:index]
		name := firstNonEmpty(message.Metadata["fileName"], message.Body)
		if name != "" {
			out[base] = append(out[base], name)
		}
	}
	for key, names := range out {
		out[key] = uniqueStrings(names)
	}
	return out
}

func uniqueStrings(input []string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, value := range input {
		value = strings.TrimSpace(value)
		key := strings.ToLower(value)
		if value == "" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, value)
	}
	return out
}

func emailStatisticsMatchesSearch(record emailStatisticsRecord, body string, search string) bool {
	values := []string{record.UniqueID, record.Mailbox, record.SenderName, record.SenderEmail, record.Recipient,
		record.Subject, body, record.Provider, record.ShopName, strings.Join(record.AttachmentNames, " ")}
	return strings.Contains(strings.ToLower(strings.Join(values, "\n")), strings.ToLower(strings.TrimSpace(search)))
}

func (s *Server) emailStatisticsDetail(ctx context.Context, user User, conversationID string, messageID string) (emailStatisticsDetail, error) {
	conversation, err := s.store.GetConversation(ctx, strings.TrimSpace(conversationID))
	if err != nil {
		return emailStatisticsDetail{}, err
	}
	if !emailStatisticsConversationKind(conversation.Kind) || conversation.Classification == suspectedMarketingReviewClassification {
		return emailStatisticsDetail{}, ErrNotFound
	}
	allowed, accessErr := s.userCanAccessEmailStatisticsShop(ctx, user, conversation.ShopID)
	if accessErr != nil {
		return emailStatisticsDetail{}, accessErr
	}
	if !allowed {
		return emailStatisticsDetail{}, ErrForbidden
	}
	shop, err := s.store.GetShop(ctx, conversation.ShopID)
	if err != nil {
		return emailStatisticsDetail{}, err
	}
	source, err := s.store.GetShopSource(ctx, conversation.ShopID, conversation.SourceID)
	if err != nil {
		return emailStatisticsDetail{}, err
	}
	if source.Type != SourceTypeEmail {
		return emailStatisticsDetail{}, ErrNotFound
	}
	messages, err := s.store.ListMessages(ctx, conversation.ID)
	if err != nil {
		return emailStatisticsDetail{}, err
	}
	tags, err := s.emailProcessingTagsForConversation(ctx, conversation.ID)
	if err != nil {
		return emailStatisticsDetail{}, err
	}
	for _, message := range messages {
		if message.ID != strings.TrimSpace(messageID) || !isEmailStatisticsMessage(message) {
			continue
		}
		status := ConversationStatusOpen
		if conversation.Status == ConversationStatusClosed {
			status = ConversationStatusClosed
		}
		record := buildEmailStatisticsRecord(conversation, shop, source, message, emailStatisticsAttachments(messages), emailProcessingCategory(conversation, messages), status, tags)
		return emailStatisticsDetail{Record: record, Body: message.Body}, nil
	}
	return emailStatisticsDetail{}, ErrNotFound
}

func (s *Server) emailStatisticsConversation(ctx context.Context, user User, conversationID string) (Conversation, error) {
	conversation, err := s.store.GetConversation(ctx, strings.TrimSpace(conversationID))
	if err != nil {
		return Conversation{}, err
	}
	if !emailStatisticsConversationKind(conversation.Kind) || conversation.Classification == suspectedMarketingReviewClassification {
		return Conversation{}, ErrNotFound
	}
	allowed, err := s.userCanAccessEmailStatisticsShop(ctx, user, conversation.ShopID)
	if err != nil {
		return Conversation{}, err
	}
	if !allowed {
		return Conversation{}, ErrForbidden
	}
	source, err := s.store.GetShopSource(ctx, conversation.ShopID, conversation.SourceID)
	if err != nil {
		return Conversation{}, err
	}
	if source.Type != SourceTypeEmail {
		return Conversation{}, ErrNotFound
	}
	return conversation, nil
}

func (s *Server) userCanAccessEmailStatisticsShop(ctx context.Context, user User, shopID string) (bool, error) {
	if user.Role == UserRoleAdmin || effectiveWorkbenchShopScope(user.WorkbenchShopScope) == AccessScopeAll {
		return true, nil
	}
	return s.userCanAccessAssignedShop(ctx, user, shopID)
}

func emailStatisticsBodyKey(conversationID string, messageID string) string {
	return conversationID + "\x00" + messageID
}

func buildEmailStatisticsWorkbook(records []emailStatisticsRecord, bodies map[string]string, exportedAt time.Time) ([]byte, error) {
	const excelTextChunkRunes = 30000
	maxBodyParts := 1
	bodyParts := make(map[string][]string, len(records))
	for _, record := range records {
		body := bodies[emailStatisticsBodyKey(record.ConversationID, record.MessageID)]
		parts := splitExcelText(strings.TrimSpace(body), excelTextChunkRunes)
		bodyParts[emailStatisticsBodyKey(record.ConversationID, record.MessageID)] = parts
		if len(parts) > maxBodyParts {
			maxBodyParts = len(parts)
		}
	}
	headers := []any{"邮件唯一ID", "邮箱账号", "发件人", "收件人", "收件时间", "邮件主题", "邮件正文"}
	for index := 1; index < maxBodyParts; index++ {
		headers = append(headers, "邮件正文续"+strconv.Itoa(index))
	}
	headers = append(headers, "平台", "店铺名称", "店铺备注", "有无附件", "附件数量", "邮件分类", "处理状态", "原始时间和时区", "附件名称", "附件目录", "附件导出结果", "导出日期")
	rows := [][]any{headers}
	location := shanghaiLocation()
	exportTime := exportedAt.In(location).Format("2006-01-02 15:04")
	for _, record := range records {
		sender := strings.TrimSpace(record.SenderName)
		if record.SenderEmail != "" {
			if sender != "" {
				sender += " <" + record.SenderEmail + ">"
			} else {
				sender = record.SenderEmail
			}
		}
		row := []any{record.UniqueID, record.Mailbox, sender, record.Recipient, record.ReceivedAtDisplay, record.Subject}
		parts := bodyParts[emailStatisticsBodyKey(record.ConversationID, record.MessageID)]
		for index := 0; index < maxBodyParts; index++ {
			if index < len(parts) {
				row = append(row, parts[index])
			} else {
				row = append(row, "")
			}
		}
		originalTime := firstNonEmpty(record.OriginalReceivedAt, record.ReceivedAt.Format(time.RFC3339Nano))
		row = append(row, emailStatisticsProviderLabel(record.Provider), record.ShopName, record.ShopNote, yesNoLabel(record.HasAttachments), record.AttachmentCount,
			emailStatisticsCategoryLabel(record.Category), emailStatisticsStatusLabel(record.Status), originalTime,
			strings.Join(record.AttachmentNames, " | "), record.AttachmentDirectory, record.AttachmentExportResult, exportTime)
		rows = append(rows, row)
	}
	book := excelize.NewFile()
	defer func() { _ = book.Close() }()
	sheet := book.GetSheetName(0)
	_ = book.SetSheetName(sheet, "邮件统计")
	for rowIndex, row := range rows {
		for columnIndex, value := range row {
			cell, err := excelize.CoordinatesToCellName(columnIndex+1, rowIndex+1)
			if err != nil {
				return nil, err
			}
			if err := book.SetCellValue("邮件统计", cell, value); err != nil {
				return nil, err
			}
		}
	}
	lastColumn, _ := excelize.ColumnNumberToName(len(headers))
	headerStyle, err := book.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Bold: true, Color: "FFFFFF"},
		Fill:      excelize.Fill{Type: "pattern", Color: []string{"2563EB"}, Pattern: 1},
		Alignment: &excelize.Alignment{Vertical: "center"},
	})
	if err != nil {
		return nil, err
	}
	compactContentStyle, err := book.NewStyle(&excelize.Style{Alignment: &excelize.Alignment{WrapText: false, Vertical: "center", Indent: 1}})
	if err != nil {
		return nil, err
	}
	if err := book.SetCellStyle("邮件统计", "A1", lastColumn+"1", headerStyle); err != nil {
		return nil, err
	}
	if len(rows) > 1 {
		endRow := strconv.Itoa(len(rows))
		startContentColumn, _ := excelize.ColumnNumberToName(6)
		endBodyColumn, _ := excelize.ColumnNumberToName(6 + maxBodyParts)
		if err := book.SetCellStyle("邮件统计", startContentColumn+"2", endBodyColumn+endRow, compactContentStyle); err != nil {
			return nil, err
		}
		for rowIndex := 2; rowIndex <= len(rows); rowIndex++ {
			if err := book.SetRowHeight("邮件统计", rowIndex, 20); err != nil {
				return nil, err
			}
		}
		if err := book.AutoFilter("邮件统计", "A1:"+lastColumn+endRow, []excelize.AutoFilterOptions{}); err != nil {
			return nil, err
		}
	}
	_ = book.SetColWidth("邮件统计", "A", "A", 26)
	_ = book.SetColWidth("邮件统计", "B", "E", 22)
	_ = book.SetColWidth("邮件统计", "F", "F", 36)
	startBodyColumn, _ := excelize.ColumnNumberToName(7)
	endBodyColumn, _ := excelize.ColumnNumberToName(6 + maxBodyParts)
	_ = book.SetColWidth("邮件统计", startBodyColumn, endBodyColumn, 52)
	if 7+maxBodyParts <= len(headers) {
		startExtra, _ := excelize.ColumnNumberToName(7 + maxBodyParts)
		_ = book.SetColWidth("邮件统计", startExtra, lastColumn, 18)
	}
	if err := book.SetPanes("邮件统计", &excelize.Panes{Freeze: true, YSplit: 1, TopLeftCell: "A2", ActivePane: "bottomLeft"}); err != nil {
		return nil, err
	}
	buffer, err := book.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func splitExcelText(value string, limit int) []string {
	runes := []rune(value)
	if len(runes) == 0 {
		return []string{""}
	}
	out := []string{}
	for len(runes) > 0 {
		end := limit
		if end > len(runes) {
			end = len(runes)
		}
		out = append(out, string(runes[:end]))
		runes = runes[end:]
	}
	return out
}

func emailStatisticsProviderLabel(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "gmail":
		return "Gmail"
	case "outlook":
		return "Outlook"
	case standardMailProvider:
		return "其他邮箱"
	default:
		return strings.TrimSpace(value)
	}
}

func emailStatisticsCategoryLabel(value string) string {
	switch value {
	case emailProcessingCategoryVerification:
		return "验证码"
	case emailProcessingCategorySecurity:
		return "安全通知"
	case emailProcessingCategoryPayment:
		return "支付财务"
	case emailProcessingCategoryLogistics:
		return "物流库存"
	case emailProcessingCategoryPlatform:
		return "平台通知"
	default:
		return "其他通知"
	}
}

func emailStatisticsStatusLabel(value string) string {
	if value == ConversationStatusClosed {
		return "已处理"
	}
	return "待处理"
}

func yesNoLabel(value bool) string {
	if value {
		return "有"
	}
	return "无"
}
