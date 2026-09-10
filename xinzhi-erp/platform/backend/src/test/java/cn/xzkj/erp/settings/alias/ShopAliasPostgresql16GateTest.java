package cn.xzkj.erp.settings.alias;

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

class ShopAliasPostgresql16GateTest {
    private static final String DB_USER = "erp";
    private static final String DB_PASSWORD = "erp";
    private static final UUID TENANT_A = UUID.fromString("a9700000-0000-4000-8000-000000000001");
    private static final UUID TENANT_B = UUID.fromString("b9700000-0000-4000-8000-000000000001");
    private static final UUID USER_A = UUID.fromString("a9700000-0000-4000-8000-000000000002");
    private static final UUID USER_B = UUID.fromString("b9700000-0000-4000-8000-000000000002");
    private static final UUID PLATFORM = UUID.fromString("a9700000-0000-4000-8000-000000000003");
    private static final UUID SHOP_A = UUID.fromString("a9700000-0000-4000-8000-000000000004");
    private static final UUID SHOP_B = UUID.fromString("b9700000-0000-4000-8000-000000000004");
    private static String containerName;
    private static ShopAliasRepository repository;

    @BeforeAll
    static void migrateAndSeed() throws Exception {
        String jdbcUrl = startPostgresql16();
        Flyway migration = Flyway.configure().dataSource(jdbcUrl, DB_USER, DB_PASSWORD)
                .locations("classpath:db/migration").load();
        assertThat(migration.migrate().success).isTrue();
        assertThat(migration.info().current().getVersion().getVersion()).isEqualTo("123");
        NamedParameterJdbcTemplate jdbc = new NamedParameterJdbcTemplate(
                new DriverManagerDataSource(jdbcUrl, DB_USER, DB_PASSWORD));
        jdbc.update("""
                insert into tenants (id, code, name) values
                  ('a9700000-0000-4000-8000-000000000001', 'alias_a', 'Tenant A'),
                  ('b9700000-0000-4000-8000-000000000001', 'alias_b', 'Tenant B');
                insert into users (id, tenant_id, username, display_name) values
                  ('a9700000-0000-4000-8000-000000000002',
                   'a9700000-0000-4000-8000-000000000001', 'alias-a', 'User A'),
                  ('b9700000-0000-4000-8000-000000000002',
                   'b9700000-0000-4000-8000-000000000001', 'alias-b', 'User B');
                insert into platform_catalog (id, code, display_name)
                  values ('a9700000-0000-4000-8000-000000000003', 'SHOPIFY_UAT', 'Shopify UAT');
                insert into tenant_shops (id, tenant_id, platform_id, external_shop_ref, display_name) values
                  ('a9700000-0000-4000-8000-000000000004',
                   'a9700000-0000-4000-8000-000000000001',
                   'a9700000-0000-4000-8000-000000000003', 'shop-a', 'Canonical A'),
                  ('b9700000-0000-4000-8000-000000000004',
                   'b9700000-0000-4000-8000-000000000001',
                   'a9700000-0000-4000-8000-000000000003', 'shop-b', 'Canonical B');
                """, new MapSqlParameterSource());
        repository = new ShopAliasRepository(jdbc);
    }

    @AfterAll
    static void stop() {
        if (containerName != null) runDocker("rm", "-f", containerName);
    }

    @Test
    void aliasesAreTenantOwnedSearchableAndOptimisticallyVersioned() {
        ShopAliasService.AliasInput aliases = new ShopAliasService.AliasInput(
                "Test Shop", "测试店铺", null, null, null, null, null, null, null);
        repository.insert(TENANT_A, SHOP_A, aliases, actorA());

        assertThat(repository.find(TENANT_A, SHOP_A)).get().satisfies(value -> {
            assertThat(value.shopDisplayName()).isEqualTo("Canonical A");
            assertThat(value.aliasZhCn()).isEqualTo("测试店铺");
            assertThat(value.version()).isZero();
        });
        assertThat(repository.list(TENANT_A,
                new ShopAliasService.AliasQuery("测试", 0, 25)).totalElements())
                .isEqualTo(1);
        assertThat(repository.list(TENANT_B,
                new ShopAliasService.AliasQuery(null, 0, 25)).items())
                .allSatisfy(value -> assertThat(value.aliasZhCn()).isNull());
        assertThat(repository.update(TENANT_A, SHOP_A, 8, aliases, actorA())).isFalse();
        assertThat(repository.update(TENANT_A, SHOP_A, 0,
                new ShopAliasService.AliasInput(null, null, null, null, null,
                        null, null, null, null), actorA())).isTrue();
        assertThat(repository.find(TENANT_A, SHOP_A)).get().satisfies(value -> {
            assertThat(value.version()).isEqualTo(1);
            assertThat(value.aliasZhCn()).isNull();
        });
    }

    @Test
    void databaseRejectsCrossTenantActorsAndShopReferences() {
        ShopAliasService.AliasInput aliases = new ShopAliasService.AliasInput(
                null, "非法跨租户", null, null, null, null, null, null, null);
        assertThatThrownBy(() -> repository.insert(TENANT_A, SHOP_B, aliases, actorA()))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> repository.insert(TENANT_A, SHOP_A, aliases, actorB()))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    private static ShopAliasService.Actor actorA() {
        return new ShopAliasService.Actor(TENANT_A, USER_A, null,
                "User A", "request-a", "127.0.0.1");
    }

    private static ShopAliasService.Actor actorB() {
        return new ShopAliasService.Actor(TENANT_A, USER_B, null,
                "User B", "request-b", "127.0.0.1");
    }

    private static String startPostgresql16() throws Exception {
        containerName = "erp-shop-alias-" + UUID.randomUUID().toString().replace("-", "");
        String id = runDocker("run", "--rm", "-d", "--name", containerName,
                "-e", "POSTGRES_DB=erp_shop_alias", "-e", "POSTGRES_USER=" + DB_USER,
                "-e", "POSTGRES_PASSWORD=" + DB_PASSWORD,
                "-p", "127.0.0.1::5432", "postgres:16-alpine");
        assertThat(id).isNotBlank();
        String binding = runDocker("port", containerName, "5432/tcp").strip();
        String jdbcUrl = "jdbc:postgresql://127.0.0.1:"
                + binding.substring(binding.lastIndexOf(':') + 1) + "/erp_shop_alias";
        long deadline = System.nanoTime() + Duration.ofSeconds(30).toNanos();
        while (System.nanoTime() < deadline) {
            try (Connection ignored = DriverManager.getConnection(jdbcUrl, DB_USER, DB_PASSWORD)) {
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
            Process process = new ProcessBuilder(command).redirectErrorStream(true).start();
            String output = new String(process.getInputStream().readAllBytes(),
                    java.nio.charset.StandardCharsets.UTF_8);
            if (!process.waitFor(60, TimeUnit.SECONDS) || process.exitValue() != 0) {
                throw new IllegalStateException("Docker command failed: " + output.strip());
            }
            return output.strip();
        } catch (java.io.IOException exception) {
            throw new IllegalStateException("Docker CLI is required", exception);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Docker command was interrupted", exception);
        }
    }
}
