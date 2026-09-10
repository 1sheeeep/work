package platform

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"
)

const (
	shopifyReturnReadScope            = "read_returns"
	shopifyReturnWriteScope           = "write_returns"
	shopifyDisputeReadScope           = "read_shopify_payments_disputes"
	shopifyRefundPreviewTTL           = 10 * time.Minute
	shopifyRefundOutcomeApplied       = "APPLIED"
	shopifyRefundOutcomePending       = "PENDING"
	shopifyRefundOutcomeReview        = "REVIEW_REQUIRED"
	shopifyRefundPreviewRefundable    = "REFUNDABLE"
	shopifyRefundPreviewNotRefundable = "NOT_REFUNDABLE"
)

type shopifyAfterSalesService interface {
	Returns(context.Context, string, string, string) ([]ShopifyReturn, error)
	DecideReturn(context.Context, string, string, ShopifyReturnDecisionRequest) (ShopifyReturnDecisionResult, error)
	PreviewReturnRefund(context.Context, string, string, ShopifyReturnRefundPreviewRequest) (ShopifyReturnRefundPreview, error)
	ProcessReturnRefund(context.Context, string, string, ShopifyReturnRefundProcessRequest) (ShopifyReturnRefundProcessResult, error)
	Disputes(context.Context, string, string) ([]ShopifyDispute, error)
}

type ShopifyReturn struct {
	ID                string              `json:"id"`
	Name              string              `json:"name"`
	OrderID           string              `json:"orderId"`
	OrderName         string              `json:"orderName"`
	Status            string              `json:"status"`
	CreatedAt         string              `json:"createdAt"`
	ClosedAt          string              `json:"closedAt,omitempty"`
	RequestApprovedAt string              `json:"requestApprovedAt,omitempty"`
	TotalQuantity     int                 `json:"totalQuantity"`
	LineItems         []ShopifyReturnLine `json:"lineItems"`
}

type ShopifyReturnLine struct {
	ID                  string `json:"id"`
	Name                string `json:"name"`
	SKU                 string `json:"sku,omitempty"`
	Reason              string `json:"reason,omitempty"`
	Quantity            int    `json:"quantity"`
	ProcessableQuantity int    `json:"processableQuantity"`
	ProcessedQuantity   int    `json:"processedQuantity"`
	RefundableQuantity  int    `json:"refundableQuantity"`
	RefundedQuantity    int    `json:"refundedQuantity"`
}

type ShopifyReturnDecisionRequest struct {
	ReturnID       string `json:"returnId"`
	Decision       string `json:"decision"`
	NotifyCustomer bool   `json:"notifyCustomer"`
	DeclineReason  string `json:"declineReason,omitempty"`
	DeclineNote    string `json:"declineNote,omitempty"`
}

type ShopifyReturnDecisionResult struct {
	ReturnID             string `json:"returnId"`
	Status               string `json:"status"`
	RecoveredFromShopify bool   `json:"recoveredFromShopify"`
	UpdatedAt            string `json:"updatedAt"`
}

type ShopifyReturnRefundLineSelection struct {
	ReturnLineID string `json:"returnLineId"`
	Quantity     int    `json:"quantity"`
}

type ShopifyMoneyBag struct {
	ShopMoney        ShopifyMoney `json:"shopMoney"`
	PresentmentMoney ShopifyMoney `json:"presentmentMoney"`
}

type ShopifyReturnRefundTransaction struct {
	ParentTransactionID string          `json:"parentTransactionId"`
	Gateway             string          `json:"gateway,omitempty"`
	FormattedGateway    string          `json:"formattedGateway,omitempty"`
	AccountNumber       string          `json:"accountNumber,omitempty"`
	Amount              ShopifyMoneyBag `json:"amount"`
}

type ShopifyReturnRefundPreviewRequest struct {
	ShopID         string                             `json:"-"`
	ReturnID       string                             `json:"returnId"`
	LineItems      []ShopifyReturnRefundLineSelection `json:"lineItems"`
	RefundShipping bool                               `json:"refundShipping"`
}

type ShopifyReturnRefundPreview struct {
	ReturnID          string                             `json:"returnId"`
	State             string                             `json:"state"`
	LineItems         []ShopifyReturnRefundLineSelection `json:"lineItems"`
	RefundShipping    bool                               `json:"refundShipping"`
	RefundAmount      ShopifyMoneyBag                    `json:"refundAmount"`
	MaximumRefundable ShopifyMoneyBag                    `json:"maximumRefundable"`
	ShippingAmount    *ShopifyMoneyBag                   `json:"shippingAmount,omitempty"`
	Transactions      []ShopifyReturnRefundTransaction   `json:"transactions"`
	PreviewToken      string                             `json:"previewToken,omitempty"`
	ExpiresAt         string                             `json:"expiresAt,omitempty"`
}

type ShopifyReturnRefundProcessRequest struct {
	ShopID         string                             `json:"-"`
	ReturnID       string                             `json:"returnId"`
	LineItems      []ShopifyReturnRefundLineSelection `json:"lineItems"`
	RefundShipping bool                               `json:"refundShipping"`
	NotifyCustomer bool                               `json:"notifyCustomer"`
	PreviewToken   string                             `json:"previewToken"`
}

type ShopifyProcessedRefundTransaction struct {
	ID                  string          `json:"id"`
	ParentTransactionID string          `json:"parentTransactionId"`
	Status              string          `json:"status"`
	Amount              ShopifyMoneyBag `json:"amount"`
}

type ShopifyReturnRefundProcessResult struct {
	ReturnID             string                              `json:"returnId"`
	ReturnStatus         string                              `json:"returnStatus"`
	Outcome              string                              `json:"outcome"`
	RefundAmount         ShopifyMoneyBag                     `json:"refundAmount"`
	Transactions         []ShopifyProcessedRefundTransaction `json:"transactions"`
	RecoveredFromShopify bool                                `json:"recoveredFromShopify"`
	ReviewTicketID       string                              `json:"reviewTicketId,omitempty"`
	UpdatedAt            string                              `json:"updatedAt"`
}

