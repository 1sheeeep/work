package installations

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

const (
	OAuthStartPath              = "/api/v1/shopify-connector/installations/oauth/start"
	ConnectionProbePath         = "/api/v1/erp-connector/shopify/connection"
	ProductCatalogPath          = "/api/v1/erp-connector/shopify/product-catalog"
	OrderCatalogPath            = "/api/v1/erp-connector/shopify/order-catalog"
	CustomerCatalogPath         = "/api/v1/erp-connector/shopify/customer-catalog"
	ReturnCatalogPath           = "/api/v1/erp-connector/shopify/return-catalog"
	ReturnDecisionPath          = "/api/v1/erp-connector/shopify/return-decision"
	ReturnRefundPreviewPath     = "/api/v1/erp-connector/shopify/return-refund-preview"
	ReturnRefundProcessPath     = "/api/v1/erp-connector/shopify/return-refund-process"
	LocationCatalogPath         = "/api/v1/erp-connector/shopify/location-catalog"
	InventoryLevelPath          = "/api/v1/erp-connector/shopify/inventory-level"
	InventorySetPath            = "/api/v1/erp-connector/shopify/inventory-set"
	OrderShippingAddressPath    = "/api/v1/erp-connector/shopify/order-shipping-address"
	DisputeCatalogPath          = "/api/v1/erp-connector/shopify/dispute-catalog"
	FulfillmentPublishPath      = "/api/v1/erp-connector/shopify/fulfillment-publish"
	ProbePath                   = "/api/v1/shopify-connector/installations/probe"
	UninstallPath               = "/api/v1/shopify-connector/installations/uninstall"
	RevokePath                  = "/api/v1/shopify-connector/installations/revoke"
	RevocationEffectsPath       = "/api/v1/shopify-connector/installations/revocation-effects"
	OAuthAuthorizePath          = "/shopify/oauth/authorize"
	OAuthCallbackPath           = "/shopify/oauth/callback"
	AppLaunchPath               = "/shopify/app"
	EmbeddedSessionPath         = "/shopify/session/exchange"
	EmbeddedProductsPath        = "/shopify/session/products"
	EmbeddedOrdersPath          = "/shopify/session/orders"
	AppUninstalledWebhookPath   = "/webhooks/shopify/app/uninstalled"
	ComplianceWebhookPath       = "/webhooks/shopify/compliance"
	ComplianceRequestListPath   = "/internal/v1/shopify/compliance-requests"
	ComplianceCompletePath      = "/internal/v1/shopify/compliance-requests/complete"
	ProtectedDataAccessListPath = "/internal/v1/shopify/protected-data-access-events"
	PrivacyPolicyPath           = "/shopify/privacy"
	TermsPath                   = "/shopify/terms"
	DataProcessingTermsPath     = "/shopify/data-processing-terms"
	SupportPath                 = "/shopify/support"
	DataDeletionPath            = "/shopify/data-deletion"
	ReviewerGuidePath           = "/shopify/guide"
	StorefrontSessionProxyPath  = "/shopify/proxy/chat/session"
	ServiceTokenHeader          = "X-XZ-ERP-Connector-Token"
	oauthBrowserCookieName      = "__Host-xz_shopify_oauth"
	installationRequestLimit    = 1 << 20
)

type RuntimeConfig struct {
	ServiceToken            string
	AppAPIKey               string
	AppSecret               string
	Scopes                  []string
	CallbackURL             string
	StateTTL                time.Duration
	PublicLegalName         string
	PublicCompanyWebsite    string
	PublicSupportEmail      string
	PublicPrivacyEmail      string
	PublicEffectiveDate     string
	PublicBusinessAddress   string
	PublicProcessingRegions string
	PublicSubprocessors     string
	PublicTransferMechanism string
	PublicOrderRetention    string
	PublicBackupRetention   string
	PublicDeletionProcess   string
	PublicPrivacyOfficer    string
}

func (c RuntimeConfig) String() string {
	return "runtimeConfig{serviceToken=[REDACTED] appKey=" + c.AppAPIKey +
		" appSecret=[REDACTED] callback=" + c.CallbackURL + "}"
}

func (c RuntimeConfig) GoString() string { return c.String() }

type OAuthStartRequest struct {
	Identity     shopifyconnector.CanonicalShopIdentity `json:"identity"`
	Context      shopifyconnector.RequestContext        `json:"context"`
	LegacyShopID string                                 `json:"legacyShopId"`
	ShopDomain   string                                 `json:"shopDomain"`
}

type OAuthStartResult struct {
	ContractVersion  string `json:"contractVersion"`
	AuthorizationURL string `json:"authorizationUrl"`
}

func (r OAuthStartResult) String() string {
	return "oauthStart{contractVersion=" + r.ContractVersion + " authorizationURL=[REDACTED]}"
}

func (r OAuthStartResult) GoString() string { return r.String() }

type RevocationEffectsResult struct {
	ContractVersion   string `json:"contractVersion"`
	TenantID          string `json:"tenantId"`
	ShopID            string `json:"shopId"`
	SourceDisabled    bool   `json:"sourceDisabled"`
	CachesInvalidated bool   `json:"cachesInvalidated"`
}

type oauthStatePayload struct {
	GrantID  string `json:"grantId"`
	IssuedAt int64  `json:"issuedAt"`
}

type appUninstalledPayload struct {
	MyshopifyDomain string `json:"myshopify_domain"`
}

type complianceWebhookPayload struct {
	ShopDomain string `json:"shop_domain"`
	ShopID     int64  `json:"shop_id"`
	Customer   struct {
		ID    int64  `json:"id"`
		Email string `json:"email"`
	} `json:"customer"`
	OrdersRequested []int64 `json:"orders_requested"`
	OrdersToRedact  []int64 `json:"orders_to_redact"`
}

type complianceCompletionRequest struct {
	EventID string `json:"eventId"`
	Outcome string `json:"outcome"`
}

