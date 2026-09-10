package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

const (
	shopifyConnectorConnectionPath      = "/api/v1/erp-connector/shopify/connection"
	shopifyConnectorProductCatalogPath  = "/api/v1/erp-connector/shopify/product-catalog"
	shopifyConnectorOrderCatalogPath    = "/api/v1/erp-connector/shopify/order-catalog"
	shopifyConnectorCustomerCatalogPath = "/api/v1/erp-connector/shopify/customer-catalog"
	shopifyConnectorReturnCatalogPath   = "/api/v1/erp-connector/shopify/return-catalog"
	shopifyConnectorLocationCatalogPath = "/api/v1/erp-connector/shopify/location-catalog"
	shopifyConnectorInventoryLevelPath  = "/api/v1/erp-connector/shopify/inventory-level"
	shopifyConnectorInventorySetPath    = "/api/v1/erp-connector/shopify/inventory-set"
	shopifyConnectorOrderAddressPath    = "/api/v1/erp-connector/shopify/order-shipping-address"
	shopifyConnectorDisputeCatalogPath  = "/api/v1/erp-connector/shopify/dispute-catalog"
	shopifyConnectorFulfillmentPath     = "/api/v1/erp-connector/shopify/fulfillment-publish"
	shopifyConnectorInternalBaseURL     = "XZ_SHOPIFY_CONNECTOR_INTERNAL_BASE_URL"
	shopifyConnectorForwardedHeader     = "X-XZ-Shopify-Connector-Forwarded"
	shopifyConnectorResponseLimit       = 1 << 20
)

type shopifyConnectorHTTPClient struct {
	baseURL *url.URL
	token   string
	client  *http.Client
}

type shopifyConnectionHTTPProbe struct {
	connector *shopifyConnectorHTTPClient
}

type shopifyProductCatalogHTTPReader struct {
	connector *shopifyConnectorHTTPClient
}

type shopifyOrderCatalogHTTPReader struct {
	connector *shopifyConnectorHTTPClient
}
type shopifyCustomerCatalogHTTPReader struct{ connector *shopifyConnectorHTTPClient }
type shopifyReturnCatalogHTTPReader struct{ connector *shopifyConnectorHTTPClient }
type shopifyLocationCatalogHTTPReader struct{ connector *shopifyConnectorHTTPClient }
type shopifyInventoryLevelHTTPReader struct{ connector *shopifyConnectorHTTPClient }
type shopifyInventorySetHTTPWriter struct{ connector *shopifyConnectorHTTPClient }
type shopifyOrderAddressHTTPWriter struct{ connector *shopifyConnectorHTTPClient }
type shopifyDisputeCatalogHTTPReader struct{ connector *shopifyConnectorHTTPClient }
type shopifyFulfillmentHTTPPublisher struct{ connector *shopifyConnectorHTTPClient }

type shopifyConnectionHTTPResponse struct {
	ContractVersion string                           `json:"contractVersion"`
	TenantID        string                           `json:"tenantId"`
	ShopID          string                           `json:"shopId"`
	State           shopifyconnector.ConnectionState `json:"state"`
	GrantedScopes   *[]string                        `json:"grantedScopes"`
	ShopName        string                           `json:"shopName,omitempty"`
	ShopDomain      string                           `json:"shopDomain,omitempty"`
	CheckedAt       *time.Time                       `json:"checkedAt"`
}

type shopifyProductCatalogHTTPResponse struct {
	ContractVersion string                               `json:"contractVersion"`
	TenantID        string                               `json:"tenantId"`
	ShopID          string                               `json:"shopId"`
	State           shopifyconnector.ProductCatalogState `json:"state"`
	Products        *[]shopifyconnector.CatalogProduct   `json:"products"`
	PageInfo        *shopifyconnector.CatalogPageInfo    `json:"pageInfo"`
	FetchedAt       *time.Time                           `json:"fetchedAt"`
}

