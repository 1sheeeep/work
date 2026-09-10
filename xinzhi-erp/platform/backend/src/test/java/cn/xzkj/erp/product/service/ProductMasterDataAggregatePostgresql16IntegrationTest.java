package cn.xzkj.erp.product.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import org.flywaydb.core.Flyway;
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
import cn.xzkj.erp.product.domain.ProductSensitiveAttributeCode;
import cn.xzkj.erp.product.domain.ProductStatus;

class ProductMasterDataAggregatePostgresql16IntegrationTest {

    private static final UUID TENANT_ID = UUID.fromString(
            "43100000-0000-0000-0000-000000000001");
    private static final UUID USER_ID = UUID.fromString(
            "43100000-0000-0000-0000-000000000011");

    private static PostgreSQLContainer<?> postgres;
    private static String jdbcUrl;
    private static String username;
    private static String password;
    private static ConfigurableApplicationContext context;
    private static ProductCenterService service;
    private static ProductMasterDataService masterDataService;

    @BeforeAll
    static void startRuntimeOnPostgres16() throws Exception {
        configureDatabase();
        Flyway.configure()
                .dataSource(jdbcUrl, username, password)
                .locations("classpath:db/migration")
                .load()
                .migrate();
        execute("""
                INSERT INTO tenants (id, code, name)
                VALUES (
                  '43100000-0000-0000-0000-000000000001',
                  'product_aggregate',
                  'Product Aggregate');

                INSERT INTO users (
                  id, tenant_id, username, display_name)
                VALUES (
                  '43100000-0000-0000-0000-000000000011',
                  '43100000-0000-0000-0000-000000000001',
                  'product_aggregate_user',
                  'Product Aggregate User');
                """);
        context = startApplication();
        service = context.getBean(ProductCenterService.class);
        masterDataService = context.getBean(ProductMasterDataService.class);
    }

    @AfterAll
    static void stopRuntimeAndPostgres16() {
        if (context != null) {
            context.close();
        }
        if (postgres != null) {
            postgres.stop();
        }
    }

    @Test
    void attributeOnlyUpdateIncrementsAggregateOnceAndAuditsActualVersion()
            throws Exception {
        var created = createSpu("ATTRIBUTE_ONLY", "create-attribute-only");

        var updated = update(
                created.spu().getId(),
                0,
                List.of(
                        ProductSensitiveAttributeCode.MAGNETIC,
                        ProductSensitiveAttributeCode.BATTERY),
                "update-attribute-only");

        assertThat(updated.spu().getVersion()).isOne();
        assertThat(updated.spu().getSensitiveAttributesRevision()).isOne();
        assertThat(updated.sensitiveAttributeCodes()).containsExactly(
                ProductSensitiveAttributeCode.BATTERY,
                ProductSensitiveAttributeCode.MAGNETIC);
        assertThat(state(created.spu().getId())).isEqualTo(
                new SpuState(1, 1, "BATTERY,MAGNETIC"));
        assertThat(audit("update-attribute-only")).isEqualTo(
                new AuditState(
                        1,
                        1,
                        "sensitiveAttributeCodes"));
    }

    @Test
    void staleVersionFailsBeforeAnyAttributeWriteOrAudit()
            throws Exception {
        var created = createSpu("STALE_ATTRIBUTE", "create-stale");
        UUID spuId = created.spu().getId();
        update(
                spuId,
                0,
                List.of(ProductSensitiveAttributeCode.BATTERY),
                "update-current");

        assertThatThrownBy(() -> update(
                spuId,
                0,
                List.of(ProductSensitiveAttributeCode.FLAMMABLE),
                "update-stale"))
                .isInstanceOf(ConflictException.class)
                .hasMessage("The resource has changed");

        assertThat(state(spuId)).isEqualTo(
                new SpuState(1, 1, "BATTERY"));
        assertThat(audit("update-current")).isEqualTo(
                new AuditState(
                        1,
                        1,
                        "sensitiveAttributeCodes"));
        assertThat(audit("update-stale")).isEqualTo(
                new AuditState(0, -1, ""));
    }

