package cn.xzkj.erp.config;

import static org.assertj.core.api.Assertions.assertThat;

import cn.xzkj.erp.ErpApplication;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.OffsetDateTime;
import java.util.Collections;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.flywaydb.core.Flyway;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.junit.jupiter.api.Test;

class Pg16BackupRestoreRehearsalIT {

    private static final String ENABLED =
            "XZ_ERP_BACKUP_RESTORE_REHEARSAL";
    private static final String PHASE =
            "XZ_ERP_BACKUP_RESTORE_PHASE";
    private static final String JDBC_URL =
            "XZ_ERP_BACKUP_RESTORE_JDBC_URL";
    private static final String USER =
            "XZ_ERP_BACKUP_RESTORE_USER";
    private static final String PASSWORD =
            "XZ_ERP_BACKUP_RESTORE_PASSWORD";
    private static final String SNAPSHOT =
            "XZ_ERP_BACKUP_RESTORE_SNAPSHOT";
    private static final String EVIDENCE =
            "XZ_ERP_BACKUP_RESTORE_EVIDENCE";
    private static final String DATASET_VERSION =
            "v1-v89-synthetic-1";
    private static final int LATEST_MIGRATION = 89;
    private static final int MIGRATION_COUNT = 63;
    private static final String SHARED_USER = "synthetic.operator";
    private static final String SHARED_PRODUCT_CODE = "SHARED_PRODUCT";
    private static final String SHARED_SKU_CODE = "SHARED_SKU";
    private static final String SHARED_WAREHOUSE_CODE = "SHARED_WH";
    private static final String SHARED_SUPPLIER_CODE = "SHARED_SUPPLIER";
    private static final OffsetDateTime CREATED_AT =
            OffsetDateTime.parse("2026-01-15T08:00:00Z");
    private static final OffsetDateTime UPDATED_AT =
            OffsetDateTime.parse("2026-01-15T08:30:00Z");
    private static final OffsetDateTime EXPIRES_AT =
            OffsetDateTime.parse("2026-01-16T08:00:00Z");

    /*
     * Executable fixture data dictionary. Every tenant-owned aggregate has
     * exactly one row per tenant. Both tenants intentionally reuse the same
     * user name and business codes to prove that uniqueness remains scoped.
     * IDs and timestamps are synthetic constants; password/token columns hold
     * only one-way hashes derived from explicit test-only seeds.
     */
    private static final Map<String, Integer> EXPECTED_COUNTS =
            Map.ofEntries(
                    Map.entry("tenants", 2),
                    Map.entry("users", 2),
                    Map.entry("roles", 2),
                    Map.entry("auditLogs", 2),
                    Map.entry("authSessions", 2),
                    Map.entry("passwordCredentials", 2),
                    Map.entry("shops", 2),
                    Map.entry("productSpus", 2),
                    Map.entry("productSkus", 2),
                    Map.entry("productListings", 2),
                    Map.entry("orders", 2),
                    Map.entry("orderLines", 2),
                    Map.entry("warehouses", 2),
                    Map.entry("warehouseLocations", 2),
                    Map.entry("suppliers", 2),
                    Map.entry("supplierSkuMappings", 2));

    private static final Map<String, String> COUNT_QUERIES =
            orderedMap(new String[][]{
                {"tenants", "SELECT count(*) FROM tenants"},
                {"users", "SELECT count(*) FROM users"},
                {"roles", "SELECT count(*) FROM roles"},
                {"auditLogs", "SELECT count(*) FROM audit_logs"},
                {"authSessions", "SELECT count(*) FROM auth_sessions"},
                {"passwordCredentials",
                    "SELECT count(*) FROM password_credentials"},
                {"shops", "SELECT count(*) FROM tenant_shops"},
                {"productSpus",
                    "SELECT count(*) FROM tenant_product_spus"},
                {"productSkus",
                    "SELECT count(*) FROM tenant_product_skus"},
                {"productListings",
                    "SELECT count(*) FROM tenant_product_listings"},
                {"orders", "SELECT count(*) FROM tenant_orders"},
                {"orderLines", "SELECT count(*) FROM tenant_order_lines"},
                {"warehouses", "SELECT count(*) FROM tenant_warehouses"},
                {"warehouseLocations",
                    "SELECT count(*) FROM tenant_warehouse_locations"},
                {"suppliers", "SELECT count(*) FROM tenant_suppliers"},
                {"supplierSkuMappings",
                    "SELECT count(*) FROM tenant_supplier_sku_mappings"},
            });

