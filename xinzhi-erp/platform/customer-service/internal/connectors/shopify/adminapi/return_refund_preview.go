package adminapi

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

const returnRefundPreviewTTL = 10 * time.Minute

const returnRefundPreviewQuery = `
query XZCSReturnRefundPreview($id: ID!, $returnLineItems: [SuggestedOutcomeReturnLineItemInput!]!, $refundShipping: RefundShippingInput, $refundDuties: [RefundDutyInput!]) {
  return(id: $id) {
    id status
    returnLineItems(first: 100) {
      pageInfo { hasNextPage }
      nodes {
        ... on ReturnLineItem {
          id processableQuantity processedQuantity refundableQuantity refundedQuantity
          fulfillmentLineItem { lineItem { duties { id } } }
        }
      }
    }
    suggestedFinancialOutcome(returnLineItems: $returnLineItems, exchangeLineItems: [], refundShipping: $refundShipping, refundDuties: $refundDuties) {
      maximumRefundable { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
      totalDuties { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
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

type refundPreviewMoneyBag struct {
	ShopMoney        shopifyconnector.CatalogMoney `json:"shopMoney"`
	PresentmentMoney shopifyconnector.CatalogMoney `json:"presentmentMoney"`
}

type refundPreviewTransaction struct {
	AccountNumber     string                `json:"accountNumber"`
	Gateway           string                `json:"gateway"`
	FormattedGateway  string                `json:"formattedGateway"`
	AmountSet         refundPreviewMoneyBag `json:"amountSet"`
	ParentTransaction *struct {
		ID string `json:"id"`
	} `json:"parentTransaction"`
}

type refundPreviewFinancialTransfer struct {
	Type                  string                      `json:"__typename"`
	Amount                refundPreviewMoneyBag       `json:"amount"`
	SuggestedTransactions *[]refundPreviewTransaction `json:"suggestedTransactions"`
}

type refundPreviewOutcome struct {
	MaximumRefundable refundPreviewMoneyBag `json:"maximumRefundable"`
	TotalDuties       refundPreviewMoneyBag `json:"totalDuties"`
	Shipping          *struct {
		AmountSet refundPreviewMoneyBag `json:"amountSet"`
	} `json:"shipping"`
	FinancialTransfer *refundPreviewFinancialTransfer `json:"financialTransfer"`
}

type refundPreviewLine struct {
	ID                  string `json:"id"`
	ProcessableQuantity int    `json:"processableQuantity"`
	ProcessedQuantity   int    `json:"processedQuantity"`
	RefundableQuantity  int    `json:"refundableQuantity"`
	RefundedQuantity    int    `json:"refundedQuantity"`
	FulfillmentLineItem *struct {
		LineItem *struct {
			Duties *[]struct {
				ID string `json:"id"`
			} `json:"duties"`
		} `json:"lineItem"`
	} `json:"fulfillmentLineItem"`
}

type refundPreviewBaselineLine struct {
	ID                  string `json:"id"`
	ProcessableQuantity int    `json:"processableQuantity"`
	ProcessedQuantity   int    `json:"processedQuantity"`
	RefundableQuantity  int    `json:"refundableQuantity"`
	RefundedQuantity    int    `json:"refundedQuantity"`
}

type refundPreviewTokenPayload struct {
	TenantID       string                                       `json:"tenantId"`
	ShopID         string                                       `json:"shopId"`
	ReturnID       string                                       `json:"returnId"`
	LineItems      []shopifyconnector.ReturnRefundLineSelection `json:"lineItems"`
	RefundShipping bool                                         `json:"refundShipping"`
	RefundDuties   []shopifyconnector.ReturnRefundDutySelection `json:"refundDuties"`
	Baseline       []refundPreviewBaselineLine                  `json:"baseline"`
	Digest         string                                       `json:"digest"`
	IssuedAt       int64                                        `json:"issuedAt"`
	ExpiresAt      int64                                        `json:"expiresAt"`
}

func (c *Client) PreviewReturnRefund(ctx context.Context, domain, token string, request shopifyconnector.ReturnRefundPreviewRequest) (shopifyconnector.ReturnRefundPreview, error) {
	if shopifyconnector.ValidateReturnRefundPreviewRequest(request) != nil || c == nil || c.httpClient == nil || c.now == nil {
		return shopifyconnector.ReturnRefundPreview{}, shopifyconnector.InvalidReturnRefundPreviewRequestError(request)
	}
	lineInputs := make([]map[string]any, 0, len(request.LineItems))
	for _, line := range request.LineItems {
		lineInputs = append(lineInputs, map[string]any{"id": line.ReturnLineID, "quantity": line.Quantity})
	}
	var data struct {
		Return *struct {
			ID              string `json:"id"`
			Status          string `json:"status"`
			ReturnLineItems *struct {
				Nodes    *[]refundPreviewLine `json:"nodes"`
				PageInfo *struct {
					HasNextPage *bool `json:"hasNextPage"`
				} `json:"pageInfo"`
			} `json:"returnLineItems"`
			SuggestedFinancialOutcome *refundPreviewOutcome `json:"suggestedFinancialOutcome"`
		} `json:"return"`
	}
	variables := map[string]any{"id": request.ReturnID, "returnLineItems": lineInputs}
	if request.RefundShipping {
		variables["refundShipping"] = map[string]any{"fullRefund": true}
	}
	if len(request.RefundDuties) > 0 {
		variables["refundDuties"] = returnRefundDutyInputs(request.RefundDuties)
	}
	if err := c.queryGraphQL(ctx, domain, token, returnRefundPreviewQuery, variables, &data); err != nil {
		return shopifyconnector.ReturnRefundPreview{}, err
	}
	if data.Return == nil || data.Return.ID != request.ReturnID || data.Return.Status != "OPEN" ||
		data.Return.ReturnLineItems == nil || data.Return.ReturnLineItems.Nodes == nil ||
		data.Return.ReturnLineItems.PageInfo == nil || data.Return.ReturnLineItems.PageInfo.HasNextPage == nil ||
		*data.Return.ReturnLineItems.PageInfo.HasNextPage || data.Return.SuggestedFinancialOutcome == nil {
		return shopifyconnector.ReturnRefundPreview{}, shopifyconnector.InvalidReturnRefundPreviewRequestError(request)
	}
	available := make(map[string]refundPreviewLine, len(*data.Return.ReturnLineItems.Nodes))
	for _, line := range *data.Return.ReturnLineItems.Nodes {
		available[line.ID] = line
	}
	for _, selected := range request.LineItems {
		line, exists := available[selected.ReturnLineID]
		if !exists || selected.Quantity > line.ProcessableQuantity || selected.Quantity > line.RefundableQuantity {
			return shopifyconnector.ReturnRefundPreview{}, shopifyconnector.InvalidReturnRefundPreviewRequestError(request)
		}
	}
	selectedDuties := make(map[string]struct{})
	for _, selected := range request.LineItems {
		line := available[selected.ReturnLineID]
		if line.FulfillmentLineItem == nil || line.FulfillmentLineItem.LineItem == nil || line.FulfillmentLineItem.LineItem.Duties == nil {
			if len(request.RefundDuties) > 0 {
				return shopifyconnector.ReturnRefundPreview{}, shopifyconnector.InvalidReturnRefundPreviewRequestError(request)
			}
			continue
		}
		for _, duty := range *line.FulfillmentLineItem.LineItem.Duties {
			selectedDuties[duty.ID] = struct{}{}
		}
	}
	for _, duty := range request.RefundDuties {
		if _, exists := selectedDuties[duty.DutyID]; !exists {
			return shopifyconnector.ReturnRefundPreview{}, shopifyconnector.InvalidReturnRefundPreviewRequestError(request)
		}
	}
	now := c.now().UTC()
	outcome := data.Return.SuggestedFinancialOutcome
	preview := shopifyconnector.ReturnRefundPreview{
		ContractVersion: shopifyconnector.ReturnRefundPreviewContractVersion,
		TenantID:        request.Identity.TenantID, ShopID: request.Identity.ShopID, ReturnID: request.ReturnID,
		State: shopifyconnector.ReturnRefundPreviewNotRefundable, LineItems: sortedRefundLines(request.LineItems),
		RefundShipping: request.RefundShipping, RefundDuties: sortedRefundDuties(request.RefundDuties),
		RefundAmount:      zeroRefundMoneyBag(outcome.MaximumRefundable),
		MaximumRefundable: mapRefundMoneyBag(outcome.MaximumRefundable), FetchedAt: now,
	}
	if request.RefundShipping {
		if outcome.Shipping == nil {
			return shopifyconnector.ReturnRefundPreview{}, errors.New("Shopify Admin API return refund shipping preview is invalid")
		}
		shipping := mapRefundMoneyBag(outcome.Shipping.AmountSet)
		preview.ShippingAmount = &shipping
	}
	if len(request.RefundDuties) > 0 {
		duties := mapRefundMoneyBag(outcome.TotalDuties)
		preview.DutyAmount = &duties
	}
	transfer := outcome.FinancialTransfer
	if transfer == nil || transfer.Type != "RefundReturnOutcome" {
		if shopifyconnector.ValidateReturnRefundPreview(request, preview) != nil {
			return shopifyconnector.ReturnRefundPreview{}, errors.New("Shopify Admin API return refund preview response is invalid")
		}
		return preview, nil
	}
	if transfer.SuggestedTransactions == nil || len(*transfer.SuggestedTransactions) == 0 {
		return shopifyconnector.ReturnRefundPreview{}, errors.New("Shopify Admin API return refund preview response is invalid")
	}
	preview.State = shopifyconnector.ReturnRefundPreviewRefundable
	preview.RefundAmount = mapRefundMoneyBag(transfer.Amount)
	preview.Transactions = make([]shopifyconnector.ReturnRefundTransaction, 0, len(*transfer.SuggestedTransactions))
	for _, transaction := range *transfer.SuggestedTransactions {
		if transaction.ParentTransaction == nil {
			return shopifyconnector.ReturnRefundPreview{}, errors.New("Shopify Admin API return refund preview response is invalid")
		}
		preview.Transactions = append(preview.Transactions, shopifyconnector.ReturnRefundTransaction{
			ParentTransactionID: transaction.ParentTransaction.ID, Amount: mapRefundMoneyBag(transaction.AmountSet),
			Gateway: strings.TrimSpace(transaction.Gateway), FormattedGateway: strings.TrimSpace(transaction.FormattedGateway),
			AccountNumber: strings.TrimSpace(transaction.AccountNumber),
		})
	}
	expiresAt := now.Add(returnRefundPreviewTTL)
	preview.ExpiresAt = &expiresAt
	preview.PreviewToken = signReturnRefundPreview(token, request, preview, available, now, expiresAt)
	if shopifyconnector.ValidateReturnRefundPreview(request, preview) != nil {
		return shopifyconnector.ReturnRefundPreview{}, errors.New("Shopify Admin API return refund preview response is invalid")
	}
	return preview, nil
}

func mapRefundMoneyBag(value refundPreviewMoneyBag) shopifyconnector.ReturnRefundMoneyBag {
	return shopifyconnector.ReturnRefundMoneyBag{ShopMoney: value.ShopMoney, PresentmentMoney: value.PresentmentMoney}
}

func zeroRefundMoneyBag(value refundPreviewMoneyBag) shopifyconnector.ReturnRefundMoneyBag {
	return shopifyconnector.ReturnRefundMoneyBag{
		ShopMoney:        shopifyconnector.CatalogMoney{Amount: "0", CurrencyCode: value.ShopMoney.CurrencyCode},
		PresentmentMoney: shopifyconnector.CatalogMoney{Amount: "0", CurrencyCode: value.PresentmentMoney.CurrencyCode},
	}
}

func sortedRefundLines(lines []shopifyconnector.ReturnRefundLineSelection) []shopifyconnector.ReturnRefundLineSelection {
	result := append([]shopifyconnector.ReturnRefundLineSelection(nil), lines...)
	sort.Slice(result, func(i, j int) bool { return result[i].ReturnLineID < result[j].ReturnLineID })
	return result
}

func sortedRefundDuties(duties []shopifyconnector.ReturnRefundDutySelection) []shopifyconnector.ReturnRefundDutySelection {
	result := append([]shopifyconnector.ReturnRefundDutySelection(nil), duties...)
	sort.Slice(result, func(i, j int) bool { return result[i].DutyID < result[j].DutyID })
	return result
}

func returnRefundDutyInputs(duties []shopifyconnector.ReturnRefundDutySelection) []map[string]any {
	result := make([]map[string]any, 0, len(duties))
	for _, duty := range duties {
		result = append(result, map[string]any{"dutyId": duty.DutyID, "refundType": duty.RefundType})
	}
	return result
}

func signReturnRefundPreview(token string, request shopifyconnector.ReturnRefundPreviewRequest, preview shopifyconnector.ReturnRefundPreview, available map[string]refundPreviewLine, issuedAt, expiresAt time.Time) string {
	payload := refundPreviewTokenPayload{
		TenantID: request.Identity.TenantID, ShopID: request.Identity.ShopID, ReturnID: request.ReturnID,
		LineItems: preview.LineItems, Digest: returnRefundPreviewDigest(preview),
		RefundShipping: preview.RefundShipping, RefundDuties: preview.RefundDuties,
		IssuedAt: issuedAt.Unix(), ExpiresAt: expiresAt.Unix(),
	}
	for _, selected := range preview.LineItems {
		line := available[selected.ReturnLineID]
		payload.Baseline = append(payload.Baseline, refundPreviewBaselineLine{
			ID: line.ID, ProcessableQuantity: line.ProcessableQuantity, ProcessedQuantity: line.ProcessedQuantity,
			RefundableQuantity: line.RefundableQuantity, RefundedQuantity: line.RefundedQuantity,
		})
	}
	payloadRaw, _ := json.Marshal(payload)
	mac := hmac.New(sha256.New, []byte("xz-customer-service-return-refund-preview\x00"+token))
	_, _ = mac.Write(payloadRaw)
	return base64.RawURLEncoding.EncodeToString(payloadRaw) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func returnRefundPreviewDigest(preview shopifyconnector.ReturnRefundPreview) string {
	digestInput := struct {
		Lines          []shopifyconnector.ReturnRefundLineSelection `json:"lines"`
		RefundShipping bool                                         `json:"refundShipping"`
		RefundDuties   []shopifyconnector.ReturnRefundDutySelection `json:"refundDuties"`
		RefundAmount   shopifyconnector.ReturnRefundMoneyBag        `json:"refundAmount"`
		ShippingAmount *shopifyconnector.ReturnRefundMoneyBag       `json:"shippingAmount"`
		DutyAmount     *shopifyconnector.ReturnRefundMoneyBag       `json:"dutyAmount"`
		Transactions   []shopifyconnector.ReturnRefundTransaction   `json:"transactions"`
	}{preview.LineItems, preview.RefundShipping, preview.RefundDuties, preview.RefundAmount, preview.ShippingAmount, preview.DutyAmount, preview.Transactions}
	digestRaw, _ := json.Marshal(digestInput)
	return base64.RawURLEncoding.EncodeToString(sha256Sum(digestRaw))
}

func sha256Sum(value []byte) []byte {
	sum := sha256.Sum256(value)
	return sum[:]
}

var _ interface {
	PreviewReturnRefund(context.Context, string, string, shopifyconnector.ReturnRefundPreviewRequest) (shopifyconnector.ReturnRefundPreview, error)
} = (*Client)(nil)
