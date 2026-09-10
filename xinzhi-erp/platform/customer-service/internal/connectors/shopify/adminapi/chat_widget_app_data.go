package adminapi

import (
	"context"
	"errors"
	"net/url"
	"strings"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

const currentAppInstallationQuery = `query XZERPCurrentAppInstallation {
  currentAppInstallation { id }
}`

const chatWidgetAppDataQuery = `query XZERPChatWidgetAppData {
  currentAppInstallation {
    serviceOrigin: metafield(namespace: "xinzhi_support", key: "service_origin") { value }
    tenant: metafield(namespace: "xinzhi_support", key: "tenant_id") { value }
  }
}`

const setChatWidgetAppDataMutation = `mutation XZERPSetChatWidgetAppData($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { namespace key value }
    userErrors { code field message }
  }
}`

type ChatWidgetAppDataConfigurer struct {
	client         *Client
	defaultOrigin  string
	originByDomain map[string]string
}

func NewChatWidgetAppDataConfigurer(
	client *Client,
	defaultOrigin string,
	overrides string,
) (*ChatWidgetAppDataConfigurer, error) {
	defaultOrigin, err := normalizeChatWidgetOrigin(defaultOrigin)
	if client == nil || err != nil {
		return nil, errors.New("Shopify storefront support configuration is invalid")
	}
	configured := &ChatWidgetAppDataConfigurer{
		client: client, defaultOrigin: defaultOrigin, originByDomain: map[string]string{},
	}
	for _, raw := range strings.Split(overrides, ",") {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		parts := strings.SplitN(raw, "=", 2)
		if len(parts) != 2 {
			return nil, errors.New("Shopify storefront support configuration is invalid")
		}
		domain, ok := shopifyconnector.NormalizeShopDomain(strings.TrimSpace(parts[0]))
		if !ok {
			return nil, errors.New("Shopify storefront support configuration is invalid")
		}
		origin, originErr := normalizeChatWidgetOrigin(parts[1])
		if originErr != nil {
			return nil, errors.New("Shopify storefront support configuration is invalid")
		}
		if _, exists := configured.originByDomain[domain]; exists {
			return nil, errors.New("Shopify storefront support configuration is invalid")
		}
		configured.originByDomain[domain] = origin
	}
	return configured, nil
}

func normalizeChatWidgetOrigin(value string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed == nil || parsed.Scheme != "https" || parsed.Host == "" ||
		parsed.User != nil || (parsed.Path != "" && parsed.Path != "/") ||
		parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("invalid storefront support origin")
	}
	return "https://" + strings.ToLower(parsed.Host), nil
}

func (c *ChatWidgetAppDataConfigurer) originForDomain(domain string) string {
	if override := c.originByDomain[domain]; override != "" {
		return override
	}
	return c.defaultOrigin
}

// Read only this app installation's data. Never navigate to, or probe, the
// customer-service host, and never return an untrusted metafield as a link.
func (c *ChatWidgetAppDataConfigurer) ReadInstallationChatSetup(
	ctx context.Context, shopDomain, accessToken string, identity shopifyconnector.CanonicalShopIdentity,
) (string, bool, error) {
	domain, ok := shopifyconnector.NormalizeShopDomain(shopDomain)
	if c == nil || c.client == nil || !ok || strings.TrimSpace(accessToken) == "" || strings.TrimSpace(identity.TenantID) == "" {
		return "", false, errors.New("Shopify chat configuration check is unavailable")
	}
	var data struct {
		Installation *struct {
			Origin *struct {
				Value string `json:"value"`
			} `json:"serviceOrigin"`
			Tenant *struct {
				Value string `json:"value"`
			} `json:"tenant"`
		} `json:"currentAppInstallation"`
	}
	if err := c.client.queryGraphQL(ctx, domain, accessToken, chatWidgetAppDataQuery, map[string]any{}, &data); err != nil || data.Installation == nil {
		return "", false, errors.New("Shopify chat configuration check is unavailable")
	}
	origin := c.originForDomain(domain)
	if data.Installation.Origin == nil || data.Installation.Tenant == nil ||
		data.Installation.Origin.Value != origin || data.Installation.Tenant.Value != identity.TenantID {
		return "", false, nil
	}
	return origin, true, nil
}

func (c *ChatWidgetAppDataConfigurer) ConfigureInstallationAppData(
	ctx context.Context,
	shopDomain string,
	accessToken string,
	identity shopifyconnector.CanonicalShopIdentity,
) error {
	domain, ok := shopifyconnector.NormalizeShopDomain(shopDomain)
	tenantID := strings.TrimSpace(identity.TenantID)
	if c == nil || c.client == nil || !ok || strings.TrimSpace(accessToken) == "" || tenantID == "" {
		return errors.New("Shopify storefront support configuration is unavailable")
	}
	origin := c.originForDomain(domain)
	var installationData struct {
		CurrentAppInstallation *struct {
			ID string `json:"id"`
		} `json:"currentAppInstallation"`
	}
	if err := c.client.queryGraphQL(
		ctx, domain, accessToken, currentAppInstallationQuery, map[string]any{}, &installationData,
	); err != nil || installationData.CurrentAppInstallation == nil ||
		strings.TrimSpace(installationData.CurrentAppInstallation.ID) == "" {
		return errors.New("Shopify storefront support configuration failed")
	}
	ownerID := strings.TrimSpace(installationData.CurrentAppInstallation.ID)
	inputs := []map[string]any{
		{
			"ownerId": ownerID, "namespace": "xinzhi_support", "key": "service_origin",
			"type": "single_line_text_field", "value": origin,
		},
		{
			"ownerId": ownerID, "namespace": "xinzhi_support", "key": "tenant_id",
			"type": "single_line_text_field", "value": tenantID,
		},
	}
	var mutationData struct {
		MetafieldsSet *struct {
			Metafields *[]struct {
				Namespace string `json:"namespace"`
				Key       string `json:"key"`
				Value     string `json:"value"`
			} `json:"metafields"`
			UserErrors *[]struct {
				Code string `json:"code"`
			} `json:"userErrors"`
		} `json:"metafieldsSet"`
	}
	if err := c.client.queryGraphQL(
		ctx, domain, accessToken, setChatWidgetAppDataMutation,
		map[string]any{"metafields": inputs}, &mutationData,
	); err != nil {
		return errors.New("Shopify storefront support configuration failed")
	}
	payload := mutationData.MetafieldsSet
	if payload == nil || payload.Metafields == nil || payload.UserErrors == nil ||
		len(*payload.UserErrors) != 0 || !chatWidgetMetafieldsMatch(*payload.Metafields, origin, tenantID) {
		return errors.New("Shopify storefront support configuration failed")
	}
	return nil
}

func chatWidgetMetafieldsMatch(
	metafields []struct {
		Namespace string `json:"namespace"`
		Key       string `json:"key"`
		Value     string `json:"value"`
	},
	origin string,
	tenantID string,
) bool {
	want := map[string]string{"service_origin": origin, "tenant_id": tenantID}
	for _, metafield := range metafields {
		if metafield.Namespace == "xinzhi_support" && want[metafield.Key] == metafield.Value {
			delete(want, metafield.Key)
		}
	}
	return len(want) == 0
}

var _ interface {
	ConfigureInstallationAppData(
		context.Context,
		string,
		string,
		shopifyconnector.CanonicalShopIdentity,
	) error
} = (*ChatWidgetAppDataConfigurer)(nil)
