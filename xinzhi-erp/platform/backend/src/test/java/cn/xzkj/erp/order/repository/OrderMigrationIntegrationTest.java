package cn.xzkj.erp.order.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import cn.xzkj.erp.ErpApplication;
import cn.xzkj.erp.fulfillment.service.FulfillmentService;
import cn.xzkj.erp.fulfillment.service.FulfillmentService.Allocation;
import cn.xzkj.erp.fulfillment.service.FulfillmentService.QuantityChange;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.PackageItem;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.Plan;
import cn.xzkj.erp.fulfillment.service.FulfillmentExceptions;
import cn.xzkj.erp.fulfillment.weighing.ShippingConfigurationService;
import cn.xzkj.erp.fulfillment.weighing.ShippingWeighingService;
import cn.xzkj.erp.logistics.trackingnumber.TrackingNumberService;
import cn.xzkj.erp.order.service.OrderCenterService;
import cn.xzkj.erp.order.service.OrderCenterService.CreateLineCommand;
import cn.xzkj.erp.order.service.OrderCenterService.CreateOrderCommand;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.order.repository.OrderListQueryRepository.Query;
import cn.xzkj.erp.order.domain.OrderListItem;
import cn.xzkj.erp.order.domain.OrderStatus;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.product.service.ProductCenterService;

class OrderMigrationIntegrationTest {
    private static PostgreSQLContainer<?> postgres;
    private static String jdbcUrl;
    private static String baseJdbcUrl;
    private static String isolatedSchema;
    private static String username;
    private static String password;

    @BeforeAll
    static void migrate() throws Exception {
        configureDatabase();
        Flyway.configure().dataSource(jdbcUrl, username, password)
                .locations("classpath:db/migration")
                .target(MigrationVersion.fromVersion("32")).load().migrate();
        seedHistoricalV32Data();
        Flyway.configure().dataSource(jdbcUrl, username, password)
                .locations("classpath:db/migration").load().migrate();
    }

    @AfterAll
    static void stopContainer() throws Exception {
        try {
            if (isolatedSchema != null) {
                try (Connection connection = DriverManager.getConnection(baseJdbcUrl, username, password);
                        Statement statement = connection.createStatement()) {
                    statement.execute("DROP SCHEMA \"" + isolatedSchema + "\" CASCADE");
                }
            }
        } finally {
            if (postgres != null) { postgres.stop(); }
        }
    }

    @Test
    void appliesV32AndDefinesPermissions() throws Exception {
        try (Connection connection = connection(); Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery("""
                        SELECT
                          (SELECT count(*) FROM flyway_schema_history WHERE version = '32' AND success),
                          (SELECT count(*) FROM permissions WHERE code IN ('orders.read', 'orders.write'))
                        """)) {
            result.next();
            assertThat(result.getInt(1)).isOne();
            assertThat(result.getInt(2)).isEqualTo(2);
        }
    }

    @Test
    void skuSalesSummariesUseReviewedWindowsAndRemainTenantScoped()
            throws Exception {
        try (Connection connection = connection();
                Statement statement = connection.createStatement()) {
            statement.executeUpdate("""
                    INSERT INTO tenant_product_spus (
                      id, tenant_id, business_code, name
                    ) VALUES (
                      '92000000-0000-0000-0000-000000000032',
                      '92000000-0000-0000-0000-000000000002',
                      'ORDER_SPU_B', 'Order SPU B'
                    ) ON CONFLICT (id) DO NOTHING
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_product_skus (
                      id, tenant_id, spu_id, business_code, name
                    ) VALUES
                      ('92000000-0000-0000-0000-000000000034',
                       '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000030',
                       'ORDER_SALES_SKU', 'Order sales SKU'),
                      ('92000000-0000-0000-0000-000000000033',
                       '92000000-0000-0000-0000-000000000002',
                       '92000000-0000-0000-0000-000000000032',
                       'ORDER_SKU_B', 'Order SKU B')
                    ON CONFLICT (id) DO NOTHING
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_orders (
                      id, tenant_id, shop_id, external_order_ref,
                      idempotency_key, request_fingerprint, currency,
                      status, line_count, placed_at
                    ) VALUES
                      ('92000000-0000-0000-0000-000000000050',
                       '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000010',
                       'sales-7', 'sales-7', repeat('1', 64), 'USD',
                       'RECEIVED', 1, '2026-07-30T00:00:00Z'),
                      ('92000000-0000-0000-0000-000000000051',
                       '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000010',
                       'sales-28', 'sales-28', repeat('2', 64), 'USD',
                       'SHIPPED', 1, '2026-07-15T00:00:00Z'),
                      ('92000000-0000-0000-0000-000000000052',
                       '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000010',
                       'sales-42', 'sales-42', repeat('3', 64), 'USD',
                       'DELIVERED', 1, '2026-06-25T00:00:00Z'),
                      ('92000000-0000-0000-0000-000000000053',
                       '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000010',
                       'sales-old', 'sales-old', repeat('4', 64), 'USD',
                       'DELIVERED', 1, '2026-06-01T00:00:00Z'),
                      ('92000000-0000-0000-0000-000000000054',
                       '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000010',
                       'sales-cancelled', 'sales-cancelled',
                       repeat('5', 64), 'USD', 'CANCELLED', 1,
                       '2026-07-30T00:00:00Z'),
                      ('92000000-0000-0000-0000-000000000055',
                       '92000000-0000-0000-0000-000000000002',
                       '92000000-0000-0000-0000-000000000011',
                       'sales-foreign', 'sales-foreign',
                       repeat('6', 64), 'USD', 'RECEIVED', 1,
                       '2026-07-30T00:00:00Z')
                    ON CONFLICT (id) DO NOTHING
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_order_lines (
                      id, tenant_id, order_id, sku_id, external_line_ref,
                      title_snapshot, quantity, unit_price_minor, currency,
                      sku_match_source
                    ) VALUES
                      ('92000000-0000-0000-0000-000000000060',
                       '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000050',
                       '92000000-0000-0000-0000-000000000034',
                       'sales-7', 'Sales 7', 2, 100, 'USD', 'PROVIDED'),
                      ('92000000-0000-0000-0000-000000000061',
                       '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000051',
                       '92000000-0000-0000-0000-000000000034',
                       'sales-28', 'Sales 28', 3, 100, 'USD', 'PROVIDED'),
                      ('92000000-0000-0000-0000-000000000062',
                       '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000052',
                       '92000000-0000-0000-0000-000000000034',
                       'sales-42', 'Sales 42', 4, 100, 'USD', 'PROVIDED'),
                      ('92000000-0000-0000-0000-000000000063',
                       '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000053',
                       '92000000-0000-0000-0000-000000000034',
                       'sales-old', 'Sales old', 8, 100, 'USD', 'PROVIDED'),
                      ('92000000-0000-0000-0000-000000000064',
                       '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000054',
                       '92000000-0000-0000-0000-000000000034',
                       'sales-cancelled', 'Sales cancelled', 16, 100, 'USD',
                       'PROVIDED'),
                      ('92000000-0000-0000-0000-000000000065',
                       '92000000-0000-0000-0000-000000000002',
                       '92000000-0000-0000-0000-000000000055',
                       '92000000-0000-0000-0000-000000000033',
                       'sales-foreign', 'Sales foreign', 32, 100, 'USD',
                       'PROVIDED')
                    ON CONFLICT (id) DO NOTHING
                    """);
        }

        var repository = new OrderListQueryRepository(
                new NamedParameterJdbcTemplate(
                        new DriverManagerDataSource(
                                jdbcUrl,
                                username,
                                password)));
        var summaries = repository.listSkuSalesSummaries(
                UUID.fromString(
                        "92000000-0000-0000-0000-000000000001"),
                java.util.Set.of(
                        UUID.fromString(
                                "92000000-0000-0000-0000-000000000034"),
                        UUID.fromString(
                                "92000000-0000-0000-0000-000000000033")),
                Instant.parse("2026-07-24T00:00:00Z"),
                Instant.parse("2026-07-03T00:00:00Z"),
                Instant.parse("2026-06-19T00:00:00Z"));

        assertThat(summaries).singleElement().satisfies(summary -> {
            assertThat(summary.skuId()).isEqualTo(UUID.fromString(
                    "92000000-0000-0000-0000-000000000034"));
            assertThat(summary.sales7()).isEqualTo(2);
            assertThat(summary.sales28()).isEqualTo(5);
            assertThat(summary.sales42()).isEqualTo(9);
        });
    }

