package platform

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"
)

const (
	shopifyComplianceBodyLimit       = 2 << 20
	shopifyComplianceDeadline        = 30 * 24 * time.Hour
	shopifyComplianceTicketCategory  = "Shopify 隐私合规"
	shopifyComplianceWebhookActor    = "shopify_compliance_webhook"
	shopifyCustomersDataRequestTopic = "customers/data_request"
	shopifyCustomersRedactTopic      = "customers/redact"
	shopifyShopRedactTopic           = "shop/redact"
)

type shopifyCompliancePayload struct {
	ShopID          json.Number   `json:"shop_id"`
	ShopDomain      string        `json:"shop_domain"`
	OrdersRequested []json.Number `json:"orders_requested"`
	OrdersToRedact  []json.Number `json:"orders_to_redact"`
	Customer        struct {
		ID json.Number `json:"id"`
	} `json:"customer"`
	DataRequest struct {
		ID json.Number `json:"id"`
	} `json:"data_request"`
}

type shopifyComplianceTicketDescription struct {
	Topic           string   `json:"topic"`
	WebhookID       string   `json:"webhookId"`
	ShopDomain      string   `json:"shopDomain"`
	ShopifyShopID   string   `json:"shopifyShopId,omitempty"`
	ShopifyCustomer string   `json:"shopifyCustomerId,omitempty"`
	DataRequestID   string   `json:"dataRequestId,omitempty"`
	OrderIDs        []string `json:"orderIds,omitempty"`
	ReceivedAt      string   `json:"receivedAt"`
	DueAt           string   `json:"dueAt"`
}

func (s *Server) handleShopifyComplianceWebhook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || !strings.EqualFold(mediaType, "application/json") {
		writeJSONResponse(w, http.StatusUnsupportedMediaType, map[string]string{"error": "Shopify compliance webhook requires application/json"})
		return
	}
	defer r.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(r.Body, shopifyComplianceBodyLimit+1))
	if err != nil {
		writeShopifyComplianceFailure(w)
		return
	}
	if len(raw) > shopifyComplianceBodyLimit {
		writeJSONResponse(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "Shopify compliance webhook payload is too large"})
		return
	}

	headerShop := normalizeShopifyDomain(r.Header.Get("X-Shopify-Shop-Domain"))
	cfg, err := s.shopifyWebhookConfigForShop(r.Context(), headerShop)
	if err != nil {
		writeShopifyComplianceFailure(w)
		return
	}
	if !verifyShopifyWebhookHMAC(raw, r.Header.Get("X-Shopify-Hmac-Sha256"), cfg.Secret) {
		writeJSONResponse(w, http.StatusUnauthorized, map[string]string{"error": "invalid Shopify webhook HMAC"})
		return
	}

	topic := strings.ToLower(strings.TrimSpace(r.Header.Get("X-Shopify-Topic")))
	if !isShopifyComplianceTopic(topic) {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "invalid Shopify compliance topic"})
		return
	}
	var payload shopifyCompliancePayload
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.UseNumber()
	if err := decoder.Decode(&payload); err != nil {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "invalid Shopify compliance payload"})
		return
	}
	payloadShop := normalizeShopifyDomain(payload.ShopDomain)
	if payloadShop == "" || (headerShop != "" && headerShop != payloadShop) {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "Shopify compliance shop domain mismatch"})
		return
	}

	webhookID := strings.TrimSpace(r.Header.Get("X-Shopify-Webhook-Id"))
	if webhookID == "" {
		webhookID = shopifyComplianceDeliveryDigest(topic, raw)
	}
	if err := s.queueShopifyComplianceRequest(r.Context(), topic, webhookID, payloadShop, payload); err != nil {
		writeShopifyComplianceFailure(w)
		return
	}
	writeJSONResponse(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) queueShopifyComplianceRequest(
	ctx context.Context,
	topic string,
	webhookID string,
	shopDomain string,
	payload shopifyCompliancePayload,
) error {
	shop, found, err := s.findShopifyShopByDomain(ctx, shopDomain)
	if err != nil || !found {
		return err
	}
	ticketID := "ticket_shopify_privacy_" + shopifyComplianceDeliveryDigest(topic, []byte(webhookID))
	if _, err := s.store.GetTicket(ctx, ticketID); err == nil {
		return nil
	} else if !errors.Is(err, ErrNotFound) {
		return err
	}
	now := time.Now().UTC()
	dueAt := now.Add(shopifyComplianceDeadline)
	description := shopifyComplianceTicketDescription{
		Topic:           topic,
		WebhookID:       webhookID,
		ShopDomain:      shopDomain,
		ShopifyShopID:   payload.ShopID.String(),
		ShopifyCustomer: payload.Customer.ID.String(),
		DataRequestID:   payload.DataRequest.ID.String(),
		OrderIDs:        shopifyComplianceOrderIDs(topic, payload),
		ReceivedAt:      now.Format(time.RFC3339),
		DueAt:           dueAt.Format(time.RFC3339),
	}
	rawDescription, err := json.Marshal(description)
	if err != nil {
		return err
	}
	ownerID, err := s.shopifyComplianceOwner(ctx)
	if err != nil {
		return err
	}
	ticket, err := s.store.CreateTicket(ctx, Ticket{
		ID:              ticketID,
		Type:            TicketTypeInternal,
		ShopID:          shop.ID,
		CustomerRef:     shopifyComplianceCustomerRef(payload),
		Title:           shopifyComplianceTicketTitle(topic),
		Category:        shopifyComplianceTicketCategory,
		Priority:        "urgent",
		Status:          TicketStatusOpen,
		AssignedAgentID: ownerID,
		Description:     string(rawDescription),
		DueAt:           &dueAt,
		CreatedBy:       shopifyComplianceWebhookActor,
	})
	if err != nil {
		if _, duplicateErr := s.store.GetTicket(ctx, ticketID); duplicateErr == nil {
			return nil
		}
		return err
	}
	s.broadcast(Event{
		Type:      "shopify_privacy.requested",
		ShopID:    shop.ID,
		EntityID:  ticket.ID,
		Payload:   map[string]string{"topic": topic, "webhookId": webhookID, "ticketId": ticket.ID},
		CreatedAt: now,
	})
	return nil
}

