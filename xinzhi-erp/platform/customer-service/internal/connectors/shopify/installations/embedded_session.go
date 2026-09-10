package installations

import (
	"context"
	"errors"
	"strings"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

var ErrEmbeddedERPLinkRequired = errors.New("Shopify shop is not linked to Xinzhi ERP")

type EmbeddedSessionConnection struct {
	Identity shopifyconnector.CanonicalShopIdentity
	Summary  shopifyconnector.InstallationSummary
	Pending  *PendingInstallationSummary
}

type EmbeddedSessionConnector interface {
	ConnectEmbeddedSession(context.Context, string, string) (EmbeddedSessionConnection, error)
}

func (s *Service) ConnectEmbeddedSession(ctx context.Context, domain string, sessionToken string) (EmbeddedSessionConnection, error) {
	domain, domainOK := shopifyconnector.NormalizeShopDomain(domain)
	sessionToken = strings.TrimSpace(sessionToken)
	if !domainOK || sessionToken == "" || s == nil || s.repository == nil || s.exchanger == nil {
		return EmbeddedSessionConnection{}, errors.New("embedded Shopify session is unavailable")
	}
	identity, err := s.repository.ResolveIdentityByDomain(ctx, domain)
	if errors.Is(err, ErrNotFound) {
		return s.prepareUnlinkedInstallation(ctx, domain, sessionToken)
	}
	if err != nil {
		return EmbeddedSessionConnection{}, errors.New("embedded Shopify session lookup failed")
	}
	legacyShopID, err := s.repository.ResolveLegacyShopID(ctx, identity)
	if err != nil {
		return EmbeddedSessionConnection{}, errors.New("embedded Shopify shop binding is incomplete")
	}
	binding, err := validateAndNormalizeBinding(Binding{
		Identity: identity, LegacyShopID: legacyShopID, ShopDomain: domain,
	})
	if err != nil {
		return EmbeddedSessionConnection{}, errors.New("embedded Shopify shop binding is invalid")
	}

	unlock := s.lockIdentity(identity)
	defer unlock()
	if err := ctx.Err(); err != nil {
		return EmbeddedSessionConnection{}, err
	}
	// Native confirmation already consumed the pending credential. Never run a
	// second exchange or replace its receipt just because app-data setup failed.
	linked, linkedErr := s.repository.GetInstallation(ctx, identity)
	if linkedErr == nil && linked.NativeLinkPending && linked.State == shopifyconnector.InstallationStateInstalled {
		// The ownership receipt is retained even when its credential has expired.
		// Only a verified merchant session can recover it; configuration failures
		// themselves must never cause another token exchange.
		if linked.Binding != binding {
			return EmbeddedSessionConnection{}, errors.New("embedded Shopify shop binding is invalid")
		}
		refreshed, _, refreshErr := s.providerAccessToken(ctx, linked)
		if errors.Is(refreshErr, ErrOfflineRefreshInactive) {
			refreshed, refreshErr = s.recoverEmbeddedCredential(ctx, linked, sessionToken)
		}
		if refreshErr != nil {
			return EmbeddedSessionConnection{}, errors.New("embedded Shopify installation is unavailable")
		}
		linked = refreshed
		linked, linkedErr = s.finishNativeLink(ctx, linked)
		if linkedErr != nil {
			return EmbeddedSessionConnection{}, linkedErr
		}
		return EmbeddedSessionConnection{Identity: identity, Summary: summary(linked)}, nil
	}

	storedBinding, record, notConfigured, _, recordErr := s.installedReadRecord(ctx, identity)
	if recordErr == nil && !notConfigured && storedBinding == binding {
		return EmbeddedSessionConnection{Identity: identity, Summary: summary(record)}, nil
	}
	if recordErr != nil {
		if errors.Is(recordErr, ErrOfflineRefreshInactive) && linkedErr == nil && linked.Binding == binding {
			recovered, recoverErr := s.recoverEmbeddedCredential(ctx, linked, sessionToken)
			if recoverErr == nil {
				return EmbeddedSessionConnection{Identity: identity, Summary: summary(recovered)}, nil
			}
		}
		return EmbeddedSessionConnection{}, errors.New("embedded Shopify installation is unavailable")
	}
	exchanger, ok := s.exchanger.(SessionTokenExchanger)
	if !ok || !s.requireExpiring {
		return EmbeddedSessionConnection{}, errors.New("embedded Shopify token exchange is unavailable")
	}
	exchange, err := exchanger.ExchangeSessionToken(ctx, domain, sessionToken)
	if err != nil || validateExpiringOAuthResult(exchange) != nil {
		return EmbeddedSessionConnection{}, errors.New("embedded Shopify token exchange failed")
	}
	exchange.AccessToken = strings.TrimSpace(exchange.AccessToken)
	exchange.RefreshToken = strings.TrimSpace(exchange.RefreshToken)
	exchange.Scopes = normalizeScopes(exchange.Scopes)
	if !containsAllScopes(exchange.Scopes, s.requiredScopes) {
		return EmbeddedSessionConnection{}, errors.New("embedded Shopify session is missing required scopes")
	}
	var shopIdentity shopifyconnector.ShopIdentity
	if s.shopIdentity != nil {
		shopIdentity, err = s.shopIdentity.FetchShopIdentity(ctx, domain, exchange.AccessToken)
		if err != nil || shopifyconnector.ValidateShopIdentity(shopIdentity) != nil ||
			!strings.EqualFold(shopIdentity.MyshopifyDomain, domain) {
			return EmbeddedSessionConnection{}, errors.New("embedded Shopify shop identity verification failed")
		}
	}
	if s.appDataConfigurer != nil {
		if err := s.appDataConfigurer.ConfigureInstallationAppData(
			ctx, binding.ShopDomain, exchange.AccessToken, binding.Identity,
		); err != nil {
			return EmbeddedSessionConnection{}, errors.New("embedded Shopify storefront support configuration failed")
		}
	}
	now := s.now().UTC()
	record = InstallationRecord{
		Binding:               binding,
		AccessToken:           exchange.AccessToken,
		RefreshToken:          exchange.RefreshToken,
		AccessTokenExpiresAt:  now.Add(exchange.AccessTokenTTL),
		RefreshTokenExpiresAt: now.Add(exchange.RefreshTokenTTL),
		CredentialKeyVersion:  s.credentialKeyVersion,
		ShopName:              strings.TrimSpace(shopIdentity.Name),
		Scopes:                exchange.Scopes,
		State:                 shopifyconnector.InstallationStateInstalled,
		InstalledAt:           now,
		UpdatedAt:             now,
	}
	if err := s.repository.CompleteInstallation(ctx, binding, record); err != nil {
		return EmbeddedSessionConnection{}, errors.New("embedded Shopify installation could not be saved")
	}
	return EmbeddedSessionConnection{Identity: identity, Summary: summary(record)}, nil
}

var _ EmbeddedSessionConnector = (*Service)(nil)

// Called only under the canonical lock after a terminal refresh result. Normal
// refresh errors (including unknown provider/persistence outcomes) do not enter
// this path. Rotation preserves installation times and native-link receipts;
// its expected refresh token also fences revocation or a newer installation.
func (s *Service) recoverEmbeddedCredential(ctx context.Context, record InstallationRecord, sessionToken string) (InstallationRecord, error) {
	exchanger, ok := s.exchanger.(SessionTokenExchanger)
	if !ok || !s.requireExpiring || record.State != shopifyconnector.InstallationStateInstalled || strings.TrimSpace(record.RefreshToken) == "" {
		return InstallationRecord{}, errors.New("embedded Shopify recovery is unavailable")
	}
	exchange, err := exchanger.ExchangeSessionToken(ctx, record.ShopDomain, sessionToken)
	if err != nil || validateExpiringOAuthResult(exchange) != nil || !containsAllScopes(normalizeScopes(exchange.Scopes), s.requiredScopes) {
		return InstallationRecord{}, errors.New("embedded Shopify recovery failed")
	}
	if s.shopIdentity != nil {
		shop, err := s.shopIdentity.FetchShopIdentity(ctx, record.ShopDomain, strings.TrimSpace(exchange.AccessToken))
		if err != nil || shopifyconnector.ValidateShopIdentity(shop) != nil || !strings.EqualFold(shop.MyshopifyDomain, record.ShopDomain) {
			return InstallationRecord{}, errors.New("embedded Shopify recovery identity is invalid")
		}
	}
	if err := ctx.Err(); err != nil {
		return InstallationRecord{}, err
	}
	return s.repository.RotateCredential(ctx, record.Identity, record.RefreshToken, exchange, s.credentialKeyVersion, s.now().UTC())
}