    @Test
    void orderKeywordSearchCoversTrackingTransactionAndInternalReferences()
            throws Exception {
        seed();
        try (Connection connection = connection();
                Statement statement = connection.createStatement()) {
            statement.executeUpdate("""
                    INSERT INTO tenant_warehouse_locations (
                      id, tenant_id, warehouse_id, business_code, name, status
                    ) VALUES (
                      '92000000-0000-0000-0000-000000000061',
                      '92000000-0000-0000-0000-000000000001',
                      '92000000-0000-0000-0000-000000000060',
                      'PICK_A01', 'Picking A01', 'ACTIVE'
                    )
                    ON CONFLICT (id) DO NOTHING
                    """);
            statement.executeUpdate("""
                    UPDATE tenant_orders
                    SET warehouse_id =
                      '92000000-0000-0000-0000-000000000060'
                    WHERE tenant_id =
                      '92000000-0000-0000-0000-000000000001'
                      AND id =
                      '92000000-0000-0000-0000-000000000020'
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_order_profiles (
                      tenant_id, order_id, sales_record_number,
                      shopping_cart_reference,
                      custom_order_reference, tracking_reference,
                      secondary_tracking_reference, actual_paid_minor,
                      profit_minor, actual_shipping_minor, item_amount_minor,
                      platform_fee_minor, insurance_fee_minor,
                      payment_fee_minor, other_income_minor,
                      other_expense_minor, tax_minor,
                      estimated_shipping_minor,
                      salesperson_user_id, manager_user_id, order_remark,
                      customer_category, product_kind_count,
                      supplier_reference, parent_product_category,
                      child_product_category, product_status,
                      extended_attribute,
                      location_id, picker_user_id, shipper_user_id,
                      purchaser_user_id, developer_user_id,
                      printed_at, platform_returned_at, exception_reviewed_at,
                      platform_specified_handover_at,
                      platform_label_requested_at, delivery_deadline_at,
                      cancelled_at, handed_over_at,
                      delivered_at
                    ) VALUES
                      ('92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000020',
                        'TXN-SHARED-7788', 'CART-SHARED-9900',
                        'INTERNAL-SHARED-4455',
                        'TRACK-SHARED-1122', 'TRACK-SHARED-SECONDARY-3344',
                        900, -50, 150, 800, 40, 10, 20, 30, 25, -5, 140,
                        '92000000-0000-0000-0000-000000000004',
                        '92000000-0000-0000-0000-000000000004',
                        'TENANT-A-REMARK',
                        'VIP-A', 2, 'SUP-A', 'HOME-A', 'LIGHTING-A',
                        'ACTIVE-A', 'FRAGILE-A',
                        '92000000-0000-0000-0000-000000000061',
                        '92000000-0000-0000-0000-000000000004',
                        '92000000-0000-0000-0000-000000000004',
                        '92000000-0000-0000-0000-000000000004',
                        '92000000-0000-0000-0000-000000000004',
                        '2026-07-21T00:00:00Z', '2026-07-22T00:00:00Z',
                        '2026-07-23T00:00:00Z', '2026-07-24T00:00:00Z',
                        '2026-07-25T00:00:00Z', '2026-07-26T00:00:00Z',
                        '2026-07-27T00:00:00Z', '2026-07-28T00:00:00Z',
                        '2026-07-29T00:00:00Z'),
                      ('92000000-0000-0000-0000-000000000002',
                       '92000000-0000-0000-0000-000000000021',
                        'TXN-SHARED-7788', 'CART-SHARED-9900',
                        'INTERNAL-SHARED-4455',
                        'TRACK-SHARED-1122', 'TRACK-SHARED-SECONDARY-3344',
                        900, -50, 150, 800, 40, 10, 20, 30, 25, -6, 140,
                        NULL, NULL, 'TENANT-B-REMARK',
                        'VIP-B', 3, 'SUP-B', 'HOME-B', 'LIGHTING-B',
                        'ACTIVE-B', 'FRAGILE-B',
                        NULL, NULL, NULL, NULL, NULL,
                        '2026-07-21T00:00:00Z', '2026-07-22T00:00:00Z',
                        '2026-07-23T00:00:00Z', '2026-07-24T00:00:00Z',
                        '2026-07-25T00:00:00Z', '2026-07-26T00:00:00Z',
                        '2026-07-27T00:00:00Z', '2026-07-28T00:00:00Z',
                        '2026-07-29T00:00:00Z')
                    ON CONFLICT (tenant_id, order_id) DO UPDATE SET
                      sales_record_number = EXCLUDED.sales_record_number,
                      shopping_cart_reference =
                        EXCLUDED.shopping_cart_reference,
                      custom_order_reference = EXCLUDED.custom_order_reference,
                      tracking_reference = EXCLUDED.tracking_reference,
                      secondary_tracking_reference =
                        EXCLUDED.secondary_tracking_reference,
                      actual_paid_minor = EXCLUDED.actual_paid_minor,
                      profit_minor = EXCLUDED.profit_minor,
                      actual_shipping_minor = EXCLUDED.actual_shipping_minor,
                      item_amount_minor = EXCLUDED.item_amount_minor,
                      platform_fee_minor = EXCLUDED.platform_fee_minor,
                      insurance_fee_minor = EXCLUDED.insurance_fee_minor,
                      payment_fee_minor = EXCLUDED.payment_fee_minor,
                      other_income_minor = EXCLUDED.other_income_minor,
                      other_expense_minor = EXCLUDED.other_expense_minor,
                      tax_minor = EXCLUDED.tax_minor,
                      estimated_shipping_minor =
                        EXCLUDED.estimated_shipping_minor,
                      salesperson_user_id = EXCLUDED.salesperson_user_id,
                      manager_user_id = EXCLUDED.manager_user_id,
                      order_remark = EXCLUDED.order_remark,
                      customer_category = EXCLUDED.customer_category,
                      product_kind_count = EXCLUDED.product_kind_count,
                      supplier_reference = EXCLUDED.supplier_reference,
                      parent_product_category =
                        EXCLUDED.parent_product_category,
                      child_product_category =
                        EXCLUDED.child_product_category,
                      product_status = EXCLUDED.product_status,
                      extended_attribute = EXCLUDED.extended_attribute,
                      location_id = EXCLUDED.location_id,
                      picker_user_id = EXCLUDED.picker_user_id,
                      shipper_user_id = EXCLUDED.shipper_user_id,
                      purchaser_user_id = EXCLUDED.purchaser_user_id,
                      developer_user_id = EXCLUDED.developer_user_id,
                      printed_at = EXCLUDED.printed_at,
                      platform_returned_at = EXCLUDED.platform_returned_at,
                      exception_reviewed_at = EXCLUDED.exception_reviewed_at,
                      platform_specified_handover_at =
                        EXCLUDED.platform_specified_handover_at,
                      platform_label_requested_at =
                        EXCLUDED.platform_label_requested_at,
                      delivery_deadline_at = EXCLUDED.delivery_deadline_at,
                      cancelled_at = EXCLUDED.cancelled_at,
                      handed_over_at = EXCLUDED.handed_over_at,
                      delivered_at = EXCLUDED.delivered_at
                    """);
        }

        var repository = new OrderListQueryRepository(
                new NamedParameterJdbcTemplate(
                        new DriverManagerDataSource(
                                jdbcUrl,
                                username,
                                password)));
        UUID tenantA = UUID.fromString(
                "92000000-0000-0000-0000-000000000001");
        UUID orderA = UUID.fromString(
                "92000000-0000-0000-0000-000000000020");

        for (String keyword : List.of(
                "track-shared-1122",
                "secondary-3344",
                "txn-shared-7788",
                "internal-shared-4455")) {
            Query query = new Query(
                    null, null, null, null, null, null, null, null,
                    null, null, null, null, null, null, null, null,
                    null, null, keyword, null);
            assertThat(repository.search(
                    tenantA, query, 0, 50, true, java.util.Set.of()).items())
                    .singleElement()
                    .satisfies(item -> {
                        assertThat(item.id()).isEqualTo(orderA);
                        assertThat(item.shopName()).isEqualTo("Shop A");
                        assertThat(item.salesRecordNumber())
                                .isEqualTo("TXN-SHARED-7788");
                        assertThat(item.shoppingCartReference())
                                .isEqualTo("CART-SHARED-9900");
                        assertThat(item.customOrderReference())
                                .isEqualTo("INTERNAL-SHARED-4455");
                        assertThat(item.trackingReference())
                                .isEqualTo("TRACK-SHARED-1122");
                        assertThat(item.secondaryTrackingReference())
                                .isEqualTo("TRACK-SHARED-SECONDARY-3344");
                        assertThat(item.actualPaidMinor()).isEqualTo(900L);
                        assertThat(item.profitMinor()).isEqualTo(-50L);
                        assertThat(item.actualShippingMinor()).isEqualTo(150L);
                        assertThat(item.itemAmountMinor()).isEqualTo(800L);
                        assertThat(item.platformFeeMinor()).isEqualTo(40L);
                        assertThat(item.insuranceFeeMinor()).isEqualTo(10L);
                        assertThat(item.paymentFeeMinor()).isEqualTo(20L);
                        assertThat(item.otherIncomeMinor()).isEqualTo(30L);
                        assertThat(item.otherExpenseMinor()).isEqualTo(25L);
                        assertThat(item.taxMinor()).isEqualTo(-5L);
                        assertThat(item.estimatedShippingMinor()).isEqualTo(140L);
                        assertThat(item.salespersonDisplayName())
                                .isEqualTo("Order Runtime Actor");
                        assertThat(item.managerDisplayName())
                                .isEqualTo("Order Runtime Actor");
                        assertThat(item.orderRemark()).isEqualTo("TENANT-A-REMARK");
                        assertThat(item.customerCategory()).isEqualTo("VIP-A");
                        assertThat(item.productKindCount()).isEqualTo(2);
                        assertThat(item.supplierReference()).isEqualTo("SUP-A");
                        assertThat(item.parentProductCategory()).isEqualTo("HOME-A");
                        assertThat(item.childProductCategory()).isEqualTo("LIGHTING-A");
                        assertThat(item.productStatus()).isEqualTo("ACTIVE-A");
                        assertThat(item.extendedAttribute()).isEqualTo("FRAGILE-A");
                        assertThat(item.warehouseDisplayName())
                                .isEqualTo("Order Warehouse");
                        assertThat(item.locationBusinessCode())
                                .isEqualTo("PICK_A01");
                        assertThat(item.pickerDisplayName())
                                .isEqualTo("Order Runtime Actor");
                        assertThat(item.shipperDisplayName())
                                .isEqualTo("Order Runtime Actor");
                        assertThat(item.purchaserDisplayName())
                                .isEqualTo("Order Runtime Actor");
                        assertThat(item.developerDisplayName())
                                .isEqualTo("Order Runtime Actor");
                        assertThat(item.printedAt())
                                .isEqualTo(Instant.parse("2026-07-21T00:00:00Z"));
                        assertThat(item.platformReturnedAt())
                                .isEqualTo(Instant.parse("2026-07-22T00:00:00Z"));
                        assertThat(item.exceptionReviewedAt())
                                .isEqualTo(Instant.parse("2026-07-23T00:00:00Z"));
                        assertThat(item.platformSpecifiedHandoverAt())
                                .isEqualTo(Instant.parse("2026-07-24T00:00:00Z"));
                        assertThat(item.platformLabelRequestedAt())
                                .isEqualTo(Instant.parse("2026-07-25T00:00:00Z"));
                        assertThat(item.deliveryDeadlineAt())
                                .isEqualTo(Instant.parse("2026-07-26T00:00:00Z"));
                        assertThat(item.cancelledAt())
                                .isEqualTo(Instant.parse("2026-07-27T00:00:00Z"));
                        assertThat(item.handedOverAt())
                                .isEqualTo(Instant.parse("2026-07-28T00:00:00Z"));
                        assertThat(item.deliveredAt())
                                .isEqualTo(Instant.parse("2026-07-29T00:00:00Z"));
                    });
        }
    }

    @Test
    void appliesV47WithExactPermissionsTenantAdminGrantsAndTenantConstraints() throws Exception {
        try (Connection connection = connection(); Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery("""
                        SELECT
                          (SELECT count(*) FROM flyway_schema_history
                           WHERE version = '46' AND success),
                          (SELECT count(*) FROM permissions
                           WHERE code IN (
                             'fulfillments.read', 'fulfillments.allocate.write',
                             'fulfillments.pick.write', 'fulfillments.pack.write',
                             'fulfillments.ship.write',
                             'fulfillments.ship.correct.write',
                             'fulfillments.cancel.write',
                             'fulfillments.exception.write',
                             'orders.transfer.read', 'orders.transfer.write'
                           )),
                          (SELECT count(*)
                           FROM role_permissions grant_row
                           JOIN roles role
                             ON role.tenant_id = grant_row.tenant_id
                            AND role.id = grant_row.role_id
                           JOIN permissions permission
                             ON permission.id = grant_row.permission_id
                           WHERE role.system_role
                             AND role.code = 'tenant_admin'
                             AND permission.code IN (
                               'fulfillments.read', 'fulfillments.allocate.write',
                               'fulfillments.pick.write', 'fulfillments.pack.write',
                               'fulfillments.ship.write',
                               'fulfillments.ship.correct.write',
                               'fulfillments.cancel.write',
                               'fulfillments.exception.write',
                               'orders.transfer.read', 'orders.transfer.write'
                             ))
                        """)) {
            result.next();
            assertThat(result.getInt(1)).isOne();
            assertThat(result.getInt(2)).isEqualTo(10);
            assertThat(result.getInt(3)).isGreaterThanOrEqualTo(10);
        }

        seed();
        try (Connection connection = connection(); Statement statement = connection.createStatement()) {
            assertThatThrownBy(() -> statement.executeUpdate("""
                    INSERT INTO tenant_fulfillment_plans (
                      id, tenant_id, order_id, shop_id, source_order_version,
                      external_order_ref_snapshot, planned_quantity,
                      creation_idempotency_key, request_fingerprint
                    ) VALUES (
                      '46000000-0000-0000-0000-000000000099',
                      '92000000-0000-0000-0000-000000000002',
                      '92000000-0000-0000-0000-000000000020',
                      '92000000-0000-0000-0000-000000000011',
                      0, 'cross-tenant', 1, 'cross-tenant', repeat('a', 64)
                    )
                    """)).hasMessageContaining("fk_tenant_fulfillment_plans_order");
        }
    }

