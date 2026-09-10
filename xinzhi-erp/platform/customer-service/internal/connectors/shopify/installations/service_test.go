package installations

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

const (
	testTenantID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	testShopID   = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
)

type fakeEffects struct {
	calls int
	err   error
}

type fakeExchanger struct {
	result OAuthExchangeResult
	err    error
}

type fakeShopIdentityProvider struct {
	identity shopifyconnector.ShopIdentity
	err      error
}

type fakeInstallationAppDataConfigurer struct {
	domain      string
	accessToken string
	identity    shopifyconnector.CanonicalShopIdentity
	err         error
}

type fakeAppUninstaller struct {
	domain      string
	accessToken string
	err         error
}

func (u *fakeAppUninstaller) UninstallApp(
	_ context.Context, domain string, accessToken string,
) error {
	u.domain = domain
	u.accessToken = accessToken
	return u.err
}

func (c *fakeInstallationAppDataConfigurer) ConfigureInstallationAppData(
	_ context.Context,
	domain string,
	accessToken string,
	identity shopifyconnector.CanonicalShopIdentity,
) error {
	c.domain = domain
	c.accessToken = accessToken
	c.identity = identity
	return c.err
}

func (p fakeShopIdentityProvider) FetchShopIdentity(
	context.Context, string, string,
) (shopifyconnector.ShopIdentity, error) {
	return p.identity, p.err
}

type countingExchanger struct {
	calls  atomic.Int32
	result OAuthExchangeResult
}

func (e *countingExchanger) ExchangeOAuthCode(context.Context, string, string) (OAuthExchangeResult, error) {
	e.calls.Add(1)
	return e.result, nil
}

type blockingEffects struct {
	started chan struct{}
	release chan struct{}
}

func (e *blockingEffects) ApplyRevocation(context.Context, RevocationRecord) error {
	close(e.started)
	<-e.release
	return nil
}

func (f fakeExchanger) ExchangeOAuthCode(context.Context, string, string) (OAuthExchangeResult, error) {
	return f.result, f.err
}

func (f *fakeEffects) ApplyRevocation(context.Context, RevocationRecord) error {
	f.calls++
	return f.err
}

func TestCompleteOAuthStoresTokenInsideConnectorAndReturnsOnlySafeMetadata(t *testing.T) {
	repository := NewMemoryRepository()
	service := NewService(repository, []string{"read_orders", "write_orders"}, nil, fakeExchanger{result: OAuthExchangeResult{
		AccessToken: "shpat_connector_secret", Scopes: []string{"write_orders", "read_orders"},
	}})
	result, err := service.CompleteOAuth(t.Context(), shopifyconnector.CompleteOAuthRequest{
		Identity:          identity(),
		Context:           requestContext("complete"),
		LegacyShopID:      "legacy-shop",
		ShopDomain:        "Demo.MyShopify.com",
		AuthorizationCode: "authorization-code",
	})
	if err != nil {
		t.Fatalf("CompleteOAuth failed: %v", err)
	}
	if result.ShopDomain != "demo.myshopify.com" || result.State != shopifyconnector.InstallationStateInstalled {
		t.Fatalf("unexpected safe result: %#v", result)
	}
	stored, err := repository.GetInstallation(t.Context(), identity())
	if err != nil {
		t.Fatalf("GetInstallation failed: %v", err)
	}
	if stored.AccessToken != "shpat_connector_secret" {
		t.Fatalf("connector repository did not retain provider token")
	}
	if strings.Contains(result.String(), "shpat_connector_secret") {
		t.Fatalf("safe result leaked provider token: %s", result.String())
	}
	resolved, err := repository.ResolveCanonicalIdentity(t.Context(), "legacy-shop")
	if err != nil || resolved != identity() {
		t.Fatalf("reverse binding mismatch: identity=%#v err=%v", resolved, err)
	}
}