type shopifyOrderCatalogHTTPResponse struct {
	ContractVersion string                             `json:"contractVersion"`
	TenantID        string                             `json:"tenantId"`
	ShopID          string                             `json:"shopId"`
	State           shopifyconnector.OrderCatalogState `json:"state"`
	Orders          *[]shopifyconnector.CatalogOrder   `json:"orders"`
	PageInfo        *shopifyconnector.CatalogPageInfo  `json:"pageInfo"`
	FetchedAt       *time.Time                         `json:"fetchedAt"`
}
type shopifyCustomerCatalogHTTPResponse struct {
	ContractVersion string                              `json:"contractVersion"`
	TenantID        string                              `json:"tenantId"`
	ShopID          string                              `json:"shopId"`
	State           shopifyconnector.OrderCatalogState  `json:"state"`
	Customers       *[]shopifyconnector.CatalogCustomer `json:"customers"`
	PageInfo        *shopifyconnector.CatalogPageInfo   `json:"pageInfo"`
	FetchedAt       *time.Time                          `json:"fetchedAt"`
}
type shopifyReturnCatalogHTTPResponse struct {
	ContractVersion string                                `json:"contractVersion"`
	TenantID        string                                `json:"tenantId"`
	ShopID          string                                `json:"shopId"`
	State           shopifyconnector.OrderCatalogState    `json:"state"`
	Returns         *[]shopifyconnector.CatalogReturn     `json:"returns"`
	PageInfo        *shopifyConnectorPageInfoHTTPResponse `json:"pageInfo"`
	FetchedAt       *time.Time                            `json:"fetchedAt"`
}
type shopifyLocationCatalogHTTPResponse struct {
	ContractVersion string                                `json:"contractVersion"`
	TenantID        string                                `json:"tenantId"`
	ShopID          string                                `json:"shopId"`
	State           shopifyconnector.LocationCatalogState `json:"state"`
	Locations       *[]shopifyconnector.CatalogLocation   `json:"locations"`
	PageInfo        *shopifyConnectorPageInfoHTTPResponse `json:"pageInfo"`
	FetchedAt       *time.Time                            `json:"fetchedAt"`
}
type shopifyInventoryLevelHTTPResponse struct {
	ContractVersion   string                               `json:"contractVersion"`
	TenantID          string                               `json:"tenantId"`
	ShopID            string                               `json:"shopId"`
	State             shopifyconnector.InventoryLevelState `json:"state"`
	InventoryItemID   string                               `json:"inventoryItemId"`
	LocationID        string                               `json:"locationId"`
	Tracked           *bool                                `json:"tracked"`
	Active            *bool                                `json:"active"`
	AvailableQuantity *int                                 `json:"availableQuantity"`
	OnHandQuantity    *int                                 `json:"onHandQuantity"`
	FetchedAt         *time.Time                           `json:"fetchedAt"`
}
type shopifyDisputeCatalogHTTPResponse struct {
	ContractVersion string                                `json:"contractVersion"`
	TenantID        string                                `json:"tenantId"`
	ShopID          string                                `json:"shopId"`
	State           shopifyconnector.OrderCatalogState    `json:"state"`
	Disputes        *[]shopifyconnector.Dispute           `json:"disputes"`
	PageInfo        *shopifyConnectorPageInfoHTTPResponse `json:"pageInfo"`
	FetchedAt       *time.Time                            `json:"fetchedAt"`
}
type shopifyInventorySetHTTPResponse struct {
	ContractVersion   string                               `json:"contractVersion"`
	TenantID          string                               `json:"tenantId"`
	ShopID            string                               `json:"shopId"`
	Outcome           shopifyconnector.InventorySetOutcome `json:"outcome"`
	InventoryItemID   string                               `json:"inventoryItemId"`
	LocationID        string                               `json:"locationId"`
	ExpectedAvailable *int                                 `json:"expectedAvailable"`
	TargetAvailable   *int                                 `json:"targetAvailable"`
	SafeErrorCode     string                               `json:"safeErrorCode"`
	UpdatedAt         *time.Time                           `json:"updatedAt"`
}
type shopifyFulfillmentHTTPResponse struct {
	ContractVersion      string                                `json:"contractVersion"`
	TenantID             string                                `json:"tenantId"`
	ShopID               string                                `json:"shopId"`
	OrderID              string                                `json:"orderId"`
	FulfillmentIDs       *[]string                             `json:"fulfillmentIds"`
	Tracking             *shopifyconnector.CatalogTrackingInfo `json:"tracking"`
	RecoveredFromShopify *bool                                 `json:"recoveredFromShopify"`
	UpdatedAt            *time.Time                            `json:"updatedAt"`
}

type shopifyOrderAddressHTTPResponse struct {
	ContractVersion string                                  `json:"contractVersion"`
	TenantID        string                                  `json:"tenantId"`
	ShopID          string                                  `json:"shopId"`
	OrderID         string                                  `json:"orderId"`
	Address         *shopifyconnector.CatalogMailingAddress `json:"address"`
	UpdatedAt       *time.Time                              `json:"updatedAt"`
}

type shopifyConnectorPageInfoHTTPResponse struct {
	HasNextPage *bool  `json:"hasNextPage"`
	EndCursor   string `json:"endCursor"`
}

func newShopifyConnectorHTTPClient(rawBaseURL, serviceToken string, client *http.Client) (*shopifyConnectorHTTPClient, error) {
	baseURL, err := validateShopifyConnectorInternalBaseURL(rawBaseURL)
	serviceToken = strings.TrimSpace(serviceToken)
	if err != nil || serviceToken == "" || client == nil {
		return nil, errors.New("independent Shopify connector is not configured")
	}
	clientCopy := *client
	if clientCopy.Timeout <= 0 || clientCopy.Timeout > 60*time.Second {
		clientCopy.Timeout = 10 * time.Second
	}
	clientCopy.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &shopifyConnectorHTTPClient{baseURL: baseURL, token: serviceToken, client: &clientCopy}, nil
}

func newShopifyConnectorHTTPClientFromEnvironment() (*shopifyConnectorHTTPClient, error) {
	return newShopifyConnectorHTTPClient(
		os.Getenv(shopifyConnectorInternalBaseURL),
		erpConnectorServiceToken(),
		&http.Client{Timeout: 10 * time.Second},
	)
}

func newShopifyConnectionHTTPProbe(rawBaseURL, serviceToken string, client *http.Client) (*shopifyConnectionHTTPProbe, error) {
	connector, err := newShopifyConnectorHTTPClient(rawBaseURL, serviceToken, client)
	if err != nil {
		return nil, err
	}
	return &shopifyConnectionHTTPProbe{connector: connector}, nil
}

func newShopifyConnectionHTTPProbeFromEnvironment() (*shopifyConnectionHTTPProbe, error) {
	connector, err := newShopifyConnectorHTTPClientFromEnvironment()
	if err != nil {
		return nil, err
	}
	return &shopifyConnectionHTTPProbe{connector: connector}, nil
}

