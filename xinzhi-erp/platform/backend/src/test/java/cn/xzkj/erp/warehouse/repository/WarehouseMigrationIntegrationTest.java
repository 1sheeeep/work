package cn.xzkj.erp.warehouse.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.data.domain.PageRequest;
import org.testcontainers.containers.PostgreSQLContainer;

import cn.xzkj.erp.ErpApplication;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.warehouse.domain.Warehouse;
import cn.xzkj.erp.warehouse.domain.WarehouseStatus;
import cn.xzkj.erp.warehouse.service.WarehouseMasterDataService;
import cn.xzkj.erp.warehouse.service.WarehouseActor;

class WarehouseMigrationIntegrationTest {
    private static PostgreSQLContainer<?> postgres;
    private static String baseJdbcUrl;
    private static String upgradeJdbcUrl;
    private static String emptyJdbcUrl;
    private static String username;
    private static String password;
    private static String upgradeSchema;
    private static String emptySchema;

    @BeforeAll
    static void migrateHistoricalAndEmptyDatabases() throws Exception {
        configureDatabase();
        upgradeSchema = "warehouse_upgrade_" + compactUuid();
        emptySchema = "warehouse_empty_" + compactUuid();
        createSchema(upgradeSchema);
        createSchema(emptySchema);
        upgradeJdbcUrl = withSchema(baseJdbcUrl, upgradeSchema);
        emptyJdbcUrl = withSchema(baseJdbcUrl, emptySchema);

        Flyway.configure()
                .dataSource(upgradeJdbcUrl, username, password)
                .locations("classpath:db/migration")
                .target(MigrationVersion.fromVersion("35"))
                .load()
                .migrate();
        try (Connection connection = DriverManager.getConnection(
                        upgradeJdbcUrl, username, password);
                Statement statement = connection.createStatement()) {
            statement.executeUpdate("""
                    INSERT INTO tenants (id, code, name)
                    VALUES
                      ('96000000-0000-0000-0000-000000000001', 'warehouse_a', 'Warehouse A'),
                      ('96000000-0000-0000-0000-000000000002', 'warehouse_b', 'Warehouse B')
                    """);
        }
        Flyway.configure()
                .dataSource(upgradeJdbcUrl, username, password)
                .locations("classpath:db/migration")
                .target(MigrationVersion.fromVersion("39"))
                .load()
                .migrate();
        seedWarehouseScopeHistory();
        Flyway.configure()
                .dataSource(upgradeJdbcUrl, username, password)
                .locations("classpath:db/migration")
                .load()
                .migrate();
        Flyway.configure()
                .dataSource(emptyJdbcUrl, username, password)
                .locations("classpath:db/migration")
                .load()
                .migrate();
    }

    @AfterAll
    static void cleanUp() throws Exception {
        try {
            if (upgradeSchema != null) {
                dropSchema(upgradeSchema);
            }
            if (emptySchema != null) {
                dropSchema(emptySchema);
            }
        } finally {
            if (postgres != null) {
                postgres.stop();
            }
        }
    }

    @Test
    void migratesBothHistoricalV35AndEmptyDatabasesThroughLatest()
            throws Exception {
        for (String jdbcUrl : new String[] {upgradeJdbcUrl, emptyJdbcUrl}) {
            try (Connection connection = DriverManager.getConnection(jdbcUrl, username, password);
                    Statement statement = connection.createStatement();
                    ResultSet result = statement.executeQuery("""
                            SELECT
                              (SELECT count(*) FROM flyway_schema_history
                               WHERE version = '36' AND success),
                              (SELECT count(*) FROM information_schema.tables
                               WHERE table_schema = current_schema()
                                 AND table_name IN (
                                   'tenant_warehouses',
                                   'tenant_warehouse_locations')),
                              (SELECT count(*) FROM permissions
                               WHERE code IN ('warehouses.read', 'warehouses.write')),
                              (SELECT count(*) FROM flyway_schema_history
                               WHERE version = '40' AND success),
                              (SELECT count(*) FROM information_schema.tables
                               WHERE table_schema = current_schema()
                                 AND table_name IN (
                                   'tenant_user_warehouse_scopes',
                                   'tenant_user_warehouse_scope_items'))
                            """)) {
                result.next();
                assertThat(result.getInt(1)).isOne();
                assertThat(result.getInt(2)).isEqualTo(2);
                assertThat(result.getInt(3)).isEqualTo(2);
                assertThat(result.getInt(4)).isOne();
                assertThat(result.getInt(5)).isEqualTo(2);
            }
        }
    }