func TestCompleteOAuthConfiguresStorefrontAppDataBeforeSavingInstallation(t *testing.T) {
	repository := NewMemoryRepository()
	service := NewService(repository, []string{"read_orders"}, nil, fakeExchanger{result: OAuthExchangeResult{
		AccessToken: "shpat_connector_secret", Scopes: []string{"read_orders"},
	}})
	configurer := &fakeInstallationAppDataConfigurer{}
	if err := service.ConfigureInstallationAppData(configurer); err != nil {
		t.Fatal(err)
	}
	_, err := service.CompleteOAuth(t.Context(), shopifyconnector.CompleteOAuthRequest{
		Identity: identity(), Context: requestContext("app-data"), LegacyShopID: "legacy-shop",
		ShopDomain: "demo.myshopify.com", AuthorizationCode: "authorization-code",
	})
	if err != nil {
		t.Fatalf("CompleteOAuth failed: %v", err)
	}
	if configurer.domain != "demo.myshopify.com" || configurer.accessToken != "shpat_connector_secret" ||
		configurer.identity != identity() {
		t.Fatalf("unexpected app-data configuration call: %#v", configurer)
	}

	failedRepository := NewMemoryRepository()
	failedService := NewService(failedRepository, []string{"read_orders"}, nil, fakeExchanger{result: OAuthExchangeResult{
		AccessToken: "shpat_connector_secret", Scopes: []string{"read_orders"},
	}})
	if err := failedService.ConfigureInstallationAppData(&fakeInstallationAppDataConfigurer{err: errors.New("provider secret detail")}); err != nil {
		t.Fatal(err)
	}
	_, err = failedService.CompleteOAuth(t.Context(), shopifyconnector.CompleteOAuthRequest{
		Identity: identity(), Context: requestContext("app-data-fail"), LegacyShopID: "legacy-shop",
		ShopDomain: "demo.myshopify.com", AuthorizationCode: "authorization-code",
	})
	if err == nil || strings.Contains(err.Error(), "provider secret detail") || strings.Contains(err.Error(), "shpat_connector_secret") {
		t.Fatalf("unsafe app-data failure: %v", err)
	}
	if _, getErr := failedRepository.GetInstallation(t.Context(), identity()); !errors.Is(getErr, ErrNotFound) {
		t.Fatalf("failed app-data configuration persisted an installation: %v", getErr)
	}
}

func TestCompleteOAuthStoresVerifiedShopIdentityForERPProjection(t *testing.T) {
	repository := NewMemoryRepository()
	service := NewService(repository, []string{"read_orders"}, nil, fakeExchanger{
		result: OAuthExchangeResult{
			AccessToken: "shpat_connector_secret", Scopes: []string{"read_orders"},
		},
	})
	service.shopIdentity = fakeShopIdentityProvider{identity: shopifyconnector.ShopIdentity{
		Name: "Example Store", MyshopifyDomain: "demo.myshopify.com",
	}}

	result, err := service.CompleteOAuth(t.Context(), shopifyconnector.CompleteOAuthRequest{
		Identity: identity(), Context: requestContext("shop-identity"),
		LegacyShopID: "legacy-shop", ShopDomain: "demo.myshopify.com",
		AuthorizationCode: "authorization-code",
	})
	if err != nil {
		t.Fatalf("CompleteOAuth failed: %v", err)
	}
	if result.ShopName != "Example Store" || result.ShopDomain != "demo.myshopify.com" {
		t.Fatalf("safe shop identity was not returned: %#v", result)
	}
	connected, err := service.ProbeConnection(t.Context(), shopifyconnector.ConnectionProbeRequest{
		Identity: identity(), Context: requestContext("shop-identity-probe"),
	})
	if err != nil || connected.ShopName != "Example Store" ||
		connected.ShopDomain != "demo.myshopify.com" {
		t.Fatalf("shop identity was not projected into connection summary: %#v err=%v", connected, err)
	}
}

