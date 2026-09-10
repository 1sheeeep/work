package cn.xzkj.erp.iam.persistence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import cn.xzkj.erp.ErpApplication;
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
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
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.testcontainers.containers.PostgreSQLContainer;

@TestMethodOrder(OrderAnnotation.class)
@ExtendWith(OutputCaptureExtension.class)
class IamLoginThrottleIntegrationTest {

    private static final String TENANT_A =
            "f0000000-0000-0000-0000-000000000001";
    private static final String TENANT_B =
            "f0000000-0000-0000-0000-000000000002";
    private static final String TENANT_DISABLED =
            "f0000000-0000-0000-0000-000000000003";
    private static final String USER_THRESHOLD =
            "f1000000-0000-0000-0000-000000000001";
    private static final String USER_WINDOW =
            "f1000000-0000-0000-0000-000000000002";
    private static final String USER_EXPIRED_LOCK =
            "f1000000-0000-0000-0000-000000000003";
    private static final String USER_SUCCESS =
            "f1000000-0000-0000-0000-000000000004";
    private static final String USER_DISABLED =
            "f1000000-0000-0000-0000-000000000005";
    private static final String USER_DISABLED_TENANT =
            "f1000000-0000-0000-0000-000000000006";
    private static final String USER_ISOLATION_A =
            "f1000000-0000-0000-0000-000000000007";
    private static final String USER_ISOLATION_A_SECOND =
            "f1000000-0000-0000-0000-000000000008";
    private static final String USER_ISOLATION_B =
            "f1000000-0000-0000-0000-000000000009";
    private static final String USER_CONCURRENT =
            "f1000000-0000-0000-0000-000000000010";
    private static final String USER_ROLLBACK =
            "f1000000-0000-0000-0000-000000000011";
    private static final String USER_RESTART =
            "f1000000-0000-0000-0000-000000000012";
    private static final String USER_CASE =
            "f1000000-0000-0000-0000-000000000013";
    private static final String USER_LOCK_WAIT =
            "f1000000-0000-0000-0000-000000000014";
    private static final String VALID_PASSWORD =
            "integration-valid-password";
    private static final String INVALID_PASSWORD =
            "integration-invalid-password";
    private static final ConcurrentLoginBarrier LOGIN_BARRIER =
            new ConcurrentLoginBarrier();

    private static PostgreSQLContainer<?> postgres;
    private static ConfigurableApplicationContext firstContext;
    private static ConfigurableApplicationContext secondContext;
    private static MockMvc firstMvc;
    private static MockMvc secondMvc;
    private static String jdbcUrl;
    private static String username;
    private static String password;

    @BeforeAll
    static void start() throws Exception {
        configureDatabase();
        Flyway flyway = Flyway.configure()
                .dataSource(jdbcUrl, username, password)
                .locations("classpath:db/migration")
                .cleanDisabled(false)
                .load();
        flyway.clean();
        flyway.migrate();
        seedContract();
        firstContext = startContext("iam-login-throttle-first");
        secondContext = startContext("iam-login-throttle-second");
        firstMvc = mockMvc(firstContext);
        secondMvc = mockMvc(secondContext);
    }

    @AfterAll
    static void stop() {
        if (secondContext != null) {
            secondContext.close();
        }
        if (firstContext != null) {
            firstContext.close();
        }
        if (postgres != null) {
            postgres.stop();
        }
    }

