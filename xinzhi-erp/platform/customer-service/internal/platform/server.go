package platform

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"golang.org/x/sync/singleflight"
)

type Server struct {
	store                       Store
	uploadDir                   string
	upgrader                    websocket.Upgrader
	erpIdentityVerifier         ERPIdentityVerifier
	nativeTenantID              string
	nativeTenantMode            bool
	erpExchangeMu               sync.Mutex
	erpSessionMu                sync.RWMutex
	erpSessionIdentities        map[string]ERPIdentity
	erpIdentityChecks           singleflight.Group
	localDemo                   bool
	allowedOriginsMu            sync.RWMutex
	allowedOrigins              map[string]bool
	wsTicketsMu                 sync.Mutex
	wsTickets                   map[string]wsTicketGrant
	wsTicketRouteHook           func(string)
	shopifyConnectionChecker    func(context.Context, string, string) ShopifyConnectionStatus
	shopifySessionTokenExchange func(context.Context, string, string, shopifyAppSettings) (shopifyOAuthTokenResponse, error)
	publicShopifyOrderSearch    func(context.Context, string, string, string, int) (ShopifyOrderSearchResult, error)
	publicShopifyCustomerLookup func(context.Context, string, string, string) (ShopifyCustomerSearchResult, error)
	shopifyCustomerSearch       func(context.Context, string, string, string) (ShopifyCustomerSearchResult, error)
	shopifyOrderAddressUpdate   func(context.Context, string, string, ShopifyOrderShippingAddressUpdate) (ShopifyMailingAddress, error)
	shopifyTrackingInfoUpdate   func(context.Context, string, string, ShopifyFulfillmentTrackingUpdate) (ShopifyFulfillment, error)
	shopifyAfterSales           shopifyAfterSalesService
	shopifyOrderPageSearch      func(context.Context, string, string, string, int, string) (shopifyOrderPage, error)
	logisticsTracker            LogisticsTracker

	clientsMu sync.Mutex
	clients   map[*websocket.Conn]*eventClient

	chatClientsMu sync.Mutex
	chatClients   map[string]map[*websocket.Conn]*chatEventClient

	emailSyncLocksMu      sync.Mutex
	emailSyncLocks        map[string]*sync.Mutex
	emailHistoryLocksMu   sync.Mutex
	emailHistoryLocks     map[string]*sync.Mutex
	emailHistoryRunMu     sync.Mutex
	emailHistoryRunning   map[string]bool
	emailHistoryLimit     chan struct{}
	emailHistoryWake      chan struct{}
	emailSyncWake         map[string]chan struct{}
	standardIMAPWake      chan struct{}
	emailExportWake       chan struct{}
	emailAttachmentWake   chan struct{}
	emailAttachmentRunMu  sync.Mutex
	emailAttachmentRun    map[string]bool
	emailOutboxWake       chan struct{}
	emailPushMu           sync.Mutex
	emailPushEnabled      bool
	emailProviderGateMu   sync.Mutex
	emailProviderGates    map[string]time.Time
	emailProviderFailures map[string]map[string]time.Time

	gmailPushAuthMu    sync.Mutex
	gmailPushAuthCache map[string]time.Time

	recordAutoLocksMu sync.Mutex
	recordAutoLocks   map[string]*translationLock

	logisticsDraftLocksMu sync.Mutex
	logisticsDraftLocks   map[string]*translationLock

	messageTranslationLocksMu sync.Mutex
	messageTranslationLocks   map[string]*translationLock

	routingMu        sync.Mutex
	routingLastAgent map[string]string
	routingJobsMu    sync.Mutex
	routingJobs      map[string]bool

	aiLimit       chan struct{}
	aiQueue       chan aiBackgroundJob
	aiWorkersOnce sync.Once
	aiQueuedMu    sync.Mutex
	aiQueued      map[string]bool

	productRecommendationsMu sync.Mutex
	productRecommendations   map[string]cachedShopifyProducts
	productRecommendationRun singleflight.Group
	logisticsTrackingRun     singleflight.Group
	publicTrackingReplyRun   singleflight.Group

	monitorCacheMu sync.Mutex
	monitorCache   map[string]cachedMonitorOverview

	orderSyncMu        sync.Mutex
	orderSyncSnapshots map[string]shopifyOrderSyncSnapshot
	orderSyncHighWake  chan struct{}
	orderSyncAllWake   chan struct{}
}

type customerLoginRequirementRequest struct {
	Required bool `json:"required"`
}

type customerLoginRequirementResponse struct {
	Updated int          `json:"updated"`
	Sources []ShopSource `json:"sources"`
}

type eventClient struct {
	user          User
	permissionsMu sync.RWMutex
	assignedShop  map[string]bool
	writeMu       sync.Mutex
	send          chan Event
	done          chan struct{}
	stopOnce      sync.Once
}

type chatEventClient struct {
	writeMu  sync.Mutex
	send     chan Event
	done     chan struct{}
	stopOnce sync.Once
}

type wsTicketGrant struct {
	SessionToken string
	Origin       string
	ExpiresAt    time.Time
}

type translationLock struct {
	mu   sync.Mutex
	refs int
}

const (
	aiTotalConcurrency      = 32
	aiBackgroundWorkerCount = 16
	eventHeartbeatInterval  = 20 * time.Second
	eventHeartbeatTimeout   = 55 * time.Second
	eventWriteTimeout       = 10 * time.Second
	eventClientQueueSize    = 128
	chatClientQueueSize     = 64
)

func NewServer(store Store) *Server {
	server := &Server{
		store:                   store,
		uploadDir:               defaultChatUploadDir(),
		clients:                 map[*websocket.Conn]*eventClient{},
		erpSessionIdentities:    map[string]ERPIdentity{},
		allowedOrigins:          map[string]bool{},
		wsTickets:               map[string]wsTicketGrant{},
		chatClients:             map[string]map[*websocket.Conn]*chatEventClient{},
		emailSyncLocks:          map[string]*sync.Mutex{},
		emailHistoryLocks:       map[string]*sync.Mutex{},
		emailHistoryRunning:     map[string]bool{},
		emailHistoryLimit:       make(chan struct{}, 1),
		emailHistoryWake:        make(chan struct{}, 1),
		emailSyncWake:           newEmailSyncWakeChannels(),
		standardIMAPWake:        make(chan struct{}, 1),
		emailExportWake:         make(chan struct{}, 1),
		emailAttachmentWake:     make(chan struct{}, 2),
		emailAttachmentRun:      map[string]bool{},
		emailOutboxWake:         make(chan struct{}, 4),
		emailProviderGates:      map[string]time.Time{},
		emailProviderFailures:   map[string]map[string]time.Time{},
		gmailPushAuthCache:      map[string]time.Time{},
		recordAutoLocks:         map[string]*translationLock{},
		logisticsDraftLocks:     map[string]*translationLock{},
		messageTranslationLocks: map[string]*translationLock{},
		routingLastAgent:        map[string]string{},
		routingJobs:             map[string]bool{},
		aiLimit:                 make(chan struct{}, aiTotalConcurrency),
		aiQueue:                 make(chan aiBackgroundJob, 1000),
		aiQueued:                map[string]bool{},
		productRecommendations:  map[string]cachedShopifyProducts{},
		monitorCache:            map[string]cachedMonitorOverview{},
		orderSyncSnapshots:      map[string]shopifyOrderSyncSnapshot{},
		orderSyncHighWake:       make(chan struct{}, shopifyOrderSyncWorkerCount-shopifyOrderReconcileWorkerCount),
		orderSyncAllWake:        make(chan struct{}, shopifyOrderReconcileWorkerCount),
		shopifySessionTokenExchange: func(ctx context.Context, shop string, sessionToken string, cfg shopifyAppSettings) (shopifyOAuthTokenResponse, error) {
			return exchangeShopifySessionToken(ctx, shop, sessionToken, cfg)
		},
		publicShopifyOrderSearch: func(ctx context.Context, domain string, token string, query string, limit int) (ShopifyOrderSearchResult, error) {
			return (shopifyAdminClient{HTTPClient: &http.Client{Timeout: 15 * time.Second}}).SearchOrders(ctx, domain, token, query, limit)
		},
		publicShopifyCustomerLookup: func(ctx context.Context, domain string, token string, customerID string) (ShopifyCustomerSearchResult, error) {
			return (shopifyAdminClient{HTTPClient: &http.Client{Timeout: 15 * time.Second}}).GetCustomer(ctx, domain, token, customerID)
		},
		shopifyCustomerSearch: func(ctx context.Context, domain string, token string, email string) (ShopifyCustomerSearchResult, error) {
			return (shopifyAdminClient{HTTPClient: &http.Client{Timeout: 15 * time.Second}}).SearchCustomer(ctx, domain, token, email)
		},
		shopifyOrderAddressUpdate: func(ctx context.Context, domain string, token string, input ShopifyOrderShippingAddressUpdate) (ShopifyMailingAddress, error) {
			return (shopifyAdminClient{HTTPClient: &http.Client{Timeout: 15 * time.Second}}).UpdateOrderShippingAddress(ctx, domain, token, input)
		},
		shopifyTrackingInfoUpdate: func(ctx context.Context, domain string, token string, input ShopifyFulfillmentTrackingUpdate) (ShopifyFulfillment, error) {
			return (shopifyAdminClient{HTTPClient: &http.Client{Timeout: 15 * time.Second}}).UpdateFulfillmentTracking(ctx, domain, token, input)
		},
		shopifyAfterSales: shopifyAdminClient{HTTPClient: &http.Client{Timeout: 20 * time.Second}},
	}
	server.upgrader = websocket.Upgrader{CheckOrigin: server.websocketOriginAllowed}
	server.shopifyOrderPageSearch = (shopifyAdminClient{HTTPClient: &http.Client{Timeout: 25 * time.Second}}).SearchOrdersPage
	server.logisticsTracker = &seventeenTrackService{server: server, client: &http.Client{Timeout: 35 * time.Second}}
	return server
}

func (s *Server) lockConversationRecordAuto(conversationID string) func() {
	s.recordAutoLocksMu.Lock()
	entry := s.recordAutoLocks[conversationID]
	if entry == nil {
		entry = &translationLock{}
		s.recordAutoLocks[conversationID] = entry
	}
	entry.refs++
	s.recordAutoLocksMu.Unlock()

	entry.mu.Lock()
	return func() {
		entry.mu.Unlock()
		s.recordAutoLocksMu.Lock()
		entry.refs--
		if entry.refs == 0 {
			delete(s.recordAutoLocks, conversationID)
		}
		s.recordAutoLocksMu.Unlock()
	}
}

func (s *Server) lockMessageTranslation(messageID string) func() {
	s.messageTranslationLocksMu.Lock()
	entry := s.messageTranslationLocks[messageID]
	if entry == nil {
		entry = &translationLock{}
		s.messageTranslationLocks[messageID] = entry
	}
	entry.refs++
	s.messageTranslationLocksMu.Unlock()

	entry.mu.Lock()
	return func() {
		entry.mu.Unlock()
		s.messageTranslationLocksMu.Lock()
		entry.refs--
		if entry.refs == 0 {
			delete(s.messageTranslationLocks, messageID)
		}
		s.messageTranslationLocksMu.Unlock()
	}
}

func (s *Server) lockConversationLogisticsDraft(conversationID string) func() {
	s.logisticsDraftLocksMu.Lock()
	entry := s.logisticsDraftLocks[conversationID]
	if entry == nil {
		entry = &translationLock{}
		s.logisticsDraftLocks[conversationID] = entry
	}
	entry.refs++
	s.logisticsDraftLocksMu.Unlock()

	entry.mu.Lock()
	return func() {
		entry.mu.Unlock()
		s.logisticsDraftLocksMu.Lock()
		entry.refs--
		if entry.refs == 0 {
			delete(s.logisticsDraftLocks, conversationID)
		}
		s.logisticsDraftLocksMu.Unlock()
	}
}

func (s *Server) emailSourceSyncLock(sourceID string) *sync.Mutex {
	s.emailSyncLocksMu.Lock()
	defer s.emailSyncLocksMu.Unlock()
	lock := s.emailSyncLocks[sourceID]
	if lock == nil {
		lock = &sync.Mutex{}
		s.emailSyncLocks[sourceID] = lock
	}
	return lock
}

