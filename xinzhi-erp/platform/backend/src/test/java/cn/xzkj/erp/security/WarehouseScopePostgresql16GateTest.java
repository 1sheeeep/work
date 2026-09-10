package cn.xzkj.erp.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import cn.xzkj.erp.iam.application.IamActor;
import cn.xzkj.erp.iam.application.IamNotFoundException;
import cn.xzkj.erp.iam.domain.IamPermissionCodes;
import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeMode;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeService;
import cn.xzkj.erp.warehouse.domain.WarehouseStatus;
import cn.xzkj.erp.warehouse.service.WarehouseActor;
import cn.xzkj.erp.warehouse.service.WarehouseMasterDataService;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;

class WarehouseScopePostgresql16GateTest {

    private static final UUID TENANT_A =
            uuid("9a000000-0000-0000-0000-000000000001");
    private static final UUID TENANT_B =
            uuid("9a000000-0000-0000-0000-000000000002");
    private static final UUID ADMIN_A =
            uuid("9a100000-0000-0000-0000-000000000001");
    private static final UUID WORKER_EMPTY =
            uuid("9a100000-0000-0000-0000-000000000002");
    private static final UUID WORKER_HISTORY =
            uuid("9a100000-0000-0000-0000-000000000003");
    private static final UUID WORKER_ARCHIVE_FIRST =
            uuid("9a100000-0000-0000-0000-000000000004");
    private static final UUID WORKER_ADD_FIRST =
            uuid("9a100000-0000-0000-0000-000000000005");
    private static final UUID GOVERNOR_A =
            uuid("9a100000-0000-0000-0000-000000000006");
    private static final UUID MISSING_SCOPE =
            uuid("9a100000-0000-0000-0000-000000000007");
    private static final UUID FOREIGN_USER =
            uuid("9a100000-0000-0000-0000-000000000008");
    private static final UUID ADMIN_ROLE =
            uuid("9a200000-0000-0000-0000-000000000001");
    private static final UUID ACTIVE_WAREHOUSE =
            uuid("9a300000-0000-0000-0000-000000000001");
    private static final UUID HISTORY_WAREHOUSE =
            uuid("9a300000-0000-0000-0000-000000000002");
    private static final UUID ARCHIVE_FIRST_WAREHOUSE =
            uuid("9a300000-0000-0000-0000-000000000003");
    private static final UUID ADD_FIRST_WAREHOUSE =
            uuid("9a300000-0000-0000-0000-000000000004");
    private static final UUID FOREIGN_WAREHOUSE =
            uuid("9a300000-0000-0000-0000-000000000005");
    private static final long TEST_ADVISORY_LOCK = 90400040L;

    private static PostgresqlApiFixture fixture;
    private static MockMvc mockMvc;
    private static WarehouseScopeService scopeService;
    private static WarehouseMasterDataService warehouseService;

    @BeforeAll
    static void start() throws Exception {
        fixture = new PostgresqlApiFixture();
        fixture.start();
        seed();
        mockMvc = fixture.mockMvc();
        scopeService = fixture.bean(WarehouseScopeService.class);
        warehouseService = fixture.bean(WarehouseMasterDataService.class);
    }

    @AfterAll
    static void stop() {
        if (fixture != null) {
            fixture.close();
        }
    }

