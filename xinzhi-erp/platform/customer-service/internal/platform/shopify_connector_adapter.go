package platform

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

var errShopifyConnectorBindingNotFound = errors.New("Shopify connector binding not found")

type shopifyConnectorBindingResolver interface {
	ResolveLegacyShopID(
		context.Context,
		shopifyconnector.CanonicalShopIdentity,
	) (string, error)
}

// shopifyProductCatalogToken is retained for the location and inventory
// routes that have not yet moved to the independent connector runtime. The
// ProductCatalog route must not use it.
type shopifyProductCatalogToken func(context.Context, string, string) string

// shopifyOrderCatalogToken is retained for order-adjacent readers and writers
// that have not yet moved to the independent connector runtime. The
// OrderCatalog route must not use it.
type shopifyOrderCatalogToken func(context.Context, string, string) string

func shopifyNumericLegacyID(value json.Number, gid string) string {
	if id := strings.TrimSpace(value.String()); id != "" {
		return id
	}
	gid = strings.TrimSpace(gid)
	if index := strings.LastIndex(gid, "/"); index >= 0 && index+1 < len(gid) {
		return gid[index+1:]
	}
	return ""
}

