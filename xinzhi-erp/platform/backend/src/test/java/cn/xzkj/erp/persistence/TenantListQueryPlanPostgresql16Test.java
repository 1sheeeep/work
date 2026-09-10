package cn.xzkj.erp.persistence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import cn.xzkj.erp.ErpApplication;
import cn.xzkj.erp.iam.application.IamAdministrationService;
import cn.xzkj.erp.iam.application.IamValidationException;
import cn.xzkj.erp.iam.persistence.AuditLogQueryRepository;
import cn.xzkj.erp.order.api.OrderCenterController;
import cn.xzkj.erp.order.domain.OrderStatus;
import cn.xzkj.erp.order.service.OrderCenterService;
import cn.xzkj.erp.product.api.ProductCenterController;
import cn.xzkj.erp.product.domain.ProductStatus;
import cn.xzkj.erp.product.service.ProductCenterService;
import cn.xzkj.erp.supplier.api.SupplierController;
import cn.xzkj.erp.supplier.api.SupplierSkuMappingController;
import cn.xzkj.erp.supplier.domain.SupplierSkuMappingStatus;
import cn.xzkj.erp.supplier.domain.SupplierStatus;
import cn.xzkj.erp.supplier.service.SupplierMasterDataService;
import cn.xzkj.erp.supplier.service.SupplierSkuMappingService;
import cn.xzkj.erp.warehouse.api.WarehouseController;
import cn.xzkj.erp.warehouse.domain.WarehouseStatus;
import cn.xzkj.erp.warehouse.service.WarehouseMasterDataService;
import cn.xzkj.erp.warehouse.service.WarehouseActor;
import jakarta.persistence.EntityManagerFactory;
import jakarta.validation.Validator;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Function;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer.OrderAnnotation;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DelegatingDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import tools.jackson.databind.ObjectMapper;

/**
 * PostgreSQL 16 gate for the production tenant-list query shapes.
 *
 * <p>The fixture is intentionally self-contained: it always starts and stops
 * its own container, migrates the complete classpath migration set, and never
 * reads an environment variable, .env file, external JDBC URL, or local path.
 * Docker failures therefore fail the test instead of becoming assumptions or
 * skips.
 */
@TestMethodOrder(OrderAnnotation.class)
class TenantListQueryPlanPostgresql16Test {

    private static final String POSTGRES_IMAGE = "postgres:16-alpine";
    private static final int ROWS_PER_TENANT = 3_000;
    private static final int ACTIVE_ROWS_PER_TENANT = 1_000;
    private static final int PAGE_SIZE = 73;
    private static final UUID TENANT_A =
            UUID.fromString("a1000000-0000-0000-0000-000000000001");
    private static final UUID TENANT_B =
            UUID.fromString("b1000000-0000-0000-0000-000000000001");
    private static final Instant SHARED_TIME =
            Instant.parse("2026-01-15T08:00:00Z");

    private static final TenantFixture FIXTURE_A = new TenantFixture(
            TENANT_A,
            UUID.fromString("a1000000-0000-0000-0000-000000000010"),
            UUID.fromString("a1000000-0000-0000-0000-000000000020"),
            UUID.fromString("a1000000-0000-0000-0000-000000000030"),
            UUID.fromString("a1000000-0000-0000-0000-000000000040"));
    private static final TenantFixture FIXTURE_B = new TenantFixture(
            TENANT_B,
            UUID.fromString("b1000000-0000-0000-0000-000000000010"),
            UUID.fromString("b1000000-0000-0000-0000-000000000020"),
            UUID.fromString("b1000000-0000-0000-0000-000000000030"),
            UUID.fromString("b1000000-0000-0000-0000-000000000040"));

    private static PostgreSQLContainer<?> postgres;
    private static ConfigurableApplicationContext context;
    private static String jdbcUrl;
    private static String username;
    private static String password;
    private static List<ListQuerySpec> listQueries;

    @BeforeAll
    @SuppressWarnings("resource")
    static void startPostgresql16AndApplication() throws Exception {
        postgres = new PostgreSQLContainer<>(POSTGRES_IMAGE)
                .withDatabaseName("erp_tenant_list_gate")
                .withUsername("erp_list_gate")
                .withPassword("ephemeral-list-gate-only");
        postgres.start();
        jdbcUrl = postgres.getJdbcUrl();
        username = postgres.getUsername();
        password = postgres.getPassword();

        Flyway flyway = Flyway.configure()
                .dataSource(jdbcUrl, username, password)
                .locations("classpath:db/migration")
                .cleanDisabled(false)
                .load();
        flyway.clean();
        flyway.migrate();
        seedRepresentativeData();
        listQueries = productionListQueries();

        StandardEnvironment environment = new StandardEnvironment();
        environment.getPropertySources().addFirst(new MapPropertySource(
                "tenant-list-postgresql16-gate",
                Map.of(
                        "server.port", "0",
                        "spring.datasource.url", jdbcUrl,
                        "spring.datasource.username", username,
                        "spring.datasource.password", password,
                        "spring.jpa.properties.hibernate.generate_statistics", "true",
                        "spring.jpa.properties.hibernate.session.events.log", "false",
                        "erp.environment", "integration-test")));
        context = new SpringApplicationBuilder(ErpApplication.class)
                .web(WebApplicationType.NONE)
                .environment(environment)
                .run();
    }

    @AfterAll
    static void stopPostgresql16() {
        if (context != null) {
            context.close();
        }
        if (postgres != null) {
            postgres.stop();
        }
    }