func (s *Server) shopifyComplianceOwner(ctx context.Context) (string, error) {
	users, err := s.store.ListUsers(ctx)
	if err != nil {
		return "", err
	}
	ownerID := ""
	for _, user := range users {
		if !user.SystemAdmin || user.Status != UserStatusActive {
			continue
		}
		if ownerID == "" || user.ID < ownerID {
			ownerID = user.ID
		}
	}
	if ownerID == "" {
		return "", errors.New("Shopify compliance request owner is not configured")
	}
	return ownerID, nil
}

func (s *Server) findShopifyShopByDomain(ctx context.Context, shopDomain string) (Shop, bool, error) {
	shops, err := s.store.ListShops(ctx)
	if err != nil {
		return Shop{}, false, err
	}
	shopDomain = normalizeShopifyDomain(shopDomain)
	for _, shop := range shops {
		if normalizeShopifyDomain(shop.ExternalID) == shopDomain ||
			normalizeShopifyDomain(shop.Metadata["shopifyDomain"]) == shopDomain {
			return shop, true, nil
		}
	}
	return Shop{}, false, nil
}

func isShopifyComplianceTopic(topic string) bool {
	switch topic {
	case shopifyCustomersDataRequestTopic, shopifyCustomersRedactTopic, shopifyShopRedactTopic:
		return true
	default:
		return false
	}
}

func shopifyComplianceTicketTitle(topic string) string {
	switch topic {
	case shopifyCustomersDataRequestTopic:
		return "Shopify 隐私请求：导出客户数据"
	case shopifyCustomersRedactTopic:
		return "Shopify 隐私请求：删除客户数据"
	default:
		return "Shopify 隐私请求：删除店铺数据"
	}
}

func shopifyComplianceCustomerRef(payload shopifyCompliancePayload) string {
	if customerID := payload.Customer.ID.String(); customerID != "" {
		return "shopify-customer:" + customerID
	}
	return "shopify-shop:" + payload.ShopID.String()
}

func shopifyComplianceOrderIDs(topic string, payload shopifyCompliancePayload) []string {
	values := payload.OrdersRequested
	if topic == shopifyCustomersRedactTopic {
		values = payload.OrdersToRedact
	}
	result := make([]string, 0, len(values))
	for _, value := range values {
		if id := value.String(); id != "" {
			result = append(result, id)
		}
	}
	return result
}

func shopifyComplianceDeliveryDigest(topic string, raw []byte) string {
	sum := sha256.Sum256(append([]byte(strings.TrimSpace(topic)+"\x00"), raw...))
	return hex.EncodeToString(sum[:16])
}

func writeShopifyComplianceFailure(w http.ResponseWriter) {
	writeJSONResponse(w, http.StatusServiceUnavailable, map[string]string{
		"error": "Shopify compliance request is temporarily unavailable",
	})
}
