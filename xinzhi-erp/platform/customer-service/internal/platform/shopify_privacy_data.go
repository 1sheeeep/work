package platform

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	shopifyPrivacyContractVersion    = "customer_service.shopify_compliance.v1"
	shopifyPrivacyMaxRecords         = 50_000
	shopifyPrivacyMaxAttachmentBytes = 8 * 1024 * 1024
	shopifyPrivacyMaxReceipts        = 10_000

	shopifyPrivacyTopicCustomerDataRequest = "CUSTOMER_DATA_REQUEST"
	shopifyPrivacyTopicCustomerRedact      = "CUSTOMER_REDACT"
	shopifyPrivacyTopicShopRedact          = "SHOP_REDACT"
)

var (
	shopifyPrivacyEventIDPattern   = regexp.MustCompile(`^[A-Za-z0-9._:/-]{1,260}$`)
	shopifyPrivacyNumericIDPattern = regexp.MustCompile(`^(?:0|[1-9][0-9]{0,31})$`)
	shopifyPrivacyEmailHashPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
)

type ShopifyPrivacyRequest struct {
	EventID             string   `json:"eventId"`
	ShopID              string   `json:"shopId"`
	ShopDomain          string   `json:"shopDomain"`
	Topic               string   `json:"topic"`
	CustomerIDs         []string `json:"customerIds"`
	OrderIDs            []string `json:"orderIds"`
	CustomerEmailHashes []string `json:"customerEmailSha256"`
}

type ShopifyPrivacyAttachmentReference struct {
	StoredName   string `json:"-"`
	OriginalName string `json:"originalName"`
	MIMEType     string `json:"mimeType,omitempty"`
}

type ShopifyPrivacyAttachment struct {
	StoredName   string `json:"storedName"`
	OriginalName string `json:"originalName"`
	MIMEType     string `json:"mimeType,omitempty"`
	Size         int64  `json:"size"`
	SHA256       string `json:"sha256"`
	Content      []byte `json:"contentBase64"`
}

type ShopifyPrivacyData struct {
	Conversations         []Conversation                      `json:"conversations"`
	Messages              []Message                           `json:"messages"`
	ConversationEmailTags map[string][]EmailProcessingTag     `json:"conversationEmailTags"`
	TransferRequests      []TransferRequest                   `json:"transferRequests"`
	KnowledgeEntries      []KnowledgeEntry                    `json:"knowledgeEntries"`
	Tickets               []Ticket                            `json:"tickets"`
	TicketComments        []TicketComment                     `json:"ticketComments"`
	Attachments           []ShopifyPrivacyAttachmentReference `json:"-"`
}

type PrivacyRedactionReceipt struct {
	RequestFingerprint string    `json:"requestFingerprint"`
	RecordCount        int       `json:"recordCount"`
	AttachmentNames    []string  `json:"attachmentNames,omitempty"`
	FilesDeleted       bool      `json:"filesDeleted"`
	CompletedAt        time.Time `json:"completedAt,omitempty"`
}

type shopifyPrivacyDataStore interface {
	ExportShopifyPrivacy(context.Context, ShopifyPrivacyRequest) (ShopifyPrivacyData, error)
	RedactShopifyPrivacy(context.Context, ShopifyPrivacyRequest) (PrivacyRedactionReceipt, error)
	AcknowledgeShopifyPrivacyFilesDeleted(context.Context, string, string) (PrivacyRedactionReceipt, error)
}

type shopifyPrivacyExportResponse struct {
	ContractVersion string                     `json:"contractVersion"`
	EventID         string                     `json:"eventId"`
	RecordCount     int                        `json:"recordCount"`
	Data            shopifyPrivacyResponseData `json:"data"`
}

type shopifyPrivacyResponseData struct {
	Conversations         []Conversation                  `json:"conversations"`
	Messages              []Message                       `json:"messages"`
	ConversationEmailTags map[string][]EmailProcessingTag `json:"conversationEmailTags"`
	TransferRequests      []TransferRequest               `json:"transferRequests"`
	KnowledgeEntries      []KnowledgeEntry                `json:"knowledgeEntries"`
	Tickets               []Ticket                        `json:"tickets"`
	TicketComments        []TicketComment                 `json:"ticketComments"`
	Attachments           []ShopifyPrivacyAttachment      `json:"attachments"`
}

