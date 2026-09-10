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

const shopifyOrderEditAddCustomItemMutation = `
mutation XZERPOrderEditAddCustomItem(
  $id: ID!, $title: String!, $price: MoneyInput!, $quantity: Int!,
  $requiresShipping: Boolean, $taxable: Boolean
) {
  orderEditAddCustomItem(
    id: $id, title: $title, price: $price, quantity: $quantity,
    requiresShipping: $requiresShipping, taxable: $taxable
  ) {
    calculatedLineItem {
      id quantity title requiresShipping taxable
      originalUnitPriceSet { shopMoney { amount currencyCode } }
      variant { id }
    }
    userErrors { field message }
  }
}`

func (c shopifyAdminClient) AddOrderCustomItem(
	ctx context.Context,
	shopDomain string,
	accessToken string,
	request shopifyconnector.OrderAddCustomItemRequest,
) (shopifyconnector.OrderAddCustomItemResult, error) {
	current, err := c.fetchOrderLineState(
		ctx, shopDomain, accessToken, request.OrderID)
	if err != nil {
		return shopifyconnector.OrderAddCustomItemResult{}, err
	}
	matching := exactCustomOrderLines(current.LineItems.Nodes, request, false)
	if len(matching) != 0 {
		if request.RecoverExisting && len(matching) == 1 {
			return orderAddCustomItemResult(
				request, matching[0], current.TotalPriceSet.ShopMoney, true), nil
		}
		return shopifyconnector.OrderAddCustomItemResult{},
			fmt.Errorf("%w: Shopify order already contains the custom item", ErrInvalid)
	}

	calculatedOrderID, err := c.beginOrderAddCustomItemEdit(
		ctx, shopDomain, accessToken, request)
	if err != nil {
		return shopifyconnector.OrderAddCustomItemResult{}, err
	}
	added, err := c.addCalculatedOrderCustomItem(
		ctx, shopDomain, accessToken, calculatedOrderID, request)
	if err != nil {
		return shopifyconnector.OrderAddCustomItemResult{}, err
	}
	committed, err := c.commitOrderAddCustomItemEdit(
		ctx, shopDomain, accessToken, calculatedOrderID, request)
	if err != nil {
		return shopifyconnector.OrderAddCustomItemResult{}, err
	}
	matching = exactCustomOrderLines(committed.LineItems.Nodes, request, false)
	if len(matching) != 1 || !customOrderLineMatches(added, request, true) {
		return shopifyconnector.OrderAddCustomItemResult{},
			fmt.Errorf("%w: Shopify committed custom item result is invalid", ErrInvalid)
	}
	return orderAddCustomItemResult(
		request, matching[0], committed.TotalPriceSet.ShopMoney, false), nil
}

func exactCustomOrderLines(
	lines []shopifyOrderLineState,
	request shopifyconnector.OrderAddCustomItemRequest,
	calculated bool,
) []shopifyOrderLineState {
	matched := make([]shopifyOrderLineState, 0, 1)
	for _, line := range lines {
		if customOrderLineMatches(line, request, calculated) {
			matched = append(matched, line)
		}
	}
	return matched
}

func customOrderLineMatches(
	line shopifyOrderLineState,
	request shopifyconnector.OrderAddCustomItemRequest,
	calculated bool,
) bool {
	quantity := line.CurrentQuantity
	prefix := "gid://shopify/LineItem/"
	if calculated {
		quantity = line.Quantity
		prefix = "gid://shopify/CalculatedLineItem/"
	}
	return numericShopifyGID(line.ID, prefix) && line.Variant == nil &&
		strings.TrimSpace(firstNonEmpty(line.Name, line.Title)) == request.Title &&
		quantity == request.Quantity &&
		line.RequiresShipping == request.RequiresShipping &&
		line.Taxable == request.Taxable &&
		catalogMoneyEqual(line.OriginalUnitPriceSet.ShopMoney, request.UnitPrice)
}

func catalogMoneyEqual(left, right shopifyconnector.CatalogMoney) bool {
	leftAmount, leftOK := new(big.Rat).SetString(strings.TrimSpace(left.Amount))
	rightAmount, rightOK := new(big.Rat).SetString(strings.TrimSpace(right.Amount))
	return leftOK && rightOK && leftAmount.Cmp(rightAmount) == 0 &&
		left.CurrencyCode == right.CurrencyCode
}

