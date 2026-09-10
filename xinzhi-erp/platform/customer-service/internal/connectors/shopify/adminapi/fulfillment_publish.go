package adminapi

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

const shopifyFulfillmentContextLimit = 100

type fulfillmentTrackingInfo struct {
	Company string `json:"company"`
	Number  string `json:"number"`
	URL     string `json:"url"`
}

type shopifyFulfillmentContext struct {
	Order *shopifyFulfillmentOrderContext
}

type shopifyFulfillmentOrderContext struct {
	ID                string
	FulfillmentOrders shopifyFulfillmentOrderConnection
	Fulfillments      []shopifyPublishedFulfillment
}

type shopifyFulfillmentOrderConnection struct {
	Nodes    []shopifyFulfillmentOrderNode `json:"nodes"`
	PageInfo shopifyFulfillmentPageInfo    `json:"pageInfo"`
}

type shopifyFulfillmentOrderNode struct {
	ID               string   `json:"id"`
	Status           string   `json:"status"`
	SupportedActions []string `json:"supportedActions"`
	AssignedLocation struct {
		Location *struct {
			ID string `json:"id"`
		} `json:"location"`
	} `json:"assignedLocation"`
	LineItems shopifyFulfillmentOrderLineItemConnection `json:"lineItems"`
}

type shopifyFulfillmentOrderLineItemConnection struct {
	Nodes    []shopifyFulfillmentOrderLineItemNode `json:"nodes"`
	PageInfo shopifyFulfillmentPageInfo            `json:"pageInfo"`
}

type shopifyFulfillmentOrderLineItemNode struct {
	ID                string `json:"id"`
	RemainingQuantity int    `json:"remainingQuantity"`
	LineItem          *struct {
		ID string `json:"id"`
	} `json:"lineItem"`
}

type shopifyPublishedFulfillment struct {
	ID                   string `json:"id"`
	Status               string `json:"status"`
	UpdatedAt            time.Time
	TrackingInfo         []fulfillmentTrackingInfo                     `json:"trackingInfo"`
	FulfillmentLineItems shopifyPublishedFulfillmentLineItemConnection `json:"fulfillmentLineItems"`
}

type shopifyPublishedFulfillmentLineItemConnection struct {
	Nodes    []shopifyPublishedFulfillmentLineItemNode `json:"nodes"`
	PageInfo shopifyFulfillmentPageInfo                `json:"pageInfo"`
}

type shopifyPublishedFulfillmentLineItemNode struct {
	Quantity int `json:"quantity"`
	LineItem *struct {
		ID string `json:"id"`
	} `json:"lineItem"`
}

type shopifyFulfillmentPageInfo struct {
	HasNextPage bool   `json:"hasNextPage"`
	EndCursor   string `json:"endCursor"`
}

type shopifyFulfillmentOrderLine struct {
	ID       string
	Quantity int
}

type shopifyFulfillmentOrderGroup struct {
	FulfillmentOrderID string
	LocationID         string
	Lines              []shopifyFulfillmentOrderLine
}

type recoveredFulfillment struct {
	ID        string
	Tracking  shopifyconnector.CatalogTrackingInfo
	UpdatedAt time.Time
}

