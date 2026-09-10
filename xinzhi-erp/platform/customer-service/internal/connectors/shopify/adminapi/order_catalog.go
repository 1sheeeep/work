package adminapi

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

const orderCatalogFulfillmentLimit = 10

var (
	errOrderLineItemsIncomplete = errors.New("Shopify order line item pagination is incomplete")
	errOrderFulfillmentsLimited = errors.New("Shopify order fulfillments exceed the safe catalog limit")
)

func (c *Client) FetchOrderCatalogPage(
	ctx context.Context,
	shopDomain string,
	accessToken string,
	request shopifyconnector.OrderCatalogPageRequest,
) (shopifyconnector.OrderCatalogPage, error) {
	if err := shopifyconnector.ValidateOrderCatalogPageRequest(request); err != nil {
		return shopifyconnector.OrderCatalogPage{}, err
	}
	if c == nil || c.httpClient == nil || c.now == nil {
		return shopifyconnector.OrderCatalogPage{}, errors.New("Shopify Admin API client is unavailable")
	}
	variables := map[string]any{"first": request.Limit}
	if cursor := strings.TrimSpace(request.Cursor); cursor != "" {
		variables["after"] = cursor
	}
	if query := strings.TrimSpace(request.Query); query != "" {
		variables["query"] = query
	}
	var data orderCatalogData
	if err := c.queryGraphQL(ctx, shopDomain, accessToken, orderCatalogPageQuery, variables, &data); err != nil {
		return shopifyconnector.OrderCatalogPage{}, err
	}
	if data.Orders == nil || data.Orders.PageInfo == nil || data.Orders.Edges == nil {
		return shopifyconnector.OrderCatalogPage{}, errors.New("Shopify Admin API order response is invalid")
	}
	for index := range *data.Orders.Edges {
		node := &(*data.Orders.Edges)[index].Node
		if !validOrderNodeShape(node) {
			return shopifyconnector.OrderCatalogPage{}, errors.New("Shopify Admin API order response is invalid")
		}
		if err := c.fetchRemainingOrderLineItems(ctx, shopDomain, accessToken, node); err != nil {
			return shopifyconnector.OrderCatalogPage{}, err
		}
		if len(*node.Fulfillments) > orderCatalogFulfillmentLimit {
			return shopifyconnector.OrderCatalogPage{}, errOrderFulfillmentsLimited
		}
	}
	orders := make([]shopifyconnector.CatalogOrder, 0, len(*data.Orders.Edges))
	for _, edge := range *data.Orders.Edges {
		orders = append(orders, catalogOrder(edge.Node))
	}
	page := shopifyconnector.ConnectedOrderCatalogPage(request, orders, shopifyconnector.CatalogPageInfo{
		HasNextPage: data.Orders.PageInfo.HasNextPage,
		EndCursor:   data.Orders.PageInfo.EndCursor,
	}, c.now().UTC())
	if err := shopifyconnector.ValidateOrderCatalogPage(request, page); err != nil {
		return shopifyconnector.OrderCatalogPage{}, errors.New("Shopify Admin API order response is invalid")
	}
	return page, nil
}

func (c *Client) fetchRemainingOrderLineItems(
	ctx context.Context,
	shopDomain string,
	accessToken string,
	order *orderNode,
) error {
	seenCursors := make(map[string]struct{})
	for order.LineItems.PageInfo.HasNextPage {
		cursor := strings.TrimSpace(order.LineItems.PageInfo.EndCursor)
		if cursor == "" {
			return errOrderLineItemsIncomplete
		}
		if _, exists := seenCursors[cursor]; exists {
			return errOrderLineItemsIncomplete
		}
		seenCursors[cursor] = struct{}{}
		var data struct {
			Order *struct {
				LineItems *orderLineConnection `json:"lineItems"`
			} `json:"order"`
		}
		if err := c.queryGraphQL(ctx, shopDomain, accessToken, orderLineItemPageQuery,
			map[string]any{"id": order.ID, "after": cursor}, &data); err != nil {
			return err
		}
		if data.Order == nil || data.Order.LineItems == nil ||
			data.Order.LineItems.PageInfo == nil || data.Order.LineItems.Edges == nil {
			return errOrderLineItemsIncomplete
		}
		for _, edge := range *data.Order.LineItems.Edges {
			if !validOrderLineShape(edge.Node) {
				return errOrderLineItemsIncomplete
			}
		}
		merged := append(*order.LineItems.Edges, (*data.Order.LineItems.Edges)...)
		order.LineItems.Edges = &merged
		order.LineItems.PageInfo = data.Order.LineItems.PageInfo
	}
	return nil
}

