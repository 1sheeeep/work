package cn.xzkj.erp.iam.bootstrap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import cn.xzkj.erp.ErpApplication;
import cn.xzkj.erp.iam.application.InvalidPasswordCredentialException;
import cn.xzkj.erp.iam.application.LoginCommand;
import cn.xzkj.erp.iam.application.LoginResult;
import cn.xzkj.erp.iam.application.LoginService;
import cn.xzkj.erp.iam.application.PasswordCredentialService;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileStore;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermission;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer.OrderAnnotation;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import org.testcontainers.containers.PostgreSQLContainer;

@ExtendWith(OutputCaptureExtension.class)
@TestMethodOrder(OrderAnnotation.class)
class InitialAdminBootstrapIntegrationTest {

    private static PostgreSQLContainer<?> postgres;
    private static String jdbcUrl;
    private static String username;
    private static String password;
    private static ConfigurableApplicationContext context;
    private static InitialAdminBootstrapService bootstrapService;
    private static PasswordCredentialService credentialService;
    private static LoginService loginService;

    @TempDir
    Path temporaryDirectory;

    @BeforeAll
    static void start() {
        configureDatabase();
        Flyway flyway = Flyway.configure()
                .dataSource(jdbcUrl, username, password)
                .locations("classpath:db/migration")
                .cleanDisabled(false)
                .load();
        flyway.clean();
        flyway.migrate();
        context = new SpringApplicationBuilder(ErpApplication.class)
                .web(WebApplicationType.NONE)
                .environment(nonWebEnvironment(Map.of()))
                .run();
        bootstrapService =
                context.getBean(InitialAdminBootstrapService.class);
        credentialService =
                context.getBean(PasswordCredentialService.class);
        loginService = context.getBean(LoginService.class);
    }

    @AfterAll
    static void stop() {
        if (context != null) {
            context.close();
        }
        if (postgres != null) {
            postgres.stop();
        }
    }

    @Test
    @Order(1)
    void migratesEmptyDatabaseThroughLatestWithOnlyCanonicalPermissions()
            throws Exception {
        assertThat(queryStrings("""
                SELECT version
                FROM flyway_schema_history
                WHERE success = true AND version IS NOT NULL
                ORDER BY installed_rank
                """))
                .containsExactly(
                        "1", "10", "20", "21", "30", "31", "32", "33", "34",
                        "35", "36", "37", "38", "39", "40", "42", "43", "44",
                        "45", "46", "47", "48", "49", "50", "51", "52", "53",
                        "54", "55", "56", "57", "58", "59", "60", "61", "62",
                        "63", "64", "65", "66", "67", "68", "69", "70", "71",
                        "72", "73", "74", "75", "76", "77", "78", "79", "80",
                        "81", "82", "83", "84", "85", "86", "87", "88", "89",
                        "90", "91", "92", "93", "94", "95", "96", "97", "98",
                        "99", "100", "101", "102", "103", "104", "105", "106", "107", "108", "109", "110",
                        "111", "112", "113", "114", "115", "116", "117", "118", "119",
                        "120", "121", "122", "123");
        var expectedPermissions = TenantAdminPermissionCodes.EXACT_CODES.stream()
                .sorted()
                .toList();
        assertThat(queryStrings("""
                SELECT code
                FROM permissions
                ORDER BY code
                """))
                .containsExactlyElementsOf(expectedPermissions);
        assertThat(queryLong("""
                SELECT count(*) FROM permissions
                """)).isEqualTo(expectedPermissions.size());
        assertThat(queryString("""
                SELECT id::text FROM permissions
                WHERE code = 'iam:user:read'
                """)).isEqualTo("a3000000-0000-0000-0000-000000000001");
        rerunV34PermissionCatalog();
        assertThat(queryLong("""
                SELECT count(*) FROM permissions
                """)).isEqualTo(expectedPermissions.size());
        assertThat(queryLong("""
                SELECT
                  (SELECT count(*) FROM tenants)
                  + (SELECT count(*) FROM users)
                  + (SELECT count(*) FROM roles)
                  + (SELECT count(*) FROM user_roles)
                  + (SELECT count(*) FROM role_permissions)
                  + (SELECT count(*) FROM password_credentials)
                """)).isZero();
        assertThat(context.getBeansOfType(
                InitialAdminBootstrapRunner.class)).isEmpty();
    }