    @Test
    void concurrentAttributeUpdatesSerializeAndOnlyWinnerMutatesAndAudits()
            throws Exception {
        var created = createSpu("CONCURRENT_ATTRIBUTE", "create-concurrent");
        UUID spuId = created.spu().getId();
        CountDownLatch start = new CountDownLatch(1);

        try (var executor = Executors.newFixedThreadPool(2)) {
            Future<Attempt> battery = executor.submit(() -> attemptUpdate(
                    start,
                    spuId,
                    ProductSensitiveAttributeCode.BATTERY,
                    "update-concurrent-battery"));
            Future<Attempt> flammable = executor.submit(() -> attemptUpdate(
                    start,
                    spuId,
                    ProductSensitiveAttributeCode.FLAMMABLE,
                    "update-concurrent-flammable"));
            start.countDown();

            List<Attempt> attempts = List.of(
                    battery.get(30, TimeUnit.SECONDS),
                    flammable.get(30, TimeUnit.SECONDS));
            assertThat(attempts).filteredOn(Attempt::succeeded).hasSize(1);
            assertThat(attempts)
                    .filteredOn(attempt -> !attempt.succeeded())
                    .singleElement()
                    .extracting(Attempt::failure)
                    .isInstanceOf(ConflictException.class);

            Attempt winner = attempts.stream()
                    .filter(Attempt::succeeded)
                    .findFirst()
                    .orElseThrow();
            Attempt loser = attempts.stream()
                    .filter(attempt -> !attempt.succeeded())
                    .findFirst()
                    .orElseThrow();
            assertThat(winner.result().spu().getVersion()).isOne();
            assertThat(winner.result().sensitiveAttributeCodes())
                    .containsExactly(winner.code());
            assertThat(state(spuId)).isEqualTo(
                    new SpuState(1, 1, winner.code().name()));
            assertThat(audit(winner.requestId())).isEqualTo(
                    new AuditState(
                            1,
                            1,
                            "sensitiveAttributeCodes"));
            assertThat(audit(loser.requestId())).isEqualTo(
                    new AuditState(0, -1, ""));
        }
    }

    @Test
    void savesRefreshesAndEditsTheGovernedMasterProductFields()
            throws Exception {
        var category = masterDataService.createCategory(
                actor("master-category"), "测试类目", 10);
        var packageMaterial = masterDataService.createPackageMaterial(
                actor("master-package"),
                new ProductMasterDataService.PackageMaterialValues(
                        "测试纸箱", "2.5000", "CNY", 120L, 1,
                        300L, 200L, 100L));
        var created = service.createSpu(
                actor("master-create"),
                "FULL_MASTER",
                new ProductCenterService.SpuValues(
                        "完整主商品", "完整主商品", "Full master",
                        "XZ", "保留的商品备注", category.getId(),
                        100L, 200L, 300L, 450L, 5000,
                        packageMaterial.getId(), 2,
                        USER_ID, USER_ID, USER_ID, USER_ID),
                List.of(ProductSensitiveAttributeCode.BATTERY));

        UUID spuId = created.spu().getId();
        var refreshed = service.getSpu(TENANT_ID, spuId);
        assertThat(refreshed.spu().getCategoryNameSnapshot())
                .isEqualTo("测试类目");
        assertThat(refreshed.spu().getPackageMaterialNameSnapshot())
                .isEqualTo("测试纸箱");
        assertThat(refreshed.spu().getDeveloperMemberNameSnapshot())
                .isEqualTo("Product Aggregate User");
        assertThat(refreshed.spu().getProductNote())
                .isEqualTo("保留的商品备注");
        assertThat(refreshed.sensitiveAttributeCodes())
                .containsExactly(ProductSensitiveAttributeCode.BATTERY);

        var updated = service.updateSpu(
                actor("master-edit"), spuId, refreshed.spu().getVersion(),
                new ProductCenterService.SpuValues(
                        "完整主商品（已编辑）", "完整主商品（已编辑）",
                        "Full master edited", "XZ", "编辑后的商品备注",
                        category.getId(), 100L, 200L, 300L, 450L, 6000,
                        packageMaterial.getId(), 3,
                        USER_ID, USER_ID, USER_ID, USER_ID),
                ProductStatus.ACTIVE,
                List.of(ProductSensitiveAttributeCode.MAGNETIC));
        assertThat(updated.spu().getVersion()).isOne();
        assertThat(service.getSpu(TENANT_ID, spuId).spu().getProductNote())
                .isEqualTo("编辑后的商品备注");
        assertThat(service.getSpu(TENANT_ID, spuId).spu()
                .getVolumetricDivisor()).isEqualTo(6000);
    }

