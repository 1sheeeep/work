package platform

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

const testERPOrigin = "https://erp.example.test"

type fixedERPIdentityVerifier struct {
	identity    ERPIdentity
	err         error
	lastRequest ERPEntryGrantRequest
	redeemCount int
}

func (v *fixedERPIdentityVerifier) Redeem(_ context.Context, request ERPEntryGrantRequest) (ERPIdentity, error) {
	v.lastRequest = request
	v.redeemCount++
	return v.identity, v.err
}

func TestHTTPERPIdentityVerifierRedeemsGrantWithExistingServiceCredential(t *testing.T) {
	const serviceToken = "synthetic-service-token"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/internal/customer-service/entry-grants/redeem" || r.Method != http.MethodPost {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("X-XZ-ERP-Connector-Token") != serviceToken || r.Header.Get("Authorization") != "" {
			t.Fatalf("entry redemption must use only the shared workload credential")
		}
		var request map[string]string
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode redemption request: %v", err)
		}
		if request["grant"] != strings.Repeat("a", 43) || request["tenantId"] != "tenant-1" ||
			request["userId"] != "user-1" || request["targetOrigin"] != "https://customer.example.test" {
			t.Fatalf("unexpected redemption request: %#v", request)
		}
		writeTestJSON(t, w, map[string]any{
			"tenantId": "tenant-1", "tenantCode": "demo", "subjectId": "user-1",
			"email": "agent@example.test", "displayName": "ERP Agent",
			"systemAdmin": true,
			"permissions": []string{erpCustomerServicePermission},
			"expiresAt":   time.Now().UTC().Add(10 * time.Minute),
		})
	}))
	defer server.Close()

	verifier, err := NewHTTPERPIdentityVerifier(
		server.URL, serviceToken, "https://customer.example.test/", server.Client())
	if err != nil {
		t.Fatalf("NewHTTPERPIdentityVerifier failed: %v", err)
	}
	identity, err := verifier.Redeem(t.Context(), ERPEntryGrantRequest{
		Grant: strings.Repeat("a", 43), TenantID: "tenant-1", SubjectID: "user-1",
	})
	if err != nil || identity.TenantID != "tenant-1" || identity.SubjectID != "user-1" || !identity.SystemAdmin {
		t.Fatalf("unexpected redeemed identity: %+v err=%v", identity, err)
	}
	if identity.Shops != nil {
		t.Fatalf("the real Java redemption shape must leave omitted shops non-authoritative: %#v", identity.Shops)
	}
}

func TestHTTPERPIdentityVerifierFailsClosed(t *testing.T) {
	tests := []struct {
		name   string
		status int
		body   map[string]any
		want   error
	}{
		{name: "rejected grant", status: http.StatusForbidden, want: errERPIdentityUnauthorized},
		{name: "missing permission", status: http.StatusOK, body: map[string]any{
			"tenantId": "tenant-1", "subjectId": "user-1", "permissions": []string{},
			"expiresAt": time.Now().UTC().Add(time.Minute),
		}, want: errERPIdentityUnavailable},
		{name: "service failure", status: http.StatusServiceUnavailable, want: errERPIdentityUnavailable},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(test.status)
				if test.body != nil {
					_ = json.NewEncoder(w).Encode(test.body)
				}
			}))
			defer server.Close()
			verifier, err := NewHTTPERPIdentityVerifier(server.URL, "service-token", "https://customer.example.test", server.Client())
			if err != nil {
				t.Fatal(err)
			}
			_, err = verifier.Redeem(t.Context(), ERPEntryGrantRequest{
				Grant: strings.Repeat("a", 43), TenantID: "tenant-1", SubjectID: "user-1",
			})
			if !errors.Is(err, test.want) {
				t.Fatalf("got %v, want %v", err, test.want)
			}
		})
	}
}