type Handler struct {
	config              RuntimeConfig
	lifecycle           shopifyconnector.InstallationLifecycle
	uninstaller         shopifyconnector.InstallationUninstaller
	webhookUninstaller  UninstallWebhookReceiver
	connection          shopifyconnector.ConnectionProbe
	product             shopifyconnector.ProductCatalogReader
	order               shopifyconnector.OrderCatalogReader
	customers           shopifyconnector.CustomerCatalogReader
	returns             shopifyconnector.ReturnCatalogReader
	returnDecision      shopifyconnector.ReturnDecisionWriter
	returnRefundPreview shopifyconnector.ReturnRefundPreviewReader
	returnRefundProcess shopifyconnector.ReturnRefundProcessor
	locations           shopifyconnector.LocationCatalogReader
	inventory           shopifyconnector.InventoryLevelReader
	inventoryWriter     shopifyconnector.InventoryWriter
	orderAddress        shopifyconnector.OrderShippingAddressWriter
	disputes            shopifyconnector.DisputeCatalogReader
	fulfillment         shopifyconnector.FulfillmentPublisher
	embedded            EmbeddedSessionConnector
	repository          Repository
	mux                 *http.ServeMux
	now                 func() time.Time
}

func NewHandler(config RuntimeConfig, lifecycle shopifyconnector.InstallationLifecycle, repository Repository) (*Handler, error) {
	config.ServiceToken = strings.TrimSpace(config.ServiceToken)
	config.AppAPIKey = strings.TrimSpace(config.AppAPIKey)
	config.AppSecret = strings.TrimSpace(config.AppSecret)
	config.CallbackURL = strings.TrimSpace(config.CallbackURL)
	config.PublicLegalName = strings.TrimSpace(config.PublicLegalName)
	config.PublicCompanyWebsite = strings.TrimSpace(config.PublicCompanyWebsite)
	config.PublicSupportEmail = strings.TrimSpace(config.PublicSupportEmail)
	config.PublicPrivacyEmail = strings.TrimSpace(config.PublicPrivacyEmail)
	config.PublicEffectiveDate = strings.TrimSpace(config.PublicEffectiveDate)
	config.PublicBusinessAddress = strings.TrimSpace(config.PublicBusinessAddress)
	config.PublicProcessingRegions = strings.TrimSpace(config.PublicProcessingRegions)
	config.PublicSubprocessors = strings.TrimSpace(config.PublicSubprocessors)
	config.PublicTransferMechanism = strings.TrimSpace(config.PublicTransferMechanism)
	config.PublicOrderRetention = strings.TrimSpace(config.PublicOrderRetention)
	config.PublicBackupRetention = strings.TrimSpace(config.PublicBackupRetention)
	config.PublicDeletionProcess = strings.TrimSpace(config.PublicDeletionProcess)
	config.PublicPrivacyOfficer = strings.TrimSpace(config.PublicPrivacyOfficer)
	config.Scopes = normalizeScopes(config.Scopes)
	if config.StateTTL <= 0 {
		config.StateTTL = 15 * time.Minute
	}
	callback, err := url.Parse(config.CallbackURL)
	connection, connectionOK := lifecycle.(shopifyconnector.ConnectionProbe)
	product, productOK := lifecycle.(shopifyconnector.ProductCatalogReader)
	order, orderOK := lifecycle.(shopifyconnector.OrderCatalogReader)
	customers, customersOK := lifecycle.(shopifyconnector.CustomerCatalogReader)
	returns, returnsOK := lifecycle.(shopifyconnector.ReturnCatalogReader)
	returnDecision, returnDecisionOK := lifecycle.(shopifyconnector.ReturnDecisionWriter)
	returnRefundPreview, returnRefundPreviewOK := lifecycle.(shopifyconnector.ReturnRefundPreviewReader)
	returnRefundProcess, returnRefundProcessOK := lifecycle.(shopifyconnector.ReturnRefundProcessor)
	locations, locationsOK := lifecycle.(shopifyconnector.LocationCatalogReader)
	inventory, inventoryOK := lifecycle.(shopifyconnector.InventoryLevelReader)
	inventoryWriter, inventoryWriterOK := lifecycle.(shopifyconnector.InventoryWriter)
	orderAddress, orderAddressOK := lifecycle.(shopifyconnector.OrderShippingAddressWriter)
	disputes, disputesOK := lifecycle.(shopifyconnector.DisputeCatalogReader)
	fulfillment, fulfillmentOK := lifecycle.(shopifyconnector.FulfillmentPublisher)
	embedded, embeddedOK := lifecycle.(EmbeddedSessionConnector)
	uninstaller, uninstallerOK := lifecycle.(shopifyconnector.InstallationUninstaller)
	webhookUninstaller, webhookUninstallerOK := lifecycle.(UninstallWebhookReceiver)
	if config.ServiceToken == "" || config.AppAPIKey == "" || config.AppSecret == "" ||
		len(config.Scopes) == 0 || err != nil || callback.Scheme != "https" || callback.Host == "" ||
		callback.User != nil || callback.Path != OAuthCallbackPath || callback.RawQuery != "" || callback.Fragment != "" ||
		lifecycle == nil || repository == nil || !connectionOK || !productOK || !orderOK || !returnsOK || !locationsOK || !inventoryOK || !inventoryWriterOK || !orderAddressOK || !disputesOK || !fulfillmentOK || !embeddedOK || !uninstallerOK || !webhookUninstallerOK {
		return nil, errors.New("Shopify connector runtime configuration is invalid")
	}
	h := &Handler{config: config, lifecycle: lifecycle, uninstaller: uninstaller, connection: connection, product: product, order: order, customers: customers, returns: returns, returnDecision: returnDecision, returnRefundPreview: returnRefundPreview, returnRefundProcess: returnRefundProcess, locations: locations, inventory: inventory, inventoryWriter: inventoryWriter, orderAddress: orderAddress, disputes: disputes, fulfillment: fulfillment, embedded: embedded, repository: repository, mux: http.NewServeMux(), now: time.Now}
	h.webhookUninstaller = webhookUninstaller
	h.mux.HandleFunc("POST "+OAuthStartPath, h.handleOAuthStart)
	h.mux.HandleFunc("GET "+OAuthAuthorizePath, h.handleOAuthAuthorize)
	h.mux.HandleFunc("GET "+OAuthCallbackPath, h.handleOAuthCallback)
	h.mux.HandleFunc("GET "+AppLaunchPath, h.handleAppLaunch)
	h.mux.HandleFunc("POST "+EmbeddedSessionPath, h.handleEmbeddedSession)
	h.mux.HandleFunc("POST "+EmbeddedProductsPath, h.handleEmbeddedProducts)
	h.mux.HandleFunc("POST "+EmbeddedOrdersPath, h.handleEmbeddedOrders)
	h.mux.HandleFunc("POST "+EmbeddedChatSetupPath, h.handleEmbeddedChatSetup)
	h.mux.HandleFunc("POST "+NativeLinkGrantPath, h.handleNativeLinkGrant)
	h.mux.HandleFunc("POST "+NativeLinkPreviewPath, h.handleNativeLinkPreview)
	h.mux.HandleFunc("POST "+NativeLinkConfirmPath, h.handleNativeLinkConfirm)
	h.mux.HandleFunc("POST "+AppUninstalledWebhookPath, h.handleAppUninstalled)
	h.mux.HandleFunc("POST "+ComplianceWebhookPath, h.handleComplianceWebhook)
	h.mux.HandleFunc("GET "+ComplianceRequestListPath, h.handleComplianceRequestList)
	h.mux.HandleFunc("POST "+ComplianceCompletePath, h.handleComplianceRequestComplete)
	h.mux.HandleFunc("GET "+ProtectedDataAccessListPath, h.handleProtectedDataAccessList)
	h.mux.HandleFunc("GET "+PrivacyPolicyPath, h.handlePrivacyPolicy)
	h.mux.HandleFunc("GET "+TermsPath, h.handleTerms)
	h.mux.HandleFunc("GET "+DataProcessingTermsPath, h.handleDataProcessingTerms)
	h.mux.HandleFunc("GET "+SupportPath, h.handleSupport)
	h.mux.HandleFunc("GET "+DataDeletionPath, h.handleDataDeletion)
	h.mux.HandleFunc("GET "+ReviewerGuidePath, h.handleReviewerGuide)
	h.mux.HandleFunc("GET "+StorefrontSessionProxyPath, h.handleStorefrontSessionProxy)
	h.mux.HandleFunc("POST "+ProbePath, h.handleProbe)
	h.mux.HandleFunc("POST "+UninstallPath, h.handleUninstall)
	h.mux.HandleFunc("POST "+RevokePath, h.handleRevoke)
	h.mux.HandleFunc("POST "+ConnectionProbePath, h.handleConnectionProbe)
	h.mux.HandleFunc("POST "+ProductCatalogPath, h.handleProductCatalog)
	h.mux.HandleFunc("POST "+OrderCatalogPath, h.handleOrderCatalog)
	if customersOK {
		h.mux.HandleFunc("POST "+CustomerCatalogPath, h.handleCustomerCatalog)
	}
	h.mux.HandleFunc("POST "+ReturnCatalogPath, h.handleReturnCatalog)
	if returnDecisionOK {
		h.mux.HandleFunc("POST "+ReturnDecisionPath, h.handleReturnDecision)
	}
	if returnRefundPreviewOK {
		h.mux.HandleFunc("POST "+ReturnRefundPreviewPath, h.handleReturnRefundPreview)
	}
	if returnRefundProcessOK {
		h.mux.HandleFunc("POST "+ReturnRefundProcessPath, h.handleReturnRefundProcess)
	}
	h.mux.HandleFunc("POST "+LocationCatalogPath, h.handleLocationCatalog)
	h.mux.HandleFunc("POST "+InventoryLevelPath, h.handleInventoryLevel)
	h.mux.HandleFunc("POST "+InventorySetPath, h.handleInventorySet)
	h.mux.HandleFunc("POST "+OrderShippingAddressPath, h.handleOrderShippingAddress)
	h.mux.HandleFunc("POST "+DisputeCatalogPath, h.handleDisputeCatalog)
	h.mux.HandleFunc("POST "+FulfillmentPublishPath, h.handleFulfillmentPublish)
	h.mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeRuntimeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	return h, nil
}

