package cn.xzkj.erp.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.jayway.jsonpath.JsonPath;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer.OrderAnnotation;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.testcontainers.DockerClientFactory;
import org.testcontainers.containers.PostgreSQLContainer;

@ExtendWith(OutputCaptureExtension.class)
@TestMethodOrder(OrderAnnotation.class)
class AuthenticationTokenLifecyclePostgresql16GateTest {

    private static final PostgresqlApiFixture FIXTURE =
            new PostgresqlApiFixture();
    private static final String ROOT_PASSWORD =
            PostgresqlApiFixture.SYSTEM_ADMIN_PASSWORD;
    private static final String TENANT_ADMIN_PASSWORD =
            "auth-lifecycle-tenant-admin-password";
    private static final String RESET_PASSWORD =
            "auth-lifecycle-reset-password";
    private static final String FORGED_TOKEN = "A".repeat(43);

    private static MockMvc mockMvc;
    private static String rootToken;
    private static TenantAccount tenantA;
    private static TenantAccount tenantB;

    @BeforeAll
    static void start() throws Exception {
        FIXTURE.start();
        mockMvc = FIXTURE.mockMvc();
        rootToken = platformLogin(
                PostgresqlApiFixture.SYSTEM_ADMIN_USERNAME,
                ROOT_PASSWORD,
                "auth-gate-root-login");
    }

    @AfterAll
    static void stop() {
        FIXTURE.close();
    }

    @Test
    @Order(1)
    void runsRealSpringSecurityAgainstOwnedPostgresql16WithPinnedRunnerFacts()
            throws Exception {
        String testcontainersLocation = PostgreSQLContainer.class
                .getProtectionDomain()
                .getCodeSource()
                .getLocation()
                .toExternalForm()
                .replace('\\', '/');
        String testcontainersVersion = "1.21.4";
        String dockerApiVersion = DockerClientFactory.instance()
                .client()
                .versionCmd()
                .exec()
                .getApiVersion();
        assertThat(FIXTURE.isRunning()).isTrue();
        assertThat(FIXTURE.imageName()).isEqualTo("postgres:16-alpine");
        assertThat(FIXTURE.jdbcUrl()).startsWith("jdbc:postgresql:");
        assertThat(FIXTURE.singleString("SHOW server_version"))
                .startsWith("16.");
        assertThat(FIXTURE.singleString("""
                SELECT version
                FROM flyway_schema_history
                WHERE success = true
                ORDER BY installed_rank DESC
                LIMIT 1
                """))
                .isEqualTo("123");
        assertThat(testcontainersLocation)
                .contains("/org/testcontainers/postgresql/1.21.4/");
        assertThat(dockerApiVersion).isNotBlank();
        assertThat(FIXTURE.securityFilterClassNames())
                .contains(
                        "cn.xzkj.erp.iam.security."
                                + "BearerTokenAuthenticationFilter",
                        "cn.xzkj.erp.iam.security.TenantContextFilter");

        System.out.printf(
                "AUTH_TOKEN_LIFECYCLE_GATE image=%s postgresql=%s "
                        + "flyway=%s testcontainers=%s api.version=%s%n",
                FIXTURE.imageName(),
                FIXTURE.singleString("SHOW server_version"),
                FIXTURE.singleString("""
                        SELECT version
                        FROM flyway_schema_history
                        WHERE success = true
                        ORDER BY installed_rank DESC
                        LIMIT 1
                        """),
                testcontainersVersion,
                dockerApiVersion);
    }