func TestERPIdentityEntryCreatesRestrictedPasswordlessSeat(t *testing.T) {
	store := NewMemoryStore()
	verifier := &fixedERPIdentityVerifier{identity: testFullERPIdentity("tenant-1")}
	app := NewServer(store)
	app.ConfigureAllowedOrigins([]string{testERPOrigin})
	app.ConfigureERPIdentity(verifier, true)
	server := httptest.NewServer(app.Routes())
	defer server.Close()

	login, err := enterERP(server.URL, "grant-a", "tenant-1", "user-1")
	if err != nil {
		t.Fatal(err)
	}
	if verifier.lastRequest.Grant != normalizedTestGrant("grant-a") || verifier.redeemCount != 1 {
		t.Fatalf("unexpected grant redemption: %+v", verifier)
	}
	if login.IntegrationMode != erpIdentityExchangeMode || !strings.HasPrefix(login.User.ID, "erp:tenant-1:") {
		t.Fatalf("unexpected entry result: %+v", login)
	}
	stored, err := store.GetUser(t.Context(), login.User.ID)
	if err != nil || stored.PasswordHash != "!erp-sso-password-disabled!" || stored.Role != UserRoleAgent {
		t.Fatalf("expected restricted passwordless seat, got %+v err=%v", stored, err)
	}
	if containsPermission(stored.Permissions, PermissionUsersManage) ||
		!containsPermission(stored.Permissions, PermissionWorkbenchAccess) {
		t.Fatalf("unexpected seat permissions: %#v", stored.Permissions)
	}
	if stored.ShopScope != AccessScopeAssigned || stored.WorkbenchShopScope != AccessScopeAssigned ||
		stored.ConversationScope != AccessScopeAssigned {
		t.Fatalf("restricted ERP seat received global data scope: %+v", stored)
	}
	var current User
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/auth/me", login.Token, nil, http.StatusOK, &current)
	if current.ID != login.User.ID {
		t.Fatalf("customer-service session did not authenticate its seat: %+v", current)
	}
}

func TestERPIdentityEntryReconcilesAuthorizedERPShopWithoutImportingCredentials(t *testing.T) {
	store := NewMemoryStore()
	identity := testERPIdentity("tenant-real")
	identity.Shops = []ERPShop{{
		ID: "shop-real", DisplayName: "ERP Store", ExternalShopRef: "erp-store.myshopify.com",
		Status: "ACTIVE", AuthorizationStatus: "AUTHORIZED", CredentialConfigured: true,
		ChannelMode: "XZ_ERP_APP",
	}}
	app := NewServer(store)
	app.ConfigureAllowedOrigins([]string{testERPOrigin})
	app.ConfigureERPIdentity(&fixedERPIdentityVerifier{identity: identity}, false)
	server := httptest.NewServer(app.Routes())
	defer server.Close()

	login, err := enterERP(server.URL, "real-shop", identity.TenantID, identity.SubjectID)
	if err != nil {
		t.Fatal(err)
	}
	shop, err := store.GetShop(t.Context(), "shop-real")
	if err != nil || shop.ExternalID != "erp-store.myshopify.com" || shop.Metadata["connectionMode"] != "xz_erp_app" {
		t.Fatalf("ERP shop was not reconciled: shop=%+v err=%v", shop, err)
	}
	apiSource, err := store.GetShopSource(t.Context(), shop.ID, "erp-shopify:"+shop.ID)
	if err != nil || apiSource.Status != SourceStatusActive || apiSource.Provider != "unified_shopify_connector" {
		t.Fatalf("ERP connector projection is not active: source=%+v err=%v", apiSource, err)
	}
	if apiSource.Metadata["credentialReference"] != "" || apiSource.Metadata["accessToken"] != "" {
		t.Fatalf("credential material leaked into customer service: %#v", apiSource.Metadata)
	}
	chatSource, err := store.GetShopSource(t.Context(), shop.ID, "erp-chat:"+shop.ID)
	if err != nil || chatSource.Status != SourceStatusActive || chatSource.Provider != "xzdesk_widget" {
		t.Fatalf("customer-service plugin source was not prepared: source=%+v err=%v", chatSource, err)
	}
	chatSource.Metadata["visitorSchemeId"] = "scheme-custom"
	chatSource.Metadata["customImportedMetadata"] = "preserved"
	chatSource.Metadata["widgetLastSeenAt"] = "2026-08-17T10:30:00Z"
	if _, err := store.UpdateShopSource(t.Context(), shop.ID, chatSource.ID, chatSource); err != nil {
		t.Fatal(err)
	}
	if err := app.reconcileERPShops(t.Context(), identity, login.User, false); err != nil {
		t.Fatal(err)
	}
	chatSource, err = store.GetShopSource(t.Context(), shop.ID, chatSource.ID)
	if err != nil || chatSource.Metadata["visitorSchemeId"] != "scheme-custom" ||
		chatSource.Metadata["customImportedMetadata"] != "preserved" ||
		chatSource.Metadata["widgetLastSeenAt"] != "2026-08-17T10:30:00Z" ||
		chatSource.Metadata["connectionMode"] != "xz_erp_app" {
		t.Fatalf("ERP reconciliation did not preserve customer-service-owned plugin metadata: source=%+v err=%v", chatSource, err)
	}
	shopIDs, err := store.ListUserShopIDs(t.Context(), login.User.ID)
	if err != nil || len(shopIDs) != 1 || shopIDs[0] != shop.ID {
		t.Fatalf("ERP seat did not receive the reconciled shop: ids=%#v err=%v", shopIDs, err)
	}
}

