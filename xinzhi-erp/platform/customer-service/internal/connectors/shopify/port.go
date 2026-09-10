package shopify

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"net/url"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
)

const ContractVersion = "shopify.connector.connection.v3"
const ProductCatalogContractVersion = "shopify.connector.product_catalog.v1"
const OrderCatalogContractVersion = "shopify.connector.order_catalog.v1"
const CustomerCatalogContractVersion = "shopify.connector.customer_catalog.v1"
const ReturnCatalogContractVersion = "shopify.connector.return_catalog.v1"
const ReturnDecisionContractVersion = "shopify.connector.return_decision.v1"
const ReturnRefundPreviewContractVersion = "shopify.connector.return_refund_preview.v1"
const ReturnRefundProcessContractVersion = "shopify.connector.return_refund_process.v1"
const OrderShippingAddressContractVersion = "shopify.connector.order_shipping_address.v1"
const FulfillmentPublishContractVersion = "shopify.connector.fulfillment_publish.v1"
const DisputeCatalogContractVersion = "shopify.connector.dispute_catalog.v1"
const OrderEditQuantityContractVersion = "shopify.connector.order_edit_quantity.v1"
const OrderAddVariantContractVersion = "shopify.connector.order_add_variant.v1"
const OrderAddCustomItemContractVersion = "shopify.connector.order_add_custom_item.v1"
const OrderLineDiscountContractVersion = "shopify.connector.order_line_discount.v1"
const OrderCancellationContractVersion = "shopify.connector.order_cancellation.v1"
const LocationCatalogContractVersion = "shopify.connector.location_catalog.v1"
const InventoryLevelContractVersion = "shopify.connector.inventory_level.v1"
const InventorySetContractVersion = "shopify.connector.inventory_set.v1"

var ErrInvalidFulfillment = errors.New("Shopify fulfillment request is invalid")
var ErrProviderAuthorization = errors.New("Shopify provider authorization failed")

// Token rejection is narrower than authorization failure (which also covers 403).
var ErrProviderTokenRejected = errors.New("Shopify provider token rejected")
var ErrProviderAppNotInstalled = errors.New("Shopify provider app is not installed")
var ErrProtectedCustomerDataRequired = errors.New("Shopify protected customer data approval is required")

type ConnectionState string

const (
	ConnectionStateNotConfigured ConnectionState = "NOT_CONFIGURED"
	ConnectionStateDisconnected  ConnectionState = "DISCONNECTED"
	ConnectionStateConnected     ConnectionState = "CONNECTED"
)

type ErrorCode string

const (
	ErrorCodeInvalidRequest                ErrorCode = "INVALID_REQUEST"
	ErrorCodeCanceled                      ErrorCode = "CANCELED"
	ErrorCodeTimeout                       ErrorCode = "TIMEOUT"
	ErrorCodeUnavailable                   ErrorCode = "CONNECTOR_UNAVAILABLE"
	ErrorCodeForbidden                     ErrorCode = "FORBIDDEN"
	ErrorCodeProtectedCustomerDataRequired ErrorCode = "PROTECTED_CUSTOMER_DATA_REQUIRED"
)

type CanonicalShopIdentity struct {
	TenantID string `json:"tenantId"`
	ShopID   string `json:"shopId"`
}

type RequestContext struct {
	CorrelationID string `json:"correlationId"`
	RequestID     string `json:"requestId"`
}

type ConnectionProbeRequest struct {
	Identity CanonicalShopIdentity `json:"identity"`
	Context  RequestContext        `json:"context"`
}

type ProductCatalogPageRequest struct {
	Identity CanonicalShopIdentity `json:"identity"`
	Context  RequestContext        `json:"context"`
	Limit    int                   `json:"limit"`
	Cursor   string                `json:"cursor,omitempty"`
	Query    string                `json:"query,omitempty"`
}

type OrderCatalogPageRequest struct {
	Identity CanonicalShopIdentity `json:"identity"`
	Context  RequestContext        `json:"context"`
	Limit    int                   `json:"limit"`
	Cursor   string                `json:"cursor,omitempty"`
	Query    string                `json:"query,omitempty"`
}

type CustomerCatalogPageRequest struct {
	Identity CanonicalShopIdentity `json:"identity"`
	Context  RequestContext        `json:"context"`
	Limit    int                   `json:"limit"`
	Cursor   string                `json:"cursor,omitempty"`
	Query    string                `json:"query,omitempty"`
}

// ReturnCatalogPageRequest pages through Shopify orders and flattens the
// complete return collection attached to each order. Cursor therefore belongs
// to the outer order connection, not to an individual return.
type ReturnCatalogPageRequest struct {
	Identity CanonicalShopIdentity `json:"identity"`
	Context  RequestContext        `json:"context"`
	Limit    int                   `json:"limit"`
	Cursor   string                `json:"cursor,omitempty"`
	Query    string                `json:"query,omitempty"`
}

type ReturnDecision string

const (
	ReturnDecisionApprove ReturnDecision = "APPROVE"
	ReturnDecisionDecline ReturnDecision = "DECLINE"
)

type ReturnDeclineReason string

const (
	ReturnDeclineReasonFinalSale         ReturnDeclineReason = "FINAL_SALE"
	ReturnDeclineReasonOther             ReturnDeclineReason = "OTHER"
	ReturnDeclineReasonReturnPeriodEnded ReturnDeclineReason = "RETURN_PERIOD_ENDED"
)

type ReturnDecisionRequest struct {
	Identity       CanonicalShopIdentity `json:"identity"`
	Context        RequestContext        `json:"context"`
	ReturnID       string                `json:"returnId"`
	Decision       ReturnDecision        `json:"decision"`
	DeclineReason  ReturnDeclineReason   `json:"declineReason,omitempty"`
	DeclineNote    string                `json:"declineNote,omitempty"`
	NotifyCustomer bool                  `json:"notifyCustomer"`
	IdempotencyKey string                `json:"idempotencyKey"`
}

type ReturnDecisionResult struct {
	ContractVersion      string    `json:"contractVersion"`
	TenantID             string    `json:"tenantId"`
	ShopID               string    `json:"shopId"`
	ReturnID             string    `json:"returnId"`
	Status               string    `json:"status"`
	RecoveredFromShopify bool      `json:"recoveredFromShopify"`
	UpdatedAt            time.Time `json:"updatedAt"`
}

type ReturnRefundLineSelection struct {
	ReturnLineID string `json:"returnLineId"`
	Quantity     int    `json:"quantity"`
}

type ReturnRefundDutyType string

const (
	ReturnRefundDutyFull         ReturnRefundDutyType = "FULL"
	ReturnRefundDutyProportional ReturnRefundDutyType = "PROPORTIONAL"
)

type ReturnRefundDutySelection struct {
	DutyID     string               `json:"dutyId"`
	RefundType ReturnRefundDutyType `json:"refundType"`
}

type ReturnRefundPreviewRequest struct {
	Identity       CanonicalShopIdentity       `json:"identity"`
	Context        RequestContext              `json:"context"`
	ReturnID       string                      `json:"returnId"`
	LineItems      []ReturnRefundLineSelection `json:"lineItems"`
	RefundShipping bool                        `json:"refundShipping"`
	RefundDuties   []ReturnRefundDutySelection `json:"refundDuties"`
}

type ReturnRefundMoneyBag struct {
	ShopMoney        CatalogMoney `json:"shopMoney"`
	PresentmentMoney CatalogMoney `json:"presentmentMoney"`
}

type ReturnRefundTransaction struct {
	ParentTransactionID string               `json:"parentTransactionId"`
	Amount              ReturnRefundMoneyBag `json:"amount"`
	Gateway             string               `json:"gateway,omitempty"`
	FormattedGateway    string               `json:"formattedGateway,omitempty"`
	AccountNumber       string               `json:"accountNumber,omitempty"`
}

type ReturnRefundPreviewState string

const (
	ReturnRefundPreviewRefundable    ReturnRefundPreviewState = "REFUNDABLE"
	ReturnRefundPreviewNotRefundable ReturnRefundPreviewState = "NOT_REFUNDABLE"
)

type ReturnRefundPreview struct {
	ContractVersion   string                      `json:"contractVersion"`
	TenantID          string                      `json:"tenantId"`
	ShopID            string                      `json:"shopId"`
	ReturnID          string                      `json:"returnId"`
	State             ReturnRefundPreviewState    `json:"state"`
	LineItems         []ReturnRefundLineSelection `json:"lineItems"`
	RefundShipping    bool                        `json:"refundShipping"`
	RefundDuties      []ReturnRefundDutySelection `json:"refundDuties"`
	ShippingAmount    *ReturnRefundMoneyBag       `json:"shippingAmount,omitempty"`
	DutyAmount        *ReturnRefundMoneyBag       `json:"dutyAmount,omitempty"`
	RefundAmount      ReturnRefundMoneyBag        `json:"refundAmount"`
	MaximumRefundable ReturnRefundMoneyBag        `json:"maximumRefundable"`
	Transactions      []ReturnRefundTransaction   `json:"transactions"`
	PreviewToken      string                      `json:"previewToken,omitempty"`
	ExpiresAt         *time.Time                  `json:"expiresAt,omitempty"`
	FetchedAt         time.Time                   `json:"fetchedAt"`
}

type ReturnRefundProcessRequest struct {
	Identity       CanonicalShopIdentity       `json:"identity"`
	Context        RequestContext              `json:"context"`
	ReturnID       string                      `json:"returnId"`
	LineItems      []ReturnRefundLineSelection `json:"lineItems"`
	RefundShipping bool                        `json:"refundShipping"`
	RefundDuties   []ReturnRefundDutySelection `json:"refundDuties"`
	PreviewToken   string                      `json:"previewToken"`
	NotifyCustomer bool                        `json:"notifyCustomer"`
	IdempotencyKey string                      `json:"idempotencyKey"`
}

type ReturnRefundProcessOutcome string

const (
	ReturnRefundProcessApplied        ReturnRefundProcessOutcome = "APPLIED"
	ReturnRefundProcessPending        ReturnRefundProcessOutcome = "PENDING"
	ReturnRefundProcessReviewRequired ReturnRefundProcessOutcome = "REVIEW_REQUIRED"
)

type ReturnRefundProcessedTransaction struct {
	ID                  string               `json:"id"`
	ParentTransactionID string               `json:"parentTransactionId"`
	Status              string               `json:"status"`
	Amount              ReturnRefundMoneyBag `json:"amount"`
}

type ReturnRefundProcessResult struct {
	ContractVersion      string                             `json:"contractVersion"`
	TenantID             string                             `json:"tenantId"`
	ShopID               string                             `json:"shopId"`
	ReturnID             string                             `json:"returnId"`
	ReturnStatus         string                             `json:"returnStatus"`
	Outcome              ReturnRefundProcessOutcome         `json:"outcome"`
	RefundAmount         ReturnRefundMoneyBag               `json:"refundAmount"`
	Transactions         []ReturnRefundProcessedTransaction `json:"transactions"`
	RecoveredFromShopify bool                               `json:"recoveredFromShopify"`
	UpdatedAt            time.Time                          `json:"updatedAt"`
}

type LocationCatalogPageRequest struct {
	Identity CanonicalShopIdentity `json:"identity"`
	Context  RequestContext        `json:"context"`
	Limit    int                   `json:"limit"`
	Cursor   string                `json:"cursor,omitempty"`
}

type InventoryLevelReadRequest struct {
	Identity        CanonicalShopIdentity `json:"identity"`
	Context         RequestContext        `json:"context"`
	InventoryItemID string                `json:"inventoryItemId"`
	LocationID      string                `json:"locationId"`
}

type InventorySetRequest struct {
	Identity             CanonicalShopIdentity `json:"identity"`
	Context              RequestContext        `json:"context"`
	InventoryItemID      string                `json:"inventoryItemId"`
	LocationID           string                `json:"locationId"`
	ExpectedAvailable    int                   `json:"expectedAvailable"`
	TargetAvailable      int                   `json:"targetAvailable"`
	IdempotencyKey       string                `json:"idempotencyKey"`
	ReferenceDocumentURI string                `json:"referenceDocumentUri"`
}

type OrderShippingAddressUpdateRequest struct {
	Identity       CanonicalShopIdentity `json:"identity"`
	Context        RequestContext        `json:"context"`
	OrderID        string                `json:"orderId"`
	IdempotencyKey string                `json:"idempotencyKey"`
	Address        CatalogMailingAddress `json:"address"`
}

type OrderShippingAddressUpdateResult struct {
	ContractVersion string                `json:"contractVersion"`
	TenantID        string                `json:"tenantId"`
	ShopID          string                `json:"shopId"`
	OrderID         string                `json:"orderId"`
	Address         CatalogMailingAddress `json:"address"`
	UpdatedAt       time.Time             `json:"updatedAt"`
}

type OrderEditQuantityRequest struct {
	Identity         CanonicalShopIdentity `json:"identity"`
	Context          RequestContext        `json:"context"`
	OrderID          string                `json:"orderId"`
	OrderLineID      string                `json:"orderLineId"`
	VariantID        string                `json:"variantId,omitempty"`
	ExpectedQuantity int                   `json:"expectedQuantity"`
	Quantity         int                   `json:"quantity"`
	Restock          bool                  `json:"restock"`
	NotifyCustomer   bool                  `json:"notifyCustomer"`
	IdempotencyKey   string                `json:"idempotencyKey"`
}

type OrderEditQuantityResult struct {
	ContractVersion      string       `json:"contractVersion"`
	TenantID             string       `json:"tenantId"`
	ShopID               string       `json:"shopId"`
	OrderID              string       `json:"orderId"`
	OrderLineID          string       `json:"orderLineId"`
	Quantity             int          `json:"quantity"`
	Total                CatalogMoney `json:"total"`
	RecoveredFromShopify bool         `json:"recoveredFromShopify"`
	UpdatedAt            time.Time    `json:"updatedAt"`
}

type OrderAddVariantRequest struct {
	Identity        CanonicalShopIdentity `json:"identity"`
	Context         RequestContext        `json:"context"`
	OrderID         string                `json:"orderId"`
	VariantID       string                `json:"variantId"`
	Quantity        int                   `json:"quantity"`
	NotifyCustomer  bool                  `json:"notifyCustomer"`
	RecoverExisting bool                  `json:"recoverExisting"`
	IdempotencyKey  string                `json:"idempotencyKey"`
}

type OrderAddVariantResult struct {
	ContractVersion      string       `json:"contractVersion"`
	TenantID             string       `json:"tenantId"`
	ShopID               string       `json:"shopId"`
	OrderID              string       `json:"orderId"`
	OrderLineID          string       `json:"orderLineId"`
	VariantID            string       `json:"variantId"`
	Quantity             int          `json:"quantity"`
	SKU                  string       `json:"sku"`
	Title                string       `json:"title"`
	VariantTitle         string       `json:"variantTitle,omitempty"`
	UnitPrice            CatalogMoney `json:"unitPrice"`
	Total                CatalogMoney `json:"total"`
	RecoveredFromShopify bool         `json:"recoveredFromShopify"`
	UpdatedAt            time.Time    `json:"updatedAt"`
}

type OrderAddCustomItemRequest struct {
	Identity         CanonicalShopIdentity `json:"identity"`
	Context          RequestContext        `json:"context"`
	OrderID          string                `json:"orderId"`
	Title            string                `json:"title"`
	UnitPrice        CatalogMoney          `json:"unitPrice"`
	Quantity         int                   `json:"quantity"`
	RequiresShipping bool                  `json:"requiresShipping"`
	Taxable          bool                  `json:"taxable"`
	NotifyCustomer   bool                  `json:"notifyCustomer"`
	RecoverExisting  bool                  `json:"recoverExisting"`
	IdempotencyKey   string                `json:"idempotencyKey"`
}

