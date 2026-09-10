package adminapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

func TestDecideReturnApprovesRequestedReturn(t *testing.T) {
	t.Parallel()
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		var envelope struct {
			Query     string         `json:"query"`
			Variables map[string]any `json:"variables"`
		}
		if err := json.NewDecoder(r.Body).Decode(&envelope); err != nil {
			t.Fatalf("decode GraphQL request: %v", err)
		}
		switch requests {
		case 1:
			if !strings.Contains(envelope.Query, "XZERPReturnDecisionStatus") {
				t.Fatalf("unexpected status query: %s", envelope.Query)
			}
			_, _ = w.Write([]byte(`{"data":{"return":{"id":"gid://shopify/Return/10","status":"REQUESTED"}}}`))
		case 2:
			if !strings.Contains(envelope.Query, "returnApproveRequest") {
				t.Fatalf("unexpected mutation: %s", envelope.Query)
			}
			input, _ := envelope.Variables["input"].(map[string]any)
			if input["notifyCustomer"] != true || input["id"] != "gid://shopify/Return/10" {
				t.Fatalf("unexpected variables: %#v", envelope.Variables)
			}
			_, _ = w.Write([]byte(`{"data":{"returnApproveRequest":{"return":{"id":"gid://shopify/Return/10","status":"OPEN"},"userErrors":[]}}}`))
		default:
			t.Fatalf("unexpected request count: %d", requests)
		}
	}))
	defer server.Close()
	client, err := newClient("2026-07", server.URL, server.Client())
	if err != nil {
		t.Fatalf("new client: %v", err)
	}
	client.now = func() time.Time { return time.Date(2026, 8, 6, 10, 0, 0, 0, time.UTC) }
	result, err := client.DecideReturn(context.Background(), "demo.myshopify.com", "token", validReturnDecisionRequest(shopifyconnector.ReturnDecisionApprove))
	if err != nil {
		t.Fatalf("decide return: %v", err)
	}
	if result.Status != "OPEN" || result.RecoveredFromShopify || requests != 2 {
		t.Fatalf("unexpected result: %#v; requests=%d", result, requests)
	}
}

func TestDecideReturnRecoversCompletedDecline(t *testing.T) {
	t.Parallel()
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests++
		_, _ = w.Write([]byte(`{"data":{"return":{"id":"gid://shopify/Return/10","status":"DECLINED"}}}`))
	}))
	defer server.Close()
	client, err := newClient("2026-07", server.URL, server.Client())
	if err != nil {
		t.Fatalf("new client: %v", err)
	}
	request := validReturnDecisionRequest(shopifyconnector.ReturnDecisionDecline)
	request.DeclineReason = shopifyconnector.ReturnDeclineReasonReturnPeriodEnded
	result, err := client.DecideReturn(context.Background(), "demo.myshopify.com", "token", request)
	if err != nil {
		t.Fatalf("decide return: %v", err)
	}
	if result.Status != "DECLINED" || !result.RecoveredFromShopify || requests != 1 {
		t.Fatalf("unexpected recovered result: %#v; requests=%d", result, requests)
	}
}

func validReturnDecisionRequest(decision shopifyconnector.ReturnDecision) shopifyconnector.ReturnDecisionRequest {
	return shopifyconnector.ReturnDecisionRequest{
		Identity: shopifyconnector.CanonicalShopIdentity{
			TenantID: "11111111-1111-4111-8111-111111111111",
			ShopID:   "22222222-2222-4222-8222-222222222222",
		},
		Context: shopifyconnector.RequestContext{
			CorrelationID: "correlation-1", RequestID: "request-1",
		},
		ReturnID: "gid://shopify/Return/10", Decision: decision,
		NotifyCustomer: true, IdempotencyKey: "return-decision-1",
	}
}
