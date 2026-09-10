package cn.xzkj.erp.config;

import static org.assertj.core.api.Assertions.assertThat;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.ThrowableProxyUtil;
import ch.qos.logback.core.read.ListAppender;
import cn.xzkj.erp.ErpApplication;
import com.zaxxer.hikari.HikariDataSource;
import com.jayway.jsonpath.JsonPath;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.core.env.SystemEnvironmentPropertySource;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * A bounded, one-container PostgreSQL 16 gate for the production database
 * readiness and recovery behavior. The test accepts no external database
 * setting and deliberately fails when Docker is unavailable.
 */
class DatabaseResiliencePostgresql16GateTest {

    private static final String DATABASE = "erp_database_resilience_gate";
    private static final String DATABASE_USER = "resilience_gate_user";
    private static final String DATABASE_PASSWORD =
            "resilience-gate-database-password-canary";
    private static final String ADMIN_USERNAME = "resilience_gate_admin";
    private static final String ADMIN_PASSWORD =
            "resilience-gate-admin-password-canary";
    private static final String FAILED_WRITE_CODE =
            "RESILIENCE_FAILED_WRITE";
    private static final String FAILED_READ_REQUEST_ID =
            "resilience-gate-failed-read";
    private static final String FAILED_WRITE_REQUEST_ID =
            "resilience-gate-failed-write";
    private static final String FAILED_PATH_CANARY =
            "RESILIENCE_PATH_CANARY";
    private static final UUID ADMIN_ID =
            UUID.fromString("9a000000-0000-0000-0000-000000000001");
    private static final Duration HTTP_TIMEOUT = Duration.ofSeconds(10);
    private static final Duration STATE_TIMEOUT = Duration.ofSeconds(20);
    @Test
    void productionDatabaseReadinessFailsClosedAndRecoversWithoutRestart()
            throws Exception {
        try (PostgreSQLContainer<?> postgres =
                new PostgreSQLContainer<>("postgres:16-alpine")
                        .withDatabaseName(DATABASE)
                        .withUsername(DATABASE_USER)
                        .withPassword(DATABASE_PASSWORD)) {
            postgres.start();
            String jdbcUrl = withDriverTimeouts(postgres.getJdbcUrl());
            migrate(jdbcUrl);
            seedSystemAdmin(jdbcUrl);

            try (ConfigurableApplicationContext factContext =
                    startProductionFactApplication(jdbcUrl)) {
                assertRuntimeFacts(
                        factContext,
                        factContext.getBean(HikariDataSource.class),
                        postgres,
                        jdbcUrl);
            }

            try (ConfigurableApplicationContext context =
                    startProductionApplication(jdbcUrl)) {
                int port = context.getEnvironment().getRequiredProperty(
                        "local.server.port",
                        Integer.class);
                URI baseUri = URI.create("http://127.0.0.1:" + port);
                HttpClient client = HttpClient.newBuilder()
                        .connectTimeout(HTTP_TIMEOUT)
                        .build();
                HikariDataSource dataSource =
                        context.getBean(HikariDataSource.class);

                assertControlledTestSettings(dataSource);
                assertHealth(client, baseUri, "liveness", 200, "UP", jdbcUrl);
                assertHealth(client, baseUri, "readiness", 200, "UP", jdbcUrl);

                assertInvalidCredentialsRemainUnauthorized(client, baseUri);
                String platformToken = login(client, baseUri);
                TenantSession tenantSession = createAndEnterTenant(
                        client,
                        baseUri,
                        platformToken,
                        "resilience_gate_tenant_a");
                TenantSession otherTenantSession = createAndEnterTenant(
                        client,
                        baseUri,
                        platformToken,
                        "resilience_gate_tenant_b");
                UUID existingSupplierId = createSupplier(
                        jdbcUrl,
                        tenantSession.tenantId(),
                        "RESILIENCE_EXISTING");
                assertCrossTenantSupplierHidden(
                        client,
                        baseUri,
                        otherTenantSession.accessToken(),
                        existingSupplierId);
                assertThat(request(
                        client,
                        baseUri,
                        "GET",
                        "/api/v1/suppliers",
                        tenantSession.accessToken(),
                        "resilience-gate-initial-read",
                        null).statusCode()).isEqualTo(200);

                long tenantCountBefore = count(jdbcUrl, "tenants");
                long supplierCountBefore = count(
                        jdbcUrl,
                        "tenant_suppliers");
                long warehouseAuditCountBefore = countWhere(
                        jdbcUrl,
                        "audit_logs",
                        "action",
                        "warehouse.created");
                String contextId = context.getId();
                long contextStartedAt = context.getStartupDate();

                provePoolExhaustionFailsReadinessAndRecovers(
                        client,
                        baseUri,
                        dataSource,
                        jdbcUrl);

                ListAppender<ILoggingEvent> failureLogs = captureLogs();
                HttpResponse<String> failedRead;
                HttpResponse<String> failedWrite;
                try {
                    postgres.getDockerClient()
                            .pauseContainerCmd(postgres.getContainerId())
                            .exec();
                    try {
                        awaitHealth(
                                client,
                                baseUri,
                                "readiness",
                                503,
                                "DOWN",
                                jdbcUrl);
                        assertHealth(
                                client,
                                baseUri,
                                "liveness",
                                200,
                                "UP",
                                jdbcUrl);

                        failedRead = request(
                                client,
                                baseUri,
                                "GET",
                                "/api/v1/suppliers?query="
                                        + FAILED_PATH_CANARY,
                                tenantSession.accessToken(),
                                FAILED_READ_REQUEST_ID,
                                null);
                        failedWrite = request(
                                client,
                                baseUri,
                                "POST",
                                "/api/v1/warehouse-center/warehouses",
                                tenantSession.accessToken(),
                                FAILED_WRITE_REQUEST_ID,
                                """
                                {
                                  "businessCode":"%s",
                                  "name":"Must not commit"
                                }
                                """.formatted(FAILED_WRITE_CODE));
                    } finally {
                        postgres.getDockerClient()
                                .unpauseContainerCmd(
                                        postgres.getContainerId())
                                .exec();
                    }
                } finally {
                    stopCapturing(failureLogs);
                }

                assertSafeDatabaseFailureEnvelope(failedRead, jdbcUrl);
                assertSafeDatabaseFailureEnvelope(failedWrite, jdbcUrl);
                assertSafeFailureLogs(failureLogs, jdbcUrl,
                        tenantSession.accessToken());

                awaitDatabase(jdbcUrl);
                awaitHealth(
                        client,
                        baseUri,
                        "readiness",
                        200,
                        "UP",
                        jdbcUrl);

                assertThat(context.isActive()).isTrue();
                assertThat(context.getId()).isEqualTo(contextId);
                assertThat(context.getStartupDate()).isEqualTo(contextStartedAt);
                assertThat(request(
                        client,
                        baseUri,
                        "GET",
                        "/api/v1/suppliers",
                        tenantSession.accessToken(),
                        "resilience-gate-recovered-read",
                        null).statusCode()).isEqualTo(200);
                assertCrossTenantSupplierHidden(
                        client,
                        baseUri,
                        otherTenantSession.accessToken(),
                        existingSupplierId);

                assertThat(count(jdbcUrl, "tenants"))
                        .isEqualTo(tenantCountBefore);
                assertThat(count(jdbcUrl, "tenant_suppliers"))
                        .isEqualTo(supplierCountBefore);
                assertThat(countWhere(
                        jdbcUrl,
                        "tenant_warehouses",
                        "business_code",
                        FAILED_WRITE_CODE)).isZero();
                assertThat(countWhere(
                        jdbcUrl,
                        "audit_logs",
                        "action",
                        "warehouse.created"))
                        .isEqualTo(warehouseAuditCountBefore);
                assertThat(countWhere(
                        jdbcUrl,
                        "audit_logs",
                        "request_id",
                        FAILED_WRITE_REQUEST_ID)).isZero();
                awaitPoolIdle(dataSource);

                System.out.printf(
                        "DATABASE_RESILIENCE_GATE_EVIDENCE "
                                + "testcontainers=%s image=%s postgresql=%s "
                                + "flyway=%s hikari=%s spring-tx=%s "
                                + "tests=1 failures=0 skipped=0%n",
                        artifactVersion(
                                PostgreSQLContainer.class,
                                "postgresql"),
                        postgres.getDockerImageName(),
                        queryString(jdbcUrl, "SHOW server_version"),
                        queryString(
                                jdbcUrl,
                                """
                                SELECT version
                                FROM flyway_schema_history
                                WHERE success
                                ORDER BY installed_rank DESC
                                LIMIT 1
                                """),
                        artifactVersion(HikariDataSource.class, "HikariCP"),
                        artifactVersion(
                                AbstractPlatformTransactionManager.class,
                                "spring-tx"));
            }
        }
    }

