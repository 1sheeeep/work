package connectorclient

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const (
	testTenantID = "11111111-1111-4111-8111-111111111111"
	testShopID   = "22222222-2222-4222-8222-222222222222"
)

func TestNewRequiresSafeEndpointAndToken(t *testing.T) {
	t.Parallel()
	tests := []Config{
		{BaseURL: "http://connector.example", ServiceToken: "token"},
		{BaseURL: "https://connector.example", ServiceToken: ""},
		{BaseURL: "https://user:secret@connector.example", ServiceToken: "token"},
	}
	for _, test := range tests {
		if _, err := New(test); err == nil {
			t.Fatalf("expected config to be rejected: %#v", test)
		}
	}
}

func TestProbeConnectionUsesScopedAuthenticatedContract(t *testing.T) {
	t.Parallel()
	checkedAt := time.Date(2026, 8, 6, 10, 0, 0, 0, time.UTC)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != ConnectionProbePath {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get(serviceTokenHeader) != "service-token" {
			t.Fatal("service token header was not forwarded")
		}
		var request ScopedRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if request.Identity.TenantID != testTenantID || request.Identity.ShopID != testShopID {
			t.Fatalf("unexpected identity: %#v", request.Identity)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(ConnectionSummary{
			ContractVersion: ConnectionContractVersion,
			TenantID:        testTenantID,
			ShopID:          testShopID,
			State:           ConnectionStateConnected,
			GrantedScopes:   []string{"read_orders", "read_returns"},
			CheckedAt:       checkedAt,
		})
	}))
	defer server.Close()

	client, err := New(Config{BaseURL: server.URL, ServiceToken: "service-token"})
	if err != nil {
		t.Fatalf("new client: %v", err)
	}
	response, err := client.ProbeConnection(context.Background(), validScopedRequest())
	if err != nil {
		t.Fatalf("probe connection: %v", err)
	}
	if response.CheckedAt != checkedAt || response.State != ConnectionStateConnected {
		t.Fatalf("unexpected response: %#v", response)
	}
}

func TestProbeConnectionRejectsCrossTenantResponse(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(ConnectionSummary{
			ContractVersion: ConnectionContractVersion,
			TenantID:        "33333333-3333-4333-8333-333333333333",
			ShopID:          testShopID,
			State:           ConnectionStateConnected,
			GrantedScopes:   []string{"read_orders"},
			CheckedAt:       time.Now().UTC(),
		})
	}))
	defer server.Close()
	client, err := New(Config{BaseURL: server.URL, ServiceToken: "service-token"})
	if err != nil {
		t.Fatalf("new client: %v", err)
	}
	_, err = client.ProbeConnection(context.Background(), validScopedRequest())
	if err == nil || !strings.Contains(err.Error(), "identity mismatch") {
		t.Fatalf("expected identity mismatch, got %v", err)
	}
}

