package platform

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"sync"
	"time"

	"shopify-support-platform/internal/records"
)

var (
	ErrNotFound    = errors.New("not found")
	ErrInvalid     = errors.New("invalid input")
	ErrConflict    = errors.New("conflict")
	ErrForbidden   = errors.New("forbidden")
	ErrShopNeeded  = errors.New("shop is required")
	ErrRateLimited = errors.New("rate limited")
)

type Store interface {
	CreateUser(ctx context.Context, input User) (User, error)
	ListUsers(ctx context.Context) ([]User, error)
	GetUser(ctx context.Context, id string) (User, error)
	FindUserByEmail(ctx context.Context, email string) (User, error)
	UpdateUser(ctx context.Context, id string, input User) (User, error)
	SetUserReceptionOnline(ctx context.Context, id string, online bool) (User, error)
	DeleteUser(ctx context.Context, id string) error
	CountUsers(ctx context.Context) (int, error)
	CreateAccountAuditLog(ctx context.Context, input AccountAuditLog) (AccountAuditLog, error)
	ListAccountAuditLogs(ctx context.Context, targetUserID string, limit int) ([]AccountAuditLog, error)
	CreateSession(ctx context.Context, input Session) (Session, error)
	GetSessionByTokenHash(ctx context.Context, tokenHash string) (Session, User, error)
	DeleteSession(ctx context.Context, tokenHash string) error
	AssignUserToShop(ctx context.Context, shopID string, userID string) (ShopAgent, error)
	UnassignUserFromShop(ctx context.Context, shopID string, userID string) error
	ListShopUsers(ctx context.Context, shopID string) ([]User, error)
	ListUserShopIDs(ctx context.Context, userID string) ([]string, error)
	ListShopAssignments(ctx context.Context) ([]ShopAgent, error)
	CreateShop(ctx context.Context, input Shop) (Shop, error)
	ListShops(ctx context.Context) ([]Shop, error)
	GetShop(ctx context.Context, id string) (Shop, error)
	UpdateShop(ctx context.Context, id string, input Shop) (Shop, error)
	DeleteShop(ctx context.Context, id string) error
	CreateShopSource(ctx context.Context, input ShopSource) (ShopSource, error)
	ListShopSources(ctx context.Context, shopID string) ([]ShopSource, error)
	GetShopSource(ctx context.Context, shopID string, sourceID string) (ShopSource, error)
	SetShopSourceStatus(ctx context.Context, shopID string, sourceID string, status string) (ShopSource, error)
	UpdateShopSource(ctx context.Context, shopID string, sourceID string, input ShopSource) (ShopSource, error)
	MutateShopSourceMetadata(ctx context.Context, shopID string, sourceID string, mutate func(map[string]string) map[string]string) (ShopSource, error)
	DisconnectEmailSource(ctx context.Context, shopID string, sourceID string) (ShopSource, error)
	ListVisitorSchemes(ctx context.Context) ([]VisitorScheme, error)
	GetVisitorScheme(ctx context.Context, id string) (VisitorScheme, error)
	CreateVisitorScheme(ctx context.Context, input VisitorScheme) (VisitorScheme, error)
	UpdateVisitorScheme(ctx context.Context, id string, input VisitorScheme) (VisitorScheme, error)
	ApplyVisitorScheme(ctx context.Context, id string, shopIDs []string) (VisitorScheme, error)
	DeleteVisitorScheme(ctx context.Context, id string) error
	SaveShopifyInstallation(ctx context.Context, input ShopifyInstallation) (ShopifyInstallation, error)
	GetShopifyInstallationByDomain(ctx context.Context, shopDomain string) (ShopifyInstallation, error)
	DeleteShopifyInstallationByDomain(ctx context.Context, shopDomain string) error
	SaveShopifyAppProfile(ctx context.Context, input ShopifyAppProfile) (ShopifyAppProfile, error)
	GetShopifyAppProfile(ctx context.Context, shopID string) (ShopifyAppProfile, error)
	GetShopifyAppProfileByDomain(ctx context.Context, shopDomain string) (ShopifyAppProfile, error)
	DeleteShopifyAppProfile(ctx context.Context, shopID string) error
	SaveEmailInstallation(ctx context.Context, input EmailInstallation) (EmailInstallation, error)
	GetEmailInstallation(ctx context.Context, shopID string, mailbox string) (EmailInstallation, error)
	SaveEmailHistoryImportJob(ctx context.Context, input EmailHistoryImportJob) (EmailHistoryImportJob, error)
	GetEmailHistoryImportJob(ctx context.Context, shopID string, sourceID string) (EmailHistoryImportJob, error)
	ListEmailHistoryImportJobs(ctx context.Context, shopID string) ([]EmailHistoryImportJob, error)
	CreateConversation(ctx context.Context, input Conversation) (Conversation, error)
	GetConversation(ctx context.Context, id string) (Conversation, error)
	ListConversations(ctx context.Context, filter ConversationFilter) ([]Conversation, error)
	CountConversations(ctx context.Context, filter ConversationFilter) (int, error)
	UpdateConversation(ctx context.Context, id string, input ConversationUpdate) (Conversation, error)
	PromoteSystemConversation(ctx context.Context, id string, replyAllowed bool, classification string) (Conversation, error)
	ListConversationEmailTags(ctx context.Context) (map[string][]EmailProcessingTag, error)
	ReplaceConversationEmailTags(ctx context.Context, conversationID string, tags []EmailProcessingTag, updatedBy string) ([]EmailProcessingTag, error)
	ClaimConversation(ctx context.Context, id string, userID string) (Conversation, error)
	CloseConversation(ctx context.Context, id string, userID string) (Conversation, error)
	CloseInactiveCustomerConversations(ctx context.Context, before time.Time) ([]Conversation, error)
	ReopenConversation(ctx context.Context, id string, userID string) (Conversation, error)
	TransferConversation(ctx context.Context, id string, fromAgentID string, targetAgentID string) (Conversation, error)
	CreateTransferRequest(ctx context.Context, input TransferRequest) (TransferRequest, error)
	GetTransferRequest(ctx context.Context, id string) (TransferRequest, error)
	ListTransferRequests(ctx context.Context, userID string, conversationID string, status string) ([]TransferRequest, error)
	ResolveTransferRequest(ctx context.Context, id string, status string, resolvedBy string) (TransferRequest, error)
	AddMessage(ctx context.Context, input Message) (Message, Conversation, error)
	AddAgentMessage(ctx context.Context, input Message, userID string) (Message, Conversation, error)
	ListMessages(ctx context.Context, conversationID string) ([]Message, error)
	GetMessage(ctx context.Context, conversationID string, messageID string) (Message, error)
	ListMessagePage(ctx context.Context, conversationID string, beforeMessageID string, limit int) ([]Message, error)
	ListMessageRange(ctx context.Context, conversationID string, afterMessageID string, throughMessageID string) ([]Message, error)
	ListResponseSamples(ctx context.Context) ([]ResponseSample, error)
	UpdateMessageMetadata(ctx context.Context, conversationID string, messageID string, patch map[string]string) (Message, error)
	ListUnreadConversationIDs(ctx context.Context, userID string) ([]string, error)
	MarkConversationRead(ctx context.Context, userID string, conversationID string, readAt time.Time) error
	CreateKnowledge(ctx context.Context, input KnowledgeEntry) (KnowledgeEntry, error)
	ListKnowledge(ctx context.Context, filter KnowledgeFilter) ([]KnowledgeEntry, error)
	CountKnowledge(ctx context.Context, filter KnowledgeFilter) (int, error)
	GetKnowledge(ctx context.Context, id string) (KnowledgeEntry, error)
	UpdateKnowledge(ctx context.Context, id string, input KnowledgeUpdate) (KnowledgeEntry, error)
	ApplyKnowledgeRevision(ctx context.Context, revisionID string, reviewedBy string, reviewNote string) (KnowledgeEntry, error)
	DeleteKnowledge(ctx context.Context, id string) error
	GetAISettings(ctx context.Context) (AISettings, error)
	SaveAISettings(ctx context.Context, input AISettings) (AISettings, error)
	GetLogisticsSettings(ctx context.Context) (LogisticsSettings, error)
	SaveLogisticsSettings(ctx context.Context, input LogisticsSettings) (LogisticsSettings, error)
	ListCuiqiuDomainSettings(ctx context.Context) ([]CuiqiuDomainSettings, error)
	GetCuiqiuDomainSettings(ctx context.Context, domain string) (CuiqiuDomainSettings, error)
	SaveCuiqiuDomainSettings(ctx context.Context, input CuiqiuDomainSettings) (CuiqiuDomainSettings, error)
	MarkCuiqiuDomainWebhookVerified(ctx context.Context, domain string, verifiedAt time.Time) error
	GetMonitorWorkSchedule(ctx context.Context) (MonitorWorkSchedule, error)
	ListMonitorWorkScheduleVersions(ctx context.Context) ([]MonitorWorkSchedule, error)
	SaveMonitorWorkSchedule(ctx context.Context, input MonitorWorkSchedule) (MonitorWorkSchedule, error)
	GetSLASettings(ctx context.Context) (SLASettings, error)
	SaveSLASettings(ctx context.Context, input SLASettings) (SLASettings, error)
	GetRecordCategories(ctx context.Context) ([]RecordCategoryOption, error)
	SaveRecordCategories(ctx context.Context, input []RecordCategoryOption) ([]RecordCategoryOption, error)
	CreateTicket(ctx context.Context, input Ticket) (Ticket, error)
	GetTicket(ctx context.Context, id string) (Ticket, error)
	ListTickets(ctx context.Context, filter TicketFilter) ([]Ticket, error)
	GetTicketSummary(ctx context.Context, filter TicketFilter) (TicketSummary, error)
	UpdateTicket(ctx context.Context, id string, input TicketUpdate) (Ticket, error)
	AcceptTicket(ctx context.Context, id string, userID string) (Ticket, *Conversation, error)
	AddTicketComment(ctx context.Context, input TicketComment) (TicketComment, error)
	ListTicketComments(ctx context.Context, ticketID string) ([]TicketComment, error)
	ListActiveSessionUserIDs(ctx context.Context, now time.Time) ([]string, error)
}

type ERPTenantBoundStore interface {
	Store
	BindERPTenant(ctx context.Context, tenantID string) error
	GetERPTenantBinding(ctx context.Context) (string, error)
}

type ConversationFilter struct {
	ShopID              string
	SourceID            string
	Status              string
	Kind                string
	AssignedAgentID     string
	WorkbenchUserID     string
	WorkbenchSkillGroup string
	WorkbenchShopUserID string
	UnreadUserID        string
	Search              string
	ServiceLineOnly     bool
	ActiveOnly          bool
	ActiveShopsOnly     bool
	ActiveSourcesOnly   bool
	Page                int
	PageSize            int
}

