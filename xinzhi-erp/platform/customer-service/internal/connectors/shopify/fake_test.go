package shopify

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"
)

const (
	testTenantOne = "11111111-1111-4111-8111-111111111111"
	testTenantTwo = "22222222-2222-4222-8222-222222222222"
	testShopOne   = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
)

func TestFakeAdapterFailsClosedForTenantShopMismatchAndMissingConfiguration(t *testing.T) {
	adapter := mustFakeAdapter(t, FakeScenario{
		Identity:      CanonicalShopIdentity{TenantID: testTenantOne, ShopID: testShopOne},
		State:         ConnectionStateConnected,
		GrantedScopes: []string{"read_orders"},
		CheckedAt:     time.Date(2026, time.July, 30, 1, 0, 0, 0, time.UTC),
	})

	mismatch := probeRequest(testTenantTwo, testShopOne, "corr-mismatch")
	mismatchSummary, err := adapter.ProbeConnection(t.Context(), mismatch)
	if err != nil {
		t.Fatalf("tenant/shop mismatch probe failed: %v", err)
	}
	missing := probeRequest(testTenantOne, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "corr-missing")
	missingSummary, err := adapter.ProbeConnection(t.Context(), missing)
	if err != nil {
		t.Fatalf("missing configuration probe failed: %v", err)
	}
	if mismatchSummary.State != ConnectionStateNotConfigured ||
		missingSummary.State != ConnectionStateNotConfigured {
		t.Fatalf("mismatch and missing configuration must fail closed: mismatch=%#v missing=%#v", mismatchSummary, missingSummary)
	}
	if len(mismatchSummary.GrantedScopes) != 0 || len(missingSummary.GrantedScopes) != 0 {
		t.Fatalf("unmapped identities must not expose granted scopes: mismatch=%#v missing=%#v", mismatchSummary, missingSummary)
	}
}

func TestFakeAdapterReturnsAllowlistedConnectedSummary(t *testing.T) {
	checkedAt := time.Date(2026, time.July, 30, 8, 9, 10, 0, time.FixedZone("fixture", 8*60*60))
	adapter := mustFakeAdapter(t, FakeScenario{
		Identity:      CanonicalShopIdentity{TenantID: testTenantOne, ShopID: testShopOne},
		State:         ConnectionStateConnected,
		CheckedAt:     checkedAt,
		GrantedScopes: []string{"write_orders", "read_orders", "read_orders"},
	})
	request := probeRequest(testTenantOne, testShopOne, "corr-connected")

	summary, err := adapter.ProbeConnection(t.Context(), request)
	if err != nil {
		t.Fatalf("connected probe failed: %v", err)
	}
	if summary.ContractVersion != ContractVersion ||
		summary.TenantID != testTenantOne ||
		summary.ShopID != testShopOne ||
		summary.State != ConnectionStateConnected {
		t.Fatalf("unexpected connected summary: %#v", summary)
	}
	if got := strings.Join(summary.GrantedScopes, ","); got != "read_orders,write_orders" {
		t.Fatalf("expected normalized granted scopes, got %q", got)
	}
	if !summary.CheckedAt.Equal(checkedAt.UTC()) ||
		summary.CheckedAt.Location() != time.UTC {
		t.Fatalf("checkedAt must be normalized to UTC, got %v", summary.CheckedAt)
	}

	encoded, err := json.Marshal(summary)
	if err != nil {
		t.Fatalf("marshal summary: %v", err)
	}
	for _, forbidden := range []string{"token", "credential", "providerPayload", "shopDomain"} {
		if strings.Contains(strings.ToLower(string(encoded)), strings.ToLower(forbidden)) {
			t.Fatalf("allowlisted summary leaked forbidden field %q: %s", forbidden, encoded)
		}
	}
}