type ShopifyDispute struct {
	ID                string       `json:"id"`
	Status            string       `json:"status"`
	Type              string       `json:"type"`
	Reason            string       `json:"reason,omitempty"`
	NetworkReasonCode string       `json:"networkReasonCode,omitempty"`
	Amount            ShopifyMoney `json:"amount"`
	OrderID           string       `json:"orderId,omitempty"`
	OrderName         string       `json:"orderName,omitempty"`
	InitiatedAt       string       `json:"initiatedAt"`
	EvidenceDueBy     string       `json:"evidenceDueBy,omitempty"`
	EvidenceSentOn    string       `json:"evidenceSentOn,omitempty"`
	FinalizedOn       string       `json:"finalizedOn,omitempty"`
}

type shopifyReturnLineNode struct {
	ID                  string `json:"id"`
	Quantity            int    `json:"quantity"`
	ProcessableQuantity int    `json:"processableQuantity"`
	ProcessedQuantity   int    `json:"processedQuantity"`
	RefundableQuantity  int    `json:"refundableQuantity"`
	RefundedQuantity    int    `json:"refundedQuantity"`
	ReturnReason        *struct {
		Name string `json:"name"`
	} `json:"returnReasonDefinition"`
	FulfillmentLineItem *struct {
		LineItem *struct {
			Name string `json:"name"`
			SKU  string `json:"sku"`
		} `json:"lineItem"`
	} `json:"fulfillmentLineItem"`
}

type shopifyReturnNode struct {
	ID                string `json:"id"`
	Name              string `json:"name"`
	Status            string `json:"status"`
	CreatedAt         string `json:"createdAt"`
	ClosedAt          string `json:"closedAt"`
	RequestApprovedAt string `json:"requestApprovedAt"`
	TotalQuantity     int    `json:"totalQuantity"`
	ReturnLineItems   struct {
		Nodes    []shopifyReturnLineNode `json:"nodes"`
		PageInfo struct {
			HasNextPage bool `json:"hasNextPage"`
		} `json:"pageInfo"`
	} `json:"returnLineItems"`
}

const shopifyOrderReturnsQuery = `
query XzdeskOrderReturns($id: ID!) {
  order(id: $id) {
    id name
    returns(first: 50) {
      pageInfo { hasNextPage }
      nodes {
        id name status createdAt closedAt requestApprovedAt totalQuantity
        returnLineItems(first: 100) {
          pageInfo { hasNextPage }
          nodes {
            ... on ReturnLineItem {
              id quantity processableQuantity processedQuantity refundableQuantity refundedQuantity
              returnReasonDefinition { name }
              fulfillmentLineItem { lineItem { name sku } }
            }
          }
        }
      }
    }
  }
}`

func (c shopifyAdminClient) Returns(ctx context.Context, domain, token, orderID string) ([]ShopifyReturn, error) {
	orderID = strings.TrimSpace(orderID)
	if orderID == "" {
		return nil, fmt.Errorf("%w: Shopify order is required", ErrInvalid)
	}
	var data struct {
		Order *struct {
			ID      string `json:"id"`
			Name    string `json:"name"`
			Returns struct {
				Nodes    []shopifyReturnNode `json:"nodes"`
				PageInfo struct {
					HasNextPage bool `json:"hasNextPage"`
				} `json:"pageInfo"`
			} `json:"returns"`
		} `json:"order"`
	}
	if err := c.queryAdminGraphQL(ctx, domain, token, shopifyOrderReturnsQuery, map[string]any{"id": orderID}, &data); err != nil {
		return nil, err
	}
	if data.Order == nil || data.Order.ID != orderID || data.Order.Returns.PageInfo.HasNextPage {
		return nil, fmt.Errorf("%w: Shopify return data is incomplete", ErrConflict)
	}
	items := make([]ShopifyReturn, 0, len(data.Order.Returns.Nodes))
	for _, node := range data.Order.Returns.Nodes {
		if node.ID == "" || node.ReturnLineItems.PageInfo.HasNextPage {
			return nil, fmt.Errorf("%w: Shopify return data is incomplete", ErrConflict)
		}
		item := ShopifyReturn{ID: node.ID, Name: node.Name, OrderID: orderID, OrderName: data.Order.Name, Status: node.Status, CreatedAt: node.CreatedAt, ClosedAt: node.ClosedAt, RequestApprovedAt: node.RequestApprovedAt, TotalQuantity: node.TotalQuantity, LineItems: []ShopifyReturnLine{}}
		for _, line := range node.ReturnLineItems.Nodes {
			if line.FulfillmentLineItem == nil || line.FulfillmentLineItem.LineItem == nil {
				return nil, fmt.Errorf("%w: Shopify return line data is incomplete", ErrConflict)
			}
			mapped := ShopifyReturnLine{ID: line.ID, Name: line.FulfillmentLineItem.LineItem.Name, SKU: line.FulfillmentLineItem.LineItem.SKU, Quantity: line.Quantity, ProcessableQuantity: line.ProcessableQuantity, ProcessedQuantity: line.ProcessedQuantity, RefundableQuantity: line.RefundableQuantity, RefundedQuantity: line.RefundedQuantity}
			if line.ReturnReason != nil {
				mapped.Reason = line.ReturnReason.Name
			}
			item.LineItems = append(item.LineItems, mapped)
		}
		items = append(items, item)
	}
	return items, nil
}

const shopifyReturnStatusQuery = `query XzdeskReturnStatus($id: ID!) { return(id: $id) { id status } }`
const shopifyReturnApproveMutation = `mutation XzdeskReturnApprove($input: ReturnApproveRequestInput!) { returnApproveRequest(input: $input) { return { id status } userErrors { message } } }`
const shopifyReturnDeclineMutation = `mutation XzdeskReturnDecline($input: ReturnDeclineRequestInput!) { returnDeclineRequest(input: $input) { return { id status } userErrors { message } } }`