    @Test
    void inventorySkuListResolvesCreatorFromTenantScopedCreationAudit() {
        var parent = createSpu("SKU_CREATOR_PARENT", "create-sku-parent");
        var sku = service.createSku(
                actor("create-inventory-sku"),
                parent.spu().getId(),
                "SKU_CREATOR_BLUE_M",
                "Creator blue M",
                "Blue / M");

        var result = service.listSkusWithMasterIdentity(
                TENANT_ID,
                null,
                null,
                "SKU_CREATOR_BLUE_M",
                "INVENTORY_SKU",
                "EQUALS",
                PageRequest.of(0, 25));
        var matchingCreator = service.listSkusWithMasterIdentity(
                TENANT_ID, null, null, "SKU_CREATOR_BLUE_M",
                null, null, null, null, null, USER_ID,
                null, null, "INVENTORY_SKU", "EQUALS",
                "BUSINESS_CODE", false, PageRequest.of(0, 25));
        var unknownCreator = service.listSkusWithMasterIdentity(
                TENANT_ID, null, null, "SKU_CREATOR_BLUE_M",
                null, null, null, null, null, UUID.randomUUID(),
                null, null, "INVENTORY_SKU", "EQUALS",
                "BUSINESS_CODE", false, PageRequest.of(0, 25));

        assertThat(result.getContent()).singleElement().satisfies(item -> {
            assertThat(item.sku().getId()).isEqualTo(sku.getId());
            assertThat(item.master().getId())
                    .isEqualTo(parent.spu().getId());
            assertThat(item.creatorName())
                    .isEqualTo("Product Aggregate User");
        });
        assertThat(matchingCreator.getContent())
                .extracting(item -> item.sku().getId())
                .containsExactly(sku.getId());
        assertThat(unknownCreator.getContent()).isEmpty();
    }

    @Test
    void inventorySkuListSearchesTheUniquePreferredSupplierFields()
            throws Exception {
        var parent = createSpu("SKU_SUPPLIER_PARENT", "supplier-parent");
        var mapped = service.createSku(
                actor("create-supplier-mapped-sku"),
                parent.spu().getId(),
                "SKU_WITH_PREFERRED_SUPPLIER",
                "Preferred supplier item",
                null);
        var unmapped = service.createSku(
                actor("create-supplier-unmapped-sku"),
                parent.spu().getId(),
                "SKU_WITHOUT_PREFERRED_SUPPLIER",
                "No preferred supplier item",
                null);
        var mappedWithoutOriginalSku = service.createSku(
                actor("create-supplier-without-original-sku"),
                parent.spu().getId(),
                "SKU_WITHOUT_ORIGINAL_SKU",
                "Preferred supplier without original SKU",
                null);
        UUID supplierId = UUID.randomUUID();
        execute("""
                INSERT INTO tenant_suppliers (
                  id, tenant_id, business_code, name)
                VALUES ('%s', '%s', 'PREF_SUP', 'Prime Supplier')
                """.formatted(supplierId, TENANT_ID));
        execute("""
                INSERT INTO tenant_supplier_sku_mappings (
                  id, tenant_id, supplier_id, sku_id, supplier_sku_code,
                  status, preferred)
                VALUES
                  ('%s', '%s', '%s', '%s', 'FACTORY_BLUE_M',
                   'ACTIVE', true),
                  ('%s', '%s', '%s', '%s', null, 'ACTIVE', true)
                """.formatted(
                        UUID.randomUUID(), TENANT_ID, supplierId,
                        mapped.getId(),
                        UUID.randomUUID(), TENANT_ID, supplierId,
                        mappedWithoutOriginalSku.getId()));

        var byName = service.listSkusWithMasterIdentity(
                TENANT_ID, parent.spu().getId(), null, "prime supplier",
                "DEFAULT_SUPPLIER", "EQUALS", PageRequest.of(0, 25));
        var withSupplier = service.listSkusWithMasterIdentity(
                TENANT_ID, parent.spu().getId(), null, null,
                "DEFAULT_SUPPLIER", "NOT_EMPTY", PageRequest.of(0, 25));
        var withoutSupplier = service.listSkusWithMasterIdentity(
                TENANT_ID, parent.spu().getId(), null, null,
                "DEFAULT_SUPPLIER", "EMPTY", PageRequest.of(0, 25));
        var byOriginalSku = service.listSkusWithMasterIdentity(
                TENANT_ID, parent.spu().getId(), null, "blue_m",
                "ORIGINAL_SKU", "ENDS_WITH", PageRequest.of(0, 25));
        var withOriginalSku = service.listSkusWithMasterIdentity(
                TENANT_ID, parent.spu().getId(), null, null,
                "ORIGINAL_SKU", "NOT_EMPTY", PageRequest.of(0, 25));
        var withoutOriginalSku = service.listSkusWithMasterIdentity(
                TENANT_ID, parent.spu().getId(), null, null,
                "ORIGINAL_SKU", "EMPTY", PageRequest.of(0, 25));

        assertThat(byName.getContent())
                .extracting(item -> item.sku().getId())
                .containsExactlyInAnyOrder(
                        mapped.getId(), mappedWithoutOriginalSku.getId());
        assertThat(withSupplier.getContent())
                .extracting(item -> item.sku().getId())
                .containsExactlyInAnyOrder(
                        mapped.getId(), mappedWithoutOriginalSku.getId());
        assertThat(withoutSupplier.getContent())
                .extracting(item -> item.sku().getId())
                .containsExactly(unmapped.getId());
        assertThat(byOriginalSku.getContent())
                .extracting(item -> item.sku().getId())
                .containsExactly(mapped.getId());
        assertThat(withOriginalSku.getContent())
                .extracting(item -> item.sku().getId())
                .containsExactly(mapped.getId());
        assertThat(withoutOriginalSku.getContent())
                .extracting(item -> item.sku().getId())
                .containsExactlyInAnyOrder(
                        unmapped.getId(), mappedWithoutOriginalSku.getId());
    }

