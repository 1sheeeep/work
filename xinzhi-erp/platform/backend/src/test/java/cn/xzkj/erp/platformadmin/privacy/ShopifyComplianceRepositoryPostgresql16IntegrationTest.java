package cn.xzkj.erp.platformadmin.privacy;

import static org.assertj.core.api.Assertions.assertThat;

import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyComplianceRequest;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyComplianceTopic;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

class ShopifyComplianceRepositoryPostgresql16IntegrationTest {

    private static final UUID TENANT_ID =
            UUID.fromString("98000000-0000-0000-0000-000000000001");
    private static final UUID SHOP_ID =
            UUID.fromString("98000000-0000-0000-0000-000000000003");
    private static final UUID ORDER_ID =
            UUID.fromString("98000000-0000-0000-0000-000000000004");
    private static final UUID WAREHOUSE_ID =
            UUID.fromString("98000000-0000-0000-0000-000000000005");
    private static final UUID PLAN_ID =
            UUID.fromString("98000000-0000-0000-0000-000000000006");
    private static final UUID PACKAGE_ID =
            UUID.fromString("98000000-0000-0000-0000-000000000007");
    private static final UUID USER_ID =
            UUID.fromString("98000000-0000-0000-0000-000000000008");

    private static PostgreSQLContainer<?> postgres;
    private static String jdbcUrl;
    private static String username;
    private static String password;
    private static JdbcTemplate jdbc;
    private static ShopifyComplianceRepository repository;

    @BeforeAll
    static void configure() {
        String externalUrl = System.getenv("ERP_TEST_DB_URL");
        if (externalUrl != null && !externalUrl.isBlank()) {
            jdbcUrl = externalUrl;
            username = System.getenv().getOrDefault(
                    "ERP_TEST_DB_USER", "erp_test");
            password = System.getenv().getOrDefault(
                    "ERP_TEST_DB_PASSWORD", "erp_test");
        } else {
            try {
                postgres = new PostgreSQLContainer<>("postgres:16-alpine")
                        .withDatabaseName("erp_shopify_privacy_test")
                        .withUsername("erp_test")
                        .withPassword("erp_test");
                postgres.start();
                jdbcUrl = postgres.getJdbcUrl();
                username = postgres.getUsername();
                password = postgres.getPassword();
            } catch (RuntimeException unavailableDocker) {
                Assumptions.assumeTrue(false, "Docker is unavailable");
            }
        }
        DriverManagerDataSource dataSource = new DriverManagerDataSource(
                jdbcUrl,
                username,
                password);
        Flyway.configure()
                .dataSource(dataSource)
                .locations("classpath:db/migration")
                .load()
                .migrate();
        jdbc = new JdbcTemplate(dataSource);
        repository = new ShopifyComplianceRepository(
                new NamedParameterJdbcTemplate(dataSource));
        seed();
    }

    @AfterAll
    static void stop() {
        if (postgres != null) {
            postgres.stop();
        }
    }

    @Test
    void exportsThenAnonymizesPersonalDataWithoutDeletingTransactionFacts() {
        ShopifyComplianceRequest request = new ShopifyComplianceRequest(
                "shopify-compliance/customers/redact/event-1",
                TENANT_ID,
                SHOP_ID,
                "example.myshopify.com",
                ShopifyComplianceTopic.CUSTOMER_REDACT,
                List.of("customer:6001", "order:7001"),
                Instant.parse("2026-08-15T06:00:00.123456789Z"));
        ShopifyComplianceRequest exportRequest = new ShopifyComplianceRequest(
                "shopify-compliance/customers/data_request/event-2",
                TENANT_ID,
                SHOP_ID,
                "example.myshopify.com",
                ShopifyComplianceTopic.CUSTOMER_DATA_REQUEST,
                request.referenceIds(),
                request.occurredAt());

        repository.recordSeen(exportRequest);
        var exported = repository.loadCustomerData(exportRequest);

        assertThat(exported.orders()).hasSize(1);
        assertThat(exported.orders().getFirst().recipientEmail())
                .isEqualTo("buyer@example.com");
        assertThat(exported.orders().getFirst().lines()).hasSize(1);

        repository.recordSeen(request);
        assertThat(repository.anonymize(request)).isEqualTo(1);

        assertThat(jdbc.queryForObject("""
                SELECT count(*) FROM tenant_orders
                WHERE id = ? AND total_amount_minor = 1299
                  AND currency = 'USD' AND buyer_reference IS NULL
                """, Integer.class, ORDER_ID)).isOne();
        assertThat(jdbc.queryForObject("""
                SELECT count(*) FROM tenant_order_profiles
                WHERE order_id = ?
                  AND customer_id IS NULL
                  AND recipient_name IS NULL
                  AND recipient_phone IS NULL
                  AND recipient_email IS NULL
                  AND address_line1 IS NULL
                  AND platform_message IS NULL
                """, Integer.class, ORDER_ID)).isOne();
        assertThat(jdbc.queryForObject("""
                SELECT count(*) FROM tenant_order_lines
                WHERE order_id = ? AND unit_price_minor = 1000
                """, Integer.class, ORDER_ID)).isOne();
        assertThat(jdbc.queryForObject("""
                SELECT count(*) FROM tenant_fulfillment_packages
                WHERE id = ?
                  AND logistics_provider_order_reference IS NULL
                  AND logistics_tracking_reference IS NULL
                  AND logistics_label_url IS NULL
                  AND logistics_tracking_summary IS NULL
                """, Integer.class, PACKAGE_ID)).isOne();
        assertThat(jdbc.queryForObject("""
                SELECT count(*) FROM tenant_logistics_tracking_numbers
                WHERE tenant_id = ?
                  AND used_package_id IS NULL
                  AND lifecycle_status = 'ARCHIVED'
                  AND tracking_reference = 'redacted:' || id::text
                """, Integer.class, TENANT_ID)).isOne();
        assertThat(repository.anonymize(request)).isEqualTo(1);
    }