type shopifyPrivacyRedactResponse struct {
	ContractVersion    string `json:"contractVersion"`
	EventID            string `json:"eventId"`
	RecordCount        int    `json:"recordCount"`
	AttachmentsDeleted int    `json:"attachmentsDeleted"`
	AlreadyCompleted   bool   `json:"alreadyCompleted"`
}

func (s *Server) handleERPShopifyComplianceExport(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !s.requireERPConnectorToken(w, r) {
		return
	}
	var request ShopifyPrivacyRequest
	if !decodeERPConnectorRequest(w, r, &request) {
		return
	}
	normalized, err := normalizeShopifyPrivacyRequest(request)
	if err != nil {
		writeShopifyPrivacyError(w, http.StatusBadRequest, "CUSTOMER_SERVICE_COMPLIANCE_INVALID_REQUEST")
		return
	}
	if normalized.Topic != shopifyPrivacyTopicCustomerDataRequest {
		writeShopifyPrivacyError(w, http.StatusBadRequest, "CUSTOMER_SERVICE_COMPLIANCE_INVALID_TOPIC")
		return
	}
	store, ok := s.store.(shopifyPrivacyDataStore)
	if !ok {
		writeShopifyPrivacyError(w, http.StatusServiceUnavailable, "CUSTOMER_SERVICE_COMPLIANCE_UNAVAILABLE")
		return
	}
	data, err := store.ExportShopifyPrivacy(r.Context(), normalized)
	if err != nil {
		writeShopifyPrivacyStoreError(w, err)
		return
	}
	attachments, err := s.readShopifyPrivacyAttachments(data.Attachments)
	if err != nil {
		writeShopifyPrivacyError(w, http.StatusConflict, "CUSTOMER_SERVICE_COMPLIANCE_EXPORT_INCOMPLETE")
		return
	}
	recordCount := shopifyPrivacyDataRecordCount(data)
	writeJSONResponse(w, http.StatusOK, shopifyPrivacyExportResponse{
		ContractVersion: shopifyPrivacyContractVersion,
		EventID:         normalized.EventID,
		RecordCount:     recordCount,
		Data: shopifyPrivacyResponseData{
			Conversations:         data.Conversations,
			Messages:              data.Messages,
			ConversationEmailTags: data.ConversationEmailTags,
			TransferRequests:      data.TransferRequests,
			KnowledgeEntries:      data.KnowledgeEntries,
			Tickets:               data.Tickets,
			TicketComments:        data.TicketComments,
			Attachments:           attachments,
		},
	})
}

func (s *Server) handleERPShopifyComplianceRedact(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !s.requireERPConnectorToken(w, r) {
		return
	}
	var request ShopifyPrivacyRequest
	if !decodeERPConnectorRequest(w, r, &request) {
		return
	}
	normalized, err := normalizeShopifyPrivacyRequest(request)
	if err != nil || normalized.Topic == shopifyPrivacyTopicCustomerDataRequest {
		writeShopifyPrivacyError(w, http.StatusBadRequest, "CUSTOMER_SERVICE_COMPLIANCE_INVALID_REQUEST")
		return
	}
	store, ok := s.store.(shopifyPrivacyDataStore)
	if !ok {
		writeShopifyPrivacyError(w, http.StatusServiceUnavailable, "CUSTOMER_SERVICE_COMPLIANCE_UNAVAILABLE")
		return
	}
	receipt, err := store.RedactShopifyPrivacy(r.Context(), normalized)
	if err != nil {
		writeShopifyPrivacyStoreError(w, err)
		return
	}
	alreadyCompleted := receipt.FilesDeleted
	if !receipt.FilesDeleted {
		if err := s.deleteShopifyPrivacyAttachments(receipt.AttachmentNames); err != nil {
			writeShopifyPrivacyError(w, http.StatusConflict, "CUSTOMER_SERVICE_COMPLIANCE_ATTACHMENT_DELETE_FAILED")
			return
		}
		receipt, err = store.AcknowledgeShopifyPrivacyFilesDeleted(
			r.Context(), normalized.EventID, receipt.RequestFingerprint)
		if err != nil {
			writeShopifyPrivacyStoreError(w, err)
			return
		}
	}
	s.invalidateShopifyPrivacyRuntime(normalized.ShopID)
	writeJSONResponse(w, http.StatusOK, shopifyPrivacyRedactResponse{
		ContractVersion:    shopifyPrivacyContractVersion,
		EventID:            normalized.EventID,
		RecordCount:        receipt.RecordCount,
		AttachmentsDeleted: len(receipt.AttachmentNames),
		AlreadyCompleted:   alreadyCompleted,
	})
}

func writeShopifyPrivacyStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrInvalid):
		writeShopifyPrivacyError(w, http.StatusBadRequest, "CUSTOMER_SERVICE_COMPLIANCE_INVALID_REQUEST")
	case errors.Is(err, ErrNotFound):
		writeShopifyPrivacyError(w, http.StatusNotFound, "CUSTOMER_SERVICE_COMPLIANCE_SHOP_NOT_FOUND")
	case errors.Is(err, ErrConflict), errors.Is(err, ErrForbidden):
		writeShopifyPrivacyError(w, http.StatusConflict, "CUSTOMER_SERVICE_COMPLIANCE_CONFLICT")
	default:
		writeShopifyPrivacyError(w, http.StatusServiceUnavailable, "CUSTOMER_SERVICE_COMPLIANCE_UNAVAILABLE")
	}
}

func writeShopifyPrivacyError(w http.ResponseWriter, status int, code string) {
	writeJSONResponse(w, status, map[string]any{
		"code":      code,
		"error":     "Customer service compliance operation could not be completed",
		"retryable": status >= 409,
	})
}

func normalizeShopifyPrivacyRequest(input ShopifyPrivacyRequest) (ShopifyPrivacyRequest, error) {
	input.EventID = strings.TrimSpace(input.EventID)
	input.ShopID = strings.TrimSpace(input.ShopID)
	input.ShopDomain = normalizeShopifyDomain(input.ShopDomain)
	input.Topic = strings.ToUpper(strings.TrimSpace(input.Topic))
	if !shopifyPrivacyEventIDPattern.MatchString(input.EventID) || input.ShopID == "" || len(input.ShopID) > 160 || input.ShopDomain == "" {
		return ShopifyPrivacyRequest{}, ErrInvalid
	}
	switch input.Topic {
	case shopifyPrivacyTopicCustomerDataRequest, shopifyPrivacyTopicCustomerRedact, shopifyPrivacyTopicShopRedact:
	default:
		return ShopifyPrivacyRequest{}, ErrInvalid
	}
	var err error
	if input.CustomerIDs, err = normalizeShopifyPrivacyValues(input.CustomerIDs, shopifyPrivacyNumericIDPattern); err != nil {
		return ShopifyPrivacyRequest{}, err
	}
	if input.OrderIDs, err = normalizeShopifyPrivacyValues(input.OrderIDs, shopifyPrivacyNumericIDPattern); err != nil {
		return ShopifyPrivacyRequest{}, err
	}
	if input.CustomerEmailHashes, err = normalizeShopifyPrivacyValues(input.CustomerEmailHashes, shopifyPrivacyEmailHashPattern); err != nil {
		return ShopifyPrivacyRequest{}, err
	}
	if input.Topic != shopifyPrivacyTopicShopRedact && len(input.CustomerIDs)+len(input.OrderIDs)+len(input.CustomerEmailHashes) == 0 {
		return ShopifyPrivacyRequest{}, ErrInvalid
	}
	return input, nil
}

