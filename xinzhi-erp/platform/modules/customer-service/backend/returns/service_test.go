package returns

import (
	"context"
	"errors"
	"testing"
	"time"

	"xz-erp/customer-service-module/connectorclient"
)

type recordingAuthorizer struct {
	err        error
	capability string
}

func (a *recordingAuthorizer) Require(_ context.Context, _ Actor, capability string) error {
	a.capability = capability
	return a.err
}

type recordingConnector struct {
	request        connectorclient.ReturnDecisionRequest
	catalogRequest connectorclient.ReturnCatalogRequest
	calls          int
}

func (c *recordingConnector) FetchReturns(_ context.Context, request connectorclient.ReturnCatalogRequest) (connectorclient.ReturnCatalogPage, error) {
	c.calls++
	c.catalogRequest = request
	now := time.Now().UTC()
	return connectorclient.ReturnCatalogPage{
		ContractVersion: connectorclient.ReturnCatalogContractVersion,
		TenantID:        request.Identity.TenantID, ShopID: request.Identity.ShopID,
		State: connectorclient.CatalogStateConnected, Returns: []connectorclient.ReturnCatalogItem{}, FetchedAt: &now,
	}, nil
}

func (c *recordingConnector) DecideReturn(_ context.Context, request connectorclient.ReturnDecisionRequest) (connectorclient.ReturnDecisionResult, error) {
	c.calls++
	c.request = request
	return connectorclient.ReturnDecisionResult{
		ContractVersion: connectorclient.ReturnDecisionContractVersion,
		TenantID:        request.Identity.TenantID, ShopID: request.Identity.ShopID,
		ReturnID: request.ReturnID, Status: "OPEN", UpdatedAt: time.Now().UTC(),
	}, nil
}

func (c *recordingConnector) PreviewReturnRefund(_ context.Context, request connectorclient.ReturnRefundPreviewRequest) (connectorclient.ReturnRefundPreview, error) {
	c.calls++
	now := time.Now().UTC()
	expires := now.Add(10 * time.Minute)
	return connectorclient.ReturnRefundPreview{
		ContractVersion: connectorclient.ReturnRefundPreviewContractVersion,
		TenantID:        request.Identity.TenantID, ShopID: request.Identity.ShopID, ReturnID: request.ReturnID,
		State: connectorclient.ReturnRefundPreviewRefundable, LineItems: request.LineItems,
		RefundAmount:      connectorclient.ReturnRefundMoneyBag{ShopMoney: connectorclient.Money{Amount: "10.00", CurrencyCode: "USD"}, PresentmentMoney: connectorclient.Money{Amount: "10.00", CurrencyCode: "USD"}},
		MaximumRefundable: connectorclient.ReturnRefundMoneyBag{ShopMoney: connectorclient.Money{Amount: "10.00", CurrencyCode: "USD"}, PresentmentMoney: connectorclient.Money{Amount: "10.00", CurrencyCode: "USD"}},
		Transactions:      []connectorclient.ReturnRefundTransaction{{ParentTransactionID: "gid://shopify/OrderTransaction/30", Amount: connectorclient.ReturnRefundMoneyBag{ShopMoney: connectorclient.Money{Amount: "10.00", CurrencyCode: "USD"}, PresentmentMoney: connectorclient.Money{Amount: "10.00", CurrencyCode: "USD"}}}},
		PreviewToken:      "01234567890123456789012345678901", ExpiresAt: &expires, FetchedAt: now,
	}, nil
}

func (c *recordingConnector) ProcessReturnRefund(_ context.Context, request connectorclient.ReturnRefundProcessRequest) (connectorclient.ReturnRefundProcessResult, error) {
	c.calls++
	amount := connectorclient.ReturnRefundMoneyBag{ShopMoney: connectorclient.Money{Amount: "10.00", CurrencyCode: "USD"}, PresentmentMoney: connectorclient.Money{Amount: "10.00", CurrencyCode: "USD"}}
	return connectorclient.ReturnRefundProcessResult{
		ContractVersion: connectorclient.ReturnRefundProcessContractVersion,
		TenantID:        request.Identity.TenantID, ShopID: request.Identity.ShopID, ReturnID: request.ReturnID,
		ReturnStatus: "CLOSED", Outcome: connectorclient.ReturnRefundProcessApplied, RefundAmount: amount,
		Transactions: []connectorclient.ReturnRefundProcessedTransaction{{ID: "gid://shopify/OrderTransaction/31", ParentTransactionID: "gid://shopify/OrderTransaction/30", Status: "SUCCESS", Amount: amount}},
		UpdatedAt:    time.Now().UTC(),
	}, nil
}