    @Test
    @Order(1)
    void ownsARealPostgresql16DatabaseAtTheLatestSchema() throws Exception {
        assertThat(postgres.isRunning()).isTrue();
        assertThat(postgres.getDockerImageName()).isEqualTo(POSTGRES_IMAGE);
        assertThat(singleString("SHOW server_version")).startsWith("16.");
        assertThat(jdbcUrl).startsWith("jdbc:postgresql:");
        assertThat(singleString("""
                SELECT version
                FROM flyway_schema_history
                WHERE success
                ORDER BY installed_rank DESC
                LIMIT 1
                """)).isEqualTo("123");
        assertThat(singleLong("""
                SELECT count(*)
                FROM flyway_schema_history
                WHERE NOT success
                """)).isZero();

        assertThat(singleLong(
                "SELECT count(*) FROM users WHERE tenant_id = ?", TENANT_A))
                .isEqualTo(ROWS_PER_TENANT);
        assertThat(singleLong("""
                SELECT count(*)
                FROM (
                    SELECT business_code
                    FROM tenant_product_spus
                    WHERE business_code = 'SPU_000001'
                    GROUP BY business_code
                    HAVING count(*) = 2
                ) shared
                """)).isOne();
        assertThat(singleLong("""
                SELECT count(DISTINCT tenant_id)
                FROM tenant_orders
                WHERE placed_at = ?
                  AND status = 'RECEIVED'
                """, SHARED_TIME)).isEqualTo(2);
    }

    @Test
    @Order(2)
    void productionListShapesUseTenantPrefixedIndexesWithoutPrimaryTableSeqScans()
            throws Exception {
        try (Connection connection = connection()) {
            for (ListQuerySpec spec : listQueries) {
                Postgresql16JsonPlan plan = Postgresql16JsonPlan.explain(
                        connection,
                        spec.sql() + " LIMIT 50 OFFSET 500",
                        spec.parameters().apply(FIXTURE_A).toArray());

                assertThat(plan.scansOf(spec.primaryRelation()))
                        .as("%s primary relation plan: %s", spec.name(), plan.describe())
                        .isNotEmpty()
                        .noneMatch(Postgresql16JsonPlan.PlanNode::isSequentialScan);
                assertThat(plan.usesAnyIndex(spec.acceptableIndexes()))
                        .as("%s indexes %s; plan: %s",
                                spec.name(), spec.acceptableIndexes(), plan.describe())
                        .isTrue();
                assertThat(plan.scansOf(spec.primaryRelation()))
                        .as("%s tenant predicate; plan: %s", spec.name(), plan.describe())
                        .allMatch(node -> node.mentionsTenantPredicate()
                                || plan.usesTenantPredicateInAnyIndex(
                                        spec.acceptableIndexes()));

                if (spec.maxScopedSortRows() != null) {
                    assertThat(plan.nodesOfType("Sort"))
                            .as("%s sort scope; plan: %s", spec.name(), plan.describe())
                            .allMatch(node ->
                                    node.planRows() <= spec.maxScopedSortRows());
                }
                if (spec.name().equals("supplier-sku-mappings")) {
                    assertThat(plan.scansOf("tenant_product_skus"))
                            .as("PG16 may hash a tenant-filtered SKU scan when it "
                                    + "is cheaper than many random lookups; plan: %s",
                                    plan.describe())
                            .allMatch(node -> node.mentionsTenantPredicate()
                                    && node.planRows() <= ROWS_PER_TENANT);
                }
            }
        }
    }

    @Test
    @Order(3)
    void staticOffsetPagingHasNoDuplicatesOrOmissionsAcrossFirstMiddleLastAndEmptyPages()
            throws Exception {
        try (Connection connection = connection()) {
            for (ListQuerySpec spec : listQueries) {
                List<UUID> expectedA = readIds(
                        connection, spec, FIXTURE_A, null, null);
                List<UUID> expectedB = readIds(
                        connection, spec, FIXTURE_B, null, null);

                assertThat(expectedA)
                        .as("%s tenant A cardinality", spec.name())
                        .hasSize(spec.expectedRows());
                assertThat(expectedB)
                        .as("%s tenant B cardinality", spec.name())
                        .hasSize(spec.expectedRows());
                assertThat(new LinkedHashSet<>(expectedA))
                        .as("%s tenant A uniqueness", spec.name())
                        .hasSize(expectedA.size());
                assertThat(expectedA)
                        .as("%s tenant A/B isolation", spec.name())
                        .doesNotContainAnyElementsOf(expectedB);

                List<UUID> traversed = new ArrayList<>();
                for (int page = 0;
                        page * PAGE_SIZE < expectedA.size();
                        page++) {
                    traversed.addAll(spec.productionReader().read(
                            FIXTURE_A, page, PAGE_SIZE));
                }
                assertThat(traversed)
                        .as("%s first/middle/last traversal", spec.name())
                        .containsExactlyElementsOf(expectedA);
                assertThat(new LinkedHashSet<>(traversed))
                        .as("%s no duplicate IDs", spec.name())
                        .hasSize(expectedA.size());
                assertThat(spec.productionReader().read(
                                FIXTURE_A,
                                (expectedA.size() + PAGE_SIZE - 1) / PAGE_SIZE,
                                PAGE_SIZE))
                        .as("%s production empty page", spec.name())
                        .isEmpty();
            }
        }
    }

    @Test
    @Order(4)
    void offsetContractDocumentsExpectedPageShiftAfterConcurrentPrependingInsert()
            throws Exception {
        ListQuerySpec audit = listQueries.stream()
                .filter(spec -> spec.name().equals("iam-audit"))
                .findFirst()
                .orElseThrow();
        UUID inserted = UUID.fromString("ffffffff-ffff-ffff-ffff-ffffffffffff");
        try (Connection connection = connection()) {
            List<UUID> pageZeroBefore =
                    readIds(connection, audit, FIXTURE_A, 10, 0);
            executeUpdate("""
                    INSERT INTO audit_logs (
                        id, tenant_id, action, resource_type,
                        resource_id, details, created_at
                    ) VALUES (?, ?, 'gate.list', 'gate_resource',
                              'concurrent', '{}'::jsonb, ?)
                    """, inserted, TENANT_A, SHARED_TIME);

            List<UUID> pageZeroAfter =
                    readIds(connection, audit, FIXTURE_A, 10, 0);
            List<UUID> pageOneAfter =
                    readIds(connection, audit, FIXTURE_A, 10, 10);

            assertThat(pageZeroAfter.getFirst()).isEqualTo(inserted);
            assertThat(pageOneAfter.getFirst())
                    .as("offset paging can repeat the former page boundary after a prepend")
                    .isEqualTo(pageZeroBefore.getLast());
            assertThat(pageZeroBefore)
                    .as("an already-read page is a value snapshot, not a cursor")
                    .doesNotContain(inserted);
        }
    }

