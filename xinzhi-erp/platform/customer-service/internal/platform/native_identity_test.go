package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestNativeIdentityLoginManagementIsolationAndRestart(t *testing.T) {
	ctx := context.Background()
	dataFile := filepath.Join(t.TempDir(), "native-fixture.json")
	factory := NewFileERPTenantStoreFactory(dataFile)
	password := "SyntheticOnly!2026"
	var member User
	for _, tenant := range []string{"native-a", "native-b"} {
		store, err := factory.StoreForTenant(ctx, tenant)
		if err != nil {
			t.Fatal(err)
		}
		server := NewServer(store)
		_, err = server.createUserFromRequest(ctx, createUserRequest{Email: "admin@example.test", DisplayName: tenant, Password: password, Role: UserRoleAdmin, SystemAdmin: true})
		if err != nil {
			t.Fatal(err)
		}
		member, err = server.createUserFromRequest(ctx, createUserRequest{Email: "agent@example.test", DisplayName: "Agent", Password: password, Role: UserRoleAgent})
		if err != nil {
			t.Fatal(err)
		}
	}
	app := NewServer(NewMemoryStore())
	mux, err := NewNativeTenantMux(app, factory, []string{"https://native.example.test"})
	if err != nil {
		t.Fatal(err)
	}
	request := func(handler http.Handler, method, path, tenant, token string, body any, status int) *httptest.ResponseRecorder {
		t.Helper()
		payload, _ := json.Marshal(body)
		req := httptest.NewRequest(method, path, bytes.NewReader(payload))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", "https://native.example.test")
		if tenant != "" {
			req.Header.Set(erpTenantHeader, tenant)
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		out := httptest.NewRecorder()
		handler.ServeHTTP(out, req)
		if out.Code != status {
			t.Fatalf("%s %s got %d, want %d: %s", method, path, out.Code, status, out.Body.String())
		}
		return out
	}
	login := func(tenant, email string) AuthResult {
		t.Helper()
		out := request(mux, "POST", "/api/v1/auth/login", tenant, "", map[string]string{"email": email, "password": password}, 200)
		var result AuthResult
		if err := json.Unmarshal(out.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if result.TenantID != tenant || !strings.HasPrefix(result.Token, nativeSessionPrefix) {
			t.Fatal("login lost native tenant/session boundary")
		}
		return result
	}
	status := request(mux, "GET", "/api/v1/bootstrap/status", "", "", nil, 200)
	if strings.Contains(status.Body.String(), "one") || !strings.Contains(status.Body.String(), `"tenantRequired":true`) {
		t.Fatal("incorrect native login metadata")
	}
	admin := login("native-a", "admin@example.test")
	request(mux, "GET", "/api/v1/users", "native-a", admin.Token, nil, 200)
	request(mux, "GET", "/api/v1/users", "native-b", admin.Token, nil, 401)
	request(mux, "GET", "/api/v1/users", "", admin.Token, nil, 401)
	request(mux, "POST", "/api/v1/auth/login", "unknown", "", map[string]string{"email": "admin@example.test", "password": password}, 401)
	if _, err := factory.ExistingStoreForTenant(ctx, "unknown"); err == nil {
		t.Fatal("unknown login created tenant")
	}
	request(mux, "POST", "/api/v1/bootstrap/admin", "native-a", "", nil, 404)
	request(mux, "POST", "/api/v1/auth/erp/entry", "native-a", "", nil, 404)
	request(mux, "GET", "/api/v1/auth/one/start", "native-a", "", nil, 404)
	request(mux, "POST", "/api/v1/auth/login", "native-a", "", map[string]string{"email": "admin@example.test", "password": "wrong"}, 401)
	created := request(mux, "POST", "/api/v1/users", "native-a", admin.Token, map[string]string{"email": "new@example.test", "displayName": "New Agent", "password": password, "role": UserRoleAgent}, 201)
	var createdUser User
	if err := json.Unmarshal(created.Body.Bytes(), &createdUser); err != nil || createdUser.ID == "" {
		t.Fatal("native admin did not create an identified local user")
	}
	newSession := login("native-a", "new@example.test")
	request(mux, "PATCH", "/api/v1/users/"+createdUser.ID, "native-a", admin.Token, map[string]string{"status": UserStatusDisabled}, 200)
	request(mux, "GET", "/api/v1/auth/me", "native-a", newSession.Token, nil, 401)
	request(mux, "POST", "/api/v1/auth/login", "native-a", "", map[string]string{"email": "new@example.test", "password": password}, 401)
	audit := request(mux, "GET", "/api/v1/users/"+createdUser.ID+"/audit-logs", "native-a", admin.Token, nil, 200)
	if !strings.Contains(audit.Body.String(), "user.created") {
		t.Fatal("native management lost account audit")
	}
	// A fresh file factory simulates process restart, not just a cached router.
	restarted, err := NewNativeTenantMux(NewServer(NewMemoryStore()), NewFileERPTenantStoreFactory(dataFile), []string{"https://native.example.test"})
	if err != nil {
		t.Fatal(err)
	}
	request(restarted, "GET", "/api/v1/auth/me", "native-a", admin.Token, nil, 200)
	request(restarted, "POST", "/api/v1/auth/logout", "native-a", admin.Token, nil, 200)
	request(restarted, "GET", "/api/v1/auth/me", "native-a", admin.Token, nil, 401)
	login("native-a", "admin@example.test")
	agent := login("native-b", "agent@example.test")
	request(mux, "POST", "/api/v1/users", "native-b", agent.Token, map[string]string{"email": "new@example.test"}, 403)
	// Old federated tokens remain data, but cannot become native credentials.
	store, _ := factory.ExistingStoreForTenant(ctx, "native-b")
	legacy := strings.Repeat("x", 43)
	_, err = store.CreateSession(ctx, Session{UserID: member.ID, TokenHash: hashSessionToken(legacy), ExpiresAt: time.Now().Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	request(mux, "GET", "/api/v1/auth/me", "native-b", legacy, nil, 401)
}