    @Test
    void transferHistoryIsTenantScopedAndDeterministicallyPagedOnPostgresql16()
            throws Exception {
        seed();
        try (Connection connection = connection(); Statement statement = connection.createStatement()) {
            statement.executeUpdate("""
                    INSERT INTO tenant_order_transfer_jobs (
                      id, tenant_id, job_type, status, requested_count,
                      succeeded_count, failed_count, object_reference,
                      created_at, completed_at
                    ) VALUES
                      ('46000000-0000-0000-0000-000000000090',
                       '92000000-0000-0000-0000-000000000001',
                       'EXPORT', 'SUCCEEDED', 2, 2, 0, 'inline:a.csv',
                       '2026-07-30T00:00:00Z', '2026-07-30T00:00:01Z'),
                      ('46000000-0000-0000-0000-000000000091',
                       '92000000-0000-0000-0000-000000000001',
                       'IMPORT', 'FAILED', 1, 0, 1, NULL,
                       '2026-07-30T00:00:00Z', '2026-07-30T00:00:02Z'),
                      ('46000000-0000-0000-0000-000000000092',
                       '92000000-0000-0000-0000-000000000002',
                       'EXPORT', 'SUCCEEDED', 1, 1, 0, 'inline:tenant-b.csv',
                       '2026-07-31T00:00:00Z', '2026-07-31T00:00:01Z')
                    ON CONFLICT (id) DO NOTHING
                    """);
        }

        var repository = new OrderTransferRepository(new JdbcTemplate(
                new DriverManagerDataSource(jdbcUrl, username, password)));
        UUID tenantA = UUID.fromString("92000000-0000-0000-0000-000000000001");
        UUID tenantBJob = UUID.fromString("46000000-0000-0000-0000-000000000092");

        assertThat(repository.count(tenantA)).isEqualTo(2);
        assertThat(repository.list(tenantA, 0, 1))
                .extracting(OrderTransferRepository.TransferJob::id)
                .containsExactly(UUID.fromString(
                        "46000000-0000-0000-0000-000000000091"))
                .doesNotContain(tenantBJob);
        assertThat(repository.list(tenantA, 1, 1))
                .extracting(OrderTransferRepository.TransferJob::id)
                .containsExactly(UUID.fromString(
                        "46000000-0000-0000-0000-000000000090"))
                .doesNotContain(tenantBJob);
    }

    @Test
    void appliesV33AndBackfillsHistoricalMatchSources() throws Exception {
        try (Connection connection = connection(); Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery("""
                        SELECT
                          (SELECT count(*) FROM flyway_schema_history WHERE version = '33' AND success),
                          (SELECT sku_match_source FROM tenant_order_lines
                           WHERE id = '92000000-0000-0000-0000-000000000040'),
                          (SELECT sku_match_source FROM tenant_order_lines
                           WHERE id = '92000000-0000-0000-0000-000000000041')
                        """)) {
            result.next();
            assertThat(result.getInt(1)).isOne();
            assertThat(result.getString(2)).isEqualTo("PROVIDED");
            assertThat(result.getString(3)).isEqualTo("UNMATCHED");
        }
    }

    @Test
    void baselineMigrationsReachV34WithoutOrderMigrationChanges() throws Exception {
        try (Connection connection = connection(); Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery("""
                        SELECT count(*)
                        FROM flyway_schema_history
                        WHERE version = '34' AND success
                        """)) {
            result.next();
            assertThat(result.getInt(1)).isOne();
        }
    }

    @Test
    void orderMigrationsDoNotDeclareRoleGrants() throws Exception {
        for (String migration : List.of(
                "/db/migration/V32__order_center.sql",
                "/db/migration/V33__order_line_sku_matching.sql")) {
            try (var stream = OrderMigrationIntegrationTest.class.getResourceAsStream(migration)) {
                assertThat(stream).isNotNull();
                String sql = new String(stream.readAllBytes(), StandardCharsets.UTF_8);
                assertThat(sql.toLowerCase()).doesNotContain("role_permissions");
            }
        }
    }

    @Test
    void databaseEnforcesTenantForeignKeysUniquenessAndAmounts() throws Exception {
        seed();
        try (Connection connection = connection(); Statement statement = connection.createStatement()) {
            assertThatThrownBy(() -> statement.executeUpdate("""
                    INSERT INTO tenant_orders (tenant_id, shop_id, external_order_ref, idempotency_key,
                      request_fingerprint, currency, line_count, placed_at)
                    VALUES ('92000000-0000-0000-0000-000000000002',
                      '92000000-0000-0000-0000-000000000010', 'cross-shop', 'cross-shop',
                      repeat('b',64), 'USD', 1, now())
                    """)).hasMessageContaining("fk_tenant_orders_shop");
            assertThatThrownBy(() -> statement.executeUpdate("""
                    INSERT INTO tenant_orders (tenant_id, shop_id, external_order_ref, idempotency_key,
                      request_fingerprint, currency, line_count, placed_at)
                    VALUES ('92000000-0000-0000-0000-000000000001',
                      '92000000-0000-0000-0000-000000000010', 'order-one', 'duplicate-ref',
                      repeat('c',64), 'USD', 1, now())
                    """)).hasMessageContaining("uq_tenant_orders_external_ref");
            assertThatThrownBy(() -> statement.executeUpdate("""
                    INSERT INTO tenant_orders (tenant_id, shop_id, external_order_ref, idempotency_key,
                      request_fingerprint, currency, line_count, placed_at)
                    VALUES ('92000000-0000-0000-0000-000000000001',
                      '92000000-0000-0000-0000-000000000010', 'different-order', 'idem-one',
                      repeat('c',64), 'USD', 1, now())
                    """)).hasMessageContaining("uq_tenant_orders_idempotency");
            assertThatThrownBy(() -> statement.executeUpdate("""
                    INSERT INTO tenant_order_lines (tenant_id, order_id, external_line_ref,
                      title_snapshot, quantity, unit_price_minor, currency, sku_match_source)
                    VALUES ('92000000-0000-0000-0000-000000000002',
                      '92000000-0000-0000-0000-000000000020',
                      'cross-order', 'Cross', 1, 1, 'USD', 'UNMATCHED')
                    """)).hasMessageContaining("fk_tenant_order_lines_order");
            assertThatThrownBy(() -> statement.executeUpdate("""
                    INSERT INTO tenant_order_lines (tenant_id, order_id, sku_id, external_line_ref,
                      title_snapshot, quantity, unit_price_minor, currency, sku_match_source)
                    VALUES ('92000000-0000-0000-0000-000000000002',
                      '92000000-0000-0000-0000-000000000021',
                      '92000000-0000-0000-0000-000000000031', 'cross-sku', 'Cross', 1, 1, 'USD', 'PROVIDED')
                    """)).hasMessageContaining("fk_tenant_order_lines_sku");
            assertThatThrownBy(() -> statement.executeUpdate("""
                    INSERT INTO tenant_order_lines (tenant_id, order_id, external_line_ref,
                      title_snapshot, quantity, unit_price_minor, currency, sku_match_source)
                    VALUES ('92000000-0000-0000-0000-000000000001',
                      '92000000-0000-0000-0000-000000000020', 'line-one', 'Duplicate', 1, 1, 'USD', 'UNMATCHED')
                    """)).hasMessageContaining("uq_tenant_order_lines_external_ref");
            assertThatThrownBy(() -> statement.executeUpdate("""
                    INSERT INTO tenant_order_lines (tenant_id, order_id, external_line_ref,
                      title_snapshot, quantity, unit_price_minor, currency, sku_match_source)
                    VALUES ('92000000-0000-0000-0000-000000000001',
                      '92000000-0000-0000-0000-000000000020', 'bad-amount', 'Bad', 0, -1, 'USD', 'UNMATCHED')
                    """)).hasMessageContaining("ck_tenant_order_lines_quantity");
            assertThatThrownBy(() -> statement.executeUpdate("""
                    INSERT INTO tenant_order_lines (tenant_id, order_id, external_line_ref,
                      title_snapshot, quantity, unit_price_minor, currency, sku_match_source)
                    VALUES ('92000000-0000-0000-0000-000000000001',
                      '92000000-0000-0000-0000-000000000020', 'negative-amount', 'Bad', 1, -1, 'USD', 'UNMATCHED')
                    """)).hasMessageContaining("ck_tenant_order_lines_unit_price");
            assertThatThrownBy(() -> statement.executeUpdate("""
                    UPDATE tenant_order_lines
                    SET external_variant_ref = 'variant-without-listing'
                    WHERE id = '92000000-0000-0000-0000-000000000040'
                    """)).hasMessageContaining("ck_tenant_order_lines_variant_ref");
            assertThatThrownBy(() -> statement.executeUpdate("""
                    UPDATE tenant_order_lines
                    SET external_listing_ref = ' '
                    WHERE id = '92000000-0000-0000-0000-000000000040'
                    """)).hasMessageContaining("ck_tenant_order_lines_listing_ref");
            assertThatThrownBy(() -> statement.executeUpdate("""
                    UPDATE tenant_order_lines
                    SET sku_match_source = 'UNMATCHED'
                    WHERE id = '92000000-0000-0000-0000-000000000040'
                    """)).hasMessageContaining("ck_tenant_order_lines_match_consistency");
            assertThatThrownBy(() -> statement.executeUpdate("""
                    UPDATE tenant_order_lines
                    SET sku_match_source = 'MANUAL'
                    WHERE id = '92000000-0000-0000-0000-000000000041'
                    """)).hasMessageContaining("ck_tenant_order_lines_match_consistency");
            assertThatThrownBy(() -> statement.executeUpdate("""
                    UPDATE tenant_order_lines
                    SET sku_match_source = 'UNKNOWN'
                    WHERE id = '92000000-0000-0000-0000-000000000041'
                    """)).hasMessageContaining("ck_tenant_order_lines_match");
        }
    }