    private static final Map<String, String> FINGERPRINT_QUERIES =
            orderedMap(new String[][]{
                {"tenants", """
                    SELECT id, code, name, status, created_at, updated_at,
                           version
                    FROM tenants ORDER BY id
                    """},
                {"users", """
                    SELECT id, tenant_id, username, display_name,
                           password_hash, status, created_at, updated_at,
                           version
                    FROM users ORDER BY id
                    """},
                {"roles", """
                    SELECT id, tenant_id, code, name, system_role,
                           created_at, updated_at, version
                    FROM roles ORDER BY id
                    """},
                {"user_roles", """
                    SELECT tenant_id, user_id, role_id, created_at
                    FROM user_roles ORDER BY user_id, role_id
                    """},
                {"role_permissions", """
                    SELECT tenant_id, role_id, permission_id, created_at
                    FROM role_permissions ORDER BY role_id, permission_id
                    """},
                {"audit_logs", """
                    SELECT id, tenant_id, actor_user_id, action,
                           resource_type, resource_id, request_id,
                           source_ip, details::text, created_at
                    FROM audit_logs ORDER BY tenant_id, id
                    """},
                {"auth_sessions", """
                    SELECT id, tenant_id, user_id, token_hash, expires_at,
                           revoked_at, created_at
                    FROM auth_sessions ORDER BY id
                    """},
                {"password_credentials", """
                    SELECT id, tenant_id, user_id, purpose, token_hash,
                           expires_at, consumed_at, revoked_at,
                           created_by_user_id,
                           created_by_system_admin_id, created_at, version
                    FROM password_credentials ORDER BY id
                    """},
                {"platform_catalog", """
                    SELECT id, code, display_name, status, created_at,
                           updated_at, version
                    FROM platform_catalog ORDER BY id
                    """},
                {"tenant_shops", """
                    SELECT id, tenant_id, platform_id, external_shop_ref,
                           display_name, status, created_at, updated_at,
                           version
                    FROM tenant_shops ORDER BY id
                    """},
                {"tenant_product_spus", """
                    SELECT id, tenant_id, business_code, name, status,
                           created_at, updated_at, version
                    FROM tenant_product_spus ORDER BY id
                    """},
                {"tenant_product_skus", """
                    SELECT id, tenant_id, spu_id, business_code, name,
                           status, created_at, updated_at, version
                    FROM tenant_product_skus ORDER BY id
                    """},
                {"tenant_product_listings", """
                    SELECT id, tenant_id, shop_id, platform_id, sku_id,
                           external_listing_ref, external_variant_ref,
                           status, created_at, updated_at, version
                    FROM tenant_product_listings ORDER BY id
                    """},
                {"tenant_orders", """
                    SELECT id, tenant_id, shop_id, external_order_ref,
                           idempotency_key, request_fingerprint, currency,
                           status, line_count, placed_at, created_at,
                           updated_at, version
                    FROM tenant_orders ORDER BY id
                    """},
                {"tenant_order_lines", """
                    SELECT id, tenant_id, order_id, sku_id,
                           external_line_ref, title_snapshot, quantity,
                           unit_price_minor, currency, external_listing_ref,
                           external_variant_ref, sku_match_source, created_at
                    FROM tenant_order_lines ORDER BY id
                    """},
                {"tenant_warehouses", """
                    SELECT id, tenant_id, business_code, name, status,
                           created_at, updated_at, version
                    FROM tenant_warehouses ORDER BY id
                    """},
                {"tenant_warehouse_locations", """
                    SELECT id, tenant_id, warehouse_id, business_code,
                           name, status, created_at, updated_at, version
                    FROM tenant_warehouse_locations ORDER BY id
                    """},
                {"tenant_suppliers", """
                    SELECT id, tenant_id, business_code, name, status,
                           created_at, updated_at, version
                    FROM tenant_suppliers ORDER BY id
                    """},
                {"tenant_supplier_sku_mappings", """
                    SELECT id, tenant_id, supplier_id, sku_id,
                           supplier_sku_code, status, preferred,
                           lead_time_days, created_at, updated_at, version
                    FROM tenant_supplier_sku_mappings ORDER BY id
                    """},
                {"sequences", """
                    SELECT schemaname, sequencename, start_value,
                           min_value, max_value, increment_by, cycle,
                           cache_size, last_value
                    FROM pg_catalog.pg_sequences
                    WHERE schemaname = 'public'
                    ORDER BY sequencename
                    """},
            });

    private static final List<String> CRITICAL_CONSTRAINTS = List.of(
            "fk_user_roles_user_tenant",
            "ck_auth_sessions_token_hash",
            "uq_tenant_product_spus_code",
            "fk_tenant_order_lines_order",
            "fk_tenant_warehouse_locations_warehouse",
            "fk_tenant_supplier_sku_mappings_supplier",
            "ck_tenant_supplier_sku_mappings_timestamps");

    private static final List<String> CRITICAL_INDEXES = List.of(
            "idx_users_tenant_status",
            "uq_password_credentials_active_purpose",
            "idx_tenant_product_skus_tenant_spu_status_code",
            "idx_tenant_orders_shop_status",
            "idx_tenant_warehouse_locations_list",
            "idx_tenant_suppliers_list",
            "uq_tenant_supplier_sku_mappings_active_preferred");

