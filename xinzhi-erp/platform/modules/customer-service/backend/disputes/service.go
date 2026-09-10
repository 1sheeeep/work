package disputes

import (
	"context"
	"errors"
	"strings"

	"xz-erp/customer-service-module/connectorclient"
)

const (
	ReadDisputesCapability = "customer-service.disputes.read"
)

type Actor struct {
	TenantID      string
	ShopID        string
	UserID        string
	CorrelationID string
	RequestID     string
}

type CatalogQuery struct {
	Limit  int
	Cursor string
}

type Authorizer interface {
	Require(context.Context, Actor, string) error
}

type Connector interface {
	FetchDisputes(context.Context, connectorclient.DisputeCatalogRequest) (connectorclient.DisputeCatalogPage, error)
}

type Service struct {
	authorizer Authorizer
	connector  Connector
}

func NewService(authorizer Authorizer, connector Connector) (*Service, error) {
	if authorizer == nil || connector == nil {
		return nil, errors.New("dispute service dependencies are required")
	}
	return &Service{authorizer: authorizer, connector: connector}, nil
}

func (s *Service) Catalog(ctx context.Context, actor Actor, query CatalogQuery) (connectorclient.DisputeCatalogPage, error) {
	if err := validateActor(actor); err != nil {
		return connectorclient.DisputeCatalogPage{}, err
	}
	if err := s.authorizer.Require(ctx, actor, ReadDisputesCapability); err != nil {
		return connectorclient.DisputeCatalogPage{}, err
	}
	return s.connector.FetchDisputes(ctx, connectorclient.DisputeCatalogRequest{
		Identity: identity(actor), Context: requestContext(actor), Limit: query.Limit, Cursor: query.Cursor,
	})
}

func validateActor(actor Actor) error {
	if strings.TrimSpace(actor.UserID) == "" || len(actor.UserID) > 128 {
		return errors.New("customer-service actor is invalid")
	}
	return nil
}

func identity(actor Actor) connectorclient.ShopIdentity {
	return connectorclient.ShopIdentity{TenantID: actor.TenantID, ShopID: actor.ShopID}
}

func requestContext(actor Actor) connectorclient.RequestContext {
	return connectorclient.RequestContext{CorrelationID: actor.CorrelationID, RequestID: actor.RequestID}
}