func newShopifyProductCatalogHTTPReaderFromEnvironment() (*shopifyProductCatalogHTTPReader, error) {
	return newShopifyProductCatalogHTTPReader(
		os.Getenv(shopifyConnectorInternalBaseURL),
		erpConnectorServiceToken(),
		&http.Client{Timeout: 10 * time.Second},
	)
}

func newShopifyProductCatalogHTTPReader(rawBaseURL, serviceToken string, client *http.Client) (*shopifyProductCatalogHTTPReader, error) {
	connector, err := newShopifyConnectorHTTPClient(rawBaseURL, serviceToken, client)
	if err != nil {
		return nil, err
	}
	return &shopifyProductCatalogHTTPReader{connector: connector}, nil
}

func newShopifyOrderCatalogHTTPReaderFromEnvironment() (*shopifyOrderCatalogHTTPReader, error) {
	connector, err := newShopifyConnectorHTTPClientFromEnvironment()
	if err != nil {
		return nil, err
	}
	return &shopifyOrderCatalogHTTPReader{connector: connector}, nil
}

func newShopifyOrderCatalogHTTPReader(rawBaseURL, serviceToken string, client *http.Client) (*shopifyOrderCatalogHTTPReader, error) {
	connector, err := newShopifyConnectorHTTPClient(rawBaseURL, serviceToken, client)
	if err != nil {
		return nil, err
	}
	return &shopifyOrderCatalogHTTPReader{connector: connector}, nil
}

func newShopifyCustomerCatalogHTTPReaderFromEnvironment() (*shopifyCustomerCatalogHTTPReader, error) {
	connector, err := newShopifyConnectorHTTPClientFromEnvironment()
	if err != nil {
		return nil, err
	}
	return &shopifyCustomerCatalogHTTPReader{connector: connector}, nil
}

func newShopifyReturnCatalogHTTPReaderFromEnvironment() (*shopifyReturnCatalogHTTPReader, error) {
	connector, err := newShopifyConnectorHTTPClientFromEnvironment()
	if err != nil {
		return nil, err
	}
	return &shopifyReturnCatalogHTTPReader{connector: connector}, nil
}
func newShopifyLocationCatalogHTTPReaderFromEnvironment() (*shopifyLocationCatalogHTTPReader, error) {
	connector, err := newShopifyConnectorHTTPClientFromEnvironment()
	if err != nil {
		return nil, err
	}
	return &shopifyLocationCatalogHTTPReader{connector: connector}, nil
}
func newShopifyInventoryLevelHTTPReaderFromEnvironment() (*shopifyInventoryLevelHTTPReader, error) {
	connector, err := newShopifyConnectorHTTPClientFromEnvironment()
	if err != nil {
		return nil, err
	}
	return &shopifyInventoryLevelHTTPReader{connector: connector}, nil
}
func newShopifyInventorySetHTTPWriterFromEnvironment() (*shopifyInventorySetHTTPWriter, error) {
	connector, err := newShopifyConnectorHTTPClientFromEnvironment()
	if err != nil {
		return nil, err
	}
	return &shopifyInventorySetHTTPWriter{connector: connector}, nil
}

func newShopifyOrderAddressHTTPWriterFromEnvironment() (*shopifyOrderAddressHTTPWriter, error) {
	connector, err := newShopifyConnectorHTTPClientFromEnvironment()
	if err != nil {
		return nil, err
	}
	return &shopifyOrderAddressHTTPWriter{connector: connector}, nil
}
func newShopifyDisputeCatalogHTTPReaderFromEnvironment() (*shopifyDisputeCatalogHTTPReader, error) {
	connector, err := newShopifyConnectorHTTPClientFromEnvironment()
	if err != nil {
		return nil, err
	}
	return &shopifyDisputeCatalogHTTPReader{connector: connector}, nil
}
func newShopifyFulfillmentHTTPPublisherFromEnvironment() (*shopifyFulfillmentHTTPPublisher, error) {
	connector, err := newShopifyConnectorHTTPClientFromEnvironment()
	if err != nil {
		return nil, err
	}
	return &shopifyFulfillmentHTTPPublisher{connector: connector}, nil
}

func (p *shopifyConnectionHTTPProbe) ProbeConnection(ctx context.Context, request shopifyconnector.ConnectionProbeRequest) (shopifyconnector.ConnectionSummary, error) {
	if err := shopifyconnector.ValidateRequest(request); err != nil {
		return shopifyconnector.ConnectionSummary{}, shopifyconnector.InvalidRequestError(request)
	}
	if err := ctx.Err(); err != nil {
		return shopifyconnector.ConnectionSummary{}, shopifyconnector.SafeErrorFor(request, err)
	}
	var wire shopifyConnectionHTTPResponse
	if err := p.connector.postJSON(ctx, shopifyConnectorConnectionPath, request.Context.CorrelationID, request, &wire); err != nil {
		return shopifyconnector.ConnectionSummary{}, shopifyconnector.SafeErrorFor(request, err)
	}
	if wire.GrantedScopes == nil || wire.CheckedAt == nil {
		return shopifyconnector.ConnectionSummary{}, shopifyconnector.SafeErrorFor(request, errors.New("independent Shopify connector response is invalid"))
	}
	summary := shopifyconnector.ConnectionSummary{
		ContractVersion: wire.ContractVersion,
		TenantID:        wire.TenantID,
		ShopID:          wire.ShopID,
		State:           wire.State,
		GrantedScopes:   *wire.GrantedScopes,
		ShopName:        wire.ShopName,
		ShopDomain:      wire.ShopDomain,
		CheckedAt:       *wire.CheckedAt,
	}
	if shopifyconnector.ValidateConnectionSummary(request, summary) != nil {
		return shopifyconnector.ConnectionSummary{}, shopifyconnector.SafeErrorFor(request, errors.New("independent Shopify connector response is invalid"))
	}
	return summary, nil
}

