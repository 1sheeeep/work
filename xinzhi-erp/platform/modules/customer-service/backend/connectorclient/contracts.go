package connectorclient

import (
	"fmt"
	"time"
)

const (
	ConnectionContractVersion          = "shopify.connector.connection.v3"
	ConnectionProbePath                = "/api/v1/erp-connector/shopify/connection"
	ReturnCatalogContractVersion       = "shopify.connector.return_catalog.v1"
	ReturnCatalogPath                  = "/api/v1/erp-connector/shopify/return-catalog"
	ReturnDecisionContractVersion      = "shopify.connector.return_decision.v1"
	ReturnDecisionPath                 = "/api/v1/erp-connector/shopify/return-decision"
	ReturnRefundPreviewContractVersion = "shopify.connector.return_refund_preview.v1"
	ReturnRefundPreviewPath            = "/api/v1/erp-connector/shopify/return-refund-preview"
	ReturnRefundProcessContractVersion = "shopify.connector.return_refund_process.v1"
	ReturnRefundProcessPath            = "/api/v1/erp-connector/shopify/return-refund-process"
	DisputeCatalogContractVersion      = "shopify.connector.dispute_catalog.v1"
	DisputeCatalogPath                 = "/api/v1/erp-connector/shopify/dispute-catalog"
)

type ShopIdentity struct {
	TenantID string `json:"tenantId"`
	ShopID   string `json:"shopId"`
}

type RequestContext struct {
	CorrelationID string `json:"correlationId"`
	RequestID     string `json:"requestId"`
}

type ScopedRequest struct {
	Identity ShopIdentity   `json:"identity"`
	Context  RequestContext `json:"context"`
}

type ConnectionState string

const (
	ConnectionStateNotConfigured ConnectionState = "NOT_CONFIGURED"
	ConnectionStateDisconnected  ConnectionState = "DISCONNECTED"
	ConnectionStateConnected     ConnectionState = "CONNECTED"
)

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

type ReturnDecision string

const (
	ReturnDecisionApprove ReturnDecision = "APPROVE"
	ReturnDecisionDecline ReturnDecision = "DECLINE"
)

type ReturnCatalogRequest struct {
	Identity ShopIdentity   `json:"identity"`
	Context  RequestContext `json:"context"`
	Limit    int            `json:"limit"`
	Cursor   string         `json:"cursor,omitempty"`
	Query    string         `json:"query,omitempty"`
}

type ReturnCatalogDuty struct {
	ID    string               `json:"id"`
	Price ReturnRefundMoneyBag `json:"price"`
}

type ReturnCatalogLine struct {
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
	Duties              []ReturnCatalogDuty `json:"duties"`
}

type ReturnCatalogItem struct {
	ID                string              `json:"id"`
	Name              string              `json:"name"`
	OrderID           string              `json:"orderId"`
	OrderName         string              `json:"orderName"`
	Status            string              `json:"status"`
	CreatedAt         string              `json:"createdAt"`
	ClosedAt          string              `json:"closedAt,omitempty"`
	RequestApprovedAt string              `json:"requestApprovedAt,omitempty"`
	TotalQuantity     int                 `json:"totalQuantity"`
	LineItems         []ReturnCatalogLine `json:"lineItems"`
}

type ReturnCatalogPage struct {
	ContractVersion string              `json:"contractVersion"`
	TenantID        string              `json:"tenantId"`
	ShopID          string              `json:"shopId"`
	State           CatalogState        `json:"state"`
	Returns         []ReturnCatalogItem `json:"returns"`
	PageInfo        PageInfo            `json:"pageInfo"`
	FetchedAt       *time.Time          `json:"fetchedAt,omitempty"`
}

type ReturnDeclineReason string

const (
	ReturnDeclineReasonFinalSale         ReturnDeclineReason = "FINAL_SALE"
	ReturnDeclineReasonOther             ReturnDeclineReason = "OTHER"
	ReturnDeclineReasonReturnPeriodEnded ReturnDeclineReason = "RETURN_PERIOD_ENDED"
)

type ReturnDecisionRequest struct {
	Identity       ShopIdentity        `json:"identity"`
	Context        RequestContext      `json:"context"`
	ReturnID       string              `json:"returnId"`
	Decision       ReturnDecision      `json:"decision"`
	DeclineReason  ReturnDeclineReason `json:"declineReason,omitempty"`
	DeclineNote    string              `json:"declineNote,omitempty"`
	NotifyCustomer bool                `json:"notifyCustomer"`
	IdempotencyKey string              `json:"idempotencyKey"`
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
	Identity       ShopIdentity                `json:"identity"`
	Context        RequestContext              `json:"context"`
	ReturnID       string                      `json:"returnId"`
	LineItems      []ReturnRefundLineSelection `json:"lineItems"`
	RefundShipping bool                        `json:"refundShipping"`
	RefundDuties   []ReturnRefundDutySelection `json:"refundDuties"`
}

type ReturnRefundMoneyBag struct {
	ShopMoney        Money `json:"shopMoney"`
	PresentmentMoney Money `json:"presentmentMoney"`
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
	Identity       ShopIdentity                `json:"identity"`
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

type CatalogState string

const (
	CatalogStateNotConfigured CatalogState = "NOT_CONFIGURED"
	CatalogStateConnected     CatalogState = "CONNECTED"
)

type PageInfo struct {
	HasNextPage bool   `json:"hasNextPage"`
	EndCursor   string `json:"endCursor,omitempty"`
}

type Money struct {
	Amount       string `json:"amount"`
	CurrencyCode string `json:"currencyCode"`
}

type Dispute struct {
	ID                string `json:"id"`
	OrderID           string `json:"orderId,omitempty"`
	OrderName         string `json:"orderName,omitempty"`
	Status            string `json:"status"`
	Type              string `json:"type"`
	Reason            string `json:"reason"`
	NetworkReasonCode string `json:"networkReasonCode,omitempty"`
	Amount            Money  `json:"amount"`
	InitiatedAt       string `json:"initiatedAt"`
	EvidenceDueBy     string `json:"evidenceDueBy,omitempty"`
	EvidenceSentOn    string `json:"evidenceSentOn,omitempty"`
	FinalizedOn       string `json:"finalizedOn,omitempty"`
}

type DisputeCatalogRequest struct {
	Identity ShopIdentity   `json:"identity"`
	Context  RequestContext `json:"context"`
	Limit    int            `json:"limit"`
	Cursor   string         `json:"cursor,omitempty"`
}

type DisputeCatalogPage struct {
	ContractVersion string       `json:"contractVersion"`
	TenantID        string       `json:"tenantId"`
	ShopID          string       `json:"shopId"`
	State           CatalogState `json:"state"`
	Disputes        []Dispute    `json:"disputes"`
	PageInfo        PageInfo     `json:"pageInfo"`
	FetchedAt       *time.Time   `json:"fetchedAt,omitempty"`
}

type RemoteError struct {
	StatusCode    int    `json:"-"`
	Code          string `json:"code"`
	Message       string `json:"message"`
	Retryable     bool   `json:"retryable"`
	CorrelationID string `json:"correlationId"`
}

func (e *RemoteError) Error() string {
	if e == nil {
		return ""
	}
	if e.Code == "" {
		return fmt.Sprintf("connector request failed with status %d", e.StatusCode)
	}
	return fmt.Sprintf("connector request failed: %s", e.Code)
}
