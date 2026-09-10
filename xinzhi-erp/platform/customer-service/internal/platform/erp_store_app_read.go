package platform

import (
	"context"
	"crypto/subtle"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
	"shopify-support-platform/internal/connectors/shopify/adminapi"
)

const StoreAppReadPrefix = "/internal/v1/erp-store-app/shopify/"
const StoreAppReadVersionHeader = "X-XZ-Store-App-Binding-Version"
const StoreAppReadProviderHeader = "X-XZ-Shopify-Provider"

// StoreAppReadBinding is an immutable, explicitly reviewed candidate, NOT an
// active business route. Never derive it from email, display name or a request.
type StoreAppReadBinding struct {
	Identity                                                                      shopifyconnector.CanonicalShopIdentity
	CustomerServiceShopID, ShopifyShopID, ShopDomain, InstallationID, AppClientID string
	Version                                                                       int64
}

// The preparation adapter has no store write/session/agent operations.
type StoreAppReadStore interface {
	GetShop(context.Context, string) (Shop, error)
	GetShopifyInstallationByDomain(context.Context, string) (ShopifyInstallation, error)
	GetShopifyAppProfile(context.Context, string) (ShopifyAppProfile, error)
}

type StoreAppReadProvider interface {
	FetchReadBindingFacts(context.Context, string, string) (adminapi.ReadBindingFacts, error)
	FetchOrderCatalogPage(context.Context, string, string, shopifyconnector.OrderCatalogPageRequest) (shopifyconnector.OrderCatalogPage, error)
}

type storeAppReadHandler struct {
	store    StoreAppReadStore
	provider StoreAppReadProvider
	token    string
	bindings map[shopifyconnector.CanonicalShopIdentity]StoreAppReadBinding
	busy     chan struct{}
}

