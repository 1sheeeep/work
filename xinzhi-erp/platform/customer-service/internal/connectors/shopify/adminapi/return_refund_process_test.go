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

func TestProcessReturnRefundUsesFreshSignedPreview(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 6, 10, 0, 0, 0, time.UTC)
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		var envelope struct {
			Query     string         `json:"query"`
			Variables map[string]any `json:"variables"`
		}
		if err := json.NewDecoder(r.Body).Decode(&envelope); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if strings.Contains(envelope.Query, "XZCSReturnRefundPreview") {
			writeRefundPreviewGraphQL(w)
			return
		}
		if !strings.Contains(envelope.Query, "returnProcess") {
			t.Fatalf("unexpected query: %s", envelope.Query)
		}
		input, _ := envelope.Variables["input"].(map[string]any)
		if _, acceptsMoney := input["refundAmount"]; acceptsMoney {
			t.Fatalf("process accepted client money: %#v", input)
		}
		writeRefundProcessGraphQL(w, now, "SUCCESS")
	}))
	defer server.Close()
	client, err := newClient("2026-07", server.URL, server.Client())
	if err != nil {
		t.Fatalf("new client: %v", err)
	}
	client.now = func() time.Time { return now }
	previewRequest := validReturnRefundPreviewRequest(1)
	preview, err := client.PreviewReturnRefund(context.Background(), "demo.myshopify.com", "secret-token", previewRequest)
	if err != nil {
		t.Fatalf("preview: %v", err)
	}
	result, err := client.ProcessReturnRefund(context.Background(), "demo.myshopify.com", "secret-token", shopifyconnector.ReturnRefundProcessRequest{
		Identity: previewRequest.Identity, Context: previewRequest.Context, ReturnID: previewRequest.ReturnID, LineItems: previewRequest.LineItems,
		PreviewToken: preview.PreviewToken, NotifyCustomer: true, IdempotencyKey: "refund-1",
	})
	if err != nil || result.Outcome != shopifyconnector.ReturnRefundProcessApplied || result.RecoveredFromShopify || requests != 3 {
		t.Fatalf("unexpected process: %#v err=%v requests=%d", result, err, requests)
	}
}

func TestProcessReturnRefundRecoversAfterUncertainMutation(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 6, 10, 0, 0, 0, time.UTC)
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		var envelope struct {
			Query string `json:"query"`
		}
		_ = json.NewDecoder(r.Body).Decode(&envelope)
		switch {
		case strings.Contains(envelope.Query, "XZCSReturnRefundPreview"):
			writeRefundPreviewGraphQL(w)
		case strings.Contains(envelope.Query, "mutation XZCSReturnRefundProcess"):
			w.WriteHeader(http.StatusBadGateway)
		case strings.Contains(envelope.Query, "XZCSReturnRefundProcessStatus"):
			_, _ = w.Write([]byte(`{"data":{"return":` + refundProcessNodeJSON(now, "PENDING") + `}}`))
		default:
			t.Fatalf("unexpected query: %s", envelope.Query)
		}
	}))
	defer server.Close()
	client, err := newClient("2026-07", server.URL, server.Client())
	if err != nil {
		t.Fatalf("new client: %v", err)
	}
	client.now = func() time.Time { return now }
	previewRequest := validReturnRefundPreviewRequest(1)
	preview, err := client.PreviewReturnRefund(context.Background(), "demo.myshopify.com", "secret-token", previewRequest)
	if err != nil {
		t.Fatalf("preview: %v", err)
	}
	result, err := client.ProcessReturnRefund(context.Background(), "demo.myshopify.com", "secret-token", shopifyconnector.ReturnRefundProcessRequest{
		Identity: previewRequest.Identity, Context: previewRequest.Context, ReturnID: previewRequest.ReturnID, LineItems: previewRequest.LineItems,
		PreviewToken: preview.PreviewToken, IdempotencyKey: "refund-1",
	})
	if err != nil || result.Outcome != shopifyconnector.ReturnRefundProcessPending || !result.RecoveredFromShopify || requests != 4 {
		t.Fatalf("unexpected recovery: %#v err=%v requests=%d", result, err, requests)
	}
}

func TestProcessReturnRefundRejectsTamperedPreviewBeforeNetwork(t *testing.T) {
	t.Parallel()
	client, err := newClient("2026-07", "http://127.0.0.1:1", http.DefaultClient)
	if err != nil {
		t.Fatalf("new client: %v", err)
	}
	request := validReturnRefundPreviewRequest(1)
	_, err = client.ProcessReturnRefund(context.Background(), "demo.myshopify.com", "secret-token", shopifyconnector.ReturnRefundProcessRequest{
		Identity: request.Identity, Context: request.Context, ReturnID: request.ReturnID, LineItems: request.LineItems,
		PreviewToken: strings.Repeat("x", 32), IdempotencyKey: "refund-1",
	})
	if err == nil {
		t.Fatal("expected tampered preview token rejection")
	}
}

