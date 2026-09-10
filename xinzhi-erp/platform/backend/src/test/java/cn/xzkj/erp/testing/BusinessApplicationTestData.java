package cn.xzkj.erp.testing;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.UUID;

/** Test-only setup for explicitly opened business applications. */
public final class BusinessApplicationTestData {

    private BusinessApplicationTestData() {
    }

    public static void enableErpForTenant(
            Connection connection,
            UUID tenantId) throws SQLException {
        try (PreparedStatement entitlementSet = connection.prepareStatement("""
                INSERT INTO tenant_entitlement_sets (
                    tenant_id, version, updated_at
                ) VALUES (?, 0, now())
                ON CONFLICT (tenant_id) DO NOTHING
                """)) {
            entitlementSet.setObject(1, tenantId);
            entitlementSet.executeUpdate();
        }
        try (PreparedStatement modules = connection.prepareStatement("""
                INSERT INTO tenant_enabled_application_modules (
                    tenant_id, application_code, module_code, enabled_at
                )
                SELECT ?, 'ERP', module_code, now()
                FROM (VALUES
                    ('CHANNELS'), ('PRODUCTS'), ('ORDERS'), ('PROCUREMENT'),
                    ('WAREHOUSE'), ('LOGISTICS'), ('ANALYTICS')
                ) AS enabled(module_code)
                ON CONFLICT (tenant_id, application_code, module_code)
                DO NOTHING
                """)) {
            modules.setObject(1, tenantId);
            modules.executeUpdate();
        }
        try (PreparedStatement accessSets = connection.prepareStatement("""
                INSERT INTO user_application_access_sets (
                    tenant_id, user_id, version, updated_at
                )
                SELECT tenant_id, id, 0, now()
                FROM users
                WHERE tenant_id = ?
                ON CONFLICT (tenant_id, user_id) DO NOTHING
                """)) {
            accessSets.setObject(1, tenantId);
            accessSets.executeUpdate();
        }
        try (PreparedStatement userAccess = connection.prepareStatement("""
                INSERT INTO user_enabled_applications (
                    tenant_id, user_id, application_code, enabled_at
                )
                SELECT tenant_id, id, 'ERP', now()
                FROM users
                WHERE tenant_id = ?
                ON CONFLICT (tenant_id, user_id, application_code) DO NOTHING
                """)) {
            userAccess.setObject(1, tenantId);
            userAccess.executeUpdate();
        }
    }
}