type HealthStatus struct {
	Name  string `json:"name"`
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

func (s HealthStatus) Err() error {
	if s.OK {
		return nil
	}
	if s.Error == "" {
		return errors.New("health check failed")
	}
	return errors.New(s.Error)
}

type HealthChecker interface {
	Health(ctx context.Context) HealthStatus
}

type MemoryStore struct {
	mu                    sync.RWMutex
	next                  int64
	erpTenantID           string
	shops                 map[string]Shop
	users                 map[string]User
	sessions              map[string]Session
	shopAgents            map[string]ShopAgent
	sources               map[string]ShopSource
	visitorSchemes        map[string]VisitorScheme
	visitorSchemeShops    map[string]string
	installations         map[string]ShopifyInstallation
	shopifyAppProfiles    map[string]ShopifyAppProfile
	emailInstalls         map[string]EmailInstallation
	emailHistoryImports   map[string]EmailHistoryImportJob
	emailSyncJobs         map[string]EmailSyncJob
	emailAttachmentJobs   map[string]EmailAttachmentJob
	shopifyOrderSyncJobs  map[string]ShopifyOrderSyncJob
	shopifyWebhookIDs     map[string]time.Time
	emailIngressWindows   map[string]emailIngressRateWindow
	emailQuarantine       map[string]EmailQuarantineRecord
	emailOutbox           map[string]EmailOutboxRecord
	emailExportJobs       map[string]EmailExportJob
	emailRuntimeEvents    []EmailRuntimeEvent
	conversations         map[string]Conversation
	messages              map[string][]Message
	conversationEmailTags map[string][]EmailProcessingTag
	conversationReads     map[string]time.Time
	knowledge             map[string]KnowledgeEntry
	aiSettings            AISettings
	hasAISettings         bool
	logisticsSettings     LogisticsSettings
	hasLogisticsSettings  bool
	cuiqiuDomainSettings  map[string]CuiqiuDomainSettings
	monitorWorkSchedules  []MonitorWorkSchedule
	slaSettings           SLASettings
	hasSLASettings        bool
	recordCategories      []RecordCategoryOption
	transferRequests      map[string]TransferRequest
	tickets               map[string]Ticket
	ticketComments        map[string][]TicketComment
	accountAuditLogs      []AccountAuditLog
	privacyRedactions     map[string]PrivacyRedactionReceipt
}

func (s *MemoryStore) BindERPTenant(ctx context.Context, tenantID string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	tenantID = strings.TrimSpace(tenantID)
	if tenantID == "" {
		return fmt.Errorf("%w: ERP tenant ID is required", ErrInvalid)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.erpTenantID != "" {
		if s.erpTenantID != tenantID {
			return fmt.Errorf("%w: customer service store is bound to another ERP tenant", ErrForbidden)
		}
		return nil
	}
	if s.hasTenantDataLocked() {
		return fmt.Errorf("%w: non-empty customer service store must be explicitly migrated before ERP binding", ErrConflict)
	}
	s.erpTenantID = tenantID
	return nil
}

func (s *MemoryStore) GetERPTenantBinding(ctx context.Context) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.erpTenantID == "" {
		return "", ErrNotFound
	}
	return s.erpTenantID, nil
}

func (s *MemoryStore) hasTenantDataLocked() bool {
	return len(s.shops) > 0 ||
		len(s.users) > 0 ||
		len(s.sessions) > 0 ||
		len(s.shopAgents) > 0 ||
		len(s.sources) > 0 ||
		len(s.installations) > 0 ||
		len(s.shopifyAppProfiles) > 0 ||
		len(s.emailInstalls) > 0 ||
		len(s.emailHistoryImports) > 0 ||
		len(s.conversations) > 0 ||
		len(s.messages) > 0 ||
		len(s.conversationEmailTags) > 0 ||
		len(s.knowledge) > 0 ||
		len(s.cuiqiuDomainSettings) > 0 ||
		len(s.transferRequests) > 0 ||
		len(s.tickets) > 0 ||
		len(s.privacyRedactions) > 0 ||
		len(s.accountAuditLogs) > 0 ||
		s.hasAISettings ||
		s.hasLogisticsSettings ||
		len(s.monitorWorkSchedules) > 0 ||
		s.hasSLASettings ||
		s.hasCustomVisitorConfigurationLocked() ||
		!reflect.DeepEqual(s.recordCategories, records.DefaultCategories())
}

func (s *MemoryStore) hasCustomVisitorConfigurationLocked() bool {
	if len(s.visitorSchemeShops) > 0 || len(s.visitorSchemes) != 1 {
		return true
	}
	scheme, ok := s.visitorSchemes[defaultVisitorSchemeID]
	if !ok {
		return true
	}
	defaultScheme := defaultVisitorScheme()
	return scheme.Name != defaultScheme.Name ||
		scheme.Language != defaultScheme.Language ||
		scheme.InstantAnswersEnabled != defaultScheme.InstantAnswersEnabled ||
		!reflect.DeepEqual(scheme.InstantAnswers, defaultScheme.InstantAnswers) ||
		!scheme.IsDefault
}

func (s *MemoryStore) GetAISettings(ctx context.Context) (AISettings, error) {
	if err := ctx.Err(); err != nil {
		return AISettings{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if !s.hasAISettings {
		return AISettings{}, ErrNotFound
	}
	settings := s.aiSettings
	settings.Models = append([]string(nil), settings.Models...)
	return settings, nil
}

func (s *MemoryStore) SaveAISettings(ctx context.Context, input AISettings) (AISettings, error) {
	if err := ctx.Err(); err != nil {
		return AISettings{}, err
	}
	input.BaseURL = strings.TrimSpace(input.BaseURL)
	input.Model = strings.TrimSpace(input.Model)
	input.Models = normalizeAIModels(input.Models, input.Model)
	if input.BaseURL == "" || input.Model == "" {
		return AISettings{}, fmt.Errorf("%w: AI baseUrl and model are required", ErrInvalid)
	}
	input.UpdatedAt = time.Now().UTC()
	s.mu.Lock()
	s.aiSettings = input
	s.hasAISettings = true
	s.mu.Unlock()
	return input, nil
}

func (s *MemoryStore) GetLogisticsSettings(ctx context.Context) (LogisticsSettings, error) {
	if err := ctx.Err(); err != nil {
		return LogisticsSettings{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if !s.hasLogisticsSettings {
		return LogisticsSettings{}, ErrNotFound
	}
	return s.logisticsSettings, nil
}

func (s *MemoryStore) SaveLogisticsSettings(ctx context.Context, input LogisticsSettings) (LogisticsSettings, error) {
	if err := ctx.Err(); err != nil {
		return LogisticsSettings{}, err
	}
	input.BaseURL = strings.TrimSpace(input.BaseURL)
	if input.BaseURL == "" {
		return LogisticsSettings{}, fmt.Errorf("%w: logistics base URL is required", ErrInvalid)
	}
	input.ReplyCooldownHours = normalizeLogisticsReplyCooldown(input.ReplyCooldownHours)
	input.UpdatedAt = time.Now().UTC()
	s.mu.Lock()
	s.logisticsSettings = input
	s.hasLogisticsSettings = true
	s.mu.Unlock()
	return input, nil
}

func (s *MemoryStore) ListCuiqiuDomainSettings(ctx context.Context) ([]CuiqiuDomainSettings, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]CuiqiuDomainSettings, 0, len(s.cuiqiuDomainSettings))
	for _, settings := range s.cuiqiuDomainSettings {
		out = append(out, settings)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Domain < out[j].Domain })
	return out, nil
}

func (s *MemoryStore) GetCuiqiuDomainSettings(ctx context.Context, domain string) (CuiqiuDomainSettings, error) {
	if err := ctx.Err(); err != nil {
		return CuiqiuDomainSettings{}, err
	}
	domain = normalizeEmailDomain(domain)
	s.mu.RLock()
	defer s.mu.RUnlock()
	settings, ok := s.cuiqiuDomainSettings[domain]
	if !ok {
		return CuiqiuDomainSettings{}, ErrNotFound
	}
	return settings, nil
}

func (s *MemoryStore) SaveCuiqiuDomainSettings(ctx context.Context, input CuiqiuDomainSettings) (CuiqiuDomainSettings, error) {
	if err := ctx.Err(); err != nil {
		return CuiqiuDomainSettings{}, err
	}
	normalized, err := normalizeCuiqiuDomainSettingsRecord(input)
	if err != nil {
		return CuiqiuDomainSettings{}, err
	}
	normalized.UpdatedAt = time.Now().UTC()
	s.mu.Lock()
	s.cuiqiuDomainSettings[normalized.Domain] = normalized
	s.mu.Unlock()
	return normalized, nil
}

func (s *MemoryStore) MarkCuiqiuDomainWebhookVerified(ctx context.Context, domain string, verifiedAt time.Time) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	domain = normalizeEmailDomain(domain)
	s.mu.Lock()
	defer s.mu.Unlock()
	settings, ok := s.cuiqiuDomainSettings[domain]
	if !ok {
		return ErrNotFound
	}
	settings.WebhookVerifiedAt = verifiedAt.UTC()
	s.cuiqiuDomainSettings[domain] = settings
	return nil
}

func (s *MemoryStore) GetMonitorWorkSchedule(ctx context.Context) (MonitorWorkSchedule, error) {
	if err := ctx.Err(); err != nil {
		return MonitorWorkSchedule{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if len(s.monitorWorkSchedules) == 0 {
		return MonitorWorkSchedule{}, ErrNotFound
	}
	out := s.monitorWorkSchedules[len(s.monitorWorkSchedules)-1]
	out.Weekdays = append([]int(nil), out.Weekdays...)
	return out, nil
}

func (s *MemoryStore) ListMonitorWorkScheduleVersions(ctx context.Context) ([]MonitorWorkSchedule, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]MonitorWorkSchedule, len(s.monitorWorkSchedules))
	for index, item := range s.monitorWorkSchedules {
		out[index] = item
		out[index].Weekdays = append([]int(nil), item.Weekdays...)
	}
	return out, nil
}

func (s *MemoryStore) SaveMonitorWorkSchedule(ctx context.Context, input MonitorWorkSchedule) (MonitorWorkSchedule, error) {
	if err := ctx.Err(); err != nil {
		return MonitorWorkSchedule{}, err
	}
	input, err := normalizeMonitorWorkSchedule(input)
	if err != nil {
		return MonitorWorkSchedule{}, err
	}
	now := time.Now().UTC()
	input.UpdatedAt = now
	input.EffectiveFrom = now
	s.mu.Lock()
	defer s.mu.Unlock()
	hasEnabled := false
	for _, item := range s.monitorWorkSchedules {
		if item.Enabled {
			hasEnabled = true
			break
		}
	}
	if input.Enabled && !hasEnabled {
		input.EffectiveFrom = monitorScheduleHistoryStart
		s.monitorWorkSchedules = nil
	}
	s.monitorWorkSchedules = append(s.monitorWorkSchedules, input)
	return input, nil
}

func (s *MemoryStore) GetSLASettings(ctx context.Context) (SLASettings, error) {
	if err := ctx.Err(); err != nil {
		return SLASettings{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if !s.hasSLASettings {
		return SLASettings{}, ErrNotFound
	}
	return s.slaSettings, nil
}

func (s *MemoryStore) SaveSLASettings(ctx context.Context, input SLASettings) (SLASettings, error) {
	if err := ctx.Err(); err != nil {
		return SLASettings{}, err
	}
	input, err := normalizeSLASettings(input)
	if err != nil {
		return SLASettings{}, err
	}
	input.UpdatedAt = time.Now().UTC()
	s.mu.Lock()
	s.slaSettings = input
	s.hasSLASettings = true
	s.mu.Unlock()
	return input, nil
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		shops:      map[string]Shop{},
		users:      map[string]User{},
		sessions:   map[string]Session{},
		shopAgents: map[string]ShopAgent{},
		sources:    map[string]ShopSource{},
		visitorSchemes: map[string]VisitorScheme{
			defaultVisitorSchemeID: defaultVisitorScheme(),
		},
		visitorSchemeShops:    map[string]string{},
		installations:         map[string]ShopifyInstallation{},
		shopifyAppProfiles:    map[string]ShopifyAppProfile{},
		emailInstalls:         map[string]EmailInstallation{},
		emailHistoryImports:   map[string]EmailHistoryImportJob{},
		emailSyncJobs:         map[string]EmailSyncJob{},
		shopifyOrderSyncJobs:  map[string]ShopifyOrderSyncJob{},
		shopifyWebhookIDs:     map[string]time.Time{},
		emailIngressWindows:   map[string]emailIngressRateWindow{},
		emailQuarantine:       map[string]EmailQuarantineRecord{},
		emailOutbox:           map[string]EmailOutboxRecord{},
		emailExportJobs:       map[string]EmailExportJob{},
		emailAttachmentJobs:   map[string]EmailAttachmentJob{},
		emailRuntimeEvents:    []EmailRuntimeEvent{},
		cuiqiuDomainSettings:  map[string]CuiqiuDomainSettings{},
		conversations:         map[string]Conversation{},
		messages:              map[string][]Message{},
		conversationEmailTags: map[string][]EmailProcessingTag{},
		conversationReads:     map[string]time.Time{},
		knowledge:             map[string]KnowledgeEntry{},
		recordCategories:      records.DefaultCategories(),
		transferRequests:      map[string]TransferRequest{},
		tickets:               map[string]Ticket{},
		ticketComments:        map[string][]TicketComment{},
		privacyRedactions:     map[string]PrivacyRedactionReceipt{},
	}
}

func (s *MemoryStore) GetRecordCategories(ctx context.Context) ([]RecordCategoryOption, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneRecordCategories(s.recordCategories), nil
}

func (s *MemoryStore) SaveRecordCategories(ctx context.Context, input []RecordCategoryOption) ([]RecordCategoryOption, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	normalized := records.NormalizeCategories(input)
	if len(normalized) == 0 {
		return nil, fmt.Errorf("%w: record categories are required", ErrInvalid)
	}
	s.mu.Lock()
	s.recordCategories = cloneRecordCategories(normalized)
	s.mu.Unlock()
	return cloneRecordCategories(normalized), nil
}

func cloneRecordCategories(input []RecordCategoryOption) []RecordCategoryOption {
	out := make([]RecordCategoryOption, len(input))
	for index, category := range input {
		out[index] = category
		out[index].Tertiary = append([]string(nil), category.Tertiary...)
	}
	return out
}

func (s *MemoryStore) CreateKnowledge(ctx context.Context, input KnowledgeEntry) (KnowledgeEntry, error) {
	if err := ctx.Err(); err != nil {
		return KnowledgeEntry{}, err
	}
	input, err := normalizeKnowledgeEntry(input, true)
	if err != nil {
		return KnowledgeEntry{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if input.ShopID != "" {
		if _, ok := s.shops[input.ShopID]; !ok {
			return KnowledgeEntry{}, ErrNotFound
		}
	}
	if input.ConversationID != "" {
		if _, ok := s.conversations[input.ConversationID]; !ok {
			return KnowledgeEntry{}, ErrNotFound
		}
		for _, entry := range s.knowledge {
			if entry.ConversationID == input.ConversationID {
				return KnowledgeEntry{}, fmt.Errorf("%w: conversation has already been submitted", ErrConflict)
			}
		}
	}
	if input.SupersedesID != "" {
		base, ok := s.knowledge[input.SupersedesID]
		if !ok || base.Status != KnowledgeStatusPublished {
			return KnowledgeEntry{}, fmt.Errorf("%w: published knowledge to revise was not found", ErrInvalid)
		}
		if input.Status != KnowledgeStatusPending && input.Status != KnowledgeStatusRejected {
			return KnowledgeEntry{}, fmt.Errorf("%w: a knowledge revision must be pending or rejected", ErrInvalid)
		}
		for _, entry := range s.knowledge {
			if entry.SupersedesID == input.SupersedesID && entry.Status == KnowledgeStatusPending {
				return KnowledgeEntry{}, fmt.Errorf("%w: knowledge already has a pending revision", ErrConflict)
			}
		}
	}
	if input.ID == "" {
		input.ID = s.newIDLocked("knowledge")
	}
	now := time.Now().UTC()
	input.CreatedAt = now
	input.UpdatedAt = now
	if input.Status == KnowledgeStatusPublished || input.Status == KnowledgeStatusRejected {
		input.ReviewedAt = now
	}
	s.knowledge[input.ID] = input
	return input, nil
}

func (s *MemoryStore) ListKnowledge(ctx context.Context, filter KnowledgeFilter) ([]KnowledgeEntry, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []KnowledgeEntry{}
	for _, entry := range s.knowledge {
		if filter.ShopID != "" && entry.ShopID != filter.ShopID {
			continue
		}
		if filter.Status != "" && entry.Status != filter.Status {
			continue
		}
		if filter.Scope != "" && entry.Scope != filter.Scope {
			continue
		}
		if filter.SubmittedBy != "" && entry.SubmittedBy != filter.SubmittedBy {
			continue
		}
		entry.Tags = append([]string(nil), entry.Tags...)
		out = append(out, entry)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].UpdatedAt.Equal(out[j].UpdatedAt) {
			return out[i].ID < out[j].ID
		}
		return out[i].UpdatedAt.After(out[j].UpdatedAt)
	})
	if filter.PageSize > 0 {
		start := (max(filter.Page, 1) - 1) * filter.PageSize
		if start >= len(out) {
			return []KnowledgeEntry{}, nil
		}
		end := min(start+filter.PageSize, len(out))
		out = out[start:end]
	}
	return out, nil
}

func (s *MemoryStore) CountKnowledge(ctx context.Context, filter KnowledgeFilter) (int, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	total := 0
	for _, entry := range s.knowledge {
		if filter.ShopID != "" && entry.ShopID != filter.ShopID {
			continue
		}
		if filter.Status != "" && entry.Status != filter.Status {
			continue
		}
		if filter.Scope != "" && entry.Scope != filter.Scope {
			continue
		}
		if filter.SubmittedBy != "" && entry.SubmittedBy != filter.SubmittedBy {
			continue
		}
		total++
	}
	return total, nil
}

func (s *MemoryStore) GetKnowledge(ctx context.Context, id string) (KnowledgeEntry, error) {
	if err := ctx.Err(); err != nil {
		return KnowledgeEntry{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	entry, ok := s.knowledge[strings.TrimSpace(id)]
	if !ok {
		return KnowledgeEntry{}, ErrNotFound
	}
	entry.Tags = append([]string(nil), entry.Tags...)
	return entry, nil
}

func (s *MemoryStore) UpdateKnowledge(ctx context.Context, id string, input KnowledgeUpdate) (KnowledgeEntry, error) {
	if err := ctx.Err(); err != nil {
		return KnowledgeEntry{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.knowledge[strings.TrimSpace(id)]
	if !ok {
		return KnowledgeEntry{}, ErrNotFound
	}
	if strings.TrimSpace(input.Scope) != "" {
		entry.Scope = input.Scope
	}
	if input.ShopID != "" || entry.Scope == KnowledgeScopeGlobal {
		entry.ShopID = strings.TrimSpace(input.ShopID)
	}
	if strings.TrimSpace(input.Title) != "" {
		entry.Title = input.Title
	}
	if strings.TrimSpace(input.Answer) != "" {
		entry.Answer = input.Answer
	}
	if input.Tags != nil {
		entry.Tags = input.Tags
	}
	if strings.TrimSpace(input.Status) != "" {
		entry.Status = input.Status
	}
	if input.ReviewNote != "" {
		entry.ReviewNote = input.ReviewNote
	}
	if input.ReviewedBy != "" {
		entry.ReviewedBy = strings.TrimSpace(input.ReviewedBy)
	}
	entry, err := normalizeKnowledgeEntry(entry, false)
	if err != nil {
		return KnowledgeEntry{}, err
	}
	if entry.ShopID != "" {
		if _, ok := s.shops[entry.ShopID]; !ok {
			return KnowledgeEntry{}, ErrNotFound
		}
	}
	if entry.SupersedesID != "" && entry.Status == KnowledgeStatusPending {
		for otherID, other := range s.knowledge {
			if otherID != entry.ID && other.SupersedesID == entry.SupersedesID && other.Status == KnowledgeStatusPending {
				return KnowledgeEntry{}, fmt.Errorf("%w: knowledge already has a pending revision", ErrConflict)
			}
		}
	}
	entry.UpdatedAt = time.Now().UTC()
	if input.Status == KnowledgeStatusPending {
		entry.ReviewedBy = ""
		entry.ReviewNote = ""
		entry.ReviewedAt = time.Time{}
	} else if input.Status == KnowledgeStatusPublished || input.Status == KnowledgeStatusRejected {
		entry.ReviewNote = strings.TrimSpace(input.ReviewNote)
		entry.ReviewedAt = entry.UpdatedAt
	}
	s.knowledge[entry.ID] = entry
	return entry, nil
}

func (s *MemoryStore) ApplyKnowledgeRevision(ctx context.Context, revisionID string, reviewedBy string, reviewNote string) (KnowledgeEntry, error) {
	if err := ctx.Err(); err != nil {
		return KnowledgeEntry{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	revision, ok := s.knowledge[strings.TrimSpace(revisionID)]
	if !ok {
		return KnowledgeEntry{}, ErrNotFound
	}
	if revision.Status != KnowledgeStatusPending || revision.SupersedesID == "" {
		return KnowledgeEntry{}, fmt.Errorf("%w: knowledge is not a pending revision", ErrInvalid)
	}
	base, ok := s.knowledge[revision.SupersedesID]
	if !ok || base.Status != KnowledgeStatusPublished {
		return KnowledgeEntry{}, fmt.Errorf("%w: published knowledge to revise was not found", ErrConflict)
	}
	now := time.Now().UTC()
	base.Scope = revision.Scope
	base.ShopID = revision.ShopID
	base.Title = revision.Title
	base.Answer = revision.Answer
	base.Tags = append([]string(nil), revision.Tags...)
	base.SubmittedBy = revision.SubmittedBy
	base.ReviewedBy = strings.TrimSpace(reviewedBy)
	base.ReviewNote = strings.TrimSpace(reviewNote)
	base.UpdatedAt = now
	base.ReviewedAt = now
	s.knowledge[base.ID] = base
	delete(s.knowledge, revision.ID)
	return base, nil
}

func (s *MemoryStore) DeleteKnowledge(ctx context.Context, id string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	id = strings.TrimSpace(id)
	if _, ok := s.knowledge[id]; !ok {
		return ErrNotFound
	}
	delete(s.knowledge, id)
	for childID, entry := range s.knowledge {
		if entry.SupersedesID == id {
			delete(s.knowledge, childID)
		}
	}
	return nil
}

func (s *MemoryStore) Health(ctx context.Context) HealthStatus {
	if err := ctx.Err(); err != nil {
		return HealthStatus{Name: "memory", OK: false, Error: err.Error()}
	}
	return HealthStatus{Name: "memory", OK: true}
}

func (s *MemoryStore) CreateUser(ctx context.Context, input User) (User, error) {
	if err := ctx.Err(); err != nil {
		return User{}, err
	}
	email := normalizeEmail(input.Email)
	if email == "" {
		return User{}, fmt.Errorf("%w: email is required", ErrInvalid)
	}
	if strings.TrimSpace(input.PasswordHash) == "" {
		return User{}, fmt.Errorf("%w: passwordHash is required", ErrInvalid)
	}
	now := time.Now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, user := range s.users {
		if user.Email == email {
			return User{}, fmt.Errorf("%w: email already exists", ErrInvalid)
		}
	}
	if input.ID == "" {
		input.ID = s.newIDLocked("user")
	}
	input.Email = email
	input.DisplayName = defaultString(input.DisplayName, email)
	input.Role = defaultString(input.Role, UserRoleAgent)
	department, err := normalizeUserDepartment(input.Role, input.Department)
	if err != nil {
		return User{}, err
	}
	input.Department = department
	skillGroup, err := normalizeUserSkillGroupForDepartment(input.Role, input.Department, input.SkillGroup)
	if err != nil {
		return User{}, err
	}
	input.SkillGroup = skillGroup
	input.Status = defaultString(input.Status, UserStatusActive)
	input.ReceptionLimit = normalizeReceptionLimit(input.ReceptionLimit)
	input.ReceptionOnline = true
	input.Permissions = normalizePermissions(input.Permissions)
	if err := validateDataScopes(input.DataScopes); err != nil {
		return User{}, err
	}
	input.DataScopes = normalizeDataScopes(input.DataScopes, input.SystemAdmin)
	input.ShopScope = effectiveShopScope(input.ShopScope, input.Role)
	input.ShopScopeIDs = normalizeShopScopeIDs(input.ShopScopeIDs)
	if input.ShopScope != AccessScopeSelected {
		input.ShopScopeIDs = []string{}
	}
	input.WorkbenchShopScope = effectiveWorkbenchShopScope(input.WorkbenchShopScope)
	input.ConversationScope = strings.TrimSpace(input.ConversationScope)
	if err := validateShopScope(input.ShopScope, input.ShopScopeIDs); err != nil {
		return User{}, err
	}
	if err := validateAccessScope(input.WorkbenchShopScope); err != nil {
		return User{}, err
	}
	if err := validateAccessScope(input.ConversationScope); err != nil {
		return User{}, err
	}
	input.CreatedAt = now
	input.UpdatedAt = now
	s.users[input.ID] = input
	return input, nil
}

func (s *MemoryStore) ListUsers(ctx context.Context) ([]User, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]User, 0, len(s.users))
	for _, user := range s.users {
		out = append(out, user)
	}
	return out, nil
}

func (s *MemoryStore) GetUser(ctx context.Context, id string) (User, error) {
	if err := ctx.Err(); err != nil {
		return User{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	user, ok := s.users[id]
	if !ok {
		return User{}, ErrNotFound
	}
	return user, nil
}

func (s *MemoryStore) FindUserByEmail(ctx context.Context, email string) (User, error) {
	if err := ctx.Err(); err != nil {
		return User{}, err
	}
	email = normalizeEmail(email)
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, user := range s.users {
		if user.Email == email {
			return user, nil
		}
	}
	return User{}, ErrNotFound
}

func (s *MemoryStore) UpdateUser(ctx context.Context, id string, input User) (User, error) {
	if err := ctx.Err(); err != nil {
		return User{}, err
	}
	id = strings.TrimSpace(id)
	s.mu.Lock()
	defer s.mu.Unlock()
	user, ok := s.users[id]
	if !ok {
		return User{}, ErrNotFound
	}
	if strings.TrimSpace(input.DisplayName) != "" {
		user.DisplayName = strings.TrimSpace(input.DisplayName)
	}
	if strings.TrimSpace(input.Email) != "" {
		email := normalizeEmail(input.Email)
		for _, item := range s.users {
			if item.ID != id && item.Email == email {
				return User{}, fmt.Errorf("%w: email already exists", ErrInvalid)
			}
		}
		user.Email = email
	}
	if strings.TrimSpace(input.PasswordHash) != "" {
		user.PasswordHash = input.PasswordHash
	}
	if strings.TrimSpace(input.Role) != "" {
		role := strings.TrimSpace(input.Role)
		if role != UserRoleAdmin && role != UserRoleAgent {
			return User{}, fmt.Errorf("%w: unsupported role", ErrInvalid)
		}
		user.Role = role
	}
	if strings.TrimSpace(input.Status) != "" {
		status, err := normalizeUserStatus(input.Status)
		if err != nil {
			return User{}, err
		}
		user.Status = status
	}
	if input.SetDepartment {
		department, err := normalizeUserDepartment(user.Role, input.Department)
		if err != nil {
			return User{}, err
		}
		user.Department = department
	}
	if input.SetSkillGroup {
		skillGroup, err := normalizeUserSkillGroupForDepartment(user.Role, user.Department, input.SkillGroup)
		if err != nil {
			return User{}, err
		}
		user.SkillGroup = skillGroup
	}
	if input.ReceptionLimit != 0 {
		if err := validateReceptionLimit(input.ReceptionLimit); err != nil {
			return User{}, err
		}
		user.ReceptionLimit = input.ReceptionLimit
	}
	if input.SetAccessControl {
		if err := validatePermissions(input.Permissions); err != nil {
			return User{}, err
		}
		if err := validateDataScopes(input.DataScopes); err != nil {
			return User{}, err
		}
		if err := validateShopScope(input.ShopScope, input.ShopScopeIDs); err != nil {
			return User{}, err
		}
		if err := validateAccessScope(input.WorkbenchShopScope); err != nil {
			return User{}, err
		}
		if err := validateAccessScope(input.ConversationScope); err != nil {
			return User{}, err
		}
		user.Permissions = normalizePermissions(input.Permissions)
		user.PermissionsCustomized = input.PermissionsCustomized
		user.DataScopes = normalizeDataScopes(input.DataScopes, user.SystemAdmin)
		user.ShopScope = effectiveShopScope(input.ShopScope, user.Role)
		user.ShopScopeIDs = normalizeShopScopeIDs(input.ShopScopeIDs)
		if user.ShopScope != AccessScopeSelected {
			user.ShopScopeIDs = []string{}
		}
		user.WorkbenchShopScope = strings.TrimSpace(input.WorkbenchShopScope)
		user.ConversationScope = strings.TrimSpace(input.ConversationScope)
	}
	user.ReceptionLimit = normalizeReceptionLimit(user.ReceptionLimit)
	user.Department, _ = normalizeUserDepartment(user.Role, user.Department)
	user.SkillGroup, _ = normalizeUserSkillGroupForDepartment(user.Role, user.Department, user.SkillGroup)
	previous := s.users[user.ID]
	if user.PasswordHash != previous.PasswordHash || user.Status != previous.Status || user.Email != previous.Email || user.SystemAdmin != previous.SystemAdmin {
		user.IdentityRevision++
	}
	user.UpdatedAt = time.Now().UTC()
	s.users[user.ID] = user
	return user, nil
}

func (s *MemoryStore) SetUserReceptionOnline(ctx context.Context, id string, online bool) (User, error) {
	if err := ctx.Err(); err != nil {
		return User{}, err
	}
	id = strings.TrimSpace(id)
	s.mu.Lock()
	defer s.mu.Unlock()
	user, ok := s.users[id]
	if !ok {
		return User{}, ErrNotFound
	}
	user.ReceptionOnline = online
	user.UpdatedAt = time.Now().UTC()
	s.users[id] = user
	return user, nil
}

func (s *MemoryStore) CreateAccountAuditLog(ctx context.Context, input AccountAuditLog) (AccountAuditLog, error) {
	if err := ctx.Err(); err != nil {
		return AccountAuditLog{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if input.ID == "" {
		input.ID = s.newIDLocked("audit")
	}
	if input.CreatedAt.IsZero() {
		input.CreatedAt = time.Now().UTC()
	}
	s.accountAuditLogs = append(s.accountAuditLogs, input)
	return input, nil
}

func (s *MemoryStore) ListAccountAuditLogs(ctx context.Context, targetUserID string, limit int) ([]AccountAuditLog, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	targetUserID = strings.TrimSpace(targetUserID)
	if targetUserID == "" {
		return nil, fmt.Errorf("%w: target user is required", ErrInvalid)
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]AccountAuditLog, 0, limit)
	for index := len(s.accountAuditLogs) - 1; index >= 0 && len(out) < limit; index-- {
		item := s.accountAuditLogs[index]
		if item.TargetUserID == targetUserID {
			out = append(out, item)
		}
	}
	return out, nil
}

func (s *MemoryStore) DeleteUser(ctx context.Context, id string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	id = strings.TrimSpace(id)
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.users[id]; !ok {
		return ErrNotFound
	}
	delete(s.users, id)
	for tokenHash, session := range s.sessions {
		if session.UserID == id {
			delete(s.sessions, tokenHash)
		}
	}
	for key, assignment := range s.shopAgents {
		if assignment.UserID == id {
			delete(s.shopAgents, key)
		}
	}
	for key := range s.conversationReads {
		if strings.HasPrefix(key, id+"\x00") {
			delete(s.conversationReads, key)
		}
	}
	now := time.Now().UTC()
	for key, conversation := range s.conversations {
		if conversation.AssignedAgentID == id {
			conversation.AssignedAgentID = ""
			if conversation.Status == ConversationStatusAssigned {
				conversation.Status = ConversationStatusOpen
			}
			conversation.UpdatedAt = now
			s.conversations[key] = conversation
		}
	}
	return nil
}

func (s *MemoryStore) CountUsers(ctx context.Context) (int, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.users), nil
}

func (s *MemoryStore) CreateSession(ctx context.Context, input Session) (Session, error) {
	if err := ctx.Err(); err != nil {
		return Session{}, err
	}
	if strings.TrimSpace(input.UserID) == "" || strings.TrimSpace(input.TokenHash) == "" {
		return Session{}, fmt.Errorf("%w: userId and tokenHash are required", ErrInvalid)
	}
	now := time.Now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.users[input.UserID]; !ok {
		return Session{}, ErrNotFound
	}
	if input.ID == "" {
		input.ID = s.newIDLocked("sess")
	}
	if input.ExpiresAt.IsZero() {
		input.ExpiresAt = now.Add(24 * time.Hour)
	}
	input.CreatedAt = now
	s.sessions[input.TokenHash] = input
	return input, nil
}

func (s *MemoryStore) GetSessionByTokenHash(ctx context.Context, tokenHash string) (Session, User, error) {
	if err := ctx.Err(); err != nil {
		return Session{}, User{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	session, ok := s.sessions[strings.TrimSpace(tokenHash)]
	if !ok || time.Now().UTC().After(session.ExpiresAt) {
		return Session{}, User{}, ErrNotFound
	}
	user, ok := s.users[session.UserID]
	if !ok {
		return Session{}, User{}, ErrNotFound
	}
	return session, user, nil
}

func (s *MemoryStore) DeleteSession(ctx context.Context, tokenHash string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, strings.TrimSpace(tokenHash))
	return nil
}

func (s *MemoryStore) AssignUserToShop(ctx context.Context, shopID string, userID string) (ShopAgent, error) {
	if err := ctx.Err(); err != nil {
		return ShopAgent{}, err
	}
	shopID = strings.TrimSpace(shopID)
	userID = strings.TrimSpace(userID)
	if shopID == "" || userID == "" {
		return ShopAgent{}, fmt.Errorf("%w: shopId and userId are required", ErrInvalid)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.shops[shopID]; !ok {
		return ShopAgent{}, ErrNotFound
	}
	if _, ok := s.users[userID]; !ok {
		return ShopAgent{}, ErrNotFound
	}
	key := shopAgentKey(shopID, userID)
	if assignment, ok := s.shopAgents[key]; ok {
		return assignment, nil
	}
	assignment := ShopAgent{ShopID: shopID, UserID: userID, CreatedAt: time.Now().UTC()}
	s.shopAgents[key] = assignment
	return assignment, nil
}

func (s *MemoryStore) UnassignUserFromShop(ctx context.Context, shopID string, userID string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.shopAgents, shopAgentKey(strings.TrimSpace(shopID), strings.TrimSpace(userID)))
	return nil
}

func (s *MemoryStore) ListShopUsers(ctx context.Context, shopID string) ([]User, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	shopID = strings.TrimSpace(shopID)
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.shops[shopID]; !ok {
		return nil, ErrNotFound
	}
	out := []User{}
	for _, assignment := range s.shopAgents {
		if assignment.ShopID != shopID {
			continue
		}
		if user, ok := s.users[assignment.UserID]; ok {
			out = append(out, user)
		}
	}
	return out, nil
}

func (s *MemoryStore) ListUserShopIDs(ctx context.Context, userID string) ([]string, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	userID = strings.TrimSpace(userID)
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.users[userID]; !ok {
		return nil, ErrNotFound
	}
	out := []string{}
	for _, assignment := range s.shopAgents {
		if assignment.UserID == userID {
			out = append(out, assignment.ShopID)
		}
	}
	return out, nil
}

func (s *MemoryStore) ListShopAssignments(ctx context.Context) ([]ShopAgent, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]ShopAgent, 0, len(s.shopAgents))
	for _, assignment := range s.shopAgents {
		out = append(out, assignment)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].CreatedAt.Equal(out[j].CreatedAt) {
			if out[i].ShopID == out[j].ShopID {
				return out[i].UserID < out[j].UserID
			}
			return out[i].ShopID < out[j].ShopID
		}
		return out[i].CreatedAt.Before(out[j].CreatedAt)
	})
	return out, nil
}

func (s *MemoryStore) CreateShop(ctx context.Context, input Shop) (Shop, error) {
	if err := ctx.Err(); err != nil {
		return Shop{}, err
	}
	name := strings.TrimSpace(input.DisplayName)
	if name == "" {
		return Shop{}, fmt.Errorf("%w: displayName is required", ErrInvalid)
	}
	now := time.Now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, existing := range s.shops {
		if strings.EqualFold(strings.TrimSpace(existing.DisplayName), name) {
			return Shop{}, fmt.Errorf("%w: 店铺名称“%s”已存在，请直接使用原店铺", ErrConflict, existing.DisplayName)
		}
	}
	if input.ID == "" {
		input.ID = s.newIDLocked("shop")
	}
	input.DisplayName = name
	input.Platform = defaultString(input.Platform, "shopify")
	status, err := normalizeShopStatus(input.Status)
	if err != nil {
		return Shop{}, err
	}
	input.Status = status
	input.CreatedAt = now
	input.UpdatedAt = now
	s.shops[input.ID] = input
	return input, nil
}

func (s *MemoryStore) ListShops(ctx context.Context) ([]Shop, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Shop, 0, len(s.shops))
	for _, shop := range s.shops {
		out = append(out, shop)
	}
	return out, nil
}

func (s *MemoryStore) GetShop(ctx context.Context, id string) (Shop, error) {
	if err := ctx.Err(); err != nil {
		return Shop{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	shop, ok := s.shops[id]
	if !ok {
		return Shop{}, ErrNotFound
	}
	return shop, nil
}

func (s *MemoryStore) UpdateShop(ctx context.Context, id string, input Shop) (Shop, error) {
	if err := ctx.Err(); err != nil {
		return Shop{}, err
	}
	id = strings.TrimSpace(id)
	s.mu.Lock()
	defer s.mu.Unlock()
	shop, ok := s.shops[id]
	if !ok {
		return Shop{}, ErrNotFound
	}
	if name := strings.TrimSpace(input.DisplayName); name != "" {
		shop.DisplayName = name
	}
	if platform := strings.TrimSpace(input.Platform); platform != "" {
		shop.Platform = platform
	}
	if externalID := strings.TrimSpace(input.ExternalID); externalID != "" {
		shop.ExternalID = externalID
	}
	if strings.TrimSpace(input.Status) != "" {
		status, err := normalizeShopStatus(input.Status)
		if err != nil {
			return Shop{}, err
		}
		shop.Status = status
	}
	if input.Metadata != nil {
		shop.Metadata = input.Metadata
	}
	shop.UpdatedAt = time.Now().UTC()
	s.shops[id] = shop
	return shop, nil
}

func (s *MemoryStore) DeleteShop(ctx context.Context, id string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	id = strings.TrimSpace(id)
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.shops[id]; !ok {
		return ErrNotFound
	}
	delete(s.shops, id)
	delete(s.visitorSchemeShops, id)
	for key, assignment := range s.shopAgents {
		if assignment.ShopID == id {
			delete(s.shopAgents, key)
		}
	}
	sourceIDs := map[string]bool{}
	for key, source := range s.sources {
		if source.ShopID == id {
			sourceIDs[source.ID] = true
			delete(s.sources, key)
		}
	}
	for domain, installation := range s.installations {
		if installation.ShopID == id {
			delete(s.installations, domain)
		}
	}
	delete(s.shopifyAppProfiles, id)
	for key, installation := range s.emailInstalls {
		if installation.ShopID == id {
			delete(s.emailInstalls, key)
		}
	}
	for conversationID, conversation := range s.conversations {
		if conversation.ShopID == id || sourceIDs[conversation.SourceID] {
			delete(s.conversations, conversationID)
			delete(s.messages, conversationID)
			for key := range s.conversationReads {
				if strings.HasSuffix(key, "\x00"+conversationID) {
					delete(s.conversationReads, key)
				}
			}
		}
	}
	return nil
}

func (s *MemoryStore) CreateShopSource(ctx context.Context, input ShopSource) (ShopSource, error) {
	if err := ctx.Err(); err != nil {
		return ShopSource{}, err
	}
	if strings.TrimSpace(input.ShopID) == "" {
		return ShopSource{}, ErrShopNeeded
	}
	if strings.TrimSpace(input.Type) == "" {
		return ShopSource{}, fmt.Errorf("%w: type is required", ErrInvalid)
	}
	now := time.Now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.shops[input.ShopID]; !ok {
		return ShopSource{}, ErrNotFound
	}
	if input.ID == "" {
		input.ID = s.newIDLocked("src")
	}
	input.Type = strings.TrimSpace(input.Type)
	input = withShopifyChatDefaults(input)
	input.Provider = defaultString(strings.TrimSpace(input.Provider), input.Type)
	input.Address = strings.TrimSpace(input.Address)
	status, err := normalizeSourceStatus(defaultSourceStatus(input))
	if err != nil {
		return ShopSource{}, err
	}
	input.Status = status
	input.CreatedAt = now
	input.UpdatedAt = now
	s.sources[input.ID] = input
	if input.Type == SourceTypeShopifyChat {
		s.visitorSchemeShops[input.ShopID] = defaultVisitorSchemeID
	}
	return input, nil
}

func (s *MemoryStore) ListShopSources(ctx context.Context, shopID string) ([]ShopSource, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []ShopSource{}
	for _, source := range s.sources {
		if shopID == "" || source.ShopID == shopID {
			out = append(out, source)
		}
	}
	return out, nil
}

func (s *MemoryStore) GetShopSource(ctx context.Context, shopID string, sourceID string) (ShopSource, error) {
	if err := ctx.Err(); err != nil {
		return ShopSource{}, err
	}
	shopID = strings.TrimSpace(shopID)
	sourceID = strings.TrimSpace(sourceID)
	s.mu.RLock()
	defer s.mu.RUnlock()
	source, ok := s.sources[sourceID]
	if !ok || source.ShopID != shopID {
		return ShopSource{}, ErrNotFound
	}
	return source, nil
}

func (s *MemoryStore) SetShopSourceStatus(ctx context.Context, shopID string, sourceID string, status string) (ShopSource, error) {
	return s.UpdateShopSource(ctx, shopID, sourceID, ShopSource{Status: status})
}

func (s *MemoryStore) UpdateShopSource(ctx context.Context, shopID string, sourceID string, input ShopSource) (ShopSource, error) {
	if err := ctx.Err(); err != nil {
		return ShopSource{}, err
	}
	shopID = strings.TrimSpace(shopID)
	sourceID = strings.TrimSpace(sourceID)
	s.mu.Lock()
	defer s.mu.Unlock()
	source, ok := s.sources[sourceID]
	if !ok || source.ShopID != shopID {
		return ShopSource{}, ErrNotFound
	}
	if strings.TrimSpace(input.Provider) != "" {
		source.Provider = strings.TrimSpace(input.Provider)
	}
	if strings.TrimSpace(input.Address) != "" {
		source.Address = strings.TrimSpace(input.Address)
	}
	if strings.TrimSpace(input.Status) != "" {
		status, err := normalizeSourceStatus(input.Status)
		if err != nil {
			return ShopSource{}, err
		}
		source.Status = status
	}
	if input.Metadata != nil {
		source.Metadata = input.Metadata
	}
	source.UpdatedAt = time.Now().UTC()
	s.sources[source.ID] = source
	return source, nil
}

func (s *MemoryStore) MutateShopSourceMetadata(ctx context.Context, shopID string, sourceID string, mutate func(map[string]string) map[string]string) (ShopSource, error) {
	if err := ctx.Err(); err != nil {
		return ShopSource{}, err
	}
	shopID = strings.TrimSpace(shopID)
	sourceID = strings.TrimSpace(sourceID)
	s.mu.Lock()
	defer s.mu.Unlock()
	source, ok := s.sources[sourceID]
	if !ok || source.ShopID != shopID {
		return ShopSource{}, ErrNotFound
	}
	metadata := cloneStringMap(source.Metadata)
	if metadata == nil {
		metadata = map[string]string{}
	}
	source.Metadata = mutate(metadata)
	source.UpdatedAt = time.Now().UTC()
	s.sources[source.ID] = source
	return source, nil
}

func (s *MemoryStore) SaveShopifyInstallation(ctx context.Context, input ShopifyInstallation) (ShopifyInstallation, error) {
	if err := ctx.Err(); err != nil {
		return ShopifyInstallation{}, err
	}
	input.ShopDomain = normalizeShopifyDomain(input.ShopDomain)
	input.ShopID = strings.TrimSpace(input.ShopID)
	input.AccessToken = strings.TrimSpace(input.AccessToken)
	input.Scope = strings.TrimSpace(input.Scope)
	if input.ShopDomain == "" || input.ShopID == "" || input.AccessToken == "" {
		return ShopifyInstallation{}, fmt.Errorf("%w: shopDomain, shopId, and accessToken are required", ErrInvalid)
	}
	now := time.Now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.shops[input.ShopID]; !ok {
		return ShopifyInstallation{}, ErrNotFound
	}
	if existing, ok := s.installations[input.ShopDomain]; ok && !existing.InstalledAt.IsZero() {
		input.InstalledAt = existing.InstalledAt
	} else if input.InstalledAt.IsZero() {
		input.InstalledAt = now
	}
	input.UpdatedAt = now
	s.installations[input.ShopDomain] = input
	return input, nil
}

func (s *MemoryStore) ListAuthorizedShopifyShops(ctx context.Context) ([]Shop, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	authorizedIDs := make(map[string]bool, len(s.installations))
	for _, installation := range s.installations {
		if strings.TrimSpace(installation.AccessToken) != "" {
			authorizedIDs[installation.ShopID] = true
		}
	}
	out := make([]Shop, 0, len(authorizedIDs))
	for _, shop := range s.shops {
		if shop.Status == ShopStatusActive && authorizedIDs[shop.ID] {
			out = append(out, shop)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].CreatedAt.Equal(out[j].CreatedAt) {
			return out[i].ID < out[j].ID
		}
		return out[i].CreatedAt.Before(out[j].CreatedAt)
	})
	return out, nil
}

func (s *MemoryStore) GetShopifyInstallationByDomain(ctx context.Context, shopDomain string) (ShopifyInstallation, error) {
	if err := ctx.Err(); err != nil {
		return ShopifyInstallation{}, err
	}
	shopDomain = normalizeShopifyDomain(shopDomain)
	s.mu.RLock()
	defer s.mu.RUnlock()
	installation, ok := s.installations[shopDomain]
	if !ok {
		return ShopifyInstallation{}, ErrNotFound
	}
	return installation, nil
}

func (s *MemoryStore) DeleteShopifyInstallationByDomain(ctx context.Context, shopDomain string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	shopDomain = normalizeShopifyDomain(shopDomain)
	if shopDomain == "" {
		return fmt.Errorf("%w: shopDomain is required", ErrInvalid)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.installations, shopDomain)
	return nil
}

func (s *MemoryStore) SaveShopifyAppProfile(ctx context.Context, input ShopifyAppProfile) (ShopifyAppProfile, error) {
	if err := ctx.Err(); err != nil {
		return ShopifyAppProfile{}, err
	}
	input.ShopID = strings.TrimSpace(input.ShopID)
	input.ShopDomain = normalizeShopifyDomain(input.ShopDomain)
	input.ClientID = strings.TrimSpace(input.ClientID)
	input.ExtensionHandle = defaultString(strings.TrimSpace(input.ExtensionHandle), "xinzhi-chat")
	input.DeployStatus = defaultString(strings.TrimSpace(input.DeployStatus), ShopifyAppDeployPending)
	if input.ShopID == "" || input.ShopDomain == "" || input.ClientID == "" || input.EncryptedClientSecret == "" || input.EncryptedAutomationToken == "" {
		return ShopifyAppProfile{}, fmt.Errorf("%w: shopId, shopDomain, clientId, clientSecret, and automationToken are required", ErrInvalid)
	}
	now := time.Now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.shops[input.ShopID]; !ok {
		return ShopifyAppProfile{}, ErrNotFound
	}
	if existing, ok := s.shopifyAppProfiles[input.ShopID]; ok && !existing.CreatedAt.IsZero() {
		input.CreatedAt = existing.CreatedAt
	} else if input.CreatedAt.IsZero() {
		input.CreatedAt = now
	}
	input.UpdatedAt = now
	input.HasClientSecret = true
	input.HasAutomationToken = true
	s.shopifyAppProfiles[input.ShopID] = input
	return input, nil
}

func (s *MemoryStore) GetShopifyAppProfile(ctx context.Context, shopID string) (ShopifyAppProfile, error) {
	if err := ctx.Err(); err != nil {
		return ShopifyAppProfile{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	profile, ok := s.shopifyAppProfiles[strings.TrimSpace(shopID)]
	if !ok {
		return ShopifyAppProfile{}, ErrNotFound
	}
	return profile, nil
}

func (s *MemoryStore) GetShopifyAppProfileByDomain(ctx context.Context, shopDomain string) (ShopifyAppProfile, error) {
	if err := ctx.Err(); err != nil {
		return ShopifyAppProfile{}, err
	}
	shopDomain = normalizeShopifyDomain(shopDomain)
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, profile := range s.shopifyAppProfiles {
		if profile.ShopDomain == shopDomain {
			return profile, nil
		}
	}
	return ShopifyAppProfile{}, ErrNotFound
}

func (s *MemoryStore) DeleteShopifyAppProfile(ctx context.Context, shopID string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.shopifyAppProfiles, strings.TrimSpace(shopID))
	return nil
}

func (s *MemoryStore) SaveEmailInstallation(ctx context.Context, input EmailInstallation) (EmailInstallation, error) {
	if err := ctx.Err(); err != nil {
		return EmailInstallation{}, err
	}
	input.ShopID = strings.TrimSpace(input.ShopID)
	input.Mailbox = normalizeEmail(input.Mailbox)
	input.Provider = strings.ToLower(defaultString(strings.TrimSpace(input.Provider), "outlook"))
	input.AccessToken = strings.TrimSpace(input.AccessToken)
	input.RefreshToken = strings.TrimSpace(input.RefreshToken)
	input.Scope = strings.TrimSpace(input.Scope)
	if input.ShopID == "" || input.Mailbox == "" || input.AccessToken == "" {
		return EmailInstallation{}, fmt.Errorf("%w: shopId, mailbox, and accessToken are required", ErrInvalid)
	}
	now := time.Now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.shops[input.ShopID]; !ok {
		return EmailInstallation{}, ErrNotFound
	}
	for _, existing := range s.emailInstalls {
		if existing.ShopID != input.ShopID && normalizeEmail(existing.Mailbox) == input.Mailbox {
			return EmailInstallation{}, fmt.Errorf("%w: 邮箱 %s 已绑定到其他店铺", ErrConflict, input.Mailbox)
		}
	}
	key := emailInstallationKey(input.ShopID, input.Mailbox)
	if existing, ok := s.emailInstalls[key]; ok && !existing.InstalledAt.IsZero() {
		input.InstalledAt = existing.InstalledAt
		if input.RefreshToken == "" {
			input.RefreshToken = existing.RefreshToken
		}
	} else if input.InstalledAt.IsZero() {
		input.InstalledAt = now
	}
	input.UpdatedAt = now
	s.emailInstalls[key] = input
	return input, nil
}

func (s *MemoryStore) GetEmailInstallation(ctx context.Context, shopID string, mailbox string) (EmailInstallation, error) {
	if err := ctx.Err(); err != nil {
		return EmailInstallation{}, err
	}
	key := emailInstallationKey(shopID, normalizeEmail(mailbox))
	s.mu.RLock()
	defer s.mu.RUnlock()
	installation, ok := s.emailInstalls[key]
	if !ok {
		return EmailInstallation{}, ErrNotFound
	}
	return installation, nil
}

func (s *MemoryStore) SaveEmailHistoryImportJob(ctx context.Context, input EmailHistoryImportJob) (EmailHistoryImportJob, error) {
	if err := ctx.Err(); err != nil {
		return EmailHistoryImportJob{}, err
	}
	input.ShopID = strings.TrimSpace(input.ShopID)
	input.SourceID = strings.TrimSpace(input.SourceID)
	if input.ShopID == "" || input.SourceID == "" {
		return EmailHistoryImportJob{}, fmt.Errorf("%w: shopId and sourceId are required", ErrInvalid)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	source, ok := s.sources[input.SourceID]
	if !ok || source.ShopID != input.ShopID || source.Type != SourceTypeEmail {
		return EmailHistoryImportJob{}, ErrNotFound
	}
	if input.ID == "" {
		input.ID = s.newIDLocked("email_history")
	}
	now := time.Now().UTC()
	if existing, exists := s.emailHistoryImports[input.SourceID]; exists && input.CreatedAt.IsZero() {
		input.CreatedAt = existing.CreatedAt
	}
	if input.CreatedAt.IsZero() {
		input.CreatedAt = now
	}
	input.UpdatedAt = now
	s.emailHistoryImports[input.SourceID] = input
	return input, nil
}

func (s *MemoryStore) GetEmailHistoryImportJob(ctx context.Context, shopID string, sourceID string) (EmailHistoryImportJob, error) {
	if err := ctx.Err(); err != nil {
		return EmailHistoryImportJob{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	job, ok := s.emailHistoryImports[strings.TrimSpace(sourceID)]
	if !ok || (strings.TrimSpace(shopID) != "" && job.ShopID != strings.TrimSpace(shopID)) {
		return EmailHistoryImportJob{}, ErrNotFound
	}
	return job, nil
}

func (s *MemoryStore) ListEmailHistoryImportJobs(ctx context.Context, shopID string) ([]EmailHistoryImportJob, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	shopID = strings.TrimSpace(shopID)
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]EmailHistoryImportJob, 0, len(s.emailHistoryImports))
	for _, job := range s.emailHistoryImports {
		if shopID == "" || job.ShopID == shopID {
			out = append(out, job)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	return out, nil
}

func (s *MemoryStore) DisconnectEmailSource(ctx context.Context, shopID string, sourceID string) (ShopSource, error) {
	if err := ctx.Err(); err != nil {
		return ShopSource{}, err
	}
	shopID = strings.TrimSpace(shopID)
	sourceID = strings.TrimSpace(sourceID)
	s.mu.Lock()
	defer s.mu.Unlock()
	source, ok := s.sources[sourceID]
	if !ok || source.ShopID != shopID {
		return ShopSource{}, ErrNotFound
	}
	if source.Type != SourceTypeEmail {
		return ShopSource{}, fmt.Errorf("%w: source is not an email channel", ErrInvalid)
	}
	delete(s.emailInstalls, emailInstallationKey(shopID, sourceEmailAddress(source)))
	source.Status = SourceStatusDisabled
	source.Metadata = disconnectedEmailSourceMetadata(source, time.Now().UTC())
	source.UpdatedAt = time.Now().UTC()
	s.sources[source.ID] = source
	return source, nil
}

func (s *MemoryStore) CreateConversation(ctx context.Context, input Conversation) (Conversation, error) {
	if err := ctx.Err(); err != nil {
		return Conversation{}, err
	}
	if strings.TrimSpace(input.ShopID) == "" {
		return Conversation{}, ErrShopNeeded
	}
	if strings.TrimSpace(input.SourceID) == "" {
		return Conversation{}, fmt.Errorf("%w: sourceId is required", ErrInvalid)
	}
	now := time.Now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.shops[input.ShopID]; !ok {
		return Conversation{}, ErrNotFound
	}
	if source, ok := s.sources[input.SourceID]; !ok || source.ShopID != input.ShopID {
		return Conversation{}, ErrNotFound
	}
	if input.ID == "" {
		input.ID = s.newIDLocked("conv")
	}
	input.Status = defaultString(input.Status, ConversationStatusOpen)
	input.Kind = normalizeConversationKind(input.Kind)
	if input.Kind == ConversationKindCustomer && !input.ReplyAllowed {
		input.ReplyAllowed = true
	}
	if input.LastMessageAt.IsZero() {
		input.LastMessageAt = now
	}
	input.CreatedAt = now
	input.UpdatedAt = now
	if input.Status == ConversationStatusClosed && input.ClosedAt.IsZero() {
		input.ClosedAt = now
	}
	s.conversations[input.ID] = input
	return input, nil
}

func (s *MemoryStore) GetConversation(ctx context.Context, id string) (Conversation, error) {
	if err := ctx.Err(); err != nil {
		return Conversation{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	conversation, ok := s.conversations[strings.TrimSpace(id)]
	if !ok {
		return Conversation{}, ErrNotFound
	}
	return conversation, nil
}

func (s *MemoryStore) ListConversationEmailTags(ctx context.Context) (map[string][]EmailProcessingTag, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneConversationEmailTags(s.conversationEmailTags), nil
}

func (s *MemoryStore) ReplaceConversationEmailTags(ctx context.Context, conversationID string, tags []EmailProcessingTag, updatedBy string) ([]EmailProcessingTag, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return nil, fmt.Errorf("%w: conversation is required", ErrInvalid)
	}
	_ = updatedBy
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.conversations[conversationID]; !ok {
		return nil, ErrNotFound
	}
	cloned := append([]EmailProcessingTag(nil), tags...)
	if len(cloned) == 0 {
		delete(s.conversationEmailTags, conversationID)
		return []EmailProcessingTag{}, nil
	}
	s.conversationEmailTags[conversationID] = cloned
	return append([]EmailProcessingTag(nil), cloned...), nil
}

func cloneConversationEmailTags(input map[string][]EmailProcessingTag) map[string][]EmailProcessingTag {
	out := make(map[string][]EmailProcessingTag, len(input))
	for conversationID, tags := range input {
		out[conversationID] = append([]EmailProcessingTag(nil), tags...)
	}
	return out
}

func (s *MemoryStore) ListConversations(ctx context.Context, filter ConversationFilter) ([]Conversation, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	search := strings.ToLower(strings.TrimSpace(filter.Search))
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []Conversation{}
	for _, conversation := range s.conversations {
		if filter.ShopID != "" && conversation.ShopID != filter.ShopID {
			continue
		}
		if filter.SourceID != "" && conversation.SourceID != filter.SourceID {
			continue
		}
		if filter.Status != "" && conversation.Status != filter.Status {
			continue
		}
		if filter.ActiveOnly && (conversation.Status == ConversationStatusClosed || isHistoricalEmailConversation(conversation)) {
			continue
		}
		if filter.Kind != "" && conversation.Kind != normalizeConversationKind(filter.Kind) {
			continue
		}
		if filter.AssignedAgentID != "" && conversation.AssignedAgentID != filter.AssignedAgentID {
			continue
		}
		if filter.ActiveShopsOnly {
			shop, exists := s.shops[conversation.ShopID]
			if !exists || shop.Status != ShopStatusActive {
				continue
			}
		}
		if filter.ActiveSourcesOnly {
			source, exists := s.sources[conversation.SourceID]
			if !exists || source.ShopID != conversation.ShopID || source.Status != SourceStatusActive {
				continue
			}
		}
		if filter.ServiceLineOnly && isDiscardedEmailSender(conversation.CustomerEmail, conversation.CustomerName) && conversation.Classification != relayedCustomerInquiryClassification {
			continue
		}
		if filter.WorkbenchShopUserID != "" {
			shop, shopExists := s.shops[conversation.ShopID]
			_, assignedToShop := s.shopAgents[shopAgentKey(conversation.ShopID, filter.WorkbenchShopUserID)]
			if !shopExists || shop.Status != ShopStatusActive || !assignedToShop {
				continue
			}
		}
		if search != "" && !strings.Contains(strings.ToLower(conversation.CustomerName+" "+conversation.CustomerEmail+" "+conversation.Subject), search) {
			continue
		}
		if filter.WorkbenchUserID != "" {
			shop, shopExists := s.shops[conversation.ShopID]
			_, assignedToShop := s.shopAgents[shopAgentKey(conversation.ShopID, filter.WorkbenchUserID)]
			visible := conversation.AssignedAgentID == filter.WorkbenchUserID || (conversation.Status == ConversationStatusOpen && conversation.AssignedAgentID == "")
			if !visible {
				for _, transfer := range s.transferRequests {
					if transfer.ConversationID == conversation.ID && transfer.Status == TransferStatusPending &&
						(transfer.TargetAgentID == filter.WorkbenchUserID ||
							(filter.WorkbenchSkillGroup != "" && transfer.TargetSkillGroup == filter.WorkbenchSkillGroup)) {
						visible = true
						break
					}
				}
			}
			if !shopExists || shop.Status != ShopStatusActive || !assignedToShop || !visible {
				continue
			}
		}
		conversation.CustomerLastMessageAt = customerLastMessageAt(conversation.LastMessageAt, s.messages[conversation.ID])
		conversation.LastMessageDirection = latestConversationMessageDirection(s.messages[conversation.ID])
		if filter.UnreadUserID != "" {
			lastReadAt := s.conversationReads[conversationReadKey(filter.UnreadUserID, conversation.ID)]
			for _, message := range s.messages[conversation.ID] {
				if isUnreadConversationMessage(conversation.Kind, message.Direction) && message.CreatedAt.After(lastReadAt) {
					conversation.Unread = true
					break
				}
			}
		}
		out = append(out, conversation)
	}
	sort.Slice(out, func(i, j int) bool {
		if !out[i].CustomerLastMessageAt.Equal(out[j].CustomerLastMessageAt) {
			return out[i].CustomerLastMessageAt.After(out[j].CustomerLastMessageAt)
		}
		if !out[i].CreatedAt.Equal(out[j].CreatedAt) {
			return out[i].CreatedAt.After(out[j].CreatedAt)
		}
		return out[i].ID < out[j].ID
	})
	if filter.PageSize > 0 {
		page := filter.Page
		if page < 1 {
			page = 1
		}
		start := (page - 1) * filter.PageSize
		if start >= len(out) {
			return []Conversation{}, nil
		}
		end := start + filter.PageSize
		if end > len(out) {
			end = len(out)
		}
		out = out[start:end]
	}
	return out, nil
}

func (s *MemoryStore) CountConversations(ctx context.Context, filter ConversationFilter) (int, error) {
	filter.Page = 0
	filter.PageSize = 0
	items, err := s.ListConversations(ctx, filter)
	if err != nil {
		return 0, err
	}
	return len(items), nil
}

func customerLastMessageAt(fallback time.Time, messages []Message) time.Time {
	var latest time.Time
	for _, message := range messages {
		if isCustomerMessageDirection(message.Direction) && (latest.IsZero() || message.CreatedAt.After(latest)) {
			latest = message.CreatedAt
		}
	}
	if latest.IsZero() {
		return fallback
	}
	return latest
}

func latestConversationMessageDirection(messages []Message) string {
	return latestConversationMessage(messages).Direction
}

func latestConversationMessage(messages []Message) Message {
	var latest Message
	for _, message := range messages {
		if message.Direction != MessageDirectionCustomer && message.Direction != MessageDirectionAgent {
			continue
		}
		if latest.ID == "" || message.CreatedAt.After(latest.CreatedAt) || (message.CreatedAt.Equal(latest.CreatedAt) && message.ID > latest.ID) {
			latest = message
		}
	}
	return latest
}

func (s *MemoryStore) UpdateConversation(ctx context.Context, id string, input ConversationUpdate) (Conversation, error) {
	if err := ctx.Err(); err != nil {
		return Conversation{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	conversation, ok := s.conversations[strings.TrimSpace(id)]
	if !ok {
		return Conversation{}, ErrNotFound
	}
	if input.SetRecord && input.OnlyIfRecordUnclassified && conversation.RecordClassified {
		return conversation, nil
	}
	if input.SetRecord && input.OnlyIfRecordAutoFilled && !conversation.RecordAutoFilled {
		return conversation, nil
	}
	now := time.Now().UTC()
	if input.Status != "" {
		status, err := normalizeConversationStatus(input.Status)
		if err != nil {
			return Conversation{}, err
		}
		if status == ConversationStatusClosed && conversation.Status != ConversationStatusClosed {
			conversation.ClosedAt = now
		} else if status != ConversationStatusClosed {
			conversation.ClosedAt = time.Time{}
		}
		conversation.Status = status
	}
	if input.SetAssignedAgentID {
		conversation.AssignedAgentID = strings.TrimSpace(input.AssignedAgentID)
	}
	if input.SetCustomerIdentity {
		if value := strings.TrimSpace(input.CustomerName); value != "" {
			conversation.CustomerName = value
		}
		if value := strings.TrimSpace(input.CustomerEmail); value != "" {
			conversation.CustomerEmail = value
		}
	}
	if input.SetEmailDisposition {
		conversation.Kind = normalizeConversationKind(input.Kind)
		conversation.ReplyAllowed = input.ReplyAllowed
		conversation.Classification = strings.TrimSpace(input.Classification)
	}
	if input.SetRecord {
		conversation.RecordPrimary = strings.TrimSpace(input.RecordPrimary)
		conversation.RecordSecondary = strings.TrimSpace(input.RecordSecondary)
		conversation.RecordTertiary = strings.TrimSpace(input.RecordTertiary)
		conversation.RecordRemark = strings.TrimSpace(input.RecordRemark)
		conversation.RecordOrderNumber = strings.TrimSpace(input.RecordOrderNumber)
		conversation.RecordClassified = input.RecordClassified
		conversation.RecordAutoFilled = input.RecordAutoFilled
		conversation.RecordUpdatedAt = time.Now().UTC()
		conversation.RecordUpdatedBy = strings.TrimSpace(input.RecordUpdatedBy)
	}
	conversation.UpdatedAt = now
	s.conversations[conversation.ID] = conversation
	return conversation, nil
}

func (s *MemoryStore) PromoteSystemConversation(ctx context.Context, id string, replyAllowed bool, classification string) (Conversation, error) {
	if err := ctx.Err(); err != nil {
		return Conversation{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	id = strings.TrimSpace(id)
	conversation, ok := s.conversations[id]
	if !ok {
		return Conversation{}, ErrNotFound
	}
	if normalizeConversationKind(conversation.Kind) != ConversationKindSystem {
		return Conversation{}, fmt.Errorf("%w: 该邮件已进入客户会话", ErrConflict)
	}
	now := time.Now().UTC()
	conversation.Kind = ConversationKindCustomer
	conversation.ReplyAllowed = replyAllowed
	conversation.Classification = strings.TrimSpace(classification)
	conversation.Status = ConversationStatusOpen
	conversation.AssignedAgentID = ""
	conversation.ClosedAt = time.Time{}
	conversation.UpdatedAt = now
	messages := s.messages[id]
	for index := range messages {
		if strings.EqualFold(strings.TrimSpace(messages[index].Direction), MessageDirectionSystem) {
			messages[index].Direction = MessageDirectionCustomer
		}
	}
	s.messages[id] = messages
	for key := range s.conversationReads {
		if strings.HasSuffix(key, "\x00"+id) {
			delete(s.conversationReads, key)
		}
	}
	s.conversations[id] = conversation
	return conversation, nil
}

func (s *MemoryStore) BackfillConversationRecordLifecycle(ctx context.Context, id string, primary string, orderNumber string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	id = strings.TrimSpace(id)
	primary = strings.TrimSpace(primary)
	orderNumber = strings.TrimSpace(orderNumber)
	if id == "" || primary == "" {
		return ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	conversation, ok := s.conversations[id]
	if !ok {
		return ErrNotFound
	}
	if !conversation.RecordAutoFilled {
		return nil
	}
	conversation.RecordPrimary = primary
	if strings.TrimSpace(conversation.RecordOrderNumber) == "" && orderNumber != "" {
		conversation.RecordOrderNumber = orderNumber
	}
	s.conversations[id] = conversation
	return nil
}

func (s *MemoryStore) ClaimConversation(ctx context.Context, id string, userID string) (Conversation, error) {
	if err := ctx.Err(); err != nil {
		return Conversation{}, err
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return Conversation{}, fmt.Errorf("%w: userId is required", ErrInvalid)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	conversation, ok := s.conversations[strings.TrimSpace(id)]
	if !ok {
		return Conversation{}, ErrNotFound
	}
	if conversation.Status == ConversationStatusAssigned && conversation.AssignedAgentID == userID {
		return conversation, nil
	}
	if conversation.Status != ConversationStatusOpen || conversation.AssignedAgentID != "" {
		return Conversation{}, fmt.Errorf("%w: conversation is no longer available", ErrConflict)
	}
	conversation.Status = ConversationStatusAssigned
	conversation.AssignedAgentID = userID
	conversation.ClosedAt = time.Time{}
	conversation.UpdatedAt = time.Now().UTC()
	s.conversations[conversation.ID] = conversation
	return conversation, nil
}

func (s *MemoryStore) CloseConversation(ctx context.Context, id string, userID string) (Conversation, error) {
	if err := ctx.Err(); err != nil {
		return Conversation{}, err
	}
	userID = strings.TrimSpace(userID)
	s.mu.Lock()
	defer s.mu.Unlock()
	conversation, ok := s.conversations[strings.TrimSpace(id)]
	if !ok {
		return Conversation{}, ErrNotFound
	}
	if conversation.Status == ConversationStatusClosed && conversation.AssignedAgentID == userID {
		return conversation, nil
	}
	if conversation.Status != ConversationStatusAssigned || conversation.AssignedAgentID != userID {
		return Conversation{}, fmt.Errorf("%w: only the assigned agent can close the conversation", ErrConflict)
	}
	conversation.Status = ConversationStatusClosed
	conversation.ClosedAt = time.Now().UTC()
	conversation.UpdatedAt = conversation.ClosedAt
	s.conversations[conversation.ID] = conversation
	return conversation, nil
}

func (s *MemoryStore) CloseInactiveCustomerConversations(ctx context.Context, before time.Time) ([]Conversation, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	before = before.UTC()
	now := time.Now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()
	closed := make([]Conversation, 0)
	for id, conversation := range s.conversations {
		if conversation.Status != ConversationStatusAssigned || conversation.Kind != ConversationKindCustomer || conversation.AssignedAgentID == "" {
			continue
		}
		source, ok := s.sources[conversation.SourceID]
		if !ok || (source.Type != SourceTypeShopifyChat && source.Type != SourceTypeEmail) {
			continue
		}
		pendingEmailSend := false
		for _, message := range s.messages[id] {
			if emailSendStillNeedsAttention(message) {
				pendingEmailSend = true
				break
			}
		}
		if pendingEmailSend {
			continue
		}
		latest := latestConversationMessage(s.messages[id])
		if latest.Direction != MessageDirectionAgent || latest.CreatedAt.After(before) {
			continue
		}
		conversation.Status = ConversationStatusClosed
		conversation.ClosedAt = now
		conversation.UpdatedAt = now
		s.conversations[id] = conversation
		closed = append(closed, conversation)
	}
	return closed, nil
}

func (s *MemoryStore) ReopenConversation(ctx context.Context, id string, userID string) (Conversation, error) {
	if err := ctx.Err(); err != nil {
		return Conversation{}, err
	}
	userID = strings.TrimSpace(userID)
	s.mu.Lock()
	defer s.mu.Unlock()
	conversation, ok := s.conversations[strings.TrimSpace(id)]
	if !ok {
		return Conversation{}, ErrNotFound
	}
	if conversation.Status == ConversationStatusAssigned && conversation.AssignedAgentID == userID {
		return conversation, nil
	}
	if conversation.Status != ConversationStatusClosed || (conversation.AssignedAgentID != "" && conversation.AssignedAgentID != userID) {
		return Conversation{}, fmt.Errorf("%w: conversation cannot be reopened by this agent", ErrConflict)
	}
	conversation.Status = ConversationStatusAssigned
	conversation.AssignedAgentID = userID
	conversation.ClosedAt = time.Time{}
	conversation.UpdatedAt = time.Now().UTC()
	s.conversations[conversation.ID] = conversation
	return conversation, nil
}

func (s *MemoryStore) AddMessage(ctx context.Context, input Message) (Message, Conversation, error) {
	return s.addMessage(ctx, input, "")
}

func (s *MemoryStore) AddAgentMessage(ctx context.Context, input Message, userID string) (Message, Conversation, error) {
	return s.addMessage(ctx, input, strings.TrimSpace(userID))
}

func (s *MemoryStore) addMessage(ctx context.Context, input Message, agentID string) (Message, Conversation, error) {
	if err := ctx.Err(); err != nil {
		return Message{}, Conversation{}, err
	}
	if strings.TrimSpace(input.ConversationID) == "" {
		return Message{}, Conversation{}, fmt.Errorf("%w: conversationId is required", ErrInvalid)
	}
	if strings.TrimSpace(input.Body) == "" {
		return Message{}, Conversation{}, fmt.Errorf("%w: body is required", ErrInvalid)
	}
	now := time.Now().UTC()
	autoCreatedAt := input.CreatedAt.IsZero()
	createdAt := input.CreatedAt
	if autoCreatedAt {
		createdAt = now
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	conversation, ok := s.conversations[input.ConversationID]
	if !ok {
		return Message{}, Conversation{}, ErrNotFound
	}
	if autoCreatedAt && !createdAt.After(conversation.LastMessageAt) {
		createdAt = conversation.LastMessageAt.Add(time.Nanosecond)
	}
	if agentID != "" {
		if !conversation.ReplyAllowed {
			return Message{}, Conversation{}, fmt.Errorf("%w: this conversation is read-only", ErrForbidden)
		}
		if conversation.Status != ConversationStatusAssigned {
			return Message{}, Conversation{}, fmt.Errorf("%w: conversation must be claimed before replying", ErrConflict)
		}
		if conversation.AssignedAgentID != agentID {
			return Message{}, Conversation{}, fmt.Errorf("%w: conversation is assigned to another agent", ErrForbidden)
		}
		input.Direction = MessageDirectionAgent
		input.Metadata = mergeStringMaps(input.Metadata, map[string]string{messageAgentIDMetadataKey: agentID})
	}
	input.SourceMessageID = strings.TrimSpace(input.SourceMessageID)
	if input.SourceMessageID != "" {
		for _, existing := range s.messages[input.ConversationID] {
			if existing.SourceMessageID == input.SourceMessageID {
				return existing, conversation, nil
			}
		}
	}
	if input.ID == "" {
		input.ID = s.newIDLocked("msg")
	}
	input.Direction = defaultString(input.Direction, MessageDirectionCustomer)
	input, err := normalizeMessageContent(input)
	if err != nil {
		return Message{}, Conversation{}, err
	}
	input.Body = strings.TrimSpace(input.Body)
	input.SenderName = strings.TrimSpace(input.SenderName)
	input.SenderEmail = strings.TrimSpace(input.SenderEmail)
	input.CreatedAt = createdAt
	s.messages[input.ConversationID] = append(s.messages[input.ConversationID], input)
	if !isHistoricalEmailMessage(input) && isUnreadConversationMessage(conversation.Kind, input.Direction) {
		for key := range s.conversationReads {
			if strings.HasSuffix(key, "\x00"+input.ConversationID) {
				delete(s.conversationReads, key)
			}
		}
	}
	if !isHistoricalEmailMessage(input) && messageReopensConversation(conversation.Kind, input.Direction) {
		if conversation.Status == ConversationStatusClosed {
			conversation.Status = ConversationStatusOpen
			conversation.AssignedAgentID = ""
			conversation.ClosedAt = time.Time{}
		}
	}
	if createdAt.After(conversation.LastMessageAt) {
		conversation.LastMessageAt = createdAt
	}
	conversation.CustomerLastMessageAt = customerLastMessageAt(conversation.LastMessageAt, s.messages[conversation.ID])
	conversation.LastMessageDirection = latestConversationMessageDirection(s.messages[conversation.ID])
	conversation.UpdatedAt = now
	s.conversations[conversation.ID] = conversation
	return input, conversation, nil
}

func normalizeMessageType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case MessageTypeImage:
		return MessageTypeImage
	case MessageTypeFile:
		return MessageTypeFile
	case MessageTypeProduct:
		return MessageTypeProduct
	default:
		return MessageTypeText
	}
}

func normalizeConversationKind(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case ConversationKindSystem:
		return ConversationKindSystem
	case ConversationKindDepartment:
		return ConversationKindDepartment
	}
	return ConversationKindCustomer
}

func messageReopensConversation(kind string, direction string) bool {
	return isCustomerMessageDirection(direction) ||
		(emailStatisticsConversationKind(kind) && strings.EqualFold(strings.TrimSpace(direction), MessageDirectionSystem))
}

func isInboundMessageDirection(value string) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	return value == MessageDirectionCustomer || value == MessageDirectionSystem
}

func isCustomerMessageDirection(value string) bool {
	return strings.EqualFold(strings.TrimSpace(value), MessageDirectionCustomer)
}

func isUnreadConversationMessage(kind string, direction string) bool {
	if isCustomerMessageDirection(direction) {
		return true
	}
	return emailStatisticsConversationKind(kind) &&
		strings.EqualFold(strings.TrimSpace(direction), MessageDirectionSystem)
}

func cloneStringMap(input map[string]string) map[string]string {
	if len(input) == 0 {
		return nil
	}
	out := make(map[string]string, len(input))
	for key, value := range input {
		out[key] = value
	}
	return out
}

func (s *MemoryStore) ListMessages(ctx context.Context, conversationID string) ([]Message, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.conversations[conversationID]; !ok {
		return nil, ErrNotFound
	}
	items := s.messages[conversationID]
	out := make([]Message, len(items))
	copy(out, items)
	return out, nil
}

func (s *MemoryStore) GetMessage(ctx context.Context, conversationID string, messageID string) (Message, error) {
	if err := ctx.Err(); err != nil {
		return Message{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.conversations[conversationID]; !ok {
		return Message{}, ErrNotFound
	}
	for _, message := range s.messages[conversationID] {
		if message.ID == strings.TrimSpace(messageID) {
			return message, nil
		}
	}
	return Message{}, ErrNotFound
}

func (s *MemoryStore) ListMessagePage(ctx context.Context, conversationID string, beforeMessageID string, limit int) ([]Message, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.conversations[conversationID]; !ok {
		return nil, ErrNotFound
	}
	items := s.messages[conversationID]
	end := len(items)
	if beforeMessageID != "" {
		for index, message := range items {
			if message.ID == beforeMessageID {
				end = index
				break
			}
		}
	}
	if limit <= 0 {
		limit = 50
	}
	start := end - limit
	if start < 0 {
		start = 0
	}
	out := append([]Message(nil), items[start:end]...)
	return out, nil
}

func (s *MemoryStore) ListMessageRange(ctx context.Context, conversationID string, afterMessageID string, throughMessageID string) ([]Message, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.conversations[conversationID]; !ok {
		return nil, ErrNotFound
	}
	items := s.messages[conversationID]
	start, end := 0, len(items)
	if afterMessageID != "" {
		for index, message := range items {
			if message.ID == afterMessageID {
				start = index + 1
				break
			}
		}
	}
	if throughMessageID != "" {
		for index, message := range items {
			if message.ID == throughMessageID {
				end = index + 1
				break
			}
		}
	}
	if start > end {
		return []Message{}, nil
	}
	return append([]Message(nil), items[start:end]...), nil
}

func (s *MemoryStore) ListResponseSamples(ctx context.Context) ([]ResponseSample, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []ResponseSample{}
	for _, conversation := range s.conversations {
		var pending *time.Time
		first := true
		for _, message := range s.messages[conversation.ID] {
			if isHistoricalEmailMessage(message) {
				continue
			}
			if message.Direction == MessageDirectionCustomer {
				createdAt := message.CreatedAt
				pending = &createdAt
				continue
			}
			if message.Direction != MessageDirectionAgent || pending == nil {
				continue
			}
			agentID := strings.TrimSpace(message.Metadata[messageAgentIDMetadataKey])
			if agentID == "" {
				agentID = conversation.AssignedAgentID
			}
			seconds := message.CreatedAt.Sub(*pending).Seconds()
			if seconds >= 0 && agentID != "" {
				out = append(out, ResponseSample{
					AgentID: agentID, ConversationID: conversation.ID, Seconds: seconds, First: first,
					StartedAt: *pending, EndedAt: message.CreatedAt,
				})
				first = false
			}
			pending = nil
		}
	}
	return out, nil
}

func (s *MemoryStore) UpdateMessageMetadata(ctx context.Context, conversationID string, messageID string, patch map[string]string) (Message, error) {
	if err := ctx.Err(); err != nil {
		return Message{}, err
	}
	conversationID = strings.TrimSpace(conversationID)
	messageID = strings.TrimSpace(messageID)
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.conversations[conversationID]; !ok {
		return Message{}, ErrNotFound
	}
	messages := s.messages[conversationID]
	for index := range messages {
		if messages[index].ID != messageID {
			continue
		}
		metadata := cloneStringMap(messages[index].Metadata)
		if metadata == nil {
			metadata = map[string]string{}
		}
		for key, value := range patch {
			key = strings.TrimSpace(key)
			if key != "" {
				metadata[key] = strings.TrimSpace(value)
			}
		}
		messages[index].Metadata = metadata
		s.messages[conversationID] = messages
		return messages[index], nil
	}
	return Message{}, ErrNotFound
}

func (s *MemoryStore) ListUnreadConversationIDs(ctx context.Context, userID string) ([]string, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	userID = strings.TrimSpace(userID)
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []string{}
	for conversationID, messages := range s.messages {
		conversation, exists := s.conversations[conversationID]
		if !exists {
			continue
		}
		lastReadAt := s.conversationReads[conversationReadKey(userID, conversationID)]
		for _, message := range messages {
			if isHistoricalEmailMessage(message) {
				continue
			}
			if isUnreadConversationMessage(conversation.Kind, message.Direction) && message.CreatedAt.After(lastReadAt) {
				out = append(out, conversationID)
				break
			}
		}
	}
	return out, nil
}

func (s *MemoryStore) MarkConversationRead(ctx context.Context, userID string, conversationID string, readAt time.Time) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	userID = strings.TrimSpace(userID)
	conversationID = strings.TrimSpace(conversationID)
	if userID == "" || conversationID == "" {
		return fmt.Errorf("%w: userId and conversationId are required", ErrInvalid)
	}
	if readAt.IsZero() {
		readAt = time.Now().UTC()
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.users[userID]; !ok {
		return ErrNotFound
	}
	if _, ok := s.conversations[conversationID]; !ok {
		return ErrNotFound
	}
	key := conversationReadKey(userID, conversationID)
	if current := s.conversationReads[key]; current.After(readAt) {
		return nil
	}
	s.conversationReads[key] = readAt.UTC()
	return nil
}

func conversationReadKey(userID string, conversationID string) string {
	return strings.TrimSpace(userID) + "\x00" + strings.TrimSpace(conversationID)
}

func (s *MemoryStore) newIDLocked(prefix string) string {
	s.next++
	return fmt.Sprintf("%s_%d", prefix, s.next)
}

func defaultString(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

func normalizeConversationStatus(status string) (string, error) {
	status = strings.TrimSpace(status)
	switch status {
	case ConversationStatusOpen, ConversationStatusAssigned, ConversationStatusClosed:
		return status, nil
	default:
		return "", fmt.Errorf("%w: unsupported conversation status", ErrInvalid)
	}
}

func normalizeSourceStatus(status string) (string, error) {
	status = strings.TrimSpace(status)
	switch status {
	case SourceStatusActive, SourceStatusDisabled:
		return status, nil
	default:
		return "", fmt.Errorf("%w: unsupported source status", ErrInvalid)
	}
}

func defaultSourceStatus(source ShopSource) string {
	if strings.TrimSpace(source.Status) != "" {
		return source.Status
	}
	if strings.TrimSpace(source.Type) == SourceTypeShopifyAPI && sourceShopifyDomain(source) == "" {
		return SourceStatusDisabled
	}
	if strings.TrimSpace(source.Type) == SourceTypeEmail && sourceEmailAddress(source) == "" {
		return SourceStatusDisabled
	}
	return SourceStatusActive
}

func isConnectedChannelSource(source ShopSource) bool {
	if source.Status != SourceStatusActive {
		return false
	}
	if source.Type == SourceTypeShopifyAPI {
		return sourceShopifyDomain(source) != ""
	}
	if source.Type == SourceTypeEmail {
		return sourceEmailAddress(source) != ""
	}
	return true
}

func sourceShopifyDomain(source ShopSource) string {
	if domain := normalizeShopifyDomain(source.Address); domain != "" {
		return domain
	}
	if source.Metadata == nil {
		return ""
	}
	return normalizeShopifyDomain(source.Metadata["shopifyDomain"])
}

func sourceEmailAddress(source ShopSource) string {
	if address := strings.TrimSpace(source.Address); address != "" {
		return address
	}
	if source.Metadata == nil {
		return ""
	}
	return strings.TrimSpace(source.Metadata["mailbox"])
}

func normalizeShopStatus(status string) (string, error) {
	switch strings.TrimSpace(status) {
	case "", ShopStatusActive:
		return ShopStatusActive, nil
	case ShopStatusDisabled:
		return ShopStatusDisabled, nil
	default:
		return "", fmt.Errorf("%w: unsupported shop status", ErrInvalid)
	}
}

func normalizeUserStatus(status string) (string, error) {
	switch strings.TrimSpace(status) {
	case "", UserStatusActive:
		return UserStatusActive, nil
	case UserStatusDisabled:
		return UserStatusDisabled, nil
	default:
		return "", fmt.Errorf("%w: unsupported user status", ErrInvalid)
	}
}

func normalizeKnowledgeEntry(entry KnowledgeEntry, creating bool) (KnowledgeEntry, error) {
	entry.SupersedesID = strings.TrimSpace(entry.SupersedesID)
	entry.Scope = defaultString(entry.Scope, KnowledgeScopeShop)
	if entry.Scope != KnowledgeScopeGlobal && entry.Scope != KnowledgeScopeShop {
		return KnowledgeEntry{}, fmt.Errorf("%w: unsupported knowledge scope", ErrInvalid)
	}
	entry.ShopID = strings.TrimSpace(entry.ShopID)
	if entry.Scope == KnowledgeScopeGlobal {
		entry.ShopID = ""
	} else if entry.ShopID == "" {
		return KnowledgeEntry{}, fmt.Errorf("%w: shopId is required for shop knowledge", ErrInvalid)
	}
	entry.Title = strings.TrimSpace(entry.Title)
	entry.Answer = strings.TrimSpace(entry.Answer)
	if entry.Title == "" || entry.Answer == "" {
		return KnowledgeEntry{}, fmt.Errorf("%w: title and answer are required", ErrInvalid)
	}
	entry.Status = defaultString(entry.Status, KnowledgeStatusPending)
	if entry.Status != KnowledgeStatusPending && entry.Status != KnowledgeStatusPublished && entry.Status != KnowledgeStatusRejected {
		return KnowledgeEntry{}, fmt.Errorf("%w: unsupported knowledge status", ErrInvalid)
	}
	if entry.SupersedesID != "" && entry.Status == KnowledgeStatusPublished {
		return KnowledgeEntry{}, fmt.Errorf("%w: a knowledge revision cannot be published directly", ErrInvalid)
	}
	entry.ConversationID = strings.TrimSpace(entry.ConversationID)
	entry.SubmittedBy = strings.TrimSpace(entry.SubmittedBy)
	entry.ReviewedBy = strings.TrimSpace(entry.ReviewedBy)
	entry.ReviewNote = strings.TrimSpace(entry.ReviewNote)
	entry.Tags = normalizeKnowledgeTags(entry.Tags)
	if creating && entry.Status == KnowledgeStatusPublished && entry.ReviewedAt.IsZero() {
		entry.ReviewedAt = time.Now().UTC()
	}
	return entry, nil
}

func normalizeKnowledgeTags(values []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[strings.ToLower(value)] {
			continue
		}
		seen[strings.ToLower(value)] = true
		out = append(out, value)
	}
	return out
}

func shopAgentKey(shopID string, userID string) string {
	return shopID + "\x00" + userID
}

func emailInstallationKey(shopID string, mailbox string) string {
	return strings.TrimSpace(shopID) + "\x00" + normalizeEmail(mailbox)
}
