package platform

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRoleDefaultsAndCustomPermissions(t *testing.T) {
	admin := User{Role: UserRoleAdmin}
	if userHasPermission(admin, PermissionWorkbenchAccess) {
		t.Fatal("ordinary admin role must not enter the customer workbench by default")
	}
	if !userHasPermission(admin, PermissionUsersManage) {
		t.Fatal("ordinary admin role should manage users by default")
	}
	if userHasPermission(admin, PermissionAutoReception) {
		t.Fatal("ordinary admin role must not participate in automatic reception by default")
	}
	defaultAgent := User{Role: UserRoleAgent}
	for _, permission := range []string{PermissionShopsView, PermissionShopChannelsManage} {
		if !userHasPermission(defaultAgent, permission) {
			t.Fatalf("customer service role is missing default shop permission %q", permission)
		}
	}

	agent := User{Role: UserRoleAgent, PermissionsCustomized: true, Permissions: []string{PermissionTicketsView}}
	if userHasPermission(agent, PermissionWorkbenchAccess) {
		t.Fatal("custom permissions must replace the role template")
	}
	if !userHasPermission(agent, PermissionTicketsView) {
		t.Fatal("custom ticket permission was not applied")
	}

	systemAdmin := User{Role: UserRoleAdmin, SystemAdmin: true}
	if userHasPermission(systemAdmin, PermissionWorkbenchAccess) || userHasPermission(systemAdmin, PermissionAutoReception) {
		t.Fatal("system admin must not consume workbench or routing resources by default")
	}
	for _, permission := range systemAdminCorePermissions {
		if !userHasPermission(systemAdmin, permission) {
			t.Fatalf("system admin is missing protected core permission %q", permission)
		}
	}
	customSystemAdmin := User{Role: UserRoleAdmin, SystemAdmin: true, PermissionsCustomized: true, Permissions: []string{PermissionWorkbenchAccess, PermissionAutoReception}}
	if !userHasPermission(customSystemAdmin, PermissionWorkbenchAccess) || !userHasPermission(customSystemAdmin, PermissionAutoReception) {
		t.Fatal("system admin optional workbench permissions were not applied")
	}
	for _, permission := range systemAdminCorePermissions {
		if !userHasPermission(customSystemAdmin, permission) {
			t.Fatalf("custom system admin lost protected core permission %q", permission)
		}
	}
}

func TestDepartmentDefaultsKeepBackOfficeUsersOutOfCustomerService(t *testing.T) {
	for _, department := range []string{DepartmentFinance, DepartmentGeneral} {
		user := publicUser(User{Role: UserRoleAgent, Department: department, SkillGroup: SkillGroupAfterSales})
		if user.Department != department || user.SkillGroup != "" {
			t.Fatalf("department normalization failed for %q: %#v", department, user)
		}
		if !userHasPermission(user, PermissionEmailStatisticsView) {
			t.Fatalf("%s should have email statistics permission by default", department)
		}
		for _, permission := range []string{PermissionWorkbenchAccess, PermissionAutoReception, PermissionEmailProcessingManage, PermissionConversationReply} {
			if userHasPermission(user, permission) {
				t.Fatalf("%s unexpectedly received customer service permission %q", department, permission)
			}
		}
		if userIsCustomerServiceAgent(user) {
			t.Fatalf("%s must not participate in customer service routing", department)
		}
	}

	legacyAgent := publicUser(User{Role: UserRoleAgent})
	if legacyAgent.Department != DepartmentCustomerService || legacyAgent.SkillGroup != SkillGroupConsulting || !userIsCustomerServiceAgent(legacyAgent) {
		t.Fatalf("legacy agent was not migrated to customer service defaults: %#v", legacyAgent)
	}

	customFinance := publicUser(User{
		Role: UserRoleAgent, Department: DepartmentFinance, PermissionsCustomized: true,
		Permissions: []string{PermissionEmailStatisticsView, PermissionWorkbenchAccess, PermissionAutoReception},
	})
	if !containsPermission(customFinance.Permissions, PermissionWorkbenchAccess) || !containsPermission(customFinance.Permissions, PermissionAutoReception) {
		t.Fatalf("existing custom permissions must remain stored: %#v", customFinance.Permissions)
	}
	if userHasPermission(customFinance, PermissionWorkbenchAccess) || userHasPermission(customFinance, PermissionAutoReception) {
		t.Fatalf("back-office department boundary must suppress customer service permissions: %#v", customFinance.Permissions)
	}
	if userIsCustomerServiceAgent(customFinance) {
		t.Fatal("custom permissions must not bypass the department routing boundary")
	}
}