    @Test
    void preparesOrValidatesIsolatedBackupRestoreDataset() throws Exception {
        assertThat(System.getenv(ENABLED)).isEqualTo("true");
        String phase = requiredEnvironment(PHASE);
        assertThat(phase).isIn("prepare", "validate");
        String jdbcUrl = requiredEnvironment(JDBC_URL);
        String username = requiredEnvironment(USER);
        String password = requiredEnvironment(PASSWORD);
        Path snapshot = ownedOutputPath(requiredEnvironment(SNAPSHOT));
        Path evidence = ownedOutputPath(requiredEnvironment(EVIDENCE));
        assertLoopbackJdbcUrl(jdbcUrl);
        assertPostgres16(jdbcUrl, username, password);

        if (phase.equals("prepare")) {
            prepareSource(
                    jdbcUrl,
                    username,
                    password,
                    snapshot,
                    evidence);
        } else {
            validateRestored(
                    jdbcUrl,
                    username,
                    password,
                    snapshot,
                    evidence);
        }
    }

    private static void prepareSource(
            String jdbcUrl,
            String username,
            String password,
            Path snapshot,
            Path evidence) throws Exception {
        assertThat(Files.exists(snapshot)).isFalse();
        assertThat(Files.exists(evidence)).isFalse();
        Flyway flyway = flyway(jdbcUrl, username, password);
        assertThat(flyway.migrate().migrationsExecuted)
                .isEqualTo(MIGRATION_COUNT);
        assertFlywayState(flyway, jdbcUrl, username, password);

        try (Connection connection =
                DriverManager.getConnection(jdbcUrl, username, password)) {
            connection.setAutoCommit(false);
            insertSyntheticFixture(connection);
            connection.commit();
            assertSyntheticDataset(connection);
            Files.writeString(
                    snapshot,
                    snapshotText(connection),
                    StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE_NEW);
        }
    }

    private static void validateRestored(
            String jdbcUrl,
            String username,
            String password,
            Path snapshot,
            Path evidence) throws Exception {
        assertThat(Files.isRegularFile(snapshot)).isTrue();
        assertThat(Files.exists(evidence)).isFalse();
        Flyway flyway = flyway(jdbcUrl, username, password);
        assertFlywayState(flyway, jdbcUrl, username, password);

        try (Connection connection =
                DriverManager.getConnection(jdbcUrl, username, password)) {
            assertThat(snapshotText(connection))
                    .isEqualTo(Files.readString(
                            snapshot,
                            StandardCharsets.UTF_8));
            assertSyntheticDataset(connection);
            assertSchemaObjects(connection);
            assertTenantBoundaryFailures(connection);
        }

        assertHibernateValidate(jdbcUrl, username, password);
        Files.writeString(
                evidence,
                evidenceJson(),
                StandardCharsets.UTF_8,
                StandardOpenOption.CREATE_NEW);
    }

    private static Flyway flyway(
            String jdbcUrl,
            String username,
            String password) {
        return Flyway.configure()
                .dataSource(jdbcUrl, username, password)
                .locations("classpath:db/migration")
                .cleanDisabled(true)
                .outOfOrder(false)
                .load();
    }

    private static void assertFlywayState(
            Flyway flyway,
            String jdbcUrl,
            String username,
            String password) throws Exception {
        flyway.validate();
        assertThat(flyway.info().pending()).isEmpty();
        assertThat(flyway.info().current()).isNotNull();
        assertThat(flyway.info().current().getVersion().getVersion())
                .isEqualTo(String.valueOf(LATEST_MIGRATION));
        try (Connection connection =
                        DriverManager.getConnection(
                                jdbcUrl,
                                username,
                                password);
                Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery("""
                        SELECT count(*),
                               count(*) FILTER (WHERE success),
                               max(version::integer)
                        FROM flyway_schema_history
                        WHERE version IS NOT NULL
                        """)) {
            assertThat(result.next()).isTrue();
            assertThat(result.getInt(1)).isEqualTo(MIGRATION_COUNT);
            assertThat(result.getInt(2)).isEqualTo(MIGRATION_COUNT);
            assertThat(result.getInt(3)).isEqualTo(LATEST_MIGRATION);
        }
    }

    private static void insertSyntheticFixture(Connection connection)
            throws Exception {
        insertTenantIdentityFixture(connection, 1);
        insertTenantIdentityFixture(connection, 2);
        execute(
                connection,
                """
                INSERT INTO platform_catalog (
                    id, code, display_name, status, created_at, updated_at
                ) VALUES (
                    '20000000-0000-0000-0000-000000000001',
                    'SYNTHETIC', 'Synthetic platform', 'ACTIVE', ?, ?
                )
                """,
                CREATED_AT,
                UPDATED_AT);
        insertTenantBusinessFixture(connection, 1);
        insertTenantBusinessFixture(connection, 2);
    }