    @Test
    void inventorySkuListFiltersByTenantScopedParentCategoryAndPeople()
            throws Exception {
        UUID developerAssistantId = UUID.randomUUID();
        UUID salesMemberId = UUID.randomUUID();
        UUID artMemberId = UUID.randomUUID();
        execute("""
                INSERT INTO users (
                  id, tenant_id, username, display_name)
                VALUES
                  ('%s', '%s', 'sku_filter_assistant_%s',
                   'SKU filter assistant'),
                  ('%s', '%s', 'sku_filter_sales_%s',
                   'SKU filter sales'),
                  ('%s', '%s', 'sku_filter_art_%s',
                   'SKU filter art');
                """.formatted(
                        developerAssistantId, TENANT_ID,
                        developerAssistantId.toString().substring(0, 8),
                        salesMemberId, TENANT_ID,
                        salesMemberId.toString().substring(0, 8),
                        artMemberId, TENANT_ID,
                        artMemberId.toString().substring(0, 8)));
        var matchingCategory = masterDataService.createCategory(
                actor("sku-filter-category-match"),
                "库存筛选目录一",
                20);
        var otherCategory = masterDataService.createCategory(
                actor("sku-filter-category-other"),
                "库存筛选目录二",
                21);
        var matchingParent = service.createSpu(
                actor("sku-filter-parent-match"),
                "SKU_FILTER_PARENT_MATCH",
                new ProductCenterService.SpuValues(
                        "库存筛选主商品一", "库存筛选主商品一",
                        "Inventory filter parent one", null, null,
                        matchingCategory.getId(),
                        null, null, null, null, null, null, null,
                        artMemberId, USER_ID,
                        developerAssistantId, salesMemberId),
                List.of());
        var otherParent = service.createSpu(
                actor("sku-filter-parent-other"),
                "SKU_FILTER_PARENT_OTHER",
                new ProductCenterService.SpuValues(
                        "库存筛选主商品二", "库存筛选主商品二",
                        "Inventory filter parent two", null, null,
                        otherCategory.getId(),
                        null, null, null, null, null, null, null,
                        null, null, null, null),
                List.of());
        var matchingSku = service.createSku(
                actor("sku-filter-match"),
                matchingParent.spu().getId(),
                "SKU_FILTER_MATCH",
                "Inventory filter match",
                null);
        service.createSku(
                actor("sku-filter-other"),
                otherParent.spu().getId(),
                "SKU_FILTER_OTHER",
                "Inventory filter other",
                null);

        var matched = service.listSkusWithMasterIdentity(
                TENANT_ID, null, null, "SKU_FILTER_",
                matchingCategory.getId(), USER_ID,
                developerAssistantId, salesMemberId, artMemberId,
                null, null, null,
                "INVENTORY_SKU", "STARTS_WITH",
                "BUSINESS_CODE", false, PageRequest.of(0, 25));
        var mismatchedParentReferences = service.listSkusWithMasterIdentity(
                TENANT_ID, null, null, "SKU_FILTER_",
                otherCategory.getId(), USER_ID,
                developerAssistantId, salesMemberId, artMemberId,
                null, null, null,
                "INVENTORY_SKU", "STARTS_WITH",
                "BUSINESS_CODE", false, PageRequest.of(0, 25));
        var swappedPeople = service.listSkusWithMasterIdentity(
                TENANT_ID, null, null, "SKU_FILTER_",
                matchingCategory.getId(), USER_ID,
                salesMemberId, developerAssistantId, artMemberId,
                null, null, null,
                "INVENTORY_SKU", "STARTS_WITH",
                "BUSINESS_CODE", false, PageRequest.of(0, 25));
        var unknownArtMember = service.listSkusWithMasterIdentity(
                TENANT_ID, null, null, "SKU_FILTER_",
                matchingCategory.getId(), USER_ID,
                developerAssistantId, salesMemberId, UUID.randomUUID(),
                null, null, null,
                "INVENTORY_SKU", "STARTS_WITH",
                "BUSINESS_CODE", false, PageRequest.of(0, 25));

        assertThat(matched.getContent())
                .extracting(item -> item.sku().getId())
                .containsExactly(matchingSku.getId());
        assertThat(mismatchedParentReferences).isEmpty();
        assertThat(swappedPeople).isEmpty();
        assertThat(unknownArtMember).isEmpty();
    }

