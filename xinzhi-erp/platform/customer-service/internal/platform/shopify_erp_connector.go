package platform

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"strings"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

const erpConnectorRequestLimit = 1 << 20

type storeShopifyConnectorBindingResolver struct {
	store Store
}

func (r storeShopifyConnectorBindingResolver) ResolveLegacyShopID(
	ctx context.Context,
	identity shopifyconnector.CanonicalShopIdentity,
) (string, error) {
	if r.store == nil {
		return "", errShopifyConnectorBindingNotFound
	}
	shops, err := r.store.ListShops(ctx)
	if err != nil {
		return "", err
	}
	matchedShopID := ""
	for _, shop := range shops {
		if shop.Metadata["erpTenantId"] != identity.TenantID ||
			strings.TrimSpace(shop.Metadata["erpCanonicalShopId"]) != identity.ShopID {
			continue
		}
		if matchedShopID != "" && matchedShopID != shop.ID {
			return "", errShopifyConnectorBindingNotFound
		}
		matchedShopID = shop.ID
	}
	if matchedShopID != "" {
		return matchedShopID, nil
	}
	return "", errShopifyConnectorBindingNotFound
}

func (s *Server) handleERPConnectorShopifyConnection(w http.ResponseWriter, r *http.Request) {
	if !s.requireERPConnectorToken(w, r) {
		return
	}
	var request shopifyconnector.ConnectionProbeRequest
	if !decodeERPConnectorRequest(w, r, &request) {
		return
	}
	if err := shopifyconnector.ValidateRequest(request); err != nil {
		writeERPConnectorResult(w, request.Context.CorrelationID, shopifyconnector.ConnectionSummary{},
			shopifyconnector.InvalidRequestError(request))
		return
	}
	if r.Header.Get(shopifyConnectorForwardedHeader) != "" {
		log.Printf("Shopify connector connection forward rejected repeated hop correlation=%s", request.Context.CorrelationID)
		writeERPConnectorResult(w, request.Context.CorrelationID, shopifyconnector.ConnectionSummary{},
			shopifyconnector.SafeErrorFor(request, errors.New("repeated Shopify connector forwarding hop")))
		return
	}
	probe, err := newShopifyConnectionHTTPProbeFromEnvironment()
	if err != nil || probe.targetsRequestServer(r) {
		log.Printf("Shopify connector connection forward unavailable correlation=%s", request.Context.CorrelationID)
		writeERPConnectorResult(w, request.Context.CorrelationID, shopifyconnector.ConnectionSummary{},
			shopifyconnector.SafeErrorFor(request, errors.New("independent Shopify connector unavailable")))
		return
	}
	summary, err := probe.ProbeConnection(r.Context(), request)
	if err != nil {
		log.Printf("Shopify connector connection forward failed correlation=%s", request.Context.CorrelationID)
	}
	writeERPConnectorResult(w, request.Context.CorrelationID, summary, err)
}

func (s *Server) handleERPConnectorShopifyProductCatalog(w http.ResponseWriter, r *http.Request) {
	if !s.requireERPConnectorToken(w, r) {
		return
	}
	var request shopifyconnector.ProductCatalogPageRequest
	if !decodeERPConnectorRequest(w, r, &request) {
		return
	}
	if err := shopifyconnector.ValidateProductCatalogPageRequest(request); err != nil {
		writeERPConnectorResult(w, request.Context.CorrelationID, shopifyconnector.ProductCatalogPage{},
			shopifyconnector.InvalidCatalogRequestError(request))
		return
	}
	if r.Header.Get(shopifyConnectorForwardedHeader) != "" {
		log.Printf("Shopify connector product catalog forward rejected repeated hop correlation=%s", request.Context.CorrelationID)
		writeERPConnectorResult(w, request.Context.CorrelationID, shopifyconnector.ProductCatalogPage{},
			shopifyconnector.SafeCatalogErrorFor(request, errors.New("repeated Shopify connector forwarding hop")))
		return
	}
	reader, err := newShopifyProductCatalogHTTPReaderFromEnvironment()
	if err != nil || reader.targetsRequestServer(r) {
		log.Printf("Shopify connector product catalog forward unavailable correlation=%s", request.Context.CorrelationID)
		writeERPConnectorResult(w, request.Context.CorrelationID, shopifyconnector.ProductCatalogPage{},
			shopifyconnector.SafeCatalogErrorFor(request, errors.New("independent Shopify connector unavailable")))
		return
	}
	page, err := reader.FetchProductCatalogPage(r.Context(), request)
	if err != nil {
		log.Printf("Shopify connector product catalog forward failed correlation=%s", request.Context.CorrelationID)
	}
	writeERPConnectorResult(w, request.Context.CorrelationID, page, err)
}

