package platform

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

const (
	shopifyOrderReadScope      = "read_orders"
	shopifyOrderEditReadScope  = "read_order_edits"
	shopifyOrderEditWriteScope = "write_order_edits"
)

const shopifyOrderLineStateQuery = `
query XZERPOrderLineState($id: ID!) {
  order(id: $id) {
    id
    totalPriceSet { shopMoney { amount currencyCode } }
    lineItems(first: 101) {
      nodes {
        id currentQuantity sku name title variantTitle requiresShipping taxable
        originalUnitPriceSet { shopMoney { amount currencyCode } }
        totalDiscountSet { shopMoney { amount currencyCode } }
        discountAllocations {
          allocatedAmountSet { shopMoney { amount currencyCode } }
          discountApplication {
            __typename
            ... on ManualDiscountApplication {
              title description
              value {
                __typename
                ... on MoneyV2 { amount currencyCode }
                ... on PricingPercentageValue { percentage }
              }
            }
          }
        }
        variant { id }
      }
      pageInfo { hasNextPage }
    }
  }
}`

const shopifyOrderEditBeginMutation = `
mutation XZERPOrderEditBegin($id: ID!) {
  orderEditBegin(id: $id) {
    calculatedOrder {
      id
      lineItems(first: 101) {
        nodes {
          id quantity sku title variantTitle requiresShipping taxable
          originalUnitPriceSet { shopMoney { amount currencyCode } }
          totalDiscountSet { shopMoney { amount currencyCode } }
          variant { id }
        }
        pageInfo { hasNextPage }
      }
    }
    userErrors { field message }
  }
}`

const shopifyOrderEditSetQuantityMutation = `
mutation XZERPOrderEditSetQuantity(
  $id: ID!, $lineItemId: ID!, $quantity: Int!, $restock: Boolean
) {
  orderEditSetQuantity(
    id: $id, lineItemId: $lineItemId,
    quantity: $quantity, restock: $restock
  ) {
    calculatedLineItem { id quantity variant { id } }
    userErrors { field message }
  }
}`

const shopifyOrderEditCommitMutation = `
mutation XZERPOrderEditCommit(
  $id: ID!, $notifyCustomer: Boolean, $staffNote: String
) {
  orderEditCommit(
    id: $id, notifyCustomer: $notifyCustomer, staffNote: $staffNote
  ) {
    order {
      id
      totalPriceSet { shopMoney { amount currencyCode } }
      lineItems(first: 101) {
        nodes {
          id currentQuantity sku name title variantTitle requiresShipping taxable
          originalUnitPriceSet { shopMoney { amount currencyCode } }
          totalDiscountSet { shopMoney { amount currencyCode } }
          discountAllocations {
            allocatedAmountSet { shopMoney { amount currencyCode } }
            discountApplication {
              __typename
              ... on ManualDiscountApplication {
                title description
                value {
                  __typename
                  ... on MoneyV2 { amount currencyCode }
                  ... on PricingPercentageValue { percentage }
                }
              }
            }
          }
          variant { id }
        }
        pageInfo { hasNextPage }
      }
    }
    userErrors { field message }
  }
}`

type shopifyOrderLineState struct {
	ID                   string `json:"id"`
	CurrentQuantity      int    `json:"currentQuantity"`
	Quantity             int    `json:"quantity"`
	SKU                  string `json:"sku"`
	Name                 string `json:"name"`
	Title                string `json:"title"`
	VariantTitle         string `json:"variantTitle"`
	RequiresShipping     bool   `json:"requiresShipping"`
	Taxable              bool   `json:"taxable"`
	OriginalUnitPriceSet struct {
		ShopMoney shopifyconnector.CatalogMoney `json:"shopMoney"`
	} `json:"originalUnitPriceSet"`
	TotalDiscountSet struct {
		ShopMoney shopifyconnector.CatalogMoney `json:"shopMoney"`
	} `json:"totalDiscountSet"`
	DiscountAllocations []shopifyOrderDiscountAllocation `json:"discountAllocations"`
	Variant             *struct {
		ID string `json:"id"`
	} `json:"variant"`
}