    @Test
    void inventorySkuListSortsByReviewedProductFields() throws Exception {
        var parent = createSpu("SKU_SORT_PARENT", "create-sort-parent");
        var older = service.createSku(
                actor("create-sort-z"),
                parent.spu().getId(),
                "SKU_SORT_Z",
                "Sort Z",
                null);
        var newer = service.createSku(
                actor("create-sort-a"),
                parent.spu().getId(),
                "SKU_SORT_A",
                "Sort A",
                null);
        execute("""
                UPDATE tenant_product_skus
                   SET created_at = CASE
                     WHEN id = '%s' THEN TIMESTAMPTZ '2026-01-01T00:00:00Z'
                     WHEN id = '%s' THEN TIMESTAMPTZ '2026-02-01T00:00:00Z'
                     ELSE created_at
                   END
                 WHERE tenant_id = '%s'
                   AND id IN ('%s', '%s');
                """.formatted(
                        older.getId(),
                        newer.getId(),
                        TENANT_ID,
                        older.getId(),
                        newer.getId()));

        var byCreatedDescending = service.listSkusWithMasterIdentity(
                TENANT_ID, parent.spu().getId(), null, null,
                "INVENTORY_SKU", "STARTS_WITH",
                "CREATED_AT", true, PageRequest.of(0, 25));
        var byCodeDescending = service.listSkusWithMasterIdentity(
                TENANT_ID, parent.spu().getId(), null, null,
                "INVENTORY_SKU", "STARTS_WITH",
                "BUSINESS_CODE", true, PageRequest.of(0, 25));
        var januaryOnly = service.listSkusWithMasterIdentity(
                TENANT_ID, parent.spu().getId(), null, null,
                null, null, null, null, null, null,
                Instant.parse("2026-01-01T00:00:00Z"),
                Instant.parse("2026-02-01T00:00:00Z"),
                "INVENTORY_SKU", "STARTS_WITH",
                "BUSINESS_CODE", false, PageRequest.of(0, 25));

        assertThat(byCreatedDescending.getContent())
                .extracting(item -> item.sku().getBusinessCode())
                .containsExactly("SKU_SORT_A", "SKU_SORT_Z");
        assertThat(byCodeDescending.getContent())
                .extracting(item -> item.sku().getBusinessCode())
                .containsExactly("SKU_SORT_Z", "SKU_SORT_A");
        assertThat(januaryOnly.getContent())
                .extracting(item -> item.sku().getBusinessCode())
                .containsExactly("SKU_SORT_Z");
    }

    private static Attempt attemptUpdate(
            CountDownLatch start,
            UUID spuId,
            ProductSensitiveAttributeCode code,
            String requestId)
            throws InterruptedException {
        start.await(10, TimeUnit.SECONDS);
        try {
            return new Attempt(
                    requestId,
                    code,
                    update(spuId, 0, List.of(code), requestId),
                    null);
        } catch (RuntimeException failure) {
            return new Attempt(requestId, code, null, failure);
        }
    }

    private static ProductCenterService.SpuWithSummary createSpu(
            String code,
            String requestId) {
        return service.createSpu(
                actor(requestId),
                code,
                values("中文名称", "English name", "Private product note"),
                List.of());
    }

