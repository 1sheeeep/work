package platform

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
	shopifyinstallations "shopify-support-platform/internal/connectors/shopify/installations"
)

func (s *Server) handleShopifyConnectorRevocationEffects(w http.ResponseWriter, r *http.Request) {
	if !s.requireERPConnectorToken(w, r) {
		return
	}
	var request shopifyinstallations.RevocationRecord
	if !decodeERPConnectorRequest(w, r, &request) {
		return
	}
	domain, validDomain := shopifyconnector.NormalizeShopDomain(request.ShopDomain)
	if err := shopifyconnector.ValidateInstallationRevokeRequest(shopifyconnector.InstallationRevokeRequest{
		Identity: request.Identity, Context: request.Context,
	}); err != nil || strings.TrimSpace(request.LegacyShopID) == "" || !validDomain {
		writeERPConnectorResult(w, request.Context.CorrelationID, nil,
			shopifyconnector.InvalidInstallationRequestError(request.Identity, request.Context))
		return
	}
	resolver := storeShopifyConnectorBindingResolver{store: s.store}
	legacyShopID, err := resolver.ResolveLegacyShopID(r.Context(), request.Identity)
	if err != nil || legacyShopID != strings.TrimSpace(request.LegacyShopID) {
		writeERPConnectorResult(w, request.Context.CorrelationID, nil,
			shopifyconnector.ForbiddenInstallationError(request.Context))
		return
	}
	shop, err := s.store.GetShop(r.Context(), legacyShopID)
	if err != nil {
		writeERPConnectorResult(w, request.Context.CorrelationID, nil,
			shopifyconnector.ForbiddenInstallationError(request.Context))
		return
	}
	sources, err := s.store.ListShopSources(r.Context(), legacyShopID)
	if err != nil {
		writeERPConnectorResult(w, request.Context.CorrelationID, nil,
			shopifyconnector.SafeInstallationErrorFor(request.Context, err))
		return
	}
	boundDomain := normalizeShopifyDomain(shop.Metadata["shopifyDomain"]) == domain
	for _, source := range sources {
		if isConnectorManagedShopifySource(source) && sourceShopifyDomain(source) == domain {
			boundDomain = true
			break
		}
	}
	if !boundDomain {
		writeERPConnectorResult(w, request.Context.CorrelationID, nil,
			shopifyconnector.ForbiddenInstallationError(request.Context))
		return
	}
	if err := s.disableShopifyConnectorSourcesByDomain(r.Context(), legacyShopID, domain); err != nil {
		writeERPConnectorResult(w, request.Context.CorrelationID, nil,
			shopifyconnector.SafeInstallationErrorFor(request.Context, err))
		return
	}
	if err := s.invalidateShopifyConnectorCaches(r.Context(), legacyShopID); err != nil {
		writeERPConnectorResult(w, request.Context.CorrelationID, nil,
			shopifyconnector.SafeInstallationErrorFor(request.Context, err))
		return
	}
	writeERPConnectorResult(w, request.Context.CorrelationID, shopifyinstallations.RevocationEffectsResult{
		ContractVersion: shopifyconnector.InstallationContractVersion,
		TenantID:        request.Identity.TenantID, ShopID: request.Identity.ShopID,
		SourceDisabled: true, CachesInvalidated: true,
	}, nil)
}

func isConnectorManagedShopifySource(source ShopSource) bool {
	return source.Type == SourceTypeShopifyAPI || source.Provider == "shopify_admin"
}

func (s *Server) disableShopifyConnectorSourcesByDomain(ctx context.Context, shopID string, domain string) error {
	sources, err := s.store.ListShopSources(ctx, shopID)
	if err != nil {
		return err
	}
	for _, source := range sources {
		if !isConnectorManagedShopifySource(source) || sourceShopifyDomain(source) != domain || source.Status == SourceStatusDisabled {
			continue
		}
		disabled, err := s.store.SetShopSourceStatus(ctx, shopID, source.ID, SourceStatusDisabled)
		if err != nil {
			return err
		}
		s.broadcast(Event{Type: "shop_source.updated", ShopID: shopID, EntityID: disabled.ID, Payload: disabled, CreatedAt: time.Now().UTC()})
	}
	updated, err := s.store.ListShopSources(ctx, shopID)
	if err != nil {
		return err
	}
	for _, source := range updated {
		if isConnectorManagedShopifySource(source) && sourceShopifyDomain(source) == domain && source.Status != SourceStatusDisabled {
			return errors.New("Shopify connector source disablement is incomplete")
		}
	}
	return nil
}

func (s *Server) invalidateShopifyConnectorCaches(ctx context.Context, shopID string) error {
	invalidator, ok := s.store.(externalCacheInvalidator)
	if !ok {
		return nil
	}
	for _, namespace := range []string{shopifyOrderCacheNamespace, shopifyCustomerCacheNamespace} {
		if _, err := invalidator.DeleteExternalCacheNamespace(ctx, namespace, shopID); err != nil {
			return err
		}
	}
	return nil
}
