package adminapi

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

const returnRefundProcessMutation = `
mutation XZCSReturnRefundProcess($input: ReturnProcessInput!) {
  returnProcess(input: $input) {
    return { ` + returnRefundProcessStatusFields + ` }
    userErrors { code field message }
  }
}`

const returnRefundProcessStatusQuery = `
query XZCSReturnRefundProcessStatus($id: ID!) {
  return(id: $id) { ` + returnRefundProcessStatusFields + ` }
}`

const returnRefundProcessStatusFields = `
  id status
  returnLineItems(first: 100) {
    pageInfo { hasNextPage }
    nodes { ... on ReturnLineItem { id processableQuantity processedQuantity refundableQuantity refundedQuantity } }
  }
  transactions(first: 100, reverse: true) {
    pageInfo { hasNextPage }
    nodes {
      id kind status createdAt
      amountSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
      parentTransaction { id }
    }
  }
`

type returnRefundProcessTransaction struct {
	ID                string                `json:"id"`
	Kind              string                `json:"kind"`
	Status            string                `json:"status"`
	CreatedAt         string                `json:"createdAt"`
	AmountSet         refundPreviewMoneyBag `json:"amountSet"`
	ParentTransaction *struct {
		ID string `json:"id"`
	} `json:"parentTransaction"`
}

type returnRefundProcessNode struct {
	ID              string `json:"id"`
	Status          string `json:"status"`
	ReturnLineItems *struct {
		Nodes    *[]refundPreviewLine `json:"nodes"`
		PageInfo *struct {
			HasNextPage *bool `json:"hasNextPage"`
		} `json:"pageInfo"`
	} `json:"returnLineItems"`
	Transactions *struct {
		Nodes    *[]returnRefundProcessTransaction `json:"nodes"`
		PageInfo *struct {
			HasNextPage *bool `json:"hasNextPage"`
		} `json:"pageInfo"`
	} `json:"transactions"`
}

func (c *Client) ProcessReturnRefund(ctx context.Context, domain, token string, request shopifyconnector.ReturnRefundProcessRequest) (shopifyconnector.ReturnRefundProcessResult, error) {
	if shopifyconnector.ValidateReturnRefundProcessRequest(request) != nil || c == nil || c.httpClient == nil || c.now == nil {
		return shopifyconnector.ReturnRefundProcessResult{}, shopifyconnector.InvalidReturnRefundProcessRequestError(request)
	}
	payload, err := verifyReturnRefundPreviewToken(token, request, c.now().UTC())
	if err != nil {
		return shopifyconnector.ReturnRefundProcessResult{}, shopifyconnector.InvalidReturnRefundProcessRequestError(request)
	}
	previewRequest := shopifyconnector.ReturnRefundPreviewRequest{
		Identity: request.Identity, Context: request.Context, ReturnID: request.ReturnID, LineItems: request.LineItems,
		RefundShipping: request.RefundShipping, RefundDuties: request.RefundDuties,
	}
	fresh, err := c.PreviewReturnRefund(ctx, domain, token, previewRequest)
	if err != nil || fresh.State != shopifyconnector.ReturnRefundPreviewRefundable || returnRefundPreviewDigest(fresh) != payload.Digest {
		return shopifyconnector.ReturnRefundProcessResult{}, shopifyconnector.InvalidReturnRefundProcessRequestError(request)
	}
	input := returnRefundProcessInput(request, fresh)
	var data struct {
		ReturnProcess *struct {
			Return     *returnRefundProcessNode `json:"return"`
			UserErrors *[]struct {
				Code string `json:"code"`
			} `json:"userErrors"`
		} `json:"returnProcess"`
	}
	mutationErr := c.queryGraphQL(ctx, domain, token, returnRefundProcessMutation, map[string]any{"input": input}, &data)
	if mutationErr == nil && data.ReturnProcess != nil && data.ReturnProcess.UserErrors != nil && len(*data.ReturnProcess.UserErrors) == 0 && data.ReturnProcess.Return != nil {
		if result, recovered := c.classifyReturnRefundProcess(request, fresh, payload, *data.ReturnProcess.Return, false); recovered {
			return result, nil
		}
		mutationErr = errors.New("Shopify Admin API return refund process response is invalid")
	} else if mutationErr == nil {
		mutationErr = shopifyconnector.InvalidReturnRefundProcessRequestError(request)
	}
	status, recoveryErr := c.fetchReturnRefundProcessStatus(ctx, domain, token, request.ReturnID)
	if recoveryErr == nil {
		if result, recovered := c.classifyReturnRefundProcess(request, fresh, payload, status, true); recovered {
			return result, nil
		}
	}
	return shopifyconnector.ReturnRefundProcessResult{}, mutationErr
}

