package returns

import (
	"context"
	"errors"
	"strings"

	"xz-erp/customer-service-module/connectorclient"
)

const ManageReturnsCapability = "customer-service.returns-refunds.manage"

type Actor struct {
	TenantID      string
	ShopID        string
	UserID        string
	CorrelationID string
	RequestID     string
}

type DecisionCommand struct {
	ReturnID       string
	Decision       connectorclient.ReturnDecision
	DeclineReason  connectorclient.ReturnDeclineReason
	DeclineNote    string
	NotifyCustomer bool
	IdempotencyKey string
}

type Authorizer interface {
	Require(context.Context, Actor, string) error
}

type ReturnDecisionConnector interface {
	FetchReturns(context.Context, connectorclient.ReturnCatalogRequest) (connectorclient.ReturnCatalogPage, error)
	DecideReturn(context.Context, connectorclient.ReturnDecisionRequest) (connectorclient.ReturnDecisionResult, error)
	PreviewReturnRefund(context.Context, connectorclient.ReturnRefundPreviewRequest) (connectorclient.ReturnRefundPreview, error)
	ProcessReturnRefund(context.Context, connectorclient.ReturnRefundProcessRequest) (connectorclient.ReturnRefundProcessResult, error)
}

type CatalogQuery struct {
	Limit  int
	Cursor string
	Query  string
}

func (s *Service) Catalog(ctx context.Context, actor Actor, query CatalogQuery) (connectorclient.ReturnCatalogPage, error) {
	if strings.TrimSpace(actor.UserID) == "" || len(actor.UserID) > 128 {
		return connectorclient.ReturnCatalogPage{}, errors.New("customer-service actor is invalid")
	}
	if err := s.authorizer.Require(ctx, actor, ManageReturnsCapability); err != nil {
		return connectorclient.ReturnCatalogPage{}, err
	}
	return s.connector.FetchReturns(ctx, connectorclient.ReturnCatalogRequest{
		Identity: connectorclient.ShopIdentity{TenantID: actor.TenantID, ShopID: actor.ShopID},
		Context:  connectorclient.RequestContext{CorrelationID: actor.CorrelationID, RequestID: actor.RequestID},
		Limit:    query.Limit, Cursor: query.Cursor, Query: query.Query,
	})
}

type Service struct {
	authorizer Authorizer
	connector  ReturnDecisionConnector
}

func NewService(authorizer Authorizer, connector ReturnDecisionConnector) (*Service, error) {
	if authorizer == nil || connector == nil {
		return nil, errors.New("return service dependencies are required")
	}
	return &Service{authorizer: authorizer, connector: connector}, nil
}

func (s *Service) Decide(ctx context.Context, actor Actor, command DecisionCommand) (connectorclient.ReturnDecisionResult, error) {
	if strings.TrimSpace(actor.UserID) == "" || len(actor.UserID) > 128 {
		return connectorclient.ReturnDecisionResult{}, errors.New("customer-service actor is invalid")
	}
	if err := s.authorizer.Require(ctx, actor, ManageReturnsCapability); err != nil {
		return connectorclient.ReturnDecisionResult{}, err
	}
	return s.connector.DecideReturn(ctx, connectorclient.ReturnDecisionRequest{
		Identity: connectorclient.ShopIdentity{
			TenantID: actor.TenantID,
			ShopID:   actor.ShopID,
		},
		Context: connectorclient.RequestContext{
			CorrelationID: actor.CorrelationID,
			RequestID:     actor.RequestID,
		},
		ReturnID: command.ReturnID, Decision: command.Decision,
		DeclineReason: command.DeclineReason, DeclineNote: command.DeclineNote,
		NotifyCustomer: command.NotifyCustomer,
		IdempotencyKey: command.IdempotencyKey,
	})
}

type RefundPreviewCommand struct {
	ReturnID       string
	LineItems      []connectorclient.ReturnRefundLineSelection
	RefundShipping bool
	RefundDuties   []connectorclient.ReturnRefundDutySelection
}

func (s *Service) PreviewRefund(ctx context.Context, actor Actor, command RefundPreviewCommand) (connectorclient.ReturnRefundPreview, error) {
	if strings.TrimSpace(actor.UserID) == "" || len(actor.UserID) > 128 {
		return connectorclient.ReturnRefundPreview{}, errors.New("customer-service actor is invalid")
	}
	if err := s.authorizer.Require(ctx, actor, ManageReturnsCapability); err != nil {
		return connectorclient.ReturnRefundPreview{}, err
	}
	return s.connector.PreviewReturnRefund(ctx, connectorclient.ReturnRefundPreviewRequest{
		Identity: connectorclient.ShopIdentity{TenantID: actor.TenantID, ShopID: actor.ShopID},
		Context:  connectorclient.RequestContext{CorrelationID: actor.CorrelationID, RequestID: actor.RequestID},
		ReturnID: command.ReturnID, LineItems: command.LineItems,
		RefundShipping: command.RefundShipping, RefundDuties: command.RefundDuties,
	})
}

type RefundProcessCommand struct {
	ReturnID       string
	LineItems      []connectorclient.ReturnRefundLineSelection
	RefundShipping bool
	RefundDuties   []connectorclient.ReturnRefundDutySelection
	PreviewToken   string
	NotifyCustomer bool
	IdempotencyKey string
}

func (s *Service) ProcessRefund(ctx context.Context, actor Actor, command RefundProcessCommand) (connectorclient.ReturnRefundProcessResult, error) {
	if strings.TrimSpace(actor.UserID) == "" || len(actor.UserID) > 128 {
		return connectorclient.ReturnRefundProcessResult{}, errors.New("customer-service actor is invalid")
	}
	if err := s.authorizer.Require(ctx, actor, ManageReturnsCapability); err != nil {
		return connectorclient.ReturnRefundProcessResult{}, err
	}
	return s.connector.ProcessReturnRefund(ctx, connectorclient.ReturnRefundProcessRequest{
		Identity: connectorclient.ShopIdentity{TenantID: actor.TenantID, ShopID: actor.ShopID},
		Context:  connectorclient.RequestContext{CorrelationID: actor.CorrelationID, RequestID: actor.RequestID},
		ReturnID: command.ReturnID, LineItems: command.LineItems,
		RefundShipping: command.RefundShipping, RefundDuties: command.RefundDuties, PreviewToken: command.PreviewToken,
		NotifyCustomer: command.NotifyCustomer, IdempotencyKey: command.IdempotencyKey,
	})
}