    @Test
    void hibernateValidatesV34AndExecutesOrderReadWriteRules() throws Exception {
        seed();
        seedQueueFixtures();
        StandardEnvironment environment = new StandardEnvironment();
        environment.getPropertySources().addFirst(new MapPropertySource("order-schema-test", Map.of(
                "server.port", "0", "spring.datasource.url", jdbcUrl,
                "spring.datasource.username", username, "spring.datasource.password", password,
                "erp.environment", "integration-test")));
        try (ConfigurableApplicationContext context = new SpringApplicationBuilder(ErpApplication.class)
                .web(WebApplicationType.SERVLET).environment(environment).run()) {
            assertThat(context.getBean(OrderRepository.class)).isNotNull();
            OrderCenterService service = context.getBean(OrderCenterService.class);
            FulfillmentService fulfillmentService = context.getBean(FulfillmentService.class);
            ShippingConfigurationService shippingConfiguration =
                    context.getBean(ShippingConfigurationService.class);
            ShippingWeighingService shippingWeighing =
                    context.getBean(ShippingWeighingService.class);
            TrackingNumberService trackingNumbers =
                    context.getBean(TrackingNumberService.class);
            ProductCenterService productService = context.getBean(ProductCenterService.class);
            UUID tenantA = UUID.fromString("92000000-0000-0000-0000-000000000001");
            UUID tenantB = UUID.fromString("92000000-0000-0000-0000-000000000002");
            UUID shopA = UUID.fromString("92000000-0000-0000-0000-000000000010");
            UUID shopB = UUID.fromString("92000000-0000-0000-0000-000000000011");

            assertThat(productService.listSpus(
                    tenantA, null, null, PageRequest.of(0, 50)).getTotalElements()).isOne();
            assertThat(productService.listSkus(
                    tenantA, null, null, null, PageRequest.of(0, 50)).getTotalElements()).isOne();
            assertThat(productService.listListings(
                    tenantA, null, null, null, null, PageRequest.of(0, 50)).getTotalElements()).isOne();
            assertThat(productService.listSpus(
                    tenantA, null, "missing-product", PageRequest.of(0, 50)).getTotalElements()).isZero();
            assertThat(productService.listSkus(
                    tenantA, null, null, "order_sku", PageRequest.of(0, 50)).getTotalElements()).isOne();
            assertThat(productService.listSkusWithMasterIdentity(
                    tenantA, null, null, "order_sku", "INVENTORY_SKU",
                    "CONTAINS", PageRequest.of(0, 50)).getContent())
                    .singleElement()
                    .satisfies(item -> {
                        assertThat(item.master().getBusinessCode())
                                .isEqualTo("ORDER_SPU");
                        assertThat(item.master().getName())
                                .isEqualTo("Order SPU");
                        assertThat(item.thumbnail()).isNotNull();
                        assertThat(item.thumbnail().getId()).isEqualTo(
                                UUID.fromString(
                                        "92000000-0000-0000-0000-000000000032"));
                    });
            assertThat(productService.listSkus(
                    tenantA, null, null, "order widget", "NAME_EN",
                    PageRequest.of(0, 50)).getTotalElements()).isOne();
            assertThat(productService.listSkus(
                    tenantA, null, null, "order", "NAME_EN",
                    "STARTS_WITH", PageRequest.of(0, 50))
                    .getTotalElements()).isOne();
            assertThat(productService.listSkus(
                    tenantA, null, null, "widget", "NAME_EN",
                    "ENDS_WITH", PageRequest.of(0, 50))
                    .getTotalElements()).isOne();
            assertThat(productService.listSkus(
                    tenantA, null, null, "order widget", "NAME_EN",
                    "EQUALS", PageRequest.of(0, 50))
                    .getTotalElements()).isOne();
            assertThat(productService.listSkus(
                    tenantA, null, null, null, "NAME_EN",
                    "EMPTY", PageRequest.of(0, 50))
                    .getTotalElements()).isZero();
            assertThat(productService.listSkus(
                    tenantA, null, null, null, "NAME_EN",
                    "NOT_EMPTY", PageRequest.of(0, 50))
                    .getTotalElements()).isOne();
            assertThat(productService.listSkus(
                    tenantA, null, null, "order_spu", "MASTER_CODE",
                    PageRequest.of(0, 50)).getTotalElements()).isOne();
            assertThat(productService.listSkus(
                    tenantA, null, null, "order widget", "INVENTORY_SKU",
                    PageRequest.of(0, 50)).getTotalElements()).isZero();
            assertThat(productService.listListings(
                    tenantA, null, null, null, "RuNtImE-", PageRequest.of(0, 50))
                    .getTotalElements()).isOne();
            assertThat(productService.listSpus(
                    tenantB, null, null, PageRequest.of(0, 50)).getTotalElements()).isZero();

            assertThat(service.listOrders(
                    tenantA, null, null, null, PageRequest.of(0, 50)).getTotalElements())
                    .isGreaterThanOrEqualTo(1);
            assertThat(service.listOrders(
                    tenantA, null, null, "%", PageRequest.of(0, 50)).getTotalElements()).isZero();
            assertThat(service.listOrders(
                    tenantA, null, null, "OrDeR-OnE", PageRequest.of(0, 50)).getContent())
                    .singleElement().extracting(order -> order.getExternalOrderRef()).isEqualTo("order-one");
            assertThat(service.listOrders(
                    tenantB, null, null, null, PageRequest.of(0, 50)).getContent())
                    .allSatisfy(order -> assertThat(order.getTenantId()).isEqualTo(tenantB))
                    .extracting(order -> order.getExternalOrderRef())
                    .contains("order-two")
                    .doesNotContain("order-one");

            OrderActor actor = new OrderActor(
                    tenantA,
                    UUID.fromString(
                            "92000000-0000-0000-0000-000000000004"),
                    "runtime-idempotency");
            CreateOrderCommand command = new CreateOrderCommand(
                    UUID.fromString("92000000-0000-0000-0000-000000000010"),
                    "runtime-order", "runtime-idem", "USD", "runtime-buyer",
                    Instant.parse("2026-07-28T00:00:00Z"),
                    List.of(new CreateLineCommand(null, "runtime-listing", "runtime-variant",
                            "runtime-line", "Runtime item", 1, 100, "USD")));
            var created = service.createOrder(actor, command);
            var replay = service.createOrder(actor, command);
            assertThat(replay.order().getId()).isEqualTo(created.order().getId());
            assertThat(created.lines()).singleElement().satisfies(line -> {
                assertThat(line.getSkuId()).isEqualTo(
                        UUID.fromString("92000000-0000-0000-0000-000000000031"));
                assertThat(line.getSkuMatchSource().name()).isEqualTo("LISTING_MAPPING");
            });
            UUID lineId = created.lines().getFirst().getId();
            var unmatched = service.changeLineSkuMatch(actor, created.order().getId(), lineId, 0, null);
            assertThat(unmatched.order().getVersion()).isEqualTo(1);
            var pending = service.changeStatus(actor, created.order().getId(), 1,
                    OrderStatus.REVIEW_PENDING, null);
            assertThat(pending.order().getVersion()).isEqualTo(2);
            assertThatThrownBy(() -> service.changeStatus(actor, created.order().getId(), 2,
                    OrderStatus.READY_TO_FULFILL, null)).isInstanceOf(ConflictException.class);
            var manuallyMatched = service.changeLineSkuMatch(actor, created.order().getId(), lineId, 2,
                    UUID.fromString("92000000-0000-0000-0000-000000000031"));
            assertThat(manuallyMatched.order().getVersion()).isEqualTo(3);
            var idempotent = service.changeLineSkuMatch(actor, created.order().getId(), lineId, 3,
                    UUID.fromString("92000000-0000-0000-0000-000000000031"));
            assertThat(idempotent.order().getVersion()).isEqualTo(3);
            var ready = service.changeStatus(actor, created.order().getId(), 3,
                    OrderStatus.READY_TO_FULFILL, null);
            assertThat(ready.order().getVersion()).isEqualTo(4);

            var fulfillmentActor = new FulfillmentService.Actor(
                    tenantA, actor.userId(), null, "order-pg-fulfillment", "127.0.0.1");
            var plan = fulfillmentService.create(
                    fulfillmentActor, created.order().getId(), "order-pg-plan");
            UUID allocationCommand = UUID.fromString(
                    "46000000-0000-0000-0000-000000000090");
            var allocated = fulfillmentService.allocate(
                    fulfillmentActor, plan.id(), plan.version(), allocationCommand,
                    List.of(new Allocation(
                            lineId, 1,
                            UUID.fromString("92000000-0000-0000-0000-000000000060"),
                            null)));
            assertThat(allocated.shortageState().name()).isEqualTo("PARTIAL");
            assertThat(allocated.lines()).singleElement().satisfies(line -> {
                assertThat(line.warehouseId()).isEqualTo(
                        UUID.fromString("92000000-0000-0000-0000-000000000060"));
                assertThat(line.inventoryOperationRef())
                        .startsWith("inventory-reservation:");
            });
            assertThat(fulfillmentService.allocate(
                    fulfillmentActor, plan.id(), plan.version(), allocationCommand,
                    List.of(new Allocation(
                            lineId, 1,
                            UUID.fromString("92000000-0000-0000-0000-000000000060"),
                        null))).id()).isEqualTo(plan.id());
            assertThat(countInventoryReservations()).isOne();
            assertThat(service.getOrder(actor, created.order().getId())
                    .order().getStatus()).isEqualTo(OrderStatus.FULFILLING);

            var picked = fulfillmentService.recordPick(
                    fulfillmentActor, allocated.id(), allocated.version(),
                    UUID.fromString(
                            "46000000-0000-0000-0000-000000000091"),
                    List.of(new QuantityChange(
                            allocated.lines().getFirst().id(), 1)));
            var packed = fulfillmentService.createPackage(
                    fulfillmentActor, picked.id(), picked.version(),
                    UUID.fromString(
                            "46000000-0000-0000-0000-000000000092"),
                    UUID.fromString(
                            "92000000-0000-0000-0000-000000000060"),
                    "ORDER-PACKAGE-1",
                    List.of(new PackageItem(
                            picked.lines().getFirst().id(), 1)));
            var draftPackage = packed.packages().getFirst();
            context.getBean(JdbcTemplate.class).update("""
                    update tenant_product_skus
                    set standard_weight_grams = 700
                    where tenant_id = ? and id = ?
                    """, tenantA,
                    UUID.fromString("92000000-0000-0000-0000-000000000031"));
            var configurationActor = new ShippingConfigurationService.Actor(
                    tenantA, actor.userId(), null, "order-pg-shipping-config", "127.0.0.1");
            var packaging = shippingConfiguration.createTemplate(
                    configurationActor, "BOX_ORDER", "Order test box", "BOX",
                    50, 200, 150, 100);
            shippingConfiguration.setWarehousePackaging(
                    configurationActor, draftPackage.warehouseId(), packaging.id(), true);
            UUID configuredSkuId = UUID.fromString(
                    "92000000-0000-0000-0000-000000000031");
            var packagingRule = shippingConfiguration.createRule(
                    configurationActor, configuredSkuId, 1, 1, packaging.id());
            var inactiveRule = shippingConfiguration.updateRule(
                    configurationActor, configuredSkuId, packagingRule.id(),
                    packagingRule.version(), 1, 1, packaging.id(), "INACTIVE");
            var activeRule = shippingConfiguration.updateRule(
                    configurationActor, configuredSkuId, inactiveRule.id(),
                    inactiveRule.version(), 1, 1, packaging.id(), "ACTIVE");
            assertThat(activeRule.status()).isEqualTo("ACTIVE");
            assertThat(shippingConfiguration.listRules(tenantA, configuredSkuId))
                    .singleElement()
                    .extracting(rule -> rule.version())
                    .isEqualTo(2L);
            var scale = shippingConfiguration.createScale(
                    configurationActor, draftPackage.warehouseId(),
                    "ORDER-SCALE-1", "Order test scale");
            var weighingActor = new ShippingWeighingService.Actor(
                    tenantA, actor.userId(), null, "order-pg-weighing", "127.0.0.1");
            var assigned = shippingWeighing.assignPackaging(
                    weighingActor, packed.id(), draftPackage.id(),
                    draftPackage.version(), packaging.id());
            var sealed = fulfillmentService.sealPackage(
                    fulfillmentActor, packed.id(), draftPackage.id(),
                    packed.version(), assigned.packageVersion(),
                    UUID.fromString(
                            "46000000-0000-0000-0000-000000000093"));
            var sealedPackage = sealed.packages().getFirst();
            Instant handoverAt = Instant.now().minusSeconds(5);
            shippingWeighing.weigh(
                    weighingActor, sealed.id(), sealedPackage.id(),
                    sealedPackage.version(),
                    UUID.fromString("46000000-0000-0000-0000-000000000097"),
                    scale.id(), 750, handoverAt.minusSeconds(1));
            var weighed = fulfillmentService.get(fulfillmentActor, sealed.id());
            var weighedPackage = weighed.packages().getFirst();
            var trackingActor = new TrackingNumberService.Actor(
                    tenantA, actor.userId(), null,
                    "order-pg-tracking-numbers", "127.0.0.1");
            trackingNumbers.importNumbers(
                    trackingActor, "DOMESTIC_EXPRESS", "LOCAL_CARRIER",
                    List.of("TRACK-ORDER-1"));
            var handedOver = fulfillmentService.handover(
                    fulfillmentActor, weighed.id(), weighedPackage.id(),
                    weighed.version(), weighedPackage.version(),
                    UUID.fromString(
                            "46000000-0000-0000-0000-000000000094"),
                    handoverAt,
                    "LOCAL_CARRIER", "STANDARD", "TRACK-ORDER-1");
            assertThat(handedOver.status().name()).isEqualTo("SHIPPED");
            assertThat(trackingNumbers.list(
                    trackingActor, "DOMESTIC_EXPRESS", "USED", null,
                    "TRACKING_NO", "TRACK-ORDER-1", PageRequest.of(0, 25))
                    .getContent()).singleElement().satisfies(number -> {
                        assertThat(number.orderReference()).isEqualTo("runtime-order");
                        assertThat(number.packageNumber()).isEqualTo("ORDER-PACKAGE-1");
                        assertThat(number.usedAt()).isBetween(
                                handoverAt.minusNanos(1_000),
                                handoverAt.plusNanos(1_000));
                    });
            assertInventoryProjection(-1, 0, -1, 1, 0, 0);

            var handedPackage = handedOver.packages().getFirst();
            CountDownLatch correctionStart = new CountDownLatch(1);
            Object firstCorrection;
            Object secondCorrection;
            try (var executor = Executors.newFixedThreadPool(2)) {
                var first = executor.submit(() -> concurrentCorrection(
                        correctionStart, fulfillmentService, fulfillmentActor,
                        handedOver, handedPackage.id(),
                        handedPackage.version(),
                        UUID.fromString(
                                "46000000-0000-0000-0000-000000000095")));
                var second = executor.submit(() -> concurrentCorrection(
                        correctionStart, fulfillmentService, fulfillmentActor,
                        handedOver, handedPackage.id(),
                        handedPackage.version(),
                        UUID.fromString(
                                "46000000-0000-0000-0000-000000000096")));
                correctionStart.countDown();
                firstCorrection = first.get(20, TimeUnit.SECONDS);
                secondCorrection = second.get(20, TimeUnit.SECONDS);
            }
            assertThat(List.of(firstCorrection, secondCorrection)
                    .stream().filter(Plan.class::isInstance).count()).isOne();
            assertThat(List.of(firstCorrection, secondCorrection)
                    .stream().filter(
                            FulfillmentExceptions.Conflict.class::isInstance)
                    .count()).isOne();
            Plan corrected = (Plan) List.of(firstCorrection, secondCorrection)
                    .stream().filter(Plan.class::isInstance)
                    .findFirst().orElseThrow();
            assertInventoryProjection(0, 1, -1, 1, 1, 1);
            var cancelled = fulfillmentService.cancelOpen(
                    fulfillmentActor, corrected.id(), corrected.version(),
                    UUID.fromString(
                            "46000000-0000-0000-0000-000000000097"),
                    "CUSTOMER_CANCELLED");
            assertThat(cancelled.status().name()).isEqualTo("CANCELLED");
            assertInventoryProjection(0, 0, 0, 1, 1, 1);
            assertThat(service.getOrder(actor, created.order().getId())
                    .order().getStatus()).isEqualTo(OrderStatus.CANCELLED);

            try (Connection connection = connection();
                    Statement statement = connection.createStatement()) {
                statement.executeUpdate("""
                        DELETE FROM tenant_user_warehouse_scope_items
                        WHERE tenant_id =
                          '92000000-0000-0000-0000-000000000001'
                          AND user_id =
                          '92000000-0000-0000-0000-000000000004'
                        """);
                statement.executeUpdate("""
                        UPDATE tenant_user_warehouse_scopes
                        SET mode = 'SELECTED', version = version + 1
                        WHERE tenant_id =
                          '92000000-0000-0000-0000-000000000001'
                          AND user_id =
                          '92000000-0000-0000-0000-000000000004'
                        """);
            }
            Query emptyQuery = new Query(
                    null, null, null, null, null, null, null, null,
                    null, null, null, null, null, null, null, null,
                    null, null, null, null);
            assertThat(service.searchOrders(
                    actor, emptyQuery, 0, 50).items()).isEmpty();
            assertThat(service.dashboardSummary(actor, null).totalOrders())
                    .isZero();
            assertThat(service.listSkuMatchQueue(
                    actor, null, null, PageRequest.of(0, 50)))
                    .isEmpty();
            assertThat(fulfillmentService.list(
                    fulfillmentActor, null, null, null, 0, 50)
                    .items()).isEmpty();
            assertThatThrownBy(() -> service.getOrder(
                    actor, created.order().getId()))
                    .isInstanceOf(ResourceNotFoundException.class);
            assertThatThrownBy(() -> fulfillmentService.get(
                    fulfillmentActor, plan.id()))
                    .isInstanceOf(FulfillmentExceptions.NotFound.class);

            try (Connection connection = connection();
                    Statement statement = connection.createStatement()) {
                statement.executeUpdate("""
                        INSERT INTO tenant_user_warehouse_scope_items (
                          tenant_id, user_id, warehouse_id
                        ) VALUES (
                          '92000000-0000-0000-0000-000000000001',
                          '92000000-0000-0000-0000-000000000004',
                          '92000000-0000-0000-0000-000000000060'
                        )
                        """);
            }
            assertThat(service.getOrder(
                    actor, created.order().getId()).order().getId())
                    .isEqualTo(created.order().getId());
            Query warehouseQuery = new Query(
                    null,
                    UUID.fromString(
                            "92000000-0000-0000-0000-000000000060"),
                    null, null, null, null, null, null, null, null,
                    null, null, null, null, null, null, null, null,
                    null, null);
            assertThat(service.searchOrders(
                    actor, warehouseQuery, 0, 50).items())
                    .extracting(OrderListItem::id)
                    .contains(created.order().getId());
            assertThat(fulfillmentService.get(
                    fulfillmentActor, plan.id()).id()).isEqualTo(plan.id());
            try (Connection connection = connection(); Statement statement = connection.createStatement();
                    ResultSet audit = statement.executeQuery("""
                            SELECT action, request_id, details::text
                            FROM audit_logs
                            WHERE tenant_id = '92000000-0000-0000-0000-000000000001'
                              AND action IN ('order.created', 'order.line.sku_matched', 'order.line.sku_unmatched')
                            ORDER BY created_at, action
                            """)) {
                int rows = 0;
                while (audit.next()) {
                    rows++;
                    assertThat(audit.getString(2)).isEqualTo("runtime-idempotency");
                    assertThat(audit.getString(3))
                            .doesNotContain("runtime-buyer", "Runtime item", "runtime-idem",
                                    "runtime-listing", "runtime-variant",
                                    "unitPriceMinor", "price", "amount");
                    if ("order.created".equals(audit.getString(1))) {
                        assertThat(audit.getString(3)).contains(
                                "automaticMatchCount", "unmatchedCount", "\"1\"", "\"0\"");
                    }
                }
                assertThat(rows).isEqualTo(3);
            }

            long auditsBeforeQueue = countAuditLogs();
            var firstPage = service.listSkuMatchQueue(
                    tenantA, null, null, PageRequest.of(0, 2));
            assertThat(firstPage.getTotalElements()).isEqualTo(4);
            assertThat(firstPage.getContent()).extracting(item -> item.externalLineRef())
                    .containsExactly("a-line", "literal_%_line");
            assertThat(firstPage.getContent()).allSatisfy(item -> {
                assertThat(item.orderId()).isEqualTo(
                        UUID.fromString("92000000-0000-0000-0000-000000000060"));
                assertThat(item.skuId()).isNull();
                assertThat(item.skuMatchSource().name()).isEqualTo("UNMATCHED");
            });

            var secondPage = service.listSkuMatchQueue(
                    tenantA, null, null, PageRequest.of(1, 2));
            assertThat(secondPage.getContent()).extracting(
                            item -> item.orderId(), item -> item.externalLineRef())
                    .containsExactly(
                            org.assertj.core.groups.Tuple.tuple(
                                    UUID.fromString("92000000-0000-0000-0000-000000000061"),
                                    "hold-line"),
                            org.assertj.core.groups.Tuple.tuple(
                                    UUID.fromString("92000000-0000-0000-0000-000000000065"),
                                    "review-line"));

            assertThat(service.listSkuMatchQueue(
                    tenantA, shopA, null, PageRequest.of(0, 50)).getTotalElements()).isEqualTo(4);
            assertThatThrownBy(() -> service.listSkuMatchQueue(
                    tenantA, shopB, null, PageRequest.of(0, 50)))
                    .isInstanceOf(ResourceNotFoundException.class);

            assertThat(service.listSkuMatchQueue(
                    tenantA, null, "queue-hold", PageRequest.of(0, 50)).getContent())
                    .singleElement().extracting(item -> item.externalLineRef()).isEqualTo("hold-line");
            assertThat(service.listSkuMatchQueue(
                    tenantA, null, "literal_%_line", PageRequest.of(0, 50)).getContent())
                    .singleElement().extracting(item -> item.externalLineRef()).isEqualTo("literal_%_line");
            assertThat(service.listSkuMatchQueue(
                    tenantA, null, "%", PageRequest.of(0, 50)).getContent())
                    .singleElement().extracting(item -> item.externalLineRef()).isEqualTo("literal_%_line");
            assertThat(service.listSkuMatchQueue(
                    tenantA, null, "_", PageRequest.of(0, 50)).getContent())
                    .singleElement().extracting(item -> item.externalLineRef()).isEqualTo("literal_%_line");
            assertThat(service.listSkuMatchQueue(
                    tenantA, null, "NeEdLe TiTlE", PageRequest.of(0, 50)).getContent())
                    .singleElement().extracting(item -> item.externalLineRef()).isEqualTo("review-line");

            var tenantBQueue = service.listSkuMatchQueue(
                    tenantB, null, null, PageRequest.of(0, 50));
            assertThat(tenantBQueue.getContent()).singleElement().satisfies(item -> {
                assertThat(item.orderId()).isEqualTo(
                        UUID.fromString("92000000-0000-0000-0000-000000000064"));
                assertThat(item.shopId()).isEqualTo(shopB);
            });
            assertThat(countAuditLogs()).isEqualTo(auditsBeforeQueue);

            long tenantAVersionsBeforeSummary = sumOrderVersions(tenantA);
            var summary = service.dashboardSummary(tenantA, null);
            assertThat(summary.totalOrders()).isEqualTo(8);
            assertThat(summary.receivedOrders()).isEqualTo(1);
            assertThat(summary.reviewPendingOrders()).isEqualTo(1);
            assertThat(summary.holdOrders()).isEqualTo(1);
            assertThat(summary.readyToFulfillOrders()).isEqualTo(1);
            assertThat(summary.fulfillingOrders()).isZero();
            assertThat(summary.cancelledOrders()).isEqualTo(4);
            assertThat(summary.totalOrders()).isEqualTo(
                    summary.unpaidOrders() + summary.receivedOrders()
                            + summary.reviewPendingOrders()
                            + summary.mergePendingOrders()
                            + summary.holdOrders()
                            + summary.readyToFulfillOrders()
                            + summary.fulfillingOrders()
                            + summary.shippedOrders()
                            + summary.deliveredOrders()
                            + summary.cancelledOrders());
            assertThat(summary.editableOrders()).isEqualTo(3);
            assertThat(summary.unmatchedLines()).isEqualTo(4);
            assertThat(summary.oldestUnmatchedPlacedAt())
                    .isEqualTo(Instant.parse("2026-01-01T00:00:00Z"));

            var shopSummary = service.dashboardSummary(tenantA, shopA);
            assertThat(shopSummary.totalOrders()).isEqualTo(7);
            assertThat(shopSummary.cancelledOrders()).isEqualTo(3);
            assertThat(shopSummary.editableOrders()).isEqualTo(3);
            assertThat(shopSummary.unmatchedLines()).isEqualTo(4);
            assertThat(shopSummary.oldestUnmatchedPlacedAt())
                    .isEqualTo(Instant.parse("2026-01-01T00:00:00Z"));
            assertThatThrownBy(() -> service.dashboardSummary(tenantA, shopB))
                    .isInstanceOf(ResourceNotFoundException.class);

            var tenantBSummary = service.dashboardSummary(tenantB, null);
            assertThat(tenantBSummary.totalOrders()).isEqualTo(2);
            assertThat(tenantBSummary.receivedOrders()).isEqualTo(2);
            assertThat(tenantBSummary.unmatchedLines()).isEqualTo(1);
            assertThat(tenantBSummary.oldestUnmatchedPlacedAt())
                    .isEqualTo(Instant.parse("2026-01-01T00:00:00Z"));

            UUID emptyTenant = UUID.fromString("92000000-0000-0000-0000-000000000099");
            var emptySummary = service.dashboardSummary(emptyTenant, null);
            assertThat(emptySummary.totalOrders()).isZero();
            assertThat(emptySummary.receivedOrders()).isZero();
            assertThat(emptySummary.reviewPendingOrders()).isZero();
            assertThat(emptySummary.holdOrders()).isZero();
            assertThat(emptySummary.readyToFulfillOrders()).isZero();
            assertThat(emptySummary.cancelledOrders()).isZero();
            assertThat(emptySummary.editableOrders()).isZero();
            assertThat(emptySummary.unmatchedLines()).isZero();
            assertThat(emptySummary.oldestUnmatchedPlacedAt()).isNull();

            assertThat(sumOrderVersions(tenantA)).isEqualTo(tenantAVersionsBeforeSummary);
            assertThat(countAuditLogs()).isEqualTo(auditsBeforeQueue);
            assertQueuePlanUsesExistingUnmatchedIndex();
            assertDashboardPlanUsesExistingTenantAndUnmatchedIndexes();
        }
    }

