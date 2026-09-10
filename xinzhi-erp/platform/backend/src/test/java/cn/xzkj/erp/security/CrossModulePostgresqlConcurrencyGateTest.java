package cn.xzkj.erp.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer.OrderAnnotation;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@TestMethodOrder(OrderAnnotation.class)
class CrossModulePostgresqlConcurrencyGateTest {

    private static final String TENANT_A_CODE = "concurrency_gate_a";
    private static final String TENANT_B_CODE = "concurrency_gate_b";
    private static final String CONFLICT_CODE = "resource_conflict";
    private static final String CONFLICT_MESSAGE =
            "The request conflicts with the current resource state";
    private static final PostgresqlApiFixture FIXTURE =
            new PostgresqlApiFixture();

    private static MockMvc mockMvc;
    private static String platformToken;
    private static Tenant tenantA;
    private static Tenant tenantB;
    private static UUID platformId;
    private static UUID skuA;
    private static UUID secondSkuA;

    @BeforeAll
    static void start() throws Exception {
        FIXTURE.startProduction();
        mockMvc = FIXTURE.mockMvc();
        platformToken = accessToken(mockMvc.perform(post(
                                "/api/v1/platform-admin/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"username":"%s","password":"%s"}
                                """.formatted(
                                    PostgresqlApiFixture
                                            .SYSTEM_ADMIN_USERNAME,
                                    PostgresqlApiFixture
                                            .SYSTEM_ADMIN_PASSWORD)))
                .andExpect(status().isOk())
                .andReturn());

        tenantA = provisionTenant(
                TENANT_A_CODE,
                "Concurrency Gate Tenant A",
                "concurrency_gate_admin_a");
        tenantB = provisionTenant(
                TENANT_B_CODE,
                "Concurrency Gate Tenant B",
                "concurrency_gate_admin_b");

        platformId = UUID.fromString(FIXTURE.singleString("""
                SELECT id::text
                FROM platform_catalog
                WHERE code = 'SHOPIFY'
                """));
        tenantA = tenantA.withShop(createdId(request(
                post("/api/v1/platform-center/shops"),
                tenantA.token(),
                shopBody("shared-shop-ref"))));
        tenantB = tenantB.withShop(createdId(request(
                post("/api/v1/platform-center/shops"),
                tenantB.token(),
                shopBody("shared-shop-ref"))));

        UUID spuA = createSpu(
                tenantA.token(), "SHARED_BASE_SPU", "Tenant A Base SPU");
        UUID spuB = createSpu(
                tenantB.token(), "SHARED_BASE_SPU", "Tenant B Base SPU");
        skuA = createSku(
                tenantA.token(), spuA, "SHARED_BASE_SKU",
                "Tenant A Base SKU");
        secondSkuA = createSku(
                tenantA.token(), spuA, "SECOND_BASE_SKU",
                "Tenant A Second SKU");
        createSku(
                tenantB.token(), spuB, "SHARED_BASE_SKU",
                "Tenant B Base SKU");
    }

    @AfterAll
    static void stop() {
        FIXTURE.close();
    }

    @Test
    @Order(1)
    void ownsRandomEphemeralPostgresql16AndRunsAllMigrations()
            throws Exception {
        assertThat(FIXTURE.isRunning()).isTrue();
        assertThat(FIXTURE.imageName()).isEqualTo("postgres:16-alpine");
        assertThat(FIXTURE.jdbcUrl())
                .startsWith("jdbc:postgresql:")
                .doesNotContain("localhost:5432");
        assertThat(FIXTURE.singleString("SHOW server_version"))
                .startsWith("16.");
        assertThat(FIXTURE.singleString("""
                SELECT version
                FROM flyway_schema_history
                WHERE success
                ORDER BY installed_rank DESC
                LIMIT 1
                """)).isEqualTo("123");
    }

    @Test
    @Order(2)
    void orderCreateReplaysOnlyTheSameTenantRequestFingerprint()
            throws Exception {
        String key = "order-replay-key";
        String externalRef = "ORDER-REPLAY";
        String requestBody = orderBody(
                tenantA.shopId(), externalRef, key, skuA, "line-1", 100);

        MvcResult first = request(
                post("/api/v1/order-center/orders")
                        .header("X-Request-Id", "order-replay-first"),
                tenantA.token(),
                requestBody);
        assertThat(first.getResponse().getStatus()).isEqualTo(201);
        UUID orderId = id(first);

        MvcResult replay = request(
                post("/api/v1/order-center/orders")
                        .header("X-Request-Id", "order-replay-same"),
                tenantA.token(),
                requestBody);
        assertThat(replay.getResponse().getStatus()).isEqualTo(201);
        assertThat(id(replay)).isEqualTo(orderId);

        MvcResult mismatchedReplay = request(
                post("/api/v1/order-center/orders")
                        .header("X-Request-Id", "order-replay-mismatch"),
                tenantA.token(),
                orderBody(
                        tenantA.shopId(), externalRef, key, skuA,
                        "line-1", 101));
        assertSafeConflict(
                mismatchedReplay,
                tenantA.id().toString(),
                tenantA.token(),
                key,
                externalRef,
                "order-replay-mismatch");

        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM tenant_orders
                WHERE tenant_id = ? AND idempotency_key = ?
                """, tenantA.id(), key)).isEqualTo(1);
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM audit_logs
                WHERE tenant_id = ?
                  AND action = 'order.created'
                  AND resource_id = ?
                """, tenantA.id(), orderId.toString())).isEqualTo(1);
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM audit_logs
                WHERE request_id IN (
                    'order-replay-same',
                    'order-replay-mismatch'
                )
                  AND action = 'order.created'
                """)).isZero();
    }

    @Test
    @Order(3)
    void concurrentOrderIdempotencyIsTenantScopedAndCreatesNoDuplicates()
            throws Exception {
        String sameTenantKey = "order-concurrent-same-tenant";
        String sameTenantBody = orderBody(
                tenantA.shopId(),
                "ORDER-CONCURRENT-SAME",
                sameTenantKey,
                skuA,
                "line-1",
                200);
        List<MvcResult> sameTenant = race(
                () -> request(
                        post("/api/v1/order-center/orders")
                                .header(
                                    "X-Request-Id",
                                    "order-concurrent-same-a"),
                        tenantA.token(),
                        sameTenantBody),
                () -> request(
                        post("/api/v1/order-center/orders")
                                .header(
                                    "X-Request-Id",
                                    "order-concurrent-same-b"),
                        tenantA.token(),
                        sameTenantBody));
        assertThat(sameTenant)
                .extracting(result -> result.getResponse().getStatus())
                .containsExactlyInAnyOrder(201, 201);
        UUID firstId = id(sameTenant.get(0));
        assertThat(id(sameTenant.get(1))).isEqualTo(firstId);
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM tenant_orders
                WHERE tenant_id = ? AND idempotency_key = ?
                """, tenantA.id(), sameTenantKey)).isEqualTo(1);
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM audit_logs
                WHERE tenant_id = ?
                  AND action = 'order.created'
                  AND resource_id = ?
                """, tenantA.id(), firstId.toString())).isEqualTo(1);

        String sharedKey = "order-concurrent-cross-tenant";
        List<MvcResult> crossTenant = race(
                () -> request(
                        post("/api/v1/order-center/orders"),
                        tenantA.token(),
                        orderBody(
                                tenantA.shopId(),
                                "ORDER-CROSS-TENANT",
                                sharedKey,
                                skuA,
                                "line-cross",
                                300)),
                () -> request(
                        post("/api/v1/order-center/orders"),
                        tenantB.token(),
                        orderBody(
                                tenantB.shopId(),
                                "ORDER-CROSS-TENANT",
                                sharedKey,
                                null,
                                "line-cross",
                                300)));
        assertThat(crossTenant)
                .extracting(result -> result.getResponse().getStatus())
                .containsExactlyInAnyOrder(201, 201);
        assertThat(id(crossTenant.get(0)))
                .isNotEqualTo(id(crossTenant.get(1)));
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM tenant_orders
                WHERE idempotency_key = ?
                """, sharedKey)).isEqualTo(2);
    }

    @Test
    @Order(4)
    void orderStatusAndSkuMatchConcurrentDoubleWritesHaveOneWinner()
            throws Exception {
        MvcResult createdStatusOrder = request(
                post("/api/v1/order-center/orders"),
                tenantA.token(),
                orderBody(
                        tenantA.shopId(),
                        "ORDER-STATUS-RACE",
                        "order-status-race",
                        skuA,
                        "status-line",
                        400));
        UUID statusOrderId = id(createdStatusOrder);

        List<MvcResult> statusRace = race(
                () -> request(
                        put("/api/v1/order-center/orders/{orderId}/status",
                                statusOrderId)
                                .header("X-Request-Id", "status-race-review"),
                        tenantA.token(),
                        """
                                {"version":0,
                                 "targetStatus":"REVIEW_PENDING",
                                 "reason":null}
                                """),
                () -> request(
                        put("/api/v1/order-center/orders/{orderId}/status",
                                statusOrderId)
                                .header("X-Request-Id", "status-race-hold"),
                        tenantA.token(),
                        """
                                {"version":0,
                                 "targetStatus":"HOLD",
                                 "reason":"manual review"}
                                """));
        MvcResult statusConflict = assertOneWinner(statusRace, 200);
        assertSafeConflict(
                statusConflict,
                tenantA.id().toString(),
                tenantA.token(),
                statusOrderId.toString());
        assertThat(FIXTURE.singleLong("""
                SELECT version
                FROM tenant_orders
                WHERE tenant_id = ? AND id = ?
                """, tenantA.id(), statusOrderId)).isEqualTo(1);
        assertThat(FIXTURE.singleString("""
                SELECT status
                FROM tenant_orders
                WHERE tenant_id = ? AND id = ?
                """, tenantA.id(), statusOrderId))
                .isIn("REVIEW_PENDING", "HOLD");
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM audit_logs
                WHERE tenant_id = ?
                  AND action = 'order.status_changed'
                  AND resource_id = ?
                """, tenantA.id(), statusOrderId.toString())).isEqualTo(1);

        MvcResult createdMatchOrder = request(
                post("/api/v1/order-center/orders"),
                tenantA.token(),
                orderBody(
                        tenantA.shopId(),
                        "ORDER-SKU-MATCH-RACE",
                        "order-sku-match-race",
                        null,
                        "match-line",
                        500));
        UUID matchOrderId = id(createdMatchOrder);
        UUID lineId = UUID.fromString(JsonPath.read(
                body(createdMatchOrder),
                "$.lines[0].id"));

        List<MvcResult> matchRace = race(
                () -> request(
                        put("/api/v1/order-center/orders/{orderId}/lines/"
                                        + "{lineId}/sku-match",
                                matchOrderId,
                                lineId)
                                .header("X-Request-Id", "sku-match-race-a"),
                        tenantA.token(),
                        """
                                {"version":0,"skuId":"%s"}
                                """.formatted(skuA)),
                () -> request(
                        put("/api/v1/order-center/orders/{orderId}/lines/"
                                        + "{lineId}/sku-match",
                                matchOrderId,
                                lineId)
                                .header("X-Request-Id", "sku-match-race-b"),
                        tenantA.token(),
                        """
                                {"version":0,"skuId":"%s"}
                                """.formatted(secondSkuA)));
        MvcResult matchConflict = assertOneWinner(matchRace, 200);
        assertSafeConflict(
                matchConflict,
                tenantA.id().toString(),
                tenantA.token(),
                matchOrderId.toString(),
                lineId.toString());
        assertThat(FIXTURE.singleLong("""
                SELECT version
                FROM tenant_orders
                WHERE tenant_id = ? AND id = ?
                """, tenantA.id(), matchOrderId)).isEqualTo(1);
        assertThat(UUID.fromString(FIXTURE.singleString("""
                SELECT sku_id::text
                FROM tenant_order_lines
                WHERE tenant_id = ? AND order_id = ? AND id = ?
                """, tenantA.id(), matchOrderId, lineId)))
                .isIn(skuA, secondSkuA);
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM audit_logs
                WHERE tenant_id = ?
                  AND action = 'order.line.sku_matched'
                  AND resource_id = ?
                """, tenantA.id(), lineId.toString())).isEqualTo(1);
    }

    @Test
    @Order(5)
    void productVersionedUpdateAndArchiveRacesHaveOneWinner()
            throws Exception {
        UUID updateSpu = createSpu(
                tenantA.token(), "SPU_UPDATE_RACE", "SPU Before");
        List<MvcResult> spuRace = race(
                () -> request(
                        put("/api/v1/product-center/spus/{spuId}", updateSpu)
                                .header("X-Request-Id", "spu-update-race-a"),
                        tenantA.token(),
                        spuUpdateBody(0, "SPU Winner Alpha")),
                () -> request(
                        put("/api/v1/product-center/spus/{spuId}", updateSpu)
                                .header("X-Request-Id", "spu-update-race-b"),
                        tenantA.token(),
                        spuUpdateBody(0, "SPU Winner Beta")));
        assertSafeConflict(
                assertOneWinner(spuRace, 200),
                tenantA.id().toString(),
                updateSpu.toString(),
                "SPU_UPDATE_RACE",
                "spu-update-race-a",
                "spu-update-race-b");
        assertThat(FIXTURE.singleLong("""
                SELECT version
                FROM tenant_product_spus
                WHERE tenant_id = ? AND id = ?
                """, tenantA.id(), updateSpu)).isEqualTo(1);
        assertThat(FIXTURE.singleString("""
                SELECT name
                FROM tenant_product_spus
                WHERE tenant_id = ? AND id = ?
                """, tenantA.id(), updateSpu))
                .isIn("SPU Winner Alpha", "SPU Winner Beta");
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM audit_logs
                WHERE tenant_id = ?
                  AND resource_type = 'product_spu'
                  AND resource_id = ?
                  AND action = 'product_spu.updated'
                  AND request_id IN (?, ?)
                """, tenantA.id(), updateSpu.toString(),
                "spu-update-race-a", "spu-update-race-b")).isEqualTo(1);
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM audit_logs
                WHERE tenant_id = ?
                  AND resource_id = ?
                  AND request_id = ?
                """, tenantA.id(), updateSpu.toString(),
                requestIdForStatus(spuRace, 409))).isZero();

        UUID skuParent = createSpu(
                tenantA.token(), "SKU_ARCHIVE_PARENT", "SKU Parent");
        UUID archiveSku = createSku(
                tenantA.token(), skuParent, "SKU_ARCHIVE_RACE",
                "SKU Before");
        List<MvcResult> skuRace = race(
                () -> request(
                        put("/api/v1/product-center/skus/{skuId}", archiveSku)
                                .header("X-Request-Id", "sku-update-race"),
                        tenantA.token(),
                        skuUpdateBody(0, "SKU Updated")),
                () -> request(
                        post("/api/v1/product-center/skus/{skuId}/archive",
                                archiveSku)
                                .header("X-Request-Id", "sku-archive-race"),
                        tenantA.token(),
                        "{\"version\":0}"));
        assertSafeConflict(
                assertOneWinner(skuRace, 200),
                tenantA.id().toString(),
                archiveSku.toString(),
                "SKU_ARCHIVE_RACE",
                "sku-update-race",
                "sku-archive-race");
        assertThat(FIXTURE.singleLong("""
                SELECT version
                FROM tenant_product_skus
                WHERE tenant_id = ? AND id = ?
                """, tenantA.id(), archiveSku)).isEqualTo(1);
        assertThat(FIXTURE.singleString("""
                SELECT status
                FROM tenant_product_skus
                WHERE tenant_id = ? AND id = ?
                """, tenantA.id(), archiveSku))
                .isIn("ACTIVE", "ARCHIVED");
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM audit_logs
                WHERE tenant_id = ?
                  AND resource_type = 'product_sku'
                  AND resource_id = ?
                  AND action IN ('product_sku.updated',
                                 'product_sku.archived')
                  AND request_id IN (?, ?)
                """, tenantA.id(), archiveSku.toString(),
                "sku-update-race", "sku-archive-race")).isEqualTo(1);
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM audit_logs
                WHERE tenant_id = ?
                  AND resource_id = ?
                  AND request_id = ?
                """, tenantA.id(), archiveSku.toString(),
                requestIdForStatus(skuRace, 409))).isZero();

        UUID listing = createdId(request(
                post("/api/v1/product-center/listings"),
                tenantA.token(),
                """
                        {"shopId":"%s","skuId":"%s",
                         "externalListingRef":"listing-archive-race",
                         "externalVariantRef":"variant-a",
                         "externalStatus":"ONLINE",
                         "metadataNote":"before"}
                        """.formatted(tenantA.shopId(), skuA)));
        List<MvcResult> listingRace = race(
                () -> request(
                        put("/api/v1/product-center/listings/{listingId}",
                                listing)
                                .header("X-Request-Id",
                                        "listing-update-race"),
                        tenantA.token(),
                        """
                                {"version":0,"externalStatus":"UPDATED",
                                 "metadataNote":"winner update",
                                 "status":"ACTIVE"}
                                """),
                () -> request(
                        post("/api/v1/product-center/listings/{listingId}/"
                                        + "archive",
                                listing)
                                .header("X-Request-Id",
                                        "listing-archive-race"),
                        tenantA.token(),
                        "{\"version\":0}"));
        assertSafeConflict(
                assertOneWinner(listingRace, 200),
                tenantA.id().toString(),
                listing.toString(),
                "listing-archive-race",
                "listing-update-race");
        assertThat(FIXTURE.singleLong("""
                SELECT version
                FROM tenant_product_listings
                WHERE tenant_id = ? AND id = ?
                """, tenantA.id(), listing)).isEqualTo(1);
        assertThat(FIXTURE.singleString("""
                SELECT status
                FROM tenant_product_listings
                WHERE tenant_id = ? AND id = ?
                """, tenantA.id(), listing))
                .isIn("ACTIVE", "ARCHIVED");
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM audit_logs
                WHERE tenant_id = ?
                  AND resource_type = 'product_listing'
                  AND resource_id = ?
                  AND action IN ('product_listing.updated',
                                 'product_listing.archived')
                  AND request_id IN (?, ?)
                """, tenantA.id(), listing.toString(),
                "listing-update-race",
                "listing-archive-race")).isEqualTo(1);
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM audit_logs
                WHERE tenant_id = ?
                  AND resource_id = ?
                  AND request_id = ?
                """, tenantA.id(), listing.toString(),
                requestIdForStatus(listingRace, 409))).isZero();
    }

    @Test
    @Order(6)
    void warehouseAndLocationRacesHaveOneWinner()
            throws Exception {
        UUID warehouse = createWarehouse(
                tenantA.token(), "WAREHOUSE_UPDATE_RACE", "Before Warehouse");
        List<MvcResult> warehouseRace = race(
                () -> request(
                        put("/api/v1/warehouse-center/warehouses/{id}",
                                warehouse),
                        tenantA.token(),
                        warehouseUpdateBody(0, "Warehouse Alpha")),
                () -> request(
                        put("/api/v1/warehouse-center/warehouses/{id}",
                                warehouse),
                        tenantA.token(),
                        warehouseUpdateBody(0, "Warehouse Beta")));
        assertSafeConflict(
                assertOneWinner(warehouseRace, 200),
                tenantA.id().toString(),
                warehouse.toString(),
                "WAREHOUSE_UPDATE_RACE");
        assertThat(FIXTURE.singleLong("""
                SELECT version
                FROM tenant_warehouses
                WHERE tenant_id = ? AND id = ?
                """, tenantA.id(), warehouse)).isEqualTo(1);

        UUID location = createdId(request(
                post("/api/v1/warehouse-center/warehouses/{id}/locations",
                        warehouse),
                tenantA.token(),
                """
                        {"businessCode":"LOCATION_ARCHIVE_RACE",
                         "name":"Before Location"}
                        """));
        List<MvcResult> locationRace = race(
                () -> request(
                        put("/api/v1/warehouse-center/warehouses/{warehouseId}"
                                        + "/locations/{locationId}",
                                warehouse,
                                location),
                        tenantA.token(),
                        """
                                {"version":0,"name":"Location Updated",
                                 "status":"ACTIVE"}
                                """),
                () -> request(
                        post("/api/v1/warehouse-center/warehouses/{warehouseId}"
                                        + "/locations/{locationId}/archive",
                                warehouse,
                                location),
                        tenantA.token(),
                        "{\"version\":0}"));
        assertSafeConflict(
                assertOneWinner(locationRace, 200),
                tenantA.id().toString(),
                warehouse.toString(),
                location.toString());
        assertThat(FIXTURE.singleLong("""
                SELECT version
                FROM tenant_warehouse_locations
                WHERE tenant_id = ? AND id = ?
                """, tenantA.id(), location)).isEqualTo(1);

    }

    @Test
    @Order(7)
    void concurrentTenantBusinessCodesConflictLocallyButNotAcrossTenants()
            throws Exception {
        String spuCode = "SPU_CREATE_RACE";
        List<MvcResult> spuRace = race(
                () -> request(
                        post("/api/v1/product-center/spus"),
                        tenantA.token(),
                        spuCreateBody(spuCode, "SPU Create Alpha")),
                () -> request(
                        post("/api/v1/product-center/spus"),
                        tenantA.token(),
                        spuCreateBody(spuCode, "SPU Create Beta")));
        assertSafeConflict(
                assertOneWinner(spuRace, 201),
                tenantA.id().toString(),
                spuCode,
                "uq_tenant_product_spus_code");
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM tenant_product_spus
                WHERE tenant_id = ? AND business_code = ?
                """, tenantA.id(), spuCode)).isEqualTo(1);

        String warehouseCode = "WAREHOUSE_CREATE_RACE";
        List<MvcResult> warehouseRace = race(
                () -> request(
                        post("/api/v1/warehouse-center/warehouses"),
                        tenantA.token(),
                        warehouseCreateBody(
                                warehouseCode,
                                "Warehouse Create Alpha")),
                () -> request(
                        post("/api/v1/warehouse-center/warehouses"),
                        tenantA.token(),
                        warehouseCreateBody(
                                warehouseCode,
                                "Warehouse Create Beta")));
        assertSafeConflict(
                assertOneWinner(warehouseRace, 201),
                tenantA.id().toString(),
                warehouseCode,
                "uq_tenant_warehouses_code");
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM tenant_warehouses
                WHERE tenant_id = ? AND business_code = ?
                """, tenantA.id(), warehouseCode)).isEqualTo(1);

    }

    @Test
    @Order(8)
    void platformShopAndSyncUniqueWritesUseExistingConflictEnvelope()
            throws Exception {
        String globalPlatformCode = "PLATFORM_CREATE_RACE";
        List<MvcResult> platformRace = race(
                () -> request(
                        post("/api/v1/platform-center/platforms"),
                        tenantA.token(),
                        platformBody(
                                globalPlatformCode,
                                "Platform Alpha")),
                () -> request(
                        post("/api/v1/platform-center/platforms"),
                        tenantB.token(),
                        platformBody(
                                globalPlatformCode,
                                "Platform Beta")));
        assertSafeConflict(
                assertOneWinner(platformRace, 201),
                tenantA.id().toString(),
                tenantB.id().toString(),
                globalPlatformCode,
                "uq_platform_catalog_code");
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM platform_catalog
                WHERE code = ?
                """, globalPlatformCode)).isEqualTo(1);

        String localShopRef = "shop-create-race";
        List<MvcResult> shopRace = race(
                () -> request(
                        post("/api/v1/platform-center/shops"),
                        tenantA.token(),
                        shopBody(localShopRef)),
                () -> request(
                        post("/api/v1/platform-center/shops"),
                        tenantA.token(),
                        shopBody(localShopRef)));
        assertSafeConflict(
                assertOneWinner(shopRace, 201),
                tenantA.id().toString(),
                tenantA.token(),
                localShopRef,
                "uq_tenant_shops_tenant_external");
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM tenant_shops
                WHERE tenant_id = ?
                  AND platform_id = ?
                  AND external_shop_ref = ?
                """, tenantA.id(), platformId,
                localShopRef + ".myshopify.com")).isEqualTo(1);

        String crossTenantShopRef = "shop-cross-tenant-race";
        List<MvcResult> crossTenantShops = race(
                () -> request(
                        post("/api/v1/platform-center/shops"),
                        tenantA.token(),
                        shopBody(crossTenantShopRef)),
                () -> request(
                        post("/api/v1/platform-center/shops"),
                        tenantB.token(),
                        shopBody(crossTenantShopRef)));
        assertThat(crossTenantShops)
                .extracting(result -> result.getResponse().getStatus())
                .containsExactlyInAnyOrder(201, 201);

        UUID syncShop = createdId(request(
                post("/api/v1/platform-center/shops"),
                tenantA.token(),
                shopBody("sync-race-shop")));
        List<MvcResult> syncRace = race(
                () -> request(
                        post("/api/v1/platform-center/shops/{shopId}/"
                                        + "sync-jobs",
                                syncShop),
                        tenantA.token(),
                        "{\"jobType\":\"ORDERS\"}"),
                () -> request(
                        post("/api/v1/platform-center/shops/{shopId}/"
                                        + "sync-jobs",
                                syncShop),
                        tenantA.token(),
                        "{\"jobType\":\"ORDERS\"}"));
        assertSafeConflict(
                assertOneWinner(syncRace, 201),
                tenantA.id().toString(),
                tenantA.token(),
                syncShop.toString(),
                "uq_shop_sync_jobs_open_type");
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM shop_sync_jobs
                WHERE tenant_id = ?
                  AND shop_id = ?
                  AND job_type = 'ORDERS'
                  AND status IN ('QUEUED', 'RUNNING')
                """, tenantA.id(), syncShop)).isEqualTo(1);
    }

    private static Tenant provisionTenant(
            String code,
            String name,
            String adminUsername) throws Exception {
        String adminEmail = adminUsername + "@example.test";
        MvcResult created = request(
                post("/api/v1/platform-admin/tenants"),
                platformToken,
                """
                        {"code":"%s","name":"%s",
                         "adminEmail":"%s",
                         "adminDisplayName":"Concurrency Gate Admin",
                         "adminInitialPassword":"concurrency-direct-password"}
                        """.formatted(code, name, adminEmail));
        assertThat(created.getResponse().getStatus()).isEqualTo(201);
        UUID id = UUID.fromString(JsonPath.read(
                body(created),
                "$.tenant.id"));
        MvcResult enabled = request(
                put("/api/v1/platform-admin/tenants/{tenantId}/entitlements", id),
                platformToken,
                """
                        {
                          "version":0,
                          "applications":[{
                            "code":"ERP",
                            "modules":["CHANNELS","PRODUCTS","ORDERS",
                              "PROCUREMENT","WAREHOUSE","LOGISTICS","ANALYTICS"]
                          }]
                        }
                        """);
        assertThat(enabled.getResponse().getStatus()).isEqualTo(200);
        MvcResult entered = request(
                post("/api/v1/platform-admin/tenants/{tenantId}/enter", id),
                platformToken,
                null);
        assertThat(entered.getResponse().getStatus()).isEqualTo(200);
        return new Tenant(
                id,
                code,
                accessToken(entered),
                null);
    }

    private static UUID createSpu(
            String token,
            String code,
            String name) throws Exception {
        return createdId(request(
                post("/api/v1/product-center/spus"),
                token,
                spuCreateBody(code, name)));
    }

    private static UUID createSku(
            String token,
            UUID spuId,
            String code,
            String name) throws Exception {
        return createdId(request(
                post("/api/v1/product-center/spus/{spuId}/skus", spuId),
                token,
                """
                        {"businessCode":"%s","name":"%s",
                         "variantSummary":null}
                        """.formatted(code, name)));
    }

    private static UUID createWarehouse(
            String token,
            String code,
            String name) throws Exception {
        return createdId(request(
                post("/api/v1/warehouse-center/warehouses"),
                token,
                warehouseCreateBody(code, name)));
    }

    private static MvcResult request(
            MockHttpServletRequestBuilder builder,
            String token,
            String json) throws Exception {
        builder.header(HttpHeaders.AUTHORIZATION, "Bearer " + token);
        if (json != null) {
            builder.contentType(MediaType.APPLICATION_JSON).content(json);
        }
        return mockMvc.perform(builder).andReturn();
    }

    @SafeVarargs
    private static List<MvcResult> race(
            Callable<MvcResult>... requests) throws Exception {
        assertThat(requests).hasSize(2);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<MvcResult>> futures = java.util.Arrays.stream(requests)
                    .map(request -> executor.submit(() -> {
                        ready.countDown();
                        if (!start.await(10, TimeUnit.SECONDS)) {
                            throw new IllegalStateException(
                                    "Concurrent request start timed out");
                        }
                        return request.call();
                    }))
                    .toList();
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            return List.of(
                    futures.get(0).get(
                            Duration.ofSeconds(30).toMillis(),
                            TimeUnit.MILLISECONDS),
                    futures.get(1).get(
                            Duration.ofSeconds(30).toMillis(),
                            TimeUnit.MILLISECONDS));
        } finally {
            start.countDown();
            executor.shutdownNow();
            assertThat(executor.awaitTermination(10, TimeUnit.SECONDS))
                    .isTrue();
        }
    }

    private static MvcResult assertOneWinner(
            List<MvcResult> results,
            int successStatus) {
        assertThat(results).hasSize(2);
        assertThat(results)
                .extracting(result -> result.getResponse().getStatus())
                .containsExactlyInAnyOrder(successStatus, 409);
        return results.stream()
                .filter(result -> result.getResponse().getStatus() == 409)
                .findFirst()
                .orElseThrow();
    }

    private static String requestIdForStatus(
            List<MvcResult> results,
            int status) {
        return results.stream()
                .filter(result -> result.getResponse().getStatus() == status)
                .map(result -> result.getRequest().getHeader("X-Request-Id"))
                .findFirst()
                .orElseThrow();
    }

    private static void assertSafeConflict(
            MvcResult result,
            String... forbiddenValues) throws Exception {
        assertThat(result.getResponse().getStatus()).isEqualTo(409);
        assertThat(result.getResponse().getContentType())
                .isEqualTo(MediaType.APPLICATION_JSON_VALUE);
        String responseBody = body(result);
        assertThat(JsonPath.<String>read(responseBody, "$.code"))
                .isEqualTo(CONFLICT_CODE);
        assertThat(JsonPath.<String>read(responseBody, "$.message"))
                .isEqualTo(CONFLICT_MESSAGE);
        assertThat(JsonPath.<Map<String, Object>>read(
                responseBody,
                "$.details")).isEmpty();
        assertThat(responseBody)
                .doesNotContainIgnoringCase(
                        "jdbc:",
                        "postgres",
                        "constraint",
                        "tenant_id",
                        "sqlstate",
                        "duplicate key",
                        "token_hash");
        assertThat(responseBody).doesNotContain(forbiddenValues);
    }

    private static UUID createdId(MvcResult result) throws Exception {
        assertThat(result.getResponse().getStatus())
                .as("create response body: %s", body(result))
                .isEqualTo(201);
        return id(result);
    }

    private static UUID id(MvcResult result) throws Exception {
        return UUID.fromString(JsonPath.read(body(result), "$.id"));
    }

    private static String accessToken(MvcResult result) throws Exception {
        return JsonPath.read(body(result), "$.accessToken");
    }

    private static String body(MvcResult result) throws Exception {
        return result.getResponse().getContentAsString();
    }

    private static String platformBody(String code, String name) {
        return """
                {"code":"%s","displayName":"%s","description":null}
                """.formatted(code, name);
    }

    private static String shopBody(String externalRef) {
        return """
                {"platformId":"%s","externalShopRef":"%s"}
                """.formatted(platformId, externalRef);
    }

    private static String spuCreateBody(String code, String name) {
        return """
                {"businessCode":"%s","name":"%s","brandName":null,
                 "productNote":null}
                """.formatted(code, name);
    }

    private static String spuUpdateBody(long version, String name) {
        return """
                {"version":%d,"name":"%s","brandName":null,
                 "productNote":null,"status":"ACTIVE"}
                """.formatted(version, name);
    }

    private static String skuUpdateBody(long version, String name) {
        return """
                {"version":%d,"name":"%s","variantSummary":null,
                 "status":"ACTIVE"}
                """.formatted(version, name);
    }

    private static String warehouseCreateBody(String code, String name) {
        return """
                {"businessCode":"%s","name":"%s"}
                """.formatted(code, name);
    }

    private static String warehouseUpdateBody(long version, String name) {
        return """
                {"version":%d,"name":"%s","status":"ACTIVE"}
                """.formatted(version, name);
    }

    private static String orderBody(
            UUID shopId,
            String externalRef,
            String idempotencyKey,
            UUID skuId,
            String externalLineRef,
            long unitPriceMinor) {
        String sku = skuId == null ? "null" : "\"" + skuId + "\"";
        return """
                {"shopId":"%s","externalOrderRef":"%s",
                 "idempotencyKey":"%s","currency":"CNY",
                 "buyerReference":null,
                 "placedAt":"2026-07-29T00:00:00Z",
                 "lines":[{"skuId":%s,
                   "externalListingRef":null,
                   "externalVariantRef":null,
                   "externalLineRef":"%s",
                   "titleSnapshot":"Concurrency Gate Line",
                   "quantity":1,"unitPriceMinor":%d,
                   "currency":"CNY"}]}
                """.formatted(
                    shopId,
                    externalRef,
                    idempotencyKey,
                    sku,
                    externalLineRef,
                    unitPriceMinor);
    }

    private record Tenant(
            UUID id,
            String code,
            String token,
            UUID shopId) {
        Tenant withShop(UUID value) {
            return new Tenant(id, code, token, value);
        }
    }
}