func (c shopifyAdminClient) DecideReturn(ctx context.Context, domain, token string, request ShopifyReturnDecisionRequest) (ShopifyReturnDecisionResult, error) {
	request.ReturnID = strings.TrimSpace(request.ReturnID)
	request.Decision = strings.ToUpper(strings.TrimSpace(request.Decision))
	request.DeclineNote = strings.TrimSpace(request.DeclineNote)
	if request.ReturnID == "" || (request.Decision != "APPROVE" && request.Decision != "DECLINE") || len(request.DeclineNote) > 5000 {
		return ShopifyReturnDecisionResult{}, fmt.Errorf("%w: return decision is invalid", ErrInvalid)
	}
	expected := "OPEN"
	if request.Decision == "DECLINE" {
		expected = "DECLINED"
	}
	current, err := c.returnStatus(ctx, domain, token, request.ReturnID)
	if err != nil {
		return ShopifyReturnDecisionResult{}, err
	}
	if current == expected {
		return ShopifyReturnDecisionResult{ReturnID: request.ReturnID, Status: expected, RecoveredFromShopify: true, UpdatedAt: time.Now().UTC().Format(time.RFC3339)}, nil
	}
	if current != "REQUESTED" {
		return ShopifyReturnDecisionResult{}, fmt.Errorf("%w: only requested returns can be approved or declined", ErrConflict)
	}
	input := map[string]any{"id": request.ReturnID, "notifyCustomer": request.NotifyCustomer}
	query := shopifyReturnApproveMutation
	var data struct {
		Approve *struct {
			Return     *struct{ ID, Status string } `json:"return"`
			UserErrors []struct {
				Message string `json:"message"`
			} `json:"userErrors"`
		} `json:"returnApproveRequest"`
		Decline *struct {
			Return     *struct{ ID, Status string } `json:"return"`
			UserErrors []struct {
				Message string `json:"message"`
			} `json:"userErrors"`
		} `json:"returnDeclineRequest"`
	}
	if request.Decision == "DECLINE" {
		query = shopifyReturnDeclineMutation
		reason := strings.ToUpper(strings.TrimSpace(request.DeclineReason))
		if reason == "" {
			reason = "OTHER"
		}
		input["declineReason"] = reason
		if note := strings.TrimSpace(request.DeclineNote); note != "" {
			input["declineNote"] = note
		}
	}
	if err := c.queryAdminGraphQL(ctx, domain, token, query, map[string]any{"input": input}, &data); err != nil {
		if status, statusErr := c.returnStatus(ctx, domain, token, request.ReturnID); statusErr == nil && status == expected {
			return ShopifyReturnDecisionResult{ReturnID: request.ReturnID, Status: expected, RecoveredFromShopify: true, UpdatedAt: time.Now().UTC().Format(time.RFC3339)}, nil
		}
		return ShopifyReturnDecisionResult{}, err
	}
	payload := data.Approve
	if request.Decision == "DECLINE" {
		payload = data.Decline
	}
	if payload == nil || len(payload.UserErrors) > 0 || payload.Return == nil || payload.Return.ID != request.ReturnID || payload.Return.Status != expected {
		return ShopifyReturnDecisionResult{}, fmt.Errorf("%w: Shopify rejected the return decision", ErrInvalid)
	}
	return ShopifyReturnDecisionResult{ReturnID: request.ReturnID, Status: expected, UpdatedAt: time.Now().UTC().Format(time.RFC3339)}, nil
}

func (c shopifyAdminClient) returnStatus(ctx context.Context, domain, token, returnID string) (string, error) {
	var data struct {
		Return *struct{ ID, Status string } `json:"return"`
	}
	if err := c.queryAdminGraphQL(ctx, domain, token, shopifyReturnStatusQuery, map[string]any{"id": returnID}, &data); err != nil {
		return "", err
	}
	if data.Return == nil || data.Return.ID != returnID {
		return "", fmt.Errorf("%w: Shopify return was not found", ErrNotFound)
	}
	return data.Return.Status, nil
}

type shopifyRefundPreviewLine struct {
	ID                  string `json:"id"`
	ProcessableQuantity int    `json:"processableQuantity"`
	ProcessedQuantity   int    `json:"processedQuantity"`
	RefundableQuantity  int    `json:"refundableQuantity"`
	RefundedQuantity    int    `json:"refundedQuantity"`
}

type shopifyRefundPreviewToken struct {
	ShopID         string                             `json:"shopId"`
	ReturnID       string                             `json:"returnId"`
	LineItems      []ShopifyReturnRefundLineSelection `json:"lineItems"`
	RefundShipping bool                               `json:"refundShipping"`
	Baseline       []shopifyRefundPreviewLine         `json:"baseline"`
	RefundAmount   ShopifyMoneyBag                    `json:"refundAmount"`
	Transactions   []ShopifyReturnRefundTransaction   `json:"transactions"`
	Digest         string                             `json:"digest"`
	IssuedAt       int64                              `json:"issuedAt"`
	ExpiresAt      int64                              `json:"expiresAt"`
}

const shopifyReturnRefundPreviewQuery = `
query XzdeskReturnRefundPreview($id: ID!, $returnLineItems: [SuggestedOutcomeReturnLineItemInput!]!, $refundShipping: RefundShippingInput) {
  return(id: $id) {
    id status
    returnLineItems(first: 100) {
      pageInfo { hasNextPage }
      nodes { ... on ReturnLineItem { id processableQuantity processedQuantity refundableQuantity refundedQuantity } }
    }
    suggestedFinancialOutcome(returnLineItems: $returnLineItems, exchangeLineItems: [], refundShipping: $refundShipping) {
      maximumRefundable { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
      shipping { amountSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } } }
      financialTransfer {
        __typename
        ... on RefundReturnOutcome {
          amount { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
          suggestedTransactions {
            accountNumber gateway formattedGateway
            amountSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
            parentTransaction { id }
          }
        }
      }
    }
  }
}`