type OrderAddCustomItemResult struct {
	ContractVersion      string       `json:"contractVersion"`
	TenantID             string       `json:"tenantId"`
	ShopID               string       `json:"shopId"`
	OrderID              string       `json:"orderId"`
	OrderLineID          string       `json:"orderLineId"`
	Title                string       `json:"title"`
	UnitPrice            CatalogMoney `json:"unitPrice"`
	Quantity             int          `json:"quantity"`
	Total                CatalogMoney `json:"total"`
	RecoveredFromShopify bool         `json:"recoveredFromShopify"`
	UpdatedAt            time.Time    `json:"updatedAt"`
}

type OrderLineDiscountType string

const (
	OrderLineDiscountTypeFixed      OrderLineDiscountType = "FIXED"
	OrderLineDiscountTypePercentage OrderLineDiscountType = "PERCENTAGE"
)

type OrderLineDiscountRequest struct {
	Identity              CanonicalShopIdentity `json:"identity"`
	Context               RequestContext        `json:"context"`
	OrderID               string                `json:"orderId"`
	OrderLineID           string                `json:"orderLineId"`
	VariantID             string                `json:"variantId,omitempty"`
	ExpectedQuantity      int                   `json:"expectedQuantity"`
	ExpectedDiscountTotal CatalogMoney          `json:"expectedDiscountTotal"`
	Description           string                `json:"description"`
	DiscountType          OrderLineDiscountType `json:"discountType"`
	FixedValue            *CatalogMoney         `json:"fixedValue,omitempty"`
	PercentBasisPoints    int                   `json:"percentBasisPoints,omitempty"`
	NotifyCustomer        bool                  `json:"notifyCustomer"`
	RecoverExisting       bool                  `json:"recoverExisting"`
	IdempotencyKey        string                `json:"idempotencyKey"`
}

type OrderLineDiscountResult struct {
	ContractVersion      string                `json:"contractVersion"`
	TenantID             string                `json:"tenantId"`
	ShopID               string                `json:"shopId"`
	OrderID              string                `json:"orderId"`
	OrderLineID          string                `json:"orderLineId"`
	Description          string                `json:"description"`
	DiscountType         OrderLineDiscountType `json:"discountType"`
	FixedValue           *CatalogMoney         `json:"fixedValue,omitempty"`
	PercentBasisPoints   int                   `json:"percentBasisPoints,omitempty"`
	DiscountTotal        CatalogMoney          `json:"discountTotal"`
	Total                CatalogMoney          `json:"total"`
	RecoveredFromShopify bool                  `json:"recoveredFromShopify"`
	UpdatedAt            time.Time             `json:"updatedAt"`
}

type OrderCancellationReason string

const (
	OrderCancellationReasonCustomer  OrderCancellationReason = "CUSTOMER"
	OrderCancellationReasonDeclined  OrderCancellationReason = "DECLINED"
	OrderCancellationReasonFraud     OrderCancellationReason = "FRAUD"
	OrderCancellationReasonInventory OrderCancellationReason = "INVENTORY"
	OrderCancellationReasonStaff     OrderCancellationReason = "STAFF"
	OrderCancellationReasonOther     OrderCancellationReason = "OTHER"
)

type OrderCancellationRequest struct {
	Identity                     CanonicalShopIdentity   `json:"identity"`
	Context                      RequestContext          `json:"context"`
	OrderID                      string                  `json:"orderId"`
	Reason                       OrderCancellationReason `json:"reason"`
	StaffNote                    string                  `json:"staffNote"`
	RefundOriginalPaymentMethods bool                    `json:"refundOriginalPaymentMethods"`
	Restock                      bool                    `json:"restock"`
	NotifyCustomer               bool                    `json:"notifyCustomer"`
	RecoverExisting              bool                    `json:"recoverExisting"`
	IdempotencyKey               string                  `json:"idempotencyKey"`
}

type OrderCancellationResult struct {
	ContractVersion      string                  `json:"contractVersion"`
	TenantID             string                  `json:"tenantId"`
	ShopID               string                  `json:"shopId"`
	OrderID              string                  `json:"orderId"`
	Reason               OrderCancellationReason `json:"reason"`
	CancelledAt          time.Time               `json:"cancelledAt"`
	JobID                string                  `json:"jobId,omitempty"`
	RecoveredFromShopify bool                    `json:"recoveredFromShopify"`
	UpdatedAt            time.Time               `json:"updatedAt"`
}

type FulfillmentPublishRequest struct {
	Identity       CanonicalShopIdentity  `json:"identity"`
	Context        RequestContext         `json:"context"`
	OrderID        string                 `json:"orderId"`
	IdempotencyKey string                 `json:"idempotencyKey"`
	NotifyCustomer bool                   `json:"notifyCustomer"`
	Tracking       CatalogTrackingInfo    `json:"tracking"`
	Lines          []FulfillmentLineInput `json:"lines"`
}

type FulfillmentLineInput struct {
	OrderLineID string `json:"orderLineId"`
	Quantity    int    `json:"quantity"`
}

type FulfillmentPublishResult struct {
	ContractVersion      string              `json:"contractVersion"`
	TenantID             string              `json:"tenantId"`
	ShopID               string              `json:"shopId"`
	OrderID              string              `json:"orderId"`
	FulfillmentIDs       []string            `json:"fulfillmentIds"`
	Tracking             CatalogTrackingInfo `json:"tracking"`
	RecoveredFromShopify bool                `json:"recoveredFromShopify"`
	UpdatedAt            time.Time           `json:"updatedAt"`
}

type DisputeCatalogPageRequest struct {
	Identity CanonicalShopIdentity `json:"identity"`
	Context  RequestContext        `json:"context"`
	Limit    int                   `json:"limit"`
	Cursor   string                `json:"cursor,omitempty"`
}

type DisputeCatalogPage struct {
	ContractVersion string            `json:"contractVersion"`
	TenantID        string            `json:"tenantId"`
	ShopID          string            `json:"shopId"`
	State           OrderCatalogState `json:"state"`
	Disputes        []Dispute         `json:"disputes"`
	PageInfo        CatalogPageInfo   `json:"pageInfo"`
	FetchedAt       *time.Time        `json:"fetchedAt,omitempty"`
}

type Dispute struct {
	ID                string       `json:"id"`
	OrderID           string       `json:"orderId,omitempty"`
	OrderName         string       `json:"orderName,omitempty"`
	Status            string       `json:"status"`
	Type              string       `json:"type"`
	Reason            string       `json:"reason"`
	NetworkReasonCode string       `json:"networkReasonCode,omitempty"`
	Amount            CatalogMoney `json:"amount"`
	InitiatedAt       string       `json:"initiatedAt"`
	EvidenceDueBy     string       `json:"evidenceDueBy,omitempty"`
	EvidenceSentOn    string       `json:"evidenceSentOn,omitempty"`
	FinalizedOn       string       `json:"finalizedOn,omitempty"`
}

type ConnectionSummary struct {
	ContractVersion string          `json:"contractVersion"`
	TenantID        string          `json:"tenantId"`
	ShopID          string          `json:"shopId"`
	State           ConnectionState `json:"state"`
	GrantedScopes   []string        `json:"grantedScopes"`
	ShopName        string          `json:"shopName,omitempty"`
	ShopDomain      string          `json:"shopDomain,omitempty"`
	CheckedAt       time.Time       `json:"checkedAt"`
}

type ProductCatalogState string

const (
	ProductCatalogStateNotConfigured ProductCatalogState = "NOT_CONFIGURED"
	ProductCatalogStateConnected     ProductCatalogState = "CONNECTED"
)

type ProductCatalogPage struct {
	ContractVersion string              `json:"contractVersion"`
	TenantID        string              `json:"tenantId"`
	ShopID          string              `json:"shopId"`
	State           ProductCatalogState `json:"state"`
	Products        []CatalogProduct    `json:"products"`
	PageInfo        CatalogPageInfo     `json:"pageInfo"`
	FetchedAt       *time.Time          `json:"fetchedAt,omitempty"`
}

type OrderCatalogState string

const (
	OrderCatalogStateNotConfigured OrderCatalogState = "NOT_CONFIGURED"
	OrderCatalogStateConnected     OrderCatalogState = "CONNECTED"
)

type OrderCatalogPage struct {
	ContractVersion string            `json:"contractVersion"`
	TenantID        string            `json:"tenantId"`
	ShopID          string            `json:"shopId"`
	State           OrderCatalogState `json:"state"`
	Orders          []CatalogOrder    `json:"orders"`
	PageInfo        CatalogPageInfo   `json:"pageInfo"`
	FetchedAt       *time.Time        `json:"fetchedAt,omitempty"`
}

type CustomerCatalogPage struct {
	ContractVersion string            `json:"contractVersion"`
	TenantID        string            `json:"tenantId"`
	ShopID          string            `json:"shopId"`
	State           OrderCatalogState `json:"state"`
	Customers       []CatalogCustomer `json:"customers"`
	PageInfo        CatalogPageInfo   `json:"pageInfo"`
	FetchedAt       *time.Time        `json:"fetchedAt,omitempty"`
}

type ReturnCatalogPage struct {
	ContractVersion string            `json:"contractVersion"`
	TenantID        string            `json:"tenantId"`
	ShopID          string            `json:"shopId"`
	State           OrderCatalogState `json:"state"`
	Returns         []CatalogReturn   `json:"returns"`
	PageInfo        CatalogPageInfo   `json:"pageInfo"`
	FetchedAt       *time.Time        `json:"fetchedAt,omitempty"`
}

type CatalogReturn struct {
	ID                string              `json:"id"`
	Name              string              `json:"name"`
	OrderID           string              `json:"orderId"`
	OrderName         string              `json:"orderName"`
	Status            string              `json:"status"`
	CreatedAt         string              `json:"createdAt"`
	ClosedAt          string              `json:"closedAt,omitempty"`
	RequestApprovedAt string              `json:"requestApprovedAt,omitempty"`
	TotalQuantity     int                 `json:"totalQuantity"`
	LineItems         []CatalogReturnLine `json:"lineItems"`
}

type CatalogReturnLine struct {
	ID                  string              `json:"id"`
	FulfillmentLineID   string              `json:"fulfillmentLineId"`
	OrderLineID         string              `json:"orderLineId"`
	Name                string              `json:"name"`
	SKU                 string              `json:"sku,omitempty"`
	Quantity            int                 `json:"quantity"`
	ProcessableQuantity int                 `json:"processableQuantity"`
	ProcessedQuantity   int                 `json:"processedQuantity"`
	RefundableQuantity  int                 `json:"refundableQuantity"`
	RefundedQuantity    int                 `json:"refundedQuantity"`
	ReasonHandle        string              `json:"reasonHandle,omitempty"`
	ReasonName          string              `json:"reasonName,omitempty"`
	Duties              []CatalogReturnDuty `json:"duties"`
}

type CatalogReturnDuty struct {
	ID    string               `json:"id"`
	Price ReturnRefundMoneyBag `json:"price"`
}

type LocationCatalogPage struct {
	ContractVersion string               `json:"contractVersion"`
	TenantID        string               `json:"tenantId"`
	ShopID          string               `json:"shopId"`
	State           LocationCatalogState `json:"state"`
	Locations       []CatalogLocation    `json:"locations"`
	PageInfo        CatalogPageInfo      `json:"pageInfo"`
	FetchedAt       *time.Time           `json:"fetchedAt,omitempty"`
}

type LocationCatalogState string

const (
	LocationCatalogStateNotConfigured LocationCatalogState = "NOT_CONFIGURED"
	LocationCatalogStateConnected     LocationCatalogState = "CONNECTED"
)

type InventoryLevelState string

const (
	InventoryLevelStateNotConfigured InventoryLevelState = "NOT_CONFIGURED"
	InventoryLevelStateConnected     InventoryLevelState = "CONNECTED"
)

type InventoryLevelSnapshot struct {
	ContractVersion   string              `json:"contractVersion"`
	TenantID          string              `json:"tenantId"`
	ShopID            string              `json:"shopId"`
	State             InventoryLevelState `json:"state"`
	InventoryItemID   string              `json:"inventoryItemId"`
	LocationID        string              `json:"locationId"`
	Tracked           bool                `json:"tracked"`
	Active            bool                `json:"active"`
	AvailableQuantity int                 `json:"availableQuantity"`
	OnHandQuantity    *int                `json:"onHandQuantity,omitempty"`
	FetchedAt         *time.Time          `json:"fetchedAt,omitempty"`
}

type InventorySetOutcome string

const (
	InventorySetOutcomeApplied  InventorySetOutcome = "APPLIED"
	InventorySetOutcomeStale    InventorySetOutcome = "STALE"
	InventorySetOutcomeRejected InventorySetOutcome = "REJECTED"
)

type InventorySetResult struct {
	ContractVersion   string              `json:"contractVersion"`
	TenantID          string              `json:"tenantId"`
	ShopID            string              `json:"shopId"`
	Outcome           InventorySetOutcome `json:"outcome"`
	InventoryItemID   string              `json:"inventoryItemId"`
	LocationID        string              `json:"locationId"`
	ExpectedAvailable int                 `json:"expectedAvailable"`
	TargetAvailable   int                 `json:"targetAvailable"`
	SafeErrorCode     string              `json:"safeErrorCode,omitempty"`
	UpdatedAt         time.Time           `json:"updatedAt"`
}

type CatalogPageInfo struct {
	HasNextPage bool   `json:"hasNextPage"`
	EndCursor   string `json:"endCursor,omitempty"`
}

type CatalogProduct struct {
	ID               string           `json:"id"`
	LegacyResourceID string           `json:"legacyResourceId,omitempty"`
	Title            string           `json:"title"`
	Handle           string           `json:"handle,omitempty"`
	Status           string           `json:"status,omitempty"`
	Vendor           string           `json:"vendor,omitempty"`
	ProductType      string           `json:"productType,omitempty"`
	PublishedAt      string           `json:"publishedAt,omitempty"`
	UpdatedAt        string           `json:"updatedAt,omitempty"`
	Variants         []CatalogVariant `json:"variants"`
}

type CatalogVariant struct {
	ID               string `json:"id"`
	LegacyResourceID string `json:"legacyResourceId,omitempty"`
	InventoryItemID  string `json:"inventoryItemId,omitempty"`
	Title            string `json:"title"`
	SKU              string `json:"sku,omitempty"`
	Barcode          string `json:"barcode,omitempty"`
	Price            string `json:"price,omitempty"`
	CurrencyCode     string `json:"currencyCode,omitempty"`
	AvailableForSale bool   `json:"availableForSale"`
	InventoryTracked bool   `json:"inventoryTracked"`
}

type CatalogLocation struct {
	ID                   string `json:"id"`
	Name                 string `json:"name"`
	IsActive             bool   `json:"isActive"`
	FulfillsOnlineOrders bool   `json:"fulfillsOnlineOrders"`
	HasActiveInventory   bool   `json:"hasActiveInventory"`
	IsFulfillmentService bool   `json:"isFulfillmentService"`
	Address1             string `json:"address1,omitempty"`
	Address2             string `json:"address2,omitempty"`
	City                 string `json:"city,omitempty"`
	Province             string `json:"province,omitempty"`
	ProvinceCode         string `json:"provinceCode,omitempty"`
	Country              string `json:"country,omitempty"`
	CountryCode          string `json:"countryCode,omitempty"`
	Zip                  string `json:"zip,omitempty"`
}

