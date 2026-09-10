package platform

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

const shopifyOrderEditAddVariantMutation = `
mutation XZERPOrderEditAddVariant(
  $id: ID!, $variantId: ID!, $quantity: Int!
) {
  orderEditAddVariant(
    id: $id, variantId: $variantId, quantity: $quantity,
    allowDuplicates: false
  ) {
    calculatedLineItem {
      id quantity sku title variantTitle
      originalUnitPriceSet { shopMoney { amount currencyCode } }
      variant { id }
    }
    userErrors { field message }
  }
}`

func (c shopifyAdminClient) AddOrderVariant(
	ctx context.Context,
	shopDomain string,
	accessToken string,
	request shopifyconnector.OrderAddVariantRequest,
) (shopifyconnector.OrderAddVariantResult, error) {
	current, err := c.fetchOrderLineState(
		ctx, shopDomain, accessToken, request.OrderID)
	if err != nil {
		return shopifyconnector.OrderAddVariantResult{}, err
	}
	matching := exactVariantOrderLines(current, request.VariantID)
	if len(matching) != 0 {
		if request.RecoverExisting && len(matching) == 1 &&
			matching[0].CurrentQuantity == request.Quantity &&
			validOrderAddVariantLine(matching[0], request.VariantID) {
			return orderAddVariantResult(
				request, matching[0], current.TotalPriceSet.ShopMoney, true), nil
		}
		return shopifyconnector.OrderAddVariantResult{},
			fmt.Errorf("%w: Shopify order already contains the variant", ErrInvalid)
	}

	calculatedOrderID, err := c.beginOrderAddVariantEdit(
		ctx, shopDomain, accessToken, request)
	if err != nil {
		return shopifyconnector.OrderAddVariantResult{}, err
	}
	added, err := c.addCalculatedOrderVariant(
		ctx, shopDomain, accessToken, calculatedOrderID, request)
	if err != nil {
		return shopifyconnector.OrderAddVariantResult{}, err
	}
	committed, err := c.commitOrderAddVariantEdit(
		ctx, shopDomain, accessToken, calculatedOrderID, request)
	if err != nil {
		return shopifyconnector.OrderAddVariantResult{}, err
	}
	matching = exactVariantOrderLines(committed, request.VariantID)
	if len(matching) != 1 || matching[0].CurrentQuantity != request.Quantity ||
		!validOrderAddVariantLine(matching[0], request.VariantID) ||
		added.Quantity != request.Quantity || added.Variant == nil ||
		added.Variant.ID != request.VariantID {
		return shopifyconnector.OrderAddVariantResult{},
			fmt.Errorf("%w: Shopify committed variant result is invalid", ErrInvalid)
	}
	return orderAddVariantResult(
		request, matching[0], committed.TotalPriceSet.ShopMoney, false), nil
}

func exactVariantOrderLines(
	order shopifyOrderState, variantID string,
) []shopifyOrderLineState {
	matched := make([]shopifyOrderLineState, 0, 1)
	for _, line := range order.LineItems.Nodes {
		if line.Variant != nil && line.Variant.ID == variantID {
			matched = append(matched, line)
		}
	}
	return matched
}

func validOrderAddVariantLine(
	line shopifyOrderLineState, variantID string,
) bool {
	return numericShopifyGID(line.ID, "gid://shopify/LineItem/") &&
		line.Variant != nil && line.Variant.ID == variantID &&
		line.CurrentQuantity > 0 && line.CurrentQuantity <= 100_000 &&
		strings.TrimSpace(firstNonEmpty(line.Name, line.Title)) != "" &&
		validNonNegativeCatalogMoney(line.OriginalUnitPriceSet.ShopMoney)
}

func (c shopifyAdminClient) beginOrderAddVariantEdit(
	ctx context.Context, shopDomain string, accessToken string,
	request shopifyconnector.OrderAddVariantRequest,
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
	if err := shopifyMutationError("开始订单编辑", payload.UserErrors); err != nil {
		return "", err
	}
	if payload.CalculatedOrder == nil ||
		!numericShopifyGID(payload.CalculatedOrder.ID, "gid://shopify/CalculatedOrder/") ||
		payload.CalculatedOrder.LineItems.PageInfo.HasNextPage ||
		len(payload.CalculatedOrder.LineItems.Nodes) > 100 {
		return "", fmt.Errorf("%w: Shopify calculated order is incomplete", ErrInvalid)
	}
	for _, line := range payload.CalculatedOrder.LineItems.Nodes {
		if line.Variant != nil && line.Variant.ID == request.VariantID {
			return "", fmt.Errorf("%w: Shopify calculated order already contains the variant", ErrInvalid)
		}
	}
	return payload.CalculatedOrder.ID, nil
}