func TestCompleteOAuthRejectsMismatchedShopIdentityWithoutSavingToken(t *testing.T) {
	repository := NewMemoryRepository()
	service := NewService(repository, nil, nil, fakeExchanger{result: OAuthExchangeResult{
		AccessToken: "shpat_connector_secret", Scopes: []string{"read_orders"},
	}})
	service.shopIdentity = fakeShopIdentityProvider{identity: shopifyconnector.ShopIdentity{
		Name: "Other Store", MyshopifyDomain: "other.myshopify.com",
	}}

	_, err := service.CompleteOAuth(t.Context(), shopifyconnector.CompleteOAuthRequest{
		Identity: identity(), Context: requestContext("shop-identity-mismatch"),
		LegacyShopID: "legacy-shop", ShopDomain: "demo.myshopify.com",
		AuthorizationCode: "authorization-code",
	})
	if err == nil {
		t.Fatal("mismatched Shopify identity was accepted")
	}
	if _, getErr := repository.GetInstallation(t.Context(), identity()); !errors.Is(getErr, ErrNotFound) {
		t.Fatalf("failed identity verification persisted a token: %v", getErr)
	}
}

func TestSensitiveConnectorDiagnosticsAreRedacted(t *testing.T) {
	values := []struct {
		value   any
		secrets []string
	}{
		{OAuthExchangeResult{AccessToken: "shpat_exchange_secret", Scopes: []string{"read_orders"}}, []string{"shpat_exchange_secret"}},
		{RuntimeConfig{ServiceToken: "service-token-secret", AppAPIKey: "safe-app-key", AppSecret: "app-secret-value", CallbackURL: "https://connector.example/callback"}, []string{"service-token-secret", "app-secret-value"}},
		{OAuthStartResult{ContractVersion: shopifyconnector.InstallationContractVersion, AuthorizationURL: "https://connector.example/shopify/oauth/authorize?grant=grant-secret"}, []string{"grant-secret"}},
		{InstallationRecord{AccessToken: "shpat_record_secret", Binding: Binding{Identity: identity(), ShopDomain: "demo.myshopify.com"}}, []string{"shpat_record_secret"}},
		{OAuthGrant{ID: "grant-secret", BrowserNonceHash: strings.Repeat("a", 64), Identity: identity(), ShopDomain: "demo.myshopify.com"}, []string{"grant-secret", strings.Repeat("a", 64)}},
	}
	for _, item := range values {
		formatted := fmt.Sprintf("%#v", item.value)
		for _, secret := range item.secrets {
			if strings.Contains(formatted, secret) {
				t.Fatalf("diagnostic leaked %q: %s", secret, formatted)
			}
		}
	}
}

func TestCompleteOAuthRejectsMissingScopeWithoutSavingInstallation(t *testing.T) {
	repository := NewMemoryRepository()
	service := NewService(repository, []string{"read_orders", "write_orders"}, nil, fakeExchanger{result: OAuthExchangeResult{
		AccessToken: "shpat_secret", Scopes: []string{"read_orders"},
	}})
	_, err := service.CompleteOAuth(t.Context(), shopifyconnector.CompleteOAuthRequest{
		Identity: identity(), Context: requestContext("scope"), LegacyShopID: "legacy-shop",
		ShopDomain: "demo.myshopify.com", AuthorizationCode: "authorization-code",
	})
	if err == nil {
		t.Fatal("missing required scope was accepted")
	}
	var safeErr *shopifyconnector.ConnectionProbeError
	if !errors.As(err, &safeErr) || safeErr.Code != shopifyconnector.ErrorCodeForbidden {
		t.Fatalf("expected safe forbidden error, got %T %v", err, err)
	}
	if _, getErr := repository.GetInstallation(t.Context(), identity()); !errors.Is(getErr, ErrNotFound) {
		t.Fatalf("failed OAuth completion saved installation: %v", getErr)
	}
}