type CatalogOrder struct {
	ID                       string                `json:"id"`
	LegacyResourceID         string                `json:"legacyResourceId,omitempty"`
	Name                     string                `json:"name"`
	Email                    string                `json:"email,omitempty"`
	SourceName               string                `json:"sourceName,omitempty"`
	CreatedAt                string                `json:"createdAt"`
	UpdatedAt                string                `json:"updatedAt,omitempty"`
	CancelledAt              string                `json:"cancelledAt,omitempty"`
	DisplayFinancialStatus   string                `json:"displayFinancialStatus,omitempty"`
	DisplayFulfillmentStatus string                `json:"displayFulfillmentStatus,omitempty"`
	PaymentGatewayNames      []string              `json:"paymentGatewayNames,omitempty"`
	Total                    CatalogMoney          `json:"total"`
	Subtotal                 CatalogMoney          `json:"subtotal,omitempty"`
	Shipping                 CatalogMoney          `json:"shipping,omitempty"`
	ShippingAddress          CatalogMailingAddress `json:"shippingAddress,omitempty"`
	Customer                 CatalogCustomer       `json:"customer,omitempty"`
	LineItems                []CatalogOrderLine    `json:"lineItems"`
	Fulfillments             []CatalogFulfillment  `json:"fulfillments"`
}

type CatalogMoney struct {
	Amount       string `json:"amount"`
	CurrencyCode string `json:"currencyCode"`
}

type CatalogMailingAddress struct {
	Name         string   `json:"name,omitempty"`
	FirstName    string   `json:"firstName,omitempty"`
	LastName     string   `json:"lastName,omitempty"`
	Company      string   `json:"company,omitempty"`
	Address1     string   `json:"address1,omitempty"`
	Address2     string   `json:"address2,omitempty"`
	City         string   `json:"city,omitempty"`
	Province     string   `json:"province,omitempty"`
	ProvinceCode string   `json:"provinceCode,omitempty"`
	Country      string   `json:"country,omitempty"`
	CountryCode  string   `json:"countryCode,omitempty"`
	Zip          string   `json:"zip,omitempty"`
	Phone        string   `json:"phone,omitempty"`
	Formatted    []string `json:"formatted,omitempty"`
}

type CatalogCustomer struct {
	ID               string                       `json:"id,omitempty"`
	LegacyResourceID string                       `json:"legacyResourceId,omitempty"`
	DisplayName      string                       `json:"displayName,omitempty"`
	Email            string                       `json:"email,omitempty"`
	Phone            string                       `json:"phone,omitempty"`
	CreatedAt        string                       `json:"createdAt,omitempty"`
	UpdatedAt        string                       `json:"updatedAt,omitempty"`
	VerifiedEmail    bool                         `json:"verifiedEmail"`
	Tags             []string                     `json:"tags"`
	NumberOfOrders   string                       `json:"numberOfOrders"`
	TotalSpent       CatalogMoney                 `json:"totalSpent,omitempty"`
	DefaultLocation  CatalogCustomerLocation      `json:"defaultLocation,omitempty"`
	LastOrder        *CatalogCustomerOrderSummary `json:"lastOrder,omitempty"`
}

type CatalogCustomerLocation struct {
	City        string `json:"city,omitempty"`
	Province    string `json:"province,omitempty"`
	Country     string `json:"country,omitempty"`
	CountryCode string `json:"countryCode,omitempty"`
}

type CatalogCustomerOrderSummary struct {
	ID                       string       `json:"id"`
	Name                     string       `json:"name"`
	CreatedAt                string       `json:"createdAt"`
	DisplayFinancialStatus   string       `json:"displayFinancialStatus,omitempty"`
	DisplayFulfillmentStatus string       `json:"displayFulfillmentStatus,omitempty"`
	Total                    CatalogMoney `json:"total"`
}

type CatalogOrderLine struct {
	ID                string       `json:"id,omitempty"`
	LegacyResourceID  string       `json:"legacyResourceId,omitempty"`
	ProductID         string       `json:"productId,omitempty"`
	VariantID         string       `json:"variantId,omitempty"`
	InventoryItemID   string       `json:"inventoryItemId,omitempty"`
	Name              string       `json:"name"`
	Title             string       `json:"title,omitempty"`
	Quantity          int          `json:"quantity"`
	SKU               string       `json:"sku,omitempty"`
	VariantTitle      string       `json:"variantTitle,omitempty"`
	RequiresShipping  bool         `json:"requiresShipping"`
	DiscountedTotal   CatalogMoney `json:"discountedTotal,omitempty"`
	OriginalUnitPrice CatalogMoney `json:"originalUnitPrice,omitempty"`
}

type CatalogFulfillment struct {
	ID           string                `json:"id,omitempty"`
	Status       string                `json:"status,omitempty"`
	CreatedAt    string                `json:"createdAt,omitempty"`
	UpdatedAt    string                `json:"updatedAt,omitempty"`
	TrackingInfo []CatalogTrackingInfo `json:"trackingInfo,omitempty"`
}

type CatalogTrackingInfo struct {
	Company string `json:"company,omitempty"`
	Number  string `json:"number,omitempty"`
	URL     string `json:"url,omitempty"`
}

type ConnectionProbeError struct {
	Code          ErrorCode `json:"code"`
	Message       string    `json:"message"`
	Retryable     bool      `json:"retryable"`
	CorrelationID string    `json:"correlationId"`
}