func (h *Handler) handleAppLaunch(w http.ResponseWriter, r *http.Request) {
	renderEmbeddedApp(w, h.config.AppAPIKey, h.embeddedFrameShop(r))
}

func (h *Handler) handleComplianceWebhook(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if mediaType := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0])); mediaType != "application/json" {
		http.Error(w, "Shopify webhook requires application/json", http.StatusUnsupportedMediaType)
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, installationRequestLimit+1))
	if err != nil || len(raw) > installationRequestLimit {
		http.Error(w, "Shopify webhook is unavailable", http.StatusBadRequest)
		return
	}
	if !verifyShopifyWebhookHMAC(raw, r.Header.Get("X-Shopify-Hmac-Sha256"), h.config.AppSecret) {
		http.Error(w, "invalid Shopify webhook HMAC", http.StatusUnauthorized)
		return
	}
	topic := strings.TrimSpace(r.Header.Get("X-Shopify-Topic"))
	if topic != "customers/data_request" && topic != "customers/redact" && topic != "shop/redact" {
		http.Error(w, "invalid Shopify webhook topic", http.StatusBadRequest)
		return
	}
	headerDomain, headerOK := shopifyconnector.NormalizeShopDomain(r.Header.Get("X-Shopify-Shop-Domain"))
	var payload complianceWebhookPayload
	if !headerOK || json.Unmarshal(raw, &payload) != nil || payload.ShopID <= 0 {
		http.Error(w, "invalid Shopify webhook payload", http.StatusBadRequest)
		return
	}
	payloadDomain, payloadOK := shopifyconnector.NormalizeShopDomain(payload.ShopDomain)
	if !payloadOK || payloadDomain != headerDomain {
		http.Error(w, "Shopify webhook shop domain mismatch", http.StatusBadRequest)
		return
	}
	if topic == "shop/redact" {
		if err := h.repository.DiscardPendingInstallation(r.Context(), headerDomain); err != nil {
			http.Error(w, "Shopify webhook is temporarily unavailable", http.StatusServiceUnavailable)
			return
		}
	}
	identity, err := h.repository.ResolveIdentityByDomain(r.Context(), headerDomain)
	if errors.Is(err, ErrNotFound) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err != nil {
		http.Error(w, "Shopify webhook is temporarily unavailable", http.StatusServiceUnavailable)
		return
	}
	references := []string{"shop:" + formatInt64(payload.ShopID)}
	if payload.Customer.ID > 0 {
		references = append(references, "customer:"+formatInt64(payload.Customer.ID))
	}
	if emailHash := complianceCustomerEmailHash(payload.Customer.Email); emailHash != "" {
		references = append(references, "customer_email_sha256:"+emailHash)
	}
	orderIDs := payload.OrdersRequested
	if topic == "customers/redact" {
		orderIDs = payload.OrdersToRedact
	}
	for _, orderID := range orderIDs {
		if orderID > 0 {
			references = append(references, "order:"+formatInt64(orderID))
		}
	}
	sort.Strings(references)
	deliveryID := shopifyWebhookRequestID(r.Header.Get("X-Shopify-Webhook-Id"), raw)
	if err := h.repository.EnqueueOutbox(r.Context(), OutboxEvent{
		ID: "shopify-compliance/" + topic + "/" + deliveryID, Kind: "shopify.compliance.requested",
		Identity: identity, ShopDomain: headerDomain, Topic: topic, ReferenceIDs: references, OccurredAt: h.now().UTC(),
	}); err != nil {
		http.Error(w, "Shopify webhook is temporarily unavailable", http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func complianceCustomerEmailHash(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" || len(value) > 320 || strings.ContainsAny(value, "\x00\r\n\t") {
		return ""
	}
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}

func (h *Handler) handleComplianceRequestList(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !h.requireServiceToken(w, r) {
		return
	}
	if r.URL.RawQuery != "" {
		writeRuntimeJSON(w, http.StatusBadRequest, map[string]string{"error": "Shopify compliance request query is invalid"})
		return
	}
	events, err := h.repository.ListOutbox(r.Context())
	if err != nil {
		http.Error(w, "Shopify compliance requests are temporarily unavailable", http.StatusServiceUnavailable)
		return
	}
	pending := make([]OutboxEvent, 0, min(len(events), 100))
	for _, event := range events {
		if event.Kind == "shopify.compliance.requested" && event.CompletedAt == nil {
			pending = append(pending, event)
			if len(pending) == 100 {
				break
			}
		}
	}
	writeRuntimeJSON(w, http.StatusOK, map[string]any{"requests": pending})
}

func (h *Handler) handleComplianceRequestComplete(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !h.requireServiceToken(w, r) {
		return
	}
	if r.URL.RawQuery != "" {
		writeRuntimeJSON(w, http.StatusBadRequest, map[string]string{"error": "Shopify compliance request completion query is invalid"})
		return
	}
	var request complianceCompletionRequest
	if !decodeRuntimeJSON(w, r, &request) {
		return
	}
	event, already, err := h.repository.CompleteOutbox(r.Context(), request.EventID, request.Outcome, h.now().UTC())
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			writeRuntimeJSON(w, http.StatusNotFound, map[string]string{"error": "Shopify compliance request was not found"})
		case errors.Is(err, ErrRepositoryStale):
			writeRuntimeJSON(w, http.StatusConflict, map[string]string{"error": "Shopify compliance request completion conflicts with the recorded outcome"})
		case errors.Is(err, ErrInvalidBinding):
			writeRuntimeJSON(w, http.StatusBadRequest, map[string]string{"error": "Shopify compliance request completion is invalid"})
		default:
			writeRuntimeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Shopify compliance request completion is temporarily unavailable"})
		}
		return
	}
	writeRuntimeJSON(w, http.StatusOK, map[string]any{
		"eventId": event.ID, "outcome": event.Outcome, "completedAt": event.CompletedAt, "alreadyCompleted": already,
	})
}