func (c shopifyAdminClient) beginOrderAddCustomItemEdit(
	ctx context.Context, shopDomain string, accessToken string,
	request shopifyconnector.OrderAddCustomItemRequest,
) (string, error) {
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
		return "", err
	}
	payload := data.OrderEditBegin
	if err := shopifyMutationError("start order edit", payload.UserErrors); err != nil {
		return "", err
	}
	if payload.CalculatedOrder == nil ||
		!numericShopifyGID(payload.CalculatedOrder.ID, "gid://shopify/CalculatedOrder/") ||
		payload.CalculatedOrder.LineItems.PageInfo.HasNextPage ||
		len(payload.CalculatedOrder.LineItems.Nodes) > 100 ||
		len(exactCustomOrderLines(
			payload.CalculatedOrder.LineItems.Nodes, request, true)) != 0 {
		return "", fmt.Errorf("%w: Shopify calculated order is incomplete or already contains the custom item", ErrInvalid)
	}
	return payload.CalculatedOrder.ID, nil
}

func (c shopifyAdminClient) addCalculatedOrderCustomItem(
	ctx context.Context, shopDomain string, accessToken string,
	calculatedOrderID string, request shopifyconnector.OrderAddCustomItemRequest,
) (shopifyOrderLineState, error) {
	var data struct {
		OrderEditAddCustomItem struct {
			CalculatedLineItem *shopifyOrderLineState     `json:"calculatedLineItem"`
			UserErrors         []shopifyMutationUserError `json:"userErrors"`
		} `json:"orderEditAddCustomItem"`
	}
	variables := map[string]any{
		"id": calculatedOrderID, "title": request.Title,
		"price": map[string]any{
			"amount":       request.UnitPrice.Amount,
			"currencyCode": request.UnitPrice.CurrencyCode,
		},
		"quantity":         request.Quantity,
		"requiresShipping": request.RequiresShipping,
		"taxable":          request.Taxable,
	}
	if err := c.queryAdminGraphQL(ctx, shopDomain, accessToken,
		shopifyOrderEditAddCustomItemMutation, variables, &data); err != nil {
		return shopifyOrderLineState{}, err
	}
	payload := data.OrderEditAddCustomItem
	if err := shopifyMutationError("add custom order item", payload.UserErrors); err != nil {
		return shopifyOrderLineState{}, err
	}
	if payload.CalculatedLineItem == nil ||
		!customOrderLineMatches(*payload.CalculatedLineItem, request, true) {
		return shopifyOrderLineState{},
			fmt.Errorf("%w: Shopify added custom item result is invalid", ErrInvalid)
	}
	return *payload.CalculatedLineItem, nil
}

