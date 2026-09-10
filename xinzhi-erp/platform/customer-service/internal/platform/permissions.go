package platform

import (
	"fmt"
	"sort"
	"strings"
)

const (
	PermissionWorkbenchAccess        = "workbench.access"
	PermissionAutoReception          = "routing.auto_receive"
	PermissionConversationClaim      = "conversations.claim"
	PermissionConversationReply      = "conversations.reply"
	PermissionConversationTransfer   = "conversations.transfer"
	PermissionConversationClose      = "conversations.close"
	PermissionTicketsView            = "tickets.view"
	PermissionTicketsManage          = "tickets.manage"
	PermissionKnowledgeCreate        = "knowledge.create"
	PermissionKnowledgeEdit          = "knowledge.edit"
	PermissionKnowledgeDelete        = "knowledge.delete"
	PermissionKnowledgeReview        = "knowledge.review"
	PermissionKnowledgeSubmit        = "knowledge.submit" // Legacy: submission is now available to every authenticated user.
	PermissionKnowledgeManage        = "knowledge.manage" // Legacy: expands to all knowledge action permissions.
	PermissionKnowledgeImport        = "knowledge.import" // Legacy: expands to knowledge.create.
	PermissionShopsView              = "shops.view"
	PermissionShopsExport            = "shops.export"
	PermissionShopsManage            = "shops.manage"
	PermissionShopChannelsManage     = "shops.channels.manage"
	PermissionShopsAssign            = "shops.assign"
	PermissionShopsCreate            = "shops.create"
	PermissionShopsDelete            = "shops.delete"
	PermissionUsersView              = "users.view"
	PermissionUsersManage            = "users.manage"
	PermissionPermissionsManage      = "permissions.manage"
	PermissionMonitorView            = "monitor.view"
	PermissionMonitorSettingsManage  = "monitor.settings.manage"
	PermissionRecordsView            = "records.view"
	PermissionRecordsExport          = "records.export"
	PermissionOrdersManage           = "orders.manage"
	PermissionOrdersView             = "orders.view"
	PermissionOrdersRefund           = "orders.refund"
	PermissionOrdersDisputes         = "orders.disputes"
	PermissionEmailProcessingManage  = "email_processing.manage"
	PermissionEmailStatisticsView    = "email_statistics.view"
	PermissionBusinessManage         = "business.manage"
	PermissionRecordCategoriesManage = "record_categories.manage"
	PermissionVisitorSchemesManage   = "visitor_schemes.manage"
	PermissionCustomerLoginManage    = "customer_login.manage"
	PermissionLogisticsManage        = "logistics.manage"
	PermissionAIManage               = "ai.manage"
	PermissionEmailProvidersManage   = "email_providers.manage"

	AccessScopeAssigned = "assigned"
	AccessScopeSelected = "selected"
	AccessScopeAll      = "all"

	DataScopeKnowledge = "knowledge"
	DataScopeMonitor   = "monitor"
	DataScopeRecords   = "records"
	DataScopeTickets   = "tickets"
	DataScopeOrders    = "orders"
	DataScopeShops     = "shops"
)

var dataScopeModules = []string{
	DataScopeKnowledge,
	DataScopeMonitor,
	DataScopeRecords,
	DataScopeTickets,
	DataScopeOrders,
	DataScopeShops,
}

var allPermissions = []string{
	PermissionWorkbenchAccess,
	PermissionAutoReception,
	PermissionConversationClaim,
	PermissionConversationReply,
	PermissionConversationTransfer,
	PermissionConversationClose,
	PermissionTicketsView,
	PermissionTicketsManage,
	PermissionKnowledgeCreate,
	PermissionKnowledgeEdit,
	PermissionKnowledgeDelete,
	PermissionKnowledgeReview,
	PermissionShopsView,
	PermissionShopsExport,
	PermissionShopsManage,
	PermissionShopChannelsManage,
	PermissionShopsAssign,
	PermissionShopsCreate,
	PermissionShopsDelete,
	PermissionUsersView,
	PermissionUsersManage,
	PermissionPermissionsManage,
	PermissionMonitorView,
	PermissionMonitorSettingsManage,
	PermissionRecordsView,
	PermissionRecordsExport,
	PermissionOrdersManage,
	PermissionOrdersView,
	PermissionOrdersRefund,
	PermissionOrdersDisputes,
	PermissionEmailProcessingManage,
	PermissionEmailStatisticsView,
	PermissionBusinessManage,
	PermissionRecordCategoriesManage,
	PermissionVisitorSchemesManage,
	PermissionCustomerLoginManage,
	PermissionLogisticsManage,
	PermissionAIManage,
	PermissionEmailProvidersManage,
}

