package cn.xzkj.erp.tenantaccess;

import cn.xzkj.erp.iam.application.IamOptimisticLockException;
import cn.xzkj.erp.tenantaccess.TenantApplicationCatalog.EnabledModule;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class TenantEntitlementStore {

    private final JdbcTemplate jdbc;

    public TenantEntitlementStore(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Snapshot read(UUID tenantId) {
        Long version = jdbc.query(
                "select version from tenant_entitlement_sets where tenant_id = ?",
                result -> result.next() ? result.getLong(1) : null,
                tenantId);
        Set<EnabledModule> modules = new LinkedHashSet<>(jdbc.query("""
                select application_code, module_code
                from tenant_enabled_application_modules
                where tenant_id = ?
                order by application_code, module_code
                """, (result, row) -> new EnabledModule(
                        result.getString("application_code"),
                        result.getString("module_code")),
                tenantId));
        return new Snapshot(version == null ? 0 : version, modules);
    }

    public long replace(
            UUID tenantId,
            long expectedVersion,
            Set<EnabledModule> enabledModules,
            UUID systemAdminId,
            Instant now) {
        int updated;
        if (expectedVersion == 0 && !exists(tenantId)) {
            updated = jdbc.update("""
                    insert into tenant_entitlement_sets (
                        tenant_id, version, updated_at, updated_by_system_admin_id
                    ) values (?, 1, ?, ?)
                    on conflict (tenant_id) do nothing
                    """, tenantId, Timestamp.from(now), systemAdminId);
        } else {
            updated = jdbc.update("""
                    update tenant_entitlement_sets
                    set version = version + 1,
                        updated_at = ?,
                        updated_by_system_admin_id = ?
                    where tenant_id = ? and version = ?
                    """, Timestamp.from(now), systemAdminId,
                    tenantId, expectedVersion);
        }
        if (updated != 1) {
            throw new IamOptimisticLockException();
        }
        jdbc.update(
                "delete from tenant_enabled_application_modules where tenant_id = ?",
                tenantId);
        for (EnabledModule module : enabledModules) {
            jdbc.update("""
                    insert into tenant_enabled_application_modules (
                        tenant_id, application_code, module_code, enabled_at
                    ) values (?, ?, ?, ?)
                    """, tenantId, module.applicationCode(), module.moduleCode(),
                    Timestamp.from(now));
        }
        return expectedVersion + 1;
    }

    private boolean exists(UUID tenantId) {
        Boolean exists = jdbc.queryForObject(
                "select exists(select 1 from tenant_entitlement_sets where tenant_id = ?)",
                Boolean.class,
                tenantId);
        return Boolean.TRUE.equals(exists);
    }

    public record Snapshot(long version, Set<EnabledModule> enabledModules) {

        public Snapshot {
            enabledModules = Set.copyOf(enabledModules);
        }
    }
}
