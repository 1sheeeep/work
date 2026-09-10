package cn.xzkj.erp.product.supplyprice;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.DriverManager;
import java.time.Duration;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import cn.xzkj.erp.product.domain.ProductStatus;
import cn.xzkj.erp.product.supplyprice.ProductSupplyPriceRecord.SkuType;

class ProductSupplyPricePostgresql16GateTest {
    private static final String DB_USER = "erp";
    private static final String DB_PASSWORD = "erp";
    private static final UUID TENANT_A = uuid("a1030000-0000-4000-8000-000000000001");
    private static final UUID TENANT_B = uuid("b1030000-0000-4000-8000-000000000001");
    private static final UUID ADMIN = uuid("a1030000-0000-4000-8000-000000000002");
    private static final UUID SKU_A = uuid("a1030000-0000-4000-8000-000000000101");
    private static final UUID SKU_B = uuid("b1030000-0000-4000-8000-000000000101");
    private static final UUID BUNDLE_A = uuid("a1030000-0000-4000-8000-000000000201");
    private static String containerName;
    private static ProductSupplyPriceRepository repository;

    @BeforeAll
    static void migrateAndSeed() throws Exception {
        String jdbcUrl = startPostgresql16();
        Flyway migration = Flyway.configure()
                .dataSource(jdbcUrl, DB_USER, DB_PASSWORD)
                .locations("classpath:db/migration").load();
        assertThat(migration.migrate().success).isTrue();
        assertThat(migration.info().current().getVersion().getVersion())
                .isEqualTo("123");
        NamedParameterJdbcTemplate jdbc = new NamedParameterJdbcTemplate(
                new DriverManagerDataSource(jdbcUrl, DB_USER, DB_PASSWORD));
        jdbc.update("""
                insert into tenants (id, code, name) values
                  ('a1030000-0000-4000-8000-000000000001', 'price_a', 'Tenant A'),
                  ('b1030000-0000-4000-8000-000000000001', 'price_b', 'Tenant B');
                insert into system_admins (
                    id, username, display_name, status, created_at, updated_at
                ) values (
                    'a1030000-0000-4000-8000-000000000002',
                    'price-admin', 'Price Administrator',
                    'PENDING_ACTIVATION', now(), now()
                );
                insert into tenant_product_spus (
                    id, tenant_id, business_code, name
                ) values
                  ('a1030000-0000-4000-8000-000000000010',
                   'a1030000-0000-4000-8000-000000000001', 'MASTER_A', 'Master A'),
                  ('b1030000-0000-4000-8000-000000000010',
                   'b1030000-0000-4000-8000-000000000001', 'MASTER_B', 'Master B');
                insert into tenant_product_skus (
                    id, tenant_id, spu_id, business_code, name
                ) values
                  ('a1030000-0000-4000-8000-000000000101',
                   'a1030000-0000-4000-8000-000000000001',
                   'a1030000-0000-4000-8000-000000000010', 'SKU_A', 'Product A'),
                  ('b1030000-0000-4000-8000-000000000101',
                   'b1030000-0000-4000-8000-000000000001',
                   'b1030000-0000-4000-8000-000000000010', 'SKU_B', 'Product B');
                insert into tenant_product_bundles (
                    id, tenant_id, business_code, business_code_key, name,
                    status, created_by_display_name, updated_by_display_name,
                    created_by_system_admin_id, updated_by_system_admin_id,
                    request_id
                ) values (
                    'a1030000-0000-4000-8000-000000000201',
                    'a1030000-0000-4000-8000-000000000001',
                    'BUNDLE_A', 'bundle_a', 'Bundle A', 'ACTIVE',
                    'Price Administrator', 'Price Administrator',
                    'a1030000-0000-4000-8000-000000000002',
                    'a1030000-0000-4000-8000-000000000002', 'seed-price-a'
                );
                """, new MapSqlParameterSource());
        repository = new ProductSupplyPriceRepository(jdbc);
    }

    @AfterAll
    static void stop() {
        if (containerName != null) runDocker("rm", "-f", containerName);
    }