func (p *shopifyProductCatalogHTTPReader) FetchProductCatalogPage(
	ctx context.Context,
	request shopifyconnector.ProductCatalogPageRequest,
) (shopifyconnector.ProductCatalogPage, error) {
	if err := shopifyconnector.ValidateProductCatalogPageRequest(request); err != nil {
		return shopifyconnector.ProductCatalogPage{}, shopifyconnector.InvalidCatalogRequestError(request)
	}
	if err := ctx.Err(); err != nil {
		return shopifyconnector.ProductCatalogPage{}, shopifyconnector.SafeCatalogErrorFor(request, err)
	}
	var wire shopifyProductCatalogHTTPResponse
	if err := p.connector.postJSON(ctx, shopifyConnectorProductCatalogPath, request.Context.CorrelationID, request, &wire); err != nil {
		return shopifyconnector.ProductCatalogPage{}, shopifyconnector.SafeCatalogErrorFor(request, err)
	}
	if wire.Products == nil || wire.PageInfo == nil {
		return shopifyconnector.ProductCatalogPage{}, shopifyconnector.SafeCatalogErrorFor(request, errors.New("independent Shopify connector response is invalid"))
	}
	page := shopifyconnector.ProductCatalogPage{
		ContractVersion: wire.ContractVersion,
		TenantID:        wire.TenantID,
		ShopID:          wire.ShopID,
		State:           wire.State,
		Products:        *wire.Products,
		PageInfo:        *wire.PageInfo,
		FetchedAt:       wire.FetchedAt,
	}
	if shopifyconnector.ValidateProductCatalogPage(request, page) != nil {
		return shopifyconnector.ProductCatalogPage{}, shopifyconnector.SafeCatalogErrorFor(request, errors.New("independent Shopify connector response is invalid"))
	}
	return page, nil
}

func (p *shopifyOrderCatalogHTTPReader) FetchOrderCatalogPage(
	ctx context.Context,
	request shopifyconnector.OrderCatalogPageRequest,
) (shopifyconnector.OrderCatalogPage, error) {
	if err := shopifyconnector.ValidateOrderCatalogPageRequest(request); err != nil {
		return shopifyconnector.OrderCatalogPage{}, shopifyconnector.InvalidOrderCatalogRequestError(request)
	}
	if err := ctx.Err(); err != nil {
		return shopifyconnector.OrderCatalogPage{}, shopifyconnector.SafeOrderCatalogErrorFor(request, err)
	}
	var wire shopifyOrderCatalogHTTPResponse
	if err := p.connector.postJSON(ctx, shopifyConnectorOrderCatalogPath, request.Context.CorrelationID, request, &wire); err != nil {
		return shopifyconnector.OrderCatalogPage{}, shopifyconnector.SafeOrderCatalogErrorFor(request, err)
	}
	if wire.Orders == nil || wire.PageInfo == nil {
		return shopifyconnector.OrderCatalogPage{}, shopifyconnector.SafeOrderCatalogErrorFor(request, errors.New("independent Shopify connector response is invalid"))
	}
	page := shopifyconnector.OrderCatalogPage{
		ContractVersion: wire.ContractVersion,
		TenantID:        wire.TenantID,
		ShopID:          wire.ShopID,
		State:           wire.State,
		Orders:          *wire.Orders,
		PageInfo:        *wire.PageInfo,
		FetchedAt:       wire.FetchedAt,
	}
	if shopifyconnector.ValidateOrderCatalogPage(request, page) != nil {
		return shopifyconnector.OrderCatalogPage{}, shopifyconnector.SafeOrderCatalogErrorFor(request, errors.New("independent Shopify connector response is invalid"))
	}
	return page, nil
}

func (p *shopifyCustomerCatalogHTTPReader) FetchCustomerCatalogPage(
	ctx context.Context,
	request shopifyconnector.CustomerCatalogPageRequest,
) (shopifyconnector.CustomerCatalogPage, error) {
	if err := shopifyconnector.ValidateCustomerCatalogPageRequest(request); err != nil {
		return shopifyconnector.CustomerCatalogPage{}, shopifyconnector.InvalidCustomerCatalogRequestError(request)
	}
	if err := ctx.Err(); err != nil {
		return shopifyconnector.CustomerCatalogPage{}, shopifyconnector.SafeCustomerCatalogErrorFor(request, err)
	}
	var wire shopifyCustomerCatalogHTTPResponse
	if err := p.connector.postJSON(ctx, shopifyConnectorCustomerCatalogPath, request.Context.CorrelationID, request, &wire); err != nil {
		return shopifyconnector.CustomerCatalogPage{}, shopifyconnector.SafeCustomerCatalogErrorFor(request, err)
	}
	if wire.Customers == nil || wire.PageInfo == nil {
		return shopifyconnector.CustomerCatalogPage{}, shopifyconnector.SafeCustomerCatalogErrorFor(request, errors.New("independent Shopify connector response is invalid"))
	}
	page := shopifyconnector.CustomerCatalogPage{
		ContractVersion: wire.ContractVersion, TenantID: wire.TenantID, ShopID: wire.ShopID,
		State: wire.State, Customers: *wire.Customers, PageInfo: *wire.PageInfo, FetchedAt: wire.FetchedAt,
	}
	if shopifyconnector.ValidateCustomerCatalogPage(request, page) != nil {
		return shopifyconnector.CustomerCatalogPage{}, shopifyconnector.SafeCustomerCatalogErrorFor(request, errors.New("independent Shopify connector response is invalid"))
	}
	return page, nil
}

