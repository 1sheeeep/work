package installations

import (
	"context"
	"errors"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

type OAuthExchangeResult struct {
	AccessToken     string
	RefreshToken    string
	AccessTokenTTL  time.Duration
	RefreshTokenTTL time.Duration
	Scopes          []string
}

func (r OAuthExchangeResult) String() string {
	return "oauthExchange{credentials=[REDACTED] scopes=" + strings.Join(r.Scopes, ",") + "}"
}

func (r OAuthExchangeResult) GoString() string { return r.String() }

type OAuthExchanger interface {
	ExchangeOAuthCode(context.Context, string, string) (OAuthExchangeResult, error)
}

type OfflineTokenRefresher interface {
	RefreshOfflineToken(context.Context, string, string) (OAuthExchangeResult, error)
}

type SessionTokenExchanger interface {
	ExchangeSessionToken(context.Context, string, string) (OAuthExchangeResult, error)
}

type InstallationAppDataConfigurer interface {
	ConfigureInstallationAppData(
		context.Context,
		string,
		string,
		shopifyconnector.CanonicalShopIdentity,
	) error
}

type ProviderAppUninstaller interface {
	UninstallApp(context.Context, string, string) error
}

type ShopIdentityProvider interface {
	FetchShopIdentity(context.Context, string, string) (shopifyconnector.ShopIdentity, error)
}

type RevocationEffects interface {
	ApplyRevocation(context.Context, RevocationRecord) error
}

type ProductCatalogProvider interface {
	FetchProductCatalogPage(
		context.Context,
		string,
		string,
		shopifyconnector.ProductCatalogPageRequest,
	) (shopifyconnector.ProductCatalogPage, error)
}

type OrderCatalogProvider interface {
	FetchOrderCatalogPage(
		context.Context,
		string,
		string,
		shopifyconnector.OrderCatalogPageRequest,
	) (shopifyconnector.OrderCatalogPage, error)
}

type CustomerCatalogProvider interface {
	FetchCustomerCatalogPage(
		context.Context,
		string,
		string,
		shopifyconnector.CustomerCatalogPageRequest,
	) (shopifyconnector.CustomerCatalogPage, error)
}

type ReturnCatalogProvider interface {
	FetchReturnCatalogPage(context.Context, string, string, shopifyconnector.ReturnCatalogPageRequest) (shopifyconnector.ReturnCatalogPage, error)
}
type ReturnDecisionProvider interface {
	DecideReturn(context.Context, string, string, shopifyconnector.ReturnDecisionRequest) (shopifyconnector.ReturnDecisionResult, error)
}
type ReturnRefundPreviewProvider interface {
	PreviewReturnRefund(context.Context, string, string, shopifyconnector.ReturnRefundPreviewRequest) (shopifyconnector.ReturnRefundPreview, error)
}
type ReturnRefundProcessProvider interface {
	ProcessReturnRefund(context.Context, string, string, shopifyconnector.ReturnRefundProcessRequest) (shopifyconnector.ReturnRefundProcessResult, error)
}
type LocationCatalogProvider interface {
	FetchLocationCatalogPage(context.Context, string, string, shopifyconnector.LocationCatalogPageRequest) (shopifyconnector.LocationCatalogPage, error)
}
type InventoryLevelProvider interface {
	FetchInventoryLevel(context.Context, string, string, shopifyconnector.InventoryLevelReadRequest) (shopifyconnector.InventoryLevelSnapshot, error)
}
type DisputeCatalogProvider interface {
	FetchDisputeCatalogPage(context.Context, string, string, shopifyconnector.DisputeCatalogPageRequest) (shopifyconnector.DisputeCatalogPage, error)
}
type InventorySetProvider interface {
	SetInventoryAvailable(context.Context, string, string, shopifyconnector.InventorySetRequest) (shopifyconnector.InventorySetResult, error)
}

type OrderShippingAddressProvider interface {
	UpdateOrderShippingAddress(context.Context, string, string, shopifyconnector.OrderShippingAddressUpdateRequest) (shopifyconnector.OrderShippingAddressUpdateResult, error)
}
type FulfillmentPublishProvider interface {
	PublishFulfillment(context.Context, string, string, shopifyconnector.FulfillmentPublishRequest) (shopifyconnector.FulfillmentPublishResult, error)
}

type Service struct {
	repository           Repository
	requiredScopes       []string
	effects              RevocationEffects
	exchanger            OAuthExchanger
	shopIdentity         ShopIdentityProvider
	productCatalog       ProductCatalogProvider
	orderCatalog         OrderCatalogProvider
	customerCatalog      CustomerCatalogProvider
	returnCatalog        ReturnCatalogProvider
	returnDecision       ReturnDecisionProvider
	returnRefundPreview  ReturnRefundPreviewProvider
	returnRefundProcess  ReturnRefundProcessProvider
	locationCatalog      LocationCatalogProvider
	inventoryLevel       InventoryLevelProvider
	disputeCatalog       DisputeCatalogProvider
	inventoryWriter      InventorySetProvider
	orderAddress         OrderShippingAddressProvider
	fulfillment          FulfillmentPublishProvider
	now                  func() time.Time
	identityLocks        sync.Map
	tokenRefresher       OfflineTokenRefresher
	requireExpiring      bool
	credentialKeyVersion string
	refreshSkew          time.Duration
	appDataConfigurer    InstallationAppDataConfigurer
	appUninstaller       ProviderAppUninstaller
	installationChecker  InstallationChecker
}

func (s *Service) ConfigureInstallationUninstaller(uninstaller ProviderAppUninstaller) error {
	if s == nil || uninstaller == nil {
		return errors.New("Shopify installation uninstaller configuration is invalid")
	}
	s.appUninstaller = uninstaller
	return nil
}

func (s *Service) ConfigureInstallationAppData(configurer InstallationAppDataConfigurer) error {
	if s == nil || configurer == nil {
		return errors.New("Shopify installation app-data configuration is invalid")
	}
	s.appDataConfigurer = configurer
	return nil
}

func (s *Service) RequireExpiringOfflineTokens(refresher OfflineTokenRefresher, keyVersion string, refreshSkew time.Duration) error {
	keyVersion = strings.TrimSpace(keyVersion)
	if s == nil || refresher == nil || keyVersion == "" {
		return errors.New("expiring Shopify offline token configuration is invalid")
	}
	if refreshSkew <= 0 {
		refreshSkew = 5 * time.Minute
	}
	s.tokenRefresher = refresher
	s.requireExpiring = true
	s.credentialKeyVersion = keyVersion
	s.refreshSkew = refreshSkew
	return nil
}

func NewService(repository Repository, requiredScopes []string, effects RevocationEffects, exchanger OAuthExchanger) *Service {
	return &Service{
		repository: repository, requiredScopes: normalizeScopes(requiredScopes),
		effects: effects, exchanger: exchanger, now: time.Now,
	}
}

func NewServiceWithProductCatalog(
	repository Repository,
	requiredScopes []string,
	effects RevocationEffects,
	exchanger OAuthExchanger,
	productCatalog ProductCatalogProvider,
) *Service {
	return NewServiceWithCatalogs(repository, requiredScopes, effects, exchanger, productCatalog, nil)
}

func NewServiceWithCatalogs(
	repository Repository,
	requiredScopes []string,
	effects RevocationEffects,
	exchanger OAuthExchanger,
	productCatalog ProductCatalogProvider,
	orderCatalog OrderCatalogProvider,
) *Service {
	service := NewService(repository, requiredScopes, effects, exchanger)
	service.productCatalog = productCatalog
	service.orderCatalog = orderCatalog
	if provider, ok := orderCatalog.(CustomerCatalogProvider); ok {
		service.customerCatalog = provider
	}
	if provider, ok := productCatalog.(ShopIdentityProvider); ok {
		service.shopIdentity = provider
	}
	return service
}

func NewServiceWithReadProviders(repository Repository, requiredScopes []string, effects RevocationEffects, exchanger OAuthExchanger, product ProductCatalogProvider, order OrderCatalogProvider, returns ReturnCatalogProvider, locations LocationCatalogProvider, inventory InventoryLevelProvider, disputes DisputeCatalogProvider) *Service {
	service := NewServiceWithCatalogs(repository, requiredScopes, effects, exchanger, product, order)
	service.returnCatalog = returns
	if provider, ok := returns.(ReturnDecisionProvider); ok {
		service.returnDecision = provider
	}
	if provider, ok := returns.(ReturnRefundPreviewProvider); ok {
		service.returnRefundPreview = provider
	}
	if provider, ok := returns.(ReturnRefundProcessProvider); ok {
		service.returnRefundProcess = provider
	}
	service.locationCatalog = locations
	service.inventoryLevel = inventory
	service.disputeCatalog = disputes
	return service
}

func (s *Service) DecideReturn(ctx context.Context, request shopifyconnector.ReturnDecisionRequest) (shopifyconnector.ReturnDecisionResult, error) {
	if shopifyconnector.ValidateReturnDecisionRequest(request) != nil {
		return shopifyconnector.ReturnDecisionResult{}, shopifyconnector.InvalidReturnDecisionRequestError(request)
	}
	if err := ctx.Err(); err != nil {
		return shopifyconnector.ReturnDecisionResult{}, shopifyconnector.SafeReturnDecisionErrorFor(request, err)
	}
	if s == nil || s.repository == nil {
		return shopifyconnector.ReturnDecisionResult{}, returnDecisionFailure(request, "repository_unconfigured", errors.New("installation repository unavailable"))
	}
	unlock := s.lockIdentity(request.Identity)
	defer unlock()
	binding, record, missing, diagnostic, err := s.installedReadRecord(ctx, request.Identity)
	if err != nil {
		return shopifyconnector.ReturnDecisionResult{}, returnDecisionFailure(request, diagnostic, err)
	}
	if missing || !containsAllScopes(record.Scopes, []string{"read_returns", "write_returns"}) {
		return shopifyconnector.ReturnDecisionResult{}, shopifyconnector.ForbiddenReturnDecisionError(request)
	}
	if s.returnDecision == nil {
		return shopifyconnector.ReturnDecisionResult{}, returnDecisionFailure(request, "provider_unconfigured", errors.New("Shopify return decision provider unavailable"))
	}
	result, err := s.returnDecision.DecideReturn(ctx, binding.ShopDomain, record.AccessToken, request)
	if err != nil {
		var safeErr *shopifyconnector.ConnectionProbeError
		if errors.As(err, &safeErr) && safeErr.Code == shopifyconnector.ErrorCodeInvalidRequest {
			return shopifyconnector.ReturnDecisionResult{}, safeErr
		}
		return shopifyconnector.ReturnDecisionResult{}, returnDecisionFailure(request, "provider_request_failed", err)
	}
	if shopifyconnector.ValidateReturnDecisionResult(request, result) != nil {
		return shopifyconnector.ReturnDecisionResult{}, returnDecisionFailure(request, "provider_response_invalid", errors.New("Shopify return decision provider response is invalid"))
	}
	return result, nil
}

func returnDecisionFailure(request shopifyconnector.ReturnDecisionRequest, diagnostic string, cause error) error {
	log.Printf("Shopify connector return decision failed diagnostic=%s correlation=%s", diagnostic, request.Context.CorrelationID)
	return shopifyconnector.SafeReturnDecisionErrorFor(request, cause)
}

func (s *Service) PreviewReturnRefund(ctx context.Context, request shopifyconnector.ReturnRefundPreviewRequest) (shopifyconnector.ReturnRefundPreview, error) {
	if shopifyconnector.ValidateReturnRefundPreviewRequest(request) != nil {
		return shopifyconnector.ReturnRefundPreview{}, shopifyconnector.InvalidReturnRefundPreviewRequestError(request)
	}
	if err := ctx.Err(); err != nil {
		return shopifyconnector.ReturnRefundPreview{}, shopifyconnector.SafeReturnRefundPreviewErrorFor(request, err)
	}
	if s == nil || s.repository == nil {
		return shopifyconnector.ReturnRefundPreview{}, returnRefundPreviewFailure(request, "repository_unconfigured", errors.New("installation repository unavailable"))
	}
	unlock := s.lockIdentity(request.Identity)
	defer unlock()
	binding, record, missing, diagnostic, err := s.installedReadRecord(ctx, request.Identity)
	if err != nil {
		return shopifyconnector.ReturnRefundPreview{}, returnRefundPreviewFailure(request, diagnostic, err)
	}
	if missing || !containsAllScopes(record.Scopes, []string{"read_orders", "read_returns"}) {
		return shopifyconnector.ReturnRefundPreview{}, shopifyconnector.ForbiddenReturnRefundPreviewError(request)
	}
	if s.returnRefundPreview == nil {
		return shopifyconnector.ReturnRefundPreview{}, returnRefundPreviewFailure(request, "provider_unconfigured", errors.New("Shopify return refund preview provider unavailable"))
	}
	result, err := s.returnRefundPreview.PreviewReturnRefund(ctx, binding.ShopDomain, record.AccessToken, request)
	if err != nil {
		var safeErr *shopifyconnector.ConnectionProbeError
		if errors.As(err, &safeErr) && safeErr.Code == shopifyconnector.ErrorCodeInvalidRequest {
			return shopifyconnector.ReturnRefundPreview{}, safeErr
		}
		return shopifyconnector.ReturnRefundPreview{}, returnRefundPreviewFailure(request, "provider_request_failed", err)
	}
	if shopifyconnector.ValidateReturnRefundPreview(request, result) != nil {
		return shopifyconnector.ReturnRefundPreview{}, returnRefundPreviewFailure(request, "provider_response_invalid", errors.New("Shopify return refund preview provider response is invalid"))
	}
	return result, nil
}

func returnRefundPreviewFailure(request shopifyconnector.ReturnRefundPreviewRequest, diagnostic string, cause error) error {
	log.Printf("Shopify connector return refund preview failed diagnostic=%s correlation=%s", diagnostic, request.Context.CorrelationID)
	return shopifyconnector.SafeReturnRefundPreviewErrorFor(request, cause)
}

func (s *Service) ProcessReturnRefund(ctx context.Context, request shopifyconnector.ReturnRefundProcessRequest) (shopifyconnector.ReturnRefundProcessResult, error) {
	if shopifyconnector.ValidateReturnRefundProcessRequest(request) != nil {
		return shopifyconnector.ReturnRefundProcessResult{}, shopifyconnector.InvalidReturnRefundProcessRequestError(request)
	}
	if err := ctx.Err(); err != nil {
		return shopifyconnector.ReturnRefundProcessResult{}, shopifyconnector.SafeReturnRefundProcessErrorFor(request, err)
	}
	if s == nil || s.repository == nil {
		return shopifyconnector.ReturnRefundProcessResult{}, returnRefundProcessFailure(request, "repository_unconfigured", errors.New("installation repository unavailable"))
	}
	unlock := s.lockIdentity(request.Identity)
	defer unlock()
	binding, record, missing, diagnostic, err := s.installedReadRecord(ctx, request.Identity)
	if err != nil {
		return shopifyconnector.ReturnRefundProcessResult{}, returnRefundProcessFailure(request, diagnostic, err)
	}
	if missing || !containsAllScopes(record.Scopes, []string{"read_orders", "read_returns", "write_returns"}) {
		return shopifyconnector.ReturnRefundProcessResult{}, shopifyconnector.ForbiddenReturnRefundProcessError(request)
	}
	if s.returnRefundProcess == nil {
		return shopifyconnector.ReturnRefundProcessResult{}, returnRefundProcessFailure(request, "provider_unconfigured", errors.New("Shopify return refund process provider unavailable"))
	}
	result, err := s.returnRefundProcess.ProcessReturnRefund(ctx, binding.ShopDomain, record.AccessToken, request)
	if err != nil {
		var safeErr *shopifyconnector.ConnectionProbeError
		if errors.As(err, &safeErr) && safeErr.Code == shopifyconnector.ErrorCodeInvalidRequest {
			return shopifyconnector.ReturnRefundProcessResult{}, safeErr
		}
		return shopifyconnector.ReturnRefundProcessResult{}, returnRefundProcessFailure(request, "provider_request_failed", err)
	}
	if shopifyconnector.ValidateReturnRefundProcessResult(request, result) != nil {
		return shopifyconnector.ReturnRefundProcessResult{}, returnRefundProcessFailure(request, "provider_response_invalid", errors.New("Shopify return refund process provider response is invalid"))
	}
	return result, nil
}

func returnRefundProcessFailure(request shopifyconnector.ReturnRefundProcessRequest, diagnostic string, cause error) error {
	log.Printf("Shopify connector return refund process failed diagnostic=%s correlation=%s", diagnostic, request.Context.CorrelationID)
	return shopifyconnector.SafeReturnRefundProcessErrorFor(request, cause)
}

func NewServiceWithProviders(repository Repository, requiredScopes []string, effects RevocationEffects, exchanger OAuthExchanger, product ProductCatalogProvider, order OrderCatalogProvider, returns ReturnCatalogProvider, locations LocationCatalogProvider, inventory InventoryLevelProvider, disputes DisputeCatalogProvider, inventoryWriter InventorySetProvider, orderAddress OrderShippingAddressProvider, fulfillment FulfillmentPublishProvider) *Service {
	service := NewServiceWithReadProviders(repository, requiredScopes, effects, exchanger, product, order, returns, locations, inventory, disputes)
	service.inventoryWriter = inventoryWriter
	service.orderAddress = orderAddress
	service.fulfillment = fulfillment
	return service
}

func (s *Service) CompleteOAuth(ctx context.Context, request shopifyconnector.CompleteOAuthRequest) (shopifyconnector.InstallationSummary, error) {
	if err := shopifyconnector.ValidateCompleteOAuthRequest(request); err != nil {
		return shopifyconnector.InstallationSummary{}, shopifyconnector.InvalidInstallationRequestError(request.Identity, request.Context)
	}
	if err := ctx.Err(); err != nil {
		return shopifyconnector.InstallationSummary{}, shopifyconnector.SafeInstallationErrorFor(request.Context, err)
	}
	if s == nil || s.repository == nil || s.exchanger == nil {
		return shopifyconnector.InstallationSummary{}, shopifyconnector.SafeInstallationErrorFor(request.Context, errors.New("installation connector unavailable"))
	}
	unlock := s.lockIdentity(request.Identity)
	defer unlock()
	if err := ctx.Err(); err != nil {
		return shopifyconnector.InstallationSummary{}, shopifyconnector.SafeInstallationErrorFor(request.Context, err)
	}
	exchange, err := s.exchanger.ExchangeOAuthCode(ctx, normalizeDomain(request.ShopDomain), strings.TrimSpace(request.AuthorizationCode))
	if err != nil {
		return shopifyconnector.InstallationSummary{}, shopifyconnector.SafeInstallationErrorFor(request.Context, err)
	}
	exchange.AccessToken = strings.TrimSpace(exchange.AccessToken)
	exchange.RefreshToken = strings.TrimSpace(exchange.RefreshToken)
	exchange.Scopes = normalizeScopes(exchange.Scopes)
	if exchange.AccessToken == "" || (s.requireExpiring && validateExpiringOAuthResult(exchange) != nil) {
		return shopifyconnector.InstallationSummary{}, shopifyconnector.SafeInstallationErrorFor(request.Context, errors.New("provider returned no access token"))
	}
	if !containsAllScopes(exchange.Scopes, s.requiredScopes) {
		return shopifyconnector.InstallationSummary{}, shopifyconnector.ForbiddenInstallationError(request.Context)
	}
	var shopIdentity shopifyconnector.ShopIdentity
	if s.shopIdentity != nil {
		shopIdentity, err = s.shopIdentity.FetchShopIdentity(
			ctx, normalizeDomain(request.ShopDomain), exchange.AccessToken)
		if err != nil || shopifyconnector.ValidateShopIdentity(shopIdentity) != nil ||
			!strings.EqualFold(shopIdentity.MyshopifyDomain, normalizeDomain(request.ShopDomain)) {
			return shopifyconnector.InstallationSummary{}, shopifyconnector.SafeInstallationErrorFor(
				request.Context, errors.New("Shopify shop identity verification failed"))
		}
	}
	now := s.now().UTC()
	binding, bindingErr := validateAndNormalizeBinding(Binding{
		Identity: request.Identity, LegacyShopID: request.LegacyShopID, ShopDomain: request.ShopDomain,
	})
	if bindingErr != nil {
		return shopifyconnector.InstallationSummary{}, shopifyconnector.InvalidInstallationRequestError(request.Identity, request.Context)
	}
	if s.appDataConfigurer != nil {
		if err := s.appDataConfigurer.ConfigureInstallationAppData(
			ctx, binding.ShopDomain, exchange.AccessToken, binding.Identity,
		); err != nil {
			return shopifyconnector.InstallationSummary{}, shopifyconnector.SafeInstallationErrorFor(
				request.Context, errors.New("Shopify storefront support configuration failed"))
		}
	}
	record := InstallationRecord{
		Binding: binding, AccessToken: exchange.AccessToken, RefreshToken: exchange.RefreshToken, Scopes: exchange.Scopes,
		ShopName: strings.TrimSpace(shopIdentity.Name),
		State:    shopifyconnector.InstallationStateInstalled, InstalledAt: now, UpdatedAt: now,
	}
	if s.requireExpiring {
		record.AccessTokenExpiresAt = now.Add(exchange.AccessTokenTTL)
		record.RefreshTokenExpiresAt = now.Add(exchange.RefreshTokenTTL)
		record.CredentialKeyVersion = s.credentialKeyVersion
	}
	if err := s.repository.CompleteInstallation(ctx, binding, record); err != nil {
		if errors.Is(err, ErrBindingConflict) {
			return shopifyconnector.InstallationSummary{}, shopifyconnector.ForbiddenInstallationError(request.Context)
		}
		return shopifyconnector.InstallationSummary{}, shopifyconnector.SafeInstallationErrorFor(request.Context, err)
	}
	return summary(record), nil
}

func validateExpiringOAuthResult(result OAuthExchangeResult) error {
	if strings.TrimSpace(result.AccessToken) == "" || strings.TrimSpace(result.RefreshToken) == "" ||
		result.AccessTokenTTL <= 0 || result.RefreshTokenTTL <= result.AccessTokenTTL {
		return errors.New("Shopify returned an invalid expiring offline credential")
	}
	return nil
}

func (s *Service) providerAccessToken(ctx context.Context, record InstallationRecord) (InstallationRecord, string, error) {
	if !s.requireExpiring {
		return record, strings.TrimSpace(record.AccessToken), nil
	}
	now := s.now().UTC()
	if strings.TrimSpace(record.RefreshToken) == "" || record.AccessTokenExpiresAt.IsZero() ||
		record.RefreshTokenExpiresAt.IsZero() || strings.TrimSpace(record.CredentialKeyVersion) == "" {
		return InstallationRecord{}, "", errors.New("Shopify expiring offline credential is incomplete")
	}
	if now.Before(record.AccessTokenExpiresAt.Add(-s.refreshSkew)) {
		return record, strings.TrimSpace(record.AccessToken), nil
	}
	if !now.Before(record.RefreshTokenExpiresAt) {
		return InstallationRecord{}, "", ErrOfflineRefreshInactive
	}
	previousRefreshToken := record.RefreshToken
	replacement, err := s.tokenRefresher.RefreshOfflineToken(ctx, record.ShopDomain, previousRefreshToken)
	if errors.Is(err, ErrOfflineRefreshInactive) {
		return InstallationRecord{}, "", ErrOfflineRefreshInactive
	}
	if err != nil || validateExpiringOAuthResult(replacement) != nil {
		return InstallationRecord{}, "", errors.New("Shopify offline credential refresh failed")
	}
	if len(replacement.Scopes) == 0 {
		replacement.Scopes = append([]string(nil), record.Scopes...)
	}
	updated, err := s.repository.RotateCredential(ctx, record.Identity, previousRefreshToken, replacement, s.credentialKeyVersion, now)
	if err != nil {
		return InstallationRecord{}, "", errors.New("Shopify offline credential rotation could not be committed")
	}
	return updated, updated.AccessToken, nil
}

func (s *Service) Probe(ctx context.Context, request shopifyconnector.InstallationProbeRequest) (shopifyconnector.InstallationSummary, error) {
	if err := shopifyconnector.ValidateInstallationProbeRequest(request); err != nil {
		return shopifyconnector.InstallationSummary{}, shopifyconnector.InvalidInstallationRequestError(request.Identity, request.Context)
	}
	if err := ctx.Err(); err != nil {
		return shopifyconnector.InstallationSummary{}, shopifyconnector.SafeInstallationErrorFor(request.Context, err)
	}
	if s == nil || s.repository == nil {
		return shopifyconnector.InstallationSummary{}, shopifyconnector.SafeInstallationErrorFor(request.Context, errors.New("installation repository unavailable"))
	}
	unlock := s.lockIdentity(request.Identity)
	defer unlock()
	if err := ctx.Err(); err != nil {
		return shopifyconnector.InstallationSummary{}, shopifyconnector.SafeInstallationErrorFor(request.Context, err)
	}
	record, err := s.repository.GetInstallation(ctx, request.Identity)
	if errors.Is(err, ErrNotFound) {
		now := s.now().UTC()
		return shopifyconnector.InstallationSummary{
			ContractVersion: shopifyconnector.InstallationContractVersion,
			TenantID:        request.Identity.TenantID, ShopID: request.Identity.ShopID,
			State: shopifyconnector.InstallationStateNotConfigured, UpdatedAt: now,
		}, nil
	}
	if err != nil {
		return shopifyconnector.InstallationSummary{}, shopifyconnector.SafeInstallationErrorFor(request.Context, err)
	}
	return summary(record), nil
}

func (s *Service) ProbeConnection(ctx context.Context, request shopifyconnector.ConnectionProbeRequest) (shopifyconnector.ConnectionSummary, error) {
	if err := shopifyconnector.ValidateRequest(request); err != nil {
		return shopifyconnector.ConnectionSummary{}, shopifyconnector.InvalidRequestError(request)
	}
	if err := ctx.Err(); err != nil {
		return shopifyconnector.ConnectionSummary{}, shopifyconnector.SafeErrorFor(request, err)
	}
	if s == nil || s.repository == nil {
		return shopifyconnector.ConnectionSummary{}, connectionProbeFailure(request, "repository_unconfigured", errors.New("installation repository unavailable"))
	}
	unlocked := s.lockIdentity(request.Identity)
	defer unlocked()
	if err := ctx.Err(); err != nil {
		return shopifyconnector.ConnectionSummary{}, shopifyconnector.SafeErrorFor(request, err)
	}
	now := s.now().UTC()
	record, err := s.repository.GetInstallation(ctx, request.Identity)
	if errors.Is(err, ErrNotFound) {
		return shopifyconnector.NotConfiguredSummary(request, now), nil
	}
	if err != nil || record.Identity != request.Identity {
		diagnostic := "record_identity_mismatch"
		cause := errors.New("installation repository is inconsistent")
		if err != nil {
			diagnostic = "repository_read_failed"
			cause = err
		}
		return shopifyconnector.ConnectionSummary{}, connectionProbeFailure(request, diagnostic, cause)
	}
	if _, err := validateAndNormalizeBinding(record.Binding); err != nil {
		return shopifyconnector.ConnectionSummary{}, connectionProbeFailure(request, "record_binding_invalid", errors.New("installation repository is inconsistent"))
	}
	scopes := normalizeScopes(record.Scopes)
	switch record.State {
	case shopifyconnector.InstallationStateInstalled:
		if record.NativeLinkPending {
			return shopifyconnector.NotConfiguredSummary(request, now), nil
		}
		if strings.TrimSpace(record.AccessToken) == "" || len(scopes) == 0 ||
			record.InstalledAt.IsZero() || record.UpdatedAt.IsZero() || record.UpdatedAt.Before(record.InstalledAt) ||
			!record.RevokedAt.IsZero() {
			return shopifyconnector.ConnectionSummary{}, connectionProbeFailure(request, "installed_record_invalid", errors.New("installation repository is inconsistent"))
		}
		refreshed, _, refreshErr := s.providerAccessToken(ctx, record)
		if refreshErr != nil {
			return shopifyconnector.ConnectionSummary{}, connectionProbeFailure(request, "credential_refresh_failed", refreshErr)
		}
		record = refreshed
		if record.ShopName != "" && shopifyconnector.ValidateShopIdentity(
			shopifyconnector.ShopIdentity{
				Name: record.ShopName, MyshopifyDomain: record.ShopDomain,
			}) != nil {
			return shopifyconnector.ConnectionSummary{}, connectionProbeFailure(
				request, "shop_identity_invalid", errors.New("installation repository is inconsistent"))
		}
		return shopifyconnector.ConnectedShopSummary(
			request, now, scopes, record.ShopName, record.ShopDomain), nil
	case shopifyconnector.InstallationStateRevoked:
		if strings.TrimSpace(record.AccessToken) != "" || len(scopes) == 0 ||
			record.InstalledAt.IsZero() || record.RevokedAt.IsZero() || record.UpdatedAt.IsZero() ||
			record.RevokedAt.Before(record.InstalledAt) || record.UpdatedAt.Before(record.RevokedAt) {
			return shopifyconnector.ConnectionSummary{}, connectionProbeFailure(request, "revoked_record_invalid", errors.New("installation repository is inconsistent"))
		}
		return shopifyconnector.DisconnectedSummary(request, now, scopes), nil
	default:
		return shopifyconnector.ConnectionSummary{}, connectionProbeFailure(request, "record_state_invalid", errors.New("installation repository is inconsistent"))
	}
}

func (s *Service) FetchProductCatalogPage(
	ctx context.Context,
	request shopifyconnector.ProductCatalogPageRequest,
) (shopifyconnector.ProductCatalogPage, error) {
	if err := shopifyconnector.ValidateProductCatalogPageRequest(request); err != nil {
		return shopifyconnector.ProductCatalogPage{}, shopifyconnector.InvalidCatalogRequestError(request)
	}
	if err := ctx.Err(); err != nil {
		return shopifyconnector.ProductCatalogPage{}, shopifyconnector.SafeCatalogErrorFor(request, err)
	}
	if s == nil || s.repository == nil {
		return shopifyconnector.ProductCatalogPage{}, productCatalogFailure(request, "repository_unconfigured", errors.New("installation repository unavailable"))
	}
	unlock := s.lockIdentity(request.Identity)
	defer unlock()
	if err := ctx.Err(); err != nil {
		return shopifyconnector.ProductCatalogPage{}, shopifyconnector.SafeCatalogErrorFor(request, err)
	}
	record, err := s.repository.GetInstallation(ctx, request.Identity)
	if errors.Is(err, ErrNotFound) {
		return shopifyconnector.NotConfiguredProductCatalogPage(request), nil
	}
	if err != nil {
		return shopifyconnector.ProductCatalogPage{}, productCatalogFailure(request, "repository_read_failed", err)
	}
	if record.Identity != request.Identity {
		return shopifyconnector.ProductCatalogPage{}, productCatalogFailure(request, "record_identity_mismatch", errors.New("installation repository is inconsistent"))
	}
	if record.NativeLinkPending {
		return shopifyconnector.NotConfiguredProductCatalogPage(request), nil
	}
	binding, err := validateAndNormalizeBinding(record.Binding)
	if err != nil || binding != record.Binding {
		return shopifyconnector.ProductCatalogPage{}, productCatalogFailure(request, "record_binding_invalid", errors.New("installation repository is inconsistent"))
	}
	scopes := normalizeScopes(record.Scopes)
	switch record.State {
	case shopifyconnector.InstallationStateRevoked:
		if strings.TrimSpace(record.AccessToken) != "" || len(scopes) == 0 ||
			record.InstalledAt.IsZero() || record.RevokedAt.IsZero() || record.UpdatedAt.IsZero() ||
			record.RevokedAt.Before(record.InstalledAt) || record.UpdatedAt.Before(record.RevokedAt) {
			return shopifyconnector.ProductCatalogPage{}, productCatalogFailure(request, "revoked_record_invalid", errors.New("installation repository is inconsistent"))
		}
		return shopifyconnector.NotConfiguredProductCatalogPage(request), nil
	case shopifyconnector.InstallationStateInstalled:
		if strings.TrimSpace(record.AccessToken) == "" || len(scopes) == 0 ||
			record.InstalledAt.IsZero() || record.UpdatedAt.IsZero() || record.UpdatedAt.Before(record.InstalledAt) ||
			!record.RevokedAt.IsZero() {
			return shopifyconnector.ProductCatalogPage{}, productCatalogFailure(request, "installed_record_invalid", errors.New("installation repository is inconsistent"))
		}
	default:
		return shopifyconnector.ProductCatalogPage{}, productCatalogFailure(request, "record_state_invalid", errors.New("installation repository is inconsistent"))
	}
	if !containsAllScopes(scopes, []string{"read_products"}) {
		return shopifyconnector.ProductCatalogPage{}, shopifyconnector.ForbiddenCatalogError(request)
	}
	if s.productCatalog == nil {
		return shopifyconnector.ProductCatalogPage{}, productCatalogFailure(request, "provider_unconfigured", errors.New("Shopify product provider unavailable"))
	}
	refreshed, token, refreshErr := s.providerAccessToken(ctx, record)
	if refreshErr != nil {
		return shopifyconnector.ProductCatalogPage{}, productCatalogFailure(request, "credential_refresh_failed", refreshErr)
	}
	record = refreshed
	page, err := s.productCatalog.FetchProductCatalogPage(ctx, binding.ShopDomain, token, request)
	if err != nil {
		return shopifyconnector.ProductCatalogPage{}, productCatalogFailure(request, "provider_request_failed", err)
	}
	if err := shopifyconnector.ValidateProductCatalogPage(request, page); err != nil || page.State != shopifyconnector.ProductCatalogStateConnected {
		return shopifyconnector.ProductCatalogPage{}, productCatalogFailure(request, "provider_response_invalid", errors.New("Shopify product provider response is invalid"))
	}
	return page, nil
}

func productCatalogFailure(request shopifyconnector.ProductCatalogPageRequest, diagnostic string, cause error) error {
	log.Printf("Shopify connector product catalog failed diagnostic=%s correlation=%s", diagnostic, request.Context.CorrelationID)
	return shopifyconnector.SafeCatalogErrorFor(request, cause)
}

func (s *Service) FetchOrderCatalogPage(
	ctx context.Context,
	request shopifyconnector.OrderCatalogPageRequest,
) (shopifyconnector.OrderCatalogPage, error) {
	if err := shopifyconnector.ValidateOrderCatalogPageRequest(request); err != nil {
		return shopifyconnector.OrderCatalogPage{}, shopifyconnector.InvalidOrderCatalogRequestError(request)
	}
	if err := ctx.Err(); err != nil {
		return shopifyconnector.OrderCatalogPage{}, shopifyconnector.SafeOrderCatalogErrorFor(request, err)
	}
	if s == nil || s.repository == nil {
		return shopifyconnector.OrderCatalogPage{}, orderCatalogFailure(request, "repository_unconfigured", errors.New("installation repository unavailable"))
	}
	unlock := s.lockIdentity(request.Identity)
	defer unlock()
	if err := ctx.Err(); err != nil {
		return shopifyconnector.OrderCatalogPage{}, shopifyconnector.SafeOrderCatalogErrorFor(request, err)
	}
	record, err := s.repository.GetInstallation(ctx, request.Identity)
	if errors.Is(err, ErrNotFound) {
		return shopifyconnector.NotConfiguredOrderCatalogPage(request), nil
	}
	if err != nil {
		return shopifyconnector.OrderCatalogPage{}, orderCatalogFailure(request, "repository_read_failed", err)
	}
	if record.Identity != request.Identity {
		return shopifyconnector.OrderCatalogPage{}, orderCatalogFailure(request, "record_identity_mismatch", errors.New("installation repository is inconsistent"))
	}
	if record.NativeLinkPending {
		return shopifyconnector.NotConfiguredOrderCatalogPage(request), nil
	}
	binding, err := validateAndNormalizeBinding(record.Binding)
	if err != nil || binding != record.Binding {
		return shopifyconnector.OrderCatalogPage{}, orderCatalogFailure(request, "record_binding_invalid", errors.New("installation repository is inconsistent"))
	}
	scopes := normalizeScopes(record.Scopes)
	switch record.State {
	case shopifyconnector.InstallationStateRevoked:
		if strings.TrimSpace(record.AccessToken) != "" || len(scopes) == 0 ||
			record.InstalledAt.IsZero() || record.RevokedAt.IsZero() || record.UpdatedAt.IsZero() ||
			record.RevokedAt.Before(record.InstalledAt) || record.UpdatedAt.Before(record.RevokedAt) {
			return shopifyconnector.OrderCatalogPage{}, orderCatalogFailure(request, "revoked_record_invalid", errors.New("installation repository is inconsistent"))
		}
		return shopifyconnector.NotConfiguredOrderCatalogPage(request), nil
	case shopifyconnector.InstallationStateInstalled:
		if strings.TrimSpace(record.AccessToken) == "" || len(scopes) == 0 ||
			record.InstalledAt.IsZero() || record.UpdatedAt.IsZero() || record.UpdatedAt.Before(record.InstalledAt) ||
			!record.RevokedAt.IsZero() {
			return shopifyconnector.OrderCatalogPage{}, orderCatalogFailure(request, "installed_record_invalid", errors.New("installation repository is inconsistent"))
		}
	default:
		return shopifyconnector.OrderCatalogPage{}, orderCatalogFailure(request, "record_state_invalid", errors.New("installation repository is inconsistent"))
	}
	if !containsAllScopes(scopes, []string{"read_orders"}) {
		return shopifyconnector.OrderCatalogPage{}, shopifyconnector.ForbiddenOrderCatalogError(request)
	}
	if s.orderCatalog == nil {
		return shopifyconnector.OrderCatalogPage{}, orderCatalogFailure(request, "provider_unconfigured", errors.New("Shopify order provider unavailable"))
	}
	refreshed, token, refreshErr := s.providerAccessToken(ctx, record)
	if refreshErr != nil {
		return shopifyconnector.OrderCatalogPage{}, orderCatalogFailure(request, "credential_refresh_failed", refreshErr)
	}
	record = refreshed
	page, err := s.orderCatalog.FetchOrderCatalogPage(ctx, binding.ShopDomain, token, request)
	if err != nil {
		return shopifyconnector.OrderCatalogPage{}, orderCatalogFailure(request, "provider_request_failed", err)
	}
	if err := shopifyconnector.ValidateOrderCatalogPage(request, page); err != nil || page.State != shopifyconnector.OrderCatalogStateConnected {
		return shopifyconnector.OrderCatalogPage{}, orderCatalogFailure(request, "provider_response_invalid", errors.New("Shopify order provider response is invalid"))
	}
	return page, nil
}

func orderCatalogFailure(request shopifyconnector.OrderCatalogPageRequest, diagnostic string, cause error) error {
	log.Printf("Shopify connector order catalog failed diagnostic=%s correlation=%s", diagnostic, request.Context.CorrelationID)
	if errors.Is(cause, shopifyconnector.ErrProtectedCustomerDataRequired) {
		return shopifyconnector.ProtectedCustomerDataOrderCatalogError(request)
	}
	return shopifyconnector.SafeOrderCatalogErrorFor(request, cause)
}

func (s *Service) FetchCustomerCatalogPage(
	ctx context.Context,
	request shopifyconnector.CustomerCatalogPageRequest,
) (shopifyconnector.CustomerCatalogPage, error) {
	if shopifyconnector.ValidateCustomerCatalogPageRequest(request) != nil {
		return shopifyconnector.CustomerCatalogPage{}, shopifyconnector.InvalidCustomerCatalogRequestError(request)
	}
	if err := ctx.Err(); err != nil {
		return shopifyconnector.CustomerCatalogPage{}, shopifyconnector.SafeCustomerCatalogErrorFor(request, err)
	}
	if s == nil || s.repository == nil {
		return shopifyconnector.CustomerCatalogPage{}, customerCatalogFailure(request, "repository_unconfigured", errors.New("installation repository unavailable"))
	}
	unlock := s.lockIdentity(request.Identity)
	defer unlock()
	binding, record, missing, diagnostic, err := s.installedReadRecord(ctx, request.Identity)
	if err != nil {
		return shopifyconnector.CustomerCatalogPage{}, customerCatalogFailure(request, diagnostic, err)
	}
	if missing {
		return shopifyconnector.NotConfiguredCustomerCatalogPage(request), nil
	}
	if !containsAllScopes(record.Scopes, []string{"read_customers"}) {
		return shopifyconnector.CustomerCatalogPage{}, shopifyconnector.ForbiddenCustomerCatalogError(request)
	}
	if s.customerCatalog == nil {
		return shopifyconnector.CustomerCatalogPage{}, customerCatalogFailure(request, "provider_unconfigured", errors.New("Shopify customer provider unavailable"))
	}
	page, err := s.customerCatalog.FetchCustomerCatalogPage(ctx, binding.ShopDomain, record.AccessToken, request)
	if err != nil {
		return shopifyconnector.CustomerCatalogPage{}, customerCatalogFailure(request, "provider_request_failed", err)
	}
	if shopifyconnector.ValidateCustomerCatalogPage(request, page) != nil || page.State != shopifyconnector.OrderCatalogStateConnected {
		return shopifyconnector.CustomerCatalogPage{}, customerCatalogFailure(request, "provider_response_invalid", errors.New("Shopify customer provider response is invalid"))
	}
	return page, nil
}

func customerCatalogFailure(request shopifyconnector.CustomerCatalogPageRequest, diagnostic string, cause error) error {
	log.Printf("Shopify connector customer catalog failed diagnostic=%s correlation=%s", diagnostic, request.Context.CorrelationID)
	if errors.Is(cause, shopifyconnector.ErrProtectedCustomerDataRequired) {
		return shopifyconnector.ProtectedCustomerDataCustomerCatalogError(request)
	}
	return shopifyconnector.SafeCustomerCatalogErrorFor(request, cause)
}

func (s *Service) installedReadRecord(ctx context.Context, identity shopifyconnector.CanonicalShopIdentity) (Binding, InstallationRecord, bool, string, error) {
	record, err := s.repository.GetInstallation(ctx, identity)
	if errors.Is(err, ErrNotFound) {
		return Binding{}, InstallationRecord{}, true, "", nil
	}
	if err != nil {
		return Binding{}, InstallationRecord{}, false, "repository_read_failed", err
	}
	if record.Identity != identity {
		return Binding{}, InstallationRecord{}, false, "record_identity_mismatch", errors.New("installation repository is inconsistent")
	}
	binding, err := validateAndNormalizeBinding(record.Binding)
	if err != nil || binding != record.Binding {
		return Binding{}, InstallationRecord{}, false, "record_binding_invalid", errors.New("installation repository is inconsistent")
	}
	scopes := normalizeScopes(record.Scopes)
	if record.State == shopifyconnector.InstallationStateRevoked {
		if strings.TrimSpace(record.AccessToken) != "" || len(scopes) == 0 || record.InstalledAt.IsZero() || record.RevokedAt.IsZero() || record.UpdatedAt.IsZero() || record.RevokedAt.Before(record.InstalledAt) || record.UpdatedAt.Before(record.RevokedAt) {
			return Binding{}, InstallationRecord{}, false, "revoked_record_invalid", errors.New("installation repository is inconsistent")
		}
		return Binding{}, InstallationRecord{}, true, "", nil
	}
	if record.State != shopifyconnector.InstallationStateInstalled {
		return Binding{}, InstallationRecord{}, false, "record_state_invalid", errors.New("installation repository is inconsistent")
	}
	if record.NativeLinkPending {
		return Binding{}, InstallationRecord{}, false, "native_link_configuration_pending", errors.New("installation setup is incomplete")
	}
	if strings.TrimSpace(record.AccessToken) == "" || len(scopes) == 0 || record.InstalledAt.IsZero() || record.UpdatedAt.IsZero() || record.UpdatedAt.Before(record.InstalledAt) || !record.RevokedAt.IsZero() {
		return Binding{}, InstallationRecord{}, false, "installed_record_invalid", errors.New("installation repository is inconsistent")
	}
	record.Scopes = scopes
	refreshed, _, refreshErr := s.providerAccessToken(ctx, record)
	if refreshErr != nil {
		return Binding{}, InstallationRecord{}, false, "credential_refresh_failed", refreshErr
	}
	record = refreshed
	return binding, record, false, "", nil
}

func (s *Service) FetchReturnCatalogPage(ctx context.Context, request shopifyconnector.ReturnCatalogPageRequest) (shopifyconnector.ReturnCatalogPage, error) {
	if shopifyconnector.ValidateReturnCatalogPageRequest(request) != nil {
		return shopifyconnector.ReturnCatalogPage{}, shopifyconnector.InvalidReturnCatalogRequestError(request)
	}
	if err := ctx.Err(); err != nil {
		return shopifyconnector.ReturnCatalogPage{}, shopifyconnector.SafeReturnCatalogErrorFor(request, err)
	}
	if s == nil || s.repository == nil {
		return shopifyconnector.ReturnCatalogPage{}, returnCatalogFailure(request, "repository_unconfigured", errors.New("installation repository unavailable"))
	}
	unlock := s.lockIdentity(request.Identity)
	defer unlock()
	binding, record, missing, diagnostic, err := s.installedReadRecord(ctx, request.Identity)
	if err != nil {
		return shopifyconnector.ReturnCatalogPage{}, returnCatalogFailure(request, diagnostic, err)
	}
	if missing {
		return shopifyconnector.NotConfiguredReturnCatalogPage(request), nil
	}
	if !containsAllScopes(record.Scopes, []string{"read_orders", "read_returns"}) {
		return shopifyconnector.ReturnCatalogPage{}, shopifyconnector.ForbiddenReturnCatalogError(request)
	}
	if s.returnCatalog == nil {
		return shopifyconnector.ReturnCatalogPage{}, returnCatalogFailure(request, "provider_unconfigured", errors.New("Shopify return provider unavailable"))
	}
	page, err := s.returnCatalog.FetchReturnCatalogPage(ctx, binding.ShopDomain, record.AccessToken, request)
	if err != nil {
		return shopifyconnector.ReturnCatalogPage{}, returnCatalogFailure(request, "provider_request_failed", err)
	}
	if shopifyconnector.ValidateReturnCatalogPage(request, page) != nil || page.State != shopifyconnector.OrderCatalogStateConnected {
		return shopifyconnector.ReturnCatalogPage{}, returnCatalogFailure(request, "provider_response_invalid", errors.New("Shopify return provider response is invalid"))
	}
	return page, nil
}

func returnCatalogFailure(request shopifyconnector.ReturnCatalogPageRequest, diagnostic string, cause error) error {
	if diagnostic == "provider_request_failed" {
		var safeDiagnostic interface{ SafeDiagnostic() string }
		if errors.As(cause, &safeDiagnostic) {
			if detail := strings.TrimSpace(safeDiagnostic.SafeDiagnostic()); detail != "" {
				diagnostic += "_" + detail
			}
		}
	}
	log.Printf("Shopify connector return catalog failed diagnostic=%s correlation=%s", diagnostic, request.Context.CorrelationID)
	return shopifyconnector.SafeReturnCatalogErrorFor(request, cause)
}

func (s *Service) FetchLocationCatalogPage(ctx context.Context, request shopifyconnector.LocationCatalogPageRequest) (shopifyconnector.LocationCatalogPage, error) {
	if shopifyconnector.ValidateLocationCatalogPageRequest(request) != nil {
		return shopifyconnector.LocationCatalogPage{}, shopifyconnector.InvalidLocationCatalogRequestError(request)
	}
	if err := ctx.Err(); err != nil {
		return shopifyconnector.LocationCatalogPage{}, shopifyconnector.SafeLocationCatalogErrorFor(request, err)
	}
	if s == nil || s.repository == nil {
		return shopifyconnector.LocationCatalogPage{}, locationCatalogFailure(request, "repository_unconfigured", errors.New("installation repository unavailable"))
	}
	unlock := s.lockIdentity(request.Identity)
	defer unlock()
	binding, record, missing, diagnostic, err := s.installedReadRecord(ctx, request.Identity)
	if err != nil {
		return shopifyconnector.LocationCatalogPage{}, locationCatalogFailure(request, diagnostic, err)
	}
	if missing {
		return shopifyconnector.NotConfiguredLocationCatalogPage(request), nil
	}
	if !containsAllScopes(record.Scopes, []string{"read_locations"}) {
		return shopifyconnector.LocationCatalogPage{}, shopifyconnector.ForbiddenLocationCatalogError(request)
	}
	if s.locationCatalog == nil {
		return shopifyconnector.LocationCatalogPage{}, locationCatalogFailure(request, "provider_unconfigured", errors.New("Shopify location provider unavailable"))
	}
	page, err := s.locationCatalog.FetchLocationCatalogPage(ctx, binding.ShopDomain, record.AccessToken, request)
	if err != nil {
		return shopifyconnector.LocationCatalogPage{}, locationCatalogFailure(request, "provider_request_failed", err)
	}
	if shopifyconnector.ValidateLocationCatalogPage(request, page) != nil || page.State != shopifyconnector.LocationCatalogStateConnected {
		return shopifyconnector.LocationCatalogPage{}, locationCatalogFailure(request, "provider_response_invalid", errors.New("Shopify location provider response is invalid"))
	}
	return page, nil
}

func locationCatalogFailure(request shopifyconnector.LocationCatalogPageRequest, diagnostic string, cause error) error {
	log.Printf("Shopify connector location catalog failed diagnostic=%s correlation=%s", diagnostic, request.Context.CorrelationID)
	return shopifyconnector.SafeLocationCatalogErrorFor(request, cause)
}

func (s *Service) FetchInventoryLevel(ctx context.Context, request shopifyconnector.InventoryLevelReadRequest) (shopifyconnector.InventoryLevelSnapshot, error) {
	if shopifyconnector.ValidateInventoryLevelReadRequest(request) != nil {
		return shopifyconnector.InventoryLevelSnapshot{}, shopifyconnector.InvalidInventoryLevelRequestError(request)
	}
	if err := ctx.Err(); err != nil {
		return shopifyconnector.InventoryLevelSnapshot{}, shopifyconnector.SafeInventoryLevelErrorFor(request, err)
	}
	if s == nil || s.repository == nil {
		return shopifyconnector.InventoryLevelSnapshot{}, inventoryLevelFailure(request, "repository_unconfigured", errors.New("installation repository unavailable"))
	}
	unlock := s.lockIdentity(request.Identity)
	defer unlock()
	binding, record, missing, diagnostic, err := s.installedReadRecord(ctx, request.Identity)
	if err != nil {
		return shopifyconnector.InventoryLevelSnapshot{}, inventoryLevelFailure(request, diagnostic, err)
	}
	if missing {
		return shopifyconnector.NotConfiguredInventoryLevel(request), nil
	}
	if !containsAllScopes(record.Scopes, []string{"read_inventory", "read_locations"}) {
		return shopifyconnector.InventoryLevelSnapshot{}, shopifyconnector.ForbiddenInventoryLevelError(request)
	}
	if s.inventoryLevel == nil {
		return shopifyconnector.InventoryLevelSnapshot{}, inventoryLevelFailure(request, "provider_unconfigured", errors.New("Shopify inventory provider unavailable"))
	}
	snapshot, err := s.inventoryLevel.FetchInventoryLevel(ctx, binding.ShopDomain, record.AccessToken, request)
	if err != nil {
		return shopifyconnector.InventoryLevelSnapshot{}, inventoryLevelFailure(request, "provider_request_failed", err)
	}
	if shopifyconnector.ValidateInventoryLevelSnapshot(request, snapshot) != nil || snapshot.State != shopifyconnector.InventoryLevelStateConnected {
		return shopifyconnector.InventoryLevelSnapshot{}, inventoryLevelFailure(request, "provider_response_invalid", errors.New("Shopify inventory provider response is invalid"))
	}
	return snapshot, nil
}

func inventoryLevelFailure(request shopifyconnector.InventoryLevelReadRequest, diagnostic string, cause error) error {
	log.Printf("Shopify connector inventory level failed diagnostic=%s correlation=%s", diagnostic, request.Context.CorrelationID)
	return shopifyconnector.SafeInventoryLevelErrorFor(request, cause)
}

func (s *Service) FetchDisputeCatalogPage(ctx context.Context, request shopifyconnector.DisputeCatalogPageRequest) (shopifyconnector.DisputeCatalogPage, error) {
	if shopifyconnector.ValidateDisputeCatalogPageRequest(request) != nil {
		return shopifyconnector.DisputeCatalogPage{}, shopifyconnector.InvalidDisputeCatalogRequestError(request)
	}
	if err := ctx.Err(); err != nil {
		return shopifyconnector.DisputeCatalogPage{}, shopifyconnector.SafeDisputeCatalogErrorFor(request, err)
	}
	if s == nil || s.repository == nil {
		return shopifyconnector.DisputeCatalogPage{}, disputeCatalogFailure(request, "repository_unconfigured", errors.New("installation repository unavailable"))
	}
	unlock := s.lockIdentity(request.Identity)
	defer unlock()
	binding, record, missing, diagnostic, err := s.installedReadRecord(ctx, request.Identity)
	if err != nil {
		return shopifyconnector.DisputeCatalogPage{}, disputeCatalogFailure(request, diagnostic, err)
	}
	if missing {
		return shopifyconnector.NotConfiguredDisputeCatalogPage(request), nil
	}
	if !containsAllScopes(record.Scopes, []string{"read_shopify_payments_disputes"}) {
		return shopifyconnector.DisputeCatalogPage{}, shopifyconnector.ForbiddenDisputeCatalogError(request)
	}
	if s.disputeCatalog == nil {
		return shopifyconnector.DisputeCatalogPage{}, disputeCatalogFailure(request, "provider_unconfigured", errors.New("Shopify dispute provider unavailable"))
	}
	page, err := s.disputeCatalog.FetchDisputeCatalogPage(ctx, binding.ShopDomain, record.AccessToken, request)
	if err != nil {
		return shopifyconnector.DisputeCatalogPage{}, disputeCatalogFailure(request, "provider_request_failed", err)
	}
	if shopifyconnector.ValidateDisputeCatalogPage(request, page) != nil || page.State != shopifyconnector.OrderCatalogStateConnected {
		return shopifyconnector.DisputeCatalogPage{}, disputeCatalogFailure(request, "provider_response_invalid", errors.New("Shopify dispute provider response is invalid"))
	}
	return page, nil
}

func disputeCatalogFailure(request shopifyconnector.DisputeCatalogPageRequest, diagnostic string, cause error) error {
	log.Printf("Shopify connector dispute catalog failed diagnostic=%s correlation=%s", diagnostic, request.Context.CorrelationID)
	return shopifyconnector.SafeDisputeCatalogErrorFor(request, cause)
}

func (s *Service) SetInventoryAvailable(ctx context.Context, request shopifyconnector.InventorySetRequest) (shopifyconnector.InventorySetResult, error) {
	if shopifyconnector.ValidateInventorySetRequest(request) != nil {
		return shopifyconnector.InventorySetResult{}, shopifyconnector.InvalidInventorySetRequestError(request)
	}
	if err := ctx.Err(); err != nil {
		return shopifyconnector.InventorySetResult{}, shopifyconnector.SafeInventorySetErrorFor(request, err)
	}
	if s == nil || s.repository == nil {
		return shopifyconnector.InventorySetResult{}, inventoryWriteFailure(request, "repository_unconfigured", errors.New("installation repository unavailable"))
	}
	unlock := s.lockIdentity(request.Identity)
	defer unlock()
	binding, record, missing, diagnostic, err := s.installedReadRecord(ctx, request.Identity)
	if err != nil {
		return shopifyconnector.InventorySetResult{}, inventoryWriteFailure(request, diagnostic, err)
	}
	if missing || !containsAllScopes(record.Scopes, []string{"write_inventory", "read_locations"}) {
		return shopifyconnector.InventorySetResult{}, shopifyconnector.ForbiddenInventorySetError(request)
	}
	if s.inventoryWriter == nil {
		return shopifyconnector.InventorySetResult{}, inventoryWriteFailure(request, "provider_unconfigured", errors.New("Shopify inventory write provider unavailable"))
	}
	result, err := s.inventoryWriter.SetInventoryAvailable(ctx, binding.ShopDomain, record.AccessToken, request)
	if err != nil {
		return shopifyconnector.InventorySetResult{}, inventoryWriteFailure(request, "provider_request_failed", err)
	}
	if shopifyconnector.ValidateInventorySetResult(request, result) != nil {
		return shopifyconnector.InventorySetResult{}, inventoryWriteFailure(request, "provider_response_invalid", errors.New("Shopify inventory write provider response is invalid"))
	}
	return result, nil
}

func inventoryWriteFailure(request shopifyconnector.InventorySetRequest, diagnostic string, cause error) error {
	log.Printf("Shopify connector inventory write failed diagnostic=%s correlation=%s", diagnostic, request.Context.CorrelationID)
	return shopifyconnector.SafeInventorySetErrorFor(request, cause)
}

func (s *Service) UpdateOrderShippingAddress(ctx context.Context, request shopifyconnector.OrderShippingAddressUpdateRequest) (shopifyconnector.OrderShippingAddressUpdateResult, error) {
	if shopifyconnector.ValidateOrderShippingAddressUpdateRequest(request) != nil {
		return shopifyconnector.OrderShippingAddressUpdateResult{}, shopifyconnector.InvalidOrderShippingAddressRequestError(request)
	}
	if err := ctx.Err(); err != nil {
		return shopifyconnector.OrderShippingAddressUpdateResult{}, shopifyconnector.SafeOrderShippingAddressErrorFor(request, err)
	}
	if s == nil || s.repository == nil {
		return shopifyconnector.OrderShippingAddressUpdateResult{}, orderAddressFailure(request, "repository_unconfigured", errors.New("installation repository unavailable"))
	}
	unlock := s.lockIdentity(request.Identity)
	defer unlock()
	binding, record, missing, diagnostic, err := s.installedReadRecord(ctx, request.Identity)
	if err != nil {
		return shopifyconnector.OrderShippingAddressUpdateResult{}, orderAddressFailure(request, diagnostic, err)
	}
	if missing || !containsAllScopes(record.Scopes, []string{"write_orders"}) {
		return shopifyconnector.OrderShippingAddressUpdateResult{}, shopifyconnector.ForbiddenOrderShippingAddressError(request)
	}
	if s.orderAddress == nil {
		return shopifyconnector.OrderShippingAddressUpdateResult{}, orderAddressFailure(request, "provider_unconfigured", errors.New("Shopify order address provider unavailable"))
	}
	result, err := s.orderAddress.UpdateOrderShippingAddress(ctx, binding.ShopDomain, record.AccessToken, request)
	if err != nil {
		var safeErr *shopifyconnector.ConnectionProbeError
		if errors.As(err, &safeErr) && safeErr.Code == shopifyconnector.ErrorCodeInvalidRequest {
			return shopifyconnector.OrderShippingAddressUpdateResult{}, safeErr
		}
		if errors.Is(err, shopifyconnector.ErrProviderAuthorization) {
			return shopifyconnector.OrderShippingAddressUpdateResult{}, shopifyconnector.ForbiddenOrderShippingAddressError(request)
		}
		return shopifyconnector.OrderShippingAddressUpdateResult{}, orderAddressFailure(request, "provider_request_failed", err)
	}
	if shopifyconnector.ValidateOrderShippingAddressUpdateResult(request, result) != nil {
		return shopifyconnector.OrderShippingAddressUpdateResult{}, orderAddressFailure(request, "provider_response_invalid", errors.New("Shopify order address provider response is invalid"))
	}
	return result, nil
}

func orderAddressFailure(request shopifyconnector.OrderShippingAddressUpdateRequest, diagnostic string, cause error) error {
	log.Printf("Shopify connector order address write failed diagnostic=%s correlation=%s", diagnostic, request.Context.CorrelationID)
	return shopifyconnector.SafeOrderShippingAddressErrorFor(request, cause)
}

func (s *Service) PublishFulfillment(ctx context.Context, request shopifyconnector.FulfillmentPublishRequest) (shopifyconnector.FulfillmentPublishResult, error) {
	if shopifyconnector.ValidateFulfillmentPublishRequest(request) != nil {
		return shopifyconnector.FulfillmentPublishResult{}, shopifyconnector.InvalidFulfillmentPublishRequestError(request)
	}
	if err := ctx.Err(); err != nil {
		return shopifyconnector.FulfillmentPublishResult{}, shopifyconnector.SafeFulfillmentPublishErrorFor(request, err)
	}
	if s == nil || s.repository == nil {
		return shopifyconnector.FulfillmentPublishResult{}, fulfillmentFailure(request, "repository_unconfigured", errors.New("installation repository unavailable"))
	}
	unlock := s.lockIdentity(request.Identity)
	defer unlock()
	binding, record, missing, diagnostic, err := s.installedReadRecord(ctx, request.Identity)
	if err != nil {
		return shopifyconnector.FulfillmentPublishResult{}, fulfillmentFailure(request, diagnostic, err)
	}
	if missing || !containsFulfillmentScopePair(record.Scopes) {
		return shopifyconnector.FulfillmentPublishResult{}, shopifyconnector.ForbiddenFulfillmentPublishError(request)
	}
	if s.fulfillment == nil {
		return shopifyconnector.FulfillmentPublishResult{}, fulfillmentFailure(request, "provider_unconfigured", errors.New("Shopify fulfillment provider unavailable"))
	}
	result, err := s.fulfillment.PublishFulfillment(ctx, binding.ShopDomain, record.AccessToken, request)
	if err != nil {
		if errors.Is(err, shopifyconnector.ErrInvalidFulfillment) {
			return shopifyconnector.FulfillmentPublishResult{}, shopifyconnector.InvalidFulfillmentPublishRequestError(request)
		}
		if errors.Is(err, shopifyconnector.ErrProviderAuthorization) {
			return shopifyconnector.FulfillmentPublishResult{}, shopifyconnector.ForbiddenFulfillmentPublishError(request)
		}
		return shopifyconnector.FulfillmentPublishResult{}, fulfillmentFailure(request, "provider_request_failed", err)
	}
	if shopifyconnector.ValidateFulfillmentPublishResult(request, result) != nil {
		return shopifyconnector.FulfillmentPublishResult{}, fulfillmentFailure(request, "provider_response_invalid", errors.New("Shopify fulfillment provider response is invalid"))
	}
	return result, nil
}

func fulfillmentFailure(request shopifyconnector.FulfillmentPublishRequest, diagnostic string, cause error) error {
	log.Printf("Shopify connector fulfillment publish failed diagnostic=%s correlation=%s", diagnostic, request.Context.CorrelationID)
	return shopifyconnector.SafeFulfillmentPublishErrorFor(request, cause)
}

func containsFulfillmentScopePair(granted []string) bool {
	return containsAllScopes(granted, []string{
		"read_merchant_managed_fulfillment_orders",
		"write_merchant_managed_fulfillment_orders",
	})
}

func connectionProbeFailure(request shopifyconnector.ConnectionProbeRequest, diagnostic string, cause error) error {
	log.Printf("Shopify connector repository connection probe failed diagnostic=%s correlation=%s", diagnostic, request.Context.CorrelationID)
	return shopifyconnector.SafeErrorFor(request, cause)
}

func (s *Service) Revoke(ctx context.Context, request shopifyconnector.InstallationRevokeRequest) (shopifyconnector.InstallationRevokeResult, error) {
	if err := shopifyconnector.ValidateInstallationRevokeRequest(request); err != nil {
		return shopifyconnector.InstallationRevokeResult{}, shopifyconnector.InvalidInstallationRequestError(request.Identity, request.Context)
	}
	if err := ctx.Err(); err != nil {
		return shopifyconnector.InstallationRevokeResult{}, shopifyconnector.SafeInstallationErrorFor(request.Context, err)
	}
	if s == nil || s.repository == nil {
		return shopifyconnector.InstallationRevokeResult{}, shopifyconnector.SafeInstallationErrorFor(request.Context, errors.New("installation repository unavailable"))
	}
	unlock := s.lockIdentity(request.Identity)
	defer unlock()
	if err := ctx.Err(); err != nil {
		return shopifyconnector.InstallationRevokeResult{}, shopifyconnector.SafeInstallationErrorFor(request.Context, err)
	}
	return s.revokeLocked(ctx, request)
}

func (s *Service) Uninstall(ctx context.Context, request shopifyconnector.InstallationRevokeRequest) (shopifyconnector.InstallationRevokeResult, error) {
	if err := shopifyconnector.ValidateInstallationRevokeRequest(request); err != nil {
		return shopifyconnector.InstallationRevokeResult{}, shopifyconnector.InvalidInstallationRequestError(request.Identity, request.Context)
	}
	if err := ctx.Err(); err != nil {
		return shopifyconnector.InstallationRevokeResult{}, shopifyconnector.SafeInstallationErrorFor(request.Context, err)
	}
	if s == nil || s.repository == nil || s.appUninstaller == nil {
		return shopifyconnector.InstallationRevokeResult{}, shopifyconnector.SafeInstallationErrorFor(request.Context, errors.New("installation uninstaller unavailable"))
	}
	unlock := s.lockIdentity(request.Identity)
	defer unlock()
	if err := ctx.Err(); err != nil {
		return shopifyconnector.InstallationRevokeResult{}, shopifyconnector.SafeInstallationErrorFor(request.Context, err)
	}
	current, err := s.repository.GetInstallation(ctx, request.Identity)
	if errors.Is(err, ErrNotFound) {
		return shopifyconnector.InstallationRevokeResult{}, shopifyconnector.ForbiddenInstallationError(request.Context)
	}
	if err != nil {
		return shopifyconnector.InstallationRevokeResult{}, shopifyconnector.SafeInstallationErrorFor(request.Context, err)
	}
	if current.State == shopifyconnector.InstallationStateInstalled {
		refreshed, accessToken, refreshErr := s.providerAccessToken(ctx, current)
		if refreshErr != nil {
			return shopifyconnector.InstallationRevokeResult{}, shopifyconnector.SafeInstallationErrorFor(request.Context, refreshErr)
		}
		current = refreshed
		uninstallErr := s.appUninstaller.UninstallApp(ctx, current.ShopDomain, accessToken)
		if uninstallErr != nil && !errors.Is(uninstallErr, shopifyconnector.ErrProviderAppNotInstalled) {
			return shopifyconnector.InstallationRevokeResult{}, shopifyconnector.SafeInstallationErrorFor(request.Context, uninstallErr)
		}
	} else if current.State != shopifyconnector.InstallationStateRevoked {
		return shopifyconnector.InstallationRevokeResult{}, shopifyconnector.SafeInstallationErrorFor(request.Context, errors.New("installation state is invalid"))
	}
	return s.revokeLocked(ctx, request)
}

var _ shopifyconnector.InstallationUninstaller = (*Service)(nil)

func (s *Service) revokeLocked(ctx context.Context, request shopifyconnector.InstallationRevokeRequest) (shopifyconnector.InstallationRevokeResult, error) {
	now := s.now().UTC()
	current, currentErr := s.repository.GetInstallation(ctx, request.Identity)
	if errors.Is(currentErr, ErrNotFound) {
		return shopifyconnector.InstallationRevokeResult{},
			shopifyconnector.ForbiddenInstallationError(request.Context)
	}
	if currentErr != nil {
		return shopifyconnector.InstallationRevokeResult{}, shopifyconnector.SafeInstallationErrorFor(request.Context, currentErr)
	}
	record, already, err := s.repository.MarkRevokedAndEnqueue(ctx, request.Identity, now, OutboxEvent{
		ID: "shopify-revocation/" + request.Context.RequestID, Kind: "shopify.installation.revoked",
		Identity: request.Identity, ShopDomain: current.ShopDomain,
		Topic: "app/uninstalled", OccurredAt: now,
	})
	if errors.Is(err, ErrNotFound) {
		return shopifyconnector.InstallationRevokeResult{},
			shopifyconnector.ForbiddenInstallationError(request.Context)
	}
	if err != nil {
		return shopifyconnector.InstallationRevokeResult{}, shopifyconnector.SafeInstallationErrorFor(request.Context, err)
	}
	return s.applyRevocationEffectsLocked(ctx, request, record, already)
}

func (s *Service) applyRevocationEffectsLocked(ctx context.Context, request shopifyconnector.InstallationRevokeRequest, record InstallationRecord, already bool) (shopifyconnector.InstallationRevokeResult, error) {
	if record.EffectsApplied {
		return revokeResult(record, true), nil
	}
	if s.effects == nil {
		return shopifyconnector.InstallationRevokeResult{}, shopifyconnector.SafeInstallationErrorFor(request.Context, errors.New("revocation effects unavailable"))
	}
	if err := s.effects.ApplyRevocation(ctx, RevocationRecord{
		Identity: record.Identity, LegacyShopID: record.LegacyShopID,
		ShopDomain: record.ShopDomain, Context: request.Context,
	}); err != nil {
		return shopifyconnector.InstallationRevokeResult{}, shopifyconnector.SafeInstallationErrorFor(request.Context, err)
	}
	if err := s.repository.MarkRevocationEffectsApplied(ctx, request.Identity, s.now().UTC()); err != nil {
		return shopifyconnector.InstallationRevokeResult{}, shopifyconnector.SafeInstallationErrorFor(request.Context, err)
	}
	record.EffectsApplied = true
	return revokeResult(record, already), nil
}

func (s *Service) lockIdentity(identity shopifyconnector.CanonicalShopIdentity) func() {
	value, _ := s.identityLocks.LoadOrStore(identityKey(identity), &sync.Mutex{})
	lock := value.(*sync.Mutex)
	lock.Lock()
	return lock.Unlock
}

func summary(record InstallationRecord) shopifyconnector.InstallationSummary {
	if record.NativeLinkPending && record.State == shopifyconnector.InstallationStateInstalled {
		record.State = shopifyconnector.InstallationStateNotConfigured
	}
	return shopifyconnector.InstallationSummary{
		ContractVersion: shopifyconnector.InstallationContractVersion,
		TenantID:        record.Identity.TenantID, ShopID: record.Identity.ShopID,
		ShopDomain: record.ShopDomain, ShopName: record.ShopName, State: record.State,
		GrantedScopes: append([]string(nil), record.Scopes...),
		InstalledAt:   record.InstalledAt, UpdatedAt: record.UpdatedAt,
	}
}

func revokeResult(record InstallationRecord, already bool) shopifyconnector.InstallationRevokeResult {
	return shopifyconnector.InstallationRevokeResult{
		ContractVersion: shopifyconnector.InstallationContractVersion,
		TenantID:        record.Identity.TenantID, ShopID: record.Identity.ShopID,
		ShopDomain: record.ShopDomain, InstallationRevoked: true,
		SourceDisabled: true, CachesInvalidated: true, AlreadyRevoked: already,
		RevokedAt: record.RevokedAt,
	}
}

func normalizeScopes(scopes []string) []string {
	result := shopifyconnector.ListUniqueNormalized(scopes)
	sort.Strings(result)
	return result
}

var _ shopifyconnector.ConnectionProbe = (*Service)(nil)
var _ shopifyconnector.ProductCatalogReader = (*Service)(nil)
var _ shopifyconnector.OrderCatalogReader = (*Service)(nil)
var _ shopifyconnector.ReturnCatalogReader = (*Service)(nil)
var _ shopifyconnector.LocationCatalogReader = (*Service)(nil)
var _ shopifyconnector.InventoryLevelReader = (*Service)(nil)
var _ shopifyconnector.DisputeCatalogReader = (*Service)(nil)
var _ shopifyconnector.OrderShippingAddressWriter = (*Service)(nil)
var _ shopifyconnector.FulfillmentPublisher = (*Service)(nil)

func containsAllScopes(granted []string, required []string) bool {
	set := make(map[string]bool, len(granted))
	for _, scope := range granted {
		set[scope] = true
	}
	for _, scope := range required {
		impliedWrite, hasImplication := readScopeImpliedByWrite[scope]
		if !set[scope] && (!hasImplication || !set[impliedWrite]) {
			return false
		}
	}
	return true
}

var readScopeImpliedByWrite = map[string]string{
	"read_products":     "write_products",
	"read_publications": "write_publications",
	"read_inventory":    "write_inventory",
	"read_orders":       "write_orders",
	"read_draft_orders": "write_draft_orders",
	"read_order_edits":  "write_order_edits",
	"read_merchant_managed_fulfillment_orders": "write_merchant_managed_fulfillment_orders",
	"read_shipping":    "write_shipping",
	"read_returns":     "write_returns",
	"read_customers":   "write_customers",
	"read_discounts":   "write_discounts",
	"read_price_rules": "write_price_rules",
	"read_themes":      "write_themes",
}

var _ shopifyconnector.InstallationLifecycle = (*Service)(nil)
