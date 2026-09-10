package cn.xzkj.erp.logistics.authorization;

import static org.assertj.core.api.Assertions.assertThat;

import cn.xzkj.erp.logistics.authorization.LogisticsProviderConnectorGateway.DiscoveredChannel;
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
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class LogisticsAuthorizationPostgresql16GateTest {
    private static final String DB_USER = "erp";
    private static final String DB_PASSWORD = "erp";
    private static final UUID TENANT_ID = UUID.fromString(
            "a7860000-0000-4000-8000-000000000001");
    private static final UUID USER_ID = UUID.fromString(
            "a7860000-0000-4000-8000-000000000002");
    private static final UUID AUTHORIZATION_ID = UUID.fromString(
            "a7860000-0000-4000-8000-000000000003");
    private static String containerName;
    private static String jdbcUrl;
    private static LogisticsAuthorizationRepository repository;

    @BeforeAll
    static void migrate() throws Exception {
        startPostgresql16();
        Flyway migration = Flyway.configure()
                .dataSource(jdbcUrl, DB_USER, DB_PASSWORD)
                .locations("classpath:db/migration")
                .load();
        assertThat(migration.migrate().success).isTrue();
        assertThat(migration.info().current().getVersion().getVersion())
                .isEqualTo("123");
        DriverManagerDataSource dataSource = new DriverManagerDataSource(
                jdbcUrl, DB_USER, DB_PASSWORD);
        repository = new LogisticsAuthorizationRepository(
                new NamedParameterJdbcTemplate(dataSource));
        new org.springframework.jdbc.core.JdbcTemplate(dataSource).update("""
                insert into tenants (id, code, name) values
                    ('a7860000-0000-4000-8000-000000000001',
                     'logistics_auth_a', 'Logistics Authorization A');
                insert into users (id, tenant_id, username, display_name) values
                    ('a7860000-0000-4000-8000-000000000002',
                     'a7860000-0000-4000-8000-000000000001',
                     'logistics.operator', 'Logistics Operator');
                """);
    }

    @AfterAll
    static void stop() {
        if (containerName != null) runDocker("rm", "-f", containerName);
    }

    @Test
    void boundedAuthorizationListQueryIsValidAgainstPostgresql16() {
        var page = repository.list(UUID.randomUUID(), "CUSTOM",
                "100%_carrier\\", "ACTIVE", PageRequest.of(0, 25));
        assertThat(page).isEmpty();
        assertThat(page.getTotalElements()).isZero();

        var unfiltered = repository.list(UUID.randomUUID(), "PLATFORM",
                null, null, PageRequest.of(0, 25));
        assertThat(unfiltered).isEmpty();
        assertThat(unfiltered.getTotalElements()).isZero();
    }

    @Test
    void storesEncryptedDirectCredentialsAndTransitionsConnectionState() {
        var actor = new LogisticsAuthorizationService.Actor(
                TENANT_ID, USER_ID, null, "Logistics Operator",
                "logistics-auth-postgresql-uat", "127.0.0.1");
        repository.insert(AUTHORIZATION_ID, TENANT_ID,
                new LogisticsAuthorizationService.AuthorizationInput(
                        "PLATFORM", "YUNEXPRESS", "云途物流", "华南发货账号",
                        "DIRECT_CREDENTIALS", null, null, "PostgreSQL gate"), actor);
        byte[] nonce = new byte[12];
        byte[] ciphertext = new byte[32];
        java.util.Arrays.fill(ciphertext, (byte) 7);
        repository.saveCredential(AUTHORIZATION_ID, TENANT_ID,
                new LogisticsCredentialCipher.EncryptedCredential(
                        "v1", nonce, ciphertext), actor);

        LogisticsAuthorizationRecord pending = repository.find(
                TENANT_ID, AUTHORIZATION_ID);
        assertThat(pending.providerCode()).isEqualTo("YUNEXPRESS");
        assertThat(pending.integrationMode()).isEqualTo("DIRECT_CREDENTIALS");
        assertThat(pending.credentialConfigured()).isTrue();
        assertThat(pending.credentialType()).isEqualTo("ENCRYPTED");
        assertThat(pending.status()).isEqualTo("PENDING");
        assertThat(repository.findByIdentity(
                TENANT_ID, pending.category(), pending.providerName(), pending.accountLabel()).id())
                .isEqualTo(AUTHORIZATION_ID);
        assertThat(repository.findCredential(TENANT_ID, AUTHORIZATION_ID)
                .ciphertext()).containsExactly(ciphertext);

        assertThat(repository.activate(
                TENANT_ID, AUTHORIZATION_ID, pending.version(), actor)).isTrue();
        LogisticsAuthorizationRecord active = repository.find(
                TENANT_ID, AUTHORIZATION_ID);
        assertThat(active.status()).isEqualTo("ACTIVE");
        assertThat(active.version()).isEqualTo(1);

        assertThat(repository.updateAccountLabel(
                TENANT_ID, AUTHORIZATION_ID, active.version(),
                "美西仓账号", actor)).isTrue();
        active = repository.find(TENANT_ID, AUTHORIZATION_ID);
        assertThat(active.accountLabel()).isEqualTo("美西仓账号");
        assertThat(active.status()).isEqualTo("ACTIVE");
        assertThat(active.version()).isEqualTo(2);

        repository.synchronizeChannels(TENANT_ID, AUTHORIZATION_ID, List.of(
                new DiscoveredChannel("US-01", "美国专线"),
                new DiscoveredChannel("EU-02", "欧洲专线")), actor);
        List<LogisticsAuthorizationChannelRecord> synchronizedChannels =
                repository.listChannels(TENANT_ID, AUTHORIZATION_ID);
        assertThat(synchronizedChannels).hasSize(2)
                .allMatch(LogisticsAuthorizationChannelRecord::providerAvailable)
                .allMatch(channel -> "美西仓账号".equals(channel.accountLabel()))
                .noneMatch(LogisticsAuthorizationChannelRecord::enabled);
        LogisticsAuthorizationChannelRecord usChannel = synchronizedChannels.stream()
                .filter(channel -> "US-01".equals(channel.channelCode()))
                .findFirst().orElseThrow();
        assertThat(repository.setChannelEnabled(TENANT_ID, AUTHORIZATION_ID,
                usChannel.id(), usChannel.version(), true, actor)).isTrue();
        assertThat(repository.listEnabledChannels(TENANT_ID))
                .extracting(LogisticsAuthorizationChannelRecord::channelCode)
                .containsExactly("US-01");

        repository.synchronizeChannels(TENANT_ID, AUTHORIZATION_ID, List.of(
                new DiscoveredChannel("US-01", "美国专线"),
                new DiscoveredChannel("EU-02", "欧洲专线")), actor);
        assertThat(repository.findChannel(TENANT_ID, AUTHORIZATION_ID,
                usChannel.id()).enabled()).isTrue();

        repository.synchronizeChannels(TENANT_ID, AUTHORIZATION_ID, List.of(
                new DiscoveredChannel("EU-02", "欧洲专线")), actor);
        LogisticsAuthorizationChannelRecord unavailableUs = repository.findChannel(
                TENANT_ID, AUTHORIZATION_ID, usChannel.id());
        assertThat(unavailableUs.providerAvailable()).isFalse();
        assertThat(unavailableUs.enabled()).isFalse();
        assertThat(repository.listEnabledChannels(TENANT_ID)).isEmpty();

        assertThat(repository.archive(
                TENANT_ID, AUTHORIZATION_ID, active.version(), actor)).isTrue();
        LogisticsAuthorizationRecord disabled = repository.find(
                TENANT_ID, AUTHORIZATION_ID);
        assertThat(disabled.status()).isEqualTo("ARCHIVED");
        assertThat(disabled.credentialConfigured()).isTrue();

        assertThat(repository.enable(
                TENANT_ID, AUTHORIZATION_ID, disabled.version(), actor)).isTrue();
        LogisticsAuthorizationRecord reenabled = repository.find(
                TENANT_ID, AUTHORIZATION_ID);
        assertThat(reenabled.status()).isEqualTo("PENDING");
        assertThat(reenabled.credentialConfigured()).isTrue();

        assertThat(repository.archive(
                TENANT_ID, AUTHORIZATION_ID, reenabled.version(), actor)).isTrue();
        LogisticsAuthorizationRecord disabledAgain = repository.find(
                TENANT_ID, AUTHORIZATION_ID);
        assertThat(repository.deleteArchived(
                TENANT_ID, AUTHORIZATION_ID, disabledAgain.version())).isTrue();
        assertThat(repository.find(TENANT_ID, AUTHORIZATION_ID)).isNull();
        assertThat(repository.findByIdentity(
                TENANT_ID, pending.category(), pending.providerName(), pending.accountLabel())).isNull();
        assertThat(repository.findCredential(TENANT_ID, AUTHORIZATION_ID)).isNull();
    }

    private static void startPostgresql16() throws Exception {
        containerName = "erp-logistics-authorization-"
                + UUID.randomUUID().toString().replace("-", "");
        String id = runDocker(
                "run", "--rm", "-d", "--name", containerName,
                "-e", "POSTGRES_DB=erp_logistics_authorization",
                "-e", "POSTGRES_USER=" + DB_USER,
                "-e", "POSTGRES_PASSWORD=" + DB_PASSWORD,
                "-p", "127.0.0.1::5432", "postgres:16-alpine");
        assertThat(id).isNotBlank();
        String binding = runDocker("port", containerName, "5432/tcp").strip();
        int separator = binding.lastIndexOf(':');
        if (separator < 0) throw new IllegalStateException("Docker did not publish PostgreSQL");
        jdbcUrl = "jdbc:postgresql://127.0.0.1:"
                + binding.substring(separator + 1) + "/erp_logistics_authorization";
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