var systemAdminCorePermissions = []string{
	PermissionUsersView,
	PermissionUsersManage,
	PermissionPermissionsManage,
	PermissionShopsExport,
	PermissionMonitorSettingsManage,
	PermissionEmailProcessingManage,
	PermissionEmailStatisticsView,
	PermissionEmailProvidersManage,
}

var knownPermissions = func() map[string]bool {
	out := make(map[string]bool, len(allPermissions)+3)
	for _, permission := range allPermissions {
		out[permission] = true
	}
	out[PermissionKnowledgeSubmit] = true
	out[PermissionKnowledgeManage] = true
	out[PermissionKnowledgeImport] = true
	return out
}()

func defaultPermissionsForRole(role string) []string {
	return defaultPermissionsForDepartment(role, "")
}

func defaultPermissionsForDepartment(role string, department string) []string {
	if role == UserRoleAdmin {
		return normalizePermissions([]string{
			PermissionTicketsView, PermissionTicketsManage,
			PermissionShopsView, PermissionShopsExport, PermissionShopChannelsManage, PermissionShopsAssign, PermissionShopsCreate, PermissionShopsDelete,
			PermissionUsersView, PermissionUsersManage, PermissionPermissionsManage,
			PermissionMonitorView, PermissionMonitorSettingsManage, PermissionRecordsView, PermissionRecordsExport,
			PermissionOrdersView, PermissionOrdersRefund, PermissionOrdersDisputes,
			PermissionEmailProcessingManage,
			PermissionEmailStatisticsView,
			PermissionRecordCategoriesManage, PermissionVisitorSchemesManage, PermissionCustomerLoginManage,
			PermissionLogisticsManage, PermissionAIManage, PermissionEmailProvidersManage,
		})
	}
	department, _ = normalizeUserDepartment(role, department)
	if department == DepartmentFinance || department == DepartmentGeneral {
		return normalizePermissions([]string{PermissionEmailStatisticsView})
	}
	return normalizePermissions([]string{
		PermissionWorkbenchAccess,
		PermissionAutoReception,
		PermissionConversationClaim, PermissionConversationReply,
		PermissionConversationTransfer, PermissionConversationClose,
		PermissionTicketsView, PermissionTicketsManage,
		PermissionShopsView, PermissionShopChannelsManage,
	})
}

func effectivePermissions(user User) []string {
	var permissions []string
	if user.SystemAdmin {
		permissions = defaultPermissionsForRole(UserRoleAdmin)
		if user.PermissionsCustomized {
			permissions = normalizePermissions(user.Permissions)
		}
		permissions = append(permissions, systemAdminCorePermissions...)
	} else if !user.PermissionsCustomized {
		permissions = defaultPermissionsForDepartment(user.Role, user.Department)
	} else {
		permissions = normalizePermissions(user.Permissions)
	}
	permissions = normalizePermissions(permissions)
	if containsPermission(permissions, PermissionShopsManage) {
		permissions = append(permissions,
			PermissionShopsExport, PermissionShopChannelsManage, PermissionShopsAssign,
			PermissionShopsCreate, PermissionShopsDelete,
			PermissionCustomerLoginManage, PermissionLogisticsManage,
		)
	}
	if containsPermission(permissions, PermissionOrdersManage) {
		permissions = append(permissions, PermissionOrdersView, PermissionOrdersRefund, PermissionOrdersDisputes)
	}
	if containsPermission(permissions, PermissionBusinessManage) {
		permissions = append(permissions,
			PermissionRecordCategoriesManage, PermissionVisitorSchemesManage, PermissionCustomerLoginManage,
		)
	}
	if containsPermission(permissions, PermissionKnowledgeManage) {
		permissions = append(permissions,
			PermissionKnowledgeCreate,
			PermissionKnowledgeEdit,
			PermissionKnowledgeDelete,
			PermissionKnowledgeReview,
		)
	}
	if containsPermission(permissions, PermissionKnowledgeImport) {
		permissions = append(permissions, PermissionKnowledgeCreate)
	}
	return normalizePermissions(permissions)
}

