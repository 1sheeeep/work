package cn.xzkj.erp.product.bundle;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.time.Duration;
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

class ProductBundlePostgresql16GateTest {
    private static final String DB_USER = "erp";
    private static final String DB_PASSWORD = "erp";
    private static final UUID TENANT_A = uuid("a1020000-0000-4000-8000-000000000001");
    private static final UUID TENANT_B = uuid("b1020000-0000-4000-8000-000000000001");
    private static final UUID ADMIN = uuid("a1020000-0000-4000-8000-000000000002");
    private static final UUID SKU_A1 = uuid("a1020000-0000-4000-8000-000000000101");
    private static final UUID SKU_A2 = uuid("a1020000-0000-4000-8000-000000000102");
    private static final UUID SKU_B = uuid("b1020000-0000-4000-8000-000000000101");
    private static String containerName;
    private static ProductBundleRepository repository;
    private static NamedParameterJdbcTemplate jdbc;

    @BeforeAll
    static void migrateAndSeed() throws Exception {
        String jdbcUrl = startPostgresql16();
        Flyway migration = Flyway.configure()
                .dataSource(jdbcUrl, DB_USER, DB_PASSWORD)
                .locations("classpath:db/migration").load();
        assertThat(migration.migrate().success).isTrue();
        assertThat(migration.info().current().getVersion().getVersion())
                .isEqualTo("123");
        jdbc = new NamedParameterJdbcTemplate(
                new DriverManagerDataSource(jdbcUrl, DB_USER, DB_PASSWORD));
        jdbc.update("""
                insert into tenants (id, code, name) values
                  ('a1020000-0000-4000-8000-000000000001', 'bundle_a', 'Tenant A'),
                  ('b1020000-0000-4000-8000-000000000001', 'bundle_b', 'Tenant B');
                insert into system_admins (
                    id, username, display_name, status, created_at, updated_at
                ) values (
                    'a1020000-0000-4000-8000-000000000002',
                    'bundle-admin', 'Bundle Administrator',
                    'PENDING_ACTIVATION', now(), now()
                );
                insert into tenant_product_spus (
                    id, tenant_id, business_code, name
                ) values
                  ('a1020000-0000-4000-8000-000000000010',
                   'a1020000-0000-4000-8000-000000000001', 'MASTER_A', 'Master A'),
                  ('b1020000-0000-4000-8000-000000000010',
                   'b1020000-0000-4000-8000-000000000001', 'MASTER_B', 'Master B');
                insert into tenant_product_skus (
                    id, tenant_id, spu_id, business_code, name
                ) values
                  ('a1020000-0000-4000-8000-000000000101',
                   'a1020000-0000-4000-8000-000000000001',
                   'a1020000-0000-4000-8000-000000000010', 'SKU_A1', 'Component A1'),
                  ('a1020000-0000-4000-8000-000000000102',
                   'a1020000-0000-4000-8000-000000000001',
                   'a1020000-0000-4000-8000-000000000010', 'SKU_A2', 'Component A2'),
                  ('b1020000-0000-4000-8000-000000000101',
                   'b1020000-0000-4000-8000-000000000001',
                   'b1020000-0000-4000-8000-000000000010', 'SKU_B1', 'Component B1');
                """, new MapSqlParameterSource());
        repository = new ProductBundleRepository(jdbc);
    }

    @AfterAll
    static void stop() {
        if (containerName != null) runDocker("rm", "-f", containerName);
    }

    @Test
    void bundlesPersistComponentsWithTenantVersionAndArchiveGuards() {
        UUID bundleId = UUID.randomUUID();
        repository.insert(TENANT_A, bundleId,
                input("BUNDLE_A", "Starter set", List.of(
                        new ProductBundleService.ComponentInput(SKU_A1, 2),
                        new ProductBundleService.ComponentInput(SKU_A2, 1))),
                actor());

        ProductBundleRecord created = repository.find(TENANT_A, bundleId)
                .orElseThrow();
        assertThat(created.version()).isZero();
        assertThat(created.componentCount()).isEqualTo(2);
        assertThat(created.totalUnits()).isEqualTo(3);
        assertThat(created.components())
                .extracting(ProductBundleRecord.Component::skuCode)
                .containsExactly("SKU_A1", "SKU_A2");
        assertThat(repository.find(TENANT_B, bundleId)).isEmpty();
        assertThat(repository.list(TENANT_A, new ProductBundleService.BundleQuery(
                null, "starter", null, null, 0, 25)).items())
                .extracting(ProductBundleRecord::id).containsExactly(bundleId);

        assertThat(repository.update(TENANT_A, bundleId, 7,
                input("BUNDLE_A", "Starter set", List.of(
                        new ProductBundleService.ComponentInput(SKU_A1, 3))),
                actor())).isFalse();
        assertThat(repository.update(TENANT_A, bundleId, 0,
                input("BUNDLE_A", "Starter set updated", List.of(
                        new ProductBundleService.ComponentInput(SKU_A1, 3))),
                actor())).isTrue();
        ProductBundleRecord updated = repository.find(TENANT_A, bundleId)
                .orElseThrow();
        assertThat(updated.version()).isEqualTo(1);
        assertThat(updated.totalUnits()).isEqualTo(3);

        assertThatThrownBy(() -> jdbc.update("""
                insert into tenant_product_bundle_components (
                    tenant_id, bundle_id, sku_id, quantity
                ) values (:tenantId, :bundleId, :skuId, 1)
                """, new MapSqlParameterSource("tenantId", TENANT_A)
                .addValue("bundleId", bundleId)
                .addValue("skuId", SKU_B)))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> repository.insert(TENANT_A, UUID.randomUUID(),
                input("BUNDLE_A", "Duplicate", List.of(
                        new ProductBundleService.ComponentInput(SKU_A1, 1))),
                actor())).isInstanceOf(DataIntegrityViolationException.class);

        assertThat(repository.archive(TENANT_A, bundleId, 1, actor())).isTrue();
        assertThat(repository.find(TENANT_A, bundleId).orElseThrow().status())
                .isEqualTo(ProductStatus.ARCHIVED);
        assertThat(repository.list(TENANT_A, new ProductBundleService.BundleQuery(
                null, null, null, null, 0, 25)).items()).isEmpty();
    }

    private static ProductBundleService.BundleInput input(
            String code,
            String name,
            List<ProductBundleService.ComponentInput> components) {
        return new ProductBundleService.BundleInput(
                code, code.toLowerCase(java.util.Locale.ROOT), name,
                "Bundle for warehouse picking", ProductStatus.ACTIVE,
                components);
    }

    private static ProductBundleService.Actor actor() {
        return new ProductBundleService.Actor(
                TENANT_A, null, ADMIN, "Bundle Administrator",
                "request-bundle-a", "127.0.0.1");
    }

    private static String startPostgresql16() throws Exception {
        containerName = "erp-product-bundle-"
                + UUID.randomUUID().toString().replace("-", "");
        String id = runDocker("run", "--rm", "-d", "--name", containerName,
                "-e", "POSTGRES_DB=erp_product_bundle",
                "-e", "POSTGRES_USER=" + DB_USER,
                "-e", "POSTGRES_PASSWORD=" + DB_PASSWORD,
                "-p", "127.0.0.1::5432", "postgres:16-alpine");
        assertThat(id).isNotBlank();
        String binding = runDocker("port", containerName, "5432/tcp").strip();
        String jdbcUrl = "jdbc:postgresql://127.0.0.1:"
                + binding.substring(binding.lastIndexOf(':') + 1)
                + "/erp_product_bundle";
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