    @Test
    @Order(2)
    void enabledOneOffRunnerCreatesNewTenantWithSafeTokenDelivery(
            CapturedOutput output) throws Exception {
        Path tokenFile = temporaryDirectory.resolve("runner-activation.token");
        execute("""
                INSERT INTO permissions (id, code, module, name, description)
                VALUES (
                  'f3400000-0000-0000-0000-000000000001',
                  'future:permission',
                  'future',
                  'Future permission',
                  'Must never be granted automatically'
                )
                """);
        StandardEnvironment environment = nonWebEnvironment(Map.ofEntries(
                Map.entry(
                        "erp.bootstrap.initial-admin.enabled",
                        "true"),
                Map.entry(
                        "erp.bootstrap.initial-admin.tenant-code",
                        "runner_tenant"),
                Map.entry(
                        "erp.bootstrap.initial-admin.tenant-name",
                        "Runner Tenant"),
                Map.entry(
                        "erp.bootstrap.initial-admin.email",
                        "runner.admin@example.com"),
                Map.entry(
                        "erp.bootstrap.initial-admin.display-name",
                        "Runner Administrator"),
                Map.entry(
                        "erp.bootstrap.initial-admin.token-output-path",
                        tokenFile.toAbsolutePath().toString()),
                Map.entry(
                        "erp.bootstrap.initial-admin.ttl-minutes",
                        "30")));

        try (ConfigurableApplicationContext runnerContext =
                new SpringApplicationBuilder(ErpApplication.class)
                        .web(WebApplicationType.NONE)
                        .environment(environment)
                        .run()) {
            assertThat(runnerContext.getBean(
                    InitialAdminBootstrapRunner.class)).isNotNull();
        }

        assertProvisioned(
                "runner_tenant",
                "runner.admin@example.com",
                tokenFile);
        String rawToken = Files.readString(tokenFile, StandardCharsets.US_ASCII);
        String tokenHash = sha256(rawToken);
        assertThat(queryString("""
                SELECT credential.token_hash
                FROM password_credentials credential
                JOIN users user_account ON user_account.id = credential.user_id
                JOIN tenants tenant ON tenant.id = user_account.tenant_id
                WHERE tenant.code = 'runner_tenant'
                """)).isEqualTo(tokenHash);
        assertOwnerOnlyWhenPosix(tokenFile);
        assertSanitizedBootstrapAudit(
                "runner_tenant",
                rawToken,
                tokenHash,
                tokenFile);
        assertThat(output.getOut())
                .doesNotContain(rawToken)
                .doesNotContain(tokenHash)
                .doesNotContain(tokenFile.toString());
        assertThat(output.getErr())
                .doesNotContain(rawToken)
                .doesNotContain(tokenHash)
                .doesNotContain(tokenFile.toString());
    }

    @Test
    @Order(3)
    void provisionsExistingActiveTenantWithoutAnAdministrator()
            throws Exception {
        String tenantId = "d4000000-0000-0000-0000-000000000003";
        execute("""
                INSERT INTO tenants (id, code, name)
                VALUES (
                  '%s', 'existing_bootstrap', 'Existing Bootstrap Tenant'
                )
                """.formatted(tenantId));
        Path tokenFile = temporaryDirectory.resolve("existing.token");

        InitialAdminBootstrapService.ProvisionedAdmin provisioned =
                bootstrapService.provision(command(
                        "existing_bootstrap",
                        "Existing Bootstrap Tenant",
                        "existing.admin@example.com",
                        tokenFile));

        assertThat(provisioned.tenantId().toString()).isEqualTo(tenantId);
        assertProvisioned(
                "existing_bootstrap",
                "existing.admin@example.com",
                tokenFile);
        assertThat(queryLong("""
                SELECT count(*) FROM tenants
                WHERE code = 'existing_bootstrap'
                """)).isOne();
    }

