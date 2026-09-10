package cn.xzkj.erp.settings.address;

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

import cn.xzkj.erp.settings.address.AddressMappingService.AddressType;
import cn.xzkj.erp.settings.address.AddressMappingService.MappingInput;
import cn.xzkj.erp.settings.address.AddressMappingService.MappingQuery;
import cn.xzkj.erp.settings.address.AddressMappingService.Platform;

class AddressMappingPostgresql16GateTest {
    private static final String DB_USER = "erp";
    private static final String DB_PASSWORD = "erp";
    private static final UUID TENANT_A = UUID.fromString(
            "a9600000-0000-4000-8000-000000000001");
    private static final UUID TENANT_B = UUID.fromString(
            "b9600000-0000-4000-8000-000000000001");
    private static final UUID USER_A = UUID.fromString(
            "a9600000-0000-4000-8000-000000000002");
    private static final UUID USER_B = UUID.fromString(
            "b9600000-0000-4000-8000-000000000002");
    private static String containerName;
    private static AddressMappingRepository repository;

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
                  ('a9600000-0000-4000-8000-000000000001', 'mapping_a', 'Tenant A'),
                  ('b9600000-0000-4000-8000-000000000001', 'mapping_b', 'Tenant B');
                insert into users (id, tenant_id, username, display_name) values
                  ('a9600000-0000-4000-8000-000000000002',
                   'a9600000-0000-4000-8000-000000000001', 'mapping-a', 'User A'),
                  ('b9600000-0000-4000-8000-000000000002',
                   'b9600000-0000-4000-8000-000000000001', 'mapping-b', 'User B');
                """, new MapSqlParameterSource());
        repository = new AddressMappingRepository(jdbc);
    }

    @AfterAll
    static void stop() {
        if (containerName != null) runDocker("rm", "-f", containerName);
    }

    @Test
    void mappingIsTenantOwnedVersionedUniqueAndAppliedOnlyWhenEnabled() {
        UUID firstId = UUID.randomUUID();
        MappingInput input = new MappingInput(Platform.SHOPIFY, "JP",
                AddressType.PROVINCE, "Tōkyō", "東京都", true);
        repository.insert(TENANT_A, firstId, input, "tōkyō", actorA());

        assertThat(repository.resolve(TENANT_A, Platform.SHOPIFY, "JP",
                AddressType.PROVINCE, "tōkyō")).isEmpty();
        repository.insertSetting(TENANT_A, true, actorA());
        assertThat(repository.resolve(TENANT_A, Platform.SHOPIFY, "JP",
                AddressType.PROVINCE, "tōkyō")).contains("東京都");
        assertThat(repository.resolve(TENANT_B, Platform.SHOPIFY, "JP",
                AddressType.PROVINCE, "tōkyō")).isEmpty();

        assertThatThrownBy(() -> repository.insert(TENANT_A, UUID.randomUUID(),
                input, "tōkyō", actorA()))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThat(repository.update(TENANT_A, firstId, 9,
                input, "tōkyō", actorA())).isFalse();
        assertThat(repository.update(TENANT_A, firstId, 0,
                new MappingInput(Platform.SHOPIFY, "JP", AddressType.PROVINCE,
                        "Tōkyō", "東京都港区", false), "tōkyō", actorA())).isTrue();
        assertThat(repository.find(TENANT_A, firstId)).get()
                .satisfies(value -> {
                    assertThat(value.version()).isEqualTo(1);
                    assertThat(value.enabled()).isFalse();
                    assertThat(value.mappedValue()).isEqualTo("東京都港区");
                });
        assertThat(repository.list(TENANT_B, new MappingQuery(null, null,
                null, null, 0, 25)).totalElements()).isZero();

        assertThat(repository.delete(TENANT_A, firstId, 1, actorA())).isTrue();
        UUID replacementId = UUID.randomUUID();
        repository.insert(TENANT_A, replacementId, input, "tōkyō", actorA());
        assertThat(repository.find(TENANT_A, replacementId)).isPresent();
    }

    @Test
    void databaseRejectsInvalidCountryAndCrossTenantActors() {
        MappingInput invalid = new MappingInput(Platform.SHOPIFY, "jp",
                AddressType.CITY, "Tokyo", "東京", true);
        assertThatThrownBy(() -> repository.insert(TENANT_A, UUID.randomUUID(),
                invalid, "tokyo", actorA()))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> repository.insert(TENANT_A, UUID.randomUUID(),
                new MappingInput(Platform.SHOPIFY, "JP", AddressType.CITY,
                        "Tokyo", "東京", true), "tokyo", actorB()))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    private static AddressMappingService.Actor actorA() {
        return new AddressMappingService.Actor(TENANT_A, USER_A, null,
                "User A", "request-a", "127.0.0.1");
    }

    private static AddressMappingService.Actor actorB() {
        return new AddressMappingService.Actor(TENANT_A, USER_B, null,
                "User B", "request-b", "127.0.0.1");
    }

    private static String startPostgresql16() throws Exception {
        containerName = "erp-address-mapping-"
                + UUID.randomUUID().toString().replace("-", "");
        String id = runDocker(
                "run", "--rm", "-d", "--name", containerName,
                "-e", "POSTGRES_DB=erp_address_mapping",
                "-e", "POSTGRES_USER=" + DB_USER,
                "-e", "POSTGRES_PASSWORD=" + DB_PASSWORD,
                "-p", "127.0.0.1::5432", "postgres:16-alpine");
        assertThat(id).isNotBlank();
        String binding = runDocker("port", containerName, "5432/tcp").strip();
        String jdbcUrl = "jdbc:postgresql://127.0.0.1:"
                + binding.substring(binding.lastIndexOf(':') + 1)
                + "/erp_address_mapping";
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
}
