package platform

import (
	"context"
	"crypto/subtle"
	"errors"
	"net/http"
	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
	"strconv"
	"time"
)

const StoreAppInventoryPreparationPath = "/internal/v1/erp-store-app/shopify/inventory-set-preparation"
const InventoryPreparationRouteHeader = "X-XZ-Inventory-Route-Version"

type StoreAppInventoryPreparationProvider interface {
	StoreAppReadProvider
	SetInventoryAvailable(context.Context, string, string, shopifyconnector.InventorySetRequest) (shopifyconnector.InventorySetResult, error)
}

// Claim must durably consume the exact already-journaled command at the COMMON
// coordinator, validating payload, current actor/shop permission, pinned source
// and version. It must reject replay even after process restart. Nil is refused.
// It is not replaceable with a service-token-only or in-memory production gate.
type InventoryPreparationAuthority interface {
	Claim(context.Context, shopifyconnector.InventorySetRequest, int64) error
}

type storeAppInventoryPreparationHandler struct {
	read      *storeAppReadHandler
	provider  StoreAppInventoryPreparationProvider
	authority InventoryPreparationAuthority
}

// Deliberately never mounted by any production entrypoint. Reuses the original
// owner store and existing Shopify CAS/idempotency client, never copies tokens.
func NewERPStoreAppInventoryPreparationHandler(store StoreAppReadStore, provider StoreAppInventoryPreparationProvider, token string, bindings []StoreAppReadBinding, authority InventoryPreparationAuthority) (http.Handler, error) {
	if authority == nil {
		return nil, errors.New("inventory command authority required")
	}
	reader, err := NewERPStoreAppReadHandler(store, provider, token, bindings)
	if err != nil {
		return nil, err
	}
	return &storeAppInventoryPreparationHandler{reader.(*storeAppReadHandler), provider, authority}, nil
}

func (h *storeAppInventoryPreparationHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	fail := func(status int, code string) {
		writeJSONResponse(w, status, map[string]any{"code": code, "retryable": false})
	}
	if r.Method != http.MethodPost || r.URL.Path != StoreAppInventoryPreparationPath || r.URL.RawQuery != "" {
		fail(404, "INVENTORY_OPERATION_DISABLED")
		return
	}
	if len(r.Header.Values("X-XZ-ERP-Connector-Token")) != 1 || subtle.ConstantTimeCompare([]byte(r.Header.Get("X-XZ-ERP-Connector-Token")), []byte(h.read.token)) != 1 {
		fail(403, "INVENTORY_SOURCE_FORBIDDEN")
		return
	}
	var request shopifyconnector.InventorySetRequest
	if !decodeERPConnectorRequest(w, r, &request) {
		return
	}
	if shopifyconnector.ValidateInventorySetRequest(request) != nil {
		fail(400, "INVENTORY_COMMAND_INVALID")
		return
	}
	binding, ok := h.read.bindings[request.Identity]
	if !ok {
		fail(403, "INVENTORY_SOURCE_FORBIDDEN")
		return
	}
	version := strconv.FormatInt(binding.Version, 10)
	route, err := strconv.ParseInt(r.Header.Get(InventoryPreparationRouteHeader), 10, 64)
	if err != nil || route < 1 || len(r.Header.Values(InventoryPreparationRouteHeader)) != 1 || len(r.Header.Values(StoreAppReadVersionHeader)) != 1 || r.Header.Get(StoreAppReadVersionHeader) != version {
		fail(409, "INVENTORY_BINDING_OR_ROUTE_CHANGED")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	// Claim BEFORE any owner API call; loss of the response remains UNKNOWN in
	// the coordinator. A duplicate is never sent to another authorization source.
	if h.authority.Claim(ctx, request, route) != nil {
		fail(409, "INVENTORY_COMMAND_NOT_CLAIMABLE")
		return
	}
	installation, facts, err := h.read.resolve(ctx, binding)
	if err != nil {
		fail(502, "INVENTORY_SOURCE_NOT_VERIFIED")
		return
	}
	scopes := map[string]bool{}
	for _, scope := range facts.GrantedScopes {
		scopes[scope] = true
	}
	if !scopes["write_inventory"] || !scopes["read_locations"] {
		fail(403, "INVENTORY_CAPABILITY_REQUIRED")
		return
	}
	result, err := h.provider.SetInventoryAvailable(ctx, binding.ShopDomain, installation.AccessToken, request)
	if err != nil || shopifyconnector.ValidateInventorySetResult(request, result) != nil {
		fail(502, "INVENTORY_RECONCILIATION_REQUIRED")
		return
	}
	w.Header().Set(StoreAppReadProviderHeader, "CS_STORE_APP")
	w.Header().Set(StoreAppReadVersionHeader, version)
	w.Header().Set(InventoryPreparationRouteHeader, strconv.FormatInt(route, 10))
	writeJSONResponse(w, 200, result)
}
