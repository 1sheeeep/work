package installations

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

func TestServiceConnectionProbeReportsOnlyConnectorOwnedInstallationFacts(t *testing.T) {
	now := time.Date(2026, 8, 1, 18, 0, 0, 0, time.UTC)
	repository := NewMemoryRepository()
	service := NewService(repository, []string{"read_orders"}, &fakeEffects{}, &recordingExchanger{})
	service.now = func() time.Time { return now }
	request := shopifyconnector.ConnectionProbeRequest{Identity: identity(), Context: requestContext("connection-v3")}

	missing, err := service.ProbeConnection(t.Context(), request)
	if err != nil || missing.ContractVersion != shopifyconnector.ContractVersion ||
		missing.State != shopifyconnector.ConnectionStateNotConfigured || !missing.CheckedAt.Equal(now) || len(missing.GrantedScopes) != 0 {
		t.Fatalf("missing installation probe mismatch: %#v err=%v", missing, err)
	}
	binding := Binding{Identity: identity(), LegacyShopID: "legacy-shop", ShopDomain: "demo.myshopify.com"}
	if err := repository.CompleteInstallation(t.Context(), binding, InstallationRecord{
		Binding: binding, AccessToken: "shpat_connector_owned_token",
		ShopName: "Demo Store",
		Scopes:   []string{"write_orders", "read_orders", "read_orders"},
		State:    shopifyconnector.InstallationStateInstalled, InstalledAt: now.Add(-time.Hour), UpdatedAt: now.Add(-time.Hour),
	}); err != nil {
		t.Fatalf("seed installation failed: %v", err)
	}
	connected, err := service.ProbeConnection(t.Context(), request)
	if err != nil || connected.State != shopifyconnector.ConnectionStateConnected ||
		strings.Join(connected.GrantedScopes, ",") != "read_orders,write_orders" ||
		connected.ShopName != "Demo Store" || connected.ShopDomain != "demo.myshopify.com" ||
		!connected.CheckedAt.Equal(now) {
		t.Fatalf("installed connection probe mismatch: %#v err=%v", connected, err)
	}
	raw, err := json.Marshal(connected)
	if err != nil {
		t.Fatalf("marshal connection summary: %v", err)
	}
	for _, forbidden := range []string{"capabilities", "themeEmbed", "adminApi", "shpat_", "token"} {
		if strings.Contains(strings.ToLower(string(raw)), strings.ToLower(forbidden)) {
			t.Fatalf("connection.v3 exposed forbidden fact %q: %s", forbidden, raw)
		}
	}
	if _, _, err := repository.MarkRevoked(t.Context(), identity(), now); err != nil {
		t.Fatalf("MarkRevoked failed: %v", err)
	}
	disconnected, err := service.ProbeConnection(t.Context(), request)
	if err != nil || disconnected.State != shopifyconnector.ConnectionStateDisconnected ||
		strings.Join(disconnected.GrantedScopes, ",") != "read_orders,write_orders" || !disconnected.CheckedAt.Equal(now) {
		t.Fatalf("revoked connection probe mismatch: %#v err=%v", disconnected, err)
	}
}

func TestServiceConnectionProbeFailsClosedForInconsistentRepositoryRecord(t *testing.T) {
	request := shopifyconnector.ConnectionProbeRequest{Identity: identity(), Context: requestContext("inconsistent-connection")}
	binding := Binding{Identity: identity(), LegacyShopID: "legacy-shop", ShopDomain: "demo.myshopify.com"}
	recordTime := time.Date(2026, 8, 1, 17, 0, 0, 0, time.UTC)
	for name, record := range map[string]InstallationRecord{
		"installed without credential": {Binding: binding, State: shopifyconnector.InstallationStateInstalled, Scopes: []string{"read_orders"}},
		"installed without scopes":     {Binding: binding, State: shopifyconnector.InstallationStateInstalled, AccessToken: "shpat_connector_owned_token"},
		"revoked with credential":      {Binding: binding, State: shopifyconnector.InstallationStateRevoked, AccessToken: "shpat_connector_owned_token"},
		"revoked without scopes": {
			Binding: binding, State: shopifyconnector.InstallationStateRevoked,
			InstalledAt: recordTime.Add(-time.Hour), RevokedAt: recordTime, UpdatedAt: recordTime,
		},
		"unknown state": {Binding: binding, State: shopifyconnector.InstallationState("BROKEN")},
	} {
		t.Run(name, func(t *testing.T) {
			current := NewMemoryRepository()
			currentService := NewService(current, nil, &fakeEffects{}, &recordingExchanger{})
			if err := current.CompleteInstallation(t.Context(), binding, record); err != nil {
				t.Fatalf("seed inconsistent record: %v", err)
			}
			_, err := currentService.ProbeConnection(t.Context(), request)
			var safeErr *shopifyconnector.ConnectionProbeError
			if !errors.As(err, &safeErr) || safeErr.Code != shopifyconnector.ErrorCodeUnavailable {
				t.Fatalf("inconsistent record did not fail safely: %T %v", err, err)
			}
		})
	}
}