func (h *Handler) handleProtectedDataAccessList(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !h.requireServiceToken(w, r) {
		return
	}
	if r.URL.RawQuery != "" {
		writeRuntimeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "Protected-data access event query is invalid",
		})
		return
	}
	events, err := h.repository.ListProtectedDataAccess(r.Context())
	if err != nil {
		writeRuntimeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "Protected-data access events are temporarily unavailable",
		})
		return
	}
	const responseLimit = 100
	if len(events) > responseLimit {
		events = events[len(events)-responseLimit:]
	}
	writeRuntimeJSON(w, http.StatusOK, map[string]any{"events": events})
}

func formatInt64(value int64) string {
	return strconv.FormatInt(value, 10)
}

func (h *Handler) handleAppUninstalled(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if mediaType := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0])); mediaType != "application/json" {
		http.Error(w, "Shopify webhook requires application/json", http.StatusUnsupportedMediaType)
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, installationRequestLimit+1))
	if err != nil || len(raw) > installationRequestLimit {
		http.Error(w, "Shopify webhook is unavailable", http.StatusBadRequest)
		return
	}
	if !verifyShopifyWebhookHMAC(raw, r.Header.Get("X-Shopify-Hmac-Sha256"), h.config.AppSecret) {
		http.Error(w, "invalid Shopify webhook HMAC", http.StatusUnauthorized)
		return
	}
	if strings.TrimSpace(r.Header.Get("X-Shopify-Topic")) != "app/uninstalled" {
		http.Error(w, "invalid Shopify webhook topic", http.StatusBadRequest)
		return
	}
	headerDomain, headerOK := shopifyconnector.NormalizeShopDomain(r.Header.Get("X-Shopify-Shop-Domain"))
	var payload appUninstalledPayload
	if !headerOK || json.Unmarshal(raw, &payload) != nil {
		http.Error(w, "invalid Shopify webhook payload", http.StatusBadRequest)
		return
	}
	payloadDomain, payloadOK := shopifyconnector.NormalizeShopDomain(payload.MyshopifyDomain)
	if !payloadOK || payloadDomain != headerDomain {
		http.Error(w, "Shopify webhook shop domain mismatch", http.StatusBadRequest)
		return
	}
	digest := sha256.Sum256(raw)
	delivery := UninstallWebhook{ShopDomain: headerDomain,
		DeliveryID: r.Header.Get("X-Shopify-Webhook-Id"), EventID: r.Header.Get("X-Shopify-Event-Id"), PayloadHash: hex.EncodeToString(digest[:])}
	if _, err := delivery.keys(); err != nil {
		http.Error(w, "invalid Shopify webhook identifier", http.StatusBadRequest)
		return
	}
	if err := h.webhookUninstaller.ReceiveUninstallWebhook(r.Context(), delivery); err != nil {
		http.Error(w, "Shopify webhook is temporarily unavailable", http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func verifyShopifyWebhookHMAC(raw []byte, header string, secret string) bool {
	provided, err := base64.StdEncoding.DecodeString(strings.TrimSpace(header))
	if err != nil || len(provided) != sha256.Size || strings.TrimSpace(secret) == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(raw)
	return hmac.Equal(provided, mac.Sum(nil))
}

func shopifyWebhookRequestID(webhookID string, raw []byte) string {
	value := strings.TrimSpace(webhookID)
	if value != "" && len(value) <= 100 {
		valid := true
		for _, r := range value {
			if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || strings.ContainsRune("._:-", r)) {
				valid = false
				break
			}
		}
		if valid {
			return "shopify-uninstall:" + value
		}
	}
	digest := sha256.Sum256(raw)
	return "shopify-uninstall:" + hex.EncodeToString(digest[:])
}

func (h *Handler) handleOrderShippingAddress(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !h.requireServiceToken(w, r) {
		return
	}
	var request shopifyconnector.OrderShippingAddressUpdateRequest
	if !decodeRuntimeJSON(w, r, &request) {
		return
	}
	result, err := h.orderAddress.UpdateOrderShippingAddress(r.Context(), request)
	if err != nil {
		writeRuntimeError(w, err)
		return
	}
	if shopifyconnector.ValidateOrderShippingAddressUpdateResult(request, result) != nil {
		writeRuntimeError(w, shopifyconnector.SafeOrderShippingAddressErrorFor(request, errors.New("Shopify order address response is invalid")))
		return
	}
	writeRuntimeJSON(w, http.StatusOK, result)
}

func (h *Handler) handleFulfillmentPublish(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !h.requireServiceToken(w, r) {
		return
	}
	var request shopifyconnector.FulfillmentPublishRequest
	if !decodeRuntimeJSON(w, r, &request) {
		return
	}
	result, err := h.fulfillment.PublishFulfillment(r.Context(), request)
	if err != nil {
		writeRuntimeError(w, err)
		return
	}
	if shopifyconnector.ValidateFulfillmentPublishResult(request, result) != nil {
		writeRuntimeError(w, shopifyconnector.SafeFulfillmentPublishErrorFor(request, errors.New("Shopify fulfillment response is invalid")))
		return
	}
	writeRuntimeJSON(w, http.StatusOK, result)
}

func (h *Handler) handleReturnCatalog(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !h.requireServiceToken(w, r) {
		return
	}
	var request shopifyconnector.ReturnCatalogPageRequest
	if !decodeRuntimeJSON(w, r, &request) {
		return
	}
	result, err := h.returns.FetchReturnCatalogPage(r.Context(), request)
	if err != nil {
		writeRuntimeError(w, err)
		return
	}
	if err := shopifyconnector.ValidateReturnCatalogPage(request, result); err != nil {
		writeRuntimeError(w, shopifyconnector.SafeReturnCatalogErrorFor(request, err))
		return
	}
	writeRuntimeJSON(w, http.StatusOK, result)
}

func (h *Handler) handleReturnDecision(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !h.requireServiceToken(w, r) {
		return
	}
	var request shopifyconnector.ReturnDecisionRequest
	if !decodeRuntimeJSON(w, r, &request) {
		return
	}
	result, err := h.returnDecision.DecideReturn(r.Context(), request)
	if err != nil {
		writeRuntimeError(w, err)
		return
	}
	if err := shopifyconnector.ValidateReturnDecisionResult(request, result); err != nil {
		writeRuntimeError(w, shopifyconnector.SafeReturnDecisionErrorFor(request, err))
		return
	}
	writeRuntimeJSON(w, http.StatusOK, result)
}

func (h *Handler) handleReturnRefundPreview(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !h.requireServiceToken(w, r) {
		return
	}
	var request shopifyconnector.ReturnRefundPreviewRequest
	if !decodeRuntimeJSON(w, r, &request) {
		return
	}
	result, err := h.returnRefundPreview.PreviewReturnRefund(r.Context(), request)
	if err != nil {
		writeRuntimeError(w, err)
		return
	}
	if err := shopifyconnector.ValidateReturnRefundPreview(request, result); err != nil {
		writeRuntimeError(w, shopifyconnector.SafeReturnRefundPreviewErrorFor(request, err))
		return
	}
	writeRuntimeJSON(w, http.StatusOK, result)
}

func (h *Handler) handleReturnRefundProcess(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !h.requireServiceToken(w, r) {
		return
	}
	var request shopifyconnector.ReturnRefundProcessRequest
	if !decodeRuntimeJSON(w, r, &request) {
		return
	}
	result, err := h.returnRefundProcess.ProcessReturnRefund(r.Context(), request)
	if err != nil {
		writeRuntimeError(w, err)
		return
	}
	if err := shopifyconnector.ValidateReturnRefundProcessResult(request, result); err != nil {
		writeRuntimeError(w, shopifyconnector.SafeReturnRefundProcessErrorFor(request, err))
		return
	}
	writeRuntimeJSON(w, http.StatusOK, result)
}

func (h *Handler) handleLocationCatalog(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !h.requireServiceToken(w, r) {
		return
	}
	var request shopifyconnector.LocationCatalogPageRequest
	if !decodeRuntimeJSON(w, r, &request) {
		return
	}
	result, err := h.locations.FetchLocationCatalogPage(r.Context(), request)
	if err != nil {
		writeRuntimeError(w, err)
		return
	}
	if err := shopifyconnector.ValidateLocationCatalogPage(request, result); err != nil {
		writeRuntimeError(w, shopifyconnector.SafeLocationCatalogErrorFor(request, err))
		return
	}
	writeRuntimeJSON(w, http.StatusOK, result)
}

func (h *Handler) handleInventoryLevel(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !h.requireServiceToken(w, r) {
		return
	}
	var request shopifyconnector.InventoryLevelReadRequest
	if !decodeRuntimeJSON(w, r, &request) {
		return
	}
	result, err := h.inventory.FetchInventoryLevel(r.Context(), request)
	if err != nil {
		writeRuntimeError(w, err)
		return
	}
	if err := shopifyconnector.ValidateInventoryLevelSnapshot(request, result); err != nil {
		writeRuntimeError(w, shopifyconnector.SafeInventoryLevelErrorFor(request, err))
		return
	}
	writeRuntimeJSON(w, http.StatusOK, result)
}

func (h *Handler) handleInventorySet(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !h.requireServiceToken(w, r) {
		return
	}
	var request shopifyconnector.InventorySetRequest
	if !decodeRuntimeJSON(w, r, &request) {
		return
	}
	result, err := h.inventoryWriter.SetInventoryAvailable(r.Context(), request)
	if err != nil {
		writeRuntimeError(w, err)
		return
	}
	if err := shopifyconnector.ValidateInventorySetResult(request, result); err != nil {
		writeRuntimeError(w, shopifyconnector.SafeInventorySetErrorFor(request, err))
		return
	}
	writeRuntimeJSON(w, http.StatusOK, result)
}

func (h *Handler) handleDisputeCatalog(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !h.requireServiceToken(w, r) {
		return
	}
	var request shopifyconnector.DisputeCatalogPageRequest
	if !decodeRuntimeJSON(w, r, &request) {
		return
	}
	result, err := h.disputes.FetchDisputeCatalogPage(r.Context(), request)
	if err != nil {
		writeRuntimeError(w, err)
		return
	}
	if err := shopifyconnector.ValidateDisputeCatalogPage(request, result); err != nil {
		writeRuntimeError(w, shopifyconnector.SafeDisputeCatalogErrorFor(request, err))
		return
	}
	writeRuntimeJSON(w, http.StatusOK, result)
}

func (h *Handler) handleOrderCatalog(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !h.requireServiceToken(w, r) {
		return
	}
	var request shopifyconnector.OrderCatalogPageRequest
	if !decodeRuntimeJSON(w, r, &request) {
		return
	}
	result, err := h.order.FetchOrderCatalogPage(r.Context(), request)
	if err != nil {
		writeRuntimeError(w, err)
		return
	}
	if err := shopifyconnector.ValidateOrderCatalogPage(request, result); err != nil {
		writeRuntimeError(w, shopifyconnector.SafeOrderCatalogErrorFor(request, err))
		return
	}
	writeRuntimeJSON(w, http.StatusOK, result)
}

func (h *Handler) handleCustomerCatalog(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !h.requireServiceToken(w, r) {
		return
	}
	var request shopifyconnector.CustomerCatalogPageRequest
	if !decodeRuntimeJSON(w, r, &request) {
		return
	}
	result, err := h.customers.FetchCustomerCatalogPage(r.Context(), request)
	if err != nil {
		writeRuntimeError(w, err)
		return
	}
	if err := shopifyconnector.ValidateCustomerCatalogPage(request, result); err != nil {
		writeRuntimeError(w, shopifyconnector.SafeCustomerCatalogErrorFor(request, err))
		return
	}
	writeRuntimeJSON(w, http.StatusOK, result)
}

func (h *Handler) handleProductCatalog(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !h.requireServiceToken(w, r) {
		return
	}
	var request shopifyconnector.ProductCatalogPageRequest
	if !decodeRuntimeJSON(w, r, &request) {
		return
	}
	result, err := h.product.FetchProductCatalogPage(r.Context(), request)
	if err != nil {
		writeRuntimeError(w, err)
		return
	}
	if err := shopifyconnector.ValidateProductCatalogPage(request, result); err != nil {
		writeRuntimeError(w, shopifyconnector.SafeCatalogErrorFor(request, err))
		return
	}
	writeRuntimeJSON(w, http.StatusOK, result)
}

func (h *Handler) handleConnectionProbe(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !h.requireServiceToken(w, r) {
		return
	}
	var request shopifyconnector.ConnectionProbeRequest
	if !decodeRuntimeJSON(w, r, &request) {
		return
	}
	result, err := h.connection.ProbeConnection(r.Context(), request)
	if err != nil {
		writeRuntimeError(w, err)
		return
	}
	if err := shopifyconnector.ValidateConnectionSummary(request, result); err != nil {
		writeRuntimeError(w, shopifyconnector.SafeErrorFor(request, err))
		return
	}
	writeRuntimeJSON(w, http.StatusOK, result)
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.mux.ServeHTTP(w, r)
}

func (h *Handler) handleOAuthStart(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !h.requireServiceToken(w, r) {
		return
	}
	var request OAuthStartRequest
	if !decodeRuntimeJSON(w, r, &request) {
		return
	}
	validation := shopifyconnector.CompleteOAuthRequest{
		Identity: request.Identity, Context: request.Context, LegacyShopID: request.LegacyShopID,
		ShopDomain: request.ShopDomain, AuthorizationCode: "pending-oauth-code",
	}
	if err := shopifyconnector.ValidateCompleteOAuthRequest(validation); err != nil {
		writeRuntimeError(w, shopifyconnector.InvalidInstallationRequestError(request.Identity, request.Context))
		return
	}
	callback, _ := url.Parse(h.config.CallbackURL)
	if strings.Contains(h.config.AppAPIKey, "not-configured") ||
		strings.Contains(h.config.AppSecret, "not-configured") ||
		strings.EqualFold(callback.Hostname(), "local.invalid") {
		writeRuntimeError(w, shopifyconnector.SafeInstallationErrorFor(
			request.Context, errors.New("Shopify OAuth test app is not configured")))
		return
	}
	now := h.now().UTC()
	grantID, err := randomOpaqueValue(32)
	if err != nil {
		writeRuntimeError(w, shopifyconnector.SafeInstallationErrorFor(request.Context, err))
		return
	}
	domain, _ := shopifyconnector.NormalizeShopDomain(request.ShopDomain)
	if err := h.repository.CreateOAuthGrant(r.Context(), OAuthGrant{
		ID: grantID, Identity: request.Identity, Context: request.Context,
		LegacyShopID: strings.TrimSpace(request.LegacyShopID), ShopDomain: domain,
		ExpiresAt: now.Add(h.config.StateTTL),
	}); err != nil {
		if errors.Is(err, ErrBindingConflict) || errors.Is(err, ErrInvalidBinding) {
			writeRuntimeError(w, shopifyconnector.ForbiddenInstallationError(request.Context))
			return
		}
		writeRuntimeError(w, shopifyconnector.SafeInstallationErrorFor(request.Context, err))
		return
	}
	browserStart := (&url.URL{
		Scheme: callback.Scheme, Host: callback.Host, Path: OAuthAuthorizePath,
		RawQuery: url.Values{"grant": {grantID}}.Encode(),
	}).String()
	writeRuntimeJSON(w, http.StatusOK, OAuthStartResult{
		ContractVersion:  shopifyconnector.InstallationContractVersion,
		AuthorizationURL: browserStart,
	})
}

func (h *Handler) handleOAuthAuthorize(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	grantID := strings.TrimSpace(r.URL.Query().Get("grant"))
	browserNonce := ""
	if cookie, err := r.Cookie(oauthBrowserCookieName); err == nil {
		browserNonce = strings.TrimSpace(cookie.Value)
	}
	if !validOpaqueSecret(browserNonce) {
		var err error
		browserNonce, err = randomOpaqueValue(32)
		if err != nil {
			writeOAuthCallbackForbidden(w)
			return
		}
	}
	now := h.now().UTC()
	grant, err := h.repository.BindOAuthGrant(r.Context(), grantID, hashOpaqueValue(browserNonce), now)
	if err != nil {
		writeOAuthCallbackForbidden(w)
		return
	}
	state, err := h.signState(grant.ID, now)
	if err != nil {
		writeOAuthCallbackForbidden(w)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: oauthBrowserCookieName, Value: browserNonce, Path: "/", MaxAge: int(h.config.StateTTL.Seconds()),
		HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode,
	})
	query := url.Values{
		"client_id": {h.config.AppAPIKey}, "scope": {strings.Join(h.config.Scopes, ",")},
		"redirect_uri": {h.config.CallbackURL}, "state": {state},
	}
	http.Redirect(w, r, "https://"+grant.ShopDomain+"/admin/oauth/authorize?"+query.Encode(), http.StatusFound)
}