    private static void insertTenantIdentityFixture(
            Connection connection,
            int tenantNumber) throws Exception {
        String suffix = String.valueOf(tenantNumber);
        String tenantId = fixtureId("10", suffix);
        String userId = fixtureId("11", suffix);
        String roleId = fixtureId("12", suffix);
        String sessionId = fixtureId("13", suffix);
        String credentialId = fixtureId("14", suffix);

        execute(
                connection,
                """
                INSERT INTO tenants (
                    id, code, name, status, created_at, updated_at
                ) VALUES (?::uuid, ?, ?, 'ACTIVE', ?, ?)
                """,
                tenantId,
                "synthetic_tenant_" + suffix,
                "Synthetic Tenant " + suffix,
                CREATED_AT,
                UPDATED_AT);
        execute(
                connection,
                """
                INSERT INTO users (
                    id, tenant_id, username, display_name, password_hash,
                    status, created_at, updated_at
                ) VALUES (
                    ?::uuid, ?::uuid, ?, ?, ?, 'ACTIVE', ?, ?
                )
                """,
                userId,
                tenantId,
                SHARED_USER,
                "Synthetic Operator " + suffix,
                syntheticPasswordHash("password-seed-" + suffix),
                CREATED_AT,
                UPDATED_AT);
        execute(
                connection,
                """
                INSERT INTO roles (
                    id, tenant_id, code, name, system_role,
                    created_at, updated_at
                ) VALUES (
                    ?::uuid, ?::uuid, 'fixture_operator',
                    'Fixture Operator', false, ?, ?
                )
                """,
                roleId,
                tenantId,
                CREATED_AT,
                UPDATED_AT);
        execute(
                connection,
                """
                INSERT INTO user_roles (
                    tenant_id, user_id, role_id, created_at
                ) VALUES (?::uuid, ?::uuid, ?::uuid, ?)
                """,
                tenantId,
                userId,
                roleId,
                CREATED_AT);
        execute(
                connection,
                """
                INSERT INTO role_permissions (
                    tenant_id, role_id, permission_id, created_at
                ) VALUES (
                    ?::uuid, ?::uuid,
                    '71000000-0000-0000-0000-000000000001', ?
                )
                """,
                tenantId,
                roleId,
                CREATED_AT);
        execute(
                connection,
                """
                INSERT INTO auth_sessions (
                    id, tenant_id, user_id, token_hash, expires_at,
                    created_at
                ) VALUES (?::uuid, ?::uuid, ?::uuid, ?, ?, ?)
                """,
                sessionId,
                tenantId,
                userId,
                hash("session-seed-" + suffix),
                EXPIRES_AT,
                CREATED_AT);
        execute(
                connection,
                """
                INSERT INTO password_credentials (
                    id, tenant_id, user_id, purpose, token_hash,
                    expires_at, created_by_user_id, created_at
                ) VALUES (
                    ?::uuid, ?::uuid, ?::uuid, 'PASSWORD_RESET', ?,
                    ?, ?::uuid, ?
                )
                """,
                credentialId,
                tenantId,
                userId,
                hash("credential-seed-" + suffix),
                EXPIRES_AT,
                userId,
                CREATED_AT);
        execute(
                connection,
                """
                INSERT INTO audit_logs (
                    tenant_id, actor_user_id, action, resource_type,
                    resource_id, request_id, source_ip, details, created_at
                ) VALUES (
                    ?::uuid, ?::uuid, 'fixture.restore', 'backup_gate',
                    ?, ?, '127.0.0.1', '{"synthetic":true}'::jsonb, ?
                )
                """,
                tenantId,
                userId,
                "fixture-" + suffix,
                "synthetic-request-" + suffix,
                CREATED_AT);
    }

