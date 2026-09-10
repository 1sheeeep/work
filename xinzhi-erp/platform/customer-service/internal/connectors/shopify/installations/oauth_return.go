package installations

import (
	"errors"
	"net/url"
	"strings"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

// Only the grant-verified shop and configured public app key choose this target.
// The callback's host, redirect, returnTo and forwarded headers are not inputs.
func shopifyAdminAppURL(shopDomain, apiKey string) (string, error) {
	domain, valid := shopifyconnector.NormalizeShopDomain(shopDomain)
	apiKey = strings.TrimSpace(apiKey)
	if !valid || apiKey == "" {
		return "", errors.New("invalid Shopify application return")
	}
	for _, char := range apiKey {
		if !((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '-' || char == '_') {
			return "", errors.New("invalid Shopify application return")
		}
	}
	return (&url.URL{Scheme: "https", Host: domain, Path: "/admin/apps/" + apiKey}).String(), nil
}
