package adminapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

func TestPreviewReturnRefundUsesShopifySuggestedTransactions(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var envelope struct {
			Query     string         `json:"query"`
			Variables map[string]any `json:"variables"`
		}
		if err := json.NewDecoder(r.Body).Decode(&envelope); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if !strings.Contains(envelope.Query, "suggestedFinancialOutcome") || !strings.Contains(envelope.Query, "suggestedTransactions") {
			t.Fatalf("preview query does not use Shopify suggestion: %s", envelope.Query)
		}
		lines, ok := envelope.Variables["returnLineItems"].([]any)
		if !ok || len(lines) != 1 {
			t.Fatalf("unexpected line variables: %#v", envelope.Variables)
		}
		_, _ = w.Write([]byte(`{"data":{"return":{"id":"gid://shopify/Return/10","status":"OPEN","returnLineItems":{"pageInfo":{"hasNextPage":false},"nodes":[{"id":"gid://shopify/ReturnLineItem/20","processableQuantity":2,"refundableQuantity":2}]},"suggestedFinancialOutcome":{"maximumRefundable":{"shopMoney":{"amount":"30.00","currencyCode":"USD"},"presentmentMoney":{"amount":"30.00","currencyCode":"USD"}},"financialTransfer":{"__typename":"RefundReturnOutcome","amount":{"shopMoney":{"amount":"25.99","currencyCode":"USD"},"presentmentMoney":{"amount":"25.99","currencyCode":"USD"}},"suggestedTransactions":[{"accountNumber":"•••• 4242","gateway":"shopify_payments","formattedGateway":"Shopify Payments","amountSet":{"shopMoney":{"amount":"25.99","currencyCode":"USD"},"presentmentMoney":{"amount":"25.99","currencyCode":"USD"}},"parentTransaction":{"id":"gid://shopify/OrderTransaction/30"}}]}}}}}`))
	}))
	defer server.Close()
	client, err := newClient("2026-07", server.URL, server.Client())
	if err != nil {
		t.Fatalf("new client: %v", err)
	}
	now := time.Date(2026, 8, 6, 10, 0, 0, 0, time.UTC)
	client.now = func() time.Time { return now }
	request := validReturnRefundPreviewRequest(1)
	preview, err := client.PreviewReturnRefund(context.Background(), "demo.myshopify.com", "secret-token", request)
	if err != nil {
		t.Fatalf("preview: %v", err)
	}
	if preview.State != shopifyconnector.ReturnRefundPreviewRefundable || preview.RefundAmount.PresentmentMoney.Amount != "25.99" ||
		len(preview.Transactions) != 1 || preview.Transactions[0].ParentTransactionID != "gid://shopify/OrderTransaction/30" ||
		preview.ExpiresAt == nil || !preview.ExpiresAt.Equal(now.Add(returnRefundPreviewTTL)) {
		t.Fatalf("unexpected preview: %#v", preview)
	}
	parts := strings.Split(preview.PreviewToken, ".")
	if len(parts) != 2 {
		t.Fatalf("invalid preview token: %q", preview.PreviewToken)
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil || strings.Contains(string(payload), "secret-token") {
		t.Fatalf("preview token leaked secret or is invalid: %v %s", err, payload)
	}
}