func TestERPIdentityEntryProjectsSystemAdministratorToFullCustomerServiceAccess(t *testing.T) {
	store := NewMemoryStore()
	identity := testFullERPIdentity("tenant-admin")
	identity.SystemAdmin = true
	app := NewServer(store)
	app.ConfigureAllowedOrigins([]string{testERPOrigin})
	app.ConfigureERPIdentity(&fixedERPIdentityVerifier{identity: identity}, true)
	server := httptest.NewServer(app.Routes())
	defer server.Close()

	login, err := enterERP(server.URL, "admin-entry", identity.TenantID, identity.SubjectID)
	if err != nil {
		t.Fatal(err)
	}
	stored, err := store.GetUser(t.Context(), login.User.ID)
	if err != nil || !stored.SystemAdmin || stored.Role != UserRoleAdmin {
		t.Fatalf("ERP main account was not projected as system administrator: %+v err=%v", stored, err)
	}
	if !sameStrings(stored.Permissions, normalizePermissions(allPermissions)) ||
		stored.ShopScope != AccessScopeAll || stored.WorkbenchShopScope != AccessScopeAll ||
		stored.ConversationScope != AccessScopeAll {
		t.Fatalf("ERP main account did not receive full customer-service access: %+v", stored)
	}

	if _, err := enterERP(server.URL, "admin-entry-again", identity.TenantID, identity.SubjectID); err != nil {
		t.Fatalf("ERP main account could not re-enter customer service: %v", err)
	}
}

func TestERPIdentityEntryRejectsOriginBindingAndIdentityMismatch(t *testing.T) {
	verifier := &fixedERPIdentityVerifier{identity: testERPIdentity("tenant-1")}
	app := NewServer(NewMemoryStore())
	app.ConfigureAllowedOrigins([]string{testERPOrigin})
	app.ConfigureERPIdentity(verifier, false)
	server := httptest.NewServer(app.Routes())
	defer server.Close()

	form := url.Values{"grant": {normalizedTestGrant("grant")}, "tenantId": {"tenant-1"}, "userId": {"user-1"}}
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/auth/erp/entry", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Origin", "https://wrong.example.test")
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusForbidden || verifier.redeemCount != 0 {
		t.Fatalf("wrong origin status=%d redemptionCount=%d", response.StatusCode, verifier.redeemCount)
	}

	verifier.identity.SubjectID = "another-user"
	if _, err := enterERP(server.URL, "grant", "tenant-1", "user-1"); err == nil || !strings.Contains(err.Error(), "status=403") {
		t.Fatalf("identity mismatch must fail closed: %v", err)
	}
}