    @Test
    void pricesPersistForInventoryAndBundleWithTenantAndVersionGuards() {
        UUID inventoryPriceId = UUID.randomUUID();
        ProductSupplyPriceService.PriceInput inventory = input(
                SkuType.INVENTORY, SKU_A, "DE", "EUR", "12.3400",
                LocalDate.of(2026, 8, 1), LocalDate.of(2026, 8, 31));
        repository.insert(TENANT_A, inventoryPriceId, inventory, actor());

        ProductSupplyPriceRecord created = repository.find(
                TENANT_A, inventoryPriceId).orElseThrow();
        assertThat(created.skuCode()).isEqualTo("SKU_A");
        assertThat(created.unitPrice()).isEqualByComparingTo("12.3400");
        assertThat(repository.find(TENANT_B, inventoryPriceId)).isEmpty();
        assertThat(repository.list(TENANT_A,
                new ProductSupplyPriceService.PriceQuery(
                        null, SkuType.INVENTORY, "DE", "product", 0, 25))
                .items()).extracting(ProductSupplyPriceRecord::id)
                .containsExactly(inventoryPriceId);
        assertThat(repository.overlaps(TENANT_A, null, input(
                SkuType.INVENTORY, SKU_A, "DE", "EUR", "13.0000",
                LocalDate.of(2026, 8, 31), null))).isTrue();
        assertThat(repository.overlaps(TENANT_A, null, input(
                SkuType.INVENTORY, SKU_A, "DE", "EUR", "13.0000",
                LocalDate.of(2026, 9, 1), null))).isFalse();

        assertThat(repository.update(TENANT_A, inventoryPriceId, 7,
                inventory, actor())).isFalse();
        ProductSupplyPriceService.PriceInput inactive = new ProductSupplyPriceService.PriceInput(
                inventory.skuType(), inventory.referenceId(), inventory.salesCountry(),
                inventory.currency(), new BigDecimal("11.9900"),
                inventory.minimumQuantity(), inventory.validFrom(), inventory.validTo(),
                ProductStatus.INACTIVE, inventory.note());
        assertThat(repository.update(TENANT_A, inventoryPriceId, 0,
                inactive, actor())).isTrue();
        assertThat(repository.find(TENANT_A, inventoryPriceId).orElseThrow().version())
                .isEqualTo(1);

        UUID bundlePriceId = UUID.randomUUID();
        repository.insert(TENANT_A, bundlePriceId, input(
                SkuType.BUNDLE, BUNDLE_A, "US", "USD", "29.9900",
                LocalDate.of(2026, 8, 1), null), actor());
        assertThat(repository.find(TENANT_A, bundlePriceId).orElseThrow().skuCode())
                .isEqualTo("BUNDLE_A");

        assertThatThrownBy(() -> repository.insert(TENANT_A, UUID.randomUUID(),
                input(SkuType.INVENTORY, SKU_B, "GB", "GBP", "8.0000",
                        LocalDate.of(2026, 8, 1), null), actor()))
                .isInstanceOf(DataIntegrityViolationException.class);

        assertThat(repository.archive(TENANT_A, bundlePriceId, 0, actor())).isTrue();
        assertThat(repository.find(TENANT_A, bundlePriceId).orElseThrow().status())
                .isEqualTo(ProductStatus.ARCHIVED);
    }

    private static ProductSupplyPriceService.PriceInput input(
            SkuType type,
            UUID referenceId,
            String country,
            String currency,
            String price,
            LocalDate validFrom,
            LocalDate validTo) {
        return new ProductSupplyPriceService.PriceInput(
                type, referenceId, country, currency, new BigDecimal(price), 1,
                validFrom, validTo, ProductStatus.ACTIVE, "Published supply price");
    }

    private static ProductSupplyPriceService.Actor actor() {
        return new ProductSupplyPriceService.Actor(
                TENANT_A, null, ADMIN, "Price Administrator",
                "request-price-a", "127.0.0.1");
    }

    private static String startPostgresql16() throws Exception {
        containerName = "erp-product-supply-price-"
                + UUID.randomUUID().toString().replace("-", "");
        String id = runDocker("run", "--rm", "-d", "--name", containerName,
                "-e", "POSTGRES_DB=erp_product_supply_price",
                "-e", "POSTGRES_USER=" + DB_USER,
                "-e", "POSTGRES_PASSWORD=" + DB_PASSWORD,
                "-p", "127.0.0.1::5432", "postgres:16-alpine");
        assertThat(id).isNotBlank();
        String binding = runDocker("port", containerName, "5432/tcp").strip();
        String jdbcUrl = "jdbc:postgresql://127.0.0.1:"
                + binding.substring(binding.lastIndexOf(':') + 1)
                + "/erp_product_supply_price";
        long deadline = System.nanoTime() + Duration.ofSeconds(30).toNanos();
        while (System.nanoTime() < deadline) {
            try (Connection ignored = DriverManager.getConnection(
                    jdbcUrl, DB_USER, DB_PASSWORD)) {
                return jdbcUrl;
            } catch (java.sql.SQLException exception) {
                Thread.sleep(200);
            }
        }
        throw new IllegalStateException("PostgreSQL 16 did not become ready");
    }

    private static String runDocker(String... arguments) {
        try {
            List<String> command = new ArrayList<>();
            command.add("docker");
            command.addAll(List.of(arguments));
            Process process = new ProcessBuilder(command)
                    .redirectErrorStream(true).start();
            String output = new String(process.getInputStream().readAllBytes(),
                    java.nio.charset.StandardCharsets.UTF_8);
            if (!process.waitFor(60, TimeUnit.SECONDS)
                    || process.exitValue() != 0) {
                throw new IllegalStateException(
                        "Docker command failed: " + output.strip());
            }
            return output.strip();
        } catch (java.io.IOException exception) {
            throw new IllegalStateException("Docker CLI is required", exception);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(
                    "Docker command was interrupted", exception);
        }
    }

    private static UUID uuid(String value) {
        return UUID.fromString(value);
    }
}
