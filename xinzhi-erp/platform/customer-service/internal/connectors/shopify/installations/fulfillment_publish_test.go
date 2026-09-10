package installations

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

type recordingFulfillmentProvider struct {
	calls         int
	domain, token string
	now           time.Time
	err           error
}

type blockingFulfillmentProvider struct {
	started chan struct{}
	release chan struct{}
	now     time.Time
}

func (p *blockingFulfillmentProvider) PublishFulfillment(_ context.Context, _, _ string, request shopifyconnector.FulfillmentPublishRequest) (shopifyconnector.FulfillmentPublishResult, error) {
	close(p.started)
	<-p.release
	return shopifyconnector.FulfillmentPublishResult{
		ContractVersion: shopifyconnector.FulfillmentPublishContractVersion,
		TenantID:        request.Identity.TenantID, ShopID: request.Identity.ShopID,
		OrderID: request.OrderID, FulfillmentIDs: []string{"gid://shopify/Fulfillment/50"},
		Tracking: request.Tracking, UpdatedAt: p.now,
	}, nil
}

func (p *recordingFulfillmentProvider) PublishFulfillment(_ context.Context, domain, token string, request shopifyconnector.FulfillmentPublishRequest) (shopifyconnector.FulfillmentPublishResult, error) {
	p.calls++
	p.domain, p.token = domain, token
	if p.err != nil {
		return shopifyconnector.FulfillmentPublishResult{}, p.err
	}
	return shopifyconnector.FulfillmentPublishResult{
		ContractVersion: shopifyconnector.FulfillmentPublishContractVersion,
		TenantID:        request.Identity.TenantID, ShopID: request.Identity.ShopID,
		OrderID: request.OrderID, FulfillmentIDs: []string{"gid://shopify/Fulfillment/50"},
		Tracking: request.Tracking, UpdatedAt: p.now,
	}, nil
}

func TestServiceFulfillmentPublishUsesConnectorCredentialAndMerchantManagedScopePair(t *testing.T) {
	now := time.Date(2026, 8, 2, 2, 0, 0, 0, time.UTC)
	binding := Binding{Identity: identity(), LegacyShopID: "legacy", ShopDomain: "fulfill.myshopify.com"}
	repository := NewMemoryRepository()
	seedOrderInstallation(t, repository, binding, "shpat_connector_fulfillment", []string{"write_merchant_managed_fulfillment_orders"}, now)
	provider := &recordingFulfillmentProvider{now: now}
	service := NewServiceWithProviders(repository, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, provider)
	result, err := service.PublishFulfillment(t.Context(), fulfillmentPublishRequest("merchant-managed"))
	if err != nil || provider.calls != 1 || provider.domain != binding.ShopDomain || provider.token != "shpat_connector_fulfillment" || result.UpdatedAt != now {
		t.Fatalf("connector-owned merchant fulfillment failed calls=%d domain=%q result=%#v error=%v", provider.calls, provider.domain, result, err)
	}

	for _, scopes := range [][]string{
		{"write_assigned_fulfillment_orders"},
		{"write_third_party_fulfillment_orders"},
		{"read_assigned_fulfillment_orders", "write_orders"},
	} {
		repository := NewMemoryRepository()
		seedOrderInstallation(t, repository, binding, "shpat_unsupported", scopes, now)
		provider := &recordingFulfillmentProvider{now: now}
		service := NewServiceWithProviders(repository, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, provider)
		_, err := service.PublishFulfillment(t.Context(), fulfillmentPublishRequest("unsupported-scope"))
		var safeErr *shopifyconnector.ConnectionProbeError
		if !errors.As(err, &safeErr) || safeErr.Code != shopifyconnector.ErrorCodeForbidden || safeErr.Retryable || provider.calls != 0 {
			t.Fatalf("unsupported fulfillment scope was accepted scopes=%v calls=%d error=%#v", scopes, provider.calls, safeErr)
		}
	}
}

