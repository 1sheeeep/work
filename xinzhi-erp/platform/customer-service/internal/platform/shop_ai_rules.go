package platform

import (
	"fmt"
	"net/http"
	"strings"
	"time"
)

const (
	shopAIReplyRulesKey          = "aiReplyRules"
	shopAIReplyRulesUpdatedByKey = "aiReplyRulesUpdatedBy"
	shopAIReplyRulesUpdaterKey   = "aiReplyRulesUpdatedByName"
	shopAIReplyRulesUpdatedAtKey = "aiReplyRulesUpdatedAt"
	maxShopAIReplyRulesLength    = 4000
	maxShopAIReplyRuleLines      = 100
)

type shopAIReplyRulesRequest struct {
	Rules string `json:"rules"`
}

type shopAIReplyRulesResponse struct {
	ShopID        string `json:"shopId"`
	Rules         string `json:"rules"`
	UpdatedBy     string `json:"updatedBy,omitempty"`
	UpdatedByName string `json:"updatedByName,omitempty"`
	UpdatedAt     string `json:"updatedAt,omitempty"`
}

func (s *Server) handleShopAIReplyRules(w http.ResponseWriter, r *http.Request, user User, shopID string) {
	if !s.requireModuleShopAccess(w, r, user, DataScopeShops, shopID) {
		return
	}
	shop, err := s.store.GetShop(r.Context(), shopID)
	if err != nil {
		writeError(w, err)
		return
	}

	switch r.Method {
	case http.MethodGet:
		writeJSONResponse(w, http.StatusOK, shopAIReplyRulesFromShop(shop))
	case http.MethodPatch:
		var input shopAIReplyRulesRequest
		if !decodeJSON(w, r, &input) {
			return
		}
		rules, err := normalizeShopAIReplyRules(input.Rules)
		if err != nil {
			writeError(w, err)
			return
		}
		metadata := cloneStringMap(shop.Metadata)
		if metadata == nil {
			metadata = map[string]string{}
		}
		now := time.Now().UTC()
		metadata[shopAIReplyRulesKey] = rules
		metadata[shopAIReplyRulesUpdatedByKey] = user.ID
		metadata[shopAIReplyRulesUpdaterKey] = strings.TrimSpace(user.DisplayName)
		metadata[shopAIReplyRulesUpdatedAtKey] = now.Format(time.RFC3339)

		updated, err := s.store.UpdateShop(r.Context(), shopID, Shop{Metadata: metadata})
		if err != nil {
			writeError(w, err)
			return
		}
		s.broadcast(Event{Type: "shop.updated", ShopID: updated.ID, EntityID: updated.ID, Payload: updated, CreatedAt: now})
		writeJSONResponse(w, http.StatusOK, shopAIReplyRulesFromShop(updated))
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func normalizeShopAIReplyRules(value string) (string, error) {
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	lines := strings.Split(value, "\n")
	normalized := make([]string, 0, len(lines))
	for _, line := range lines {
		if line = strings.TrimSpace(line); line != "" {
			normalized = append(normalized, line)
		}
	}
	if len(normalized) > maxShopAIReplyRuleLines {
		return "", fmt.Errorf("%w: AI reply rules cannot exceed %d non-empty lines", ErrInvalid, maxShopAIReplyRuleLines)
	}
	rules := strings.Join(normalized, "\n")
	if len([]rune(rules)) > maxShopAIReplyRulesLength {
		return "", fmt.Errorf("%w: AI reply rules cannot exceed %d characters", ErrInvalid, maxShopAIReplyRulesLength)
	}
	return rules, nil
}

func shopAIReplyRulesFromShop(shop Shop) shopAIReplyRulesResponse {
	return shopAIReplyRulesResponse{
		ShopID:        shop.ID,
		Rules:         strings.TrimSpace(shop.Metadata[shopAIReplyRulesKey]),
		UpdatedBy:     strings.TrimSpace(shop.Metadata[shopAIReplyRulesUpdatedByKey]),
		UpdatedByName: strings.TrimSpace(shop.Metadata[shopAIReplyRulesUpdaterKey]),
		UpdatedAt:     strings.TrimSpace(shop.Metadata[shopAIReplyRulesUpdatedAtKey]),
	}
}
