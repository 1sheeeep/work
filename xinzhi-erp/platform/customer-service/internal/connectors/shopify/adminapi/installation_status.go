package adminapi

import (
	"context"
	"errors"
	"strings"
)

const currentInstallationQuery = `query XZERPCurrentInstallation {
  currentAppInstallation { id }
  shop { myshopifyDomain }
}`

// Success proves current access, not the age of a webhook. Only a strict 401
// means the supplied credential was rejected; 403 and other failures are unknown.
func (c *Client) CheckCurrentInstallation(ctx context.Context, domain, token string) error {
	if c == nil || c.httpClient == nil {
		return errors.New("Shopify installation check is unavailable")
	}
	var data struct {
		Installation *struct {
			ID string `json:"id"`
		} `json:"currentAppInstallation"`
		Shop *struct {
			Domain string `json:"myshopifyDomain"`
		} `json:"shop"`
	}
	if err := c.queryGraphQL(ctx, domain, token, currentInstallationQuery, map[string]any{}, &data); err != nil {
		return err
	}
	if data.Installation == nil || data.Shop == nil || data.Shop.Domain != domain {
		return errors.New("Shopify installation check response is invalid")
	}
	id := strings.TrimPrefix(data.Installation.ID, "gid://shopify/AppInstallation/")
	if id == data.Installation.ID || id == "" || id[0] == '0' {
		return errors.New("Shopify installation check response is invalid")
	}
	for _, char := range id {
		if char < '0' || char > '9' {
			return errors.New("Shopify installation check response is invalid")
		}
	}
	return nil
}

var _ interface {
	CheckCurrentInstallation(context.Context, string, string) error
} = (*Client)(nil)