func (c shopifyAdminClient) PreviewReturnRefund(ctx context.Context, domain, token string, request ShopifyReturnRefundPreviewRequest) (ShopifyReturnRefundPreview, error) {
	request.ReturnID = strings.TrimSpace(request.ReturnID)
	request.LineItems = normalizeRefundLines(request.LineItems)
	if request.ShopID == "" || request.ReturnID == "" || !validRefundLines(request.LineItems) {
		return ShopifyReturnRefundPreview{}, fmt.Errorf("%w: refund preview selection is invalid", ErrInvalid)
	}
	lineInputs := make([]map[string]any, 0, len(request.LineItems))
	for _, line := range request.LineItems {
		lineInputs = append(lineInputs, map[string]any{"id": line.ReturnLineID, "quantity": line.Quantity})
	}
	var data struct {
		Return *struct {
			ID              string `json:"id"`
			Status          string `json:"status"`
			ReturnLineItems struct {
				Nodes    []shopifyRefundPreviewLine `json:"nodes"`
				PageInfo struct {
					HasNextPage bool `json:"hasNextPage"`
				} `json:"pageInfo"`
			} `json:"returnLineItems"`
			Outcome *struct {
				MaximumRefundable ShopifyMoneyBag `json:"maximumRefundable"`
				Shipping          *struct {
					AmountSet ShopifyMoneyBag `json:"amountSet"`
				} `json:"shipping"`
				FinancialTransfer *struct {
					Type                  string          `json:"__typename"`
					Amount                ShopifyMoneyBag `json:"amount"`
					SuggestedTransactions []struct {
						AccountNumber, Gateway, FormattedGateway string
						AmountSet                                ShopifyMoneyBag `json:"amountSet"`
						ParentTransaction                        *struct {
							ID string `json:"id"`
						} `json:"parentTransaction"`
					} `json:"suggestedTransactions"`
				} `json:"financialTransfer"`
			} `json:"suggestedFinancialOutcome"`
		} `json:"return"`
	}
	variables := map[string]any{"id": request.ReturnID, "returnLineItems": lineInputs}
	if request.RefundShipping {
		variables["refundShipping"] = map[string]any{"fullRefund": true}
	}
	if err := c.queryAdminGraphQL(ctx, domain, token, shopifyReturnRefundPreviewQuery, variables, &data); err != nil {
		return ShopifyReturnRefundPreview{}, err
	}
	if data.Return == nil || data.Return.ID != request.ReturnID || data.Return.Status != "OPEN" || data.Return.ReturnLineItems.PageInfo.HasNextPage || data.Return.Outcome == nil {
		return ShopifyReturnRefundPreview{}, fmt.Errorf("%w: return is not ready for refund", ErrConflict)
	}
	available := make(map[string]shopifyRefundPreviewLine, len(data.Return.ReturnLineItems.Nodes))
	for _, line := range data.Return.ReturnLineItems.Nodes {
		available[line.ID] = line
	}
	for _, selected := range request.LineItems {
		line, ok := available[selected.ReturnLineID]
		if !ok || selected.Quantity > line.ProcessableQuantity || selected.Quantity > line.RefundableQuantity {
			return ShopifyReturnRefundPreview{}, fmt.Errorf("%w: refund quantity exceeds the current Shopify allowance", ErrConflict)
		}
	}
	preview := ShopifyReturnRefundPreview{ReturnID: request.ReturnID, State: shopifyRefundPreviewNotRefundable, LineItems: request.LineItems, RefundShipping: request.RefundShipping, MaximumRefundable: data.Return.Outcome.MaximumRefundable, Transactions: []ShopifyReturnRefundTransaction{}}
	preview.RefundAmount = zeroMoneyBag(preview.MaximumRefundable)
	if request.RefundShipping {
		if data.Return.Outcome.Shipping == nil {
			return ShopifyReturnRefundPreview{}, fmt.Errorf("%w: shipping refund is unavailable", ErrConflict)
		}
		shipping := data.Return.Outcome.Shipping.AmountSet
		preview.ShippingAmount = &shipping
	}
	transfer := data.Return.Outcome.FinancialTransfer
	if transfer == nil || transfer.Type != "RefundReturnOutcome" {
		return preview, nil
	}
	if len(transfer.SuggestedTransactions) == 0 {
		return ShopifyReturnRefundPreview{}, fmt.Errorf("%w: Shopify returned no refund transaction", ErrConflict)
	}
	preview.State = shopifyRefundPreviewRefundable
	preview.RefundAmount = transfer.Amount
	for _, transaction := range transfer.SuggestedTransactions {
		if transaction.ParentTransaction == nil || transaction.ParentTransaction.ID == "" {
			return ShopifyReturnRefundPreview{}, fmt.Errorf("%w: Shopify refund transaction is incomplete", ErrConflict)
		}
		preview.Transactions = append(preview.Transactions, ShopifyReturnRefundTransaction{ParentTransactionID: transaction.ParentTransaction.ID, Gateway: transaction.Gateway, FormattedGateway: transaction.FormattedGateway, AccountNumber: transaction.AccountNumber, Amount: transaction.AmountSet})
	}
	now := time.Now().UTC()
	expires := now.Add(shopifyRefundPreviewTTL)
	preview.ExpiresAt = expires.Format(time.RFC3339)
	payload := shopifyRefundPreviewToken{ShopID: request.ShopID, ReturnID: request.ReturnID, LineItems: request.LineItems, RefundShipping: request.RefundShipping, RefundAmount: preview.RefundAmount, Transactions: preview.Transactions, Digest: refundPreviewDigest(preview), IssuedAt: now.Unix(), ExpiresAt: expires.Unix()}
	for _, selected := range request.LineItems {
		payload.Baseline = append(payload.Baseline, available[selected.ReturnLineID])
	}
	preview.PreviewToken = signRefundPreview(token, payload)
	return preview, nil
}