func (s *Server) emailHistoryLock(sourceID string) *sync.Mutex {
	s.emailHistoryLocksMu.Lock()
	defer s.emailHistoryLocksMu.Unlock()
	lock := s.emailHistoryLocks[sourceID]
	if lock == nil {
		lock = &sync.Mutex{}
		s.emailHistoryLocks[sourceID] = lock
	}
	return lock
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/bootstrap/status", s.handleBootstrapStatus)
	mux.HandleFunc("GET /healthz", s.handleHealth)
	mux.HandleFunc("POST /api/v1/bootstrap/admin", s.handleBootstrapAdmin)
	mux.HandleFunc("POST /api/v1/auth/login", s.handleLogin)
	mux.HandleFunc("POST /api/v1/auth/erp/entry", s.handleERPIdentityEntry)
	mux.HandleFunc("POST /api/v1/auth/ws-ticket", s.handleWSTicket)
	mux.HandleFunc("GET /api/v1/auth/me", s.handleMe)
	mux.HandleFunc("PATCH /api/v1/auth/me/routing", s.handleMyRouting)
	mux.HandleFunc("PATCH /api/v1/auth/me/presence", s.handleMyPresence)
	mux.HandleFunc("POST /api/v1/auth/logout", s.handleLogout)
	mux.HandleFunc("GET /api/v1/email/outlook/status", s.handleOutlookConfigStatus)
	mux.HandleFunc("GET /api/v1/email/gmail/status", s.handleGmailConfigStatus)
	mux.HandleFunc("GET /api/v1/email/operations", s.handleEmailRuntimeEvents)
	mux.HandleFunc("GET /api/v1/settings/ai", s.handleAISettings)
	mux.HandleFunc("PUT /api/v1/settings/ai", s.handleAISettings)
	mux.HandleFunc("POST /api/v1/settings/ai/test", s.handleAISettingsTest)
	mux.HandleFunc("POST /api/v1/settings/ai/models/sync", s.handleAIModelsSync)
	mux.HandleFunc("GET /api/v1/settings/logistics", s.handleLogisticsSettings)
	mux.HandleFunc("PUT /api/v1/settings/logistics", s.handleLogisticsSettings)
	mux.HandleFunc("POST /api/v1/settings/logistics/test", s.handleLogisticsSettingsTest)
	mux.HandleFunc("GET /api/v1/settings/email-providers/cuiqiu", s.handleCuiqiuDomainSettings)
	mux.HandleFunc("PUT /api/v1/settings/email-providers/cuiqiu", s.handleCuiqiuDomainSettings)
	mux.HandleFunc("POST /api/v1/settings/email-providers/cuiqiu/test", s.handleCuiqiuDomainSettingsTest)
	mux.HandleFunc("GET /api/v1/settings/monitor-work-schedule", s.handleMonitorWorkSchedule)
	mux.HandleFunc("PUT /api/v1/settings/monitor-work-schedule", s.handleMonitorWorkSchedule)
	mux.HandleFunc("GET /api/v1/settings/sla", s.handleSLASettings)
	mux.HandleFunc("PUT /api/v1/settings/sla", s.handleSLASettings)
	mux.HandleFunc("GET /api/v1/settings/record-categories", s.handleRecordCategories)
	mux.HandleFunc("PUT /api/v1/settings/record-categories", s.handleRecordCategories)
	mux.HandleFunc("GET /api/v1/visitor-schemes", s.handleVisitorSchemes)
	mux.HandleFunc("POST /api/v1/visitor-schemes", s.handleVisitorSchemes)
	mux.HandleFunc("PATCH /api/v1/visitor-schemes/", s.handleVisitorSchemes)
	mux.HandleFunc("DELETE /api/v1/visitor-schemes/", s.handleVisitorSchemes)
	mux.HandleFunc("POST /api/v1/visitor-schemes/", s.handleVisitorSchemes)
	mux.HandleFunc("PATCH /api/v1/customer-login", s.handleCustomerLoginRequirement)
	mux.HandleFunc("GET /api/v1/processing-records", s.handleProcessingRecords)
	mux.HandleFunc("GET /api/v1/processing-records/export", s.handleProcessingRecordsExport)
	mux.HandleFunc("GET /api/v1/users", s.handleListUsers)
	mux.HandleFunc("POST /api/v1/users", s.handleCreateUser)
	mux.HandleFunc("GET /api/v1/users/", s.handleUserSubroutes)
	mux.HandleFunc("PATCH /api/v1/users/", s.handleUserSubroutes)
	mux.HandleFunc("DELETE /api/v1/users/", s.handleUserSubroutes)
	mux.HandleFunc("GET /api/v1/shops", s.handleListShops)
	mux.HandleFunc("GET /api/v1/shops/export", s.handleShopExport)
	mux.HandleFunc("GET /api/v1/sources", s.handleListSources)
	mux.HandleFunc("GET /api/v1/shop-assignments", s.handleListShopAssignments)
	mux.HandleFunc("POST /api/v1/shops", s.handleCreateShop)
	mux.HandleFunc("POST /api/v1/shops/", s.handleShopSubroutes)
	mux.HandleFunc("GET /api/v1/shops/", s.handleShopSubroutes)
	mux.HandleFunc("PATCH /api/v1/shops/", s.handleShopSubroutes)
	mux.HandleFunc("DELETE /api/v1/shops/", s.handleShopSubroutes)
	mux.HandleFunc("GET /api/v1/conversations/summary", s.handleConversationSummary)
	mux.HandleFunc("GET /api/v1/conversations", s.handleListConversations)
	mux.HandleFunc("GET /api/v1/email-processing", s.handleEmailProcessing)
	mux.HandleFunc("GET /api/v1/email-processing/", s.handleEmailProcessingSubroutes)
	mux.HandleFunc("POST /api/v1/email-processing/", s.handleEmailProcessingSubroutes)
	mux.HandleFunc("PUT /api/v1/email-processing/", s.handleEmailProcessingSubroutes)
	mux.HandleFunc("GET /api/v1/email-statistics", s.handleEmailStatistics)
	mux.HandleFunc("POST /api/v1/email-statistics/refresh", s.handleEmailStatisticsRefresh)
	mux.HandleFunc("POST /api/v1/email-statistics/exports", s.handleCreateEmailStatisticsExport)
	mux.HandleFunc("GET /api/v1/email-statistics/exports/", s.handleEmailStatisticsExportSubroutes)
	mux.HandleFunc("GET /api/v1/email-statistics/", s.handleEmailStatisticsSubroutes)
	mux.HandleFunc("PUT /api/v1/email-statistics/", s.handleEmailStatisticsSubroutes)
	mux.HandleFunc("POST /api/v1/email-statistics/", s.handleEmailStatisticsSubroutes)
	mux.HandleFunc("POST /api/v1/conversations", s.handleCreateConversation)
	mux.HandleFunc("POST /api/v1/ingest/conversations", s.handleIngestConversation)
	mux.HandleFunc("GET /api/v1/knowledge", s.handleKnowledge)
	mux.HandleFunc("POST /api/v1/knowledge/import", s.handleKnowledgeImport)
	mux.HandleFunc("GET /api/v1/monitor/response-metrics", s.handleResponseMetrics)
	mux.HandleFunc("GET /api/v1/monitor/overview", s.handleMonitorOverview)
	mux.HandleFunc("GET /api/v1/monitor/conversations", s.handleMonitorConversations)
	mux.HandleFunc("GET /api/v1/monitor/conversations/", s.handleMonitorConversationSubroutes)
	mux.HandleFunc("GET /api/v1/statistics", s.handleHistoricalStatistics)
	mux.HandleFunc("GET /api/v1/statistics/export", s.handleHistoricalStatisticsExport)
	mux.HandleFunc("GET /api/v1/shopify/orders", s.handleSyncedShopifyOrders)
	mux.HandleFunc("GET /api/v1/shopify/orders/sync", s.handleShopifyOrderSync)
	mux.HandleFunc("POST /api/v1/shopify/orders/sync", s.handleShopifyOrderSync)
	mux.HandleFunc("GET /api/v1/shopify/authorization-status", s.handleShopifyAuthorizationStatus)
	mux.HandleFunc("GET /api/v1/logistics/status", s.handleLogisticsStatus)
	mux.HandleFunc("POST /api/v1/logistics/track", s.handleLogisticsTrack)
	mux.HandleFunc("POST /api/v1/knowledge", s.handleKnowledge)
	mux.HandleFunc("PATCH /api/v1/knowledge/", s.handleKnowledgeSubroutes)
	mux.HandleFunc("DELETE /api/v1/knowledge/", s.handleKnowledgeSubroutes)
	mux.HandleFunc("GET /api/v1/conversations/", s.handleConversationSubroutes)
	mux.HandleFunc("PATCH /api/v1/conversations/", s.handleConversationSubroutes)
	mux.HandleFunc("POST /api/v1/conversations/", s.handleConversationSubroutes)
	mux.HandleFunc("GET /api/v1/transfers", s.handleTransfers)
	mux.HandleFunc("POST /api/v1/transfers/", s.handleTransferSubroutes)
	mux.HandleFunc("GET /api/v1/tickets", s.handleTickets)
	mux.HandleFunc("POST /api/v1/tickets", s.handleTickets)
	mux.HandleFunc("GET /api/v1/ticket-summary", s.handleTicketSummary)
	mux.HandleFunc("GET /api/v1/ticket-assignees", s.handleTicketAssignees)
	mux.HandleFunc("GET /api/v1/ticket-customers", s.handleTicketCustomers)
	mux.HandleFunc("GET /api/v1/tickets/", s.handleTicketSubroutes)
	mux.HandleFunc("PATCH /api/v1/tickets/", s.handleTicketSubroutes)
	mux.HandleFunc("POST /api/v1/tickets/", s.handleTicketSubroutes)
	mux.HandleFunc("GET /auth", s.handleShopifyInstall)
	mux.HandleFunc("GET /auth/callback", s.handleShopifyCallback)
	mux.HandleFunc("POST /api/v1/shopify/session/exchange", s.handleShopifySessionExchange)
	mux.HandleFunc("POST /api/v1/erp-connector/shopify/connection", s.handleERPConnectorShopifyConnection)
	mux.HandleFunc("POST /api/v1/erp-connector/shopify/product-catalog", s.handleERPConnectorShopifyProductCatalog)
	mux.HandleFunc("POST /api/v1/erp-connector/shopify/order-catalog", s.handleERPConnectorShopifyOrderCatalog)
	mux.HandleFunc("POST /api/v1/erp-connector/shopify/customer-catalog", s.handleERPConnectorShopifyCustomerCatalog)
	mux.HandleFunc("POST /api/v1/erp-connector/shopify/return-catalog", s.handleERPConnectorShopifyReturnCatalog)
	mux.HandleFunc("POST /api/v1/erp-connector/shopify/location-catalog", s.handleERPConnectorShopifyLocationCatalog)
	mux.HandleFunc("POST /api/v1/erp-connector/shopify/inventory-level", s.handleERPConnectorShopifyInventoryLevel)
	mux.HandleFunc("POST /api/v1/erp-connector/shopify/inventory-set", s.handleERPConnectorShopifyInventorySet)
	mux.HandleFunc("POST /api/v1/erp-connector/shopify/order-shipping-address", s.handleERPConnectorShopifyOrderShippingAddress)
	mux.HandleFunc("POST /api/v1/erp-connector/shopify/order-edit-quantity", s.handleERPConnectorShopifyOrderEditQuantity)
	mux.HandleFunc("POST /api/v1/erp-connector/shopify/order-add-variant", s.handleERPConnectorShopifyOrderAddVariant)
	mux.HandleFunc("POST /api/v1/erp-connector/shopify/order-add-custom-item", s.handleERPConnectorShopifyOrderAddCustomItem)
	mux.HandleFunc("POST /api/v1/erp-connector/shopify/order-line-discount", s.handleERPConnectorShopifyOrderLineDiscount)
	mux.HandleFunc("POST /api/v1/erp-connector/shopify/order-cancel", s.handleERPConnectorShopifyOrderCancellation)
	mux.HandleFunc("POST /api/v1/erp-connector/shopify/fulfillment-publish", s.handleERPConnectorShopifyFulfillmentPublish)
	mux.HandleFunc("POST /api/v1/erp-connector/shopify/dispute-catalog", s.handleERPConnectorShopifyDisputeCatalog)
	mux.HandleFunc("POST /api/v1/internal/customer-service/shopify-compliance/export", s.handleERPShopifyComplianceExport)
	mux.HandleFunc("POST /api/v1/internal/customer-service/shopify-compliance/redact", s.handleERPShopifyComplianceRedact)
	mux.HandleFunc("POST /api/v1/shopify-connector/installations/revocation-effects", s.handleShopifyConnectorRevocationEffects)
	mux.HandleFunc("POST /api/v1/shopify-connector/installations/oauth/start", s.handleERPConnectorShopifyOAuthStart)
	mux.HandleFunc("POST /api/v1/shopify-connector/installations/uninstall", s.handleERPConnectorShopifyOAuthStart)
	mux.HandleFunc("GET /outlook/callback", s.handleOutlookCallback)
	mux.HandleFunc("GET /gmail/callback", s.handleGmailCallback)
	mux.HandleFunc("POST /webhooks/email/gmail", s.handleGmailPush)
	mux.HandleFunc("POST /webhooks/email/outlook", s.handleOutlookPush)
	mux.HandleFunc("POST /webhooks/email/cuiqiu", s.handleCuiqiuWebhook)
	mux.HandleFunc("POST /webhooks/shopify/app/uninstalled", s.handleShopifyAppUninstalled)
	mux.HandleFunc("POST /webhooks/shopify/compliance", s.handleShopifyComplianceWebhook)
	mux.HandleFunc("POST /webhooks/17track", s.handleSeventeenTrackWebhook)
	mux.HandleFunc("GET /shopify/app", s.handleShopifyApp)
	mux.HandleFunc("GET /shopify/install", s.handleShopifyInstall)
	mux.HandleFunc("GET /shopify/callback", s.handleShopifyCallback)
	mux.HandleFunc("GET /shopify/xz-erp", s.handleXZERPPublicPage)
	mux.HandleFunc("GET /shopify/xz-erp/", s.handleXZERPPublicPage)
	mux.HandleFunc("GET /shopify/xz-erp/privacy", s.handleXZERPPublicPage)
	mux.HandleFunc("GET /shopify/xz-erp/support", s.handleXZERPPublicPage)
	mux.HandleFunc("GET /shopify/xz-erp/guide", s.handleXZERPPublicPage)
	mux.HandleFunc("GET /shopify/xz-erp/data-deletion", s.handleXZERPPublicPage)
	mux.HandleFunc("GET /shopify/proxy/chat/session", s.handleShopifyChatCustomerSession)
	mux.HandleFunc("GET /chat/widget.js", s.handleChatWidgetScript)
	mux.HandleFunc("GET /chat/widget.css", s.handleChatWidgetStyles)
	mux.HandleFunc("GET /api/v1/public/chat/config", s.handlePublicChatConfig)
	mux.HandleFunc("POST /api/v1/public/chat/instant-answer", s.handlePublicChatInstantAnswer)
	mux.HandleFunc("POST /api/v1/public/chat/workflows/order-tracking", s.handlePublicChatOrderTracking)
	mux.HandleFunc("POST /api/v1/public/chat/heartbeat", s.handlePublicChatHeartbeat)
	mux.HandleFunc("POST /api/v1/public/chat/attachments", s.handlePublicChatAttachmentUpload)
	mux.HandleFunc("POST /api/v1/public/chat/conversations", s.handlePublicChatConversation)
	mux.HandleFunc("GET /api/v1/public/chat/conversations/", s.handlePublicChatConversationSubroutes)
	mux.HandleFunc("POST /api/v1/public/chat/conversations/", s.handlePublicChatConversationSubroutes)
	mux.HandleFunc("GET /api/v1/chat/attachments/", s.handleChatAttachmentFile)
	mux.HandleFunc("GET /ws/events", s.handleEventsWebSocket)
	mux.HandleFunc("GET /ws/chat", s.handleChatWebSocket)
	mux.HandleFunc("GET /", s.handleFrontendApp)
	return s.withCORS(mux)
}

func (s *Server) handleFrontendApp(w http.ResponseWriter, r *http.Request) {
	distDir, ok := frontendDistDir()
	if !ok {
		http.NotFound(w, r)
		return
	}

	relPath := strings.TrimPrefix(r.URL.Path, "/")
	if relPath == "" {
		relPath = "index.html"
	}
	cleanPath := filepath.Clean(relPath)
	if cleanPath == "." || strings.HasPrefix(cleanPath, "..") {
		http.NotFound(w, r)
		return
	}

	fullPath := filepath.Join(distDir, cleanPath)
	if info, err := os.Stat(fullPath); err == nil && !info.IsDir() {
		http.ServeFile(w, r, fullPath)
		return
	}

	indexPath := filepath.Join(distDir, "index.html")
	if _, err := os.Stat(indexPath); err != nil {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, indexPath)
}

func frontendDistDir() (string, bool) {
	wd, err := os.Getwd()
	if err != nil {
		return "", false
	}
	candidates := []string{
		filepath.Join(wd, "frontend", "dist"),
		filepath.Join(filepath.Dir(wd), "frontend", "dist"),
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(filepath.Join(candidate, "index.html")); err == nil && !info.IsDir() {
			return candidate, true
		}
	}
	return "", false
}

type createUserRequest struct {
	Email                 string            `json:"email"`
	DisplayName           string            `json:"displayName"`
	Password              string            `json:"password"`
	Role                  string            `json:"role"`
	Department            string            `json:"department"`
	SkillGroup            string            `json:"skillGroup"`
	ReceptionLimit        int               `json:"receptionLimit"`
	LegacyReceptionOrder  json.RawMessage   `json:"receptionOrder"` // Accepted but ignored while pre-release browser tabs age out.
	Permissions           []string          `json:"permissions"`
	PermissionsCustomized bool              `json:"permissionsCustomized"`
	ShopScope             string            `json:"shopScope"`
	ShopScopeIDs          []string          `json:"shopScopeIds"`
	DataScopes            map[string]string `json:"dataScopes"`
	WorkbenchShopScope    string            `json:"workbenchShopScope"`
	ConversationScope     string            `json:"conversationScope"`
	SystemAdmin           bool              `json:"-"`
}

type updateUserRequest struct {
	Email                 string             `json:"email"`
	DisplayName           string             `json:"displayName"`
	Password              string             `json:"password"`
	Role                  string             `json:"role"`
	Status                string             `json:"status"`
	Department            *string            `json:"department"`
	SkillGroup            *string            `json:"skillGroup"`
	ReceptionLimit        *int               `json:"receptionLimit"`
	LegacyReceptionOrder  json.RawMessage    `json:"receptionOrder"` // Accepted but ignored while pre-release browser tabs age out.
	Permissions           *[]string          `json:"permissions"`
	PermissionsCustomized *bool              `json:"permissionsCustomized"`
	ShopScope             *string            `json:"shopScope"`
	ShopScopeIDs          *[]string          `json:"shopScopeIds"`
	DataScopes            *map[string]string `json:"dataScopes"`
	WorkbenchShopScope    *string            `json:"workbenchShopScope"`
	ConversationScope     *string            `json:"conversationScope"`
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type receptionPresenceRequest struct {
	Online bool `json:"online"`
}

type assignShopUserRequest struct {
	UserID string `json:"userId"`
}

type updateShopRequest struct {
	DisplayName string            `json:"displayName"`
	Platform    string            `json:"platform"`
	ExternalID  string            `json:"externalId"`
	Status      string            `json:"status"`
	Metadata    map[string]string `json:"metadata"`
}

type updateShopSourceRequest struct {
	Status   string            `json:"status"`
	Provider string            `json:"provider"`
	Address  string            `json:"address"`
	Metadata map[string]string `json:"metadata"`
}

type updateConversationRequest struct {
	Status          *string `json:"status"`
	AssignedAgentID *string `json:"assignedAgentId"`
}

type emailAuthURLRequest struct{}

type createKnowledgeRequest struct {
	Scope  string   `json:"scope"`
	ShopID string   `json:"shopId"`
	Title  string   `json:"title"`
	Answer string   `json:"answer"`
	Tags   []string `json:"tags"`
}

type submitConversationKnowledgeRequest struct {
	Title  string   `json:"title"`
	Answer string   `json:"answer"`
	Tags   []string `json:"tags"`
}

type updateKnowledgeRequest struct {
	Scope      string   `json:"scope"`
	ShopID     string   `json:"shopId"`
	Title      string   `json:"title"`
	Answer     string   `json:"answer"`
	Tags       []string `json:"tags"`
	Status     string   `json:"status"`
	ReviewNote string   `json:"reviewNote"`
}

type ingestConversationRequest struct {
	ShopID                 string          `json:"shopId"`
	SourceID               string          `json:"sourceId"`
	ExternalConversationID string          `json:"externalConversationId"`
	CustomerName           string          `json:"customerName"`
	CustomerEmail          string          `json:"customerEmail"`
	Subject                string          `json:"subject"`
	Status                 string          `json:"status"`
	Messages               []ingestMessage `json:"messages"`
}

type ingestMessage struct {
	Direction       string            `json:"direction"`
	Body            string            `json:"body"`
	Metadata        map[string]string `json:"metadata"`
	SenderName      string            `json:"senderName"`
	SenderEmail     string            `json:"senderEmail"`
	SourceMessageID string            `json:"sourceMessageId"`
	CreatedAt       time.Time         `json:"createdAt"`
}

type ingestConversationResponse struct {
	Conversation        Conversation `json:"conversation"`
	Messages            []Message    `json:"messages"`
	ConversationCreated bool         `json:"conversationCreated"`
	MessagesCreated     int          `json:"messagesCreated"`
	MessagesSkipped     int          `json:"messagesSkipped"`
}

type emailReadStateRequest struct {
	Mailbox   string `json:"mailbox"`
	MessageID string `json:"messageId"`
	Read      bool   `json:"read"`
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	storage := HealthStatus{Name: "unknown", OK: true}
	if checker, ok := s.store.(HealthChecker); ok {
		storage = checker.Health(r.Context())
	}
	status := http.StatusOK
	if !storage.OK {
		status = http.StatusServiceUnavailable
	}
	response := map[string]any{
		"ok":        storage.OK,
		"service":   "xzdesk",
		"storage":   storage,
		"timestamp": time.Now().UTC(),
	}
	if releaseID := strings.TrimSpace(os.Getenv("XZDESK_RELEASE_ID")); releaseID != "" {
		response["release"] = releaseID
	}
	if color := strings.TrimSpace(os.Getenv("XZDESK_DEPLOY_COLOR")); color != "" {
		response["color"] = color
	}
	writeJSONResponse(w, status, response)
}

func (s *Server) handleBootstrapStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if s.nativeTenantMode {
		writeJSONResponse(w, http.StatusOK, map[string]any{"needsBootstrap": false, "authMode": "local", "tenantRequired": true})
		return
	}
	if s.erpIdentityVerifier != nil {
		loginURL := ""
		if verifier, ok := s.erpIdentityVerifier.(*HTTPERPIdentityVerifier); ok {
			entry := *verifier.baseURL
			entry.Path = "/customer-service"
			loginURL = entry.String()
		}
		writeJSONResponse(w, http.StatusOK, map[string]any{
			"needsBootstrap": false,
			"authMode":       "erp_sso",
			"erpLoginUrl":    loginURL,
		})
		return
	}
	count, err := s.store.CountUsers(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{"needsBootstrap": count == 0, "authMode": "local"})
}

