package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestShopifyDisputeListUsesOnlyUnrestrictedSummaryFields(t *testing.T) {
	shopify := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Query string `json:"query"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(payload.Query, "disputeEvidence") {
			t.Fatalf("summary query requested restricted dispute evidence fields: %s", payload.Query)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"data":{"disputes":{"pageInfo":{"hasNextPage":false},"nodes":[{"id":"gid://shopify/ShopifyPaymentsDispute/1","status":"NEEDS_RESPONSE","type":"CHARGEBACK","initiatedAt":"2026-08-01T00:00:00Z","evidenceDueBy":"2026-08-25T00:00:00Z","evidenceSentOn":"2026-08-20T00:00:00Z","amount":{"amount":"20.00","currencyCode":"USD"},"reasonDetails":{"reason":"FRAUDULENT","networkReasonCode":"10.4"},"order":{"id":"gid://shopify/Order/1","name":"#1001"}}]}}}`)
	}))
	defer shopify.Close()

	client := shopifyAdminClient{HTTPClient: shopify.Client(), BaseURL: shopify.URL}
	items, err := client.Disputes(t.Context(), "demo.myshopify.com", "test-token")
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].OrderName != "#1001" || items[0].EvidenceSentOn != "2026-08-20T00:00:00Z" {
		t.Fatalf("unexpected dispute summary: %#v", items)
	}
}