func (e *ConnectionProbeError) Error() string {
	if e == nil {
		return ""
	}
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

type ConnectionProbe interface {
	ProbeConnection(context.Context, ConnectionProbeRequest) (ConnectionSummary, error)
}

type ProductCatalogReader interface {
	FetchProductCatalogPage(context.Context, ProductCatalogPageRequest) (ProductCatalogPage, error)
}

type OrderCatalogReader interface {
	FetchOrderCatalogPage(context.Context, OrderCatalogPageRequest) (OrderCatalogPage, error)
}

type CustomerCatalogReader interface {
	FetchCustomerCatalogPage(context.Context, CustomerCatalogPageRequest) (CustomerCatalogPage, error)
}

type ReturnCatalogReader interface {
	FetchReturnCatalogPage(context.Context, ReturnCatalogPageRequest) (ReturnCatalogPage, error)
}

type ReturnDecisionWriter interface {
	DecideReturn(context.Context, ReturnDecisionRequest) (ReturnDecisionResult, error)
}

type ReturnRefundPreviewReader interface {
	PreviewReturnRefund(context.Context, ReturnRefundPreviewRequest) (ReturnRefundPreview, error)
}

type ReturnRefundProcessor interface {
	ProcessReturnRefund(context.Context, ReturnRefundProcessRequest) (ReturnRefundProcessResult, error)
}

type LocationCatalogReader interface {
	FetchLocationCatalogPage(context.Context, LocationCatalogPageRequest) (LocationCatalogPage, error)
}

type InventoryLevelReader interface {
	FetchInventoryLevel(context.Context, InventoryLevelReadRequest) (InventoryLevelSnapshot, error)
}

type InventoryWriter interface {
	SetInventoryAvailable(context.Context, InventorySetRequest) (InventorySetResult, error)
}

type OrderShippingAddressWriter interface {
	UpdateOrderShippingAddress(context.Context, OrderShippingAddressUpdateRequest) (OrderShippingAddressUpdateResult, error)
}

type OrderEditQuantityWriter interface {
	UpdateOrderLineQuantity(context.Context, OrderEditQuantityRequest) (OrderEditQuantityResult, error)
}

type OrderVariantAdder interface {
	AddOrderVariant(context.Context, OrderAddVariantRequest) (OrderAddVariantResult, error)
}

type OrderCustomItemAdder interface {
	AddOrderCustomItem(context.Context, OrderAddCustomItemRequest) (OrderAddCustomItemResult, error)
}

type OrderLineDiscounter interface {
	AddOrderLineDiscount(context.Context, OrderLineDiscountRequest) (OrderLineDiscountResult, error)
}

type OrderCanceller interface {
	CancelOrder(context.Context, OrderCancellationRequest) (OrderCancellationResult, error)
}

type FulfillmentPublisher interface {
	PublishFulfillment(context.Context, FulfillmentPublishRequest) (FulfillmentPublishResult, error)
}

type DisputeCatalogReader interface {
	FetchDisputeCatalogPage(context.Context, DisputeCatalogPageRequest) (DisputeCatalogPage, error)
}

func ValidateRequest(request ConnectionProbeRequest) error {
	if err := validateCanonicalUUID("tenantId", request.Identity.TenantID); err != nil {
		return err
	}
	if err := validateCanonicalUUID("shopId", request.Identity.ShopID); err != nil {
		return err
	}
	if !validContextID(request.Context.CorrelationID) {
		return errors.New("correlationId must be a 1-128 character ASCII identifier")
	}
	if !validContextID(request.Context.RequestID) {
		return errors.New("requestId must be a 1-128 character ASCII identifier")
	}
	return nil
}

func ValidateProductCatalogPageRequest(request ProductCatalogPageRequest) error {
	if err := ValidateRequest(ConnectionProbeRequest{
		Identity: request.Identity,
		Context:  request.Context,
	}); err != nil {
		return err
	}
	if request.Limit < 1 || request.Limit > 100 {
		return errors.New("limit must be between 1 and 100")
	}
	if !validOpaqueField(request.Cursor, 4096) {
		return errors.New("cursor must be a bounded printable ASCII value")
	}
	if !validOpaqueField(request.Query, 500) {
		return errors.New("query must be a bounded printable ASCII value")
	}
	return nil
}

func ValidateProductCatalogPage(request ProductCatalogPageRequest, page ProductCatalogPage) error {
	if err := ValidateProductCatalogPageRequest(request); err != nil ||
		page.ContractVersion != ProductCatalogContractVersion ||
		page.TenantID != request.Identity.TenantID || page.ShopID != request.Identity.ShopID ||
		page.Products == nil || len(page.Products) > request.Limit ||
		!validOpaqueField(page.PageInfo.EndCursor, 4096) ||
		(page.PageInfo.HasNextPage && strings.TrimSpace(page.PageInfo.EndCursor) == "") {
		return errors.New("Shopify product catalog response is invalid")
	}
	switch page.State {
	case ProductCatalogStateNotConfigured:
		if len(page.Products) != 0 || page.PageInfo.HasNextPage || page.PageInfo.EndCursor != "" || page.FetchedAt != nil {
			return errors.New("Shopify product catalog response is invalid")
		}
		return nil
	case ProductCatalogStateConnected:
		if page.FetchedAt == nil || page.FetchedAt.IsZero() {
			return errors.New("Shopify product catalog response is invalid")
		}
	default:
		return errors.New("Shopify product catalog response is invalid")
	}
	productIDs := make(map[string]struct{}, len(page.Products))
	variantIDs := make(map[string]struct{})
	for _, product := range page.Products {
		if !validShopifyGID(product.ID, "gid://shopify/Product/") ||
			!validRequiredText(product.Title, 512) || !validOptionalText(product.LegacyResourceID, 64) ||
			!validOptionalText(product.Handle, 255) || !validOptionalText(product.Vendor, 255) ||
			!validOptionalText(product.ProductType, 255) || product.Variants == nil ||
			!validCatalogTimestamp(product.PublishedAt) || !validCatalogTimestamp(product.UpdatedAt) {
			return errors.New("Shopify product catalog response is invalid")
		}
		switch product.Status {
		case "", "ACTIVE", "ARCHIVED", "DRAFT", "UNLISTED":
		default:
			return errors.New("Shopify product catalog response is invalid")
		}
		if _, exists := productIDs[product.ID]; exists {
			return errors.New("Shopify product catalog response is invalid")
		}
		productIDs[product.ID] = struct{}{}
		for _, variant := range product.Variants {
			if !validShopifyGID(variant.ID, "gid://shopify/ProductVariant/") ||
				!validRequiredText(variant.Title, 512) || !validOptionalText(variant.LegacyResourceID, 64) ||
				!validOptionalText(variant.SKU, 255) || !validOptionalText(variant.Barcode, 255) ||
				!validOptionalText(variant.Price, 64) ||
				(variant.InventoryItemID != "" && !validShopifyGID(variant.InventoryItemID, "gid://shopify/InventoryItem/")) ||
				(variant.CurrencyCode != "" && !validCurrencyCode(variant.CurrencyCode)) {
				return errors.New("Shopify product catalog response is invalid")
			}
			if _, exists := variantIDs[variant.ID]; exists {
				return errors.New("Shopify product catalog response is invalid")
			}
			variantIDs[variant.ID] = struct{}{}
		}
	}
	return nil
}

func validCatalogTimestamp(value string) bool {
	if value == "" {
		return true
	}
	_, err := time.Parse(time.RFC3339, value)
	return err == nil
}

func ValidateOrderCatalogPageRequest(request OrderCatalogPageRequest) error {
	if err := ValidateRequest(ConnectionProbeRequest{
		Identity: request.Identity,
		Context:  request.Context,
	}); err != nil {
		return err
	}
	if request.Limit < 1 || request.Limit > 100 {
		return errors.New("limit must be between 1 and 100")
	}
	if !validOpaqueField(request.Cursor, 4096) {
		return errors.New("cursor must be a bounded printable ASCII value")
	}
	if !validOpaqueField(request.Query, 500) {
		return errors.New("query must be a bounded printable ASCII value")
	}
	return nil
}

func ValidateOrderCatalogPage(request OrderCatalogPageRequest, page OrderCatalogPage) error {
	if err := ValidateOrderCatalogPageRequest(request); err != nil ||
		page.ContractVersion != OrderCatalogContractVersion ||
		page.TenantID != request.Identity.TenantID || page.ShopID != request.Identity.ShopID ||
		page.Orders == nil || len(page.Orders) > request.Limit ||
		!validOpaqueField(page.PageInfo.EndCursor, 4096) ||
		(page.PageInfo.HasNextPage && strings.TrimSpace(page.PageInfo.EndCursor) == "") {
		return errors.New("Shopify order catalog response is invalid")
	}
	switch page.State {
	case OrderCatalogStateNotConfigured:
		if len(page.Orders) != 0 || page.PageInfo.HasNextPage || page.PageInfo.EndCursor != "" || page.FetchedAt != nil {
			return errors.New("Shopify order catalog response is invalid")
		}
		return nil
	case OrderCatalogStateConnected:
		if page.FetchedAt == nil || page.FetchedAt.IsZero() {
			return errors.New("Shopify order catalog response is invalid")
		}
	default:
		return errors.New("Shopify order catalog response is invalid")
	}
	orderIDs := make(map[string]struct{}, len(page.Orders))
	lineIDs := make(map[string]struct{})
	fulfillmentIDs := make(map[string]struct{})
	for _, order := range page.Orders {
		if !validShopifyGID(order.ID, "gid://shopify/Order/") ||
			!validOptionalText(order.LegacyResourceID, 64) || !validRequiredText(order.Name, 255) ||
			!validOptionalText(order.Email, 320) || !validOptionalText(order.SourceName, 255) ||
			!validRequiredCatalogTimestamp(order.CreatedAt) || !validCatalogTimestamp(order.UpdatedAt) ||
			!validCatalogTimestamp(order.CancelledAt) ||
			!validOptionalText(order.DisplayFinancialStatus, 64) ||
			!validOptionalText(order.DisplayFulfillmentStatus, 64) ||
			order.LineItems == nil || order.Fulfillments == nil ||
			len(order.Fulfillments) > 10 || !validCatalogMoney(order.Total, true) ||
			!validCatalogMoney(order.Subtotal, false) || !validCatalogMoney(order.Shipping, false) ||
			!validCatalogAddress(order.ShippingAddress) || !validCatalogCustomer(order.Customer) {
			return errors.New("Shopify order catalog response is invalid")
		}
		if _, exists := orderIDs[order.ID]; exists {
			return errors.New("Shopify order catalog response is invalid")
		}
		orderIDs[order.ID] = struct{}{}
		for _, gateway := range order.PaymentGatewayNames {
			if !validRequiredText(gateway, 255) {
				return errors.New("Shopify order catalog response is invalid")
			}
		}
		for _, line := range order.LineItems {
			if !validShopifyGID(line.ID, "gid://shopify/LineItem/") ||
				!validOptionalText(line.LegacyResourceID, 64) || !validRequiredText(line.Name, 512) ||
				!validOptionalText(line.Title, 512) || !validOptionalText(line.SKU, 255) ||
				!validOptionalText(line.VariantTitle, 512) || line.Quantity < 0 ||
				(line.ProductID != "" && !validShopifyGID(line.ProductID, "gid://shopify/Product/")) ||
				(line.VariantID != "" && !validShopifyGID(line.VariantID, "gid://shopify/ProductVariant/")) ||
				(line.InventoryItemID != "" && !validShopifyGID(line.InventoryItemID, "gid://shopify/InventoryItem/")) ||
				!validCatalogMoney(line.DiscountedTotal, false) || !validCatalogMoney(line.OriginalUnitPrice, false) {
				return errors.New("Shopify order catalog response is invalid")
			}
			if _, exists := lineIDs[line.ID]; exists {
				return errors.New("Shopify order catalog response is invalid")
			}
			lineIDs[line.ID] = struct{}{}
		}
		for _, fulfillment := range order.Fulfillments {
			if !validShopifyGID(fulfillment.ID, "gid://shopify/Fulfillment/") ||
				!validOptionalText(fulfillment.Status, 64) || !validCatalogTimestamp(fulfillment.CreatedAt) ||
				!validCatalogTimestamp(fulfillment.UpdatedAt) {
				return errors.New("Shopify order catalog response is invalid")
			}
			if _, exists := fulfillmentIDs[fulfillment.ID]; exists {
				return errors.New("Shopify order catalog response is invalid")
			}
			fulfillmentIDs[fulfillment.ID] = struct{}{}
			for _, tracking := range fulfillment.TrackingInfo {
				if !validOptionalText(tracking.Company, 255) || !validOptionalText(tracking.Number, 255) ||
					!validOptionalText(tracking.URL, 2048) {
					return errors.New("Shopify order catalog response is invalid")
				}
			}
		}
	}
	return nil
}

func ValidateCustomerCatalogPageRequest(request CustomerCatalogPageRequest) error {
	if err := ValidateRequest(ConnectionProbeRequest{
		Identity: request.Identity,
		Context:  request.Context,
	}); err != nil {
		return err
	}
	if request.Limit < 1 || request.Limit > 100 {
		return errors.New("limit must be between 1 and 100")
	}
	if !validOpaqueField(request.Cursor, 4096) {
		return errors.New("cursor must be a bounded printable ASCII value")
	}
	if !validOptionalText(request.Query, 200) {
		return errors.New("query must be bounded text")
	}
	return nil
}

func ValidateCustomerCatalogPage(request CustomerCatalogPageRequest, page CustomerCatalogPage) error {
	if err := ValidateCustomerCatalogPageRequest(request); err != nil ||
		page.ContractVersion != CustomerCatalogContractVersion ||
		page.TenantID != request.Identity.TenantID || page.ShopID != request.Identity.ShopID ||
		page.Customers == nil || len(page.Customers) > request.Limit ||
		!validOpaqueField(page.PageInfo.EndCursor, 4096) ||
		(page.PageInfo.HasNextPage && strings.TrimSpace(page.PageInfo.EndCursor) == "") {
		return errors.New("Shopify customer catalog response is invalid")
	}
	switch page.State {
	case OrderCatalogStateNotConfigured:
		if len(page.Customers) != 0 || page.PageInfo.HasNextPage ||
			page.PageInfo.EndCursor != "" || page.FetchedAt != nil {
			return errors.New("Shopify customer catalog response is invalid")
		}
		return nil
	case OrderCatalogStateConnected:
		if page.FetchedAt == nil || page.FetchedAt.IsZero() {
			return errors.New("Shopify customer catalog response is invalid")
		}
	default:
		return errors.New("Shopify customer catalog response is invalid")
	}
	ids := make(map[string]struct{}, len(page.Customers))
	for _, customer := range page.Customers {
		if !validShopifyGID(customer.ID, "gid://shopify/Customer/") ||
			!validOptionalText(customer.LegacyResourceID, 64) ||
			!validRequiredText(customer.DisplayName, 512) ||
			!validOptionalText(customer.Email, 320) || !validOptionalText(customer.Phone, 64) ||
			!validRequiredCatalogTimestamp(customer.CreatedAt) ||
			!validRequiredCatalogTimestamp(customer.UpdatedAt) || customer.Tags == nil ||
			!validUnsignedDecimal(customer.NumberOfOrders) || !validCatalogMoney(customer.TotalSpent, true) ||
			!validCustomerLocation(customer.DefaultLocation) || !validCustomerLastOrder(customer.LastOrder) {
			return errors.New("Shopify customer catalog response is invalid")
		}
		if _, exists := ids[customer.ID]; exists {
			return errors.New("Shopify customer catalog response is invalid")
		}
		ids[customer.ID] = struct{}{}
		for _, tag := range customer.Tags {
			if !validRequiredText(tag, 255) {
				return errors.New("Shopify customer catalog response is invalid")
			}
		}
	}
	return nil
}

func validCustomerLocation(value CatalogCustomerLocation) bool {
	return validOptionalText(value.City, 255) && validOptionalText(value.Province, 255) &&
		validOptionalText(value.Country, 255) && validOptionalText(value.CountryCode, 64)
}

func validCustomerLastOrder(value *CatalogCustomerOrderSummary) bool {
	if value == nil {
		return true
	}
	return validShopifyGID(value.ID, "gid://shopify/Order/") &&
		validRequiredText(value.Name, 255) && validRequiredCatalogTimestamp(value.CreatedAt) &&
		validOptionalText(value.DisplayFinancialStatus, 64) &&
		validOptionalText(value.DisplayFulfillmentStatus, 64) && validCatalogMoney(value.Total, true)
}

func validRequiredCatalogTimestamp(value string) bool {
	return value != "" && validCatalogTimestamp(value)
}

func validCatalogMoney(value CatalogMoney, required bool) bool {
	if value.Amount == "" && value.CurrencyCode == "" {
		return !required
	}
	amount, ok := new(big.Rat).SetString(strings.TrimSpace(value.Amount))
	return ok && amount.Sign() >= 0 && value.Amount == strings.TrimSpace(value.Amount) &&
		validCurrencyCode(value.CurrencyCode)
}

func validCatalogAddress(value CatalogMailingAddress) bool {
	fields := []struct {
		value string
		limit int
	}{
		{value.Name, 512}, {value.FirstName, 255}, {value.LastName, 255}, {value.Company, 255},
		{value.Address1, 512}, {value.Address2, 512}, {value.City, 255}, {value.Province, 255},
		{value.ProvinceCode, 64}, {value.Country, 255}, {value.CountryCode, 64}, {value.Zip, 64}, {value.Phone, 64},
	}
	for _, field := range fields {
		if !validOptionalText(field.value, field.limit) {
			return false
		}
	}
	for _, line := range value.Formatted {
		if !validRequiredText(line, 512) {
			return false
		}
	}
	return true
}

func validCatalogCustomer(value CatalogCustomer) bool {
	return (value.ID == "" || validShopifyGID(value.ID, "gid://shopify/Customer/")) &&
		validOptionalText(value.LegacyResourceID, 64) && validOptionalText(value.DisplayName, 512) &&
		validOptionalText(value.Email, 320) && validOptionalText(value.Phone, 64) &&
		validCatalogTimestamp(value.CreatedAt) && validCatalogTimestamp(value.UpdatedAt) &&
		(value.NumberOfOrders == "" || validUnsignedDecimal(value.NumberOfOrders)) &&
		validCatalogMoney(value.TotalSpent, false) &&
		validCustomerLocation(value.DefaultLocation) && validCustomerLastOrder(value.LastOrder)
}

func validUnsignedDecimal(value string) bool {
	if value == "" || value != strings.TrimSpace(value) {
		return false
	}
	parsed, ok := new(big.Int).SetString(value, 10)
	return ok && parsed.Sign() >= 0
}

func ValidateReturnCatalogPageRequest(request ReturnCatalogPageRequest) error {
	if err := ValidateRequest(ConnectionProbeRequest{
		Identity: request.Identity,
		Context:  request.Context,
	}); err != nil {
		return err
	}
	if request.Limit < 1 || request.Limit > 100 {
		return errors.New("limit must be between 1 and 100")
	}
	if !validOpaqueField(request.Cursor, 4096) {
		return errors.New("cursor must be a bounded printable ASCII value")
	}
	if !validOpaqueField(request.Query, 500) {
		return errors.New("query must be a bounded printable ASCII value")
	}
	return nil
}

func ValidateReturnCatalogPage(request ReturnCatalogPageRequest, page ReturnCatalogPage) error {
	if err := ValidateReturnCatalogPageRequest(request); err != nil ||
		page.ContractVersion != ReturnCatalogContractVersion ||
		page.TenantID != request.Identity.TenantID || page.ShopID != request.Identity.ShopID ||
		page.Returns == nil || !validOpaqueField(page.PageInfo.EndCursor, 4096) ||
		(page.PageInfo.HasNextPage && strings.TrimSpace(page.PageInfo.EndCursor) == "") {
		return errors.New("Shopify return catalog response is invalid")
	}
	if page.State == OrderCatalogStateNotConfigured {
		if len(page.Returns) != 0 || page.PageInfo.HasNextPage || page.PageInfo.EndCursor != "" || page.FetchedAt != nil {
			return errors.New("Shopify return catalog response is invalid")
		}
		return nil
	}
	if page.State != OrderCatalogStateConnected || page.FetchedAt == nil || page.FetchedAt.IsZero() {
		return errors.New("Shopify return catalog response is invalid")
	}
	returnIDs, lineIDs := map[string]struct{}{}, map[string]struct{}{}
	dutyIDs := map[string]struct{}{}
	for _, item := range page.Returns {
		if !validShopifyGID(item.ID, "gid://shopify/Return/") ||
			!validShopifyGID(item.OrderID, "gid://shopify/Order/") ||
			!validOptionalText(item.Name, 300) || !validOptionalText(item.OrderName, 300) ||
			!validRequiredText(item.Status, 64) || !validRequiredCatalogTimestamp(item.CreatedAt) ||
			!validCatalogTimestamp(item.ClosedAt) || !validCatalogTimestamp(item.RequestApprovedAt) ||
			item.TotalQuantity < 1 || item.LineItems == nil {
			return errors.New("Shopify return catalog response is invalid")
		}
		switch item.Status {
		case "CANCELED", "CLOSED", "DECLINED", "OPEN", "REQUESTED":
		default:
			return errors.New("Shopify return catalog response is invalid")
		}
		if _, exists := returnIDs[item.ID]; exists {
			return errors.New("Shopify return catalog response is invalid")
		}
		returnIDs[item.ID] = struct{}{}
		total := 0
		for _, line := range item.LineItems {
			if !validShopifyGID(line.ID, "gid://shopify/ReturnLineItem/") ||
				!validShopifyGID(line.FulfillmentLineID, "gid://shopify/FulfillmentLineItem/") ||
				!validShopifyGID(line.OrderLineID, "gid://shopify/LineItem/") ||
				!validOptionalText(line.Name, 500) || !validOptionalText(line.SKU, 300) ||
				!validOptionalText(line.ReasonHandle, 100) || !validOptionalText(line.ReasonName, 300) ||
				line.Quantity < 1 || line.ProcessableQuantity < 0 || line.ProcessedQuantity < 0 ||
				line.RefundableQuantity < 0 || line.RefundedQuantity < 0 ||
				line.ProcessableQuantity > line.Quantity || line.ProcessedQuantity > line.Quantity ||
				line.RefundableQuantity > line.Quantity || line.RefundedQuantity > line.Quantity {
				return errors.New("Shopify return catalog response is invalid")
			}
			if _, exists := lineIDs[line.ID]; exists {
				return errors.New("Shopify return catalog response is invalid")
			}
			lineIDs[line.ID] = struct{}{}
			for _, duty := range line.Duties {
				if !validShopifyGID(duty.ID, "gid://shopify/Duty/") || !validReturnRefundMoneyBag(duty.Price, false) {
					return errors.New("Shopify return catalog response is invalid")
				}
				if _, exists := dutyIDs[duty.ID]; exists {
					return errors.New("Shopify return catalog response is invalid")
				}
				dutyIDs[duty.ID] = struct{}{}
			}
			total += line.Quantity
		}
		if len(item.LineItems) == 0 || total != item.TotalQuantity {
			return errors.New("Shopify return catalog response is invalid")
		}
	}
	return nil
}

func ValidateReturnDecisionRequest(request ReturnDecisionRequest) error {
	if err := ValidateRequest(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context}); err != nil {
		return err
	}
	if !validShopifyGID(request.ReturnID, "gid://shopify/Return/") {
		return errors.New("returnId must be a Shopify Return GID")
	}
	if !validContextID(request.IdempotencyKey) || len(request.IdempotencyKey) > 100 {
		return errors.New("idempotencyKey must be a 1-100 character ASCII identifier")
	}
	switch request.Decision {
	case ReturnDecisionApprove:
		if request.DeclineReason != "" || request.DeclineNote != "" {
			return errors.New("approve decision must not include decline details")
		}
	case ReturnDecisionDecline:
		switch request.DeclineReason {
		case ReturnDeclineReasonFinalSale, ReturnDeclineReasonOther, ReturnDeclineReasonReturnPeriodEnded:
		default:
			return errors.New("declineReason is invalid")
		}
		if !validEvidenceText(request.DeclineNote, 500) {
			return errors.New("declineNote must be bounded text")
		}
	default:
		return errors.New("return decision is invalid")
	}
	return nil
}

func ValidateReturnDecisionResult(request ReturnDecisionRequest, result ReturnDecisionResult) error {
	if err := ValidateReturnDecisionRequest(request); err != nil ||
		result.ContractVersion != ReturnDecisionContractVersion ||
		result.TenantID != request.Identity.TenantID || result.ShopID != request.Identity.ShopID ||
		result.ReturnID != request.ReturnID || result.UpdatedAt.IsZero() {
		return errors.New("Shopify return decision response is invalid")
	}
	expected := "OPEN"
	if request.Decision == ReturnDecisionDecline {
		expected = "DECLINED"
	}
	if result.Status != expected {
		return errors.New("Shopify return decision response is invalid")
	}
	return nil
}

func ValidateReturnRefundPreviewRequest(request ReturnRefundPreviewRequest) error {
	if err := ValidateRequest(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context}); err != nil {
		return err
	}
	if !validShopifyGID(request.ReturnID, "gid://shopify/Return/") || len(request.LineItems) == 0 || len(request.LineItems) > 100 {
		return errors.New("return refund preview selection is invalid")
	}
	seen := make(map[string]struct{}, len(request.LineItems))
	for _, line := range request.LineItems {
		if !validShopifyGID(line.ReturnLineID, "gid://shopify/ReturnLineItem/") || line.Quantity < 1 || line.Quantity > 100_000 {
			return errors.New("return refund preview line is invalid")
		}
		if _, duplicate := seen[line.ReturnLineID]; duplicate {
			return errors.New("return refund preview lines contain duplicates")
		}
		seen[line.ReturnLineID] = struct{}{}
	}
	duties := make(map[string]struct{}, len(request.RefundDuties))
	if len(request.RefundDuties) > 100 {
		return errors.New("return refund duty selection is invalid")
	}
	for _, duty := range request.RefundDuties {
		if !validShopifyGID(duty.DutyID, "gid://shopify/Duty/") || (duty.RefundType != ReturnRefundDutyFull && duty.RefundType != ReturnRefundDutyProportional) {
			return errors.New("return refund duty selection is invalid")
		}
		if _, duplicate := duties[duty.DutyID]; duplicate {
			return errors.New("return refund duty selection contains duplicates")
		}
		duties[duty.DutyID] = struct{}{}
	}
	return nil
}