type shopifyOrderDiscountAllocation struct {
	AllocatedAmountSet struct {
		ShopMoney shopifyconnector.CatalogMoney `json:"shopMoney"`
	} `json:"allocatedAmountSet"`
	DiscountApplication struct {
		Typename    string `json:"__typename"`
		Title       string `json:"title"`
		Description string `json:"description"`
		Value       struct {
			Typename     string  `json:"__typename"`
			Amount       string  `json:"amount"`
			CurrencyCode string  `json:"currencyCode"`
			Percentage   float64 `json:"percentage"`
		} `json:"value"`
	} `json:"discountApplication"`
}

type shopifyOrderLineConnection struct {
	Nodes    []shopifyOrderLineState `json:"nodes"`
	PageInfo struct {
		HasNextPage bool `json:"hasNextPage"`
	} `json:"pageInfo"`
}

type shopifyOrderState struct {
	ID            string `json:"id"`
	TotalPriceSet struct {
		ShopMoney shopifyconnector.CatalogMoney `json:"shopMoney"`
	} `json:"totalPriceSet"`
	LineItems shopifyOrderLineConnection `json:"lineItems"`
}

func (c shopifyAdminClient) UpdateOrderLineQuantity(
	ctx context.Context,
	shopDomain string,
	accessToken string,
	request shopifyconnector.OrderEditQuantityRequest,
) (shopifyconnector.OrderEditQuantityResult, error) {
	current, err := c.fetchOrderLineState(
		ctx, shopDomain, accessToken, request.OrderID)
	if err != nil {
		return shopifyconnector.OrderEditQuantityResult{}, err
	}
	line, err := exactOrderLine(current, request.OrderLineID, request.VariantID)
	if err != nil {
		return shopifyconnector.OrderEditQuantityResult{}, err
	}
	if line.CurrentQuantity == request.Quantity {
		return orderEditQuantityResult(request, current.TotalPriceSet.ShopMoney, true), nil
	}
	if line.CurrentQuantity != request.ExpectedQuantity {
		return shopifyconnector.OrderEditQuantityResult{},
			fmt.Errorf("%w: Shopify order line quantity changed", ErrInvalid)
	}

	calculatedOrderID, calculatedLineID, err := c.beginOrderQuantityEdit(
		ctx, shopDomain, accessToken, request)
	if err != nil {
		return shopifyconnector.OrderEditQuantityResult{}, err
	}
	if err := c.setCalculatedLineQuantity(
		ctx, shopDomain, accessToken, calculatedOrderID,
		calculatedLineID, request); err != nil {
		return shopifyconnector.OrderEditQuantityResult{}, err
	}
	committed, err := c.commitOrderQuantityEdit(
		ctx, shopDomain, accessToken, calculatedOrderID, request)
	if err != nil {
		return shopifyconnector.OrderEditQuantityResult{}, err
	}
	return orderEditQuantityResult(request, committed.TotalPriceSet.ShopMoney, false), nil
}

func (c shopifyAdminClient) fetchOrderLineState(
	ctx context.Context, shopDomain string, accessToken string, orderID string,
) (shopifyOrderState, error) {
	var data struct {
		Order *shopifyOrderState `json:"order"`
	}
	if err := c.queryAdminGraphQL(ctx, shopDomain, accessToken,
		shopifyOrderLineStateQuery, map[string]any{"id": orderID}, &data); err != nil {
		return shopifyOrderState{}, err
	}
	if data.Order == nil || data.Order.ID != orderID ||
		!validNonNegativeCatalogMoney(data.Order.TotalPriceSet.ShopMoney) ||
		data.Order.LineItems.PageInfo.HasNextPage ||
		len(data.Order.LineItems.Nodes) > 100 {
		return shopifyOrderState{},
			fmt.Errorf("%w: Shopify order line state is incomplete", ErrInvalid)
	}
	return *data.Order, nil
}