    private static Object concurrentCorrection(
            CountDownLatch start,
            FulfillmentService service,
            FulfillmentService.Actor actor,
            Plan plan,
            UUID packageId,
            long packageVersion,
            UUID commandId) throws InterruptedException {
        start.await(10, TimeUnit.SECONDS);
        try {
            return service.correctHandover(
                    actor, plan.id(), packageId, plan.version(),
                    packageVersion, commandId, Instant.now().minusSeconds(1),
                    "WAREHOUSE_CORRECTION");
        } catch (RuntimeException exception) {
            return exception;
        }
    }

    private static void assertInventoryProjection(
            long onHand,
            long reserved,
            long available,
            int handovers,
            int corrections,
            int reversals) throws Exception {
        try (Connection connection = connection();
                Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery("""
                        SELECT
                          balance.on_hand,
                          coalesce((
                            SELECT sum(
                              reservation.quantity
                              - reservation.consumed_quantity
                              - reservation.released_quantity)
                            FROM tenant_inventory_reservations reservation
                            WHERE reservation.tenant_id = balance.tenant_id
                              AND reservation.sku_id = balance.sku_id
                              AND reservation.warehouse_id =
                                balance.warehouse_id
                          ), 0) AS reserved,
                          (SELECT count(*)
                           FROM tenant_shipment_events event
                           WHERE event.tenant_id = balance.tenant_id
                             AND event.event_type = 'HANDOVER_CONFIRMED')
                            AS handovers,
                          (SELECT count(*)
                           FROM tenant_shipment_events event
                           WHERE event.tenant_id = balance.tenant_id
                             AND event.event_type =
                               'HANDOVER_CORRECTION_RECORDED')
                            AS corrections,
                          (SELECT count(*)
                           FROM inventory_ledger_events event
                           WHERE event.tenant_id = balance.tenant_id
                             AND event.reversal_of_event_id IS NOT NULL)
                            AS reversals
                        FROM inventory_balances balance
                        WHERE balance.tenant_id =
                          '92000000-0000-0000-0000-000000000001'
                          AND balance.sku_id =
                          '92000000-0000-0000-0000-000000000031'
                          AND balance.warehouse_id =
                          '92000000-0000-0000-0000-000000000060'
                        """)) {
            assertThat(result.next()).isTrue();
            assertThat(result.getLong("on_hand")).isEqualTo(onHand);
            assertThat(result.getLong("reserved")).isEqualTo(reserved);
            assertThat(result.getLong("on_hand")
                    - result.getLong("reserved")).isEqualTo(available);
            assertThat(result.getInt("handovers")).isEqualTo(handovers);
            assertThat(result.getInt("corrections")).isEqualTo(corrections);
            assertThat(result.getInt("reversals")).isEqualTo(reversals);
        }
    }