    @Test
    @Order(5)
    void existingInvalidAndVeryLargePageContractsRemainUnchanged()
            throws Exception {
        IamAdministrationService iam =
                context.getBean(IamAdministrationService.class);
        assertThat(iam.listMembers(TENANT_A, 1_000_000, 100).items())
                .isEmpty();
        assertThatThrownBy(() -> iam.listMembers(TENANT_A, -1, 50))
                .isInstanceOf(IamValidationException.class);
        assertThatThrownBy(() -> iam.listMembers(TENANT_A, 1_000_001, 50))
                .isInstanceOf(IamValidationException.class);
        assertThatThrownBy(() -> iam.listMembers(TENANT_A, 0, 101))
                .isInstanceOf(IamValidationException.class);

        Validator validator = context.getBean(Validator.class);
        assertControllerPageContract(
                validator,
                context.getBean(ProductCenterController.class),
                "listSpus",
                false);
        assertControllerPageContract(
                validator,
                context.getBean(OrderCenterController.class),
                "listOrders",
                true);
        assertControllerPageContract(
                validator,
                context.getBean(WarehouseController.class),
                "listWarehouses",
                false);
        assertControllerPageContract(
                validator,
                context.getBean(SupplierController.class),
                "list",
                false);
        assertControllerPageContract(
                validator,
                context.getBean(SupplierSkuMappingController.class),
                "list",
                false);

        try (Connection connection = connection()) {
            assertThat(queryIds(
                    connection,
                    """
                    SELECT id
                    FROM users
                    WHERE tenant_id = ?
                    ORDER BY username, id
                    LIMIT 200 OFFSET 429496729400
                    """,
                    TENANT_A)).isEmpty();
        }
    }

    @Test
    @Order(6)
    void listServicesUseBoundedStatementsAndDoNotFetchEntitiesOneByOne()
            throws Exception {
        Statistics statistics = context.getBean(EntityManagerFactory.class)
                .unwrap(SessionFactory.class)
                .getStatistics();

        assertStatements(statistics, 2, () ->
                context.getBean(IamAdministrationService.class)
                        .listMembers(TENANT_A, 0, 50));
        assertStatements(statistics, 2, () ->
                context.getBean(IamAdministrationService.class)
                        .listRoles(TENANT_A, 0, 50));
        assertStatements(statistics, 4, () ->
                context.getBean(ProductCenterService.class)
                        .listSpus(
                                TENANT_A,
                                ProductStatus.ACTIVE,
                                null,
                                PageRequest.of(0, 50)));
        assertStatements(statistics, 3, () ->
                context.getBean(ProductCenterService.class)
                        .listSkus(
                                TENANT_A,
                                FIXTURE_A.spuId(),
                                ProductStatus.ACTIVE,
                                null,
                                PageRequest.of(0, 50)));
        assertStatements(statistics, 3, () ->
                context.getBean(ProductCenterService.class)
                        .listListings(
                                TENANT_A,
                                FIXTURE_A.shopId(),
                                null,
                                cn.xzkj.erp.product.domain.ListingStatus.ACTIVE,
                                null,
                                PageRequest.of(0, 50)));
        assertStatements(statistics, 2, () ->
                context.getBean(OrderCenterService.class)
                        .listOrders(
                                TENANT_A,
                                null,
                                OrderStatus.RECEIVED,
                                null,
                                PageRequest.of(0, 50)));
        assertStatements(statistics, 2, () ->
                context.getBean(WarehouseMasterDataService.class)
                        .listWarehouses(
                                warehouseActor(TENANT_A),
                                WarehouseStatus.ACTIVE,
                                null,
                                PageRequest.of(0, 50)));
        assertStatements(statistics, 3, () ->
                context.getBean(WarehouseMasterDataService.class)
                        .listLocations(
                                warehouseActor(TENANT_A),
                                FIXTURE_A.warehouseId(),
                                WarehouseStatus.ACTIVE,
                                null,
                                PageRequest.of(0, 50)));
        assertStatements(statistics, 2, () ->
                context.getBean(SupplierMasterDataService.class)
                        .list(
                                TENANT_A,
                                SupplierStatus.ACTIVE,
                                null,
                                PageRequest.of(0, 50)));
        assertStatements(statistics, 3, () ->
                context.getBean(SupplierSkuMappingService.class)
                        .list(
                                TENANT_A,
                                FIXTURE_A.supplierId(),
                                SupplierSkuMappingStatus.ACTIVE,
                                null,
                                PageRequest.of(0, 50)));

        CountingDataSource counting = new CountingDataSource(
                context.getBean(DataSource.class));
        AuditLogQueryRepository auditRepository = new AuditLogQueryRepository(
                new NamedParameterJdbcTemplate(counting),
                context.getBean(ObjectMapper.class));
        var auditPage = auditRepository.find(
                TENANT_A,
                "gate.list",
                null,
                null,
                null,
                0,
                50);
        assertThat(auditPage.items()).hasSize(50);
        assertThat(auditPage.totalElements())
                .isEqualTo(ROWS_PER_TENANT + 1L);
        assertThat(counting.preparedStatements())
                .as("audit count plus content query")
                .isEqualTo(2);
    }