func (c shopifyAdminClient) addCalculatedOrderVariant(
	ctx context.Context, shopDomain string, accessToken string,
	calculatedOrderID string, request shopifyconnector.OrderAddVariantRequest,
) (shopifyOrderLineState, error) {
	var data struct {
		OrderEditAddVariant struct {
			CalculatedLineItem *shopifyOrderLineState     `json:"calculatedLineItem"`
			UserErrors         []shopifyMutationUserError `json:"userErrors"`
		} `json:"orderEditAddVariant"`
	}
	variables := map[string]any{
		"id": calculatedOrderID, "variantId": request.VariantID,
		"quantity": request.Quantity,
	}
	if err := c.queryAdminGraphQL(ctx, shopDomain, accessToken,
		shopifyOrderEditAddVariantMutation, variables, &data); err != nil {
		return shopifyOrderLineState{}, err
	}
	payload := data.OrderEditAddVariant
	if err := shopifyMutationError("新增订单商品", payload.UserErrors); err != nil {
		return shopifyOrderLineState{}, err
	}
	if payload.CalculatedLineItem == nil ||
		!numericShopifyGID(payload.CalculatedLineItem.ID, "gid://shopify/CalculatedLineItem/") ||
		payload.CalculatedLineItem.Quantity != request.Quantity ||
		payload.CalculatedLineItem.Variant == nil ||
		payload.CalculatedLineItem.Variant.ID != request.VariantID ||
		!validNonNegativeCatalogMoney(payload.CalculatedLineItem.OriginalUnitPriceSet.ShopMoney) {
		return shopifyOrderLineState{},
			fmt.Errorf("%w: Shopify added variant result is invalid", ErrInvalid)
	}
	return *payload.CalculatedLineItem, nil
}

