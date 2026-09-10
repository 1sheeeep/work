package adminapi

import (
	"context"
	"errors"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

const returnDecisionStatusQuery = `
query XZERPReturnDecisionStatus($id: ID!) {
  return(id: $id) { id status }
}`

const returnApproveRequestMutation = `
mutation XZERPReturnApproveRequest($input: ReturnApproveRequestInput!) {
  returnApproveRequest(input: $input) {
    return { id status }
    userErrors { code field message }
  }
}`

const returnDeclineRequestMutation = `
mutation XZERPReturnDeclineRequest($input: ReturnDeclineRequestInput!) {
  returnDeclineRequest(input: $input) {
    return { id status }
    userErrors { code field message }
  }
}`

type returnDecisionNode struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

type returnDecisionPayload struct {
	Return     *returnDecisionNode `json:"return"`
	UserErrors *[]struct {
		Code string `json:"code"`
	} `json:"userErrors"`
}

func (c *Client) DecideReturn(ctx context.Context, domain, token string, request shopifyconnector.ReturnDecisionRequest) (shopifyconnector.ReturnDecisionResult, error) {
	if shopifyconnector.ValidateReturnDecisionRequest(request) != nil || c == nil || c.httpClient == nil || c.now == nil {
		return shopifyconnector.ReturnDecisionResult{}, shopifyconnector.InvalidReturnDecisionRequestError(request)
	}
	expected := expectedReturnDecisionStatus(request.Decision)
	current, err := c.fetchReturnDecisionStatus(ctx, domain, token, request.ReturnID)
	if err != nil {
		return shopifyconnector.ReturnDecisionResult{}, err
	}
	if current.Status == expected {
		return c.returnDecisionResult(request, expected, true), nil
	}
	if current.Status != "REQUESTED" {
		return shopifyconnector.ReturnDecisionResult{}, shopifyconnector.InvalidReturnDecisionRequestError(request)
	}

	query := returnApproveRequestMutation
	input := map[string]any{
		"id": request.ReturnID, "notifyCustomer": request.NotifyCustomer,
	}
	var data struct {
		ReturnApproveRequest *returnDecisionPayload `json:"returnApproveRequest"`
		ReturnDeclineRequest *returnDecisionPayload `json:"returnDeclineRequest"`
	}
	if request.Decision == shopifyconnector.ReturnDecisionDecline {
		query = returnDeclineRequestMutation
		input["declineReason"] = request.DeclineReason
		if request.DeclineNote != "" {
			input["declineNote"] = request.DeclineNote
		}
	}
	mutationErr := c.queryGraphQL(ctx, domain, token, query, map[string]any{"input": input}, &data)
	if mutationErr != nil {
		if recovered, recoveryErr := c.fetchReturnDecisionStatus(ctx, domain, token, request.ReturnID); recoveryErr == nil && recovered.Status == expected {
			return c.returnDecisionResult(request, expected, true), nil
		}
		return shopifyconnector.ReturnDecisionResult{}, mutationErr
	}
	payload := data.ReturnApproveRequest
	if request.Decision == shopifyconnector.ReturnDecisionDecline {
		payload = data.ReturnDeclineRequest
	}
	if payload == nil || payload.UserErrors == nil {
		return shopifyconnector.ReturnDecisionResult{}, errors.New("Shopify Admin API return decision response is invalid")
	}
	if len(*payload.UserErrors) != 0 {
		if payload.Return != nil {
			return shopifyconnector.ReturnDecisionResult{}, errors.New("Shopify Admin API return decision response is contradictory")
		}
		return shopifyconnector.ReturnDecisionResult{}, shopifyconnector.InvalidReturnDecisionRequestError(request)
	}
	if payload.Return == nil || payload.Return.ID != request.ReturnID || payload.Return.Status != expected {
		return shopifyconnector.ReturnDecisionResult{}, errors.New("Shopify Admin API return decision response is invalid")
	}
	result := c.returnDecisionResult(request, expected, false)
	if shopifyconnector.ValidateReturnDecisionResult(request, result) != nil {
		return shopifyconnector.ReturnDecisionResult{}, errors.New("Shopify Admin API return decision response is invalid")
	}
	return result, nil
}

func (c *Client) fetchReturnDecisionStatus(ctx context.Context, domain, token, returnID string) (returnDecisionNode, error) {
	var data struct {
		Return *returnDecisionNode `json:"return"`
	}
	if err := c.queryGraphQL(ctx, domain, token, returnDecisionStatusQuery, map[string]any{"id": returnID}, &data); err != nil {
		return returnDecisionNode{}, err
	}
	if data.Return == nil || data.Return.ID != returnID {
		return returnDecisionNode{}, errors.New("Shopify Admin API return decision status is invalid")
	}
	switch data.Return.Status {
	case "CANCELED", "CLOSED", "DECLINED", "OPEN", "REQUESTED":
		return *data.Return, nil
	default:
		return returnDecisionNode{}, errors.New("Shopify Admin API return decision status is invalid")
	}
}

func (c *Client) returnDecisionResult(request shopifyconnector.ReturnDecisionRequest, status string, recovered bool) shopifyconnector.ReturnDecisionResult {
	return shopifyconnector.ReturnDecisionResult{
		ContractVersion: shopifyconnector.ReturnDecisionContractVersion,
		TenantID:        request.Identity.TenantID, ShopID: request.Identity.ShopID,
		ReturnID: request.ReturnID, Status: status,
		RecoveredFromShopify: recovered, UpdatedAt: c.now().UTC(),
	}
}

func expectedReturnDecisionStatus(decision shopifyconnector.ReturnDecision) string {
	if decision == shopifyconnector.ReturnDecisionDecline {
		return "DECLINED"
	}
	return "OPEN"
}

var _ interface {
	DecideReturn(context.Context, string, string, shopifyconnector.ReturnDecisionRequest) (shopifyconnector.ReturnDecisionResult, error)
} = (*Client)(nil)
