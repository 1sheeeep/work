package cn.xzkj.erp.security;

import static org.assertj.core.api.Assertions.assertThat;

import cn.xzkj.erp.testing.LogCapture;
import com.jayway.jsonpath.JsonPath;
import io.micrometer.core.instrument.Meter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Tag;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.SpringBootVersion;
import org.testcontainers.containers.PostgreSQLContainer;

class ObservabilityBoundaryPostgresql16GateTest {

    private static final String TENANT_CODE = "observability_gate";
    private static final String TENANT_USERNAME =
            "observability_gate_admin@example.test";
    private static final String TENANT_PASSWORD =
            "observability-gate-tenant-password";
    private static final String FAILURE_CANARY_PREFIX =
            "obs-cardinality-canary-";
    private static final int REPEATED_FAILURES = 128;
    private static final int METER_GROWTH_LIMIT = 4;
    private static final PostgresqlApiFixture FIXTURE =
            new PostgresqlApiFixture();
    private static final HttpClient CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();
    private static final List<String> HEALTH_PATHS = List.of(
            "/actuator/health",
            "/actuator/health/liveness",
            "/actuator/health/readiness");
    private static final List<String> DENIED_ACTUATOR_PATHS = List.of(
            "/actuator",
            "/actuator/",
            "/actuator/info",
            "/actuator/metrics",
            "/actuator/prometheus",
            "/actuator/env",
            "/actuator/configprops",
            "/actuator/beans",
            "/actuator/loggers",
            "/actuator/heapdump",
            "/actuator/threaddump",
            "/actuator/mappings");
    private static final List<String> API_ACTUATOR_PATHS = List.of(
            "/api/actuator",
            "/api/actuator/health",
            "/api/actuator/metrics",
            "/api/actuator/prometheus");

    private static int port;
    private static String platformToken;
    private static String enteredTenantToken;
    private static String tenantToken;

    @BeforeAll
    static void start() throws Exception {
        FIXTURE.startProduction();
        port = FIXTURE.port();

        HttpResponse<String> platformLogin = jsonRequest(
                "POST",
                "/api/v1/platform-admin/auth/login",
                null,
                """
                {"username":"%s","password":"%s"}
                """.formatted(
                        PostgresqlApiFixture.SYSTEM_ADMIN_USERNAME,
                        PostgresqlApiFixture.SYSTEM_ADMIN_PASSWORD));
        assertThat(platformLogin.statusCode()).isEqualTo(200);
        platformToken = JsonPath.read(
                platformLogin.body(),
                "$.accessToken");

        HttpResponse<String> tenantCreated = jsonRequest(
                "POST",
                "/api/v1/platform-admin/tenants",
                platformToken,
                """
                {"code":"%s",
                 "name":"Observability Gate Tenant",
                 "adminEmail":"%s",
                 "adminDisplayName":"Observability Gate Admin",
                 "adminInitialPassword":"%s"}
                """.formatted(TENANT_CODE, TENANT_USERNAME, TENANT_PASSWORD));
        assertThat(tenantCreated.statusCode()).isEqualTo(201);
        String tenantId = JsonPath.read(
                tenantCreated.body(),
                "$.tenant.id");
        FIXTURE.enableErp(UUID.fromString(tenantId));

        HttpResponse<String> tenantLogin = jsonRequest(
                "POST",
                "/api/v1/auth/login",
                null,
                """
                {"tenantCode":"%s","username":"%s","password":"%s"}
                """.formatted(
                        TENANT_CODE,
                        TENANT_USERNAME,
                        TENANT_PASSWORD));
        assertThat(tenantLogin.statusCode()).isEqualTo(200);
        tenantToken = JsonPath.read(tenantLogin.body(), "$.accessToken");

        HttpResponse<String> entered = jsonRequest(
                "POST",
                "/api/v1/platform-admin/tenants/"
                        + UUID.fromString(tenantId)
                        + "/enter",
                platformToken,
                null);
        assertThat(entered.statusCode()).isEqualTo(200);
        enteredTenantToken = JsonPath.read(
                entered.body(),
                "$.accessToken");
    }

    @AfterAll
    static void stop() {
        FIXTURE.close();
    }

