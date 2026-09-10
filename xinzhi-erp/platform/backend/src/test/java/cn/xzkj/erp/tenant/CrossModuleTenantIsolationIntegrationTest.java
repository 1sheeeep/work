package cn.xzkj.erp.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import cn.xzkj.erp.ErpApplication;
import cn.xzkj.erp.platform.api.ApiExceptionHandler;
import cn.xzkj.erp.testing.BusinessApplicationTestData;
import cn.xzkj.erp.testing.LogCapture;
import com.jayway.jsonpath.JsonPath;
import jakarta.servlet.Filter;
import java.lang.reflect.Method;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.flywaydb.core.Flyway;
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
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.testcontainers.containers.PostgreSQLContainer;

@TestMethodOrder(OrderAnnotation.class)
class CrossModuleTenantIsolationIntegrationTest {

    private static final String PLATFORM_USERNAME = "isolation_system_admin";
    private static final String PLATFORM_PASSWORD =
            "isolation-system-admin-password";
    private static final UUID PLATFORM_ADMIN_ID =
            UUID.fromString("91000000-0000-0000-0000-000000000001");
    private static final UUID PLATFORM_ID =
            UUID.fromString("91000000-0000-0000-0000-000000000010");
    private static final UUID SHOP_A_ID =
            UUID.fromString("91000000-0000-0000-0000-000000000011");
    private static final UUID SHOP_B_ID =
            UUID.fromString("91000000-0000-0000-0000-000000000012");
    private static PostgreSQLContainer<?> postgres;
    private static ConfigurableApplicationContext context;
    private static MockMvc mockMvc;
    private static String jdbcUrl;
    private static String databaseUsername;
    private static String databasePassword;
    private static String platformToken;
    private static TenantFixture tenantA;
    private static TenantFixture tenantB;

    @BeforeAll
    @SuppressWarnings("resource")
    static void start() throws Exception {
        postgres = new PostgreSQLContainer<>("postgres:16-alpine")
                .withDatabaseName("erp_tenant_isolation_test")
                .withUsername("erp_test")
                .withPassword("erp_test");
        postgres.start();
        jdbcUrl = postgres.getJdbcUrl();
        databaseUsername = postgres.getUsername();
        databasePassword = postgres.getPassword();

        Flyway flyway = Flyway.configure()
                .dataSource(jdbcUrl, databaseUsername, databasePassword)
                .locations("classpath:db/migration")
                .cleanDisabled(false)
                .load();
        flyway.clean();
        flyway.migrate();
        seedPlatformAdmin();

        StandardEnvironment environment = new StandardEnvironment();
        environment.getPropertySources().addFirst(new MapPropertySource(
                "cross-module-tenant-isolation-test",
                Map.ofEntries(
                        Map.entry("server.port", "0"),
                        Map.entry("ERP_DB_URL", jdbcUrl),
                        Map.entry("ERP_DB_USER", databaseUsername),
                        Map.entry("ERP_DB_PASSWORD", databasePassword),
                        Map.entry(
                                "erp.security.login-throttle.max-failures",
                                "20"))));
        environment.setActiveProfiles("production");
        context = new SpringApplicationBuilder(ErpApplication.class)
                .web(WebApplicationType.SERVLET)
                .environment(environment)
                .run();
        mockMvc = MockMvcBuilders
                .webAppContextSetup((WebApplicationContext) context)
                .addFilters(context.getBean(
                        "springSecurityFilterChain",
                        Filter.class))
                .build();

        platformToken = platformLogin();
        ProvisionedTenant provisionedA = provisionTenant(
                "isolation_tenant_a",
                "Isolation Tenant A",
                "isolation_admin_a",
                "Isolation Admin A",
                "tenant-admin-a-password");
        ProvisionedTenant provisionedB = provisionTenant(
                "isolation_tenant_b",
                "Isolation Tenant B",
                "isolation_admin_b",
                "Isolation Admin B",
                "tenant-admin-b-password");
        insertShopFixtures(provisionedA.id(), provisionedB.id());

        TenantResources resourcesA = createResources(
                provisionedA.id(),
                provisionedA.token(),
                SHOP_A_ID,
                "Tenant A");
        TenantResources resourcesB = createResources(
                provisionedB.id(),
                provisionedB.token(),
                SHOP_B_ID,
                "Tenant B");
        tenantA = new TenantFixture(
                provisionedA.id(),
                provisionedA.code(),
                provisionedA.token(),
                provisionedA.userId(),
                SHOP_A_ID,
                resourcesA);
        tenantB = new TenantFixture(
                provisionedB.id(),
                provisionedB.code(),
                provisionedB.token(),
                provisionedB.userId(),
                SHOP_B_ID,
                resourcesB);
    }

    @AfterAll
    static void stop() {
        if (context != null) {
            context.close();
        }
        if (postgres != null) {
            postgres.stop();
        }
    }

    @Test
    @Order(1)
    void runsOnlyAgainstAnEphemeralPostgresql16Container()
            throws Exception {
        assertThat(postgres.isRunning()).isTrue();
        assertThat(postgres.getDockerImageName()).isEqualTo("postgres:16-alpine");
        assertThat(singleString("SHOW server_version")).startsWith("16.");
        assertThat(jdbcUrl).startsWith("jdbc:postgresql:");
    }