func TestFinanceDepartmentUserCreationAndPresenceBoundary(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var finance User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email: "finance-department@example.com", DisplayName: "Finance", Password: "agent-password",
		Role: UserRoleAgent, Department: DepartmentFinance, SkillGroup: SkillGroupAfterSales,
	}, http.StatusCreated, &finance)
	if finance.Department != DepartmentFinance || finance.SkillGroup != "" || finance.PermissionsCustomized {
		t.Fatalf("finance account was not created with department defaults: %#v", finance)
	}
	if len(finance.Permissions) != 1 || finance.Permissions[0] != PermissionEmailStatisticsView {
		t.Fatalf("finance account received unexpected default permissions: %#v", finance.Permissions)
	}

	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email: finance.Email, Password: "agent-password",
	}, http.StatusOK, &login)
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/auth/me/presence", login.Token, receptionPresenceRequest{Online: true}, http.StatusForbidden, nil)
}

func TestAutomaticReceptionRequiresWorkbenchPermission(t *testing.T) {
	if err := validatePermissions([]string{PermissionAutoReception}); err == nil {
		t.Fatal("automatic reception without workbench access must be rejected")
	}
	if err := validatePermissions([]string{PermissionWorkbenchAccess, PermissionAutoReception}); err != nil {
		t.Fatalf("valid automatic reception permissions were rejected: %v", err)
	}
}

func TestWorkbenchShopScopeDefaultsToAssignedForEveryRole(t *testing.T) {
	for _, role := range []string{UserRoleAgent, UserRoleAdmin} {
		user := publicUser(User{Role: role})
		if user.WorkbenchShopScope != AccessScopeAssigned {
			t.Fatalf("%s workbench shop scope = %q, want assigned", role, user.WorkbenchShopScope)
		}
		if user.ConversationScope != AccessScopeAssigned {
			t.Fatalf("%s workbench conversation scope = %q, want assigned", role, user.ConversationScope)
		}
	}
	if scope := publicUser(User{Role: UserRoleAgent}).ShopScope; scope != AccessScopeAssigned {
		t.Fatalf("agent shop management scope = %q, want assigned", scope)
	}
	if scope := publicUser(User{Role: UserRoleAdmin}).ShopScope; scope != AccessScopeAll {
		t.Fatalf("admin shop management scope = %q, want all", scope)
	}
}

func TestLegacyPermissionsExpandToGranularPermissions(t *testing.T) {
	user := User{
		Role:                  UserRoleAgent,
		PermissionsCustomized: true,
		Permissions: []string{
			PermissionShopsManage,
			PermissionOrdersManage,
			PermissionBusinessManage,
		},
	}
	for _, permission := range []string{
		PermissionShopChannelsManage, PermissionShopsAssign, PermissionShopsCreate, PermissionShopsDelete,
		PermissionOrdersView, PermissionOrdersRefund, PermissionOrdersDisputes,
		PermissionRecordCategoriesManage, PermissionVisitorSchemesManage, PermissionCustomerLoginManage,
		PermissionLogisticsManage,
	} {
		if !userHasPermission(user, permission) {
			t.Fatalf("legacy permissions did not grant %q", permission)
		}
	}
}