func validOrderNodeShape(node *orderNode) bool {
	if node == nil || node.PaymentGatewayNames == nil || node.CurrentTotalPriceSet == nil ||
		node.CurrentTotalPriceSet.ShopMoney == nil || node.CurrentSubtotalPriceSet == nil ||
		node.CurrentSubtotalPriceSet.ShopMoney == nil || node.CurrentShippingPriceSet == nil ||
		node.CurrentShippingPriceSet.ShopMoney == nil || node.LineItems == nil ||
		node.LineItems.PageInfo == nil || node.LineItems.Edges == nil || node.Fulfillments == nil {
		return false
	}
	if node.ShippingAddress != nil && node.ShippingAddress.Formatted == nil {
		return false
	}
	for _, edge := range *node.LineItems.Edges {
		if !validOrderLineShape(edge.Node) {
			return false
		}
	}
	for _, fulfillment := range *node.Fulfillments {
		if fulfillment.TrackingInfo == nil {
			return false
		}
	}
	return true
}

func validOrderLineShape(node orderLineNode) bool {
	return node.DiscountedTotalSet != nil && node.DiscountedTotalSet.ShopMoney != nil &&
		node.OriginalUnitPriceSet != nil && node.OriginalUnitPriceSet.ShopMoney != nil
}

func catalogOrder(node orderNode) shopifyconnector.CatalogOrder {
	order := shopifyconnector.CatalogOrder{
		ID: node.ID, LegacyResourceID: numericLegacyID(node.LegacyResourceID, node.ID),
		Name: node.Name, Email: node.Email, SourceName: node.SourceName,
		CreatedAt: node.CreatedAt, UpdatedAt: node.UpdatedAt, CancelledAt: node.CancelledAt,
		DisplayFinancialStatus: node.DisplayFinancialStatus, DisplayFulfillmentStatus: node.DisplayFulfillmentStatus,
		PaymentGatewayNames: append([]string{}, (*node.PaymentGatewayNames)...),
		Total:               catalogMoney(*node.CurrentTotalPriceSet.ShopMoney),
		Subtotal:            catalogMoney(*node.CurrentSubtotalPriceSet.ShopMoney),
		Shipping:            catalogMoney(*node.CurrentShippingPriceSet.ShopMoney),
		LineItems:           make([]shopifyconnector.CatalogOrderLine, 0, len(*node.LineItems.Edges)),
		Fulfillments:        make([]shopifyconnector.CatalogFulfillment, 0, len(*node.Fulfillments)),
	}
	if order.Subtotal.Amount == "" {
		order.Subtotal = order.Total
	}
	if node.ShippingAddress != nil {
		order.ShippingAddress = catalogAddress(*node.ShippingAddress)
		order.Customer.DisplayName = node.ShippingAddress.Name
		order.Customer.Phone = node.ShippingAddress.Phone
	}
	order.Customer.Email = node.Email
	for _, edge := range *node.LineItems.Edges {
		order.LineItems = append(order.LineItems, catalogOrderLine(edge.Node))
	}
	for _, fulfillment := range *node.Fulfillments {
		mapped := shopifyconnector.CatalogFulfillment{
			ID: fulfillment.ID, Status: fulfillment.Status,
			CreatedAt: fulfillment.CreatedAt, UpdatedAt: fulfillment.UpdatedAt,
			TrackingInfo: make([]shopifyconnector.CatalogTrackingInfo, 0, len(*fulfillment.TrackingInfo)),
		}
		for _, tracking := range *fulfillment.TrackingInfo {
			mapped.TrackingInfo = append(mapped.TrackingInfo, shopifyconnector.CatalogTrackingInfo{
				Company: tracking.Company, Number: tracking.Number, URL: tracking.URL,
			})
		}
		order.Fulfillments = append(order.Fulfillments, mapped)
	}
	return order
}

func catalogOrderLine(node orderLineNode) shopifyconnector.CatalogOrderLine {
	line := shopifyconnector.CatalogOrderLine{
		ID: node.ID, LegacyResourceID: numericLegacyID("", node.ID),
		Name: node.Name, Title: node.Title, Quantity: node.Quantity, SKU: node.SKU,
		VariantTitle: node.VariantTitle, RequiresShipping: node.RequiresShipping,
		DiscountedTotal:   catalogMoney(*node.DiscountedTotalSet.ShopMoney),
		OriginalUnitPrice: catalogMoney(*node.OriginalUnitPriceSet.ShopMoney),
	}
	if node.Product != nil {
		line.ProductID = node.Product.ID
	}
	if node.Variant != nil {
		line.VariantID = node.Variant.ID
		if node.Variant.InventoryItem != nil {
			line.InventoryItemID = node.Variant.InventoryItem.ID
		}
	}
	return line
}

func catalogMoney(value orderMoney) shopifyconnector.CatalogMoney {
	return shopifyconnector.CatalogMoney{Amount: value.Amount, CurrencyCode: value.CurrencyCode}
}

func catalogAddress(value orderAddress) shopifyconnector.CatalogMailingAddress {
	return shopifyconnector.CatalogMailingAddress{
		Name: value.Name, FirstName: value.FirstName, LastName: value.LastName, Company: value.Company,
		Address1: value.Address1, Address2: value.Address2, City: value.City, Province: value.Province,
		ProvinceCode: value.ProvinceCode, Country: value.Country, CountryCode: value.CountryCode,
		Zip: value.Zip, Phone: value.Phone, Formatted: append([]string(nil), (*value.Formatted)...),
	}
}