func (s *Server) handleERPConnectorShopifyOrderCatalog(w http.ResponseWriter, r *http.Request) {
	if !s.requireERPConnectorToken(w, r) {
		return
	}
	var request shopifyconnector.OrderCatalogPageRequest
	if !decodeERPConnectorRequest(w, r, &request) {
		return
	}
	if err := shopifyconnector.ValidateOrderCatalogPageRequest(request); err != nil {
		writeERPConnectorResult(w, request.Context.CorrelationID, shopifyconnector.OrderCatalogPage{},
			shopifyconnector.InvalidOrderCatalogRequestError(request))
		return
	}
	if r.Header.Get(shopifyConnectorForwardedHeader) != "" {
		log.Printf("Shopify connector order catalog forward rejected repeated hop correlation=%s", request.Context.CorrelationID)
		writeERPConnectorResult(w, request.Context.CorrelationID, shopifyconnector.OrderCatalogPage{},
			shopifyconnector.SafeOrderCatalogErrorFor(request, errors.New("repeated Shopify connector forwarding hop")))
		return
	}
	reader, err := newShopifyOrderCatalogHTTPReaderFromEnvironment()
	if err != nil || reader.targetsRequestServer(r) {
		log.Printf("Shopify connector order catalog forward unavailable correlation=%s", request.Context.CorrelationID)
		writeERPConnectorResult(w, request.Context.CorrelationID, shopifyconnector.OrderCatalogPage{},
			shopifyconnector.SafeOrderCatalogErrorFor(request, errors.New("independent Shopify connector unavailable")))
		return
	}
	page, err := reader.FetchOrderCatalogPage(r.Context(), request)
	if err != nil {
		log.Printf("Shopify connector order catalog forward failed correlation=%s", request.Context.CorrelationID)
	}
	writeERPConnectorResult(w, request.Context.CorrelationID, page, err)
}

func (s *Server) handleERPConnectorShopifyCustomerCatalog(w http.ResponseWriter, r *http.Request) {
	if !s.requireERPConnectorToken(w, r) {
		return
	}
	var request shopifyconnector.CustomerCatalogPageRequest
	if !decodeERPConnectorRequest(w, r, &request) {
		return
	}
	if err := shopifyconnector.ValidateCustomerCatalogPageRequest(request); err != nil {
		writeERPConnectorResult(w, request.Context.CorrelationID, shopifyconnector.CustomerCatalogPage{},
			shopifyconnector.InvalidCustomerCatalogRequestError(request))
		return
	}
	if r.Header.Get(shopifyConnectorForwardedHeader) != "" {
		log.Printf("Shopify connector customer catalog forward rejected repeated hop correlation=%s", request.Context.CorrelationID)
		writeERPConnectorResult(w, request.Context.CorrelationID, shopifyconnector.CustomerCatalogPage{},
			shopifyconnector.SafeCustomerCatalogErrorFor(request, errors.New("repeated Shopify connector forwarding hop")))
		return
	}
	reader, err := newShopifyCustomerCatalogHTTPReaderFromEnvironment()
	if err != nil || reader.targetsRequestServer(r) {
		log.Printf("Shopify connector customer catalog forward unavailable correlation=%s", request.Context.CorrelationID)
		writeERPConnectorResult(w, request.Context.CorrelationID, shopifyconnector.CustomerCatalogPage{},
			shopifyconnector.SafeCustomerCatalogErrorFor(request, errors.New("independent Shopify connector unavailable")))
		return
	}
	page, err := reader.FetchCustomerCatalogPage(r.Context(), request)
	if err != nil {
		log.Printf("Shopify connector customer catalog forward failed correlation=%s", request.Context.CorrelationID)
	}
	writeERPConnectorResult(w, request.Context.CorrelationID, page, err)
}