func TestERPIdentityEntryWithoutShopFactsPreservesImportedShopsAndExistingSeat(t *testing.T) {
	store := NewMemoryStore()
	identity := testFullERPIdentity("tenant-existing")
	identity.Shops = nil
	const serviceToken = "synthetic-cross-contract-token"
	iam := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-XZ-ERP-Connector-Token") != serviceToken {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		// Backward-compatible legacy wire shape: an omitted shops field must be
		// treated as unknown, never as an authoritative empty catalog.
		writeTestJSON(t, w, map[string]any{
			"tenantId": identity.TenantID, "tenantCode": identity.TenantCode,
			"subjectId": identity.SubjectID, "email": identity.Email,
			"displayName": identity.DisplayName, "permissions": identity.Permissions,
			"expiresAt": identity.ExpiresAt,
		})
	}))
	defer iam.Close()
	verifier, err := NewHTTPERPIdentityVerifier(
		iam.URL, serviceToken, "https://customer.example.test", iam.Client())
	if err != nil {
		t.Fatal(err)
	}
	if err := store.BindERPTenant(t.Context(), identity.TenantID); err != nil {
		t.Fatal(err)
	}
	oldHash := "!erp-sso-password-disabled!"
	seatID := "erp:" + identity.TenantID + ":" + identity.SubjectID
	if _, err := store.CreateUser(t.Context(), User{
		ID: seatID, Email: "old-erp-seat@example.test", Role: UserRoleAdmin,
		Status: UserStatusActive, PasswordHash: oldHash,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateShop(t.Context(), Shop{
		ID: "imported-shop", DisplayName: "Imported Shop", Status: ShopStatusActive,
		Metadata: map[string]string{"erpTenantId": identity.TenantID},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateShopSource(t.Context(), ShopSource{
		ID: "imported-source", ShopID: "imported-shop", Type: SourceTypeShopifyChat,
		Provider: "imported", Status: SourceStatusActive,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.AssignUserToShop(t.Context(), "imported-shop", seatID); err != nil {
		t.Fatal(err)
	}

	app := NewServer(store)
	app.ConfigureAllowedOrigins([]string{testERPOrigin})
	app.ConfigureERPIdentity(verifier, true)
	server := httptest.NewServer(app.Routes())
	defer server.Close()
	if _, err := enterERP(server.URL, "java-shape", identity.TenantID, identity.SubjectID); err != nil {
		t.Fatalf("identity entry with the Java response shape failed: %v", err)
	}

	shop, err := store.GetShop(t.Context(), "imported-shop")
	if err != nil || shop.Status != ShopStatusActive {
		t.Fatalf("omitted shops disabled an imported shop: shop=%+v err=%v", shop, err)
	}
	source, err := store.GetShopSource(t.Context(), "imported-shop", "imported-source")
	if err != nil || source.Status != SourceStatusActive {
		t.Fatalf("omitted shops disabled an imported source: source=%+v err=%v", source, err)
	}
	shopIDs, err := store.ListUserShopIDs(t.Context(), seatID)
	if err != nil || len(shopIDs) != 1 || shopIDs[0] != "imported-shop" {
		t.Fatalf("omitted shops removed the existing assignment: ids=%#v err=%v", shopIDs, err)
	}
	seat, err := store.GetUser(t.Context(), seatID)
	if err != nil || seat.PasswordHash != oldHash || seat.Role != UserRoleAdmin || seat.Email != "old-erp-seat@example.test" {
		t.Fatalf("existing ERP seat configuration was changed: err=%v", err)
	}
}

func TestERPIdentityEntryDoesNotClaimExistingLocalUserEmail(t *testing.T) {
	store := NewMemoryStore()
	identity := testFullERPIdentity("tenant-email-conflict")
	identity.Shops = nil
	if err := store.BindERPTenant(t.Context(), identity.TenantID); err != nil {
		t.Fatal(err)
	}
	localHash, err := hashPassword("local-user-password")
	if err != nil {
		t.Fatal(err)
	}
	local, err := store.CreateUser(t.Context(), User{
		ID: "local-user", Email: identity.Email, DisplayName: "Local User",
		Role: UserRoleAgent, Status: UserStatusActive, PasswordHash: localHash,
	})
	if err != nil {
		t.Fatal(err)
	}
	app := NewServer(store)
	app.ConfigureAllowedOrigins([]string{testERPOrigin})
	app.ConfigureERPIdentity(&fixedERPIdentityVerifier{identity: identity}, true)
	server := httptest.NewServer(app.Routes())
	defer server.Close()
	login, err := enterERP(server.URL, "email-conflict", identity.TenantID, identity.SubjectID)
	if err != nil {
		t.Fatalf("identity entry failed on an occupied ERP profile email: %v", err)
	}
	unchanged, err := store.GetUser(t.Context(), local.ID)
	if err != nil || unchanged.PasswordHash != localHash || unchanged.Email != identity.Email {
		t.Fatalf("existing local account was mutated or claimed: %+v err=%v", unchanged, err)
	}
	seat, err := store.GetUser(t.Context(), login.User.ID)
	if err != nil || seat.ID == local.ID || seat.Email == identity.Email || seat.PasswordHash != "!erp-sso-password-disabled!" {
		t.Fatalf("ERP entry did not create an isolated passwordless seat: %+v err=%v", seat, err)
	}
}

func testERPIdentity(tenantID string) ERPIdentity {
	return ERPIdentity{
		TenantID: tenantID, TenantCode: "demo", SubjectID: "user-1",
		Email: "agent@example.test", DisplayName: "ERP Agent",
		ExpiresAt:   time.Now().UTC().Add(15 * time.Minute),
		Permissions: []string{erpCustomerServicePermission},
		Shops: []ERPShop{{
			ID: "shop-1", DisplayName: "Synthetic Shop", Status: "ACTIVE",
			AuthorizationStatus: "NOT_AUTHORIZED", ChannelMode: "UNCONFIGURED",
		}},
	}
}

func testFullERPIdentity(tenantID string) ERPIdentity {
	identity := testERPIdentity(tenantID)
	identity.Permissions = []string{
		erpCustomerServicePermission,
		erpCustomerServiceConversationClaim,
		erpCustomerServiceConversationReply,
		erpCustomerServiceConversationTransfer,
		erpCustomerServiceConversationClose,
		erpCustomerServiceTicketManage,
	}
	return identity
}

func writeTestJSON(t *testing.T, w http.ResponseWriter, value any) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(value); err != nil {
		t.Fatalf("encode response: %v", err)
	}
}