func normalizeRefundLines(lines []ShopifyReturnRefundLineSelection) []ShopifyReturnRefundLineSelection {
	out := append([]ShopifyReturnRefundLineSelection(nil), lines...)
	for index := range out {
		out[index].ReturnLineID = strings.TrimSpace(out[index].ReturnLineID)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ReturnLineID < out[j].ReturnLineID })
	return out
}

func validRefundLines(lines []ShopifyReturnRefundLineSelection) bool {
	if len(lines) == 0 || len(lines) > 100 {
		return false
	}
	seen := make(map[string]bool, len(lines))
	for _, line := range lines {
		if line.ReturnLineID == "" || line.Quantity <= 0 || seen[line.ReturnLineID] {
			return false
		}
		seen[line.ReturnLineID] = true
	}
	return true
}

func zeroMoneyBag(value ShopifyMoneyBag) ShopifyMoneyBag {
	return ShopifyMoneyBag{ShopMoney: ShopifyMoney{Amount: "0", CurrencyCode: value.ShopMoney.CurrencyCode}, PresentmentMoney: ShopifyMoney{Amount: "0", CurrencyCode: value.PresentmentMoney.CurrencyCode}}
}

func refundPreviewDigest(preview ShopifyReturnRefundPreview) string {
	value := struct {
		Lines          []ShopifyReturnRefundLineSelection `json:"lines"`
		RefundShipping bool                               `json:"refundShipping"`
		RefundAmount   ShopifyMoneyBag                    `json:"refundAmount"`
		ShippingAmount *ShopifyMoneyBag                   `json:"shippingAmount"`
		Transactions   []ShopifyReturnRefundTransaction   `json:"transactions"`
	}{preview.LineItems, preview.RefundShipping, preview.RefundAmount, preview.ShippingAmount, preview.Transactions}
	raw, _ := json.Marshal(value)
	sum := sha256.Sum256(raw)
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func signRefundPreview(token string, payload shopifyRefundPreviewToken) string {
	raw, _ := json.Marshal(payload)
	mac := hmac.New(sha256.New, []byte("xzdesk-refund-preview\x00"+token))
	_, _ = mac.Write(raw)
	return base64.RawURLEncoding.EncodeToString(raw) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func verifyRefundPreview(token string, request ShopifyReturnRefundProcessRequest) (shopifyRefundPreviewToken, error) {
	parts := strings.Split(strings.TrimSpace(request.PreviewToken), ".")
	if len(parts) != 2 {
		return shopifyRefundPreviewToken{}, errors.New("invalid preview token")
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return shopifyRefundPreviewToken{}, err
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return shopifyRefundPreviewToken{}, err
	}
	mac := hmac.New(sha256.New, []byte("xzdesk-refund-preview\x00"+token))
	_, _ = mac.Write(raw)
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return shopifyRefundPreviewToken{}, errors.New("invalid preview signature")
	}
	var payload shopifyRefundPreviewToken
	if err := json.Unmarshal(raw, &payload); err != nil {
		return shopifyRefundPreviewToken{}, err
	}
	now := time.Now().UTC()
	if payload.ShopID != request.ShopID || payload.ReturnID != request.ReturnID || payload.RefundShipping != request.RefundShipping || !validRefundLines(payload.LineItems) || !sameRefundLines(payload.LineItems, request.LineItems) || len(payload.Baseline) != len(payload.LineItems) || payload.IssuedAt > now.Add(time.Minute).Unix() || payload.IssuedAt >= payload.ExpiresAt {
		return shopifyRefundPreviewToken{}, errors.New("invalid preview payload")
	}
	return payload, nil
}

func sameRefundLines(left, right []ShopifyReturnRefundLineSelection) bool {
	left, right = normalizeRefundLines(left), normalizeRefundLines(right)
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

const shopifyReturnRefundProcessMutation = `
mutation XzdeskReturnRefundProcess($input: ReturnProcessInput!) {
  returnProcess(input: $input) {
    return { ` + shopifyReturnRefundStatusFields + ` }
    userErrors { message }
  }
}`
const shopifyReturnRefundStatusQuery = `query XzdeskReturnRefundStatus($id: ID!) { return(id: $id) { ` + shopifyReturnRefundStatusFields + ` } }`
const shopifyReturnRefundStatusFields = `
  id status
  returnLineItems(first: 100) { pageInfo { hasNextPage } nodes { ... on ReturnLineItem { id processableQuantity processedQuantity refundableQuantity refundedQuantity } } }
  transactions(first: 100, reverse: true) {
    pageInfo { hasNextPage }
    nodes { id kind status createdAt amountSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } } parentTransaction { id } }
  }
`

type shopifyRefundStatusNode struct {
	ID              string `json:"id"`
	Status          string `json:"status"`
	ReturnLineItems struct {
		Nodes    []shopifyRefundPreviewLine `json:"nodes"`
		PageInfo struct {
			HasNextPage bool `json:"hasNextPage"`
		} `json:"pageInfo"`
	} `json:"returnLineItems"`
	Transactions struct {
		Nodes []struct {
			ID                string          `json:"id"`
			Kind              string          `json:"kind"`
			Status            string          `json:"status"`
			CreatedAt         string          `json:"createdAt"`
			AmountSet         ShopifyMoneyBag `json:"amountSet"`
			ParentTransaction *struct {
				ID string `json:"id"`
			} `json:"parentTransaction"`
		} `json:"nodes"`
		PageInfo struct {
			HasNextPage bool `json:"hasNextPage"`
		} `json:"pageInfo"`
	} `json:"transactions"`
}

func (c shopifyAdminClient) ProcessReturnRefund(ctx context.Context, domain, token string, request ShopifyReturnRefundProcessRequest) (ShopifyReturnRefundProcessResult, error) {
	request.ReturnID = strings.TrimSpace(request.ReturnID)
	request.LineItems = normalizeRefundLines(request.LineItems)
	payload, err := verifyRefundPreview(token, request)
	if err != nil {
		return ShopifyReturnRefundProcessResult{}, fmt.Errorf("%w: refund preview expired or changed", ErrConflict)
	}
	if status, statusErr := c.refundStatus(ctx, domain, token, request.ReturnID); statusErr == nil {
		if result, recovered := classifyRefundResult(request, payload, status, true); recovered {
			return result, nil
		}
	}
	if payload.ExpiresAt <= time.Now().UTC().Unix() {
		return ShopifyReturnRefundProcessResult{}, fmt.Errorf("%w: refund preview expired; preview again", ErrConflict)
	}
	fresh, err := c.PreviewReturnRefund(ctx, domain, token, ShopifyReturnRefundPreviewRequest{ShopID: request.ShopID, ReturnID: request.ReturnID, LineItems: request.LineItems, RefundShipping: request.RefundShipping})
	if err != nil || fresh.State != shopifyRefundPreviewRefundable || refundPreviewDigest(fresh) != payload.Digest {
		return ShopifyReturnRefundProcessResult{}, fmt.Errorf("%w: Shopify refund values changed; preview again", ErrConflict)
	}
	lineInputs := make([]map[string]any, 0, len(request.LineItems))
	for _, line := range request.LineItems {
		lineInputs = append(lineInputs, map[string]any{"id": line.ReturnLineID, "quantity": line.Quantity})
	}
	transactionInputs := make([]map[string]any, 0, len(fresh.Transactions))
	for _, transaction := range fresh.Transactions {
		transactionInputs = append(transactionInputs, map[string]any{"parentId": transaction.ParentTransactionID, "transactionAmount": map[string]any{"amount": transaction.Amount.PresentmentMoney.Amount, "currencyCode": transaction.Amount.PresentmentMoney.CurrencyCode}})
	}
	input := map[string]any{"returnId": request.ReturnID, "notifyCustomer": request.NotifyCustomer, "returnLineItems": lineInputs, "financialTransfer": map[string]any{"issueRefund": map[string]any{"orderTransactions": transactionInputs}}}
	if request.RefundShipping {
		input["refundShipping"] = map[string]any{"fullRefund": true}
	}
	var data struct {
		ReturnProcess *struct {
			Return     *shopifyRefundStatusNode `json:"return"`
			UserErrors []struct {
				Message string `json:"message"`
			} `json:"userErrors"`
		} `json:"returnProcess"`
	}
	mutationErr := c.queryAdminGraphQL(ctx, domain, token, shopifyReturnRefundProcessMutation, map[string]any{"input": input}, &data)
	if mutationErr == nil && data.ReturnProcess != nil && len(data.ReturnProcess.UserErrors) == 0 && data.ReturnProcess.Return != nil {
		if result, ok := classifyRefundResult(request, payload, *data.ReturnProcess.Return, false); ok {
			return result, nil
		}
		mutationErr = fmt.Errorf("%w: Shopify refund result is incomplete", ErrConflict)
	} else if mutationErr == nil {
		mutationErr = fmt.Errorf("%w: Shopify rejected the refund", ErrInvalid)
	}
	if status, statusErr := c.refundStatus(ctx, domain, token, request.ReturnID); statusErr == nil {
		if result, recovered := classifyRefundResult(request, payload, status, true); recovered {
			return result, nil
		}
	}
	return ShopifyReturnRefundProcessResult{}, mutationErr
}

func (c shopifyAdminClient) refundStatus(ctx context.Context, domain, token, returnID string) (shopifyRefundStatusNode, error) {
	var data struct {
		Return *shopifyRefundStatusNode `json:"return"`
	}
	if err := c.queryAdminGraphQL(ctx, domain, token, shopifyReturnRefundStatusQuery, map[string]any{"id": returnID}, &data); err != nil {
		return shopifyRefundStatusNode{}, err
	}
	if data.Return == nil || data.Return.ID != returnID {
		return shopifyRefundStatusNode{}, ErrNotFound
	}
	return *data.Return, nil
}

func classifyRefundResult(request ShopifyReturnRefundProcessRequest, payload shopifyRefundPreviewToken, node shopifyRefundStatusNode, recovered bool) (ShopifyReturnRefundProcessResult, bool) {
	if node.ID != request.ReturnID || node.ReturnLineItems.PageInfo.HasNextPage {
		return ShopifyReturnRefundProcessResult{}, false
	}
	current := make(map[string]shopifyRefundPreviewLine, len(node.ReturnLineItems.Nodes))
	for _, line := range node.ReturnLineItems.Nodes {
		current[line.ID] = line
	}
	quantities := make(map[string]int, len(request.LineItems))
	for _, line := range request.LineItems {
		quantities[line.ReturnLineID] = line.Quantity
	}
	allProcessed, anyProgress := true, false
	for _, baseline := range payload.Baseline {
		line, exists := current[baseline.ID]
		processed := exists && (line.ProcessedQuantity >= baseline.ProcessedQuantity+quantities[baseline.ID] || line.ProcessableQuantity <= baseline.ProcessableQuantity-quantities[baseline.ID])
		allProcessed = allProcessed && processed
		anyProgress = anyProgress || processed
	}
	matched := make([]ShopifyProcessedRefundTransaction, 0, len(payload.Transactions))
	for _, expected := range payload.Transactions {
		for _, actual := range node.Transactions.Nodes {
			createdAt, err := time.Parse(time.RFC3339, actual.CreatedAt)
			if err != nil || createdAt.Unix() < payload.IssuedAt-60 || actual.Kind != "REFUND" || actual.ParentTransaction == nil || actual.ParentTransaction.ID != expected.ParentTransactionID || actual.AmountSet.PresentmentMoney != expected.Amount.PresentmentMoney {
				continue
			}
			matched = append(matched, ShopifyProcessedRefundTransaction{ID: actual.ID, ParentTransactionID: actual.ParentTransaction.ID, Status: actual.Status, Amount: actual.AmountSet})
			break
		}
	}
	if !allProcessed || len(matched) != len(payload.Transactions) {
		if !anyProgress && len(matched) == 0 {
			return ShopifyReturnRefundProcessResult{}, false
		}
		return ShopifyReturnRefundProcessResult{ReturnID: request.ReturnID, ReturnStatus: node.Status, Outcome: shopifyRefundOutcomeReview, RefundAmount: payload.RefundAmount, Transactions: matched, RecoveredFromShopify: true, UpdatedAt: time.Now().UTC().Format(time.RFC3339)}, true
	}
	outcome := shopifyRefundOutcomeApplied
	for _, transaction := range matched {
		switch transaction.Status {
		case "SUCCESS":
		case "AWAITING_RESPONSE", "PENDING":
			if outcome == shopifyRefundOutcomeApplied {
				outcome = shopifyRefundOutcomePending
			}
		default:
			outcome = shopifyRefundOutcomeReview
		}
	}
	return ShopifyReturnRefundProcessResult{ReturnID: request.ReturnID, ReturnStatus: node.Status, Outcome: outcome, RefundAmount: payload.RefundAmount, Transactions: matched, RecoveredFromShopify: recovered, UpdatedAt: time.Now().UTC().Format(time.RFC3339)}, true
}

type shopifyDisputeNode struct {
	ID, Status, Type, InitiatedAt, EvidenceDueBy, EvidenceSentOn, FinalizedOn string
	Amount                                                                    ShopifyMoney                               `json:"amount"`
	ReasonDetails                                                             struct{ Reason, NetworkReasonCode string } `json:"reasonDetails"`
	Order                                                                     *struct{ ID, Name string }                 `json:"order"`
}

const shopifyDisputesQuery = `
query XzdeskDisputes {
  disputes(first: 100) {
    pageInfo { hasNextPage }
    nodes {
      id status type initiatedAt evidenceDueBy evidenceSentOn finalizedOn
      amount { amount currencyCode }
      reasonDetails { reason networkReasonCode }
      order { id name }
    }
  }
}`

func (c shopifyAdminClient) Disputes(ctx context.Context, domain, token string) ([]ShopifyDispute, error) {
	var data struct {
		Disputes struct {
			Nodes    []shopifyDisputeNode `json:"nodes"`
			PageInfo struct {
				HasNextPage bool `json:"hasNextPage"`
			} `json:"pageInfo"`
		} `json:"disputes"`
	}
	if err := c.queryAdminGraphQL(ctx, domain, token, shopifyDisputesQuery, nil, &data); err != nil {
		return nil, err
	}
	if data.Disputes.PageInfo.HasNextPage {
		return nil, fmt.Errorf("%w: Shopify dispute data is incomplete", ErrConflict)
	}
	items := make([]ShopifyDispute, 0, len(data.Disputes.Nodes))
	for _, node := range data.Disputes.Nodes {
		mapped, err := mapShopifyDispute(node)
		if err != nil {
			return nil, err
		}
		items = append(items, mapped)
	}
	return items, nil
}

func mapShopifyDispute(node shopifyDisputeNode) (ShopifyDispute, error) {
	if node.ID == "" {
		return ShopifyDispute{}, fmt.Errorf("%w: Shopify dispute data is incomplete", ErrConflict)
	}
	item := ShopifyDispute{ID: node.ID, Status: node.Status, Type: node.Type, Reason: node.ReasonDetails.Reason, NetworkReasonCode: node.ReasonDetails.NetworkReasonCode, Amount: node.Amount, InitiatedAt: node.InitiatedAt, EvidenceDueBy: node.EvidenceDueBy, EvidenceSentOn: node.EvidenceSentOn, FinalizedOn: node.FinalizedOn}
	if node.Order != nil {
		item.OrderID, item.OrderName = node.Order.ID, node.Order.Name
	}
	return item, nil
}

func (s *Server) handleShopifyReturns(w http.ResponseWriter, r *http.Request, user User, shopID string) {
	if !s.requireAfterSalesAccess(w, r, user, shopID, PermissionOrdersRefund) {
		return
	}
	domain, token, err := s.shopifyCredentialsWithScopes(r.Context(), shopID, []string{shopifyReturnReadScope})
	if err != nil {
		writeError(w, err)
		return
	}
	items, err := s.shopifyAfterSales.Returns(r.Context(), domain, token, r.URL.Query().Get("orderId"))
	if err != nil {
		s.recordShopifyAPIError(r.Context(), shopID, err)
		writeError(w, err)
		return
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{"returns": nonNilSlice(items)})
}

func (s *Server) handleShopifyReturnDecision(w http.ResponseWriter, r *http.Request, user User, shopID string) {
	if !s.requireAfterSalesAccess(w, r, user, shopID, PermissionOrdersRefund) {
		return
	}
	var input ShopifyReturnDecisionRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	domain, token, err := s.shopifyCredentialsWithScopes(r.Context(), shopID, []string{shopifyReturnReadScope, shopifyReturnWriteScope})
	if err != nil {
		writeError(w, err)
		return
	}
	result, err := s.shopifyAfterSales.DecideReturn(r.Context(), domain, token, input)
	if err != nil {
		s.recordShopifyAPIError(r.Context(), shopID, err)
		writeError(w, err)
		return
	}
	s.auditAccountChange(r.Context(), user.ID, user.ID, "shopify.return.decided", map[string]any{"shopId": shopID, "returnId": result.ReturnID, "decision": strings.ToUpper(strings.TrimSpace(input.Decision)), "status": result.Status, "recovered": result.RecoveredFromShopify})
	s.broadcast(Event{Type: "shopify.return.updated", ShopID: shopID, EntityID: result.ReturnID, Payload: result, CreatedAt: time.Now().UTC()})
	writeJSONResponse(w, http.StatusOK, result)
}

func (s *Server) handleShopifyReturnRefundPreview(w http.ResponseWriter, r *http.Request, user User, shopID string) {
	if !s.requireAfterSalesAccess(w, r, user, shopID, PermissionOrdersRefund) {
		return
	}
	var input ShopifyReturnRefundPreviewRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	input.ShopID = shopID
	domain, token, err := s.shopifyCredentialsWithScopes(r.Context(), shopID, []string{shopifyReturnReadScope, shopifyReturnWriteScope, shopifyOrderWriteScope})
	if err != nil {
		writeError(w, err)
		return
	}
	result, err := s.shopifyAfterSales.PreviewReturnRefund(r.Context(), domain, token, input)
	if err != nil {
		s.recordShopifyAPIError(r.Context(), shopID, err)
		writeError(w, err)
		return
	}
	writeJSONResponse(w, http.StatusOK, result)
}

func (s *Server) handleShopifyReturnRefundProcess(w http.ResponseWriter, r *http.Request, user User, shopID string) {
	if !s.requireAfterSalesAccess(w, r, user, shopID, PermissionOrdersRefund) {
		return
	}
	var input ShopifyReturnRefundProcessRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	input.ShopID = shopID
	domain, token, err := s.shopifyCredentialsWithScopes(r.Context(), shopID, []string{shopifyReturnReadScope, shopifyReturnWriteScope, shopifyOrderWriteScope})
	if err != nil {
		writeError(w, err)
		return
	}
	result, err := s.shopifyAfterSales.ProcessReturnRefund(r.Context(), domain, token, input)
	if err != nil {
		s.recordShopifyAPIError(r.Context(), shopID, err)
		writeError(w, err)
		return
	}
	if result.Outcome == shopifyRefundOutcomePending || result.Outcome == shopifyRefundOutcomeReview {
		ticket, ticketErr := s.ensureRefundReviewTicket(r.Context(), user, shopID, result)
		if ticketErr != nil {
			writeError(w, ticketErr)
			return
		}
		result.ReviewTicketID = ticket.ID
	}
	s.invalidateShopifyOrderCaches(r.Context(), shopID)
	s.auditAccountChange(r.Context(), user.ID, user.ID, "shopify.return.refund.processed", map[string]any{"shopId": shopID, "returnId": result.ReturnID, "outcome": result.Outcome, "reviewTicketId": result.ReviewTicketID, "recovered": result.RecoveredFromShopify})
	s.broadcast(Event{Type: "shopify.return.refunded", ShopID: shopID, EntityID: result.ReturnID, Payload: result, CreatedAt: time.Now().UTC()})
	writeJSONResponse(w, http.StatusOK, result)
}

func (s *Server) handleShopifyDisputes(w http.ResponseWriter, r *http.Request, user User, shopID string) {
	if !s.requireAfterSalesAccess(w, r, user, shopID, PermissionOrdersDisputes) {
		return
	}
	domain, token, err := s.shopifyCredentialsWithScopes(r.Context(), shopID, []string{shopifyDisputeReadScope})
	if err != nil {
		writeError(w, err)
		return
	}
	items, err := s.shopifyAfterSales.Disputes(r.Context(), domain, token)
	if err != nil {
		s.recordShopifyAPIError(r.Context(), shopID, err)
		writeError(w, err)
		return
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{"disputes": nonNilSlice(items)})
}

func (s *Server) requireAfterSalesAccess(w http.ResponseWriter, r *http.Request, user User, shopID, permission string) bool {
	if !userHasPermission(user, permission) {
		writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "required order operation permission is missing"})
		return false
	}
	return s.requireWorkbenchOrModuleShopAccess(w, r, user, DataScopeOrders, shopID)
}