func (p *shopifyReturnCatalogHTTPReader) FetchReturnCatalogPage(ctx context.Context, request shopifyconnector.ReturnCatalogPageRequest) (shopifyconnector.ReturnCatalogPage, error) {
	if shopifyconnector.ValidateReturnCatalogPageRequest(request) != nil {
		return shopifyconnector.ReturnCatalogPage{}, shopifyconnector.InvalidReturnCatalogRequestError(request)
	}
	var wire shopifyReturnCatalogHTTPResponse
	if err := p.connector.postJSON(ctx, shopifyConnectorReturnCatalogPath, request.Context.CorrelationID, request, &wire); err != nil {
		return shopifyconnector.ReturnCatalogPage{}, shopifyconnector.SafeReturnCatalogErrorFor(request, err)
	}
	if wire.Returns == nil || wire.PageInfo == nil || wire.PageInfo.HasNextPage == nil {
		return shopifyconnector.ReturnCatalogPage{}, shopifyconnector.SafeReturnCatalogErrorFor(request, errors.New("independent Shopify connector response is invalid"))
	}
	page := shopifyconnector.ReturnCatalogPage{ContractVersion: wire.ContractVersion, TenantID: wire.TenantID, ShopID: wire.ShopID, State: wire.State, Returns: *wire.Returns, PageInfo: shopifyconnector.CatalogPageInfo{HasNextPage: *wire.PageInfo.HasNextPage, EndCursor: wire.PageInfo.EndCursor}, FetchedAt: wire.FetchedAt}
	if shopifyconnector.ValidateReturnCatalogPage(request, page) != nil {
		return shopifyconnector.ReturnCatalogPage{}, shopifyconnector.SafeReturnCatalogErrorFor(request, errors.New("independent Shopify connector response is invalid"))
	}
	return page, nil
}

func (p *shopifyLocationCatalogHTTPReader) FetchLocationCatalogPage(ctx context.Context, request shopifyconnector.LocationCatalogPageRequest) (shopifyconnector.LocationCatalogPage, error) {
	if shopifyconnector.ValidateLocationCatalogPageRequest(request) != nil {
		return shopifyconnector.LocationCatalogPage{}, shopifyconnector.InvalidLocationCatalogRequestError(request)
	}
	var wire shopifyLocationCatalogHTTPResponse
	if err := p.connector.postJSON(ctx, shopifyConnectorLocationCatalogPath, request.Context.CorrelationID, request, &wire); err != nil {
		return shopifyconnector.LocationCatalogPage{}, shopifyconnector.SafeLocationCatalogErrorFor(request, err)
	}
	if wire.Locations == nil || wire.PageInfo == nil || wire.PageInfo.HasNextPage == nil {
		return shopifyconnector.LocationCatalogPage{}, shopifyconnector.SafeLocationCatalogErrorFor(request, errors.New("independent Shopify connector response is invalid"))
	}
	page := shopifyconnector.LocationCatalogPage{ContractVersion: wire.ContractVersion, TenantID: wire.TenantID, ShopID: wire.ShopID, State: wire.State, Locations: *wire.Locations, PageInfo: shopifyconnector.CatalogPageInfo{HasNextPage: *wire.PageInfo.HasNextPage, EndCursor: wire.PageInfo.EndCursor}, FetchedAt: wire.FetchedAt}
	if shopifyconnector.ValidateLocationCatalogPage(request, page) != nil {
		return shopifyconnector.LocationCatalogPage{}, shopifyconnector.SafeLocationCatalogErrorFor(request, errors.New("independent Shopify connector response is invalid"))
	}
	return page, nil
}

func (p *shopifyInventoryLevelHTTPReader) FetchInventoryLevel(ctx context.Context, request shopifyconnector.InventoryLevelReadRequest) (shopifyconnector.InventoryLevelSnapshot, error) {
	if shopifyconnector.ValidateInventoryLevelReadRequest(request) != nil {
		return shopifyconnector.InventoryLevelSnapshot{}, shopifyconnector.InvalidInventoryLevelRequestError(request)
	}
	var wire shopifyInventoryLevelHTTPResponse
	if err := p.connector.postJSON(ctx, shopifyConnectorInventoryLevelPath, request.Context.CorrelationID, request, &wire); err != nil {
		return shopifyconnector.InventoryLevelSnapshot{}, shopifyconnector.SafeInventoryLevelErrorFor(request, err)
	}
	if wire.Tracked == nil || wire.Active == nil || wire.AvailableQuantity == nil {
		return shopifyconnector.InventoryLevelSnapshot{}, shopifyconnector.SafeInventoryLevelErrorFor(request, errors.New("independent Shopify connector response is invalid"))
	}
	snapshot := shopifyconnector.InventoryLevelSnapshot{ContractVersion: wire.ContractVersion, TenantID: wire.TenantID, ShopID: wire.ShopID, State: wire.State, InventoryItemID: wire.InventoryItemID, LocationID: wire.LocationID, Tracked: *wire.Tracked, Active: *wire.Active, AvailableQuantity: *wire.AvailableQuantity, OnHandQuantity: wire.OnHandQuantity, FetchedAt: wire.FetchedAt}
	if shopifyconnector.ValidateInventoryLevelSnapshot(request, snapshot) != nil {
		return shopifyconnector.InventoryLevelSnapshot{}, shopifyconnector.SafeInventoryLevelErrorFor(request, errors.New("independent Shopify connector response is invalid"))
	}
	return snapshot, nil
}