func (c *Client) PublishFulfillment(
	ctx context.Context,
	shopDomain string,
	accessToken string,
	request shopifyconnector.FulfillmentPublishRequest,
) (shopifyconnector.FulfillmentPublishResult, error) {
	if err := shopifyconnector.ValidateFulfillmentPublishRequest(request); err != nil {
		return shopifyconnector.FulfillmentPublishResult{}, err
	}
	if c == nil || c.httpClient == nil || c.now == nil {
		return shopifyconnector.FulfillmentPublishResult{}, fmt.Errorf("Shopify Admin API fulfillment provider is unavailable")
	}
	var wire fulfillmentContextWire
	if err := c.queryGraphQL(
		ctx,
		shopDomain,
		accessToken,
		shopifyFulfillmentContextQuery,
		map[string]any{"orderId": request.OrderID},
		&wire,
	); err != nil {
		return shopifyconnector.FulfillmentPublishResult{}, err
	}
	order, err := normalizeFulfillmentContext(wire, request.OrderID)
	if err != nil {
		return shopifyconnector.FulfillmentPublishResult{}, err
	}
	data := shopifyFulfillmentContext{Order: order}
	if len(data.Order.Fulfillments) > shopifyFulfillmentContextLimit {
		return shopifyconnector.FulfillmentPublishResult{}, fmt.Errorf("%w: fulfillment limit exceeded", shopifyconnector.ErrInvalidFulfillment)
	}
	if err := c.fetchRemainingFulfillmentOrders(
		ctx, shopDomain, accessToken, data.Order.ID, &data.Order.FulfillmentOrders,
	); err != nil {
		return shopifyconnector.FulfillmentPublishResult{}, err
	}
	for index := range data.Order.FulfillmentOrders.Nodes {
		if err := c.fetchRemainingFulfillmentOrderLineItems(
			ctx, shopDomain, accessToken, &data.Order.FulfillmentOrders.Nodes[index],
		); err != nil {
			return shopifyconnector.FulfillmentPublishResult{}, err
		}
	}
	for index := range data.Order.Fulfillments {
		if err := c.fetchRemainingPublishedFulfillmentLineItems(
			ctx, shopDomain, accessToken, &data.Order.Fulfillments[index],
		); err != nil {
			return shopifyconnector.FulfillmentPublishResult{}, err
		}
	}
	if err := validateCompleteFulfillmentContext(data.Order); err != nil {
		return shopifyconnector.FulfillmentPublishResult{}, err
	}

	requested := requestedFulfillmentLineQuantities(request.Lines)
	if recovered, ok, err := recoverPublishedFulfillment(
		data.Order.Fulfillments,
		request.Tracking.Number,
		requested,
	); err != nil {
		return shopifyconnector.FulfillmentPublishResult{}, err
	} else if ok {
		return validatedFulfillmentPublishResult(request, shopifyconnector.FulfillmentPublishResult{
			ContractVersion:      shopifyconnector.FulfillmentPublishContractVersion,
			TenantID:             request.Identity.TenantID,
			ShopID:               request.Identity.ShopID,
			OrderID:              request.OrderID,
			FulfillmentIDs:       []string{recovered.ID},
			Tracking:             recovered.Tracking,
			RecoveredFromShopify: true,
			UpdatedAt:            recovered.UpdatedAt,
		})
	}

	groups, err := fulfillmentOrderGroups(
		data.Order.FulfillmentOrders.Nodes,
		requested,
	)
	if err != nil {
		return shopifyconnector.FulfillmentPublishResult{}, err
	}
	lineItemsByOrder := make([]map[string]any, 0, len(groups))
	for _, group := range groups {
		lines := make([]map[string]any, 0, len(group.Lines))
		for _, line := range group.Lines {
			lines = append(lines, map[string]any{
				"id":       line.ID,
				"quantity": line.Quantity,
			})
		}
		lineItemsByOrder = append(lineItemsByOrder, map[string]any{
			"fulfillmentOrderId":        group.FulfillmentOrderID,
			"fulfillmentOrderLineItems": lines,
		})
	}
	tracking := map[string]any{"number": request.Tracking.Number}
	if request.Tracking.Company != "" {
		tracking["company"] = request.Tracking.Company
	}
	if request.Tracking.URL != "" {
		tracking["url"] = request.Tracking.URL
	}
	var mutation fulfillmentMutationWire
	if err := c.queryGraphQL(
		ctx,
		shopDomain,
		accessToken,
		shopifyFulfillmentCreateMutation,
		map[string]any{
			"fulfillment": map[string]any{
				"lineItemsByFulfillmentOrder": lineItemsByOrder,
				"notifyCustomer":              request.NotifyCustomer,
				"trackingInfo":                tracking,
			},
			"message": "XZ ERP shipment " + request.IdempotencyKey,
		},
		&mutation,
	); err != nil {
		return shopifyconnector.FulfillmentPublishResult{}, err
	}
	created, _, rejected, err := normalizeCreatedFulfillment(mutation)
	if err != nil {
		return shopifyconnector.FulfillmentPublishResult{}, err
	}
	if rejected {
		return shopifyconnector.FulfillmentPublishResult{}, shopifyconnector.ErrInvalidFulfillment
	}
	trackingResult, ok := exactFulfillmentTracking(
		created.TrackingInfo, request.Tracking.Number,
	)
	if !ok {
		return shopifyconnector.FulfillmentPublishResult{}, incompleteShopifyFulfillmentContext("created fulfillment tracking")
	}
	return validatedFulfillmentPublishResult(request, shopifyconnector.FulfillmentPublishResult{
		ContractVersion:      shopifyconnector.FulfillmentPublishContractVersion,
		TenantID:             request.Identity.TenantID,
		ShopID:               request.Identity.ShopID,
		OrderID:              request.OrderID,
		FulfillmentIDs:       []string{created.ID},
		Tracking:             trackingResult,
		RecoveredFromShopify: false,
		UpdatedAt:            created.UpdatedAt,
	})
}