    @Test
    void v36SourceAddsNoRoleGrantOrTenantSpecificData() throws Exception {
        try (var stream = WarehouseMigrationIntegrationTest.class.getResourceAsStream(
                "/db/migration/V36__warehouse_master_data.sql")) {
            assertThat(stream).isNotNull();
            String sql = new String(stream.readAllBytes(), StandardCharsets.UTF_8)
                    .toLowerCase();
            assertThat(sql).doesNotContain("insert into role_permissions");
            assertThat(sql).doesNotContain("insert into roles");
            assertThat(sql).doesNotContain("insert into tenants");
        }
    }

    @Test
    void v40InitializesCompatibleScopesAndTenantAdminGovernance()
            throws Exception {
        try (Connection connection = DriverManager.getConnection(
                        upgradeJdbcUrl, username, password);
                Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery("""
                        SELECT
                          (SELECT count(*) FROM permissions
                           WHERE code IN (
                             'iam:warehouse:scope:read',
                             'iam:warehouse:scope:write')),
                          (SELECT count(*)
                           FROM tenant_user_warehouse_scopes
                           WHERE tenant_id =
                             '96000000-0000-0000-0000-000000000001'
                           AND user_id =
                             '97000000-0000-0000-0000-000000000002'
                           AND mode = 'ALL'),
                          (SELECT count(*)
                           FROM tenant_user_warehouse_scopes
                           WHERE tenant_id =
                             '96000000-0000-0000-0000-000000000001'
                           AND user_id =
                             '97000000-0000-0000-0000-000000000003'
                           AND mode = 'SELECTED'),
                          (SELECT count(*)
                           FROM tenant_user_warehouse_scopes
                           WHERE tenant_id =
                             '96000000-0000-0000-0000-000000000001'
                           AND user_id =
                             '97000000-0000-0000-0000-000000000001'),
                          (SELECT count(*)
                           FROM role_permissions assignment
                           JOIN permissions permission
                             ON permission.id = assignment.permission_id
                           WHERE assignment.tenant_id =
                             '96000000-0000-0000-0000-000000000001'
                           AND assignment.role_id =
                             '97010000-0000-0000-0000-000000000001'
                           AND permission.code IN (
                             'iam:warehouse:scope:read',
                             'iam:warehouse:scope:write'))
                        """)) {
            result.next();
            assertThat(result.getInt(1)).isEqualTo(2);
            assertThat(result.getInt(2)).isOne();
            assertThat(result.getInt(3)).isOne();
            assertThat(result.getInt(4)).isZero();
            assertThat(result.getInt(5)).isEqualTo(2);
        }
    }