    @Test
    @Order(2)
    void platformSessionCannotCallTenantBusinessApis()
            throws Exception {
        assertSafeForbidden(get("/api/v1/product-center/spus")
                .header("Authorization", bearer(platformToken)));
        assertSafeForbidden(get("/api/v1/order-center/orders")
                .header("Authorization", bearer(platformToken)));
        assertSafeForbidden(get("/api/v1/warehouse-center/warehouses")
                .header("Authorization", bearer(platformToken)));
        assertSafeForbidden(get("/api/v1/suppliers")
                .header("Authorization", bearer(platformToken)));
        assertSafeForbidden(get(
                        "/api/v1/suppliers/{supplierId}/sku-mappings",
                        tenantA.resources().supplierId())
                .header("Authorization", bearer(platformToken)));

        mockMvc.perform(get("/api/v1/platform-admin/auth/me")
                        .header("Authorization", bearer(platformToken)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.admin.id")
                        .value(PLATFORM_ADMIN_ID.toString()))
                .andExpect(jsonPath("$.tenant").doesNotExist());
    }

    @Test
    @Order(3)
    void sameBusinessIdentifiersCoexistAndPagesCountOnlyCurrentTenant()
            throws Exception {
        assertThat(singleLong("""
                SELECT count(*)
                FROM tenant_product_spus
                WHERE business_code = 'SHARED_PRODUCT'
                """)).isEqualTo(2);
        assertThat(singleLong("""
                SELECT count(*)
                FROM tenant_product_skus
                WHERE business_code = 'SHARED_SKU'
                """)).isEqualTo(2);
        assertThat(singleLong("""
                SELECT count(*)
                FROM tenant_orders
                WHERE external_order_ref = 'SHARED-ORDER-REF'
                  AND idempotency_key = 'shared-order-idem'
                """)).isEqualTo(2);
        assertThat(singleLong("""
                SELECT count(*)
                FROM tenant_warehouses
                WHERE business_code = 'SHARED_WAREHOUSE'
                """)).isEqualTo(2);
        assertThat(singleLong("""
                SELECT count(*)
                FROM tenant_warehouse_locations
                WHERE business_code = 'SHARED_LOCATION'
                """)).isEqualTo(2);
        assertThat(singleLong("""
                SELECT count(*)
                FROM tenant_suppliers
                WHERE business_code = 'SHARED_SUPPLIER'
                """)).isEqualTo(2);
        assertThat(singleLong("""
                SELECT count(*)
                FROM tenant_supplier_sku_mappings
                WHERE supplier_sku_code = 'SHARED_SUPPLIER_SKU'
                """)).isEqualTo(2);
        assertThat(singleLong("""
                SELECT count(*)
                FROM tenant_shops
                WHERE external_shop_ref = 'shared-shop-ref'
                """)).isEqualTo(2);

        assertPageContainsOnly(
                tenantA.token(),
                "/api/v1/product-center/spus?size=1",
                tenantA.resources().spuId(),
                tenantB.privateMarkers());
        assertPageContainsOnly(
                tenantB.token(),
                "/api/v1/product-center/spus?size=1",
                tenantB.resources().spuId(),
                tenantA.privateMarkers());
        assertPageContainsOnly(
                tenantA.token(),
                "/api/v1/product-center/skus?size=1",
                tenantA.resources().skuId(),
                2,
                tenantB.privateMarkers());
        assertPageContainsOnly(
                tenantB.token(),
                "/api/v1/product-center/skus?size=1",
                tenantB.resources().skuId(),
                2,
                tenantA.privateMarkers());
        assertPageContainsOnly(
                tenantA.token(),
                "/api/v1/order-center/orders?size=1",
                tenantA.resources().orderId(),
                tenantB.privateMarkers());
        assertPageContainsOnly(
                tenantB.token(),
                "/api/v1/order-center/orders?size=1",
                tenantB.resources().orderId(),
                tenantA.privateMarkers());
        assertPageContainsOnly(
                tenantA.token(),
                "/api/v1/warehouse-center/warehouses?size=1",
                tenantA.resources().warehouseId(),
                tenantB.privateMarkers());
        assertPageContainsOnly(
                tenantB.token(),
                "/api/v1/warehouse-center/warehouses?size=1",
                tenantB.resources().warehouseId(),
                tenantA.privateMarkers());
        assertPageContainsOnly(
                tenantA.token(),
                "/api/v1/warehouse-center/warehouses/"
                        + tenantA.resources().warehouseId()
                        + "/locations?size=1",
                tenantA.resources().locationId(),
                tenantB.privateMarkers());
        assertPageContainsOnly(
                tenantB.token(),
                "/api/v1/warehouse-center/warehouses/"
                        + tenantB.resources().warehouseId()
                        + "/locations?size=1",
                tenantB.resources().locationId(),
                tenantA.privateMarkers());
        assertPageContainsOnly(
                tenantA.token(),
                "/api/v1/suppliers?size=1",
                tenantA.resources().supplierId(),
                2,
                tenantB.privateMarkers());
        assertPageContainsOnly(
                tenantB.token(),
                "/api/v1/suppliers?size=1",
                tenantB.resources().supplierId(),
                2,
                tenantA.privateMarkers());
        assertMappingPageContainsOnly(
                tenantA.token(),
                mappingCollection(tenantA.resources().supplierId())
                        + "?page=0&size=1",
                tenantA.resources().mappingId(),
                2,
                tenantB.privateMarkers());
        assertMappingPageContainsOnly(
                tenantB.token(),
                mappingCollection(tenantB.resources().supplierId())
                        + "?page=0&size=1",
                tenantB.resources().mappingId(),
                2,
                tenantA.privateMarkers());
        assertMappingPageContainsOnly(
                tenantA.token(),
                mappingCollection(tenantA.resources().supplierId())
                        + "?status=ACTIVE&query=shared_supplier_sku"
                        + "&page=0&size=1",
                tenantA.resources().mappingId(),
                1,
                tenantB.privateMarkers());
        assertMappingPageContainsOnly(
                tenantA.token(),
                mappingCollection(tenantA.resources().supplierId())
                        + "?status=INACTIVE"
                        + "&query=shared_supplier_sku_inactive"
                        + "&page=0&size=1",
                tenantA.resources().inactiveMappingId(),
                1,
                tenantB.privateMarkers());
        assertMappingPageContainsOnly(
                tenantA.token(),
                mappingCollection(tenantA.resources().secondarySupplierId())
                        + "?status=INACTIVE&page=0&size=1",
                tenantA.resources().secondaryMappingId(),
                1,
                tenantB.privateMarkers());
    }

    @Test
    @Order(4)
    void tenantAdminCannotReadOrMutateAnotherTenantsResources()
            throws Exception {
        String token = tenantA.token();
        TenantResources foreign = tenantB.resources();
        String[] forbidden = tenantB.privateMarkers();

        assertSafeNotFound(get("/api/v1/product-center/spus/{spuId}",
                        foreign.spuId())
                .header("Authorization", bearer(token)), forbidden);
        assertSafeNotFound(put("/api/v1/product-center/spus/{spuId}",
                        foreign.spuId())
                .header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"version":0,"name":"Cross tenant product",
                         "brandName":null,"productNote":null,
                         "status":"ACTIVE"}
                        """), forbidden);
        assertSafeNotFound(post(
                        "/api/v1/product-center/spus/{spuId}/archive",
                        foreign.spuId())
                .header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"version\":0}"), forbidden);

        assertSafeNotFound(get("/api/v1/product-center/skus/{skuId}",
                        foreign.skuId())
                .header("Authorization", bearer(token)), forbidden);
        assertSafeNotFound(put("/api/v1/product-center/skus/{skuId}",
                        foreign.skuId())
                .header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"version":0,"name":"Cross tenant SKU",
                         "variantSummary":null,"status":"ACTIVE"}
                        """), forbidden);
        assertSafeNotFound(post(
                        "/api/v1/product-center/skus/{skuId}/archive",
                        foreign.skuId())
                .header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"version\":0}"), forbidden);

        assertSafeNotFound(get("/api/v1/order-center/orders/{orderId}",
                        foreign.orderId())
                .header("Authorization", bearer(token)), forbidden);
        assertSafeNotFound(put(
                        "/api/v1/order-center/orders/{orderId}/status",
                        foreign.orderId())
                .header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"version":0,"targetStatus":"REVIEW_PENDING",
                         "reason":"cross tenant mutation"}
                        """), forbidden);
        assertSafeNotFound(get("/api/v1/order-center/orders")
                .header("Authorization", bearer(token))
                .queryParam("shopId", tenantB.shopId().toString()), forbidden);

        assertSafeNotFound(get(
                        "/api/v1/warehouse-center/warehouses/{warehouseId}",
                        foreign.warehouseId())
                .header("Authorization", bearer(token)), forbidden);
        assertSafeNotFound(put(
                        "/api/v1/warehouse-center/warehouses/{warehouseId}",
                        foreign.warehouseId())
                .header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"version":0,"name":"Cross tenant warehouse",
                         "status":"ACTIVE"}
                        """), forbidden);
        assertSafeNotFound(post(
                        "/api/v1/warehouse-center/warehouses/{warehouseId}/archive",
                        foreign.warehouseId())
                .header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"version\":0}"), forbidden);
        assertSafeNotFound(get(
                        "/api/v1/warehouse-center/warehouses/{warehouseId}/locations",
                        foreign.warehouseId())
                .header("Authorization", bearer(token)), forbidden);
        assertSafeNotFound(get(
                        "/api/v1/warehouse-center/warehouses/{warehouseId}"
                                + "/locations/{locationId}",
                        foreign.warehouseId(),
                        foreign.locationId())
                .header("Authorization", bearer(token)), forbidden);
        assertSafeNotFound(put(
                        "/api/v1/warehouse-center/warehouses/{warehouseId}"
                                + "/locations/{locationId}",
                        foreign.warehouseId(),
                        foreign.locationId())
                .header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"version":0,"name":"Cross tenant location",
                         "status":"ACTIVE"}
                        """), forbidden);
        assertSafeNotFound(post(
                        "/api/v1/warehouse-center/warehouses/{warehouseId}"
                                + "/locations/{locationId}/archive",
                        foreign.warehouseId(),
                        foreign.locationId())
                .header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"version\":0}"), forbidden);

        assertSafeNotFound(get("/api/v1/suppliers/{supplierId}",
                        foreign.supplierId())
                .header("Authorization", bearer(token)), forbidden);
        assertSafeNotFound(get(mappingCollection(foreign.supplierId()))
                .header("Authorization", bearer(token))
                .header("X-Request-Id", "cross-v39-list"), forbidden);
    }

    @Test
    @Order(5)
    void platformTenantSessionsAreTenantBoundAndOldTokensAreRevoked()
            throws Exception {
        String tenantSessionA = enterTenant(tenantA.id());
        MvcResult tenantSessionMe = mockMvc.perform(get("/api/v1/auth/me")
                        .header("Authorization", bearer(tenantSessionA)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tenant.id")
                        .value(tenantA.id().toString()))
                .andExpect(jsonPath("$.platformAdmin.id")
                        .value(PLATFORM_ADMIN_ID.toString()))
                .andExpect(jsonPath("$.permissions")
                        .value(org.hamcrest.Matchers.hasItems(
                                "products.read",
                                "products.write",
                                "orders.read",
                                "orders.write",
                                "warehouses.read",
                                "warehouses.write",
                                "suppliers.read",
                                "suppliers.write")))
                .andReturn();
        List<String> expectedPermissions = new java.util.ArrayList<>(
                singleStrings("""
                        SELECT code
                        FROM permissions
                        ORDER BY code
                        """));
        expectedPermissions.add("PLATFORM_ADMIN_TENANT_SESSION");
        assertThat(JsonPath.<List<String>>read(
                        tenantSessionMe.getResponse().getContentAsString(),
                        "$.permissions"))
                .containsExactlyInAnyOrderElementsOf(expectedPermissions);

        assertBusinessResourcesReadable(tenantSessionA, tenantA.resources());
        assertMappingPageContainsOnly(
                tenantSessionA,
                mappingCollection(tenantA.resources().supplierId())
                        + "?page=0&size=1",
                tenantA.resources().mappingId(),
                2,
                tenantB.privateMarkers());
        assertPlatformTenantSessionCanWriteCurrentBusinessModules(
                tenantSessionA);
        assertSafeNotFound(get("/api/v1/product-center/spus/{spuId}",
                        tenantB.resources().spuId())
                .header("Authorization", bearer(tenantSessionA)),
                tenantB.privateMarkers());
        assertSafeNotFound(put(
                        "/api/v1/order-center/orders/{orderId}/status",
                        tenantB.resources().orderId())
                .header("Authorization", bearer(tenantSessionA))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"version":0,"targetStatus":"REVIEW_PENDING",
                         "reason":"platform tenant isolation"}
                        """), tenantB.privateMarkers());
        assertSafeNotFound(post(
                        "/api/v1/warehouse-center/warehouses/{warehouseId}"
                                + "/locations/{locationId}/archive",
                        tenantB.resources().warehouseId(),
                        tenantB.resources().locationId())
                .header("Authorization", bearer(tenantSessionA))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"version\":0}"), tenantB.privateMarkers());
        assertSafeNotFound(get(mappingCollection(
                        tenantB.resources().supplierId()))
                .header("Authorization", bearer(tenantSessionA)),
                tenantB.privateMarkers());

        mockMvc.perform(delete("/api/v1/platform-admin/tenant-session")
                        .header("Authorization", bearer(tenantSessionA)))
                .andExpect(status().isNoContent());
        assertUnauthorizedTenantToken(tenantSessionA);

        String tenantSessionB = enterTenant(tenantB.id());
        assertBusinessResourcesReadable(tenantSessionB, tenantB.resources());
        assertSafeNotFound(get("/api/v1/suppliers/{supplierId}",
                        tenantA.resources().supplierId())
                .header("Authorization", bearer(tenantSessionB)),
                tenantA.privateMarkers());
        assertUnauthorizedTenantToken(tenantSessionA);

        mockMvc.perform(delete("/api/v1/platform-admin/tenant-session")
                        .header("Authorization", bearer(tenantSessionB)))
                .andExpect(status().isNoContent());
        assertUnauthorizedTenantToken(tenantSessionB);
        mockMvc.perform(get("/api/v1/platform-admin/auth/me")
                        .header("Authorization", bearer(platformToken)))
                .andExpect(status().isOk());
    }

    @Test
    @Order(9)
    void committedAuditCoverageIsCompleteAtomicTenantBoundAndRedacted()
            throws Exception {
        String token = tenantA.token();
        UUID tenantId = tenantA.id();
        UUID userId = tenantA.userId();
        String secretReference =
                "vault://audit-gate/credential/secret-marker";
        String secretError =
                "token=plain-audit-secret password=plain-audit-password";

        MvcResult platformResult = mockMvc.perform(post(
                                "/api/v1/platform-center/platforms")
                        .header("Authorization", bearer(token))
                        .header("X-Request-Id", "audit-platform-create")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"code":"AUDIT_GATE",
                                 "displayName":"Audit Gate",
                                 "description":"isolated test catalog"}
                                """))
                .andExpect(status().isCreated())
                .andReturn();
        UUID auditPlatformId = responseId(platformResult);
        assertCommittedAudit(
                "audit-platform-create", tenantId, userId, null,
                "platform.created", "platform", auditPlatformId, true);
        MvcResult shopResult = mockMvc.perform(post(
                                "/api/v1/platform-center/shops")
                        .header("Authorization", bearer(token))
                        .header("X-Request-Id", "audit-shop-create")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"platformId":"%s",
                                 "externalShopRef":"audit-gate-shop"}
                                """.formatted(UUID.fromString(singleString("""
                                        SELECT id::text
                                        FROM platform_catalog
                                        WHERE code = 'SHOPIFY'
                                        """)))))
                .andExpect(status().isCreated())
                .andReturn();
        UUID auditShopId = responseId(shopResult);
        assertCommittedAudit(
                "audit-shop-create", tenantId, userId, null,
                "shop.created", "shop", auditShopId, true);

        MvcResult authorizationResult = mockMvc.perform(put(
                                "/api/v1/platform-center/shops/{shopId}/authorization",
                                auditShopId)
                        .header("Authorization", bearer(token))
                        .header("X-Request-Id", "audit-authorization-update")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"status":"AUTHORIZED",
                                 "credentialReference":"%s",
                                 "providerAccountRef":"safe-provider-account",
                                 "scopes":["orders.read"],
                                 "authorizedAt":"2026-07-01T00:00:00Z",
                                 "expiresAt":"2027-07-01T00:00:00Z",
                                 "lastVerifiedAt":"2026-07-01T00:00:00Z",
                                 "errorSummary":"%s"}
                                """.formatted(
                                    secretReference,
                                    secretError)))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(authorizationResult.getResponse().getContentAsString())
                .doesNotContain(secretReference)
                .doesNotContain("plain-audit-password");
        UUID authorizationId = UUID.fromString(singleString("""
                SELECT id::text
                FROM shop_authorizations
                WHERE tenant_id = ? AND shop_id = ?
                """, tenantId, auditShopId));
        assertCommittedAudit(
                "audit-authorization-update", tenantId, userId, null,
                "shop_authorization.updated", "shop_authorization",
                authorizationId, true);

        MvcResult syncResult = mockMvc.perform(post(
                                "/api/v1/platform-center/shops/{shopId}/sync-jobs",
                                auditShopId)
                        .header("Authorization", bearer(token))
                        .header("X-Request-Id", "audit-sync-create")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"jobType\":\"ORDERS\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        UUID syncId = responseId(syncResult);
        assertCommittedAudit(
                "audit-sync-create", tenantId, userId, null,
                "shop_sync_job.created", "shop_sync_job", syncId, true);
        mockMvc.perform(put(
                                "/api/v1/platform-center/shops/{shopId}"
                                        + "/sync-jobs/{syncJobId}/status",
                                auditShopId,
                                syncId)
                        .header("Authorization", bearer(token))
                        .header("X-Request-Id", "audit-sync-status")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"status":"CANCELLED",
                                 "progressProcessed":0,
                                 "progressTotal":null,
                                 "errorCode":null,
                                 "errorSummary":null}
                                """))
                .andExpect(status().isOk());
        assertCommittedAudit(
                "audit-sync-status", tenantId, userId, null,
                "shop_sync_job.status_changed", "shop_sync_job",
                syncId, true);

        MvcResult spuResult = mockMvc.perform(post(
                                "/api/v1/product-center/spus")
                        .header("Authorization", bearer(token))
                        .header("X-Request-Id", "audit-spu-create")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"businessCode":"AUDIT_GATE_SPU",
                                 "name":"Audit Gate SPU",
                                 "brandName":"Audit Brand",
                                 "productNote":"safe description"}
                                """))
                .andExpect(status().isCreated())
                .andReturn();
        UUID spuId = responseId(spuResult);
        assertCommittedAudit(
                "audit-spu-create", tenantId, userId, null,
                "product_spu.created", "product_spu", spuId, true);
        mockMvc.perform(put("/api/v1/product-center/spus/{spuId}", spuId)
                        .header("Authorization", bearer(token))
                        .header("X-Request-Id", "audit-spu-update")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"version":0,"name":"Audit Gate SPU Updated",
                                 "brandName":"Audit Brand",
                                 "productNote":"safe update",
                                 "status":"ACTIVE"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(1));
        assertCommittedAudit(
                "audit-spu-update", tenantId, userId, null,
                "product_spu.updated", "product_spu", spuId, true);

        MvcResult skuResult = mockMvc.perform(post(
                                "/api/v1/product-center/spus/{spuId}/skus",
                                spuId)
                        .header("Authorization", bearer(token))
                        .header("X-Request-Id", "audit-sku-create")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"businessCode":"AUDIT_GATE_SKU",
                                 "name":"Audit Gate SKU",
                                 "variantSummary":"safe variant"}
                                """))
                .andExpect(status().isCreated())
                .andReturn();
        UUID skuId = responseId(skuResult);
        assertCommittedAudit(
                "audit-sku-create", tenantId, userId, null,
                "product_sku.created", "product_sku", skuId, true);
        mockMvc.perform(put("/api/v1/product-center/skus/{skuId}", skuId)
                        .header("Authorization", bearer(token))
                        .header("X-Request-Id", "audit-sku-update")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"version":0,"name":"Audit Gate SKU Updated",
                                 "variantSummary":"safe update",
                                 "status":"ACTIVE"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(1));
        assertCommittedAudit(
                "audit-sku-update", tenantId, userId, null,
                "product_sku.updated", "product_sku", skuId, true);

        MvcResult listingResult = mockMvc.perform(post(
                                "/api/v1/product-center/listings")
                        .header("Authorization", bearer(token))
                        .header("X-Request-Id", "audit-listing-create")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"shopId":"%s","skuId":"%s",
                                 "externalListingRef":"audit-listing",
                                 "externalVariantRef":"audit-variant",
                                 "externalStatus":"ACTIVE",
                                 "metadataNote":"safe note"}
                                """.formatted(auditShopId, skuId)))
                .andExpect(status().isCreated())
                .andReturn();
        UUID listingId = responseId(listingResult);
        assertCommittedAudit(
                "audit-listing-create", tenantId, userId, null,
                "product_listing.created", "product_listing",
                listingId, true);
        mockMvc.perform(put(
                                "/api/v1/product-center/listings/{listingId}",
                                listingId)
                        .header("Authorization", bearer(token))
                        .header("X-Request-Id", "audit-listing-update")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"version":0,"externalStatus":"PAUSED",
                                 "metadataNote":"safe update",
                                 "status":"INACTIVE"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(1));
        assertCommittedAudit(
                "audit-listing-update", tenantId, userId, null,
                "product_listing.updated", "product_listing",
                listingId, true);
        mockMvc.perform(post(
                                "/api/v1/product-center/listings/{listingId}/archive",
                                listingId)
                        .header("Authorization", bearer(token))
                        .header("X-Request-Id", "audit-listing-archive")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"version\":1}"))
                .andExpect(status().isOk());
        assertCommittedAudit(
                "audit-listing-archive", tenantId, userId, null,
                "product_listing.archived", "product_listing",
                listingId, true);
        mockMvc.perform(post(
                                "/api/v1/product-center/skus/{skuId}/archive",
                                skuId)
                        .header("Authorization", bearer(token))
                        .header("X-Request-Id", "audit-sku-archive")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"version\":1}"))
                .andExpect(status().isOk());
        assertCommittedAudit(
                "audit-sku-archive", tenantId, userId, null,
                "product_sku.archived", "product_sku", skuId, true);
        mockMvc.perform(post(
                                "/api/v1/product-center/spus/{spuId}/archive",
                                spuId)
                        .header("Authorization", bearer(token))
                        .header("X-Request-Id", "audit-spu-archive")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"version\":1}"))
                .andExpect(status().isOk());
        assertCommittedAudit(
                "audit-spu-archive", tenantId, userId, null,
                "product_spu.archived", "product_spu", spuId, true);

        MvcResult warehouseResult = mockMvc.perform(post(
                                "/api/v1/warehouse-center/warehouses")
                        .header("Authorization", bearer(token))
                        .header("X-Request-Id", "audit-warehouse-create")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"businessCode":"AUDIT_GATE_WAREHOUSE",
                                 "name":"Audit Gate Warehouse"}
                                """))
                .andExpect(status().isCreated())
                .andReturn();
        UUID warehouseId = responseId(warehouseResult);
        assertCommittedAudit(
                "audit-warehouse-create", tenantId, userId, null,
                "warehouse.created", "warehouse", warehouseId, true);
        mockMvc.perform(put(
                                "/api/v1/warehouse-center/warehouses/{warehouseId}",
                                warehouseId)
                        .header("Authorization", bearer(token))
                        .header("X-Request-Id", "audit-warehouse-update")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"version":0,
                                 "name":"Audit Gate Warehouse Updated",
                                 "status":"ACTIVE"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(1));
        assertCommittedAudit(
                "audit-warehouse-update", tenantId, userId, null,
                "warehouse.updated", "warehouse", warehouseId, true);

        MvcResult locationResult = mockMvc.perform(post(
                                "/api/v1/warehouse-center/warehouses/{warehouseId}/locations",
                                warehouseId)
                        .header("Authorization", bearer(token))
                        .header("X-Request-Id", "audit-location-create")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"businessCode":"AUDIT_GATE_LOCATION",
                                 "name":"Audit Gate Location"}
                                """))
                .andExpect(status().isCreated())
                .andReturn();
        UUID locationId = responseId(locationResult);
        assertCommittedAudit(
                "audit-location-create", tenantId, userId, null,
                "warehouse_location.created", "warehouse_location",
                locationId, true);
        mockMvc.perform(put(
                                "/api/v1/warehouse-center/warehouses/{warehouseId}"
                                        + "/locations/{locationId}",
                                warehouseId,
                                locationId)
                        .header("Authorization", bearer(token))
                        .header("X-Request-Id", "audit-location-update")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"version":0,
                                 "name":"Audit Gate Location Updated",
                                 "status":"ACTIVE"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(1));
        assertCommittedAudit(
                "audit-location-update", tenantId, userId, null,
                "warehouse_location.updated", "warehouse_location",
                locationId, true);
        mockMvc.perform(post(
                                "/api/v1/warehouse-center/warehouses/{warehouseId}"
                                        + "/locations/{locationId}/archive",
                                warehouseId,
                                locationId)
                        .header("Authorization", bearer(token))
                        .header("X-Request-Id", "audit-location-archive")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"version\":1}"))
                .andExpect(status().isOk());
        assertCommittedAudit(
                "audit-location-archive", tenantId, userId, null,
                "warehouse_location.archived", "warehouse_location",
                locationId, true);
        mockMvc.perform(post(
                                "/api/v1/warehouse-center/warehouses/{warehouseId}/archive",
                                warehouseId)
                        .header("Authorization", bearer(token))
                        .header("X-Request-Id", "audit-warehouse-archive")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"version\":1}"))
                .andExpect(status().isOk());
        assertCommittedAudit(
                "audit-warehouse-archive", tenantId, userId, null,
                "warehouse.archived", "warehouse", warehouseId, true);

        mockMvc.perform(put(
                                "/api/v1/platform-center/shops/{shopId}/authorization",
                                auditShopId)
                        .header("Authorization", bearer(token))
                        .header("X-Request-Id", "audit-authorization-revoke")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"REVOKED\"}"))
                .andExpect(status().isOk());
        assertCommittedAudit(
                "audit-authorization-revoke", tenantId, userId, null,
                "shop_authorization.updated", "shop_authorization",
                authorizationId, true);
        mockMvc.perform(post(
                                "/api/v1/platform-center/shops/{shopId}/archive",
                                auditShopId)
                        .header("Authorization", bearer(token))
                        .header("X-Request-Id", "audit-shop-archive"))
                .andExpect(status().isOk());
        assertCommittedAudit(
                "audit-shop-archive", tenantId, userId, null,
                "shop.archived", "shop", auditShopId, true);
        mockMvc.perform(post(
                                "/api/v1/platform-center/platforms/{platformId}/archive",
                                auditPlatformId)
                        .header("Authorization", bearer(token))
                        .header("X-Request-Id", "audit-platform-archive"))
                .andExpect(status().isOk());
        assertCommittedAudit(
                "audit-platform-archive", tenantId, userId, null,
                "platform.archived", "platform", auditPlatformId, true);

        assertThat(singleLong("""
                SELECT count(*)
                FROM audit_logs
                WHERE request_id LIKE 'audit-%'
                  AND details::text LIKE ?
                """, "%" + secretReference + "%")).isZero();
        assertThat(singleLong("""
                SELECT count(*)
                FROM audit_logs
                WHERE request_id LIKE 'audit-%'
                  AND (details::text ILIKE '%plain-audit-secret%'
                       OR details::text ILIKE '%plain-audit-password%')
                """)).isZero();

        exerciseOrderActorAudit(
                tenantA.token(),
                "audit-order-user",
                tenantA.userId(),
                null);
        String systemTenantToken = enterTenant(tenantA.id());
        exerciseOrderActorAudit(
                systemTenantToken,
                "audit-order-system",
                null,
                PLATFORM_ADMIN_ID);
        assertThat(singleLong("""
                SELECT count(*)
                FROM audit_logs
                WHERE request_id LIKE 'audit-order-system-%'
                  AND action = 'platform_admin.tenant_write_attempted'
                """)).isEqualTo(3);

        mockMvc.perform(put(
                                "/api/v1/warehouse-center/warehouses/{warehouseId}",
                                tenantB.resources().warehouseId())
                        .header("Authorization", bearer(token))
                        .header("X-Request-Id", "audit-negative-cross-tenant")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"version":0,"name":"must not persist",
                                 "status":"ACTIVE"}
                                """))
                .andExpect(status().isNotFound());
        assertNoSuccessfulAudit("audit-negative-cross-tenant");

        mockMvc.perform(post("/api/v1/warehouse-center/warehouses")
                        .header("Authorization", bearer(token))
                        .header("X-Request-Id", "audit-negative-validation")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"businessCode\":\"bad code\",\"name\":\"x\"}"))
                .andExpect(status().isBadRequest());
        assertNoSuccessfulAudit("audit-negative-validation");

        mockMvc.perform(post("/api/v1/warehouse-center/warehouses")
                        .header("X-Request-Id", "audit-negative-unauthorized")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"businessCode":"AUDIT_NO_AUTH",
                                 "name":"must not persist"}
                                """))
                .andExpect(status().isUnauthorized());
        assertNoSuccessfulAudit("audit-negative-unauthorized");

        mockMvc.perform(post("/api/v1/warehouse-center/warehouses")
                        .header("Authorization", bearer(platformToken))
                        .header("X-Request-Id", "audit-negative-forbidden")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"businessCode":"AUDIT_FORBIDDEN",
                                 "name":"must not persist"}
                                """))
                .andExpect(status().isForbidden());
        assertNoSuccessfulAudit("audit-negative-forbidden");

        mockMvc.perform(post("/api/v1/warehouse-center/warehouses")
                        .header("Authorization", bearer(token))
                        .header("X-Request-Id", "audit-negative-conflict")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"businessCode":"AUDIT_GATE_WAREHOUSE",
                                 "name":"duplicate must fail"}
                                """))
                .andExpect(status().isConflict());
        assertNoSuccessfulAudit("audit-negative-conflict");

        executeUpdate("""
                CREATE FUNCTION reject_audit_gate_insert()
                RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                  RAISE EXCEPTION 'forced audit rollback';
                END;
                $$
                """);
        executeUpdate("""
                CREATE TRIGGER reject_audit_gate_insert
                BEFORE INSERT ON audit_logs
                FOR EACH ROW
                WHEN (NEW.request_id = 'audit-negative-rollback')
                EXECUTE FUNCTION reject_audit_gate_insert()
                """);
        LogCapture rollbackLogs = LogCapture.start();
        try {
            MvcResult rollback = mockMvc.perform(post(
                                    "/api/v1/warehouse-center/warehouses")
                            .header("Authorization", bearer(token))
                            .header("X-Request-Id", "audit-negative-rollback")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"businessCode":"AUDIT_ROLLBACK_WAREHOUSE",
                                     "name":"rollback secret marker"}
                                    """))
                    .andExpect(status().isInternalServerError())
                    .andReturn();
            assertAuditRollbackExceptionChain(rollback);
            assertThat(rollback.getResponse().getContentAsString())
                    .doesNotContain("forced audit rollback")
                    .doesNotContain("rollback secret marker");
            assertThat(singleLong("""
                    SELECT count(*)
                    FROM tenant_warehouses
                    WHERE tenant_id = ?
                      AND business_code = 'AUDIT_ROLLBACK_WAREHOUSE'
                    """, tenantId)).isZero();
            assertNoSuccessfulAudit("audit-negative-rollback");
        } finally {
            rollbackLogs.close();
            executeUpdate("DROP TRIGGER reject_audit_gate_insert ON audit_logs");
            executeUpdate("DROP FUNCTION reject_audit_gate_insert()");
        }
        assertOnlyFixedUnexpectedErrorWasLogged(
                rollbackLogs,
                "Unexpected business API error",
                tenantId.toString(),
                token,
                "AUDIT_ROLLBACK_WAREHOUSE",
                "rollback secret marker",
                "forced audit rollback",
                "reject_audit_gate_insert",
                "audit_logs");
    }

    @Test
    @Order(10)
    void nonDatabaseUnknownFailureKeepsFixedProductionErrorSignal()
            throws Exception {
        String canary = "non-database-unknown-failure-canary";
        ApiExceptionHandler handler =
                context.getBean(ApiExceptionHandler.class);
        Method method = ApiExceptionHandler.class.getDeclaredMethod(
                "handleUnexpected",
                Exception.class);
        method.setAccessible(true);

        ResponseEntity<?> response;
        LogCapture logs = LogCapture.start();
        try {
            response = (ResponseEntity<?>) method.invoke(
                    handler,
                    new IllegalStateException(canary));
        } finally {
            logs.close();
        }

        assertThat(response.getStatusCode())
                .isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
        assertThat(response.getHeaders().getContentType())
                .isEqualTo(MediaType.APPLICATION_JSON);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().toString())
                .contains(
                        "code=internal_error",
                        "message=An internal error occurred")
                .doesNotContain(canary);
        assertOnlyFixedUnexpectedErrorWasLogged(
                logs,
                "Unexpected business API error",
                canary);
    }

    private static void assertOnlyFixedUnexpectedErrorWasLogged(
            LogCapture logs,
            String fixedMessage,
            String... forbiddenValues) {
        assertThat(logs.events()).hasSize(1);
        var event = logs.events().getFirst();
        assertThat(event.getLevel().toString()).isEqualTo("ERROR");
        assertThat(event.getLoggerName())
                .isEqualTo(ApiExceptionHandler.class.getName());
        assertThat(event.getFormattedMessage()).isEqualTo(fixedMessage);
        assertThat(event.getThrowableProxy()).isNull();
        assertThat(logs.events())
                .noneMatch(candidate -> candidate.getLoggerName().equals(
                        "org.hibernate.orm.jdbc.error"));

        assertThat(logs.rendered())
                .doesNotContainIgnoringCase(
                        "HHH000247",
                        "SQLState",
                        "Detail:",
                        "Where:",
                        "constraint",
                        "trigger",
                        "function",
                        "tenant_id",
                        "business_code",
                        "jdbc:postgresql:",
                        "password",
                        "token",
                        "select ",
                        "insert ",
                        "update ",
                        "delete from",
                        "PSQLException",
                        "JDBCException",
                        "DataIntegrityViolationException")
                .doesNotContain(forbiddenValues);
    }

    private static void assertAuditRollbackExceptionChain(
            MvcResult rollback) {
        assertThat(rollback.getResolvedException()).isNotNull();
        List<String> causeTypes = java.util.stream.Stream.iterate(
                        rollback.getResolvedException(),
                        java.util.Objects::nonNull,
                        Throwable::getCause)
                .map(cause -> cause.getClass().getName())
                .toList();
        assertThat(causeTypes).containsExactly(
                "org.hibernate.exception.GenericJDBCException",
                "org.postgresql.util.PSQLException");
    }

    private static void exerciseOrderActorAudit(
            String token,
            String requestPrefix,
            UUID actorUserId,
            UUID actorSystemAdminId) throws Exception {
        MvcResult created = mockMvc.perform(post(
                                "/api/v1/order-center/orders")
                        .header("Authorization", bearer(token))
                        .header("X-Request-Id", requestPrefix + "-create")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"shopId":"%s",
                                 "externalOrderRef":"%s",
                                 "idempotencyKey":"%s",
                                 "currency":"CNY",
                                 "buyerReference":"audit secret buyer",
                                 "placedAt":"2026-07-02T03:04:05Z",
                                 "lines":[{
                                   "skuId":null,
                                   "externalListingRef":null,
                                   "externalVariantRef":null,
                                   "externalLineRef":"%s-line",
                                   "titleSnapshot":"audit secret title",
                                   "quantity":1,
                                   "unitPriceMinor":100,
                                   "currency":"CNY"
                                 }]}
                                """.formatted(
                                    tenantA.shopId(),
                                    requestPrefix,
                                    requestPrefix,
                                    requestPrefix)))
                .andExpect(status().isCreated())
                .andReturn();
        String body = created.getResponse().getContentAsString();
        UUID orderId = UUID.fromString(JsonPath.read(body, "$.id"));
        UUID lineId = UUID.fromString(JsonPath.read(body, "$.lines[0].id"));
        assertCommittedAudit(
                requestPrefix + "-create",
                tenantA.id(),
                actorUserId,
                actorSystemAdminId,
                "order.created",
                "order",
                orderId,
                false);

        mockMvc.perform(put(
                                "/api/v1/order-center/orders/{orderId}"
                                        + "/lines/{lineId}/sku-match",
                                orderId,
                                lineId)
                        .header("Authorization", bearer(token))
                        .header("X-Request-Id", requestPrefix + "-sku")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"version":0,"skuId":"%s"}
                                """.formatted(tenantA.resources().skuId())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(1));
        assertCommittedAudit(
                requestPrefix + "-sku",
                tenantA.id(),
                actorUserId,
                actorSystemAdminId,
                "order.line.sku_matched",
                "order_line",
                lineId,
                false);

        mockMvc.perform(put(
                                "/api/v1/order-center/orders/{orderId}/status",
                                orderId)
                        .header("Authorization", bearer(token))
                        .header("X-Request-Id", requestPrefix + "-status")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"version":1,
                                 "targetStatus":"REVIEW_PENDING",
                                 "reason":null}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(2));
        assertCommittedAudit(
                requestPrefix + "-status",
                tenantA.id(),
                actorUserId,
                actorSystemAdminId,
                "order.status_changed",
                "order",
                orderId,
                false);
        assertThat(singleLong("""
                SELECT count(*)
                FROM audit_logs
                WHERE request_id LIKE ?
                  AND (details::text ILIKE '%order-secret%'
                       OR details::text ILIKE '%audit secret%')
                """, requestPrefix + "-%")).isZero();
    }

    private static void assertCommittedAudit(
            String requestId,
            UUID tenantId,
            UUID actorUserId,
            UUID actorSystemAdminId,
            String action,
            String resourceType,
            UUID resourceId,
            boolean requireVersion) throws Exception {
        assertThat(singleLong("""
                SELECT count(*)
                FROM audit_logs
                WHERE request_id = ?
                  AND tenant_id = ?
                  AND actor_user_id IS NOT DISTINCT FROM ?
                  AND actor_system_admin_id IS NOT DISTINCT FROM ?
                  AND action = ?
                  AND resource_type = ?
                  AND resource_id = ?
                  AND (? = false OR jsonb_exists(details, 'version'))
                """,
                requestId,
                tenantId,
                actorUserId,
                actorSystemAdminId,
                action,
                resourceType,
                resourceId.toString(),
                requireVersion)).isEqualTo(1);
        assertThat(singleLong("""
                SELECT count(*)
                FROM audit_logs
                WHERE request_id = ?
                  AND action <> 'platform_admin.tenant_write_attempted'
                """, requestId)).isEqualTo(1);
    }

    private static void assertNoSuccessfulAudit(String requestId)
            throws Exception {
        assertThat(singleLong("""
                SELECT count(*)
                FROM audit_logs
                WHERE request_id = ?
                  AND action <> 'platform_admin.tenant_write_attempted'
                """, requestId)).isZero();
    }

    private static UUID responseId(MvcResult result) throws Exception {
        return UUID.fromString(JsonPath.read(
                result.getResponse().getContentAsString(),
                "$.id"));
    }

    private static ProvisionedTenant provisionTenant(
            String code,
            String name,
            String adminUsername,
            String adminDisplayName,
            String password) throws Exception {
        String adminEmail = adminUsername + "@example.test";
        MvcResult created = mockMvc.perform(post("/api/v1/platform-admin/tenants")
                        .header("Authorization", bearer(platformToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"code":"%s","name":"%s",
                                 "adminEmail":"%s",
                                 "adminDisplayName":"%s",
                                 "adminInitialPassword":"%s"}
                                 """.formatted(
                                     code,
                                     name,
                                     adminEmail,
                                     adminDisplayName,
                                     password)))
                .andExpect(status().isCreated())
                .andReturn();
        String body = created.getResponse().getContentAsString();
        UUID tenantId = UUID.fromString(JsonPath.read(body, "$.tenant.id"));
        try (Connection connection = DriverManager.getConnection(
                jdbcUrl,
                databaseUsername,
                databasePassword)) {
            BusinessApplicationTestData.enableErpForTenant(
                    connection,
                    tenantId);
        }
        MvcResult login = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"tenantCode":"%s","username":"%s",
                                 "password":"%s"}
                                """.formatted(code, adminEmail, password)))
                .andExpect(status().isOk())
                .andReturn();
        String loginBody = login.getResponse().getContentAsString();
        return new ProvisionedTenant(
                tenantId,
                code,
                JsonPath.read(loginBody, "$.accessToken"),
                UUID.fromString(JsonPath.read(loginBody, "$.user.id")));
    }

    private static TenantResources createResources(
            UUID tenantId,
            String token,
            UUID shopId,
            String tenantLabel) throws Exception {
        UUID spuId = createdId(post("/api/v1/product-center/spus")
                .header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"businessCode":"SHARED_PRODUCT",
                         "name":"%s Private Product",
                         "brandName":"%s Private Brand",
                         "productNote":"%s product audit detail"}
                        """.formatted(tenantLabel, tenantLabel, tenantLabel)));
        UUID skuId = createdId(post(
                        "/api/v1/product-center/spus/{spuId}/skus",
                        spuId)
                .header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"businessCode":"SHARED_SKU",
                         "name":"%s Private SKU",
                         "variantSummary":"%s private variant"}
                        """.formatted(tenantLabel, tenantLabel)));
        UUID inactiveSkuId = createdId(post(
                        "/api/v1/product-center/spus/{spuId}/skus",
                        spuId)
                .header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"businessCode":"SHARED_SKU_INACTIVE",
                         "name":"%s Private Inactive SKU",
                         "variantSummary":"%s inactive private variant"}
                        """.formatted(tenantLabel, tenantLabel)));
        UUID orderId = createdId(post("/api/v1/order-center/orders")
                .header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"shopId":"%s",
                         "externalOrderRef":"SHARED-ORDER-REF",
                         "idempotencyKey":"shared-order-idem",
                         "currency":"CNY",
                         "buyerReference":"%s Private Buyer",
                         "placedAt":"2026-01-02T03:04:05Z",
                         "lines":[{
                           "skuId":"%s",
                           "externalListingRef":"shared-listing-ref",
                           "externalVariantRef":"shared-variant-ref",
                           "externalLineRef":"shared-line-ref",
                           "titleSnapshot":"%s Private Order Line",
                           "quantity":1,
                           "unitPriceMinor":9900,
                           "currency":"CNY"
                         }]}
                        """.formatted(
                            shopId,
                            tenantLabel,
                            skuId,
                            tenantLabel)));
        UUID warehouseId = createdId(post(
                        "/api/v1/warehouse-center/warehouses")
                .header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"businessCode":"SHARED_WAREHOUSE",
                         "name":"%s Private Warehouse"}
                        """.formatted(tenantLabel)));
        UUID locationId = createdId(post(
                        "/api/v1/warehouse-center/warehouses/{warehouseId}/locations",
                        warehouseId)
                .header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"businessCode":"SHARED_LOCATION",
                         "name":"%s Private Location"}
                        """.formatted(tenantLabel)));
        UUID supplierId = UUID.randomUUID();
        UUID secondarySupplierId = UUID.randomUUID();
        UUID mappingId = UUID.randomUUID();
        UUID inactiveMappingId = UUID.randomUUID();
        UUID secondaryMappingId = UUID.randomUUID();
        executeUpdate("""
                INSERT INTO tenant_suppliers (
                  id, tenant_id, business_code, name, status,
                  contact_name, contact_phone, contact_email, address, notes)
                VALUES
                  (?, ?, 'SHARED_SUPPLIER', ?, 'ACTIVE', ?, '10000',
                   'fixture@example.invalid', ?, ?),
                  (?, ?, 'SHARED_SUPPLIER_SECONDARY', ?, 'ACTIVE',
                   NULL, NULL, NULL, NULL, NULL)
                """,
                supplierId,
                tenantId,
                tenantLabel + " Private Supplier",
                tenantLabel + " Private Contact",
                tenantLabel + " Private Address",
                tenantLabel + " supplier historical detail",
                secondarySupplierId,
                tenantId,
                tenantLabel + " Private Secondary Supplier");
        executeUpdate("""
                INSERT INTO tenant_supplier_sku_mappings (
                  id, tenant_id, supplier_id, sku_id,
                  supplier_sku_code, status, preferred, lead_time_days)
                VALUES
                  (?, ?, ?, ?, 'SHARED_SUPPLIER_SKU', 'ACTIVE', false, 7),
                  (?, ?, ?, ?, 'SHARED_SUPPLIER_SKU_INACTIVE',
                   'INACTIVE', false, 7),
                  (?, ?, ?, ?, 'SECONDARY_SUPPLIER_SKU',
                   'INACTIVE', false, 7)
                """,
                mappingId, tenantId, supplierId, skuId,
                inactiveMappingId, tenantId, supplierId, inactiveSkuId,
                secondaryMappingId, tenantId, secondarySupplierId, skuId);
        return new TenantResources(
                spuId,
                skuId,
                inactiveSkuId,
                orderId,
                warehouseId,
                locationId,
                supplierId,
                secondarySupplierId,
                mappingId,
                inactiveMappingId,
                secondaryMappingId);
    }

    private static UUID createdId(MockHttpServletRequestBuilder request)
            throws Exception {
        MvcResult result = mockMvc.perform(request)
                .andExpect(status().isCreated())
                .andReturn();
        return UUID.fromString(JsonPath.read(
                result.getResponse().getContentAsString(),
                "$.id"));
    }

    private static void assertPageContainsOnly(
            String token,
            String uri,
            UUID expectedId,
            String... forbiddenMarkers) throws Exception {
        assertPageContainsOnly(
                token,
                uri,
                expectedId,
                1,
                forbiddenMarkers);
    }

    private static void assertPageContainsOnly(
            String token,
            String uri,
            UUID expectedId,
            int expectedTotal,
            String... forbiddenMarkers) throws Exception {
        MvcResult result = mockMvc.perform(get(uri)
                        .header("Authorization", bearer(token)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(1))
                .andExpect(jsonPath("$.totalElements").value(expectedTotal))
                .andExpect(jsonPath("$.totalPages").value(expectedTotal))
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].id")
                        .value(expectedId.toString()))
                .andReturn();
        assertNoMarkers(
                result.getResponse().getContentAsString(),
                forbiddenMarkers);
    }

    private static void assertMappingPageContainsOnly(
            String token,
            String uri,
            UUID expectedId,
            int expectedTotal,
            String... forbiddenMarkers) throws Exception {
        MvcResult result = mockMvc.perform(get(uri)
                        .header("Authorization", bearer(token)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(1))
                .andExpect(jsonPath("$.totalElements").value(expectedTotal))
                .andExpect(jsonPath("$.totalPages").value(expectedTotal))
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].id")
                        .value(expectedId.toString()))
                .andReturn();
        assertNoMarkers(
                result.getResponse().getContentAsString(),
                forbiddenMarkers);
    }

    private static void assertSafeNotFound(
            MockHttpServletRequestBuilder request,
            String... forbiddenMarkers) throws Exception {
        MvcResult result = mockMvc.perform(request)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"))
                .andExpect(jsonPath("$.message")
                        .value("Requested resource was not found"))
                .andReturn();
        String body = result.getResponse().getContentAsString();
        assertThat(JsonPath.<Map<String, Object>>read(body, "$.details"))
                .isEmpty();
        assertThat(body)
                .doesNotContain("tenant_id")
                .doesNotContain("tenantId")
                .doesNotContain("audit");
        assertNoMarkers(body, forbiddenMarkers);
        assertSafeErrorHeaders(result.getResponse());
    }

    private static void assertSafeForbidden(
            MockHttpServletRequestBuilder request) throws Exception {
        MvcResult result = mockMvc.perform(request)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("permission_denied"))
                .andExpect(jsonPath("$.message")
                        .value("Permission is required"))
                .andReturn();
        String body = result.getResponse().getContentAsString();
        Map<String, Object> error = JsonPath.read(body, "$");
        if (error.containsKey("details")) {
            assertThat(error.get("details"))
                    .as("403 details must be empty when present")
                    .isEqualTo(Map.of());
        }
        assertThat(body)
                .doesNotContain("tenant_id")
                .doesNotContain("tenantId")
                .doesNotContain("audit");
        assertSafeErrorHeaders(result.getResponse());
    }

    private static void assertSafeErrorHeaders(
            MockHttpServletResponse response) {
        String headers = response.getHeaderNames().stream()
                .flatMap(name -> response.getHeaders(name).stream()
                        .map(value -> name + ":" + value))
                .collect(Collectors.joining(System.lineSeparator()));
        assertThat(response.getHeader(HttpHeaders.LOCATION)).isNull();
        assertThat(headers.toLowerCase(java.util.Locale.ROOT))
                .doesNotContain("authorization:");
        assertThat(headers)
                .doesNotContain(
                        "Exception",
                        "org.postgresql",
                        "jdbc:postgresql:",
                        "constraint",
                        "tenant_id",
                        "C:\\",
                        "/workspace/");
    }

    private static void assertNoMarkers(
            String body,
            String... forbiddenMarkers) {
        for (String marker : forbiddenMarkers) {
            assertThat(body).doesNotContain(marker);
        }
    }

    private static void assertBusinessResourcesReadable(
            String token,
            TenantResources resources) throws Exception {
        mockMvc.perform(get("/api/v1/product-center/spus/{spuId}",
                        resources.spuId())
                        .header("Authorization", bearer(token)))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/product-center/skus/{skuId}",
                        resources.skuId())
                        .header("Authorization", bearer(token)))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/order-center/orders/{orderId}",
                        resources.orderId())
                        .header("Authorization", bearer(token)))
                .andExpect(status().isOk());
        mockMvc.perform(get(
                        "/api/v1/warehouse-center/warehouses/{warehouseId}",
                        resources.warehouseId())
                        .header("Authorization", bearer(token)))
                .andExpect(status().isOk());
        mockMvc.perform(get(
                        "/api/v1/warehouse-center/warehouses/{warehouseId}"
                                + "/locations/{locationId}",
                        resources.warehouseId(),
                        resources.locationId())
                        .header("Authorization", bearer(token)))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/suppliers/{supplierId}",
                        resources.supplierId())
                        .header("Authorization", bearer(token)))
                .andExpect(status().isOk());
    }

    private static void assertPlatformTenantSessionCanWriteCurrentBusinessModules(
            String token) throws Exception {
        mockMvc.perform(put("/api/v1/product-center/spus/{spuId}",
                        tenantA.resources().spuId())
                        .header("Authorization", bearer(token))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"version":0,
                                 "name":"System Session Tenant A Product",
                                 "brandName":"System Session Brand",
                                 "productNote":null,"status":"ACTIVE"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(1));
        UUID orderId = createdId(post("/api/v1/order-center/orders")
                .header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"shopId":"%s",
                         "externalOrderRef":"SYSTEM-SESSION-ORDER",
                         "idempotencyKey":"system-session-order",
                         "currency":"CNY","buyerReference":null,
                         "placedAt":"2026-01-03T03:04:05Z",
                         "lines":[{
                           "skuId":"%s",
                           "externalListingRef":null,
                           "externalVariantRef":null,
                           "externalLineRef":"system-session-line",
                           "titleSnapshot":"System Session Order Line",
                           "quantity":1,"unitPriceMinor":100,
                           "currency":"CNY"
                         }]}
                        """.formatted(
                            tenantA.shopId(),
                            tenantA.resources().skuId())));
        assertThat(singleString("""
                SELECT tenant_id::text
                FROM tenant_orders
                WHERE id = ?
                """, orderId)).isEqualTo(tenantA.id().toString());
        mockMvc.perform(put(
                        "/api/v1/warehouse-center/warehouses/{warehouseId}",
                        tenantA.resources().warehouseId())
                        .header("Authorization", bearer(token))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"version":0,
                                 "name":"System Session Tenant A Warehouse",
                                 "status":"ACTIVE"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(1));
        mockMvc.perform(put(
                        "/api/v1/warehouse-center/warehouses/{warehouseId}"
                                + "/locations/{locationId}",
                        tenantA.resources().warehouseId(),
                        tenantA.resources().locationId())
                        .header("Authorization", bearer(token))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"version":0,
                                 "name":"System Session Tenant A Location",
                                 "status":"ACTIVE"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(1));
    }

    private static void assertUnauthorizedTenantToken(String token)
            throws Exception {
        MvcResult result = mockMvc.perform(get("/api/v1/suppliers")
                            .header("Authorization", bearer(token)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code")
                        .value("authentication_required"))
                .andReturn();
        assertSafeErrorHeaders(result.getResponse());
    }

    private static String mappingCollection(UUID supplierId) {
        return "/api/v1/suppliers/" + supplierId + "/sku-mappings";
    }

    private static String enterTenant(UUID tenantId) throws Exception {
        MvcResult result = mockMvc.perform(post(
                                "/api/v1/platform-admin/tenants/{tenantId}/enter",
                                tenantId)
                        .header("Authorization", bearer(platformToken)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tenant.id")
                        .value(tenantId.toString()))
                .andReturn();
        return JsonPath.read(
                result.getResponse().getContentAsString(),
                "$.accessToken");
    }

    private static String platformLogin() throws Exception {
        MvcResult result = mockMvc.perform(post(
                                "/api/v1/platform-admin/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"username":"%s","password":"%s"}
                                """.formatted(
                                    PLATFORM_USERNAME,
                                    PLATFORM_PASSWORD)))
                .andExpect(status().isOk())
                .andReturn();
        return JsonPath.read(
                result.getResponse().getContentAsString(),
                "$.accessToken");
    }

    private static void seedPlatformAdmin() throws Exception {
        String storedHash = "{bcrypt}" + new BCryptPasswordEncoder(12)
                .encode(PLATFORM_PASSWORD);
        executeUpdate("""
                INSERT INTO system_admins (
                    id, username, display_name, password_hash,
                    status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'ACTIVE', now(), now())
                """,
                PLATFORM_ADMIN_ID,
                PLATFORM_USERNAME,
                "Isolation System Admin",
                storedHash);
    }

    private static void insertShopFixtures(
            UUID tenantAId,
            UUID tenantBId) throws Exception {
        executeUpdate("""
                INSERT INTO platform_catalog (
                    id, code, display_name
                ) VALUES (?, 'ISOLATION_TEST', 'Isolation Test Platform')
                """, PLATFORM_ID);
        executeUpdate("""
                INSERT INTO tenant_shops (
                    id, tenant_id, platform_id,
                    external_shop_ref, display_name
                ) VALUES
                    (?, ?, ?, 'shared-shop-ref', 'Tenant A Private Shop'),
                    (?, ?, ?, 'shared-shop-ref', 'Tenant B Private Shop')
                """,
                SHOP_A_ID,
                tenantAId,
                PLATFORM_ID,
                SHOP_B_ID,
                tenantBId,
                PLATFORM_ID);
    }

    private static void executeUpdate(
            String sql,
            Object... parameters) throws Exception {
        try (Connection connection = DriverManager.getConnection(
                        jdbcUrl,
                        databaseUsername,
                        databasePassword);
                PreparedStatement statement =
                        connection.prepareStatement(sql)) {
            setParameters(statement, parameters);
            statement.executeUpdate();
        }
    }

    private static long singleLong(String sql, Object... parameters)
            throws Exception {
        try (Connection connection = DriverManager.getConnection(
                        jdbcUrl,
                        databaseUsername,
                        databasePassword);
                PreparedStatement statement =
                        connection.prepareStatement(sql)) {
            setParameters(statement, parameters);
            try (ResultSet result = statement.executeQuery()) {
                result.next();
                return result.getLong(1);
            }
        }
    }

    private static String singleString(String sql, Object... parameters)
            throws Exception {
        try (Connection connection = DriverManager.getConnection(
                        jdbcUrl,
                        databaseUsername,
                        databasePassword);
                PreparedStatement statement =
                        connection.prepareStatement(sql)) {
            setParameters(statement, parameters);
            try (ResultSet result = statement.executeQuery()) {
                result.next();
                return result.getString(1);
            }
        }
    }

    private static List<String> singleStrings(String sql)
            throws Exception {
        try (Connection connection = DriverManager.getConnection(
                        jdbcUrl,
                        databaseUsername,
                        databasePassword);
                PreparedStatement statement =
                        connection.prepareStatement(sql);
                ResultSet result = statement.executeQuery()) {
            java.util.ArrayList<String> values = new java.util.ArrayList<>();
            while (result.next()) {
                values.add(result.getString(1));
            }
            return List.copyOf(values);
        }
    }

    private static void setParameters(
            PreparedStatement statement,
            Object... parameters) throws Exception {
        for (int index = 0; index < parameters.length; index++) {
            statement.setObject(index + 1, parameters[index]);
        }
    }

    private static String bearer(String token) {
        return "Bearer " + token;
    }

    private record ProvisionedTenant(
            UUID id,
            String code,
            String token,
            UUID userId) {
    }

    private record TenantFixture(
            UUID id,
            String code,
            String token,
            UUID userId,
            UUID shopId,
            TenantResources resources) {

        String[] privateMarkers() {
            return new String[] {
                id.toString(),
                shopId.toString(),
                resources.spuId().toString(),
                resources.skuId().toString(),
                resources.inactiveSkuId().toString(),
                resources.orderId().toString(),
                resources.warehouseId().toString(),
                resources.locationId().toString(),
                resources.supplierId().toString(),
                resources.secondarySupplierId().toString(),
                resources.mappingId().toString(),
                resources.inactiveMappingId().toString(),
                resources.secondaryMappingId().toString(),
                code,
                code.endsWith("_a") ? "Tenant A Private" : "Tenant B Private"
            };
        }
    }

    private record TenantResources(
            UUID spuId,
            UUID skuId,
            UUID inactiveSkuId,
            UUID orderId,
            UUID warehouseId,
            UUID locationId,
            UUID supplierId,
            UUID secondarySupplierId,
            UUID mappingId,
            UUID inactiveMappingId,
            UUID secondaryMappingId) {
    }

}