func (c *Client) fetchRemainingFulfillmentOrders(
	ctx context.Context,
	shopDomain string,
	accessToken string,
	orderID string,
	connection *shopifyFulfillmentOrderConnection,
) error {
	seenCursors := make(map[string]struct{})
	for connection.PageInfo.HasNextPage {
		cursor := strings.TrimSpace(connection.PageInfo.EndCursor)
		if cursor == "" {
			return incompleteShopifyFulfillmentContext("fulfillment orders")
		}
		if _, exists := seenCursors[cursor]; exists {
			return incompleteShopifyFulfillmentContext("fulfillment orders")
		}
		seenCursors[cursor] = struct{}{}

		var data struct {
			Order requiredFulfillmentField[fulfillmentOrderContextWire] `json:"order"`
		}
		if err := c.queryGraphQL(
			ctx,
			shopDomain,
			accessToken,
			shopifyFulfillmentOrderPageQuery,
			map[string]any{"orderId": orderID, "after": cursor},
			&data,
		); err != nil {
			return err
		}
		if !data.Order.Set || data.Order.Null ||
			!requiredString(data.Order.Value.ID) || data.Order.Value.ID.Value != orderID {
			return incompleteShopifyFulfillmentContext("fulfillment orders")
		}
		page, err := normalizeFulfillmentOrderConnection(
			data.Order.Value.FulfillmentOrders,
		)
		if err != nil {
			return err
		}
		connection.Nodes = append(connection.Nodes, page.Nodes...)
		connection.PageInfo = page.PageInfo
	}
	return nil
}

func (c *Client) fetchRemainingFulfillmentOrderLineItems(
	ctx context.Context,
	shopDomain string,
	accessToken string,
	order *shopifyFulfillmentOrderNode,
) error {
	seenCursors := make(map[string]struct{})
	for order.LineItems.PageInfo.HasNextPage {
		cursor := strings.TrimSpace(order.LineItems.PageInfo.EndCursor)
		if cursor == "" {
			return incompleteShopifyFulfillmentContext("fulfillment order line items")
		}
		if _, exists := seenCursors[cursor]; exists {
			return incompleteShopifyFulfillmentContext("fulfillment order line items")
		}
		seenCursors[cursor] = struct{}{}

		var data struct {
			FulfillmentOrder requiredFulfillmentField[fulfillmentOrderNodeWire] `json:"fulfillmentOrder"`
		}
		if err := c.queryGraphQL(
			ctx,
			shopDomain,
			accessToken,
			shopifyFulfillmentOrderLineItemPageQuery,
			map[string]any{"fulfillmentOrderId": order.ID, "after": cursor},
			&data,
		); err != nil {
			return err
		}
		if !data.FulfillmentOrder.Set || data.FulfillmentOrder.Null ||
			!requiredString(data.FulfillmentOrder.Value.ID) ||
			data.FulfillmentOrder.Value.ID.Value != order.ID {
			return incompleteShopifyFulfillmentContext("fulfillment order line items")
		}
		lines, err := normalizeFulfillmentOrderLines(
			data.FulfillmentOrder.Value.LineItems,
		)
		if err != nil {
			return err
		}
		order.LineItems.Nodes = append(order.LineItems.Nodes, lines.Nodes...)
		order.LineItems.PageInfo = lines.PageInfo
	}
	return nil
}

