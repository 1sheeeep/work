package adminapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

func (c *Client) FetchCustomerCatalogPage(
	ctx context.Context,
	shopDomain string,
	accessToken string,
	request shopifyconnector.CustomerCatalogPageRequest,
) (shopifyconnector.CustomerCatalogPage, error) {
	if err := shopifyconnector.ValidateCustomerCatalogPageRequest(request); err != nil {
		return shopifyconnector.CustomerCatalogPage{}, err
	}
	if c == nil || c.httpClient == nil || c.now == nil {
		return shopifyconnector.CustomerCatalogPage{}, errors.New("Shopify Admin API client is unavailable")
	}
	variables := map[string]any{"first": request.Limit, "sortKey": "UPDATED_AT"}
	if cursor := strings.TrimSpace(request.Cursor); cursor != "" {
		variables["after"] = cursor
	}
	if query := strings.TrimSpace(request.Query); query != "" {
		variables["query"] = query
		variables["sortKey"] = "RELEVANCE"
	}
	var data customerCatalogData
	if err := c.queryGraphQL(ctx, shopDomain, accessToken, customerCatalogPageQuery, variables, &data); err != nil {
		return shopifyconnector.CustomerCatalogPage{}, err
	}
	if data.Customers == nil || data.Customers.PageInfo == nil || data.Customers.Edges == nil {
		return shopifyconnector.CustomerCatalogPage{}, errors.New("Shopify Admin API customer response is invalid")
	}
	customers := make([]shopifyconnector.CatalogCustomer, 0, len(*data.Customers.Edges))
	for _, edge := range *data.Customers.Edges {
		customer, err := catalogCustomerProfile(edge.Node)
		if err != nil {
			return shopifyconnector.CustomerCatalogPage{}, errors.New("Shopify Admin API customer response is invalid")
		}
		customers = append(customers, customer)
	}
	page := shopifyconnector.ConnectedCustomerCatalogPage(request, customers, shopifyconnector.CatalogPageInfo{
		HasNextPage: data.Customers.PageInfo.HasNextPage,
		EndCursor:   data.Customers.PageInfo.EndCursor,
	}, c.now().UTC())
	if err := shopifyconnector.ValidateCustomerCatalogPage(request, page); err != nil {
		return shopifyconnector.CustomerCatalogPage{}, errors.New("Shopify Admin API customer response is invalid")
	}
	return page, nil
}

func catalogCustomerProfile(node customerCatalogNode) (shopifyconnector.CatalogCustomer, error) {
	orderCount, ok := unsignedDecimal(node.NumberOfOrders)
	if !ok || node.Tags == nil || node.AmountSpent == nil {
		return shopifyconnector.CatalogCustomer{}, errors.New("invalid customer shape")
	}
	result := shopifyconnector.CatalogCustomer{
		ID: node.ID, LegacyResourceID: node.LegacyResourceID, DisplayName: node.DisplayName,
		CreatedAt: node.CreatedAt, UpdatedAt: node.UpdatedAt, VerifiedEmail: node.VerifiedEmail,
		Tags: append([]string(nil), (*node.Tags)...), NumberOfOrders: orderCount,
		TotalSpent: catalogMoney(*node.AmountSpent),
	}
	if result.Tags == nil {
		result.Tags = []string{}
	}
	if node.DefaultEmailAddress != nil {
		result.Email = node.DefaultEmailAddress.EmailAddress
	}
	if node.DefaultPhoneNumber != nil {
		result.Phone = node.DefaultPhoneNumber.PhoneNumber
	}
	if node.DefaultAddress != nil {
		result.DefaultLocation = shopifyconnector.CatalogCustomerLocation{
			City: node.DefaultAddress.City, Province: node.DefaultAddress.Province,
			Country: node.DefaultAddress.Country, CountryCode: node.DefaultAddress.CountryCode,
		}
	}
	if node.LastOrder != nil {
		if node.LastOrder.Total == nil || node.LastOrder.Total.ShopMoney == nil {
			return shopifyconnector.CatalogCustomer{}, errors.New("invalid customer last order shape")
		}
		result.LastOrder = &shopifyconnector.CatalogCustomerOrderSummary{
			ID: node.LastOrder.ID, Name: node.LastOrder.Name, CreatedAt: node.LastOrder.CreatedAt,
			DisplayFinancialStatus:   node.LastOrder.DisplayFinancialStatus,
			DisplayFulfillmentStatus: node.LastOrder.DisplayFulfillmentStatus,
			Total:                    catalogMoney(*node.LastOrder.Total.ShopMoney),
		}
	}
	return result, nil
}