func (h *Handler) handleOAuthCallback(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	values, queryErr := url.ParseQuery(r.URL.RawQuery)
	if queryErr != nil {
		writeOAuthCallbackForbidden(w)
		return
	}
	for _, entries := range values {
		if len(entries) != 1 {
			writeOAuthCallbackForbidden(w)
			return
		}
	}
	if !verifyShopifyQuery(values, h.config.AppSecret) {
		writeRuntimeError(w, &shopifyconnector.ConnectionProbeError{
			Code: shopifyconnector.ErrorCodeForbidden, Message: "Shopify OAuth callback is invalid", Retryable: false,
		})
		return
	}
	now := h.now().UTC()
	payload, err := h.verifyState(values.Get("state"), now)
	cookie, cookieErr := r.Cookie(oauthBrowserCookieName)
	shopDomain, domainOK := shopifyconnector.NormalizeShopDomain(values.Get("shop"))
	if err != nil || cookieErr != nil || !validOpaqueSecret(cookie.Value) || !domainOK || values.Has("error") || strings.TrimSpace(values.Get("code")) == "" {
		writeOAuthCallbackForbidden(w)
		return
	}
	returnURL, err := shopifyAdminAppURL(shopDomain, h.config.AppAPIKey)
	if err != nil {
		http.Error(w, "Shopify application return is unavailable", http.StatusServiceUnavailable)
		return
	}
	grant, err := h.repository.ConsumeOAuthGrant(
		r.Context(), payload.GrantID, hashOpaqueValue(cookie.Value), shopDomain, now)
	if err != nil {
		writeOAuthCallbackForbidden(w)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: oauthBrowserCookieName, Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode,
	})
	_, err = h.lifecycle.CompleteOAuth(r.Context(), shopifyconnector.CompleteOAuthRequest{
		Identity: grant.Identity, Context: grant.Context, LegacyShopID: grant.LegacyShopID,
		ShopDomain: grant.ShopDomain, AuthorizationCode: strings.TrimSpace(values.Get("code")),
	})
	if err != nil {
		writeRuntimeError(w, err)
		return
	}
	// Shopify supplies a fresh embedded launch context. Never forward callback
	// parameters or manufacture a Shopify session from the successful OAuth grant.
	http.Redirect(w, r, returnURL, http.StatusSeeOther)
}