func normalizeShopifyPrivacyValues(values []string, pattern *regexp.Regexp) ([]string, error) {
	if len(values) > 250 {
		return nil, ErrInvalid
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.ToLower(strings.TrimSpace(value))
		if !pattern.MatchString(value) {
			return nil, ErrInvalid
		}
		if !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	sort.Strings(out)
	return out, nil
}

func shopifyPrivacyRequestFingerprint(input ShopifyPrivacyRequest) string {
	raw, _ := json.Marshal(input)
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:])
}

func (s *MemoryStore) ExportShopifyPrivacy(ctx context.Context, request ShopifyPrivacyRequest) (ShopifyPrivacyData, error) {
	if err := ctx.Err(); err != nil {
		return ShopifyPrivacyData{}, err
	}
	request, err := normalizeShopifyPrivacyRequest(request)
	if err != nil {
		return ShopifyPrivacyData{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if err := s.validateShopifyPrivacyShopLocked(request); err != nil {
		return ShopifyPrivacyData{}, err
	}
	data := s.collectShopifyPrivacyDataLocked(request)
	if shopifyPrivacyDataRecordCount(data) > shopifyPrivacyMaxRecords {
		return ShopifyPrivacyData{}, fmt.Errorf("%w: customer service privacy export is too large", ErrConflict)
	}
	return data, nil
}

func (s *MemoryStore) RedactShopifyPrivacy(ctx context.Context, request ShopifyPrivacyRequest) (PrivacyRedactionReceipt, error) {
	if err := ctx.Err(); err != nil {
		return PrivacyRedactionReceipt{}, err
	}
	request, err := normalizeShopifyPrivacyRequest(request)
	if err != nil || request.Topic == shopifyPrivacyTopicCustomerDataRequest {
		return PrivacyRedactionReceipt{}, ErrInvalid
	}
	fingerprint := shopifyPrivacyRequestFingerprint(request)
	s.mu.Lock()
	defer s.mu.Unlock()
	if receipt, exists := s.privacyRedactions[request.EventID]; exists {
		if receipt.RequestFingerprint != fingerprint {
			return PrivacyRedactionReceipt{}, fmt.Errorf("%w: privacy event identity changed", ErrConflict)
		}
		return cloneShopifyPrivacyRedactionReceipt(receipt), nil
	}
	if len(s.privacyRedactions) >= shopifyPrivacyMaxReceipts {
		return PrivacyRedactionReceipt{}, fmt.Errorf("%w: privacy receipt capacity reached", ErrConflict)
	}
	if err := s.validateShopifyPrivacyShopLocked(request); err != nil {
		return PrivacyRedactionReceipt{}, err
	}
	data := s.collectShopifyPrivacyDataLocked(request)
	if shopifyPrivacyDataRecordCount(data) > shopifyPrivacyMaxRecords {
		return PrivacyRedactionReceipt{}, fmt.Errorf("%w: customer service privacy redaction is too large", ErrConflict)
	}
	conversationIDs := make(map[string]bool, len(data.Conversations))
	for _, conversation := range data.Conversations {
		conversationIDs[conversation.ID] = true
		delete(s.conversations, conversation.ID)
		delete(s.messages, conversation.ID)
		delete(s.conversationEmailTags, conversation.ID)
	}
	for key := range s.conversationReads {
		for conversationID := range conversationIDs {
			if strings.HasSuffix(key, "\x00"+conversationID) {
				delete(s.conversationReads, key)
				break
			}
		}
	}
	for id, transfer := range s.transferRequests {
		if conversationIDs[transfer.ConversationID] {
			delete(s.transferRequests, id)
		}
	}
	for id, entry := range s.knowledge {
		if conversationIDs[entry.ConversationID] {
			delete(s.knowledge, id)
		}
	}
	for _, ticket := range data.Tickets {
		delete(s.tickets, ticket.ID)
		delete(s.ticketComments, ticket.ID)
	}
	if request.Topic == shopifyPrivacyTopicShopRedact {
		s.deleteShopifyPrivacyShopLocked(request.ShopID)
	}
	attachmentNames := make([]string, 0, len(data.Attachments))
	for _, attachment := range data.Attachments {
		attachmentNames = append(attachmentNames, attachment.StoredName)
	}
	sort.Strings(attachmentNames)
	recordCount := shopifyPrivacyDataRecordCount(data)
	if request.Topic == shopifyPrivacyTopicShopRedact {
		recordCount++
	}
	receipt := PrivacyRedactionReceipt{
		RequestFingerprint: fingerprint,
		RecordCount:        recordCount,
		AttachmentNames:    attachmentNames,
	}
	s.privacyRedactions[request.EventID] = receipt
	return cloneShopifyPrivacyRedactionReceipt(receipt), nil
}

func (s *MemoryStore) AcknowledgeShopifyPrivacyFilesDeleted(ctx context.Context, eventID string, fingerprint string) (PrivacyRedactionReceipt, error) {
	if err := ctx.Err(); err != nil {
		return PrivacyRedactionReceipt{}, err
	}
	eventID = strings.TrimSpace(eventID)
	fingerprint = strings.TrimSpace(fingerprint)
	s.mu.Lock()
	defer s.mu.Unlock()
	receipt, exists := s.privacyRedactions[eventID]
	if !exists {
		return PrivacyRedactionReceipt{}, ErrNotFound
	}
	if receipt.RequestFingerprint != fingerprint {
		return PrivacyRedactionReceipt{}, ErrConflict
	}
	if !receipt.FilesDeleted {
		receipt.FilesDeleted = true
		receipt.CompletedAt = time.Now().UTC()
		s.privacyRedactions[eventID] = receipt
	}
	return cloneShopifyPrivacyRedactionReceipt(receipt), nil
}

func (s *FileStore) RedactShopifyPrivacy(ctx context.Context, request ShopifyPrivacyRequest) (PrivacyRedactionReceipt, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (PrivacyRedactionReceipt, error) {
		return candidate.RedactShopifyPrivacy(ctx, request)
	})
}

func (s *FileStore) AcknowledgeShopifyPrivacyFilesDeleted(ctx context.Context, eventID string, fingerprint string) (PrivacyRedactionReceipt, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (PrivacyRedactionReceipt, error) {
		return candidate.AcknowledgeShopifyPrivacyFilesDeleted(ctx, eventID, fingerprint)
	})
}

