package platform

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

func isERPManagedShopifySource(sources []ShopSource) bool {
	for _, source := range sources {
		if source.Type == SourceTypeShopifyAPI &&
			strings.EqualFold(strings.TrimSpace(source.Metadata["connectionMode"]), "xz_erp_app") {
			return true
		}
	}
	return false
}

func (s *Server) refreshERPManagedShopifyConnectionStatus(
	ctx context.Context,
	shop Shop,
	domain string,
) (ShopifyConnectionStatus, error) {
	tenantID := strings.TrimSpace(shop.Metadata["erpTenantId"])
	canonicalShopID := strings.TrimSpace(shop.Metadata["erpCanonicalShopId"])
	correlationID := "customer-service-connection-" + uuid.NewString()
	request := shopifyconnector.ConnectionProbeRequest{
		Identity: shopifyconnector.CanonicalShopIdentity{
			TenantID: tenantID,
			ShopID:   canonicalShopID,
		},
		Context: shopifyconnector.RequestContext{
			CorrelationID: correlationID,
			RequestID:     correlationID,
		},
	}
	probe, err := newShopifyConnectionHTTPProbeFromEnvironment()
	if err != nil {
		return ShopifyConnectionStatus{}, fmt.Errorf("ERP Shopify connector is unavailable")
	}
	summary, err := probe.ProbeConnection(ctx, request)
	if err != nil {
		return ShopifyConnectionStatus{}, err
	}
	status := erpManagedShopifyConnectionStatus(summary, domain)
	_, persistErr := s.persistShopifyConnectionStatus(ctx, shop.ID, status)
	return status, persistErr
}

func erpManagedShopifyConnectionStatus(
	summary shopifyconnector.ConnectionSummary,
	fallbackDomain string,
) ShopifyConnectionStatus {
	status := ShopifyConnectionStatus{
		ShopDomain:        firstNonEmpty(summary.ShopDomain, fallbackDomain),
		ShopName:          summary.ShopName,
		Scope:             strings.Join(summary.GrantedScopes, ","),
		CheckedAt:         summary.CheckedAt,
		AppDeployStatus:   ShopifyAppDeployReady,
		ThemeEmbedState:   shopifyThemeEmbedUnavailable,
		ThemeEmbedMessage: "聊天插件启用状态需要在 Shopify 主题编辑器中人工确认",
	}
	switch summary.State {
	case shopifyconnector.ConnectionStateConnected:
		status.State = "installed"
		status.Message = "Shopify 授权由 XZ ERP 统一连接"
	case shopifyconnector.ConnectionStateDisconnected:
		status.State = "not_installed"
		status.Message = "XZ ERP 中的 Shopify 授权已断开"
	default:
		status.State = "not_configured"
		status.Message = "XZ ERP 尚未配置 Shopify 授权"
	}
	return status
}