func TestServiceFulfillmentPublishFailsClosedAndRedactsProviderErrors(t *testing.T) {
	now := time.Date(2026, 8, 2, 2, 0, 0, 0, time.UTC)
	binding := Binding{Identity: identity(), LegacyShopID: "legacy", ShopDomain: "fulfill.myshopify.com"}
	repository := NewMemoryRepository()
	seedOrderInstallation(t, repository, binding, "shpat_secret_fulfillment", []string{"write_merchant_managed_fulfillment_orders"}, now)
	request := fulfillmentPublishRequest("provider-error")
	for _, test := range []struct {
		name      string
		err       error
		wantCode  shopifyconnector.ErrorCode
		retryable bool
	}{
		{"invalid", fmtError(shopifyconnector.ErrInvalidFulfillment, "provider userError shpat_secret"), shopifyconnector.ErrorCodeInvalidRequest, false},
		{"forbidden", fmtError(shopifyconnector.ErrProviderAuthorization, "provider auth shpat_secret"), shopifyconnector.ErrorCodeForbidden, false},
		{"unavailable", errors.New("provider raw shpat_secret_fulfillment"), shopifyconnector.ErrorCodeUnavailable, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			provider := &recordingFulfillmentProvider{now: now, err: test.err}
			service := NewServiceWithProviders(repository, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, provider)
			_, err := service.PublishFulfillment(t.Context(), request)
			var safeErr *shopifyconnector.ConnectionProbeError
			if !errors.As(err, &safeErr) || safeErr.Code != test.wantCode || safeErr.Retryable != test.retryable || strings.Contains(err.Error(), "provider") || strings.Contains(err.Error(), "shpat_") {
				t.Fatalf("provider error escaped: %#v %v", safeErr, err)
			}
		})
	}
}

func TestServiceFulfillmentPublishRejectsMissingAndRevokedInstallations(t *testing.T) {
	now := time.Date(2026, 8, 2, 2, 0, 0, 0, time.UTC)
	request := fulfillmentPublishRequest("missing-installation")
	for _, test := range []struct {
		name       string
		repository *MemoryRepository
	}{
		{"missing", NewMemoryRepository()},
		{"revoked", func() *MemoryRepository {
			repository := NewMemoryRepository()
			binding := Binding{Identity: identity(), LegacyShopID: "legacy", ShopDomain: "fulfill.myshopify.com"}
			seedOrderInstallation(t, repository, binding, "shpat_revoked", []string{"write_merchant_managed_fulfillment_orders"}, now)
			if _, _, err := repository.MarkRevoked(t.Context(), identity(), now); err != nil {
				t.Fatal(err)
			}
			return repository
		}()},
	} {
		t.Run(test.name, func(t *testing.T) {
			provider := &recordingFulfillmentProvider{now: now}
			service := NewServiceWithProviders(test.repository, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, provider)
			_, err := service.PublishFulfillment(t.Context(), request)
			var safeErr *shopifyconnector.ConnectionProbeError
			if !errors.As(err, &safeErr) || safeErr.Code != shopifyconnector.ErrorCodeForbidden || safeErr.Retryable || provider.calls != 0 {
				t.Fatalf("installation boundary failed open calls=%d error=%#v", provider.calls, safeErr)
			}
		})
	}
}

func TestHTTPRuntimeServesFulfillmentPublishBehindServiceToken(t *testing.T) {
	now := time.Date(2026, 8, 2, 2, 0, 0, 0, time.UTC)
	repository := NewMemoryRepository()
	binding := Binding{Identity: identity(), LegacyShopID: "legacy", ShopDomain: "fulfill.myshopify.com"}
	scopes := []string{"write_merchant_managed_fulfillment_orders"}
	seedOrderInstallation(t, repository, binding, "shpat_runtime_fulfillment", scopes, now)
	provider := &recordingFulfillmentProvider{now: now}
	service := NewServiceWithProviders(repository, scopes, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, provider)
	handler, err := NewHandler(RuntimeConfig{ServiceToken: "service-token", AppAPIKey: "app-key", AppSecret: "app-secret", Scopes: scopes, CallbackURL: "https://connector.example/shopify/oauth/callback"}, service, repository)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(fulfillmentPublishRequest("runtime-fulfillment"))
	unauthorized := httptest.NewRecorder()
	handler.ServeHTTP(unauthorized, httptest.NewRequest(http.MethodPost, FulfillmentPublishPath, bytes.NewReader(body)))
	if unauthorized.Code != http.StatusForbidden || unauthorized.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("unauthorized status=%d", unauthorized.Code)
	}
	request := httptest.NewRequest(http.MethodPost, FulfillmentPublishPath, bytes.NewReader(body))
	request.Header.Set(ServiceTokenHeader, "service-token")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" || provider.calls != 1 || strings.Contains(response.Body.String(), "shpat_") {
		t.Fatalf("runtime response status=%d calls=%d body=%s", response.Code, provider.calls, response.Body.String())
	}

	for _, malformed := range [][]byte{
		append(append([]byte(nil), body...), []byte(` {}`)...),
		[]byte(strings.TrimSuffix(string(body), "}") + `,"accessToken":"shpat_forbidden"}`),
	} {
		request := httptest.NewRequest(http.MethodPost, FulfillmentPublishPath, bytes.NewReader(malformed))
		request.Header.Set(ServiceTokenHeader, "service-token")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest || response.Header().Get("Cache-Control") != "no-store" || provider.calls != 1 || strings.Contains(response.Body.String(), "shpat_") {
			t.Fatalf("malformed request escaped strict boundary status=%d calls=%d body=%s", response.Code, provider.calls, response.Body.String())
		}
	}
}