    @Test
    void actuatorHealthRedactionAndCardinalityStayFailClosed()
            throws Exception {
        assertRuntimeBaseline();
        List<SessionCase> sessions = List.of(
                new SessionCase("anonymous", null, 401, 401, 401),
                new SessionCase("tenant", tenantToken, 403, 404, 404),
                new SessionCase(
                        "system-base",
                        platformToken,
                        403,
                        403,
                        403),
                new SessionCase(
                        "entered-tenant",
                        enteredTenantToken,
                        403,
                        404,
                        404));

        try (LogCapture logs = LogCapture.start()) {
            assertHealthContract(sessions);
            assertActuatorDenied(sessions);
            assertApiActuatorUnchanged(sessions);
            assertUnknownBusinessPathsRedacted(sessions);
            assertRepeatedFailuresRemainBounded();
            assertAuditSurfacesSafe();
            assertSafeSurface("application logs", logs.rendered());
        }

        System.out.printf(
                Locale.ROOT,
                "OBSERVABILITY_BOUNDARY_GATE_EVIDENCE "
                        + "testcontainers=%s image=%s postgresql=%s "
                        + "spring=%s sessions=4 health_cases=%d "
                        + "denied_cases=%d api_actuator_cases=%d "
                        + "unknown_path_cases=%d audit_matches=0 "
                        + "repeated_failures=%d meter_growth_max=%d "
                        + "tests=1 failures=0 skipped=0%n",
                artifactVersion(
                        PostgreSQLContainer.class,
                        "postgresql"),
                FIXTURE.imageName(),
                FIXTURE.singleString("SHOW server_version"),
                SpringBootVersion.getVersion(),
                sessions.size() * HEALTH_PATHS.size(),
                sessions.size() * DENIED_ACTUATOR_PATHS.size(),
                sessions.size() * API_ACTUATOR_PATHS.size(),
                sessions.size(),
                REPEATED_FAILURES,
                METER_GROWTH_LIMIT);
    }

    private static void assertRuntimeBaseline() throws Exception {
        assertThat(FIXTURE.imageName()).isEqualTo("postgres:16-alpine");
        assertThat(FIXTURE.singleString("SHOW server_version"))
                .startsWith("16.");
        assertThat(FIXTURE.property(
                "management.endpoints.web.exposure.include"))
                .isEqualTo("health,info");
        assertThat(FIXTURE.property(
                "management.endpoint.health.show-details"))
                .isEqualTo("never");
        assertThat(FIXTURE.property(
                "management.endpoint.health.show-components"))
                .isEqualTo("never");
        assertThat(FIXTURE.property(
                "management.endpoint.health.group.liveness.include"))
                .isEqualTo("livenessState");
        assertThat(FIXTURE.property(
                "management.endpoint.health.group.readiness.include"))
                .isEqualTo("readinessState,db");
        assertThat(FIXTURE.property("spring.web.error.include-path"))
                .isEqualTo("never");
    }

    private static void assertHealthContract(
            List<SessionCase> sessions) throws Exception {
        for (SessionCase session : sessions) {
            for (String path : HEALTH_PATHS) {
                HttpResponse<String> response =
                        request(path, session.token(), Map.of());
                assertThat(response.statusCode())
                        .as("%s %s", session.name(), path)
                        .isEqualTo(200);
                assertThat(response.headers()
                        .firstValue("content-type")
                        .orElse(""))
                        .matches(
                                "application/(?:json|vnd\\.spring-boot"
                                        + "\\.actuator\\.v3\\+json).*");
                assertThat(response.body())
                        .contains("\"status\":\"UP\"")
                        .doesNotContain(
                                "components",
                                "details",
                                "db",
                                "jdbc:",
                                "postgresql",
                                TENANT_CODE,
                                TENANT_USERNAME,
                                TENANT_PASSWORD);
                assertSafeResponse(response);
            }
        }
    }

