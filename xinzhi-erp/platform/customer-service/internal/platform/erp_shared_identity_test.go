package platform

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSharedERPIdentityLiveRevocation(t *testing.T) {
	identity := testERPIdentity("tenant-shared")
	revoked := false
	checked := 0
	iam := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/internal/customer-service/session/validate" {
			checked++
			if revoked {
				w.WriteHeader(403)
				return
			}
		}
		writeTestJSON(t, w, identity)
	}))
	defer iam.Close()
	verifier, err := NewHTTPERPIdentityVerifier(iam.URL, "synthetic-service-token", "https://chat.example.test", iam.Client())
	if err != nil {
		t.Fatal(err)
	}
	app := NewServer(NewMemoryStore())
	app.ConfigureERPIdentity(verifier, false)
	app.ConfigureAllowedOrigins([]string{testERPOrigin})
	server := httptest.NewServer(app.Routes())
	defer server.Close()
	auth, err := enterERP(server.URL, "shared-proof", identity.TenantID, identity.SubjectID)
	if err != nil {
		t.Fatal(err)
	}
	var current User
	requestJSON(t, "GET", server.URL+"/api/v1/auth/me", auth.Token, nil, 200, &current)
	if checked != 1 {
		t.Fatal("current ERP identity was not checked")
	}
	revoked = true
	app.erpSessionMu.Lock()
	stored := app.erpSessionIdentities[hashSessionToken(auth.Token)]
	stored.ValidatedAt = time.Time{}
	app.erpSessionIdentities[hashSessionToken(auth.Token)] = stored
	app.erpSessionMu.Unlock()
	requestJSON(t, "GET", server.URL+"/api/v1/auth/me", auth.Token, nil, 401, nil)
}

func TestSharedERPIdentityNeverResetsExistingSeat(t *testing.T) {
	for _, kind := range []string{"native", "disabled", "configured"} {
		t.Run(kind, func(t *testing.T) {
			store := NewMemoryStore()
			identity := testERPIdentity("tenant-preserve")
			status := UserStatusActive
			password := "!erp-sso-password-disabled!"
			if kind == "native" {
				password = "synthetic-native-hash"
			}
			if kind == "disabled" {
				status = "disabled"
			}
			before, err := store.CreateUser(t.Context(), User{ID: "erp:" + identity.TenantID + ":" + identity.SubjectID, Email: "seat@example.test", DisplayName: "Existing seat", Role: UserRoleAgent, Status: status, PasswordHash: password, PermissionsCustomized: true, Permissions: []string{PermissionWorkbenchAccess}, SetAccessControl: true, ReceptionLimit: 17})
			if err != nil {
				t.Fatal(err)
			}
			app := NewServer(store)
			_, err = app.upsertERPSeat(context.Background(), identity)
			if (kind == "configured") != (err == nil) {
				t.Fatal("unexpected existing-seat result")
			}
			after, err := store.GetUser(t.Context(), before.ID)
			if err != nil {
				t.Fatal(err)
			}
			a, _ := json.Marshal(before)
			b, _ := json.Marshal(after)
			if string(a) != string(b) || before.PasswordHash != after.PasswordHash {
				t.Fatal("existing seat was modified")
			}
		})
	}
}

func TestSharedERPBootstrapDoesNotExposeProofOrCredentials(t *testing.T) {
	identity := testERPIdentity("tenant-shared")
	identity.EntryProof = ERPEntryGrantRequest{Grant: "must-not-be-serialized"}
	payload, _ := json.Marshal(identity)
	if strings.Contains(string(payload), "must-not-be-serialized") {
		t.Fatal("internal proof leaked")
	}
}

func TestSharedERPIdentityCannotCreateTenantPartition(t *testing.T) {
	factory := NewMemoryERPTenantStoreFactory()
	identity := testERPIdentity("missing-shared-tenant")
	mux, err := NewERPSharedIdentityMux(NewServer(NewMemoryStore()), &fixedERPIdentityVerifier{identity: identity}, factory, []string{testERPOrigin})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(mux)
	defer server.Close()
	if _, err := enterERP(server.URL, "missing-tenant", identity.TenantID, identity.SubjectID); err == nil {
		t.Fatal("unknown tenant was opened")
	}
	if len(factory.stores) != 0 {
		t.Fatal("entry created tenant data")
	}
	var status map[string]any
	requestJSON(t, "GET", server.URL+"/api/v1/bootstrap/status", "", nil, 200, &status)
	if status["authMode"] != "erp_sso" || status["needsBootstrap"] != false {
		t.Fatal("shared identity bootstrap did not fail closed")
	}
}