func (s *Server) shopifyCredentialsWithScopes(ctx context.Context, shopID string, required []string) (string, string, error) {
	shop, err := s.store.GetShop(ctx, shopID)
	if err != nil {
		return "", "", err
	}
	if shop.Status != ShopStatusActive {
		return "", "", fmt.Errorf("%w: 当前店铺已停用，不能处理 Shopify 售后", ErrInvalid)
	}
	sources, err := s.store.ListShopSources(ctx, shopID)
	if err != nil {
		return "", "", err
	}
	domain := shopifyDomainForShop(shop, sources)
	token := s.shopifyAdminToken(ctx, domain)
	if domain == "" || token == "" {
		return "", "", fmt.Errorf("%w: 该店铺尚未完成 Shopify 授权", ErrInvalid)
	}
	if installation, installErr := s.store.GetShopifyInstallationByDomain(ctx, domain); installErr == nil && strings.TrimSpace(installation.Scope) != "" {
		for _, scope := range required {
			if !shopifyScopeIncludes(installation.Scope, scope) {
				return "", "", fmt.Errorf("%w: 当前 Shopify 授权缺少售后权限，请重新发布 App 并由店铺管理员重新授权", ErrForbidden)
			}
		}
	}
	return domain, token, nil
}

func (s *Server) ensureRefundReviewTicket(ctx context.Context, user User, shopID string, result ShopifyReturnRefundProcessResult) (Ticket, error) {
	search := strings.TrimSpace(result.ReturnID)
	existing, err := s.store.ListTickets(ctx, TicketFilter{ShopID: shopID, Search: search, Page: 1, PageSize: 100})
	if err != nil {
		return Ticket{}, err
	}
	for _, ticket := range existing {
		if ticket.Category == "退款复核" && ticketStatusActive(ticket.Status) {
			return ticket, nil
		}
	}
	priority := "high"
	if result.Outcome == shopifyRefundOutcomeReview {
		priority = "urgent"
	}
	ticket, err := s.store.CreateTicket(ctx, Ticket{Type: TicketTypeCustomer, ShopID: shopID, CustomerRef: "shopify-return:" + result.ReturnID, Title: "Shopify 退款结果需要复核", Category: "退款复核", Priority: priority, Status: TicketStatusOpen, Description: fmt.Sprintf("退货 %s 的退款结果为 %s。请在 Shopify 后台核对退款交易及退货行状态，确认后关闭此工单。", result.ReturnID, result.Outcome), CreatedBy: user.ID})
	if err != nil {
		return Ticket{}, err
	}
	s.broadcast(Event{Type: "ticket.created", ShopID: shopID, EntityID: ticket.ID, Payload: ticket, CreatedAt: time.Now().UTC()})
	return ticket, nil
}