func TestSystemAdminCanEditOwnOptionalPermissions(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	var auth AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/bootstrap/admin", "", createUserRequest{
		Email: "owner-permissions@example.com", DisplayName: "Owner", Password: "password-123",
	}, http.StatusCreated, &auth)
	if userHasPermission(auth.User, PermissionWorkbenchAccess) || userHasPermission(auth.User, PermissionAutoReception) {
		t.Fatalf("new system admin unexpectedly entered the workbench: %#v", auth.User.Permissions)
	}

	permissions := []string{PermissionWorkbenchAccess, PermissionAutoReception}
	customized := true
	assigned := AccessScopeAssigned
	var updated User
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/users/"+auth.User.ID, auth.Token, updateUserRequest{
		Permissions: &permissions, PermissionsCustomized: &customized,
		ShopScope: &assigned, ConversationScope: &assigned,
	}, http.StatusOK, &updated)
	if !userHasPermission(updated, PermissionWorkbenchAccess) || !userHasPermission(updated, PermissionAutoReception) {
		t.Fatalf("system admin optional workbench permissions were not saved: %#v", updated.Permissions)
	}
	for _, permission := range systemAdminCorePermissions {
		if !userHasPermission(updated, permission) {
			t.Fatalf("system admin lost protected core permission %q", permission)
		}
	}
}

func TestOrdinaryAdminNeedsExplicitWorkbenchPermission(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	systemAdminToken := bootstrapAdmin(t, server.URL)

	var manager User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", systemAdminToken, createUserRequest{
		Email: "manager-permissions@example.com", DisplayName: "Manager", Password: "agent-password", Role: UserRoleAdmin,
	}, http.StatusCreated, &manager)
	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email: "manager-permissions@example.com", Password: "agent-password",
	}, http.StatusOK, &login)
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations?scope=assigned", login.Token, nil, http.StatusForbidden, nil)

	permissions := append(defaultPermissionsForRole(UserRoleAdmin), PermissionWorkbenchAccess, PermissionConversationClaim)
	customized := true
	assigned := AccessScopeAssigned
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/users/"+manager.ID, systemAdminToken, updateUserRequest{
		Permissions: &permissions, PermissionsCustomized: &customized, ShopScope: &assigned, ConversationScope: &assigned,
	}, http.StatusOK, &manager)

	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email: "manager-permissions@example.com", Password: "agent-password",
	}, http.StatusOK, &login)
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations?scope=assigned", login.Token, nil, http.StatusOK, nil)
}

func TestOrdinaryAdminCanEnableAnyPermissionAndWorkbenchAllScope(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	systemAdminToken := bootstrapAdmin(t, server.URL)

	var manager User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", systemAdminToken, createUserRequest{
		Email: "full-access-manager@example.com", DisplayName: "Full Access Manager",
		Password: "manager-password", Role: UserRoleAdmin,
	}, http.StatusCreated, &manager)
	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email: "full-access-manager@example.com", Password: "manager-password",
	}, http.StatusOK, &login)
	if userHasPermission(login.User, PermissionWorkbenchAccess) {
		t.Fatal("ordinary admin workbench access should remain disabled by default")
	}

	permissions := append(defaultPermissionsForRole(UserRoleAdmin),
		PermissionWorkbenchAccess,
		PermissionAutoReception,
		PermissionConversationClaim,
		PermissionConversationReply,
		PermissionConversationTransfer,
		PermissionConversationClose,
	)
	customized := true
	all := AccessScopeAll
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/users/"+manager.ID, systemAdminToken, updateUserRequest{
		Permissions:           &permissions,
		PermissionsCustomized: &customized,
		WorkbenchShopScope:    &all,
		ConversationScope:     &all,
	}, http.StatusOK, &manager)

	for _, permission := range permissions {
		if !userHasPermission(manager, permission) {
			t.Fatalf("ordinary admin could not enable permission %q", permission)
		}
	}
	for _, module := range dataScopeModules {
		if manager.DataScopes[module] != AccessScopeAll {
			t.Fatalf("enabled module %s did not receive all-data access: %#v", module, manager.DataScopes)
		}
	}
	if manager.WorkbenchShopScope != AccessScopeAll || manager.ConversationScope != AccessScopeAll {
		t.Fatalf("ordinary admin scopes were not saved: %#v", manager)
	}
}

