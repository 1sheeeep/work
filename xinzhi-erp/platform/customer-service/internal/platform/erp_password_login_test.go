package platform

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestERPPasswordLoginUsesExistingAccountAndPreservesSeat(t *testing.T) {
	fixture := newERPPasswordFixture(t, "success")
	response := fixture.login(t, `{"tenantCode":"demo","loginIdentifier":"agent@example.test","password":"synthetic-password"}`, "https://chat.example.test")
	if response.Code != 200 || !strings.Contains(response.Header().Get("Content-Type"), "application/json") || response.Header().Get("Location") != "" || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("login should return a non-redirecting, non-cacheable JSON session: %d", response.Code)
	}
	var result AuthResult
	if json.Unmarshal(response.Body.Bytes(), &result) != nil || result.Token == "" || result.TenantID != "tenant-login" || result.IntegrationMode != erpIdentityExchangeMode {
		t.Fatal("expected a customer-service session")
	}
	if result.User.DisplayName != "Existing seat" || result.User.ReceptionLimit != 17 || containsPermission(result.User.Permissions, PermissionUsersManage) {
		t.Fatal("login changed the existing seat or permissions")
	}
	for _, sensitive := range []string{"synthetic-password", "synthetic-erp-bearer", "synthetic-service-token", strings.Repeat("a", 43), "accessToken", "entryProof"} {
		if strings.Contains(response.Body.String(), sensitive) {
			t.Fatal("login response exposed an upstream credential")
		}
	}
	if fixture.cleanup != 0 || fixture.redeems != 1 {
		t.Fatal("unexpected grant or parent-session lifecycle")
	}
	request := httptest.NewRequest("GET", "/api/v1/auth/me", nil)
	request.Header.Set("Authorization", "Bearer "+result.Token)
	request.Header.Set(erpTenantHeader, result.TenantID)
	me := httptest.NewRecorder()
	fixture.mux.ServeHTTP(me, request)
	if me.Code != 200 {
		t.Fatalf("new session cannot access its seat: %d", me.Code)
	}
	server := fixture.mux.existingServerForTenant(result.TenantID)
	server.erpSessionMu.Lock()
	identity := server.erpSessionIdentities[hashSessionToken(result.Token)]
	identity.ValidatedAt = time.Time{}
	server.erpSessionIdentities[hashSessionToken(result.Token)] = identity
	server.erpSessionMu.Unlock()
	fixture.revoked = true
	me = httptest.NewRecorder()
	fixture.mux.ServeHTTP(me, request)
	if me.Code != 401 {
		t.Fatal("ERP revocation did not invalidate the customer-service session")
	}
}

func TestERPPasswordLoginFailsClosed(t *testing.T) {
	for _, tc := range []struct {
		mode    string
		status  int
		cleanup int
	}{
		{"wrong password", 401, 0}, {"throttled", 429, 0}, {"redirect", 503, 0},
		{"missing CHAT", 403, 1}, {"wrong tenant", 503, 1}, {"wrong grant owner", 503, 1},
		{"wrong grant target", 503, 1}, {"expired grant", 503, 1}, {"wrong redeemed owner", 403, 1},
		{"system admin", 403, 1}, {"missing permission", 503, 1}, {"unprovisioned", 403, 1},
		{"disabled seat", 403, 1}, {"provider failure", 503, 0},
	} {
		t.Run(tc.mode, func(t *testing.T) {
			fixture := newERPPasswordFixture(t, tc.mode)
			response := fixture.login(t, `{"tenantCode":"demo","loginIdentifier":"agent@example.test","password":"synthetic-password"}`, "https://chat.example.test")
			if response.Code != tc.status || fixture.cleanup != tc.cleanup {
				t.Fatalf("status=%d cleanup=%d", response.Code, fixture.cleanup)
			}
			if strings.Contains(response.Body.String(), "synthetic-") || strings.Contains(response.Body.String(), "accessToken") {
				t.Fatal("provider details leaked")
			}
			if tc.mode == "unprovisioned" && len(fixture.factory.stores) != 0 {
				t.Fatal("login created a tenant partition")
			}
		})
	}
}