func (p *shopifyDisputeCatalogHTTPReader) FetchDisputeCatalogPage(ctx context.Context, request shopifyconnector.DisputeCatalogPageRequest) (shopifyconnector.DisputeCatalogPage, error) {
	if shopifyconnector.ValidateDisputeCatalogPageRequest(request) != nil {
		return shopifyconnector.DisputeCatalogPage{}, shopifyconnector.InvalidDisputeCatalogRequestError(request)
	}
	var wire shopifyDisputeCatalogHTTPResponse
	if err := p.connector.postJSON(ctx, shopifyConnectorDisputeCatalogPath, request.Context.CorrelationID, request, &wire); err != nil {
		return shopifyconnector.DisputeCatalogPage{}, shopifyconnector.SafeDisputeCatalogErrorFor(request, err)
	}
	if wire.Disputes == nil || wire.PageInfo == nil || wire.PageInfo.HasNextPage == nil {
		return shopifyconnector.DisputeCatalogPage{}, shopifyconnector.SafeDisputeCatalogErrorFor(request, errors.New("independent Shopify connector response is invalid"))
	}
	page := shopifyconnector.DisputeCatalogPage{ContractVersion: wire.ContractVersion, TenantID: wire.TenantID, ShopID: wire.ShopID, State: wire.State, Disputes: *wire.Disputes, PageInfo: shopifyconnector.CatalogPageInfo{HasNextPage: *wire.PageInfo.HasNextPage, EndCursor: wire.PageInfo.EndCursor}, FetchedAt: wire.FetchedAt}
	if shopifyconnector.ValidateDisputeCatalogPage(request, page) != nil {
		return shopifyconnector.DisputeCatalogPage{}, shopifyconnector.SafeDisputeCatalogErrorFor(request, errors.New("independent Shopify connector response is invalid"))
	}
	return page, nil
}

func (p *shopifyInventorySetHTTPWriter) SetInventoryAvailable(ctx context.Context, request shopifyconnector.InventorySetRequest) (shopifyconnector.InventorySetResult, error) {
	if shopifyconnector.ValidateInventorySetRequest(request) != nil {
		return shopifyconnector.InventorySetResult{}, shopifyconnector.InvalidInventorySetRequestError(request)
	}
	var wire shopifyInventorySetHTTPResponse
	if err := p.connector.postJSON(ctx, shopifyConnectorInventorySetPath, request.Context.CorrelationID, request, &wire); err != nil {
		return shopifyconnector.InventorySetResult{}, shopifyconnector.SafeInventorySetErrorFor(request, err)
	}
	if wire.ExpectedAvailable == nil || wire.TargetAvailable == nil || wire.UpdatedAt == nil {
		return shopifyconnector.InventorySetResult{}, shopifyconnector.SafeInventorySetErrorFor(request, errors.New("independent Shopify connector response is invalid"))
	}
	result := shopifyconnector.InventorySetResult{ContractVersion: wire.ContractVersion, TenantID: wire.TenantID, ShopID: wire.ShopID, Outcome: wire.Outcome, InventoryItemID: wire.InventoryItemID, LocationID: wire.LocationID, ExpectedAvailable: *wire.ExpectedAvailable, TargetAvailable: *wire.TargetAvailable, SafeErrorCode: wire.SafeErrorCode, UpdatedAt: *wire.UpdatedAt}
	if shopifyconnector.ValidateInventorySetResult(request, result) != nil {
		return shopifyconnector.InventorySetResult{}, shopifyconnector.SafeInventorySetErrorFor(request, errors.New("independent Shopify connector response is invalid"))
	}
	return result, nil
}

func (p *shopifyFulfillmentHTTPPublisher) PublishFulfillment(ctx context.Context, request shopifyconnector.FulfillmentPublishRequest) (shopifyconnector.FulfillmentPublishResult, error) {
	if shopifyconnector.ValidateFulfillmentPublishRequest(request) != nil {
		return shopifyconnector.FulfillmentPublishResult{}, shopifyconnector.InvalidFulfillmentPublishRequestError(request)
	}
	var wire shopifyFulfillmentHTTPResponse
	if err := p.connector.postJSON(ctx, shopifyConnectorFulfillmentPath, request.Context.CorrelationID, request, &wire); err != nil {
		return shopifyconnector.FulfillmentPublishResult{}, shopifyconnector.SafeFulfillmentPublishErrorFor(request, err)
	}
	if wire.FulfillmentIDs == nil || wire.Tracking == nil || wire.RecoveredFromShopify == nil || wire.UpdatedAt == nil {
		return shopifyconnector.FulfillmentPublishResult{}, shopifyconnector.SafeFulfillmentPublishErrorFor(request, errors.New("independent Shopify connector response is invalid"))
	}
	result := shopifyconnector.FulfillmentPublishResult{
		ContractVersion: wire.ContractVersion, TenantID: wire.TenantID, ShopID: wire.ShopID,
		OrderID: wire.OrderID, FulfillmentIDs: *wire.FulfillmentIDs, Tracking: *wire.Tracking,
		RecoveredFromShopify: *wire.RecoveredFromShopify, UpdatedAt: *wire.UpdatedAt,
	}
	if shopifyconnector.ValidateFulfillmentPublishResult(request, result) != nil {
		return shopifyconnector.FulfillmentPublishResult{}, shopifyconnector.SafeFulfillmentPublishErrorFor(request, errors.New("independent Shopify connector response is invalid"))
	}
	return result, nil
}