func TestCompleteOAuthAcceptsOnlyExplicitWriteToReadScopeImplications(t *testing.T) {
	repository := NewMemoryRepository()
	service := NewService(repository, []string{"read_orders", "write_orders"}, nil, fakeExchanger{result: OAuthExchangeResult{
		AccessToken: "shpat_secret", Scopes: []string{"write_orders"},
	}})
	_, err := service.CompleteOAuth(t.Context(), shopifyconnector.CompleteOAuthRequest{
		Identity: identity(), Context: requestContext("implied-scope"), LegacyShopID: "legacy-shop",
		ShopDomain: "demo.myshopify.com", AuthorizationCode: "authorization-code",
	})
	if err != nil {
		t.Fatalf("write_orders must imply read_orders: %v", err)
	}

	otherRepository := NewMemoryRepository()
	otherService := NewService(otherRepository, []string{"read_orders"}, nil, fakeExchanger{result: OAuthExchangeResult{
		AccessToken: "shpat_secret", Scopes: []string{"write_products"},
	}})
	_, err = otherService.CompleteOAuth(t.Context(), shopifyconnector.CompleteOAuthRequest{
		Identity: identity(), Context: requestContext("unrelated-scope"), LegacyShopID: "legacy-shop",
		ShopDomain: "demo.myshopify.com", AuthorizationCode: "authorization-code",
	})
	var safeErr *shopifyconnector.ConnectionProbeError
	if !errors.As(err, &safeErr) || safeErr.Code != shopifyconnector.ErrorCodeForbidden {
		t.Fatalf("unrelated write scope satisfied read_orders: %T %v", err, err)
	}
}

func TestDeclaredWriteScopeImplicationsAreExact(t *testing.T) {
	for readScope, writeScope := range readScopeImpliedByWrite {
		if !containsAllScopes([]string{writeScope}, []string{readScope}) {
			t.Fatalf("declared implication %s -> %s was not honored", writeScope, readScope)
		}
		if containsAllScopes([]string{writeScope + "_other"}, []string{readScope}) {
			t.Fatalf("unrelated scope unexpectedly implied %s", readScope)
		}
	}
	if containsAllScopes([]string{"write_unknown"}, []string{"read_unknown"}) {
		t.Fatal("undeclared write scope implied an unrelated read scope")
	}
}

func TestBindingConflictsFailClosedInBothDirections(t *testing.T) {
	repository := NewMemoryRepository()
	if err := repository.SaveBinding(t.Context(), Binding{Identity: identity(), LegacyShopID: "legacy-one", ShopDomain: "one.myshopify.com"}); err != nil {
		t.Fatalf("save initial binding: %v", err)
	}
	conflicts := []Binding{
		{Identity: identity(), LegacyShopID: "legacy-two", ShopDomain: "two.myshopify.com"},
		{Identity: shopifyconnector.CanonicalShopIdentity{TenantID: testTenantID, ShopID: "cccccccc-cccc-4ccc-8ccc-cccccccccccc"}, LegacyShopID: "legacy-one", ShopDomain: "two.myshopify.com"},
		{Identity: shopifyconnector.CanonicalShopIdentity{TenantID: testTenantID, ShopID: "dddddddd-dddd-4ddd-8ddd-dddddddddddd"}, LegacyShopID: "legacy-three", ShopDomain: "one.myshopify.com"},
	}
	for _, conflict := range conflicts {
		if err := repository.SaveBinding(t.Context(), conflict); !errors.Is(err, ErrBindingConflict) {
			t.Fatalf("binding conflict accepted: %#v err=%v", conflict, err)
		}
	}
}

func TestRepositoryRejectsInvalidBindingDomainAtRestoreBoundary(t *testing.T) {
	repository := NewMemoryRepository()
	err := repository.SaveBinding(t.Context(), Binding{
		Identity: identity(), LegacyShopID: "legacy-shop", ShopDomain: "evil.demo.myshopify.com",
	})
	if !errors.Is(err, ErrInvalidBinding) {
		t.Fatalf("invalid restored binding accepted: %v", err)
	}
}

