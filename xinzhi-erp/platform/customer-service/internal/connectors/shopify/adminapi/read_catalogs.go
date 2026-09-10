package adminapi

import (
	"context"
	"errors"
	"strings"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

const locationCatalogQuery = `
query XZERPLocationCatalogPage($first: Int!, $after: String) {
  locations(first: $first, after: $after, includeInactive: true, includeLegacy: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name isActive fulfillsOnlineOrders hasActiveInventory isFulfillmentService
      address { address1 address2 city province provinceCode country countryCode zip }
    }
  }
}`

const inventoryLevelQuery = `
query XZERPInventoryLevel($inventoryItemId: ID!, $locationId: ID!) {
  inventoryItem(id: $inventoryItemId) {
    id tracked
    inventoryLevel(locationId: $locationId, includeInactive: true) {
      isActive location { id }
      quantities(names: ["available", "on_hand"]) { name quantity }
    }
  }
}`

const disputeCatalogQuery = `
query XZERPDisputes($first: Int!, $after: String) {
  disputes(first: $first, after: $after) {
    nodes {
      id status type initiatedAt evidenceDueBy evidenceSentOn finalizedOn
      amount { amount currencyCode }
      reasonDetails { reason networkReasonCode }
      order { id name }
    }
    pageInfo { hasNextPage endCursor }
  }
}`

func (c *Client) FetchLocationCatalogPage(ctx context.Context, domain, token string, request shopifyconnector.LocationCatalogPageRequest) (shopifyconnector.LocationCatalogPage, error) {
	if err := shopifyconnector.ValidateLocationCatalogPageRequest(request); err != nil {
		return shopifyconnector.LocationCatalogPage{}, err
	}
	if c == nil || c.httpClient == nil || c.now == nil {
		return shopifyconnector.LocationCatalogPage{}, errors.New("Shopify Admin API client is unavailable")
	}
	variables := map[string]any{"first": request.Limit}
	if cursor := strings.TrimSpace(request.Cursor); cursor != "" {
		variables["after"] = cursor
	}
	var data struct {
		Locations *struct {
			PageInfo *strictPageInfo `json:"pageInfo"`
			Nodes    *[]struct {
				ID                   string `json:"id"`
				Name                 string `json:"name"`
				IsActive             *bool  `json:"isActive"`
				FulfillsOnlineOrders *bool  `json:"fulfillsOnlineOrders"`
				HasActiveInventory   *bool  `json:"hasActiveInventory"`
				IsFulfillmentService *bool  `json:"isFulfillmentService"`
				Address              *struct {
					Address1     string `json:"address1"`
					Address2     string `json:"address2"`
					City         string `json:"city"`
					Province     string `json:"province"`
					ProvinceCode string `json:"provinceCode"`
					Country      string `json:"country"`
					CountryCode  string `json:"countryCode"`
					Zip          string `json:"zip"`
				} `json:"address"`
			} `json:"nodes"`
		} `json:"locations"`
	}
	if err := c.queryGraphQL(ctx, domain, token, locationCatalogQuery, variables, &data); err != nil {
		return shopifyconnector.LocationCatalogPage{}, err
	}
	if data.Locations == nil || data.Locations.PageInfo == nil || data.Locations.PageInfo.HasNextPage == nil || data.Locations.Nodes == nil {
		return shopifyconnector.LocationCatalogPage{}, errors.New("Shopify Admin API location response is invalid")
	}
	locations := make([]shopifyconnector.CatalogLocation, 0, len(*data.Locations.Nodes))
	for _, node := range *data.Locations.Nodes {
		if node.Address == nil || node.IsActive == nil || node.FulfillsOnlineOrders == nil || node.HasActiveInventory == nil || node.IsFulfillmentService == nil {
			return shopifyconnector.LocationCatalogPage{}, errors.New("Shopify Admin API location response is invalid")
		}
		locations = append(locations, shopifyconnector.CatalogLocation{ID: node.ID, Name: node.Name, IsActive: *node.IsActive, FulfillsOnlineOrders: *node.FulfillsOnlineOrders, HasActiveInventory: *node.HasActiveInventory, IsFulfillmentService: *node.IsFulfillmentService, Address1: node.Address.Address1, Address2: node.Address.Address2, City: node.Address.City, Province: node.Address.Province, ProvinceCode: node.Address.ProvinceCode, Country: node.Address.Country, CountryCode: node.Address.CountryCode, Zip: node.Address.Zip})
	}
	page := shopifyconnector.ConnectedLocationCatalogPage(request, locations, shopifyconnector.CatalogPageInfo{HasNextPage: *data.Locations.PageInfo.HasNextPage, EndCursor: data.Locations.PageInfo.EndCursor}, c.now().UTC())
	if shopifyconnector.ValidateLocationCatalogPage(request, page) != nil {
		return shopifyconnector.LocationCatalogPage{}, errors.New("Shopify Admin API location response is invalid")
	}
	return page, nil
}

func (c *Client) FetchInventoryLevel(ctx context.Context, domain, token string, request shopifyconnector.InventoryLevelReadRequest) (shopifyconnector.InventoryLevelSnapshot, error) {
	if err := shopifyconnector.ValidateInventoryLevelReadRequest(request); err != nil {
		return shopifyconnector.InventoryLevelSnapshot{}, err
	}
	if c == nil || c.httpClient == nil || c.now == nil {
		return shopifyconnector.InventoryLevelSnapshot{}, errors.New("Shopify Admin API client is unavailable")
	}
	var data struct {
		InventoryItem *struct {
			ID             string `json:"id"`
			Tracked        *bool  `json:"tracked"`
			InventoryLevel *struct {
				IsActive *bool `json:"isActive"`
				Location *struct {
					ID string `json:"id"`
				} `json:"location"`
				Quantities *[]struct {
					Name     string `json:"name"`
					Quantity int    `json:"quantity"`
				} `json:"quantities"`
			} `json:"inventoryLevel"`
		} `json:"inventoryItem"`
	}
	if err := c.queryGraphQL(ctx, domain, token, inventoryLevelQuery, map[string]any{"inventoryItemId": request.InventoryItemID, "locationId": request.LocationID}, &data); err != nil {
		return shopifyconnector.InventoryLevelSnapshot{}, err
	}
	if data.InventoryItem == nil || data.InventoryItem.Tracked == nil || data.InventoryItem.InventoryLevel == nil || data.InventoryItem.InventoryLevel.IsActive == nil || data.InventoryItem.InventoryLevel.Location == nil || data.InventoryItem.InventoryLevel.Quantities == nil || data.InventoryItem.ID != request.InventoryItemID || data.InventoryItem.InventoryLevel.Location.ID != request.LocationID {
		return shopifyconnector.InventoryLevelSnapshot{}, errors.New("Shopify Admin API inventory response is invalid")
	}
	availableCount := 0
	available := 0
	var onHand *int
	for _, quantity := range *data.InventoryItem.InventoryLevel.Quantities {
		switch quantity.Name {
		case "available":
			availableCount++
			available = quantity.Quantity
		case "on_hand":
			if onHand != nil {
				return shopifyconnector.InventoryLevelSnapshot{}, errors.New("Shopify Admin API inventory response is invalid")
			}
			value := quantity.Quantity
			onHand = &value
		default:
			return shopifyconnector.InventoryLevelSnapshot{}, errors.New("Shopify Admin API inventory response is invalid")
		}
	}
	if availableCount != 1 {
		return shopifyconnector.InventoryLevelSnapshot{}, errors.New("Shopify Admin API inventory response is invalid")
	}
	snapshot := shopifyconnector.ConnectedInventoryLevel(request, *data.InventoryItem.Tracked, *data.InventoryItem.InventoryLevel.IsActive, available, onHand, c.now().UTC())
	if shopifyconnector.ValidateInventoryLevelSnapshot(request, snapshot) != nil {
		return shopifyconnector.InventoryLevelSnapshot{}, errors.New("Shopify Admin API inventory response is invalid")
	}
	return snapshot, nil
}

func (c *Client) FetchDisputeCatalogPage(ctx context.Context, domain, token string, request shopifyconnector.DisputeCatalogPageRequest) (shopifyconnector.DisputeCatalogPage, error) {
	if err := shopifyconnector.ValidateDisputeCatalogPageRequest(request); err != nil {
		return shopifyconnector.DisputeCatalogPage{}, err
	}
	if c == nil || c.httpClient == nil || c.now == nil {
		return shopifyconnector.DisputeCatalogPage{}, errors.New("Shopify Admin API client is unavailable")
	}
	variables := map[string]any{"first": request.Limit}
	if cursor := strings.TrimSpace(request.Cursor); cursor != "" {
		variables["after"] = cursor
	}
	var data struct {
		Disputes *struct {
			Nodes    *[]disputeNode  `json:"nodes"`
			PageInfo *strictPageInfo `json:"pageInfo"`
		} `json:"disputes"`
	}
	if err := c.queryGraphQL(ctx, domain, token, disputeCatalogQuery, variables, &data); err != nil {
		return shopifyconnector.DisputeCatalogPage{}, err
	}
	if data.Disputes == nil || data.Disputes.Nodes == nil || data.Disputes.PageInfo == nil || data.Disputes.PageInfo.HasNextPage == nil {
		return shopifyconnector.DisputeCatalogPage{}, errors.New("Shopify Admin API dispute response is invalid")
	}
	disputes := make([]shopifyconnector.Dispute, 0, len(*data.Disputes.Nodes))
	for _, node := range *data.Disputes.Nodes {
		mapped, err := node.catalog()
		if err != nil {
			return shopifyconnector.DisputeCatalogPage{}, err
		}
		disputes = append(disputes, mapped)
	}
	page := shopifyconnector.ConnectedDisputeCatalogPage(request, disputes, shopifyconnector.CatalogPageInfo{HasNextPage: *data.Disputes.PageInfo.HasNextPage, EndCursor: data.Disputes.PageInfo.EndCursor}, c.now().UTC())
	if shopifyconnector.ValidateDisputeCatalogPage(request, page) != nil {
		return shopifyconnector.DisputeCatalogPage{}, errors.New("Shopify Admin API dispute response is invalid")
	}
	return page, nil
}

type disputeNode struct {
	ID             string                        `json:"id"`
	Status         string                        `json:"status"`
	Type           string                        `json:"type"`
	InitiatedAt    string                        `json:"initiatedAt"`
	EvidenceDueBy  string                        `json:"evidenceDueBy"`
	EvidenceSentOn string                        `json:"evidenceSentOn"`
	FinalizedOn    string                        `json:"finalizedOn"`
	Amount         shopifyconnector.CatalogMoney `json:"amount"`
	ReasonDetails  struct {
		Reason            string `json:"reason"`
		NetworkReasonCode string `json:"networkReasonCode"`
	} `json:"reasonDetails"`
	Order *struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"order"`
}

type strictPageInfo struct {
	HasNextPage *bool  `json:"hasNextPage"`
	EndCursor   string `json:"endCursor"`
}

func (n disputeNode) catalog() (shopifyconnector.Dispute, error) {
	result := shopifyconnector.Dispute{ID: n.ID, Status: n.Status, Type: n.Type, Reason: n.ReasonDetails.Reason, NetworkReasonCode: n.ReasonDetails.NetworkReasonCode, Amount: n.Amount, InitiatedAt: n.InitiatedAt, EvidenceDueBy: n.EvidenceDueBy, EvidenceSentOn: n.EvidenceSentOn, FinalizedOn: n.FinalizedOn}
	if n.Order != nil {
		result.OrderID = n.Order.ID
		result.OrderName = n.Order.Name
	}
	return result, nil
}

var _ interface {
	FetchLocationCatalogPage(context.Context, string, string, shopifyconnector.LocationCatalogPageRequest) (shopifyconnector.LocationCatalogPage, error)
	FetchInventoryLevel(context.Context, string, string, shopifyconnector.InventoryLevelReadRequest) (shopifyconnector.InventoryLevelSnapshot, error)
	FetchDisputeCatalogPage(context.Context, string, string, shopifyconnector.DisputeCatalogPageRequest) (shopifyconnector.DisputeCatalogPage, error)
} = (*Client)(nil)