    private static void assertRuntimeFacts(
            ConfigurableApplicationContext context,
            HikariDataSource dataSource,
            PostgreSQLContainer<?> postgres,
            String jdbcUrl) throws Exception {
        assertThat(artifactVersion(
                PostgreSQLContainer.class,
                "postgresql"))
                .isEqualTo("1.21.4");
        assertThat(artifactVersion(HikariDataSource.class, "HikariCP"))
                .isEqualTo("7.0.2");
        assertThat(artifactVersion(
                AbstractPlatformTransactionManager.class,
                "spring-tx"))
                .isEqualTo("7.0.8");
        assertThat(postgres.getDockerImageName())
                .isEqualTo("postgres:16-alpine");
        assertThat(queryString(jdbcUrl, "SHOW server_version"))
                .startsWith("16.");
        assertThat(queryString(
                jdbcUrl,
                """
                SELECT version
                FROM flyway_schema_history
                WHERE success
                ORDER BY installed_rank DESC
                LIMIT 1
                """)).isEqualTo("123");

        assertThat(dataSource.getMaximumPoolSize()).isEqualTo(10);
        assertThat(dataSource.getMinimumIdle()).isEqualTo(10);
        assertThat(dataSource.getConnectionTimeout()).isEqualTo(30_000);
        assertThat(dataSource.getValidationTimeout()).isEqualTo(5_000);
        assertThat(dataSource.getIdleTimeout()).isEqualTo(600_000);
        assertThat(dataSource.getMaxLifetime()).isEqualTo(1_800_000);
        assertThat(dataSource.getLeakDetectionThreshold()).isZero();
        assertThat(dataSource.getInitializationFailTimeout()).isEqualTo(1);

        AbstractPlatformTransactionManager transactionManager =
                (AbstractPlatformTransactionManager) context.getBean(
                        "transactionManager");
        assertThat(transactionManager.getDefaultTimeout())
                .isEqualTo(TransactionDefinition.TIMEOUT_DEFAULT);

        assertThat(context.getEnvironment().getProperty(
                "management.endpoint.health.group.readiness.include"))
                .isEqualTo("readinessState,db");
        assertThat(context.getEnvironment().getProperty(
                "management.endpoint.health.show-details"))
                .isEqualTo("never");
        assertThat(context.getEnvironment().getProperty(
                "management.endpoint.health.show-components"))
                .isEqualTo("never");

    }