func returnRefundProcessInput(request shopifyconnector.ReturnRefundProcessRequest, preview shopifyconnector.ReturnRefundPreview) map[string]any {
	input := map[string]any{
		"returnId":          request.ReturnID,
		"notifyCustomer":    request.NotifyCustomer,
		"returnLineItems":   returnRefundProcessLineInputs(request.LineItems),
		"financialTransfer": map[string]any{"issueRefund": map[string]any{"orderTransactions": returnRefundProcessTransactionInputs(preview.Transactions)}},
	}
	if request.RefundShipping {
		input["refundShipping"] = map[string]any{"fullRefund": true}
	}
	if len(request.RefundDuties) > 0 {
		input["refundDuties"] = returnRefundDutyInputs(request.RefundDuties)
	}
	return input
}

func verifyReturnRefundPreviewToken(token string, request shopifyconnector.ReturnRefundProcessRequest, now time.Time) (refundPreviewTokenPayload, error) {
	parts := strings.Split(request.PreviewToken, ".")
	if len(parts) != 2 {
		return refundPreviewTokenPayload{}, errors.New("invalid preview token")
	}
	payloadRaw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return refundPreviewTokenPayload{}, err
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return refundPreviewTokenPayload{}, err
	}
	mac := hmac.New(sha256.New, []byte("xz-customer-service-return-refund-preview\x00"+token))
	_, _ = mac.Write(payloadRaw)
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return refundPreviewTokenPayload{}, errors.New("invalid preview signature")
	}
	var payload refundPreviewTokenPayload
	if json.Unmarshal(payloadRaw, &payload) != nil || payload.TenantID != request.Identity.TenantID || payload.ShopID != request.Identity.ShopID ||
		payload.ReturnID != request.ReturnID || !sameProcessLines(payload.LineItems, request.LineItems) ||
		payload.RefundShipping != request.RefundShipping || !sameProcessDuties(payload.RefundDuties, request.RefundDuties) || len(payload.Baseline) != len(request.LineItems) ||
		payload.ExpiresAt <= now.Unix() || payload.IssuedAt > now.Add(time.Minute).Unix() || payload.IssuedAt >= payload.ExpiresAt {
		return refundPreviewTokenPayload{}, errors.New("invalid preview payload")
	}
	return payload, nil
}

func returnRefundProcessLineInputs(lines []shopifyconnector.ReturnRefundLineSelection) []map[string]any {
	result := make([]map[string]any, 0, len(lines))
	for _, line := range lines {
		result = append(result, map[string]any{"id": line.ReturnLineID, "quantity": line.Quantity})
	}
	return result
}

func returnRefundProcessTransactionInputs(transactions []shopifyconnector.ReturnRefundTransaction) []map[string]any {
	result := make([]map[string]any, 0, len(transactions))
	for _, transaction := range transactions {
		result = append(result, map[string]any{
			"parentId":          transaction.ParentTransactionID,
			"transactionAmount": map[string]any{"amount": transaction.Amount.PresentmentMoney.Amount, "currencyCode": transaction.Amount.PresentmentMoney.CurrencyCode},
		})
	}
	return result
}

func (c *Client) fetchReturnRefundProcessStatus(ctx context.Context, domain, token, returnID string) (returnRefundProcessNode, error) {
	var data struct {
		Return *returnRefundProcessNode `json:"return"`
	}
	if err := c.queryGraphQL(ctx, domain, token, returnRefundProcessStatusQuery, map[string]any{"id": returnID}, &data); err != nil {
		return returnRefundProcessNode{}, err
	}
	if data.Return == nil {
		return returnRefundProcessNode{}, errors.New("Shopify Admin API return refund recovery response is invalid")
	}
	return *data.Return, nil
}