    @Test
    @Order(1)
    void migratesEmptyPostgresThroughLatestAndEnforcesTenantScopedSchema()
            throws Exception {
        assertThat(queryStrings("""
                SELECT version
                FROM flyway_schema_history
                WHERE success = true
                ORDER BY installed_rank
                """)).containsExactly(
                "1", "10", "20", "21", "30", "31", "32", "33", "34", "35", "36",
                "37", "38", "39", "40", "42", "43", "44", "45", "46", "47",
                "48", "49", "50", "51", "52", "53", "54", "55", "56", "57",
                "58", "59", "60", "61", "62", "63", "64", "65", "66", "67",
                "68", "69", "70", "71", "72", "73", "74", "75", "76", "77", "78", "79", "80",
                "81", "82", "83", "84", "85", "86", "87", "88", "89",
                "90", "91", "92", "93", "94", "95", "96", "97", "98",
                "99", "100", "101", "102", "103", "104", "105", "106", "107", "108", "109", "110",
                "111", "112", "113", "114", "115", "116", "117", "118", "119",
                "120", "121", "122", "123");

        assertThat(queryStrings("""
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'iam_login_throttles'
                ORDER BY ordinal_position
                """)).containsExactly(
                "tenant_id",
                "user_id",
                "failed_count",
                "window_started_at",
                "locked_until",
                "updated_at");

        assertThat(queryLong("""
                SELECT count(*)
                FROM pg_constraint
                WHERE conname = 'fk_iam_login_throttles_user_tenant'
                """)).isOne();

        assertThatThrownBy(() -> execute("""
                INSERT INTO iam_login_throttles (
                    tenant_id,
                    user_id,
                    failed_count,
                    window_started_at,
                    updated_at
                ) VALUES (
                    '%s',
                    '%s',
                    1,
                    now(),
                    now()
                )
                """.formatted(TENANT_A, USER_ISOLATION_B)))
                .hasMessageContaining(
                        "fk_iam_login_throttles_user_tenant");
    }

