package cn.xzkj.erp.iam.domain;

public final class SecurityAuditActions {

    public static final String LOGIN_SUCCEEDED = "iam.login.succeeded";
    public static final String LOGIN_FAILED = "iam.login.failed";
    public static final String LOGIN_THROTTLED = "iam.login.throttled";
    public static final String SESSION_REVOKED = "iam.session.revoked";
    public static final String USER_CREATED = "iam.user.created";
    public static final String USER_UPDATED = "iam.user.updated";
    public static final String USER_STATUS_CHANGED = "iam.user.status_changed";
    public static final String USER_ROLES_REPLACED = "iam.user.roles_replaced";
    public static final String USER_APPLICATIONS_REPLACED =
            "iam.user.applications_replaced";
    public static final String USER_PASSWORD_CHANGED =
            "iam.user.password_changed";
    public static final String USER_PASSWORD_RESET_BY_ADMIN =
            "iam.user.password_reset_by_admin";
    public static final String PASSWORD_CREDENTIAL_ISSUED =
            "iam.user.password_credential_issued";
    public static final String PASSWORD_CREDENTIAL_REVOKED =
            "iam.user.password_credential_revoked";
    public static final String USER_ACTIVATED = "iam.user.activated";
    public static final String USER_PASSWORD_RESET = "iam.user.password_reset";
    public static final String ROLE_CREATED = "iam.role.created";
    public static final String ROLE_UPDATED = "iam.role.updated";
    public static final String ROLE_PERMISSIONS_REPLACED =
            "iam.role.permissions_replaced";
    public static final String WAREHOUSE_SCOPE_UPDATED =
            "iam.warehouse_scope.updated";
    public static final String BOOTSTRAP_ADMIN_PROVISIONED =
            "iam.bootstrap.admin_provisioned";
    public static final String CUSTOMER_SERVICE_ENTRY_GRANT_ISSUED =
            "customer_service.entry_grant.issued";
    public static final String CUSTOMER_SERVICE_ENTRY_GRANT_REDEEMED =
            "customer_service.entry_grant.redeemed";
    public static final String FIRST_PARTY_ENTRY_GRANT_ISSUED =
            "iam.first_party_entry_grant.issued";
    public static final String FIRST_PARTY_ENTRY_GRANT_REDEEMED =
            "iam.first_party_entry_grant.redeemed";

    private SecurityAuditActions() {
    }
}
