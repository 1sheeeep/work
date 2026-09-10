package platform

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestModulePermissionsGrantAllDataOnlyForEnabledFeatures(t *testing.T) {
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	ownerToken := bootstrapAdmin(t, server.URL)

	var assignedShop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", ownerToken, Shop{DisplayName: "Assigned"}, http.StatusCreated, &assignedShop)
	var monitoredShop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", ownerToken, Shop{DisplayName: "Monitored"}, http.StatusCreated, &monitoredShop)

	var manager User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", ownerToken, createUserRequest{
		Email:                 "module-permission-agent@example.com",
		DisplayName:           "Module Permission Agent",
		Password:              "agent-password",
		Role:                  UserRoleAgent,
		PermissionsCustomized: true,
		Permissions: []string{
			PermissionMonitorView,
			PermissionKnowledgeCreate,
			PermissionTicketsView,
			PermissionOrdersView,
		},
	}, http.StatusCreated, &manager)
	if _, err := store.AssignUserToShop(t.Context(), assignedShop.ID, manager.ID); err != nil {
		t.Fatalf("assign manager shop: %v", err)
	}

	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email: "module-permission-agent@example.com", Password: "agent-password",
	}, http.StatusOK, &login)

	var monitorShops []Shop
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/shops?scope=monitor", login.Token, nil, http.StatusOK, &monitorShops)
	if len(monitorShops) != 2 {
		t.Fatalf("monitor scope should include both shops, got %#v", monitorShops)
	}

	for _, module := range []string{DataScopeKnowledge, DataScopeTickets, DataScopeOrders} {
		var shops []Shop
		requestJSON(t, http.MethodGet, server.URL+"/api/v1/shops?scope="+module, login.Token, nil, http.StatusOK, &shops)
		if len(shops) != 2 {
			t.Fatalf("%s permission should include both shops, got %#v", module, shops)
		}
	}

	requestJSON(t, http.MethodPost, server.URL+"/api/v1/knowledge", login.Token, createKnowledgeRequest{
		Scope: KnowledgeScopeShop, ShopID: monitoredShop.ID, Title: "Allowed", Answer: "Allowed",
	}, http.StatusCreated, nil)
}

func TestModuleDataScopeIsDerivedFromPermission(t *testing.T) {
	user := publicUser(User{
		Role:                  UserRoleAgent,
		PermissionsCustomized: true,
		Permissions:           []string{PermissionRecordsView},
	})
	for _, module := range dataScopeModules {
		want := AccessScopeAssigned
		if module == DataScopeKnowledge || module == DataScopeRecords {
			want = AccessScopeAll
		}
		if user.DataScopes[module] != want {
			t.Fatalf("%s scope = %q, want %q", module, user.DataScopes[module], want)
		}
	}

	systemAdmin := publicUser(User{Role: UserRoleAdmin, SystemAdmin: true})
	for _, module := range dataScopeModules {
		want := AccessScopeAssigned
		if userCanUseDataScopeModule(systemAdmin, module) {
			want = AccessScopeAll
		}
		if systemAdmin.DataScopes[module] != want {
			t.Fatalf("system admin %s scope = %q, want %q", module, systemAdmin.DataScopes[module], want)
		}
	}
}