    @Test
    @Order(2)
    void tenantBaseAndTenantSessionTrustDomainsCannotBeMixed()
            throws Exception {
        tenantA = provisionTenant(
                "auth_gate_tenant_a",
                "auth_gate_admin_a");
        tenantB = provisionTenant(
                "auth_gate_tenant_b",
                "auth_gate_admin_b");
        String tenantSessionA = enterTenant(rootToken, tenantA.tenantId());
        String tenantSessionB = enterTenant(rootToken, tenantB.tenantId());

        assertThat(statusOf(authorized(
                get("/api/v1/platform-admin/auth/me"),
                rootToken))).isEqualTo(200);
        assertThat(statusOf(authorized(
                get("/api/v1/suppliers"),
                rootToken))).isEqualTo(403);
        assertThat(statusOf(authorized(
                get("/api/v1/platform-admin/system-admins"),
                tenantA.accessToken()))).isEqualTo(403);
        assertThat(statusOf(authorized(
                get("/api/v1/platform-admin/auth/me"),
                tenantSessionA))).isEqualTo(403);
        assertThat(statusOf(authorized(
                get("/api/v1/suppliers"),
                tenantSessionA))).isEqualTo(200);

        String foreignSessionId = FIXTURE.singleString(
                "SELECT id::text FROM auth_sessions WHERE token_hash = ?",
                hash(tenantB.accessToken()));
        assertThat(statusOf(authorized(
                delete("/api/v1/auth/sessions/" + foreignSessionId),
                tenantA.accessToken()))).isEqualTo(404);
        assertThat(statusOf(authorized(
                get("/api/v1/auth/me"),
                tenantB.accessToken()))).isEqualTo(200);

        MvcResult tenantAMe = perform(authorized(
                get("/api/v1/auth/me"),
                tenantSessionA));
        MvcResult tenantBMe = perform(authorized(
                get("/api/v1/auth/me"),
                tenantSessionB));
        assertThat(tenantAMe.getResponse().getStatus()).isEqualTo(200);
        assertThat(tenantBMe.getResponse().getStatus()).isEqualTo(200);
        assertThat(body(tenantAMe)).contains(tenantA.tenantId().toString());
        assertThat(body(tenantAMe)).doesNotContain(tenantB.tenantId().toString());
        assertThat(body(tenantBMe)).contains(tenantB.tenantId().toString());
        assertThat(body(tenantBMe)).doesNotContain(tenantA.tenantId().toString());

        assertThat(statusOf(authorized(
                delete("/api/v1/platform-admin/tenant-session"),
                tenantSessionA))).isEqualTo(204);
        assertThat(statusOf(authorized(
                get("/api/v1/auth/me"),
                tenantSessionA))).isEqualTo(401);
        assertThat(statusOf(authorized(
                get("/api/v1/auth/me"),
                tenantSessionB))).isEqualTo(200);
        assertThat(statusOf(authorized(
                get("/api/v1/platform-admin/auth/me"),
                rootToken))).isEqualTo(200);
    }