func (p *shopifyOrderAddressHTTPWriter) UpdateOrderShippingAddress(ctx context.Context, request shopifyconnector.OrderShippingAddressUpdateRequest) (shopifyconnector.OrderShippingAddressUpdateResult, error) {
	if shopifyconnector.ValidateOrderShippingAddressUpdateRequest(request) != nil {
		return shopifyconnector.OrderShippingAddressUpdateResult{}, shopifyconnector.InvalidOrderShippingAddressRequestError(request)
	}
	var wire shopifyOrderAddressHTTPResponse
	if err := p.connector.postJSON(ctx, shopifyConnectorOrderAddressPath, request.Context.CorrelationID, request, &wire); err != nil {
		return shopifyconnector.OrderShippingAddressUpdateResult{}, shopifyconnector.SafeOrderShippingAddressErrorFor(request, err)
	}
	if wire.Address == nil || wire.UpdatedAt == nil {
		return shopifyconnector.OrderShippingAddressUpdateResult{}, shopifyconnector.SafeOrderShippingAddressErrorFor(request, errors.New("independent Shopify connector response is invalid"))
	}
	result := shopifyconnector.OrderShippingAddressUpdateResult{
		ContractVersion: wire.ContractVersion, TenantID: wire.TenantID,
		ShopID: wire.ShopID, OrderID: wire.OrderID, Address: *wire.Address,
		UpdatedAt: *wire.UpdatedAt,
	}
	if shopifyconnector.ValidateOrderShippingAddressUpdateResult(request, result) != nil {
		return shopifyconnector.OrderShippingAddressUpdateResult{}, shopifyconnector.SafeOrderShippingAddressErrorFor(request, errors.New("independent Shopify connector response is invalid"))
	}
	return result, nil
}

func (p *shopifyConnectionHTTPProbe) targetsRequestServer(request *http.Request) bool {
	return p == nil || p.connector == nil || p.connector.targetsRequestServer(request)
}

func (p *shopifyProductCatalogHTTPReader) targetsRequestServer(request *http.Request) bool {
	return p == nil || p.connector == nil || p.connector.targetsRequestServer(request)
}

func (p *shopifyOrderCatalogHTTPReader) targetsRequestServer(request *http.Request) bool {
	return p == nil || p.connector == nil || p.connector.targetsRequestServer(request)
}
func (p *shopifyCustomerCatalogHTTPReader) targetsRequestServer(request *http.Request) bool {
	return p == nil || p.connector == nil || p.connector.targetsRequestServer(request)
}
func (p *shopifyReturnCatalogHTTPReader) targetsRequestServer(request *http.Request) bool {
	return p == nil || p.connector == nil || p.connector.targetsRequestServer(request)
}
func (p *shopifyLocationCatalogHTTPReader) targetsRequestServer(request *http.Request) bool {
	return p == nil || p.connector == nil || p.connector.targetsRequestServer(request)
}
func (p *shopifyInventoryLevelHTTPReader) targetsRequestServer(request *http.Request) bool {
	return p == nil || p.connector == nil || p.connector.targetsRequestServer(request)
}
func (p *shopifyInventorySetHTTPWriter) targetsRequestServer(request *http.Request) bool {
	return p == nil || p.connector == nil || p.connector.targetsRequestServer(request)
}
func (p *shopifyDisputeCatalogHTTPReader) targetsRequestServer(request *http.Request) bool {
	return p == nil || p.connector == nil || p.connector.targetsRequestServer(request)
}
func (p *shopifyFulfillmentHTTPPublisher) targetsRequestServer(request *http.Request) bool {
	return p == nil || p.connector == nil || p.connector.targetsRequestServer(request)
}

func (p *shopifyOrderAddressHTTPWriter) targetsRequestServer(request *http.Request) bool {
	return p == nil || p.connector == nil || p.connector.targetsRequestServer(request)
}

func (c *shopifyConnectorHTTPClient) postJSON(ctx context.Context, path, correlationID string, requestPayload any, responsePayload any) error {
	if c == nil || c.baseURL == nil || c.client == nil {
		return errors.New("independent Shopify connector is not configured")
	}
	body, err := json.Marshal(requestPayload)
	if err != nil {
		return err
	}
	endpoint := c.baseURL.ResolveReference(&url.URL{Path: path})
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return err
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Accept", "application/json")
	httpRequest.Header.Set("X-XZ-ERP-Connector-Token", c.token)
	httpRequest.Header.Set(shopifyConnectorForwardedHeader, "1")
	response, err := c.client.Do(httpRequest)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, shopifyConnectorResponseLimit+1))
	if err != nil || len(raw) > shopifyConnectorResponseLimit {
		return errors.New("independent Shopify connector request failed")
	}
	if response.StatusCode != http.StatusOK {
		if safeErr := decodeShopifyConnectorSafeError(response.StatusCode, correlationID, raw); safeErr != nil {
			return safeErr
		}
		return errors.New("independent Shopify connector request failed")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(responsePayload) != nil || decoder.Decode(&struct{}{}) != io.EOF {
		return errors.New("independent Shopify connector response is invalid")
	}
	return nil
}