func (c *Client) classifyReturnRefundProcess(request shopifyconnector.ReturnRefundProcessRequest, preview shopifyconnector.ReturnRefundPreview, payload refundPreviewTokenPayload, node returnRefundProcessNode, recovered bool) (shopifyconnector.ReturnRefundProcessResult, bool) {
	if node.ID != request.ReturnID || node.ReturnLineItems == nil || node.ReturnLineItems.Nodes == nil || node.ReturnLineItems.PageInfo == nil ||
		node.ReturnLineItems.PageInfo.HasNextPage == nil || *node.ReturnLineItems.PageInfo.HasNextPage || node.Transactions == nil ||
		node.Transactions.Nodes == nil || node.Transactions.PageInfo == nil || node.Transactions.PageInfo.HasNextPage == nil {
		return shopifyconnector.ReturnRefundProcessResult{}, false
	}
	currentLines := make(map[string]refundPreviewLine, len(*node.ReturnLineItems.Nodes))
	for _, line := range *node.ReturnLineItems.Nodes {
		currentLines[line.ID] = line
	}
	selection := make(map[string]int, len(request.LineItems))
	for _, line := range request.LineItems {
		selection[line.ReturnLineID] = line.Quantity
	}
	linesProcessed := true
	anyProgress := false
	for _, baseline := range payload.Baseline {
		current, exists := currentLines[baseline.ID]
		quantity := selection[baseline.ID]
		processed := exists && (current.ProcessedQuantity >= baseline.ProcessedQuantity+quantity || current.ProcessableQuantity <= baseline.ProcessableQuantity-quantity)
		linesProcessed = linesProcessed && processed
		anyProgress = anyProgress || processed
	}
	matched := make([]shopifyconnector.ReturnRefundProcessedTransaction, 0, len(preview.Transactions))
	for _, expected := range preview.Transactions {
		for _, actual := range *node.Transactions.Nodes {
			createdAt, timeErr := time.Parse(time.RFC3339, actual.CreatedAt)
			if timeErr != nil || createdAt.Unix() < payload.IssuedAt-60 || actual.Kind != "REFUND" || actual.ParentTransaction == nil ||
				actual.ParentTransaction.ID != expected.ParentTransactionID || actual.AmountSet.PresentmentMoney != expected.Amount.PresentmentMoney {
				continue
			}
			matched = append(matched, shopifyconnector.ReturnRefundProcessedTransaction{
				ID: actual.ID, ParentTransactionID: actual.ParentTransaction.ID, Status: actual.Status, Amount: mapRefundMoneyBag(actual.AmountSet),
			})
			break
		}
	}
	if !linesProcessed || len(matched) != len(preview.Transactions) {
		if !anyProgress && len(matched) == 0 {
			return shopifyconnector.ReturnRefundProcessResult{}, false
		}
		result := shopifyconnector.ReturnRefundProcessResult{
			ContractVersion: shopifyconnector.ReturnRefundProcessContractVersion,
			TenantID:        request.Identity.TenantID, ShopID: request.Identity.ShopID, ReturnID: request.ReturnID,
			ReturnStatus: node.Status, Outcome: shopifyconnector.ReturnRefundProcessReviewRequired,
			RefundAmount: preview.RefundAmount, Transactions: matched,
			RecoveredFromShopify: true, UpdatedAt: c.now().UTC(),
		}
		if shopifyconnector.ValidateReturnRefundProcessResult(request, result) != nil {
			return shopifyconnector.ReturnRefundProcessResult{}, false
		}
		return result, true
	}
	outcome := shopifyconnector.ReturnRefundProcessApplied
	for _, transaction := range matched {
		switch transaction.Status {
		case "SUCCESS":
		case "AWAITING_RESPONSE", "PENDING":
			if outcome == shopifyconnector.ReturnRefundProcessApplied {
				outcome = shopifyconnector.ReturnRefundProcessPending
			}
		default:
			outcome = shopifyconnector.ReturnRefundProcessReviewRequired
		}
	}
	result := shopifyconnector.ReturnRefundProcessResult{
		ContractVersion: shopifyconnector.ReturnRefundProcessContractVersion,
		TenantID:        request.Identity.TenantID, ShopID: request.Identity.ShopID, ReturnID: request.ReturnID,
		ReturnStatus: node.Status, Outcome: outcome, RefundAmount: preview.RefundAmount, Transactions: matched,
		RecoveredFromShopify: recovered, UpdatedAt: c.now().UTC(),
	}
	if shopifyconnector.ValidateReturnRefundProcessResult(request, result) != nil {
		return shopifyconnector.ReturnRefundProcessResult{}, false
	}
	return result, true
}

func sameProcessLines(left, right []shopifyconnector.ReturnRefundLineSelection) bool {
	if len(left) != len(right) {
		return false
	}
	set := make(map[string]int, len(left))
	for _, line := range left {
		set[line.ReturnLineID] = line.Quantity
	}
	for _, line := range right {
		if set[line.ReturnLineID] != line.Quantity {
			return false
		}
		delete(set, line.ReturnLineID)
	}
	return len(set) == 0
}

func sameProcessDuties(left, right []shopifyconnector.ReturnRefundDutySelection) bool {
	if len(left) != len(right) {
		return false
	}
	set := make(map[string]shopifyconnector.ReturnRefundDutyType, len(left))
	for _, duty := range left {
		set[duty.DutyID] = duty.RefundType
	}
	for _, duty := range right {
		if set[duty.DutyID] != duty.RefundType {
			return false
		}
		delete(set, duty.DutyID)
	}
	return len(set) == 0
}

var _ interface {
	ProcessReturnRefund(context.Context, string, string, shopifyconnector.ReturnRefundProcessRequest) (shopifyconnector.ReturnRefundProcessResult, error)
} = (*Client)(nil)
