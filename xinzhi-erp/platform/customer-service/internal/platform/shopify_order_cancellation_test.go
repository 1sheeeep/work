package platform

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

func TestShopifyAdminClientCancelsOrderAndVerifiesMarker(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var payload struct {
			Query     string         `json:"query"`
			Variables map[string]any `json:"variables"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		switch calls {
		case 1:
			_, _ = w.Write([]byte(`{"data":{"order":{"id":"gid://shopify/Order/10","cancelledAt":null,"cancelReason":null,"cancellation":null}}}`))
		case 2:
			refund := payload.Variables["refundMethod"].(map[string]any)
			if !strings.Contains(payload.Query, "orderCancel") ||
				payload.Variables["reason"] != "CUSTOMER" ||
				payload.Variables["staffNote"] != "Buyer requested [XZ ERP:web.order-cancel-10]" ||
				refund["originalPaymentMethodsRefund"] != true ||
				payload.Variables["restock"] != true || payload.Variables["notifyCustomer"] != true {
				t.Fatalf("unexpected cancel variables: %#v", payload.Variables)
			}
			_, _ = w.Write([]byte(`{"data":{"orderCancel":{"job":{"id":"gid://shopify/Job/abc-1","done":false},"orderCancelUserErrors":[]}}}`))
		case 3:
			_, _ = w.Write([]byte(cancelledOrderJSON()))
		default:
			t.Fatalf("unexpected GraphQL call %d", calls)
		}
	}))
	defer server.Close()

	client := shopifyAdminClient{HTTPClient: server.Client(), BaseURL: server.URL}
	result, err := client.CancelOrder(t.Context(), "demo.myshopify.com", "test-token", cancellationRequest(false))
	if err != nil || calls != 3 || result.RecoveredFromShopify ||
		result.Reason != shopifyconnector.OrderCancellationReasonCustomer ||
		result.CancelledAt.IsZero() || result.JobID != "gid://shopify/Job/abc-1" {
		t.Fatalf("unexpected cancellation: calls=%d result=%#v err=%v", calls, result, err)
	}
}

func TestShopifyAdminClientRecoversOnlyMarkedCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(cancelledOrderJSON()))
	}))
	defer server.Close()
	client := shopifyAdminClient{HTTPClient: server.Client(), BaseURL: server.URL}
	result, err := client.CancelOrder(t.Context(), "demo.myshopify.com", "test-token", cancellationRequest(true))
	if err != nil || !result.RecoveredFromShopify {
		t.Fatalf("exact cancellation recovery failed: result=%#v err=%v", result, err)
	}
	_, err = client.CancelOrder(t.Context(), "demo.myshopify.com", "test-token", cancellationRequest(false))
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("unmarked retry must fail closed: %v", err)
	}
}

func TestShopifyOrderCancellationAdapterRequiresWriteOrders(t *testing.T) {
	store := NewMemoryStore()
	shop, _ := store.CreateShop(t.Context(), Shop{
		DisplayName: "Cancel Shop", Status: ShopStatusActive,
		Metadata: map[string]string{"shopifyDomain": "orders.myshopify.com"},
	})
	_, _ = store.SaveShopifyInstallation(t.Context(), ShopifyInstallation{
		ShopID: shop.ID, ShopDomain: "orders.myshopify.com", AccessToken: "shpat_owned",
		Scope: shopifyOrderReadScope,
	})
	request := cancellationRequest(false)
	called := false
	adapter := newShopifyOrderCancellationAdapterWithWriter(
		testShopifyConnectorBindingResolver{bindings: map[shopifyconnector.CanonicalShopIdentity]string{
			request.Identity: shop.ID,
		}}, store, func(context.Context, string, string) string { return "shpat_owned" },
		func(context.Context, string, string, shopifyconnector.OrderCancellationRequest) (shopifyconnector.OrderCancellationResult, error) {
			called = true
			return shopifyconnector.OrderCancellationResult{}, nil
		})
	_, err := adapter.CancelOrder(t.Context(), request)
	var safeErr *shopifyconnector.ConnectionProbeError
	if !errors.As(err, &safeErr) || safeErr.Code != shopifyconnector.ErrorCodeForbidden ||
		called || strings.Contains(err.Error(), "shpat_owned") {
		t.Fatalf("missing write scope did not fail closed: called=%v err=%v", called, err)
	}
}

func cancellationRequest(recover bool) shopifyconnector.OrderCancellationRequest {
	return shopifyconnector.OrderCancellationRequest{
		Identity: shopifyconnector.CanonicalShopIdentity{
			TenantID: "f7000000-0000-4000-8000-000000000001",
			ShopID:   "f7000000-0000-4000-8000-000000000002",
		},
		Context: shopifyconnector.RequestContext{
			CorrelationID: "order-cancel-correlation-1", RequestID: "order-cancel-request-1",
		},
		OrderID:   "gid://shopify/Order/10",
		Reason:    shopifyconnector.OrderCancellationReasonCustomer,
		StaffNote: "Buyer requested", RefundOriginalPaymentMethods: true,
		Restock: true, NotifyCustomer: true, RecoverExisting: recover,
		IdempotencyKey: "web.order-cancel-10",
	}
}

func cancelledOrderJSON() string {
	return `{"data":{"order":{"id":"gid://shopify/Order/10","cancelledAt":"2026-07-31T12:00:00Z","cancelReason":"CUSTOMER","cancellation":{"staffNote":"Buyer requested [XZ ERP:web.order-cancel-10]"}}}}`
}
