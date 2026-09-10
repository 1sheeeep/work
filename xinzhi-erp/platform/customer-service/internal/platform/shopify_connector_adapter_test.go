package platform

import (
	"context"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

const (
	connectorTestTenantOne = "11111111-1111-4111-8111-111111111111"
	connectorTestTenantTwo = "22222222-2222-4222-8222-222222222222"
	connectorTestShopOne   = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
)

type testShopifyConnectorBindingResolver struct {
	bindings map[shopifyconnector.CanonicalShopIdentity]string
	err      error
}

func (r testShopifyConnectorBindingResolver) ResolveLegacyShopID(
	_ context.Context,
	identity shopifyconnector.CanonicalShopIdentity,
) (string, error) {
	if r.err != nil {
		return "", r.err
	}
	legacyShopID, ok := r.bindings[identity]
	if !ok {
		return "", errShopifyConnectorBindingNotFound
	}
	return legacyShopID, nil
}

func connectorProbeRequest(
	tenantID string,
	shopID string,
	correlationID string,
) shopifyconnector.ConnectionProbeRequest {
	return shopifyconnector.ConnectionProbeRequest{
		Identity: shopifyconnector.CanonicalShopIdentity{
			TenantID: tenantID,
			ShopID:   shopID,
		},
		Context: shopifyconnector.RequestContext{
			CorrelationID: correlationID,
			RequestID:     "request-connector-1",
		},
	}
}
