package adminapi

import (
	"context"
	"errors"
	"regexp"
	"sort"
	"strings"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

// ReadBindingFacts are live, non-secret facts. They do not transfer credentials
// or change the installation. A configured/requested scope list is not evidence.
type ReadBindingFacts struct {
	ShopID, ShopDomain, ShopName, InstallationID, AppClientID string
	GrantedScopes                                             []string
}

const readBindingQuery = `query XZERPReadBinding {
  shop { id name myshopifyDomain }
  currentAppInstallation { id app { apiKey } accessScopes { handle } }
}`

var readBindingScope = regexp.MustCompile(`^[a-z][a-z0-9_]{0,127}$`)
var readBindingAppID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

func (c *Client) FetchReadBindingFacts(ctx context.Context, domain, token string) (ReadBindingFacts, error) {
	var data struct {
		Shop         *struct{ ID, Name, MyshopifyDomain string } `json:"shop"`
		Installation *struct {
			ID  string `json:"id"`
			App *struct {
				APIKey string `json:"apiKey"`
			} `json:"app"`
			Scopes *[]struct {
				Handle string `json:"handle"`
			} `json:"accessScopes"`
		} `json:"currentAppInstallation"`
	}
	if err := c.queryGraphQL(ctx, domain, token, readBindingQuery, map[string]any{}, &data); err != nil {
		return ReadBindingFacts{}, err
	}
	invalid := errors.New("Shopify read binding response is invalid")
	if data.Shop == nil || data.Installation == nil || data.Installation.App == nil || data.Installation.Scopes == nil ||
		!validReadBindingGID(data.Shop.ID, "Shop") || !validReadBindingGID(data.Installation.ID, "AppInstallation") ||
		data.Shop.MyshopifyDomain != domain ||
		shopifyconnector.ValidateShopIdentity(shopifyconnector.ShopIdentity{Name: data.Shop.Name, MyshopifyDomain: domain}) != nil ||
		!readBindingAppID.MatchString(data.Installation.App.APIKey) || len(*data.Installation.Scopes) > 200 {
		return ReadBindingFacts{}, invalid
	}
	scopes := make([]string, 0, len(*data.Installation.Scopes))
	seen := make(map[string]bool)
	for _, scope := range *data.Installation.Scopes {
		if !readBindingScope.MatchString(scope.Handle) || seen[scope.Handle] {
			return ReadBindingFacts{}, invalid
		}
		seen[scope.Handle] = true
		scopes = append(scopes, scope.Handle)
	}
	sort.Strings(scopes)
	return ReadBindingFacts{data.Shop.ID, domain, data.Shop.Name, data.Installation.ID, data.Installation.App.APIKey, scopes}, nil
}

func validReadBindingGID(value, kind string) bool {
	number := strings.TrimPrefix(value, "gid://shopify/"+kind+"/")
	if number == value || number == "" || number[0] == '0' {
		return false
	}
	for _, char := range number {
		if char < '0' || char > '9' {
			return false
		}
	}
	return true
}