func TestReturnRefundProcessInputUsesSelectionsWithoutClientMoney(t *testing.T) {
	t.Parallel()
	request := shopifyconnector.ReturnRefundProcessRequest{
		ReturnID:       "gid://shopify/Return/10",
		LineItems:      []shopifyconnector.ReturnRefundLineSelection{{ReturnLineID: "gid://shopify/ReturnLineItem/20", Quantity: 1}},
		RefundShipping: true,
		RefundDuties: []shopifyconnector.ReturnRefundDutySelection{{
			DutyID: "gid://shopify/Duty/40", RefundType: shopifyconnector.ReturnRefundDutyProportional,
		}},
	}
	preview := shopifyconnector.ReturnRefundPreview{Transactions: []shopifyconnector.ReturnRefundTransaction{{
		ParentTransactionID: "gid://shopify/OrderTransaction/30",
		Amount: shopifyconnector.ReturnRefundMoneyBag{
			ShopMoney:        shopifyconnector.CatalogMoney{Amount: "39.99", CurrencyCode: "USD"},
			PresentmentMoney: shopifyconnector.CatalogMoney{Amount: "39.99", CurrencyCode: "USD"},
		},
	}}}
	input := returnRefundProcessInput(request, preview)
	shipping, _ := input["refundShipping"].(map[string]any)
	duties, _ := input["refundDuties"].([]map[string]any)
	if shipping["fullRefund"] != true || len(duties) != 1 || duties[0]["dutyId"] != "gid://shopify/Duty/40" || duties[0]["refundType"] != shopifyconnector.ReturnRefundDutyProportional {
		t.Fatalf("unexpected selection input: %#v", input)
	}
	if _, acceptsMoney := input["refundAmount"]; acceptsMoney {
		t.Fatalf("process accepted client money: %#v", input)
	}
}

func writeRefundPreviewGraphQL(w http.ResponseWriter) {
	_, _ = w.Write([]byte(`{"data":{"return":{"id":"gid://shopify/Return/10","status":"OPEN","returnLineItems":{"pageInfo":{"hasNextPage":false},"nodes":[{"id":"gid://shopify/ReturnLineItem/20","processableQuantity":1,"processedQuantity":0,"refundableQuantity":1,"refundedQuantity":0}]},"suggestedFinancialOutcome":{"maximumRefundable":{"shopMoney":{"amount":"25.99","currencyCode":"USD"},"presentmentMoney":{"amount":"25.99","currencyCode":"USD"}},"financialTransfer":{"__typename":"RefundReturnOutcome","amount":{"shopMoney":{"amount":"25.99","currencyCode":"USD"},"presentmentMoney":{"amount":"25.99","currencyCode":"USD"}},"suggestedTransactions":[{"gateway":"shopify_payments","amountSet":{"shopMoney":{"amount":"25.99","currencyCode":"USD"},"presentmentMoney":{"amount":"25.99","currencyCode":"USD"}},"parentTransaction":{"id":"gid://shopify/OrderTransaction/30"}}]}}}}}`))
}

func writeRefundProcessGraphQL(w http.ResponseWriter, now time.Time, status string) {
	_, _ = w.Write([]byte(`{"data":{"returnProcess":{"return":` + refundProcessNodeJSON(now, status) + `,"userErrors":[]}}}`))
}

func refundProcessNodeJSON(now time.Time, status string) string {
	return `{"id":"gid://shopify/Return/10","status":"CLOSED","returnLineItems":{"pageInfo":{"hasNextPage":false},"nodes":[{"id":"gid://shopify/ReturnLineItem/20","processableQuantity":0,"processedQuantity":1,"refundableQuantity":0,"refundedQuantity":1}]},"transactions":{"pageInfo":{"hasNextPage":false},"nodes":[{"id":"gid://shopify/OrderTransaction/31","kind":"REFUND","status":"` + status + `","createdAt":"` + now.Format(time.RFC3339) + `","amountSet":{"shopMoney":{"amount":"25.99","currencyCode":"USD"},"presentmentMoney":{"amount":"25.99","currencyCode":"USD"}},"parentTransaction":{"id":"gid://shopify/OrderTransaction/30"}}]}}`
}