    private static void insertTenantBusinessFixture(
            Connection connection,
            int tenantNumber) throws Exception {
        String suffix = String.valueOf(tenantNumber);
        String tenantId = fixtureId("10", suffix);
        String shopId = fixtureId("21", suffix);
        String spuId = fixtureId("30", suffix);
        String skuId = fixtureId("31", suffix);
        String listingId = fixtureId("32", suffix);
        String orderId = fixtureId("40", suffix);
        String orderLineId = fixtureId("41", suffix);
        String warehouseId = fixtureId("50", suffix);
        String locationId = fixtureId("51", suffix);
        String supplierId = fixtureId("60", suffix);
        String mappingId = fixtureId("61", suffix);

        execute(
                connection,
                """
                INSERT INTO tenant_shops (
                    id, tenant_id, platform_id, external_shop_ref,
                    display_name, status, created_at, updated_at
                ) VALUES (
                    ?::uuid, ?::uuid,
                    '20000000-0000-0000-0000-000000000001',
                    'shared-shop-ref', ?, 'ACTIVE', ?, ?
                )
                """,
                shopId,
                tenantId,
                "Synthetic Shop " + suffix,
                CREATED_AT,
                UPDATED_AT);
        execute(
                connection,
                """
                INSERT INTO tenant_product_spus (
                    id, tenant_id, business_code, name, status,
                    created_at, updated_at
                ) VALUES (
                    ?::uuid, ?::uuid, ?, ?, 'ACTIVE', ?, ?
                )
                """,
                spuId,
                tenantId,
                SHARED_PRODUCT_CODE,
                "Synthetic Product " + suffix,
                CREATED_AT,
                UPDATED_AT);
        execute(
                connection,
                """
                INSERT INTO tenant_product_skus (
                    id, tenant_id, spu_id, business_code, name, status,
                    created_at, updated_at
                ) VALUES (
                    ?::uuid, ?::uuid, ?::uuid, ?, ?, 'ACTIVE', ?, ?
                )
                """,
                skuId,
                tenantId,
                spuId,
                SHARED_SKU_CODE,
                "Synthetic SKU " + suffix,
                CREATED_AT,
                UPDATED_AT);
        execute(
                connection,
                """
                INSERT INTO tenant_product_listings (
                    id, tenant_id, shop_id, platform_id, sku_id,
                    external_listing_ref, external_variant_ref, status,
                    created_at, updated_at
                ) VALUES (
                    ?::uuid, ?::uuid, ?::uuid,
                    '20000000-0000-0000-0000-000000000001',
                    ?::uuid, 'shared-listing-ref', 'shared-variant-ref',
                    'ACTIVE', ?, ?
                )
                """,
                listingId,
                tenantId,
                shopId,
                skuId,
                CREATED_AT,
                UPDATED_AT);
        execute(
                connection,
                """
                INSERT INTO tenant_orders (
                    id, tenant_id, shop_id, external_order_ref,
                    idempotency_key, request_fingerprint, currency,
                    status, line_count, placed_at, created_at, updated_at
                ) VALUES (
                    ?::uuid, ?::uuid, ?::uuid, 'shared-order-ref',
                    ?, ?, 'CNY', 'READY_TO_FULFILL', 1, ?, ?, ?
                )
                """,
                orderId,
                tenantId,
                shopId,
                "synthetic-order-" + suffix,
                hash("order-request-" + suffix),
                CREATED_AT,
                CREATED_AT,
                UPDATED_AT);
        execute(
                connection,
                """
                INSERT INTO tenant_order_lines (
                    id, tenant_id, order_id, sku_id, external_line_ref,
                    title_snapshot, quantity, unit_price_minor, currency,
                    external_listing_ref, external_variant_ref,
                    sku_match_source, created_at
                ) VALUES (
                    ?::uuid, ?::uuid, ?::uuid, ?::uuid,
                    'shared-line-ref', ?, 2, 12345, 'CNY',
                    'shared-listing-ref', 'shared-variant-ref',
                    'PROVIDED', ?
                )
                """,
                orderLineId,
                tenantId,
                orderId,
                skuId,
                "Synthetic Line " + suffix,
                CREATED_AT);
        execute(
                connection,
                """
                INSERT INTO tenant_warehouses (
                    id, tenant_id, business_code, name, status,
                    created_at, updated_at
                ) VALUES (
                    ?::uuid, ?::uuid, ?, ?, 'ACTIVE', ?, ?
                )
                """,
                warehouseId,
                tenantId,
                SHARED_WAREHOUSE_CODE,
                "Synthetic Warehouse " + suffix,
                CREATED_AT,
                UPDATED_AT);
        execute(
                connection,
                """
                INSERT INTO tenant_warehouse_locations (
                    id, tenant_id, warehouse_id, business_code, name,
                    status, created_at, updated_at
                ) VALUES (
                    ?::uuid, ?::uuid, ?::uuid, 'SHARED_BIN', ?,
                    'ACTIVE', ?, ?
                )
                """,
                locationId,
                tenantId,
                warehouseId,
                "Synthetic Bin " + suffix,
                CREATED_AT,
                UPDATED_AT);
        execute(
                connection,
                """
                INSERT INTO tenant_suppliers (
                    id, tenant_id, business_code, name, status,
                    created_at, updated_at
                ) VALUES (
                    ?::uuid, ?::uuid, ?, ?, 'ACTIVE', ?, ?
                )
                """,
                supplierId,
                tenantId,
                SHARED_SUPPLIER_CODE,
                "Synthetic Supplier " + suffix,
                CREATED_AT,
                UPDATED_AT);
        execute(
                connection,
                """
                INSERT INTO tenant_supplier_sku_mappings (
                    id, tenant_id, supplier_id, sku_id, supplier_sku_code,
                    status, preferred, lead_time_days, created_at,
                    updated_at
                ) VALUES (
                    ?::uuid, ?::uuid, ?::uuid, ?::uuid, ?,
                    'ACTIVE', true, 7, ?, ?
                )
                """,
                mappingId,
                tenantId,
                supplierId,
                skuId,
                "SYNTHETIC-SUPPLIER-SKU-" + suffix,
                CREATED_AT,
                UPDATED_AT);
    }