func TestServiceAuthorizesAndForwardsScopedDecision(t *testing.T) {
	t.Parallel()
	authorizer := &recordingAuthorizer{}
	connector := &recordingConnector{}
	service, err := NewService(authorizer, connector)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	actor := Actor{
		TenantID: "11111111-1111-4111-8111-111111111111",
		ShopID:   "22222222-2222-4222-8222-222222222222",
		UserID:   "user-1", CorrelationID: "correlation-1", RequestID: "request-1",
	}
	result, err := service.Decide(context.Background(), actor, DecisionCommand{
		ReturnID: "gid://shopify/Return/10", Decision: connectorclient.ReturnDecisionApprove,
		NotifyCustomer: true, IdempotencyKey: "return-decision-1",
	})
	if err != nil {
		t.Fatalf("decide: %v", err)
	}
	if authorizer.capability != ManageReturnsCapability || connector.calls != 1 ||
		connector.request.Identity.TenantID != actor.TenantID || result.Status != "OPEN" {
		t.Fatalf("unexpected forwarding: capability=%s request=%#v result=%#v", authorizer.capability, connector.request, result)
	}
}

func TestServiceAuthorizesAndForwardsReturnCatalog(t *testing.T) {
	t.Parallel()
	authorizer := &recordingAuthorizer{}
	connector := &recordingConnector{}
	service, err := NewService(authorizer, connector)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	actor := Actor{TenantID: "11111111-1111-4111-8111-111111111111", ShopID: "22222222-2222-4222-8222-222222222222", UserID: "user-1", CorrelationID: "correlation-1", RequestID: "request-1"}
	page, err := service.Catalog(context.Background(), actor, CatalogQuery{Limit: 50, Query: "name:1001"})
	if err != nil || page.State != connectorclient.CatalogStateConnected || connector.catalogRequest.Query != "name:1001" || authorizer.capability != ManageReturnsCapability {
		t.Fatalf("unexpected catalog: %#v err=%v request=%#v capability=%s", page, err, connector.catalogRequest, authorizer.capability)
	}
}

func TestServiceStopsBeforeConnectorWhenForbidden(t *testing.T) {
	t.Parallel()
	authorizer := &recordingAuthorizer{err: errors.New("forbidden")}
	connector := &recordingConnector{}
	service, err := NewService(authorizer, connector)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	_, err = service.Decide(context.Background(), Actor{UserID: "user-1"}, DecisionCommand{})
	if err == nil || connector.calls != 0 {
		t.Fatalf("expected authorization failure before connector, got %v calls=%d", err, connector.calls)
	}
}

func TestServiceAuthorizesRefundPreviewWithoutAcceptingMoney(t *testing.T) {
	t.Parallel()
	authorizer := &recordingAuthorizer{}
	connector := &recordingConnector{}
	service, err := NewService(authorizer, connector)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	actor := Actor{TenantID: "11111111-1111-4111-8111-111111111111", ShopID: "22222222-2222-4222-8222-222222222222", UserID: "user-1", CorrelationID: "correlation-1", RequestID: "request-1"}
	preview, err := service.PreviewRefund(context.Background(), actor, RefundPreviewCommand{
		ReturnID: "gid://shopify/Return/10", LineItems: []connectorclient.ReturnRefundLineSelection{{ReturnLineID: "gid://shopify/ReturnLineItem/20", Quantity: 1}},
	})
	if err != nil || preview.RefundAmount.PresentmentMoney.Amount != "10.00" || authorizer.capability != ManageReturnsCapability || connector.calls != 1 {
		t.Fatalf("unexpected refund preview: %#v err=%v capability=%s calls=%d", preview, err, authorizer.capability, connector.calls)
	}
}

func TestServiceProcessesOnlyConfirmedPreview(t *testing.T) {
	t.Parallel()
	authorizer := &recordingAuthorizer{}
	connector := &recordingConnector{}
	service, err := NewService(authorizer, connector)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	actor := Actor{TenantID: "11111111-1111-4111-8111-111111111111", ShopID: "22222222-2222-4222-8222-222222222222", UserID: "user-1", CorrelationID: "correlation-1", RequestID: "request-1"}
	result, err := service.ProcessRefund(context.Background(), actor, RefundProcessCommand{
		ReturnID: "gid://shopify/Return/10", LineItems: []connectorclient.ReturnRefundLineSelection{{ReturnLineID: "gid://shopify/ReturnLineItem/20", Quantity: 1}},
		PreviewToken: "01234567890123456789012345678901", NotifyCustomer: true, IdempotencyKey: "refund-1",
	})
	if err != nil || result.Outcome != connectorclient.ReturnRefundProcessApplied || authorizer.capability != ManageReturnsCapability || connector.calls != 1 {
		t.Fatalf("unexpected refund process: %#v err=%v capability=%s calls=%d", result, err, authorizer.capability, connector.calls)
	}
}