    private static void seed() {
        jdbc.update("""
                INSERT INTO tenants (id, code, name, status)
                VALUES (?, 'privacy_test', 'Privacy Test', 'ACTIVE')
                """, TENANT_ID);
        UUID platformId = jdbc.queryForObject(
                "SELECT id FROM platform_catalog WHERE code = 'SHOPIFY'",
                UUID.class);
        jdbc.update("""
                INSERT INTO tenant_shops (
                    id, tenant_id, platform_id, external_shop_ref, display_name
                ) VALUES (?, ?, ?, 'example.myshopify.com', 'Example')
                """, SHOP_ID, TENANT_ID, platformId);
        jdbc.update("""
                INSERT INTO tenant_orders (
                    id, tenant_id, shop_id, external_order_ref,
                    idempotency_key, request_fingerprint, currency,
                    buyer_reference, status, line_count, placed_at,
                    total_amount_minor, shipping_amount_minor, postal_code
                ) VALUES (
                    ?, ?, ?, 'gid://shopify/Order/7001',
                    'privacy-order-1', repeat('a', 64), 'USD',
                    'buyer-1', 'RECEIVED', 1, '2026-08-14T00:00:00Z',
                    1299, 299, '94107'
                )
                """, ORDER_ID, TENANT_ID, SHOP_ID);
        jdbc.update("""
                INSERT INTO tenant_order_lines (
                    tenant_id, order_id, external_line_ref,
                    title_snapshot, quantity, unit_price_minor, currency,
                    platform_sku, sku_match_source
                ) VALUES (
                    ?, ?, 'gid://shopify/LineItem/8001',
                    'Product', 1, 1000, 'USD', 'SKU-1', 'UNMATCHED'
                )
                """, TENANT_ID, ORDER_ID);
        jdbc.update("""
                INSERT INTO tenant_order_profiles (
                    tenant_id, order_id, customer_id,
                    recipient_name, recipient_phone, recipient_email,
                    address_line1, city,
                    platform_message, delivered_at
                ) VALUES (
                    ?, ?, 'gid://shopify/Customer/6001',
                    'Buyer', '+14155550100', 'buyer@example.com',
                    '1 Market St', 'San Francisco',
                    'Please leave at door', '2026-08-15T00:00:00Z'
                )
                """, TENANT_ID, ORDER_ID);
        jdbc.update("""
                INSERT INTO users (
                    id, tenant_id, username, email, display_name, status
                ) VALUES (
                    ?, ?, 'privacy-admin@example.com',
                    'privacy-admin@example.com', 'Privacy Admin', 'ACTIVE'
                )
                """, USER_ID, TENANT_ID);
        jdbc.update("""
                INSERT INTO tenant_warehouses (
                    id, tenant_id, business_code, name
                ) VALUES (?, ?, 'PRIVACY_WH', 'Privacy Warehouse')
                """, WAREHOUSE_ID, TENANT_ID);
        jdbc.update("""
                INSERT INTO tenant_fulfillment_plans (
                    id, tenant_id, order_id, shop_id, source_order_version,
                    external_order_ref_snapshot, planned_quantity,
                    creation_idempotency_key, request_fingerprint
                ) VALUES (
                    ?, ?, ?, ?, 0, 'gid://shopify/Order/7001', 1,
                    'privacy-plan-1', repeat('b', 64)
                )
                """, PLAN_ID, TENANT_ID, ORDER_ID, SHOP_ID);
        jdbc.update("""
                INSERT INTO tenant_fulfillment_packages (
                    id, tenant_id, plan_id, warehouse_id, package_number,
                    logistics_provider_order_reference,
                    logistics_tracking_reference, logistics_label_url,
                    logistics_tracking_summary
                ) VALUES (
                    ?, ?, ?, ?, 'PKG-PRIVACY-1',
                    'provider-order-1', 'TRACK-PRIVACY-1',
                    NULL, 'In transit'
                )
                """, PACKAGE_ID, TENANT_ID, PLAN_ID, WAREHOUSE_ID);
        jdbc.update("""
                INSERT INTO tenant_logistics_tracking_numbers (
                    id, tenant_id, import_batch_id, tracking_type,
                    logistics_channel, tracking_reference,
                    used_plan_id, used_package_id, used_at,
                    created_by_user_id, request_id
                ) VALUES (
                    gen_random_uuid(), ?, gen_random_uuid(),
                    'DOMESTIC_EXPRESS', 'Privacy Carrier',
                    'TRACK-PRIVACY-1', ?, ?, now(), ?, 'privacy-track-1'
                )
                """, TENANT_ID, PLAN_ID, PACKAGE_ID, USER_ID);
    }
}
