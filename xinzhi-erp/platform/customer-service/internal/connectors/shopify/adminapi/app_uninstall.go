package adminapi

import (
	"context"
	"errors"
	"strings"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

const appUninstallMutation = `mutation XZERPAppUninstall {
  appUninstall {
    app { id }
    userErrors { code field message }
  }
}`

// UninstallApp delegates removal to Shopify. The connector only clears its
// local credential after Shopify confirms removal (or confirms it is absent).
func (c *Client) UninstallApp(ctx context.Context, shopDomain string, accessToken string) error {
	if c == nil || c.httpClient == nil {
		return errors.New("Shopify Admin API client is unavailable")
	}
	var data struct {
		AppUninstall *struct {
			App *struct {
				ID string `json:"id"`
			} `json:"app"`
			UserErrors []struct {
				Code string `json:"code"`
			} `json:"userErrors"`
		} `json:"appUninstall"`
	}
	if err := c.queryGraphQL(ctx, shopDomain, accessToken, appUninstallMutation, map[string]any{}, &data); err != nil {
		return err
	}
	if data.AppUninstall == nil {
		return errors.New("Shopify Admin API app uninstall response is invalid")
	}
	if len(data.AppUninstall.UserErrors) != 0 {
		for _, item := range data.AppUninstall.UserErrors {
			switch strings.ToUpper(strings.TrimSpace(item.Code)) {
			case "APP_NOT_FOUND", "APP_NOT_INSTALLED":
				return shopifyconnector.ErrProviderAppNotInstalled
			case "USER_PERMISSIONS_INSUFFICIENT":
				return shopifyconnector.ErrProviderAuthorization
			}
		}
		return errors.New("Shopify Admin API app uninstall was rejected")
	}
	if data.AppUninstall.App == nil || strings.TrimSpace(data.AppUninstall.App.ID) == "" {
		return errors.New("Shopify Admin API app uninstall response is invalid")
	}
	return nil
}
