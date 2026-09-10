package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

const identityTestServiceToken = "synthetic-identity-service-token-not-real"
const identityTestPassword = "Synthetic-password-123"

func TestExplicitSourceAdministratorMappingNeverGrantsERPAdministrator(t *testing.T) {
	h, s, u, b := identityFixture(t)
	u.SystemAdmin = true
	s.users[u.ID] = u
	if identityCall(h, "verify", identityInput(b)).Code != 401 {
		t.Fatal("unreviewed source administrator accepted")
	}
	b.AllowSourceAdministrator = true
	handler, err := NewERPIdentityPreparationHandler(s, identityTestServiceToken, []ERPIdentityBinding{b})
	if err != nil {
		t.Fatal(err)
	}
	runtime := handler.(*erpIdentityPreparationHandler)
	runtime.leaseLifetime = 8 * time.Hour
	input := identityGrant(t, runtime, b)
	response := identityCall(runtime, "exchange", input)
	var out identityPreparationResponse
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &out) != nil {
		t.Fatal("explicit reviewed source administrator rejected")
	}
	if time.Until(out.ExpiresAt) < 7*time.Hour {
		t.Fatal("runtime session duration not applied")
	}
	if strings.Contains(response.Body.String(), "systemAdmin") || strings.Contains(response.Body.String(), "permissions") {
		t.Fatal("source privilege leaked into ERP claims")
	}
	input.Grant = ""
	input.Lease = out.Lease
	if identityCall(runtime, "validate", input).Code != 200 {
		t.Fatal("runtime lease rejected")
	}
	u.PasswordHash = "changed"
	s.users[u.ID] = u
	if identityCall(runtime, "validate", input).Code != 401 {
		t.Fatal("source credential revocation ignored")
	}
}

