package installations

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

type chatSetupFixture struct {
	origin        string
	matches       bool
	failure       error
	reads, writes int
	beforeReturn  func()
}

func (f *chatSetupFixture) ConfigureInstallationAppData(context.Context, string, string, shopifyconnector.CanonicalShopIdentity) error {
	f.writes++
	return nil
}
func (f *chatSetupFixture) ReadInstallationChatSetup(_ context.Context, domain, token string, owner shopifyconnector.CanonicalShopIdentity) (string, bool, error) {
	f.reads++
	if domain != "demo.myshopify.com" || token != "synthetic-access-token" || owner != identity() {
		return "", false, errors.New("wrong provider identity")
	}
	if f.beforeReturn != nil {
		f.beforeReturn()
	}
	return f.origin, f.matches, f.failure
}

func chatSetupService(t *testing.T, fixture *chatSetupFixture) (*Service, *MemoryRepository) {
	t.Helper()
	repository := NewMemoryRepository()
	now := time.Now().UTC()
	binding := Binding{Identity: identity(), LegacyShopID: "fixture-legacy", ShopDomain: "demo.myshopify.com"}
	if err := repository.CompleteInstallation(t.Context(), binding, InstallationRecord{Binding: binding, AccessToken: "synthetic-access-token", Scopes: []string{"read_products"}, State: shopifyconnector.InstallationStateInstalled, InstalledAt: now.Add(-time.Hour), UpdatedAt: now.Add(-time.Hour)}); err != nil {
		t.Fatal(err)
	}
	service := NewService(repository, []string{"read_products"}, &fakeEffects{}, &recordingExchanger{})
	if err := service.ConfigureInstallationAppData(fixture); err != nil {
		t.Fatal(err)
	}
	return service, repository
}

func TestEmbeddedChatSetupFailsClosedWithoutConfigurationOrOwnership(t *testing.T) {
	for _, tc := range []struct {
		name, domain, origin, state string
		matches                     bool
		failure                     error
	}{
		{"match", "demo.myshopify.com", "https://support-uat.example.test", "CONFIGURED", true, nil},
		{"mismatch", "demo.myshopify.com", "https://attacker.invalid", "MISMATCH", false, nil},
		{"failure", "demo.myshopify.com", "https://attacker.invalid", "UNAVAILABLE", false, errors.New("synthetic-provider-secret")},
		{"unknown owner", "other.myshopify.com", "https://support-uat.example.test", "UNAVAILABLE", true, nil},
		{"unsafe destination", "demo.myshopify.com", "https://user:password@support.example.test/path?proof=secret", "UNAVAILABLE", true, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fixture := &chatSetupFixture{origin: tc.origin, matches: tc.matches, failure: tc.failure}
			service, _ := chatSetupService(t, fixture)
			result := service.ReadEmbeddedChatSetup(t.Context(), tc.domain)
			if result.State != tc.state || result.ContractVersion != chatSetupContractVersion || fixture.writes != 0 {
				t.Fatalf("unexpected safe result: %#v", result)
			}
			if tc.state != "CONFIGURED" && result.ServiceOrigin != "" {
				t.Fatal("unverified link leaked")
			}
			if tc.name == "unknown owner" && fixture.reads != 0 {
				t.Fatal("unbound shop reached provider")
			}
		})
	}
}

func TestEmbeddedChatSetupDoesNotReturnResultAfterInstallationChanges(t *testing.T) {
	fixture := &chatSetupFixture{origin: "https://support-uat.example.test", matches: true}
	service, repository := chatSetupService(t, fixture)
	fixture.beforeReturn = func() {
		record, _ := repository.GetInstallation(t.Context(), identity())
		record.NativeLinkPending = true
		if err := repository.CompleteInstallation(t.Context(), record.Binding, record); err != nil {
			t.Fatal(err)
		}
	}
	result := service.ReadEmbeddedChatSetup(t.Context(), "demo.myshopify.com")
	if result.State != "UNAVAILABLE" || result.ServiceOrigin != "" {
		t.Fatal("stale configuration unlocked links")
	}
	fixture.beforeReturn = nil
	service.ReadEmbeddedChatSetup(t.Context(), "demo.myshopify.com")
	if fixture.reads != 1 {
		t.Fatal("incomplete native link reached provider")
	}
}

func TestEmbeddedChatSetupHTTPUsesOnlySignedIdentity(t *testing.T) {
	fixture := &chatSetupFixture{origin: "https://support-uat.example.test", matches: true}
	service, repository := chatSetupService(t, fixture)
	handler, err := NewHandler(RuntimeConfig{ServiceToken: "fixture-service", AppAPIKey: "app-key", AppSecret: "app-secret", Scopes: []string{"read_products"}, CallbackURL: "https://connector.example.test/shopify/oauth/callback"}, service, repository)
	if err != nil {
		t.Fatal(err)
	}
	token := signEmbeddedSessionToken(t, "app-key", "app-secret", "demo.myshopify.com", time.Now().UTC())
	for _, tc := range []struct {
		name, query, body, token string
		status                   int
	}{
		{"valid", "", "", token, 200},
		{"invalid jwt", "", "", token + "x", 401},
		{"query identity", "?shop=other.myshopify.com", "", token, 400},
		{"body identity", "", `{"tenantId":"other"}`, token, 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, EmbeddedChatSetupPath+tc.query, strings.NewReader(tc.body))
			request.Header.Set("Authorization", "Bearer "+tc.token)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != tc.status || response.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("status=%d", response.Code)
			}
			for _, secret := range []string{"synthetic-access-token", testTenantID, testShopID, "fixture-service"} {
				if strings.Contains(response.Body.String(), secret) {
					t.Fatal("private data leaked")
				}
			}
			if tc.status == 200 && !strings.Contains(response.Body.String(), `"serviceOrigin":"https://support-uat.example.test"`) {
				t.Fatal("verified destination missing")
			}
		})
	}
	if fixture.reads != 1 || fixture.writes != 0 {
		t.Fatalf("reads=%d writes=%d", fixture.reads, fixture.writes)
	}
}