    private static void assertStatements(
            Statistics statistics,
            long expected,
            CheckedRunnable operation) throws Exception {
        statistics.clear();
        operation.run();
        assertThat(statistics.getPrepareStatementCount())
                .as("bounded JDBC statement count")
                .isEqualTo(expected);
        assertThat(statistics.getEntityFetchCount())
                .as("no lazy entity N+1 fetches")
                .isZero();
    }

    private static void assertControllerPageContract(
            Validator validator,
            Object controller,
            String methodName,
            boolean largePageRejected) {
        Method method = java.util.Arrays.stream(controller.getClass().getMethods())
                .filter(candidate -> candidate.getName().equals(methodName))
                .max(java.util.Comparator.comparingInt(Method::getParameterCount))
                .orElseThrow();
        List<Integer> primitiveIntIndexes = new ArrayList<>();
        Object[] valid = new Object[method.getParameterCount()];
        for (int index = 0; index < method.getParameterCount(); index += 1) {
            Class<?> type = method.getParameterTypes()[index];
            if (type == boolean.class) {
                valid[index] = false;
            } else if (type == int.class) {
                valid[index] = 0;
                primitiveIntIndexes.add(index);
            } else if (type == long.class) {
                valid[index] = 0L;
            }
        }
        assertThat(primitiveIntIndexes).hasSizeGreaterThanOrEqualTo(2);
        int pageIndex = primitiveIntIndexes.get(primitiveIntIndexes.size() - 2);
        int sizeIndex = primitiveIntIndexes.getLast();
        valid[sizeIndex] = 50;
        Object[] invalidPage = valid.clone();
        invalidPage[pageIndex] = -1;
        Object[] oversizedPage = valid.clone();
        oversizedPage[sizeIndex] = 201;
        Object[] veryLargePage = valid.clone();
        veryLargePage[pageIndex] = largePageRejected ? 1_000_001 : Integer.MAX_VALUE;
        veryLargePage[sizeIndex] = 200;
        assertThat(validator.forExecutables()
                        .validateParameters(controller, method, invalidPage))
                .isNotEmpty();
        assertThat(validator.forExecutables()
                        .validateParameters(controller, method, oversizedPage))
                .isNotEmpty();
        if (largePageRejected) {
            assertThat(validator.forExecutables()
                            .validateParameters(controller, method, veryLargePage))
                    .isNotEmpty();
        } else {
            assertThat(validator.forExecutables()
                            .validateParameters(controller, method, veryLargePage))
                    .isEmpty();
        }
    }