func TestRepositoryRejectsOAuthGrantThatConflictsWithExistingBinding(t *testing.T) {
	repository := NewMemoryRepository()
	if err := repository.SaveBinding(t.Context(), Binding{
		Identity: identity(), LegacyShopID: "legacy-one", ShopDomain: "one.myshopify.com",
	}); err != nil {
		t.Fatalf("SaveBinding failed: %v", err)
	}
	err := repository.CreateOAuthGrant(t.Context(), OAuthGrant{
		ID: strings.Repeat("A", 43), Identity: identity(), Context: requestContext("conflicting-grant"),
		LegacyShopID: "legacy-two", ShopDomain: "two.myshopify.com", ExpiresAt: time.Now().UTC().Add(time.Minute),
	})
	if !errors.Is(err, ErrBindingConflict) {
		t.Fatalf("conflicting OAuth grant was accepted: %v", err)
	}
}

func TestRevokeRetriesEffectsAndIsIdempotentWithoutRestoringToken(t *testing.T) {
	repository := NewMemoryRepository()
	effects := &fakeEffects{err: errors.New("customer service unavailable: shpat_must_not_escape")}
	service := NewService(repository, nil, effects, fakeExchanger{result: OAuthExchangeResult{
		AccessToken: "shpat_secret", Scopes: []string{"read_orders"},
	}})
	_, err := service.CompleteOAuth(t.Context(), shopifyconnector.CompleteOAuthRequest{
		Identity: identity(), Context: requestContext("complete"), LegacyShopID: "legacy-shop",
		ShopDomain: "demo.myshopify.com", AuthorizationCode: "authorization-code",
	})
	if err != nil {
		t.Fatalf("CompleteOAuth failed: %v", err)
	}

	request := shopifyconnector.InstallationRevokeRequest{Identity: identity(), Context: requestContext("revoke")}
	if _, err := service.Revoke(t.Context(), request); err == nil || strings.Contains(err.Error(), "shpat_") {
		t.Fatalf("expected sanitized retryable revoke error, got %v", err)
	}
	stored, err := repository.GetInstallation(t.Context(), identity())
	if err != nil || stored.State != shopifyconnector.InstallationStateRevoked || stored.AccessToken != "" {
		t.Fatalf("failed effects must leave token revoked: record=%#v err=%v", stored, err)
	}

	effects.err = nil
	result, err := service.Revoke(t.Context(), request)
	if err != nil {
		t.Fatalf("retry revoke failed: %v", err)
	}
	if !result.InstallationRevoked || !result.SourceDisabled || !result.CachesInvalidated || !result.AlreadyRevoked {
		t.Fatalf("unexpected retry result: %#v", result)
	}
	result, err = service.Revoke(t.Context(), request)
	if err != nil || !result.AlreadyRevoked || effects.calls != 2 {
		t.Fatalf("completed revoke was not idempotent: result=%#v calls=%d err=%v", result, effects.calls, err)
	}
}