func (s *Server) handleBootstrapAdmin(w http.ResponseWriter, r *http.Request) {
	if s.erpIdentityVerifier != nil {
		writeJSONResponse(w, http.StatusNotFound, map[string]string{
			"error": "local account bootstrap is disabled; use ERP unified sign-in",
		})
		return
	}
	count, err := s.store.CountUsers(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	if count > 0 {
		writeJSONResponse(w, http.StatusConflict, map[string]string{"error": "bootstrap is already completed"})
		return
	}
	var input createUserRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Role = UserRoleAdmin
	input.SystemAdmin = true
	user, err := s.createUserFromRequest(r.Context(), input)
	if err != nil {
		writeError(w, err)
		return
	}
	result, err := s.createSessionForUser(r.Context(), user)
	if err != nil {
		writeError(w, err)
		return
	}
	s.broadcast(Event{Type: "user.created", EntityID: user.ID, Payload: publicUser(user), CreatedAt: time.Now().UTC()})
	writeJSONResponse(w, http.StatusCreated, result)
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if s.erpIdentityVerifier != nil {
		writeJSONResponse(w, http.StatusNotFound, map[string]string{
			"error": "local password login is disabled; use ERP unified sign-in",
		})
		return
	}
	var input loginRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	user, err := s.store.FindUserByEmail(r.Context(), input.Email)
	if err != nil || user.Status != UserStatusActive || !verifyPassword(user.PasswordHash, input.Password) {
		writeJSONResponse(w, http.StatusUnauthorized, map[string]string{"error": "invalid email or password"})
		return
	}
	result, err := s.createSessionForUser(r.Context(), user)
	if err != nil {
		writeError(w, err)
		return
	}
	if userIsCustomerServiceAgent(user) && userHasPermission(user, PermissionWorkbenchAccess) {
		user, err = s.setAgentReceptionOnline(r.Context(), user.ID, true)
		if err != nil {
			_ = s.store.DeleteSession(r.Context(), hashSessionToken(result.Token))
			writeError(w, err)
			return
		}
		result.User = publicUser(user)
	}
	writeJSONResponse(w, http.StatusOK, result)
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	_, user, ok := s.requireAuth(w, r)
	if !ok {
		return
	}
	writeJSONResponse(w, http.StatusOK, publicUser(user))
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	token := bearerToken(r)
	if token != "" {
		localHash := hashSessionToken(token)
		_, user, err := s.store.GetSessionByTokenHash(r.Context(), localHash)
		if err == nil && userIsCustomerServiceAgent(user) && userHasPermission(user, PermissionWorkbenchAccess) {
			_, _ = s.setAgentReceptionOnline(r.Context(), user.ID, false)
		}
		_ = s.store.DeleteSession(r.Context(), localHash)
		s.forgetERPSession(localHash)
	}
	writeJSONResponse(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleWSTicket(w http.ResponseWriter, r *http.Request) {
	origin := requestOrigin(r)
	if origin == "" || !s.originAllowed(r) {
		writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "websocket origin is not allowed"})
		return
	}
	_, _, ok := s.requireAuth(w, r)
	if !ok {
		return
	}
	sessionToken := bearerToken(r)
	if sessionToken == "" {
		writeJSONResponse(w, http.StatusUnauthorized, map[string]string{"error": "missing bearer token"})
		return
	}
	ticket, err := newSessionToken()
	if err != nil {
		writeError(w, err)
		return
	}
	expiresAt := time.Now().UTC().Add(30 * time.Second)
	ticketHash := hashSessionToken(ticket)
	s.wsTicketsMu.Lock()
	s.wsTickets[ticketHash] = wsTicketGrant{
		SessionToken: sessionToken,
		Origin:       origin,
		ExpiresAt:    expiresAt,
	}
	s.wsTicketsMu.Unlock()
	time.AfterFunc(31*time.Second, func() {
		s.wsTicketsMu.Lock()
		current, exists := s.wsTickets[ticketHash]
		if exists && current.ExpiresAt.Equal(expiresAt) {
			delete(s.wsTickets, ticketHash)
		}
		s.wsTicketsMu.Unlock()
	})
	if s.wsTicketRouteHook != nil {
		s.wsTicketRouteHook(ticketHash)
	}
	writeJSONResponse(w, http.StatusCreated, map[string]any{
		"ticket":    ticket,
		"expiresAt": expiresAt,
	})
}

func (s *Server) handleOutlookConfigStatus(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePermission(w, r, PermissionShopChannelsManage); !ok {
		return
	}
	writeJSONResponse(w, http.StatusOK, outlookConfigStatus(r))
}

func (s *Server) handleGmailConfigStatus(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePermission(w, r, PermissionShopChannelsManage); !ok {
		return
	}
	writeJSONResponse(w, http.StatusOK, gmailConfigStatus(r))
}

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	_, ok := s.requirePermission(w, r, PermissionUsersView)
	if !ok {
		return
	}
	users, err := s.store.ListUsers(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	for index := range users {
		users[index] = publicUser(users[index])
	}
	writeJSONResponse(w, http.StatusOK, nonNilSlice(users))
}

func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	if s.erpIdentityVerifier != nil {
		writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "Manage accounts in ERP. Customer service only manages seat permissions and assignments."})
		return
	}
	currentUser, ok := s.requirePermission(w, r, PermissionUsersManage)
	if !ok {
		return
	}
	var input createUserRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if (input.Role == UserRoleAdmin || input.PermissionsCustomized || input.ShopScope != "" || len(input.ShopScopeIDs) > 0 || input.WorkbenchShopScope == AccessScopeAll || input.ConversationScope == AccessScopeAll) && !userHasPermission(currentUser, PermissionPermissionsManage) {
		writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "permission management access is required"})
		return
	}
	candidateRole := strings.TrimSpace(input.Role)
	if candidateRole == "" {
		candidateRole = UserRoleAgent
	}
	candidate := User{
		Role:                  candidateRole,
		Department:            input.Department,
		Permissions:           input.Permissions,
		PermissionsCustomized: input.PermissionsCustomized,
		DataScopes:            input.DataScopes,
	}
	if currentUser.Role != UserRoleAdmin && !permissionsAreSubset(effectivePermissions(candidate), effectivePermissions(currentUser)) {
		writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "cannot grant permissions you do not have"})
		return
	}
	if effectiveWorkbenchShopScope(input.WorkbenchShopScope) == AccessScopeAll && currentUser.Role != UserRoleAdmin && effectiveWorkbenchShopScope(currentUser.WorkbenchShopScope) != AccessScopeAll {
		writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "cannot grant workbench access to all shops"})
		return
	}
	if err := s.validateGrantedShopScope(r.Context(), currentUser, input.ShopScope, input.ShopScopeIDs); err != nil {
		writeError(w, err)
		return
	}
	if effectiveAccessScope(input.ConversationScope, input.Role) == AccessScopeAll && currentUser.Role != UserRoleAdmin && effectiveAccessScope(currentUser.ConversationScope, currentUser.Role) != AccessScopeAll {
		writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "cannot grant access to all conversations"})
		return
	}
	user, err := s.createUserFromRequest(r.Context(), input)
	if err != nil {
		writeError(w, err)
		return
	}
	s.auditAccountChange(r.Context(), currentUser.ID, user.ID, "user.created", map[string]any{"role": user.Role, "department": user.Department, "permissionsCustomized": user.PermissionsCustomized, "shopScope": publicUser(user).ShopScope, "workbenchShopScope": publicUser(user).WorkbenchShopScope, "conversationScope": publicUser(user).ConversationScope})
	s.broadcast(Event{Type: "user.created", EntityID: user.ID, Payload: publicUser(user), CreatedAt: time.Now().UTC()})
	writeJSONResponse(w, http.StatusCreated, publicUser(user))
}

func (s *Server) handleMyRouting(w http.ResponseWriter, r *http.Request) {
	_, currentUser, ok := s.requireAuth(w, r)
	if !ok {
		return
	}
	var input updateUserRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	update := User{}
	if input.ReceptionLimit != nil {
		update.ReceptionLimit = *input.ReceptionLimit
	}
	user, err := s.store.UpdateUser(r.Context(), currentUser.ID, update)
	if err != nil {
		writeError(w, err)
		return
	}
	s.broadcast(Event{Type: "user.updated", EntityID: user.ID, Payload: publicUser(user), CreatedAt: time.Now().UTC()})
	s.fillAgentCapacityAsync(user.ID)
	writeJSONResponse(w, http.StatusOK, publicUser(user))
}

func (s *Server) handleMyPresence(w http.ResponseWriter, r *http.Request) {
	_, currentUser, ok := s.requireAuth(w, r)
	if !ok {
		return
	}
	if !userIsCustomerServiceAgent(currentUser) || !userHasPermission(currentUser, PermissionWorkbenchAccess) || !userHasPermission(currentUser, PermissionAutoReception) {
		writeError(w, ErrForbidden)
		return
	}
	var input receptionPresenceRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	user, err := s.setAgentReceptionOnline(r.Context(), currentUser.ID, input.Online)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSONResponse(w, http.StatusOK, publicUser(user))
}

func (s *Server) setAgentReceptionOnline(ctx context.Context, userID string, online bool) (User, error) {
	current, err := s.store.GetUser(ctx, strings.TrimSpace(userID))
	if err != nil {
		return User{}, err
	}
	if current.ReceptionOnline == online {
		return current, nil
	}
	user, err := s.store.SetUserReceptionOnline(ctx, current.ID, online)
	if err != nil {
		return User{}, err
	}
	s.refreshEventClientPermissions(user.ID)
	s.monitorCacheMu.Lock()
	s.monitorCache = map[string]cachedMonitorOverview{}
	s.monitorCacheMu.Unlock()
	s.broadcast(Event{Type: "user.updated", EntityID: user.ID, Payload: publicUser(user), CreatedAt: time.Now().UTC()})
	if online {
		s.fillAgentCapacityAsync(user.ID)
	}
	return user, nil
}

func (s *Server) handleUserSubroutes(w http.ResponseWriter, r *http.Request) {
	parts := splitPath(r.URL.Path)
	if (len(parts) != 4 && len(parts) != 5) || parts[0] != "api" || parts[1] != "v1" || parts[2] != "users" {
		http.NotFound(w, r)
		return
	}
	targetID := strings.TrimSpace(parts[3])
	if targetID == "" {
		http.NotFound(w, r)
		return
	}
	if len(parts) == 5 {
		if r.Method != http.MethodGet || parts[4] != "audit-logs" {
			http.NotFound(w, r)
			return
		}
		if _, ok := s.requirePermission(w, r, PermissionUsersView); !ok {
			return
		}
		logs, err := s.store.ListAccountAuditLogs(r.Context(), targetID, 50)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSONResponse(w, http.StatusOK, nonNilSlice(logs))
		return
	}
	currentUser, ok := s.requirePermission(w, r, PermissionUsersManage)
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodPatch:
		var input updateUserRequest
		if !decodeJSON(w, r, &input) {
			return
		}
		targetUser, err := s.store.GetUser(r.Context(), targetID)
		if err != nil {
			writeError(w, err)
			return
		}
		nextStatus := strings.TrimSpace(input.Status)
		nextRole := strings.TrimSpace(input.Role)
		departmentChanged := input.Department != nil && strings.TrimSpace(*input.Department) != strings.TrimSpace(targetUser.Department)
		accessControlChanged := input.Permissions != nil || input.PermissionsCustomized != nil || input.ShopScope != nil || input.ShopScopeIDs != nil || input.WorkbenchShopScope != nil || input.ConversationScope != nil || departmentChanged || (nextRole != "" && nextRole != targetUser.Role)
		protected, err := s.isSystemAdmin(r.Context(), targetID)
		if err != nil {
			writeError(w, err)
			return
		}
		if protected && (nextStatus == UserStatusDisabled || (nextRole != "" && nextRole != UserRoleAdmin) || (accessControlChanged && targetID != currentUser.ID)) {
			writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "system admin role and status are protected; only the system admin can edit its optional permissions"})
			return
		}
		if accessControlChanged && !userHasPermission(currentUser, PermissionPermissionsManage) {
			writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "permission management access is required"})
			return
		}
		if targetID == currentUser.ID && (nextStatus == UserStatusDisabled || nextRole == UserRoleAgent) {
			writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "current admin account cannot be disabled"})
			return
		}
		if nextStatus == UserStatusDisabled || nextRole == UserRoleAgent {
			if err := s.ensureAdminCanBeRemoved(r.Context(), targetID); err != nil {
				writeError(w, err)
				return
			}
		}
		update := User{Email: input.Email, DisplayName: input.DisplayName, Role: input.Role, Status: input.Status}
		if input.Department != nil {
			update.SetDepartment = true
			update.Department = *input.Department
		}
		if input.SkillGroup != nil {
			update.SetSkillGroup = true
			update.SkillGroup = *input.SkillGroup
		}
		if strings.TrimSpace(input.Password) != "" {
			if s.erpIdentityVerifier != nil {
				writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "Manage shared account passwords in ERP."})
				return
			}
			passwordHash, hashErr := hashPassword(input.Password)
			if hashErr != nil {
				writeError(w, hashErr)
				return
			}
			update.PasswordHash = passwordHash
		}
		if input.ReceptionLimit != nil {
			update.ReceptionLimit = *input.ReceptionLimit
		}
		if accessControlChanged {
			update.SetAccessControl = true
			update.Permissions = append([]string(nil), targetUser.Permissions...)
			update.PermissionsCustomized = targetUser.PermissionsCustomized
			update.ShopScope = targetUser.ShopScope
			update.ShopScopeIDs = append([]string(nil), targetUser.ShopScopeIDs...)
			update.WorkbenchShopScope = targetUser.WorkbenchShopScope
			update.ConversationScope = targetUser.ConversationScope
			if input.Permissions != nil {
				if err := validatePermissions(*input.Permissions); err != nil {
					writeError(w, err)
					return
				}
				update.Permissions = normalizePermissions(*input.Permissions)
			}
			if input.PermissionsCustomized != nil {
				update.PermissionsCustomized = *input.PermissionsCustomized
			}
			if input.ShopScope != nil {
				update.ShopScope = strings.TrimSpace(*input.ShopScope)
			}
			if input.ShopScopeIDs != nil {
				update.ShopScopeIDs = normalizeShopScopeIDs(*input.ShopScopeIDs)
			}
			update.SetShopScope = input.ShopScope != nil || input.ShopScopeIDs != nil
			if input.WorkbenchShopScope != nil {
				update.WorkbenchShopScope = strings.TrimSpace(*input.WorkbenchShopScope)
			}
			if input.ConversationScope != nil {
				update.ConversationScope = strings.TrimSpace(*input.ConversationScope)
			}
			candidateRole := targetUser.Role
			if nextRole != "" {
				candidateRole = nextRole
			}
			candidateDepartment := targetUser.Department
			if input.Department != nil {
				candidateDepartment = *input.Department
			}
			candidate := User{Role: candidateRole, Department: candidateDepartment, Permissions: update.Permissions, PermissionsCustomized: update.PermissionsCustomized, SystemAdmin: targetUser.SystemAdmin}
			if currentUser.Role != UserRoleAdmin && !permissionsAreSubset(effectivePermissions(candidate), effectivePermissions(currentUser)) {
				writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "cannot grant permissions you do not have"})
				return
			}
			if effectiveWorkbenchShopScope(update.WorkbenchShopScope) == AccessScopeAll && currentUser.Role != UserRoleAdmin && effectiveWorkbenchShopScope(currentUser.WorkbenchShopScope) != AccessScopeAll {
				writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "cannot grant workbench access to all shops"})
				return
			}
			if err := s.validateGrantedShopScope(r.Context(), currentUser, update.ShopScope, update.ShopScopeIDs); err != nil {
				writeError(w, err)
				return
			}
			if effectiveAccessScope(update.ConversationScope, candidateRole) == AccessScopeAll && currentUser.Role != UserRoleAdmin && effectiveAccessScope(currentUser.ConversationScope, currentUser.Role) != AccessScopeAll {
				writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "cannot grant access to all conversations"})
				return
			}
		}
		user, err := s.store.UpdateUser(r.Context(), targetID, update)
		if err != nil {
			writeError(w, err)
			return
		}
		lostWorkbench := userHasPermission(targetUser, PermissionWorkbenchAccess) && !userHasPermission(user, PermissionWorkbenchAccess)
		leftCustomerService := userIsCustomerServiceAgent(targetUser) && !userIsCustomerServiceAgent(user)
		disabled := targetUser.Status != UserStatusDisabled && user.Status == UserStatusDisabled
		if (lostWorkbench || leftCustomerService || disabled) && s.releaseUserConversations(r.Context(), user.ID) != nil {
			writeJSONResponse(w, http.StatusInternalServerError, map[string]string{"error": "account updated but assigned conversations could not be returned to the queue"})
			return
		}
		s.auditAccountChange(r.Context(), currentUser.ID, user.ID, "user.updated", map[string]any{
			"emailChanged": input.Email != "" && normalizeEmail(input.Email) != targetUser.Email,
			"displayName":  user.DisplayName, "role": user.Role, "status": user.Status,
			"department": user.Department, "skillGroup": user.SkillGroup,
			"passwordReset": input.Password != "", "permissionsCustomized": user.PermissionsCustomized,
			"shopScope":          publicUser(user).ShopScope,
			"workbenchShopScope": publicUser(user).WorkbenchShopScope, "conversationScope": publicUser(user).ConversationScope,
		})
		s.broadcast(Event{Type: "user.updated", EntityID: user.ID, Payload: publicUser(user), CreatedAt: time.Now().UTC()})
		s.refreshEventClientPermissions(user.ID)
		s.fillAgentCapacityAsync(user.ID)
		writeJSONResponse(w, http.StatusOK, publicUser(user))
	case http.MethodDelete:
		if protected, err := s.isSystemAdmin(r.Context(), targetID); err != nil {
			writeError(w, err)
			return
		} else if protected {
			writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "system admin account cannot be deleted"})
			return
		}
		if targetID == currentUser.ID {
			writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "current admin account cannot be deleted"})
			return
		}
		if err := s.ensureAdminCanBeRemoved(r.Context(), targetID); err != nil {
			writeError(w, err)
			return
		}
		if err := s.store.DeleteUser(r.Context(), targetID); err != nil {
			writeError(w, err)
			return
		}
		s.auditAccountChange(r.Context(), currentUser.ID, targetID, "user.deleted", map[string]any{})
		s.broadcast(Event{Type: "user.deleted", EntityID: targetID, Payload: map[string]string{"userId": targetID}, CreatedAt: time.Now().UTC()})
		writeJSONResponse(w, http.StatusOK, map[string]bool{"ok": true})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *Server) isSystemAdmin(ctx context.Context, userID string) (bool, error) {
	users, err := s.store.ListUsers(ctx)
	if err != nil {
		return false, err
	}
	systemAdminID := ""
	var systemAdminCreatedAt time.Time
	for _, user := range users {
		if user.ID == userID && user.SystemAdmin {
			return true, nil
		}
		if user.Role != UserRoleAdmin {
			continue
		}
		if systemAdminID == "" || user.CreatedAt.Before(systemAdminCreatedAt) || (user.CreatedAt.Equal(systemAdminCreatedAt) && user.ID < systemAdminID) {
			systemAdminID = user.ID
			systemAdminCreatedAt = user.CreatedAt
		}
	}
	return systemAdminID != "" && systemAdminID == userID, nil
}