func (s *MemoryStore) validateShopifyPrivacyShopLocked(request ShopifyPrivacyRequest) error {
	shop, exists := s.shops[request.ShopID]
	if !exists {
		return ErrNotFound
	}
	if normalizeShopifyDomain(firstNonEmpty(shop.ExternalID, shop.Metadata["shopifyDomain"])) != request.ShopDomain {
		return fmt.Errorf("%w: privacy request shop domain does not match", ErrForbidden)
	}
	return nil
}

func (s *MemoryStore) collectShopifyPrivacyDataLocked(request ShopifyPrivacyRequest) ShopifyPrivacyData {
	allShopData := request.Topic == shopifyPrivacyTopicShopRedact
	customerIDs := stringSet(request.CustomerIDs)
	orderIDs := stringSet(request.OrderIDs)
	emailHashes := stringSet(request.CustomerEmailHashes)
	conversationIDs := map[string]bool{}
	conversations := make([]Conversation, 0)
	messages := make([]Message, 0)
	attachments := map[string]ShopifyPrivacyAttachmentReference{}
	for _, conversation := range s.conversations {
		if conversation.ShopID != request.ShopID {
			continue
		}
		conversationMessages := s.messages[conversation.ID]
		matched := allShopData || shopifyPrivacyEmailMatches(conversation.CustomerEmail, emailHashes) || shopifyPrivacyOrderMatches(conversation.RecordOrderNumber, orderIDs)
		if !matched {
			for _, message := range conversationMessages {
				if customerIDs[strings.TrimSpace(message.Metadata[publicChatCustomerIDMetadataKey])] || shopifyPrivacyOrderMatches(message.Metadata["orderId"], orderIDs) {
					matched = true
					break
				}
			}
		}
		if !matched {
			continue
		}
		conversationIDs[conversation.ID] = true
		conversations = append(conversations, cloneShopifyPrivacyConversation(conversation))
		for _, message := range conversationMessages {
			message.Metadata = cloneStringMap(message.Metadata)
			messages = append(messages, message)
			if attachment, ok := shopifyPrivacyMessageAttachment(message); ok {
				attachments[attachment.StoredName] = attachment
			}
		}
	}
	ticketIDs := map[string]bool{}
	tickets := make([]Ticket, 0)
	for _, ticket := range s.tickets {
		if ticket.ShopID != request.ShopID {
			continue
		}
		matched := allShopData || conversationIDs[ticket.ConversationID] || shopifyPrivacyTicketCustomerMatches(ticket, customerIDs, emailHashes) || shopifyPrivacyOrderMatches(ticket.OrderNumber, orderIDs)
		if !matched {
			continue
		}
		ticketIDs[ticket.ID] = true
		ticket = cloneShopifyPrivacyTicket(ticket)
		tickets = append(tickets, ticket)
		for _, item := range ticket.Attachments {
			if attachment, ok := shopifyPrivacyLocalAttachment(item.URL, item.Name, ""); ok {
				attachments[attachment.StoredName] = attachment
			}
		}
	}
	for {
		added := false
		for _, ticket := range s.tickets {
			if ticket.ShopID == request.ShopID && ticketIDs[ticket.ParentTicketID] && !ticketIDs[ticket.ID] {
				ticketIDs[ticket.ID] = true
				ticket = cloneShopifyPrivacyTicket(ticket)
				tickets = append(tickets, ticket)
				for _, item := range ticket.Attachments {
					if attachment, ok := shopifyPrivacyLocalAttachment(item.URL, item.Name, ""); ok {
						attachments[attachment.StoredName] = attachment
					}
				}
				added = true
			}
		}
		if !added {
			break
		}
	}
	comments := make([]TicketComment, 0)
	for ticketID := range ticketIDs {
		comments = append(comments, s.ticketComments[ticketID]...)
	}
	emailTags := map[string][]EmailProcessingTag{}
	for conversationID := range conversationIDs {
		if tags := s.conversationEmailTags[conversationID]; len(tags) > 0 {
			emailTags[conversationID] = append([]EmailProcessingTag(nil), tags...)
		}
	}
	transfers := make([]TransferRequest, 0)
	for _, transfer := range s.transferRequests {
		if conversationIDs[transfer.ConversationID] {
			transfers = append(transfers, transfer)
		}
	}
	knowledge := make([]KnowledgeEntry, 0)
	for _, entry := range s.knowledge {
		if conversationIDs[entry.ConversationID] {
			entry.Tags = append([]string(nil), entry.Tags...)
			knowledge = append(knowledge, entry)
		}
	}
	attachmentList := make([]ShopifyPrivacyAttachmentReference, 0, len(attachments))
	for _, attachment := range attachments {
		attachmentList = append(attachmentList, attachment)
	}
	sort.Slice(conversations, func(i, j int) bool { return conversations[i].ID < conversations[j].ID })
	sort.Slice(messages, func(i, j int) bool { return messages[i].ID < messages[j].ID })
	sort.Slice(tickets, func(i, j int) bool { return tickets[i].ID < tickets[j].ID })
	sort.Slice(comments, func(i, j int) bool { return comments[i].ID < comments[j].ID })
	sort.Slice(transfers, func(i, j int) bool { return transfers[i].ID < transfers[j].ID })
	sort.Slice(knowledge, func(i, j int) bool { return knowledge[i].ID < knowledge[j].ID })
	sort.Slice(attachmentList, func(i, j int) bool { return attachmentList[i].StoredName < attachmentList[j].StoredName })
	return ShopifyPrivacyData{
		Conversations: conversations, Messages: messages,
		ConversationEmailTags: emailTags, TransferRequests: transfers,
		KnowledgeEntries: knowledge, Tickets: tickets,
		TicketComments: comments, Attachments: attachmentList,
	}
}

