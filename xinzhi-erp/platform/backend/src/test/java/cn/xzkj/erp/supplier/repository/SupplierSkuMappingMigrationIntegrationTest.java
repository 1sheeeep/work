package cn.xzkj.erp.supplier.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.testcontainers.containers.PostgreSQLContainer;


@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class SupplierSkuMappingMigrationIntegrationTest {
    private static final UUID TENANT_A =
            UUID.fromString("98000000-0000-0000-0000-000000000001");
    private static final UUID TENANT_B =
            UUID.fromString("98000000-0000-0000-0000-000000000002");
    private static PostgreSQLContainer<?> postgres;
    private static String baseJdbcUrl;
    private static String username;
    private static String password;
    private static String v1Schema;
    private static String v38Schema;
    private static String emptySchema;
    private static String runtimeSchema;
    private static String v1JdbcUrl;
    private static String v38JdbcUrl;
    private static String emptyJdbcUrl;
    private static String runtimeJdbcUrl;

    @BeforeAll
    static void migrateV1V38EmptyAndRuntimeSchemas() throws Exception {
        configureDatabase();
        v1Schema = schemaName("mapping_v1");
        v38Schema = schemaName("mapping_v38");
        emptySchema = schemaName("mapping_empty");
        runtimeSchema = schemaName("mapping_runtime");
        for (String schema :
                new String[] {
                    v1Schema,
                    v38Schema,
                    emptySchema,
                    runtimeSchema
                }) {
            createSchema(schema);
        }
        v1JdbcUrl = withSchema(baseJdbcUrl, v1Schema);
        v38JdbcUrl = withSchema(baseJdbcUrl, v38Schema);
        emptyJdbcUrl = withSchema(baseJdbcUrl, emptySchema);
        runtimeJdbcUrl = withSchema(baseJdbcUrl, runtimeSchema);

        migrateTo(v1JdbcUrl, "1");
        seedTenants(v1JdbcUrl);
        migrateTo(v1JdbcUrl, "39");

        migrateTo(v38JdbcUrl, "38");
        seedTenants(v38JdbcUrl);
        seedMasterData(v38JdbcUrl, "10");
        migrateTo(v38JdbcUrl, "39");

        migrateTo(emptyJdbcUrl, "39");

        migrateAll(runtimeJdbcUrl);
        seedTenants(runtimeJdbcUrl);
        seedMasterData(runtimeJdbcUrl, "20");
        seedUser(runtimeJdbcUrl);
    }

    @AfterAll
    static void cleanUp() throws Exception {
        try {
            for (String schema :
                    new String[] {
                        v1Schema,
                        v38Schema,
                        emptySchema,
                        runtimeSchema
                    }) {
                if (schema != null) {
                    dropSchema(schema);
                }
            }
        } finally {
            if (postgres != null) {
                postgres.stop();
            }
        }
    }

    @Test
    @Order(1)
    void migratesV1V38AndEmptySchemasToExactlyV39() throws Exception {
        for (String jdbcUrl :
                new String[] {v1JdbcUrl, v38JdbcUrl, emptyJdbcUrl}) {
            try (Connection connection = DriverManager.getConnection(
                            jdbcUrl,
                            username,
                            password);
                    Statement statement = connection.createStatement();
                    ResultSet result = statement.executeQuery("""
                            SELECT
                              (SELECT count(*)
                                 FROM flyway_schema_history
                                WHERE version = '39' AND success),
                              (SELECT max(version::integer)
                                 FROM flyway_schema_history
                                WHERE success),
                              (SELECT count(*)
                                 FROM information_schema.tables
                                WHERE table_schema = current_schema()
                                  AND table_name =
                                    'tenant_supplier_sku_mappings')
                            """)) {
                result.next();
                assertThat(result.getInt(1)).isOne();
                assertThat(result.getInt(2)).isEqualTo(39);
                assertThat(result.getInt(3)).isOne();
            }
        }
    }

    @Test
    @Order(2)
    void v39AddsNoPermissionsRolesOrTenantFacts() throws Exception {
        try (var stream = SupplierSkuMappingMigrationIntegrationTest.class
                .getResourceAsStream(
                        "/db/migration/"
                                + "V39__supplier_sku_mappings.sql")) {
            assertThat(stream).isNotNull();
            String sql = new String(
                    stream.readAllBytes(),
                    StandardCharsets.UTF_8)
                    .toLowerCase();
            assertThat(sql)
                    .doesNotContain(
                            "insert into permissions",
                            "insert into role_permissions",
                            "insert into roles",
                            "insert into tenants");
        }
    }

    @Test
    @Order(3)
    void databaseEnforcesTenantPairValidationAndSoftDelete()
            throws Exception {
        try (Connection connection = DriverManager.getConnection(
                        v38JdbcUrl,
                        username,
                        password);
                Statement statement = connection.createStatement()) {
            statement.executeUpdate(insertMappingSql(
                    "100",
                    TENANT_A,
                    "101",
                    "201",
                    "' SUP-A '",
                    "ACTIVE",
                    false,
                    "7").replace("' SUP-A '", "'SUP-A'"));

            assertConstraint(statement, insertMappingSql(
                    "101",
                    TENANT_A,
                    "101",
                    "201",
                    "NULL",
                    "ACTIVE",
                    false,
                    "NULL"), "uq_tenant_supplier_sku_mappings_pair");
            assertConstraint(statement, insertMappingSql(
                    "102",
                    TENANT_A,
                    "104",
                    "201",
                    "NULL",
                    "ACTIVE",
                    false,
                    "NULL"), "supplier was not found");
            assertConstraint(statement, insertMappingSql(
                    "103",
                    TENANT_A,
                    "101",
                    "204",
                    "NULL",
                    "ACTIVE",
                    false,
                    "NULL"), "SKU was not found");
            assertConstraint(statement, insertMappingSql(
                    "104",
                    TENANT_A,
                    "102",
                    "202",
                    "' padded '",
                    "ACTIVE",
                    false,
                    "NULL"), "ck_tenant_supplier_sku_mappings_code");
            assertConstraint(statement, insertMappingSql(
                    "105",
                    TENANT_A,
                    "102",
                    "202",
                    "NULL",
                    "ARCHIVED",
                    false,
                    "NULL"), "ck_tenant_supplier_sku_mappings_status");
            assertConstraint(statement, insertMappingSql(
                    "106",
                    TENANT_A,
                    "102",
                    "202",
                    "NULL",
                    "ACTIVE",
                    false,
                    "3651"), "ck_tenant_supplier_sku_mappings_lead_time");
            assertThatThrownBy(() -> statement.executeUpdate("""
                    DELETE FROM tenant_supplier_sku_mappings
                     WHERE id =
                       '98000000-0000-0000-0000-000000000100'
                    """))
                    .hasMessageContaining(
                            "must be inactivated, not deleted");
        }
    }

    @Test
    @Order(4)
    void archivedMasterDataPreservesHistoryAndBlocksForbiddenWrites()
            throws Exception {
        try (Connection connection = DriverManager.getConnection(
                        v38JdbcUrl,
                        username,
                        password);
                Statement statement = connection.createStatement()) {
            statement.executeUpdate(insertMappingSql(
                    "110",
                    TENANT_A,
                    "102",
                    "202",
                    "'HISTORY'",
                    "ACTIVE",
                    false,
                    "4"));
            statement.executeUpdate("""
                    UPDATE tenant_product_skus
                       SET status = 'ARCHIVED'
                     WHERE id =
                       '98000000-0000-0000-0000-000000000202'
                    """);
            statement.executeUpdate("""
                    UPDATE tenant_supplier_sku_mappings
                       SET supplier_sku_code = 'HISTORY-KEPT'
                     WHERE id =
                       '98000000-0000-0000-0000-000000000110'
                    """);
            assertConstraint(statement, insertMappingSql(
                    "111",
                    TENANT_A,
                    "103",
                    "202",
                    "NULL",
                    "ACTIVE",
                    false,
                    "NULL"), "archived SKUs cannot receive");

            statement.executeUpdate("""
                    UPDATE tenant_suppliers
                       SET status = 'ARCHIVED'
                     WHERE id =
                       '98000000-0000-0000-0000-000000000102'
                    """);
            assertThatThrownBy(() -> statement.executeUpdate("""
                    UPDATE tenant_supplier_sku_mappings
                       SET lead_time_days = 5
                     WHERE id =
                       '98000000-0000-0000-0000-000000000110'
                    """))
                    .hasMessageContaining(
                            "archived supplier mappings are read-only");
            assertConstraint(statement, insertMappingSql(
                    "112",
                    TENANT_A,
                    "102",
                    "203",
                    "NULL",
                    "ACTIVE",
                    false,
                    "NULL"), "archived supplier mappings are read-only");

            try (ResultSet result = statement.executeQuery("""
                    SELECT supplier_sku_code
                      FROM tenant_supplier_sku_mappings
                     WHERE id =
                       '98000000-0000-0000-0000-000000000110'
                    """)) {
                assertThat(result.next()).isTrue();
                assertThat(result.getString(1)).isEqualTo("HISTORY-KEPT");
            }
        }
    }

    @Test
    @Order(5)
    void concurrentPreferredWritesCannotBothCommit() throws Exception {
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            Future<Boolean> first = executor.submit(() -> insertPreferred(
                    "120",
                    "101",
                    "203",
                    ready,
                    start));
            Future<Boolean> second = executor.submit(() -> insertPreferred(
                    "121",
                    "103",
                    "203",
                    ready,
                    start));
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            assertThat(List.of(
                            first.get(20, TimeUnit.SECONDS),
                            second.get(20, TimeUnit.SECONDS)))
                    .containsExactlyInAnyOrder(true, false);
        }
        try (Connection connection = DriverManager.getConnection(
                        v38JdbcUrl,
                        username,
                        password);
                Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery("""
                        SELECT count(*)
                          FROM tenant_supplier_sku_mappings
                         WHERE tenant_id =
                           '98000000-0000-0000-0000-000000000001'
                           AND sku_id =
                           '98000000-0000-0000-0000-000000000203'
                           AND status = 'ACTIVE'
                           AND preferred
                        """)) {
            result.next();
            assertThat(result.getLong(1)).isOne();
        }
    }

    private static boolean insertPreferred(
            String mappingSuffix,
            String supplierSuffix,
            String skuSuffix,
            CountDownLatch ready,
            CountDownLatch start) {
        try (Connection connection = DriverManager.getConnection(
                        v38JdbcUrl,
                        username,
                        password);
                Statement statement = connection.createStatement()) {
            connection.setAutoCommit(false);
            ready.countDown();
            start.await();
            statement.executeUpdate(insertMappingSql(
                    mappingSuffix,
                    TENANT_A,
                    supplierSuffix,
                    skuSuffix,
                    "NULL",
                    "ACTIVE",
                    true,
                    "NULL"));
            connection.commit();
            return true;
        } catch (Exception expected) {
            return false;
        }
    }

    private static void assertConstraint(
            Statement statement,
            String sql,
            String expectedMessage) {
        assertThatThrownBy(() -> statement.executeUpdate(sql))
                .hasMessageContaining(expectedMessage);
    }

    private static String insertMappingSql(
            String mappingSuffix,
            UUID tenantId,
            String supplierSuffix,
            String skuSuffix,
            String supplierCodeSql,
            String status,
            boolean preferred,
            String leadTimeSql) {
        return """
                INSERT INTO tenant_supplier_sku_mappings (
                  id, tenant_id, supplier_id, sku_id,
                  supplier_sku_code, status, preferred, lead_time_days)
                VALUES (
                  '%s',
                  '%s',
                  '%s',
                  '%s',
                  %s,
                  '%s',
                  %s,
                  %s)
                """.formatted(
                id(mappingSuffix),
                tenantId,
                id(supplierSuffix),
                id(skuSuffix),
                supplierCodeSql,
                status,
                preferred,
                leadTimeSql);
    }

    private static void seedTenants(String jdbcUrl) throws Exception {
        execute(jdbcUrl, """
                INSERT INTO tenants (id, code, name)
                VALUES
                  (
                    '98000000-0000-0000-0000-000000000001',
                    'mapping_a',
                    'Mapping A'
                  ),
                  (
                    '98000000-0000-0000-0000-000000000002',
                    'mapping_b',
                    'Mapping B'
                  )
                """);
    }

    private static void seedMasterData(
            String jdbcUrl,
            String prefix)
            throws Exception {
        int base = Integer.parseInt(prefix) * 10;
        execute(jdbcUrl, """
                INSERT INTO tenant_product_spus (
                  id, tenant_id, business_code, name)
                VALUES
                  (
                    '%s',
                    '%s',
                    'SPU_A_%s',
                    'Runtime SPU A'
                  ),
                  (
                    '%s',
                    '%s',
                    'SPU_B_%s',
                    'Runtime SPU B'
                  );

                INSERT INTO tenant_product_skus (
                  id, tenant_id, spu_id, business_code, name, status)
                VALUES
                  ('%s', '%s', '%s', 'SKU_A_ONE_%s', 'Runtime One', 'ACTIVE'),
                  ('%s', '%s', '%s', 'SKU_A_TWO_%s', 'Runtime Two', 'ACTIVE'),
                  ('%s', '%s', '%s', 'SKU_A_THREE_%s', 'Runtime Three', 'ACTIVE'),
                  ('%s', '%s', '%s', 'SKU_B_ONE_%s', 'Tenant B One', 'ACTIVE'),
                  ('%s', '%s', '%s', 'SKU_A_OLD_%s', 'Archived One', 'ARCHIVED');

                INSERT INTO tenant_suppliers (
                  id, tenant_id, business_code, name)
                VALUES
                  ('%s', '%s', 'SUP_A_ONE_%s', 'Supplier A One'),
                  ('%s', '%s', 'SUP_A_TWO_%s', 'Supplier A Two'),
                  ('%s', '%s', 'SUP_A_THREE_%s', 'Supplier A Three'),
                  ('%s', '%s', 'SUP_B_ONE_%s', 'Supplier B One');
                """.formatted(
                id(Integer.toString(base + 51)),
                TENANT_A,
                prefix,
                id(Integer.toString(base + 54)),
                TENANT_B,
                prefix,
                id(Integer.toString(base + 101)),
                TENANT_A,
                id(Integer.toString(base + 51)),
                prefix,
                id(Integer.toString(base + 102)),
                TENANT_A,
                id(Integer.toString(base + 51)),
                prefix,
                id(Integer.toString(base + 103)),
                TENANT_A,
                id(Integer.toString(base + 51)),
                prefix,
                id(Integer.toString(base + 104)),
                TENANT_B,
                id(Integer.toString(base + 54)),
                prefix,
                id(Integer.toString(base + 105)),
                TENANT_A,
                id(Integer.toString(base + 51)),
                prefix,
                id(Integer.toString(base + 1)),
                TENANT_A,
                prefix,
                id(Integer.toString(base + 2)),
                TENANT_A,
                prefix,
                id(Integer.toString(base + 3)),
                TENANT_A,
                prefix,
                id(Integer.toString(base + 4)),
                TENANT_B,
                prefix));
    }

    private static void seedUser(String jdbcUrl) throws Exception {
        execute(jdbcUrl, """
                INSERT INTO users (
                  id, tenant_id, username, display_name)
                VALUES (
                  '98000000-0000-0000-0000-000000000011',
                  '98000000-0000-0000-0000-000000000001',
                  'mapping_user',
                  'Mapping User')
                """);
    }

    private static void execute(String jdbcUrl, String sql)
            throws Exception {
        try (Connection connection = DriverManager.getConnection(
                        jdbcUrl,
                        username,
                        password);
                Statement statement = connection.createStatement()) {
            statement.execute(sql);
        }
    }

    private static void migrateTo(String jdbcUrl, String version) {
        Flyway.configure()
                .dataSource(jdbcUrl, username, password)
                .locations("classpath:db/migration")
                .target(MigrationVersion.fromVersion(version))
                .load()
                .migrate();
    }

    private static void migrateAll(String jdbcUrl) {
        Flyway.configure()
                .dataSource(jdbcUrl, username, password)
                .locations("classpath:db/migration")
                .load()
                .migrate();
    }

    @SuppressWarnings("resource")
    private static void configureDatabase() {
        String external = System.getenv("ERP_TEST_DB_URL");
        if (external != null && !external.isBlank()) {
            baseJdbcUrl = external;
            username = required("ERP_TEST_DB_USER");
            password = required("ERP_TEST_DB_PASSWORD");
            return;
        }
        try {
            postgres = new PostgreSQLContainer<>("postgres:16-alpine")
                    .withDatabaseName("erp_mapping_test")
                    .withUsername("erp_test")
                    .withPassword("integration-test-only");
            postgres.start();
            baseJdbcUrl = postgres.getJdbcUrl();
            username = postgres.getUsername();
            password = postgres.getPassword();
        } catch (RuntimeException unavailable) {
            Assumptions.assumeTrue(
                    false,
                    "Docker is unavailable and ERP_TEST_DB_URL was not supplied");
        }
    }

    private static void createSchema(String schema) throws Exception {
        execute(baseJdbcUrl, "CREATE SCHEMA \"" + schema + "\"");
    }

    private static void dropSchema(String schema) throws Exception {
        execute(
                baseJdbcUrl,
                "DROP SCHEMA \"" + schema + "\" CASCADE");
    }

    private static String withSchema(String jdbcUrl, String schema) {
        return jdbcUrl
                + (jdbcUrl.contains("?") ? "&" : "?")
                + "currentSchema="
                + schema;
    }

    private static String schemaName(String prefix) {
        return prefix
                + "_"
                + UUID.randomUUID().toString().replace("-", "");
    }

    private static UUID id(String suffix) {
        return UUID.fromString(
                "98000000-0000-0000-0000-"
                        + String.format("%012d", Integer.parseInt(suffix)));
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(name + " is required");
        }
        return value;
    }
}