    private static void assertControlledTestSettings(
            HikariDataSource dataSource) {
        assertThat(dataSource.getMaximumPoolSize()).isEqualTo(2);
        assertThat(dataSource.getMinimumIdle()).isZero();
        assertThat(dataSource.getConnectionTimeout()).isEqualTo(1_000);
        assertThat(dataSource.getValidationTimeout()).isEqualTo(1_000);
    }

    private static void provePoolExhaustionFailsReadinessAndRecovers(
            HttpClient client,
            URI baseUri,
            HikariDataSource dataSource,
            String jdbcUrl) throws Exception {
        List<Connection> held = new ArrayList<>();
        try {
            for (int index = 0;
                    index < dataSource.getMaximumPoolSize();
                    index++) {
                held.add(dataSource.getConnection());
            }
            assertThat(dataSource.getHikariPoolMXBean()
                    .getActiveConnections())
                    .isEqualTo(dataSource.getMaximumPoolSize());
            long acquisitionStarted = System.nanoTime();
            Exception acquisitionFailure = null;
            try {
                dataSource.getConnection().close();
            } catch (Exception expected) {
                acquisitionFailure = expected;
            }
            assertThat(acquisitionFailure).isNotNull();
            assertThat(Duration.ofNanos(
                    System.nanoTime() - acquisitionStarted))
                    .isLessThan(Duration.ofSeconds(3));
            assertHealth(
                    client,
                    baseUri,
                    "readiness",
                    503,
                    "DOWN",
                    jdbcUrl);
            assertHealth(
                    client,
                    baseUri,
                    "liveness",
                    200,
                    "UP",
                    jdbcUrl);
        } finally {
            for (Connection connection : held) {
                connection.close();
            }
        }
        awaitHealth(client, baseUri, "readiness", 200, "UP", jdbcUrl);
        awaitPoolIdle(dataSource);
    }