func (s *Server) ensureAdminCanBeRemoved(ctx context.Context, userID string) error {
	user, err := s.store.GetUser(ctx, userID)
	if err != nil {
		return err
	}
	if user.Role != UserRoleAdmin {
		return nil
	}
	users, err := s.store.ListUsers(ctx)
	if err != nil {
		return err
	}
	activeAdmins := 0
	for _, item := range users {
		if item.ID != userID && item.Role == UserRoleAdmin && item.Status == UserStatusActive {
			activeAdmins++
		}
	}
	if activeAdmins == 0 {
		return fmt.Errorf("%w: at least one active admin account is required", ErrInvalid)
	}
	return nil
}

func (s *Server) createUserFromRequest(ctx context.Context, input createUserRequest) (User, error) {
	if err := validatePermissions(input.Permissions); err != nil {
		return User{}, err
	}
	passwordHash, err := hashPassword(input.Password)
	if err != nil {
		return User{}, err
	}
	role := strings.TrimSpace(input.Role)
	if role == "" {
		role = UserRoleAgent
	}
	if role != UserRoleAdmin && role != UserRoleAgent {
		return User{}, fmt.Errorf("%w: unsupported role", ErrInvalid)
	}
	return s.store.CreateUser(ctx, User{
		Email:                 input.Email,
		DisplayName:           input.DisplayName,
		Role:                  role,
		Department:            input.Department,
		SkillGroup:            input.SkillGroup,
		ReceptionLimit:        input.ReceptionLimit,
		Permissions:           input.Permissions,
		PermissionsCustomized: input.PermissionsCustomized,
		DataScopes:            input.DataScopes,
		ShopScope:             input.ShopScope,
		ShopScopeIDs:          input.ShopScopeIDs,
		SetShopScope:          strings.TrimSpace(input.ShopScope) != "" || len(input.ShopScopeIDs) > 0,
		WorkbenchShopScope:    input.WorkbenchShopScope,
		ConversationScope:     input.ConversationScope,
		SystemAdmin:           input.SystemAdmin,
		PasswordHash:          passwordHash,
	})
}

func (s *Server) createSessionForUser(ctx context.Context, user User) (AuthResult, error) {
	return s.createSessionForUserUntil(ctx, user, time.Now().UTC().Add(sessionDuration))
}

func (s *Server) createSessionForUserUntil(ctx context.Context, user User, expiresAt time.Time) (AuthResult, error) {
	token, err := newSessionToken()
	if err != nil {
		return AuthResult{}, err
	}
	if s.nativeTenantID != "" {
		token = nativeSessionPrefix + token
	}
	maxExpiresAt := time.Now().UTC().Add(sessionDuration)
	if expiresAt.IsZero() || expiresAt.After(maxExpiresAt) {
		expiresAt = maxExpiresAt
	}
	session, err := s.store.CreateSession(ctx, Session{
		UserID:    user.ID,
		TokenHash: hashSessionToken(token),
		ExpiresAt: expiresAt,
	})
	if err != nil {
		return AuthResult{}, err
	}
	return AuthResult{Token: token, ExpiresAt: session.ExpiresAt, User: publicUser(user), TenantID: s.nativeTenantID}, nil
}

func (s *Server) requireAuth(w http.ResponseWriter, r *http.Request) (Session, User, bool) {
	token := bearerToken(r)
	return s.requireAuthToken(w, r, token)
}

func (s *Server) requireAuthToken(w http.ResponseWriter, r *http.Request, token string) (Session, User, bool) {
	if token == "" {
		writeJSONResponse(w, http.StatusUnauthorized, map[string]string{"error": "missing bearer token"})
		return Session{}, User{}, false
	}
	session, user, err := s.store.GetSessionByTokenHash(r.Context(), hashSessionToken(token))
	if err != nil || user.Status != UserStatusActive {
		writeJSONResponse(w, http.StatusUnauthorized, map[string]string{"error": "invalid session"})
		return Session{}, User{}, false
	}
	localHash := hashSessionToken(token)
	user, err = s.validateERPSession(r.Context(), localHash, user)
	if errors.Is(err, errERPIdentityUnavailable) {
		writeJSONResponse(w, http.StatusServiceUnavailable, map[string]string{"error": "identity service unavailable; retry later"})
		return Session{}, User{}, false
	}
	if err != nil || user.Status != UserStatusActive {
		_ = s.store.DeleteSession(r.Context(), localHash)
		s.forgetERPSession(localHash)
		writeJSONResponse(w, http.StatusUnauthorized, map[string]string{"error": "invalid session"})
		return Session{}, User{}, false
	}
	return session, user, true
}

func (s *Server) requirePermission(w http.ResponseWriter, r *http.Request, permission string) (User, bool) {
	_, user, ok := s.requireAuth(w, r)
	if !ok {
		return User{}, false
	}
	if !userHasPermission(user, permission) {
		writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "required permission is missing"})
		return User{}, false
	}
	return user, true
}

func (s *Server) auditAccountChange(ctx context.Context, actorUserID string, targetUserID string, action string, changes map[string]any) {
	_, _ = s.store.CreateAccountAuditLog(ctx, AccountAuditLog{
		ActorUserID: actorUserID, TargetUserID: targetUserID, Action: action, Changes: changes,
	})
}

func (s *Server) userCanAccessShop(ctx context.Context, user User, shopID string) (bool, error) {
	return s.userCanAccessAssignedShop(ctx, user, shopID)
}

func (s *Server) userCanAccessModuleShop(ctx context.Context, user User, module string, shopID string) (bool, error) {
	switch effectiveModuleScope(user, module) {
	case AccessScopeAll:
		_, err := s.store.GetShop(ctx, strings.TrimSpace(shopID))
		if err != nil {
			return false, err
		}
		return true, nil
	case AccessScopeSelected:
		shop, err := s.store.GetShop(ctx, strings.TrimSpace(shopID))
		if err != nil {
			return false, err
		}
		if shop.Status != ShopStatusActive {
			return false, nil
		}
		return stringSet(user.ShopScopeIDs)[strings.TrimSpace(shopID)], nil
	default:
		return s.userCanAccessAssignedShop(ctx, user, shopID)
	}
}

func (s *Server) userCanAccessWorkbenchOrModuleShop(ctx context.Context, user User, module string, shopID string) (bool, error) {
	if userHasPermission(user, PermissionWorkbenchAccess) {
		allowed, err := s.userCanAccessWorkbenchShop(ctx, user, shopID)
		if err != nil || allowed {
			return allowed, err
		}
	}
	return s.userCanAccessModuleShop(ctx, user, module, shopID)
}

func (s *Server) userCanAccessWorkbenchShop(ctx context.Context, user User, shopID string) (bool, error) {
	if effectiveWorkbenchShopScope(user.WorkbenchShopScope) == AccessScopeAll {
		shop, err := s.store.GetShop(ctx, strings.TrimSpace(shopID))
		if err != nil {
			return false, err
		}
		return shop.Status == ShopStatusActive, nil
	}
	return s.userCanAccessAssignedShop(ctx, user, shopID)
}

func (s *Server) userCanAccessAssignedShop(ctx context.Context, user User, shopID string) (bool, error) {
	shop, err := s.store.GetShop(ctx, strings.TrimSpace(shopID))
	if err != nil {
		return false, err
	}
	if shop.Status != ShopStatusActive {
		return false, nil
	}
	return s.userIsAssignedToShop(ctx, user, shopID)
}

func (s *Server) userIsAssignedToShop(ctx context.Context, user User, shopID string) (bool, error) {
	if _, err := s.store.GetShop(ctx, strings.TrimSpace(shopID)); err != nil {
		return false, err
	}
	shopIDs, err := s.store.ListUserShopIDs(ctx, user.ID)
	if err != nil {
		return false, err
	}
	shopID = strings.TrimSpace(shopID)
	for _, allowedShopID := range shopIDs {
		if allowedShopID == shopID {
			return true, nil
		}
	}
	return false, nil
}

func (s *Server) moduleScopeShopIDs(ctx context.Context, user User, module string) ([]string, bool, error) {
	switch effectiveModuleScope(user, module) {
	case AccessScopeAll:
		return nil, false, nil
	case AccessScopeSelected:
		return normalizeShopScopeIDs(user.ShopScopeIDs), true, nil
	default:
		shopIDs, err := s.store.ListUserShopIDs(ctx, user.ID)
		return shopIDs, true, err
	}
}

func (s *Server) validateGrantedShopScope(ctx context.Context, actor User, scope string, shopIDs []string) error {
	scope = strings.TrimSpace(scope)
	if scope == "" && len(shopIDs) == 0 {
		return nil
	}
	if err := validateShopScope(scope, shopIDs); err != nil {
		return err
	}
	if scope == AccessScopeSelected {
		for _, shopID := range normalizeShopScopeIDs(shopIDs) {
			if _, err := s.store.GetShop(ctx, shopID); err != nil {
				return err
			}
		}
	}
	if actor.Role == UserRoleAdmin {
		return nil
	}
	if scope == AccessScopeAll && effectiveModuleScope(actor, DataScopeShops) != AccessScopeAll {
		return fmt.Errorf("%w: cannot grant access to all shops", ErrForbidden)
	}
	if scope == AccessScopeSelected {
		for _, shopID := range normalizeShopScopeIDs(shopIDs) {
			allowed, err := s.userCanAccessModuleShop(ctx, actor, DataScopeShops, shopID)
			if err != nil {
				return err
			}
			if !allowed {
				return fmt.Errorf("%w: cannot grant access to shop %s", ErrForbidden, shopID)
			}
		}
	}
	return nil
}

func (s *Server) requireAssignedShopAccess(w http.ResponseWriter, r *http.Request, user User, shopID string) bool {
	ok, err := s.userCanAccessAssignedShop(r.Context(), user, shopID)
	if err != nil {
		writeError(w, err)
		return false
	}
	if !ok {
		writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "assigned shop access is required"})
		return false
	}
	return true
}

func (s *Server) requireShopAccess(w http.ResponseWriter, r *http.Request, user User, shopID string) bool {
	ok, err := s.userCanAccessShop(r.Context(), user, shopID)
	if err != nil {
		writeError(w, err)
		return false
	}
	if !ok {
		writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "shop access is required"})
		return false
	}
	return true
}

func (s *Server) requireModuleShopAccess(w http.ResponseWriter, r *http.Request, user User, module string, shopID string) bool {
	ok, err := s.userCanAccessModuleShop(r.Context(), user, module, shopID)
	if err != nil {
		writeError(w, err)
		return false
	}
	if !ok {
		writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": module + " data scope does not include this shop"})
		return false
	}
	return true
}

func (s *Server) requireWorkbenchOrModuleShopAccess(w http.ResponseWriter, r *http.Request, user User, module string, shopID string) bool {
	ok, err := s.userCanAccessWorkbenchOrModuleShop(r.Context(), user, module, shopID)
	if err != nil {
		writeError(w, err)
		return false
	}
	if !ok {
		writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "workbench or module data scope does not include this shop"})
		return false
	}
	return true
}

func moduleFromShopListScope(scope string) (string, bool) {
	switch scope {
	case DataScopeKnowledge, DataScopeMonitor, DataScopeRecords, DataScopeTickets, DataScopeOrders, DataScopeShops:
		return scope, true
	default:
		return "", false
	}
}

func (s *Server) requireWorkbenchShopAccess(w http.ResponseWriter, r *http.Request, user User, shopID string) bool {
	ok, err := s.userCanAccessWorkbenchShop(r.Context(), user, shopID)
	if err != nil {
		writeError(w, err)
		return false
	}
	if !ok {
		writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "workbench shop access is required"})
		return false
	}
	return true
}

func (s *Server) handleListShops(w http.ResponseWriter, r *http.Request) {
	_, user, ok := s.requireAuth(w, r)
	if !ok {
		return
	}
	shops, err := s.store.ListShops(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	requestedScope := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("scope")))
	if requestedScope == "workbench" && !userHasPermission(user, PermissionWorkbenchAccess) {
		writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "workbench access permission is required"})
		return
	}
	module := DataScopeShops
	if requestedScope != "" && requestedScope != AccessScopeAssigned && requestedScope != "workbench" {
		var valid bool
		module, valid = moduleFromShopListScope(requestedScope)
		if !valid {
			writeError(w, ErrInvalid)
			return
		}
		if !userCanUseDataScopeModule(user, module) {
			writeError(w, ErrForbidden)
			return
		}
	}
	var allowed []string
	restricted := false
	if requestedScope == AccessScopeAssigned {
		allowed, err = s.store.ListUserShopIDs(r.Context(), user.ID)
		restricted = true
	} else {
		allowed, restricted, err = s.moduleScopeShopIDs(r.Context(), user, module)
	}
	if requestedScope == "workbench" {
		restricted = effectiveWorkbenchShopScope(user.WorkbenchShopScope) == AccessScopeAssigned
		if restricted {
			allowed, err = s.store.ListUserShopIDs(r.Context(), user.ID)
		}
	}
	if err != nil {
		writeError(w, err)
		return
	}
	if restricted {
		shops = filterActiveShops(filterShopsByIDs(shops, allowed))
	} else if requestedScope == "workbench" {
		shops = filterActiveShops(shops)
	}
	writeJSONResponse(w, http.StatusOK, nonNilSlice(shops))
}

func removeLegacyShopOwnershipMetadata(metadata map[string]string) map[string]string {
	cleaned := cloneStringMap(metadata)
	delete(cleaned, "account_owner_type")
	delete(cleaned, "account_department")
	return cleaned
}