    @Test
    void v40DatabaseConstraintsEnforceTenantAndModeInvariants()
            throws Exception {
        try (Connection connection = DriverManager.getConnection(
                        upgradeJdbcUrl, username, password);
                Statement statement = connection.createStatement()) {
            statement.executeUpdate("""
                    INSERT INTO tenant_user_warehouse_scope_items (
                      tenant_id, user_id, warehouse_id)
                    VALUES (
                      '96000000-0000-0000-0000-000000000001',
                      '97000000-0000-0000-0000-000000000005',
                      '97020000-0000-0000-0000-000000000001')
                    """);
            assertThatThrownBy(() -> statement.executeUpdate("""
                    UPDATE tenant_user_warehouse_scopes
                    SET mode = 'ALL'
                    WHERE tenant_id =
                      '96000000-0000-0000-0000-000000000001'
                      AND user_id =
                      '97000000-0000-0000-0000-000000000005'
                    """)).hasMessageContaining(
                    "ALL warehouse scope cannot contain items");
            statement.executeUpdate("""
                    DELETE FROM tenant_user_warehouse_scope_items
                    WHERE tenant_id =
                      '96000000-0000-0000-0000-000000000001'
                      AND user_id =
                      '97000000-0000-0000-0000-000000000005'
                    """);
            statement.executeUpdate("""
                    UPDATE tenant_user_warehouse_scopes
                    SET mode = 'ALL'
                    WHERE tenant_id =
                      '96000000-0000-0000-0000-000000000001'
                      AND user_id =
                      '97000000-0000-0000-0000-000000000005'
                    """);
            assertThatThrownBy(() -> statement.executeUpdate("""
                    INSERT INTO tenant_user_warehouse_scope_items (
                      tenant_id, user_id, warehouse_id)
                    VALUES (
                      '96000000-0000-0000-0000-000000000001',
                      '97000000-0000-0000-0000-000000000005',
                      '97020000-0000-0000-0000-000000000001')
                    """)).hasMessageContaining(
                    "warehouse scope items require SELECTED mode");
            statement.executeUpdate("""
                    UPDATE tenant_user_warehouse_scopes
                    SET mode = 'SELECTED'
                    WHERE tenant_id =
                      '96000000-0000-0000-0000-000000000001'
                      AND user_id =
                      '97000000-0000-0000-0000-000000000005'
                    """);
            assertThatThrownBy(() -> statement.executeUpdate("""
                    INSERT INTO tenant_user_warehouse_scope_items (
                      tenant_id, user_id, warehouse_id)
                    VALUES (
                      '96000000-0000-0000-0000-000000000001',
                      '97000000-0000-0000-0000-000000000005',
                      '97020000-0000-0000-0000-000000000002')
                    """)).hasMessageContaining(
                    "fk_tenant_user_warehouse_scope_items_warehouse");
        }
    }

    @Test
    void databaseEnforcesTenantHierarchyUniquenessAndValidation() throws Exception {
        seedWarehouses();
        try (Connection connection = DriverManager.getConnection(
                        upgradeJdbcUrl, username, password);
                Statement statement = connection.createStatement()) {
            assertThatThrownBy(() -> statement.executeUpdate("""
                    INSERT INTO tenant_warehouses (tenant_id, business_code, name)
                    VALUES ('96000000-0000-0000-0000-000000000001', 'WH_A', 'Duplicate')
                    """)).hasMessageContaining("uq_tenant_warehouses_code");
            assertThatThrownBy(() -> statement.executeUpdate("""
                    INSERT INTO tenant_warehouses (tenant_id, business_code, name)
                    VALUES ('96000000-0000-0000-0000-000000000001', 'lowercase', 'Bad')
                    """)).hasMessageContaining("ck_tenant_warehouses_code");
            assertThatThrownBy(() -> statement.executeUpdate("""
                    INSERT INTO tenant_warehouse_locations (
                      tenant_id, warehouse_id, business_code, name)
                    VALUES (
                      '96000000-0000-0000-0000-000000000002',
                      '96000000-0000-0000-0000-000000000010',
                      'CROSS', 'Cross tenant')
                    """)).hasMessageContaining("fk_tenant_warehouse_locations_warehouse");
            assertThatThrownBy(() -> statement.executeUpdate("""
                    INSERT INTO tenant_warehouse_locations (
                      tenant_id, warehouse_id, business_code, name)
                    VALUES (
                      '96000000-0000-0000-0000-000000000001',
                      '96000000-0000-0000-0000-000000000010',
                      'A_01', 'Duplicate')
                    """)).hasMessageContaining("uq_tenant_warehouse_locations_code");
            assertThatThrownBy(() -> statement.executeUpdate("""
                    UPDATE tenant_warehouse_locations
                    SET status = 'DELETED'
                    WHERE id = '96000000-0000-0000-0000-000000000020'
                    """)).hasMessageContaining("ck_tenant_warehouse_locations_status");
            assertThatThrownBy(() -> statement.executeUpdate("""
                    UPDATE tenant_warehouses
                    SET version = -1
                    WHERE id = '96000000-0000-0000-0000-000000000010'
                    """)).hasMessageContaining("ck_tenant_warehouses_version");
        }
    }