    private static void assertSafeDatabaseFailureEnvelope(
            HttpResponse<String> response,
            String jdbcUrl) throws Exception {
        assertThat(response.statusCode()).isEqualTo(503);
        assertThat(response.headers()
                .firstValue("content-type")
                .orElse(""))
                .startsWith("application/json");
        Map<String, Object> body = JsonPath.read(response.body(), "$");
        assertThat(body)
                .containsExactlyInAnyOrderEntriesOf(Map.of(
                        "code", "service_unavailable",
                        "message", "Service is temporarily unavailable"));
        assertThat(response.headers()
                .allValues("cache-control"))
                .anyMatch(value -> value.contains("no-store"));
        assertThat(response.headers()
                .firstValue("x-content-type-options"))
                .contains("nosniff");
        assertRedacted(response.body(), jdbcUrl);
        for (Map.Entry<String, List<String>> header :
                response.headers().map().entrySet()) {
            assertRedacted(
                    header.getKey() + ":" + String.join(",", header.getValue()),
                    jdbcUrl);
        }
    }

    private static void assertSafeFailureLogs(
            ListAppender<ILoggingEvent> appender,
            String jdbcUrl,
            String accessToken) {
        String output = appender.list.stream()
                .map(event -> event.getFormattedMessage()
                        + System.lineSeparator()
                        + ThrowableProxyUtil.asString(
                                event.getThrowableProxy()))
                .reduce("", (left, right) ->
                        left + System.lineSeparator() + right);
        assertThat(output)
                .doesNotContain(
                        jdbcUrl,
                        DATABASE,
                        DATABASE_USER,
                        DATABASE_PASSWORD,
                        ADMIN_USERNAME,
                        ADMIN_PASSWORD,
                        accessToken,
                        FAILED_WRITE_CODE,
                        FAILED_READ_REQUEST_ID,
                        FAILED_WRITE_REQUEST_ID,
                        FAILED_PATH_CANARY,
                        "Must not commit",
                        "jdbc:postgresql:",
                        "SQLState",
                        "org.postgresql",
                        "PSQLException",
                        "SQLException",
                        "Exception",
                        "Caused by:",
                        "\tat ",
                        "password");
        assertThat(output)
                .doesNotContain(databaseHost(jdbcUrl))
                .doesNotContain(":" + databasePort(jdbcUrl));
        assertThat(output.toLowerCase())
                .doesNotContain(
                        "select ",
                        "insert ",
                        "update ",
                        "delete ");
    }