    private static List<ListQuerySpec> productionListQueries() {
        return List.of(
                new ListQuerySpec(
                        "iam-members",
                        "users",
                        """
                        SELECT id FROM users
                        WHERE tenant_id = ?
                        ORDER BY username ASC, id ASC
                        """,
                        fixture -> List.of(fixture.tenantId()),
                        (fixture, page, size) -> context
                                .getBean(IamAdministrationService.class)
                                .listMembers(fixture.tenantId(), page, size)
                                .items()
                                .stream()
                                .map(IamAdministrationService.MemberView::id)
                                .toList(),
                        Set.of("users_tenant_id_username_key"),
                        ROWS_PER_TENANT,
                        null),
                new ListQuerySpec(
                        "iam-roles",
                        "roles",
                        """
                        SELECT id FROM roles
                        WHERE tenant_id = ?
                        ORDER BY code ASC, id ASC
                        """,
                        fixture -> List.of(fixture.tenantId()),
                        (fixture, page, size) -> context
                                .getBean(IamAdministrationService.class)
                                .listRoles(fixture.tenantId(), page, size)
                                .items()
                                .stream()
                                .map(IamAdministrationService.RoleView::id)
                                .toList(),
                        Set.of("roles_tenant_id_code_key"),
                        ROWS_PER_TENANT,
                        null),
                new ListQuerySpec(
                        "iam-audit",
                        "audit_logs",
                        """
                        SELECT id FROM audit_logs
                        WHERE tenant_id = ? AND action = 'gate.list'
                        ORDER BY created_at DESC, id DESC
                        """,
                        fixture -> List.of(fixture.tenantId()),
                        (fixture, page, size) -> context
                                .getBean(IamAdministrationService.class)
                                .listAuditLogs(
                                        fixture.tenantId(),
                                        "gate.list",
                                        null,
                                        null,
                                        null,
                                        page,
                                        size)
                                .items()
                                .stream()
                                .map(cn.xzkj.erp.iam.persistence.AuditLogRecord::id)
                                .toList(),
                        Set.of("idx_audit_logs_tenant_action_created"),
                        ROWS_PER_TENANT,
                        null),
                new ListQuerySpec(
                        "product-spus",
                        "tenant_product_spus",
                        """
                        SELECT id FROM tenant_product_spus
                        WHERE tenant_id = ? AND status = 'ACTIVE'
                        ORDER BY business_code ASC, id ASC
                        """,
                        fixture -> List.of(fixture.tenantId()),
                        (fixture, page, size) -> context
                                .getBean(ProductCenterService.class)
                                .listSpus(
                                        fixture.tenantId(),
                                        ProductStatus.ACTIVE,
                                        null,
                                        PageRequest.of(page, size))
                                .stream()
                                .map(item -> item.spu().getId())
                                .toList(),
                        Set.of("idx_tenant_product_spus_tenant_status_code"),
                        ACTIVE_ROWS_PER_TENANT,
                        null),
                new ListQuerySpec(
                        "product-skus",
                        "tenant_product_skus",
                        """
                        SELECT id FROM tenant_product_skus
                        WHERE tenant_id = ? AND spu_id = ? AND status = 'ACTIVE'
                        ORDER BY business_code ASC, id ASC
                        """,
                        fixture -> List.of(fixture.tenantId(), fixture.spuId()),
                        (fixture, page, size) -> context
                                .getBean(ProductCenterService.class)
                                .listSkus(
                                        fixture.tenantId(),
                                        fixture.spuId(),
                                        ProductStatus.ACTIVE,
                                        null,
                                        PageRequest.of(page, size))
                                .stream()
                                .map(item -> item.getId())
                                .toList(),
                        Set.of("idx_tenant_product_skus_tenant_spu_status_code"),
                        ACTIVE_ROWS_PER_TENANT,
                        null),
                new ListQuerySpec(
                        "product-listings",
                        "tenant_product_listings",
                        """
                        SELECT id FROM tenant_product_listings
                        WHERE tenant_id = ? AND shop_id = ? AND status = 'ACTIVE'
                        ORDER BY external_listing_ref ASC, id ASC
                        """,
                        fixture -> List.of(fixture.tenantId(), fixture.shopId()),
                        (fixture, page, size) -> context
                                .getBean(ProductCenterService.class)
                                .listListings(
                                        fixture.tenantId(),
                                        fixture.shopId(),
                                        null,
                                        cn.xzkj.erp.product.domain.ListingStatus.ACTIVE,
                                        null,
                                        PageRequest.of(page, size))
                                .stream()
                                .map(item -> item.getId())
                                .toList(),
                        Set.of("idx_tenant_product_listings_tenant_shop_status_ref"),
                        ACTIVE_ROWS_PER_TENANT,
                        null),
                new ListQuerySpec(
                        "orders",
                        "tenant_orders",
                        """
                        SELECT id FROM tenant_orders
                        WHERE tenant_id = ? AND shop_id = ? AND status = 'RECEIVED'
                        ORDER BY placed_at DESC, id DESC
                        """,
                        fixture -> List.of(fixture.tenantId(), fixture.shopId()),
                        (fixture, page, size) -> context
                                .getBean(OrderCenterService.class)
                                .listOrders(
                                        fixture.tenantId(),
                                        fixture.shopId(),
                                        OrderStatus.RECEIVED,
                                        null,
                                        PageRequest.of(page, size))
                                .stream()
                                .map(item -> item.getId())
                                .toList(),
                        Set.of(
                                "idx_tenant_orders_list",
                                "idx_tenant_orders_shop_status"),
                        ACTIVE_ROWS_PER_TENANT,
                        null),
                new ListQuerySpec(
                        "warehouses",
                        "tenant_warehouses",
                        """
                        SELECT id FROM tenant_warehouses
                        WHERE tenant_id = ? AND status = 'ACTIVE'
                        ORDER BY business_code ASC, id ASC
                        """,
                        fixture -> List.of(fixture.tenantId()),
                        (fixture, page, size) -> context
                                .getBean(WarehouseMasterDataService.class)
                                .listWarehouses(
                                        warehouseActor(fixture.tenantId()),
                                        WarehouseStatus.ACTIVE,
                                        null,
                                        PageRequest.of(page, size))
                                .stream()
                                .map(item -> item.getId())
                                .toList(),
                        Set.of("idx_tenant_warehouses_list"),
                        ACTIVE_ROWS_PER_TENANT,
                        null),
                new ListQuerySpec(
                        "warehouse-locations",
                        "tenant_warehouse_locations",
                        """
                        SELECT id FROM tenant_warehouse_locations
                        WHERE tenant_id = ? AND warehouse_id = ?
                          AND status = 'ACTIVE'
                        ORDER BY business_code ASC, id ASC
                        """,
                        fixture -> List.of(
                                fixture.tenantId(), fixture.warehouseId()),
                        (fixture, page, size) -> context
                                .getBean(WarehouseMasterDataService.class)
                                .listLocations(
                                        warehouseActor(fixture.tenantId()),
                                        fixture.warehouseId(),
                                        WarehouseStatus.ACTIVE,
                                        null,
                                        PageRequest.of(page, size))
                                .stream()
                                .map(item -> item.getId())
                                .toList(),
                        Set.of("idx_tenant_warehouse_locations_list"),
                        ACTIVE_ROWS_PER_TENANT,
                        null),
                new ListQuerySpec(
                        "suppliers",
                        "tenant_suppliers",
                        """
                        SELECT id FROM tenant_suppliers
                        WHERE tenant_id = ? AND status = 'ACTIVE'
                        ORDER BY business_code ASC, id ASC
                        """,
                        fixture -> List.of(fixture.tenantId()),
                        (fixture, page, size) -> context
                                .getBean(SupplierMasterDataService.class)
                                .list(
                                        fixture.tenantId(),
                                        SupplierStatus.ACTIVE,
                                        null,
                                        PageRequest.of(page, size))
                                .stream()
                                .map(item -> item.getId())
                                .toList(),
                        Set.of("idx_tenant_suppliers_list"),
                        ACTIVE_ROWS_PER_TENANT,
                        null),
                new ListQuerySpec(
                        "supplier-sku-mappings",
                        "tenant_supplier_sku_mappings",
                        """
                        SELECT mapping.id
                        FROM tenant_supplier_sku_mappings mapping
                        JOIN tenant_product_skus sku
                          ON sku.tenant_id = mapping.tenant_id
                         AND sku.id = mapping.sku_id
                        WHERE mapping.tenant_id = ?
                          AND mapping.supplier_id = ?
                          AND mapping.status = 'ACTIVE'
                        ORDER BY mapping.preferred DESC,
                                 sku.business_code ASC,
                                 mapping.id ASC
                        """,
                        fixture -> List.of(
                                fixture.tenantId(), fixture.supplierId()),
                        (fixture, page, size) -> context
                                .getBean(SupplierSkuMappingService.class)
                                .list(
                                        fixture.tenantId(),
                                        fixture.supplierId(),
                                        SupplierSkuMappingStatus.ACTIVE,
                                        null,
                                        PageRequest.of(page, size))
                                .stream()
                                .map(item -> item.mapping().getId())
                                .toList(),
                        Set.of("idx_tenant_supplier_sku_mappings_list"),
                        ACTIVE_ROWS_PER_TENANT,
                        (long) ACTIVE_ROWS_PER_TENANT));
    }