func (c *Client) fetchRemainingPublishedFulfillmentLineItems(
	ctx context.Context,
	shopDomain string,
	accessToken string,
	fulfillment *shopifyPublishedFulfillment,
) error {
	seenCursors := make(map[string]struct{})
	for fulfillment.FulfillmentLineItems.PageInfo.HasNextPage {
		cursor := strings.TrimSpace(fulfillment.FulfillmentLineItems.PageInfo.EndCursor)
		if cursor == "" {
			return incompleteShopifyFulfillmentContext("published fulfillment line items")
		}
		if _, exists := seenCursors[cursor]; exists {
			return incompleteShopifyFulfillmentContext("published fulfillment line items")
		}
		seenCursors[cursor] = struct{}{}

		var data struct {
			Fulfillment requiredFulfillmentField[publishedFulfillmentWire] `json:"fulfillment"`
		}
		if err := c.queryGraphQL(
			ctx,
			shopDomain,
			accessToken,
			shopifyFulfillmentLineItemPageQuery,
			map[string]any{"fulfillmentId": fulfillment.ID, "after": cursor},
			&data,
		); err != nil {
			return err
		}
		if !data.Fulfillment.Set || data.Fulfillment.Null ||
			!requiredString(data.Fulfillment.Value.ID) ||
			data.Fulfillment.Value.ID.Value != fulfillment.ID {
			return incompleteShopifyFulfillmentContext("published fulfillment line items")
		}
		lines, err := normalizePublishedFulfillmentLines(
			data.Fulfillment.Value.FulfillmentLineItems,
		)
		if err != nil {
			return err
		}
		fulfillment.FulfillmentLineItems.Nodes = append(
			fulfillment.FulfillmentLineItems.Nodes,
			lines.Nodes...,
		)
		fulfillment.FulfillmentLineItems.PageInfo = lines.PageInfo
	}
	return nil
}

func incompleteShopifyFulfillmentContext(detail string) error {
	return fmt.Errorf(
		"Shopify %s could not be read completely; retry the fulfillment publish",
		detail,
	)
}

func requestedFulfillmentLineQuantities(
	lines []shopifyconnector.FulfillmentLineInput,
) map[string]int {
	result := make(map[string]int, len(lines))
	for _, line := range lines {
		result[line.OrderLineID] = line.Quantity
	}
	return result
}

func recoverPublishedFulfillment(
	fulfillments []shopifyPublishedFulfillment,
	trackingNumber string,
	requested map[string]int,
) (recoveredFulfillment, bool, error) {
	var matches []recoveredFulfillment
	for _, fulfillment := range fulfillments {
		tracking, trackingMatches, trackingConflict := fulfillmentTrackingMatch(
			fulfillment.TrackingInfo, trackingNumber,
		)
		if trackingConflict {
			return recoveredFulfillment{}, false, fmt.Errorf("%w: tracking data is ambiguous", shopifyconnector.ErrInvalidFulfillment)
		}
		if !trackingMatches {
			continue
		}
		if fulfillment.Status != "SUCCESS" {
			return recoveredFulfillment{}, false, fmt.Errorf("%w: tracking number is already used", shopifyconnector.ErrInvalidFulfillment)
		}
		actual := map[string]int{}
		for _, line := range fulfillment.FulfillmentLineItems.Nodes {
			if line.LineItem == nil || line.LineItem.ID == "" || line.Quantity < 1 {
				return recoveredFulfillment{}, false, fmt.Errorf("%w: existing fulfillment lines are invalid", shopifyconnector.ErrInvalidFulfillment)
			}
			actual[line.LineItem.ID] += line.Quantity
		}
		if !sameLineQuantities(requested, actual) {
			return recoveredFulfillment{}, false, fmt.Errorf("%w: tracking number is already used", shopifyconnector.ErrInvalidFulfillment)
		}
		matches = append(matches, recoveredFulfillment{
			ID: fulfillment.ID, Tracking: tracking,
			UpdatedAt: fulfillment.UpdatedAt,
		})
	}
	if len(matches) > 1 {
		return recoveredFulfillment{}, false, fmt.Errorf("%w: tracking number is ambiguous", shopifyconnector.ErrInvalidFulfillment)
	}
	if len(matches) == 1 {
		return matches[0], true, nil
	}
	return recoveredFulfillment{}, false, nil
}