    private static void assertRedacted(
            String value,
            String jdbcUrl) {
        assertThat(value)
                .doesNotContain(
                        jdbcUrl,
                        DATABASE,
                        DATABASE_USER,
                        DATABASE_PASSWORD,
                        ADMIN_USERNAME,
                        ADMIN_PASSWORD,
                        FAILED_WRITE_CODE,
                        FAILED_READ_REQUEST_ID,
                        FAILED_WRITE_REQUEST_ID,
                        FAILED_PATH_CANARY,
                        "jdbc:",
                        "org.postgresql",
                        "PSQLException",
                        "SQLException",
                        "SQLState",
                        "stackTrace",
                        "exception",
                        "trace",
                        "SELECT ",
                        "INSERT ",
                        "UPDATE ",
                        "DELETE ")
                .doesNotContain(databaseHost(jdbcUrl))
                .doesNotContain(":" + databasePort(jdbcUrl));
    }

    private static String login(HttpClient client, URI baseUri)
            throws Exception {
        HttpResponse<String> response = request(
                client,
                baseUri,
                "POST",
                "/api/v1/platform-admin/auth/login",
                null,
                "resilience-gate-login",
                """
                {"username":"%s","password":"%s"}
                """.formatted(ADMIN_USERNAME, ADMIN_PASSWORD));
        assertThat(response.statusCode()).isEqualTo(200);
        return JsonPath.read(response.body(), "$.accessToken");
    }

    private static void assertInvalidCredentialsRemainUnauthorized(
            HttpClient client,
            URI baseUri) throws Exception {
        HttpResponse<String> response = request(
                client,
                baseUri,
                "POST",
                "/api/v1/platform-admin/auth/login",
                null,
                "resilience-gate-invalid-login",
                """
                {"username":"%s","password":"definitely-wrong"}
                """.formatted(ADMIN_USERNAME));
        assertThat(response.statusCode()).isEqualTo(401);
        Map<String, Object> body = JsonPath.read(response.body(), "$");
        assertThat(body).containsExactlyInAnyOrderEntriesOf(Map.of(
                "code", "invalid_credentials",
                "message", "Invalid username or password"));
    }

    private static TenantSession createAndEnterTenant(
            HttpClient client,
            URI baseUri,
            String platformToken,
            String tenantCode) throws Exception {
        HttpResponse<String> created = request(
                client,
                baseUri,
                "POST",
                "/api/v1/platform-admin/tenants",
                platformToken,
                "resilience-gate-create-tenant",
                """
                {
                  "code":"%s",
                  "name":"Resilience Gate Tenant",
                  "adminEmail":"%s_admin@example.test",
                  "adminDisplayName":"Resilience Gate Tenant Admin",
                  "adminInitialPassword":"resilience-direct-password"
                }
                """.formatted(tenantCode, tenantCode));
        assertThat(created.statusCode()).isEqualTo(201);
        UUID tenantId = UUID.fromString(
                JsonPath.read(created.body(), "$.tenant.id"));
        enableErp(client, baseUri, platformToken, tenantId);
        HttpResponse<String> entered = request(
                client,
                baseUri,
                "POST",
                "/api/v1/platform-admin/tenants/" + tenantId + "/enter",
                platformToken,
                "resilience-gate-enter-tenant",
                null);
        assertThat(entered.statusCode()).isEqualTo(200);
        return new TenantSession(
                tenantId,
                JsonPath.read(entered.body(), "$.accessToken"));
    }

    private static void enableErp(
            HttpClient client,
            URI baseUri,
            String platformToken,
            UUID tenantId) throws Exception {
        HttpResponse<String> response = request(
                client,
                baseUri,
                "PUT",
                "/api/v1/platform-admin/tenants/" + tenantId
                        + "/entitlements",
                platformToken,
                "resilience-gate-enable-erp",
                """
                {
                  "version":0,
                  "applications":[{
                    "code":"ERP",
                    "modules":["CHANNELS","PRODUCTS","ORDERS",
                      "PROCUREMENT","WAREHOUSE","LOGISTICS","ANALYTICS"]
                  }]
                }
                """);
        assertThat(response.statusCode()).isEqualTo(200);
    }