func decodeShopifyConnectorSafeError(status int, correlationID string, raw []byte) *shopifyconnector.ConnectionProbeError {
	type wireError struct {
		Code          shopifyconnector.ErrorCode `json:"code"`
		Message       *string                    `json:"message"`
		Retryable     *bool                      `json:"retryable"`
		CorrelationID string                     `json:"correlationId"`
	}
	var wire wireError
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&wire) != nil || decoder.Decode(&struct{}{}) != io.EOF || wire.Message == nil || wire.Retryable == nil || wire.CorrelationID != correlationID || !boundedSafeConnectorMessage(*wire.Message) {
		return nil
	}
	expectedStatus, expectedRetryable, message, ok := safeConnectorErrorContract(wire.Code)
	if !ok || status != expectedStatus || *wire.Retryable != expectedRetryable {
		return nil
	}
	return &shopifyconnector.ConnectionProbeError{Code: wire.Code, Message: message, Retryable: expectedRetryable, CorrelationID: correlationID}
}

func safeConnectorErrorContract(code shopifyconnector.ErrorCode) (int, bool, string, bool) {
	switch code {
	case shopifyconnector.ErrorCodeInvalidRequest:
		return http.StatusBadRequest, false, "Shopify connector request is invalid", true
	case shopifyconnector.ErrorCodeForbidden:
		return http.StatusForbidden, false, "Shopify connector access is not available", true
	case shopifyconnector.ErrorCodeProtectedCustomerDataRequired:
		return http.StatusForbidden, false, "Shopify protected customer data access is required", true
	case shopifyconnector.ErrorCodeCanceled:
		return http.StatusRequestTimeout, false, "Shopify connector request was canceled", true
	case shopifyconnector.ErrorCodeTimeout:
		return http.StatusGatewayTimeout, true, "Shopify connector request timed out", true
	case shopifyconnector.ErrorCodeUnavailable:
		return http.StatusBadGateway, true, "Shopify connection status is temporarily unavailable", true
	default:
		return 0, false, "", false
	}
}

func boundedSafeConnectorMessage(value string) bool {
	if value == "" || len(value) > 256 || !utf8.ValidString(value) {
		return false
	}
	for _, r := range value {
		if unicode.IsControl(r) && r != '\n' && r != '\r' && r != '\t' {
			return false
		}
	}
	return true
}

func (c *shopifyConnectorHTTPClient) targetsRequestServer(request *http.Request) bool {
	if c == nil || c.baseURL == nil || request == nil {
		return true
	}
	requestHost := strings.TrimSpace(request.Host)
	if forwarded := strings.TrimSpace(strings.Split(request.Header.Get("X-Forwarded-Host"), ",")[0]); forwarded != "" {
		requestHost = forwarded
	}
	return sameNetworkEndpoint(c.baseURL.Host, requestHost, c.baseURL.Scheme, request.TLS != nil)
}

func validateShopifyConnectorInternalBaseURL(raw string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" ||
		(parsed.Path != "" && parsed.Path != "/") {
		return nil, errors.New("independent Shopify connector base URL is invalid")
	}
	switch strings.ToLower(parsed.Scheme) {
	case "https":
	case "http":
		if !isLoopbackConnectorHost(parsed.Hostname()) {
			return nil, errors.New("independent Shopify connector base URL is invalid")
		}
	default:
		return nil, errors.New("independent Shopify connector base URL is invalid")
	}
	parsed.Path = "/"
	return parsed, nil
}

func isLoopbackConnectorHost(host string) bool {
	if strings.EqualFold(strings.TrimSpace(host), "localhost") {
		return true
	}
	address := net.ParseIP(strings.Trim(host, "[]"))
	return address != nil && address.IsLoopback()
}

func sameNetworkEndpoint(left, right, leftScheme string, rightTLS bool) bool {
	leftHost, leftPort := splitEndpoint(left, leftScheme)
	rightScheme := "http"
	if rightTLS {
		rightScheme = "https"
	}
	rightHost, rightPort := splitEndpoint(right, rightScheme)
	if leftPort != rightPort {
		return false
	}
	if strings.EqualFold(leftHost, rightHost) {
		return true
	}
	return isLoopbackConnectorHost(leftHost) && isLoopbackConnectorHost(rightHost)
}

func splitEndpoint(value, scheme string) (string, string) {
	host, port, err := net.SplitHostPort(value)
	if err == nil {
		return strings.Trim(host, "[]"), port
	}
	defaultPort := "80"
	if strings.EqualFold(scheme, "https") {
		defaultPort = "443"
	}
	return strings.Trim(value, "[]"), defaultPort
}

var _ shopifyconnector.ConnectionProbe = (*shopifyConnectionHTTPProbe)(nil)
var _ shopifyconnector.ProductCatalogReader = (*shopifyProductCatalogHTTPReader)(nil)
var _ shopifyconnector.OrderCatalogReader = (*shopifyOrderCatalogHTTPReader)(nil)
var _ shopifyconnector.CustomerCatalogReader = (*shopifyCustomerCatalogHTTPReader)(nil)
var _ shopifyconnector.ReturnCatalogReader = (*shopifyReturnCatalogHTTPReader)(nil)
var _ shopifyconnector.LocationCatalogReader = (*shopifyLocationCatalogHTTPReader)(nil)
var _ shopifyconnector.InventoryLevelReader = (*shopifyInventoryLevelHTTPReader)(nil)
var _ shopifyconnector.InventoryWriter = (*shopifyInventorySetHTTPWriter)(nil)
var _ shopifyconnector.OrderShippingAddressWriter = (*shopifyOrderAddressHTTPWriter)(nil)
var _ shopifyconnector.DisputeCatalogReader = (*shopifyDisputeCatalogHTTPReader)(nil)
var _ shopifyconnector.FulfillmentPublisher = (*shopifyFulfillmentHTTPPublisher)(nil)