func (s *Server) handleERPConnectorShopifyReturnCatalog(w http.ResponseWriter, r *http.Request) {
	if !s.requireERPConnectorToken(w, r) {
		return
	}
	var request shopifyconnector.ReturnCatalogPageRequest
	if !decodeERPConnectorRequest(w, r, &request) {
		return
	}
	if shopifyconnector.ValidateReturnCatalogPageRequest(request) != nil {
		writeERPConnectorResult(w, request.Context.CorrelationID, shopifyconnector.ReturnCatalogPage{}, shopifyconnector.InvalidReturnCatalogRequestError(request))
		return
	}
	if r.Header.Get(shopifyConnectorForwardedHeader) != "" {
		log.Printf("Shopify connector return catalog forward rejected repeated hop correlation=%s", request.Context.CorrelationID)
		writeERPConnectorResult(w, request.Context.CorrelationID, shopifyconnector.ReturnCatalogPage{}, shopifyconnector.SafeReturnCatalogErrorFor(request, errors.New("repeated Shopify connector forwarding hop")))
		return
	}
	reader, err := newShopifyReturnCatalogHTTPReaderFromEnvironment()
	if err != nil || reader.targetsRequestServer(r) {
		log.Printf("Shopify connector return catalog forward unavailable correlation=%s", request.Context.CorrelationID)
		writeERPConnectorResult(w, request.Context.CorrelationID, shopifyconnector.ReturnCatalogPage{}, shopifyconnector.SafeReturnCatalogErrorFor(request, errors.New("independent Shopify connector unavailable")))
		return
	}
	page, err := reader.FetchReturnCatalogPage(r.Context(), request)
	if err != nil {
		log.Printf("Shopify connector return catalog forward failed correlation=%s", request.Context.CorrelationID)
	}
	writeERPConnectorResult(w, request.Context.CorrelationID, page, err)
}

func (s *Server) handleERPConnectorShopifyLocationCatalog(w http.ResponseWriter, r *http.Request) {
	if !s.requireERPConnectorToken(w, r) {
		return
	}
	var request shopifyconnector.LocationCatalogPageRequest
	if !decodeERPConnectorRequest(w, r, &request) {
		return
	}
	if shopifyconnector.ValidateLocationCatalogPageRequest(request) != nil {
		writeERPConnectorResult(w, request.Context.CorrelationID, shopifyconnector.LocationCatalogPage{}, shopifyconnector.InvalidLocationCatalogRequestError(request))
		return
	}
	if r.Header.Get(shopifyConnectorForwardedHeader) != "" {
		log.Printf("Shopify connector location catalog forward rejected repeated hop correlation=%s", request.Context.CorrelationID)
		writeERPConnectorResult(w, request.Context.CorrelationID, shopifyconnector.LocationCatalogPage{}, shopifyconnector.SafeLocationCatalogErrorFor(request, errors.New("repeated Shopify connector forwarding hop")))
		return
	}
	reader, err := newShopifyLocationCatalogHTTPReaderFromEnvironment()
	if err != nil || reader.targetsRequestServer(r) {
		log.Printf("Shopify connector location catalog forward unavailable correlation=%s", request.Context.CorrelationID)
		writeERPConnectorResult(w, request.Context.CorrelationID, shopifyconnector.LocationCatalogPage{}, shopifyconnector.SafeLocationCatalogErrorFor(request, errors.New("independent Shopify connector unavailable")))
		return
	}
	page, err := reader.FetchLocationCatalogPage(r.Context(), request)
	if err != nil {
		log.Printf("Shopify connector location catalog forward failed correlation=%s", request.Context.CorrelationID)
	}
	writeERPConnectorResult(w, request.Context.CorrelationID, page, err)
}