func TestRestrictedUserManagerCannotGrantDefaultPermissionsTheyDoNotHave(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	systemAdminToken := bootstrapAdmin(t, server.URL)

	var manager User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", systemAdminToken, createUserRequest{
		Email: "restricted-manager@example.com", DisplayName: "Restricted Manager", Password: "manager-password",
		Role: UserRoleAgent, PermissionsCustomized: true,
		Permissions: []string{PermissionUsersView, PermissionUsersManage},
	}, http.StatusCreated, &manager)
	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email: "restricted-manager@example.com", Password: "manager-password",
	}, http.StatusOK, &login)

	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", login.Token, createUserRequest{
		Email: "escalated-agent@example.com", DisplayName: "Escalated Agent", Password: "agent-password", Role: UserRoleAgent,
	}, http.StatusForbidden, nil)
}

func TestManagementPermissionsIgnoreAssignedWorkbenchShops(t *testing.T) {
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	systemAdminToken := bootstrapAdmin(t, server.URL)
	allowedShop, _ := store.CreateShop(t.Context(), Shop{DisplayName: "Allowed Shop"})
	blockedShop, _ := store.CreateShop(t.Context(), Shop{DisplayName: "Blocked Shop"})

	var manager User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", systemAdminToken, createUserRequest{
		Email: "scoped-manager@example.com", DisplayName: "Scoped Manager", Password: "manager-password",
		Role: UserRoleAgent, PermissionsCustomized: true,
		Permissions: []string{
			PermissionKnowledgeManage, PermissionKnowledgeImport,
			PermissionMonitorView, PermissionRecordsView, PermissionShopsManage,
		},
		ShopScope: AccessScopeAssigned, ConversationScope: AccessScopeAll,
	}, http.StatusCreated, &manager)
	if _, err := store.AssignUserToShop(t.Context(), allowedShop.ID, manager.ID); err != nil {
		t.Fatalf("assign allowed shop failed: %v", err)
	}
	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email: "scoped-manager@example.com", Password: "manager-password",
	}, http.StatusOK, &login)

	requestJSON(t, http.MethodPost, server.URL+"/api/v1/knowledge", login.Token, createKnowledgeRequest{
		Scope: KnowledgeScopeShop, ShopID: blockedShop.ID, Title: "Allowed", Answer: "Allowed",
	}, http.StatusCreated, nil)
	blockedKnowledge, err := store.CreateKnowledge(t.Context(), KnowledgeEntry{
		Scope: KnowledgeScopeShop, ShopID: blockedShop.ID, Title: "Protected", Answer: "Protected",
	})
	if err != nil {
		t.Fatalf("create protected knowledge failed: %v", err)
	}
	requestJSON(t, http.MethodDelete, server.URL+"/api/v1/knowledge/"+blockedKnowledge.ID, login.Token, nil, http.StatusNoContent, nil)
	if _, err := store.GetKnowledge(t.Context(), blockedKnowledge.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("knowledge permission must remove knowledge from any shop, got %v", err)
	}
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/monitor/conversations?shopId="+blockedShop.ID, login.Token, nil, http.StatusOK, nil)
}