    private static void seed() throws Exception {
        try (Connection connection = connection(); Statement statement = connection.createStatement()) {
            statement.executeUpdate("""
                    INSERT INTO tenants (id, code, name) VALUES
                      ('92000000-0000-0000-0000-000000000001', 'order_tenant_a', 'Order Tenant A'),
                      ('92000000-0000-0000-0000-000000000002', 'order_tenant_b', 'Order Tenant B'),
                      ('92000000-0000-0000-0000-000000000099', 'order_tenant_empty', 'Order Tenant Empty')
                    ON CONFLICT (id) DO NOTHING
                    """);
            statement.executeUpdate("""
                    INSERT INTO users (
                      id, tenant_id, username, display_name, status)
                    VALUES (
                      '92000000-0000-0000-0000-000000000004',
                      '92000000-0000-0000-0000-000000000001',
                      'order_runtime_actor', 'Order Runtime Actor', 'ACTIVE')
                    ON CONFLICT (id) DO NOTHING
                    """);
            statement.executeUpdate("""
                    INSERT INTO platform_catalog (id, code, display_name) VALUES
                      ('92000000-0000-0000-0000-000000000003', 'ORDER_TEST', 'Order Test')
                    ON CONFLICT (id) DO NOTHING
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_shops (id, tenant_id, platform_id, external_shop_ref, display_name) VALUES
                      ('92000000-0000-0000-0000-000000000010', '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000003', 'shop-a', 'Shop A'),
                      ('92000000-0000-0000-0000-000000000012', '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000003', 'shop-a-two', 'Shop A Two'),
                      ('92000000-0000-0000-0000-000000000011', '92000000-0000-0000-0000-000000000002',
                       '92000000-0000-0000-0000-000000000003', 'shop-b', 'Shop B')
                    ON CONFLICT (id) DO NOTHING
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_product_spus (id, tenant_id, business_code, name) VALUES
                      ('92000000-0000-0000-0000-000000000030', '92000000-0000-0000-0000-000000000001', 'ORDER_SPU', 'Order SPU')
                    ON CONFLICT (id) DO NOTHING
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_product_skus (
                      id, tenant_id, spu_id, business_code, name, name_en
                    ) VALUES
                      ('92000000-0000-0000-0000-000000000031', '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000030', 'ORDER_SKU', 'Order SKU', 'Order Widget')
                    ON CONFLICT (id) DO UPDATE
                    SET name_en = EXCLUDED.name_en
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_product_spu_images (
                      id, tenant_id, spu_id, object_key, content_type,
                      file_extension, byte_size, sha256, pixel_width,
                      pixel_height, sort_order, primary_image,
                      created_by_type, created_by
                    ) VALUES (
                      '92000000-0000-0000-0000-000000000032',
                      '92000000-0000-0000-0000-000000000001',
                      '92000000-0000-0000-0000-000000000030',
                      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png',
                      'image/png', '.png', 1,
                      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                      1, 1, 0, true, 'TENANT_USER',
                      '92000000-0000-0000-0000-000000000004'
                    )
                    ON CONFLICT (id) DO NOTHING
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_warehouses (
                      id, tenant_id, business_code, name, status
                    ) VALUES (
                      '92000000-0000-0000-0000-000000000060',
                      '92000000-0000-0000-0000-000000000001',
                      'ORDER_WH', 'Order Warehouse', 'ACTIVE'
                    )
                    ON CONFLICT (id) DO NOTHING
                    """);
            statement.executeUpdate("""
                    DELETE FROM tenant_user_warehouse_scope_items
                    WHERE tenant_id =
                      '92000000-0000-0000-0000-000000000001'
                      AND user_id =
                      '92000000-0000-0000-0000-000000000004'
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_user_warehouse_scopes (
                      tenant_id, user_id, mode
                    ) VALUES (
                      '92000000-0000-0000-0000-000000000001',
                      '92000000-0000-0000-0000-000000000004',
                      'ALL'
                    )
                    ON CONFLICT (tenant_id, user_id)
                    DO UPDATE SET mode = 'ALL'
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_product_listings (
                      id, tenant_id, shop_id, platform_id, sku_id, external_listing_ref, external_variant_ref
                    ) VALUES (
                      '92000000-0000-0000-0000-000000000050',
                      '92000000-0000-0000-0000-000000000001',
                      '92000000-0000-0000-0000-000000000010',
                      '92000000-0000-0000-0000-000000000003',
                      '92000000-0000-0000-0000-000000000031',
                      'runtime-listing', 'runtime-variant'
                    )
                    ON CONFLICT (id) DO NOTHING
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_orders (id, tenant_id, shop_id, external_order_ref, idempotency_key,
                      request_fingerprint, currency, line_count, placed_at) VALUES
                      ('92000000-0000-0000-0000-000000000020', '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000010', 'order-one', 'idem-one', repeat('a',64), 'USD', 1, now()),
                      ('92000000-0000-0000-0000-000000000021', '92000000-0000-0000-0000-000000000002',
                       '92000000-0000-0000-0000-000000000011', 'order-two', 'idem-two', repeat('b',64), 'USD', 1, now())
                    ON CONFLICT (id) DO NOTHING
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_order_lines (id, tenant_id, order_id, sku_id, external_line_ref,
                      title_snapshot, quantity, unit_price_minor, currency, sku_match_source) VALUES
                      ('92000000-0000-0000-0000-000000000040', '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000020', '92000000-0000-0000-0000-000000000031',
                       'line-one', 'Line One', 1, 100, 'USD', 'PROVIDED')
                    ON CONFLICT (id) DO NOTHING
                    """);
        }
    }