func (h *Handler) handleProbe(w http.ResponseWriter, r *http.Request) {
	if !h.requireServiceToken(w, r) {
		return
	}
	var request shopifyconnector.InstallationProbeRequest
	if !decodeRuntimeJSON(w, r, &request) {
		return
	}
	result, err := h.lifecycle.Probe(r.Context(), request)
	if err != nil {
		writeRuntimeError(w, err)
		return
	}
	writeRuntimeJSON(w, http.StatusOK, result)
}

func (h *Handler) handleRevoke(w http.ResponseWriter, r *http.Request) {
	if !h.requireServiceToken(w, r) {
		return
	}
	var request shopifyconnector.InstallationRevokeRequest
	if !decodeRuntimeJSON(w, r, &request) {
		return
	}
	result, err := h.lifecycle.Revoke(r.Context(), request)
	if err != nil {
		writeRuntimeError(w, err)
		return
	}
	writeRuntimeJSON(w, http.StatusOK, result)
}

func (h *Handler) handleUninstall(w http.ResponseWriter, r *http.Request) {
	if !h.requireServiceToken(w, r) {
		return
	}
	var request shopifyconnector.InstallationRevokeRequest
	if !decodeRuntimeJSON(w, r, &request) {
		return
	}
	result, err := h.uninstaller.Uninstall(r.Context(), request)
	if err != nil {
		writeRuntimeError(w, err)
		return
	}
	writeRuntimeJSON(w, http.StatusOK, result)
}