func TestProbeConnectionReturnsSafeRemoteError(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"code":"FORBIDDEN","message":"must not leak details","retryable":false,"correlationId":"request-1"}`))
	}))
	defer server.Close()
	client, err := New(Config{BaseURL: server.URL, ServiceToken: "service-token"})
	if err != nil {
		t.Fatalf("new client: %v", err)
	}
	_, err = client.ProbeConnection(context.Background(), validScopedRequest())
	var remote *RemoteError
	if !errors.As(err, &remote) {
		t.Fatalf("expected remote error, got %v", err)
	}
	if remote.StatusCode != http.StatusForbidden || remote.Code != "FORBIDDEN" || strings.Contains(err.Error(), "leak") {
		t.Fatalf("unsafe or invalid remote error: %#v / %v", remote, err)
	}
}

func TestProbeConnectionValidatesScopeBeforeNetwork(t *testing.T) {
	t.Parallel()
	client, err := New(Config{BaseURL: "http://127.0.0.1:1", ServiceToken: "service-token"})
	if err != nil {
		t.Fatalf("new client: %v", err)
	}
	request := validScopedRequest()
	request.Identity.TenantID = "not-a-uuid"
	_, err = client.ProbeConnection(context.Background(), request)
	if err == nil || !strings.Contains(err.Error(), "tenantId") {
		t.Fatalf("expected tenant validation error, got %v", err)
	}
}

func TestDecideReturnUsesScopedWriteContract(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != ReturnDecisionPath {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get(serviceTokenHeader) != "service-token" {
			t.Fatal("service token header was not forwarded")
		}
		var request ReturnDecisionRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if request.Decision != ReturnDecisionDecline || request.DeclineReason != ReturnDeclineReasonFinalSale {
			t.Fatalf("unexpected decision request: %#v", request)
		}
		_ = json.NewEncoder(w).Encode(ReturnDecisionResult{
			ContractVersion: ReturnDecisionContractVersion,
			TenantID:        testTenantID, ShopID: testShopID,
			ReturnID: request.ReturnID, Status: "DECLINED", UpdatedAt: time.Now().UTC(),
		})
	}))
	defer server.Close()
	client, err := New(Config{BaseURL: server.URL, ServiceToken: "service-token"})
	if err != nil {
		t.Fatalf("new client: %v", err)
	}
	request := ReturnDecisionRequest{
		Identity: validScopedRequest().Identity, Context: validScopedRequest().Context,
		ReturnID: "gid://shopify/Return/10", Decision: ReturnDecisionDecline,
		DeclineReason: ReturnDeclineReasonFinalSale, DeclineNote: "Final sale item",
		NotifyCustomer: true, IdempotencyKey: "return-decision-1",
	}
	result, err := client.DecideReturn(context.Background(), request)
	if err != nil || result.Status != "DECLINED" {
		t.Fatalf("decide return: %#v, %v", result, err)
	}
}

func TestFetchReturnsValidatesScopedCatalogAndDuties(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != ReturnCatalogPath {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		var request ReturnCatalogRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		amount := ReturnRefundMoneyBag{ShopMoney: Money{Amount: "4.00", CurrencyCode: "USD"}, PresentmentMoney: Money{Amount: "4.00", CurrencyCode: "USD"}}
		_ = json.NewEncoder(w).Encode(ReturnCatalogPage{
			ContractVersion: ReturnCatalogContractVersion, TenantID: request.Identity.TenantID, ShopID: request.Identity.ShopID,
			State: CatalogStateConnected, FetchedAt: &now, Returns: []ReturnCatalogItem{{
				ID: "gid://shopify/Return/10", Name: "#R1", OrderID: "gid://shopify/Order/11", OrderName: "#1001", Status: "REQUESTED", TotalQuantity: 1,
				LineItems: []ReturnCatalogLine{{ID: "gid://shopify/ReturnLineItem/20", FulfillmentLineID: "gid://shopify/FulfillmentLineItem/21", OrderLineID: "gid://shopify/LineItem/22", Name: "Item", Quantity: 1, ProcessableQuantity: 1, RefundableQuantity: 1, Duties: []ReturnCatalogDuty{{ID: "gid://shopify/Duty/40", Price: amount}}}},
			}},
		})
	}))
	defer server.Close()
	client, err := New(Config{BaseURL: server.URL, ServiceToken: "service-token"})
	if err != nil {
		t.Fatalf("new client: %v", err)
	}
	identity := validScopedRequest()
	page, err := client.FetchReturns(context.Background(), ReturnCatalogRequest{Identity: identity.Identity, Context: identity.Context, Limit: 50})
	if err != nil || len(page.Returns) != 1 || len(page.Returns[0].LineItems[0].Duties) != 1 {
		t.Fatalf("fetch returns: %#v, %v", page, err)
	}
}

func TestDecideReturnRejectsInvalidApproveDetailsBeforeNetwork(t *testing.T) {
	t.Parallel()
	client, err := New(Config{BaseURL: "http://127.0.0.1:1", ServiceToken: "service-token"})
	if err != nil {
		t.Fatalf("new client: %v", err)
	}
	request := ReturnDecisionRequest{
		Identity: validScopedRequest().Identity, Context: validScopedRequest().Context,
		ReturnID: "gid://shopify/Return/10", Decision: ReturnDecisionApprove,
		DeclineReason: ReturnDeclineReasonOther, IdempotencyKey: "return-decision-1",
	}
	if _, err := client.DecideReturn(context.Background(), request); err == nil || !strings.Contains(err.Error(), "decline details") {
		t.Fatalf("expected validation error, got %v", err)
	}
}

func TestDisputeCatalogRemainsTenantScoped(t *testing.T) {
	t.Parallel()
	fetchedAt := time.Now().UTC()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case DisputeCatalogPath:
			var request DisputeCatalogRequest
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Fatalf("decode catalog: %v", err)
			}
			_ = json.NewEncoder(w).Encode(DisputeCatalogPage{
				ContractVersion: DisputeCatalogContractVersion, TenantID: request.Identity.TenantID, ShopID: request.Identity.ShopID,
				State: CatalogStateConnected, FetchedAt: &fetchedAt, PageInfo: PageInfo{},
				Disputes: []Dispute{{
					ID: "gid://shopify/ShopifyPaymentsDispute/10",
				}},
			})
		default:
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
	}))
	defer server.Close()
	client, err := New(Config{BaseURL: server.URL, ServiceToken: "service-token"})
	if err != nil {
		t.Fatalf("new client: %v", err)
	}
	identity := validScopedRequest()
	page, err := client.FetchDisputes(context.Background(), DisputeCatalogRequest{
		Identity: identity.Identity, Context: identity.Context, Limit: 50,
	})
	if err != nil || len(page.Disputes) != 1 {
		t.Fatalf("fetch disputes: %#v, %v", page, err)
	}
}

func TestDisputeCatalogRejectsCrossTenantResponse(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		now := time.Now().UTC()
		_ = json.NewEncoder(w).Encode(DisputeCatalogPage{
			ContractVersion: DisputeCatalogContractVersion,
			TenantID:        "33333333-3333-4333-8333-333333333333", ShopID: testShopID,
			State: CatalogStateConnected, Disputes: []Dispute{}, FetchedAt: &now,
		})
	}))
	defer server.Close()
	client, err := New(Config{BaseURL: server.URL, ServiceToken: "service-token"})
	if err != nil {
		t.Fatalf("new client: %v", err)
	}
	request := validScopedRequest()
	_, err = client.FetchDisputes(context.Background(), DisputeCatalogRequest{Identity: request.Identity, Context: request.Context, Limit: 50})
	if err == nil || !strings.Contains(err.Error(), "contract mismatch") {
		t.Fatalf("expected identity rejection, got %v", err)
	}
}

func TestPreviewReturnRefundAcceptsOnlyConnectorCalculatedMoney(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != ReturnRefundPreviewPath {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		var request ReturnRefundPreviewRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		now := time.Now().UTC()
		expires := now.Add(10 * time.Minute)
		amount := ReturnRefundMoneyBag{ShopMoney: Money{Amount: "25.99", CurrencyCode: "USD"}, PresentmentMoney: Money{Amount: "25.99", CurrencyCode: "USD"}}
		_ = json.NewEncoder(w).Encode(ReturnRefundPreview{
			ContractVersion: ReturnRefundPreviewContractVersion, TenantID: request.Identity.TenantID, ShopID: request.Identity.ShopID,
			ReturnID: request.ReturnID, State: ReturnRefundPreviewRefundable, LineItems: request.LineItems,
			RefundAmount: amount, MaximumRefundable: amount,
			Transactions: []ReturnRefundTransaction{{ParentTransactionID: "gid://shopify/OrderTransaction/30", Amount: amount}},
			PreviewToken: "01234567890123456789012345678901", ExpiresAt: &expires, FetchedAt: now,
		})
	}))
	defer server.Close()
	client, err := New(Config{BaseURL: server.URL, ServiceToken: "service-token"})
	if err != nil {
		t.Fatalf("new client: %v", err)
	}
	identity := validScopedRequest()
	preview, err := client.PreviewReturnRefund(context.Background(), ReturnRefundPreviewRequest{
		Identity: identity.Identity, Context: identity.Context, ReturnID: "gid://shopify/Return/10",
		LineItems: []ReturnRefundLineSelection{{ReturnLineID: "gid://shopify/ReturnLineItem/20", Quantity: 1}},
	})
	if err != nil || preview.RefundAmount.PresentmentMoney.Amount != "25.99" {
		t.Fatalf("preview: %#v, %v", preview, err)
	}
}

func TestProcessReturnRefundForwardsPreviewTokenWithoutMoneyInput(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != ReturnRefundProcessPath {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		var request ReturnRefundProcessRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		amount := ReturnRefundMoneyBag{ShopMoney: Money{Amount: "25.99", CurrencyCode: "USD"}, PresentmentMoney: Money{Amount: "25.99", CurrencyCode: "USD"}}
		_ = json.NewEncoder(w).Encode(ReturnRefundProcessResult{
			ContractVersion: ReturnRefundProcessContractVersion, TenantID: request.Identity.TenantID, ShopID: request.Identity.ShopID,
			ReturnID: request.ReturnID, ReturnStatus: "CLOSED", Outcome: ReturnRefundProcessApplied, RefundAmount: amount,
			Transactions: []ReturnRefundProcessedTransaction{{ID: "gid://shopify/OrderTransaction/31", ParentTransactionID: "gid://shopify/OrderTransaction/30", Status: "SUCCESS", Amount: amount}},
			UpdatedAt:    time.Now().UTC(),
		})
	}))
	defer server.Close()
	client, err := New(Config{BaseURL: server.URL, ServiceToken: "service-token"})
	if err != nil {
		t.Fatalf("new client: %v", err)
	}
	identity := validScopedRequest()
	result, err := client.ProcessReturnRefund(context.Background(), ReturnRefundProcessRequest{
		Identity: identity.Identity, Context: identity.Context, ReturnID: "gid://shopify/Return/10",
		LineItems:    []ReturnRefundLineSelection{{ReturnLineID: "gid://shopify/ReturnLineItem/20", Quantity: 1}},
		PreviewToken: "01234567890123456789012345678901", NotifyCustomer: true, IdempotencyKey: "refund-1",
	})
	if err != nil || result.Outcome != ReturnRefundProcessApplied {
		t.Fatalf("process: %#v, %v", result, err)
	}
}

func validScopedRequest() ScopedRequest {
	return ScopedRequest{
		Identity: ShopIdentity{TenantID: testTenantID, ShopID: testShopID},
		Context: RequestContext{
			CorrelationID: "correlation-1",
			RequestID:     "request-1",
		},
	}
}