func TestFulfillmentPublishSerializesCredentialUseWithRevoke(t *testing.T) {
	now := time.Date(2026, 8, 2, 2, 0, 0, 0, time.UTC)
	repository := NewMemoryRepository()
	binding := Binding{Identity: identity(), LegacyShopID: "legacy", ShopDomain: "fulfill.myshopify.com"}
	seedOrderInstallation(t, repository, binding, "shpat_generation_one", []string{"write_merchant_managed_fulfillment_orders"}, now)
	provider := &blockingFulfillmentProvider{started: make(chan struct{}), release: make(chan struct{}), now: now}
	service := NewServiceWithProviders(repository, nil, &fakeEffects{}, nil, nil, nil, nil, nil, nil, nil, nil, nil, provider)

	publishDone := make(chan error, 1)
	go func() {
		_, err := service.PublishFulfillment(t.Context(), fulfillmentPublishRequest("locked-publish"))
		publishDone <- err
	}()
	select {
	case <-provider.started:
	case <-time.After(2 * time.Second):
		t.Fatal("fulfillment provider did not start")
	}

	revokeDone := make(chan error, 1)
	go func() {
		_, err := service.Revoke(t.Context(), shopifyconnector.InstallationRevokeRequest{
			Identity: identity(), Context: requestContext("locked-revoke"),
		})
		revokeDone <- err
	}()
	select {
	case err := <-revokeDone:
		t.Fatalf("revoke crossed in-flight credential boundary: %v", err)
	case <-time.After(50 * time.Millisecond):
	}

	close(provider.release)
	if err := <-publishDone; err != nil {
		t.Fatalf("serialized publish failed: %v", err)
	}
	select {
	case err := <-revokeDone:
		if err != nil {
			t.Fatalf("serialized revoke failed: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("revoke did not finish after provider released identity lock")
	}
	record, err := repository.GetInstallation(t.Context(), identity())
	if err != nil || record.State != shopifyconnector.InstallationStateRevoked || record.AccessToken != "" {
		t.Fatalf("revoked installation retained credential: record=%#v err=%v", record, err)
	}
}

func fulfillmentPublishRequest(correlation string) shopifyconnector.FulfillmentPublishRequest {
	return shopifyconnector.FulfillmentPublishRequest{
		Identity: identity(), Context: requestContext(correlation), OrderID: "gid://shopify/Order/1",
		IdempotencyKey: "fulfillment-command-1", NotifyCustomer: true,
		Tracking: shopifyconnector.CatalogTrackingInfo{Company: "UPS", Number: "1Z123", URL: "https://track.example/1Z123"},
		Lines:    []shopifyconnector.FulfillmentLineInput{{OrderLineID: "gid://shopify/LineItem/40", Quantity: 2}},
	}
}

func fmtError(cause error, detail string) error {
	return &wrappedTestError{cause: cause, detail: detail}
}

type wrappedTestError struct {
	cause  error
	detail string
}

func (e *wrappedTestError) Error() string { return e.detail }
func (e *wrappedTestError) Unwrap() error { return e.cause }