    private static void seedQueueFixtures() throws Exception {
        try (Connection connection = connection(); Statement statement = connection.createStatement()) {
            statement.executeUpdate("""
                    UPDATE tenant_orders SET status = 'CANCELLED'
                    WHERE id = '92000000-0000-0000-0000-000000000020'
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_orders (
                      id, tenant_id, shop_id, external_order_ref, idempotency_key,
                      request_fingerprint, currency, status, hold_reason, line_count, placed_at
                    ) VALUES
                      ('92000000-0000-0000-0000-000000000060',
                       '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000010',
                       'queue-oldest', 'queue-idem-60', repeat('6',64), 'USD',
                       'RECEIVED', NULL, 5, '2026-01-01T00:00:00Z'),
                      ('92000000-0000-0000-0000-000000000061',
                       '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000010',
                       'queue-hold', 'queue-idem-61', repeat('7',64), 'USD',
                       'HOLD', 'manual review', 1, '2026-01-01T00:00:00Z'),
                      ('92000000-0000-0000-0000-000000000062',
                       '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000010',
                       'queue-ready', 'queue-idem-62', repeat('8',64), 'USD',
                       'READY_TO_FULFILL', NULL, 1, '2026-01-02T00:00:00Z'),
                      ('92000000-0000-0000-0000-000000000063',
                       '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000010',
                       'queue-cancelled', 'queue-idem-63', repeat('9',64), 'USD',
                       'CANCELLED', NULL, 1, '2026-01-02T00:00:00Z'),
                      ('92000000-0000-0000-0000-000000000064',
                       '92000000-0000-0000-0000-000000000002',
                       '92000000-0000-0000-0000-000000000011',
                       'queue-other-tenant', 'queue-idem-64', repeat('a',64), 'USD',
                       'RECEIVED', NULL, 1, '2026-01-01T00:00:00Z'),
                      ('92000000-0000-0000-0000-000000000065',
                       '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000010',
                       'queue-review', 'queue-idem-65', repeat('b',64), 'USD',
                       'REVIEW_PENDING', NULL, 1, '2026-01-03T00:00:00Z'),
                      ('92000000-0000-0000-0000-000000000066',
                       '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000012',
                       'queue-second-shop', 'queue-idem-66', repeat('c',64), 'USD',
                       'CANCELLED', NULL, 1, '2026-01-04T00:00:00Z')
                    ON CONFLICT (id) DO NOTHING
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_order_lines (
                      id, tenant_id, order_id, sku_id, external_line_ref, title_snapshot,
                      quantity, unit_price_minor, currency, external_listing_ref,
                      external_variant_ref, sku_match_source
                    ) VALUES
                      ('92000000-0000-0000-0000-000000000070',
                       '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000060', NULL,
                       'literal_%_line', 'Percent % and underscore _', 1, 10, 'USD',
                       'listing-trace', 'variant-trace', 'UNMATCHED'),
                      ('92000000-0000-0000-0000-000000000072',
                       '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000060', NULL,
                       'a-line', 'Oldest unmatched', 1, 10, 'USD',
                       NULL, NULL, 'UNMATCHED'),
                      ('92000000-0000-0000-0000-000000000071',
                       '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000060',
                       '92000000-0000-0000-0000-000000000031',
                       'provided-line', 'Provided', 1, 10, 'USD',
                       NULL, NULL, 'PROVIDED'),
                      ('92000000-0000-0000-0000-000000000078',
                       '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000060',
                       '92000000-0000-0000-0000-000000000031',
                       'mapped-line', 'Mapped', 1, 10, 'USD',
                       'mapped-listing', NULL, 'LISTING_MAPPING'),
                      ('92000000-0000-0000-0000-000000000079',
                       '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000060',
                       '92000000-0000-0000-0000-000000000031',
                       'manual-line', 'Manual', 1, 10, 'USD',
                       NULL, NULL, 'MANUAL'),
                      ('92000000-0000-0000-0000-000000000073',
                       '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000061', NULL,
                       'hold-line', 'Hold unmatched', 1, 10, 'USD',
                       NULL, NULL, 'UNMATCHED'),
                      ('92000000-0000-0000-0000-000000000074',
                       '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000065', NULL,
                       'review-line', 'Needle Title', 1, 10, 'USD',
                       NULL, NULL, 'UNMATCHED'),
                      ('92000000-0000-0000-0000-000000000075',
                       '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000062', NULL,
                       'ready-line', 'Ready excluded', 1, 10, 'USD',
                       NULL, NULL, 'UNMATCHED'),
                      ('92000000-0000-0000-0000-000000000076',
                       '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000063', NULL,
                       'cancelled-line', 'Cancelled excluded', 1, 10, 'USD',
                       NULL, NULL, 'UNMATCHED'),
                      ('92000000-0000-0000-0000-000000000077',
                       '92000000-0000-0000-0000-000000000002',
                       '92000000-0000-0000-0000-000000000064', NULL,
                       'foreign-line', 'Foreign tenant', 1, 10, 'USD',
                       NULL, NULL, 'UNMATCHED'),
                      ('92000000-0000-0000-0000-000000000080',
                       '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000066', NULL,
                       'second-shop-terminal-line', 'Second shop terminal', 1, 10, 'USD',
                       NULL, NULL, 'UNMATCHED')
                    ON CONFLICT (id) DO NOTHING
                    """);
        }
    }

    private static long countAuditLogs() throws Exception {
        try (Connection connection = connection(); Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery("SELECT count(*) FROM audit_logs")) {
            result.next();
            return result.getLong(1);
        }
    }

    private static long countInventoryReservations() throws Exception {
        try (Connection connection = connection(); Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery(
                        "SELECT count(*) FROM tenant_inventory_reservations")) {
            result.next();
            return result.getLong(1);
        }
    }

    private static long sumOrderVersions(UUID tenantId) throws Exception {
        try (Connection connection = connection();
                var statement = connection.prepareStatement("""
                        SELECT coalesce(sum(version), 0)
                        FROM tenant_orders
                        WHERE tenant_id = ?
                        """)) {
            statement.setObject(1, tenantId);
            try (ResultSet result = statement.executeQuery()) {
                result.next();
                return result.getLong(1);
            }
        }
    }

    private static void assertQueuePlanUsesExistingUnmatchedIndex() throws Exception {
        try (Connection connection = connection(); Statement statement = connection.createStatement()) {
            statement.executeUpdate("""
                    INSERT INTO tenant_orders (
                      id, tenant_id, shop_id, external_order_ref, idempotency_key,
                      request_fingerprint, currency, status, line_count, placed_at
                    )
                    SELECT
                      ('93000000-0000-0000-0000-' || lpad(series::text, 12, '0'))::uuid,
                      '92000000-0000-0000-0000-000000000001'::uuid,
                      '92000000-0000-0000-0000-000000000010'::uuid,
                      'bulk-order-' || series,
                      'bulk-idem-' || series,
                      md5(series::text) || md5(series::text),
                      'USD', 'RECEIVED', 200, '2026-02-01T00:00:00Z'::timestamptz
                    FROM generate_series(1, 50) AS series
                    ON CONFLICT (id) DO NOTHING
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_order_lines (
                      id, tenant_id, order_id, sku_id, external_line_ref, title_snapshot,
                      quantity, unit_price_minor, currency, sku_match_source
                    )
                    SELECT
                      ('94000000-0000-0000-0000-' ||
                        lpad((((orders.series - 1) * 200) + lines.series)::text, 12, '0'))::uuid,
                      '92000000-0000-0000-0000-000000000001'::uuid,
                      ('93000000-0000-0000-0000-' || lpad(orders.series::text, 12, '0'))::uuid,
                      '92000000-0000-0000-0000-000000000031'::uuid,
                      'bulk-line-' || lines.series,
                      'Bulk matched line',
                      1, 10, 'USD', 'PROVIDED'
                    FROM generate_series(1, 50) AS orders(series)
                    CROSS JOIN generate_series(1, 200) AS lines(series)
                    ON CONFLICT (id) DO NOTHING
                    """);
            statement.execute("ANALYZE tenant_orders");
            statement.execute("ANALYZE tenant_order_lines");
            StringBuilder plan = new StringBuilder();
            try (ResultSet result = statement.executeQuery("""
                    EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
                    SELECT o.id, o.version, o.status, o.shop_id, o.external_order_ref, o.placed_at,
                           l.id, l.external_line_ref, l.title_snapshot, l.external_listing_ref,
                           l.external_variant_ref, l.sku_id, l.sku_match_source
                    FROM tenant_orders o
                    JOIN tenant_order_lines l
                      ON l.tenant_id = o.tenant_id AND l.order_id = o.id
                    WHERE o.tenant_id = '92000000-0000-0000-0000-000000000001'
                      AND l.tenant_id = '92000000-0000-0000-0000-000000000001'
                      AND l.order_id = o.id
                      AND o.status IN ('RECEIVED', 'REVIEW_PENDING', 'HOLD')
                      AND l.sku_id IS NULL
                    ORDER BY o.placed_at ASC, o.id ASC, l.external_line_ref ASC, l.id ASC
                    LIMIT 50
                    """)) {
                while (result.next()) {
                    plan.append(result.getString(1)).append('\n');
                }
            }
            assertThat(plan.toString()).contains("idx_tenant_order_lines_unmatched");
        }
    }