func identityFixture(t *testing.T) (*erpIdentityPreparationHandler, *MemoryStore, User, ERPIdentityBinding) {
	t.Helper()
	s := NewMemoryStore()
	hash, err := hashPassword(identityTestPassword)
	if err != nil {
		t.Fatal(err)
	}
	u, err := s.CreateUser(context.Background(), User{ID: "cs-existing-agent", Email: "agent@example.invalid", DisplayName: "Synthetic agent", Role: UserRoleAgent,
		PasswordHash: hash, PermissionsCustomized: true, Permissions: []string{PermissionWorkbenchAccess}, ShopScope: "assigned"})
	if err != nil {
		t.Fatal(err)
	}
	u, err = s.SetUserReceptionOnline(context.Background(), u.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	b := ERPIdentityBinding{TenantID: "11111111-1111-4111-8111-111111111111", SubjectRef: "reviewed-subject-1", CustomerServiceUserID: u.ID,
		ERPUserID: "33333333-3333-4333-8333-333333333333", Version: 7, State: "CONFIRMED", ReviewedBy: "synthetic-reviewer", EvidenceRef: "synthetic-evidence", ReviewedAt: time.Now().Add(-time.Hour)}
	h, err := NewERPIdentityPreparationHandler(s, identityTestServiceToken, []ERPIdentityBinding{b})
	if err != nil {
		t.Fatal(err)
	}
	return h.(*erpIdentityPreparationHandler), s, u, b
}

func identityCall(h http.Handler, op string, input identityPreparationRequest) *httptest.ResponseRecorder {
	body, _ := json.Marshal(input)
	r := httptest.NewRequest("POST", ERPIdentityPreparationPrefix+op, bytes.NewReader(body))
	r.Header.Set(ERPIdentityPreparationHeader, identityTestServiceToken)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func identityInput(b ERPIdentityBinding) identityPreparationRequest {
	return identityPreparationRequest{TenantID: b.TenantID, Target: "ERP", Attempt: strings.Repeat("A", 43), Email: "agent@example.invalid", Password: identityTestPassword}
}

func identityGrant(t *testing.T, h http.Handler, b ERPIdentityBinding) identityPreparationRequest {
	t.Helper()
	input := identityInput(b)
	w := identityCall(h, "verify", input)
	if w.Code != 200 {
		t.Fatalf("verify status %d", w.Code)
	}
	var out identityPreparationResponse
	if json.Unmarshal(w.Body.Bytes(), &out) != nil {
		t.Fatal("invalid response")
	}
	input.Email, input.Password, input.Grant = "", "", out.Grant
	return input
}

func TestIdentityPreparationPreservesNativeAccountsSessionsPresenceAndScopes(t *testing.T) {
	h, s, u, b := identityFixture(t)
	_, err := s.CreateSession(context.Background(), Session{UserID: u.ID, TokenHash: hashSessionToken("synthetic-original-cs-session"), ExpiresAt: time.Now().Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	beforeSessions := len(s.sessions)
	input := identityGrant(t, h, b)
	w := identityCall(h, "exchange", input)
	if w.Code != 200 {
		t.Fatalf("exchange %d", w.Code)
	}
	var out identityPreparationResponse
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if out.ERPUserID != b.ERPUserID || out.CustomerServiceUserID != u.ID || out.BindingVersion != 7 || out.Grant != "" || out.Lease == "" {
		t.Fatal("incorrect mapping contract")
	}
	if identityCall(h, "exchange", input).Code != 401 {
		t.Fatal("grant replay accepted")
	}
	input.Grant, input.Lease = "", out.Lease
	if identityCall(h, "validate", input).Code != 200 {
		t.Fatal("lease rejected")
	}
	after, _ := s.GetUser(context.Background(), u.ID)
	if !reflect.DeepEqual(u, after) || len(s.sessions) != beforeSessions {
		t.Fatal("native owner state changed")
	}
	if _, _, err = s.GetSessionByTokenHash(context.Background(), hashSessionToken("synthetic-original-cs-session")); err != nil {
		t.Fatal("CS session invalidated")
	}
	if w.Header().Get("Cache-Control") != "no-store" || strings.Contains(w.Body.String(), identityTestPassword) || strings.Contains(w.Body.String(), u.PasswordHash) || strings.Contains(w.Body.String(), "permissions") {
		t.Fatal("sensitive response")
	}
}

func TestIdentityPreparationRejectsRecreatedNativeAccountBeforeGrantExchange(t *testing.T) {
	h, s, u, b := identityFixture(t)
	input := identityGrant(t, h, b)
	if err := s.DeleteUser(context.Background(), u.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateUser(context.Background(), u); err != nil {
		t.Fatal(err)
	}
	if identityCall(h, "exchange", input).Code != 401 {
		t.Fatal("recreated account accepted original grant")
	}
}

func TestIdentityPreparationRejectsCredentialAndIdentityConfusion(t *testing.T) {
	for _, name := range []string{"wrong-password", "unmapped-same-email", "disabled", "system-admin", "cross-tenant", "wrong-target", "missing-attempt"} {
		t.Run(name, func(t *testing.T) {
			h, s, u, b := identityFixture(t)
			input := identityInput(b)
			switch name {
			case "wrong-password":
				input.Password = "Wrong-password-123"
			case "unmapped-same-email":
				delete(h.bindings, u.ID)
			case "disabled":
				u.Status = UserStatusDisabled
				s.users[u.ID] = u
			case "system-admin":
				u.SystemAdmin = true
				s.users[u.ID] = u
			case "cross-tenant":
				input.TenantID = "22222222-2222-4222-8222-222222222222"
			case "wrong-target":
				input.Target = "CHAT"
			case "missing-attempt":
				input.Attempt = ""
			}
			w := identityCall(h, "verify", input)
			if w.Code != 401 || len(h.grants) != 0 || len(s.sessions) != 0 {
				t.Fatalf("unsafe identity result %d", w.Code)
			}
			if strings.Contains(w.Body.String(), input.Email) || strings.Contains(w.Body.String(), input.Password) {
				t.Fatal("input exposed")
			}
		})
	}
}

func TestIdentityPreparationRejectsUnreviewedDuplicateOrCrossEnterpriseBindings(t *testing.T) {
	_, s, _, b := identityFixture(t)
	for _, name := range []string{"unreviewed", "conflict", "disabled", "missing-review", "future-review", "duplicate-user", "duplicate-subject", "duplicate-erp", "cross-enterprise", "zero-version"} {
		t.Run(name, func(t *testing.T) {
			changed := b
			bindings := []ERPIdentityBinding{changed}
			switch name {
			case "unreviewed":
				changed.State = "UNREVIEWED"
			case "conflict":
				changed.State = "CONFLICT"
			case "disabled":
				changed.State = "DISABLED"
			case "missing-review":
				changed.EvidenceRef = ""
			case "future-review":
				changed.ReviewedAt = time.Now().Add(time.Hour)
			case "duplicate-user":
				bindings = append(bindings, b)
			case "duplicate-subject":
				changed.CustomerServiceUserID = "cs-second"
				changed.ERPUserID = "44444444-4444-4444-8444-444444444444"
				bindings = append(bindings, b)
			case "duplicate-erp":
				changed.CustomerServiceUserID = "cs-second"
				changed.SubjectRef = "second-subject"
				bindings = append(bindings, b)
			case "cross-enterprise":
				changed.TenantID = "22222222-2222-4222-8222-222222222222"
				bindings = append(bindings, b)
			case "zero-version":
				changed.Version = 0
			}
			bindings[0] = changed
			if _, err := NewERPIdentityPreparationHandler(s, identityTestServiceToken, bindings); err == nil {
				t.Fatal("unsafe binding accepted")
			}
		})
	}
}

func TestIdentityPreparationLeaseExpiryPasswordChangeAndInstanceReplacement(t *testing.T) {
	for _, name := range []string{"grant-expired", "lease-expired", "wrong-attempt", "changed-password", "disabled", "replacement"} {
		t.Run(name, func(t *testing.T) {
			h, s, u, b := identityFixture(t)
			input := identityGrant(t, h, b)
			if name == "grant-expired" {
				h.now = func() time.Time { return time.Now().Add(time.Minute) }
				if identityCall(h, "exchange", input).Code != 401 {
					t.Fatal("expired grant")
				}
				return
			}
			w := identityCall(h, "exchange", input)
			var out identityPreparationResponse
			_ = json.Unmarshal(w.Body.Bytes(), &out)
			input.Grant, input.Lease = "", out.Lease
			switch name {
			case "lease-expired":
				h.now = func() time.Time { return time.Now().Add(6 * time.Minute) }
			case "wrong-attempt":
				input.Attempt = strings.Repeat("B", 43)
			case "changed-password":
				u.PasswordHash = "replacement-hash"
				s.users[u.ID] = u
			case "disabled":
				u.Status = UserStatusDisabled
				s.users[u.ID] = u
			case "replacement":
				b.Version++
				next, err := NewERPIdentityPreparationHandler(s, identityTestServiceToken, []ERPIdentityBinding{b})
				if err != nil {
					t.Fatal(err)
				}
				h = next.(*erpIdentityPreparationHandler)
			}
			if identityCall(h, "validate", input).Code != 401 {
				t.Fatal("invalid lease accepted")
			}
			if name == "disabled" {
				u.Status = UserStatusActive
				s.users[u.ID] = u
				if identityCall(h, "validate", input).Code != 401 {
					t.Fatal("observed revoked lease resurrected")
				}
			}
		})
	}
}

type identityUnavailableStore struct{ ERPIdentityReadStore }

func (s identityUnavailableStore) GetUser(context.Context, string) (User, error) {
	return User{}, errors.New("private-store-error-canary")
}
func (s identityUnavailableStore) ReadIdentitySnapshot(context.Context, string) (User, error) {
	return User{}, errors.New("private-store-error-canary")
}

func TestIdentityPreparationRejectsDisableEnableBetweenChecksButNotPresenceChanges(t *testing.T) {
	h, s, u, b := identityFixture(t)
	input := identityGrant(t, h, b)
	out := identityPreparationResponse{}
	if json.Unmarshal(identityCall(h, "exchange", input).Body.Bytes(), &out) != nil {
		t.Fatal("exchange failed")
	}
	input.Grant, input.Lease = "", out.Lease
	_, _ = s.SetUserReceptionOnline(context.Background(), u.ID, true)
	_, _ = s.SetUserReceptionOnline(context.Background(), u.ID, false)
	if identityCall(h, "validate", input).Code != 200 {
		t.Fatal("presence revoked identity")
	}
	_, _ = s.UpdateUser(context.Background(), u.ID, User{Status: UserStatusDisabled})
	_, _ = s.UpdateUser(context.Background(), u.ID, User{Status: UserStatusActive})
	if identityCall(h, "validate", input).Code != 401 {
		t.Fatal("unobserved disable-enable revived identity")
	}
}

func TestIdentityPreparationOutageIsNotRevocationAndDoesNotLeakDetails(t *testing.T) {
	h, s, _, b := identityFixture(t)
	input := identityGrant(t, h, b)
	w := identityCall(h, "exchange", input)
	var out identityPreparationResponse
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	input.Grant, input.Lease = "", out.Lease
	h.store = identityUnavailableStore{s}
	w = identityCall(h, "validate", input)
	if w.Code != 503 || strings.Contains(w.Body.String(), "private-store-error-canary") {
		t.Fatal("unsafe outage contract")
	}
	h.store = s
	if identityCall(h, "validate", input).Code != 200 {
		t.Fatal("outage was mistaken for revocation")
	}
}

func TestIdentityPreparationEnterpriseRoleDoesNotBecomePlatformPrivilege(t *testing.T) {
	h, s, u, b := identityFixture(t)
	u.Role = UserRoleAdmin
	u.SystemAdmin = false
	s.users[u.ID] = u
	w := identityCall(h, "verify", identityInput(b))
	if w.Code != 200 || strings.Contains(w.Body.String(), "role") || strings.Contains(w.Body.String(), "admin") {
		t.Fatal("business role was confused with platform privilege")
	}
}

func TestIdentityPreparationConcurrentExchangeIsSingleUse(t *testing.T) {
	h, _, _, b := identityFixture(t)
	input := identityGrant(t, h, b)
	results := make(chan int, 12)
	var wg sync.WaitGroup
	for range 12 {
		wg.Add(1)
		go func() { defer wg.Done(); results <- identityCall(h, "exchange", input).Code }()
	}
	wg.Wait()
	close(results)
	ok := 0
	for code := range results {
		if code == 200 {
			ok++
		} else if code != 401 {
			t.Fatalf("unexpected status %d", code)
		}
	}
	if ok != 1 {
		t.Fatalf("exchange successes %d", ok)
	}
}

func TestIdentityPreparationRequestBoundariesAndThrottle(t *testing.T) {
	h, s, _, b := identityFixture(t)
	for _, name := range []string{"missing-service", "duplicate-service", "query", "unknown-field", "trailing-json", "large-body", "unsupported-operation"} {
		t.Run(name, func(t *testing.T) {
			body, _ := json.Marshal(identityInput(b))
			url := ERPIdentityPreparationPrefix + "verify"
			switch name {
			case "query":
				url += "?password=ignored"
			case "unknown-field":
				body = []byte(`{"unknown":true}`)
			case "trailing-json":
				body = append(body, []byte(`{}`)...)
			case "large-body":
				body = []byte(strings.Repeat("x", 4097))
			case "unsupported-operation":
				url = ERPIdentityPreparationPrefix + "login"
			}
			r := httptest.NewRequest("POST", url, bytes.NewReader(body))
			if name != "missing-service" {
				r.Header.Set(ERPIdentityPreparationHeader, identityTestServiceToken)
			}
			if name == "duplicate-service" {
				r.Header.Add(ERPIdentityPreparationHeader, identityTestServiceToken)
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code == 200 || len(s.sessions) != 0 {
				t.Fatal("unsafe request accepted")
			}
		})
	}
	input := identityInput(b)
	input.Password = "Wrong-password"
	for range 5 {
		if identityCall(h, "verify", input).Code != 401 {
			t.Fatal("unexpected credential status")
		}
	}
	if identityCall(h, "verify", identityInput(b)).Code != 429 {
		t.Fatal("throttle bypassed by correct password")
	}
	defaultServer := NewServer(s).Routes()
	w := identityCall(defaultServer, "verify", identityInput(b))
	if w.Code != 404 && w.Code != 405 {
		t.Fatal("preparation route mounted in normal server")
	}
}