    @Test
    @Order(4)
    void concurrentBootstrapHasExactlyOneWinner() throws Exception {
        Path firstOutput = temporaryDirectory.resolve("concurrent-a.token");
        Path secondOutput = temporaryDirectory.resolve("concurrent-b.token");
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        List<Future<Object>> futures = new ArrayList<>();
        try {
            futures.add(executor.submit(() -> provisionConcurrently(
                    command(
                            "concurrent_bootstrap",
                            "Concurrent Bootstrap Tenant",
                            "concurrent.admin@example.com",
                            firstOutput),
                    ready,
                    start)));
            futures.add(executor.submit(() -> provisionConcurrently(
                    command(
                            "concurrent_bootstrap",
                            "Concurrent Bootstrap Tenant",
                            "concurrent.admin@example.com",
                            secondOutput),
                    ready,
                    start)));
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            List<Object> outcomes = List.of(
                    futures.get(0).get(20, TimeUnit.SECONDS),
                    futures.get(1).get(20, TimeUnit.SECONDS));
            assertThat(outcomes.stream()
                    .filter(InitialAdminBootstrapService.ProvisionedAdmin.class::isInstance))
                    .hasSize(1);
            assertThat(outcomes.stream()
                    .filter(InitialAdminBootstrapException.class::isInstance))
                    .hasSize(1);
        } finally {
            executor.shutdownNow();
            assertThat(executor.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }

        assertThat(List.of(firstOutput, secondOutput).stream()
                .filter(Files::exists))
                .hasSize(1);
        assertThat(queryLong("""
                SELECT count(*)
                FROM users user_account
                JOIN tenants tenant ON tenant.id = user_account.tenant_id
                WHERE tenant.code = 'concurrent_bootstrap'
                """)).isOne();
        assertThat(queryLong("""
                SELECT count(*)
                FROM audit_logs audit
                JOIN tenants tenant ON tenant.id = audit.tenant_id
                WHERE tenant.code = 'concurrent_bootstrap'
                  AND audit.action = 'iam.bootstrap.admin_provisioned'
                """)).isOne();
    }

    @Test
    @Order(5)
    void repeatBootstrapFailsWithoutSideEffects() throws Exception {
        Path original = temporaryDirectory.resolve("repeat-original.token");
        bootstrapService.provision(command(
                "repeat_bootstrap",
                "Repeat Bootstrap Tenant",
                "repeat.admin@example.com",
                original));
        long rowCountBefore = tenantAggregateCount("repeat_bootstrap");
        Path repeated = temporaryDirectory.resolve("repeat-second.token");

        assertThatThrownBy(() -> bootstrapService.provision(command(
                "repeat_bootstrap",
                "Repeat Bootstrap Tenant",
                "repeat.admin@example.com",
                repeated)))
                .isExactlyInstanceOf(InitialAdminBootstrapException.class);

        assertThat(tenantAggregateCount("repeat_bootstrap"))
                .isEqualTo(rowCountBefore);
        assertThat(original).exists();
        assertThat(repeated).doesNotExist();
        assertThat(queryLong("""
                SELECT count(*)
                FROM audit_logs audit
                JOIN tenants tenant ON tenant.id = audit.tenant_id
                WHERE tenant.code = 'repeat_bootstrap'
                  AND audit.action = 'iam.bootstrap.admin_provisioned'
                """)).isOne();
    }

    @Test
    @Order(6)
    void existingOutputFileIsNeverOverwrittenAndDatabaseIsUnchanged()
            throws Exception {
        Path output = temporaryDirectory.resolve("already-exists.token");
        Files.writeString(output, "caller-owned-sentinel");

        assertThatThrownBy(() -> bootstrapService.provision(command(
                "existing_output",
                "Existing Output Tenant",
                "existing.output.admin@example.com",
                output)))
                .isExactlyInstanceOf(InitialAdminBootstrapException.class);

        assertThat(Files.readString(output)).isEqualTo("caller-owned-sentinel");
        assertThat(queryLong("""
                SELECT count(*) FROM tenants WHERE code = 'existing_output'
                """)).isZero();
    }

    @Test
    @Order(7)
    void databaseCommitFailureRemovesNewTokenFile() throws Exception {
        Path output = temporaryDirectory.resolve("rollback-cleanup.token");
        installDeferredBootstrapFailure();
        try {
            assertThatThrownBy(() -> bootstrapService.provision(command(
                    "commit_failure",
                    "Commit Failure Tenant",
                    "commit.failure.admin@example.com",
                    output)))
                    .isInstanceOf(RuntimeException.class);
        } finally {
            removeDeferredBootstrapFailure();
        }

        assertThat(output).doesNotExist();
        assertThat(queryLong("""
                SELECT count(*) FROM tenants WHERE code = 'commit_failure'
                """)).isZero();
    }

    @Test
    @Order(8)
    void activationWritesArgon2idEnablesLoginAndRejectsReplay()
            throws Exception {
        Path output = temporaryDirectory.resolve("activation-login.token");
        bootstrapService.provision(command(
                "activation_login",
                "Activation Login Tenant",
                "activation.admin@example.com",
                output));
        String rawToken = Files.readString(output, StandardCharsets.US_ASCII);
        String newPassword = "BootstrapPass-2026";

        credentialService.redeem(
                rawToken.toCharArray(),
                newPassword.toCharArray(),
                "bootstrap-activation",
                "127.0.0.1");
        LoginResult login = loginService.login(new LoginCommand(
                "activation_login",
                "activation.admin@example.com",
                newPassword,
                "bootstrap-login",
                "127.0.0.1"));

        assertThat(login.permissions())
                .containsExactlyElementsOf(
                        TenantAdminPermissionCodes.EXACT_CODES.stream()
                                .sorted()
                                .toList());
        assertThat(queryString("""
                SELECT user_account.status || ':' || user_account.password_hash
                FROM users user_account
                JOIN tenants tenant ON tenant.id = user_account.tenant_id
                WHERE tenant.code = 'activation_login'
                """))
                .startsWith("ACTIVE:{argon2id}$argon2id$");
        assertThatThrownBy(() -> credentialService.redeem(
                rawToken.toCharArray(),
                "DifferentPass-2026".toCharArray(),
                "bootstrap-replay",
                "127.0.0.1"))
                .isExactlyInstanceOf(InvalidPasswordCredentialException.class);
    }

    @Test
    @Order(9)
    void expiredBootstrapCredentialFailsWithoutActivatingUser()
            throws Exception {
        Path output = temporaryDirectory.resolve("expired.token");
        bootstrapService.provision(command(
                "expired_bootstrap",
                "Expired Bootstrap Tenant",
                "expired.admin@example.com",
                output));
        String rawToken = Files.readString(output, StandardCharsets.US_ASCII);
        execute("""
                UPDATE password_credentials credential
                SET created_at = now() - interval '2 hours',
                    expires_at = now() - interval '1 hour'
                FROM users user_account, tenants tenant
                WHERE credential.user_id = user_account.id
                  AND user_account.tenant_id = tenant.id
                  AND tenant.code = 'expired_bootstrap'
                """);

        assertThatThrownBy(() -> credentialService.redeem(
                rawToken.toCharArray(),
                "ExpiredPass-2026".toCharArray(),
                "bootstrap-expired",
                "127.0.0.1"))
                .isExactlyInstanceOf(InvalidPasswordCredentialException.class);
        assertThat(queryString("""
                SELECT user_account.status || ':'
                       || COALESCE(user_account.password_hash, 'NULL')
                FROM users user_account
                JOIN tenants tenant ON tenant.id = user_account.tenant_id
                WHERE tenant.code = 'expired_bootstrap'
                """)).isEqualTo("DISABLED:NULL");
    }

    @Test
    @Order(10)
    void concurrentRedemptionHasOneWinnerAndOneActivationAudit()
            throws Exception {
        Path output = temporaryDirectory.resolve("concurrent-redeem.token");
        bootstrapService.provision(command(
                "concurrent_redeem",
                "Concurrent Redeem Tenant",
                "redeem.admin@example.com",
                output));
        String rawToken = Files.readString(output, StandardCharsets.US_ASCII);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        List<Future<Object>> futures = new ArrayList<>();
        try {
            for (int index = 0; index < 2; index++) {
                int requestIndex = index;
                futures.add(executor.submit(() -> {
                    start.await(10, TimeUnit.SECONDS);
                    try {
                        credentialService.redeem(
                                rawToken.toCharArray(),
                                "ConcurrentPass-2026".toCharArray(),
                                "concurrent-redeem-" + requestIndex,
                                "127.0.0.1");
                        return Boolean.TRUE;
                    } catch (RuntimeException failure) {
                        return failure;
                    }
                }));
            }
            start.countDown();
            List<Object> outcomes = List.of(
                    futures.get(0).get(20, TimeUnit.SECONDS),
                    futures.get(1).get(20, TimeUnit.SECONDS));
            assertThat(outcomes).contains(Boolean.TRUE);
            assertThat(outcomes.stream()
                    .filter(InvalidPasswordCredentialException.class::isInstance))
                    .hasSize(1);
        } finally {
            executor.shutdownNow();
            assertThat(executor.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }
        assertThat(queryLong("""
                SELECT count(*)
                FROM audit_logs audit
                JOIN tenants tenant ON tenant.id = audit.tenant_id
                WHERE tenant.code = 'concurrent_redeem'
                  AND audit.action = 'iam.user.activated'
                """)).isOne();
    }

    @Test
    @Order(11)
    void enabledBootstrapCannotStartAsAWebApplication() throws Exception {
        StandardEnvironment environment = servletEnvironment();
        environment.getPropertySources().addFirst(new MapPropertySource(
                "iam-bootstrap-enabled-web",
                Map.of(
                        "erp.bootstrap.initial-admin.enabled",
                        "true")));

        assertThatThrownBy(() -> new SpringApplicationBuilder(
                        ErpApplication.class)
                .web(WebApplicationType.SERVLET)
                .environment(environment)
                .run())
                .isInstanceOf(InitialAdminBootstrapException.class)
                .hasMessage("Initial administrator bootstrap failed safely");
        assertThat(queryLong("""
                SELECT count(*) FROM tenants WHERE code = 'web_bootstrap'
                """)).isZero();
    }

    @Test
    @Order(12)
    void webApplicationExposesNoBootstrapHttpEndpoint() {
        StandardEnvironment environment = servletEnvironment();
        try (ConfigurableApplicationContext webContext =
                new SpringApplicationBuilder(ErpApplication.class)
                        .web(WebApplicationType.SERVLET)
                        .environment(environment)
                        .run()) {
            RequestMappingHandlerMapping mappings =
                    webContext.getBean(
                            "requestMappingHandlerMapping",
                            RequestMappingHandlerMapping.class);
            assertThat(mappings.getHandlerMethods().entrySet())
                    .allSatisfy(entry -> {
                        assertThat(entry.getKey().toString())
                                .doesNotContainIgnoringCase("bootstrap");
                        assertThat(entry.getValue()
                                .getBeanType()
                                .getPackageName())
                                .doesNotStartWith(
                                        "cn.xzkj.erp.iam.bootstrap");
                    });
        }
    }

    private static Object provisionConcurrently(
            InitialAdminBootstrapCommand command,
            CountDownLatch ready,
            CountDownLatch start) throws InterruptedException {
        ready.countDown();
        start.await(10, TimeUnit.SECONDS);
        try {
            return bootstrapService.provision(command);
        } catch (RuntimeException failure) {
            return failure;
        }
    }

    private InitialAdminBootstrapCommand command(
            String tenantCode,
            String tenantName,
            String adminUsername,
            Path outputPath) {
        return new InitialAdminBootstrapCommand(
                tenantCode,
                tenantName,
                adminUsername,
                "Bootstrap Administrator",
                outputPath.toAbsolutePath(),
                30);
    }

    private static void assertProvisioned(
            String tenantCode,
            String adminUsername,
            Path tokenFile) throws Exception {
        assertThat(tokenFile).isRegularFile();
        assertThat(queryString("""
                SELECT tenant.status || ':' || user_account.status || ':'
                       || COALESCE(user_account.password_hash, 'NULL') || ':'
                       || role.code || ':' || role.system_role
                FROM tenants tenant
                JOIN users user_account
                  ON user_account.tenant_id = tenant.id
                JOIN user_roles user_role
                  ON user_role.tenant_id = tenant.id
                 AND user_role.user_id = user_account.id
                JOIN roles role
                  ON role.id = user_role.role_id
                 AND role.tenant_id = user_role.tenant_id
                WHERE tenant.code = '%s'
                  AND user_account.username = '%s'
                """.formatted(tenantCode, adminUsername)))
                .isEqualTo("ACTIVE:DISABLED:NULL:tenant_admin:true");
        assertThat(queryStrings("""
                SELECT permission.code
                FROM permissions permission
                JOIN role_permissions role_permission
                  ON role_permission.permission_id = permission.id
                JOIN roles role ON role.id = role_permission.role_id
                JOIN tenants tenant ON tenant.id = role.tenant_id
                WHERE tenant.code = '%s'
                  AND role.code = 'tenant_admin'
                ORDER BY permission.code
                """.formatted(tenantCode)))
                .containsExactlyElementsOf(
                        TenantAdminPermissionCodes.EXACT_CODES.stream()
                                .sorted()
                                .toList());
        assertThat(queryString("""
                SELECT role.name || ':' || role.system_role || ':'
                       || role.preset_role
                FROM roles role
                JOIN tenants tenant ON tenant.id = role.tenant_id
                WHERE tenant.code = '%s'
                  AND role.code = 'tenant_admin'
                """.formatted(tenantCode)))
                .isEqualTo("企业管理员:true:false");
        assertThat(queryLong("""
                SELECT count(*)
                FROM roles role
                JOIN tenants tenant ON tenant.id = role.tenant_id
                WHERE tenant.code = '%s'
                  AND role.preset_role = true
                  AND role.system_role = false
                """.formatted(tenantCode))).isEqualTo(12);
        assertThat(queryLong("""
                SELECT count(*)
                FROM password_credentials credential
                JOIN users user_account ON user_account.id = credential.user_id
                JOIN tenants tenant ON tenant.id = user_account.tenant_id
                WHERE tenant.code = '%s'
                  AND credential.purpose = 'ACTIVATION'
                  AND credential.created_by_user_id = user_account.id
                  AND credential.consumed_at IS NULL
                  AND credential.revoked_at IS NULL
                """.formatted(tenantCode))).isOne();
    }

    private static void assertSanitizedBootstrapAudit(
            String tenantCode,
            String rawToken,
            String tokenHash,
            Path outputPath) throws Exception {
        String audit = queryString("""
                SELECT row_to_json(audit)::text
                FROM audit_logs audit
                JOIN tenants tenant ON tenant.id = audit.tenant_id
                WHERE tenant.code = '%s'
                  AND audit.action = 'iam.bootstrap.admin_provisioned'
                """.formatted(tenantCode));
        assertThat(audit)
                .contains("\"resource_type\":\"user\"")
                .contains("\"roleCode\": \"tenant_admin\"")
                .contains("\"ttlMinutes\": \"30\"")
                .doesNotContain(rawToken)
                .doesNotContain(tokenHash)
                .doesNotContain(outputPath.toString())
                .doesNotContainIgnoringCase("password")
                .doesNotContainIgnoringCase("token")
                .doesNotContainIgnoringCase("credential");
    }

    private static void assertOwnerOnlyWhenPosix(Path outputPath)
            throws Exception {
        FileStore store = Files.getFileStore(outputPath);
        if (store.supportsFileAttributeView("posix")) {
            assertThat(Files.getPosixFilePermissions(outputPath))
                    .containsExactlyInAnyOrder(
                            PosixFilePermission.OWNER_READ,
                            PosixFilePermission.OWNER_WRITE);
        }
    }

    private static long tenantAggregateCount(String tenantCode)
            throws Exception {
        return queryLong("""
                SELECT
                  (SELECT count(*) FROM tenants tenant
                   WHERE tenant.code = '%1$s')
                  + (SELECT count(*) FROM users user_account
                     JOIN tenants tenant ON tenant.id = user_account.tenant_id
                     WHERE tenant.code = '%1$s')
                  + (SELECT count(*) FROM roles role
                     JOIN tenants tenant ON tenant.id = role.tenant_id
                     WHERE tenant.code = '%1$s')
                  + (SELECT count(*) FROM password_credentials credential
                     JOIN tenants tenant ON tenant.id = credential.tenant_id
                     WHERE tenant.code = '%1$s')
                  + (SELECT count(*) FROM audit_logs audit
                     JOIN tenants tenant ON tenant.id = audit.tenant_id
                     WHERE tenant.code = '%1$s')
                """.formatted(tenantCode));
    }

    private static void installDeferredBootstrapFailure() throws Exception {
        execute("""
                CREATE OR REPLACE FUNCTION fail_bootstrap_commit()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $$
                BEGIN
                  RAISE EXCEPTION 'forced bootstrap commit failure';
                END;
                $$
                """);
        execute("""
                CREATE CONSTRAINT TRIGGER fail_bootstrap_commit_trigger
                AFTER INSERT ON audit_logs
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW
                WHEN (NEW.action = 'iam.bootstrap.admin_provisioned')
                EXECUTE FUNCTION fail_bootstrap_commit()
                """);
    }

    private static void removeDeferredBootstrapFailure() throws Exception {
        execute("""
                DROP TRIGGER IF EXISTS fail_bootstrap_commit_trigger
                ON audit_logs
                """);
        execute("DROP FUNCTION IF EXISTS fail_bootstrap_commit()");
    }

    private static StandardEnvironment nonWebEnvironment(
            Map<String, Object> additional) {
        StandardEnvironment environment = baseEnvironment();
        Map<String, Object> properties = new java.util.LinkedHashMap<>();
        properties.put("spring.main.web-application-type", "none");
        properties.putAll(additional);
        environment.getPropertySources().addFirst(new MapPropertySource(
                "iam-bootstrap-non-web",
                properties));
        return environment;
    }

    private static StandardEnvironment servletEnvironment() {
        StandardEnvironment environment = baseEnvironment();
        environment.getPropertySources().addFirst(new MapPropertySource(
                "iam-bootstrap-servlet",
                Map.of("server.port", "0")));
        return environment;
    }

    private static StandardEnvironment baseEnvironment() {
        StandardEnvironment environment = new StandardEnvironment();
        environment.getPropertySources().addFirst(new MapPropertySource(
                "iam-bootstrap-database",
                Map.of(
                        "spring.datasource.url", jdbcUrl,
                        "spring.datasource.username", username,
                        "spring.datasource.password", password,
                        "erp.environment", "integration-test")));
        return environment;
    }

    private static String sha256(String value) throws Exception {
        return HexFormat.of().formatHex(
                MessageDigest.getInstance("SHA-256")
                        .digest(value.getBytes(StandardCharsets.US_ASCII)));
    }

    private static long queryLong(String sql) throws Exception {
        try (Connection connection = connection();
                Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery(sql)) {
            assertThat(result.next()).isTrue();
            return result.getLong(1);
        }
    }

    private static String queryString(String sql) throws Exception {
        try (Connection connection = connection();
                Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery(sql)) {
            assertThat(result.next()).isTrue();
            String value = result.getString(1);
            assertThat(result.next()).isFalse();
            return value;
        }
    }

    private static List<String> queryStrings(String sql) throws Exception {
        try (Connection connection = connection();
                Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery(sql)) {
            List<String> values = new ArrayList<>();
            while (result.next()) {
                values.add(result.getString(1));
            }
            return values;
        }
    }

    private static void execute(String sql) throws Exception {
        try (Connection connection = connection();
                Statement statement = connection.createStatement()) {
            statement.execute(sql);
        }
    }

    private static void rerunV34PermissionCatalog() throws Exception {
        try (var resource = InitialAdminBootstrapIntegrationTest.class
                .getResourceAsStream(
                        "/db/migration/V34__iam_permission_catalog.sql")) {
            assertThat(resource).isNotNull();
            execute(new String(
                    resource.readAllBytes(),
                    StandardCharsets.UTF_8));
        }
    }

    private static Connection connection() throws Exception {
        return DriverManager.getConnection(jdbcUrl, username, password);
    }

    private static void configureDatabase() {
        String externalUrl = System.getenv("ERP_TEST_DB_URL");
        if (externalUrl != null && !externalUrl.isBlank()) {
            jdbcUrl = externalUrl;
            username = requiredEnvironment("ERP_TEST_DB_USER");
            password = requiredEnvironment("ERP_TEST_DB_PASSWORD");
            return;
        }
        try {
            postgres = new PostgreSQLContainer<>("postgres:16-alpine")
                    .withDatabaseName("erp_iam_bootstrap_test")
                    .withUsername("erp_test")
                    .withPassword("integration-test-only");
            postgres.start();
            jdbcUrl = postgres.getJdbcUrl();
            username = postgres.getUsername();
            password = postgres.getPassword();
        } catch (RuntimeException unavailableDocker) {
            Assumptions.assumeTrue(
                    false,
                    "Docker is unavailable and ERP_TEST_DB_URL was not supplied");
        }
    }

    private static String requiredEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(
                    name + " is required when ERP_TEST_DB_URL is set");
        }
        return value;
    }
}