func unsignedDecimal(raw json.RawMessage) (string, bool) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return "", false
	}
	if raw[0] == '"' {
		var value string
		if json.Unmarshal(raw, &value) != nil {
			return "", false
		}
		raw = []byte(value)
	}
	if len(raw) == 0 {
		return "", false
	}
	for _, value := range raw {
		if value < '0' || value > '9' {
			return "", false
		}
	}
	return string(raw), true
}

type customerCatalogData struct {
	Customers *struct {
		PageInfo *pageInfo `json:"pageInfo"`
		Edges    *[]struct {
			Node customerCatalogNode `json:"node"`
		} `json:"edges"`
	} `json:"customers"`
}

type customerCatalogNode struct {
	ID                  string          `json:"id"`
	LegacyResourceID    string          `json:"legacyResourceId"`
	DisplayName         string          `json:"displayName"`
	CreatedAt           string          `json:"createdAt"`
	UpdatedAt           string          `json:"updatedAt"`
	VerifiedEmail       bool            `json:"verifiedEmail"`
	Tags                *[]string       `json:"tags"`
	NumberOfOrders      json.RawMessage `json:"numberOfOrders"`
	AmountSpent         *orderMoney     `json:"amountSpent"`
	DefaultEmailAddress *struct {
		EmailAddress string `json:"emailAddress"`
	} `json:"defaultEmailAddress"`
	DefaultPhoneNumber *struct {
		PhoneNumber string `json:"phoneNumber"`
	} `json:"defaultPhoneNumber"`
	DefaultAddress *struct {
		City        string `json:"city"`
		Province    string `json:"province"`
		Country     string `json:"country"`
		CountryCode string `json:"countryCode"`
	} `json:"defaultAddress"`
	LastOrder *struct {
		ID                       string         `json:"id"`
		Name                     string         `json:"name"`
		CreatedAt                string         `json:"createdAt"`
		DisplayFinancialStatus   string         `json:"displayFinancialStatus"`
		DisplayFulfillmentStatus string         `json:"displayFulfillmentStatus"`
		Total                    *orderMoneyBag `json:"currentTotalPriceSet"`
	} `json:"lastOrder"`
}

const customerCatalogPageQuery = `
query XZERPCustomerCatalogPage(
  $first: Int!
  $after: String
  $query: String
  $sortKey: CustomerSortKeys!
) {
  customers(first: $first, after: $after, query: $query, sortKey: $sortKey, reverse: true) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        legacyResourceId
        displayName
        createdAt
        updatedAt
        verifiedEmail
        tags
        numberOfOrders
        amountSpent { amount currencyCode }
        defaultEmailAddress { emailAddress }
        defaultPhoneNumber { phoneNumber }
        defaultAddress { city province country countryCode: countryCodeV2 }
        lastOrder {
          id
          name
          createdAt
          displayFinancialStatus
          displayFulfillmentStatus
          currentTotalPriceSet { shopMoney { amount currencyCode } }
        }
      }
    }
  }
}`

var _ interface {
	FetchCustomerCatalogPage(context.Context, string, string, shopifyconnector.CustomerCatalogPageRequest) (shopifyconnector.CustomerCatalogPage, error)
} = (*Client)(nil)
