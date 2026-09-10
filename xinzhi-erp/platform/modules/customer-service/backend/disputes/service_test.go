package disputes

import (
	"context"
	"errors"
	"testing"
	"time"

	"xz-erp/customer-service-module/connectorclient"
)

type recordingAuthorizer struct {
	err          error
	capabilities []string
}

func (a *recordingAuthorizer) Require(_ context.Context, _ Actor, capability string) error {
	a.capabilities = append(a.capabilities, capability)
	return a.err
}

type recordingConnector struct {
	catalogRequest connectorclient.DisputeCatalogRequest
	calls          int
}

func (c *recordingConnector) FetchDisputes(_ context.Context, request connectorclient.DisputeCatalogRequest) (connectorclient.DisputeCatalogPage, error) {
	c.calls++
	c.catalogRequest = request
	now := time.Now().UTC()
	return connectorclient.DisputeCatalogPage{ContractVersion: connectorclient.DisputeCatalogContractVersion, TenantID: request.Identity.TenantID, ShopID: request.Identity.ShopID, State: connectorclient.CatalogStateConnected, Disputes: []connectorclient.Dispute{}, FetchedAt: &now}, nil
}

func TestServiceRequiresReadCapability(t *testing.T) {
	t.Parallel()
	authorizer := &recordingAuthorizer{}
	connector := &recordingConnector{}
	service, err := NewService(authorizer, connector)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	actor := Actor{TenantID: "11111111-1111-4111-8111-111111111111", ShopID: "22222222-2222-4222-8222-222222222222", UserID: "agent-1", CorrelationID: "correlation-1", RequestID: "request-1"}
	if _, err := service.Catalog(context.Background(), actor, CatalogQuery{Limit: 50}); err != nil {
		t.Fatalf("catalog: %v", err)
	}
	if len(authorizer.capabilities) != 1 || authorizer.capabilities[0] != ReadDisputesCapability || connector.calls != 1 || connector.catalogRequest.Identity.TenantID != actor.TenantID {
		t.Fatalf("unexpected forwarding: capabilities=%v connector=%#v", authorizer.capabilities, connector)
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
	_, err = service.Catalog(context.Background(), Actor{UserID: "agent-1"}, CatalogQuery{Limit: 50})
	if err == nil || connector.calls != 0 {
		t.Fatalf("expected authorization failure before connector, got %v calls=%d", err, connector.calls)
	}
}