    private static void assertSyntheticDataset(Connection connection)
            throws Exception {
        Map<String, Integer> counts = counts(connection);
        assertThat(counts).containsExactlyInAnyOrderEntriesOf(
                EXPECTED_COUNTS);
        assertTenantScopedDuplicate(
                connection,
                "users",
                "username",
                SHARED_USER);
        assertTenantScopedDuplicate(
                connection,
                "tenant_product_spus",
                "business_code",
                SHARED_PRODUCT_CODE);
        assertTenantScopedDuplicate(
                connection,
                "tenant_product_skus",
                "business_code",
                SHARED_SKU_CODE);
        assertTenantScopedDuplicate(
                connection,
                "tenant_warehouses",
                "business_code",
                SHARED_WAREHOUSE_CODE);
        assertTenantScopedDuplicate(
                connection,
                "tenant_suppliers",
                "business_code",
                SHARED_SUPPLIER_CODE);

        assertThat(singleInt(
                connection,
                """
                SELECT count(*)
                FROM users
                WHERE password_hash
                    ~ '^synthetic-sha256\\$[0-9a-f]{64}$'
                  AND password_hash NOT LIKE '%password-seed%'
                """)).isEqualTo(2);
        assertThat(singleInt(
                connection,
                """
                SELECT count(*)
                FROM password_credentials
                WHERE token_hash ~ '^[0-9a-f]{64}$'
                """)).isEqualTo(2);
        assertThat(singleInt(
                connection,
                """
                SELECT count(*)
                FROM audit_logs
                WHERE details = '{"synthetic":true}'::jsonb
                  AND actor_user_id IS NOT NULL
                  AND created_at = '2026-01-15T08:00:00Z'::timestamptz
                """)).isEqualTo(2);
        assertThat(singleInt(
                connection,
                """
                SELECT count(*)
                FROM tenant_supplier_sku_mappings AS mapping
                JOIN tenant_suppliers AS supplier
                  ON supplier.id = mapping.supplier_id
                 AND supplier.tenant_id = mapping.tenant_id
                JOIN tenant_product_skus AS sku
                  ON sku.id = mapping.sku_id
                 AND sku.tenant_id = mapping.tenant_id
                WHERE mapping.status = 'ACTIVE'
                  AND mapping.preferred
                  AND mapping.lead_time_days = 7
                """)).isEqualTo(2);
        assertThat(singleInt(
                connection,
                """
                SELECT count(*)
                FROM tenant_orders AS orders
                JOIN tenant_order_lines AS lines
                  ON lines.order_id = orders.id
                 AND lines.tenant_id = orders.tenant_id
                 AND lines.currency = orders.currency
                JOIN tenant_product_skus AS sku
                  ON sku.id = lines.sku_id
                 AND sku.tenant_id = lines.tenant_id
                WHERE orders.line_count = 1
                  AND lines.quantity = 2
                  AND lines.sku_match_source = 'PROVIDED'
                """)).isEqualTo(2);
        assertThat(singleInt(
                connection,
                """
                SELECT count(*)
                FROM audit_logs
                WHERE pg_typeof(id)::text = 'uuid'
                  AND pg_typeof(created_at)::text
                        = 'timestamp with time zone'
                """)).isEqualTo(2);
    }

    private static void assertTenantScopedDuplicate(
            Connection connection,
            String table,
            String column,
            String value) throws Exception {
        assertThat(table).matches("[a-z_]+");
        assertThat(column).matches("[a-z_]+");
        try (PreparedStatement statement = connection.prepareStatement(
                "SELECT count(*), count(DISTINCT tenant_id) "
                        + "FROM " + table + " WHERE " + column + " = ?")) {
            statement.setString(1, value);
            try (ResultSet result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                assertThat(result.getInt(1)).isEqualTo(2);
                assertThat(result.getInt(2)).isEqualTo(2);
            }
        }
    }