func TestShopifyReturnRefundPreviewAndRetryRecovery(t *testing.T) {
	const returnID = "gid://shopify/Return/1"
	const lineID = "gid://shopify/ReturnLineItem/1"
	const parentID = "gid://shopify/OrderTransaction/1"
	mutationCalls := 0
	processed := false
	shopify := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Query string `json:"query"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode GraphQL request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.Contains(payload.Query, "XzdeskReturnRefundPreview"):
			_, _ = w.Write([]byte(`{"data":{"return":{"id":"` + returnID + `","status":"OPEN","returnLineItems":{"pageInfo":{"hasNextPage":false},"nodes":[{"id":"` + lineID + `","processableQuantity":1,"processedQuantity":0,"refundableQuantity":1,"refundedQuantity":0}]},"suggestedFinancialOutcome":{"maximumRefundable":{"shopMoney":{"amount":"20.00","currencyCode":"USD"},"presentmentMoney":{"amount":"20.00","currencyCode":"USD"}},"shipping":null,"financialTransfer":{"__typename":"RefundReturnOutcome","amount":{"shopMoney":{"amount":"20.00","currencyCode":"USD"},"presentmentMoney":{"amount":"20.00","currencyCode":"USD"}},"suggestedTransactions":[{"accountNumber":"••42","gateway":"shopify_payments","formattedGateway":"Shopify Payments","amountSet":{"shopMoney":{"amount":"20.00","currencyCode":"USD"},"presentmentMoney":{"amount":"20.00","currencyCode":"USD"}},"parentTransaction":{"id":"` + parentID + `"}}]}}}}}`))
		case strings.Contains(payload.Query, "XzdeskReturnRefundProcess"):
			mutationCalls++
			processed = true
			_, _ = w.Write([]byte(refundProcessGraphQLResponse(returnID, lineID, parentID, time.Now().UTC())))
		case strings.Contains(payload.Query, "XzdeskReturnRefundStatus"):
			if processed {
				_, _ = w.Write([]byte(refundStatusGraphQLResponse(returnID, lineID, parentID, time.Now().UTC())))
			} else {
				_, _ = w.Write([]byte(`{"data":{"return":{"id":"` + returnID + `","status":"OPEN","returnLineItems":{"pageInfo":{"hasNextPage":false},"nodes":[{"id":"` + lineID + `","processableQuantity":1,"processedQuantity":0,"refundableQuantity":1,"refundedQuantity":0}]},"transactions":{"pageInfo":{"hasNextPage":false},"nodes":[]}}}}`))
			}
		default:
			t.Fatalf("unexpected GraphQL operation: %s", payload.Query)
		}
	}))
	defer shopify.Close()

	client := shopifyAdminClient{HTTPClient: shopify.Client(), BaseURL: shopify.URL}
	previewRequest := ShopifyReturnRefundPreviewRequest{ShopID: "shop-1", ReturnID: returnID, LineItems: []ShopifyReturnRefundLineSelection{{ReturnLineID: lineID, Quantity: 1}}}
	preview, err := client.PreviewReturnRefund(t.Context(), "demo.myshopify.com", "test-token", previewRequest)
	if err != nil {
		t.Fatalf("PreviewReturnRefund failed: %v", err)
	}
	if preview.State != shopifyRefundPreviewRefundable || preview.PreviewToken == "" || preview.RefundAmount.PresentmentMoney.Amount != "20.00" {
		t.Fatalf("unexpected preview: %#v", preview)
	}
	processRequest := ShopifyReturnRefundProcessRequest{ShopID: "shop-1", ReturnID: returnID, LineItems: preview.LineItems, PreviewToken: preview.PreviewToken}
	first, err := client.ProcessReturnRefund(t.Context(), "demo.myshopify.com", "test-token", processRequest)
	if err != nil {
		t.Fatalf("ProcessReturnRefund failed: %v", err)
	}
	if first.Outcome != shopifyRefundOutcomeApplied || first.RecoveredFromShopify || mutationCalls != 1 {
		t.Fatalf("unexpected initial refund result: %#v calls=%d", first, mutationCalls)
	}
	second, err := client.ProcessReturnRefund(t.Context(), "demo.myshopify.com", "test-token", processRequest)
	if err != nil {
		t.Fatalf("retry ProcessReturnRefund failed: %v", err)
	}
	if second.Outcome != shopifyRefundOutcomeApplied || !second.RecoveredFromShopify || mutationCalls != 1 {
		t.Fatalf("retry was not recovered without another mutation: %#v calls=%d", second, mutationCalls)
	}

	tampered := processRequest
	tampered.LineItems = []ShopifyReturnRefundLineSelection{{ReturnLineID: lineID, Quantity: 2}}
	if _, err := verifyRefundPreview("test-token", tampered); err == nil {
		t.Fatal("tampered refund selection unexpectedly passed preview verification")
	}
}

func refundProcessGraphQLResponse(returnID, lineID, parentID string, createdAt time.Time) string {
	return `{"data":{"returnProcess":{"return":` + refundStatusNodeJSON(returnID, lineID, parentID, createdAt) + `,"userErrors":[]}}}`
}

func refundStatusGraphQLResponse(returnID, lineID, parentID string, createdAt time.Time) string {
	return `{"data":{"return":` + refundStatusNodeJSON(returnID, lineID, parentID, createdAt) + `}}`
}

func refundStatusNodeJSON(returnID, lineID, parentID string, createdAt time.Time) string {
	return fmt.Sprintf(`{"id":%q,"status":"CLOSED","returnLineItems":{"pageInfo":{"hasNextPage":false},"nodes":[{"id":%q,"processableQuantity":0,"processedQuantity":1,"refundableQuantity":0,"refundedQuantity":1}]},"transactions":{"pageInfo":{"hasNextPage":false},"nodes":[{"id":"gid://shopify/OrderTransaction/2","kind":"REFUND","status":"SUCCESS","createdAt":%q,"amountSet":{"shopMoney":{"amount":"20.00","currencyCode":"USD"},"presentmentMoney":{"amount":"20.00","currencyCode":"USD"}},"parentTransaction":{"id":%q}}]}}`, returnID, lineID, createdAt.Format(time.RFC3339), parentID)
}

type fakeAfterSalesService struct {
	processResult ShopifyReturnRefundProcessResult
}

func (f fakeAfterSalesService) Returns(context.Context, string, string, string) ([]ShopifyReturn, error) {
	return nil, nil
}
func (f fakeAfterSalesService) DecideReturn(context.Context, string, string, ShopifyReturnDecisionRequest) (ShopifyReturnDecisionResult, error) {
	return ShopifyReturnDecisionResult{}, nil
}
func (f fakeAfterSalesService) PreviewReturnRefund(context.Context, string, string, ShopifyReturnRefundPreviewRequest) (ShopifyReturnRefundPreview, error) {
	return ShopifyReturnRefundPreview{}, nil
}
func (f fakeAfterSalesService) ProcessReturnRefund(context.Context, string, string, ShopifyReturnRefundProcessRequest) (ShopifyReturnRefundProcessResult, error) {
	return f.processResult, nil
}
func (f fakeAfterSalesService) Disputes(context.Context, string, string) ([]ShopifyDispute, error) {
	return nil, nil
}
func TestPendingRefundCreatesOneReviewTicketAcrossRetries(t *testing.T) {
	store := NewMemoryStore()
	server := NewServer(store)
	server.shopifyAfterSales = fakeAfterSalesService{processResult: ShopifyReturnRefundProcessResult{
		ReturnID: "gid://shopify/Return/9", ReturnStatus: "OPEN", Outcome: shopifyRefundOutcomePending,
		RefundAmount: ShopifyMoneyBag{PresentmentMoney: ShopifyMoney{Amount: "50.00", CurrencyCode: "USD"}}, UpdatedAt: time.Now().UTC().Format(time.RFC3339),
	}}
	httpServer := httptest.NewServer(server.Routes())
	defer httpServer.Close()
	adminToken := bootstrapAdmin(t, httpServer.URL)
	var admin User
	requestJSON(t, http.MethodGet, httpServer.URL+"/api/v1/auth/me", adminToken, nil, http.StatusOK, &admin)
	var shop Shop
	requestJSON(t, http.MethodPost, httpServer.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "After-sales", ExternalID: "after-sales.myshopify.com"}, http.StatusCreated, &shop)
	if _, err := store.SaveShopifyInstallation(t.Context(), ShopifyInstallation{ShopID: shop.ID, ShopDomain: "after-sales.myshopify.com", AccessToken: "test-token", Scope: strings.Join([]string{shopifyReturnReadScope, shopifyReturnWriteScope, shopifyOrderWriteScope}, ",")}); err != nil {
		t.Fatal(err)
	}
	body := ShopifyReturnRefundProcessRequest{ReturnID: "gid://shopify/Return/9", LineItems: []ShopifyReturnRefundLineSelection{{ReturnLineID: "line-1", Quantity: 1}}, PreviewToken: "fake"}
	var first ShopifyReturnRefundProcessResult
	requestJSON(t, http.MethodPost, httpServer.URL+"/api/v1/shops/"+shop.ID+"/shopify/returns/refund-process", adminToken, body, http.StatusOK, &first)
	if first.ReviewTicketID == "" {
		t.Fatalf("pending refund did not create a review ticket: %#v", first)
	}
	var second ShopifyReturnRefundProcessResult
	requestJSON(t, http.MethodPost, httpServer.URL+"/api/v1/shops/"+shop.ID+"/shopify/returns/refund-process", adminToken, body, http.StatusOK, &second)
	if second.ReviewTicketID != first.ReviewTicketID {
		t.Fatalf("retry created another review ticket: first=%s second=%s", first.ReviewTicketID, second.ReviewTicketID)
	}
	tickets, err := store.ListTickets(t.Context(), TicketFilter{ShopID: shop.ID})
	if err != nil || len(tickets) != 1 || tickets[0].Category != "退款复核" || tickets[0].CreatedBy != admin.ID {
		t.Fatalf("unexpected review tickets: %#v err=%v", tickets, err)
	}
}
