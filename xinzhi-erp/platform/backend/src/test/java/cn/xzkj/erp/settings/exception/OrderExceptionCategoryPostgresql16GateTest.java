package cn.xzkj.erp.settings.exception;

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

class OrderExceptionCategoryPostgresql16GateTest {
    private static final String DB_USER = "erp";
    private static final String DB_PASSWORD = "erp";
    private static final UUID TENANT_A = UUID.fromString("a9800000-0000-4000-8000-000000000001");
    private static final UUID TENANT_B = UUID.fromString("b9800000-0000-4000-8000-000000000001");
    private static final UUID USER_A = UUID.fromString("a9800000-0000-4000-8000-000000000002");
    private static final UUID USER_B = UUID.fromString("b9800000-0000-4000-8000-000000000002");
    private static String containerName;
    private static OrderExceptionCategoryRepository repository;

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
                  ('a9800000-0000-4000-8000-000000000001', 'exception_a', 'Tenant A'),
                  ('b9800000-0000-4000-8000-000000000001', 'exception_b', 'Tenant B');
                insert into users (id, tenant_id, username, display_name) values
                  ('a9800000-0000-4000-8000-000000000002',
                   'a9800000-0000-4000-8000-000000000001', 'exception-a', 'User A'),
                  ('b9800000-0000-4000-8000-000000000002',
                   'b9800000-0000-4000-8000-000000000001', 'exception-b', 'User B');
                """, new MapSqlParameterSource());
        repository = new OrderExceptionCategoryRepository(jdbc);
    }

    @AfterAll
    static void stop() {
        if (containerName != null) runDocker("rm", "-f", containerName);
    }

    @Test
    void categoriesAreTenantOwnedOrderedAndOptimisticallyVersioned() {
        repository.insertSet(TENANT_A, actorA());
        repository.replaceItems(TENANT_A, List.of(
                input("地址信息待确认", true), input("库存待确认", false)), actorA());

        OrderExceptionCategoryRecord value = repository.find(TENANT_A);
        assertThat(value.configured()).isTrue();
        assertThat(value.revision()).isZero();
        assertThat(value.items()).extracting(OrderExceptionCategoryRecord.Category::name)
                .containsExactly("地址信息待确认", "库存待确认");
        assertThat(repository.find(TENANT_B).configured()).isFalse();
        assertThat(repository.updateSet(TENANT_A, 9, actorA())).isFalse();
        assertThat(repository.updateSet(TENANT_A, 0, actorA())).isTrue();
        assertThat(repository.find(TENANT_A).revision()).isEqualTo(1);
    }

    @Test
    void databaseRejectsCrossTenantActorsAndDuplicateNames() {
        assertThatThrownBy(() -> repository.insertSet(TENANT_B, actorA()))
                .isInstanceOf(DataIntegrityViolationException.class);
        repository.insertSet(TENANT_B, actorB());
        assertThatThrownBy(() -> repository.replaceItems(TENANT_B, List.of(
                input("重复分类", true), input("重复分类", false)), actorB()))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    private static OrderExceptionCategoryService.CategoryInput input(String name,
            boolean enabled) {
        return new OrderExceptionCategoryService.CategoryInput(UUID.randomUUID(),
                name, name.toLowerCase(java.util.Locale.ROOT), null, enabled);
    }

    private static OrderExceptionCategoryService.Actor actorA() {
        return new OrderExceptionCategoryService.Actor(TENANT_A, USER_A, null,
                "User A", "request-a", "127.0.0.1");
    }

    private static OrderExceptionCategoryService.Actor actorB() {
        return new OrderExceptionCategoryService.Actor(TENANT_B, USER_B, null,
                "User B", "request-b", "127.0.0.1");
    }

    private static String startPostgresql16() throws Exception {
        containerName = "erp-order-exception-"
                + UUID.randomUUID().toString().replace("-", "");
        String id = runDocker("run", "--rm", "-d", "--name", containerName,
                "-e", "POSTGRES_DB=erp_order_exception",
                "-e", "POSTGRES_USER=" + DB_USER,
                "-e", "POSTGRES_PASSWORD=" + DB_PASSWORD,
                "-p", "127.0.0.1::5432", "postgres:16-alpine");
        assertThat(id).isNotBlank();
        String binding = runDocker("port", containerName, "5432/tcp").strip();
        String jdbcUrl = "jdbc:postgresql://127.0.0.1:"
                + binding.substring(binding.lastIndexOf(':') + 1)
                + "/erp_order_exception";
        long deadline = System.nanoTime() + Duration.ofSeconds(30).toNanos();
        while (System.nanoTime() < deadline) {
            try (Connection ignored = DriverManager.getConnection(jdbcUrl,
                    DB_USER, DB_PASSWORD)) {
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
            Process process = new ProcessBuilder(command).redirectErrorStream(true)
                    .start();
            String output = new String(process.getInputStream().readAllBytes(),
                    java.nio.charset.StandardCharsets.UTF_8);
            if (!process.waitFor(60, TimeUnit.SECONDS) || process.exitValue() != 0) {
                throw new IllegalStateException("Docker command failed: "
                        + output.strip());
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
