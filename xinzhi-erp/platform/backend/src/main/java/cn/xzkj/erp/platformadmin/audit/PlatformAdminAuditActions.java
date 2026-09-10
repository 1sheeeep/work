package cn.xzkj.erp.platformadmin.audit;

public final class PlatformAdminAuditActions {

    public static final String LOGIN_SUCCEEDED = "platform_admin.login.succeeded";
    public static final String LOGIN_FAILED = "platform_admin.login.failed";
    public static final String LOGIN_THROTTLED = "platform_admin.login.throttled";
    public static final String SESSION_REVOKED = "platform_admin.session.revoked";
    public static final String PASSWORD_CHANGED =
            "platform_admin.password_changed";
    public static final String CREDENTIAL_REDEEMED =
            "platform_admin.password_credential.redeemed";
    public static final String SYSTEM_ADMIN_CREATED =
            "platform_admin.system_admin.created";
    public static final String SYSTEM_ADMIN_UPDATED =
            "platform_admin.system_admin.updated";
    public static final String SYSTEM_ADMIN_STATUS_CHANGED =
            "platform_admin.system_admin.status_changed";
    public static final String SYSTEM_ADMIN_DELETED =
            "platform_admin.system_admin.deleted";
    public static final String SYSTEM_ADMIN_PASSWORD_RESET =
            "platform_admin.system_admin.password_reset";
    public static final String CREDENTIAL_ISSUED =
            "platform_admin.password_credential.issued";
    public static final String TENANT_CREATED = "platform_admin.tenant.created";
    public static final String TENANT_UPDATED = "platform_admin.tenant.updated";
    public static final String TENANT_DELETED = "platform_admin.tenant.deleted";
    public static final String TENANT_ENTITLEMENTS_UPDATED =
            "platform_admin.tenant_entitlements.updated";
    public static final String ENTERPRISE_ADMIN_CREATED =
            "platform_admin.enterprise_admin.created";
    public static final String ENTERPRISE_ADMIN_UPDATED =
            "platform_admin.enterprise_admin.updated";
    public static final String ENTERPRISE_ADMIN_PASSWORD_RESET =
            "platform_admin.enterprise_admin.password_reset";
    public static final String TENANT_ENTERED = "platform_admin.tenant.entered";
    public static final String TENANT_SESSION_REVOKED =
            "platform_admin.tenant_session.revoked";
    public static final String LOGISTICS_PROVIDER_CONFIG_UPDATED =
            "platform_admin.logistics_provider_config.updated";
    public static final String SHOPIFY_APP_RELEASE_TOKEN_UPDATED =
            "platform_admin.shopify_app_release.token_updated";
    public static final String SHOPIFY_APP_RELEASE_TOKEN_CLEARED =
            "platform_admin.shopify_app_release.token_cleared";
    public static final String SHOPIFY_APP_RELEASE_SUCCEEDED =
            "platform_admin.shopify_app_release.succeeded";
    public static final String SHOPIFY_APP_RELEASE_FAILED =
            "platform_admin.shopify_app_release.failed";
    public static final String SHOPIFY_COMPLIANCE_EXPORT_PREPARED =
            "platform_admin.shopify_compliance.export_prepared";
    public static final String SHOPIFY_COMPLIANCE_EXPORT_DELIVERED =
            "platform_admin.shopify_compliance.export_delivered";
    public static final String SHOPIFY_COMPLIANCE_DATA_REDACTED =
            "platform_admin.shopify_compliance.data_redacted";
    public static final String BOOTSTRAP_PROVISIONED =
            "platform_admin.bootstrap.provisioned";
    public static final String BOOTSTRAP_RECOVERY_ISSUED =
            "platform_admin.bootstrap.recovery_issued";

    private PlatformAdminAuditActions() {
    }
}