func TestFakeAdapterRedactsProviderFailure(t *testing.T) {
	adapter := mustFakeAdapter(t, FakeScenario{
		Identity: CanonicalShopIdentity{TenantID: testTenantOne, ShopID: testShopOne},
		State:    ConnectionStateConnected,
		ProviderFailure: errors.New(
			"provider raw payload included private material fixture-secret for demo.myshopify.com",
		),
	})
	request := probeRequest(testTenantOne, testShopOne, "corr-provider")

	_, err := adapter.ProbeConnection(t.Context(), request)
	var safeErr *ConnectionProbeError
	if !errors.As(err, &safeErr) {
		t.Fatalf("expected safe connector error, got %T %v", err, err)
	}
	if safeErr.Code != ErrorCodeUnavailable || !safeErr.Retryable ||
		safeErr.CorrelationID != request.Context.CorrelationID {
		t.Fatalf("unexpected safe error: %#v", safeErr)
	}
	encoded, marshalErr := json.Marshal(safeErr)
	if marshalErr != nil {
		t.Fatalf("marshal safe error: %v", marshalErr)
	}
	for _, forbidden := range []string{"fixture-secret", "demo.myshopify.com", "provider raw"} {
		if strings.Contains(string(encoded), forbidden) || strings.Contains(err.Error(), forbidden) {
			t.Fatalf("safe error leaked provider detail %q: %s", forbidden, encoded)
		}
	}
}

func TestFakeAdapterMapsCancellationAndTimeoutWithoutNetwork(t *testing.T) {
	adapter := mustFakeAdapter(t)
	request := probeRequest(testTenantOne, testShopOne, "corr-context")

	canceledContext, cancel := context.WithCancel(t.Context())
	cancel()
	_, err := adapter.ProbeConnection(canceledContext, request)
	assertProbeErrorCode(t, err, ErrorCodeCanceled)

	expiredContext, expiredCancel := context.WithDeadline(t.Context(), time.Unix(1, 0))
	defer expiredCancel()
	_, err = adapter.ProbeConnection(expiredContext, request)
	assertProbeErrorCode(t, err, ErrorCodeTimeout)
}

func TestFakeAdapterRepeatedCorrelationIsIdempotentRead(t *testing.T) {
	adapter := mustFakeAdapter(t, FakeScenario{
		Identity:  CanonicalShopIdentity{TenantID: testTenantOne, ShopID: testShopOne},
		State:     ConnectionStateDisconnected,
		CheckedAt: time.Date(2026, time.July, 30, 1, 2, 3, 0, time.UTC),
	})
	request := probeRequest(testTenantOne, testShopOne, "corr-repeat")

	first, err := adapter.ProbeConnection(t.Context(), request)
	if err != nil {
		t.Fatalf("first repeated probe failed: %v", err)
	}
	second, err := adapter.ProbeConnection(t.Context(), request)
	if err != nil {
		t.Fatalf("second repeated probe failed: %v", err)
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("repeated read changed result: first=%#v second=%#v", first, second)
	}
}

func TestFakeAdapterRejectsNonCanonicalIdentityAndContext(t *testing.T) {
	adapter := mustFakeAdapter(t)
	tests := []ConnectionProbeRequest{
		probeRequest(testTenantOne, strings.ToUpper(testShopOne), "corr-invalid-shop-case"),
		probeRequest(testTenantOne, "not-a-uuid", "corr-invalid-shop"),
		{
			Identity: CanonicalShopIdentity{TenantID: testTenantOne, ShopID: testShopOne},
			Context:  RequestContext{CorrelationID: "contains space", RequestID: "request-1"},
		},
	}
	for _, request := range tests {
		_, err := adapter.ProbeConnection(t.Context(), request)
		assertProbeErrorCode(t, err, ErrorCodeInvalidRequest)
	}
}

func mustFakeAdapter(t *testing.T, scenarios ...FakeScenario) *FakeAdapter {
	t.Helper()
	adapter, err := NewFakeAdapter(scenarios...)
	if err != nil {
		t.Fatalf("NewFakeAdapter failed: %v", err)
	}
	return adapter
}

func probeRequest(tenantID string, shopID string, correlationID string) ConnectionProbeRequest {
	return ConnectionProbeRequest{
		Identity: CanonicalShopIdentity{TenantID: tenantID, ShopID: shopID},
		Context: RequestContext{
			CorrelationID: correlationID,
			RequestID:     "request-1",
		},
	}
}

func assertProbeErrorCode(t *testing.T, err error, expected ErrorCode) {
	t.Helper()
	var safeErr *ConnectionProbeError
	if !errors.As(err, &safeErr) {
		t.Fatalf("expected connector error %s, got %T %v", expected, err, err)
	}
	if safeErr.Code != expected {
		t.Fatalf("expected connector error %s, got %#v", expected, safeErr)
	}
}