func (h *Handler) requireServiceToken(w http.ResponseWriter, r *http.Request) bool {
	provided := strings.TrimSpace(r.Header.Get(ServiceTokenHeader))
	if provided == "" {
		if parts := strings.Fields(r.Header.Get("Authorization")); len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
			provided = parts[1]
		}
	}
	if provided == "" || len(provided) != len(h.config.ServiceToken) ||
		subtle.ConstantTimeCompare([]byte(provided), []byte(h.config.ServiceToken)) != 1 {
		writeRuntimeError(w, &shopifyconnector.ConnectionProbeError{
			Code: shopifyconnector.ErrorCodeForbidden, Message: "XZ ERP connector token is invalid", Retryable: false,
		})
		return false
	}
	return true
}

func (h *Handler) signState(grantID string, now time.Time) (string, error) {
	payload := oauthStatePayload{GrantID: grantID, IssuedAt: now.Unix()}
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	encoded := base64.RawURLEncoding.EncodeToString(raw)
	return encoded + "." + hmacHex(h.config.AppSecret, encoded), nil
}

func (h *Handler) verifyState(state string, now time.Time) (oauthStatePayload, error) {
	parts := strings.Split(state, ".")
	if len(parts) != 2 || !hmac.Equal([]byte(parts[1]), []byte(hmacHex(h.config.AppSecret, parts[0]))) {
		return oauthStatePayload{}, errors.New("invalid OAuth state")
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return oauthStatePayload{}, errors.New("invalid OAuth state")
	}
	var payload oauthStatePayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return oauthStatePayload{}, errors.New("invalid OAuth state")
	}
	issued := time.Unix(payload.IssuedAt, 0)
	if !validOpaqueSecret(payload.GrantID) ||
		issued.After(now.Add(time.Minute)) || now.Sub(issued) > h.config.StateTTL {
		return oauthStatePayload{}, errors.New("invalid OAuth state")
	}
	return payload, nil
}

