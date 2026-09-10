package cn.xzkj.erp.iam.security;

import java.util.Optional;
import java.util.UUID;

public final class TenantContext {

    private static final ThreadLocal<UUID> CURRENT_TENANT = new ThreadLocal<>();

    private TenantContext() {
    }

    public static Optional<UUID> currentTenantId() {
        return Optional.ofNullable(CURRENT_TENANT.get());
    }

    static void set(UUID tenantId) {
        CURRENT_TENANT.set(tenantId);
    }

    static void clear() {
        CURRENT_TENANT.remove();
    }
}