func (s *Server) handleCreateShop(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, PermissionShopsCreate)
	if !ok {
		return
	}
	if effectiveModuleScope(user, DataScopeShops) != AccessScopeAll {
		writeError(w, fmt.Errorf("%w: access to all shops is required to create a shop", ErrForbidden))
		return
	}
	var input Shop
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Metadata = removeLegacyShopOwnershipMetadata(input.Metadata)
	shop, err := s.store.CreateShop(r.Context(), input)
	if err != nil {
		writeError(w, err)
		return
	}
	s.broadcast(Event{Type: "shop.created", ShopID: shop.ID, EntityID: shop.ID, Payload: shop, CreatedAt: time.Now().UTC()})
	writeJSONResponse(w, http.StatusCreated, shop)
}

func (s *Server) updateCustomerLoginRequirement(ctx context.Context, shopID string, required bool) (ShopSource, error) {
	sources, err := s.store.ListShopSources(ctx, shopID)
	if err != nil {
		return ShopSource{}, err
	}
	for _, source := range sources {
		if source.Type != SourceTypeShopifyChat {
			continue
		}
		updated, err := s.store.MutateShopSourceMetadata(ctx, shopID, source.ID, func(metadata map[string]string) map[string]string {
			if metadata == nil {
				metadata = map[string]string{}
			}
			metadata[shopifyChatCustomerLoginRequiredKey] = strconv.FormatBool(required)
			return metadata
		})
		if err != nil {
			return ShopSource{}, err
		}
		return withShopifyChatDefaults(updated), nil
	}
	return ShopSource{}, ErrNotFound
}

func (s *Server) handleCustomerLoginRequirement(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, PermissionCustomerLoginManage)
	if !ok {
		return
	}
	var input customerLoginRequirementRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	shops, err := s.store.ListShops(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	allowed, restricted, listErr := s.moduleScopeShopIDs(r.Context(), user, DataScopeShops)
	if listErr != nil {
		writeError(w, listErr)
		return
	}
	if restricted {
		shops = filterShopsByIDs(shops, allowed)
	}
	updatedSources := make([]ShopSource, 0, len(shops))
	for _, shop := range shops {
		updated, err := s.updateCustomerLoginRequirement(r.Context(), shop.ID, input.Required)
		if errors.Is(err, ErrNotFound) {
			continue
		}
		if err != nil {
			writeError(w, err)
			return
		}
		updatedSources = append(updatedSources, updated)
		s.broadcast(Event{Type: "shop_source.updated", ShopID: shop.ID, EntityID: updated.ID, Payload: updated, CreatedAt: time.Now().UTC()})
	}
	writeJSONResponse(w, http.StatusOK, customerLoginRequirementResponse{Updated: len(updatedSources), Sources: nonNilSlice(updatedSources)})
}

func (s *Server) handleListSources(w http.ResponseWriter, r *http.Request) {
	_, user, ok := s.requireAuth(w, r)
	if !ok {
		return
	}
	if !userHasAnyPermission(user, PermissionWorkbenchAccess, PermissionShopsView, PermissionShopChannelsManage, PermissionCustomerLoginManage) {
		writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "source access permission is required"})
		return
	}
	requestedScope := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("scope")))
	if requestedScope != "" && requestedScope != "workbench" {
		writeError(w, ErrInvalid)
		return
	}
	if requestedScope == "workbench" && !userHasPermission(user, PermissionWorkbenchAccess) {
		writeError(w, ErrForbidden)
		return
	}
	sources, err := s.store.ListShopSources(r.Context(), "")
	if err != nil {
		writeError(w, err)
		return
	}
	shopIDs, restricted, listErr := s.moduleScopeShopIDs(r.Context(), user, DataScopeShops)
	if requestedScope == "workbench" {
		restricted = effectiveWorkbenchShopScope(user.WorkbenchShopScope) == AccessScopeAssigned
		if restricted {
			shopIDs, listErr = s.store.ListUserShopIDs(r.Context(), user.ID)
		}
	}
	if listErr != nil {
		writeError(w, listErr)
		return
	}
	if restricted {
		allowed := stringSet(shopIDs)
		filtered := sources[:0]
		for _, source := range sources {
			if allowed[source.ShopID] {
				filtered = append(filtered, source)
			}
		}
		sources = filtered
	}
	writeJSONResponse(w, http.StatusOK, nonNilSlice(sources))
}

func (s *Server) handleListShopAssignments(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, PermissionShopsAssign)
	if !ok {
		return
	}
	assignments, err := s.store.ListShopAssignments(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	shopIDs, restricted, listErr := s.moduleScopeShopIDs(r.Context(), user, DataScopeShops)
	if listErr != nil {
		writeError(w, listErr)
		return
	}
	if restricted {
		allowed := stringSet(shopIDs)
		filtered := assignments[:0]
		for _, assignment := range assignments {
			if allowed[assignment.ShopID] {
				filtered = append(filtered, assignment)
			}
		}
		assignments = filtered
	}
	writeJSONResponse(w, http.StatusOK, nonNilSlice(assignments))
}

func (s *Server) handleShopSubroutes(w http.ResponseWriter, r *http.Request) {
	parts := splitPath(r.URL.Path)
	if len(parts) < 4 || len(parts) > 8 || parts[0] != "api" || parts[1] != "v1" || parts[2] != "shops" {
		http.NotFound(w, r)
		return
	}
	shopID := parts[3]
	_, user, ok := s.requireAuth(w, r)
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		if len(parts) == 4 {
			http.NotFound(w, r)
			return
		}
		if len(parts) == 5 && parts[4] == "ai-reply-rules" {
			s.handleShopAIReplyRules(w, r, user, shopID)
			return
		}
		if len(parts) == 6 && parts[4] == "email" && parts[5] == "history-imports" {
			s.handleEmailHistoryImportList(w, r, user, shopID)
			return
		}
		if parts[4] == "shopify" && len(parts) == 6 && parts[5] == "orders" {
			s.handleShopifyOrderSearch(w, r, user, shopID)
			return
		}
		if parts[4] == "shopify" && len(parts) == 6 && parts[5] == "products" {
			s.handleShopifyProductSearch(w, r, user, shopID)
			return
		}
		if parts[4] == "shopify" && len(parts) == 6 && parts[5] == "customer" {
			s.handleShopifyCustomerSearch(w, r, user, shopID)
			return
		}
		if parts[4] == "shopify" && len(parts) == 6 && parts[5] == "connection" {
			s.handleShopifyConnectionStatus(w, r, user, shopID)
			return
		}
		if parts[4] == "shopify" && len(parts) == 6 && parts[5] == "returns" {
			s.handleShopifyReturns(w, r, user, shopID)
			return
		}
		if parts[4] == "shopify" && len(parts) == 6 && parts[5] == "disputes" {
			s.handleShopifyDisputes(w, r, user, shopID)
			return
		}
		if parts[4] == "agents" {
			if len(parts) != 5 {
				http.NotFound(w, r)
				return
			}
			if !s.requireModuleShopAccess(w, r, user, DataScopeShops, shopID) {
				return
			}
			if !userHasPermission(user, PermissionUsersView) {
				writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "user view permission is required"})
				return
			}
			users, err := s.store.ListShopUsers(r.Context(), shopID)
			if err != nil {
				writeError(w, err)
				return
			}
			for index := range users {
				users[index] = publicUser(users[index])
			}
			writeJSONResponse(w, http.StatusOK, nonNilSlice(users))
			return
		}
		if parts[4] != "sources" || len(parts) != 5 {
			http.NotFound(w, r)
			return
		}
		if userCanUseDataScopeModule(user, DataScopeShops) {
			if !s.requireModuleShopAccess(w, r, user, DataScopeShops, shopID) {
				return
			}
		} else if !userHasPermission(user, PermissionWorkbenchAccess) || !s.requireWorkbenchShopAccess(w, r, user, shopID) {
			return
		}
		sources, err := s.store.ListShopSources(r.Context(), shopID)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSONResponse(w, http.StatusOK, nonNilSlice(sources))
	case http.MethodPost:
		if len(parts) == 4 {
			http.NotFound(w, r)
			return
		}
		if len(parts) == 8 && parts[4] == "email" && parts[6] == "messages" && parts[7] == "read-state" {
			if !userHasPermission(user, PermissionWorkbenchAccess) || !s.requireWorkbenchShopAccess(w, r, user, shopID) {
				return
			}
			var input emailReadStateRequest
			if !decodeJSON(w, r, &input) {
				return
			}
			if err := s.setEmailMessageReadState(r.Context(), shopID, parts[5], input); err != nil {
				writeError(w, err)
				return
			}
			writeJSONResponse(w, http.StatusOK, map[string]bool{"ok": true})
			return
		}
		if len(parts) == 8 && parts[4] == "email" && parts[5] == "sources" && parts[7] == "history-import" {
			s.handleEmailHistoryImportAction(w, r, user, shopID, parts[6])
			return
		}
		if len(parts) == 8 && parts[4] == "email" && parts[5] == "sources" && parts[7] == "quarantine-retry" && r.Method == http.MethodPost {
			if !s.requireModuleShopAccess(w, r, user, DataScopeShops, shopID) {
				return
			}
			if !userHasPermission(user, PermissionShopChannelsManage) {
				writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "shop channel management permission is required"})
				return
			}
			result, err := s.retryEmailQuarantine(r.Context(), shopID, parts[6])
			if err != nil {
				writeError(w, err)
				return
			}
			writeJSONResponse(w, http.StatusOK, result)
			return
		}
		if len(parts) == 8 && parts[4] == "email" && parts[5] == "sources" && parts[7] == "sync-control" {
			if !s.requireModuleShopAccess(w, r, user, DataScopeShops, shopID) {
				return
			}
			if !userHasPermission(user, PermissionShopChannelsManage) {
				writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "shop channel management permission is required"})
				return
			}
			var input struct {
				Action string `json:"action"`
			}
			if !decodeJSON(w, r, &input) {
				return
			}
			action := strings.ToLower(strings.TrimSpace(input.Action))
			if action == "recover" {
				updated, err := s.recoverStandardIMAPSource(r.Context(), shopID, parts[6])
				if err != nil {
					writeError(w, err)
					return
				}
				writeJSONResponse(w, http.StatusOK, updated)
				return
			}
			paused := action == "pause"
			if !paused && action != "resume" {
				writeError(w, fmt.Errorf("%w: action must be pause, resume, or recover", ErrInvalid))
				return
			}
			updated, err := s.setEmailSourceManualPause(r.Context(), shopID, parts[6], paused, user.ID)
			if err != nil {
				writeError(w, err)
				return
			}
			if !paused && emailSourceAutomaticSyncDue(updated, time.Now().UTC()) {
				s.scheduleEmailSourceSync(updated, "manual resume")
			}
			writeJSONResponse(w, http.StatusOK, updated)
			return
		}
		if parts[4] == "shopify" && len(parts) == 7 && parts[5] == "returns" {
			switch parts[6] {
			case "decision":
				s.handleShopifyReturnDecision(w, r, user, shopID)
			case "refund-preview":
				s.handleShopifyReturnRefundPreview(w, r, user, shopID)
			case "refund-process":
				s.handleShopifyReturnRefundProcess(w, r, user, shopID)
			default:
				http.NotFound(w, r)
			}
			return
		}
		if !s.requireModuleShopAccess(w, r, user, DataScopeShops, shopID) {
			return
		}
		if len(parts) == 6 && parts[4] == "channels" && parts[5] == "check" {
			if !userHasAnyPermission(user, PermissionShopsView, PermissionShopChannelsManage) {
				writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "shop view permission is required"})
				return
			}
			result, err := s.checkShopChannels(r.Context(), shopID)
			if err != nil {
				writeError(w, err)
				return
			}
			writeJSONResponse(w, http.StatusOK, result)
			return
		}
		if len(parts) == 7 && parts[4] == "email" && parts[6] == "sync" {
			http.NotFound(w, r)
			return
		}
		if parts[4] == "agents" {
			if !userHasPermission(user, PermissionShopsAssign) {
				writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "shop assignment permission is required"})
				return
			}
		} else if !userHasPermission(user, PermissionShopChannelsManage) {
			writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "shop channel management permission is required"})
			return
		}
		if len(parts) == 7 && parts[4] == "email" && parts[5] == "outlook" && parts[6] == "auth-url" {
			var input emailAuthURLRequest
			if !decodeJSON(w, r, &input) {
				return
			}
			authURL, err := s.createOutlookAuthURL(r.Context(), shopID, emailInitialImportNow, r)
			if err != nil {
				writeError(w, err)
				return
			}
			writeJSONResponse(w, http.StatusOK, outlookAuthURLResponse{AuthURL: authURL})
			return
		}
		if len(parts) == 7 && parts[4] == "email" && parts[5] == "gmail" && parts[6] == "auth-url" {
			var input emailAuthURLRequest
			if !decodeJSON(w, r, &input) {
				return
			}
			authURL, err := s.createGmailAuthURL(r.Context(), shopID, emailInitialImportNow, r)
			if err != nil {
				writeError(w, err)
				return
			}
			writeJSONResponse(w, http.StatusOK, outlookAuthURLResponse{AuthURL: authURL})
			return
		}
		if len(parts) == 7 && parts[4] == "email" && parts[5] == cuiqiuProvider && parts[6] == "connect" {
			s.handleCuiqiuConnect(w, r, shopID)
			return
		}
		if len(parts) == 7 && parts[4] == "email" && (parts[5] == "standard" || parts[5] == "netease") && parts[6] == "connect" {
			s.handleStandardMailConnect(w, r, shopID)
			return
		}
		if parts[4] == "agents" {
			if len(parts) != 5 {
				http.NotFound(w, r)
				return
			}
			var input assignShopUserRequest
			if !decodeJSON(w, r, &input) {
				return
			}
			assignment, err := s.store.AssignUserToShop(r.Context(), shopID, input.UserID)
			if err != nil {
				writeError(w, err)
				return
			}
			s.auditAccountChange(r.Context(), user.ID, assignment.UserID, "shop.assigned", map[string]any{"shopId": shopID})
			s.broadcast(Event{Type: "shop_agent.assigned", ShopID: shopID, EntityID: assignment.UserID, Payload: assignment, CreatedAt: time.Now().UTC()})
			s.refreshEventClientPermissions(assignment.UserID)
			s.fillAgentCapacityAsync(assignment.UserID)
			writeJSONResponse(w, http.StatusCreated, assignment)
			return
		}
		if parts[4] != "sources" || len(parts) != 5 {
			http.NotFound(w, r)
			return
		}
		var input ShopSource
		if !decodeJSON(w, r, &input) {
			return
		}
		input.ShopID = shopID
		source, err := s.store.CreateShopSource(r.Context(), input)
		if err != nil {
			writeError(w, err)
			return
		}
		s.broadcast(Event{Type: "shop_source.created", ShopID: shopID, EntityID: source.ID, Payload: source, CreatedAt: time.Now().UTC()})
		s.notifyStandardIMAPSupervisor()
		writeJSONResponse(w, http.StatusCreated, source)
	case http.MethodPatch:
		if len(parts) == 5 && parts[4] == "ai-reply-rules" {
			s.handleShopAIReplyRules(w, r, user, shopID)
			return
		}
		if len(parts) == 7 && parts[4] == "shopify" && parts[5] == "orders" && parts[6] == "shipping-address" {
			s.handleShopifyOrderShippingAddressUpdate(w, r, user, shopID)
			return
		}
		if len(parts) == 7 && parts[4] == "shopify" && parts[5] == "fulfillments" && parts[6] == "tracking" {
			s.handleShopifyFulfillmentTrackingUpdate(w, r, user, shopID)
			return
		}
		if !s.requireModuleShopAccess(w, r, user, DataScopeShops, shopID) {
			return
		}
		if len(parts) == 5 && parts[4] == "customer-login" {
			if !userHasPermission(user, PermissionCustomerLoginManage) {
				writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "customer login management permission is required"})
				return
			}
			var input customerLoginRequirementRequest
			if !decodeJSON(w, r, &input) {
				return
			}
			updated, err := s.updateCustomerLoginRequirement(r.Context(), shopID, input.Required)
			if err != nil {
				writeError(w, err)
				return
			}
			s.broadcast(Event{Type: "shop_source.updated", ShopID: shopID, EntityID: updated.ID, Payload: updated, CreatedAt: time.Now().UTC()})
			writeJSONResponse(w, http.StatusOK, updated)
			return
		}
		if !userHasPermission(user, PermissionShopChannelsManage) {
			writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "shop channel management permission is required"})
			return
		}
		if len(parts) == 4 {
			var input updateShopRequest
			if !decodeJSON(w, r, &input) {
				return
			}
			if input.Metadata != nil {
				input.Metadata = removeLegacyShopOwnershipMetadata(input.Metadata)
			}
			shop, err := s.store.UpdateShop(r.Context(), shopID, Shop{
				DisplayName: input.DisplayName,
				Platform:    input.Platform,
				ExternalID:  input.ExternalID,
				Status:      input.Status,
				Metadata:    input.Metadata,
			})
			if err != nil {
				writeError(w, err)
				return
			}
			s.broadcast(Event{Type: "shop.updated", ShopID: shop.ID, EntityID: shop.ID, Payload: shop, CreatedAt: time.Now().UTC()})
			s.notifyStandardIMAPSupervisor()
			writeJSONResponse(w, http.StatusOK, shop)
			return
		}
		if len(parts) != 6 || parts[4] != "sources" {
			http.NotFound(w, r)
			return
		}
		var input updateShopSourceRequest
		if !decodeJSON(w, r, &input) {
			return
		}
		source, err := s.store.UpdateShopSource(r.Context(), shopID, parts[5], ShopSource{
			Status:   input.Status,
			Provider: input.Provider,
			Address:  input.Address,
			Metadata: input.Metadata,
		})
		if err != nil {
			writeError(w, err)
			return
		}
		s.broadcast(Event{Type: "shop_source.updated", ShopID: shopID, EntityID: source.ID, Payload: source, CreatedAt: time.Now().UTC()})
		s.notifyStandardIMAPSupervisor()
		writeJSONResponse(w, http.StatusOK, source)
	case http.MethodDelete:
		if !s.requireModuleShopAccess(w, r, user, DataScopeShops, shopID) {
			return
		}
		if len(parts) == 7 && parts[4] == "email" && parts[5] == "sources" {
			if !userHasPermission(user, PermissionShopChannelsManage) {
				writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "shop channel management permission is required"})
				return
			}
			result, err := s.disconnectEmailSource(r.Context(), shopID, parts[6])
			if err != nil {
				writeError(w, err)
				return
			}
			s.broadcast(Event{Type: "shop_source.updated", ShopID: shopID, EntityID: result.Source.ID, Payload: result.Source, CreatedAt: time.Now().UTC()})
			writeJSONResponse(w, http.StatusOK, result)
			return
		}
		if len(parts) == 4 {
			if !userHasPermission(user, PermissionShopsDelete) {
				writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "shop delete permission is required"})
				return
			}
			if err := s.ensureShopCanBeDeleted(r.Context(), shopID); err != nil {
				writeError(w, err)
				return
			}
			if err := s.store.DeleteShop(r.Context(), shopID); err != nil {
				writeError(w, err)
				return
			}
			s.broadcast(Event{Type: "shop.deleted", ShopID: shopID, EntityID: shopID, Payload: map[string]string{"shopId": shopID}, CreatedAt: time.Now().UTC()})
			s.notifyStandardIMAPSupervisor()
			writeJSONResponse(w, http.StatusOK, map[string]bool{"ok": true})
			return
		}
		if !userHasPermission(user, PermissionShopsAssign) {
			writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "shop assignment permission is required"})
			return
		}
		if len(parts) != 6 || parts[4] != "agents" {
			http.NotFound(w, r)
			return
		}
		if err := s.store.UnassignUserFromShop(r.Context(), shopID, parts[5]); err != nil {
			writeError(w, err)
			return
		}
		if err := s.releaseUserShopConversations(r.Context(), parts[5], shopID); err != nil {
			writeJSONResponse(w, http.StatusInternalServerError, map[string]string{"error": "shop assignment removed but active conversations could not be returned to the queue"})
			return
		}
		s.auditAccountChange(r.Context(), user.ID, parts[5], "shop.unassigned", map[string]any{"shopId": shopID})
		s.broadcast(Event{Type: "shop_agent.unassigned", ShopID: shopID, EntityID: parts[5], Payload: map[string]string{"shopId": shopID, "userId": parts[5]}, CreatedAt: time.Now().UTC()})
		s.refreshEventClientPermissions(parts[5])
		writeJSONResponse(w, http.StatusOK, map[string]bool{"ok": true})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *Server) ensureShopCanBeDeleted(ctx context.Context, shopID string) error {
	if _, err := s.store.GetShop(ctx, shopID); err != nil {
		return err
	}
	sources, err := s.store.ListShopSources(ctx, shopID)
	if err != nil {
		return err
	}
	var connected []string
	for _, source := range sources {
		if !isConnectedChannelSource(source) {
			continue
		}
		switch source.Type {
		case SourceTypeShopifyAPI:
			if strings.TrimSpace(s.shopifyAdminToken(ctx, sourceShopifyDomain(source))) != "" {
				connected = append(connected, "Shopify")
			}
		case SourceTypeEmail:
			connected = append(connected, "邮箱")
		}
	}
	if len(connected) > 0 {
		return fmt.Errorf("%w: 请先解绑%s后再删除店铺", ErrInvalid, strings.Join(connected, "和"))
	}
	return nil
}