func exactOrderLine(
	order shopifyOrderState, lineID string, variantID string,
) (shopifyOrderLineState, error) {
	var matched *shopifyOrderLineState
	for index := range order.LineItems.Nodes {
		line := &order.LineItems.Nodes[index]
		if line.ID != lineID {
			continue
		}
		if matched != nil || line.Variant == nil || line.Variant.ID != variantID ||
			!numericShopifyGID(line.ID, "gid://shopify/LineItem/") {
			return shopifyOrderLineState{},
				fmt.Errorf("%w: Shopify order line mapping is invalid", ErrInvalid)
		}
		matched = line
	}
	if matched == nil {
		return shopifyOrderLineState{},
			fmt.Errorf("%w: Shopify order line was not found", ErrInvalid)
	}
	return *matched, nil
}

func (c shopifyAdminClient) beginOrderQuantityEdit(
	ctx context.Context, shopDomain string, accessToken string,
	request shopifyconnector.OrderEditQuantityRequest,
) (string, string, error) {
	var data struct {
		OrderEditBegin struct {
			CalculatedOrder *struct {
				ID        string                     `json:"id"`
				LineItems shopifyOrderLineConnection `json:"lineItems"`
			} `json:"calculatedOrder"`
			UserErrors []shopifyMutationUserError `json:"userErrors"`
		} `json:"orderEditBegin"`
	}
	if err := c.queryAdminGraphQL(ctx, shopDomain, accessToken,
		shopifyOrderEditBeginMutation, map[string]any{"id": request.OrderID}, &data); err != nil {
		return "", "", err
	}
	payload := data.OrderEditBegin
	if err := shopifyMutationError("开始订单编辑", payload.UserErrors); err != nil {
		return "", "", err
	}
	if payload.CalculatedOrder == nil ||
		!numericShopifyGID(payload.CalculatedOrder.ID, "gid://shopify/CalculatedOrder/") ||
		payload.CalculatedOrder.LineItems.PageInfo.HasNextPage ||
		len(payload.CalculatedOrder.LineItems.Nodes) > 100 {
		return "", "", fmt.Errorf("%w: Shopify calculated order is incomplete", ErrInvalid)
	}
	calculatedLineID := ""
	for _, line := range payload.CalculatedOrder.LineItems.Nodes {
		if line.Variant != nil && line.Variant.ID == request.VariantID &&
			line.Quantity == request.ExpectedQuantity {
			if calculatedLineID != "" ||
				!numericShopifyGID(line.ID, "gid://shopify/CalculatedLineItem/") {
				return "", "", fmt.Errorf("%w: Shopify calculated line mapping is ambiguous", ErrInvalid)
			}
			calculatedLineID = line.ID
		}
	}
	if calculatedLineID == "" {
		return "", "", fmt.Errorf("%w: Shopify calculated line was not found", ErrInvalid)
	}
	return payload.CalculatedOrder.ID, calculatedLineID, nil
}

func (c shopifyAdminClient) setCalculatedLineQuantity(
	ctx context.Context, shopDomain string, accessToken string,
	calculatedOrderID string, calculatedLineID string,
	request shopifyconnector.OrderEditQuantityRequest,
) error {
	var data struct {
		OrderEditSetQuantity struct {
			CalculatedLineItem *shopifyOrderLineState     `json:"calculatedLineItem"`
			UserErrors         []shopifyMutationUserError `json:"userErrors"`
		} `json:"orderEditSetQuantity"`
	}
	variables := map[string]any{
		"id": calculatedOrderID, "lineItemId": calculatedLineID,
		"quantity": request.Quantity, "restock": request.Restock,
	}
	if err := c.queryAdminGraphQL(ctx, shopDomain, accessToken,
		shopifyOrderEditSetQuantityMutation, variables, &data); err != nil {
		return err
	}
	payload := data.OrderEditSetQuantity
	if err := shopifyMutationError("修改订单商品数量", payload.UserErrors); err != nil {
		return err
	}
	if payload.CalculatedLineItem == nil ||
		payload.CalculatedLineItem.ID != calculatedLineID ||
		payload.CalculatedLineItem.Quantity != request.Quantity ||
		payload.CalculatedLineItem.Variant == nil ||
		payload.CalculatedLineItem.Variant.ID != request.VariantID {
		return fmt.Errorf("%w: Shopify calculated line result is invalid", ErrInvalid)
	}
	return nil
}

