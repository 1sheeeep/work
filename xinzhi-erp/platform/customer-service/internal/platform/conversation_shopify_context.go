package platform

import (
	"errors"
	"net/http"
	"strings"
)

type ConversationShopifyContext struct {
	ShopID            string               `json:"shopId"`
	ShopName          string               `json:"shopName"`
	AssignedAgentID   string               `json:"assignedAgentId,omitempty"`
	AssignedAgentName string               `json:"assignedAgentName,omitempty"`
	OrderNumber       string               `json:"orderNumber,omitempty"`
	Order             *ShopifyOrderSummary `json:"order,omitempty"`
	SnapshotAt        string               `json:"snapshotAt,omitempty"`
}

func (s *Server) handleConversationShopifyContext(w http.ResponseWriter, r *http.Request, conversation Conversation) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	shop, err := s.store.GetShop(r.Context(), conversation.ShopID)
	if err != nil {
		writeError(w, err)
		return
	}

	result := ConversationShopifyContext{
		ShopID:          shop.ID,
		ShopName:        shop.DisplayName,
		AssignedAgentID: strings.TrimSpace(conversation.AssignedAgentID),
	}
	if result.AssignedAgentID != "" {
		agent, agentErr := s.store.GetUser(r.Context(), result.AssignedAgentID)
		if agentErr == nil {
			result.AssignedAgentName = strings.TrimSpace(agent.DisplayName)
		} else if !errors.Is(agentErr, ErrNotFound) {
			writeError(w, agentErr)
			return
		}
	}

	snapshot := s.loadShopifyOrderSnapshot(r.Context(), shop)
	result.SnapshotAt = strings.TrimSpace(snapshot.State.LastSuccessAt)
	storedOrderNumber := strings.TrimSpace(conversation.RecordOrderNumber)
	subjectOrderNumber := extractRecordOrderNumber(conversation.Subject)
	result.OrderNumber = firstNonEmpty(storedOrderNumber, subjectOrderNumber)
	if order, ok := conversationOrderFromSnapshot(snapshot.Orders, conversation, storedOrderNumber, subjectOrderNumber); ok {
		normalizeShopifyOrderTrackingURLs(&order)
		result.Order = &order
		if result.OrderNumber == "" {
			result.OrderNumber = strings.TrimSpace(order.Name)
		}
	}

	writeJSONResponse(w, http.StatusOK, result)
}

func conversationOrderFromSnapshot(orders []ShopifyOrderSummary, conversation Conversation, storedOrderNumber string, subjectOrderNumber string) (ShopifyOrderSummary, bool) {
	if order, ok := exactShopifyOrder(orders, storedOrderNumber); ok {
		return order, true
	}

	verified := filterShopifyOrdersByCustomerEmail(orders, conversation.CustomerEmail)
	if order, ok := exactShopifyOrder(verified, subjectOrderNumber); ok {
		return order, true
	}
	if strings.TrimSpace(storedOrderNumber) == "" && strings.TrimSpace(subjectOrderNumber) == "" && len(verified) > 0 {
		return verified[0], true
	}
	return ShopifyOrderSummary{}, false
}