    private static UUID createSupplier(
            String jdbcUrl,
            UUID tenantId,
            String businessCode) throws Exception {
        UUID supplierId = UUID.randomUUID();
        try (Connection connection = DriverManager.getConnection(
                        jdbcUrl,
                        DATABASE_USER,
                        DATABASE_PASSWORD);
                PreparedStatement statement = connection.prepareStatement("""
                        INSERT INTO tenant_suppliers (
                          id, tenant_id, business_code, name, status)
                        VALUES (?, ?, ?, ?, 'ACTIVE')
                        """)) {
            statement.setObject(1, supplierId);
            statement.setObject(2, tenantId);
            statement.setString(3, businessCode);
            statement.setString(4, "Existing tenant A supplier");
            statement.executeUpdate();
        }
        return supplierId;
    }

    private static void assertCrossTenantSupplierHidden(
            HttpClient client,
            URI baseUri,
            String otherTenantToken,
            UUID supplierId) throws Exception {
        HttpResponse<String> response = request(
                client,
                baseUri,
                "GET",
                "/api/v1/suppliers/" + supplierId,
                otherTenantToken,
                "resilience-gate-cross-tenant-read",
                null);
        assertThat(response.statusCode()).isEqualTo(404);
        Map<String, Object> body = JsonPath.read(response.body(), "$");
        assertThat(body)
                .containsEntry("code", "resource_not_found")
                .doesNotContainValue(supplierId.toString());
    }