func ValidateReturnRefundPreview(request ReturnRefundPreviewRequest, preview ReturnRefundPreview) error {
	if err := ValidateReturnRefundPreviewRequest(request); err != nil ||
		preview.ContractVersion != ReturnRefundPreviewContractVersion ||
		preview.TenantID != request.Identity.TenantID || preview.ShopID != request.Identity.ShopID ||
		preview.ReturnID != request.ReturnID || preview.FetchedAt.IsZero() ||
		!sameReturnRefundLines(request.LineItems, preview.LineItems) || request.RefundShipping != preview.RefundShipping ||
		!sameReturnRefundDuties(request.RefundDuties, preview.RefundDuties) ||
		!validReturnRefundMoneyBag(preview.RefundAmount, true) || !validReturnRefundMoneyBag(preview.MaximumRefundable, true) {
		return errors.New("Shopify return refund preview response is invalid")
	}
	if request.RefundShipping != (preview.ShippingAmount != nil) || (preview.ShippingAmount != nil && !validReturnRefundMoneyBag(*preview.ShippingAmount, true)) ||
		(len(request.RefundDuties) > 0) != (preview.DutyAmount != nil) || (preview.DutyAmount != nil && !validReturnRefundMoneyBag(*preview.DutyAmount, true)) {
		return errors.New("Shopify return refund preview response is invalid")
	}
	switch preview.State {
	case ReturnRefundPreviewRefundable:
		if len(preview.Transactions) == 0 || preview.ExpiresAt == nil || preview.ExpiresAt.IsZero() ||
			!preview.ExpiresAt.After(preview.FetchedAt) || !validOpaqueField(preview.PreviewToken, 4096) {
			return errors.New("Shopify return refund preview response is invalid")
		}
		seen := make(map[string]struct{}, len(preview.Transactions))
		for _, transaction := range preview.Transactions {
			if !validShopifyGID(transaction.ParentTransactionID, "gid://shopify/OrderTransaction/") ||
				!validReturnRefundMoneyBag(transaction.Amount, false) || !validOptionalText(transaction.Gateway, 255) ||
				!validOptionalText(transaction.FormattedGateway, 255) || !validOptionalText(transaction.AccountNumber, 255) {
				return errors.New("Shopify return refund preview response is invalid")
			}
			if _, duplicate := seen[transaction.ParentTransactionID]; duplicate {
				return errors.New("Shopify return refund preview response is invalid")
			}
			seen[transaction.ParentTransactionID] = struct{}{}
		}
	case ReturnRefundPreviewNotRefundable:
		if len(preview.Transactions) != 0 || preview.PreviewToken != "" || preview.ExpiresAt != nil {
			return errors.New("Shopify return refund preview response is invalid")
		}
	default:
		return errors.New("Shopify return refund preview response is invalid")
	}
	return nil
}

func sameReturnRefundLines(expected, actual []ReturnRefundLineSelection) bool {
	if len(expected) != len(actual) {
		return false
	}
	quantities := make(map[string]int, len(expected))
	for _, line := range expected {
		quantities[line.ReturnLineID] = line.Quantity
	}
	for _, line := range actual {
		if quantities[line.ReturnLineID] != line.Quantity {
			return false
		}
		delete(quantities, line.ReturnLineID)
	}
	return len(quantities) == 0
}

func sameReturnRefundDuties(expected, actual []ReturnRefundDutySelection) bool {
	if len(expected) != len(actual) {
		return false
	}
	types := make(map[string]ReturnRefundDutyType, len(expected))
	for _, duty := range expected {
		types[duty.DutyID] = duty.RefundType
	}
	for _, duty := range actual {
		if types[duty.DutyID] != duty.RefundType {
			return false
		}
		delete(types, duty.DutyID)
	}
	return len(types) == 0
}

func validReturnRefundMoneyBag(value ReturnRefundMoneyBag, allowZero bool) bool {
	if !validCatalogMoney(value.ShopMoney, true) || !validCatalogMoney(value.PresentmentMoney, true) {
		return false
	}
	shop, shopOK := new(big.Rat).SetString(value.ShopMoney.Amount)
	presentment, presentmentOK := new(big.Rat).SetString(value.PresentmentMoney.Amount)
	if !shopOK || !presentmentOK {
		return false
	}
	if allowZero {
		return shop.Sign() >= 0 && presentment.Sign() >= 0
	}
	return shop.Sign() > 0 && presentment.Sign() > 0
}

func ValidateReturnRefundProcessRequest(request ReturnRefundProcessRequest) error {
	if err := ValidateReturnRefundPreviewRequest(ReturnRefundPreviewRequest{
		Identity: request.Identity, Context: request.Context, ReturnID: request.ReturnID, LineItems: request.LineItems,
		RefundShipping: request.RefundShipping, RefundDuties: request.RefundDuties,
	}); err != nil {
		return err
	}
	if !validOpaqueField(request.PreviewToken, 4096) || len(request.PreviewToken) < 32 ||
		!validContextID(request.IdempotencyKey) || len(request.IdempotencyKey) > 100 {
		return errors.New("return refund process confirmation is invalid")
	}
	return nil
}

func ValidateReturnRefundProcessResult(request ReturnRefundProcessRequest, result ReturnRefundProcessResult) error {
	if err := ValidateReturnRefundProcessRequest(request); err != nil ||
		result.ContractVersion != ReturnRefundProcessContractVersion || result.TenantID != request.Identity.TenantID ||
		result.ShopID != request.Identity.ShopID || result.ReturnID != request.ReturnID || result.UpdatedAt.IsZero() ||
		!validRequiredText(result.ReturnStatus, 64) || !validReturnRefundMoneyBag(result.RefundAmount, false) {
		return errors.New("Shopify return refund process response is invalid")
	}
	seen := make(map[string]struct{}, len(result.Transactions))
	allSuccess := len(result.Transactions) > 0
	anyPending := false
	anyFailure := false
	for _, transaction := range result.Transactions {
		if !validShopifyGID(transaction.ID, "gid://shopify/OrderTransaction/") ||
			!validShopifyGID(transaction.ParentTransactionID, "gid://shopify/OrderTransaction/") ||
			!validReturnRefundMoneyBag(transaction.Amount, false) {
			return errors.New("Shopify return refund process response is invalid")
		}
		switch transaction.Status {
		case "SUCCESS":
		case "AWAITING_RESPONSE", "PENDING":
			allSuccess = false
			anyPending = true
		case "ERROR", "FAILURE", "UNKNOWN":
			allSuccess = false
			anyFailure = true
		default:
			return errors.New("Shopify return refund process response is invalid")
		}
		if _, duplicate := seen[transaction.ID]; duplicate {
			return errors.New("Shopify return refund process response is invalid")
		}
		seen[transaction.ID] = struct{}{}
	}
	switch result.Outcome {
	case ReturnRefundProcessApplied:
		if !allSuccess {
			return errors.New("Shopify return refund process response is invalid")
		}
	case ReturnRefundProcessPending:
		if allSuccess || !anyPending || anyFailure {
			return errors.New("Shopify return refund process response is invalid")
		}
	case ReturnRefundProcessReviewRequired:
		if allSuccess || (len(result.Transactions) > 0 && anyPending && !anyFailure) {
			return errors.New("Shopify return refund process response is invalid")
		}
	default:
		return errors.New("Shopify return refund process response is invalid")
	}
	return nil
}

func ValidateLocationCatalogPageRequest(request LocationCatalogPageRequest) error {
	if err := ValidateRequest(ConnectionProbeRequest{
		Identity: request.Identity,
		Context:  request.Context,
	}); err != nil {
		return err
	}
	if request.Limit < 1 || request.Limit > 100 {
		return errors.New("limit must be between 1 and 100")
	}
	if !validOpaqueField(request.Cursor, 4096) {
		return errors.New("cursor must be a bounded printable ASCII value")
	}
	return nil
}

func ValidateLocationCatalogPage(request LocationCatalogPageRequest, page LocationCatalogPage) error {
	if err := ValidateLocationCatalogPageRequest(request); err != nil ||
		page.ContractVersion != LocationCatalogContractVersion ||
		page.TenantID != request.Identity.TenantID || page.ShopID != request.Identity.ShopID ||
		page.Locations == nil || len(page.Locations) > request.Limit ||
		!validOpaqueField(page.PageInfo.EndCursor, 4096) ||
		(page.PageInfo.HasNextPage && strings.TrimSpace(page.PageInfo.EndCursor) == "") {
		return errors.New("Shopify location catalog response is invalid")
	}
	if page.State == LocationCatalogStateNotConfigured {
		if len(page.Locations) != 0 || page.PageInfo.HasNextPage || page.PageInfo.EndCursor != "" || page.FetchedAt != nil {
			return errors.New("Shopify location catalog response is invalid")
		}
		return nil
	}
	if page.State != LocationCatalogStateConnected || page.FetchedAt == nil || page.FetchedAt.IsZero() {
		return errors.New("Shopify location catalog response is invalid")
	}
	seen := map[string]struct{}{}
	for _, location := range page.Locations {
		if !validShopifyGID(location.ID, "gid://shopify/Location/") || !validRequiredText(location.Name, 255) ||
			!validOptionalText(location.Address1, 512) || !validOptionalText(location.Address2, 512) ||
			!validOptionalText(location.City, 255) || !validOptionalText(location.Province, 255) ||
			!validOptionalText(location.ProvinceCode, 64) || !validOptionalText(location.Country, 255) ||
			!validOptionalText(location.Zip, 64) ||
			(location.CountryCode != "" && (len(location.CountryCode) != 2 || strings.ToUpper(location.CountryCode) != location.CountryCode)) {
			return errors.New("Shopify location catalog response is invalid")
		}
		if _, exists := seen[location.ID]; exists {
			return errors.New("Shopify location catalog response is invalid")
		}
		seen[location.ID] = struct{}{}
	}
	return nil
}

func ValidateInventoryLevelReadRequest(request InventoryLevelReadRequest) error {
	if err := ValidateRequest(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context}); err != nil {
		return err
	}
	if !validShopifyGID(request.InventoryItemID, "gid://shopify/InventoryItem/") {
		return errors.New("inventoryItemId must be a Shopify InventoryItem GID")
	}
	if !validShopifyGID(request.LocationID, "gid://shopify/Location/") {
		return errors.New("locationId must be a Shopify Location GID")
	}
	return nil
}

func ValidateInventoryLevelSnapshot(request InventoryLevelReadRequest, snapshot InventoryLevelSnapshot) error {
	if err := ValidateInventoryLevelReadRequest(request); err != nil ||
		snapshot.ContractVersion != InventoryLevelContractVersion ||
		snapshot.TenantID != request.Identity.TenantID || snapshot.ShopID != request.Identity.ShopID ||
		snapshot.InventoryItemID != request.InventoryItemID || snapshot.LocationID != request.LocationID {
		return errors.New("Shopify inventory level response is invalid")
	}
	switch snapshot.State {
	case InventoryLevelStateNotConfigured:
		if snapshot.Tracked || snapshot.Active || snapshot.AvailableQuantity != 0 || snapshot.OnHandQuantity != nil || snapshot.FetchedAt != nil {
			return errors.New("Shopify inventory level response is invalid")
		}
	case InventoryLevelStateConnected:
		if snapshot.FetchedAt == nil || snapshot.FetchedAt.IsZero() {
			return errors.New("Shopify inventory level response is invalid")
		}
	default:
		return errors.New("Shopify inventory level response is invalid")
	}
	return nil
}

func ValidateInventorySetRequest(request InventorySetRequest) error {
	if err := ValidateRequest(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context}); err != nil {
		return err
	}
	if !validShopifyGID(request.InventoryItemID, "gid://shopify/InventoryItem/") {
		return errors.New("inventoryItemId must be a Shopify InventoryItem GID")
	}
	if !validShopifyGID(request.LocationID, "gid://shopify/Location/") {
		return errors.New("locationId must be a Shopify Location GID")
	}
	if request.ExpectedAvailable < -1_000_000_000 || request.ExpectedAvailable > 1_000_000_000 ||
		request.TargetAvailable < -1_000_000_000 || request.TargetAvailable > 1_000_000_000 {
		return errors.New("inventory quantity is outside Shopify bounds")
	}
	if !validContextID(request.IdempotencyKey) || len(request.IdempotencyKey) > 100 {
		return errors.New("idempotencyKey must be a 1-100 character ASCII identifier")
	}
	prefix := "xz-erp://inventory-publications/"
	if !strings.HasPrefix(request.ReferenceDocumentURI, prefix) ||
		validateCanonicalUUID("inventoryPublicationId", strings.TrimPrefix(request.ReferenceDocumentURI, prefix)) != nil {
		return errors.New("referenceDocumentUri must identify an XZ ERP inventory publication")
	}
	return nil
}

func ValidateInventorySetResult(request InventorySetRequest, result InventorySetResult) error {
	if err := ValidateInventorySetRequest(request); err != nil ||
		result.ContractVersion != InventorySetContractVersion ||
		result.TenantID != request.Identity.TenantID || result.ShopID != request.Identity.ShopID ||
		result.InventoryItemID != request.InventoryItemID || result.LocationID != request.LocationID ||
		result.ExpectedAvailable != request.ExpectedAvailable || result.TargetAvailable != request.TargetAvailable ||
		result.UpdatedAt.IsZero() {
		return errors.New("Shopify inventory write response is invalid")
	}
	switch result.Outcome {
	case InventorySetOutcomeApplied:
		if result.SafeErrorCode != "" {
			return errors.New("Shopify inventory write response is invalid")
		}
	case InventorySetOutcomeStale:
		if result.SafeErrorCode != "SHOPIFY_INVENTORY_STALE" {
			return errors.New("Shopify inventory write response is invalid")
		}
	case InventorySetOutcomeRejected:
		switch result.SafeErrorCode {
		case "SHOPIFY_INVENTORY_REJECTED", "SHOPIFY_IDEMPOTENCY_BUSY", "SHOPIFY_IDEMPOTENCY_CONFLICT", "SHOPIFY_IDEMPOTENCY_FAILED":
		default:
			return errors.New("Shopify inventory write response is invalid")
		}
	default:
		return errors.New("Shopify inventory write response is invalid")
	}
	return nil
}

func ValidateOrderShippingAddressUpdateRequest(request OrderShippingAddressUpdateRequest) error {
	if err := ValidateRequest(ConnectionProbeRequest{
		Identity: request.Identity,
		Context:  request.Context,
	}); err != nil {
		return err
	}
	if !validShopifyGID(request.OrderID, "gid://shopify/Order/") {
		return errors.New("orderId must be a Shopify Order GID")
	}
	if !validContextID(request.IdempotencyKey) || len(request.IdempotencyKey) > 100 {
		return errors.New("idempotencyKey must be a 1-100 character ASCII identifier")
	}
	address := request.Address
	if !validRequiredText(address.Address1, 300) {
		return errors.New("address.address1 is required and must be at most 300 characters")
	}
	if !validRequiredText(address.City, 120) {
		return errors.New("address.city is required and must be at most 120 characters")
	}
	if len(address.CountryCode) != 2 || strings.ToUpper(address.CountryCode) != address.CountryCode {
		return errors.New("address.countryCode must be a two-letter uppercase code")
	}
	for _, value := range []struct {
		name  string
		text  string
		limit int
	}{
		{"firstName", address.FirstName, 100},
		{"lastName", address.LastName, 100},
		{"company", address.Company, 200},
		{"address2", address.Address2, 300},
		{"provinceCode", address.ProvinceCode, 32},
		{"zip", address.Zip, 32},
		{"phone", address.Phone, 40},
	} {
		if !validOptionalText(value.text, value.limit) {
			return fmt.Errorf("address.%s must be bounded text", value.name)
		}
	}
	return nil
}