func (c shopifyAdminClient) commitOrderAddVariantEdit(
	ctx context.Context, shopDomain string, accessToken string,
	calculatedOrderID string, request shopifyconnector.OrderAddVariantRequest,
) (shopifyOrderState, error) {
	var data struct {
		OrderEditCommit struct {
			Order      *shopifyOrderState         `json:"order"`
			UserErrors []shopifyMutationUserError `json:"userErrors"`
		} `json:"orderEditCommit"`
	}
	variables := map[string]any{
		"id": calculatedOrderID, "notifyCustomer": request.NotifyCustomer,
		"staffNote": "Added variant from XZ ERP",
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

func orderAddVariantResult(
	request shopifyconnector.OrderAddVariantRequest,
	line shopifyOrderLineState,
	total shopifyconnector.CatalogMoney,
	recovered bool,
) shopifyconnector.OrderAddVariantResult {
	return shopifyconnector.OrderAddVariantResult{
		ContractVersion: shopifyconnector.OrderAddVariantContractVersion,
		TenantID:        request.Identity.TenantID, ShopID: request.Identity.ShopID,
		OrderID: request.OrderID, OrderLineID: line.ID,
		VariantID: request.VariantID, Quantity: request.Quantity,
		SKU:          strings.TrimSpace(line.SKU),
		Title:        strings.TrimSpace(firstNonEmpty(line.Name, line.Title)),
		VariantTitle: strings.TrimSpace(line.VariantTitle),
		UnitPrice:    line.OriginalUnitPriceSet.ShopMoney, Total: total,
		RecoveredFromShopify: recovered, UpdatedAt: time.Now().UTC(),
	}
}

type shopifyOrderAddVariantUpdater func(
	context.Context, string, string, shopifyconnector.OrderAddVariantRequest,
) (shopifyconnector.OrderAddVariantResult, error)

type shopifyOrderAddVariantAdapter struct {
	resolve shopifyConnectorBindingResolver
	store   Store
	token   shopifyOrderCatalogToken
	add     shopifyOrderAddVariantUpdater
}

func newShopifyOrderAddVariantAdapter(
	server *Server, resolver shopifyConnectorBindingResolver,
) *shopifyOrderAddVariantAdapter {
	if server == nil {
		return newShopifyOrderAddVariantAdapterWithUpdater(resolver, nil, nil, nil)
	}
	return newShopifyOrderAddVariantAdapterWithUpdater(
		resolver, server.store, server.shopifyAdminTokenForShop, nil)
}

func newShopifyOrderAddVariantAdapterWithUpdater(
	resolver shopifyConnectorBindingResolver, store Store,
	token shopifyOrderCatalogToken, add shopifyOrderAddVariantUpdater,
) *shopifyOrderAddVariantAdapter {
	if add == nil {
		add = (shopifyAdminClient{
			HTTPClient: &http.Client{Timeout: 20 * time.Second},
		}).AddOrderVariant
	}
	return &shopifyOrderAddVariantAdapter{
		resolve: resolver, store: store, token: token, add: add,
	}
}

func (a *shopifyOrderAddVariantAdapter) AddOrderVariant(
	ctx context.Context, request shopifyconnector.OrderAddVariantRequest,
) (shopifyconnector.OrderAddVariantResult, error) {
	if err := shopifyconnector.ValidateOrderAddVariantRequest(request); err != nil {
		return shopifyconnector.OrderAddVariantResult{},
			shopifyconnector.InvalidOrderAddVariantRequestError(request)
	}
	if err := ctx.Err(); err != nil || a.resolve == nil || a.store == nil ||
		a.token == nil || a.add == nil {
		return shopifyconnector.OrderAddVariantResult{},
			shopifyconnector.SafeOrderAddVariantErrorFor(request, err)
	}
	legacyShopID, err := a.resolve.ResolveLegacyShopID(ctx, request.Identity)
	if err != nil || strings.TrimSpace(legacyShopID) == "" {
		return shopifyconnector.OrderAddVariantResult{},
			shopifyconnector.ForbiddenOrderAddVariantError(request)
	}
	shop, err := a.store.GetShop(ctx, legacyShopID)
	if err != nil || shop.Status != ShopStatusActive {
		return shopifyconnector.OrderAddVariantResult{},
			shopifyconnector.ForbiddenOrderAddVariantError(request)
	}
	sources, err := a.store.ListShopSources(ctx, legacyShopID)
	if err != nil {
		return shopifyconnector.OrderAddVariantResult{},
			shopifyconnector.SafeOrderAddVariantErrorFor(request, err)
	}
	domain := shopifyDomainForShop(shop, sources)
	installation, err := a.store.GetShopifyInstallationByDomain(ctx, domain)
	if err != nil ||
		!shopifyScopeIncludes(installation.Scope, shopifyOrderReadScope) ||
		!shopifyScopeIncludes(installation.Scope, shopifyOrderEditReadScope) ||
		!shopifyScopeIncludes(installation.Scope, shopifyOrderEditWriteScope) {
		return shopifyconnector.OrderAddVariantResult{},
			shopifyconnector.ForbiddenOrderAddVariantError(request)
	}
	accessToken := a.token(ctx, legacyShopID, domain)
	if domain == "" || strings.TrimSpace(accessToken) == "" {
		return shopifyconnector.OrderAddVariantResult{},
			shopifyconnector.ForbiddenOrderAddVariantError(request)
	}
	result, err := a.add(ctx, domain, accessToken, request)
	if err != nil {
		if errors.Is(err, ErrInvalid) {
			return shopifyconnector.OrderAddVariantResult{},
				shopifyconnector.InvalidOrderAddVariantRequestError(request)
		}
		if isShopifyAuthorizationError(err) {
			return shopifyconnector.OrderAddVariantResult{},
				shopifyconnector.ForbiddenOrderAddVariantError(request)
		}
		return shopifyconnector.OrderAddVariantResult{},
			shopifyconnector.SafeOrderAddVariantErrorFor(request, err)
	}
	if result.OrderID != request.OrderID || result.VariantID != request.VariantID ||
		result.Quantity != request.Quantity ||
		!numericShopifyGID(result.OrderLineID, "gid://shopify/LineItem/") ||
		strings.TrimSpace(result.Title) == "" ||
		!validNonNegativeCatalogMoney(result.UnitPrice) ||
		!validNonNegativeCatalogMoney(result.Total) {
		return shopifyconnector.OrderAddVariantResult{},
			shopifyconnector.SafeOrderAddVariantErrorFor(
				request, errors.New("invalid provider result"))
	}
	result.ContractVersion = shopifyconnector.OrderAddVariantContractVersion
	result.TenantID = request.Identity.TenantID
	result.ShopID = request.Identity.ShopID
	if result.UpdatedAt.IsZero() {
		result.UpdatedAt = time.Now().UTC()
	}
	return result, nil
}

var _ shopifyconnector.OrderVariantAdder = (*shopifyOrderAddVariantAdapter)(nil)