func TestUninstallConfirmsProviderRemovalBeforeRevokingLocalCredential(t *testing.T) {
	for name, providerErr := range map[string]error{
		"removed":        nil,
		"already absent": shopifyconnector.ErrProviderAppNotInstalled,
	} {
		t.Run(name, func(t *testing.T) {
			repository := NewMemoryRepository()
			effects := &fakeEffects{}
			service := NewService(repository, []string{"read_orders"}, effects, fakeExchanger{result: OAuthExchangeResult{
				AccessToken: "shpat_secret", Scopes: []string{"read_orders"},
			}})
			uninstaller := &fakeAppUninstaller{err: providerErr}
			if err := service.ConfigureInstallationUninstaller(uninstaller); err != nil {
				t.Fatal(err)
			}
			if _, err := service.CompleteOAuth(t.Context(), shopifyconnector.CompleteOAuthRequest{
				Identity: identity(), Context: requestContext("complete-uninstall"), LegacyShopID: "legacy-shop",
				ShopDomain: "demo.myshopify.com", AuthorizationCode: "authorization-code",
			}); err != nil {
				t.Fatal(err)
			}

			result, err := service.Uninstall(t.Context(), shopifyconnector.InstallationRevokeRequest{
				Identity: identity(), Context: requestContext("uninstall"),
			})
			if err != nil || !result.InstallationRevoked || effects.calls != 1 {
				t.Fatalf("unexpected uninstall result=%#v effects=%d err=%v", result, effects.calls, err)
			}
			stored, err := repository.GetInstallation(t.Context(), identity())
			if err != nil || stored.State != shopifyconnector.InstallationStateRevoked || stored.AccessToken != "" {
				t.Fatalf("local credential was not revoked: record=%#v err=%v", stored, err)
			}
			if uninstaller.domain != "demo.myshopify.com" || uninstaller.accessToken != "shpat_secret" {
				t.Fatalf("unexpected provider uninstall call: %#v", uninstaller)
			}
		})
	}
}