func ValidateOrderShippingAddressUpdateResult(
	request OrderShippingAddressUpdateRequest,
	result OrderShippingAddressUpdateResult,
) error {
	if err := ValidateOrderShippingAddressUpdateRequest(request); err != nil ||
		result.ContractVersion != OrderShippingAddressContractVersion ||
		result.TenantID != request.Identity.TenantID ||
		result.ShopID != request.Identity.ShopID ||
		result.OrderID != request.OrderID || result.UpdatedAt.IsZero() ||
		!validCatalogAddress(result.Address) ||
		!sameRequestedMailingAddress(request.Address, result.Address) {
		return errors.New("Shopify order shipping address response is invalid")
	}
	return nil
}

func sameRequestedMailingAddress(expected, actual CatalogMailingAddress) bool {
	return actual.FirstName == expected.FirstName &&
		actual.LastName == expected.LastName &&
		actual.Company == expected.Company &&
		actual.Address1 == expected.Address1 &&
		actual.Address2 == expected.Address2 &&
		actual.City == expected.City &&
		actual.ProvinceCode == expected.ProvinceCode &&
		actual.CountryCode == expected.CountryCode &&
		actual.Zip == expected.Zip && actual.Phone == expected.Phone
}

func ValidateOrderEditQuantityRequest(request OrderEditQuantityRequest) error {
	if err := ValidateRequest(ConnectionProbeRequest{
		Identity: request.Identity,
		Context:  request.Context,
	}); err != nil {
		return err
	}
	if !validShopifyGID(request.OrderID, "gid://shopify/Order/") {
		return errors.New("orderId must be a Shopify Order GID")
	}
	if !validShopifyGID(request.OrderLineID, "gid://shopify/LineItem/") {
		return errors.New("orderLineId must be a Shopify LineItem GID")
	}
	if !validShopifyGID(request.VariantID, "gid://shopify/ProductVariant/") {
		return errors.New("variantId must be a Shopify ProductVariant GID")
	}
	if request.ExpectedQuantity < 1 || request.ExpectedQuantity > 100_000 ||
		request.Quantity < 0 || request.Quantity > 100_000 ||
		request.ExpectedQuantity == request.Quantity {
		return errors.New("order line quantities are invalid or unchanged")
	}
	if request.Quantity > request.ExpectedQuantity && request.Restock {
		return errors.New("restock is only valid when decreasing quantity")
	}
	if !validContextID(request.IdempotencyKey) || len(request.IdempotencyKey) > 100 {
		return errors.New("idempotencyKey must be a 1-100 character ASCII identifier")
	}
	return nil
}

func ValidateOrderAddVariantRequest(request OrderAddVariantRequest) error {
	if err := ValidateRequest(ConnectionProbeRequest{
		Identity: request.Identity,
		Context:  request.Context,
	}); err != nil {
		return err
	}
	if !validShopifyGID(request.OrderID, "gid://shopify/Order/") {
		return errors.New("orderId must be a Shopify Order GID")
	}
	if !validShopifyGID(request.VariantID, "gid://shopify/ProductVariant/") {
		return errors.New("variantId must be a Shopify ProductVariant GID")
	}
	if request.Quantity < 1 || request.Quantity > 100_000 {
		return errors.New("quantity must be between 1 and 100000")
	}
	if !validContextID(request.IdempotencyKey) || len(request.IdempotencyKey) > 100 {
		return errors.New("idempotencyKey must be a 1-100 character ASCII identifier")
	}
	return nil
}

func ValidateOrderAddCustomItemRequest(request OrderAddCustomItemRequest) error {
	if err := ValidateRequest(ConnectionProbeRequest{
		Identity: request.Identity,
		Context:  request.Context,
	}); err != nil {
		return err
	}
	if !validShopifyGID(request.OrderID, "gid://shopify/Order/") {
		return errors.New("orderId must be a Shopify Order GID")
	}
	if !validRequiredText(request.Title, 255) {
		return errors.New("title must be 1-255 characters without control characters")
	}
	amount, ok := new(big.Rat).SetString(strings.TrimSpace(request.UnitPrice.Amount))
	if !ok || amount.Sign() < 0 || !validCurrencyCode(request.UnitPrice.CurrencyCode) {
		return errors.New("unitPrice must be non-negative money with an uppercase currency code")
	}
	if request.Quantity < 1 || request.Quantity > 100_000 {
		return errors.New("quantity must be between 1 and 100000")
	}
	if !validContextID(request.IdempotencyKey) || len(request.IdempotencyKey) > 100 {
		return errors.New("idempotencyKey must be a 1-100 character ASCII identifier")
	}
	return nil
}

func ValidateOrderLineDiscountRequest(request OrderLineDiscountRequest) error {
	if err := ValidateRequest(ConnectionProbeRequest{
		Identity: request.Identity,
		Context:  request.Context,
	}); err != nil {
		return err
	}
	if !validShopifyGID(request.OrderID, "gid://shopify/Order/") {
		return errors.New("orderId must be a Shopify Order GID")
	}
	if !validShopifyGID(request.OrderLineID, "gid://shopify/LineItem/") {
		return errors.New("orderLineId must be a Shopify LineItem GID")
	}
	if !validShopifyGID(request.VariantID, "gid://shopify/ProductVariant/") {
		return errors.New("variantId must be a Shopify ProductVariant GID")
	}
	if request.ExpectedQuantity < 1 || request.ExpectedQuantity > 100_000 {
		return errors.New("expectedQuantity must be between 1 and 100000")
	}
	if !validRequiredText(request.Description, 255) {
		return errors.New("description must be 1-255 characters without control characters")
	}
	expected, ok := new(big.Rat).SetString(strings.TrimSpace(
		request.ExpectedDiscountTotal.Amount))
	if !ok || expected.Sign() < 0 ||
		!validCurrencyCode(request.ExpectedDiscountTotal.CurrencyCode) {
		return errors.New("expectedDiscountTotal must be non-negative money")
	}
	switch request.DiscountType {
	case OrderLineDiscountTypeFixed:
		if request.FixedValue == nil || request.PercentBasisPoints != 0 {
			return errors.New("fixed discount requires only fixedValue")
		}
		fixed, parsed := new(big.Rat).SetString(strings.TrimSpace(
			request.FixedValue.Amount))
		if !parsed || fixed.Sign() <= 0 ||
			request.FixedValue.CurrencyCode != request.ExpectedDiscountTotal.CurrencyCode {
			return errors.New("fixedValue must be positive money in the order currency")
		}
	case OrderLineDiscountTypePercentage:
		if request.FixedValue != nil || request.PercentBasisPoints < 1 ||
			request.PercentBasisPoints > 10_000 {
			return errors.New("percentage discount must be between 1 and 10000 basis points")
		}
	default:
		return errors.New("discountType must be FIXED or PERCENTAGE")
	}
	if !validContextID(request.IdempotencyKey) || len(request.IdempotencyKey) > 100 {
		return errors.New("idempotencyKey must be a 1-100 character ASCII identifier")
	}
	return nil
}

func ValidateOrderCancellationRequest(request OrderCancellationRequest) error {
	if err := ValidateRequest(ConnectionProbeRequest{
		Identity: request.Identity, Context: request.Context,
	}); err != nil {
		return err
	}
	if !validShopifyGID(request.OrderID, "gid://shopify/Order/") {
		return errors.New("orderId must be a Shopify Order GID")
	}
	switch request.Reason {
	case OrderCancellationReasonCustomer, OrderCancellationReasonDeclined,
		OrderCancellationReasonFraud, OrderCancellationReasonInventory,
		OrderCancellationReasonStaff, OrderCancellationReasonOther:
	default:
		return errors.New("reason is not supported")
	}
	if !validOptionalText(request.StaffNote, 180) {
		return errors.New("staffNote must be at most 180 characters without control characters")
	}
	if !validContextID(request.IdempotencyKey) || len(request.IdempotencyKey) > 64 {
		return errors.New("idempotencyKey must be a 1-64 character ASCII identifier")
	}
	return nil
}

func ValidateFulfillmentPublishRequest(request FulfillmentPublishRequest) error {
	if err := ValidateRequest(ConnectionProbeRequest{
		Identity: request.Identity,
		Context:  request.Context,
	}); err != nil {
		return err
	}
	if !validShopifyGID(request.OrderID, "gid://shopify/Order/") {
		return errors.New("orderId must be a Shopify Order GID")
	}
	if !validContextID(request.IdempotencyKey) || len(request.IdempotencyKey) > 100 {
		return errors.New("idempotencyKey must be a 1-100 character ASCII identifier")
	}
	if len(request.Lines) < 1 || len(request.Lines) > 200 {
		return errors.New("lines must contain between 1 and 200 entries")
	}
	seen := map[string]struct{}{}
	for _, line := range request.Lines {
		if !validShopifyGID(line.OrderLineID, "gid://shopify/LineItem/") || line.Quantity < 1 {
			return errors.New("lines must contain Shopify LineItem GIDs and positive quantities")
		}
		if _, exists := seen[line.OrderLineID]; exists {
			return errors.New("lines must not contain duplicate order line IDs")
		}
		seen[line.OrderLineID] = struct{}{}
	}
	if !validRequiredText(request.Tracking.Number, 160) ||
		!validOptionalText(request.Tracking.Company, 120) {
		return errors.New("tracking number is required and tracking company must be bounded text")
	}
	if rawURL := request.Tracking.URL; rawURL != "" {
		if !validOptionalText(rawURL, 2048) {
			return errors.New("tracking URL is invalid")
		}
		parsed, err := url.Parse(rawURL)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") ||
			parsed.Host == "" || parsed.User != nil {
			return errors.New("tracking URL must be an HTTP or HTTPS URL")
		}
	}
	return nil
}

func ValidateFulfillmentPublishResult(
	request FulfillmentPublishRequest,
	result FulfillmentPublishResult,
) error {
	if ValidateFulfillmentPublishRequest(request) != nil ||
		result.ContractVersion != FulfillmentPublishContractVersion ||
		result.TenantID != request.Identity.TenantID ||
		result.ShopID != request.Identity.ShopID ||
		result.OrderID != request.OrderID ||
		len(result.FulfillmentIDs) != 1 || result.UpdatedAt.IsZero() ||
		result.Tracking.Number != request.Tracking.Number ||
		!validOptionalText(result.Tracking.Company, 120) ||
		!validRequiredText(result.Tracking.Number, 160) ||
		!validOptionalText(result.Tracking.URL, 2048) {
		return errors.New("Shopify fulfillment publish response is invalid")
	}
	if !validShopifyGID(result.FulfillmentIDs[0], "gid://shopify/Fulfillment/") {
		return errors.New("Shopify fulfillment publish response is invalid")
	}
	if result.Tracking.URL != "" {
		parsed, err := url.Parse(result.Tracking.URL)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") ||
			parsed.Host == "" || parsed.User != nil {
			return errors.New("Shopify fulfillment publish response is invalid")
		}
	}
	return nil
}

func ValidateDisputeCatalogPageRequest(request DisputeCatalogPageRequest) error {
	if err := ValidateRequest(ConnectionProbeRequest{
		Identity: request.Identity,
		Context:  request.Context,
	}); err != nil {
		return err
	}
	if request.Limit < 1 || request.Limit > 100 {
		return errors.New("limit must be between 1 and 100")
	}
	if !validOpaqueField(request.Cursor, 4096) {
		return errors.New("cursor must be a bounded printable ASCII value")
	}
	return nil
}

func ValidateDisputeCatalogPage(request DisputeCatalogPageRequest, page DisputeCatalogPage) error {
	if err := ValidateDisputeCatalogPageRequest(request); err != nil || page.ContractVersion != DisputeCatalogContractVersion ||
		page.TenantID != request.Identity.TenantID || page.ShopID != request.Identity.ShopID ||
		page.Disputes == nil || len(page.Disputes) > request.Limit ||
		!validOpaqueField(page.PageInfo.EndCursor, 4096) || (page.PageInfo.HasNextPage && strings.TrimSpace(page.PageInfo.EndCursor) == "") {
		return errors.New("Shopify dispute catalog response is invalid")
	}
	if page.State == OrderCatalogStateNotConfigured {
		if len(page.Disputes) != 0 || page.PageInfo.HasNextPage || page.PageInfo.EndCursor != "" || page.FetchedAt != nil {
			return errors.New("Shopify dispute catalog response is invalid")
		}
		return nil
	}
	if page.State != OrderCatalogStateConnected || page.FetchedAt == nil || page.FetchedAt.IsZero() {
		return errors.New("Shopify dispute catalog response is invalid")
	}
	seen := map[string]struct{}{}
	for _, dispute := range page.Disputes {
		if !validShopifyGID(dispute.ID, "gid://shopify/ShopifyPaymentsDispute/") ||
			(dispute.OrderID != "" && !validShopifyGID(dispute.OrderID, "gid://shopify/Order/")) ||
			!validOptionalText(dispute.OrderName, 300) || !validRequiredText(dispute.Status, 64) ||
			!validRequiredText(dispute.Type, 64) || !validRequiredText(dispute.Reason, 255) ||
			!validOptionalText(dispute.NetworkReasonCode, 255) || !validCatalogMoney(dispute.Amount, true) ||
			!validRequiredCatalogTimestamp(dispute.InitiatedAt) || !validCatalogTimestamp(dispute.EvidenceDueBy) ||
			!validCatalogTimestamp(dispute.EvidenceSentOn) || !validCatalogTimestamp(dispute.FinalizedOn) {
			return errors.New("Shopify dispute catalog response is invalid")
		}
		amount, ok := new(big.Rat).SetString(dispute.Amount.Amount)
		if !ok || amount.Sign() <= 0 {
			return errors.New("Shopify dispute catalog response is invalid")
		}
		switch dispute.Status {
		case "ACCEPTED", "LOST", "NEEDS_RESPONSE", "PREVENTED", "UNDER_REVIEW", "WON", "CHARGE_REFUNDED":
		default:
			return errors.New("Shopify dispute catalog response is invalid")
		}
		switch dispute.Type {
		case "CHARGEBACK", "INQUIRY":
		default:
			return errors.New("Shopify dispute catalog response is invalid")
		}
		if _, exists := seen[dispute.ID]; exists {
			return errors.New("Shopify dispute catalog response is invalid")
		}
		seen[dispute.ID] = struct{}{}
	}
	return nil
}

func NotConfiguredSummary(request ConnectionProbeRequest, checkedAt time.Time) ConnectionSummary {
	return newSummary(request, ConnectionStateNotConfigured, checkedAt, nil)
}

func NotConfiguredProductCatalogPage(request ProductCatalogPageRequest) ProductCatalogPage {
	return newProductCatalogPage(request, ProductCatalogStateNotConfigured, nil, CatalogPageInfo{}, time.Time{})
}

func NotConfiguredOrderCatalogPage(request OrderCatalogPageRequest) OrderCatalogPage {
	return newOrderCatalogPage(request, OrderCatalogStateNotConfigured, nil, CatalogPageInfo{}, time.Time{})
}

func NotConfiguredCustomerCatalogPage(request CustomerCatalogPageRequest) CustomerCatalogPage {
	return newCustomerCatalogPage(request, OrderCatalogStateNotConfigured, nil, CatalogPageInfo{}, time.Time{})
}

func NotConfiguredReturnCatalogPage(request ReturnCatalogPageRequest) ReturnCatalogPage {
	return newReturnCatalogPage(request, OrderCatalogStateNotConfigured, nil, CatalogPageInfo{}, time.Time{})
}

