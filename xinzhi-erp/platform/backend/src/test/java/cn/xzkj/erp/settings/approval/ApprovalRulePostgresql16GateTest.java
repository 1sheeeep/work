package cn.xzkj.erp.settings.approval;

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

class ApprovalRulePostgresql16GateTest {
    private static final String DB_USER = "erp";
    private static final String DB_PASSWORD = "erp";
    private static final UUID TENANT_A = UUID.fromString("a9900000-0000-4000-8000-000000000001");
    private static final UUID TENANT_B = UUID.fromString("b9900000-0000-4000-8000-000000000001");
    private static final UUID USER_A = UUID.fromString("a9900000-0000-4000-8000-000000000002");
    private static final UUID USER_A2 = UUID.fromString("a9900000-0000-4000-8000-000000000003");
    private static final UUID USER_B = UUID.fromString("b9900000-0000-4000-8000-000000000002");
    private static String containerName;
    private static ApprovalRuleRepository repository;

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
                  ('a9900000-0000-4000-8000-000000000001', 'approval_a', 'Tenant A'),
                  ('b9900000-0000-4000-8000-000000000001', 'approval_b', 'Tenant B');
                insert into users (id, tenant_id, username, display_name) values
                  ('a9900000-0000-4000-8000-000000000002',
                   'a9900000-0000-4000-8000-000000000001', 'approval-a', 'Reviewer A'),
                  ('a9900000-0000-4000-8000-000000000003',
                   'a9900000-0000-4000-8000-000000000001', 'approval-a2', 'Reviewer A2'),
                  ('b9900000-0000-4000-8000-000000000002',
                   'b9900000-0000-4000-8000-000000000001', 'approval-b', 'Reviewer B');
                """, new MapSqlParameterSource());
        repository = new ApprovalRuleRepository(jdbc);
    }

    @AfterAll
    static void stop() {
        if (containerName != null) runDocker("rm", "-f", containerName);
    }

    @Test
    void rulesPersistOrderedApproversWithTenantAndVersionGuards() {
        UUID ruleId = UUID.randomUUID();
        repository.insert(TENANT_A, ruleId, input("采购单复核", true,
                List.of(USER_A2, USER_A)), actorA());

        ApprovalRuleRecord created = repository.find(TENANT_A, ruleId).orElseThrow();
        assertThat(created.version()).isZero();
        assertThat(created.approvers())
                .extracting(ApprovalRuleRecord.Approver::userId)
                .containsExactly(USER_A2, USER_A);
        assertThat(repository.find(TENANT_B, ruleId)).isEmpty();
        assertThat(repository.candidates(TENANT_A))
                .extracting(ApprovalRuleService.ApproverCandidate::userId)
                .containsExactlyInAnyOrder(USER_A, USER_A2);

        assertThat(repository.update(TENANT_A, ruleId, 9,
                input("采购单复核", true, List.of(USER_A)), actorA())).isFalse();
        assertThat(repository.setEnabled(TENANT_A, ruleId, 0, false, actorA())).isTrue();
        assertThat(repository.find(TENANT_A, ruleId).orElseThrow().version()).isEqualTo(1);

        assertThatThrownBy(() -> repository.insert(TENANT_B, UUID.randomUUID(),
                input("跨租户规则", true, List.of(USER_A)), actorB()))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> repository.insert(TENANT_A, UUID.randomUUID(),
                input("采购单复核", true, List.of(USER_A)), actorA()))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    private static ApprovalRuleService.RuleInput input(String name,
            boolean enabled, List<UUID> approvers) {
        return new ApprovalRuleService.RuleInput(2, name,
                name.toLowerCase(java.util.Locale.ROOT),
                ApprovalRuleService.DocumentType.PROCUREMENT_ORDER,
                "提交后按顺序复核", enabled, approvers);
    }

    private static ApprovalRuleService.Actor actorA() {
        return new ApprovalRuleService.Actor(TENANT_A, USER_A, null,
                "Reviewer A", "request-approval-a", "127.0.0.1");
    }

    private static ApprovalRuleService.Actor actorB() {
        return new ApprovalRuleService.Actor(TENANT_B, USER_B, null,
                "Reviewer B", "request-approval-b", "127.0.0.1");
    }

    private static String startPostgresql16() throws Exception {
        containerName = "erp-approval-rule-"
                + UUID.randomUUID().toString().replace("-", "");
        String id = runDocker("run", "--rm", "-d", "--name", containerName,
                "-e", "POSTGRES_DB=erp_approval_rule",
                "-e", "POSTGRES_USER=" + DB_USER,
                "-e", "POSTGRES_PASSWORD=" + DB_PASSWORD,
                "-p", "127.0.0.1::5432", "postgres:16-alpine");
        assertThat(id).isNotBlank();
        String binding = runDocker("port", containerName, "5432/tcp").strip();
        String jdbcUrl = "jdbc:postgresql://127.0.0.1:"
                + binding.substring(binding.lastIndexOf(':') + 1)
                + "/erp_approval_rule";
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