    @Test
    @Order(2)
    void firstFourFailuresAre401AndFifthAtomicallyLocksWithSafe429()
            throws Exception {
        for (int attempt = 1; attempt <= 4; attempt++) {
            performLogin(
                            firstMvc,
                            "throttle_a",
                            "threshold_user",
                            INVALID_PASSWORD,
                            "threshold-" + attempt,
                            TENANT_B)
                    .andExpect(status().isUnauthorized())
                    .andExpect(content().contentTypeCompatibleWith(
                            MediaType.APPLICATION_JSON))
                    .andExpect(jsonPath("$.code")
                            .value("invalid_credentials"))
                    .andExpect(jsonPath("$.message")
                            .value("Invalid tenant, username, or password"));
        }

        MvcResult fifth = performLogin(
                        firstMvc,
                        "throttle_a",
                        "threshold_user",
                        INVALID_PASSWORD,
                        "threshold-5",
                        TENANT_B)
                .andExpect(status().isTooManyRequests())
                .andExpect(content().contentTypeCompatibleWith(
                        MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.code")
                        .value("login_rate_limited"))
                .andExpect(jsonPath("$.message")
                        .value("Too many failed login attempts"))
                .andExpect(header().exists(HttpHeaders.RETRY_AFTER))
                .andReturn();

        long retryAfter = Long.parseLong(
                fifth.getResponse().getHeader(HttpHeaders.RETRY_AFTER));
        assertThat(retryAfter).isBetween(1L, Duration.ofMinutes(15).toSeconds());
        assertThat(fifth.getResponse().getContentAsString())
                .doesNotContain("threshold_user")
                .doesNotContain(INVALID_PASSWORD)
                .doesNotContain(USER_THRESHOLD);

        assertThrottle(USER_THRESHOLD, 5, true);
        assertSafeThrottleAudit(USER_THRESHOLD, 1);

        performLogin(
                        secondMvc,
                        "throttle_a",
                        "threshold_user",
                        VALID_PASSWORD,
                        "threshold-locked",
                        TENANT_B)
                .andExpect(status().isTooManyRequests())
                .andExpect(header().string(
                        HttpHeaders.RETRY_AFTER,
                        org.hamcrest.Matchers.matchesPattern("[1-9][0-9]*")));

        assertThrottle(USER_THRESHOLD, 5, true);
        assertSafeThrottleAudit(USER_THRESHOLD, 1);
    }

    @Test
    @Order(3)
    void expiredWindowAndExpiredLockStartANewFailureWindow()
            throws Exception {
        insertThrottle(
                TENANT_A,
                USER_WINDOW,
                4,
                "-16 minutes",
                null);
        performLogin(
                        firstMvc,
                        "throttle_a",
                        "window_user",
                        INVALID_PASSWORD,
                        "window-reset",
                        null)
                .andExpect(status().isUnauthorized());
        assertThrottle(USER_WINDOW, 1, false);

        insertThrottle(
                TENANT_A,
                USER_EXPIRED_LOCK,
                5,
                "-20 minutes",
                "-1 second");
        performLogin(
                        firstMvc,
                        "throttle_a",
                        "expired_lock_user",
                        INVALID_PASSWORD,
                        "lock-expired",
                        null)
                .andExpect(status().isUnauthorized());
        assertThrottle(USER_EXPIRED_LOCK, 1, false);
    }

    @Test
    @Order(4)
    void successfulLoginClearsStateAndIgnoresForgedTenantHeader()
            throws Exception {
        insertThrottle(
                TENANT_A,
                USER_SUCCESS,
                3,
                "-1 minute",
                null);

        MvcResult result = performLogin(
                        firstMvc,
                        "throttle_a",
                        "success_user",
                        VALID_PASSWORD,
                        "success-clear",
                        TENANT_B)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tenant.id").value(TENANT_A))
                .andExpect(jsonPath("$.user.id").value(USER_SUCCESS))
                .andReturn();

        assertThat(result.getResponse().getContentAsString())
                .doesNotContain(VALID_PASSWORD)
                .doesNotContain("password_hash");
        assertThat(throttleCount(USER_SUCCESS)).isZero();
        assertThat(queryLong("""
                SELECT count(*)
                FROM auth_sessions
                WHERE tenant_id = '%s'
                  AND user_id = '%s'
                """.formatted(TENANT_A, USER_SUCCESS))).isOne();
    }

    @Test
    @Order(5)
    void disabledSubjectsCountButUnknownInputsNeverCreateState()
            throws Exception {
        performLogin(
                        firstMvc,
                        "throttle_a",
                        "disabled_user",
                        VALID_PASSWORD,
                        "disabled-user",
                        null)
                .andExpect(status().isUnauthorized());
        assertThrottle(USER_DISABLED, 1, false);

        performLogin(
                        firstMvc,
                        "throttle_disabled",
                        "disabled_tenant_user",
                        VALID_PASSWORD,
                        "disabled-tenant",
                        null)
                .andExpect(status().isUnauthorized());
        assertThrottle(USER_DISABLED_TENANT, 1, false);

        long rowsBeforeUnknown = queryLong(
                "SELECT count(*) FROM iam_login_throttles");
        performLogin(
                        firstMvc,
                        "does_not_exist",
                        "attacker-controlled",
                        INVALID_PASSWORD,
                        "unknown-tenant",
                        null)
                .andExpect(status().isUnauthorized());
        performLogin(
                        firstMvc,
                        "throttle_a",
                        "attacker-controlled",
                        INVALID_PASSWORD,
                        "unknown-user",
                        null)
                .andExpect(status().isUnauthorized());
        performLogin(
                        firstMvc,
                        "throttle_a",
                        "CASE_USER",
                        INVALID_PASSWORD,
                        "case-sensitive-user",
                        null)
                .andExpect(status().isUnauthorized());
        assertThat(queryLong(
                "SELECT count(*) FROM iam_login_throttles"))
                .isEqualTo(rowsBeforeUnknown);
        assertThat(throttleCount(USER_CASE)).isZero();

        assertThat(queryStrings("""
                SELECT resource_id || ':' || details::text
                FROM audit_logs
                WHERE request_id IN ('unknown-user', 'case-sensitive-user')
                ORDER BY request_id
                """))
                .allSatisfy(audit -> assertThat(audit)
                        .startsWith("unknown:")
                        .doesNotContain("attacker-controlled")
                        .doesNotContain("CASE_USER"));
    }

    @Test
    @Order(6)
    void tenantsAndUsersHaveIndependentCounters() throws Exception {
        performFailures(
                firstMvc,
                "throttle_a",
                "shared_name",
                2,
                "isolation-a");
        performFailures(
                firstMvc,
                "throttle_a",
                "second_user",
                1,
                "isolation-a-second");
        performFailures(
                secondMvc,
                "throttle_b",
                "shared_name",
                4,
                "isolation-b");

        assertThrottle(USER_ISOLATION_A, 2, false);
        assertThrottle(USER_ISOLATION_A_SECOND, 1, false);
        assertThrottle(USER_ISOLATION_B, 4, false);
    }

    @Test
    @Order(7)
    void concurrentFailuresAcrossContextsLoseNoCountAndAuditOnce()
            throws Exception {
        int requestCount = 8;
        LOGIN_BARRIER.enable(requestCount);
        ExecutorService executor = Executors.newFixedThreadPool(requestCount);
        CountDownLatch ready = new CountDownLatch(requestCount);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<Integer>> futures = new ArrayList<>();
        try {
            for (int index = 0; index < requestCount; index++) {
                int attempt = index;
                MockMvc client = index % 2 == 0 ? firstMvc : secondMvc;
                futures.add(executor.submit(() -> {
                    ready.countDown();
                    start.await(10, TimeUnit.SECONDS);
                    return performLogin(
                                    client,
                                    "throttle_a",
                                    "concurrent_user",
                                    INVALID_PASSWORD,
                                    "concurrent-" + attempt,
                                    null)
                            .andReturn()
                            .getResponse()
                            .getStatus();
                }));
            }
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            List<Integer> statuses = new ArrayList<>();
            for (Future<Integer> future : futures) {
                statuses.add(future.get(20, TimeUnit.SECONDS));
            }
            assertThat(statuses.stream()
                    .filter(status -> status == 401)
                    .count()).isEqualTo(4);
            assertThat(statuses.stream()
                    .filter(status -> status == 429)
                    .count()).isEqualTo(4);
        } finally {
            LOGIN_BARRIER.disable();
            executor.shutdownNow();
            assertThat(executor.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }

        assertThrottle(USER_CONCURRENT, 5, true);
        assertThrottleWindowIntegrity(USER_CONCURRENT);
        assertSafeThrottleAudit(USER_CONCURRENT, 1);
    }

    @Test
    @Order(8)
    void refreshesDatabaseTimeAfterWaitingForThrottleRowLock()
            throws Exception {
        insertThrottle(
                TENANT_A,
                USER_LOCK_WAIT,
                0,
                "-1 minute",
                null);
        var service = firstContext.getBean(
                cn.xzkj.erp.iam.application.LoginThrottleService.class);
        ExecutorService executor = Executors.newSingleThreadExecutor();
        Future<cn.xzkj.erp.iam.application.LoginThrottleService.FailureDecision>
                waitingFailure = null;
        Instant committedWindowStart;
        try (Connection lockingConnection = connection()) {
            lockingConnection.setAutoCommit(false);
            try (PreparedStatement lock = lockingConnection.prepareStatement("""
                    SELECT failed_count
                    FROM iam_login_throttles
                    WHERE tenant_id = ?::uuid
                      AND user_id = ?::uuid
                    FOR UPDATE
                    """)) {
                lock.setString(1, TENANT_A);
                lock.setString(2, USER_LOCK_WAIT);
                try (ResultSet result = lock.executeQuery()) {
                    assertThat(result.next()).isTrue();
                }
            }

            waitingFailure = executor.submit(() -> service.recordFailure(
                    UUID.fromString(TENANT_A),
                    UUID.fromString(USER_LOCK_WAIT),
                    "lock-wait-regression"));
            awaitThrottleLockWait();

            try (PreparedStatement advanceWindow =
                    lockingConnection.prepareStatement("""
                            WITH marker AS (
                                SELECT clock_timestamp() AS value
                            )
                            UPDATE iam_login_throttles
                            SET failed_count = 2,
                                window_started_at = marker.value,
                                locked_until = NULL,
                                updated_at = marker.value
                            FROM marker
                            WHERE tenant_id = ?::uuid
                              AND user_id = ?::uuid
                            RETURNING window_started_at
                            """)) {
                advanceWindow.setString(1, TENANT_A);
                advanceWindow.setString(2, USER_LOCK_WAIT);
                try (ResultSet result = advanceWindow.executeQuery()) {
                    assertThat(result.next()).isTrue();
                    committedWindowStart = result
                            .getObject(1, OffsetDateTime.class)
                            .toInstant();
                }
            }
            lockingConnection.commit();
        } finally {
            executor.shutdown();
        }

        assertThat(waitingFailure).isNotNull();
        assertThat(waitingFailure.get(20, TimeUnit.SECONDS).rateLimited())
                .isFalse();
        assertThat(executor.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        try (Connection connection = connection();
                PreparedStatement statement = connection.prepareStatement("""
                        SELECT failed_count,
                               window_started_at,
                               updated_at,
                               locked_until
                        FROM iam_login_throttles
                        WHERE tenant_id = ?::uuid
                          AND user_id = ?::uuid
                        """)) {
            statement.setString(1, TENANT_A);
            statement.setString(2, USER_LOCK_WAIT);
            try (ResultSet result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                assertThat(result.getInt(1)).isEqualTo(3);
                assertThat(result.getObject(2, OffsetDateTime.class).toInstant())
                        .isEqualTo(committedWindowStart);
                assertThat(result.getObject(3, OffsetDateTime.class).toInstant())
                        .isAfterOrEqualTo(committedWindowStart);
                assertThat(result.getObject(4)).isNull();
            }
        }
    }

    @Test
    @Order(9)
    void successfulLoginRollbackRestoresThrottleAndCreatesNoSession()
            throws Exception {
        insertThrottle(
                TENANT_A,
                USER_ROLLBACK,
                3,
                "-1 minute",
                null);
        long sessionsBefore = sessionCount(USER_ROLLBACK);
        installDeferredLoginSuccessFailure();
        try {
            assertThatThrownBy(() -> performLogin(
                    firstMvc,
                    "throttle_a",
                    "rollback_user",
                    VALID_PASSWORD,
                    "rollback-success",
                    null))
                    .rootCause()
                    .hasMessageContaining(
                            "forced login success commit failure");
        } finally {
            removeDeferredLoginSuccessFailure();
        }

        assertThrottle(USER_ROLLBACK, 3, false);
        assertThat(sessionCount(USER_ROLLBACK)).isEqualTo(sessionsBefore);
        assertThat(queryLong("""
                SELECT count(*)
                FROM audit_logs
                WHERE request_id = 'rollback-success'
                  AND action = 'iam.login.succeeded'
                """)).isZero();
    }

    @Test
    @Order(10)
    void restartAndSecondContextObserveTheSamePersistentLock()
            throws Exception {
        performFailures(
                firstMvc,
                "throttle_a",
                "restart_user",
                4,
                "restart-before");
        assertThrottle(USER_RESTART, 4, false);

        secondContext.close();
        secondContext = startContext("iam-login-throttle-restarted");
        secondMvc = mockMvc(secondContext);

        performLogin(
                        secondMvc,
                        "throttle_a",
                        "restart_user",
                        INVALID_PASSWORD,
                        "restart-after",
                        null)
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value("login_rate_limited"));
        assertThrottle(USER_RESTART, 5, true);

        performLogin(
                        firstMvc,
                        "throttle_a",
                        "restart_user",
                        VALID_PASSWORD,
                        "other-context-sees-lock",
                        null)
                .andExpect(status().isTooManyRequests());
        assertSafeThrottleAudit(USER_RESTART, 1);
    }

    @Test
    @Order(11)
    void responseAuditAndLogsDoNotExposePresentedCredentials(
            CapturedOutput output) throws Exception {
        String probeUser = "log_probe_user";
        String probePassword = "sensitive-log-probe-value";
        long rowsBefore = queryLong(
                "SELECT count(*) FROM iam_login_throttles");

        MvcResult result = performLogin(
                        firstMvc,
                        "throttle_a",
                        probeUser,
                        probePassword,
                        "log-probe",
                        TENANT_B)
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code")
                        .value("invalid_credentials"))
                .andReturn();

        assertThat(result.getResponse().getContentAsString())
                .doesNotContain(probeUser)
                .doesNotContain(probePassword);
        assertThat(output.getAll())
                .doesNotContain(probeUser)
                .doesNotContain(probePassword);
        assertThat(queryLong(
                "SELECT count(*) FROM iam_login_throttles"))
                .isEqualTo(rowsBefore);
        assertThat(queryStrings("""
                SELECT resource_id || ':' || details::text
                FROM audit_logs
                WHERE request_id = 'log-probe'
                """))
                .allSatisfy(audit -> assertThat(audit)
                        .doesNotContain(probeUser)
                        .doesNotContain(probePassword));
    }

    private static org.springframework.test.web.servlet.ResultActions performLogin(
            MockMvc client,
            String tenantCode,
            String userName,
            String suppliedPassword,
            String requestId,
            String forgedTenantId) throws Exception {
        var request = post("/api/v1/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .header("X-Request-Id", requestId)
                .content("""
                        {
                          "tenantCode":"%s",
                          "username":"%s",
                          "password":"%s"
                        }
                        """.formatted(
                        tenantCode,
                        userName,
                        suppliedPassword));
        if (forgedTenantId != null) {
            request.header("X-Tenant-Id", forgedTenantId);
        }
        return client.perform(request);
    }

    private static void performFailures(
            MockMvc client,
            String tenantCode,
            String userName,
            int attempts,
            String requestIdPrefix) throws Exception {
        for (int attempt = 1; attempt <= attempts; attempt++) {
            performLogin(
                            client,
                            tenantCode,
                            userName,
                            INVALID_PASSWORD,
                            requestIdPrefix + "-" + attempt,
                            null)
                    .andExpect(status().isUnauthorized());
        }
    }

    private static void assertThrottle(
            String userId,
            int expectedFailures,
            boolean expectedLocked) throws Exception {
        try (Connection connection = connection();
                PreparedStatement statement = connection.prepareStatement("""
                        SELECT failed_count,
                               locked_until > clock_timestamp()
                        FROM iam_login_throttles
                        WHERE user_id = ?::uuid
                        """)) {
            statement.setString(1, userId);
            try (ResultSet result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                assertThat(result.getInt(1)).isEqualTo(expectedFailures);
                assertThat(result.getBoolean(2)).isEqualTo(expectedLocked);
                assertThat(result.next()).isFalse();
            }
        }
    }

    private static void assertThrottleWindowIntegrity(String userId)
            throws Exception {
        try (Connection connection = connection();
                PreparedStatement statement = connection.prepareStatement("""
                        SELECT updated_at >= window_started_at
                        FROM iam_login_throttles
                        WHERE user_id = ?::uuid
                        """)) {
            statement.setString(1, userId);
            try (ResultSet result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                assertThat(result.getBoolean(1)).isTrue();
                assertThat(result.next()).isFalse();
            }
        }
    }

    private static void assertSafeThrottleAudit(
            String userId,
            long expectedCount) throws Exception {
        assertThat(queryLong("""
                SELECT count(*)
                FROM audit_logs
                WHERE action = 'iam.login.throttled'
                  AND resource_type = 'user'
                  AND resource_id = '%s'
                  AND actor_user_id IS NULL
                  AND source_ip IS NULL
                  AND details = '{
                    "maxFailures":"5",
                    "windowSeconds":"900",
                    "lockDurationSeconds":"900"
                  }'::jsonb
                """.formatted(userId))).isEqualTo(expectedCount);
        assertThat(queryStrings("""
                SELECT resource_id || ':' || details::text
                FROM audit_logs
                WHERE action = 'iam.login.throttled'
                  AND resource_id = '%s'
                """.formatted(userId)))
                .allSatisfy(audit -> assertThat(audit)
                        .doesNotContainIgnoringCase("username")
                        .doesNotContainIgnoringCase("password")
                        .doesNotContainIgnoringCase("token")
                        .doesNotContainIgnoringCase("hash")
                        .doesNotContainIgnoringCase("sourceIp")
                        .doesNotContain(INVALID_PASSWORD));
    }

    private static long throttleCount(String userId) throws Exception {
        return queryLong("""
                SELECT count(*)
                FROM iam_login_throttles
                WHERE user_id = '%s'
                """.formatted(userId));
    }

    private static long sessionCount(String userId) throws Exception {
        return queryLong("""
                SELECT count(*)
                FROM auth_sessions
                WHERE user_id = '%s'
                """.formatted(userId));
    }

    private static void insertThrottle(
            String tenantId,
            String userId,
            int failedCount,
            String windowOffset,
            String lockOffset) throws Exception {
        String lockedUntil = lockOffset == null
                ? "NULL"
                : "clock_timestamp() + interval '" + lockOffset + "'";
        execute("""
                INSERT INTO iam_login_throttles (
                    tenant_id,
                    user_id,
                    failed_count,
                    window_started_at,
                    locked_until,
                    updated_at
                ) VALUES (
                    '%s',
                    '%s',
                    %d,
                    clock_timestamp() + interval '%s',
                    %s,
                    clock_timestamp()
                )
                ON CONFLICT (tenant_id, user_id) DO UPDATE SET
                    failed_count = EXCLUDED.failed_count,
                    window_started_at = EXCLUDED.window_started_at,
                    locked_until = EXCLUDED.locked_until,
                    updated_at = EXCLUDED.updated_at
                """.formatted(
                tenantId,
                userId,
                failedCount,
                windowOffset,
                lockedUntil));
    }

    private static void installDeferredLoginSuccessFailure()
            throws Exception {
        execute("""
                CREATE OR REPLACE FUNCTION fail_login_success_commit()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $$
                BEGIN
                  RAISE EXCEPTION 'forced login success commit failure';
                END;
                $$
                """);
        execute("""
                CREATE CONSTRAINT TRIGGER fail_login_success_commit_trigger
                AFTER INSERT ON audit_logs
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW
                WHEN (NEW.action = 'iam.login.succeeded')
                EXECUTE FUNCTION fail_login_success_commit()
                """);
    }

    private static void removeDeferredLoginSuccessFailure()
            throws Exception {
        execute("""
                DROP TRIGGER IF EXISTS fail_login_success_commit_trigger
                ON audit_logs
                """);
        execute("DROP FUNCTION IF EXISTS fail_login_success_commit()");
    }

    private static void seedContract() throws Exception {
        execute("""
                INSERT INTO tenants (id, code, name, status) VALUES
                  ('%s', 'throttle_a', 'Throttle Tenant A', 'ACTIVE'),
                  ('%s', 'throttle_b', 'Throttle Tenant B', 'ACTIVE'),
                  ('%s', 'throttle_disabled', 'Disabled Throttle Tenant', 'DISABLED')
                """.formatted(TENANT_A, TENANT_B, TENANT_DISABLED));
        insertUser(USER_THRESHOLD, TENANT_A, "threshold_user", "ACTIVE");
        insertUser(USER_WINDOW, TENANT_A, "window_user", "ACTIVE");
        insertUser(
                USER_EXPIRED_LOCK,
                TENANT_A,
                "expired_lock_user",
                "ACTIVE");
        insertUser(USER_SUCCESS, TENANT_A, "success_user", "ACTIVE");
        insertUser(USER_DISABLED, TENANT_A, "disabled_user", "DISABLED");
        insertUser(
                USER_DISABLED_TENANT,
                TENANT_DISABLED,
                "disabled_tenant_user",
                "ACTIVE");
        insertUser(USER_ISOLATION_A, TENANT_A, "shared_name", "ACTIVE");
        insertUser(
                USER_ISOLATION_A_SECOND,
                TENANT_A,
                "second_user",
                "ACTIVE");
        insertUser(USER_ISOLATION_B, TENANT_B, "shared_name", "ACTIVE");
        insertUser(USER_CONCURRENT, TENANT_A, "concurrent_user", "ACTIVE");
        insertUser(USER_ROLLBACK, TENANT_A, "rollback_user", "ACTIVE");
        insertUser(USER_RESTART, TENANT_A, "restart_user", "ACTIVE");
        insertUser(USER_CASE, TENANT_A, "case_user", "ACTIVE");
        insertUser(USER_LOCK_WAIT, TENANT_A, "lock_wait_user", "ACTIVE");
    }

    private static void insertUser(
            String userId,
            String tenantId,
            String userName,
            String status) throws Exception {
        try (Connection connection = connection();
                PreparedStatement statement = connection.prepareStatement("""
                        INSERT INTO users (
                            id,
                            tenant_id,
                            username,
                            display_name,
                            password_hash,
                            status
                        ) VALUES (
                            ?::uuid,
                            ?::uuid,
                            ?,
                            ?,
                            ?,
                            ?
                        )
                        """)) {
            statement.setString(1, userId);
            statement.setString(2, tenantId);
            statement.setString(3, userName);
            statement.setString(4, userName);
            statement.setString(5, hash(VALID_PASSWORD));
            statement.setString(6, status);
            statement.executeUpdate();
        }
    }

    private static String hash(String raw) {
        return "{bcrypt}" + new BCryptPasswordEncoder(4).encode(raw);
    }

    private static ConfigurableApplicationContext startContext(
            String propertySourceName) {
        StandardEnvironment environment = new StandardEnvironment();
        environment.getPropertySources().addFirst(new MapPropertySource(
                propertySourceName,
                Map.of(
                        "server.port", "0",
                        "spring.datasource.url", jdbcUrl,
                        "spring.datasource.username", username,
                        "spring.datasource.password", password,
                        "erp.environment", "integration-test",
                        "erp.security.login-throttle.max-failures", "5",
                        "erp.security.login-throttle.window", "PT15M",
                        "erp.security.login-throttle.lock-duration", "PT15M")));
        return new SpringApplicationBuilder(ErpApplication.class)
                .web(WebApplicationType.SERVLET)
                .environment(environment)
                .run();
    }

    private static MockMvc mockMvc(
            ConfigurableApplicationContext context) {
        return MockMvcBuilders
                .webAppContextSetup((WebApplicationContext) context)
                .addFilters(
                        context.getBean(
                                "springSecurityFilterChain",
                                Filter.class),
                        LOGIN_BARRIER)
                .build();
    }

    private static long queryLong(String sql) throws Exception {
        try (Connection connection = connection();
                Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery(sql)) {
            assertThat(result.next()).isTrue();
            return result.getLong(1);
        }
    }

    private static void awaitThrottleLockWait() throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            if (queryLong("""
                    SELECT count(*)
                    FROM pg_stat_activity
                    WHERE datname = current_database()
                      AND state = 'active'
                      AND wait_event_type = 'Lock'
                      AND query ILIKE '%iam_login_throttles%'
                    """) > 0) {
                return;
            }
            Thread.sleep(20);
        }
        throw new AssertionError(
                "recordFailure did not wait for the throttle row lock");
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
                    .withDatabaseName("erp_iam_login_throttle_test")
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

    private static final class ConcurrentLoginBarrier implements Filter {

        private volatile CountDownLatch arrivals;

        void enable(int requestCount) {
            arrivals = new CountDownLatch(requestCount);
        }

        void disable() {
            arrivals = null;
        }

        @Override
        public void doFilter(
                ServletRequest request,
                ServletResponse response,
                FilterChain chain) throws IOException, ServletException {
            CountDownLatch active = arrivals;
            if (active != null
                    && request instanceof HttpServletRequest httpRequest
                    && "POST".equals(httpRequest.getMethod())
                    && "/api/v1/auth/login".equals(
                            httpRequest.getRequestURI())) {
                active.countDown();
                try {
                    if (!active.await(10, TimeUnit.SECONDS)) {
                        throw new ServletException(
                                "Concurrent login requests did not arrive");
                    }
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new ServletException(interrupted);
                }
            }
            chain.doFilter(request, response);
        }
    }
}