func (s *Server) handleERPConnectorShopifyInventoryLevel(w http.ResponseWriter, r *http.Request) {
	if !s.requireERPConnectorToken(w, r) {
		return
	}
	var request shopifyconnector.InventoryLevelReadRequest
	if !decodeERPConnectorRequest(w, r, &request) {
		return
	}
	if shopifyconnector.ValidateInventoryLevelReadRequest(request) != nil {
		writeERPConnectorResult(w, request.Context.CorrelationID, shopifyconnector.InventoryLevelSnapshot{}, shopifyconnector.InvalidInventoryLevelRequestError(request))
		return
	}
	if r.Header.Get(shopifyConnectorForwardedHeader) != "" {
		log.Printf("Shopify connector inventory level forward rejected repeated hop correlation=%s", request.Context.CorrelationID)
		writeERPConnectorResult(w, request.Context.CorrelationID, shopifyconnector.InventoryLevelSnapshot{}, shopifyconnector.SafeInventoryLevelErrorFor(request, errors.New("repeated Shopify connector forwarding hop")))
		return
	}
	reader, err := newShopifyInventoryLevelHTTPReaderFromEnvironment()
	if err != nil || reader.targetsRequestServer(r) {
		log.Printf("Shopify connector inventory level forward unavailable correlation=%s", request.Context.CorrelationID)
		writeERPConnectorResult(w, request.Context.CorrelationID, shopifyconnector.InventoryLevelSnapshot{}, shopifyconnector.SafeInventoryLevelErrorFor(request, errors.New("independent Shopify connector unavailable")))
		return
	}
	snapshot, err := reader.FetchInventoryLevel(r.Context(), request)
	if err != nil {
		log.Printf("Shopify connector inventory level forward failed correlation=%s", request.Context.CorrelationID)
	}
	writeERPConnectorResult(w, request.Context.CorrelationID, snapshot, err)
}

func (s *Server) handleERPConnectorShopifyInventorySet(w http.ResponseWriter, r *http.Request) {
	if !s.requireERPConnectorToken(w, r) {
		return
	}
	var request shopifyconnector.InventorySetRequest
	if !decodeERPConnectorRequest(w, r, &request) {
		return
	}
	if shopifyconnector.ValidateInventorySetRequest(request) != nil {
		writeERPConnectorResult(w, request.Context.CorrelationID, shopifyconnector.InventorySetResult{}, shopifyconnector.InvalidInventorySetRequestError(request))
		return
	}
	if r.Header.Get(shopifyConnectorForwardedHeader) != "" {
		log.Printf("Shopify connector inventory write forward rejected repeated hop correlation=%s", request.Context.CorrelationID)
		writeERPConnectorResult(w, request.Context.CorrelationID, shopifyconnector.InventorySetResult{}, shopifyconnector.SafeInventorySetErrorFor(request, errors.New("repeated Shopify connector forwarding hop")))
		return
	}
	writer, err := newShopifyInventorySetHTTPWriterFromEnvironment()
	if err != nil || writer.targetsRequestServer(r) {
		log.Printf("Shopify connector inventory write forward unavailable correlation=%s", request.Context.CorrelationID)
		writeERPConnectorResult(w, request.Context.CorrelationID, shopifyconnector.InventorySetResult{}, shopifyconnector.SafeInventorySetErrorFor(request, errors.New("independent Shopify connector unavailable")))
		return
	}
	result, err := writer.SetInventoryAvailable(r.Context(), request)
	if err != nil {
		log.Printf("Shopify connector inventory write forward failed correlation=%s", request.Context.CorrelationID)
	}
	writeERPConnectorResult(w, request.Context.CorrelationID, result, err)
}

func (s *Server) handleERPConnectorShopifyOrderShippingAddress(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !s.requireERPConnectorToken(w, r) {
		return
	}
	var request shopifyconnector.OrderShippingAddressUpdateRequest
	if !decodeERPConnectorRequest(w, r, &request) {
		return
	}
	if shopifyconnector.ValidateOrderShippingAddressUpdateRequest(request) != nil {
		writeERPConnectorResult(w, request.Context.CorrelationID, shopifyconnector.OrderShippingAddressUpdateResult{}, shopifyconnector.InvalidOrderShippingAddressRequestError(request))
		return
	}
	if r.Header.Get(shopifyConnectorForwardedHeader) != "" {
		log.Printf("Shopify connector order address forward rejected repeated hop correlation=%s", request.Context.CorrelationID)
		writeERPConnectorResult(w, request.Context.CorrelationID, shopifyconnector.OrderShippingAddressUpdateResult{}, shopifyconnector.SafeOrderShippingAddressErrorFor(request, errors.New("repeated Shopify connector forwarding hop")))
		return
	}
	writer, err := newShopifyOrderAddressHTTPWriterFromEnvironment()
	if err != nil || writer.targetsRequestServer(r) {
		log.Printf("Shopify connector order address forward unavailable correlation=%s", request.Context.CorrelationID)
		writeERPConnectorResult(w, request.Context.CorrelationID, shopifyconnector.OrderShippingAddressUpdateResult{}, shopifyconnector.SafeOrderShippingAddressErrorFor(request, errors.New("independent Shopify connector unavailable")))
		return
	}
	result, err := writer.UpdateOrderShippingAddress(r.Context(), request)
	if err != nil {
		log.Printf("Shopify connector order address forward failed correlation=%s", request.Context.CorrelationID)
	}
	writeERPConnectorResult(w, request.Context.CorrelationID, result, err)
}