    private static ProductCenterService.SpuWithSummary update(
            UUID spuId,
            long expectedVersion,
            List<ProductSensitiveAttributeCode> attributes,
            String requestId) {
        return service.updateSpu(
                actor(requestId),
                spuId,
                expectedVersion,
                values("中文名称", null, "Private product note"),
                ProductStatus.ACTIVE,
                attributes);
    }

    private static ProductCenterService.SpuValues values(
            String name,
            String nameEn,
            String productNote) {
        return new ProductCenterService.SpuValues(
                name, name, nameEn, null, productNote,
                null, null, null, null, null, null, null, null,
                null, null, null, null);
    }

    private static ProductActor actor(String requestId) {
        return new ProductActor(
                TENANT_ID,
                USER_ID,
                null,
                requestId,
                "127.0.0.1");
    }

    private static SpuState state(UUID spuId) throws Exception {
        try (Connection connection = connection();
                PreparedStatement statement = connection.prepareStatement("""
                        SELECT s.version,
                               s.sensitive_attributes_revision,
                               coalesce((
                                 SELECT string_agg(
                                   a.attribute_code, ','
                                   ORDER BY a.sort_order)
                                 FROM
                                   tenant_product_spu_sensitive_attributes a
                                 WHERE a.tenant_id = s.tenant_id
                                   AND a.spu_id = s.id
                               ), '')
                        FROM tenant_product_spus s
                        WHERE s.tenant_id = ? AND s.id = ?
                        """)) {
            statement.setObject(1, TENANT_ID);
            statement.setObject(2, spuId);
            try (ResultSet result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                return new SpuState(
                        result.getLong(1),
                        result.getLong(2),
                        result.getString(3));
            }
        }
    }

    private static AuditState audit(String requestId) throws Exception {
        try (Connection connection = connection();
                PreparedStatement statement = connection.prepareStatement("""
                        SELECT count(*),
                               coalesce(
                                 max((details ->> 'version')::bigint),
                                 -1),
                               coalesce(
                                 max(details ->> 'changedFields'),
                                 '')
                        FROM audit_logs
                        WHERE tenant_id = ?
                          AND action = 'product_spu.updated'
                          AND request_id = ?
                        """)) {
            statement.setObject(1, TENANT_ID);
            statement.setString(2, requestId);
            try (ResultSet result = statement.executeQuery()) {
                result.next();
                return new AuditState(
                        result.getLong(1),
                        result.getLong(2),
                        result.getString(3));
            }
        }
    }

    private static ConfigurableApplicationContext startApplication() {
        StandardEnvironment environment = new StandardEnvironment();
        environment.getPropertySources().addFirst(new MapPropertySource(
                "product-aggregate-integration-test",
                Map.of(
                        "server.port", "0",
                        "spring.datasource.url", jdbcUrl,
                        "spring.datasource.username", username,
                        "spring.datasource.password", password,
                        "erp.environment", "integration-test")));
        return new SpringApplicationBuilder(ErpApplication.class)
                .web(WebApplicationType.SERVLET)
                .environment(environment)
                .run();
    }

    private static void configureDatabase() {
        String externalUrl = System.getenv("ERP_TEST_DB_URL");
        if (externalUrl != null && !externalUrl.isBlank()) {
            jdbcUrl = externalUrl;
            username = requiredEnvironment("ERP_TEST_DB_USER");
            password = requiredEnvironment("ERP_TEST_DB_PASSWORD");
            return;
        }
        postgres = new PostgreSQLContainer<>("postgres:16-alpine")
                .withImagePullPolicy(imageName -> false)
                .withDatabaseName("erp_product_aggregate_test")
                .withUsername("erp_test")
                .withPassword("integration-test-only");
        postgres.start();
        jdbcUrl = postgres.getJdbcUrl();
        username = postgres.getUsername();
        password = postgres.getPassword();
    }

    private static String requiredEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(name + " is required");
        }
        return value;
    }

    private static void execute(String sql) throws Exception {
        try (Connection connection = connection();
                Statement statement = connection.createStatement()) {
            statement.execute(sql);
        }
    }

    private static Connection connection() throws Exception {
        return DriverManager.getConnection(jdbcUrl, username, password);
    }

    private record SpuState(
            long version,
            long sensitiveAttributesRevision,
            String attributes) {
    }

    private record AuditState(
            long count,
            long version,
            String changedFields) {
    }

    private record Attempt(
            String requestId,
            ProductSensitiveAttributeCode code,
            ProductCenterService.SpuWithSummary result,
            RuntimeException failure) {

        boolean succeeded() {
            return failure == null;
        }
    }
}