func NotConfiguredLocationCatalogPage(request LocationCatalogPageRequest) LocationCatalogPage {
	return newLocationCatalogPage(request, LocationCatalogStateNotConfigured, nil, CatalogPageInfo{}, time.Time{})
}

func NotConfiguredInventoryLevel(request InventoryLevelReadRequest) InventoryLevelSnapshot {
	return newInventoryLevelSnapshot(request, InventoryLevelStateNotConfigured, false, false, 0, nil, time.Time{})
}

func NotConfiguredDisputeCatalogPage(request DisputeCatalogPageRequest) DisputeCatalogPage {
	return newDisputeCatalogPage(request, OrderCatalogStateNotConfigured, nil, CatalogPageInfo{}, time.Time{})
}

func ConnectedProductCatalogPage(
	request ProductCatalogPageRequest,
	products []CatalogProduct,
	pageInfo CatalogPageInfo,
	fetchedAt time.Time,
) ProductCatalogPage {
	return newProductCatalogPage(request, ProductCatalogStateConnected, products, pageInfo, fetchedAt)
}

func ConnectedOrderCatalogPage(
	request OrderCatalogPageRequest,
	orders []CatalogOrder,
	pageInfo CatalogPageInfo,
	fetchedAt time.Time,
) OrderCatalogPage {
	return newOrderCatalogPage(request, OrderCatalogStateConnected, orders, pageInfo, fetchedAt)
}

func ConnectedCustomerCatalogPage(
	request CustomerCatalogPageRequest,
	customers []CatalogCustomer,
	pageInfo CatalogPageInfo,
	fetchedAt time.Time,
) CustomerCatalogPage {
	return newCustomerCatalogPage(request, OrderCatalogStateConnected, customers, pageInfo, fetchedAt)
}

func ConnectedReturnCatalogPage(
	request ReturnCatalogPageRequest,
	returns []CatalogReturn,
	pageInfo CatalogPageInfo,
	fetchedAt time.Time,
) ReturnCatalogPage {
	return newReturnCatalogPage(request, OrderCatalogStateConnected, returns, pageInfo, fetchedAt)
}

func ConnectedLocationCatalogPage(
	request LocationCatalogPageRequest,
	locations []CatalogLocation,
	pageInfo CatalogPageInfo,
	fetchedAt time.Time,
) LocationCatalogPage {
	return newLocationCatalogPage(request, LocationCatalogStateConnected, locations, pageInfo, fetchedAt)
}

func ConnectedInventoryLevel(
	request InventoryLevelReadRequest,
	tracked bool,
	active bool,
	available int,
	onHand *int,
	fetchedAt time.Time,
) InventoryLevelSnapshot {
	return newInventoryLevelSnapshot(request, InventoryLevelStateConnected, tracked, active, available, onHand, fetchedAt)
}

func ConnectedSummary(
	request ConnectionProbeRequest,
	checkedAt time.Time,
	grantedScopes []string,
) ConnectionSummary {
	return newSummary(request, ConnectionStateConnected, checkedAt, grantedScopes)
}

func ConnectedShopSummary(
	request ConnectionProbeRequest,
	checkedAt time.Time,
	grantedScopes []string,
	shopName string,
	shopDomain string,
) ConnectionSummary {
	summary := newSummary(request, ConnectionStateConnected, checkedAt, grantedScopes)
	if normalizedName := strings.TrimSpace(shopName); normalizedName != "" {
		summary.ShopName = normalizedName
		summary.ShopDomain = strings.TrimSpace(strings.ToLower(shopDomain))
	}
	return summary
}

func DisconnectedSummary(request ConnectionProbeRequest, checkedAt time.Time, grantedScopes []string) ConnectionSummary {
	return newSummary(request, ConnectionStateDisconnected, checkedAt, grantedScopes)
}

func ValidateConnectionSummary(request ConnectionProbeRequest, summary ConnectionSummary) error {
	if err := ValidateRequest(request); err != nil || summary.ContractVersion != ContractVersion ||
		summary.TenantID != request.Identity.TenantID || summary.ShopID != request.Identity.ShopID ||
		summary.CheckedAt.IsZero() {
		return errors.New("Shopify connector connection response is invalid")
	}
	normalizedScopes := ListUniqueNormalized(summary.GrantedScopes)
	sort.Strings(normalizedScopes)
	if len(normalizedScopes) != len(summary.GrantedScopes) {
		return errors.New("Shopify connector connection response is invalid")
	}
	for index := range normalizedScopes {
		if normalizedScopes[index] != summary.GrantedScopes[index] {
			return errors.New("Shopify connector connection response is invalid")
		}
	}
	if (summary.ShopName == "") != (summary.ShopDomain == "") {
		return errors.New("Shopify connector connection response is invalid")
	}
	if summary.ShopName != "" && ValidateShopIdentity(ShopIdentity{
		Name: summary.ShopName, MyshopifyDomain: summary.ShopDomain,
	}) != nil {
		return errors.New("Shopify connector connection response is invalid")
	}
	switch summary.State {
	case ConnectionStateConnected:
		if len(summary.GrantedScopes) == 0 {
			return errors.New("Shopify connector connection response is invalid")
		}
	case ConnectionStateDisconnected:
	case ConnectionStateNotConfigured:
		if len(summary.GrantedScopes) != 0 {
			return errors.New("Shopify connector connection response is invalid")
		}
	default:
		return errors.New("Shopify connector connection response is invalid")
	}
	return nil
}

func SafeErrorFor(request ConnectionProbeRequest, cause error) *ConnectionProbeError {
	var connectorErr *ConnectionProbeError
	if errors.As(cause, &connectorErr) {
		if normalized := normalizedConnectorError(request, connectorErr); normalized != nil {
			return normalized
		}
	}
	switch {
	case errors.Is(cause, context.Canceled):
		return &ConnectionProbeError{
			Code:          ErrorCodeCanceled,
			Message:       "Shopify connector request was canceled",
			Retryable:     false,
			CorrelationID: safeCorrelationID(request.Context.CorrelationID),
		}
	case errors.Is(cause, context.DeadlineExceeded):
		return &ConnectionProbeError{
			Code:          ErrorCodeTimeout,
			Message:       "Shopify connector request timed out",
			Retryable:     true,
			CorrelationID: safeCorrelationID(request.Context.CorrelationID),
		}
	default:
		return &ConnectionProbeError{
			Code:          ErrorCodeUnavailable,
			Message:       "Shopify connection status is temporarily unavailable",
			Retryable:     true,
			CorrelationID: safeCorrelationID(request.Context.CorrelationID),
		}
	}
}

func normalizedConnectorError(request ConnectionProbeRequest, cause *ConnectionProbeError) *ConnectionProbeError {
	if cause == nil {
		return nil
	}
	correlationID := safeCorrelationID(request.Context.CorrelationID)
	switch cause.Code {
	case ErrorCodeInvalidRequest:
		if cause.Retryable {
			return nil
		}
		return &ConnectionProbeError{Code: ErrorCodeInvalidRequest, Message: "Shopify connector request is invalid", Retryable: false, CorrelationID: correlationID}
	case ErrorCodeForbidden:
		if cause.Retryable {
			return nil
		}
		return &ConnectionProbeError{Code: ErrorCodeForbidden, Message: "Shopify connector access is not available", Retryable: false, CorrelationID: correlationID}
	case ErrorCodeProtectedCustomerDataRequired:
		if cause.Retryable {
			return nil
		}
		return &ConnectionProbeError{Code: ErrorCodeProtectedCustomerDataRequired, Message: "Shopify protected customer data access is required", Retryable: false, CorrelationID: correlationID}
	case ErrorCodeCanceled:
		if cause.Retryable {
			return nil
		}
		return &ConnectionProbeError{Code: ErrorCodeCanceled, Message: "Shopify connector request was canceled", Retryable: false, CorrelationID: correlationID}
	case ErrorCodeTimeout:
		if !cause.Retryable {
			return nil
		}
		return &ConnectionProbeError{Code: ErrorCodeTimeout, Message: "Shopify connector request timed out", Retryable: true, CorrelationID: correlationID}
	case ErrorCodeUnavailable:
		if !cause.Retryable {
			return nil
		}
		return &ConnectionProbeError{Code: ErrorCodeUnavailable, Message: "Shopify connection status is temporarily unavailable", Retryable: true, CorrelationID: correlationID}
	default:
		return nil
	}
}

func InvalidRequestError(request ConnectionProbeRequest) *ConnectionProbeError {
	return &ConnectionProbeError{
		Code:          ErrorCodeInvalidRequest,
		Message:       "Shopify connector request is invalid",
		Retryable:     false,
		CorrelationID: safeCorrelationID(request.Context.CorrelationID),
	}
}

func SafeCatalogErrorFor(request ProductCatalogPageRequest, cause error) *ConnectionProbeError {
	return SafeErrorFor(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context}, cause)
}

func InvalidCatalogRequestError(request ProductCatalogPageRequest) *ConnectionProbeError {
	return InvalidRequestError(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context})
}

func ForbiddenCatalogError(request ProductCatalogPageRequest) *ConnectionProbeError {
	return &ConnectionProbeError{
		Code:          ErrorCodeForbidden,
		Message:       "Shopify product read access is not available",
		Retryable:     false,
		CorrelationID: safeCorrelationID(request.Context.CorrelationID),
	}
}

func ForbiddenOrderCatalogError(request OrderCatalogPageRequest) *ConnectionProbeError {
	return &ConnectionProbeError{
		Code:          ErrorCodeForbidden,
		Message:       "Shopify order read access is not available",
		Retryable:     false,
		CorrelationID: safeCorrelationID(request.Context.CorrelationID),
	}
}

func ProtectedCustomerDataOrderCatalogError(request OrderCatalogPageRequest) *ConnectionProbeError {
	return &ConnectionProbeError{
		Code:          ErrorCodeProtectedCustomerDataRequired,
		Message:       "Shopify protected customer data access is required",
		Retryable:     false,
		CorrelationID: safeCorrelationID(request.Context.CorrelationID),
	}
}

func SafeOrderCatalogErrorFor(request OrderCatalogPageRequest, cause error) *ConnectionProbeError {
	return SafeErrorFor(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context}, cause)
}

func SafeCustomerCatalogErrorFor(request CustomerCatalogPageRequest, cause error) *ConnectionProbeError {
	return SafeErrorFor(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context}, cause)
}

func InvalidCustomerCatalogRequestError(request CustomerCatalogPageRequest) *ConnectionProbeError {
	return InvalidRequestError(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context})
}

func ForbiddenCustomerCatalogError(request CustomerCatalogPageRequest) *ConnectionProbeError {
	return &ConnectionProbeError{
		Code:          ErrorCodeForbidden,
		Message:       "Shopify customer read access is not available",
		Retryable:     false,
		CorrelationID: safeCorrelationID(request.Context.CorrelationID),
	}
}

func ProtectedCustomerDataCustomerCatalogError(request CustomerCatalogPageRequest) *ConnectionProbeError {
	return &ConnectionProbeError{
		Code:          ErrorCodeProtectedCustomerDataRequired,
		Message:       "Shopify protected customer data access is required",
		Retryable:     false,
		CorrelationID: safeCorrelationID(request.Context.CorrelationID),
	}
}

func SafeReturnCatalogErrorFor(request ReturnCatalogPageRequest, cause error) *ConnectionProbeError {
	return SafeErrorFor(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context}, cause)
}

func SafeReturnDecisionErrorFor(request ReturnDecisionRequest, cause error) *ConnectionProbeError {
	return SafeErrorFor(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context}, cause)
}

func InvalidReturnDecisionRequestError(request ReturnDecisionRequest) *ConnectionProbeError {
	return InvalidRequestError(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context})
}

func ForbiddenReturnDecisionError(request ReturnDecisionRequest) *ConnectionProbeError {
	return &ConnectionProbeError{
		Code: ErrorCodeForbidden, Message: "Shopify return write access is not available",
		Retryable: false, CorrelationID: safeCorrelationID(request.Context.CorrelationID),
	}
}

func SafeReturnRefundPreviewErrorFor(request ReturnRefundPreviewRequest, cause error) *ConnectionProbeError {
	return SafeErrorFor(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context}, cause)
}

func InvalidReturnRefundPreviewRequestError(request ReturnRefundPreviewRequest) *ConnectionProbeError {
	return InvalidRequestError(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context})
}

func ForbiddenReturnRefundPreviewError(request ReturnRefundPreviewRequest) *ConnectionProbeError {
	return &ConnectionProbeError{
		Code: ErrorCodeForbidden, Message: "Shopify return refund preview access is not available",
		Retryable: false, CorrelationID: safeCorrelationID(request.Context.CorrelationID),
	}
}

func SafeReturnRefundProcessErrorFor(request ReturnRefundProcessRequest, cause error) *ConnectionProbeError {
	return SafeErrorFor(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context}, cause)
}

func InvalidReturnRefundProcessRequestError(request ReturnRefundProcessRequest) *ConnectionProbeError {
	return InvalidRequestError(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context})
}

func ForbiddenReturnRefundProcessError(request ReturnRefundProcessRequest) *ConnectionProbeError {
	return &ConnectionProbeError{
		Code: ErrorCodeForbidden, Message: "Shopify return refund processing access is not available",
		Retryable: false, CorrelationID: safeCorrelationID(request.Context.CorrelationID),
	}
}

func SafeLocationCatalogErrorFor(request LocationCatalogPageRequest, cause error) *ConnectionProbeError {
	return SafeErrorFor(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context}, cause)
}

func InvalidLocationCatalogRequestError(request LocationCatalogPageRequest) *ConnectionProbeError {
	return InvalidRequestError(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context})
}

func ForbiddenLocationCatalogError(request LocationCatalogPageRequest) *ConnectionProbeError {
	return &ConnectionProbeError{
		Code:          ErrorCodeForbidden,
		Message:       "Shopify location read access is not available",
		Retryable:     false,
		CorrelationID: safeCorrelationID(request.Context.CorrelationID),
	}
}

func SafeInventoryLevelErrorFor(request InventoryLevelReadRequest, cause error) *ConnectionProbeError {
	return SafeErrorFor(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context}, cause)
}

func InvalidInventoryLevelRequestError(request InventoryLevelReadRequest) *ConnectionProbeError {
	return InvalidRequestError(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context})
}

func ForbiddenInventoryLevelError(request InventoryLevelReadRequest) *ConnectionProbeError {
	return &ConnectionProbeError{
		Code: ErrorCodeForbidden, Message: "Shopify inventory read access is not available",
		Retryable: false, CorrelationID: safeCorrelationID(request.Context.CorrelationID),
	}
}

func AppliedInventorySetResult(request InventorySetRequest, updatedAt time.Time) InventorySetResult {
	return newInventorySetResult(request, InventorySetOutcomeApplied, "", updatedAt)
}

func StaleInventorySetResult(request InventorySetRequest, updatedAt time.Time) InventorySetResult {
	return newInventorySetResult(request, InventorySetOutcomeStale, "SHOPIFY_INVENTORY_STALE", updatedAt)
}

func RejectedInventorySetResult(request InventorySetRequest, safeErrorCode string, updatedAt time.Time) InventorySetResult {
	return newInventorySetResult(request, InventorySetOutcomeRejected, safeErrorCode, updatedAt)
}

func SafeInventorySetErrorFor(request InventorySetRequest, cause error) *ConnectionProbeError {
	return SafeErrorFor(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context}, cause)
}

func InvalidInventorySetRequestError(request InventorySetRequest) *ConnectionProbeError {
	return InvalidRequestError(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context})
}

func ForbiddenInventorySetError(request InventorySetRequest) *ConnectionProbeError {
	return &ConnectionProbeError{
		Code: ErrorCodeForbidden, Message: "Shopify inventory write access is not available",
		Retryable: false, CorrelationID: safeCorrelationID(request.Context.CorrelationID),
	}
}