func TestManagementReportsIgnoreWorkbenchConversationScope(t *testing.T) {
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	systemAdminToken := bootstrapAdmin(t, server.URL)

	var manager User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", systemAdminToken, createUserRequest{
		Email:             "report-manager@example.com",
		DisplayName:       "Report Manager",
		Password:          "manager-password",
		Role:              UserRoleAdmin,
		ShopScope:         AccessScopeAssigned,
		ConversationScope: AccessScopeAssigned,
	}, http.StatusCreated, &manager)
	agent := createTestAgent(t, server.URL, systemAdminToken, "report-agent@example.com", "Report Agent")

	shop, err := store.CreateShop(t.Context(), Shop{DisplayName: "Managed Shop"})
	if err != nil {
		t.Fatalf("create managed shop failed: %v", err)
	}
	source, err := store.CreateShopSource(t.Context(), ShopSource{
		ShopID: shop.ID, Type: SourceTypeShopifyChat, Status: SourceStatusActive,
	})
	if err != nil {
		t.Fatalf("create managed source failed: %v", err)
	}
	for _, userID := range []string{manager.ID, agent.ID} {
		if _, err := store.AssignUserToShop(t.Context(), shop.ID, userID); err != nil {
			t.Fatalf("assign %s to managed shop failed: %v", userID, err)
		}
	}
	conversation := createTestConversation(t, store, shop.ID, source.ID, ConversationStatusClosed, agent.ID, "Another agent record")
	if _, _, err := store.AddMessage(t.Context(), Message{
		ConversationID: conversation.ID,
		Direction:      MessageDirectionCustomer,
		Body:           "Where is my order?",
	}); err != nil {
		t.Fatalf("add managed conversation message failed: %v", err)
	}
	if _, err := store.UpdateConversation(t.Context(), conversation.ID, ConversationUpdate{
		Status:             ConversationStatusClosed,
		AssignedAgentID:    agent.ID,
		SetAssignedAgentID: true,
		SetRecord:          true,
		RecordPrimary:      "未发货",
		RecordSecondary:    "物流查询",
		RecordTertiary:     "订单状态查询",
		RecordRemark:       "客服已回复物流进度。",
		RecordClassified:   true,
		RecordUpdatedBy:    agent.ID,
	}); err != nil {
		t.Fatalf("classify managed conversation failed: %v", err)
	}

	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email: "report-manager@example.com", Password: "manager-password",
	}, http.StatusOK, &login)

	var overview monitorOverviewResponse
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/monitor/overview?shopId="+shop.ID, login.Token, nil, http.StatusOK, &overview)
	if overview.Totals.ClosedToday != 1 {
		t.Fatalf("management monitor must include another agent's conversation: %#v", overview.Totals)
	}

	var metrics responseMetricsResponse
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/monitor/response-metrics?shopId="+shop.ID, login.Token, nil, http.StatusOK, &metrics)
	if len(metrics.Metrics) != 1 || metrics.Metrics[0].UserID != agent.ID || metrics.Metrics[0].ConversationCount != 1 {
		t.Fatalf("management response metrics must include another agent: %#v", metrics)
	}

	var page monitorConversationPage
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/monitor/conversations?shopId="+shop.ID, login.Token, nil, http.StatusOK, &page)
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].ID != conversation.ID {
		t.Fatalf("management conversation list must include another agent's conversation: %#v", page)
	}
	var messages []Message
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/monitor/conversations/"+conversation.ID+"/messages", login.Token, nil, http.StatusOK, &messages)
	if len(messages) != 1 || messages[0].Body != "Where is my order?" {
		t.Fatalf("management conversation detail must include another agent's messages: %#v", messages)
	}

	var records processingRecordsResponse
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/processing-records?shopId="+shop.ID, login.Token, nil, http.StatusOK, &records)
	if records.Summary.Total != 1 || len(records.Items) != 1 || records.Items[0].AgentID != agent.ID {
		t.Fatalf("management processing records must include another agent: %#v", records)
	}
}