    @Test
    void enforcesTenantAdministrationAndFailClosedWarehouseAccess()
            throws Exception {
        mockMvc.perform(get(scopePath(ADMIN_A))
                        .with(authentication(adminAuthentication(
                                IamPermissionCodes.WAREHOUSE_SCOPE_READ))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mode").value("ALL"))
                .andExpect(jsonPath("$.warehouseIds").isEmpty())
                .andExpect(jsonPath("$.version").value(0));

        mockMvc.perform(put(scopePath(ADMIN_A))
                        .with(authentication(adminAuthentication(
                                IamPermissionCodes.WAREHOUSE_SCOPE_WRITE)))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(scopeBody(0, "ALL")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("protected_scope"));

        mockMvc.perform(get(scopePath(WORKER_EMPTY))
                        .with(authentication(userAuthentication(
                                GOVERNOR_A,
                                TENANT_A,
                                IamPermissionCodes.WAREHOUSE_SCOPE_READ))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("permission_denied"));

        mockMvc.perform(get(scopePath(WORKER_EMPTY))
                        .with(authentication(userAuthentication(
                                WORKER_EMPTY,
                                TENANT_A))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("permission_denied"));

        mockMvc.perform(get(scopePath(FOREIGN_USER))
                        .with(authentication(adminAuthentication(
                                IamPermissionCodes.WAREHOUSE_SCOPE_READ))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"));

        mockMvc.perform(get(scopePath(UUID.randomUUID()))
                        .with(authentication(adminAuthentication(
                                IamPermissionCodes.WAREHOUSE_SCOPE_READ))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"));

        mockMvc.perform(get(scopePath(WORKER_EMPTY))
                        .with(authentication(systemAdminAuthentication(
                                IamPermissionCodes.WAREHOUSE_SCOPE_READ))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mode").value("SELECTED"))
                .andExpect(jsonPath("$.warehouseIds").isEmpty());

        mockMvc.perform(get("/api/v1/warehouse-center/warehouses")
                        .with(authentication(userAuthentication(
                                MISSING_SCOPE,
                                TENANT_A,
                                "warehouses.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0))
                .andExpect(jsonPath("$.items").isEmpty());

        mockMvc.perform(get("/api/v1/warehouse-center/warehouses")
                        .with(authentication(userAuthentication(
                                WORKER_EMPTY,
                                TENANT_A,
                                "warehouses.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0))
                .andExpect(jsonPath("$.items").isEmpty());

        mockMvc.perform(get("/api/v1/warehouse-center/warehouses/"
                                + ACTIVE_WAREHOUSE)
                        .with(authentication(userAuthentication(
                                WORKER_EMPTY,
                                TENANT_A,
                                "warehouses.read"))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"));

        mockMvc.perform(get("/api/v1/warehouse-center/warehouses/"
                                + ACTIVE_WAREHOUSE)
                        .with(authentication(userAuthentication(
                                MISSING_SCOPE,
                                TENANT_A,
                                "warehouses.read"))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"));

        mockMvc.perform(get("/api/v1/warehouse-center/warehouses/"
                                + FOREIGN_WAREHOUSE)
                        .with(authentication(userAuthentication(
                                MISSING_SCOPE,
                                TENANT_A,
                                "warehouses.read"))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"));

        mockMvc.perform(get("/api/v1/warehouse-center/warehouses/"
                                + ACTIVE_WAREHOUSE
                                + "/locations")
                        .with(authentication(userAuthentication(
                                MISSING_SCOPE,
                                TENANT_A,
                                "warehouses.read"))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"));

        mockMvc.perform(post("/api/v1/warehouse-center/warehouses")
                        .with(authentication(userAuthentication(
                                MISSING_SCOPE,
                                TENANT_A,
                                "warehouses.write")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"businessCode":"DENIED_WH","name":"Denied"}
                                """))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("permission_denied"));

        mockMvc.perform(get("/api/v1/warehouse-center/warehouses")
                        .with(authentication(systemAdminAuthentication(
                                "warehouses.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(
                        org.hamcrest.Matchers.greaterThan(0)));
    }

    @Test
    void preservesArchivedHistoryAndRejectsNewArchivedAssignments()
            throws Exception {
        mockMvc.perform(put(scopePath(WORKER_HISTORY))
                        .with(authentication(adminAuthentication(
                                IamPermissionCodes.WAREHOUSE_SCOPE_WRITE)))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(scopeBody(1, "SELECTED", HISTORY_WAREHOUSE)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code")
                        .value("optimistic_lock_conflict"));

        mockMvc.perform(put(scopePath(WORKER_HISTORY))
                        .with(authentication(adminAuthentication(
                                IamPermissionCodes.WAREHOUSE_SCOPE_WRITE)))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(scopeBody(0, "SELECTED", HISTORY_WAREHOUSE)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(1))
                .andExpect(jsonPath("$.warehouseIds[0]")
                        .value(HISTORY_WAREHOUSE.toString()));

        mockMvc.perform(post("/api/v1/warehouse-center/warehouses/"
                                + HISTORY_WAREHOUSE + "/archive")
                        .with(authentication(adminAuthentication(
                                "warehouses.write")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"version\":0}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ARCHIVED"));

        mockMvc.perform(get(scopePath(WORKER_HISTORY))
                        .with(authentication(adminAuthentication(
                                IamPermissionCodes.WAREHOUSE_SCOPE_READ))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(1))
                .andExpect(jsonPath("$.warehouseIds[0]")
                        .value(HISTORY_WAREHOUSE.toString()));

        mockMvc.perform(put(scopePath(WORKER_HISTORY))
                        .with(authentication(adminAuthentication(
                                IamPermissionCodes.WAREHOUSE_SCOPE_WRITE)))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(scopeBody(1, "SELECTED", HISTORY_WAREHOUSE)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(1));

        mockMvc.perform(put(scopePath(WORKER_HISTORY))
                        .with(authentication(adminAuthentication(
                                IamPermissionCodes.WAREHOUSE_SCOPE_WRITE)))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(scopeBody(1, "SELECTED")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(2))
                .andExpect(jsonPath("$.warehouseIds").isEmpty());

        mockMvc.perform(put(scopePath(WORKER_HISTORY))
                        .with(authentication(adminAuthentication(
                                IamPermissionCodes.WAREHOUSE_SCOPE_WRITE)))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(scopeBody(2, "SELECTED", HISTORY_WAREHOUSE)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"));
    }

    @Test
    void serializesNewAssignmentsWithWarehouseArchive() throws Exception {
        WarehouseActor warehouseActor = warehouseActor();
        IamActor iamActor = iamActor();

        warehouseService.archiveWarehouse(
                warehouseActor, ARCHIVE_FIRST_WAREHOUSE, 0);
        assertThatThrownBy(() -> scopeService.replace(
                        iamActor,
                        WORKER_ARCHIVE_FIRST,
                        0,
                        WarehouseScopeMode.SELECTED,
                        List.of(ARCHIVE_FIRST_WAREHOUSE)))
                .isInstanceOf(IamNotFoundException.class);
        assertThat(fixture.singleLong("""
                SELECT count(*)
                FROM tenant_user_warehouse_scope_items
                WHERE tenant_id = ? AND user_id = ?
                """, TENANT_A, WORKER_ARCHIVE_FIRST)).isZero();

        installBlockingInsertTrigger();
        try (Connection blocker = DriverManager.getConnection(
                        fixture.jdbcUrl(),
                        fixture.databaseUsername(),
                        fixture.databasePassword());
                Statement statement = blocker.createStatement();
                var executor = Executors.newFixedThreadPool(2)) {
            blocker.setAutoCommit(false);
            statement.execute(
                    "SELECT pg_advisory_xact_lock(" + TEST_ADVISORY_LOCK + ")");

            Future<?> replace = executor.submit(() -> scopeService.replace(
                    iamActor,
                    WORKER_ADD_FIRST,
                    0,
                    WarehouseScopeMode.SELECTED,
                    List.of(ADD_FIRST_WAREHOUSE)));
            awaitDatabaseCount("""
                    SELECT count(*)
                    FROM pg_stat_activity
                    WHERE wait_event = 'advisory'
                      AND query ILIKE '%tenant_user_warehouse_scope_items%'
                    """, 1);

            Future<?> archive = executor.submit(() ->
                    warehouseService.archiveWarehouse(
                            warehouseActor, ADD_FIRST_WAREHOUSE, 0));
            awaitDatabaseCount("""
                    SELECT count(*)
                    FROM pg_stat_activity
                    WHERE wait_event_type = 'Lock'
                      AND query ILIKE '%tenant_warehouses%'
                    """, 1);

            blocker.commit();
            replace.get(10, TimeUnit.SECONDS);
            archive.get(10, TimeUnit.SECONDS);
        } finally {
            removeBlockingInsertTrigger();
        }

        assertThat(fixture.singleString("""
                SELECT status
                FROM tenant_warehouses
                WHERE tenant_id = ? AND id = ?
                """, TENANT_A, ADD_FIRST_WAREHOUSE))
                .isEqualTo(WarehouseStatus.ARCHIVED.name());
        assertThat(fixture.singleLong("""
                SELECT count(*)
                FROM tenant_user_warehouse_scope_items
                WHERE tenant_id = ? AND user_id = ? AND warehouse_id = ?
                """, TENANT_A, WORKER_ADD_FIRST, ADD_FIRST_WAREHOUSE))
                .isOne();
    }

    private static void seed() throws Exception {
        fixture.executeUpdate("""
                INSERT INTO tenants (id, code, name)
                VALUES
                  (?, 'scope_a', 'Scope A'),
                  (?, 'scope_b', 'Scope B')
                """, TENANT_A, TENANT_B);
        fixture.executeUpdate("""
                INSERT INTO users (
                  id, tenant_id, username, display_name, status)
                VALUES
                  (?, ?, 'scope_admin', 'Scope Admin', 'ACTIVE'),
                  (?, ?, 'worker_empty', 'Worker Empty', 'ACTIVE'),
                  (?, ?, 'worker_history', 'Worker History', 'ACTIVE'),
                  (?, ?, 'worker_archive_first', 'Worker Archive First', 'ACTIVE'),
                  (?, ?, 'worker_add_first', 'Worker Add First', 'ACTIVE'),
                  (?, ?, 'scope_governor', 'Scope Governor', 'ACTIVE'),
                  (?, ?, 'missing_scope', 'Missing Scope', 'ACTIVE'),
                  (?, ?, 'foreign_worker', 'Foreign Worker', 'ACTIVE')
                """,
                ADMIN_A, TENANT_A,
                WORKER_EMPTY, TENANT_A,
                WORKER_HISTORY, TENANT_A,
                WORKER_ARCHIVE_FIRST, TENANT_A,
                WORKER_ADD_FIRST, TENANT_A,
                GOVERNOR_A, TENANT_A,
                MISSING_SCOPE, TENANT_A,
                FOREIGN_USER, TENANT_B);
        fixture.executeUpdate("""
                INSERT INTO roles (
                  id, tenant_id, code, name, system_role)
                VALUES (?, ?, 'tenant_admin', 'Tenant Admin', true)
                """, ADMIN_ROLE, TENANT_A);
        fixture.executeUpdate("""
                INSERT INTO user_roles (tenant_id, user_id, role_id)
                VALUES (?, ?, ?)
                """, TENANT_A, ADMIN_A, ADMIN_ROLE);
        fixture.executeUpdate("""
                INSERT INTO tenant_user_warehouse_scopes (
                  tenant_id, user_id, mode)
                VALUES
                  (?, ?, 'SELECTED'),
                  (?, ?, 'SELECTED'),
                  (?, ?, 'SELECTED'),
                  (?, ?, 'SELECTED'),
                  (?, ?, 'SELECTED')
                """,
                TENANT_A, WORKER_EMPTY,
                TENANT_A, WORKER_HISTORY,
                TENANT_A, WORKER_ARCHIVE_FIRST,
                TENANT_A, WORKER_ADD_FIRST,
                TENANT_B, FOREIGN_USER);
        fixture.executeUpdate("""
                INSERT INTO tenant_warehouses (
                  id, tenant_id, business_code, name)
                VALUES
                  (?, ?, 'ACTIVE_WH', 'Active Warehouse'),
                  (?, ?, 'HISTORY_WH', 'History Warehouse'),
                  (?, ?, 'ARCHIVE_FIRST_WH', 'Archive First Warehouse'),
                  (?, ?, 'ADD_FIRST_WH', 'Add First Warehouse'),
                  (?, ?, 'FOREIGN_WH', 'Foreign Warehouse')
                """,
                ACTIVE_WAREHOUSE, TENANT_A,
                HISTORY_WAREHOUSE, TENANT_A,
                ARCHIVE_FIRST_WAREHOUSE, TENANT_A,
                ADD_FIRST_WAREHOUSE, TENANT_A,
                FOREIGN_WAREHOUSE, TENANT_B);
    }

    private static TestingAuthenticationToken adminAuthentication(
            String... authorities) {
        return userAuthentication(ADMIN_A, TENANT_A, authorities);
    }

    private static TestingAuthenticationToken systemAdminAuthentication(
            String... authorities) {
        ErpPrincipal principal = new ErpPrincipal(
                UUID.randomUUID(),
                Instant.parse("2099-01-01T00:00:00Z"),
                TENANT_A,
                "scope_a",
                "Scope A",
                null,
                "system_admin",
                "System Admin",
                PostgresqlApiFixture.SYSTEM_ADMIN_ID);
        return new TestingAuthenticationToken(
                principal, "not-used", authorities);
    }

    private static TestingAuthenticationToken userAuthentication(
            UUID userId,
            UUID tenantId,
            String... authorities) {
        ErpPrincipal principal = new ErpPrincipal(
                UUID.randomUUID(),
                Instant.parse("2099-01-01T00:00:00Z"),
                tenantId,
                "scope_a",
                "Scope A",
                userId,
                "scope_test",
                "Scope Test");
        return new TestingAuthenticationToken(
                principal, "not-used", authorities);
    }

    private static IamActor iamActor() {
        return new IamActor(
                TENANT_A,
                ADMIN_A,
                null,
                "warehouse-scope-core",
                "127.0.0.1");
    }

    private static WarehouseActor warehouseActor() {
        return new WarehouseActor(
                TENANT_A,
                ADMIN_A,
                null,
                "warehouse-scope-core",
                "127.0.0.1");
    }

    private static String scopePath(UUID userId) {
        return "/api/v1/iam/members/" + userId + "/warehouse-scope";
    }

    private static String scopeBody(
            long version, String mode, UUID... warehouseIds) {
        String ids = java.util.Arrays.stream(warehouseIds)
                .map(id -> "\"" + id + "\"")
                .collect(java.util.stream.Collectors.joining(","));
        return """
                {"version":%d,"mode":"%s","warehouseIds":[%s]}
                """.formatted(version, mode, ids);
    }

    private static void installBlockingInsertTrigger() throws Exception {
        fixture.executeUpdate("""
                CREATE FUNCTION test_block_warehouse_scope_insert()
                RETURNS TRIGGER
                LANGUAGE plpgsql
                AS $$
                BEGIN
                    PERFORM pg_advisory_xact_lock(90400040);
                    RETURN NEW;
                END;
                $$
                """);
        fixture.executeUpdate("""
                CREATE TRIGGER trg_test_block_warehouse_scope_insert
                BEFORE INSERT ON tenant_user_warehouse_scope_items
                FOR EACH ROW
                EXECUTE FUNCTION test_block_warehouse_scope_insert()
                """);
    }

    private static void removeBlockingInsertTrigger() throws Exception {
        fixture.executeUpdate("""
                DROP TRIGGER IF EXISTS trg_test_block_warehouse_scope_insert
                ON tenant_user_warehouse_scope_items
                """);
        fixture.executeUpdate(
                "DROP FUNCTION IF EXISTS test_block_warehouse_scope_insert()");
    }

    private static void awaitDatabaseCount(String sql, long minimum)
            throws Exception {
        for (int attempt = 0; attempt < 100; attempt++) {
            if (fixture.singleLong(sql) >= minimum) {
                return;
            }
            Thread.sleep(50);
        }
        throw new AssertionError("Database lock state was not observed");
    }

    private static UUID uuid(String value) {
        return UUID.fromString(value);
    }
}