func (s *MemoryStore) deleteShopifyPrivacyShopLocked(shopID string) {
	delete(s.shops, shopID)
	delete(s.visitorSchemeShops, shopID)
	delete(s.shopifyAppProfiles, shopID)
	for key, assignment := range s.shopAgents {
		if assignment.ShopID == shopID {
			delete(s.shopAgents, key)
		}
	}
	for key, source := range s.sources {
		if source.ShopID == shopID {
			delete(s.sources, key)
		}
	}
	for key, installation := range s.installations {
		if installation.ShopID == shopID {
			delete(s.installations, key)
		}
	}
	for key, installation := range s.emailInstalls {
		if installation.ShopID == shopID {
			delete(s.emailInstalls, key)
		}
	}
	for key, job := range s.emailHistoryImports {
		if job.ShopID == shopID {
			delete(s.emailHistoryImports, key)
		}
	}
	for id, ticket := range s.tickets {
		if ticket.ShopID == shopID {
			delete(s.tickets, id)
			delete(s.ticketComments, id)
		}
	}
}

func (s *Server) readShopifyPrivacyAttachments(references []ShopifyPrivacyAttachmentReference) ([]ShopifyPrivacyAttachment, error) {
	attachments := make([]ShopifyPrivacyAttachment, 0, len(references))
	total := int64(0)
	for _, reference := range references {
		path, ok := s.shopifyPrivacyAttachmentPath(reference.StoredName)
		if !ok {
			return nil, ErrInvalid
		}
		info, err := os.Stat(path)
		if err != nil || info.IsDir() || info.Size() < 0 {
			return nil, ErrConflict
		}
		total += info.Size()
		if total > shopifyPrivacyMaxAttachmentBytes {
			return nil, ErrConflict
		}
		raw, err := os.ReadFile(path)
		if err != nil || int64(len(raw)) != info.Size() {
			return nil, ErrConflict
		}
		digest := sha256.Sum256(raw)
		attachments = append(attachments, ShopifyPrivacyAttachment{
			StoredName:   reference.StoredName,
			OriginalName: reference.OriginalName,
			MIMEType:     reference.MIMEType,
			Size:         int64(len(raw)),
			SHA256:       hex.EncodeToString(digest[:]),
			Content:      raw,
		})
	}
	return attachments, nil
}