func fulfillmentOrderGroups(
	orders []shopifyFulfillmentOrderNode,
	requested map[string]int,
) ([]shopifyFulfillmentOrderGroup, error) {
	remaining := make(map[string]int, len(requested))
	for key, value := range requested {
		remaining[key] = value
	}
	ordered := append([]shopifyFulfillmentOrderNode(nil), orders...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].ID < ordered[j].ID })
	var groups []shopifyFulfillmentOrderGroup
	locationID := ""
	for _, order := range ordered {
		if !containsShopifyAction(order.SupportedActions, "CREATE_FULFILLMENT") {
			continue
		}
		if order.AssignedLocation.Location == nil || order.AssignedLocation.Location.ID == "" {
			return nil, fmt.Errorf("%w: fulfillment order location is missing", shopifyconnector.ErrInvalidFulfillment)
		}
		group := shopifyFulfillmentOrderGroup{
			FulfillmentOrderID: order.ID,
			LocationID:         order.AssignedLocation.Location.ID,
		}
		for _, line := range order.LineItems.Nodes {
			if line.LineItem == nil || line.RemainingQuantity < 1 {
				continue
			}
			quantity := remaining[line.LineItem.ID]
			if quantity < 1 {
				continue
			}
			if quantity > line.RemainingQuantity {
				quantity = line.RemainingQuantity
			}
			group.Lines = append(group.Lines, shopifyFulfillmentOrderLine{
				ID:       line.ID,
				Quantity: quantity,
			})
			remaining[line.LineItem.ID] -= quantity
		}
		if len(group.Lines) == 0 {
			continue
		}
		if locationID == "" {
			locationID = group.LocationID
		} else if group.LocationID != locationID {
			return nil, fmt.Errorf("%w: fulfillment spans locations", shopifyconnector.ErrInvalidFulfillment)
		}
		groups = append(groups, group)
	}
	for _, quantity := range remaining {
		if quantity != 0 {
			return nil, fmt.Errorf("%w: fulfillable quantities do not match", shopifyconnector.ErrInvalidFulfillment)
		}
	}
	if len(groups) == 0 {
		return nil, fmt.Errorf("%w: no fulfillment order can be fulfilled", shopifyconnector.ErrInvalidFulfillment)
	}
	return groups, nil
}

func sameLineQuantities(left map[string]int, right map[string]int) bool {
	if len(left) != len(right) {
		return false
	}
	for key, value := range left {
		if right[key] != value {
			return false
		}
	}
	return true
}