func TestServiceConnectionProbeFailsClosedForRepositoryFailureAndMissingConfiguration(t *testing.T) {
	request := shopifyconnector.ConnectionProbeRequest{Identity: identity(), Context: requestContext("repository-failure")}
	services := map[string]*Service{
		"missing repository": NewService(nil, nil, &fakeEffects{}, &recordingExchanger{}),
		"repository failure": NewService(connectionProbeFailingRepository{
			Repository: NewMemoryRepository(),
			err:        errors.New("repository unavailable shpat_internal_fixture_secret"),
		}, nil, &fakeEffects{}, &recordingExchanger{}),
	}
	for name, service := range services {
		t.Run(name, func(t *testing.T) {
			_, err := service.ProbeConnection(t.Context(), request)
			var safeErr *shopifyconnector.ConnectionProbeError
			if !errors.As(err, &safeErr) || safeErr.Code != shopifyconnector.ErrorCodeUnavailable {
				t.Fatalf("repository failure did not fail closed: %T %v", err, err)
			}
			if strings.Contains(err.Error(), "fixture_secret") || strings.Contains(err.Error(), "repository unavailable") {
				t.Fatalf("repository failure leaked internal detail: %v", err)
			}
		})
	}
}

type connectionProbeFailingRepository struct {
	Repository
	err error
}

func (r connectionProbeFailingRepository) GetInstallation(
	context.Context,
	shopifyconnector.CanonicalShopIdentity,
) (InstallationRecord, error) {
	return InstallationRecord{}, r.err
}

func TestHTTPRuntimeConnectionProbeRequiresServiceTokenAndReturnsV3(t *testing.T) {
	repository := NewMemoryRepository()
	now := time.Date(2026, 8, 1, 18, 30, 0, 0, time.UTC)
	binding := Binding{Identity: identity(), LegacyShopID: "legacy-shop", ShopDomain: "demo.myshopify.com"}
	if err := repository.CompleteInstallation(t.Context(), binding, InstallationRecord{
		Binding: binding, AccessToken: "shpat_connector_owned_token", Scopes: []string{"read_orders"},
		State: shopifyconnector.InstallationStateInstalled, InstalledAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("seed installation: %v", err)
	}
	service := NewService(repository, []string{"read_orders"}, &fakeEffects{}, &recordingExchanger{})
	service.now = func() time.Time { return now }
	handler, err := NewHandler(RuntimeConfig{
		ServiceToken: "service-token", AppAPIKey: "app-key", AppSecret: "app-secret",
		Scopes: []string{"read_orders"}, CallbackURL: "https://connector.example/shopify/oauth/callback",
	}, service, repository)
	if err != nil {
		t.Fatalf("NewHandler failed: %v", err)
	}
	body := encodeJSON(t, shopifyconnector.ConnectionProbeRequest{Identity: identity(), Context: requestContext("runtime-connection")})

	unauthorized := httptest.NewRequest(http.MethodPost, ConnectionProbePath, bytes.NewReader(body))
	unauthorizedResponse := httptest.NewRecorder()
	handler.ServeHTTP(unauthorizedResponse, unauthorized)
	if unauthorizedResponse.Code != http.StatusForbidden {
		t.Fatalf("unauthorized connection probe status=%d", unauthorizedResponse.Code)
	}
	authorized := httptest.NewRequest(http.MethodPost, ConnectionProbePath, bytes.NewReader(body))
	authorized.Header.Set(ServiceTokenHeader, "service-token")
	authorizedResponse := httptest.NewRecorder()
	handler.ServeHTTP(authorizedResponse, authorized)
	if authorizedResponse.Code != http.StatusOK {
		t.Fatalf("authorized connection probe status=%d body=%s", authorizedResponse.Code, authorizedResponse.Body.String())
	}
	var summary shopifyconnector.ConnectionSummary
	if err := json.Unmarshal(authorizedResponse.Body.Bytes(), &summary); err != nil ||
		summary.ContractVersion != "shopify.connector.connection.v3" || summary.State != shopifyconnector.ConnectionStateConnected {
		t.Fatalf("runtime response mismatch: %#v err=%v", summary, err)
	}
}