func containsPermission(permissions []string, target string) bool {
	for _, permission := range permissions {
		if permission == target {
			return true
		}
	}
	return false
}

func userHasPermission(user User, permission string) bool {
	department, err := normalizeUserDepartment(user.Role, user.Department)
	if err == nil && user.Role == UserRoleAgent && department != DepartmentCustomerService && permission != PermissionEmailStatisticsView {
		return false
	}
	for _, item := range effectivePermissions(user) {
		if item == permission {
			return true
		}
	}
	return false
}

func userHasAnyPermission(user User, permissions ...string) bool {
	for _, permission := range permissions {
		if userHasPermission(user, permission) {
			return true
		}
	}
	return false
}

func userIsCustomerServiceAgent(user User) bool {
	department, err := normalizeUserDepartment(user.Role, user.Department)
	return err == nil && user.Role == UserRoleAgent && department == DepartmentCustomerService
}

func publicUser(user User) User {
	user.Permissions = effectivePermissions(user)
	user.Department, _ = normalizeUserDepartment(user.Role, user.Department)
	user.SkillGroup, _ = normalizeUserSkillGroupForDepartment(user.Role, user.Department, user.SkillGroup)
	user.DataScopes = effectiveDataScopes(user)
	user.ShopScope = effectiveModuleScope(user, DataScopeShops)
	if user.ShopScope == AccessScopeSelected {
		user.ShopScopeIDs = normalizeShopScopeIDs(user.ShopScopeIDs)
	} else {
		user.ShopScopeIDs = []string{}
	}
	user.WorkbenchShopScope = effectiveWorkbenchShopScope(user.WorkbenchShopScope)
	user.ConversationScope = effectiveAccessScope(user.ConversationScope, user.Role)
	return user
}

func normalizeUserDepartment(role string, department string) (string, error) {
	if strings.TrimSpace(role) != UserRoleAgent {
		return "", nil
	}
	switch value := strings.TrimSpace(department); value {
	case "", DepartmentCustomerService:
		return DepartmentCustomerService, nil
	case DepartmentFinance, DepartmentGeneral:
		return value, nil
	default:
		return "", fmt.Errorf("%w: unsupported department", ErrInvalid)
	}
}

func normalizeUserSkillGroup(role string, skillGroup string) (string, error) {
	return normalizeUserSkillGroupForDepartment(role, "", skillGroup)
}

func normalizeUserSkillGroupForDepartment(role string, department string, skillGroup string) (string, error) {
	department, err := normalizeUserDepartment(role, department)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(role) != UserRoleAgent || department != DepartmentCustomerService {
		return "", nil
	}
	switch value := strings.TrimSpace(skillGroup); value {
	case "":
		return SkillGroupConsulting, nil
	case SkillGroupConsulting, SkillGroupAfterSales:
		return value, nil
	default:
		return "", fmt.Errorf("%w: unsupported skill group", ErrInvalid)
	}
}

func normalizePermissions(input []string) []string {
	seen := make(map[string]bool, len(input))
	out := make([]string, 0, len(input))
	for _, permission := range input {
		permission = strings.TrimSpace(permission)
		if permission == "" || !knownPermissions[permission] || seen[permission] {
			continue
		}
		seen[permission] = true
		out = append(out, permission)
	}
	sort.Strings(out)
	return out
}

func validatePermissions(input []string) error {
	hasWorkbench := false
	hasAutoReception := false
	for _, permission := range input {
		permission = strings.TrimSpace(permission)
		if !knownPermissions[permission] {
			return fmt.Errorf("%w: unsupported permission %q", ErrInvalid, permission)
		}
		hasWorkbench = hasWorkbench || permission == PermissionWorkbenchAccess
		hasAutoReception = hasAutoReception || permission == PermissionAutoReception
	}
	if hasAutoReception && !hasWorkbench {
		return fmt.Errorf("%w: automatic reception requires workbench access", ErrInvalid)
	}
	return nil
}

func defaultAccessScope(_ string) string {
	return AccessScopeAssigned
}

// Module data access follows the corresponding feature permission. The stored
// map is retained only for backward-compatible database reads and API clients.
func defaultDataScopes(_ bool) map[string]string {
	out := make(map[string]string, len(dataScopeModules))
	for _, module := range dataScopeModules {
		out[module] = AccessScopeAll
	}
	return out
}

func normalizeDataScopes(_ map[string]string, systemAdmin bool) map[string]string {
	return defaultDataScopes(systemAdmin)
}