func TestManagementAndWorkbenchShopScopesAreIndependent(t *testing.T) {
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	systemAdminToken := bootstrapAdmin(t, server.URL)
	assignedShop, _ := store.CreateShop(t.Context(), Shop{DisplayName: "Assigned Shop"})
	otherShop, _ := store.CreateShop(t.Context(), Shop{DisplayName: "Other Shop"})
	assignedSource, _ := store.CreateShopSource(t.Context(), ShopSource{ShopID: assignedShop.ID, Type: SourceTypeShopifyChat})
	otherSource, _ := store.CreateShopSource(t.Context(), ShopSource{ShopID: otherShop.ID, Type: SourceTypeShopifyChat})
	assignedConversation, err := store.CreateConversation(t.Context(), Conversation{ShopID: assignedShop.ID, SourceID: assignedSource.ID, Subject: "Assigned"})
	if err != nil {
		t.Fatalf("create assigned conversation failed: %v", err)
	}
	otherConversation, err := store.CreateConversation(t.Context(), Conversation{ShopID: otherShop.ID, SourceID: otherSource.ID, Subject: "Other"})
	if err != nil {
		t.Fatalf("create other conversation failed: %v", err)
	}

	var agent User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", systemAdminToken, createUserRequest{
		Email: "independent-scopes@example.com", DisplayName: "Independent Scopes", Password: "agent-password",
		Role: UserRoleAgent, PermissionsCustomized: true,
		Permissions:        []string{PermissionWorkbenchAccess, PermissionConversationReply, PermissionShopsView, PermissionShopChannelsManage},
		WorkbenchShopScope: AccessScopeAssigned, ConversationScope: AccessScopeAll,
	}, http.StatusCreated, &agent)
	if _, err := store.AssignUserToShop(t.Context(), assignedShop.ID, agent.ID); err != nil {
		t.Fatalf("assign shop failed: %v", err)
	}

	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email: "independent-scopes@example.com", Password: "agent-password",
	}, http.StatusOK, &login)

	var managementShops []Shop
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/shops", login.Token, nil, http.StatusOK, &managementShops)
	if len(managementShops) != 1 || managementShops[0].ID != assignedShop.ID {
		t.Fatalf("assigned management scope should expose only the assigned shop, got %#v", managementShops)
	}
	var workbenchShops []Shop
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/shops?scope=workbench", login.Token, nil, http.StatusOK, &workbenchShops)
	if len(workbenchShops) != 1 || workbenchShops[0].ID != assignedShop.ID {
		t.Fatalf("workbench scope should expose only the assigned shop, got %#v", workbenchShops)
	}
	var managementSources []ShopSource
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/sources", login.Token, nil, http.StatusOK, &managementSources)
	if len(managementSources) != 1 || managementSources[0].ShopID != assignedShop.ID {
		t.Fatalf("assigned management source scope should expose only the assigned shop, got %#v", managementSources)
	}
	var workbenchSources []ShopSource
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/sources?scope=workbench", login.Token, nil, http.StatusOK, &workbenchSources)
	if len(workbenchSources) != 1 || workbenchSources[0].ShopID != assignedShop.ID {
		t.Fatalf("workbench source scope should expose only the assigned shop, got %#v", workbenchSources)
	}

	selected := AccessScopeSelected
	selectedIDs := []string{otherShop.ID}
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/users/"+agent.ID, systemAdminToken, updateUserRequest{
		ShopScope: &selected, ShopScopeIDs: &selectedIDs,
	}, http.StatusOK, &agent)
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/shops", login.Token, nil, http.StatusOK, &managementShops)
	if len(managementShops) != 1 || managementShops[0].ID != otherShop.ID {
		t.Fatalf("selected management scope should expose only the selected shop, got %#v", managementShops)
	}
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/shops/"+assignedShop.ID+"/sources", login.Token, nil, http.StatusForbidden, nil)
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/shops/"+otherShop.ID+"/sources", login.Token, nil, http.StatusOK, nil)
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/shops/"+assignedShop.ID+"/sources/"+assignedSource.ID, login.Token, updateShopSourceRequest{Status: SourceStatusActive}, http.StatusForbidden, nil)
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/shops/"+otherShop.ID+"/sources/"+otherSource.ID, login.Token, updateShopSourceRequest{Status: SourceStatusActive}, http.StatusOK, nil)

	all := AccessScopeAll
	emptyIDs := []string{}
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/users/"+agent.ID, systemAdminToken, updateUserRequest{
		ShopScope: &all, ShopScopeIDs: &emptyIDs,
	}, http.StatusOK, &agent)
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/shops", login.Token, nil, http.StatusOK, &managementShops)
	if len(managementShops) != 2 {
		t.Fatalf("all management scope should expose both shops, got %#v", managementShops)
	}
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/shops?scope=workbench", login.Token, nil, http.StatusOK, &workbenchShops)
	if len(workbenchShops) != 1 || workbenchShops[0].ID != assignedShop.ID {
		t.Fatalf("shop management scope must not change the workbench scope, got %#v", workbenchShops)
	}
	var conversations []Conversation
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations?scope=all", login.Token, nil, http.StatusOK, &conversations)
	if len(conversations) != 1 || conversations[0].ID != assignedConversation.ID {
		t.Fatalf("workbench conversations should be limited to assigned shops, got %#v", conversations)
	}
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations/"+otherConversation.ID+"/messages", login.Token, nil, http.StatusForbidden, nil)
}