func (s *Server) deleteShopifyPrivacyAttachments(names []string) error {
	for _, name := range names {
		path, ok := s.shopifyPrivacyAttachmentPath(name)
		if !ok {
			return ErrInvalid
		}
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return nil
}

func (s *Server) shopifyPrivacyAttachmentPath(name string) (string, bool) {
	name = strings.TrimSpace(name)
	if name == "" || name != filepath.Base(name) || !strings.HasPrefix(name, "att_") {
		return "", false
	}
	if _, ok := storedChatAttachmentSpec(name); !ok {
		return "", false
	}
	root := filepath.Clean(s.uploadDir)
	path := filepath.Join(root, name)
	relative, err := filepath.Rel(root, path)
	if err != nil || relative == "." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
		return "", false
	}
	return path, true
}

func (s *Server) invalidateShopifyPrivacyRuntime(shopID string) {
	s.orderSyncMu.Lock()
	delete(s.orderSyncSnapshots, shopID)
	s.orderSyncMu.Unlock()
	s.monitorCacheMu.Lock()
	s.monitorCache = map[string]cachedMonitorOverview{}
	s.monitorCacheMu.Unlock()
	s.invalidateExternalCacheNamespace(context.Background(), shopifyOrderCacheNamespace, shopID)
	s.invalidateExternalCacheNamespace(context.Background(), shopifyCustomerCacheNamespace, shopID)
}

func shopifyPrivacyDataRecordCount(data ShopifyPrivacyData) int {
	return len(data.Conversations) + len(data.Messages) +
		len(data.ConversationEmailTags) + len(data.TransferRequests) +
		len(data.KnowledgeEntries) + len(data.Tickets) +
		len(data.TicketComments) + len(data.Attachments)
}