func (c shopifyAdminClient) commitOrderAddCustomItemEdit(
	ctx context.Context, shopDomain string, accessToken string,
	calculatedOrderID string, request shopifyconnector.OrderAddCustomItemRequest,
) (shopifyOrderState, error) {
	var data struct {
		OrderEditCommit struct {
			Order      *shopifyOrderState         `json:"order"`
			UserErrors []shopifyMutationUserError `json:"userErrors"`
		} `json:"orderEditCommit"`
	}
	variables := map[string]any{
		"id": calculatedOrderID, "notifyCustomer": request.NotifyCustomer,
		"staffNote": "Added custom item from XZ ERP",
	}
	if err := c.queryAdminGraphQL(ctx, shopDomain, accessToken,
		shopifyOrderEditCommitMutation, variables, &data); err != nil {
		return shopifyOrderState{}, err
	}
	payload := data.OrderEditCommit
	if err := shopifyMutationError("commit order edit", payload.UserErrors); err != nil {
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

func orderAddCustomItemResult(
	request shopifyconnector.OrderAddCustomItemRequest,
	line shopifyOrderLineState,
	total shopifyconnector.CatalogMoney,
	recovered bool,
) shopifyconnector.OrderAddCustomItemResult {
	return shopifyconnector.OrderAddCustomItemResult{
		ContractVersion: shopifyconnector.OrderAddCustomItemContractVersion,
		TenantID:        request.Identity.TenantID, ShopID: request.Identity.ShopID,
		OrderID: request.OrderID, OrderLineID: line.ID,
		Title: request.Title, UnitPrice: line.OriginalUnitPriceSet.ShopMoney,
		Quantity: request.Quantity, Total: total,
		RecoveredFromShopify: recovered, UpdatedAt: time.Now().UTC(),
	}
}

type shopifyOrderAddCustomItemUpdater func(
	context.Context, string, string, shopifyconnector.OrderAddCustomItemRequest,
) (shopifyconnector.OrderAddCustomItemResult, error)

type shopifyOrderAddCustomItemAdapter struct {
	resolve shopifyConnectorBindingResolver
	store   Store
	token   shopifyOrderCatalogToken
	add     shopifyOrderAddCustomItemUpdater
}

func newShopifyOrderAddCustomItemAdapter(
	server *Server, resolver shopifyConnectorBindingResolver,
) *shopifyOrderAddCustomItemAdapter {
	if server == nil {
		return newShopifyOrderAddCustomItemAdapterWithUpdater(resolver, nil, nil, nil)
	}
	return newShopifyOrderAddCustomItemAdapterWithUpdater(
		resolver, server.store, server.shopifyAdminTokenForShop, nil)
}

func newShopifyOrderAddCustomItemAdapterWithUpdater(
	resolver shopifyConnectorBindingResolver, store Store,
	token shopifyOrderCatalogToken, add shopifyOrderAddCustomItemUpdater,
) *shopifyOrderAddCustomItemAdapter {
	if add == nil {
		add = (shopifyAdminClient{
			HTTPClient: &http.Client{Timeout: 20 * time.Second},
		}).AddOrderCustomItem
	}
	return &shopifyOrderAddCustomItemAdapter{
		resolve: resolver, store: store, token: token, add: add,
	}
}

func (a *shopifyOrderAddCustomItemAdapter) AddOrderCustomItem(
	ctx context.Context, request shopifyconnector.OrderAddCustomItemRequest,
) (shopifyconnector.OrderAddCustomItemResult, error) {
	if err := shopifyconnector.ValidateOrderAddCustomItemRequest(request); err != nil {
		return shopifyconnector.OrderAddCustomItemResult{},
			shopifyconnector.InvalidOrderAddCustomItemRequestError(request)
	}
	if err := ctx.Err(); err != nil || a.resolve == nil || a.store == nil ||
		a.token == nil || a.add == nil {
		return shopifyconnector.OrderAddCustomItemResult{},
			shopifyconnector.SafeOrderAddCustomItemErrorFor(request, err)
	}
	legacyShopID, err := a.resolve.ResolveLegacyShopID(ctx, request.Identity)
	if err != nil || strings.TrimSpace(legacyShopID) == "" {
		return shopifyconnector.OrderAddCustomItemResult{},
			shopifyconnector.ForbiddenOrderAddCustomItemError(request)
	}
	shop, err := a.store.GetShop(ctx, legacyShopID)
	if err != nil || shop.Status != ShopStatusActive {
		return shopifyconnector.OrderAddCustomItemResult{},
			shopifyconnector.ForbiddenOrderAddCustomItemError(request)
	}
	sources, err := a.store.ListShopSources(ctx, legacyShopID)
	if err != nil {
		return shopifyconnector.OrderAddCustomItemResult{},
			shopifyconnector.SafeOrderAddCustomItemErrorFor(request, err)
	}
	domain := shopifyDomainForShop(shop, sources)
	installation, err := a.store.GetShopifyInstallationByDomain(ctx, domain)
	if err != nil ||
		!shopifyScopeIncludes(installation.Scope, shopifyOrderReadScope) ||
		!shopifyScopeIncludes(installation.Scope, shopifyOrderEditReadScope) ||
		!shopifyScopeIncludes(installation.Scope, shopifyOrderEditWriteScope) {
		return shopifyconnector.OrderAddCustomItemResult{},
			shopifyconnector.ForbiddenOrderAddCustomItemError(request)
	}
	accessToken := a.token(ctx, legacyShopID, domain)
	if domain == "" || strings.TrimSpace(accessToken) == "" {
		return shopifyconnector.OrderAddCustomItemResult{},
			shopifyconnector.ForbiddenOrderAddCustomItemError(request)
	}
	result, err := a.add(ctx, domain, accessToken, request)
	if err != nil {
		if errors.Is(err, ErrInvalid) {
			return shopifyconnector.OrderAddCustomItemResult{},
				shopifyconnector.InvalidOrderAddCustomItemRequestError(request)
		}
		if isShopifyAuthorizationError(err) {
			return shopifyconnector.OrderAddCustomItemResult{},
				shopifyconnector.ForbiddenOrderAddCustomItemError(request)
		}
		return shopifyconnector.OrderAddCustomItemResult{},
			shopifyconnector.SafeOrderAddCustomItemErrorFor(request, err)
	}
	if result.OrderID != request.OrderID || result.Title != request.Title ||
		result.Quantity != request.Quantity ||
		!numericShopifyGID(result.OrderLineID, "gid://shopify/LineItem/") ||
		!catalogMoneyEqual(result.UnitPrice, request.UnitPrice) ||
		!validNonNegativeCatalogMoney(result.Total) {
		return shopifyconnector.OrderAddCustomItemResult{},
			shopifyconnector.SafeOrderAddCustomItemErrorFor(
				request, errors.New("invalid provider result"))
	}
	result.ContractVersion = shopifyconnector.OrderAddCustomItemContractVersion
	result.TenantID = request.Identity.TenantID
	result.ShopID = request.Identity.ShopID
	if result.UpdatedAt.IsZero() {
		result.UpdatedAt = time.Now().UTC()
	}
	return result, nil
}

var _ shopifyconnector.OrderCustomItemAdder = (*shopifyOrderAddCustomItemAdapter)(nil)
