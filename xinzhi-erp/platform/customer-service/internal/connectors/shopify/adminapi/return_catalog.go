package adminapi

import (
	"context"
	"errors"
	"strings"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

var errReturnCatalogIncomplete = errors.New("Shopify Admin API return pagination is incomplete")

const returnOrderQueryFilter = "(return_status:return_requested OR return_status:in_progress OR return_status:inspection_complete OR return_status:returned OR return_status:return_failed)"

const (
	returnCatalogOrderReturnsPageSize = 5
	returnOrderReturnsPageSize        = 50
	returnLineItemsPageSize           = 100
)

const returnCatalogQuery = `
query XZERPReturnCatalogPage($first: Int!, $after: String, $query: String, $returnsFirst: Int!) {
  orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes { id name returns(first: $returnsFirst) { pageInfo { hasNextPage endCursor } nodes { ` + returnSummaryFields + ` } } }
  }
}`

const returnPageQuery = `
query XZERPOrderReturnPage($id: ID!, $after: String!, $first: Int!) {
  order(id: $id) { returns(first: $first, after: $after) { pageInfo { hasNextPage endCursor } nodes { ` + returnSummaryFields + ` } } }
}`

const returnLineFirstPageQuery = `
query XZERPReturnLineItemFirstPage($id: ID!, $first: Int!) {
  return(id: $id) { returnLineItems(first: $first) { pageInfo { hasNextPage endCursor } nodes { ` + returnLineFields + ` } } }
}`

const returnLinePageQuery = `
query XZERPReturnLineItemPage($id: ID!, $after: String!, $first: Int!) {
  return(id: $id) { returnLineItems(first: $first, after: $after) { pageInfo { hasNextPage endCursor } nodes { ` + returnLineFields + ` } } }
}`

const returnSummaryFields = `
  id name status createdAt closedAt requestApprovedAt totalQuantity
`

const returnLineFields = `
  ... on ReturnLineItem {
    id quantity processableQuantity processedQuantity refundableQuantity refundedQuantity
    returnReasonDefinition { handle name }
    fulfillmentLineItem {
      id
      lineItem {
        id name sku
        duties { id price { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } } }
      }
    }
  }
`

type returnCatalogData struct {
	Orders *struct {
		Nodes    *[]returnOrderNode `json:"nodes"`
		PageInfo *strictPageInfo    `json:"pageInfo"`
	} `json:"orders"`
}
type returnOrderNode struct {
	ID      string            `json:"id"`
	Name    string            `json:"name"`
	Returns *returnConnection `json:"returns"`
}
type returnConnection struct {
	Nodes    *[]returnNode   `json:"nodes"`
	PageInfo *strictPageInfo `json:"pageInfo"`
}
type returnLineConnection struct {
	Nodes    *[]returnLineNode `json:"nodes"`
	PageInfo *strictPageInfo   `json:"pageInfo"`
}
type returnNode struct {
	ID                string                `json:"id"`
	Name              string                `json:"name"`
	Status            string                `json:"status"`
	CreatedAt         string                `json:"createdAt"`
	ClosedAt          string                `json:"closedAt"`
	RequestApprovedAt string                `json:"requestApprovedAt"`
	TotalQuantity     int                   `json:"totalQuantity"`
	ReturnLineItems   *returnLineConnection `json:"returnLineItems"`
}
type returnLineNode struct {
	ID                  string `json:"id"`
	Quantity            int    `json:"quantity"`
	ProcessableQuantity int    `json:"processableQuantity"`
	ProcessedQuantity   int    `json:"processedQuantity"`
	RefundableQuantity  int    `json:"refundableQuantity"`
	RefundedQuantity    int    `json:"refundedQuantity"`
	ReturnReason        *struct {
		Handle string `json:"handle"`
		Name   string `json:"name"`
	} `json:"returnReasonDefinition"`
	FulfillmentLineItem *struct {
		ID       string `json:"id"`
		LineItem *struct {
			ID     string `json:"id"`
			Name   string `json:"name"`
			SKU    string `json:"sku"`
			Duties *[]struct {
				ID    string                `json:"id"`
				Price refundPreviewMoneyBag `json:"price"`
			} `json:"duties"`
		} `json:"lineItem"`
	} `json:"fulfillmentLineItem"`
}

func (c *Client) FetchReturnCatalogPage(ctx context.Context, domain, token string, request shopifyconnector.ReturnCatalogPageRequest) (shopifyconnector.ReturnCatalogPage, error) {
	if err := shopifyconnector.ValidateReturnCatalogPageRequest(request); err != nil {
		return shopifyconnector.ReturnCatalogPage{}, err
	}
	if c == nil || c.httpClient == nil || c.now == nil {
		return shopifyconnector.ReturnCatalogPage{}, errors.New("Shopify Admin API client is unavailable")
	}
	variables := map[string]any{
		"first":        request.Limit,
		"query":        returnCatalogFilter(request.Query),
		"returnsFirst": returnCatalogOrderReturnsPageSize,
	}
	if cursor := strings.TrimSpace(request.Cursor); cursor != "" {
		variables["after"] = cursor
	}
	var data returnCatalogData
	if err := c.queryGraphQL(ctx, domain, token, returnCatalogQuery, variables, &data); err != nil {
		return shopifyconnector.ReturnCatalogPage{}, err
	}
	if data.Orders == nil || data.Orders.Nodes == nil || data.Orders.PageInfo == nil || data.Orders.PageInfo.HasNextPage == nil || len(*data.Orders.Nodes) > request.Limit {
		return shopifyconnector.ReturnCatalogPage{}, errors.New("Shopify Admin API return response is invalid")
	}
	for index := range *data.Orders.Nodes {
		order := &(*data.Orders.Nodes)[index]
		if order.Returns == nil || order.Returns.Nodes == nil || order.Returns.PageInfo == nil || order.Returns.PageInfo.HasNextPage == nil {
			return shopifyconnector.ReturnCatalogPage{}, errors.New("Shopify Admin API return response is invalid")
		}
		if err := c.fetchRemainingReturns(ctx, domain, token, order); err != nil {
			return shopifyconnector.ReturnCatalogPage{}, err
		}
		for returnIndex := range *order.Returns.Nodes {
			if err := c.fetchRemainingReturnLines(ctx, domain, token, &(*order.Returns.Nodes)[returnIndex]); err != nil {
				return shopifyconnector.ReturnCatalogPage{}, err
			}
		}
	}
	returns := make([]shopifyconnector.CatalogReturn, 0)
	for _, order := range *data.Orders.Nodes {
		for _, item := range *order.Returns.Nodes {
			catalog, err := catalogReturn(order, item)
			if err != nil {
				return shopifyconnector.ReturnCatalogPage{}, err
			}
			returns = append(returns, catalog)
		}
	}
	page := shopifyconnector.ConnectedReturnCatalogPage(request, returns, shopifyconnector.CatalogPageInfo{HasNextPage: *data.Orders.PageInfo.HasNextPage, EndCursor: data.Orders.PageInfo.EndCursor}, c.now().UTC())
	if shopifyconnector.ValidateReturnCatalogPage(request, page) != nil {
		return shopifyconnector.ReturnCatalogPage{}, errors.New("Shopify Admin API return response is invalid")
	}
	return page, nil
}

func (c *Client) fetchRemainingReturns(ctx context.Context, domain, token string, order *returnOrderNode) error {
	seen := map[string]struct{}{}
	for *order.Returns.PageInfo.HasNextPage {
		cursor := strings.TrimSpace(order.Returns.PageInfo.EndCursor)
		if cursor == "" {
			return errReturnCatalogIncomplete
		}
		if _, exists := seen[cursor]; exists {
			return errReturnCatalogIncomplete
		}
		seen[cursor] = struct{}{}
		var data struct {
			Order *struct {
				Returns *returnConnection `json:"returns"`
			} `json:"order"`
		}
		if err := c.queryGraphQL(ctx, domain, token, returnPageQuery, map[string]any{
			"id": order.ID, "after": cursor, "first": returnOrderReturnsPageSize,
		}, &data); err != nil {
			return err
		}
		if data.Order == nil || data.Order.Returns == nil || data.Order.Returns.Nodes == nil || data.Order.Returns.PageInfo == nil || data.Order.Returns.PageInfo.HasNextPage == nil {
			return errReturnCatalogIncomplete
		}
		merged := append(*order.Returns.Nodes, (*data.Order.Returns.Nodes)...)
		order.Returns.Nodes = &merged
		order.Returns.PageInfo = data.Order.Returns.PageInfo
	}
	return nil
}

func (c *Client) fetchRemainingReturnLines(ctx context.Context, domain, token string, item *returnNode) error {
	var firstPage struct {
		Return *struct {
			ReturnLineItems *returnLineConnection `json:"returnLineItems"`
		} `json:"return"`
	}
	if err := c.queryGraphQL(ctx, domain, token, returnLineFirstPageQuery, map[string]any{
		"id": item.ID, "first": returnLineItemsPageSize,
	}, &firstPage); err != nil {
		return err
	}
	if firstPage.Return == nil || firstPage.Return.ReturnLineItems == nil ||
		firstPage.Return.ReturnLineItems.Nodes == nil ||
		firstPage.Return.ReturnLineItems.PageInfo == nil ||
		firstPage.Return.ReturnLineItems.PageInfo.HasNextPage == nil {
		return errReturnCatalogIncomplete
	}
	item.ReturnLineItems = firstPage.Return.ReturnLineItems
	seen := map[string]struct{}{}
	for *item.ReturnLineItems.PageInfo.HasNextPage {
		cursor := strings.TrimSpace(item.ReturnLineItems.PageInfo.EndCursor)
		if cursor == "" {
			return errReturnCatalogIncomplete
		}
		if _, exists := seen[cursor]; exists {
			return errReturnCatalogIncomplete
		}
		seen[cursor] = struct{}{}
		var data struct {
			Return *struct {
				ReturnLineItems *returnLineConnection `json:"returnLineItems"`
			} `json:"return"`
		}
		if err := c.queryGraphQL(ctx, domain, token, returnLinePageQuery, map[string]any{
			"id": item.ID, "after": cursor, "first": returnLineItemsPageSize,
		}, &data); err != nil {
			return err
		}
		if data.Return == nil || data.Return.ReturnLineItems == nil || data.Return.ReturnLineItems.Nodes == nil || data.Return.ReturnLineItems.PageInfo == nil || data.Return.ReturnLineItems.PageInfo.HasNextPage == nil {
			return errReturnCatalogIncomplete
		}
		merged := append(*item.ReturnLineItems.Nodes, (*data.Return.ReturnLineItems.Nodes)...)
		item.ReturnLineItems.Nodes = &merged
		item.ReturnLineItems.PageInfo = data.Return.ReturnLineItems.PageInfo
	}
	return nil
}

func returnCatalogFilter(query string) string {
	if query = strings.TrimSpace(query); query != "" {
		return returnOrderQueryFilter + " AND (" + query + ")"
	}
	return returnOrderQueryFilter
}

func catalogReturn(order returnOrderNode, item returnNode) (shopifyconnector.CatalogReturn, error) {
	if item.ReturnLineItems == nil || item.ReturnLineItems.Nodes == nil {
		return shopifyconnector.CatalogReturn{}, errors.New("Shopify Admin API return response is invalid")
	}
	result := shopifyconnector.CatalogReturn{ID: item.ID, Name: item.Name, OrderID: order.ID, OrderName: order.Name, Status: item.Status, CreatedAt: item.CreatedAt, ClosedAt: item.ClosedAt, RequestApprovedAt: item.RequestApprovedAt, TotalQuantity: item.TotalQuantity, LineItems: make([]shopifyconnector.CatalogReturnLine, 0, len(*item.ReturnLineItems.Nodes))}
	for _, line := range *item.ReturnLineItems.Nodes {
		if line.FulfillmentLineItem == nil || line.FulfillmentLineItem.LineItem == nil {
			return shopifyconnector.CatalogReturn{}, errors.New("Shopify Admin API return response is invalid")
		}
		mapped := shopifyconnector.CatalogReturnLine{ID: line.ID, FulfillmentLineID: line.FulfillmentLineItem.ID, OrderLineID: line.FulfillmentLineItem.LineItem.ID, Name: line.FulfillmentLineItem.LineItem.Name, SKU: line.FulfillmentLineItem.LineItem.SKU, Quantity: line.Quantity, ProcessableQuantity: line.ProcessableQuantity, ProcessedQuantity: line.ProcessedQuantity, RefundableQuantity: line.RefundableQuantity, RefundedQuantity: line.RefundedQuantity, Duties: []shopifyconnector.CatalogReturnDuty{}}
		if line.FulfillmentLineItem.LineItem.Duties != nil {
			for _, duty := range *line.FulfillmentLineItem.LineItem.Duties {
				mapped.Duties = append(mapped.Duties, shopifyconnector.CatalogReturnDuty{ID: duty.ID, Price: mapRefundMoneyBag(duty.Price)})
			}
		}
		if line.ReturnReason != nil {
			mapped.ReasonHandle = line.ReturnReason.Handle
			mapped.ReasonName = line.ReturnReason.Name
		}
		result.LineItems = append(result.LineItems, mapped)
	}
	return result, nil
}

var _ interface {
	FetchReturnCatalogPage(context.Context, string, string, shopifyconnector.ReturnCatalogPageRequest) (shopifyconnector.ReturnCatalogPage, error)
} = (*Client)(nil)