    private static void assertActuatorDenied(
            List<SessionCase> sessions) throws Exception {
        for (SessionCase session : sessions) {
            for (String path : DENIED_ACTUATOR_PATHS) {
                HttpResponse<String> response =
                        request(path, session.token(), Map.of());
                assertThat(response.statusCode())
                        .as("%s %s", session.name(), path)
                        .isEqualTo(session.actuatorStatus());
                assertThat(response.body()).isEqualTo(
                        session.actuatorStatus() == 401
                                ? """
                                {"code":"authentication_required","message":"Authentication is required"}"""
                                : """
                                {"code":"permission_denied","message":"Permission is required"}""");
                assertSafeResponse(response);
            }
        }
    }

    private static void assertApiActuatorUnchanged(
            List<SessionCase> sessions) throws Exception {
        for (SessionCase session : sessions) {
            for (String path : API_ACTUATOR_PATHS) {
                HttpResponse<String> response =
                        request(path, session.token(), Map.of());
                assertThat(response.statusCode())
                        .as("%s %s", session.name(), path)
                        .isEqualTo(session.apiActuatorStatus());
                assertSafeResponse(response);
            }
        }
    }

    private static void assertUnknownBusinessPathsRedacted(
            List<SessionCase> sessions) throws Exception {
        for (SessionCase session : sessions) {
            String canary = FAILURE_CANARY_PREFIX + session.name();
            HttpResponse<String> response = request(
                    "/api/v1/" + canary
                            + "?query=" + canary
                            + "&resource=" + canary,
                    session.token(),
                    Map.of(
                            "X-Observability-Gate",
                            canary,
                            "X-Request-Id",
                            canary));
            assertThat(response.statusCode())
                    .as("%s unknown business path", session.name())
                    .isEqualTo(session.unknownPathStatus());
            assertSafeResponse(response);
        }
    }

    private static void assertRepeatedFailuresRemainBounded()
            throws Exception {
        MeterRegistry registry = FIXTURE.bean(MeterRegistry.class);
        request(
                "/api/v1/" + FAILURE_CANARY_PREFIX + "warmup"
                        + "?tenant=" + FAILURE_CANARY_PREFIX + "query",
                tenantToken,
                Map.of(
                        "X-Observability-Gate",
                        FAILURE_CANARY_PREFIX + "header"));

        Set<String> before = meterIdentities(registry);
        int httpSeriesBefore = meterSeries(
                registry,
                "http.server.requests").size();

        for (int index = 0; index < REPEATED_FAILURES; index++) {
            String canary = FAILURE_CANARY_PREFIX + index;
            HttpResponse<String> response = request(
                    "/api/v1/" + canary
                            + "?tenant=" + canary
                            + "&user=" + canary
                            + "&resource=" + canary
                            + "&error=" + canary,
                    tenantToken,
                    Map.of(
                            "X-Observability-Gate",
                            canary,
                            "X-Request-Id",
                            canary));
            assertThat(response.statusCode()).isEqualTo(404);
            assertSafeResponse(response);
        }

        Set<String> after = meterIdentities(registry);
        Set<String> added = new LinkedHashSet<>(after);
        added.removeAll(before);
        assertThat(added.size()).isLessThanOrEqualTo(
                METER_GROWTH_LIMIT);
        assertThat(meterSeries(registry, "http.server.requests").size())
                .isLessThanOrEqualTo(httpSeriesBefore + 1);
        assertMeterTagsSafe(registry);
    }