func (s *Server) workbenchConversationFilter(w http.ResponseWriter, r *http.Request, user User) (ConversationFilter, bool) {
	filter := ConversationFilter{
		ShopID:            strings.TrimSpace(r.URL.Query().Get("shopId")),
		SourceID:          strings.TrimSpace(r.URL.Query().Get("sourceId")),
		Status:            strings.TrimSpace(r.URL.Query().Get("status")),
		Kind:              ConversationKindCustomer,
		UnreadUserID:      user.ID,
		Search:            strings.TrimSpace(r.URL.Query().Get("search")),
		ServiceLineOnly:   true,
		ActiveOnly:        strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("activeOnly")), "true"),
		ActiveShopsOnly:   true,
		ActiveSourcesOnly: strings.HasPrefix(user.ID, "erp:"),
	}
	assignedOnly := effectiveAccessScope(user.ConversationScope, user.Role) == AccessScopeAssigned || strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("scope")), AccessScopeAssigned)
	if filter.ShopID != "" && !s.requireWorkbenchShopAccess(w, r, user, filter.ShopID) {
		return ConversationFilter{}, false
	}
	if assignedOnly {
		filter.WorkbenchUserID = user.ID
		if user.Role == UserRoleAgent {
			filter.WorkbenchSkillGroup = user.SkillGroup
		}
	}
	if effectiveWorkbenchShopScope(user.WorkbenchShopScope) == AccessScopeAssigned {
		filter.WorkbenchShopUserID = user.ID
	}
	return filter, true
}

type conversationSummaryResponse struct {
	Assigned       int               `json:"assigned"`
	Open           int               `json:"open"`
	Closed         int               `json:"closed"`
	ActiveLoad     int               `json:"activeLoad"`
	Capacity       int               `json:"capacity"`
	RoutingReasons map[string]string `json:"routingReasons"`
}

func (s *Server) handleConversationSummary(w http.ResponseWriter, r *http.Request) {
	_, user, ok := s.requireAuth(w, r)
	if !ok {
		return
	}
	if !userHasPermission(user, PermissionWorkbenchAccess) {
		writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "workbench access permission is required"})
		return
	}
	baseFilter, ok := s.workbenchConversationFilter(w, r, user)
	if !ok {
		return
	}
	baseFilter.Status = ""
	baseFilter.ActiveOnly = false
	baseFilter.Page = 0
	baseFilter.PageSize = 0
	counts := map[string]int{}
	for _, status := range []string{ConversationStatusAssigned, ConversationStatusOpen, ConversationStatusClosed} {
		filter := baseFilter
		filter.Status = status
		filter.ActiveOnly = status != ConversationStatusClosed
		count, err := s.store.CountConversations(r.Context(), filter)
		if err != nil {
			writeError(w, err)
			return
		}
		counts[status] = count
	}
	loads, err := s.customerConversationLoads(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	queueFilter := baseFilter
	queueFilter.Status = ConversationStatusOpen
	queueFilter.ActiveOnly = true
	queueFilter.Page = 1
	queueFilter.PageSize = 500
	queued, err := s.store.ListConversations(r.Context(), queueFilter)
	if err != nil {
		writeError(w, err)
		return
	}
	queued = filterServiceLineConversations(queued)
	if err := s.annotateRoutingReasons(r.Context(), queued); err != nil {
		writeError(w, err)
		return
	}
	routingReasons := make(map[string]string, len(queued))
	for _, conversation := range queued {
		if conversation.RoutingReason != "" {
			routingReasons[conversation.ID] = conversation.RoutingReason
		}
	}
	writeJSONResponse(w, http.StatusOK, conversationSummaryResponse{
		Assigned: counts[ConversationStatusAssigned], Open: counts[ConversationStatusOpen], Closed: counts[ConversationStatusClosed],
		ActiveLoad: loads[user.ID], Capacity: normalizeReceptionLimit(user.ReceptionLimit), RoutingReasons: routingReasons,
	})
}

func (s *Server) handleListConversations(w http.ResponseWriter, r *http.Request) {
	_, user, ok := s.requireAuth(w, r)
	if !ok {
		return
	}
	if !userHasPermission(user, PermissionWorkbenchAccess) {
		writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "workbench access permission is required"})
		return
	}
	filter, ok := s.workbenchConversationFilter(w, r, user)
	if !ok {
		return
	}
	includeTotal := strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("includeTotal")), "true")
	if includeTotal || strings.TrimSpace(r.URL.Query().Get("page")) != "" || strings.TrimSpace(r.URL.Query().Get("pageSize")) != "" {
		filter.Page = positiveQueryInt(r.URL.Query().Get("page"), 1)
		filter.PageSize = positiveQueryInt(r.URL.Query().Get("pageSize"), 200)
		if filter.PageSize > 500 {
			filter.PageSize = 500
		}
	}
	items, err := s.store.ListConversations(r.Context(), filter)
	if err != nil {
		writeError(w, err)
		return
	}
	items = filterServiceLineConversations(items)
	if err := s.annotateRoutingReasons(r.Context(), items); err != nil {
		writeError(w, err)
		return
	}
	if includeTotal {
		total, countErr := s.store.CountConversations(r.Context(), filter)
		if countErr != nil {
			writeError(w, countErr)
			return
		}
		totalPages := 1
		if filter.PageSize > 0 && total > 0 {
			totalPages = (total + filter.PageSize - 1) / filter.PageSize
		}
		writeJSONResponse(w, http.StatusOK, map[string]any{
			"items": nonNilSlice(items), "page": filter.Page, "pageSize": filter.PageSize,
			"total": total, "totalPages": totalPages,
		})
		return
	}
	writeJSONResponse(w, http.StatusOK, nonNilSlice(items))
}

func (s *Server) filterWorkbenchConversations(ctx context.Context, user User, items []Conversation) ([]Conversation, error) {
	transfers, err := s.store.ListTransferRequests(ctx, user.ID, "", TransferStatusPending)
	if err != nil {
		return nil, err
	}
	transferConversationIDs := make(map[string]bool, len(transfers))
	for _, transfer := range transfers {
		if transferTargetsUser(transfer, user) {
			transferConversationIDs[transfer.ConversationID] = true
		}
	}
	visible := make([]Conversation, 0, len(items))
	for _, conversation := range items {
		if conversation.AssignedAgentID == user.ID ||
			(conversation.Status == ConversationStatusOpen && conversation.AssignedAgentID == "") ||
			transferConversationIDs[conversation.ID] {
			visible = append(visible, conversation)
		}
	}
	return visible, nil
}

func (s *Server) userCanAccessConversation(ctx context.Context, user User, conversation Conversation) (bool, error) {
	shop, err := s.store.GetShop(ctx, conversation.ShopID)
	if err != nil {
		return false, err
	}
	if shop.Status != ShopStatusActive {
		return false, nil
	}
	if strings.HasPrefix(user.ID, "erp:") {
		source, sourceErr := s.store.GetShopSource(ctx, conversation.ShopID, conversation.SourceID)
		if sourceErr != nil {
			return false, sourceErr
		}
		if source.Status != SourceStatusActive {
			return false, nil
		}
	}
	allowed, err := s.userCanAccessWorkbenchShop(ctx, user, conversation.ShopID)
	if err != nil || !allowed {
		return allowed, err
	}
	if effectiveAccessScope(user.ConversationScope, user.Role) == AccessScopeAll {
		return true, nil
	}
	if conversation.AssignedAgentID == user.ID ||
		(conversation.Status == ConversationStatusOpen && conversation.AssignedAgentID == "") {
		return true, nil
	}
	transfers, err := s.store.ListTransferRequests(ctx, user.ID, conversation.ID, TransferStatusPending)
	if err != nil {
		return false, err
	}
	for _, transfer := range transfers {
		if transferTargetsUser(transfer, user) {
			return true, nil
		}
	}
	return false, nil
}

func (s *Server) requireConversationAccess(w http.ResponseWriter, r *http.Request, user User, conversation Conversation) bool {
	allowed, err := s.userCanAccessConversation(r.Context(), user, conversation)
	if err != nil {
		writeError(w, err)
		return false
	}
	if !allowed {
		writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "conversation access is required"})
		return false
	}
	return true
}

func (s *Server) requireModuleConversationAccess(w http.ResponseWriter, r *http.Request, user User, module string, conversation Conversation) bool {
	allowed, err := s.userCanAccessModuleShop(r.Context(), user, module, conversation.ShopID)
	if err != nil {
		writeError(w, err)
		return false
	}
	if !allowed {
		writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "conversation access is required"})
		return false
	}
	return true
}

func conversationUnreadForUser(conversation Conversation, userID string, unreadSet map[string]bool) bool {
	if !unreadSet[conversation.ID] {
		return false
	}
	return conversation.Status != ConversationStatusAssigned || conversation.AssignedAgentID == userID
}

func (s *Server) handleCreateConversation(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, PermissionShopChannelsManage)
	if !ok {
		return
	}
	var input Conversation
	if !decodeJSON(w, r, &input) {
		return
	}
	if !s.requireModuleShopAccess(w, r, user, DataScopeShops, input.ShopID) {
		return
	}
	input.Status = ConversationStatusOpen
	input.AssignedAgentID = ""
	conversation, err := s.store.CreateConversation(r.Context(), input)
	if err != nil {
		writeError(w, err)
		return
	}
	s.broadcast(Event{Type: "conversation.created", ShopID: conversation.ShopID, EntityID: conversation.ID, Payload: conversation, CreatedAt: time.Now().UTC()})
	writeJSONResponse(w, http.StatusCreated, conversation)
}

func (s *Server) handleIngestConversation(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, PermissionShopChannelsManage)
	if !ok {
		return
	}
	var input ingestConversationRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	input.ShopID = strings.TrimSpace(input.ShopID)
	input.SourceID = strings.TrimSpace(input.SourceID)
	if input.ShopID == "" {
		writeError(w, ErrShopNeeded)
		return
	}
	if !s.requireModuleShopAccess(w, r, user, DataScopeShops, input.ShopID) {
		return
	}
	if input.SourceID == "" {
		writeError(w, fmt.Errorf("%w: sourceId is required", ErrInvalid))
		return
	}

	conversationID := stableExternalConversationID(input.SourceID, input.ExternalConversationID)
	conversation, err := s.store.GetConversation(r.Context(), conversationID)
	conversationCreated := false
	if errors.Is(err, ErrNotFound) {
		nextConversation := Conversation{
			ID:            conversationID,
			ShopID:        input.ShopID,
			SourceID:      input.SourceID,
			CustomerName:  input.CustomerName,
			CustomerEmail: input.CustomerEmail,
			Subject:       input.Subject,
			Status:        input.Status,
		}
		nextConversation.Status = ConversationStatusOpen
		nextConversation.AssignedAgentID = ""
		conversation, err = s.store.CreateConversation(r.Context(), Conversation{
			ID:              nextConversation.ID,
			ShopID:          nextConversation.ShopID,
			SourceID:        nextConversation.SourceID,
			CustomerName:    nextConversation.CustomerName,
			CustomerEmail:   nextConversation.CustomerEmail,
			Subject:         nextConversation.Subject,
			Status:          nextConversation.Status,
			AssignedAgentID: nextConversation.AssignedAgentID,
		})
		if err != nil {
			writeError(w, err)
			return
		}
		conversationCreated = true
		s.broadcastConversationEvent(conversation, Event{Type: "conversation.created", ShopID: conversation.ShopID, EntityID: conversation.ID, Payload: conversation, CreatedAt: time.Now().UTC()})
	} else if err != nil {
		writeError(w, err)
		return
	} else if conversation.ShopID != input.ShopID || conversation.SourceID != input.SourceID {
		writeError(w, fmt.Errorf("%w: externalConversationId belongs to a different shop or source", ErrInvalid))
		return
	}

	seenSourceMessageIDs := map[string]bool{}

	createdMessages := []Message{}
	skipped := 0
	for _, item := range input.Messages {
		sourceMessageID := strings.TrimSpace(item.SourceMessageID)
		if sourceMessageID != "" && seenSourceMessageIDs[sourceMessageID] {
			skipped++
			continue
		}
		candidateID := prefixedID("message")
		message, updatedConversation, err := s.store.AddMessage(r.Context(), Message{
			ID:              candidateID,
			ConversationID:  conversation.ID,
			Direction:       item.Direction,
			Body:            item.Body,
			Metadata:        item.Metadata,
			SenderName:      item.SenderName,
			SenderEmail:     item.SenderEmail,
			SourceMessageID: sourceMessageID,
			CreatedAt:       item.CreatedAt,
		})
		if err != nil {
			writeError(w, err)
			return
		}
		if message.ID != candidateID {
			skipped++
			continue
		}
		if sourceMessageID != "" {
			seenSourceMessageIDs[sourceMessageID] = true
		}
		conversation = updatedConversation
		createdMessages = append(createdMessages, message)
		s.broadcastConversationEvent(conversation, Event{Type: "message.created", ShopID: conversation.ShopID, EntityID: message.ID, Payload: message, CreatedAt: time.Now().UTC()})
	}

	if !conversationCreated && len(createdMessages) > 0 {
		s.broadcastConversationEvent(conversation, Event{Type: "conversation.updated", ShopID: conversation.ShopID, EntityID: conversation.ID, Payload: conversation, CreatedAt: time.Now().UTC()})
	}
	if len(createdMessages) > 0 && isCustomerConversation(conversation) {
		if routed, _, routeErr := s.tryAutoAssignConversation(r.Context(), conversation.ID); routeErr != nil {
			log.Printf("conversation ingest: automatic assignment failed for %s: %v", conversation.ID, routeErr)
		} else {
			conversation = routed
		}
	}

	writeJSONResponse(w, http.StatusOK, ingestConversationResponse{
		Conversation:        conversation,
		Messages:            createdMessages,
		ConversationCreated: conversationCreated,
		MessagesCreated:     len(createdMessages),
		MessagesSkipped:     skipped,
	})
}

