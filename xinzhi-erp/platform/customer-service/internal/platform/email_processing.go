package platform

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	emailProcessingCategoryVerification = "verification"
	emailProcessingCategorySecurity     = "security"
	emailProcessingCategoryPayment      = "payment"
	emailProcessingCategoryLogistics    = "logistics"
	emailProcessingCategoryPlatform     = "platform"
	emailProcessingCategoryOther        = "other"
)

var (
	emailProcessingSecurityPattern  = regexp.MustCompile(`(?i)\b(security|password|login|sign[- ]?in|new device|account access|suspicious|unauthorized|安全|密码|登录|新设备|异常访问)\b`)
	emailProcessingPaymentPattern   = regexp.MustCompile(`(?i)\b(payment|payout|refund|chargeback|dispute|invoice|billing|subscription|付款|收款|退款|拒付|争议|账单|订阅)\b`)
	emailProcessingLogisticsPattern = regexp.MustCompile(`(?i)\b(shipment|shipping|delivery|fulfillment|tracking|inventory|stock|物流|配送|履约|运单|库存)\b`)
)

type emailProcessingItem struct {
	Conversation    Conversation         `json:"conversation"`
	ShopName        string               `json:"shopName"`
	SourceAddress   string               `json:"sourceAddress"`
	Provider        string               `json:"provider"`
	Category        string               `json:"category"`
	Preview         string               `json:"preview,omitempty"`
	ShopifyOfficial bool                 `json:"shopifyOfficial"`
	Tags            []EmailProcessingTag `json:"tags"`
}

type emailProcessingOption struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	ShopID    string `json:"shopId,omitempty"`
	Provider  string `json:"provider,omitempty"`
	Connected bool   `json:"connected"`
	Syncable  bool   `json:"syncable,omitempty"`
}

type emailProcessingPage struct {
	Items      []emailProcessingItem   `json:"items"`
	Page       int                     `json:"page"`
	PageSize   int                     `json:"pageSize"`
	Total      int                     `json:"total"`
	TotalPages int                     `json:"totalPages"`
	OpenCount  int                     `json:"openCount"`
	Shops      []emailProcessingOption `json:"shops"`
	Mailboxes  []emailProcessingOption `json:"mailboxes"`
	TagOptions []EmailProcessingTag    `json:"tagOptions"`
}

type emailProcessingDetail struct {
	Item     emailProcessingItem `json:"item"`
	Messages []Message           `json:"messages"`
}

type emailProcessingActionResponse struct {
	Item             emailProcessingItem `json:"item"`
	EmailReadSynced  bool                `json:"emailReadSynced,omitempty"`
	EmailReadPending bool                `json:"emailReadPending,omitempty"`
}

type emailProcessingFilter struct {
	ShopID   string
	SourceID string
	Status   string
	Category string
	Tag      string
	Search   string
	Page     int
	PageSize int
}

type emailProcessingQueryRow struct {
	Conversation  Conversation
	ShopName      string
	SourceAddress string
	Provider      string
	Category      string
	LatestBody    string
	Tags          []EmailProcessingTag
}

type emailProcessingQueryStore interface {
	QueryEmailProcessing(ctx context.Context, filter emailProcessingFilter, scopeUserID string, unreadUserID string) ([]emailProcessingQueryRow, int, int, []EmailProcessingTag, error)
}

func (s *Server) handleEmailProcessing(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireEmailProcessingPermission(w, r)
	if !ok {
		return
	}
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	page, err := s.emailProcessingPage(r.Context(), user, r)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSONResponse(w, http.StatusOK, page)
}