func (s *Server) handleERPConnectorShopifyOAuthStart(w http.ResponseWriter, r *http.Request) {
	if !s.requireERPConnectorToken(w, r) {
		return
	}
	if r.Header.Get(shopifyConnectorForwardedHeader) != "" {
		writeJSONResponse(w, http.StatusBadGateway, map[string]any{
			"code": "ERP_CONNECTOR_UNAVAILABLE", "error": "Repeated Shopify connector forwarding hop", "retryable": true,
		})
		return
	}
	connector, err := newShopifyConnectorHTTPClientFromEnvironment()
	if err != nil || connector.targetsRequestServer(r) {
		writeJSONResponse(w, http.StatusServiceUnavailable, map[string]any{
			"code": "ERP_CONNECTOR_UNAVAILABLE", "error": "Independent Shopify connector is unavailable", "retryable": true,
		})
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, erpConnectorRequestLimit+1))
	if err != nil || len(body) > erpConnectorRequestLimit {
		writeJSONResponse(w, http.StatusBadRequest, map[string]any{
			"code": "ERP_CONNECTOR_INVALID_REQUEST", "error": "Connector request is invalid", "retryable": false,
		})
		return
	}
	endpoint := strings.TrimRight(connector.baseURL.String(), "/") + r.URL.Path
	request, err := http.NewRequestWithContext(r.Context(), http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		writeJSONResponse(w, http.StatusServiceUnavailable, map[string]any{
			"code": "ERP_CONNECTOR_UNAVAILABLE", "error": "Independent Shopify connector is unavailable", "retryable": true,
		})
		return
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	request.Header.Set("X-XZ-ERP-Connector-Token", connector.token)
	request.Header.Set(shopifyConnectorForwardedHeader, "1")
	response, err := connector.client.Do(request)
	if err != nil {
		writeJSONResponse(w, http.StatusServiceUnavailable, map[string]any{
			"code": "ERP_CONNECTOR_UNAVAILABLE", "error": "Independent Shopify connector is unavailable", "retryable": true,
		})
		return
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, shopifyConnectorResponseLimit+1))
	if err != nil || len(raw) > shopifyConnectorResponseLimit {
		writeJSONResponse(w, http.StatusBadGateway, map[string]any{
			"code": "ERP_CONNECTOR_UNAVAILABLE", "error": "Independent Shopify connector response is invalid", "retryable": true,
		})
		return
	}
	if contentType := response.Header.Get("Content-Type"); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	w.WriteHeader(response.StatusCode)
	_, _ = w.Write(raw)
}

func (s *Server) handleERPConnectorShopifyOrderEditQuantity(w http.ResponseWriter, r *http.Request) {
	if !s.requireERPConnectorToken(w, r) {
		return
	}
	var request shopifyconnector.OrderEditQuantityRequest
	if !decodeERPConnectorRequest(w, r, &request) {
		return
	}
	writer := newShopifyOrderEditQuantityAdapter(
		s,
		storeShopifyConnectorBindingResolver{store: s.store},
	)
	result, err := writer.UpdateOrderLineQuantity(r.Context(), request)
	writeERPConnectorResult(w, request.Context.CorrelationID, result, err)
}

func (s *Server) handleERPConnectorShopifyOrderAddVariant(w http.ResponseWriter, r *http.Request) {
	if !s.requireERPConnectorToken(w, r) {
		return
	}
	var request shopifyconnector.OrderAddVariantRequest
	if !decodeERPConnectorRequest(w, r, &request) {
		return
	}
	writer := newShopifyOrderAddVariantAdapter(
		s,
		storeShopifyConnectorBindingResolver{store: s.store},
	)
	result, err := writer.AddOrderVariant(r.Context(), request)
	writeERPConnectorResult(w, request.Context.CorrelationID, result, err)
}

