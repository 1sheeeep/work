package platform

import (
	"context"
	"errors"
	"fmt"
	"math"
	"math/big"
	"net/http"
	"strings"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

const shopifyOrderEditAddLineDiscountMutation = `
mutation XZERPOrderEditAddLineDiscount(
  $id: ID!, $lineItemId: ID!, $discount: OrderEditAppliedDiscountInput!
) {
  orderEditAddLineItemDiscount(
    id: $id, lineItemId: $lineItemId, discount: $discount
  ) {
    calculatedLineItem { id quantity variant { id } }
    addedDiscountStagedChange {
      id description
      value {
        __typename
        ... on MoneyV2 { amount currencyCode }
        ... on PricingPercentageValue { percentage }
      }
    }
    userErrors { field message }
  }
}`

type shopifyStagedDiscountValue struct {
	Typename     string  `json:"__typename"`
	Amount       string  `json:"amount"`
	CurrencyCode string  `json:"currencyCode"`
	Percentage   float64 `json:"percentage"`
}

func (c shopifyAdminClient) AddOrderLineDiscount(
	ctx context.Context,
	shopDomain string,
	accessToken string,
	request shopifyconnector.OrderLineDiscountRequest,
) (shopifyconnector.OrderLineDiscountResult, error) {
	current, err := c.fetchOrderLineState(ctx, shopDomain, accessToken, request.OrderID)
	if err != nil {
		return shopifyconnector.OrderLineDiscountResult{}, err
	}
	line, err := exactOrderLine(current, request.OrderLineID, request.VariantID)
	if err != nil || line.CurrentQuantity != request.ExpectedQuantity {
		return shopifyconnector.OrderLineDiscountResult{},
			fmt.Errorf("%w: Shopify order line changed", ErrInvalid)
	}
	if !catalogMoneyEqual(line.TotalDiscountSet.ShopMoney, request.ExpectedDiscountTotal) {
		matching := exactManualDiscountAllocations(line, request)
		if request.RecoverExisting && len(matching) == 1 &&
			discountDeltaMatches(line.TotalDiscountSet.ShopMoney,
				request.ExpectedDiscountTotal, matching[0].AllocatedAmountSet.ShopMoney) {
			return orderLineDiscountResult(request, line.TotalDiscountSet.ShopMoney,
				current.TotalPriceSet.ShopMoney, true), nil
		}
		return shopifyconnector.OrderLineDiscountResult{},
			fmt.Errorf("%w: Shopify order line discount changed", ErrInvalid)
	}
	if len(exactManualDiscountAllocations(line, request)) != 0 {
		return shopifyconnector.OrderLineDiscountResult{},
			fmt.Errorf("%w: Shopify order line already contains this discount", ErrInvalid)
	}

	calculatedOrderID, calculatedLineID, err := c.beginOrderQuantityEdit(
		ctx, shopDomain, accessToken,
		shopifyconnector.OrderEditQuantityRequest{
			OrderID: request.OrderID, VariantID: request.VariantID,
			ExpectedQuantity: request.ExpectedQuantity,
		})
	if err != nil {
		return shopifyconnector.OrderLineDiscountResult{}, err
	}
	if err := c.addCalculatedLineDiscount(ctx, shopDomain, accessToken,
		calculatedOrderID, calculatedLineID, request); err != nil {
		return shopifyconnector.OrderLineDiscountResult{}, err
	}
	committed, err := c.commitOrderLineDiscount(
		ctx, shopDomain, accessToken, calculatedOrderID, request)
	if err != nil {
		return shopifyconnector.OrderLineDiscountResult{}, err
	}
	line, err = exactOrderLine(committed, request.OrderLineID, request.VariantID)
	if err != nil || line.CurrentQuantity != request.ExpectedQuantity {
		return shopifyconnector.OrderLineDiscountResult{},
			fmt.Errorf("%w: Shopify committed order line is invalid", ErrInvalid)
	}
	matching := exactManualDiscountAllocations(line, request)
	if len(matching) != 1 || !discountDeltaMatches(
		line.TotalDiscountSet.ShopMoney, request.ExpectedDiscountTotal,
		matching[0].AllocatedAmountSet.ShopMoney) {
		return shopifyconnector.OrderLineDiscountResult{},
			fmt.Errorf("%w: Shopify committed discount is invalid", ErrInvalid)
	}
	return orderLineDiscountResult(request, line.TotalDiscountSet.ShopMoney,
		committed.TotalPriceSet.ShopMoney, false), nil
}

func exactManualDiscountAllocations(
	line shopifyOrderLineState,
	request shopifyconnector.OrderLineDiscountRequest,
) []shopifyOrderDiscountAllocation {
	matching := make([]shopifyOrderDiscountAllocation, 0, 1)
	for _, allocation := range line.DiscountAllocations {
		application := allocation.DiscountApplication
		if application.Typename != "ManualDiscountApplication" ||
			strings.TrimSpace(firstNonEmpty(application.Description, application.Title)) !=
				request.Description ||
			!discountValueMatches(application.Value.Typename,
				application.Value.Amount, application.Value.CurrencyCode,
				application.Value.Percentage, request) ||
			!validNonNegativeCatalogMoney(allocation.AllocatedAmountSet.ShopMoney) {
			continue
		}
		matching = append(matching, allocation)
	}
	return matching
}

func discountValueMatches(
	typename string,
	amount string,
	currency string,
	percentage float64,
	request shopifyconnector.OrderLineDiscountRequest,
) bool {
	switch request.DiscountType {
	case shopifyconnector.OrderLineDiscountTypeFixed:
		return typename == "MoneyV2" && request.FixedValue != nil &&
			catalogMoneyEqual(shopifyconnector.CatalogMoney{
				Amount: amount, CurrencyCode: currency,
			}, *request.FixedValue)
	case shopifyconnector.OrderLineDiscountTypePercentage:
		return typename == "PricingPercentageValue" &&
			math.Abs(percentage*100-float64(request.PercentBasisPoints)) < 0.000001
	default:
		return false
	}
}

func discountDeltaMatches(
	current shopifyconnector.CatalogMoney,
	expected shopifyconnector.CatalogMoney,
	allocation shopifyconnector.CatalogMoney,
) bool {
	if current.CurrencyCode != expected.CurrencyCode ||
		current.CurrencyCode != allocation.CurrencyCode {
		return false
	}
	currentAmount, currentOK := new(big.Rat).SetString(strings.TrimSpace(current.Amount))
	expectedAmount, expectedOK := new(big.Rat).SetString(strings.TrimSpace(expected.Amount))
	allocationAmount, allocationOK := new(big.Rat).SetString(strings.TrimSpace(allocation.Amount))
	if !currentOK || !expectedOK || !allocationOK || allocationAmount.Sign() <= 0 {
		return false
	}
	return new(big.Rat).Sub(currentAmount, expectedAmount).Cmp(allocationAmount) == 0
}

func (c shopifyAdminClient) addCalculatedLineDiscount(
	ctx context.Context,
	shopDomain string,
	accessToken string,
	calculatedOrderID string,
	calculatedLineID string,
	request shopifyconnector.OrderLineDiscountRequest,
) error {
	discount := map[string]any{"description": request.Description}
	if request.DiscountType == shopifyconnector.OrderLineDiscountTypeFixed {
		discount["fixedValue"] = map[string]any{
			"amount":       request.FixedValue.Amount,
			"currencyCode": request.FixedValue.CurrencyCode,
		}
	} else {
		discount["percentValue"] = float64(request.PercentBasisPoints) / 100
	}
	var data struct {
		OrderEditAddLineItemDiscount struct {
			CalculatedLineItem        *shopifyOrderLineState `json:"calculatedLineItem"`
			AddedDiscountStagedChange *struct {
				ID          string                     `json:"id"`
				Description string                     `json:"description"`
				Value       shopifyStagedDiscountValue `json:"value"`
			} `json:"addedDiscountStagedChange"`
			UserErrors []shopifyMutationUserError `json:"userErrors"`
		} `json:"orderEditAddLineItemDiscount"`
	}
	variables := map[string]any{
		"id": calculatedOrderID, "lineItemId": calculatedLineID,
		"discount": discount,
	}
	if err := c.queryAdminGraphQL(ctx, shopDomain, accessToken,
		shopifyOrderEditAddLineDiscountMutation, variables, &data); err != nil {
		return err
	}
	payload := data.OrderEditAddLineItemDiscount
	if err := shopifyMutationError("添加订单商品折扣", payload.UserErrors); err != nil {
		return err
	}
	if payload.CalculatedLineItem == nil ||
		payload.CalculatedLineItem.ID != calculatedLineID ||
		payload.CalculatedLineItem.Quantity != request.ExpectedQuantity ||
		payload.CalculatedLineItem.Variant == nil ||
		payload.CalculatedLineItem.Variant.ID != request.VariantID ||
		payload.AddedDiscountStagedChange == nil ||
		!numericShopifyGID(payload.AddedDiscountStagedChange.ID,
			"gid://shopify/OrderStagedChangeAddLineItemDiscount/") ||
		payload.AddedDiscountStagedChange.Description != request.Description ||
		!discountValueMatches(payload.AddedDiscountStagedChange.Value.Typename,
			payload.AddedDiscountStagedChange.Value.Amount,
			payload.AddedDiscountStagedChange.Value.CurrencyCode,
			payload.AddedDiscountStagedChange.Value.Percentage, request) {
		return fmt.Errorf("%w: Shopify staged discount is invalid", ErrInvalid)
	}
	return nil
}

func (c shopifyAdminClient) commitOrderLineDiscount(
	ctx context.Context,
	shopDomain string,
	accessToken string,
	calculatedOrderID string,
	request shopifyconnector.OrderLineDiscountRequest,
) (shopifyOrderState, error) {
	var data struct {
		OrderEditCommit struct {
			Order      *shopifyOrderState         `json:"order"`
			UserErrors []shopifyMutationUserError `json:"userErrors"`
		} `json:"orderEditCommit"`
	}
	variables := map[string]any{
		"id":             calculatedOrderID,
		"notifyCustomer": request.NotifyCustomer,
		"staffNote":      "Line discount applied from XZ ERP",
	}
	if err := c.queryAdminGraphQL(ctx, shopDomain, accessToken,
		shopifyOrderEditCommitMutation, variables, &data); err != nil {
		return shopifyOrderState{}, err
	}
	payload := data.OrderEditCommit
	if err := shopifyMutationError("提交订单编辑", payload.UserErrors); err != nil {
		return shopifyOrderState{}, err
	}
	if payload.Order == nil || payload.Order.ID != request.OrderID ||
		!validNonNegativeCatalogMoney(payload.Order.TotalPriceSet.ShopMoney) ||
		payload.Order.LineItems.PageInfo.HasNextPage ||
		len(payload.Order.LineItems.Nodes) > 100 {
		return shopifyOrderState{},
			fmt.Errorf("%w: Shopify committed order is incomplete", ErrInvalid)
	}
	return *payload.Order, nil
}

func orderLineDiscountResult(
	request shopifyconnector.OrderLineDiscountRequest,
	discountTotal shopifyconnector.CatalogMoney,
	total shopifyconnector.CatalogMoney,
	recovered bool,
) shopifyconnector.OrderLineDiscountResult {
	result := shopifyconnector.OrderLineDiscountResult{
		ContractVersion: shopifyconnector.OrderLineDiscountContractVersion,
		TenantID:        request.Identity.TenantID, ShopID: request.Identity.ShopID,
		OrderID: request.OrderID, OrderLineID: request.OrderLineID,
		Description: request.Description, DiscountType: request.DiscountType,
		PercentBasisPoints: request.PercentBasisPoints,
		DiscountTotal:      discountTotal, Total: total,
		RecoveredFromShopify: recovered, UpdatedAt: time.Now().UTC(),
	}
	if request.FixedValue != nil {
		value := *request.FixedValue
		result.FixedValue = &value
	}
	return result
}

type shopifyOrderLineDiscountWriter func(
	context.Context, string, string, shopifyconnector.OrderLineDiscountRequest,
) (shopifyconnector.OrderLineDiscountResult, error)

type shopifyOrderLineDiscountAdapter struct {
	resolve shopifyConnectorBindingResolver
	store   Store
	token   shopifyOrderCatalogToken
	write   shopifyOrderLineDiscountWriter
}

func newShopifyOrderLineDiscountAdapter(
	server *Server, resolver shopifyConnectorBindingResolver,
) *shopifyOrderLineDiscountAdapter {
	if server == nil {
		return newShopifyOrderLineDiscountAdapterWithWriter(resolver, nil, nil, nil)
	}
	return newShopifyOrderLineDiscountAdapterWithWriter(
		resolver, server.store, server.shopifyAdminTokenForShop, nil)
}

func newShopifyOrderLineDiscountAdapterWithWriter(
	resolver shopifyConnectorBindingResolver,
	store Store,
	token shopifyOrderCatalogToken,
	write shopifyOrderLineDiscountWriter,
) *shopifyOrderLineDiscountAdapter {
	if write == nil {
		write = (shopifyAdminClient{
			HTTPClient: &http.Client{Timeout: 20 * time.Second},
		}).AddOrderLineDiscount
	}
	return &shopifyOrderLineDiscountAdapter{
		resolve: resolver, store: store, token: token, write: write,
	}
}

func (a *shopifyOrderLineDiscountAdapter) AddOrderLineDiscount(
	ctx context.Context,
	request shopifyconnector.OrderLineDiscountRequest,
) (shopifyconnector.OrderLineDiscountResult, error) {
	if err := shopifyconnector.ValidateOrderLineDiscountRequest(request); err != nil {
		return shopifyconnector.OrderLineDiscountResult{},
			shopifyconnector.InvalidOrderLineDiscountRequestError(request)
	}
	if err := ctx.Err(); err != nil || a.resolve == nil || a.store == nil ||
		a.token == nil || a.write == nil {
		return shopifyconnector.OrderLineDiscountResult{},
			shopifyconnector.SafeOrderLineDiscountErrorFor(request, err)
	}
	legacyShopID, err := a.resolve.ResolveLegacyShopID(ctx, request.Identity)
	if err != nil || strings.TrimSpace(legacyShopID) == "" {
		return shopifyconnector.OrderLineDiscountResult{},
			shopifyconnector.ForbiddenOrderLineDiscountError(request)
	}
	shop, err := a.store.GetShop(ctx, legacyShopID)
	if err != nil || shop.Status != ShopStatusActive {
		return shopifyconnector.OrderLineDiscountResult{},
			shopifyconnector.ForbiddenOrderLineDiscountError(request)
	}
	sources, err := a.store.ListShopSources(ctx, legacyShopID)
	if err != nil {
		return shopifyconnector.OrderLineDiscountResult{},
			shopifyconnector.SafeOrderLineDiscountErrorFor(request, err)
	}
	domain := shopifyDomainForShop(shop, sources)
	installation, err := a.store.GetShopifyInstallationByDomain(ctx, domain)
	if err != nil ||
		!shopifyScopeIncludes(installation.Scope, shopifyOrderReadScope) ||
		!shopifyScopeIncludes(installation.Scope, shopifyOrderEditReadScope) ||
		!shopifyScopeIncludes(installation.Scope, shopifyOrderEditWriteScope) {
		return shopifyconnector.OrderLineDiscountResult{},
			shopifyconnector.ForbiddenOrderLineDiscountError(request)
	}
	accessToken := a.token(ctx, legacyShopID, domain)
	if domain == "" || strings.TrimSpace(accessToken) == "" {
		return shopifyconnector.OrderLineDiscountResult{},
			shopifyconnector.ForbiddenOrderLineDiscountError(request)
	}
	result, err := a.write(ctx, domain, accessToken, request)
	if err != nil {
		if errors.Is(err, ErrInvalid) {
			return shopifyconnector.OrderLineDiscountResult{},
				shopifyconnector.InvalidOrderLineDiscountRequestError(request)
		}
		if isShopifyAuthorizationError(err) {
			return shopifyconnector.OrderLineDiscountResult{},
				shopifyconnector.ForbiddenOrderLineDiscountError(request)
		}
		return shopifyconnector.OrderLineDiscountResult{},
			shopifyconnector.SafeOrderLineDiscountErrorFor(request, err)
	}
	if result.OrderID != request.OrderID || result.OrderLineID != request.OrderLineID ||
		result.Description != request.Description ||
		result.DiscountType != request.DiscountType ||
		!validNonNegativeCatalogMoney(result.DiscountTotal) ||
		!validNonNegativeCatalogMoney(result.Total) {
		return shopifyconnector.OrderLineDiscountResult{},
			shopifyconnector.SafeOrderLineDiscountErrorFor(
				request, errors.New("invalid provider result"))
	}
	result.ContractVersion = shopifyconnector.OrderLineDiscountContractVersion
	result.TenantID = request.Identity.TenantID
	result.ShopID = request.Identity.ShopID
	if result.UpdatedAt.IsZero() {
		result.UpdatedAt = time.Now().UTC()
	}
	return result, nil
}

var _ shopifyconnector.OrderLineDiscounter = (*shopifyOrderLineDiscountAdapter)(nil)