    @Test
    @Order(3)
    void tenantLogoutSessionRevocationAndSubjectDisableFailClosed()
            throws Exception {
        TenantAccount tenant = provisionTenant(
                "auth_gate_tenant_lifecycle",
                "auth_gate_lifecycle_admin");
        String secondToken = tenantLogin(
                tenant.code(),
                tenant.username(),
                TENANT_ADMIN_PASSWORD,
                "auth-gate-second-session");
        String secondSessionId = FIXTURE.singleString(
                "SELECT id::text FROM auth_sessions WHERE token_hash = ?",
                hash(secondToken));

        assertThat(statusOf(authorized(
                delete("/api/v1/auth/sessions/" + secondSessionId),
                tenant.accessToken()))).isEqualTo(204);
        assertThat(statusOf(authorized(
                get("/api/v1/auth/me"),
                secondToken))).isEqualTo(401);
        assertThat(statusOf(authorized(
                get("/api/v1/auth/me"),
                tenant.accessToken()))).isEqualTo(200);
        assertThat(statusOf(authorized(
                delete("/api/v1/auth/session"),
                tenant.accessToken()))).isEqualTo(204);
        assertThat(statusOf(authorized(
                get("/api/v1/auth/me"),
                tenant.accessToken()))).isEqualTo(401);

        TenantAccount subjectTenant = provisionTenant(
                "auth_gate_tenant_subject",
                "auth_gate_subject_admin");
        TenantMember member = createTenantMember(
                subjectTenant,
                "auth_gate_disabled_member");
        TenantCredential activation = issueTenantCredential(
                subjectTenant.accessToken(),
                member.id(),
                "ACTIVATION");
        redeemTenantCredential(
                activation.token(),
                "auth-gate-disabled-member-password",
                "auth-gate-member-activate",
                204);
        String memberToken = tenantLogin(
                subjectTenant.code(),
                member.username(),
                "auth-gate-disabled-member-password",
                "auth-gate-member-login");
        long memberVersion = FIXTURE.singleLong(
                "SELECT version FROM users WHERE id = ?",
                member.id());
        assertThat(statusOf(authorized(
                put("/api/v1/iam/members/" + member.id() + "/status")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"status":"DISABLED","version":%d}
                                """.formatted(memberVersion)),
                subjectTenant.accessToken()))).isEqualTo(200);
        assertThat(statusOf(authorized(
                get("/api/v1/auth/me"),
                memberToken))).isEqualTo(401);

        TenantAccount suspended = provisionTenant(
                "auth_gate_tenant_suspended",
                "auth_gate_suspended_admin");
        String suspendedTenantSession =
                enterTenant(rootToken, suspended.tenantId());
        assertThat(statusOf(authorized(
                put("/api/v1/platform-admin/tenants/"
                        + suspended.tenantId())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"Suspended Gate Tenant",
                                 "status":"SUSPENDED","version":%d}
                                """.formatted(suspended.tenantVersion())),
                rootToken))).isEqualTo(200);
        assertThat(statusOf(authorized(
                get("/api/v1/auth/me"),
                suspended.accessToken()))).isEqualTo(401);
        assertThat(statusOf(authorized(
                get("/api/v1/auth/me"),
                suspendedTenantSession))).isEqualTo(401);
    }

    @Test
    @Order(4)
    void systemAdminDisableAndDeleteRevokeEveryRelatedSecret()
            throws Exception {
        PlatformAccount disabled = provisionPlatformAdmin(
                "auth_gate_platform_disabled",
                "auth-gate-platform-disabled-password");
        String disabledTenantSession =
                enterTenant(disabled.accessToken(), tenantA.tenantId());
        long disabledVersion = FIXTURE.singleLong(
                "SELECT version FROM system_admins WHERE id = ?",
                disabled.id());
        assertThat(statusOf(authorized(
                post("/api/v1/platform-admin/system-admins/"
                        + disabled.id()
                        + "/disable")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"version\":" + disabledVersion + "}"),
                rootToken))).isEqualTo(200);
        assertThat(statusOf(authorized(
                get("/api/v1/platform-admin/auth/me"),
                disabled.accessToken()))).isEqualTo(401);
        assertThat(statusOf(authorized(
                get("/api/v1/auth/me"),
                disabledTenantSession))).isEqualTo(401);

        PlatformAccount deleted = provisionPlatformAdmin(
                "auth_gate_platform_deleted",
                "auth-gate-platform-deleted-password");
        MvcResult resetIssue = perform(authorized(
                post("/api/v1/platform-admin/system-admins/"
                        + deleted.id()
                        + "/password-credentials"),
                rootToken));
        assertThat(resetIssue.getResponse().getStatus()).isEqualTo(201);
        String resetToken = JsonPath.read(body(resetIssue), "$.token");
        long deletedVersion = FIXTURE.singleLong(
                "SELECT version FROM system_admins WHERE id = ?",
                deleted.id());
        assertThat(statusOf(authorized(
                post("/api/v1/platform-admin/system-admins/"
                        + deleted.id()
                        + "/delete")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"version\":" + deletedVersion + "}"),
                rootToken))).isEqualTo(200);
        assertThat(statusOf(authorized(
                get("/api/v1/platform-admin/auth/me"),
                deleted.accessToken()))).isEqualTo(401);
        assertThat(redeemPlatformCredential(
                resetToken,
                "auth-gate-deleted-reset-password",
                "auth-gate-deleted-redeem")).isEqualTo(401);
    }

    @Test
    @Order(5)
    void tenantCredentialIssueResetReplayExpiryAndConcurrencyAreSingleUse(
            CapturedOutput output) throws Exception {
        TenantMember member = createTenantMember(
                tenantA,
                "auth_gate_credential_member");
        TenantCredential activation = issueTenantCredential(
                tenantA.accessToken(),
                member.id(),
                "ACTIVATION");
        String storedActivationHash = FIXTURE.singleString(
                "SELECT token_hash FROM password_credentials WHERE id = ?",
                activation.id());
        assertThat(storedActivationHash)
                .hasSize(64)
                .isEqualTo(hash(activation.token()))
                .isNotEqualTo(activation.token());

        MvcResult activationResult = redeemTenantCredential(
                activation.token(),
                "auth-gate-credential-member-password",
                "auth-gate-credential-activate",
                204);
        assertThat(body(activationResult)).isEmpty();
        assertThat(redeemTenantCredential(
                activation.token(),
                "auth-gate-credential-member-password",
                "auth-gate-credential-replay",
                400).getResponse().getStatus()).isEqualTo(400);

        String oldSession = tenantLogin(
                tenantA.code(),
                member.username(),
                "auth-gate-credential-member-password",
                "auth-gate-credential-login");
        TenantCredential reset = issueTenantCredential(
                tenantA.accessToken(),
                member.id(),
                "PASSWORD_RESET");
        MvcResult resetResult = redeemTenantCredential(
                reset.token(),
                RESET_PASSWORD,
                "auth-gate-credential-reset",
                204);
        assertThat(body(resetResult)).isEmpty();
        assertThat(statusOf(authorized(
                get("/api/v1/auth/me"),
                oldSession))).isEqualTo(401);
        assertThat(tenantLogin(
                tenantA.code(),
                member.username(),
                RESET_PASSWORD,
                "auth-gate-reset-login")).hasSize(43);
        assertAuditContainsNoSecrets(
                "audit_logs",
                member.id(),
                activation.token(),
                reset.token(),
                "auth-gate-credential-member-password",
                RESET_PASSWORD,
                storedActivationHash);

        TenantCredential expired = issueTenantCredential(
                tenantA.accessToken(),
                member.id(),
                "PASSWORD_RESET");
        assertThat(FIXTURE.executeUpdate("""
                UPDATE password_credentials
                SET created_at = CURRENT_TIMESTAMP - INTERVAL '2 minutes',
                    expires_at = CURRENT_TIMESTAMP - INTERVAL '1 minute'
                WHERE id = ?
                """, expired.id())).isOne();
        assertThat(redeemTenantCredential(
                expired.token(),
                "auth-gate-expired-password",
                "auth-gate-expired-redeem",
                400).getResponse().getStatus()).isEqualTo(400);

        TenantCredential revoked = issueTenantCredential(
                tenantA.accessToken(),
                member.id(),
                "PASSWORD_RESET");
        assertThat(statusOf(authorized(
                delete("/api/v1/iam/members/"
                        + member.id()
                        + "/password-credentials/"
                        + revoked.id()),
                tenantA.accessToken()))).isEqualTo(204);
        assertThat(redeemTenantCredential(
                revoked.token(),
                "auth-gate-revoked-password",
                "auth-gate-revoked-redeem",
                400).getResponse().getStatus()).isEqualTo(400);

        TenantCredential concurrent = issueTenantCredential(
                tenantA.accessToken(),
                member.id(),
                "PASSWORD_RESET");
        List<Integer> statuses = concurrently(
                () -> redeemTenantCredential(
                        concurrent.token(),
                        "auth-gate-concurrent-password-a",
                        "auth-gate-concurrent-a",
                        null).getResponse().getStatus(),
                () -> redeemTenantCredential(
                        concurrent.token(),
                        "auth-gate-concurrent-password-b",
                        "auth-gate-concurrent-b",
                        null).getResponse().getStatus());
        assertThat(statuses).containsExactlyInAnyOrder(204, 400);
        List<Integer> loginStatuses = List.of(
                tenantLoginStatus(
                        tenantA.code(),
                        member.username(),
                        "auth-gate-concurrent-password-a",
                        "auth-gate-concurrent-login-a"),
                tenantLoginStatus(
                        tenantA.code(),
                        member.username(),
                        "auth-gate-concurrent-password-b",
                        "auth-gate-concurrent-login-b"));
        assertThat(loginStatuses).containsExactlyInAnyOrder(200, 401);
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM audit_logs
                WHERE resource_id = ?
                  AND action = 'iam.user.password_reset'
                  AND request_id IN (
                    'auth-gate-concurrent-a',
                    'auth-gate-concurrent-b'
                  )
                """, member.id().toString())).isOne();
        assertThat(output.getAll()).doesNotContain(
                activation.token(),
                reset.token(),
                expired.token(),
                revoked.token(),
                concurrent.token(),
                "auth-gate-credential-member-password",
                RESET_PASSWORD,
                "auth-gate-expired-password",
                "auth-gate-revoked-password",
                "auth-gate-concurrent-password-a",
                "auth-gate-concurrent-password-b",
                storedActivationHash);
    }

    @Test
    @Order(6)
    void platformCredentialReplayExpiryAndConcurrencyInvalidateSessions(
            CapturedOutput output) throws Exception {
        PendingPlatformAccount expired = createPendingPlatformAdmin(
                "auth_gate_platform_expired");
        String expiredHash = FIXTURE.singleString("""
                SELECT token_hash
                FROM platform_admin_password_credentials
                WHERE system_admin_id = ?
                """, expired.id());
        assertThat(expiredHash)
                .hasSize(64)
                .isEqualTo(hash(expired.activationToken()))
                .isNotEqualTo(expired.activationToken());
        assertThat(FIXTURE.executeUpdate("""
                UPDATE platform_admin_password_credentials
                SET created_at = CURRENT_TIMESTAMP - INTERVAL '2 minutes',
                    expires_at = CURRENT_TIMESTAMP - INTERVAL '1 minute'
                WHERE system_admin_id = ?
                """, expired.id())).isOne();
        assertThat(redeemPlatformCredential(
                expired.activationToken(),
                "auth-gate-platform-expired-password",
                "auth-gate-platform-expired-redeem")).isEqualTo(401);

        PendingPlatformAccount concurrent = createPendingPlatformAdmin(
                "auth_gate_platform_concurrent");
        List<Integer> statuses = concurrently(
                () -> redeemPlatformCredential(
                        concurrent.activationToken(),
                        "auth-gate-platform-concurrent-a",
                        "auth-gate-platform-concurrent-redeem-a"),
                () -> redeemPlatformCredential(
                        concurrent.activationToken(),
                        "auth-gate-platform-concurrent-b",
                        "auth-gate-platform-concurrent-redeem-b"));
        assertThat(statuses).containsExactlyInAnyOrder(204, 401);
        List<Integer> loginStatuses = List.of(
                platformLoginStatus(
                        concurrent.username(),
                        "auth-gate-platform-concurrent-a",
                        "auth-gate-platform-concurrent-login-a"),
                platformLoginStatus(
                        concurrent.username(),
                        "auth-gate-platform-concurrent-b",
                        "auth-gate-platform-concurrent-login-b"));
        assertThat(loginStatuses).containsExactlyInAnyOrder(200, 401);
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM platform_admin_audit_logs
                WHERE resource_id = ?
                  AND action = 'platform_admin.password_credential.redeemed'
                  AND request_id IN (
                    'auth-gate-platform-concurrent-redeem-a',
                    'auth-gate-platform-concurrent-redeem-b'
                  )
                """, concurrent.id().toString())).isOne();

        String winningPassword = loginStatuses.get(0) == 200
                ? "auth-gate-platform-concurrent-a"
                : "auth-gate-platform-concurrent-b";
        String oldSession = platformLogin(
                concurrent.username(),
                winningPassword,
                "auth-gate-platform-before-reset");
        MvcResult resetIssue = perform(authorized(
                post("/api/v1/platform-admin/system-admins/"
                        + concurrent.id()
                        + "/password-credentials"),
                rootToken));
        assertThat(resetIssue.getResponse().getStatus()).isEqualTo(201);
        String resetToken = JsonPath.read(body(resetIssue), "$.token");
        assertThat(redeemPlatformCredential(
                resetToken,
                "auth-gate-platform-reset-password",
                "auth-gate-platform-reset")).isEqualTo(204);
        assertThat(statusOf(authorized(
                get("/api/v1/platform-admin/auth/me"),
                oldSession))).isEqualTo(401);
        assertThat(redeemPlatformCredential(
                resetToken,
                "auth-gate-platform-reset-password",
                "auth-gate-platform-reset-replay")).isEqualTo(401);
        assertAuditContainsNoSecrets(
                "platform_admin_audit_logs",
                concurrent.id(),
                concurrent.activationToken(),
                resetToken,
                winningPassword,
                "auth-gate-platform-reset-password",
                expiredHash);
        assertThat(output.getAll()).doesNotContain(
                expired.activationToken(),
                concurrent.activationToken(),
                resetToken,
                "auth-gate-platform-expired-password",
                "auth-gate-platform-concurrent-a",
                "auth-gate-platform-concurrent-b",
                "auth-gate-platform-reset-password",
                expiredHash);
    }

    @Test
    @Order(7)
    void expiryForgeryMalformedCredentialsAndCheapFailuresNeverLeakOrSucceed(
            CapturedOutput output) throws Exception {
        TenantAccount tenant = provisionTenant(
                "auth_gate_tenant_failures",
                "auth_gate_failure_admin");
        assertThat(FIXTURE.executeUpdate("""
                UPDATE auth_sessions
                SET created_at = CURRENT_TIMESTAMP - INTERVAL '2 minutes',
                    expires_at = CURRENT_TIMESTAMP - INTERVAL '1 minute'
                WHERE token_hash = ?
                """, hash(tenant.accessToken()))).isOne();
        assertThat(statusOf(authorized(
                get("/api/v1/auth/me"),
                tenant.accessToken()))).isEqualTo(401);

        PlatformAccount platform = provisionPlatformAdmin(
                "auth_gate_platform_expiry",
                "auth-gate-platform-expiry-password");
        String tenantSession =
                enterTenant(platform.accessToken(), tenantA.tenantId());
        assertThat(FIXTURE.executeUpdate("""
                UPDATE platform_admin_tenant_sessions
                SET created_at = CURRENT_TIMESTAMP - INTERVAL '2 minutes',
                    expires_at = CURRENT_TIMESTAMP - INTERVAL '1 minute'
                WHERE token_hash = ?
                """, hash(tenantSession))).isOne();
        assertThat(statusOf(authorized(
                get("/api/v1/auth/me"),
                tenantSession))).isEqualTo(401);
        assertThat(statusOf(authorized(
                get("/api/v1/platform-admin/auth/me"),
                platform.accessToken()))).isEqualTo(200);
        assertThat(FIXTURE.executeUpdate("""
                UPDATE platform_admin_sessions
                SET created_at = CURRENT_TIMESTAMP - INTERVAL '2 minutes',
                    expires_at = CURRENT_TIMESTAMP - INTERVAL '1 minute'
                WHERE token_hash = ?
                """, hash(platform.accessToken()))).isOne();
        assertThat(statusOf(authorized(
                get("/api/v1/platform-admin/auth/me"),
                platform.accessToken()))).isEqualTo(401);

        for (String token : List.of(
                FORGED_TOKEN,
                "short",
                "not-a-bearer-token!",
                "A".repeat(44))) {
            MvcResult failure = perform(authorized(
                    get("/api/v1/auth/me"),
                    token));
            assertThat(failure.getResponse().getStatus()).isEqualTo(401);
            assertThat(body(failure)).doesNotContain(token);
        }

        String wrongTenantPassword = "auth-gate-wrong-tenant-secret";
        String wrongPlatformPassword = "auth-gate-wrong-platform-secret";
        for (int index = 0; index < 3; index++) {
            MvcResult tenantFailure = tenantLoginResult(
                    tenantA.code(),
                    tenantA.username(),
                    wrongTenantPassword,
                    "auth-gate-tenant-failure-" + index);
            assertSafeFailure(tenantFailure, wrongTenantPassword);
            MvcResult platformFailure = platformLoginResult(
                    PostgresqlApiFixture.SYSTEM_ADMIN_USERNAME,
                    wrongPlatformPassword,
                    "auth-gate-platform-failure-" + index);
            assertSafeFailure(platformFailure, wrongPlatformPassword);
        }
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM audit_logs
                WHERE request_id LIKE 'auth-gate-tenant-failure-%'
                  AND action = 'iam.login.failed'
                """)).isEqualTo(3);
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM audit_logs
                WHERE request_id LIKE 'auth-gate-tenant-failure-%'
                  AND action = 'iam.login.succeeded'
                """)).isZero();
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM platform_admin_audit_logs
                WHERE request_id LIKE 'auth-gate-platform-failure-%'
                  AND action = 'platform_admin.login.failed'
                """)).isEqualTo(3);
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM platform_admin_audit_logs
                WHERE request_id LIKE 'auth-gate-platform-failure-%'
                  AND action = 'platform_admin.login.succeeded'
                """)).isZero();
        assertThat(output.getAll())
                .doesNotContain(
                        tenant.accessToken(),
                        platform.accessToken(),
                        tenantSession,
                        wrongTenantPassword,
                        wrongPlatformPassword,
                        hash(wrongTenantPassword),
                        hash(wrongPlatformPassword));
    }

    @Test
    @Order(8)
    void concurrentLogoutIsIdempotentButRevokesAndAuditsOnlyOnce()
            throws Exception {
        TenantAccount tenant = provisionTenant(
                "auth_gate_tenant_logout",
                "auth_gate_logout_admin");
        String tenantSessionId = FIXTURE.singleString(
                "SELECT id::text FROM auth_sessions WHERE token_hash = ?",
                hash(tenant.accessToken()));
        List<Integer> tenantStatuses = concurrently(
                () -> statusOf(authorized(
                        delete("/api/v1/auth/session")
                                .header(
                                        "X-Request-Id",
                                        "auth-gate-tenant-logout-a"),
                        tenant.accessToken())),
                () -> statusOf(authorized(
                        delete("/api/v1/auth/session")
                                .header(
                                        "X-Request-Id",
                                        "auth-gate-tenant-logout-b"),
                        tenant.accessToken())));
        assertIdempotentLogoutStatuses(tenantStatuses);
        assertThat(statusOf(authorized(
                get("/api/v1/auth/me"),
                tenant.accessToken()))).isEqualTo(401);
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM audit_logs
                WHERE action = 'iam.session.revoked'
                  AND resource_id = ?
                """, tenantSessionId)).isOne();

        PlatformAccount platform = provisionPlatformAdmin(
                "auth_gate_platform_logout",
                "auth-gate-platform-logout-password");
        String platformSessionId = FIXTURE.singleString("""
                SELECT id::text
                FROM platform_admin_sessions
                WHERE token_hash = ?
                """, hash(platform.accessToken()));
        List<Integer> platformStatuses = concurrently(
                () -> statusOf(authorized(
                        delete("/api/v1/platform-admin/auth/session")
                                .header(
                                        "X-Request-Id",
                                        "auth-gate-platform-logout-a"),
                        platform.accessToken())),
                () -> statusOf(authorized(
                        delete("/api/v1/platform-admin/auth/session")
                                .header(
                                        "X-Request-Id",
                                        "auth-gate-platform-logout-b"),
                        platform.accessToken())));
        assertIdempotentLogoutStatuses(platformStatuses);
        assertThat(statusOf(authorized(
                get("/api/v1/platform-admin/auth/me"),
                platform.accessToken()))).isEqualTo(401);
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM platform_admin_audit_logs
                WHERE action = 'platform_admin.session.revoked'
                  AND resource_id = ?
                """, platformSessionId)).isOne();
    }

    private static TenantAccount provisionTenant(
            String code,
            String username) throws Exception {
        MvcResult created = perform(authorized(
                post("/api/v1/platform-admin/tenants")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"code":"%s","name":"%s",
                                 "adminEmail":"%s",
                                 "adminDisplayName":"Lifecycle Gate Admin",
                                 "adminInitialPassword":"%s"}
                """.formatted(
                                    code,
                                    code,
                                    testEmail(username),
                                    TENANT_ADMIN_PASSWORD)),
                rootToken));
        assertThat(created.getResponse().getStatus())
                .as("tenant provisioning response: %s", body(created))
                .isEqualTo(201);
        UUID tenantId = UUID.fromString(JsonPath.read(
                body(created),
                "$.tenant.id"));
        long tenantVersion = ((Number) JsonPath.read(
                body(created),
                "$.tenant.version")).longValue();
        UUID adminId = UUID.fromString(JsonPath.read(
                body(created),
                "$.enterpriseAdmin.id"));
        enableErp(tenantId);
        return new TenantAccount(
                tenantId,
                tenantVersion,
                adminId,
                code,
                testEmail(username),
                tenantLogin(
                        code,
                        testEmail(username),
                        TENANT_ADMIN_PASSWORD,
                "auth-gate-login-" + code));
    }

    private static void enableErp(UUID tenantId) throws Exception {
        MvcResult result = perform(authorized(
                put("/api/v1/platform-admin/tenants/"
                                + tenantId
                                + "/entitlements")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "version":0,
                                  "applications":[{
                                    "code":"ERP",
                                    "modules":["CHANNELS","PRODUCTS","ORDERS",
                                      "PROCUREMENT","WAREHOUSE","LOGISTICS","ANALYTICS"]
                                  }]
                                }
                                """),
                rootToken));
        assertThat(result.getResponse().getStatus()).isEqualTo(200);
    }

    private static TenantMember createTenantMember(
            TenantAccount tenant,
            String username) throws Exception {
        MvcResult result = perform(authorized(
                post("/api/v1/iam/members")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"email":"%s",
                                 "displayName":"Lifecycle Gate Member",
                                 "initialPassword":"member-direct-password",
                                 "roleIds":[]}
                                """.formatted(testEmail(username))),
                tenant.accessToken()));
        assertThat(result.getResponse().getStatus()).isEqualTo(201);
        UUID userId = UUID.fromString(JsonPath.read(body(result), "$.id"));
        assertThat(FIXTURE.executeUpdate("""
                UPDATE users
                SET status = 'DISABLED',
                    password_hash = NULL,
                    version = version + 1,
                    updated_at = now()
                WHERE id = ?
                """, userId)).isOne();
        return new TenantMember(userId, testEmail(username));
    }

    private static TenantCredential issueTenantCredential(
            String actorToken,
            UUID userId,
            String purpose) throws Exception {
        MvcResult result = perform(authorized(
                post("/api/v1/iam/members/"
                        + userId
                        + "/password-credentials")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"purpose\":\"" + purpose + "\"}"),
                actorToken));
        assertThat(result.getResponse().getStatus()).isEqualTo(201);
        String response = body(result);
        assertThat(response)
                .doesNotContainIgnoringCase("passwordHash")
                .doesNotContainIgnoringCase("tokenHash");
        return new TenantCredential(
                UUID.fromString(JsonPath.read(response, "$.id")),
                JsonPath.read(response, "$.token"));
    }

    private static MvcResult redeemTenantCredential(
            String token,
            String newPassword,
            String requestId,
            Integer expectedStatus) throws Exception {
        MvcResult result = perform(post(
                        "/api/v1/auth/password-credentials/redeem")
                .header("X-Request-Id", requestId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(credentialBody(token, newPassword)));
        if (expectedStatus != null) {
            assertThat(result.getResponse().getStatus())
                    .isEqualTo(expectedStatus);
        }
        assertThat(body(result))
                .doesNotContain(token)
                .doesNotContain(newPassword)
                .doesNotContain(hash(token))
                .doesNotContain(hash(newPassword));
        return result;
    }

    private static PendingPlatformAccount createPendingPlatformAdmin(
            String username) throws Exception {
        MvcResult created = perform(authorized(
                post("/api/v1/platform-admin/system-admins")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"email":"%s",
                                 "displayName":"Lifecycle Platform Admin"}
                                """.formatted(testEmail(username))),
                rootToken));
        assertThat(created.getResponse().getStatus())
                .as("platform administrator response: %s", body(created))
                .isEqualTo(201);
        return new PendingPlatformAccount(
                UUID.fromString(JsonPath.read(body(created), "$.id")),
                testEmail(username),
                JsonPath.read(
                        body(created),
                        "$.activationCredential.token"));
    }

    private static PlatformAccount provisionPlatformAdmin(
            String username,
            String password) throws Exception {
        PendingPlatformAccount pending =
                createPendingPlatformAdmin(username);
        assertThat(redeemPlatformCredential(
                pending.activationToken(),
                password,
                "auth-gate-platform-provision-" + username))
                .isEqualTo(204);
        return new PlatformAccount(
                pending.id(),
                pending.username(),
                platformLogin(
                        pending.username(),
                        password,
                        "auth-gate-platform-login-" + username));
    }

    private static int redeemPlatformCredential(
            String token,
            String newPassword,
            String requestId) throws Exception {
        MvcResult result = perform(post(
                        "/api/v1/platform-admin/auth/"
                                + "password-credentials/redeem")
                .header("X-Request-Id", requestId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(credentialBody(token, newPassword)));
        assertThat(body(result))
                .doesNotContain(token)
                .doesNotContain(newPassword)
                .doesNotContain(hash(token))
                .doesNotContain(hash(newPassword));
        return result.getResponse().getStatus();
    }

    private static String enterTenant(
            String platformToken,
            UUID tenantId) throws Exception {
        MvcResult result = perform(authorized(
                post("/api/v1/platform-admin/tenants/"
                        + tenantId
                        + "/enter"),
                platformToken));
        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        return JsonPath.read(body(result), "$.accessToken");
    }

    private static String tenantLogin(
            String tenantCode,
            String username,
            String password,
            String requestId) throws Exception {
        MvcResult result = tenantLoginResult(
                tenantCode,
                username,
                password,
                requestId);
        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        return JsonPath.read(body(result), "$.accessToken");
    }

    private static int tenantLoginStatus(
            String tenantCode,
            String username,
            String password,
            String requestId) throws Exception {
        return tenantLoginResult(
                tenantCode,
                username,
                password,
                requestId).getResponse().getStatus();
    }

    private static MvcResult tenantLoginResult(
            String tenantCode,
            String username,
            String password,
            String requestId) throws Exception {
        return perform(post("/api/v1/auth/login")
                .header("X-Request-Id", requestId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"tenantCode":"%s","username":"%s","password":"%s"}
                        """.formatted(tenantCode, username, password)));
    }

    private static String platformLogin(
            String username,
            String password,
            String requestId) throws Exception {
        MvcResult result = platformLoginResult(
                username,
                password,
                requestId);
        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        return JsonPath.read(body(result), "$.accessToken");
    }

    private static int platformLoginStatus(
            String username,
            String password,
            String requestId) throws Exception {
        return platformLoginResult(
                username,
                password,
                requestId).getResponse().getStatus();
    }

    private static MvcResult platformLoginResult(
            String username,
            String password,
            String requestId) throws Exception {
        return perform(post("/api/v1/platform-admin/auth/login")
                .header("X-Request-Id", requestId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"username":"%s","password":"%s"}
                        """.formatted(username, password)));
    }

    private static void assertAuditContainsNoSecrets(
            String table,
            UUID resourceId,
            String... secrets) throws Exception {
        assertThat(table)
                .isIn("audit_logs", "platform_admin_audit_logs");
        String audit = FIXTURE.singleString("""
                SELECT COALESCE(string_agg(
                    action || ' ' || resource_type || ' '
                    || COALESCE(resource_id, '') || ' '
                    || details::text,
                    ' '
                ), '')
                FROM %s
                WHERE resource_id = ?
                """.formatted(table), resourceId.toString());
        for (String secret : secrets) {
            assertThat(audit).doesNotContain(secret);
        }
        assertThat(audit)
                .doesNotContainIgnoringCase("token_hash")
                .doesNotContainIgnoringCase("password_hash");
    }

    private static void assertSafeFailure(
            MvcResult result,
            String secret) throws Exception {
        assertThat(result.getResponse().getStatus()).isEqualTo(401);
        assertThat(result.getResponse().getStatus()).isLessThan(500);
        assertThat(body(result))
                .doesNotContain(secret)
                .doesNotContain(hash(secret));
    }

    private static void assertIdempotentLogoutStatuses(
            List<Integer> statuses) {
        assertThat(statuses).contains(204);
        assertThat(statuses).allMatch(
                status -> status == 204 || status == 401);
    }

    private static List<Integer> concurrently(
            CheckedStatus first,
            CheckedStatus second) throws Exception {
        ExecutorService executor = Executors.newFixedThreadPool(2);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        try {
            Future<Integer> firstFuture = executor.submit(() -> {
                ready.countDown();
                assertThat(start.await(10, TimeUnit.SECONDS)).isTrue();
                return first.run();
            });
            Future<Integer> secondFuture = executor.submit(() -> {
                ready.countDown();
                assertThat(start.await(10, TimeUnit.SECONDS)).isTrue();
                return second.run();
            });
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            return List.of(
                    firstFuture.get(30, TimeUnit.SECONDS),
                    secondFuture.get(30, TimeUnit.SECONDS));
        } finally {
            executor.shutdownNow();
            assertThat(executor.awaitTermination(10, TimeUnit.SECONDS))
                    .isTrue();
        }
    }

    private static MvcResult perform(
            MockHttpServletRequestBuilder request) throws Exception {
        return mockMvc.perform(request).andReturn();
    }

    private static int statusOf(
            MockHttpServletRequestBuilder request) throws Exception {
        return perform(request).getResponse().getStatus();
    }

    private static MockHttpServletRequestBuilder authorized(
            MockHttpServletRequestBuilder request,
            String token) {
        return request.header(
                HttpHeaders.AUTHORIZATION,
                "Bearer " + token);
    }

    private static String body(MvcResult result) throws Exception {
        return result.getResponse().getContentAsString(StandardCharsets.UTF_8);
    }

    private static String credentialBody(
            String token,
            String newPassword) {
        return """
                {"token":"%s","newPassword":"%s"}
                """.formatted(token, newPassword);
    }

    private static String hash(String value) throws Exception {
        return HexFormat.of().formatHex(
                MessageDigest.getInstance("SHA-256")
                        .digest(value.getBytes(StandardCharsets.US_ASCII)));
    }

    private static String testEmail(String label) {
        return label.contains("@") ? label : label + "@example.test";
    }

    @FunctionalInterface
    private interface CheckedStatus {

        int run() throws Exception;
    }

    private record TenantAccount(
            UUID tenantId,
            long tenantVersion,
            UUID adminId,
            String code,
            String username,
            String accessToken) {
    }

    private record TenantMember(UUID id, String username) {
    }

    private record TenantCredential(UUID id, String token) {
    }

    private record PendingPlatformAccount(
            UUID id,
            String username,
            String activationToken) {
    }

    private record PlatformAccount(
            UUID id,
            String username,
            String accessToken) {
    }
}