func (s *Server) handleERPConnectorShopifyOrderAddCustomItem(w http.ResponseWriter, r *http.Request) {
	if !s.requireERPConnectorToken(w, r) {
		return
	}
	var request shopifyconnector.OrderAddCustomItemRequest
	if !decodeERPConnectorRequest(w, r, &request) {
		return
	}
	writer := newShopifyOrderAddCustomItemAdapter(
		s,
		storeShopifyConnectorBindingResolver{store: s.store},
	)
	result, err := writer.AddOrderCustomItem(r.Context(), request)
	writeERPConnectorResult(w, request.Context.CorrelationID, result, err)
}

func (s *Server) handleERPConnectorShopifyOrderLineDiscount(w http.ResponseWriter, r *http.Request) {
	if !s.requireERPConnectorToken(w, r) {
		return
	}
	var request shopifyconnector.OrderLineDiscountRequest
	if !decodeERPConnectorRequest(w, r, &request) {
		return
	}
	writer := newShopifyOrderLineDiscountAdapter(
		s,
		storeShopifyConnectorBindingResolver{store: s.store},
	)
	result, err := writer.AddOrderLineDiscount(r.Context(), request)
	writeERPConnectorResult(w, request.Context.CorrelationID, result, err)
}

func (s *Server) handleERPConnectorShopifyOrderCancellation(w http.ResponseWriter, r *http.Request) {
	if !s.requireERPConnectorToken(w, r) {
		return
	}
	var request shopifyconnector.OrderCancellationRequest
	if !decodeERPConnectorRequest(w, r, &request) {
		return
	}
	writer := newShopifyOrderCancellationAdapter(
		s, storeShopifyConnectorBindingResolver{store: s.store})
	result, err := writer.CancelOrder(r.Context(), request)
	writeERPConnectorResult(w, request.Context.CorrelationID, result, err)
}

func (s *Server) handleERPConnectorShopifyFulfillmentPublish(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !s.requireERPConnectorToken(w, r) {
		return
	}
	var request shopifyconnector.FulfillmentPublishRequest
	if !decodeERPConnectorRequest(w, r, &request) {
		return
	}
	if shopifyconnector.ValidateFulfillmentPublishRequest(request) != nil {
		writeERPConnectorResult(w, request.Context.CorrelationID, shopifyconnector.FulfillmentPublishResult{}, shopifyconnector.InvalidFulfillmentPublishRequestError(request))
		return
	}
	if r.Header.Get(shopifyConnectorForwardedHeader) != "" {
		log.Printf("Shopify connector fulfillment forward rejected repeated hop correlation=%s", request.Context.CorrelationID)
		writeERPConnectorResult(w, request.Context.CorrelationID, shopifyconnector.FulfillmentPublishResult{}, shopifyconnector.SafeFulfillmentPublishErrorFor(request, errors.New("repeated Shopify connector forwarding hop")))
		return
	}
	publisher, err := newShopifyFulfillmentHTTPPublisherFromEnvironment()
	if err != nil || publisher.targetsRequestServer(r) {
		log.Printf("Shopify connector fulfillment forward unavailable correlation=%s", request.Context.CorrelationID)
		writeERPConnectorResult(w, request.Context.CorrelationID, shopifyconnector.FulfillmentPublishResult{}, shopifyconnector.SafeFulfillmentPublishErrorFor(request, errors.New("independent Shopify connector unavailable")))
		return
	}
	result, err := publisher.PublishFulfillment(r.Context(), request)
	if err != nil {
		log.Printf("Shopify connector fulfillment forward failed correlation=%s", request.Context.CorrelationID)
	}
	writeERPConnectorResult(w, request.Context.CorrelationID, result, err)
}

func (s *Server) handleERPConnectorShopifyDisputeCatalog(w http.ResponseWriter, r *http.Request) {
	if !s.requireERPConnectorToken(w, r) {
		return
	}
	var request shopifyconnector.DisputeCatalogPageRequest
	if !decodeERPConnectorRequest(w, r, &request) {
		return
	}
	if shopifyconnector.ValidateDisputeCatalogPageRequest(request) != nil {
		writeERPConnectorResult(w, request.Context.CorrelationID, shopifyconnector.DisputeCatalogPage{}, shopifyconnector.InvalidDisputeCatalogRequestError(request))
		return
	}
	if r.Header.Get(shopifyConnectorForwardedHeader) != "" {
		log.Printf("Shopify connector dispute catalog forward rejected repeated hop correlation=%s", request.Context.CorrelationID)
		writeERPConnectorResult(w, request.Context.CorrelationID, shopifyconnector.DisputeCatalogPage{}, shopifyconnector.SafeDisputeCatalogErrorFor(request, errors.New("repeated Shopify connector forwarding hop")))
		return
	}
	reader, err := newShopifyDisputeCatalogHTTPReaderFromEnvironment()
	if err != nil || reader.targetsRequestServer(r) {
		log.Printf("Shopify connector dispute catalog forward unavailable correlation=%s", request.Context.CorrelationID)
		writeERPConnectorResult(w, request.Context.CorrelationID, shopifyconnector.DisputeCatalogPage{}, shopifyconnector.SafeDisputeCatalogErrorFor(request, errors.New("independent Shopify connector unavailable")))
		return
	}
	page, err := reader.FetchDisputeCatalogPage(r.Context(), request)
	if err != nil {
		log.Printf("Shopify connector dispute catalog forward failed correlation=%s", request.Context.CorrelationID)
	}
	writeERPConnectorResult(w, request.Context.CorrelationID, page, err)
}