func effectiveDataScopes(user User) map[string]string {
	out := make(map[string]string, len(dataScopeModules))
	for _, module := range dataScopeModules {
		out[module] = effectiveModuleScope(user, module)
	}
	return out
}

func effectiveModuleScope(user User, module string) string {
	if module == DataScopeShops && userCanUseDataScopeModule(user, module) {
		return effectiveShopScope(user.ShopScope, user.Role)
	}
	if userCanUseDataScopeModule(user, module) {
		return AccessScopeAll
	}
	return AccessScopeAssigned
}

func userCanUseDataScopeModule(user User, module string) bool {
	switch module {
	case DataScopeKnowledge:
		return true
	case DataScopeMonitor:
		return userHasPermission(user, PermissionMonitorView)
	case DataScopeRecords:
		return userHasAnyPermission(user, PermissionRecordsView, PermissionRecordsExport)
	case DataScopeTickets:
		return userHasAnyPermission(user, PermissionTicketsView, PermissionTicketsManage)
	case DataScopeOrders:
		return userHasAnyPermission(user, PermissionOrdersView, PermissionOrdersRefund, PermissionOrdersDisputes)
	case DataScopeShops:
		return userHasAnyPermission(user,
			PermissionShopsView, PermissionShopsExport, PermissionShopChannelsManage, PermissionShopsAssign,
			PermissionShopsCreate, PermissionShopsDelete, PermissionVisitorSchemesManage,
			PermissionCustomerLoginManage, PermissionLogisticsManage,
		)
	default:
		return false
	}
}

func validateDataScopes(input map[string]string) error {
	known := make(map[string]bool, len(dataScopeModules))
	for _, module := range dataScopeModules {
		known[module] = true
	}
	for module, scope := range input {
		if !known[strings.TrimSpace(module)] {
			return fmt.Errorf("%w: unsupported data scope module %q", ErrInvalid, module)
		}
		if err := validateAccessScope(strings.TrimSpace(scope)); err != nil {
			return err
		}
	}
	return nil
}

func effectiveAccessScope(scope string, role string) string {
	scope = strings.TrimSpace(scope)
	if scope == AccessScopeAssigned || scope == AccessScopeAll {
		return scope
	}
	return defaultAccessScope(role)
}

func effectiveWorkbenchShopScope(scope string) string {
	scope = strings.TrimSpace(scope)
	if scope == AccessScopeAssigned || scope == AccessScopeAll {
		return scope
	}
	return AccessScopeAssigned
}

func defaultShopScope(role string) string {
	if strings.TrimSpace(role) == UserRoleAdmin {
		return AccessScopeAll
	}
	return AccessScopeAssigned
}

func effectiveShopScope(scope string, role string) string {
	scope = strings.TrimSpace(scope)
	if scope == AccessScopeAssigned || scope == AccessScopeSelected || scope == AccessScopeAll {
		return scope
	}
	return defaultShopScope(role)
}

func normalizeShopScopeIDs(input []string) []string {
	seen := make(map[string]bool, len(input))
	out := make([]string, 0, len(input))
	for _, shopID := range input {
		shopID = strings.TrimSpace(shopID)
		if shopID == "" || seen[shopID] {
			continue
		}
		seen[shopID] = true
		out = append(out, shopID)
	}
	sort.Strings(out)
	return out
}

func validateShopScope(scope string, shopIDs []string) error {
	scope = strings.TrimSpace(scope)
	if scope != "" && scope != AccessScopeAssigned && scope != AccessScopeSelected && scope != AccessScopeAll {
		return fmt.Errorf("%w: unsupported shop scope", ErrInvalid)
	}
	if scope == AccessScopeSelected && len(normalizeShopScopeIDs(shopIDs)) == 0 {
		return fmt.Errorf("%w: selected shop scope requires at least one shop", ErrInvalid)
	}
	return nil
}

func validateAccessScope(scope string) error {
	if scope != "" && scope != AccessScopeAssigned && scope != AccessScopeAll {
		return fmt.Errorf("%w: unsupported data scope", ErrInvalid)
	}
	return nil
}

func permissionsAreSubset(candidate []string, allowed []string) bool {
	allowedSet := make(map[string]bool, len(allowed))
	for _, permission := range allowed {
		allowedSet[permission] = true
	}
	for _, permission := range candidate {
		if !allowedSet[permission] {
			return false
		}
	}
	return true
}
