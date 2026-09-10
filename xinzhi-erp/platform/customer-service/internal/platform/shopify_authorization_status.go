package platform

import (
	"errors"
	"net/http"
	"strings"
)

const (
	shopifyAuthorizationFeatureRefund  = "refund"
	shopifyAuthorizationFeatureDispute = "dispute"
)

type ShopifyAuthorizationStatus struct {
	ShopID               string   `json:"shopId"`
	ShopName             string   `json:"shopName"`
	Installed            bool     `json:"installed"`
	NeedsReauthorization bool     `json:"needsReauthorization"`
	MissingScopes        []string `json:"missingScopes"`
}

func requiredShopifyScopesForFeature(feature string) ([]string, string, bool) {
	switch strings.ToLower(strings.TrimSpace(feature)) {
	case shopifyAuthorizationFeatureRefund:
		return []string{shopifyReturnReadScope, shopifyReturnWriteScope, shopifyOrderWriteScope}, PermissionOrdersRefund, true
	case shopifyAuthorizationFeatureDispute:
		return []string{shopifyDisputeReadScope}, PermissionOrdersDisputes, true
	default:
		return nil, "", false
	}
}

func (s *Server) handleShopifyAuthorizationStatus(w http.ResponseWriter, r *http.Request) {
	_, user, ok := s.requireAuth(w, r)
	if !ok {
		return
	}
	feature := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("feature")))
	requiredScopes, permission, valid := requiredShopifyScopesForFeature(feature)
	if !valid {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "feature must be refund or dispute"})
		return
	}
	if !userHasPermission(user, permission) {
		writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "required order operation permission is missing"})
		return
	}

	requestedShopID := strings.TrimSpace(r.URL.Query().Get("shopId"))
	shops, err := s.store.ListShops(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	allowedShopIDs, restricted, err := s.moduleScopeShopIDs(r.Context(), user, DataScopeOrders)
	if err != nil {
		writeError(w, err)
		return
	}
	allowedSet := stringSet(allowedShopIDs)
	statuses := make([]ShopifyAuthorizationStatus, 0, len(shops))
	for _, shop := range shops {
		if shop.Status != ShopStatusActive || (restricted && !allowedSet[shop.ID]) || (requestedShopID != "" && shop.ID != requestedShopID) {
			continue
		}
		sources, sourceErr := s.store.ListShopSources(r.Context(), shop.ID)
		if sourceErr != nil {
			writeError(w, sourceErr)
			return
		}
		if shopifyDomainForShop(shop, sources) == "" {
			continue
		}
		status, statusErr := s.shopifyAuthorizationStatusForShop(r, shop, requiredScopes)
		if statusErr != nil {
			writeError(w, statusErr)
			return
		}
		statuses = append(statuses, status)
	}
	if requestedShopID != "" && len(statuses) == 0 {
		writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "shop is outside the order data scope"})
		return
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{"feature": feature, "shops": statuses})
}

func (s *Server) shopifyAuthorizationStatusForShop(r *http.Request, shop Shop, requiredScopes []string) (ShopifyAuthorizationStatus, error) {
	status := ShopifyAuthorizationStatus{ShopID: shop.ID, ShopName: shop.DisplayName, MissingScopes: append([]string(nil), requiredScopes...)}
	sources, err := s.store.ListShopSources(r.Context(), shop.ID)
	if err != nil {
		return status, err
	}
	domain := shopifyDomainForShop(shop, sources)
	if domain == "" {
		status.NeedsReauthorization = true
		return status, nil
	}
	installation, err := s.store.GetShopifyInstallationByDomain(r.Context(), domain)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			status.NeedsReauthorization = true
			return status, nil
		}
		return status, err
	}
	status.Installed = strings.TrimSpace(installation.AccessToken) != ""
	status.MissingScopes = status.MissingScopes[:0]
	for _, scope := range requiredScopes {
		if !shopifyScopeIncludes(installation.Scope, scope) {
			status.MissingScopes = append(status.MissingScopes, scope)
		}
	}
	status.NeedsReauthorization = !status.Installed || len(status.MissingScopes) > 0
	return status, nil
}