func (c shopifyAdminClient) commitOrderQuantityEdit(
	ctx context.Context, shopDomain string, accessToken string,
	calculatedOrderID string, request shopifyconnector.OrderEditQuantityRequest,
) (shopifyOrderState, error) {
	var data struct {
		OrderEditCommit struct {
			Order      *shopifyOrderState         `json:"order"`
			UserErrors []shopifyMutationUserError `json:"userErrors"`
		} `json:"orderEditCommit"`
	}
	variables := map[string]any{
		"id": calculatedOrderID, "notifyCustomer": request.NotifyCustomer,
		"staffNote": "Edited from XZ ERP",
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
		return shopifyOrderState{}, fmt.Errorf("%w: Shopify committed order is incomplete", ErrInvalid)
	}
	line, err := exactOrderLine(*payload.Order, request.OrderLineID, request.VariantID)
	if err != nil || line.CurrentQuantity != request.Quantity {
		return shopifyOrderState{}, fmt.Errorf("%w: Shopify committed quantity is invalid", ErrInvalid)
	}
	return *payload.Order, nil
}

func orderEditQuantityResult(
	request shopifyconnector.OrderEditQuantityRequest,
	total shopifyconnector.CatalogMoney, recovered bool,
) shopifyconnector.OrderEditQuantityResult {
	return shopifyconnector.OrderEditQuantityResult{
		ContractVersion: shopifyconnector.OrderEditQuantityContractVersion,
		TenantID:        request.Identity.TenantID, ShopID: request.Identity.ShopID,
		OrderID: request.OrderID, OrderLineID: request.OrderLineID,
		Quantity: request.Quantity, Total: total, RecoveredFromShopify: recovered,
		UpdatedAt: time.Now().UTC(),
	}
}

func validNonNegativeCatalogMoney(value shopifyconnector.CatalogMoney) bool {
	amount, ok := new(big.Rat).SetString(strings.TrimSpace(value.Amount))
	if !ok || amount.Sign() < 0 || len(value.CurrencyCode) != 3 ||
		strings.ToUpper(value.CurrencyCode) != value.CurrencyCode {
		return false
	}
	for _, r := range value.CurrencyCode {
		if r < 'A' || r > 'Z' {
			return false
		}
	}
	return true
}

type shopifyOrderEditQuantityUpdater func(
	context.Context, string, string, shopifyconnector.OrderEditQuantityRequest,
) (shopifyconnector.OrderEditQuantityResult, error)

type shopifyOrderEditQuantityAdapter struct {
	resolve shopifyConnectorBindingResolver
	store   Store
	token   shopifyOrderCatalogToken
	update  shopifyOrderEditQuantityUpdater
}

func newShopifyOrderEditQuantityAdapter(
	server *Server, resolver shopifyConnectorBindingResolver,
) *shopifyOrderEditQuantityAdapter {
	if server == nil {
		return newShopifyOrderEditQuantityAdapterWithUpdater(resolver, nil, nil, nil)
	}
	return newShopifyOrderEditQuantityAdapterWithUpdater(
		resolver, server.store, server.shopifyAdminTokenForShop, nil)
}

func newShopifyOrderEditQuantityAdapterWithUpdater(
	resolver shopifyConnectorBindingResolver, store Store,
	token shopifyOrderCatalogToken, update shopifyOrderEditQuantityUpdater,
) *shopifyOrderEditQuantityAdapter {
	if update == nil {
		update = (shopifyAdminClient{
			HTTPClient: &http.Client{Timeout: 20 * time.Second},
		}).UpdateOrderLineQuantity
	}
	return &shopifyOrderEditQuantityAdapter{
		resolve: resolver, store: store, token: token, update: update,
	}
}

