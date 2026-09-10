package cn.xzkj.erp.logistics.statistics;

import static org.assertj.core.api.Assertions.assertThat;

import cn.xzkj.erp.logistics.statistics.LogisticsStatisticsView.Dimension;
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
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class LogisticsStatisticsPostgresql16GateTest {
    private static final String DB_USER = "erp";
    private static final String DB_PASSWORD = "erp";
    private static String containerName;
    private static String jdbcUrl;
    private static NamedParameterJdbcTemplate jdbc;
    private static LogisticsStatisticsRepository repository;

    @BeforeAll
    static void migrate() throws Exception {
        startPostgresql16();
        Flyway migration = Flyway.configure()
                .dataSource(jdbcUrl, DB_USER, DB_PASSWORD)
                .locations("classpath:db/migration")
                .load();
        assertThat(migration.migrate().success).isTrue();
        jdbc = new NamedParameterJdbcTemplate(new DriverManagerDataSource(
                jdbcUrl, DB_USER, DB_PASSWORD));
        repository = new LogisticsStatisticsRepository(jdbc);
        seed();
    }

    @AfterAll
    static void stop() {
        if (containerName != null) runDocker("rm", "-f", containerName);
    }

    @Test
    void bothDimensionsAndAllFiltersCompileAgainstPostgresql16() {
        var country = repository.summarize(
                UUID.randomUUID(), Set.of(), true, Dimension.COUNTRY,
                "u%_\\s", java.time.Instant.parse("2026-08-01T00:00:00Z"),
                java.time.Instant.parse("2026-08-03T00:00:00Z"),
                PageRequest.of(0, 25));
        var channel = repository.summarize(
                UUID.randomUUID(), Set.of(UUID.randomUUID()), false,
                Dimension.CHANNEL, "carrier",
                java.time.Instant.parse("2026-08-01T00:00:00Z"),
                java.time.Instant.parse("2026-08-03T00:00:00Z"),
                PageRequest.of(0, 25));

        assertThat(country.items()).isEmpty();
        assertThat(country.totalStatuses()).isEmpty();
        assertThat(channel.items()).isEmpty();
        assertThat(channel.totalStatuses()).isEmpty();
    }

    @Test
    void totalStatusesCoverAllFilteredRecordsAcrossGroupPages() {
        var result = repository.summarize(
                uuid("a8800000-0000-4000-8000-000000000001"), Set.of(),
                true, Dimension.CHANNEL, null, null, null,
                PageRequest.of(0, 1));

        assertThat(result.totalRecords()).isEqualTo(3);
        assertThat(result.totalGroups()).isEqualTo(2);
        assertThat(result.items()).hasSize(1);
        assertThat(result.items().getFirst().groupValue()).isEqualTo("UPS");
        assertThat(result.totalStatuses())
                .extracting(status -> status.status() + ":" + status.recordCount())
                .containsExactly("DELIVERED:2", "IN_TRANSIT:1");
    }

    private static void seed() {
        jdbc.getJdbcTemplate().execute("""
                INSERT INTO tenants (id, code, name) VALUES
                  ('a8800000-0000-4000-8000-000000000001', 'logistics-stats-a', 'Logistics Stats A'),
                  ('b8800000-0000-4000-8000-000000000001', 'logistics-stats-b', 'Logistics Stats B');
                INSERT INTO platform_catalog (id, code, display_name) VALUES
                  ('c8800000-0000-4000-8000-000000000001', 'LOGISTICS_STATS', 'Logistics Stats');
                INSERT INTO tenant_shops (id, tenant_id, platform_id, external_shop_ref, display_name) VALUES
                  ('a8800000-0000-4000-8000-000000000010', 'a8800000-0000-4000-8000-000000000001', 'c8800000-0000-4000-8000-000000000001', 'shop-a', 'Shop A'),
                  ('b8800000-0000-4000-8000-000000000010', 'b8800000-0000-4000-8000-000000000001', 'c8800000-0000-4000-8000-000000000001', 'shop-b', 'Shop B');
                INSERT INTO tenant_orders (
                  id, tenant_id, shop_id, external_order_ref, idempotency_key,
                  request_fingerprint, currency, status, line_count, placed_at,
                  logistics_channel, tracking_status, shipped_at
                ) VALUES
                  ('a8800000-0000-4000-8000-000000000101', 'a8800000-0000-4000-8000-000000000001', 'a8800000-0000-4000-8000-000000000010', 'A-1', 'logistics-a-1', repeat('1', 64), 'CNY', 'SHIPPED', 1, '2026-08-01T01:00:00Z', 'UPS', 'DELIVERED', '2026-08-02T01:00:00Z'),
                  ('a8800000-0000-4000-8000-000000000102', 'a8800000-0000-4000-8000-000000000001', 'a8800000-0000-4000-8000-000000000010', 'A-2', 'logistics-a-2', repeat('2', 64), 'CNY', 'SHIPPED', 1, '2026-08-01T02:00:00Z', 'UPS', 'IN_TRANSIT', '2026-08-02T02:00:00Z'),
                  ('a8800000-0000-4000-8000-000000000103', 'a8800000-0000-4000-8000-000000000001', 'a8800000-0000-4000-8000-000000000010', 'A-3', 'logistics-a-3', repeat('3', 64), 'CNY', 'SHIPPED', 1, '2026-08-01T03:00:00Z', 'DHL', 'DELIVERED', '2026-08-02T03:00:00Z'),
                  ('b8800000-0000-4000-8000-000000000101', 'b8800000-0000-4000-8000-000000000001', 'b8800000-0000-4000-8000-000000000010', 'B-1', 'logistics-b-1', repeat('4', 64), 'CNY', 'SHIPPED', 1, '2026-08-01T04:00:00Z', 'UPS', 'EXCEPTION', '2026-08-02T04:00:00Z');
                INSERT INTO tenant_order_profiles (
                  tenant_id, order_id, tracking_reference
                ) VALUES
                  ('a8800000-0000-4000-8000-000000000001', 'a8800000-0000-4000-8000-000000000101', 'TRACK-A-1'),
                  ('a8800000-0000-4000-8000-000000000001', 'a8800000-0000-4000-8000-000000000102', 'TRACK-A-2'),
                  ('a8800000-0000-4000-8000-000000000001', 'a8800000-0000-4000-8000-000000000103', 'TRACK-A-3'),
                  ('b8800000-0000-4000-8000-000000000001', 'b8800000-0000-4000-8000-000000000101', 'TRACK-B-1');
                """);
    }

    private static UUID uuid(String value) {
        return UUID.fromString(value);
    }

    private static void startPostgresql16() throws Exception {
        containerName = "erp-logistics-statistics-"
                + UUID.randomUUID().toString().replace("-", "");
        String id = runDocker(
                "run", "--rm", "-d", "--name", containerName,
                "-e", "POSTGRES_DB=erp_logistics_statistics",
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
                + "/erp_logistics_statistics";
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
                    .redirectErrorStream(true)
                    .start();
            String output = new String(
                    process.getInputStream().readAllBytes(),
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
}
