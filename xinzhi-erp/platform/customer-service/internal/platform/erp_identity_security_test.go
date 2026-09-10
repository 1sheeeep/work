package platform

import (
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestERPReadPermissionCannotMutateConversations(t *testing.T) {
	identity := testERPIdentity("tenant-read-only")
	identity.Shops = []ERPShop{{
		ID: "shop-1", DisplayName: "Synthetic Shop", Status: "ACTIVE",
		AuthorizationStatus: "NOT_AUTHORIZED", ChannelMode: "UNCONFIGURED",
	}}
	app := NewServer(NewMemoryStore())
	app.ConfigureAllowedOrigins([]string{testERPOrigin})
	app.ConfigureERPIdentity(&fixedERPIdentityVerifier{identity: identity}, true)
	server := httptest.NewServer(app.Routes())
	defer server.Close()

	login, err := enterERP(server.URL, "read-only", identity.TenantID, identity.SubjectID)
	if err != nil {
		t.Fatal(err)
	}
	var conversations []Conversation
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations?scope=all", login.Token, nil, http.StatusOK, &conversations)
	if len(conversations) != 1 {
		t.Fatalf("expected one synthetic conversation, got %#v", conversations)
	}
	baseURL := server.URL + "/api/v1/conversations/" + conversations[0].ID
	requestJSON(t, http.MethodPost, baseURL+"/claim", login.Token, nil, http.StatusForbidden, nil)
	requestJSON(t, http.MethodPost, baseURL+"/messages", login.Token, Message{
		Direction: MessageDirectionAgent, Body: "read-only must not reply",
	}, http.StatusForbidden, nil)
	requestJSON(t, http.MethodPost, baseURL+"/close", login.Token, nil, http.StatusForbidden, nil)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/tickets", login.Token, map[string]any{
		"title": "read-only must not create tickets",
	}, http.StatusForbidden, nil)
}

func TestERPEntryBootstrapIsNoStoreAndDoesNotEchoGrant(t *testing.T) {
	identity := testERPIdentity("tenant-secure-entry")
	app := NewServer(NewMemoryStore())
	app.ConfigureAllowedOrigins([]string{testERPOrigin})
	app.ConfigureERPIdentity(&fixedERPIdentityVerifier{identity: identity}, false)
	server := httptest.NewServer(app.Routes())
	defer server.Close()

	grant := normalizedTestGrant("sensitive-grant")
	form := "grant=" + grant + "&tenantId=" + identity.TenantID + "&userId=" + identity.SubjectID
	request, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/auth/erp/entry", strings.NewReader(form))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Origin", testERPOrigin)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	if response.StatusCode != http.StatusOK || response.Header.Get("Cache-Control") != "no-store" ||
		!strings.Contains(response.Header.Get("Content-Security-Policy"), "frame-ancestors 'none'") ||
		strings.Contains(string(body), grant) {
		t.Fatalf("unsafe entry bootstrap: status=%d headers=%#v body=%s", response.StatusCode, response.Header, body)
	}
}

func TestERPFileStoreBindingSurvivesRestartAndSessionsFailClosed(t *testing.T) {
	storePath := filepath.Join(t.TempDir(), "customer-service.json")
	firstStore, err := OpenFileStore(storePath)
	if err != nil {
		t.Fatal(err)
	}
	firstApp := NewServer(firstStore)
	firstApp.ConfigureAllowedOrigins([]string{testERPOrigin})
	firstApp.ConfigureERPIdentity(&fixedERPIdentityVerifier{identity: testERPIdentity("tenant-a")}, false)
	firstServer := httptest.NewServer(firstApp.Routes())
	firstLogin, err := enterERP(firstServer.URL, "tenant-a", "tenant-a", "user-1")
	if err != nil {
		t.Fatal(err)
	}
	firstServer.Close()

	restartedStore, err := OpenFileStore(storePath)
	if err != nil {
		t.Fatal(err)
	}
	restartedApp := NewServer(restartedStore)
	restartedApp.ConfigureAllowedOrigins([]string{testERPOrigin})
	restartedApp.ConfigureERPIdentity(&fixedERPIdentityVerifier{identity: testERPIdentity("tenant-a")}, false)
	restartedServer := httptest.NewServer(restartedApp.Routes())
	defer restartedServer.Close()
	requestJSON(t, http.MethodGet, restartedServer.URL+"/api/v1/auth/me", firstLogin.Token, nil, http.StatusUnauthorized, nil)
	boundTenantID, err := restartedStore.GetERPTenantBinding(t.Context())
	if err != nil || boundTenantID != "tenant-a" {
		t.Fatalf("persistent tenant binding changed: tenant=%q err=%v", boundTenantID, err)
	}
}

func TestERPBindingRejectsNonEmptyUnboundStore(t *testing.T) {
	store := NewMemoryStore()
	if _, err := store.CreateShop(t.Context(), Shop{DisplayName: "legacy shop"}); err != nil {
		t.Fatalf("seed legacy store: %v", err)
	}
	if err := store.BindERPTenant(t.Context(), "tenant-a"); err == nil {
		t.Fatal("expected non-empty unbound store to fail closed")
	}
}

func TestHTTPERPIdentityVerifierConfigurationFailsClosed(t *testing.T) {
	for _, test := range []struct {
		baseURL string
		token   string
		origin  string
	}{
		{baseURL: "http://erp.example.test", token: "service", origin: "https://customer.example.test"},
		{baseURL: "https://erp.example.test", token: "", origin: "https://customer.example.test"},
		{baseURL: "https://erp.example.test", token: "service", origin: "http://customer.example.test"},
	} {
		if _, err := NewHTTPERPIdentityVerifier(test.baseURL, test.token, test.origin, nil); err == nil {
			t.Fatalf("unsafe configuration was accepted: %#v", test)
		}
	}
}
