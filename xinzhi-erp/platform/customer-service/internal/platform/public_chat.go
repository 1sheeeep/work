package platform

import (
	"context"
	"crypto/hmac"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/mail"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

type publicChatConfigResponse struct {
	Shop         Shop              `json:"shop"`
	Source       ShopSource        `json:"source"`
	Localization map[string]string `json:"localization,omitempty"`
}

type publicChatConversationRequest struct {
	Shop            string `json:"shop"`
	ConversationID  string `json:"conversationId"`
	CustomerName    string `json:"customerName"`
	CustomerEmail   string `json:"customerEmail"`
	Subject         string `json:"subject"`
	Body            string `json:"body"`
	VisitorID       string `json:"visitorId"`
	PageTitle       string `json:"pageTitle"`
	PageURL         string `json:"pageUrl"`
	ProductHandle   string `json:"productHandle"`
	ProductTitle    string `json:"productTitle"`
	ProductImageURL string `json:"productImageUrl"`
	ProductPrice    string `json:"productPrice"`
	ProductCurrency string `json:"productCurrencyCode"`
	CustomerSession string `json:"customerSession"`
	ClientMessageID string `json:"clientMessageId"`
	CustomerID      string `json:"-"`
}

type publicChatConversationResponse struct {
	Shop           Shop         `json:"shop"`
	Source         ShopSource   `json:"source"`
	Conversation   Conversation `json:"conversation"`
	Messages       []Message    `json:"messages"`
	WorkflowStatus string       `json:"workflowStatus,omitempty"`
}

type publicChatSelfServiceResponse struct {
	Messages       []Message `json:"messages"`
	WorkflowStatus string    `json:"workflowStatus,omitempty"`
	Pending        bool      `json:"pending,omitempty"`
}

type publicChatMessageRequest struct {
	// Shop is retained only for compatibility with an already cached widget.
	// The shop is always derived from the conversation ID in the URL.
	Shop            string `json:"shop"`
	Body            string `json:"body"`
	CustomerName    string `json:"customerName"`
	CustomerEmail   string `json:"customerEmail"`
	VisitorID       string `json:"visitorId"`
	PageTitle       string `json:"pageTitle"`
	PageURL         string `json:"pageUrl"`
	ProductHandle   string `json:"productHandle"`
	ProductTitle    string `json:"productTitle"`
	ProductImageURL string `json:"productImageUrl"`
	ProductPrice    string `json:"productPrice"`
	ProductCurrency string `json:"productCurrencyCode"`
	CustomerSession string `json:"customerSession"`
	ClientMessageID string `json:"clientMessageId"`
}

type publicChatInstantAnswerRequest struct {
	Shop            string `json:"shop"`
	ConversationID  string `json:"conversationId"`
	AnswerID        string `json:"answerId"`
	CustomerName    string `json:"customerName"`
	CustomerEmail   string `json:"customerEmail"`
	VisitorID       string `json:"visitorId"`
	PageTitle       string `json:"pageTitle"`
	PageURL         string `json:"pageUrl"`
	ProductHandle   string `json:"productHandle"`
	ProductTitle    string `json:"productTitle"`
	ProductImageURL string `json:"productImageUrl"`
	ProductPrice    string `json:"productPrice"`
	ProductCurrency string `json:"productCurrencyCode"`
	CustomerSession string `json:"customerSession"`
	Language        string `json:"language"`
}

type publicChatOrderTrackingRequest struct {
	Shop            string `json:"shop"`
	ConversationID  string `json:"conversationId"`
	AnswerID        string `json:"answerId"`
	OrderNumber     string `json:"orderNumber"`
	CustomerName    string `json:"customerName"`
	CustomerEmail   string `json:"customerEmail"`
	CustomerSession string `json:"customerSession"`
	VisitorID       string `json:"visitorId"`
	PageTitle       string `json:"pageTitle"`
	PageURL         string `json:"pageUrl"`
	ProductHandle   string `json:"productHandle"`
	ProductTitle    string `json:"productTitle"`
	ProductImageURL string `json:"productImageUrl"`
	ProductPrice    string `json:"productPrice"`
	ProductCurrency string `json:"productCurrencyCode"`
	Language        string `json:"language"`
}

type publicChatHeartbeatRequest struct {
	Shop string `json:"shop"`
}

type publicInstantAnswer struct {
	ID      string
	Title   string
	Answer  string
	Enabled bool
	Mode    string
}

type publicChatCustomerSessionResponse struct {
	Authenticated bool   `json:"authenticated"`
	Token         string `json:"token,omitempty"`
	CustomerName  string `json:"customerName,omitempty"`
	CustomerEmail string `json:"customerEmail,omitempty"`
}

type publicChatCustomerSessionPayload struct {
	Shop       string `json:"shop"`
	CustomerID string `json:"customerId"`
	IssuedAt   int64  `json:"issuedAt"`
}

type publicOrderLookup struct {
	MessageBody   string
	CustomerName  string
	CustomerEmail string
	Reply         string
	SourceID      string
	Status        string
	Pending       bool
}

var publicOrderNumberPattern = regexp.MustCompile(`^#?[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)
var publicShopifyCustomerIDPattern = regexp.MustCompile(`^\d{1,32}$`)

const publicChatCustomerIDMetadataKey = "shopifyCustomerId"

const (
	publicOrderLookupFound       = "found"
	publicOrderLookupNotFound    = "not_found"
	publicOrderLookupUnavailable = "unavailable"
)

func customerProfileName(profile *ShopifyCustomerProfile) string {
	if profile == nil {
		return ""
	}
	return strings.TrimSpace(profile.DisplayName)
}

func customerProfileEmail(profile *ShopifyCustomerProfile) string {
	if profile == nil {
		return ""
	}
	return strings.TrimSpace(profile.Email)
}

func (s *Server) handlePublicChatOrderTracking(w http.ResponseWriter, r *http.Request) {
	var input publicChatOrderTrackingRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	shop, source, err := s.publicChatContext(r.Context(), input.Shop)
	if err != nil {
		writeError(w, err)
		return
	}
	answer, ok := findPublicInstantAnswer(source.Metadata, input.AnswerID)
	if !ok || answer.Mode != "order_tracking" {
		writeError(w, fmt.Errorf("%w: order tracking workflow is unavailable", ErrInvalid))
		return
	}
	lookup, err := s.resolvePublicOrderTracking(r.Context(), shop, answer, input)
	if err != nil {
		writeError(w, err)
		return
	}
	lookup.Reply = s.localizePublicTrackingReply(r.Context(), input.Language, lookup.Reply)
	now := time.Now().UTC()
	visitorMessage := publicChatSelfServiceMessage(
		MessageDirectionCustomer,
		lookup.MessageBody,
		firstNonEmpty(lookup.CustomerName, input.CustomerName, "Visitor"),
		nil,
		now,
	)
	botMessage := publicChatSelfServiceMessage(
		MessageDirectionSystem,
		lookup.Reply,
		"Xzdesk",
		map[string]string{
			"workflow":        "order_tracking",
			"workflowStatus":  lookup.Status,
			"instantAnswerId": answer.ID,
			"workflowPending": strconv.FormatBool(lookup.Pending),
		},
		now.Add(time.Nanosecond),
	)
	writeJSONResponse(w, http.StatusOK, publicChatSelfServiceResponse{
		Messages: []Message{visitorMessage, botMessage}, WorkflowStatus: lookup.Status, Pending: lookup.Pending,
	})
}

func (s *Server) resolvePublicOrderTracking(ctx context.Context, shop Shop, answer publicInstantAnswer, input publicChatOrderTrackingRequest) (publicOrderLookup, error) {
	if strings.TrimSpace(input.CustomerSession) != "" {
		customerID, err := s.verifyPublicChatCustomerSession(ctx, shop, input.CustomerSession)
		if err != nil {
			return publicOrderLookup{}, err
		}
		order, found, lookupErr := s.publicOrderForCustomerID(ctx, shop, customerID)
		if lookupErr != nil {
			return publicOrderLookup{
				MessageBody: answer.Title,
				Reply:       "Order lookup is temporarily unavailable. Please try again or continue with our support team.",
				SourceID:    "customer:" + customerID,
				Status:      publicOrderLookupUnavailable,
			}, nil
		}
		if !found {
			return publicOrderLookup{
				MessageBody: answer.Title,
				Reply:       "No logistics information was found for this customer. Please try again or contact support.",
				SourceID:    "customer:" + customerID,
				Status:      publicOrderLookupNotFound,
			}, nil
		}
		reply, pending := s.publicOrderTrackingMessageWithLogistics(ctx, shop, order)
		return publicOrderLookup{
			MessageBody:   answer.Title,
			CustomerName:  order.Customer.DisplayName,
			CustomerEmail: firstNonEmpty(order.Customer.Email, order.Email),
			Reply:         reply,
			SourceID:      "customer:" + customerID + ":" + order.Name,
			Status:        publicOrderLookupFound,
			Pending:       pending,
		}, nil
	}
	orderNumber, customerEmail, err := normalizePublicOrderLookupInput(input.OrderNumber, input.CustomerEmail)
	if err != nil {
		return publicOrderLookup{}, err
	}
	reply, status, pending := s.publicOrderTrackingResult(ctx, shop, orderNumber, customerEmail)
	return publicOrderLookup{
		MessageBody:   fmt.Sprintf("Order number: %s\nEmail: %s", orderNumber, customerEmail),
		CustomerName:  input.CustomerName,
		CustomerEmail: customerEmail,
		Reply:         reply,
		SourceID:      orderNumber,
		Status:        status,
		Pending:       pending,
	}, nil
}

func (s *Server) publicOrderForCustomerID(ctx context.Context, shop Shop, customerID string) (ShopifyOrderSummary, bool, error) {
	if !publicShopifyCustomerIDPattern.MatchString(strings.TrimSpace(customerID)) {
		return ShopifyOrderSummary{}, false, nil
	}
	sources, err := s.store.ListShopSources(ctx, shop.ID)
	if err != nil {
		return ShopifyOrderSummary{}, false, err
	}
	domain := shopifyDomainForShop(shop, sources)
	token := s.shopifyAdminToken(ctx, domain)
	if domain == "" || token == "" {
		return ShopifyOrderSummary{}, false, fmt.Errorf("Shopify order lookup is not configured")
	}
	result, err := s.searchShopifyOrdersCached(ctx, shop.ID, domain, token, "customer_id:"+strings.TrimSpace(customerID), 5)
	if err != nil {
		s.recordShopifyAPIError(ctx, shop.ID, err)
		return ShopifyOrderSummary{}, false, err
	}
	if len(result.Orders) == 0 {
		return ShopifyOrderSummary{}, false, nil
	}
	return result.Orders[0], true, nil
}

func (s *Server) publicOrderTrackingReply(ctx context.Context, shop Shop, orderNumber string, email string) string {
	reply, _, _ := s.publicOrderTrackingResult(ctx, shop, orderNumber, email)
	return reply
}

func (s *Server) publicOrderTrackingResult(ctx context.Context, shop Shop, orderNumber string, email string) (string, string, bool) {
	orderNumber, email, err := normalizePublicOrderLookupInput(orderNumber, email)
	if err != nil {
		return "No logistics information was found for this order. Check the order number and email, then try again.", publicOrderLookupNotFound, false
	}
	sources, err := s.store.ListShopSources(ctx, shop.ID)
	if err != nil {
		return "Order lookup is temporarily unavailable. Please try again or contact support.", publicOrderLookupUnavailable, false
	}
	domain, token := shopifyDomainForShop(shop, sources), s.shopifyAdminToken(ctx, shopifyDomainForShop(shop, sources))
	if domain == "" || token == "" {
		return "Order lookup is temporarily unavailable. Please try again or contact support.", publicOrderLookupUnavailable, false
	}
	result, err := s.searchShopifyOrdersCached(ctx, shop.ID, domain, token, fmt.Sprintf("name:%s", orderNumber), 5)
	if err != nil {
		s.recordShopifyAPIError(ctx, shop.ID, err)
		return "Order lookup is temporarily unavailable. Please try again or contact support.", publicOrderLookupUnavailable, false
	}
	if len(result.Orders) == 0 {
		return "No logistics information was found for this order. Check the order number and email, then try again.", publicOrderLookupNotFound, false
	}
	order, ok := verifiedPublicOrder(result.Orders, orderNumber, email)
	if !ok {
		return "No logistics information was found for this order. Check the order number and email, then try again.", publicOrderLookupNotFound, false
	}
	reply, pending := s.publicOrderTrackingMessageWithLogistics(ctx, shop, order)
	return reply, publicOrderLookupFound, pending
}

func normalizePublicOrderLookupInput(orderNumber string, email string) (string, string, error) {
	orderNumber = strings.TrimSpace(orderNumber)
	email = strings.TrimSpace(email)
	if !publicOrderNumberPattern.MatchString(orderNumber) {
		return "", "", fmt.Errorf("%w: a valid order number and checkout email are required", ErrInvalid)
	}
	address, err := mail.ParseAddress(email)
	if err != nil || !strings.EqualFold(email, address.Address) || len(address.Address) > 254 {
		return "", "", fmt.Errorf("%w: a valid order number and checkout email are required", ErrInvalid)
	}
	return orderNumber, strings.ToLower(address.Address), nil
}

func verifiedPublicOrder(orders []ShopifyOrderSummary, orderNumber string, email string) (ShopifyOrderSummary, bool) {
	normalizedNumber := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(orderNumber)), "#")
	for _, order := range orders {
		candidateNumber := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(order.Name)), "#")
		if candidateNumber == normalizedNumber && strings.EqualFold(strings.TrimSpace(order.Email), strings.TrimSpace(email)) {
			return order, true
		}
	}
	return ShopifyOrderSummary{}, false
}

func publicOrderTrackingMessage(order ShopifyOrderSummary) string {
	var selectedFulfillment ShopifyFulfillment
	var selectedAt time.Time
	foundFulfillment := false
	for _, fulfillment := range order.Fulfillments {
		updatedAt, parseErr := time.Parse(time.RFC3339, firstNonEmpty(fulfillment.UpdatedAt, fulfillment.CreatedAt))
		if !foundFulfillment || (parseErr == nil && (selectedAt.IsZero() || updatedAt.After(selectedAt))) {
			selectedFulfillment = fulfillment
			selectedAt = updatedAt
			foundFulfillment = true
		}
	}
	if foundFulfillment {
		var selectedTracking ShopifyTrackingInfo
		for _, tracking := range selectedFulfillment.TrackingInfo {
			if strings.TrimSpace(tracking.Number) != "" {
				selectedTracking = tracking
				selectedTracking.URL = normalizeShopifyTrackingURL(selectedTracking.URL)
				break
			}
		}
		if strings.TrimSpace(selectedTracking.Number) == "" {
			return fmt.Sprintf("Order %s is %s. No logistics information is currently available.", order.Name, firstNonEmpty(selectedFulfillment.Status, "being processed"))
		}
		trackingURL := ""
		if strings.TrimSpace(selectedTracking.URL) != "" {
			trackingURL = " " + strings.TrimSpace(selectedTracking.URL)
		}
		return fmt.Sprintf("Order %s is %s. Tracking: %s%s", order.Name, firstNonEmpty(selectedFulfillment.Status, "being processed"), strings.TrimSpace(selectedTracking.Number), trackingURL)
	}
	return fmt.Sprintf("Order %s was found. Its fulfillment status is %s. No logistics information is currently available.", order.Name, firstNonEmpty(order.FulfillmentStatus, "being processed"))
}

func (s *Server) publicOrderTrackingMessageWithLogistics(ctx context.Context, shop Shop, order ShopifyOrderSummary) (string, bool) {
	base := publicOrderTrackingMessage(order)
	tracking := latestShopifyTracking(order)
	if strings.TrimSpace(tracking.Number) == "" {
		return base, false
	}
	config, err := s.resolveLogisticsConfig(ctx)
	if err != nil || !config.Enabled || config.APIKey == "" {
		return base, false
	}
	if cached, ok := s.seventeenTrack().cached(ctx, tracking.Number); ok {
		pending := strings.EqualFold(strings.TrimSpace(cached.Status), "pending") && len(cached.Events) == 0
		return base + publicLatestLogisticsMessage(cached), pending
	}
	request := LogisticsTrackingRequest{ShopID: shop.ID, Carrier: tracking.Company, TrackingNumber: tracking.Number}
	go func() {
		background, cancel := context.WithTimeout(context.Background(), 25*time.Second)
		defer cancel()
		_, _ = s.seventeenTrack().Track(background, request)
	}()
	return base + " Logistics information is syncing and may take a few minutes.", true
}

func (s *Server) localizePublicTrackingReply(ctx context.Context, language string, reply string) string {
	reply = strings.TrimSpace(reply)
	language = normalizePublicBrowserLanguage(language)
	if reply == "" || language == "" || (strings.HasPrefix(language, "en") && isASCIIText(reply)) {
		return reply
	}
	cacheKey := externalCacheKey("public_tracking_reply", "", language+"\x00"+reply)
	var cached string
	if s.loadExternalCache(ctx, cacheKey, &cached) && strings.TrimSpace(cached) != "" {
		return strings.TrimSpace(cached)
	}
	value, err, _ := s.publicTrackingReplyRun.Do(cacheKey, func() (any, error) {
		if s.loadExternalCache(ctx, cacheKey, &cached) && strings.TrimSpace(cached) != "" {
			return strings.TrimSpace(cached), nil
		}
		translated, err := s.callAI(ctx, buildPublicTrackingLocalizationPrompt(language, reply))
		if err != nil || strings.TrimSpace(translated) == "" {
			return reply, nil
		}
		translated = strings.TrimSpace(translated)
		s.saveExternalCache(ctx, "public_tracking_reply", "", cacheKey, translated, seventeenTrackSnapshotTTL)
		return translated, nil
	})
	if err != nil {
		return reply
	}
	return value.(string)
}

func normalizePublicBrowserLanguage(language string) string {
	language = strings.ToLower(strings.ReplaceAll(strings.TrimSpace(language), "_", "-"))
	if len(language) > 35 || !regexp.MustCompile(`^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$`).MatchString(language) {
		return ""
	}
	return language
}

func isASCIIText(value string) bool {
	for _, char := range value {
		if char > 127 {
			return false
		}
	}
	return true
}

func buildPublicTrackingLocalizationPrompt(language string, reply string) string {
	return fmt.Sprintf(`Translate the customer-facing order and logistics reply inside <reply> into the browser language %q.
Preserve every order number, tracking number, status, date, time, location, carrier name, and URL exactly.
Do not add links, estimates, explanations, promises, labels, Markdown, or facts that are not present.
Return only the translated reply.

<reply>
%s
</reply>`, language, reply)
}

func defaultPublicOrderTrackingLocalization() map[string]string {
	return map[string]string{
		"trackOrder":    "Track my order",
		"orderHelp":     "Enter the order number and email used at checkout.",
		"orderNumber":   "Order number",
		"emailAddress":  "Email address",
		"checkOrder":    "Check order status",
		"checkingOrder": "Checking order...",
		"cancelOrder":   "Cancel order lookup",
		"orderError":    "Could not check this order. Verify the order number and email, then try again.",
	}
}

func (s *Server) publicOrderTrackingLocalization(ctx context.Context, language string) map[string]string {
	language = normalizePublicBrowserLanguage(language)
	fallback := defaultPublicOrderTrackingLocalization()
	if language == "" || strings.HasPrefix(language, "en") {
		return fallback
	}
	cacheKey := externalCacheKey("public_tracking_ui", "", language)
	var cached map[string]string
	if s.loadExternalCache(ctx, cacheKey, &cached) && validPublicOrderTrackingLocalization(cached) {
		return cached
	}
	value, err, _ := s.publicTrackingReplyRun.Do(cacheKey, func() (any, error) {
		if s.loadExternalCache(ctx, cacheKey, &cached) && validPublicOrderTrackingLocalization(cached) {
			return cached, nil
		}
		raw, _ := json.Marshal(fallback)
		aiContext, cancel := context.WithTimeout(ctx, 8*time.Second)
		defer cancel()
		translated, err := s.callAI(aiContext, fmt.Sprintf(`Translate every JSON string value into browser language %q.
Keep the JSON keys unchanged. Return only one valid JSON object without Markdown or explanations.
Do not add or remove keys.

%s`, language, raw))
		if err != nil {
			s.saveExternalCache(ctx, "public_tracking_ui", "", cacheKey, fallback, time.Hour)
			return fallback, nil
		}
		start, end := strings.Index(translated, "{"), strings.LastIndex(translated, "}")
		if start < 0 || end <= start || json.Unmarshal([]byte(translated[start:end+1]), &cached) != nil || !validPublicOrderTrackingLocalization(cached) {
			s.saveExternalCache(ctx, "public_tracking_ui", "", cacheKey, fallback, time.Hour)
			return fallback, nil
		}
		s.saveExternalCache(ctx, "public_tracking_ui", "", cacheKey, cached, seventeenTrackSnapshotTTL)
		return cached, nil
	})
	if err != nil {
		return fallback
	}
	return value.(map[string]string)
}

func validPublicOrderTrackingLocalization(values map[string]string) bool {
	for key := range defaultPublicOrderTrackingLocalization() {
		value := strings.TrimSpace(values[key])
		if value == "" || len(value) > 300 {
			return false
		}
	}
	return true
}

func latestShopifyTracking(order ShopifyOrderSummary) ShopifyTrackingInfo {
	var selected ShopifyTrackingInfo
	var selectedAt time.Time
	for _, fulfillment := range order.Fulfillments {
		createdAt, _ := time.Parse(time.RFC3339, firstNonEmpty(fulfillment.UpdatedAt, fulfillment.CreatedAt))
		for _, tracking := range fulfillment.TrackingInfo {
			if strings.TrimSpace(tracking.Number) == "" {
				continue
			}
			if selected.Number == "" || createdAt.After(selectedAt) {
				selected = tracking
				selected.URL = normalizeShopifyTrackingURL(selected.URL)
				selectedAt = createdAt
			}
		}
	}
	return selected
}

func publicLatestLogisticsMessage(result LogisticsTrackingResult) string {
	if len(result.Events) == 0 {
		if strings.TrimSpace(result.Status) == "" || result.Status == "pending" {
			return " Logistics information is syncing and may take a few minutes."
		}
		return fmt.Sprintf(" Logistics status: %s.", result.Status)
	}
	event := result.Events[0]
	parts := []string{}
	if value := firstNonEmpty(event.Status, result.Status); value != "" {
		parts = append(parts, "status: "+value)
	}
	if event.Description != "" {
		parts = append(parts, event.Description)
	}
	if event.Time != "" {
		parts = append(parts, "time: "+event.Time)
	}
	if event.Location != "" {
		parts = append(parts, "location: "+event.Location)
	}
	if len(parts) == 0 {
		return ""
	}
	return " Latest logistics update: " + strings.Join(parts, "; ") + "."
}

func (s *Server) handlePublicChatConfig(w http.ResponseWriter, r *http.Request) {
	shop, source, err := s.publicChatContext(r.Context(), r.URL.Query().Get("shop"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSONResponse(w, http.StatusOK, publicChatConfigResponse{
		Shop:         shop,
		Source:       source,
		Localization: s.publicOrderTrackingLocalization(r.Context(), r.URL.Query().Get("language")),
	})
}

func (s *Server) handleShopifyChatCustomerSession(w http.ResponseWriter, r *http.Request) {
	shopDomain := normalizeShopifyDomain(r.URL.Query().Get("shop"))
	if shopDomain == "" {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "shop is required"})
		return
	}
	cfg, err := s.shopifyAppConfigForShop(r.Context(), shopDomain)
	if err != nil {
		writeError(w, err)
		return
	}
	if !verifyShopifyAppProxySignature(r.URL.Query(), cfg.Secret) {
		writeJSONResponse(w, http.StatusUnauthorized, map[string]string{"error": "invalid Shopify app proxy signature"})
		return
	}
	timestamp, err := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("timestamp")), 10, 64)
	if err != nil || absDuration(time.Since(time.Unix(timestamp, 0))) > 5*time.Minute {
		writeJSONResponse(w, http.StatusUnauthorized, map[string]string{"error": "expired Shopify app proxy request"})
		return
	}
	customerID := strings.TrimSpace(r.URL.Query().Get("logged_in_customer_id"))
	if customerID == "" {
		writeJSONResponse(w, http.StatusOK, publicChatCustomerSessionResponse{Authenticated: false})
		return
	}
	if !publicShopifyCustomerIDPattern.MatchString(customerID) {
		writeJSONResponse(w, http.StatusUnauthorized, map[string]string{"error": "invalid Shopify customer identity"})
		return
	}
	token, err := signPublicChatCustomerSession(publicChatCustomerSessionPayload{
		Shop:       shopDomain,
		CustomerID: customerID,
		IssuedAt:   time.Now().UTC().Unix(),
	}, cfg.Secret)
	if err != nil {
		writeError(w, err)
		return
	}
	response := publicChatCustomerSessionResponse{Authenticated: true, Token: token}
	if shop, findErr := s.findPublicShop(r.Context(), shopDomain); findErr == nil {
		if profile, lookupErr := s.lookupPublicShopifyCustomerProfile(r.Context(), shop, customerID); lookupErr == nil && profile != nil {
			response.CustomerName = strings.TrimSpace(profile.DisplayName)
			response.CustomerEmail = strings.TrimSpace(profile.Email)
		}
	}
	writeJSONResponse(w, http.StatusOK, response)
}

func verifyShopifyAppProxySignature(values url.Values, secret string) bool {
	got := strings.TrimSpace(values.Get("signature"))
	if got == "" || strings.TrimSpace(secret) == "" {
		return false
	}
	keys := make([]string, 0, len(values))
	for key := range values {
		if key != "signature" {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	var payload strings.Builder
	for _, key := range keys {
		payload.WriteString(key)
		payload.WriteString("=")
		payload.WriteString(strings.Join(values[key], ","))
	}
	expected := hmacHex(secret, payload.String())
	return hmac.Equal([]byte(got), []byte(expected))
}

func signPublicChatCustomerSession(payload publicChatCustomerSessionPayload, secret string) (string, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	encoded := base64.RawURLEncoding.EncodeToString(raw)
	return encoded + "." + hmacHex(secret, encoded), nil
}

func (s *Server) verifyPublicChatCustomerSession(ctx context.Context, shop Shop, token string) (string, error) {
	sources, err := s.store.ListShopSources(ctx, shop.ID)
	if err != nil {
		return "", err
	}
	shopDomain := shopifyDomainForShop(shop, sources)
	cfg, err := s.shopifyAppConfigForShop(ctx, shopDomain)
	if err != nil {
		return "", fmt.Errorf("%w: signed-in customer session is unavailable", ErrInvalid)
	}
	parts := strings.Split(strings.TrimSpace(token), ".")
	if len(parts) != 2 || !hmac.Equal([]byte(parts[1]), []byte(hmacHex(cfg.Secret, parts[0]))) {
		return "", fmt.Errorf("%w: signed-in customer session is invalid", ErrInvalid)
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", fmt.Errorf("%w: signed-in customer session is invalid", ErrInvalid)
	}
	var payload publicChatCustomerSessionPayload
	if json.Unmarshal(raw, &payload) != nil ||
		normalizeShopifyDomain(payload.Shop) != shopDomain ||
		!publicShopifyCustomerIDPattern.MatchString(payload.CustomerID) ||
		payload.IssuedAt <= 0 ||
		absDuration(time.Since(time.Unix(payload.IssuedAt, 0))) > 24*time.Hour {
		return "", fmt.Errorf("%w: signed-in customer session is invalid", ErrInvalid)
	}
	return payload.CustomerID, nil
}

func absDuration(value time.Duration) time.Duration {
	if value < 0 {
		return -value
	}
	return value
}

func (s *Server) handlePublicChatHeartbeat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var input publicChatHeartbeatRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	shop, source, err := s.publicChatContext(r.Context(), input.Shop)
	if err != nil {
		writeError(w, err)
		return
	}
	metadata := make(map[string]string, len(source.Metadata)+1)
	for key, value := range source.Metadata {
		metadata[key] = value
	}
	now := time.Now().UTC()
	shouldBroadcast := shouldBroadcastWidgetHeartbeat(source.Metadata, now)
	metadata["widgetLastSeenAt"] = now.Format(time.RFC3339)
	updatedSource, err := s.store.UpdateShopSource(r.Context(), shop.ID, source.ID, ShopSource{
		Status:   source.Status,
		Provider: source.Provider,
		Address:  source.Address,
		Metadata: metadata,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	if shouldBroadcast {
		s.broadcast(Event{
			Type:      "shopify_widget.heartbeat",
			ShopID:    shop.ID,
			EntityID:  updatedSource.ID,
			Payload:   updatedSource,
			CreatedAt: now,
		})
	}
	writeJSONResponse(w, http.StatusOK, map[string]bool{"ok": true})
}

func shouldBroadcastWidgetHeartbeat(metadata map[string]string, now time.Time) bool {
	lastSeen, err := time.Parse(time.RFC3339, strings.TrimSpace(metadata["widgetLastSeenAt"]))
	return err != nil || now.Sub(lastSeen) >= 15*time.Minute
}

func publicChatBoundCustomerID(messages []Message) string {
	for _, message := range messages {
		if customerID := strings.TrimSpace(message.Metadata[publicChatCustomerIDMetadataKey]); customerID != "" {
			return customerID
		}
	}
	return ""
}

func publicChatCustomerMetadata(metadata map[string]string, customerID string) map[string]string {
	if strings.TrimSpace(customerID) == "" {
		return metadata
	}
	if metadata == nil {
		metadata = map[string]string{}
	}
	metadata[publicChatCustomerIDMetadataKey] = strings.TrimSpace(customerID)
	return metadata
}

func (s *Server) authorizePublicChatCustomer(ctx context.Context, shop Shop, source ShopSource, conversationID, token string) (string, *ShopifyCustomerProfile, error) {
	return s.authorizePublicChatCustomerWithGuestAccess(ctx, shop, source, conversationID, token, false)
}

func (s *Server) authorizePublicChatCustomerWithGuestAccess(ctx context.Context, shop Shop, source ShopSource, conversationID, token string, allowGuest bool) (string, *ShopifyCustomerProfile, error) {
	required := shopifyChatCustomerLoginRequired(source.Metadata) && !allowGuest
	token = strings.TrimSpace(token)
	if token == "" {
		if required {
			return "", nil, fmt.Errorf("%w: customer login is required", ErrForbidden)
		}
		return "", nil, nil
	}
	customerID, err := s.verifyPublicChatCustomerSession(ctx, shop, token)
	if err != nil {
		return "", nil, fmt.Errorf("%w: customer login is invalid", ErrForbidden)
	}
	needsProfile := strings.TrimSpace(conversationID) == ""
	var conversation Conversation
	if strings.TrimSpace(conversationID) != "" {
		conversation, err = s.store.GetConversation(ctx, conversationID)
		if err != nil {
			return "", nil, err
		}
		if conversation.ShopID != shop.ID || conversation.SourceID != source.ID {
			return "", nil, ErrNotFound
		}
		messages, err := s.store.ListMessagePage(ctx, conversation.ID, "", 50)
		if err != nil {
			return "", nil, err
		}
		if boundID := publicChatBoundCustomerID(messages); boundID != "" {
			if boundID != customerID {
				return "", nil, fmt.Errorf("%w: conversation belongs to another customer", ErrForbidden)
			}
		} else {
			for _, message := range messages {
				if message.Direction != MessageDirectionCustomer {
					continue
				}
				if _, err := s.store.UpdateMessageMetadata(ctx, conversation.ID, message.ID, map[string]string{
					publicChatCustomerIDMetadataKey: customerID,
				}); err != nil {
					return "", nil, err
				}
				break
			}
		}
		needsProfile = conversation.CustomerName == "" || conversation.CustomerEmail == ""
	}

	var profile *ShopifyCustomerProfile
	if !needsProfile {
		return customerID, nil, nil
	}
	profile, err = s.lookupPublicShopifyCustomerProfile(ctx, shop, customerID)
	if err != nil {
		log.Printf("public chat: Shopify customer lookup failed for shop %s: %v", shop.ID, err)
		return customerID, nil, nil
	}
	if profile != nil && strings.TrimSpace(conversationID) != "" {
		_, updateErr := s.store.UpdateConversation(ctx, conversation.ID, ConversationUpdate{
			SetCustomerIdentity: true,
			CustomerName:        profile.DisplayName,
			CustomerEmail:       profile.Email,
		})
		if updateErr != nil {
			return "", nil, updateErr
		}
	}
	return customerID, profile, nil
}

func (s *Server) lookupPublicShopifyCustomerProfile(ctx context.Context, shop Shop, customerID string) (*ShopifyCustomerProfile, error) {
	customerID = strings.TrimSpace(customerID)
	if customerID == "" {
		return nil, nil
	}
	cacheKey := externalCacheKey("shopify_customer_id", shop.ID, customerID)
	var cached ShopifyCustomerSearchResult
	if s.loadExternalCache(ctx, cacheKey, &cached) {
		return cached.Customer, nil
	}
	sources, err := s.store.ListShopSources(ctx, shop.ID)
	if err != nil {
		return nil, err
	}
	domain := shopifyDomainForShop(shop, sources)
	accessToken := s.shopifyAdminToken(ctx, domain)
	lookup := s.publicShopifyCustomerLookup
	if domain == "" || accessToken == "" || lookup == nil {
		return nil, nil
	}
	result, err := lookup(ctx, domain, accessToken, customerID)
	if err != nil {
		return nil, err
	}
	s.saveExternalCache(ctx, "shopify_customer_id", shop.ID, cacheKey, result, 24*time.Hour)
	return result.Customer, nil
}

func (s *Server) handlePublicChatConversation(w http.ResponseWriter, r *http.Request) {
	var input publicChatConversationRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	clientMessageID, err := normalizePublicClientMessageID(input.ClientMessageID)
	if err != nil {
		writeError(w, err)
		return
	}
	input.ClientMessageID = clientMessageID
	shop, source, err := s.publicChatContext(r.Context(), input.Shop)
	if err != nil {
		writeError(w, err)
		return
	}
	if strings.TrimSpace(input.ConversationID) == "" && input.ClientMessageID != "" {
		candidateID := publicFirstConversationID(source.ID, input.ClientMessageID)
		if existing, lookupErr := s.store.GetConversation(r.Context(), candidateID); lookupErr == nil {
			if existing.ShopID != shop.ID || existing.SourceID != source.ID {
				writeError(w, fmt.Errorf("%w: conversation does not belong to this shop", ErrInvalid))
				return
			}
			input.ConversationID = existing.ID
		} else if !errors.Is(lookupErr, ErrNotFound) {
			writeError(w, lookupErr)
			return
		}
	}
	customerID, profile, err := s.authorizePublicChatCustomer(r.Context(), shop, source, input.ConversationID, input.CustomerSession)
	if err != nil {
		writeError(w, err)
		return
	}
	input.CustomerID = customerID
	if profile != nil {
		input.CustomerName = firstNonEmpty(profile.DisplayName, input.CustomerName)
		input.CustomerEmail = firstNonEmpty(profile.Email, input.CustomerEmail)
	}

	conversation, messages, conversationCreated, messageCreated, err := s.upsertPublicConversationMessage(r.Context(), shop, source, input)
	if err != nil {
		writeError(w, err)
		return
	}
	if conversationCreated {
		s.broadcastConversationEvent(conversation, Event{Type: "conversation.created", ShopID: shop.ID, EntityID: conversation.ID, Payload: conversation, CreatedAt: time.Now().UTC()})
	}
	if len(messages) > 0 && messageCreated {
		message := messages[len(messages)-1]
		s.broadcastConversationEvent(conversation, Event{Type: "message.created", ShopID: shop.ID, EntityID: message.ID, Payload: message, CreatedAt: time.Now().UTC()})
		if routed, _, routeErr := s.tryAutoAssignConversation(r.Context(), conversation.ID); routeErr == nil {
			conversation = routed
		}
	}
	writeJSONResponse(w, http.StatusCreated, publicChatConversationResponse{
		Shop:         shop,
		Source:       source,
		Conversation: conversation,
		Messages:     nonNilSlice(messages),
	})
}

func (s *Server) handlePublicChatInstantAnswer(w http.ResponseWriter, r *http.Request) {
	var input publicChatInstantAnswerRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	_, source, err := s.publicChatContext(r.Context(), input.Shop)
	if err != nil {
		writeError(w, err)
		return
	}
	answer, ok := findPublicInstantAnswer(source.Metadata, input.AnswerID)
	if !ok {
		writeError(w, fmt.Errorf("%w: instant answer is unavailable", ErrInvalid))
		return
	}
	now := time.Now().UTC()
	answerTitle, answerBody := answer.Title, answer.Answer
	if answer.Mode == "order_tracking" {
		localization := s.publicOrderTrackingLocalization(r.Context(), input.Language)
		answerTitle = localization["trackOrder"]
		answerBody = localization["orderHelp"]
	}
	messages := []Message{
		publicChatSelfServiceMessage(
			MessageDirectionCustomer,
			answerTitle,
			firstNonEmpty(input.CustomerName, "Visitor"),
			nil,
			now,
		),
		publicChatSelfServiceMessage(
			MessageDirectionSystem,
			answerBody,
			"Xzdesk",
			nil,
			now.Add(time.Nanosecond),
		),
	}
	writeJSONResponse(w, http.StatusOK, publicChatSelfServiceResponse{
		Messages: messages,
	})
}

func publicChatSelfServiceMessage(direction, body, senderName string, metadata map[string]string, createdAt time.Time) Message {
	return Message{
		ID:         prefixedID("self_service"),
		Direction:  direction,
		Type:       MessageTypeText,
		Body:       strings.TrimSpace(body),
		Metadata:   metadata,
		SenderName: strings.TrimSpace(senderName),
		CreatedAt:  createdAt,
	}
}

func (s *Server) handlePublicChatConversationSubroutes(w http.ResponseWriter, r *http.Request) {
	parts := splitPath(r.URL.Path)
	if len(parts) != 7 || parts[0] != "api" || parts[1] != "v1" || parts[2] != "public" || parts[3] != "chat" || parts[4] != "conversations" || parts[6] != "messages" {
		http.NotFound(w, r)
		return
	}
	conversationID := parts[5]
	conversation, err := s.store.GetConversation(r.Context(), conversationID)
	if err != nil {
		writeError(w, err)
		return
	}
	shop, err := s.store.GetShop(r.Context(), conversation.ShopID)
	if err != nil {
		writeError(w, err)
		return
	}
	if shop.Status != ShopStatusActive {
		writeError(w, ErrNotFound)
		return
	}
	source, err := s.store.GetShopSource(r.Context(), shop.ID, conversation.SourceID)
	if err != nil {
		writeError(w, err)
		return
	}
	if source.Type != SourceTypeShopifyChat {
		writeError(w, ErrNotFound)
		return
	}
	source = withShopifyChatDefaults(source)

	switch r.Method {
	case http.MethodGet:
		if _, _, err := s.authorizePublicChatCustomer(r.Context(), shop, source, conversation.ID, r.URL.Query().Get("customerSession")); err != nil {
			writeError(w, err)
			return
		}
		messages, err := s.store.ListMessages(r.Context(), conversation.ID)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSONResponse(w, http.StatusOK, nonNilSlice(messages))
	case http.MethodPost:
		var input publicChatMessageRequest
		if !decodeJSON(w, r, &input) {
			return
		}
		clientMessageID, err := normalizePublicClientMessageID(input.ClientMessageID)
		if err != nil {
			writeError(w, err)
			return
		}
		input.ClientMessageID = clientMessageID
		customerID, profile, err := s.authorizePublicChatCustomer(r.Context(), shop, source, conversation.ID, input.CustomerSession)
		if err != nil {
			writeError(w, err)
			return
		}
		if profile != nil {
			input.CustomerName = firstNonEmpty(profile.DisplayName, input.CustomerName)
			input.CustomerEmail = firstNonEmpty(profile.Email, input.CustomerEmail)
		}
		conversation, err = s.promotePublicSupportConversation(r.Context(), conversation)
		if err != nil {
			writeError(w, err)
			return
		}
		requestedMessageID := prefixedID("msg")
		message, updated, err := s.store.AddMessage(r.Context(), Message{
			ID:              requestedMessageID,
			ConversationID:  conversation.ID,
			Direction:       MessageDirectionCustomer,
			Body:            input.Body,
			SenderName:      firstNonEmpty(input.CustomerName, "Visitor"),
			SenderEmail:     input.CustomerEmail,
			SourceMessageID: publicVisitorMessageID(input.VisitorID, input.Body, input.ClientMessageID),
			Metadata: publicChatCustomerMetadata(publicEntryMetadata(
				input.PageTitle, input.PageURL, input.ProductHandle, input.ProductTitle,
				input.ProductImageURL, input.ProductPrice, input.ProductCurrency,
			), customerID),
		})
		if err != nil {
			writeError(w, err)
			return
		}
		if message.ID == requestedMessageID {
			s.broadcastConversationEvent(updated, Event{Type: "message.created", ShopID: updated.ShopID, EntityID: message.ID, Payload: message, CreatedAt: time.Now().UTC()})
			if _, _, routeErr := s.tryAutoAssignConversation(r.Context(), updated.ID); routeErr != nil {
				log.Printf("public chat: automatic assignment failed for %s: %v", updated.ID, routeErr)
			}
		}
		writeJSONResponse(w, http.StatusCreated, message)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleChatWebSocket(w http.ResponseWriter, r *http.Request) {
	conversationID := strings.TrimSpace(r.URL.Query().Get("conversationId"))
	if conversationID == "" {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "conversationId is required"})
		return
	}
	conversation, err := s.store.GetConversation(r.Context(), conversationID)
	if err != nil {
		writeError(w, err)
		return
	}
	shop, err := s.store.GetShop(r.Context(), conversation.ShopID)
	if err != nil {
		writeError(w, err)
		return
	}
	source, err := s.store.GetShopSource(r.Context(), shop.ID, conversation.SourceID)
	if err != nil {
		writeError(w, err)
		return
	}
	if source.Type != SourceTypeShopifyChat {
		writeError(w, ErrNotFound)
		return
	}
	source = withShopifyChatDefaults(source)
	if _, _, err := s.authorizePublicChatCustomer(r.Context(), shop, source, conversation.ID, r.URL.Query().Get("customerSession")); err != nil {
		writeError(w, err)
		return
	}
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	s.chatClientsMu.Lock()
	if s.chatClients[conversationID] == nil {
		s.chatClients[conversationID] = map[*websocket.Conn]*chatEventClient{}
	}
	client := &chatEventClient{send: make(chan Event, chatClientQueueSize), done: make(chan struct{})}
	s.chatClients[conversationID][conn] = client
	s.chatClientsMu.Unlock()
	go s.runChatEventWriter(conversationID, conn, client)
	defer func() {
		s.removeChatEventClient(conversationID, conn)
	}()
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			return
		}
	}
}

func (s *Server) publicChatContext(ctx context.Context, shopRef string) (Shop, ShopSource, error) {
	shop, err := s.findPublicShop(ctx, shopRef)
	if err != nil {
		return Shop{}, ShopSource{}, err
	}
	sources, err := s.store.ListShopSources(ctx, shop.ID)
	if err != nil {
		return Shop{}, ShopSource{}, err
	}
	hasChatSource := false
	for _, source := range sources {
		if source.Type != SourceTypeShopifyChat {
			continue
		}
		hasChatSource = true
		if source.Status == SourceStatusActive {
			return shop, withShopifyChatDefaults(source), nil
		}
	}
	if hasChatSource {
		return Shop{}, ShopSource{}, fmt.Errorf("%w: Shopify Chat source is disabled", ErrInvalid)
	}
	source, err := s.store.CreateShopSource(ctx, ShopSource{
		ShopID:   shop.ID,
		Type:     SourceTypeShopifyChat,
		Provider: "xzdesk_widget",
		Address:  shopRef,
	})
	if err != nil {
		return Shop{}, ShopSource{}, err
	}
	return shop, withShopifyChatDefaults(source), nil
}

func (s *Server) findPublicShop(ctx context.Context, shopRef string) (Shop, error) {
	shopRef = strings.TrimSpace(shopRef)
	if shopRef == "" {
		return Shop{}, fmt.Errorf("%w: shop is required", ErrInvalid)
	}
	normalizedDomain := normalizeShopifyDomain(shopRef)
	shops, err := s.store.ListShops(ctx)
	if err != nil {
		return Shop{}, err
	}
	for _, shop := range shops {
		if shop.Status != ShopStatusActive {
			continue
		}
		if shop.ID == shopRef || strings.EqualFold(shop.ExternalID, shopRef) || strings.EqualFold(shop.DisplayName, shopRef) {
			return shop, nil
		}
		if normalizedDomain != "" {
			for _, value := range []string{shop.ExternalID, shop.Metadata["shopifyDomain"], shop.Metadata["domain"]} {
				if normalizeShopifyDomain(value) == normalizedDomain {
					return shop, nil
				}
			}
		}
		if normalizedDomain != "" {
			sources, err := s.store.ListShopSources(ctx, shop.ID)
			if err != nil {
				return Shop{}, err
			}
			for _, source := range sources {
				if source.Type != SourceTypeShopifyChat && source.Type != SourceTypeShopifyAPI {
					continue
				}
				for _, value := range []string{source.Address, source.Metadata["shopifyDomain"]} {
					if normalizeShopifyDomain(value) == normalizedDomain {
						return shop, nil
					}
				}
			}
		}
	}
	return Shop{}, ErrNotFound
}

func (s *Server) upsertPublicConversationMessage(ctx context.Context, shop Shop, source ShopSource, input publicChatConversationRequest) (Conversation, []Message, bool, bool, error) {
	conversationID := strings.TrimSpace(input.ConversationID)
	created := false
	var conversation Conversation
	var err error
	if conversationID != "" {
		conversation, err = s.store.GetConversation(ctx, conversationID)
		if err != nil {
			return Conversation{}, nil, false, false, err
		}
		if conversation.ShopID != shop.ID || conversation.SourceID != source.ID {
			return Conversation{}, nil, false, false, fmt.Errorf("%w: conversation does not belong to this shop", ErrInvalid)
		}
		if strings.TrimSpace(input.Body) != "" {
			conversation, err = s.promotePublicSupportConversation(ctx, conversation)
			if err != nil {
				return Conversation{}, nil, false, false, err
			}
		}
	} else {
		conversationID = publicFirstConversationID(source.ID, input.ClientMessageID)
		if conversationID != "" {
			existing, lookupErr := s.store.GetConversation(ctx, conversationID)
			if lookupErr == nil {
				if existing.ShopID != shop.ID || existing.SourceID != source.ID {
					return Conversation{}, nil, false, false, fmt.Errorf("%w: conversation does not belong to this shop", ErrInvalid)
				}
				conversation = existing
			} else if !errors.Is(lookupErr, ErrNotFound) {
				return Conversation{}, nil, false, false, lookupErr
			}
		}
		if conversation.ID == "" {
			conversation, err = s.store.CreateConversation(ctx, Conversation{
				ID:            conversationID,
				ShopID:        shop.ID,
				SourceID:      source.ID,
				CustomerName:  strings.TrimSpace(input.CustomerName),
				CustomerEmail: strings.TrimSpace(input.CustomerEmail),
				Subject:       firstNonEmpty(input.Subject, "Online chat"),
				Status:        ConversationStatusOpen,
			})
			if err != nil {
				if conversationID == "" {
					return Conversation{}, nil, false, false, err
				}
				conversation, err = s.store.GetConversation(ctx, conversationID)
				if err != nil {
					return Conversation{}, nil, false, false, err
				}
				if conversation.ShopID != shop.ID || conversation.SourceID != source.ID {
					return Conversation{}, nil, false, false, fmt.Errorf("%w: conversation does not belong to this shop", ErrInvalid)
				}
			} else {
				created = true
			}
		}
	}

	messages := []Message{}
	messageCreated := false
	if strings.TrimSpace(input.Body) != "" {
		requestedMessageID := prefixedID("msg")
		message, updated, err := s.store.AddMessage(ctx, Message{
			ID:              requestedMessageID,
			ConversationID:  conversation.ID,
			Direction:       MessageDirectionCustomer,
			Body:            input.Body,
			SenderName:      firstNonEmpty(input.CustomerName, "Visitor"),
			SenderEmail:     input.CustomerEmail,
			SourceMessageID: publicVisitorMessageID(input.VisitorID, input.Body, input.ClientMessageID),
			Metadata: publicChatCustomerMetadata(publicEntryMetadata(
				input.PageTitle, input.PageURL, input.ProductHandle, input.ProductTitle,
				input.ProductImageURL, input.ProductPrice, input.ProductCurrency,
			), input.CustomerID),
		})
		if err != nil {
			return Conversation{}, nil, false, false, err
		}
		messageCreated = message.ID == requestedMessageID
		conversation = updated
		messages = append(messages, message)
	}
	return conversation, messages, created, messageCreated, nil
}

func (s *Server) promotePublicSupportConversation(ctx context.Context, conversation Conversation) (Conversation, error) {
	if normalizeConversationKind(conversation.Kind) == ConversationKindCustomer {
		return conversation, nil
	}
	input := ConversationUpdate{
		SetEmailDisposition: true,
		Kind:                ConversationKindCustomer,
		ReplyAllowed:        true,
		Classification:      "customer requested support after self-service",
	}
	if conversation.Status != ConversationStatusAssigned {
		input.Status = ConversationStatusOpen
	}
	return s.store.UpdateConversation(ctx, conversation.ID, input)
}

func publicEntryMetadata(title, pageURL, productHandle, productTitle, productImageURL, productPrice, productCurrency string) map[string]string {
	metadata := map[string]string{
		"entryPageTitle":           strings.TrimSpace(title),
		"entryPageUrl":             strings.TrimSpace(pageURL),
		"entryProductHandle":       strings.TrimSpace(productHandle),
		"entryProductTitle":        strings.TrimSpace(productTitle),
		"entryProductImageUrl":     strings.TrimSpace(productImageURL),
		"entryProductPrice":        strings.TrimSpace(productPrice),
		"entryProductCurrencyCode": strings.TrimSpace(productCurrency),
	}
	if metadata["entryPageUrl"] != "" && !isSafeHTTPURL(metadata["entryPageUrl"]) {
		delete(metadata, "entryPageUrl")
	}
	if metadata["entryProductImageUrl"] != "" && !isSafeHTTPURL(metadata["entryProductImageUrl"]) {
		delete(metadata, "entryProductImageUrl")
	}
	for key, value := range metadata {
		if value == "" {
			delete(metadata, key)
		}
	}
	if len(metadata) == 0 {
		return nil
	}
	return metadata
}

func findPublicInstantAnswer(metadata map[string]string, answerID string) (publicInstantAnswer, bool) {
	if metadata == nil || metadata["instantAnswersEnabled"] != "true" {
		return publicInstantAnswer{}, false
	}
	type rawInstantAnswer struct {
		ID      string `json:"id"`
		Title   string `json:"title"`
		Answer  string `json:"answer"`
		Enabled *bool  `json:"enabled"`
		Mode    string `json:"mode"`
	}
	var rawAnswers []rawInstantAnswer
	if err := json.Unmarshal([]byte(metadata["instantAnswersJson"]), &rawAnswers); err != nil {
		return publicInstantAnswer{}, false
	}
	answerID = strings.TrimSpace(answerID)
	for index, raw := range rawAnswers {
		id := strings.TrimSpace(raw.ID)
		if id == "" {
			id = fmt.Sprintf("answer_%d", index)
		}
		enabled := raw.Enabled == nil || *raw.Enabled
		title := strings.TrimSpace(raw.Title)
		answer := strings.TrimSpace(raw.Answer)
		if enabled && id == answerID && title != "" && answer != "" {
			mode := strings.TrimSpace(raw.Mode)
			if mode == "" {
				mode = "text"
			}
			return publicInstantAnswer{ID: id, Title: title, Answer: answer, Enabled: true, Mode: mode}, true
		}
	}
	return publicInstantAnswer{}, false
}

func normalizePublicClientMessageID(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	if len(value) > 128 {
		return "", fmt.Errorf("%w: clientMessageId is invalid", ErrInvalid)
	}
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') ||
			(char >= '0' && char <= '9') || char == '-' || char == '_' {
			continue
		}
		return "", fmt.Errorf("%w: clientMessageId is invalid", ErrInvalid)
	}
	return value, nil
}

func publicFirstConversationID(sourceID string, clientMessageID string) string {
	if strings.TrimSpace(clientMessageID) == "" {
		return ""
	}
	return stableExternalConversationID(sourceID, "public-client-message:"+clientMessageID)
}

func publicVisitorMessageID(visitorID string, body string, clientMessageIDs ...string) string {
	visitorID = strings.TrimSpace(visitorID)
	if visitorID == "" {
		return ""
	}
	if len(clientMessageIDs) > 0 && strings.TrimSpace(clientMessageIDs[0]) != "" {
		return stableExternalConversationID(visitorID, "public-client-message:"+strings.TrimSpace(clientMessageIDs[0]))
	}
	return stableExternalConversationID(visitorID, fmt.Sprintf("%d:%s", time.Now().UnixNano(), strings.TrimSpace(body)))
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}

func (s *Server) handleChatWidgetScript(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	script := strings.ReplaceAll(chatWidgetScriptEnglish, "__DEFAULT_SHOP__", jsString(r.URL.Query().Get("shop")))
	_, _ = io.WriteString(w, script)
}

func (s *Server) handleChatWidgetStyles(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/css; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=300")
	_, _ = io.WriteString(w, chatWidgetStyles)
}

func jsString(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	return url.QueryEscape(value)
}

//go:embed static/chat-widget.js
var chatWidgetScriptEnglish string

//go:embed static/chat-widget.css
var chatWidgetStyles string