func (a *shopifyOrderEditQuantityAdapter) UpdateOrderLineQuantity(
	ctx context.Context, request shopifyconnector.OrderEditQuantityRequest,
) (shopifyconnector.OrderEditQuantityResult, error) {
	if err := shopifyconnector.ValidateOrderEditQuantityRequest(request); err != nil {
		return shopifyconnector.OrderEditQuantityResult{},
			shopifyconnector.InvalidOrderEditQuantityRequestError(request)
	}
	if err := ctx.Err(); err != nil || a.resolve == nil || a.store == nil ||
		a.token == nil || a.update == nil {
		return shopifyconnector.OrderEditQuantityResult{},
			shopifyconnector.SafeOrderEditQuantityErrorFor(request, err)
	}
	legacyShopID, err := a.resolve.ResolveLegacyShopID(ctx, request.Identity)
	if err != nil || strings.TrimSpace(legacyShopID) == "" {
		return shopifyconnector.OrderEditQuantityResult{},
			shopifyconnector.ForbiddenOrderEditQuantityError(request)
	}
	shop, err := a.store.GetShop(ctx, legacyShopID)
	if err != nil || shop.Status != ShopStatusActive {
		return shopifyconnector.OrderEditQuantityResult{},
			shopifyconnector.ForbiddenOrderEditQuantityError(request)
	}
	sources, err := a.store.ListShopSources(ctx, legacyShopID)
	if err != nil {
		return shopifyconnector.OrderEditQuantityResult{},
			shopifyconnector.SafeOrderEditQuantityErrorFor(request, err)
	}
	domain := shopifyDomainForShop(shop, sources)
	installation, err := a.store.GetShopifyInstallationByDomain(ctx, domain)
	if err != nil ||
		!shopifyScopeIncludes(installation.Scope, shopifyOrderReadScope) ||
		!shopifyScopeIncludes(installation.Scope, shopifyOrderEditReadScope) ||
		!shopifyScopeIncludes(installation.Scope, shopifyOrderEditWriteScope) {
		return shopifyconnector.OrderEditQuantityResult{},
			shopifyconnector.ForbiddenOrderEditQuantityError(request)
	}
	accessToken := a.token(ctx, legacyShopID, domain)
	if domain == "" || strings.TrimSpace(accessToken) == "" {
		return shopifyconnector.OrderEditQuantityResult{},
			shopifyconnector.ForbiddenOrderEditQuantityError(request)
	}
	result, err := a.update(ctx, domain, accessToken, request)
	if err != nil {
		if errors.Is(err, ErrInvalid) {
			return shopifyconnector.OrderEditQuantityResult{},
				shopifyconnector.InvalidOrderEditQuantityRequestError(request)
		}
		if isShopifyAuthorizationError(err) {
			return shopifyconnector.OrderEditQuantityResult{},
				shopifyconnector.ForbiddenOrderEditQuantityError(request)
		}
		return shopifyconnector.OrderEditQuantityResult{},
			shopifyconnector.SafeOrderEditQuantityErrorFor(request, err)
	}
	if result.OrderID != request.OrderID || result.OrderLineID != request.OrderLineID ||
		result.Quantity != request.Quantity || !validNonNegativeCatalogMoney(result.Total) {
		return shopifyconnector.OrderEditQuantityResult{},
			shopifyconnector.SafeOrderEditQuantityErrorFor(
				request, errors.New("invalid provider result"))
	}
	result.ContractVersion = shopifyconnector.OrderEditQuantityContractVersion
	result.TenantID = request.Identity.TenantID
	result.ShopID = request.Identity.ShopID
	if result.UpdatedAt.IsZero() {
		result.UpdatedAt = time.Now().UTC()
	}
	return result, nil
}

var _ shopifyconnector.OrderEditQuantityWriter = (*shopifyOrderEditQuantityAdapter)(nil)