func TestSelectedShopScopeRequiresExistingShopsAndFiltersEvents(t *testing.T) {
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	systemAdminToken := bootstrapAdmin(t, server.URL)
	shop, _ := store.CreateShop(t.Context(), Shop{DisplayName: "Selected Shop"})

	selected := AccessScopeSelected
	emptyIDs := []string{}
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", systemAdminToken, createUserRequest{
		Email: "empty-selected-scope@example.com", DisplayName: "Empty Scope", Password: "agent-password",
		Role: UserRoleAgent, ShopScope: selected, ShopScopeIDs: emptyIDs,
	}, http.StatusBadRequest, nil)

	client := &eventClient{
		user:         User{Role: UserRoleAgent, ShopScope: selected, ShopScopeIDs: []string{shop.ID}},
		assignedShop: map[string]bool{"another-shop": true},
	}
	if !client.canAccessScopedShop(AccessScopeSelected, shop.ID) {
		t.Fatal("selected shop event should be visible")
	}
	if client.canAccessScopedShop(AccessScopeSelected, "another-shop") {
		t.Fatal("assignment must not expand selected shop events")
	}
	if !client.canAccessScopedShop(AccessScopeAssigned, "another-shop") {
		t.Fatal("assigned workbench event should remain visible")
	}
}

func TestGranularLogisticsPermissionDoesNotGrantShopMutation(t *testing.T) {
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	systemAdminToken := bootstrapAdmin(t, server.URL)
	shop, _ := store.CreateShop(t.Context(), Shop{DisplayName: "Protected Shop"})

	var user User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", systemAdminToken, createUserRequest{
		Email: "logistics-only@example.com", DisplayName: "Logistics Only", Password: "agent-password",
		Role: UserRoleAgent, PermissionsCustomized: true, Permissions: []string{PermissionLogisticsManage},
		ShopScope: AccessScopeAll,
	}, http.StatusCreated, &user)
	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email: "logistics-only@example.com", Password: "agent-password",
	}, http.StatusOK, &login)

	requestJSON(t, http.MethodGet, server.URL+"/api/v1/settings/logistics", login.Token, nil, http.StatusOK, nil)
	requestJSON(t, http.MethodDelete, server.URL+"/api/v1/shops/"+shop.ID, login.Token, nil, http.StatusForbidden, nil)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", login.Token, Shop{DisplayName: "Forbidden"}, http.StatusForbidden, nil)
}

func TestAccountAuditLogsAndEventPermissions(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	systemAdminToken := bootstrapAdmin(t, server.URL)

	var agent User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", systemAdminToken, createUserRequest{
		Email: "audited-agent@example.com", DisplayName: "Audited Agent", Password: "agent-password", Role: UserRoleAgent,
	}, http.StatusCreated, &agent)
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/users/"+agent.ID, systemAdminToken, updateUserRequest{DisplayName: "Updated Agent"}, http.StatusOK, &agent)

	var logs []AccountAuditLog
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/users/"+agent.ID+"/audit-logs", systemAdminToken, nil, http.StatusOK, &logs)
	if len(logs) != 2 || logs[0].Action != "user.updated" || logs[1].Action != "user.created" {
		t.Fatalf("unexpected account audit logs: %#v", logs)
	}

	workbenchOnly := User{Role: UserRoleAgent}
	if clientCanReceiveEvent(workbenchOnly, Event{Type: "user.updated"}) {
		t.Fatal("workbench-only users must not receive account events")
	}
	if clientCanReceiveEvent(workbenchOnly, Event{Type: "ticket.created"}) != userHasPermission(workbenchOnly, PermissionTicketsView) {
		t.Fatal("ticket events must follow ticket view permission")
	}
	manager := User{Role: UserRoleAdmin}
	if !clientCanReceiveEvent(manager, Event{Type: "user.updated"}) {
		t.Fatal("account viewers should receive account events")
	}
}