func TestUninstallKeepsLocalCredentialWhenProviderAuthorizationFails(t *testing.T) {
	repository := NewMemoryRepository()
	service := NewService(repository, []string{"read_orders"}, &fakeEffects{}, fakeExchanger{result: OAuthExchangeResult{
		AccessToken: "shpat_secret", Scopes: []string{"read_orders"},
	}})
	if err := service.ConfigureInstallationUninstaller(&fakeAppUninstaller{
		err: shopifyconnector.ErrProviderAuthorization,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.CompleteOAuth(t.Context(), shopifyconnector.CompleteOAuthRequest{
		Identity: identity(), Context: requestContext("complete-auth-failure"), LegacyShopID: "legacy-shop",
		ShopDomain: "demo.myshopify.com", AuthorizationCode: "authorization-code",
	}); err != nil {
		t.Fatal(err)
	}

	if _, err := service.Uninstall(t.Context(), shopifyconnector.InstallationRevokeRequest{
		Identity: identity(), Context: requestContext("uninstall-auth-failure"),
	}); err == nil {
		t.Fatal("provider authorization failure was reported as a successful uninstall")
	}
	stored, err := repository.GetInstallation(t.Context(), identity())
	if err != nil || stored.State != shopifyconnector.InstallationStateInstalled || stored.AccessToken != "shpat_secret" {
		t.Fatalf("provider failure destroyed local recovery state: record=%#v err=%v", stored, err)
	}
}

func TestRevokeMissingConnectorInstallationFailsClosedWithoutClaimingLegacyEffects(t *testing.T) {
	repository := NewMemoryRepository()
	effects := &fakeEffects{}
	service := NewService(repository, nil, effects, fakeExchanger{})
	result, err := service.Revoke(t.Context(), shopifyconnector.InstallationRevokeRequest{
		Identity: identity(), Context: requestContext("missing-revoke"),
	})
	if err == nil {
		t.Fatalf("missing connector installation reported success: %#v", result)
	}
	var safeErr *shopifyconnector.ConnectionProbeError
	if !errors.As(err, &safeErr) || safeErr.Code != shopifyconnector.ErrorCodeForbidden || safeErr.Retryable {
		t.Fatalf("missing installation did not fail closed safely: result=%#v err=%T %v", result, err, err)
	}
	if result.InstallationRevoked || result.SourceDisabled || result.CachesInvalidated || effects.calls != 0 {
		t.Fatalf("missing installation claimed unverified effects: result=%#v calls=%d", result, effects.calls)
	}
}

func TestRevokeSerializesCompleteOAuthAndKeepsGenerationMarkersSeparate(t *testing.T) {
	repository := NewMemoryRepository()
	effects := &blockingEffects{started: make(chan struct{}), release: make(chan struct{})}
	exchanger := &countingExchanger{result: OAuthExchangeResult{
		AccessToken: "shpat_initial", Scopes: []string{"read_orders"},
	}}
	service := NewService(repository, []string{"read_orders"}, effects, exchanger)
	completeRequest := shopifyconnector.CompleteOAuthRequest{
		Identity: identity(), Context: requestContext("initial-install"), LegacyShopID: "legacy-shop",
		ShopDomain: "demo.myshopify.com", AuthorizationCode: "initial-code",
	}
	if _, err := service.CompleteOAuth(t.Context(), completeRequest); err != nil {
		t.Fatalf("initial CompleteOAuth failed: %v", err)
	}

	type revokeOutcome struct {
		result shopifyconnector.InstallationRevokeResult
		err    error
	}
	revokeDone := make(chan revokeOutcome, 1)
	go func() {
		result, err := service.Revoke(t.Context(), shopifyconnector.InstallationRevokeRequest{
			Identity: identity(), Context: requestContext("concurrent-revoke"),
		})
		revokeDone <- revokeOutcome{result: result, err: err}
	}()
	select {
	case <-effects.started:
	case <-time.After(2 * time.Second):
		t.Fatal("revoke did not reach controlled effects boundary")
	}

	completeRequest.Context = requestContext("concurrent-complete")
	completeRequest.AuthorizationCode = "replacement-code"
	exchanger.result.AccessToken = "shpat_replacement"
	type completeOutcome struct {
		result shopifyconnector.InstallationSummary
		err    error
	}
	completeDone := make(chan completeOutcome, 1)
	go func() {
		result, err := service.CompleteOAuth(t.Context(), completeRequest)
		completeDone <- completeOutcome{result: result, err: err}
	}()
	select {
	case outcome := <-completeDone:
		t.Fatalf("CompleteOAuth crossed in-flight revoke boundary: result=%#v err=%v", outcome.result, outcome.err)
	case <-time.After(50 * time.Millisecond):
	}
	close(effects.release)

	var revoke revokeOutcome
	select {
	case revoke = <-revokeDone:
	case <-time.After(2 * time.Second):
		t.Fatal("revoke did not complete after effects release")
	}
	if revoke.err != nil || !revoke.result.InstallationRevoked || !revoke.result.SourceDisabled || !revoke.result.CachesInvalidated {
		t.Fatalf("revoke result was inconsistent: result=%#v err=%v", revoke.result, revoke.err)
	}
	var complete completeOutcome
	select {
	case complete = <-completeDone:
	case <-time.After(2 * time.Second):
		t.Fatal("serialized CompleteOAuth did not finish")
	}
	if complete.err != nil || complete.result.State != shopifyconnector.InstallationStateInstalled {
		t.Fatalf("serialized post-revoke CompleteOAuth failed: result=%#v err=%v", complete.result, complete.err)
	}
	stored, err := repository.GetInstallation(t.Context(), identity())
	if err != nil || stored.State != shopifyconnector.InstallationStateInstalled || stored.AccessToken != "shpat_replacement" || stored.EffectsApplied {
		t.Fatalf("concurrent lifecycle left inconsistent record: %#v err=%v", stored, err)
	}
	if calls := exchanger.calls.Load(); calls != 2 {
		t.Fatalf("serialized replacement exchange count mismatch: calls=%d", calls)
	}
}

func identity() shopifyconnector.CanonicalShopIdentity {
	return shopifyconnector.CanonicalShopIdentity{TenantID: testTenantID, ShopID: testShopID}
}

func requestContext(suffix string) shopifyconnector.RequestContext {
	return shopifyconnector.RequestContext{CorrelationID: "corr-" + suffix, RequestID: "request-" + suffix}
}