    private static List<UUID> readIds(
            Connection connection,
            ListQuerySpec spec,
            TenantFixture fixture,
            Integer limit,
            Integer offset) throws Exception {
        String sql = spec.sql();
        List<Object> parameters =
                new ArrayList<>(spec.parameters().apply(fixture));
        if (limit != null) {
            sql += " LIMIT ? OFFSET ?";
            parameters.add(limit);
            parameters.add(offset);
        }
        return queryIds(connection, sql, parameters.toArray());
    }

    private static List<UUID> queryIds(
            Connection connection,
            String sql,
            Object... parameters) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            for (int index = 0; index < parameters.length; index++) {
                statement.setObject(index + 1, parameters[index]);
            }
            try (ResultSet result = statement.executeQuery()) {
                List<UUID> ids = new ArrayList<>();
                while (result.next()) {
                    ids.add(result.getObject(1, UUID.class));
                }
                return List.copyOf(ids);
            }
        }
    }

    private static void seedRepresentativeData() throws Exception {
        try (Connection connection = connection();
                Statement statement = connection.createStatement()) {
            statement.executeUpdate("""
                    INSERT INTO tenants (id, code, name)
                    VALUES
                      ('a1000000-0000-0000-0000-000000000001',
                       'list_gate_a', 'List Gate A'),
                      ('b1000000-0000-0000-0000-000000000001',
                       'list_gate_b', 'List Gate B')
                    """);
            statement.executeUpdate("""
                    INSERT INTO platform_catalog (
                        id, code, display_name, status)
                    VALUES (
                        'c1000000-0000-0000-0000-000000000001',
                        'LIST_GATE', 'List Gate', 'ACTIVE')
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_shops (
                        id, tenant_id, platform_id,
                        external_shop_ref, display_name, status)
                    VALUES
                      ('a1000000-0000-0000-0000-000000000010',
                       'a1000000-0000-0000-0000-000000000001',
                       'c1000000-0000-0000-0000-000000000001',
                       'shared-shop', 'Shared Shop', 'ACTIVE'),
                      ('b1000000-0000-0000-0000-000000000010',
                       'b1000000-0000-0000-0000-000000000001',
                       'c1000000-0000-0000-0000-000000000001',
                       'shared-shop', 'Shared Shop', 'ACTIVE')
                    """);
            statement.executeUpdate("""
                    INSERT INTO users (
                        id, tenant_id, username, display_name,
                        status, created_at, updated_at)
                    SELECT
                        md5(prefix || ':user:' || n)::uuid,
                        tenant_id,
                        'user_' || lpad(n::text, 6, '0'),
                        'Shared User ' || n,
                        CASE WHEN n % 2 = 0 THEN 'ACTIVE' ELSE 'DISABLED' END,
                        '2026-01-15T08:00:00Z',
                        '2026-01-15T08:00:00Z'
                    FROM (
                        VALUES
                          ('tenant-a', 'a1000000-0000-0000-0000-000000000001'::uuid),
                          ('tenant-b', 'b1000000-0000-0000-0000-000000000001'::uuid)
                    ) tenants(prefix, tenant_id)
                    CROSS JOIN generate_series(1, 3000) n
                    """);
            statement.executeUpdate("""
                    INSERT INTO roles (
                        id, tenant_id, code, name, system_role,
                        created_at, updated_at)
                    SELECT
                        md5(prefix || ':role:' || n)::uuid,
                        tenant_id,
                        'role_' || lpad(n::text, 6, '0'),
                        'Shared Role ' || n,
                        false,
                        '2026-01-15T08:00:00Z',
                        '2026-01-15T08:00:00Z'
                    FROM (
                        VALUES
                          ('tenant-a', 'a1000000-0000-0000-0000-000000000001'::uuid),
                          ('tenant-b', 'b1000000-0000-0000-0000-000000000001'::uuid)
                    ) tenants(prefix, tenant_id)
                    CROSS JOIN generate_series(1, 3000) n
                    """);
            statement.executeUpdate("""
                    INSERT INTO audit_logs (
                        id, tenant_id, action, resource_type,
                        resource_id, details, created_at)
                    SELECT
                        md5(prefix || ':audit:' || n)::uuid,
                        tenant_id,
                        'gate.list',
                        'gate_resource',
                        n::text,
                        '{}'::jsonb,
                        '2026-01-15T08:00:00Z'
                    FROM (
                        VALUES
                          ('tenant-a', 'a1000000-0000-0000-0000-000000000001'::uuid),
                          ('tenant-b', 'b1000000-0000-0000-0000-000000000001'::uuid)
                    ) tenants(prefix, tenant_id)
                    CROSS JOIN generate_series(1, 3000) n
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_product_spus (
                        id, tenant_id, business_code, name,
                        status, created_at, updated_at)
                    SELECT
                        CASE WHEN n = 1 THEN focus_spu
                             ELSE md5(prefix || ':spu:' || n)::uuid END,
                        tenant_id,
                        'SPU_' || lpad(n::text, 6, '0'),
                        'Shared SPU ' || n,
                        CASE n % 3
                          WHEN 1 THEN 'ACTIVE'
                          WHEN 2 THEN 'INACTIVE'
                          ELSE 'ARCHIVED'
                        END,
                        '2026-01-15T08:00:00Z',
                        '2026-01-15T08:00:00Z'
                    FROM (
                        VALUES
                          ('tenant-a',
                           'a1000000-0000-0000-0000-000000000001'::uuid,
                           'a1000000-0000-0000-0000-000000000020'::uuid),
                          ('tenant-b',
                           'b1000000-0000-0000-0000-000000000001'::uuid,
                           'b1000000-0000-0000-0000-000000000020'::uuid)
                    ) tenants(prefix, tenant_id, focus_spu)
                    CROSS JOIN generate_series(1, 3000) n
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_product_skus (
                        id, tenant_id, spu_id, business_code, name,
                        status, created_at, updated_at)
                    SELECT
                        md5(prefix || ':sku:' || n)::uuid,
                        tenant_id,
                        focus_spu,
                        'SKU_' || lpad(n::text, 6, '0'),
                        'Shared SKU ' || n,
                        CASE n % 3
                          WHEN 1 THEN 'ACTIVE'
                          WHEN 2 THEN 'INACTIVE'
                          ELSE 'ARCHIVED'
                        END,
                        '2026-01-15T08:00:00Z',
                        '2026-01-15T08:00:00Z'
                    FROM (
                        VALUES
                          ('tenant-a',
                           'a1000000-0000-0000-0000-000000000001'::uuid,
                           'a1000000-0000-0000-0000-000000000020'::uuid),
                          ('tenant-b',
                           'b1000000-0000-0000-0000-000000000001'::uuid,
                           'b1000000-0000-0000-0000-000000000020'::uuid)
                    ) tenants(prefix, tenant_id, focus_spu)
                    CROSS JOIN generate_series(1, 3000) n
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_product_listings (
                        id, tenant_id, shop_id, platform_id, sku_id,
                        external_listing_ref, external_variant_ref,
                        status, created_at, updated_at)
                    SELECT
                        md5(prefix || ':listing:' || n)::uuid,
                        tenant_id,
                        shop_id,
                        'c1000000-0000-0000-0000-000000000001',
                        md5(prefix || ':sku:' || n)::uuid,
                        'listing-' || lpad(n::text, 6, '0'),
                        'variant-shared',
                        CASE n % 3
                          WHEN 1 THEN 'ACTIVE'
                          WHEN 2 THEN 'INACTIVE'
                          ELSE 'ARCHIVED'
                        END,
                        '2026-01-15T08:00:00Z',
                        '2026-01-15T08:00:00Z'
                    FROM (
                        VALUES
                          ('tenant-a',
                           'a1000000-0000-0000-0000-000000000001'::uuid,
                           'a1000000-0000-0000-0000-000000000010'::uuid),
                          ('tenant-b',
                           'b1000000-0000-0000-0000-000000000001'::uuid,
                           'b1000000-0000-0000-0000-000000000010'::uuid)
                    ) tenants(prefix, tenant_id, shop_id)
                    CROSS JOIN generate_series(1, 3000) n
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_orders (
                        id, tenant_id, shop_id, external_order_ref,
                        idempotency_key, request_fingerprint, currency,
                        status, line_count, placed_at, created_at, updated_at)
                    SELECT
                        md5(prefix || ':order:' || n)::uuid,
                        tenant_id,
                        shop_id,
                        'ORDER-' || lpad(n::text, 6, '0'),
                        'idem-' || lpad(n::text, 6, '0'),
                        repeat('a', 64),
                        'CNY',
                        CASE n % 3
                          WHEN 1 THEN 'RECEIVED'
                          WHEN 2 THEN 'REVIEW_PENDING'
                          ELSE 'READY_TO_FULFILL'
                        END,
                        1,
                        '2026-01-15T08:00:00Z',
                        '2026-01-15T08:00:00Z',
                        '2026-01-15T08:00:00Z'
                    FROM (
                        VALUES
                          ('tenant-a',
                           'a1000000-0000-0000-0000-000000000001'::uuid,
                           'a1000000-0000-0000-0000-000000000010'::uuid),
                          ('tenant-b',
                           'b1000000-0000-0000-0000-000000000001'::uuid,
                           'b1000000-0000-0000-0000-000000000010'::uuid)
                    ) tenants(prefix, tenant_id, shop_id)
                    CROSS JOIN generate_series(1, 3000) n
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_warehouses (
                        id, tenant_id, business_code, name,
                        status, created_at, updated_at)
                    SELECT
                        CASE WHEN n = 1 THEN focus_warehouse
                             ELSE md5(prefix || ':warehouse:' || n)::uuid END,
                        tenant_id,
                        'WH_' || lpad(n::text, 6, '0'),
                        'Shared Warehouse ' || n,
                        CASE n % 3
                          WHEN 1 THEN 'ACTIVE'
                          WHEN 2 THEN 'INACTIVE'
                          ELSE 'ARCHIVED'
                        END,
                        '2026-01-15T08:00:00Z',
                        '2026-01-15T08:00:00Z'
                    FROM (
                        VALUES
                          ('tenant-a',
                           'a1000000-0000-0000-0000-000000000001'::uuid,
                           'a1000000-0000-0000-0000-000000000030'::uuid),
                          ('tenant-b',
                           'b1000000-0000-0000-0000-000000000001'::uuid,
                           'b1000000-0000-0000-0000-000000000030'::uuid)
                    ) tenants(prefix, tenant_id, focus_warehouse)
                    CROSS JOIN generate_series(1, 3000) n
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_warehouse_locations (
                        id, tenant_id, warehouse_id, business_code, name,
                        status, created_at, updated_at)
                    SELECT
                        md5(prefix || ':location:' || n)::uuid,
                        tenant_id,
                        focus_warehouse,
                        'LOC_' || lpad(n::text, 6, '0'),
                        'Shared Location ' || n,
                        CASE n % 3
                          WHEN 1 THEN 'ACTIVE'
                          WHEN 2 THEN 'INACTIVE'
                          ELSE 'ARCHIVED'
                        END,
                        '2026-01-15T08:00:00Z',
                        '2026-01-15T08:00:00Z'
                    FROM (
                        VALUES
                          ('tenant-a',
                           'a1000000-0000-0000-0000-000000000001'::uuid,
                           'a1000000-0000-0000-0000-000000000030'::uuid),
                          ('tenant-b',
                           'b1000000-0000-0000-0000-000000000001'::uuid,
                           'b1000000-0000-0000-0000-000000000030'::uuid)
                    ) tenants(prefix, tenant_id, focus_warehouse)
                    CROSS JOIN generate_series(1, 3000) n
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_suppliers (
                        id, tenant_id, business_code, name,
                        status, created_at, updated_at)
                    SELECT
                        CASE WHEN n = 1 THEN focus_supplier
                             ELSE md5(prefix || ':supplier:' || n)::uuid END,
                        tenant_id,
                        'SUP_' || lpad(n::text, 6, '0'),
                        'Shared Supplier ' || n,
                        CASE n % 3
                          WHEN 1 THEN 'ACTIVE'
                          WHEN 2 THEN 'INACTIVE'
                          ELSE 'ARCHIVED'
                        END,
                        '2026-01-15T08:00:00Z',
                        '2026-01-15T08:00:00Z'
                    FROM (
                        VALUES
                          ('tenant-a',
                           'a1000000-0000-0000-0000-000000000001'::uuid,
                           'a1000000-0000-0000-0000-000000000040'::uuid),
                          ('tenant-b',
                           'b1000000-0000-0000-0000-000000000001'::uuid,
                           'b1000000-0000-0000-0000-000000000040'::uuid)
                    ) tenants(prefix, tenant_id, focus_supplier)
                    CROSS JOIN generate_series(1, 3000) n
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_supplier_sku_mappings (
                        id, tenant_id, supplier_id, sku_id,
                        supplier_sku_code, status, preferred,
                        lead_time_days, created_at, updated_at)
                    SELECT
                        md5(prefix || ':mapping:' || n)::uuid,
                        tenant_id,
                        focus_supplier,
                        md5(prefix || ':sku:' || n)::uuid,
                        'SUPPLIER-SKU-' || lpad(n::text, 6, '0'),
                        CASE n % 3
                          WHEN 1 THEN 'ACTIVE'
                          ELSE 'INACTIVE'
                        END,
                        n % 2 = 0,
                        n % 31,
                        '2026-01-15T08:00:00Z',
                        '2026-01-15T08:00:00Z'
                    FROM (
                        VALUES
                          ('tenant-a',
                           'a1000000-0000-0000-0000-000000000001'::uuid,
                           'a1000000-0000-0000-0000-000000000040'::uuid),
                          ('tenant-b',
                           'b1000000-0000-0000-0000-000000000001'::uuid,
                           'b1000000-0000-0000-0000-000000000040'::uuid)
                    ) tenants(prefix, tenant_id, focus_supplier)
                    CROSS JOIN generate_series(1, 3000) n
                    WHERE n % 3 <> 0
                    """);
            statement.execute("VACUUM (ANALYZE)");
        }
    }

    private static Connection connection() throws Exception {
        return DriverManager.getConnection(jdbcUrl, username, password);
    }

    private static void executeUpdate(String sql, Object... parameters)
            throws Exception {
        try (Connection connection = connection();
                PreparedStatement statement = connection.prepareStatement(sql)) {
            for (int index = 0; index < parameters.length; index++) {
                setParameter(statement, index + 1, parameters[index]);
            }
            statement.executeUpdate();
        }
    }

    private static long singleLong(String sql, Object... parameters)
            throws Exception {
        try (Connection connection = connection();
                PreparedStatement statement = connection.prepareStatement(sql)) {
            for (int index = 0; index < parameters.length; index++) {
                setParameter(statement, index + 1, parameters[index]);
            }
            try (ResultSet result = statement.executeQuery()) {
                result.next();
                return result.getLong(1);
            }
        }
    }

    private static String singleString(String sql, Object... parameters)
            throws Exception {
        try (Connection connection = connection();
                PreparedStatement statement = connection.prepareStatement(sql)) {
            for (int index = 0; index < parameters.length; index++) {
                setParameter(statement, index + 1, parameters[index]);
            }
            try (ResultSet result = statement.executeQuery()) {
                result.next();
                return result.getString(1);
            }
        }
    }

    private static void setParameter(
            PreparedStatement statement,
            int index,
            Object value) throws Exception {
        if (value instanceof Instant instant) {
            statement.setTimestamp(index, java.sql.Timestamp.from(instant));
        } else {
            statement.setObject(index, value);
        }
    }

    private static WarehouseActor warehouseActor(UUID tenantId) {
        return new WarehouseActor(
                tenantId,
                null,
                UUID.fromString("99000000-0000-0000-0000-000000000001"),
                "tenant-list-query-plan",
                "127.0.0.1");
    }

    private record TenantFixture(
            UUID tenantId,
            UUID shopId,
            UUID spuId,
            UUID warehouseId,
            UUID supplierId) {
    }

    private record ListQuerySpec(
            String name,
            String primaryRelation,
            String sql,
            Function<TenantFixture, List<Object>> parameters,
            ProductionPageReader productionReader,
            Set<String> acceptableIndexes,
            int expectedRows,
            Long maxScopedSortRows) {
    }

    @FunctionalInterface
    private interface CheckedRunnable {
        void run() throws Exception;
    }

    @FunctionalInterface
    private interface ProductionPageReader {
        List<UUID> read(TenantFixture fixture, int page, int size)
                throws Exception;
    }

    private static final class CountingDataSource extends DelegatingDataSource {

        private final AtomicLong preparedStatements = new AtomicLong();

        private CountingDataSource(DataSource target) {
            super(target);
        }

        @Override
        public Connection getConnection() throws java.sql.SQLException {
            return count(super.getConnection());
        }

        @Override
        public Connection getConnection(String username, String password)
                throws java.sql.SQLException {
            return count(super.getConnection(username, password));
        }

        long preparedStatements() {
            return preparedStatements.get();
        }

        private Connection count(Connection target) {
            return (Connection) Proxy.newProxyInstance(
                    Connection.class.getClassLoader(),
                    new Class<?>[] {Connection.class},
                    (proxy, method, arguments) -> {
                        if (method.getName().startsWith("prepareStatement")) {
                            preparedStatements.incrementAndGet();
                        }
                        try {
                            return method.invoke(target, arguments);
                        } catch (InvocationTargetException failure) {
                            throw failure.getCause();
                        }
                    });
        }
    }
}