type orderCatalogData struct {
	Orders *struct {
		PageInfo *pageInfo `json:"pageInfo"`
		Edges    *[]struct {
			Node orderNode `json:"node"`
		} `json:"edges"`
	} `json:"orders"`
}

type orderNode struct {
	ID                       string               `json:"id"`
	LegacyResourceID         json.Number          `json:"legacyResourceId"`
	Name                     string               `json:"name"`
	Email                    string               `json:"email"`
	SourceName               string               `json:"sourceName"`
	CreatedAt                string               `json:"createdAt"`
	UpdatedAt                string               `json:"updatedAt"`
	CancelledAt              string               `json:"cancelledAt"`
	DisplayFinancialStatus   string               `json:"displayFinancialStatus"`
	DisplayFulfillmentStatus string               `json:"displayFulfillmentStatus"`
	PaymentGatewayNames      *[]string            `json:"paymentGatewayNames"`
	CurrentTotalPriceSet     *orderMoneyBag       `json:"currentTotalPriceSet"`
	CurrentSubtotalPriceSet  *orderMoneyBag       `json:"currentSubtotalPriceSet"`
	CurrentShippingPriceSet  *orderMoneyBag       `json:"currentShippingPriceSet"`
	ShippingAddress          *orderAddress        `json:"shippingAddress"`
	LineItems                *orderLineConnection `json:"lineItems"`
	Fulfillments             *[]orderFulfillment  `json:"fulfillments"`
}

type orderMoneyBag struct {
	ShopMoney *orderMoney `json:"shopMoney"`
}

type orderMoney struct {
	Amount       string `json:"amount"`
	CurrencyCode string `json:"currencyCode"`
}

type orderAddress struct {
	Name         string    `json:"name"`
	FirstName    string    `json:"firstName"`
	LastName     string    `json:"lastName"`
	Company      string    `json:"company"`
	Address1     string    `json:"address1"`
	Address2     string    `json:"address2"`
	City         string    `json:"city"`
	Province     string    `json:"province"`
	ProvinceCode string    `json:"provinceCode"`
	Country      string    `json:"country"`
	CountryCode  string    `json:"countryCode"`
	Zip          string    `json:"zip"`
	Phone        string    `json:"phone"`
	Formatted    *[]string `json:"formatted"`
}

type orderLineConnection struct {
	PageInfo *pageInfo `json:"pageInfo"`
	Edges    *[]struct {
		Node orderLineNode `json:"node"`
	} `json:"edges"`
}

type orderLineNode struct {
	ID                   string         `json:"id"`
	Name                 string         `json:"name"`
	Title                string         `json:"title"`
	Quantity             int            `json:"quantity"`
	SKU                  string         `json:"sku"`
	VariantTitle         string         `json:"variantTitle"`
	RequiresShipping     bool           `json:"requiresShipping"`
	DiscountedTotalSet   *orderMoneyBag `json:"discountedTotalSet"`
	OriginalUnitPriceSet *orderMoneyBag `json:"originalUnitPriceSet"`
	Product              *struct {
		ID string `json:"id"`
	} `json:"product"`
	Variant *struct {
		ID            string `json:"id"`
		InventoryItem *struct {
			ID string `json:"id"`
		} `json:"inventoryItem"`
	} `json:"variant"`
}

type orderFulfillment struct {
	ID           string `json:"id"`
	Status       string `json:"status"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
	TrackingInfo *[]struct {
		Company string `json:"company"`
		Number  string `json:"number"`
		URL     string `json:"url"`
	} `json:"trackingInfo"`
}

const orderCatalogPageQuery = `
query XZERPOrderCatalogPage($first: Int!, $after: String, $query: String) {
  orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        legacyResourceId
        name
        email
        sourceName
        createdAt
        updatedAt
        cancelledAt
        displayFinancialStatus
        displayFulfillmentStatus
        paymentGatewayNames
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        currentSubtotalPriceSet { shopMoney { amount currencyCode } }
        currentShippingPriceSet { shopMoney { amount currencyCode } }
        shippingAddress {
          name firstName lastName company address1 address2 city province provinceCode country
          countryCode: countryCodeV2
          zip phone formatted(withName: false)
        }
        lineItems(first: 100) {
          pageInfo { hasNextPage endCursor }
          edges { node { ` + orderLineFields + ` } }
        }
        fulfillments(first: 11) {
          id status createdAt updatedAt trackingInfo { company number url }
        }
      }
    }
  }
}`

const orderLineItemPageQuery = `
query XZERPOrderLineItemPage($id: ID!, $after: String!) {
  order(id: $id) {
    lineItems(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges { node { ` + orderLineFields + ` } }
    }
  }
}`

const orderLineFields = `
  id
  name
  title
  quantity
  sku
  variantTitle
  requiresShipping
  discountedTotalSet { shopMoney { amount currencyCode } }
  originalUnitPriceSet { shopMoney { amount currencyCode } }
  product { id }
  variant { id inventoryItem { id } }
`

var _ interface {
	FetchOrderCatalogPage(context.Context, string, string, shopifyconnector.OrderCatalogPageRequest) (shopifyconnector.OrderCatalogPage, error)
} = (*Client)(nil)
