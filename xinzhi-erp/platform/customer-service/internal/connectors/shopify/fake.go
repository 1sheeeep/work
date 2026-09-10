package shopify

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

type FakeScenario struct {
	Identity        CanonicalShopIdentity
	State           ConnectionState
	CheckedAt       time.Time
	GrantedScopes   []string
	ProviderFailure error
}

type FakeAdapter struct {
	mu        sync.RWMutex
	scenarios map[string]FakeScenario
}

func NewFakeAdapter(scenarios ...FakeScenario) (*FakeAdapter, error) {
	adapter := &FakeAdapter{scenarios: make(map[string]FakeScenario, len(scenarios))}
	for _, scenario := range scenarios {
		request := ConnectionProbeRequest{
			Identity: scenario.Identity,
			Context: RequestContext{
				CorrelationID: "fake-fixture",
				RequestID:     "fake-fixture",
			},
		}
		if err := ValidateRequest(request); err != nil {
			return nil, fmt.Errorf("invalid fake Shopify connector identity: %w", err)
		}
		switch scenario.State {
		case ConnectionStateNotConfigured, ConnectionStateDisconnected, ConnectionStateConnected:
		default:
			return nil, fmt.Errorf("invalid fake Shopify connector state %q", scenario.State)
		}
		if scenario.ProviderFailure == nil {
			var summary ConnectionSummary
			switch scenario.State {
			case ConnectionStateConnected:
				summary = ConnectedSummary(request, scenario.CheckedAt, scenario.GrantedScopes)
			case ConnectionStateDisconnected:
				summary = DisconnectedSummary(request, scenario.CheckedAt, scenario.GrantedScopes)
			default:
				summary = NotConfiguredSummary(request, scenario.CheckedAt)
			}
			if err := ValidateConnectionSummary(request, summary); err != nil {
				return nil, errors.New("invalid fake Shopify connection.v3 scenario")
			}
		}
		key := identityKey(scenario.Identity)
		if _, exists := adapter.scenarios[key]; exists {
			return nil, errors.New("duplicate fake Shopify connector identity")
		}
		adapter.scenarios[key] = scenario
	}
	return adapter, nil
}

func (a *FakeAdapter) ProbeConnection(
	ctx context.Context,
	request ConnectionProbeRequest,
) (ConnectionSummary, error) {
	if err := ValidateRequest(request); err != nil {
		safeErr := InvalidRequestError(request)
		return ConnectionSummary{}, safeErr
	}
	if err := ctx.Err(); err != nil {
		safeErr := SafeErrorFor(request, err)
		return ConnectionSummary{}, safeErr
	}

	a.mu.RLock()
	scenario, configured := a.scenarios[identityKey(request.Identity)]
	a.mu.RUnlock()
	if !configured {
		return NotConfiguredSummary(request, time.Now().UTC()), nil
	}
	if scenario.ProviderFailure != nil {
		safeErr := SafeErrorFor(request, scenario.ProviderFailure)
		return ConnectionSummary{}, safeErr
	}

	switch scenario.State {
	case ConnectionStateConnected:
		return ConnectedSummary(request, scenario.CheckedAt, scenario.GrantedScopes), nil
	case ConnectionStateDisconnected:
		return DisconnectedSummary(request, scenario.CheckedAt, scenario.GrantedScopes), nil
	default:
		return NotConfiguredSummary(request, scenario.CheckedAt), nil
	}
}

func identityKey(identity CanonicalShopIdentity) string {
	return identity.TenantID + "\x00" + identity.ShopID
}

var _ ConnectionProbe = (*FakeAdapter)(nil)