func containsShopifyAction(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func exactFulfillmentTracking(
	values []fulfillmentTrackingInfo,
	number string,
) (shopifyconnector.CatalogTrackingInfo, bool) {
	result, found, conflict := fulfillmentTrackingMatch(values, number)
	return result, found && !conflict
}

func fulfillmentTrackingMatch(
	values []fulfillmentTrackingInfo,
	number string,
) (shopifyconnector.CatalogTrackingInfo, bool, bool) {
	var result shopifyconnector.CatalogTrackingInfo
	found := false
	for _, value := range values {
		if value.Number != number {
			continue
		}
		candidate := shopifyconnector.CatalogTrackingInfo{
			Company: value.Company, Number: value.Number, URL: value.URL,
		}
		if found && candidate != result {
			return shopifyconnector.CatalogTrackingInfo{}, true, true
		}
		result = candidate
		found = true
	}
	return result, found, false
}

func validateCompleteFulfillmentContext(
	order *shopifyFulfillmentOrderContext,
) error {
	if order == nil {
		return incompleteShopifyFulfillmentContext("order context")
	}
	seenOrders := make(map[string]struct{}, len(order.FulfillmentOrders.Nodes))
	for _, fulfillmentOrder := range order.FulfillmentOrders.Nodes {
		if _, duplicate := seenOrders[fulfillmentOrder.ID]; duplicate {
			return incompleteShopifyFulfillmentContext("duplicate fulfillment order")
		}
		seenOrders[fulfillmentOrder.ID] = struct{}{}
		seenLines := make(map[string]struct{}, len(fulfillmentOrder.LineItems.Nodes))
		for _, line := range fulfillmentOrder.LineItems.Nodes {
			if _, duplicate := seenLines[line.ID]; duplicate {
				return incompleteShopifyFulfillmentContext("duplicate fulfillment order line")
			}
			seenLines[line.ID] = struct{}{}
		}
	}
	return nil
}

func validatedFulfillmentPublishResult(
	request shopifyconnector.FulfillmentPublishRequest,
	result shopifyconnector.FulfillmentPublishResult,
) (shopifyconnector.FulfillmentPublishResult, error) {
	if err := shopifyconnector.ValidateFulfillmentPublishResult(request, result); err != nil {
		return shopifyconnector.FulfillmentPublishResult{}, incompleteShopifyFulfillmentContext("fulfillment result")
	}
	return result, nil
}

const shopifyFulfillmentContextQuery = `
query XZERPFulfillmentContext($orderId: ID!) {
  order(id: $orderId) {
    id
    fulfillmentOrders(first: 100) {
      nodes {
        id
        status
        supportedActions
        assignedLocation { location { id } }
        lineItems(first: 100) {
          nodes { id remainingQuantity lineItem { id } }
          pageInfo { hasNextPage endCursor }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
    fulfillments(first: 101) {
      id
      status
      updatedAt
      trackingInfo { company number url }
      fulfillmentLineItems(first: 100) {
        nodes { quantity lineItem { id } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`

const shopifyFulfillmentOrderPageQuery = `
query XZERPFulfillmentOrderPage($orderId: ID!, $after: String!) {
  order(id: $orderId) {
    id
    fulfillmentOrders(first: 100, after: $after) {
      nodes {
        id
        status
        supportedActions
        assignedLocation { location { id } }
        lineItems(first: 100) {
          nodes { id remainingQuantity lineItem { id } }
          pageInfo { hasNextPage endCursor }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`

const shopifyFulfillmentOrderLineItemPageQuery = `
query XZERPFulfillmentOrderLineItemPage($fulfillmentOrderId: ID!, $after: String!) {
  fulfillmentOrder(id: $fulfillmentOrderId) {
    id
    lineItems(first: 100, after: $after) {
      nodes { id remainingQuantity lineItem { id } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`

const shopifyFulfillmentLineItemPageQuery = `
query XZERPFulfillmentLineItemPage($fulfillmentId: ID!, $after: String!) {
  fulfillment(id: $fulfillmentId) {
    id
    fulfillmentLineItems(first: 100, after: $after) {
      nodes { quantity lineItem { id } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`

const shopifyFulfillmentCreateMutation = `
mutation XZERPFulfillmentCreate($fulfillment: FulfillmentInput!, $message: String) {
  fulfillmentCreate(fulfillment: $fulfillment, message: $message) {
    fulfillment {
      id
      status
      createdAt
      updatedAt
      trackingInfo { company number url }
    }
    userErrors { field message }
  }
}`
