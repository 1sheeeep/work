package cn.xzkj.erp.logistics.declaration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class LogisticsDeclarationEntityPostgresql16GateTest {
    private static final String DB_USER = "erp";
    private static final String DB_PASSWORD = "erp";
    private static final UUID TENANT_A = UUID.fromString(
            "a7900000-0000-4000-8000-000000000001");
    private static final UUID TENANT_B = UUID.fromString(
            "b7900000-0000-4000-8000-000000000001");
    private static final UUID USER_A = UUID.fromString(
            "a7900000-0000-4000-8000-000000000002");
    private static final UUID SHOP_A = UUID.fromString(
            "a7900000-0000-4000-8000-000000000003");
    private static final UUID SHOP_B = UUID.fromString(
            "b7900000-0000-4000-8000-000000000003");
    private static String containerName;
    private static String jdbcUrl;
    private static LogisticsDeclarationEntityRepository repository;

    @BeforeAll
    static void migrateAndSeed() throws Exception {
        startPostgresql16();
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
                  ('a7900000-0000-4000-8000-000000000001', 'decl_a', 'Tenant A'),
                  ('b7900000-0000-4000-8000-000000000001', 'decl_b', 'Tenant B');
                insert into users (id, tenant_id, username, display_name) values
                  ('a7900000-0000-4000-8000-000000000002',
                   'a7900000-0000-4000-8000-000000000001', 'decl-a', 'User A');
                insert into tenant_shops (
                    id, tenant_id, platform_id, external_shop_ref, display_name
                ) values
                  ('a7900000-0000-4000-8000-000000000003',
                   'a7900000-0000-4000-8000-000000000001',
                   (select id from platform_catalog where code = 'SHOPIFY'),
                   'shop-a', 'Shop A'),
                  ('b7900000-0000-4000-8000-000000000003',
                   'b7900000-0000-4000-8000-000000000001',
                   (select id from platform_catalog where code = 'SHOPIFY'),
                   'shop-b', 'Shop B');
                """, new MapSqlParameterSource());
        repository = new LogisticsDeclarationEntityRepository(jdbc);
    }

    @AfterAll
    static void stop() {
        if (containerName != null) runDocker("rm", "-f", containerName);
    }

    @Test
    void entityCrudKeepsTenantShopBindingsAndOptimisticLifecycleBoundaries() {
        UUID id = UUID.randomUUID();
        var value = new LogisticsDeclarationEntityService.EntityInput(
                "Entity A", "CN-ENTITY-A", Set.of(SHOP_A));
        repository.insert(id, TENANT_A, value, USER_A, null, "request-1");

        assertThat(repository.list(TENANT_A, "ACTIVE", "SHOP", "Shop A",
                PageRequest.of(0, 25)).getContent()).singleElement()
                .satisfies(entity -> {
                    assertThat(entity.id()).isEqualTo(id);
                    assertThat(entity.shops()).singleElement()
                            .extracting(LogisticsDeclarationEntityRecord.ShopBinding::shopId)
                            .isEqualTo(SHOP_A);
                });
        assertThat(repository.list(TENANT_B, null, "NAME", null,
                PageRequest.of(0, 25))).isEmpty();
        assertThat(repository.countBindableShops(TENANT_A, Set.of(SHOP_B)))
                .isZero();
        assertThat(repository.update(id, TENANT_A, 99, value, USER_A, null,
                "request-2")).isFalse();
        assertThat(repository.update(id, TENANT_A, 0,
                new LogisticsDeclarationEntityService.EntityInput(
                        "Entity A Updated", "CN-ENTITY-A", Set.of()),
                USER_A, null, "request-2")).isTrue();
        assertThat(repository.find(TENANT_A, id).shops()).isEmpty();
        assertThat(repository.archive(TENANT_A, id, 1, USER_A, null,
                "request-3")).isTrue();
        assertThat(repository.find(TENANT_A, id).status()).isEqualTo("ARCHIVED");
    }

    @Test
    void activeEnterpriseCodeIsUniqueWithinTenant() {
        var value = new LogisticsDeclarationEntityService.EntityInput(
                "Unique A", "CN-UNIQUE-A", Set.of());
        repository.insert(UUID.randomUUID(), TENANT_A, value,
                USER_A, null, "request-unique-1");
        assertThatThrownBy(() -> repository.insert(UUID.randomUUID(), TENANT_A,
                value, USER_A, null, "request-unique-2"))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void boundedSearchAndShopOptionQueriesAreValidOnPostgresql16() {
        assertThat(repository.list(TENANT_A, null, "PLATFORM", "100%_road\\",
                PageRequest.of(0, 25))).isNotNull();
        assertThat(repository.listShopOptions(TENANT_A, "100%_road\\",
                PageRequest.of(0, 100))).isNotNull();
    }

    private static void startPostgresql16() throws Exception {
        containerName = "erp-logistics-declaration-"
                + UUID.randomUUID().toString().replace("-", "");
        String id = runDocker(
                "run", "--rm", "-d", "--name", containerName,
                "-e", "POSTGRES_DB=erp_logistics_declaration",
                "-e", "POSTGRES_USER=" + DB_USER,
                "-e", "POSTGRES_PASSWORD=" + DB_PASSWORD,
                "-p", "127.0.0.1::5432", "postgres:16-alpine");
        assertThat(id).isNotBlank();
        String binding = runDocker("port", containerName, "5432/tcp").strip();
        int separator = binding.lastIndexOf(':');
        if (separator < 0) {
            throw new IllegalStateException("Docker did not publish PostgreSQL");
        }
        jdbcUrl = "jdbc:postgresql://127.0.0.1:"
                + binding.substring(separator + 1)
                + "/erp_logistics_declaration";
        long deadline = System.nanoTime() + Duration.ofSeconds(30).toNanos();
        while (System.nanoTime() < deadline) {
            try (Connection connection = DriverManager.getConnection(
                    jdbcUrl, DB_USER, DB_PASSWORD)) {
                connection.isValid(1);
                return;
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
            if (!process.waitFor(60, TimeUnit.SECONDS) || process.exitValue() != 0) {
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
}