func TestERPPasswordLoginRejectsUntrustedInputsBeforeContactingERP(t *testing.T) {
	for _, tc := range []struct {
		body, origin, query, header string
		status                      int
	}{
		{`{"tenantCode":"demo","loginIdentifier":"agent@example.test","password":"synthetic-password"}`, "https://attacker.invalid", "", "", 403},
		{`{}`, "", "", "", 403},
		{`{}`, "https://chat.example.test", "?tenantId=other", "", 403},
		{`{}`, "https://chat.example.test", "", "other", 403},
		{`{"tenantCode":"demo","loginIdentifier":"agent@example.test","password":"synthetic-password","tenantId":"other"}`, "https://chat.example.test", "", "", 400},
		{`{"tenantCode":"demo","loginIdentifier":"agent@example.test","password":"synthetic-password"} {}`, "https://chat.example.test", "", "", 400},
		{`{"tenantCode":"","loginIdentifier":"agent@example.test","password":"synthetic-password"}`, "https://chat.example.test", "", "", 400},
		{`{}`, "https://chat.example.test", "", "", 400},
	} {
		fixture := newERPPasswordFixture(t, "success")
		r := httptest.NewRequest("POST", "/api/v1/auth/erp/login"+tc.query, strings.NewReader(tc.body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", tc.origin)
		r.Header.Set(erpTenantHeader, tc.header)
		response := httptest.NewRecorder()
		fixture.mux.ServeHTTP(response, r)
		if response.Code != tc.status || fixture.requests != 0 {
			t.Fatalf("untrusted input reached ERP: status=%d requests=%d", response.Code, fixture.requests)
		}
	}
}

type erpPasswordFixture struct {
	mux                        *ERPTenantMux
	factory                    *MemoryERPTenantStoreFactory
	requests, cleanup, redeems int
	revoked                    bool
}

func (f *erpPasswordFixture) login(t *testing.T, body, origin string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest("POST", "/api/v1/auth/erp/login", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", origin)
	w := httptest.NewRecorder()
	f.mux.ServeHTTP(w, r)
	return w
}

func newERPPasswordFixture(t *testing.T, mode string) *erpPasswordFixture {
	t.Helper()
	f := &erpPasswordFixture{factory: NewMemoryERPTenantStoreFactory()}
	iam := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.requests++
		switch r.URL.Path {
		case "/api/v1/auth/login":
			if r.Header.Get("Authorization") != "" || r.Header.Get("X-XZ-ERP-Connector-Token") != "" {
				t.Error("password authentication sent unrelated credentials")
			}
			var credentials map[string]string
			_ = json.NewDecoder(r.Body).Decode(&credentials)
			if credentials["email"] != "agent@example.test" || credentials["password"] != "synthetic-password" || credentials["tenantCode"] != "demo" {
				t.Error("native login contract changed")
			}
			if mode == "redirect" {
				http.Redirect(w, r, "/must-not-follow", 307)
				return
			}
			status := map[string]int{"wrong password": 401, "throttled": 429, "provider failure": 503}[mode]
			if status != 0 {
				w.WriteHeader(status)
				_, _ = w.Write([]byte("synthetic-private-provider-details"))
				return
			}
			code := "demo"
			if mode == "wrong tenant" {
				code = "other"
			}
			writeTestJSON(t, w, map[string]any{"tokenType": "Bearer", "accessToken": "synthetic-erp-bearer", "expiresAt": time.Now().Add(time.Hour), "tenant": map[string]string{"id": "tenant-login", "code": code}, "user": map[string]string{"id": "user-login"}})
		case "/api/v1/customer-service/entry-grants":
			if r.Header.Get("Authorization") != "Bearer synthetic-erp-bearer" {
				t.Error("grant did not use native session")
			}
			var input map[string]string
			_ = json.NewDecoder(r.Body).Decode(&input)
			if input["targetOrigin"] != "https://chat.example.test" || len(input) != 1 {
				t.Error("grant target came from the client")
			}
			if mode == "missing CHAT" {
				w.WriteHeader(403)
				return
			}
			owner, target, expires := "user-login", "https://chat.example.test/api/v1/auth/erp/entry", time.Now().Add(time.Minute)
			if mode == "wrong grant owner" {
				owner = "other"
			}
			if mode == "wrong grant target" {
				target = "https://attacker.invalid"
			}
			if mode == "expired grant" {
				expires = time.Now().Add(-time.Minute)
			}
			writeTestJSON(t, w, map[string]any{"grant": strings.Repeat("a", 43), "tenantId": "tenant-login", "userId": owner, "entryUrl": target, "expiresAt": expires})
		case "/api/v1/internal/customer-service/entry-grants/redeem", "/api/v1/internal/customer-service/session/validate":
			if r.Header.Get("Authorization") != "" || r.Header.Get("X-XZ-ERP-Connector-Token") != "synthetic-service-token" {
				t.Error("redemption credential boundary changed")
			}
			if f.revoked {
				w.WriteHeader(403)
				return
			}
			if strings.HasSuffix(r.URL.Path, "/redeem") {
				f.redeems++
			}
			identity := ERPIdentity{TenantID: "tenant-login", TenantCode: "demo", SubjectID: "user-login", DisplayName: "ERP name", Email: "agent@example.test", ExpiresAt: time.Now().Add(10 * time.Minute), Permissions: []string{erpCustomerServicePermission}}
			if mode == "wrong redeemed owner" {
				identity.SubjectID = "other"
			}
			if mode == "system admin" {
				identity.SystemAdmin = true
			}
			if mode == "missing permission" {
				identity.Permissions = nil
			}
			writeTestJSON(t, w, identity)
		case "/api/v1/auth/session":
			if r.Method != "DELETE" || r.Header.Get("Authorization") != "Bearer synthetic-erp-bearer" {
				t.Error("invalid failed-login cleanup")
			}
			f.cleanup++
			w.WriteHeader(204)
		default:
			t.Error("unexpected request or followed redirect")
			w.WriteHeader(500)
		}
	}))
	t.Cleanup(iam.Close)
	verifier, err := NewHTTPERPIdentityVerifier(iam.URL, "synthetic-service-token", "https://chat.example.test", iam.Client())
	if err != nil {
		t.Fatal(err)
	}
	if mode != "unprovisioned" {
		store, err := f.factory.StoreForTenant(t.Context(), "tenant-login")
		if err != nil {
			t.Fatal(err)
		}
		status := UserStatusActive
		if mode == "disabled seat" {
			status = "disabled"
		}
		_, err = store.CreateUser(t.Context(), User{ID: "erp:tenant-login:user-login", Email: "seat@example.test", DisplayName: "Existing seat", PasswordHash: "!erp-sso-password-disabled!", Status: status, Role: UserRoleAgent, Permissions: []string{PermissionWorkbenchAccess}, PermissionsCustomized: true, SetAccessControl: true, ReceptionLimit: 17})
		if err != nil {
			t.Fatal(err)
		}
	}
	f.mux, err = NewERPSharedIdentityMux(NewServer(NewMemoryStore()), verifier, f.factory, []string{"https://chat.example.test"})
	if err != nil {
		t.Fatal(err)
	}
	return f
}
