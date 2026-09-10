package platform

import (
	"context"
	"errors"
	"strings"
)

// These limits and the line-item continuation query remain in customer-service
// solely for SupportOrderSearch and Customer.lastOrder, which are explicitly
// outside the ERP OrderCatalog cutover package.
const shopifyOrderCatalogFulfillmentLimit = 10

var (
	errShopifyOrderCatalogLineItemsTruncated    = errors.New("Shopify order line items exceed the supported catalog page size")
	errShopifyOrderCatalogFulfillmentsTruncated = errors.New("Shopify order fulfillments exceed the supported catalog page size")
)

func (c shopifyAdminClient) fetchRemainingOrderLineItems(
	ctx context.Context,
	shopDomain string,
	accessToken string,
	order *shopifyOrderNode,
) error {
	seenCursors := make(map[string]struct{})
	for order.LineItems.PageInfo.HasNextPage {
		cursor := strings.TrimSpace(order.LineItems.PageInfo.EndCursor)
		if cursor == "" {
			return errShopifyOrderCatalogLineItemsTruncated
		}
		if _, exists := seenCursors[cursor]; exists {
			return errShopifyOrderCatalogLineItemsTruncated
		}
		seenCursors[cursor] = struct{}{}

		var data struct {
			Order *shopifyOrderNode `json:"order"`
		}
		if err := c.queryAdminGraphQL(
			ctx,
			shopDomain,
			accessToken,
			shopifySupportOrderLineItemPageQuery,
			map[string]any{"id": order.ID, "after": cursor},
			&data,
		); err != nil {
			return err
		}
		if data.Order == nil {
			return errShopifyOrderCatalogLineItemsTruncated
		}
		order.LineItems.Edges = append(order.LineItems.Edges, data.Order.LineItems.Edges...)
		order.LineItems.PageInfo = data.Order.LineItems.PageInfo
	}
	return nil
}

const shopifySupportOrderLineItemPageQuery = `
query XZERPOrderLineItemPage($id: ID!, $after: String!) {
  order(id: $id) {
    lineItems(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
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
        }
      }
    }
  }
}`
