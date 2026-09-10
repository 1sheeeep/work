package cn.xzkj.erp.iam.domain;

import java.util.Set;

/**
 * Stable permissions for tenant-scoped IAM administration.
 * Constants define authorization contracts only and grant nothing.
 */
public final class IamPermissionCodes {

    public static final String USER_READ = "iam:user:read";
    public static final String USER_WRITE = "iam:user:write";
    public static final String ROLE_READ = "iam:role:read";
    public static final String ROLE_WRITE = "iam:role:write";
    public static final String PERMISSION_READ = "iam:permission:read";
    public static final String PERMISSION_ASSIGN = "iam:permission:assign";
    public static final String AUDIT_READ = "iam:audit:read";
    public static final String WAREHOUSE_SCOPE_READ =
            "iam:warehouse:scope:read";
    public static final String WAREHOUSE_SCOPE_WRITE =
            "iam:warehouse:scope:write";

    private IamPermissionCodes() {
    }

    public static Set<String> all() {
        return Set.of(
                USER_READ,
                USER_WRITE,
                ROLE_READ,
                ROLE_WRITE,
                PERMISSION_READ,
                PERMISSION_ASSIGN,
                AUDIT_READ,
                WAREHOUSE_SCOPE_READ,
                WAREHOUSE_SCOPE_WRITE);
    }
}