    private static HttpResponse<String> request(
            HttpClient client,
            URI baseUri,
            String method,
            String path,
            String accessToken,
            String requestId,
            String body) throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder()
                .uri(baseUri.resolve(path))
                .timeout(HTTP_TIMEOUT)
                .header("Accept", "application/json")
                .header("X-Request-Id", requestId);
        if (accessToken != null) {
            builder.header("Authorization", "Bearer " + accessToken);
        }
        if (body != null) {
            builder.header("Content-Type", "application/json");
        }
        builder.method(
                method,
                body == null
                        ? HttpRequest.BodyPublishers.noBody()
                        : HttpRequest.BodyPublishers.ofString(body));
        return client.send(
                builder.build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private static void assertHealth(
            HttpClient client,
            URI baseUri,
            String group,
            int expectedStatus,
            String expectedHealth,
            String jdbcUrl) throws Exception {
        HttpResponse<String> response = health(client, baseUri, group);
        assertThat(response.statusCode()).isEqualTo(expectedStatus);
        assertThat(response.headers()
                .firstValue("content-type")
                .orElse(""))
                .startsWith(
                        "application/vnd.spring-boot.actuator.v3+json");
        assertThat(response.body())
                .isEqualTo("{\"status\":\"" + expectedHealth + "\"}");
        assertRedacted(response.body(), jdbcUrl);
        for (Map.Entry<String, List<String>> header :
                response.headers().map().entrySet()) {
            assertRedacted(
                    header.getKey() + ":" + String.join(",", header.getValue()),
                    jdbcUrl);
        }
    }

    private static void awaitHealth(
            HttpClient client,
            URI baseUri,
            String group,
            int expectedStatus,
            String expectedHealth,
            String jdbcUrl) throws Exception {
        long deadline = System.nanoTime() + STATE_TIMEOUT.toNanos();
        AssertionError lastFailure = null;
        while (System.nanoTime() < deadline) {
            try {
                assertHealth(
                        client,
                        baseUri,
                        group,
                        expectedStatus,
                        expectedHealth,
                        jdbcUrl);
                return;
            } catch (AssertionError failure) {
                lastFailure = failure;
                Thread.sleep(200);
            }
        }
        throw lastFailure == null
                ? new AssertionError("Health state did not converge")
                : lastFailure;
    }

    private static HttpResponse<String> health(
            HttpClient client,
            URI baseUri,
            String group) throws Exception {
        return client.send(
                HttpRequest.newBuilder()
                        .uri(baseUri.resolve(
                                "/actuator/health/" + group))
                        .timeout(HTTP_TIMEOUT)
                        .GET()
                        .build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private static void awaitDatabase(String jdbcUrl) throws Exception {
        long deadline = System.nanoTime() + STATE_TIMEOUT.toNanos();
        Exception lastFailure = null;
        while (System.nanoTime() < deadline) {
            try (Connection connection = connection(jdbcUrl);
                    PreparedStatement statement =
                            connection.prepareStatement("SELECT 1");
                    ResultSet result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                return;
            } catch (Exception unavailable) {
                lastFailure = unavailable;
                Thread.sleep(200);
            }
        }
        throw lastFailure == null
                ? new IllegalStateException("Database did not recover")
                : lastFailure;
    }

    private static void awaitPoolIdle(HikariDataSource dataSource)
            throws Exception {
        long deadline = System.nanoTime() + STATE_TIMEOUT.toNanos();
        while (System.nanoTime() < deadline) {
            if (dataSource.getHikariPoolMXBean().getActiveConnections() == 0) {
                return;
            }
            Thread.sleep(100);
        }
        assertThat(dataSource.getHikariPoolMXBean().getActiveConnections())
                .isZero();
    }

    private static ListAppender<ILoggingEvent> captureLogs() {
        Logger root = (Logger) LoggerFactory.getLogger(
                Logger.ROOT_LOGGER_NAME);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        root.addAppender(appender);
        return appender;
    }

    private static void stopCapturing(
            ListAppender<ILoggingEvent> appender) {
        Logger root = (Logger) LoggerFactory.getLogger(
                Logger.ROOT_LOGGER_NAME);
        root.detachAppender(appender);
        appender.stop();
    }

    private static ConfigurableApplicationContext startProductionApplication(
            String jdbcUrl) {
        return startProductionApplication(jdbcUrl, true);
    }

    private static ConfigurableApplicationContext
            startProductionFactApplication(String jdbcUrl) {
        return startProductionApplication(jdbcUrl, false);
    }

    private static ConfigurableApplicationContext startProductionApplication(
            String jdbcUrl,
            boolean controlledWebGate) {
        StandardEnvironment environment = new StandardEnvironment();
        environment.getPropertySources().remove(
                StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME);
        environment.getPropertySources().remove(
                StandardEnvironment.SYSTEM_PROPERTIES_PROPERTY_SOURCE_NAME);
        environment.getPropertySources().addFirst(
                new MapPropertySource(
                        "databaseResilienceGateSettings",
                        controlledWebGate
                                ? Map.ofEntries(
                                        Map.entry("server.port", "0"),
                                        Map.entry(
                                                "spring.datasource.hikari."
                                                        + "connection-timeout",
                                                "1000"),
                                        Map.entry(
                                                "spring.datasource.hikari."
                                                        + "validation-timeout",
                                                "1000"),
                                        Map.entry(
                                                "spring.datasource.hikari."
                                                        + "maximum-pool-size",
                                                "2"),
                                        Map.entry(
                                                "spring.datasource.hikari."
                                                        + "minimum-idle",
                                                "0"),
                                        Map.entry(
                                                "spring.main.banner-mode",
                                                "off"))
                                : Map.of(
                                        "spring.main.banner-mode",
                                        "off")));
        environment.getPropertySources().addFirst(
                new SystemEnvironmentPropertySource(
                        "isolatedDatabaseResilienceGateEnvironment",
                        Map.ofEntries(
                                Map.entry("ERP_DB_URL", jdbcUrl),
                                Map.entry("ERP_DB_USER", DATABASE_USER),
                                Map.entry(
                                        "ERP_DB_PASSWORD",
                                        DATABASE_PASSWORD))));
        environment.setActiveProfiles("production");
        SpringApplicationBuilder builder =
                new SpringApplicationBuilder(ErpApplication.class)
                .environment(environment)
                .logStartupInfo(false);
        if (!controlledWebGate) {
            builder.web(WebApplicationType.NONE);
        }
        return builder.run();
    }

    private static void migrate(String jdbcUrl) {
        Flyway.configure()
                .dataSource(jdbcUrl, DATABASE_USER, DATABASE_PASSWORD)
                .locations("classpath:db/migration")
                .load()
                .migrate();
    }

    private static void seedSystemAdmin(String jdbcUrl) throws Exception {
        String passwordHash = "{bcrypt}"
                + new BCryptPasswordEncoder(12).encode(ADMIN_PASSWORD);
        try (Connection connection = connection(jdbcUrl);
                PreparedStatement statement = connection.prepareStatement("""
                        INSERT INTO system_admins (
                            id, username, display_name, password_hash,
                            status, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, 'ACTIVE', now(), now())
                        """)) {
            statement.setObject(1, ADMIN_ID);
            statement.setString(2, ADMIN_USERNAME);
            statement.setString(3, "Resilience Gate Admin");
            statement.setString(4, passwordHash);
            statement.executeUpdate();
        }
    }

    private static long count(String jdbcUrl, String table)
            throws Exception {
        return queryLong(jdbcUrl, "SELECT count(*) FROM " + table);
    }

    private static long countWhere(
            String jdbcUrl,
            String table,
            String column,
            String value) throws Exception {
        try (Connection connection = connection(jdbcUrl);
                PreparedStatement statement = connection.prepareStatement(
                        "SELECT count(*) FROM "
                                + table
                                + " WHERE "
                                + column
                                + " = ?")) {
            statement.setString(1, value);
            try (ResultSet result = statement.executeQuery()) {
                result.next();
                return result.getLong(1);
            }
        }
    }

    private static long queryLong(String jdbcUrl, String sql)
            throws Exception {
        try (Connection connection = connection(jdbcUrl);
                PreparedStatement statement = connection.prepareStatement(sql);
                ResultSet result = statement.executeQuery()) {
            result.next();
            return result.getLong(1);
        }
    }

    private static String queryString(String jdbcUrl, String sql)
            throws Exception {
        try (Connection connection = connection(jdbcUrl);
                PreparedStatement statement = connection.prepareStatement(sql);
                ResultSet result = statement.executeQuery()) {
            result.next();
            return result.getString(1);
        }
    }

    private static Connection connection(String jdbcUrl) throws Exception {
        return DriverManager.getConnection(
                jdbcUrl,
                DATABASE_USER,
                DATABASE_PASSWORD);
    }

    private static String withDriverTimeouts(String jdbcUrl) {
        return jdbcUrl
                + (jdbcUrl.contains("?") ? "&" : "?")
                + "connectTimeout=1&socketTimeout=1";
    }

    private static String databaseHost(String jdbcUrl) {
        return URI.create(jdbcUrl.substring("jdbc:".length())).getHost();
    }

    private static int databasePort(String jdbcUrl) {
        return URI.create(jdbcUrl.substring("jdbc:".length())).getPort();
    }

    private static String artifactVersion(
            Class<?> type,
            String artifactId) {
        String location = type.getProtectionDomain()
                .getCodeSource()
                .getLocation()
                .toString();
        Matcher matcher = Pattern.compile(
                        Pattern.quote(artifactId)
                                + "-([0-9][A-Za-z0-9.-]*)\\.jar$")
                .matcher(location);
        assertThat(matcher.find())
                .as("artifact version location for %s", artifactId)
                .isTrue();
        return matcher.group(1);
    }

    private record TenantSession(UUID tenantId, String accessToken) {
    }
}