    private static void assertSchemaObjects(Connection connection)
            throws Exception {
        for (String constraint : CRITICAL_CONSTRAINTS) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT count(*)
                    FROM pg_catalog.pg_constraint
                    WHERE conname = ?
                    """)) {
                statement.setString(1, constraint);
                try (ResultSet result = statement.executeQuery()) {
                    assertThat(result.next()).isTrue();
                    assertThat(result.getInt(1))
                            .as("constraint %s", constraint)
                            .isEqualTo(1);
                }
            }
        }
        for (String index : CRITICAL_INDEXES) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT count(*)
                    FROM pg_catalog.pg_class AS relation
                    JOIN pg_catalog.pg_index AS index_state
                      ON index_state.indexrelid = relation.oid
                    JOIN pg_catalog.pg_namespace AS namespace
                      ON namespace.oid = relation.relnamespace
                    WHERE namespace.nspname = 'public'
                      AND relation.relname = ?
                      AND index_state.indisvalid
                      AND index_state.indisready
                    """)) {
                statement.setString(1, index);
                try (ResultSet result = statement.executeQuery()) {
                    assertThat(result.next()).isTrue();
                    assertThat(result.getInt(1))
                            .as("index %s", index)
                            .isEqualTo(1);
                }
            }
        }
        assertThat(singleInt(
                connection,
                """
                SELECT count(*)
                FROM pg_catalog.pg_trigger
                WHERE tgname IN (
                    'trg_tenant_suppliers_prevent_delete',
                    'trg_tenant_supplier_sku_mappings_enforce_write',
                    'trg_tenant_supplier_sku_mappings_prevent_delete'
                )
                  AND NOT tgisinternal
                """)).isEqualTo(3);
    }

    private static void assertTenantBoundaryFailures(Connection connection)
            throws Exception {
        assertSqlState(
                connection,
                """
                INSERT INTO tenant_supplier_sku_mappings (
                    id, tenant_id, supplier_id, sku_id, status,
                    preferred, created_at, updated_at
                ) VALUES (
                    '61000000-0000-0000-0000-000000000099',
                    '10000000-0000-0000-0000-000000000001',
                    '60000000-0000-0000-0000-000000000001',
                    '31000000-0000-0000-0000-000000000002',
                    'ACTIVE', false, ?, ?
                )
                """,
                "23503",
                CREATED_AT,
                UPDATED_AT);
        assertSqlState(
                connection,
                """
                INSERT INTO tenant_order_lines (
                    id, tenant_id, order_id, sku_id, external_line_ref,
                    title_snapshot, quantity, unit_price_minor, currency,
                    sku_match_source, created_at
                ) VALUES (
                    '41000000-0000-0000-0000-000000000099',
                    '10000000-0000-0000-0000-000000000001',
                    '40000000-0000-0000-0000-000000000001',
                    '31000000-0000-0000-0000-000000000002',
                    'cross-tenant-line', 'Cross tenant line', 1, 1,
                    'CNY', 'PROVIDED', ?
                )
                """,
                "23503",
                CREATED_AT);
        assertSqlState(
                connection,
                """
                INSERT INTO tenant_warehouse_locations (
                    id, tenant_id, warehouse_id, business_code, name,
                    status, created_at, updated_at
                ) VALUES (
                    '51000000-0000-0000-0000-000000000099',
                    '10000000-0000-0000-0000-000000000001',
                    '50000000-0000-0000-0000-000000000002',
                    'CROSS_TENANT_BIN', 'Cross tenant bin', 'ACTIVE', ?, ?
                )
                """,
                "23503",
                CREATED_AT,
                UPDATED_AT);
    }

    private static void assertSqlState(
            Connection connection,
            String sql,
            String expectedSqlState,
            Object... values) throws Exception {
        connection.setAutoCommit(false);
        SQLException failure = null;
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            for (int index = 0; index < values.length; index += 1) {
                statement.setObject(index + 1, values[index]);
            }
            statement.executeUpdate();
        } catch (SQLException expected) {
            failure = expected;
        } finally {
            connection.rollback();
            connection.setAutoCommit(true);
        }
        assertThat((Object) failure).isNotNull();
        assertThat(failure.getSQLState()).isEqualTo(expectedSqlState);
    }

    private static void assertHibernateValidate(
            String jdbcUrl,
            String username,
            String password) {
        StandardEnvironment environment = new StandardEnvironment();
        environment.getPropertySources().remove(
                StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME);
        environment.getPropertySources().remove(
                StandardEnvironment.SYSTEM_PROPERTIES_PROPERTY_SOURCE_NAME);
        environment.getPropertySources().addFirst(new MapPropertySource(
                "backupRestoreHibernateValidation",
                Map.ofEntries(
                        Map.entry("spring.datasource.url", jdbcUrl),
                        Map.entry("spring.datasource.username", username),
                        Map.entry("spring.datasource.password", password),
                        Map.entry("spring.flyway.enabled", "false"),
                        Map.entry(
                                "spring.jpa.hibernate.ddl-auto",
                                "validate"),
                        Map.entry(
                                "spring.datasource.hikari.maximum-pool-size",
                                "2"),
                        Map.entry(
                                "spring.datasource.hikari.connection-timeout",
                                "2000"),
                        Map.entry("spring.main.banner-mode", "off"),
                        Map.entry("logging.level.root", "WARN"),
                        Map.entry("erp.environment", "local"),
                        Map.entry(
                                "erp.bootstrap.initial-admin.enabled",
                                "false"),
                        Map.entry(
                                "erp.bootstrap.platform-admin.enabled",
                                "false"))));
        try (ConfigurableApplicationContext ignored =
                new SpringApplicationBuilder(ErpApplication.class)
                        .environment(environment)
                        .web(WebApplicationType.NONE)
                        .logStartupInfo(false)
                        .run()) {
            assertThat(ignored.isActive()).isTrue();
        }
    }

    private static String snapshotText(Connection connection)
            throws Exception {
        StringBuilder snapshot = new StringBuilder();
        snapshot.append("schemaVersion=1\n")
                .append("datasetVersion=")
                .append(DATASET_VERSION)
                .append('\n')
                .append("latestMigration=")
                .append(LATEST_MIGRATION)
                .append('\n')
                .append("migrationCount=")
                .append(MIGRATION_COUNT)
                .append('\n')
                .append("datasetFingerprint=")
                .append(datasetFingerprint(connection))
                .append('\n');
        for (Map.Entry<String, Integer> count
                : counts(connection).entrySet()) {
            snapshot.append("count.")
                    .append(count.getKey())
                    .append('=')
                    .append(count.getValue())
                    .append('\n');
        }
        return snapshot.toString();
    }

    private static String datasetFingerprint(Connection connection)
            throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        for (Map.Entry<String, String> query
                : FINGERPRINT_QUERIES.entrySet()) {
            updateDigest(digest, query.getKey());
            try (Statement statement = connection.createStatement();
                    ResultSet result =
                            statement.executeQuery(query.getValue())) {
                ResultSetMetaData metadata = result.getMetaData();
                while (result.next()) {
                    for (int index = 1;
                            index <= metadata.getColumnCount();
                            index += 1) {
                        String value = result.getString(index);
                        updateDigest(
                                digest,
                                value == null ? "<null>" : value);
                    }
                }
            }
        }
        return HexFormat.of().formatHex(digest.digest());
    }

    private static void updateDigest(
            MessageDigest digest,
            String value) {
        digest.update(value.getBytes(StandardCharsets.UTF_8));
        digest.update((byte) 0);
    }

    private static Map<String, Integer> counts(Connection connection)
            throws Exception {
        Map<String, Integer> counts = new LinkedHashMap<>();
        for (Map.Entry<String, String> entry : COUNT_QUERIES.entrySet()) {
            counts.put(
                    entry.getKey(),
                    singleInt(connection, entry.getValue()));
        }
        return counts;
    }

    private static int singleInt(
            Connection connection,
            String sql) throws Exception {
        try (Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery(sql)) {
            assertThat(result.next()).isTrue();
            return result.getInt(1);
        }
    }

    private static void execute(
            Connection connection,
            String sql,
            Object... values) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            for (int index = 0; index < values.length; index += 1) {
                statement.setObject(index + 1, values[index]);
            }
            assertThat(statement.executeUpdate()).isEqualTo(1);
        }
    }

    private static String syntheticPasswordHash(String seed)
            throws Exception {
        return "synthetic-sha256$" + hash(seed);
    }

    private static String hash(String seed) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        return HexFormat.of().formatHex(
                digest.digest(seed.getBytes(StandardCharsets.UTF_8)));
    }

    private static String fixtureId(String prefix, String suffix) {
        return prefix
                + "000000-0000-0000-0000-00000000000"
                + suffix;
    }

    private static Path ownedOutputPath(String value) {
        Path path = Path.of(value).toAbsolutePath().normalize();
        assertThat(path.getParent()).isNotNull();
        Path temporaryRoot = Path.of(
                System.getProperty("java.io.tmpdir"))
                .toAbsolutePath()
                .normalize();
        assertThat(path.getParent().getParent())
                .isEqualTo(temporaryRoot);
        assertThat(path.getParent().getFileName().toString())
                .startsWith("xz-erp-pg16-backup-restore-");
        assertThat(Files.isSymbolicLink(path.getParent())).isFalse();
        assertThat(Files.isDirectory(path.getParent())).isTrue();
        assertThat(path.getFileName().toString())
                .matches("[a-z0-9][a-z0-9.-]*");
        return path;
    }

    private static void assertPostgres16(
            String jdbcUrl,
            String username,
            String password) throws Exception {
        try (Connection connection =
                        DriverManager.getConnection(
                                jdbcUrl,
                                username,
                                password);
                Statement statement = connection.createStatement();
                ResultSet result =
                        statement.executeQuery("SHOW server_version_num")) {
            assertThat(result.next()).isTrue();
            assertThat(Integer.parseInt(result.getString(1)) / 10_000)
                    .isEqualTo(16);
        }
    }

    private static void assertLoopbackJdbcUrl(String jdbcUrl) {
        assertThat(jdbcUrl).startsWith("jdbc:postgresql://");
        URI uri = URI.create(jdbcUrl.substring("jdbc:".length()));
        assertThat(uri.getScheme()).isEqualTo("postgresql");
        assertThat(uri.getUserInfo()).isNull();
        assertThat(uri.getHost()).isIn("127.0.0.1", "localhost");
        assertThat(uri.getPort()).isBetween(1, 65_535);
        assertThat(uri.getPath())
                .matches("/backup_restore_[a-z_]+");
        assertThat(uri.getQuery()).isNull();
        assertThat(uri.getFragment()).isNull();
    }

    private static String requiredEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(
                    "backup restore rehearsal environment is incomplete");
        }
        return value;
    }

    private static String evidenceJson() {
        return """
                {
                  "schemaVersion": 1,
                  "postgresMajor": 16,
                  "latestMigration": "83",
                  "migrationSuccessfulCount": 57,
                  "syntheticDatasetVersion": "v1-v89-synthetic-1",
                  "dumpFormat": "custom",
                  "counts": {
                    "tenants": 2,
                    "users": 2,
                    "roles": 2,
                    "auditLogs": 2,
                    "authSessions": 2,
                    "passwordCredentials": 2,
                    "shops": 2,
                    "productSpus": 2,
                    "productSkus": 2,
                    "productListings": 2,
                    "orders": 2,
                    "orderLines": 2,
                    "warehouses": 2,
                    "warehouseLocations": 2,
                    "suppliers": 2,
                    "supplierSkuMappings": 2
                  },
                  "countsMatched": true,
                  "constraintsValidated": true,
                  "indexesValidated": true,
                  "tenantIsolationValidated": true,
                  "passwordHashesSyntheticOnly": true,
                  "auditRowsValidated": true,
                  "sequenceUuidTimeValidated": true,
                  "flywayValidated": true,
                  "hibernateValidated": true,
                  "skipped": 0
                }
                """;
    }

    private static Map<String, String> orderedMap(String[][] entries) {
        Map<String, String> values = new LinkedHashMap<>();
        for (String[] entry : entries) {
            values.put(entry[0], entry[1]);
        }
        return Collections.unmodifiableMap(values);
    }
}