    private static void assertDashboardPlanUsesExistingTenantAndUnmatchedIndexes() throws Exception {
        try (Connection connection = connection(); Statement statement = connection.createStatement()) {
            statement.executeUpdate("""
                    INSERT INTO tenants (id, code, name) VALUES
                      ('95000000-0000-0000-0000-000000000001', 'summary_scale_a', 'Summary Scale A'),
                      ('95000000-0000-0000-0000-000000000002', 'summary_scale_b', 'Summary Scale B')
                    ON CONFLICT (id) DO NOTHING
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_shops (id, tenant_id, platform_id, external_shop_ref, display_name) VALUES
                      ('95000000-0000-0000-0000-000000000010',
                       '95000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000003', 'summary-scale-a', 'Summary Scale A'),
                      ('95000000-0000-0000-0000-000000000011',
                       '95000000-0000-0000-0000-000000000002',
                       '92000000-0000-0000-0000-000000000003', 'summary-scale-b', 'Summary Scale B')
                    ON CONFLICT (id) DO NOTHING
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_product_spus (id, tenant_id, business_code, name)
                    VALUES ('95000000-0000-0000-0000-000000000030',
                      '95000000-0000-0000-0000-000000000001', 'SUMMARY_SPU', 'Summary SPU')
                    ON CONFLICT (id) DO NOTHING
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_product_skus (id, tenant_id, spu_id, business_code, name)
                    VALUES ('95000000-0000-0000-0000-000000000031',
                      '95000000-0000-0000-0000-000000000001',
                      '95000000-0000-0000-0000-000000000030', 'SUMMARY_SKU', 'Summary SKU')
                    ON CONFLICT (id) DO NOTHING
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_orders (
                      id, tenant_id, shop_id, external_order_ref, idempotency_key,
                      request_fingerprint, currency, status, line_count, placed_at
                    )
                    SELECT
                      ('95100000-0000-0000-0000-' || lpad(series::text, 12, '0'))::uuid,
                      '95000000-0000-0000-0000-000000000001'::uuid,
                      '95000000-0000-0000-0000-000000000010'::uuid,
                      'summary-order-' || series,
                      'summary-idem-' || series,
                      md5(series::text) || md5(series::text),
                      'USD',
                      (ARRAY['RECEIVED', 'REVIEW_PENDING', 'HOLD',
                             'READY_TO_FULFILL', 'CANCELLED'])[(series % 5) + 1],
                      2,
                      '2026-03-01T00:00:00Z'::timestamptz + (series || ' seconds')::interval
                    FROM generate_series(1, 10000) AS series
                    ON CONFLICT (id) DO NOTHING
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_order_lines (
                      id, tenant_id, order_id, sku_id, external_line_ref, title_snapshot,
                      quantity, unit_price_minor, currency, sku_match_source
                    )
                    SELECT
                      ('95200000-0000-0000-0000-' ||
                        lpad((((orders.series - 1) * 2) + lines.series)::text, 12, '0'))::uuid,
                      '95000000-0000-0000-0000-000000000001'::uuid,
                      ('95100000-0000-0000-0000-' || lpad(orders.series::text, 12, '0'))::uuid,
                      CASE
                        WHEN lines.series = 1
                         AND orders.series % 100 = 0
                         AND orders.series % 5 IN (0, 1, 2)
                        THEN NULL
                        ELSE '95000000-0000-0000-0000-000000000031'::uuid
                      END,
                      'summary-line-' || lines.series,
                      'Summary line',
                      1, 10, 'USD',
                      CASE
                        WHEN lines.series = 1
                         AND orders.series % 100 = 0
                         AND orders.series % 5 IN (0, 1, 2)
                        THEN 'UNMATCHED'
                        ELSE 'PROVIDED'
                      END
                    FROM generate_series(1, 10000) AS orders(series)
                    CROSS JOIN generate_series(1, 2) AS lines(series)
                    ON CONFLICT (id) DO NOTHING
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_orders (
                      id, tenant_id, shop_id, external_order_ref, idempotency_key,
                      request_fingerprint, currency, status, line_count, placed_at
                    )
                    SELECT
                      ('95300000-0000-0000-0000-' || lpad(series::text, 12, '0'))::uuid,
                      '95000000-0000-0000-0000-000000000002'::uuid,
                      '95000000-0000-0000-0000-000000000011'::uuid,
                      'foreign-summary-order-' || series,
                      'foreign-summary-idem-' || series,
                      md5(series::text) || md5(series::text),
                      'USD', 'CANCELLED', 1, '2026-04-01T00:00:00Z'::timestamptz
                    FROM generate_series(1, 20000) AS series
                    ON CONFLICT (id) DO NOTHING
                    """);
            statement.execute("ANALYZE tenant_orders");
            statement.execute("ANALYZE tenant_order_lines");

            StringBuilder plan = new StringBuilder();
            try (ResultSet result = statement.executeQuery("""
                    EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
                    WITH scoped_orders AS MATERIALIZED (
                      SELECT o.id, o.status, o.placed_at
                      FROM tenant_orders o
                      WHERE o.tenant_id = '95000000-0000-0000-0000-000000000001'
                        AND o.shop_id = '95000000-0000-0000-0000-000000000010'
                    ),
                    order_counts AS (
                      SELECT count(*),
                        count(*) FILTER (WHERE status = 'RECEIVED'),
                        count(*) FILTER (WHERE status = 'REVIEW_PENDING'),
                        count(*) FILTER (WHERE status = 'HOLD'),
                        count(*) FILTER (WHERE status = 'READY_TO_FULFILL'),
                        count(*) FILTER (WHERE status = 'CANCELLED')
                      FROM scoped_orders
                    ),
                    unmatched AS (
                      SELECT count(l.id), min(o.placed_at)
                      FROM scoped_orders o
                      JOIN tenant_order_lines l
                        ON l.tenant_id = '95000000-0000-0000-0000-000000000001'
                       AND l.order_id = o.id
                      WHERE o.status IN ('RECEIVED', 'REVIEW_PENDING', 'HOLD')
                        AND l.sku_id IS NULL
                    )
                    SELECT * FROM order_counts CROSS JOIN unmatched
                    """)) {
                while (result.next()) {
                    plan.append(result.getString(1)).append('\n');
                }
            }
            String planText = plan.toString();
            assertThat(planText)
                    .contains("idx_tenant_order_lines_unmatched")
                    .contains("tenant_id = '95000000-0000-0000-0000-000000000001'")
                    .contains("status")
                    .doesNotContain("Seq Scan on tenant_orders");
            assertThat(List.of(
                    "idx_tenant_orders_shop_status",
                    "idx_tenant_orders_list",
                    "uq_tenant_orders_external_ref"))
                    .anySatisfy(index -> assertThat(planText).contains(index));
        }
    }

    private static void seedHistoricalV32Data() throws Exception {
        try (Connection connection = connection(); Statement statement = connection.createStatement()) {
            statement.executeUpdate("""
                    INSERT INTO tenants (id, code, name) VALUES
                      ('92000000-0000-0000-0000-000000000001', 'order_tenant_a', 'Order Tenant A'),
                      ('92000000-0000-0000-0000-000000000002', 'order_tenant_b', 'Order Tenant B')
                    """);
            statement.executeUpdate("""
                    INSERT INTO roles (id, tenant_id, code, name, system_role)
                    VALUES (
                      '92000000-0000-0000-0000-000000000005',
                      '92000000-0000-0000-0000-000000000001',
                      'tenant_admin', 'Tenant Admin', true
                    )
                    """);
            statement.executeUpdate("""
                    INSERT INTO platform_catalog (id, code, display_name)
                    VALUES ('92000000-0000-0000-0000-000000000003', 'ORDER_TEST', 'Order Test')
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_shops (id, tenant_id, platform_id, external_shop_ref, display_name) VALUES
                      ('92000000-0000-0000-0000-000000000010', '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000003', 'shop-a', 'Shop A'),
                      ('92000000-0000-0000-0000-000000000011', '92000000-0000-0000-0000-000000000002',
                       '92000000-0000-0000-0000-000000000003', 'shop-b', 'Shop B')
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_product_spus (id, tenant_id, business_code, name)
                    VALUES ('92000000-0000-0000-0000-000000000030',
                      '92000000-0000-0000-0000-000000000001', 'ORDER_SPU', 'Order SPU')
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_product_skus (id, tenant_id, spu_id, business_code, name)
                    VALUES ('92000000-0000-0000-0000-000000000031',
                      '92000000-0000-0000-0000-000000000001',
                      '92000000-0000-0000-0000-000000000030', 'ORDER_SKU', 'Order SKU')
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_orders (id, tenant_id, shop_id, external_order_ref, idempotency_key,
                      request_fingerprint, currency, line_count, placed_at) VALUES
                      ('92000000-0000-0000-0000-000000000020', '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000010', 'order-one', 'idem-one',
                       repeat('a',64), 'USD', 2, now()),
                      ('92000000-0000-0000-0000-000000000021', '92000000-0000-0000-0000-000000000002',
                       '92000000-0000-0000-0000-000000000011', 'order-two', 'idem-two',
                       repeat('b',64), 'USD', 1, now())
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_order_lines (id, tenant_id, order_id, sku_id, external_line_ref,
                      title_snapshot, quantity, unit_price_minor, currency) VALUES
                      ('92000000-0000-0000-0000-000000000040', '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000020', '92000000-0000-0000-0000-000000000031',
                       'line-one', 'Line One', 1, 100, 'USD'),
                      ('92000000-0000-0000-0000-000000000041', '92000000-0000-0000-0000-000000000001',
                       '92000000-0000-0000-0000-000000000020', NULL,
                       'line-unmatched', 'Line Unmatched', 1, 100, 'USD')
                    """);
        }
    }

    private static Connection connection() throws Exception {
        return DriverManager.getConnection(jdbcUrl, username, password);
    }

    @SuppressWarnings("resource")
    private static void configureDatabase() {
        String external = System.getenv("ERP_TEST_DB_URL");
        if (external != null && !external.isBlank()) {
            baseJdbcUrl = external;
            username = required("ERP_TEST_DB_USER");
            password = required("ERP_TEST_DB_PASSWORD");
            isolatedSchema = "order_phase2_" + UUID.randomUUID().toString().replace("-", "");
            try (Connection connection = DriverManager.getConnection(baseJdbcUrl, username, password);
                    Statement statement = connection.createStatement()) {
                statement.execute("CREATE SCHEMA \"" + isolatedSchema + "\"");
            } catch (Exception exception) {
                throw new IllegalStateException("Unable to create isolated order migration test schema", exception);
            }
            jdbcUrl = baseJdbcUrl + (baseJdbcUrl.contains("?") ? "&" : "?")
                    + "currentSchema=" + isolatedSchema;
            return;
        }
        try {
            postgres = new PostgreSQLContainer<>("postgres:16-alpine")
                    .withDatabaseName("erp_order_test").withUsername("erp_test")
                    .withPassword("integration-test-only");
            postgres.start();
            jdbcUrl = postgres.getJdbcUrl(); username = postgres.getUsername(); password = postgres.getPassword();
        } catch (RuntimeException unavailable) {
            Assumptions.assumeTrue(false, "Docker is unavailable and ERP_TEST_DB_URL was not supplied");
        }
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) { throw new IllegalStateException(name + " is required"); }
        return value;
    }
}