func (s *Server) handleEmailProcessingSubroutes(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireEmailProcessingPermission(w, r)
	if !ok {
		return
	}
	parts := splitPath(strings.TrimPrefix(r.URL.Path, "/api/v1/email-processing/"))
	if len(parts) == 1 && r.Method == http.MethodGet {
		detail, err := s.emailProcessingDetail(r.Context(), parts[0], user)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSONResponse(w, http.StatusOK, detail)
		return
	}
	if len(parts) == 4 && parts[1] == "messages" && parts[3] == "translate" && r.Method == http.MethodPost {
		conversation, err := s.emailProcessingConversation(r.Context(), parts[0], user)
		if err != nil {
			writeError(w, err)
			return
		}
		s.handleMessageTranslation(w, r, user, conversation, parts[2])
		return
	}
	if len(parts) == 2 && parts[1] == "tags" && r.Method == http.MethodPut {
		conversation, err := s.emailProcessingConversation(r.Context(), parts[0], user)
		if err != nil {
			writeError(w, err)
			return
		}
		var input struct {
			Tags []EmailProcessingTag `json:"tags"`
		}
		if !decodeJSON(w, r, &input) {
			return
		}
		tags, err := normalizeEmailProcessingTags(input.Tags)
		if err != nil {
			writeError(w, err)
			return
		}
		tags, err = s.store.ReplaceConversationEmailTags(r.Context(), conversation.ID, tags, user.ID)
		if err != nil {
			writeError(w, err)
			return
		}
		messages, err := s.store.ListMessages(r.Context(), conversation.ID)
		if err != nil {
			writeError(w, err)
			return
		}
		item, err := s.emailProcessingItem(r.Context(), conversation, nil, nil, messages, tags)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSONResponse(w, http.StatusOK, item)
		return
	}
	if len(parts) != 2 || r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	conversation, err := s.emailProcessingConversation(r.Context(), parts[0], user)
	if err != nil {
		writeError(w, err)
		return
	}
	messages, err := s.store.ListMessages(r.Context(), conversation.ID)
	if err != nil {
		writeError(w, err)
		return
	}
	tags, err := s.emailProcessingTagsForConversation(r.Context(), conversation.ID)
	if err != nil {
		writeError(w, err)
		return
	}
	switch parts[1] {
	case "handled":
		conversation, err = s.store.UpdateConversation(r.Context(), conversation.ID, ConversationUpdate{Status: ConversationStatusClosed})
		if err != nil {
			writeError(w, err)
			return
		}
		readAt := time.Now().UTC()
		if len(messages) > 0 && !messages[len(messages)-1].CreatedAt.IsZero() {
			readAt = messages[len(messages)-1].CreatedAt
		}
		if err := s.store.MarkConversationRead(r.Context(), user.ID, conversation.ID, readAt); err != nil {
			writeError(w, err)
			return
		}
		readSynced, readErr := s.markEmailMessagesRead(r.Context(), conversation, messages)
		item, itemErr := s.emailProcessingItem(r.Context(), conversation, nil, nil, messages, tags)
		if itemErr != nil {
			writeError(w, itemErr)
			return
		}
		writeJSONResponse(w, http.StatusOK, emailProcessingActionResponse{Item: item, EmailReadSynced: readSynced, EmailReadPending: !readSynced || readErr != nil})
	case "reopen":
		conversation, err = s.store.UpdateConversation(r.Context(), conversation.ID, ConversationUpdate{Status: ConversationStatusOpen})
		if err != nil {
			writeError(w, err)
			return
		}
		item, itemErr := s.emailProcessingItem(r.Context(), conversation, nil, nil, messages, tags)
		if itemErr != nil {
			writeError(w, itemErr)
			return
		}
		writeJSONResponse(w, http.StatusOK, emailProcessingActionResponse{Item: item})
	case "promote":
		replyAllowed := emailProcessingReplyAllowed(conversation, messages)
		conversation, err = s.store.PromoteSystemConversation(r.Context(), conversation.ID, replyAllowed, "manual review confirmed customer email")
		if err != nil {
			writeError(w, err)
			return
		}
		s.broadcastConversationEvent(conversation, Event{Type: "conversation.reclassified", ShopID: conversation.ShopID, EntityID: conversation.ID, Payload: conversation, CreatedAt: time.Now().UTC()})
		writeJSONResponse(w, http.StatusOK, map[string]any{"conversation": conversation})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *Server) requireEmailProcessingPermission(w http.ResponseWriter, r *http.Request) (User, bool) {
	user, ok := s.requirePermission(w, r, PermissionEmailProcessingManage)
	if !ok {
		return User{}, false
	}
	return user, true
}

func (s *Server) emailProcessingPage(ctx context.Context, user User, r *http.Request) (emailProcessingPage, error) {
	query := r.URL.Query()
	filter := emailProcessingFilter{
		ShopID: strings.TrimSpace(query.Get("shopId")), SourceID: strings.TrimSpace(query.Get("sourceId")),
		Status: strings.TrimSpace(query.Get("status")), Category: strings.TrimSpace(query.Get("category")),
		Tag: strings.TrimSpace(query.Get("tag")), Search: strings.ToLower(strings.TrimSpace(query.Get("search"))),
		Page: positiveQueryInt(query.Get("page"), 1), PageSize: positiveQueryInt(query.Get("pageSize"), 30),
	}
	status := filter.Status
	if status != "" && status != ConversationStatusOpen && status != ConversationStatusClosed {
		return emailProcessingPage{}, fmt.Errorf("%w: unsupported email processing status", ErrInvalid)
	}
	category := filter.Category
	if category != "" && !isEmailProcessingCategory(category) {
		return emailProcessingPage{}, fmt.Errorf("%w: unsupported email processing category", ErrInvalid)
	}
	tagFilter := filter.Tag
	if filter.PageSize > 100 {
		filter.PageSize = 100
	}
	page := filter.Page
	pageSize := filter.PageSize
	shops, err := s.store.ListShops(ctx)
	if err != nil {
		return emailProcessingPage{}, err
	}
	shopsByID := make(map[string]Shop, len(shops))
	for _, shop := range shops {
		shopsByID[shop.ID] = shop
	}
	allowedShopIDs := map[string]bool{}
	restrictToAssignedShops := user.Role != UserRoleAdmin
	if restrictToAssignedShops {
		assignedShopIDs, assignedErr := s.store.ListUserShopIDs(ctx, user.ID)
		if assignedErr != nil {
			return emailProcessingPage{}, assignedErr
		}
		assigned := stringSet(assignedShopIDs)
		for _, shop := range shops {
			if shop.Status == ShopStatusActive && assigned[shop.ID] {
				allowedShopIDs[shop.ID] = true
			}
		}
	}
	sources, err := s.store.ListShopSources(ctx, "")
	if err != nil {
		return emailProcessingPage{}, err
	}
	sourcesByID := make(map[string]ShopSource, len(sources))
	for _, source := range sources {
		sourcesByID[source.ID] = source
	}
	if queryStore, ok := s.store.(emailProcessingQueryStore); ok {
		scopeUserID := ""
		if restrictToAssignedShops {
			scopeUserID = user.ID
		}
		rows, total, openCount, tagOptions, queryErr := queryStore.QueryEmailProcessing(ctx, filter, scopeUserID, user.ID)
		if queryErr != nil {
			return emailProcessingPage{}, queryErr
		}
		totalPages := (total + pageSize - 1) / pageSize
		if totalPages == 0 {
			totalPages = 1
		}
		if page > totalPages {
			page = totalPages
		}
		items := make([]emailProcessingItem, 0, len(rows))
		for _, row := range rows {
			body := cleanProviderEmailBody(stripQuotedEmailHistoryForSubject(row.LatestBody, row.Conversation.Subject))
			items = append(items, emailProcessingItem{
				Conversation: row.Conversation, ShopName: row.ShopName, SourceAddress: row.SourceAddress,
				Provider: strings.ToLower(strings.TrimSpace(row.Provider)), Category: row.Category,
				Preview:         truncateEmailPreview(strings.Join(strings.Fields(body), " "), 180),
				ShopifyOfficial: isShopifyOfficialEmail(row.Conversation.CustomerEmail), Tags: nonNilSlice(row.Tags),
			})
		}
		shopOptions, mailboxes := emailProcessingOptions(shops, sources, restrictToAssignedShops, allowedShopIDs)
		return emailProcessingPage{
			Items: items, Page: page, PageSize: pageSize, Total: total, TotalPages: totalPages, OpenCount: openCount,
			Shops: shopOptions, Mailboxes: mailboxes, TagOptions: nonNilSlice(tagOptions),
		}, nil
	}
	baseFilter := ConversationFilter{
		ShopID:       filter.ShopID,
		SourceID:     filter.SourceID,
		Kind:         ConversationKindSystem,
		UnreadUserID: user.ID,
	}
	search := filter.Search
	all, err := s.store.ListConversations(ctx, baseFilter)
	if err != nil {
		return emailProcessingPage{}, err
	}
	tagsByConversationID, err := s.store.ListConversationEmailTags(ctx)
	if err != nil {
		return emailProcessingPage{}, err
	}
	tagOptionsByLabel := map[string]EmailProcessingTag{}
	openCount := 0
	filtered := make([]Conversation, 0, len(all))
	for _, conversation := range all {
		source, sourceExists := sourcesByID[conversation.SourceID]
		if !sourceExists || source.Type != SourceTypeEmail {
			continue
		}
		if restrictToAssignedShops && !allowedShopIDs[conversation.ShopID] {
			continue
		}
		for _, tag := range tagsByConversationID[conversation.ID] {
			key := strings.ToLower(strings.TrimSpace(tag.Label))
			if key != "" {
				tagOptionsByLabel[key] = tag
			}
		}
		if search != "" && !emailProcessingMatchesSearch(conversation, shopsByID[conversation.ShopID], source, search) {
			continue
		}
		itemCategory := emailProcessingCategory(conversation, nil)
		isOpen := conversation.Status != ConversationStatusClosed
		if isOpen {
			openCount++
		}
		switch status {
		case ConversationStatusOpen:
			if !isOpen {
				continue
			}
		case ConversationStatusClosed:
			if isOpen {
				continue
			}
		}
		if category != "" && itemCategory != category {
			continue
		}
		if tagFilter != "" && !emailProcessingHasTag(tagsByConversationID[conversation.ID], tagFilter) {
			continue
		}
		filtered = append(filtered, conversation)
	}
	total := len(filtered)
	totalPages := (total + pageSize - 1) / pageSize
	if totalPages == 0 {
		totalPages = 1
	}
	if page > totalPages {
		page = totalPages
	}
	start := (page - 1) * pageSize
	end := start + pageSize
	if start > total {
		start = total
	}
	if end > total {
		end = total
	}
	items := make([]emailProcessingItem, 0, end-start)
	for _, conversation := range filtered[start:end] {
		messages, messageErr := s.store.ListMessages(ctx, conversation.ID)
		if messageErr != nil {
			return emailProcessingPage{}, messageErr
		}
		item, itemErr := s.emailProcessingItem(ctx, conversation, shopsByID, sourcesByID, messages, tagsByConversationID[conversation.ID])
		if itemErr != nil {
			return emailProcessingPage{}, itemErr
		}
		items = append(items, item)
	}
	shopOptions, mailboxes := emailProcessingOptions(shops, sources, restrictToAssignedShops, allowedShopIDs)
	tagOptions := make([]EmailProcessingTag, 0, len(tagOptionsByLabel))
	for _, tag := range tagOptionsByLabel {
		tagOptions = append(tagOptions, tag)
	}
	sort.Slice(tagOptions, func(i, j int) bool {
		return strings.ToLower(tagOptions[i].Label) < strings.ToLower(tagOptions[j].Label)
	})
	return emailProcessingPage{
		Items: items, Page: page, PageSize: pageSize, Total: total, TotalPages: totalPages,
		OpenCount: openCount,
		Shops:     shopOptions, Mailboxes: mailboxes, TagOptions: nonNilSlice(tagOptions),
	}, nil
}

func emailProcessingOptions(shops []Shop, sources []ShopSource, restricted bool, allowedShopIDs map[string]bool) ([]emailProcessingOption, []emailProcessingOption) {
	shopOptions := make([]emailProcessingOption, 0, len(shops))
	for _, shop := range shops {
		if restricted && !allowedShopIDs[shop.ID] {
			continue
		}
		shopOptions = append(shopOptions, emailProcessingOption{ID: shop.ID, Label: shop.DisplayName})
	}
	sort.Slice(shopOptions, func(i, j int) bool {
		return strings.ToLower(shopOptions[i].Label) < strings.ToLower(shopOptions[j].Label)
	})
	mailboxes := make([]emailProcessingOption, 0)
	for _, source := range sources {
		if source.Type != SourceTypeEmail || strings.TrimSpace(source.Metadata[emailDisconnectedAtKey]) != "" || (restricted && !allowedShopIDs[source.ShopID]) {
			continue
		}
		mailboxes = append(mailboxes, emailProcessingOption{ID: source.ID, Label: source.Address, ShopID: source.ShopID, Provider: source.Provider, Connected: true})
	}
	sort.Slice(mailboxes, func(i, j int) bool { return strings.ToLower(mailboxes[i].Label) < strings.ToLower(mailboxes[j].Label) })
	return shopOptions, mailboxes
}

func emailProcessingMatchesSearch(conversation Conversation, shop Shop, source ShopSource, search string) bool {
	search = strings.ToLower(strings.TrimSpace(search))
	if search == "" {
		return true
	}
	values := []string{
		conversation.CustomerName,
		conversation.CustomerEmail,
		conversation.Subject,
		shop.DisplayName,
		shop.ExternalID,
		source.Address,
		source.Provider,
	}
	return strings.Contains(strings.ToLower(strings.Join(values, "\n")), search)
}

func (s *Server) emailProcessingDetail(ctx context.Context, conversationID string, user User) (emailProcessingDetail, error) {
	conversation, err := s.emailProcessingConversation(ctx, conversationID, user)
	if err != nil {
		return emailProcessingDetail{}, err
	}
	messages, err := s.store.ListMessages(ctx, conversation.ID)
	if err != nil {
		return emailProcessingDetail{}, err
	}
	if len(messages) > 0 {
		readAt := messages[len(messages)-1].CreatedAt
		if readAt.IsZero() {
			readAt = time.Now().UTC()
		}
		if err := s.store.MarkConversationRead(ctx, user.ID, conversation.ID, readAt); err != nil {
			return emailProcessingDetail{}, err
		}
		conversation.Unread = false
	}
	tags, err := s.emailProcessingTagsForConversation(ctx, conversation.ID)
	if err != nil {
		return emailProcessingDetail{}, err
	}
	item, err := s.emailProcessingItem(ctx, conversation, nil, nil, messages, tags)
	if err != nil {
		return emailProcessingDetail{}, err
	}
	displayMessages := make([]Message, 0, len(messages))
	for _, message := range messages {
		message = cloneMessageForDisplay(message)
		message.Body = cleanProviderEmailBody(message.Body)
		displayMessages = append(displayMessages, message)
	}
	displayMessages = expandQuotedEmailMessagesForDisplay(displayMessages, conversation.Subject)
	return emailProcessingDetail{Item: item, Messages: nonNilSlice(displayMessages)}, nil
}

func (s *Server) emailProcessingConversation(ctx context.Context, conversationID string, user User) (Conversation, error) {
	conversation, err := s.store.GetConversation(ctx, strings.TrimSpace(conversationID))
	if err != nil {
		return Conversation{}, err
	}
	if normalizeConversationKind(conversation.Kind) != ConversationKindSystem {
		return Conversation{}, ErrNotFound
	}
	source, err := s.store.GetShopSource(ctx, conversation.ShopID, conversation.SourceID)
	if err != nil {
		return Conversation{}, err
	}
	if source.Type != SourceTypeEmail {
		return Conversation{}, ErrNotFound
	}
	if user.Role != UserRoleAdmin {
		allowed, accessErr := s.userCanAccessAssignedShop(ctx, user, conversation.ShopID)
		if accessErr != nil {
			return Conversation{}, accessErr
		}
		if !allowed {
			return Conversation{}, ErrForbidden
		}
	}
	return conversation, nil
}

func (s *Server) emailProcessingItem(ctx context.Context, conversation Conversation, shops map[string]Shop, sources map[string]ShopSource, messages []Message, tags []EmailProcessingTag) (emailProcessingItem, error) {
	shop, ok := shops[conversation.ShopID]
	if !ok {
		var err error
		shop, err = s.store.GetShop(ctx, conversation.ShopID)
		if err != nil {
			return emailProcessingItem{}, err
		}
	}
	source, ok := sources[conversation.SourceID]
	if !ok {
		var err error
		source, err = s.store.GetShopSource(ctx, conversation.ShopID, conversation.SourceID)
		if err != nil {
			return emailProcessingItem{}, err
		}
	}
	latestBody := ""
	if len(messages) > 0 {
		latestBody = cleanProviderEmailBody(stripQuotedEmailHistoryForSubject(messages[len(messages)-1].Body, conversation.Subject))
	}
	preview := strings.Join(strings.Fields(latestBody), " ")
	preview = truncateEmailPreview(preview, 180)
	category := emailProcessingCategory(conversation, messages)
	return emailProcessingItem{
		Conversation: conversation, ShopName: shop.DisplayName, SourceAddress: source.Address,
		Provider: strings.ToLower(strings.TrimSpace(source.Provider)), Category: category,
		Preview: preview, ShopifyOfficial: isShopifyOfficialEmail(conversation.CustomerEmail),
		Tags: nonNilSlice(append([]EmailProcessingTag(nil), tags...)),
	}, nil
}

func (s *Server) emailProcessingTagsForConversation(ctx context.Context, conversationID string) ([]EmailProcessingTag, error) {
	all, err := s.store.ListConversationEmailTags(ctx)
	if err != nil {
		return nil, err
	}
	return append([]EmailProcessingTag(nil), all[conversationID]...), nil
}

func isShopifyOfficialEmail(address string) bool {
	address = normalizeEmail(address)
	at := strings.LastIndex(address, "@")
	if at < 0 || at == len(address)-1 {
		return false
	}
	domain := address[at+1:]
	return domain == "shopify.com" || strings.HasSuffix(domain, ".shopify.com")
}

func emailProcessingHasTag(tags []EmailProcessingTag, label string) bool {
	label = strings.TrimSpace(label)
	for _, tag := range tags {
		if strings.EqualFold(strings.TrimSpace(tag.Label), label) {
			return true
		}
	}
	return false
}

func normalizeEmailProcessingTags(input []EmailProcessingTag) ([]EmailProcessingTag, error) {
	if len(input) > 5 {
		return nil, fmt.Errorf("%w: an email can have at most 5 tags", ErrInvalid)
	}
	allowedColors := map[string]bool{"red": true, "orange": true, "yellow": true, "green": true, "blue": true, "purple": true, "gray": true}
	out := make([]EmailProcessingTag, 0, len(input))
	indexes := map[string]int{}
	for _, tag := range input {
		label := strings.TrimSpace(tag.Label)
		color := strings.ToLower(strings.TrimSpace(tag.Color))
		if label == "" || len([]rune(label)) > 12 {
			return nil, fmt.Errorf("%w: tag label must contain 1 to 12 characters", ErrInvalid)
		}
		if !allowedColors[color] {
			return nil, fmt.Errorf("%w: unsupported tag color", ErrInvalid)
		}
		key := strings.ToLower(label)
		normalized := EmailProcessingTag{Label: label, Color: color}
		if index, ok := indexes[key]; ok {
			out[index] = normalized
			continue
		}
		indexes[key] = len(out)
		out = append(out, normalized)
	}
	return out, nil
}

func emailProcessingCategory(conversation Conversation, _ []Message) string {
	content := strings.TrimSpace(conversation.Classification + "\n" + conversation.Subject)
	if conversation.Classification == verificationSystemNotificationClassification || verificationSubjectPattern.MatchString(content) || verificationBodyPattern.MatchString(content) {
		return emailProcessingCategoryVerification
	}
	if conversation.Classification == pendingSystemNotificationClassification ||
		conversation.Classification == suspectedMarketingReviewClassification {
		return emailProcessingCategoryOther
	}
	if emailProcessingSecurityPattern.MatchString(content) {
		return emailProcessingCategorySecurity
	}
	if emailProcessingPaymentPattern.MatchString(content) {
		return emailProcessingCategoryPayment
	}
	if emailProcessingLogisticsPattern.MatchString(content) {
		return emailProcessingCategoryLogistics
	}
	if conversation.Classification == automatedSystemNotificationClassification {
		return emailProcessingCategoryPlatform
	}
	return emailProcessingCategoryOther
}

func isEmailProcessingCategory(value string) bool {
	switch value {
	case emailProcessingCategoryVerification, emailProcessingCategorySecurity, emailProcessingCategoryPayment,
		emailProcessingCategoryLogistics, emailProcessingCategoryPlatform, emailProcessingCategoryOther:
		return true
	default:
		return false
	}
}

func emailProcessingReplyAllowed(conversation Conversation, messages []Message) bool {
	for index := len(messages) - 1; index >= 0; index-- {
		message := messages[index]
		if incomingEmailReplyAllowed(message.Metadata["mail_reply_to_email"], message.SenderEmail, conversation.CustomerEmail) {
			return true
		}
	}
	return incomingEmailReplyAllowed(conversation.CustomerEmail)
}