func (s *Server) handleConversationSubroutes(w http.ResponseWriter, r *http.Request) {
	parts := splitPath(r.URL.Path)
	if len(parts) < 4 || parts[0] != "api" || parts[1] != "v1" || parts[2] != "conversations" {
		http.NotFound(w, r)
		return
	}
	conversationID := parts[3]
	_, user, ok := s.requireAuth(w, r)
	if !ok {
		return
	}
	if !userHasPermission(user, PermissionWorkbenchAccess) && !userHasPermission(user, PermissionTicketsView) {
		writeError(w, ErrForbidden)
		return
	}
	conversation, err := s.store.GetConversation(r.Context(), conversationID)
	if err != nil {
		writeError(w, err)
		return
	}
	if !s.requireConversationAccess(w, r, user, conversation) {
		return
	}
	if len(parts) == 4 {
		s.handleConversationUpdate(w, r, user, conversation)
		return
	}
	if len(parts) == 5 && parts[4] == "read" {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var input conversationReadRequest
		if r.ContentLength != 0 && !decodeJSON(w, r, &input) {
			return
		}
		throughMessageID := strings.TrimSpace(input.ThroughMessageID)
		if throughMessageID == "" {
			latest, latestErr := s.store.ListMessagePage(r.Context(), conversation.ID, "", 1)
			if latestErr != nil {
				writeError(w, latestErr)
				return
			}
			if len(latest) > 0 {
				throughMessageID = latest[len(latest)-1].ID
			}
		}
		readAt := time.Now().UTC()
		if throughMessageID != "" {
			throughMessage, messageErr := s.store.GetMessage(r.Context(), conversation.ID, throughMessageID)
			if messageErr != nil {
				writeError(w, messageErr)
				return
			}
			readAt = throughMessage.CreatedAt
		}
		if err := s.store.MarkConversationRead(r.Context(), user.ID, conversation.ID, readAt); err != nil {
			writeError(w, err)
			return
		}
		newlyReadMessages, rangeErr := s.store.ListMessageRange(r.Context(), conversation.ID, input.AfterMessageID, throughMessageID)
		if rangeErr != nil {
			writeError(w, rangeErr)
			return
		}
		emailSynced, syncErr := s.markHandledEmailMessagesRead(r.Context(), user.ID, conversation, newlyReadMessages)
		if syncErr != nil {
			log.Printf("conversation read: email read-state sync deferred for %s: %v", conversation.ID, syncErr)
		}
		writeJSONResponse(w, http.StatusOK, conversationReadResponse{OK: true, EmailReadSynced: emailSynced, EmailReadPending: !emailSynced})
		return
	}
	if len(parts) == 7 && parts[4] == "messages" && parts[6] == "translate" {
		s.handleMessageTranslation(w, r, user, conversation, parts[5])
		return
	}
	if len(parts) == 5 {
		switch parts[4] {
		case "shopify-context":
			s.handleConversationShopifyContext(w, r, conversation)
			return
		case "attachments":
			s.handleChatAttachmentUpload(w, r, user, conversation)
			return
		case "claim":
			s.handleConversationClaim(w, r, user, conversation)
			return
		case "close":
			s.handleConversationClose(w, r, user, conversation)
			return
		case "reopen":
			s.handleConversationReopen(w, r, user, conversation)
			return
		case "transfer-candidates":
			s.handleTransferCandidates(w, r, user, conversation)
			return
		case "transfers":
			s.handleConversationTransfers(w, r, user, conversation)
			return
		case "knowledge":
			s.handleConversationKnowledgeSubmit(w, r, user, conversation)
			return
		case "record":
			s.handleConversationRecord(w, r, user, conversation)
			return
		case "record-auto":
			s.handleConversationRecordAuto(w, r, user, conversation)
			return
		case "ai":
			s.handleConversationAISubroutes(w, r, user, conversation, parts)
			return
		}
	}
	if len(parts) == 6 && parts[4] == "ai" {
		s.handleConversationAISubroutes(w, r, user, conversation, parts)
		return
	}
	if len(parts) != 5 || parts[4] != "messages" {
		http.NotFound(w, r)
		return
	}
	switch r.Method {
	case http.MethodGet:
		pageSize := positiveQueryInt(r.URL.Query().Get("pageSize"), 50)
		if pageSize > 100 {
			pageSize = 100
		}
		messages, err := s.store.ListMessagePage(r.Context(), conversationID, strings.TrimSpace(r.URL.Query().Get("before")), pageSize)
		if err != nil {
			writeError(w, err)
			return
		}
		for _, message := range messages {
			body := stripQuotedEmailHistoryForSubject(message.Body, conversation.Subject)
			if message.Metadata[messageTranslationStatusKey] == messageTranslationDone &&
				!isUsableChineseMessageTranslation(body, message.Metadata[messageTranslationZHKey]) {
				s.translateMessageAsync(conversation, message)
			}
		}
		messages = expandQuotedEmailMessagesForDisplay(messages, conversation.Subject)
		writeJSONResponse(w, http.StatusOK, nonNilSlice(messages))
	case http.MethodPost:
		var input Message
		if !decodeJSON(w, r, &input) {
			return
		}
		input.ConversationID = conversationID
		input.Direction = defaultString(strings.TrimSpace(input.Direction), MessageDirectionCustomer)
		if input.Direction == MessageDirectionAgent && !userHasPermission(user, PermissionConversationReply) {
			writeError(w, ErrForbidden)
			return
		}
		if input.Direction != MessageDirectionAgent && user.Role != UserRoleAdmin {
			writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "agents can only send agent messages"})
			return
		}
		clientRequestID, requestIDErr := messageClientRequestID(input.Metadata)
		if requestIDErr != nil {
			writeError(w, requestIDErr)
			return
		}
		var message Message
		reconciled := false
		emailQueued := false
		if input.Direction == MessageDirectionAgent {
			emailSource, hasEmailSource, sourceErr := s.emailSourceForConversation(r.Context(), conversation)
			if sourceErr != nil {
				writeError(w, sourceErr)
				return
			}
			if hasEmailSource {
				if clientRequestID == "" {
					clientRequestID = prefixedID("email_send")
					input.Metadata = mergeStringMaps(input.Metadata, map[string]string{messageClientRequestIDKey: clientRequestID})
				}
				message, conversation, reconciled, err = s.enqueueAgentEmailMessage(r.Context(), emailSource, conversation, input, user, clientRequestID)
				emailQueued = true
			} else {
				message, conversation, err = s.store.AddAgentMessage(r.Context(), input, user.ID)
			}
		} else {
			message, conversation, err = s.store.AddMessage(r.Context(), input)
		}
		if err != nil {
			writeError(w, err)
			return
		}
		if conversation.LastMessageDirection != message.Direction || conversation.LastMessageAt.Before(message.CreatedAt) {
			if latest, latestErr := s.store.GetConversation(r.Context(), conversation.ID); latestErr == nil {
				conversation = latest
			}
		}
		if !reconciled {
			s.broadcastConversationEvent(conversation, Event{Type: "message.created", ShopID: conversation.ShopID, EntityID: message.ID, Payload: message, CreatedAt: time.Now().UTC()})
		} else if emailQueued {
			s.broadcastConversationEvent(conversation, Event{Type: "message.updated", ShopID: conversation.ShopID, EntityID: message.ID, Payload: message, CreatedAt: time.Now().UTC()})
		}
		if emailQueued {
			s.signalEmailOutboxWorker()
		}
		if input.Direction == MessageDirectionCustomer && isCustomerConversation(conversation) {
			if routed, _, routeErr := s.tryAutoAssignConversation(r.Context(), conversation.ID); routeErr != nil {
				log.Printf("conversation message: automatic assignment failed for %s: %v", conversation.ID, routeErr)
			} else {
				conversation = routed
			}
		}
		status := http.StatusCreated
		if emailQueued && reconciled {
			status = http.StatusOK
		} else if emailQueued {
			status = http.StatusAccepted
		}
		writeJSONResponse(w, status, message)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleConversationUpdate(w http.ResponseWriter, r *http.Request, user User, conversation Conversation) {
	if r.Method == http.MethodGet {
		writeJSONResponse(w, http.StatusOK, conversation)
		return
	}
	if r.Method != http.MethodPatch {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if effectiveAccessScope(user.ConversationScope, user.Role) != AccessScopeAll {
		writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "use claim, close, or reopen for agent conversation actions"})
		return
	}
	var input updateConversationRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	update := ConversationUpdate{}
	if input.Status != nil {
		status, err := normalizeConversationStatus(*input.Status)
		if err != nil {
			writeError(w, err)
			return
		}
		update.Status = status
	}
	if input.AssignedAgentID != nil {
		update.AssignedAgentID = strings.TrimSpace(*input.AssignedAgentID)
		update.SetAssignedAgentID = true
	}
	if update.Status == "" && !update.SetAssignedAgentID {
		writeError(w, fmt.Errorf("%w: status or assignedAgentId is required", ErrInvalid))
		return
	}
	if effectiveAccessScope(user.ConversationScope, user.Role) != AccessScopeAll && update.SetAssignedAgentID && update.AssignedAgentID != "" && update.AssignedAgentID != user.ID {
		writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "agent can only assign conversations to self"})
		return
	}
	if update.SetAssignedAgentID {
		if err := s.validateConversationAssignee(r.Context(), conversation.ShopID, update.AssignedAgentID); err != nil {
			writeError(w, err)
			return
		}
	}
	updated, err := s.store.UpdateConversation(r.Context(), conversation.ID, update)
	if err != nil {
		writeError(w, err)
		return
	}
	s.broadcastConversationEvent(updated, Event{Type: "conversation.updated", ShopID: updated.ShopID, EntityID: updated.ID, Payload: updated, CreatedAt: time.Now().UTC()})
	s.refillCapacityAfterConversationChange(conversation, updated)
	if updated.Status == ConversationStatusOpen && updated.AssignedAgentID == "" && isEffectiveRoutingConversation(updated) {
		if routed, _, routeErr := s.tryAutoAssignConversation(r.Context(), updated.ID); routeErr == nil {
			updated = routed
		}
	}
	writeJSONResponse(w, http.StatusOK, updated)
}

func (s *Server) handleConversationClaim(w http.ResponseWriter, r *http.Request, user User, conversation Conversation) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if !userHasPermission(user, PermissionConversationClaim) {
		writeError(w, ErrForbidden)
		return
	}
	if err := s.validateConversationAssignee(r.Context(), conversation.ShopID, user.ID); err != nil {
		writeError(w, err)
		return
	}
	s.routingMu.Lock()
	updated, err := s.store.ClaimConversation(r.Context(), conversation.ID, user.ID)
	s.routingMu.Unlock()
	if err != nil {
		writeError(w, err)
		return
	}
	if messages, messagesErr := s.store.ListMessages(r.Context(), updated.ID); messagesErr != nil {
		log.Printf("conversation claim: list messages for read sync failed for %s: %v", updated.ID, messagesErr)
	} else {
		visibleMessages, readAt, scopeErr := conversationMessagesThrough(messages, "")
		if scopeErr != nil {
			log.Printf("conversation claim: build read scope failed for %s: %v", updated.ID, scopeErr)
		} else {
			if markErr := s.store.MarkConversationRead(r.Context(), user.ID, updated.ID, readAt); markErr != nil {
				log.Printf("conversation claim: mark local read failed for %s: %v", updated.ID, markErr)
			}
			if _, syncErr := s.markHandledEmailMessagesRead(r.Context(), user.ID, updated, visibleMessages); syncErr != nil {
				log.Printf("conversation claim: email read-state sync deferred for %s: %v", updated.ID, syncErr)
			}
		}
	}
	s.broadcastConversationEvent(updated, Event{Type: "conversation.claimed", ShopID: updated.ShopID, EntityID: updated.ID, Payload: updated, CreatedAt: time.Now().UTC()})
	s.fillAgentCapacityAsync(user.ID)
	writeJSONResponse(w, http.StatusOK, updated)
}

func (s *Server) handleConversationClose(w http.ResponseWriter, r *http.Request, user User, conversation Conversation) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if !userHasPermission(user, PermissionConversationClose) {
		writeError(w, ErrForbidden)
		return
	}
	updated, err := s.store.CloseConversation(r.Context(), conversation.ID, user.ID)
	if err != nil {
		writeError(w, err)
		return
	}
	s.broadcastConversationEvent(updated, Event{Type: "conversation.updated", ShopID: updated.ShopID, EntityID: updated.ID, Payload: updated, CreatedAt: time.Now().UTC()})
	s.fillAgentCapacityAsync(user.ID)
	writeJSONResponse(w, http.StatusOK, updated)
}

func (s *Server) handleConversationReopen(w http.ResponseWriter, r *http.Request, user User, conversation Conversation) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if !userHasPermission(user, PermissionConversationClose) {
		writeError(w, ErrForbidden)
		return
	}
	if err := s.validateConversationAssignee(r.Context(), conversation.ShopID, user.ID); err != nil {
		writeError(w, err)
		return
	}
	s.routingMu.Lock()
	updated, err := s.store.ReopenConversation(r.Context(), conversation.ID, user.ID)
	s.routingMu.Unlock()
	if err != nil {
		writeError(w, err)
		return
	}
	s.broadcastConversationEvent(updated, Event{Type: "conversation.updated", ShopID: updated.ShopID, EntityID: updated.ID, Payload: updated, CreatedAt: time.Now().UTC()})
	writeJSONResponse(w, http.StatusOK, updated)
}

func (s *Server) validateConversationAssignee(ctx context.Context, shopID string, userID string) error {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil
	}
	user, err := s.store.GetUser(ctx, userID)
	if err != nil {
		return err
	}
	if user.Status != UserStatusActive {
		return fmt.Errorf("%w: assigned user is disabled", ErrInvalid)
	}
	if !userHasPermission(user, PermissionWorkbenchAccess) {
		return fmt.Errorf("%w: assigned user does not have workbench access", ErrInvalid)
	}
	shopIDs, err := s.store.ListUserShopIDs(ctx, user.ID)
	if err != nil {
		return err
	}
	if !stringSet(shopIDs)[strings.TrimSpace(shopID)] {
		return fmt.Errorf("%w: assigned agent is not assigned to this shop", ErrInvalid)
	}
	return nil
}

func (s *Server) handleEventsWebSocket(w http.ResponseWriter, r *http.Request) {
	if strings.TrimSpace(r.URL.Query().Get("token")) != "" {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "websocket credentials must not be sent in the URL"})
		return
	}
	ticket := strings.TrimSpace(r.URL.Query().Get("ticket"))
	if ticket == "" {
		writeJSONResponse(w, http.StatusUnauthorized, map[string]string{"error": "missing websocket ticket"})
		return
	}
	ticketHash := hashSessionToken(ticket)
	s.wsTicketsMu.Lock()
	grant, found := s.wsTickets[ticketHash]
	delete(s.wsTickets, ticketHash)
	s.wsTicketsMu.Unlock()
	if !found || time.Now().UTC().After(grant.ExpiresAt) {
		writeJSONResponse(w, http.StatusUnauthorized, map[string]string{"error": "invalid or expired websocket ticket"})
		return
	}
	if requestOrigin(r) == "" || requestOrigin(r) != grant.Origin || !s.originAllowed(r) {
		writeError(w, ErrForbidden)
		return
	}
	_, user, ok := s.requireAuthToken(w, r, grant.SessionToken)
	if !ok {
		return
	}
	if !userHasPermission(user, PermissionWorkbenchAccess) && !userHasPermission(user, PermissionTicketsView) {
		writeError(w, ErrForbidden)
		return
	}
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	_ = conn.SetReadDeadline(time.Now().Add(eventHeartbeatTimeout))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(eventHeartbeatTimeout))
	})
	client := &eventClient{user: user, assignedShop: map[string]bool{}, send: make(chan Event, eventClientQueueSize), done: make(chan struct{})}
	shopIDs, listErr := s.store.ListUserShopIDs(r.Context(), user.ID)
	if listErr != nil {
		_ = conn.Close()
		return
	}
	client.assignedShop = stringSet(shopIDs)
	s.clientsMu.Lock()
	s.clients[conn] = client
	s.clientsMu.Unlock()
	connectedAt := time.Now().UTC()
	log.Printf("agent websocket connected: user_id=%s connections=%d", user.ID, s.connectedUserConnectionCount(user.ID))
	go s.runEventWriter(conn, client)
	go s.runEventHeartbeat(conn, client, client.done)
	go s.watchNativeEventSession(conn, client, grant.SessionToken)
	if userIsCustomerServiceAgent(user) && user.ReceptionOnline && userHasPermission(user, PermissionWorkbenchAccess) && userHasPermission(user, PermissionAutoReception) {
		s.fillAgentCapacityAsync(user.ID)
	}
	var disconnectErr error
	defer func() {
		s.removeEventClient(conn)
		closeCode := 0
		var closeErr *websocket.CloseError
		if errors.As(disconnectErr, &closeErr) {
			closeCode = closeErr.Code
		}
		log.Printf("agent websocket disconnected: user_id=%s close_code=%d duration=%s connections=%d error=%v", user.ID, closeCode, time.Since(connectedAt).Round(time.Millisecond), s.connectedUserConnectionCount(user.ID), disconnectErr)
	}()
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			disconnectErr = err
			return
		}
		_ = conn.SetReadDeadline(time.Now().Add(eventHeartbeatTimeout))
	}
}