func (s *Server) requireERPConnectorToken(w http.ResponseWriter, r *http.Request) bool {
	expected := erpConnectorServiceToken()
	if expected == "" {
		writeJSONResponse(w, http.StatusServiceUnavailable, map[string]any{
			"code":      "ERP_CONNECTOR_NOT_CONFIGURED",
			"error":     "XZ ERP connector token is not configured",
			"retryable": false,
		})
		return false
	}
	provided := strings.TrimSpace(r.Header.Get("X-XZ-ERP-Connector-Token"))
	if provided == "" {
		provided = bearerToken(r)
	}
	if provided == "" || subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) != 1 {
		writeJSONResponse(w, http.StatusForbidden, map[string]any{
			"code":      "ERP_CONNECTOR_FORBIDDEN",
			"error":     "XZ ERP connector token is invalid",
			"retryable": false,
		})
		return false
	}
	return true
}

func erpConnectorServiceToken() string {
	expected := strings.TrimSpace(os.Getenv("XZ_ERP_CONNECTOR_TOKEN"))
	if expected == "" {
		expected = strings.TrimSpace(os.Getenv("ERP_XZ_ERP_APP_CONNECTOR_TOKEN"))
	}
	return expected
}

func decodeERPConnectorRequest(w http.ResponseWriter, r *http.Request, target any) bool {
	defer r.Body.Close()
	body, err := io.ReadAll(io.LimitReader(r.Body, erpConnectorRequestLimit+1))
	if err != nil || len(body) > erpConnectorRequestLimit {
		writeJSONResponse(w, http.StatusBadRequest, map[string]any{
			"code":      "ERP_CONNECTOR_INVALID_REQUEST",
			"error":     "Connector request is invalid",
			"retryable": false,
		})
		return false
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	var trailing any
	if err := decoder.Decode(target); err != nil || decoder.Decode(&trailing) != io.EOF {
		writeJSONResponse(w, http.StatusBadRequest, map[string]any{
			"code":      "ERP_CONNECTOR_INVALID_REQUEST",
			"error":     "Connector request is invalid",
			"retryable": false,
		})
		return false
	}
	return true
}

func writeERPConnectorResult(w http.ResponseWriter, correlationID string, payload any, err error) {
	if err == nil {
		writeJSONResponse(w, http.StatusOK, payload)
		return
	}
	var safeErr *shopifyconnector.ConnectionProbeError
	if !errors.As(err, &safeErr) {
		safeErr = &shopifyconnector.ConnectionProbeError{
			Code:          shopifyconnector.ErrorCodeUnavailable,
			Message:       "Shopify connector is temporarily unavailable",
			Retryable:     true,
			CorrelationID: correlationID,
		}
	}
	status := http.StatusBadGateway
	switch safeErr.Code {
	case shopifyconnector.ErrorCodeInvalidRequest:
		status = http.StatusBadRequest
	case shopifyconnector.ErrorCodeCanceled:
		status = http.StatusRequestTimeout
	case shopifyconnector.ErrorCodeTimeout:
		status = http.StatusGatewayTimeout
	case shopifyconnector.ErrorCodeForbidden:
		status = http.StatusForbidden
	case shopifyconnector.ErrorCodeProtectedCustomerDataRequired:
		status = http.StatusForbidden
	}
	writeJSONResponse(w, status, safeErr)
}

var _ shopifyConnectorBindingResolver = storeShopifyConnectorBindingResolver{}