    @Test
    void indexesSupportTenantScopedLists() throws Exception {
        try (Connection connection = DriverManager.getConnection(
                        upgradeJdbcUrl, username, password);
                Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery("""
                        SELECT indexname
                        FROM pg_indexes
                        WHERE schemaname = current_schema()
                          AND indexname IN (
                            'idx_tenant_warehouses_list',
                            'idx_tenant_warehouse_locations_list')
                        ORDER BY indexname
                        """)) {
            List<String> indexes = new ArrayList<>();
            while (result.next()) {
                indexes.add(result.getString(1));
            }
            assertThat(indexes)
                    .containsExactly(
                            "idx_tenant_warehouse_locations_list",
                            "idx_tenant_warehouses_list");
        }
    }

    @Test
    void hibernateValidatesSchemaAndServiceRejectsTenantAndConcurrentWrites()
            throws Exception {
        StandardEnvironment environment = new StandardEnvironment();
        environment.getPropertySources().addFirst(new MapPropertySource(
                "warehouse-schema-test",
                Map.of(
                        "server.port", "0",
                        "spring.datasource.url", upgradeJdbcUrl,
                        "spring.datasource.username", username,
                        "spring.datasource.password", password,
                        "erp.environment", "integration-test")));
        try (ConfigurableApplicationContext context =
                new SpringApplicationBuilder(ErpApplication.class)
                        .web(WebApplicationType.SERVLET)
                        .environment(environment)
                        .run()) {
            WarehouseMasterDataService service =
                    context.getBean(WarehouseMasterDataService.class);
            UUID tenantA = UUID.fromString("96000000-0000-0000-0000-000000000001");
            UUID tenantB = UUID.fromString("96000000-0000-0000-0000-000000000002");
            WarehouseActor actor = new WarehouseActor(
                    tenantA,
                    UUID.fromString(
                            "96000000-0000-0000-0000-000000000003"),
                    null,
                    "warehouse-runtime",
                    "127.0.0.1");
            Warehouse created =
                    service.createWarehouse(
                            actor, "runtime_wh", "Runtime warehouse");

            WarehouseActor tenantBActor = new WarehouseActor(
                    tenantB,
                    UUID.fromString(
                            "96000000-0000-0000-0000-000000000003"),
                    null,
                    "warehouse-runtime",
                    "127.0.0.1");
            assertThatThrownBy(() -> service.getWarehouse(
                            tenantBActor, created.getId()))
                    .isInstanceOf(ResourceNotFoundException.class);
            Warehouse changed = service.updateWarehouse(
                    actor,
                    created.getId(),
                    created.getVersion(),
                    "Changed once",
                    WarehouseStatus.ACTIVE);
            assertThat(changed.getVersion()).isEqualTo(created.getVersion() + 1);
            assertThatThrownBy(() -> service.updateWarehouse(
                    actor,
                    created.getId(),
                    created.getVersion(),
                    "Stale write",
                    WarehouseStatus.INACTIVE))
                    .isInstanceOf(ConflictException.class);

            Warehouse raceWarehouse =
                    service.createWarehouse(
                            actor, "race_wh", "Race warehouse");
            CountDownLatch start = new CountDownLatch(1);
            try (var executor = Executors.newFixedThreadPool(2)) {
                Future<Boolean> archive = executor.submit(() -> {
                    start.await();
                    try {
                        service.archiveWarehouse(
                                actor,
                                raceWarehouse.getId(),
                                raceWarehouse.getVersion());
                        return true;
                    } catch (ConflictException expected) {
                        return false;
                    }
                });
                Future<Boolean> createLocation = executor.submit(() -> {
                    start.await();
                    try {
                        service.createLocation(
                                actor, raceWarehouse.getId(),
                                "RACE_A", "Race A");
                        return true;
                    } catch (ConflictException expected) {
                        return false;
                    }
                });
                start.countDown();
                assertThat(java.util.List.of(
                                archive.get(20, TimeUnit.SECONDS),
                                createLocation.get(20, TimeUnit.SECONDS)))
                        .containsExactlyInAnyOrder(true, false);
            }

            Warehouse finalParent =
                    service.getWarehouse(actor, raceWarehouse.getId());
            long nonArchivedLocations = service.listLocations(
                            actor,
                            raceWarehouse.getId(),
                            null,
                            null,
                            PageRequest.of(0, 50))
                    .getTotalElements();
            if (finalParent.getStatus() == WarehouseStatus.ARCHIVED) {
                assertThat(nonArchivedLocations).isZero();
            } else {
                assertThat(finalParent.getStatus()).isEqualTo(WarehouseStatus.ACTIVE);
                assertThat(nonArchivedLocations).isOne();
            }
        }
    }