func (s *Server) runEventHeartbeat(conn *websocket.Conn, client *eventClient, done <-chan struct{}) {
	ticker := time.NewTicker(eventHeartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-done:
			return
		case now := <-ticker.C:
			if !s.enqueueEvent(conn, client, Event{Type: "connection.heartbeat", CreatedAt: now.UTC()}) {
				return
			}
			deadline := time.Now().Add(eventWriteTimeout)
			client.writeMu.Lock()
			_ = conn.SetWriteDeadline(deadline)
			err := conn.WriteControl(websocket.PingMessage, nil, deadline)
			client.writeMu.Unlock()
			if err != nil {
				s.removeEventClient(conn)
				return
			}
		}
	}
}

func (s *Server) connectedUserConnectionCount(userID string) int {
	userID = strings.TrimSpace(userID)
	s.clientsMu.Lock()
	defer s.clientsMu.Unlock()
	count := 0
	for _, client := range s.clients {
		if client.userSnapshot().ID == userID {
			count++
		}
	}
	return count
}

func (s *Server) connectedUserIDs() map[string]bool {
	s.clientsMu.Lock()
	defer s.clientsMu.Unlock()
	connected := make(map[string]bool, len(s.clients))
	for _, client := range s.clients {
		user := client.userSnapshot()
		if userIsCustomerServiceAgent(user) && userHasPermission(user, PermissionWorkbenchAccess) {
			connected[user.ID] = true
		}
	}
	return connected
}

func (s *Server) refreshEventClientPermissions(userID string) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return
	}
	shopIDs, err := s.store.ListUserShopIDs(context.Background(), userID)
	if err != nil {
		return
	}
	user, err := s.store.GetUser(context.Background(), userID)
	if err != nil {
		return
	}
	assigned := stringSet(shopIDs)
	s.clientsMu.Lock()
	defer s.clientsMu.Unlock()
	for _, client := range s.clients {
		if client.userSnapshot().ID == userID {
			client.permissionsMu.Lock()
			client.user = user
			client.assignedShop = assigned
			client.permissionsMu.Unlock()
		}
	}
}

func (c *eventClient) canAccessAssignedShop(shopID string) bool {
	c.permissionsMu.RLock()
	defer c.permissionsMu.RUnlock()
	return c.assignedShop[strings.TrimSpace(shopID)]
}

func (c *eventClient) userSnapshot() User {
	c.permissionsMu.RLock()
	defer c.permissionsMu.RUnlock()
	return c.user
}

func (c *eventClient) canAccessScopedShop(scope string, shopID string) bool {
	c.permissionsMu.RLock()
	defer c.permissionsMu.RUnlock()
	shopID = strings.TrimSpace(shopID)
	switch scope {
	case AccessScopeAssigned:
		return c.assignedShop[shopID]
	case AccessScopeSelected:
		return stringSet(c.user.ShopScopeIDs)[shopID]
	default:
		return true
	}
}

func (s *Server) eventClients() map[*websocket.Conn]*eventClient {
	s.clientsMu.Lock()
	defer s.clientsMu.Unlock()
	out := make(map[*websocket.Conn]*eventClient, len(s.clients))
	for conn, client := range s.clients {
		out[conn] = client
	}
	return out
}

func (s *Server) removeEventClient(conn *websocket.Conn) {
	s.clientsMu.Lock()
	client := s.clients[conn]
	delete(s.clients, conn)
	s.clientsMu.Unlock()
	if client != nil {
		client.stopOnce.Do(func() { close(client.done) })
	}
	_ = conn.Close()
}

func (s *Server) runEventWriter(conn *websocket.Conn, client *eventClient) {
	for {
		select {
		case <-client.done:
			return
		case event := <-client.send:
			if !s.writeEvent(conn, client, event) {
				return
			}
		}
	}
}

func (s *Server) enqueueEvent(conn *websocket.Conn, client *eventClient, event Event) bool {
	select {
	case <-client.done:
		return false
	case client.send <- event:
		return true
	default:
		s.removeEventClient(conn)
		return false
	}
}

func (s *Server) writeEvent(conn *websocket.Conn, client *eventClient, event Event) bool {
	client.writeMu.Lock()
	_ = conn.SetWriteDeadline(time.Now().Add(eventWriteTimeout))
	err := conn.WriteJSON(event)
	client.writeMu.Unlock()
	if err != nil {
		s.removeEventClient(conn)
		return false
	}
	return true
}

func (s *Server) broadcast(event Event) {
	for conn, client := range s.eventClients() {
		user := client.userSnapshot()
		ownUserEvent := strings.HasPrefix(event.Type, "user.") && event.EntityID == user.ID
		if !ownUserEvent && !clientCanReceiveEvent(user, event) {
			continue
		}
		ownAssignmentEvent := strings.HasPrefix(event.Type, "shop_agent.") && event.EntityID == user.ID
		shopScope := effectiveModuleScope(user, eventDataScopeModule(event))
		if strings.HasPrefix(event.Type, "conversation.") && userHasPermission(user, PermissionWorkbenchAccess) {
			shopScope = effectiveWorkbenchShopScope(user.WorkbenchShopScope)
		}
		if event.ShopID != "" && !ownAssignmentEvent && !client.canAccessScopedShop(shopScope, event.ShopID) {
			continue
		}
		s.enqueueEvent(conn, client, event)
	}
}

func eventDataScopeModule(event Event) string {
	switch {
	case strings.HasPrefix(event.Type, "knowledge."):
		return DataScopeKnowledge
	case strings.HasPrefix(event.Type, "ticket."):
		return DataScopeTickets
	case strings.HasPrefix(event.Type, "conversation."):
		return DataScopeMonitor
	default:
		return DataScopeShops
	}
}

func clientCanReceiveEvent(user User, event Event) bool {
	switch {
	case strings.HasPrefix(event.Type, "user."):
		return userHasPermission(user, PermissionUsersView)
	case strings.HasPrefix(event.Type, "shop_agent."):
		return event.EntityID == user.ID || userHasPermission(user, PermissionShopsAssign)
	case strings.HasPrefix(event.Type, "ticket."):
		return userHasPermission(user, PermissionTicketsView)
	case strings.HasPrefix(event.Type, "knowledge."):
		return true
	case strings.HasPrefix(event.Type, "conversation."):
		return userHasPermission(user, PermissionWorkbenchAccess)
	case strings.HasPrefix(event.Type, "shop."), strings.HasPrefix(event.Type, "shop_"), strings.HasPrefix(event.Type, "source."), strings.HasPrefix(event.Type, "email."), strings.HasPrefix(event.Type, "shopify_app."):
		return userHasAnyPermission(user, PermissionShopsView, PermissionShopChannelsManage, PermissionCustomerLoginManage)
	default:
		return true
	}
}

func (s *Server) broadcastConversationEvent(conversation Conversation, event Event) {
	event.Conversation = &conversation
	s.broadcastAssignedShopEvent(conversation, event)
	s.broadcastChat(conversation.ID, event)
	if event.Type == "message.created" && normalizeConversationKind(conversation.Kind) != ConversationKindDepartment {
		if message, ok := event.Payload.(Message); ok {
			s.translateMessageAsync(conversation, message)
			if message.Direction == MessageDirectionCustomer && conversation.AssignedAgentID != "" {
				s.enqueueConversationReplyDraft(conversation)
			}
		}
	}
}

func (s *Server) broadcastAssignedShopEvent(conversation Conversation, event Event) {
	if normalizeConversationKind(conversation.Kind) != ConversationKindCustomer {
		return
	}
	isOwnershipEvent := event.Type == "conversation.claimed" || event.Type == "conversation.transferred" || strings.HasPrefix(event.Type, "transfer.")
	for conn, client := range s.eventClients() {
		user := client.userSnapshot()
		if !userHasPermission(user, PermissionWorkbenchAccess) {
			continue
		}
		if effectiveWorkbenchShopScope(user.WorkbenchShopScope) == AccessScopeAssigned && !client.canAccessAssignedShop(event.ShopID) {
			continue
		}
		if effectiveAccessScope(user.ConversationScope, user.Role) == AccessScopeAssigned && conversation.AssignedAgentID != "" && conversation.AssignedAgentID != user.ID && !isOwnershipEvent {
			continue
		}
		s.enqueueEvent(conn, client, event)
	}
}

func (s *Server) broadcastChat(conversationID string, event Event) {
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return
	}
	s.chatClientsMu.Lock()
	subscribers := s.chatClients[conversationID]
	type chatSubscriber struct {
		conn   *websocket.Conn
		client *chatEventClient
	}
	connections := make([]chatSubscriber, 0, len(subscribers))
	for conn, client := range subscribers {
		connections = append(connections, chatSubscriber{conn: conn, client: client})
	}
	s.chatClientsMu.Unlock()
	for _, subscriber := range connections {
		s.enqueueChatEvent(conversationID, subscriber.conn, subscriber.client, event)
	}
}

func (s *Server) runChatEventWriter(conversationID string, conn *websocket.Conn, client *chatEventClient) {
	for {
		select {
		case <-client.done:
			return
		case event := <-client.send:
			client.writeMu.Lock()
			_ = conn.SetWriteDeadline(time.Now().Add(eventWriteTimeout))
			err := conn.WriteJSON(event)
			client.writeMu.Unlock()
			if err != nil {
				s.removeChatEventClient(conversationID, conn)
				return
			}
		}
	}
}

func (s *Server) enqueueChatEvent(conversationID string, conn *websocket.Conn, client *chatEventClient, event Event) bool {
	select {
	case <-client.done:
		return false
	case client.send <- event:
		return true
	default:
		s.removeChatEventClient(conversationID, conn)
		return false
	}
}

func (s *Server) removeChatEventClient(conversationID string, conn *websocket.Conn) {
	s.chatClientsMu.Lock()
	client := s.chatClients[conversationID][conn]
	delete(s.chatClients[conversationID], conn)
	if len(s.chatClients[conversationID]) == 0 {
		delete(s.chatClients, conversationID)
	}
	s.chatClientsMu.Unlock()
	if client != nil {
		client.stopOnce.Do(func() { close(client.done) })
	}
	_ = conn.Close()
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return false
	}
	return true
}

func writeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, context.Canceled):
		writeJSONResponse(w, http.StatusRequestTimeout, map[string]string{"error": err.Error()})
	case errors.Is(err, ErrNotFound):
		writeJSONResponse(w, http.StatusNotFound, map[string]string{"error": err.Error()})
	case errors.Is(err, ErrInvalid), errors.Is(err, ErrShopNeeded):
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	case errors.Is(err, ErrConflict):
		writeJSONResponse(w, http.StatusConflict, map[string]string{"error": err.Error()})
	case errors.Is(err, ErrForbidden):
		writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": err.Error()})
	case errors.Is(err, ErrRateLimited):
		writeJSONResponse(w, http.StatusTooManyRequests, map[string]string{"error": err.Error()})
	default:
		writeJSONResponse(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
}

func writeJSONResponse(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func nonNilSlice[T any](items []T) []T {
	if items == nil {
		return []T{}
	}
	return items
}

func splitPath(path string) []string {
	raw := strings.Split(strings.Trim(path, "/"), "/")
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		item = strings.TrimSpace(item)
		if item != "" {
			out = append(out, item)
		}
	}
	return out
}

func stableExternalConversationID(sourceID string, externalConversationID string) string {
	externalConversationID = strings.TrimSpace(externalConversationID)
	if externalConversationID == "" {
		return ""
	}
	sum := sha1.Sum([]byte(strings.TrimSpace(sourceID) + "\x00" + externalConversationID))
	return "conv_ext_" + hex.EncodeToString(sum[:])[:24]
}

func (s *Server) ConfigureAllowedOrigins(origins []string) {
	normalized := normalizeAllowedOrigins(origins)
	s.allowedOriginsMu.Lock()
	s.allowedOrigins = make(map[string]bool, len(normalized))
	for _, origin := range normalized {
		s.allowedOrigins[origin] = true
	}
	s.allowedOriginsMu.Unlock()
}

func (s *Server) setWSTicketRouteHook(hook func(string)) {
	s.wsTicketsMu.Lock()
	s.wsTicketRouteHook = hook
	s.wsTicketsMu.Unlock()
}

func normalizeAllowedOrigins(origins []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(origins))
	for _, raw := range origins {
		parsed, err := url.Parse(strings.TrimSpace(raw))
		if err != nil || parsed == nil ||
			(parsed.Scheme != "http" && parsed.Scheme != "https") ||
			parsed.Host == "" || parsed.User != nil ||
			(parsed.Path != "" && parsed.Path != "/") ||
			parsed.RawQuery != "" || parsed.Fragment != "" {
			continue
		}
		origin := parsed.Scheme + "://" + parsed.Host
		if !seen[origin] {
			seen[origin] = true
			out = append(out, origin)
		}
	}
	return out
}

func requestOrigin(r *http.Request) string {
	raw := strings.TrimSpace(r.Header.Get("Origin"))
	parsed, err := url.Parse(raw)
	if err != nil || parsed == nil ||
		(parsed.Scheme != "http" && parsed.Scheme != "https") ||
		parsed.Host == "" || parsed.User != nil ||
		(parsed.Path != "" && parsed.Path != "/") ||
		parsed.RawQuery != "" || parsed.Fragment != "" {
		return ""
	}
	return parsed.Scheme + "://" + parsed.Host
}

func (s *Server) originAllowed(r *http.Request) bool {
	origin := requestOrigin(r)
	if origin == "" {
		return false
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if origin == scheme+"://"+r.Host {
		return true
	}
	s.allowedOriginsMu.RLock()
	allowed := s.allowedOrigins[origin]
	s.allowedOriginsMu.RUnlock()
	return allowed
}

func (s *Server) websocketOriginAllowed(r *http.Request) bool {
	return s.originAllowed(r) || publicStorefrontRequest(r)
}

func (s *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := requestOrigin(r)
		originAllowed := origin != "" && (s.originAllowed(r) || publicStorefrontRequest(r))
		if originAllowed {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Add("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, "+erpTenantHeader)
		}
		if r.Method == http.MethodOptions {
			if !originAllowed {
				writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "origin is not allowed"})
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func publicStorefrontRequest(r *http.Request) bool {
	if r == nil || requestOrigin(r) == "" {
		return false
	}
	return strings.HasPrefix(r.URL.Path, "/api/v1/public/chat/") ||
		r.URL.Path == "/api/v1/public/chat/config" ||
		strings.HasPrefix(r.URL.Path, "/api/v1/chat/attachments/") ||
		r.URL.Path == "/ws/chat"
}

func filterShopsByIDs(shops []Shop, allowedIDs []string) []Shop {
	allowed := stringSet(allowedIDs)
	out := []Shop{}
	for _, shop := range shops {
		if allowed[shop.ID] {
			out = append(out, shop)
		}
	}
	return out
}

func filterActiveShops(shops []Shop) []Shop {
	out := []Shop{}
	for _, shop := range shops {
		if shop.Status == ShopStatusActive {
			out = append(out, shop)
		}
	}
	return out
}

func activeShopIDs(shops []Shop, allowedIDs []string) []string {
	allowed := stringSet(allowedIDs)
	out := []string{}
	for _, shop := range shops {
		if shop.Status == ShopStatusActive && allowed[shop.ID] {
			out = append(out, shop.ID)
		}
	}
	return out
}

func filterConversationsByShopIDs(conversations []Conversation, allowedIDs []string) []Conversation {
	allowed := stringSet(allowedIDs)
	out := []Conversation{}
	for _, conversation := range conversations {
		if allowed[conversation.ShopID] {
			out = append(out, conversation)
		}
	}
	return out
}

func (s *Server) filterConversationsForModuleScope(ctx context.Context, user User, module string, conversations []Conversation) ([]Conversation, error) {
	allowed, restricted, err := s.moduleScopeShopIDs(ctx, user, module)
	if err != nil {
		return nil, err
	}
	if restricted {
		conversations = filterConversationsByShopIDs(conversations, allowed)
	}
	return conversations, nil
}

func stringSet(values []string) map[string]bool {
	out := map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			out[value] = true
		}
	}
	return out
}