func InvalidOrderCatalogRequestError(request OrderCatalogPageRequest) *ConnectionProbeError {
	return InvalidRequestError(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context})
}

func InvalidReturnCatalogRequestError(request ReturnCatalogPageRequest) *ConnectionProbeError {
	return InvalidRequestError(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context})
}

func ForbiddenReturnCatalogError(request ReturnCatalogPageRequest) *ConnectionProbeError {
	return &ConnectionProbeError{
		Code:          ErrorCodeForbidden,
		Message:       "Shopify return read access is not available",
		Retryable:     false,
		CorrelationID: safeCorrelationID(request.Context.CorrelationID),
	}
}

func SafeOrderShippingAddressErrorFor(request OrderShippingAddressUpdateRequest, cause error) *ConnectionProbeError {
	return SafeErrorFor(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context}, cause)
}

func InvalidOrderShippingAddressRequestError(request OrderShippingAddressUpdateRequest) *ConnectionProbeError {
	return InvalidRequestError(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context})
}

func ForbiddenOrderShippingAddressError(request OrderShippingAddressUpdateRequest) *ConnectionProbeError {
	return &ConnectionProbeError{
		Code:          ErrorCodeForbidden,
		Message:       "Shopify order write access is not available",
		Retryable:     false,
		CorrelationID: safeCorrelationID(request.Context.CorrelationID),
	}
}

func SafeOrderEditQuantityErrorFor(request OrderEditQuantityRequest, cause error) *ConnectionProbeError {
	return SafeErrorFor(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context}, cause)
}

func InvalidOrderEditQuantityRequestError(request OrderEditQuantityRequest) *ConnectionProbeError {
	return InvalidRequestError(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context})
}

func ForbiddenOrderEditQuantityError(request OrderEditQuantityRequest) *ConnectionProbeError {
	return &ConnectionProbeError{
		Code:          ErrorCodeForbidden,
		Message:       "Shopify order edit access is not available",
		Retryable:     false,
		CorrelationID: safeCorrelationID(request.Context.CorrelationID),
	}
}

func SafeOrderAddVariantErrorFor(request OrderAddVariantRequest, cause error) *ConnectionProbeError {
	return SafeErrorFor(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context}, cause)
}

func InvalidOrderAddVariantRequestError(request OrderAddVariantRequest) *ConnectionProbeError {
	return InvalidRequestError(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context})
}

func ForbiddenOrderAddVariantError(request OrderAddVariantRequest) *ConnectionProbeError {
	return &ConnectionProbeError{
		Code:          ErrorCodeForbidden,
		Message:       "Shopify order edit access is not available",
		Retryable:     false,
		CorrelationID: safeCorrelationID(request.Context.CorrelationID),
	}
}

func SafeOrderAddCustomItemErrorFor(request OrderAddCustomItemRequest, cause error) *ConnectionProbeError {
	return SafeErrorFor(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context}, cause)
}

func InvalidOrderAddCustomItemRequestError(request OrderAddCustomItemRequest) *ConnectionProbeError {
	return InvalidRequestError(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context})
}

func ForbiddenOrderAddCustomItemError(request OrderAddCustomItemRequest) *ConnectionProbeError {
	return &ConnectionProbeError{
		Code:          ErrorCodeForbidden,
		Message:       "Shopify order edit access is not available",
		Retryable:     false,
		CorrelationID: safeCorrelationID(request.Context.CorrelationID),
	}
}

func SafeOrderLineDiscountErrorFor(request OrderLineDiscountRequest, cause error) *ConnectionProbeError {
	return SafeErrorFor(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context}, cause)
}

func InvalidOrderLineDiscountRequestError(request OrderLineDiscountRequest) *ConnectionProbeError {
	return InvalidRequestError(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context})
}

func ForbiddenOrderLineDiscountError(request OrderLineDiscountRequest) *ConnectionProbeError {
	return &ConnectionProbeError{
		Code:          ErrorCodeForbidden,
		Message:       "Shopify order edit access is not available",
		Retryable:     false,
		CorrelationID: safeCorrelationID(request.Context.CorrelationID),
	}
}

func SafeOrderCancellationErrorFor(request OrderCancellationRequest, cause error) *ConnectionProbeError {
	return SafeErrorFor(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context}, cause)
}

func InvalidOrderCancellationRequestError(request OrderCancellationRequest) *ConnectionProbeError {
	return InvalidRequestError(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context})
}

func ForbiddenOrderCancellationError(request OrderCancellationRequest) *ConnectionProbeError {
	return &ConnectionProbeError{
		Code: ErrorCodeForbidden, Message: "Shopify order cancellation access is not available",
		Retryable: false, CorrelationID: safeCorrelationID(request.Context.CorrelationID),
	}
}

func SafeFulfillmentPublishErrorFor(request FulfillmentPublishRequest, cause error) *ConnectionProbeError {
	return SafeErrorFor(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context}, cause)
}

func InvalidFulfillmentPublishRequestError(request FulfillmentPublishRequest) *ConnectionProbeError {
	return InvalidRequestError(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context})
}

func ForbiddenFulfillmentPublishError(request FulfillmentPublishRequest) *ConnectionProbeError {
	return &ConnectionProbeError{
		Code:          ErrorCodeForbidden,
		Message:       "Shopify fulfillment write access is not available",
		Retryable:     false,
		CorrelationID: safeCorrelationID(request.Context.CorrelationID),
	}
}

func SafeDisputeCatalogErrorFor(request DisputeCatalogPageRequest, cause error) *ConnectionProbeError {
	return SafeErrorFor(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context}, cause)
}

func InvalidDisputeCatalogRequestError(request DisputeCatalogPageRequest) *ConnectionProbeError {
	return InvalidRequestError(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context})
}

func ForbiddenDisputeCatalogError(request DisputeCatalogPageRequest) *ConnectionProbeError {
	return &ConnectionProbeError{
		Code:          ErrorCodeForbidden,
		Message:       "Shopify dispute read access is not available",
		Retryable:     false,
		CorrelationID: safeCorrelationID(request.Context.CorrelationID),
	}
}

func newSummary(
	request ConnectionProbeRequest,
	state ConnectionState,
	checkedAt time.Time,
	grantedScopes []string,
) ConnectionSummary {
	checkedAt = checkedAt.UTC()
	normalizedScopes := ListUniqueNormalized(grantedScopes)
	sort.Strings(normalizedScopes)
	summary := ConnectionSummary{
		ContractVersion: ContractVersion,
		TenantID:        request.Identity.TenantID,
		ShopID:          request.Identity.ShopID,
		State:           state,
		GrantedScopes:   normalizedScopes,
		CheckedAt:       checkedAt,
	}
	return summary
}

func ListUniqueNormalized(values []string) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		normalized := strings.TrimSpace(strings.ToLower(value))
		if normalized == "" {
			continue
		}
		if _, ok := seen[normalized]; ok {
			continue
		}
		seen[normalized] = struct{}{}
		result = append(result, normalized)
	}
	return result
}

func newProductCatalogPage(
	request ProductCatalogPageRequest,
	state ProductCatalogState,
	products []CatalogProduct,
	pageInfo CatalogPageInfo,
	fetchedAt time.Time,
) ProductCatalogPage {
	if !fetchedAt.IsZero() {
		fetchedAt = fetchedAt.UTC()
	}
	page := ProductCatalogPage{
		ContractVersion: ProductCatalogContractVersion,
		TenantID:        request.Identity.TenantID,
		ShopID:          request.Identity.ShopID,
		State:           state,
		Products:        append([]CatalogProduct(nil), products...),
		PageInfo:        pageInfo,
	}
	if page.Products == nil {
		page.Products = []CatalogProduct{}
	}
	if !fetchedAt.IsZero() {
		page.FetchedAt = &fetchedAt
	}
	return page
}

func newOrderCatalogPage(
	request OrderCatalogPageRequest,
	state OrderCatalogState,
	orders []CatalogOrder,
	pageInfo CatalogPageInfo,
	fetchedAt time.Time,
) OrderCatalogPage {
	if !fetchedAt.IsZero() {
		fetchedAt = fetchedAt.UTC()
	}
	page := OrderCatalogPage{
		ContractVersion: OrderCatalogContractVersion,
		TenantID:        request.Identity.TenantID,
		ShopID:          request.Identity.ShopID,
		State:           state,
		Orders:          append([]CatalogOrder(nil), orders...),
		PageInfo:        pageInfo,
	}
	if page.Orders == nil {
		page.Orders = []CatalogOrder{}
	}
	if !fetchedAt.IsZero() {
		page.FetchedAt = &fetchedAt
	}
	return page
}

func newCustomerCatalogPage(
	request CustomerCatalogPageRequest,
	state OrderCatalogState,
	customers []CatalogCustomer,
	pageInfo CatalogPageInfo,
	fetchedAt time.Time,
) CustomerCatalogPage {
	if !fetchedAt.IsZero() {
		fetchedAt = fetchedAt.UTC()
	}
	page := CustomerCatalogPage{
		ContractVersion: CustomerCatalogContractVersion,
		TenantID:        request.Identity.TenantID,
		ShopID:          request.Identity.ShopID,
		State:           state,
		Customers:       append([]CatalogCustomer(nil), customers...),
		PageInfo:        pageInfo,
	}
	if page.Customers == nil {
		page.Customers = []CatalogCustomer{}
	}
	if !fetchedAt.IsZero() {
		page.FetchedAt = &fetchedAt
	}
	return page
}

func newReturnCatalogPage(
	request ReturnCatalogPageRequest,
	state OrderCatalogState,
	returns []CatalogReturn,
	pageInfo CatalogPageInfo,
	fetchedAt time.Time,
) ReturnCatalogPage {
	if !fetchedAt.IsZero() {
		fetchedAt = fetchedAt.UTC()
	}
	page := ReturnCatalogPage{
		ContractVersion: ReturnCatalogContractVersion,
		TenantID:        request.Identity.TenantID,
		ShopID:          request.Identity.ShopID,
		State:           state,
		Returns:         append([]CatalogReturn(nil), returns...),
		PageInfo:        pageInfo,
	}
	if page.Returns == nil {
		page.Returns = []CatalogReturn{}
	}
	if !fetchedAt.IsZero() {
		page.FetchedAt = &fetchedAt
	}
	return page
}

func newLocationCatalogPage(
	request LocationCatalogPageRequest,
	state LocationCatalogState,
	locations []CatalogLocation,
	pageInfo CatalogPageInfo,
	fetchedAt time.Time,
) LocationCatalogPage {
	if !fetchedAt.IsZero() {
		fetchedAt = fetchedAt.UTC()
	}
	page := LocationCatalogPage{
		ContractVersion: LocationCatalogContractVersion,
		TenantID:        request.Identity.TenantID,
		ShopID:          request.Identity.ShopID,
		State:           state,
		Locations:       append([]CatalogLocation(nil), locations...),
		PageInfo:        pageInfo,
	}
	if page.Locations == nil {
		page.Locations = []CatalogLocation{}
	}
	if !fetchedAt.IsZero() {
		page.FetchedAt = &fetchedAt
	}
	return page
}

func newInventoryLevelSnapshot(
	request InventoryLevelReadRequest,
	state InventoryLevelState,
	tracked bool,
	active bool,
	available int,
	onHand *int,
	fetchedAt time.Time,
) InventoryLevelSnapshot {
	result := InventoryLevelSnapshot{
		ContractVersion: InventoryLevelContractVersion,
		TenantID:        request.Identity.TenantID, ShopID: request.Identity.ShopID,
		State: state, InventoryItemID: request.InventoryItemID, LocationID: request.LocationID,
		Tracked: tracked, Active: active, AvailableQuantity: available,
	}
	if onHand != nil {
		value := *onHand
		result.OnHandQuantity = &value
	}
	if !fetchedAt.IsZero() {
		value := fetchedAt.UTC()
		result.FetchedAt = &value
	}
	return result
}

func newInventorySetResult(
	request InventorySetRequest,
	outcome InventorySetOutcome,
	safeErrorCode string,
	updatedAt time.Time,
) InventorySetResult {
	return InventorySetResult{
		ContractVersion: InventorySetContractVersion,
		TenantID:        request.Identity.TenantID, ShopID: request.Identity.ShopID,
		Outcome: outcome, InventoryItemID: request.InventoryItemID, LocationID: request.LocationID,
		ExpectedAvailable: request.ExpectedAvailable, TargetAvailable: request.TargetAvailable,
		SafeErrorCode: safeErrorCode, UpdatedAt: updatedAt.UTC(),
	}
}

func ConnectedDisputeCatalogPage(
	request DisputeCatalogPageRequest,
	disputes []Dispute,
	pageInfo CatalogPageInfo,
	fetchedAt time.Time,
) DisputeCatalogPage {
	return newDisputeCatalogPage(request, OrderCatalogStateConnected, disputes, pageInfo, fetchedAt)
}

func newDisputeCatalogPage(request DisputeCatalogPageRequest, state OrderCatalogState, disputes []Dispute, pageInfo CatalogPageInfo, fetchedAt time.Time) DisputeCatalogPage {
	if !fetchedAt.IsZero() {
		fetchedAt = fetchedAt.UTC()
	}
	page := DisputeCatalogPage{
		ContractVersion: DisputeCatalogContractVersion,
		TenantID:        request.Identity.TenantID,
		ShopID:          request.Identity.ShopID,
		State:           state,
		Disputes:        append([]Dispute(nil), disputes...),
		PageInfo:        pageInfo,
	}
	if page.Disputes == nil {
		page.Disputes = []Dispute{}
	}
	if !fetchedAt.IsZero() {
		page.FetchedAt = &fetchedAt
	}
	return page
}

func validateCanonicalUUID(field string, value string) error {
	if value == "" || value != strings.TrimSpace(value) {
		return fmt.Errorf("%s must be a canonical UUID", field)
	}
	parsed, err := uuid.Parse(value)
	if err != nil || parsed == uuid.Nil || parsed.String() != value {
		return fmt.Errorf("%s must be a canonical UUID", field)
	}
	return nil
}

func validContextID(value string) bool {
	if value == "" || len(value) > 128 || value != strings.TrimSpace(value) {
		return false
	}
	for _, r := range value {
		if r > unicode.MaxASCII ||
			!(unicode.IsLetter(r) || unicode.IsDigit(r) || strings.ContainsRune("._:-", r)) {
			return false
		}
	}
	return true
}

func validOpaqueField(value string, limit int) bool {
	if value == "" {
		return true
	}
	if len(value) > limit || value != strings.TrimSpace(value) {
		return false
	}
	for _, r := range value {
		if r < 0x20 || r > unicode.MaxASCII {
			return false
		}
	}
	return true
}

func validShopifyGID(value string, prefix string) bool {
	if value != strings.TrimSpace(value) || !strings.HasPrefix(value, prefix) {
		return false
	}
	suffix := strings.TrimPrefix(value, prefix)
	if suffix == "" {
		return false
	}
	for _, r := range suffix {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func validRequiredText(value string, limit int) bool {
	return value != "" && value == strings.TrimSpace(value) && validOptionalText(value, limit)
}

func validCurrencyCode(value string) bool {
	if len(value) != 3 || strings.ToUpper(value) != value {
		return false
	}
	for _, character := range value {
		if character < 'A' || character > 'Z' {
			return false
		}
	}
	return true
}

func validOptionalText(value string, limit int) bool {
	if len(value) > limit || value != strings.TrimSpace(value) {
		return false
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

func validEvidenceText(value string, limit int) bool {
	if len(value) > limit {
		return false
	}
	for _, r := range value {
		if unicode.IsControl(r) && r != '\n' && r != '\r' && r != '\t' {
			return false
		}
	}
	return true
}

func safeCorrelationID(value string) string {
	if validContextID(value) {
		return value
	}
	return ""
}