    private static void seedWarehouses() throws Exception {
        try (Connection connection = DriverManager.getConnection(
                        upgradeJdbcUrl, username, password);
                Statement statement = connection.createStatement()) {
            statement.executeUpdate("""
                    INSERT INTO users (
                      id, tenant_id, username, display_name, status)
                    VALUES (
                      '96000000-0000-0000-0000-000000000003',
                      '96000000-0000-0000-0000-000000000001',
                      'warehouse_runtime_actor',
                      'Warehouse Runtime Actor', 'ACTIVE')
                    ON CONFLICT (id) DO NOTHING
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_warehouses (
                      id, tenant_id, business_code, name)
                    VALUES
                      ('96000000-0000-0000-0000-000000000010',
                       '96000000-0000-0000-0000-000000000001', 'WH_A', 'Warehouse A'),
                      ('96000000-0000-0000-0000-000000000011',
                       '96000000-0000-0000-0000-000000000001', 'WH_B', 'Warehouse B'),
                      ('96000000-0000-0000-0000-000000000012',
                       '96000000-0000-0000-0000-000000000002', 'WH_A', 'Warehouse A2')
                    ON CONFLICT (id) DO NOTHING
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_user_warehouse_scopes (
                      tenant_id, user_id, mode)
                    VALUES (
                      '96000000-0000-0000-0000-000000000001',
                      '96000000-0000-0000-0000-000000000003',
                      'ALL')
                    ON CONFLICT (tenant_id, user_id) DO UPDATE SET mode = 'ALL'
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_warehouse_locations (
                      id, tenant_id, warehouse_id, business_code, name)
                    VALUES
                      ('96000000-0000-0000-0000-000000000020',
                       '96000000-0000-0000-0000-000000000001',
                       '96000000-0000-0000-0000-000000000010', 'A_01', 'A-01'),
                      ('96000000-0000-0000-0000-000000000021',
                       '96000000-0000-0000-0000-000000000001',
                       '96000000-0000-0000-0000-000000000011', 'A_01', 'A-01 other')
                    ON CONFLICT (id) DO NOTHING
                    """);
        }
    }