func TestPreviewReturnRefundRejectsQuantityAboveShopifyAvailability(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"data":{"return":{"id":"gid://shopify/Return/10","status":"OPEN","returnLineItems":{"pageInfo":{"hasNextPage":false},"nodes":[{"id":"gid://shopify/ReturnLineItem/20","processableQuantity":1,"refundableQuantity":1}]},"suggestedFinancialOutcome":{"maximumRefundable":{"shopMoney":{"amount":"25.99","currencyCode":"USD"},"presentmentMoney":{"amount":"25.99","currencyCode":"USD"}},"financialTransfer":null}}}}`))
	}))
	defer server.Close()
	client, err := newClient("2026-07", server.URL, server.Client())
	if err != nil {
		t.Fatalf("new client: %v", err)
	}
	_, err = client.PreviewReturnRefund(context.Background(), "demo.myshopify.com", "token", validReturnRefundPreviewRequest(2))
	if err == nil {
		t.Fatal("expected unavailable quantity to be rejected")
	}
}

func TestPreviewReturnRefundCalculatesFullShippingAndSelectedDuty(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var envelope struct {
			Variables map[string]any `json:"variables"`
		}
		if err := json.NewDecoder(r.Body).Decode(&envelope); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		shipping, _ := envelope.Variables["refundShipping"].(map[string]any)
		duties, _ := envelope.Variables["refundDuties"].([]any)
		if shipping["fullRefund"] != true || len(duties) != 1 {
			t.Fatalf("shipping or duty selection was not forwarded: %#v", envelope.Variables)
		}
		_, _ = w.Write([]byte(`{"data":{"return":{"id":"gid://shopify/Return/10","status":"OPEN","returnLineItems":{"pageInfo":{"hasNextPage":false},"nodes":[{"id":"gid://shopify/ReturnLineItem/20","processableQuantity":1,"refundableQuantity":1,"fulfillmentLineItem":{"lineItem":{"duties":[{"id":"gid://shopify/Duty/40"}]}}}]},"suggestedFinancialOutcome":{"maximumRefundable":{"shopMoney":{"amount":"40.00","currencyCode":"USD"},"presentmentMoney":{"amount":"40.00","currencyCode":"USD"}},"totalDuties":{"shopMoney":{"amount":"4.00","currencyCode":"USD"},"presentmentMoney":{"amount":"4.00","currencyCode":"USD"}},"shipping":{"amountSet":{"shopMoney":{"amount":"10.00","currencyCode":"USD"},"presentmentMoney":{"amount":"10.00","currencyCode":"USD"}}},"financialTransfer":{"__typename":"RefundReturnOutcome","amount":{"shopMoney":{"amount":"39.99","currencyCode":"USD"},"presentmentMoney":{"amount":"39.99","currencyCode":"USD"}},"suggestedTransactions":[{"amountSet":{"shopMoney":{"amount":"39.99","currencyCode":"USD"},"presentmentMoney":{"amount":"39.99","currencyCode":"USD"}},"parentTransaction":{"id":"gid://shopify/OrderTransaction/30"}}]}}}}}`))
	}))
	defer server.Close()
	client, err := newClient("2026-07", server.URL, server.Client())
	if err != nil {
		t.Fatalf("new client: %v", err)
	}
	request := validReturnRefundPreviewRequest(1)
	request.RefundShipping = true
	request.RefundDuties = []shopifyconnector.ReturnRefundDutySelection{{DutyID: "gid://shopify/Duty/40", RefundType: shopifyconnector.ReturnRefundDutyProportional}}
	preview, err := client.PreviewReturnRefund(context.Background(), "demo.myshopify.com", "token", request)
	if err != nil {
		t.Fatalf("preview: %v", err)
	}
	if preview.ShippingAmount == nil || preview.ShippingAmount.PresentmentMoney.Amount != "10.00" || preview.DutyAmount == nil || preview.DutyAmount.PresentmentMoney.Amount != "4.00" {
		t.Fatalf("unexpected component amounts: %#v", preview)
	}
}

func validReturnRefundPreviewRequest(quantity int) shopifyconnector.ReturnRefundPreviewRequest {
	return shopifyconnector.ReturnRefundPreviewRequest{
		Identity:  shopifyconnector.CanonicalShopIdentity{TenantID: "11111111-1111-4111-8111-111111111111", ShopID: "22222222-2222-4222-8222-222222222222"},
		Context:   shopifyconnector.RequestContext{CorrelationID: "correlation-1", RequestID: "request-1"},
		ReturnID:  "gid://shopify/Return/10",
		LineItems: []shopifyconnector.ReturnRefundLineSelection{{ReturnLineID: "gid://shopify/ReturnLineItem/20", Quantity: quantity}},
	}
}