    private static void assertAuditSurfacesSafe() throws Exception {
        String marker = "%" + FAILURE_CANARY_PREFIX + "%";
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM audit_logs
                WHERE concat_ws(
                    ' ',
                    request_id,
                    resource_type,
                    resource_id::text,
                    details::text) LIKE ?
                """, marker)).isZero();
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM platform_admin_audit_logs
                WHERE concat_ws(
                    ' ',
                    request_id,
                    resource_type,
                    resource_id::text,
                    details::text) LIKE ?
                """, marker)).isZero();
    }

    private static Set<String> meterIdentities(MeterRegistry registry) {
        Set<String> identities = new LinkedHashSet<>();
        for (Meter meter : registry.getMeters()) {
            identities.add(meter.getId().getName()
                    + "|"
                    + meter.getId().getTags());
        }
        return identities;
    }

    private static Set<String> meterSeries(
            MeterRegistry registry,
            String name) {
        Set<String> series = new LinkedHashSet<>();
        for (Meter meter : registry.getMeters()) {
            if (name.equals(meter.getId().getName())) {
                series.add(meter.getId().getTags().toString());
            }
        }
        return series;
    }

    private static void assertMeterTagsSafe(MeterRegistry registry) {
        for (Meter meter : registry.getMeters()) {
            for (Tag tag : meter.getId().getTags()) {
                String key = tag.getKey().toLowerCase(Locale.ROOT);
                String value = tag.getValue().toLowerCase(Locale.ROOT);
                assertThat(key).doesNotMatch(
                        "(?:tenant|user|resource)(?:[._-]?(?:id|name|code))"
                                + "|request[._-]?(?:path|query|header)"
                                + "|error[._-]?(?:detail|message)");
                assertThat(value)
                        .doesNotContain(
                                FAILURE_CANARY_PREFIX,
                                TENANT_CODE,
                                TENANT_USERNAME)
                        .doesNotMatch(
                                ".*[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}"
                                        + "-[89ab][0-9a-f]{3}"
                                        + "-[0-9a-f]{12}.*");
            }
        }
    }

    private static void assertSafeResponse(
            HttpResponse<String> response) {
        assertSafeSurface(
                "response headers",
                response.headers().map().toString());
        assertSafeSurface("response body", response.body());
    }

    private static void assertSafeSurface(
            String surfaceName,
            String surface) {
        String lower = surface.toLowerCase(Locale.ROOT);
        Map<String, Boolean> sensitiveCategories = Map.ofEntries(
                Map.entry("jdbc-url", lower.contains("jdbc:")),
                Map.entry("database-product", lower.contains("postgresql")),
                Map.entry("database-name", lower.contains("erp_api_error_gate")),
                Map.entry("database-user", lower.contains("erp_test")),
                Map.entry("loopback-host", lower.contains("127.0.0.1")),
                Map.entry("localhost", lower.contains("localhost")),
                Map.entry("runtime-port", surface.contains(":" + port)),
                Map.entry("tenant-canary", lower.contains(TENANT_CODE)),
                Map.entry("user-canary", lower.contains(TENANT_USERNAME)),
                Map.entry("password-canary", lower.contains(TENANT_PASSWORD)),
                Map.entry(
                        "cardinality-canary",
                        lower.contains(FAILURE_CANARY_PREFIX)),
                Map.entry(
                        "cardinality-path-field",
                        lower.matches(
                                "(?s).*\"path\"\\s*:\\s*\"[^\"]*"
                                        + FAILURE_CANARY_PREFIX
                                        + ".*")),
                Map.entry(
                        "cardinality-detail-field",
                        lower.matches(
                                "(?s).*\"detail\"\\s*:\\s*\"[^\"]*"
                                        + FAILURE_CANARY_PREFIX
                                        + ".*")),
                Map.entry(
                        "cardinality-instance-field",
                        lower.matches(
                                "(?s).*\"instance\"\\s*:\\s*\"[^\"]*"
                                        + FAILURE_CANARY_PREFIX
                                        + ".*")),
                Map.entry("stacktrace", lower.contains("stacktrace")),
                Map.entry("exception-class", lower.contains("exception:")));
        assertThat(sensitiveCategories)
                .as(surfaceName)
                .allSatisfy((category, present) ->
                        assertThat(present)
                                .as(category)
                                .isFalse());
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

    private static HttpResponse<String> jsonRequest(
            String method,
            String path,
            String accessToken,
            String body) throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + port + path))
                .timeout(Duration.ofSeconds(5))
                .header("Accept", "application/json");
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
        return CLIENT.send(
                builder.build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private static HttpResponse<String> request(
            String path,
            String accessToken,
            Map<String, String> headers) throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + port + path))
                .timeout(Duration.ofSeconds(5))
                .header("Accept", "application/json")
                .GET();
        if (accessToken != null) {
            builder.header("Authorization", "Bearer " + accessToken);
        }
        headers.forEach(builder::header);
        return CLIENT.send(
                builder.build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private record SessionCase(
            String name,
            String token,
            int actuatorStatus,
            int apiActuatorStatus,
            int unknownPathStatus) {}
}