func randomOpaqueValue(size int) (string, error) {
	value := make([]byte, size)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func validOpaqueSecret(value string) bool {
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	return err == nil && len(decoded) == 32 && base64.RawURLEncoding.EncodeToString(decoded) == value
}

func hashOpaqueValue(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func writeOAuthCallbackForbidden(w http.ResponseWriter) {
	writeRuntimeError(w, &shopifyconnector.ConnectionProbeError{
		Code: shopifyconnector.ErrorCodeForbidden, Message: "Shopify OAuth callback is invalid", Retryable: false,
	})
}

func verifyShopifyQuery(values url.Values, secret string) bool {
	got := strings.TrimSpace(values.Get("hmac"))
	if got == "" {
		return false
	}
	return hmac.Equal([]byte(got), []byte(signShopifyQuery(values, secret)))
}

func signShopifyQuery(values url.Values, secret string) string {
	items := make([]string, 0, len(values))
	for key, rawValues := range values {
		if key == "hmac" || key == "signature" {
			continue
		}
		for _, value := range rawValues {
			items = append(items, key+"="+value)
		}
	}
	sort.Strings(items)
	return hmacHex(secret, strings.Join(items, "&"))
}

func hmacHex(secret string, payload string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil))
}

func decodeRuntimeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	defer r.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(r.Body, installationRequestLimit+1))
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	decodeErr := decoder.Decode(target)
	var trailing any
	trailingErr := decoder.Decode(&trailing)
	if err != nil || len(raw) > installationRequestLimit || decodeErr != nil || trailingErr != io.EOF {
		writeRuntimeError(w, &shopifyconnector.ConnectionProbeError{
			Code: shopifyconnector.ErrorCodeInvalidRequest, Message: "Shopify connector request is invalid", Retryable: false,
		})
		return false
	}
	return true
}

func writeRuntimeError(w http.ResponseWriter, err error) {
	var safeErr *shopifyconnector.ConnectionProbeError
	if !errors.As(err, &safeErr) {
		safeErr = &shopifyconnector.ConnectionProbeError{
			Code: shopifyconnector.ErrorCodeUnavailable, Message: "Shopify connector is temporarily unavailable", Retryable: true,
		}
	}
	status := http.StatusBadGateway
	switch safeErr.Code {
	case shopifyconnector.ErrorCodeInvalidRequest:
		status = http.StatusBadRequest
	case shopifyconnector.ErrorCodeForbidden:
		status = http.StatusForbidden
	case shopifyconnector.ErrorCodeProtectedCustomerDataRequired:
		status = http.StatusForbidden
	case shopifyconnector.ErrorCodeCanceled:
		status = http.StatusRequestTimeout
	case shopifyconnector.ErrorCodeTimeout:
		status = http.StatusGatewayTimeout
	}
	writeRuntimeJSON(w, status, safeErr)
}

func writeRuntimeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