func shopifyPrivacyMessageAttachment(message Message) (ShopifyPrivacyAttachmentReference, bool) {
	if message.Type != MessageTypeImage && message.Type != MessageTypeFile {
		return ShopifyPrivacyAttachmentReference{}, false
	}
	return shopifyPrivacyLocalAttachment(message.Metadata["url"], message.Metadata["fileName"], message.Metadata["mimeType"])
}

func shopifyPrivacyLocalAttachment(rawURL string, originalName string, mimeType string) (ShopifyPrivacyAttachmentReference, bool) {
	const prefix = "/api/v1/chat/attachments/"
	rawURL = strings.TrimSpace(rawURL)
	if !strings.HasPrefix(rawURL, prefix) {
		return ShopifyPrivacyAttachmentReference{}, false
	}
	name := strings.TrimSpace(strings.SplitN(strings.TrimPrefix(rawURL, prefix), "?", 2)[0])
	if name == "" || name != filepath.Base(name) || !strings.HasPrefix(name, "att_") {
		return ShopifyPrivacyAttachmentReference{}, false
	}
	if _, ok := storedChatAttachmentSpec(name); !ok {
		return ShopifyPrivacyAttachmentReference{}, false
	}
	originalName = filepath.Base(strings.TrimSpace(originalName))
	if originalName == "." || originalName == "" {
		originalName = name
	}
	return ShopifyPrivacyAttachmentReference{StoredName: name, OriginalName: originalName, MIMEType: strings.TrimSpace(mimeType)}, true
}

func shopifyPrivacyTicketCustomerMatches(ticket Ticket, customerIDs map[string]bool, emailHashes map[string]bool) bool {
	ref := strings.ToLower(strings.TrimSpace(ticket.CustomerRef))
	for _, prefix := range []string{"shopify:", "shopify-customer:"} {
		if strings.HasPrefix(ref, prefix) && customerIDs[strings.TrimPrefix(ref, prefix)] {
			return true
		}
	}
	if strings.HasPrefix(ref, "email:") && shopifyPrivacyEmailMatches(strings.TrimPrefix(ref, "email:"), emailHashes) {
		return true
	}
	return shopifyPrivacyEmailMatches(ticket.CustomerEmail, emailHashes)
}

func shopifyPrivacyEmailMatches(email string, hashes map[string]bool) bool {
	email = normalizeEmail(email)
	if email == "" || len(hashes) == 0 {
		return false
	}
	digest := sha256.Sum256([]byte(email))
	return hashes[hex.EncodeToString(digest[:])]
}

func shopifyPrivacyOrderMatches(value string, orderIDs map[string]bool) bool {
	value = strings.TrimSpace(value)
	if value == "" || len(orderIDs) == 0 {
		return false
	}
	value = strings.TrimPrefix(value, "#")
	value = strings.TrimPrefix(value, "gid://shopify/Order/")
	return orderIDs[value]
}

func cloneShopifyPrivacyConversation(input Conversation) Conversation {
	return input
}

func cloneShopifyPrivacyTicket(input Ticket) Ticket {
	input.CollaboratorIDs = append([]string(nil), input.CollaboratorIDs...)
	input.Attachments = append([]TicketAttachment(nil), input.Attachments...)
	return input
}

func cloneShopifyPrivacyRedactionReceipt(input PrivacyRedactionReceipt) PrivacyRedactionReceipt {
	input.AttachmentNames = append([]string(nil), input.AttachmentNames...)
	return input
}

func cloneShopifyPrivacyRedactionReceipts(input map[string]PrivacyRedactionReceipt) map[string]PrivacyRedactionReceipt {
	out := make(map[string]PrivacyRedactionReceipt, len(input))
	for key, value := range input {
		out[key] = cloneShopifyPrivacyRedactionReceipt(value)
	}
	return out
}

var _ shopifyPrivacyDataStore = (*MemoryStore)(nil)
var _ shopifyPrivacyDataStore = (*FileStore)(nil)
