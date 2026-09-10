package adminapi

import (
	"context"
	"errors"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

const inventorySetMutation = `
mutation XZERPInventorySet($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
  inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
    inventoryAdjustmentGroup { createdAt changes { name delta quantityAfterChange } }
    userErrors { code field message }
  }
}`

const orderShippingAddressUpdateMutation = `
mutation XZERPOrderShippingAddressUpdate($input: OrderInput!) {
  orderUpdate(input: $input) {
    order {
      id
      updatedAt
      shippingAddress {
        name firstName lastName company address1 address2 city province
        provinceCode country countryCode: countryCodeV2 zip phone
        formatted(withName: false)
      }
    }
    userErrors { field message }
  }
}`

func (c *Client) SetInventoryAvailable(ctx context.Context, domain, token string, request shopifyconnector.InventorySetRequest) (shopifyconnector.InventorySetResult, error) {
	if shopifyconnector.ValidateInventorySetRequest(request) != nil || c == nil || c.httpClient == nil || c.now == nil {
		return shopifyconnector.InventorySetResult{}, errors.New("Shopify Admin API inventory write request is invalid")
	}
	variables := map[string]any{
		"idempotencyKey": request.IdempotencyKey,
		"input": map[string]any{
			"name": "available", "reason": "correction", "referenceDocumentUri": request.ReferenceDocumentURI,
			"quantities": []map[string]any{{
				"inventoryItemId": request.InventoryItemID, "locationId": request.LocationID,
				"quantity": request.TargetAvailable, "changeFromQuantity": request.ExpectedAvailable,
			}},
		},
	}
	var data struct {
		InventorySetQuantities *struct {
			InventoryAdjustmentGroup *struct {
				CreatedAt string `json:"createdAt"`
				Changes   *[]struct {
					Name                string `json:"name"`
					Delta               int    `json:"delta"`
					QuantityAfterChange *int   `json:"quantityAfterChange"`
				} `json:"changes"`
			} `json:"inventoryAdjustmentGroup"`
			UserErrors *[]struct {
				Code string `json:"code"`
			} `json:"userErrors"`
		} `json:"inventorySetQuantities"`
	}
	if err := c.queryGraphQL(ctx, domain, token, inventorySetMutation, variables, &data); err != nil {
		return shopifyconnector.InventorySetResult{}, err
	}
	if data.InventorySetQuantities == nil || data.InventorySetQuantities.UserErrors == nil {
		return shopifyconnector.InventorySetResult{}, errors.New("Shopify Admin API inventory write response is invalid")
	}
	payload := data.InventorySetQuantities
	if len(*payload.UserErrors) > 0 {
		allStale := true
		safeCode := "SHOPIFY_INVENTORY_REJECTED"
		for _, userError := range *payload.UserErrors {
			if userError.Code != "CHANGE_FROM_QUANTITY_STALE" {
				allStale = false
			}
			switch userError.Code {
			case "IDEMPOTENCY_CONCURRENT_REQUEST":
				safeCode = "SHOPIFY_IDEMPOTENCY_BUSY"
			case "IDEMPOTENCY_KEY_PARAMETER_MISMATCH":
				safeCode = "SHOPIFY_IDEMPOTENCY_CONFLICT"
			case "IDEMPOTENCY_PREVIOUS_ATTEMPT_FAILED":
				safeCode = "SHOPIFY_IDEMPOTENCY_FAILED"
			}
		}
		if allStale {
			return shopifyconnector.StaleInventorySetResult(request, c.now().UTC()), nil
		}
		return shopifyconnector.RejectedInventorySetResult(request, safeCode, c.now().UTC()), nil
	}
	if payload.InventoryAdjustmentGroup == nil || payload.InventoryAdjustmentGroup.Changes == nil {
		return shopifyconnector.InventorySetResult{}, errors.New("Shopify Admin API inventory write response is invalid")
	}
	expectedDelta := request.TargetAvailable - request.ExpectedAvailable
	availableChanges := 0
	for _, change := range *payload.InventoryAdjustmentGroup.Changes {
		if (change.Name != "available" && change.Name != "on_hand") || change.Delta != expectedDelta ||
			(change.QuantityAfterChange != nil && *change.QuantityAfterChange != request.TargetAvailable) {
			return shopifyconnector.InventorySetResult{}, errors.New("Shopify Admin API inventory write response is invalid")
		}
		if change.Name == "available" {
			availableChanges++
		}
	}
	if availableChanges != 1 {
		return shopifyconnector.InventorySetResult{}, errors.New("Shopify Admin API inventory write response is invalid")
	}
	updatedAt := c.now().UTC()
	if payload.InventoryAdjustmentGroup.CreatedAt != "" {
		parsed, err := time.Parse(time.RFC3339Nano, payload.InventoryAdjustmentGroup.CreatedAt)
		if err != nil {
			return shopifyconnector.InventorySetResult{}, errors.New("Shopify Admin API inventory write response is invalid")
		}
		updatedAt = parsed.UTC()
	}
	result := shopifyconnector.AppliedInventorySetResult(request, updatedAt)
	if shopifyconnector.ValidateInventorySetResult(request, result) != nil {
		return shopifyconnector.InventorySetResult{}, errors.New("Shopify Admin API inventory write response is invalid")
	}
	return result, nil
}

func (c *Client) UpdateOrderShippingAddress(ctx context.Context, domain, token string, request shopifyconnector.OrderShippingAddressUpdateRequest) (shopifyconnector.OrderShippingAddressUpdateResult, error) {
	if shopifyconnector.ValidateOrderShippingAddressUpdateRequest(request) != nil || c == nil || c.httpClient == nil || c.now == nil {
		return shopifyconnector.OrderShippingAddressUpdateResult{}, shopifyconnector.InvalidOrderShippingAddressRequestError(request)
	}
	address := request.Address
	variables := map[string]any{"input": map[string]any{
		"id": request.OrderID,
		"shippingAddress": map[string]any{
			"firstName": address.FirstName, "lastName": address.LastName,
			"company": address.Company, "address1": address.Address1,
			"address2": address.Address2, "city": address.City,
			"provinceCode": address.ProvinceCode, "countryCode": address.CountryCode,
			"zip": address.Zip, "phone": address.Phone,
		},
	}}
	var data struct {
		OrderUpdate *struct {
			Order *struct {
				ID              string        `json:"id"`
				UpdatedAt       string        `json:"updatedAt"`
				ShippingAddress *orderAddress `json:"shippingAddress"`
			} `json:"order"`
			UserErrors *[]struct {
				Field []string `json:"field"`
			} `json:"userErrors"`
		} `json:"orderUpdate"`
	}
	if err := c.queryGraphQL(ctx, domain, token, orderShippingAddressUpdateMutation, variables, &data); err != nil {
		return shopifyconnector.OrderShippingAddressUpdateResult{}, err
	}
	if data.OrderUpdate == nil || data.OrderUpdate.UserErrors == nil {
		return shopifyconnector.OrderShippingAddressUpdateResult{}, errors.New("Shopify Admin API order shipping address response is invalid")
	}
	payload := data.OrderUpdate
	if len(*payload.UserErrors) != 0 {
		if payload.Order != nil {
			return shopifyconnector.OrderShippingAddressUpdateResult{}, errors.New("Shopify Admin API order shipping address response is contradictory")
		}
		return shopifyconnector.OrderShippingAddressUpdateResult{}, shopifyconnector.InvalidOrderShippingAddressRequestError(request)
	}
	if payload.Order == nil || payload.Order.ID != request.OrderID || payload.Order.ShippingAddress == nil || payload.Order.ShippingAddress.Formatted == nil {
		return shopifyconnector.OrderShippingAddressUpdateResult{}, errors.New("Shopify Admin API order shipping address response is invalid")
	}
	updatedAt, err := time.Parse(time.RFC3339Nano, payload.Order.UpdatedAt)
	if err != nil {
		return shopifyconnector.OrderShippingAddressUpdateResult{}, errors.New("Shopify Admin API order shipping address response is invalid")
	}
	result := shopifyconnector.OrderShippingAddressUpdateResult{
		ContractVersion: shopifyconnector.OrderShippingAddressContractVersion,
		TenantID:        request.Identity.TenantID, ShopID: request.Identity.ShopID,
		OrderID: request.OrderID, Address: catalogAddress(*payload.Order.ShippingAddress),
		UpdatedAt: updatedAt.UTC(),
	}
	if shopifyconnector.ValidateOrderShippingAddressUpdateResult(request, result) != nil {
		return shopifyconnector.OrderShippingAddressUpdateResult{}, errors.New("Shopify Admin API order shipping address response is invalid")
	}
	return result, nil
}

var _ interface {
	SetInventoryAvailable(context.Context, string, string, shopifyconnector.InventorySetRequest) (shopifyconnector.InventorySetResult, error)
	UpdateOrderShippingAddress(context.Context, string, string, shopifyconnector.OrderShippingAddressUpdateRequest) (shopifyconnector.OrderShippingAddressUpdateResult, error)
} = (*Client)(nil)