var storeAppUUID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
var storeAppDomain = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$`)

// NewERPStoreAppReadHandler is deliberately NOT registered by Server.Handler or
// any production entrypoint. It can be mounted in an isolated rehearsal only.
// Each service credential grants only these reviewed shops and these two reads.
// It never falls back to SaaS, installs, uninstalls, refreshes or copies tokens.
func NewERPStoreAppReadHandler(store StoreAppReadStore, provider StoreAppReadProvider, token string, bindings []StoreAppReadBinding) (http.Handler, error) {
	invalid := errors.New("store app read preparation configuration is invalid")
	if store == nil || provider == nil || len(token) < 32 || len(token) > 256 || strings.TrimSpace(token) != token || len(bindings) == 0 || len(bindings) > 100 {
		return nil, invalid
	}
	for _, c := range token {
		if c < 33 || c > 126 {
			return nil, invalid
		}
	}
	h := &storeAppReadHandler{store: store, provider: provider, token: token, bindings: make(map[shopifyconnector.CanonicalShopIdentity]StoreAppReadBinding), busy: make(chan struct{}, 1)}
	csShops, domains, shopIDs := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for _, b := range bindings {
		if !storeAppUUID.MatchString(b.Identity.TenantID) || !storeAppUUID.MatchString(b.Identity.ShopID) ||
			!safeStoreAppRef(b.CustomerServiceShopID) || !safeStoreAppRef(b.AppClientID) ||
			!storeAppDomain.MatchString(b.ShopDomain) || !storeAppGID(b.ShopifyShopID, "Shop") ||
			!storeAppGID(b.InstallationID, "AppInstallation") || b.Version < 1 || b.Version > 9007199254740991 ||
			b.Identity.TenantID != bindings[0].Identity.TenantID ||
			csShops[b.CustomerServiceShopID] || domains[b.ShopDomain] || shopIDs[b.ShopifyShopID] {
			return nil, invalid
		}
		if _, exists := h.bindings[b.Identity]; exists {
			return nil, invalid
		}
		h.bindings[b.Identity] = b
		csShops[b.CustomerServiceShopID], domains[b.ShopDomain], shopIDs[b.ShopifyShopID] = true, true, true
	}
	return h, nil
}

func (h *storeAppReadHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodPost || (r.URL.Path != StoreAppReadPrefix+"connection" && r.URL.Path != StoreAppReadPrefix+"order-catalog") {
		storeAppReadError(w, http.StatusNotFound, "STORE_APP_READ_OPERATION_DISABLED")
		return
	}
	if len(r.Header.Values("X-XZ-ERP-Connector-Token")) != 1 || subtle.ConstantTimeCompare([]byte(r.Header.Get("X-XZ-ERP-Connector-Token")), []byte(h.token)) != 1 {
		storeAppReadError(w, http.StatusForbidden, "STORE_APP_READ_FORBIDDEN")
		return
	}
	if r.URL.RawQuery != "" {
		storeAppReadError(w, http.StatusBadRequest, "STORE_APP_READ_INVALID_REQUEST")
		return
	}
	var request shopifyconnector.OrderCatalogPageRequest
	if r.URL.Path == StoreAppReadPrefix+"connection" {
		var probe shopifyconnector.ConnectionProbeRequest
		if !decodeERPConnectorRequest(w, r, &probe) {
			return
		}
		if shopifyconnector.ValidateRequest(probe) != nil {
			storeAppReadError(w, 400, "STORE_APP_READ_INVALID_REQUEST")
			return
		}
		request.Identity, request.Context = probe.Identity, probe.Context
	} else {
		if !decodeERPConnectorRequest(w, r, &request) {
			return
		}
		if shopifyconnector.ValidateOrderCatalogPageRequest(request) != nil || request.Limit > 25 {
			storeAppReadError(w, 400, "STORE_APP_READ_INVALID_REQUEST")
			return
		}
	}
	b, ok := h.bindings[request.Identity]
	if !ok {
		storeAppReadError(w, 403, "STORE_APP_READ_FORBIDDEN")
		return
	}
	version := strconv.FormatInt(b.Version, 10)
	if len(r.Header.Values(StoreAppReadVersionHeader)) != 1 || r.Header.Get(StoreAppReadVersionHeader) != version {
		storeAppReadError(w, 409, "STORE_APP_READ_BINDING_CHANGED")
		return
	}
	// A bounded foreground preview, never a background scan or retry queue. This
	// does not claim to implement the future shared CS/ERP Shopify cost budget.
	select {
	case h.busy <- struct{}{}:
		defer func() { <-h.busy }()
	default:
		storeAppReadError(w, 429, "STORE_APP_READ_BUSY")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	installation, facts, err := h.resolve(ctx, b)
	if err != nil {
		storeAppReadError(w, 502, "STORE_APP_READ_NOT_VERIFIED")
		return
	}
	w.Header().Set(StoreAppReadProviderHeader, "CUSTOMER_SERVICE_STORE_APP_READ_ONLY")
	w.Header().Set(StoreAppReadVersionHeader, version)
	if r.URL.Path == StoreAppReadPrefix+"connection" {
		writeJSONResponse(w, 200, shopifyconnector.ConnectionSummary{
			ContractVersion: "shopify.connector.connection.v3", TenantID: b.Identity.TenantID, ShopID: b.Identity.ShopID,
			State: shopifyconnector.ConnectionStateConnected, GrantedScopes: facts.GrantedScopes,
			ShopName: facts.ShopName, ShopDomain: facts.ShopDomain, CheckedAt: time.Now().UTC(),
		})
		return
	}
	canRead := false
	for _, scope := range facts.GrantedScopes {
		if scope == "read_orders" || scope == "write_orders" {
			canRead = true
		}
	}
	if !canRead {
		storeAppReadError(w, 403, "STORE_APP_READ_SCOPE_MISSING")
		return
	}
	page, err := h.provider.FetchOrderCatalogPage(ctx, b.ShopDomain, installation.AccessToken, request)
	if err != nil || shopifyconnector.ValidateOrderCatalogPage(request, page) != nil || page.State != shopifyconnector.OrderCatalogStateConnected {
		storeAppReadError(w, 502, "STORE_APP_READ_UNAVAILABLE")
		return
	}
	writeJSONResponse(w, 200, page)
}

func (h *storeAppReadHandler) resolve(ctx context.Context, b StoreAppReadBinding) (ShopifyInstallation, adminapi.ReadBindingFacts, error) {
	invalid := errors.New("store app read binding is not verified")
	shop, err := h.store.GetShop(ctx, b.CustomerServiceShopID)
	if err != nil || shop.ID != b.CustomerServiceShopID || shop.Platform != "shopify" || shop.Status != "active" {
		return ShopifyInstallation{}, adminapi.ReadBindingFacts{}, invalid
	}
	profile, err := h.store.GetShopifyAppProfile(ctx, b.CustomerServiceShopID)
	if err != nil || profile.ShopID != shop.ID || profile.ShopDomain != b.ShopDomain || profile.ClientID != b.AppClientID {
		return ShopifyInstallation{}, adminapi.ReadBindingFacts{}, invalid
	}
	installation, err := h.store.GetShopifyInstallationByDomain(ctx, b.ShopDomain)
	if err != nil || installation.ShopID != shop.ID || installation.ShopDomain != b.ShopDomain || strings.TrimSpace(installation.AccessToken) == "" {
		return ShopifyInstallation{}, adminapi.ReadBindingFacts{}, invalid
	}
	facts, err := h.provider.FetchReadBindingFacts(ctx, b.ShopDomain, installation.AccessToken)
	if err != nil || facts.ShopID != b.ShopifyShopID || facts.ShopDomain != b.ShopDomain || facts.AppClientID != b.AppClientID ||
		facts.InstallationID != b.InstallationID || facts.GrantedScopes == nil || facts.ShopName == "" {
		return ShopifyInstallation{}, adminapi.ReadBindingFacts{}, invalid
	}
	return installation, facts, nil
}

func storeAppReadError(w http.ResponseWriter, status int, code string) {
	writeJSONResponse(w, status, map[string]any{"code": code, "error": "Store app preparation read was not completed", "retryable": false})
}

func safeStoreAppRef(s string) bool {
	if len(s) < 1 || len(s) > 128 {
		return false
	}
	for _, c := range s {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	return true
}

func storeAppGID(s, kind string) bool {
	n := strings.TrimPrefix(s, "gid://shopify/"+kind+"/")
	if n == s || n == "" || n[0] == '0' {
		return false
	}
	for _, c := range n {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}