    private static void seedWarehouseScopeHistory() throws Exception {
        try (Connection connection = DriverManager.getConnection(
                        upgradeJdbcUrl, username, password);
                Statement statement = connection.createStatement()) {
            statement.executeUpdate("""
                    INSERT INTO users (
                      id, tenant_id, username, display_name, status)
                    VALUES
                      ('97000000-0000-0000-0000-000000000001',
                       '96000000-0000-0000-0000-000000000001',
                       'historical_admin', 'Historical Admin', 'ACTIVE'),
                      ('97000000-0000-0000-0000-000000000002',
                       '96000000-0000-0000-0000-000000000001',
                       'historical_reader', 'Historical Reader', 'ACTIVE'),
                      ('97000000-0000-0000-0000-000000000003',
                       '96000000-0000-0000-0000-000000000001',
                       'historical_denied', 'Historical Denied', 'ACTIVE'),
                      ('97000000-0000-0000-0000-000000000005',
                       '96000000-0000-0000-0000-000000000001',
                       'historical_trigger', 'Historical Trigger', 'ACTIVE')
                    """);
            statement.executeUpdate("""
                    INSERT INTO roles (
                      id, tenant_id, code, name, system_role)
                    VALUES
                      ('97010000-0000-0000-0000-000000000001',
                       '96000000-0000-0000-0000-000000000001',
                       'tenant_admin', 'Tenant Admin', true),
                      ('97010000-0000-0000-0000-000000000002',
                       '96000000-0000-0000-0000-000000000001',
                       'warehouse_reader', 'Warehouse Reader', false)
                    """);
            statement.executeUpdate("""
                    INSERT INTO user_roles (tenant_id, user_id, role_id)
                    VALUES
                      ('96000000-0000-0000-0000-000000000001',
                       '97000000-0000-0000-0000-000000000001',
                       '97010000-0000-0000-0000-000000000001'),
                      ('96000000-0000-0000-0000-000000000001',
                       '97000000-0000-0000-0000-000000000002',
                       '97010000-0000-0000-0000-000000000002')
                    """);
            statement.executeUpdate("""
                    INSERT INTO role_permissions (
                      tenant_id, role_id, permission_id)
                    VALUES (
                      '96000000-0000-0000-0000-000000000001',
                      '97010000-0000-0000-0000-000000000002',
                      '83000000-0000-0000-0000-000000000001')
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_warehouses (
                      id, tenant_id, business_code, name)
                    VALUES
                      ('97020000-0000-0000-0000-000000000001',
                       '96000000-0000-0000-0000-000000000001',
                       'HIST_A', 'Historical A'),
                      ('97020000-0000-0000-0000-000000000002',
                       '96000000-0000-0000-0000-000000000002',
                       'HIST_B', 'Historical B')
                    """);
        }
    }

    @SuppressWarnings("resource")
    private static void configureDatabase() {
        postgres = new PostgreSQLContainer<>("postgres:16-alpine")
                .withImagePullPolicy(imageName -> false)
                .withDatabaseName("erp_warehouse_test")
                .withUsername("erp_test")
                .withPassword("integration-test-only");
        postgres.start();
        baseJdbcUrl = postgres.getJdbcUrl();
        username = postgres.getUsername();
        password = postgres.getPassword();
    }

    private static void createSchema(String schema) throws Exception {
        try (Connection connection = DriverManager.getConnection(
                        baseJdbcUrl, username, password);
                Statement statement = connection.createStatement()) {
            statement.execute("CREATE SCHEMA \"" + schema + "\"");
        }
    }

    private static void dropSchema(String schema) throws Exception {
        try (Connection connection = DriverManager.getConnection(
                        baseJdbcUrl, username, password);
                Statement statement = connection.createStatement()) {
            statement.execute("DROP SCHEMA \"" + schema + "\" CASCADE");
        }
    }

    private static String withSchema(String jdbcUrl, String schema) {
        return jdbcUrl + (jdbcUrl.contains("?") ? "&" : "?") + "currentSchema=" + schema;
    }

    private static String compactUuid() {
        return UUID.randomUUID().toString().replace("-", "");
    }

}
