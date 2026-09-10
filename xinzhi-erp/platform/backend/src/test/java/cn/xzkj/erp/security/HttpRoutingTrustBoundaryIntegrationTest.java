package cn.xzkj.erp.security;

import static org.assertj.core.api.Assertions.assertThat;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.ThrowableProxyUtil;
import ch.qos.logback.core.read.ListAppender;
import com.jayway.jsonpath.JsonPath;
import java.io.ByteArrayOutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

class HttpRoutingTrustBoundaryIntegrationTest {

    private static final String TENANT_CODE = "http_route_gate";
    private static final String TENANT_USERNAME =
            "http_route_gate_admin@example.test";
    private static final String TENANT_PASSWORD =
            "http-route-gate-tenant-password";
    private static final String HEADER_CANARY =
            "header.http-route-gate.invalid";
    private static final String QUERY_CANARY =
            "query-http-route-gate-credential";
    private static final String BODY_CANARY =
            "body-http-route-gate-password";
    private static final int MAX_RESPONSE_BYTES = 64 * 1024;
    private static final PostgresqlApiFixture FIXTURE =
            new PostgresqlApiFixture();
    private static final HttpClient CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    private static int port;
    private static String platformToken;
    private static String enteredTenantToken;
    private static String tenantToken;

    @BeforeAll
    static void start() throws Exception {
        FIXTURE.startProductionWithParserLogLevelAttempt("DEBUG");
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
                 "name":"HTTP Route Gate Tenant",
                 "adminEmail":"%s",
                 "adminDisplayName":"HTTP Route Gate Admin",
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
    void usesARealSpringConnectorAndOwnedPostgresql16() throws Exception {
        assertThat(port).isPositive();
        assertThat(FIXTURE.imageName()).isEqualTo("postgres:16-alpine");
        assertThat(FIXTURE.singleString("SHOW server_version"))
                .startsWith("16.");
        assertThat(FIXTURE.property(
                "logging.level.org.apache.coyote.http11.Http11Processor"))
                .isEqualTo("WARN");
        assertThat(raw("GET", "/actuator/health", null, Map.of(), null).status())
                .isEqualTo(200);
    }

    @Test
    void trustDomainsRemainClosedForEverySessionAndPathVariant()
            throws Exception {
        ListAppender<ILoggingEvent> logs = captureLogs();
        try {
            List<SessionCase> sessions = List.of(
                    new SessionCase("platform-base", platformToken),
                    new SessionCase("entered-tenant", enteredTenantToken),
                    new SessionCase("tenant", tenantToken),
                    new SessionCase("anonymous", null));
            List<DomainCase> domains = List.of(
                    new DomainCase(
                            "platform-admin",
                            "/api/v1/platform-admin/system-admins",
                            Set.of("platform-base")),
                    new DomainCase(
                            "tenant-business",
                            "/api/v1/product-center/spus",
                            Set.of("entered-tenant", "tenant")),
                    new DomainCase(
                            "actuator",
                            "/actuator/health",
                            Set.of(
                                    "platform-base",
                                    "entered-tenant",
                                    "tenant",
                                    "anonymous")),
                    new DomainCase(
                            "internal",
                            "/internal/http-route-gate",
                            Set.of()),
                    new DomainCase(
                            "static",
                            "/index.html",
                            Set.of()),
                    new DomainCase(
                            "api-actuator",
                            "/api/actuator/health",
                            Set.of()));

            int requests = 0;
            for (DomainCase domain : domains) {
                for (PathVariant variant : variants(domain.path())) {
                    for (SessionCase session : sessions) {
                        RawResponse response = raw(
                                "GET",
                                withCanaryQuery(variant.target()),
                                session.token(),
                                hostileRoutingHeaders(),
                                null);
                        requests += 1;
                        assertSafeResponse(
                                response,
                                domain.name(),
                                variant.name(),
                                session.name());
                        if (response.status() == 500) {
                            assertThat(response.body())
                                    .contains("\"code\":\"internal_error\"")
                                    .contains(
                                            "\"message\":\"An internal error occurred\"");
                        }
                        if (isSuccess(response.status())) {
                            assertThat(domain.allowedSessions())
                                    .as("%s %s must not cross trust domains",
                                            domain.name(),
                                            variant.name())
                                    .contains(session.name());
                            assertSuccessFingerprint(domain, response);
                        }
                    }
                }
            }
            assertThat(requests).isEqualTo(
                    domains.size() * variants(domains.getFirst().path()).size()
                            * sessions.size());
            assertThat(logText(logs))
                    .contains("Unexpected business API error");
        } finally {
            stopCapturing(logs);
            assertLogsSafe(logs);
        }
    }

    @Test
    void methodsAndOverrideHeadersPreserveTheActualRequest()
            throws Exception {
        Map<String, Integer> publicMethodFacts = Map.of(
                "GET", 200,
                "POST", 405,
                "PUT", 405,
                "PATCH", 405,
                "DELETE", 405,
                "OPTIONS", 200,
                "TRACE", 405);
        for (Map.Entry<String, Integer> fact : publicMethodFacts.entrySet()) {
            RawResponse response = raw(
                    fact.getKey(),
                    "/api/v1/system/info",
                    null,
                    Map.of(),
                    null);
            assertThat(response.status())
                    .as("current direct-Spring %s fact", fact.getKey())
                    .isEqualTo(fact.getValue());
            assertSafeResponse(
                    response,
                    "public-system-info",
                    "exact",
                    "anonymous");
        }

        Map<String, Integer> tenantMethodFacts = Map.of(
                "GET", 200,
                "POST", 400,
                "PUT", 405,
                "PATCH", 405,
                "DELETE", 405,
                "OPTIONS", 200,
                "TRACE", 405);
        for (Map.Entry<String, Integer> fact : tenantMethodFacts.entrySet()) {
            RawResponse tenant = raw(
                    fact.getKey(),
                    "/api/v1/product-center/spus",
                    tenantToken,
                    Map.of(),
                    null);
            assertThat(tenant.status())
                    .as("current tenant %s fact", fact.getKey())
                    .isEqualTo(fact.getValue());

            RawResponse platformBase = raw(
                    fact.getKey(),
                    "/api/v1/product-center/spus",
                    platformToken,
                    Map.of(),
                    null);
            assertThat(platformBase.status())
                    .as("base SYSTEM_ADMIN %s must not enter tenant API",
                            fact.getKey())
                    .isEqualTo(fact.getKey().equals("TRACE") ? 405 : 403);

            RawResponse anonymous = raw(
                    fact.getKey(),
                    "/api/v1/product-center/spus",
                    null,
                    Map.of(),
                    null);
            assertThat(anonymous.status())
                    .as("anonymous %s must not enter tenant API", fact.getKey())
                    .isEqualTo(fact.getKey().equals("TRACE") ? 405 : 401);
        }

        List<Map<String, String>> ignoredRoutingHeaders = List.of(
                Map.of("X-HTTP-Method-Override", "DELETE"),
                Map.of("X-Method-Override", "PATCH"),
                Map.of(
                        "X-Original-URL",
                        "/api/v1/platform-admin/system-admins"),
                Map.of("X-Rewrite-URL", "/actuator/health"),
                Map.of(
                        "Forwarded",
                        "for=192.0.2.44;host="
                                + HEADER_CANARY
                                + ";proto=https"),
                Map.of("X-Forwarded-Prefix", "/actuator"),
                Map.of(
                        "X-Forwarded-Host",
                        HEADER_CANARY,
                        "X-Forwarded-Proto",
                        "https"));
        for (Map<String, String> headers : ignoredRoutingHeaders) {
            RawResponse response = raw(
                    "GET",
                    withCanaryQuery("/api/v1/system/info"),
                    null,
                    headers,
                    null);
            assertThat(response.status()).isEqualTo(200);
            assertThat(response.body()).contains("\"service\":\"xz-erp\"");
            assertSafeResponse(
                    response,
                    "public-system-info",
                    "routing-header",
                    "anonymous");
        }

        RawResponse postNotOverridden = raw(
                "POST",
                "/api/v1/system/info",
                null,
                Map.of(
                        "Content-Type", "application/json",
                        "X-HTTP-Method-Override", "GET",
                        "X-Method-Override", "GET"),
                "{\"value\":\"" + BODY_CANARY + "\"}");
        assertThat(postNotOverridden.status()).isEqualTo(405);
        assertThat(postNotOverridden.body())
                .doesNotContain("\"service\":\"xz-erp\"");
        assertSafeResponse(
                postNotOverridden,
                "public-system-info",
                "post-not-overridden",
                "anonymous");

        RawResponse tenantPathNotRewritten = raw(
                "GET",
                "/api/v1/product-center/spus",
                tenantToken,
                Map.of(
                        "X-Original-URL",
                        "/api/v1/platform-admin/system-admins",
                        "X-Rewrite-URL",
                        "/actuator/health",
                        "X-Forwarded-Prefix",
                        "/internal"),
                null);
        assertThat(tenantPathNotRewritten.status()).isEqualTo(200);
        assertThat(tenantPathNotRewritten.body())
                .doesNotContain("\"status\":\"UP\"");

        RawResponse platformPathNotRewritten = raw(
                "GET",
                "/api/v1/platform-admin/system-admins",
                platformToken,
                Map.of(
                        "X-Original-URL",
                        "/api/v1/product-center/spus",
                        "X-Rewrite-URL",
                        "/actuator/health"),
                null);
        assertThat(platformPathNotRewritten.status()).isEqualTo(200);
        assertThat(platformPathNotRewritten.body())
                .doesNotContain("\"status\":\"UP\"");
    }

    @Test
    void conflictingLengthAndTransferEncodingIsOneBoundedRejectedRequest()
            throws Exception {
        RawResponse response = raw(
                "POST",
                "/api/v1/system/info",
                null,
                Map.of(
                        "Content-Length", "4",
                        "Transfer-Encoding", "chunked",
                        "Content-Type", "application/json"),
                "0\r\n\r\n");
        assertThat(response.status())
                .as("the bounded sample must not succeed")
                .isBetween(400, 499);
        assertSafeResponse(
                response,
                "connector",
                "content-length-transfer-encoding",
                "anonymous");
    }

    @Test
    void productionParserRedactionKeepsOrdinaryWarnVisible()
            throws Exception {
        ListAppender<ILoggingEvent> logs = captureLogs();
        try {
            String malformedTarget =
                    "/api\\v1\\system\\info?token="
                            + QUERY_CANARY
                            + "&password="
                            + QUERY_CANARY
                            + "&credential="
                            + QUERY_CANARY;
            RawResponse malformed = raw(
                    "GET",
                    malformedTarget,
                    null,
                    hostileRoutingHeaders(),
                    null);
            assertThat(malformed.status()).isEqualTo(400);
            assertSafeResponse(
                    malformed,
                    "connector",
                    "raw-backslash",
                    "anonymous");

            RawResponse ordinaryWarning = raw(
                    "POST",
                    "/api/v1/system/info",
                    null,
                    Map.of(),
                    null);
            assertThat(ordinaryWarning.status()).isEqualTo(405);

        } finally {
            stopCapturing(logs);
        }

        String output = logText(logs);
        assertThat(output)
                .contains("Request method 'POST' is not supported")
                .doesNotContain(
                        QUERY_CANARY,
                        HEADER_CANARY,
                        "/api\\v1\\system\\info",
                        "IllegalArgumentException",
                        "Http11InputBuffer.parseRequestLine");
    }

    private static List<PathVariant> variants(String exact) {
        String[] segments = exact.substring(1).split("/");
        String first = segments[0];
        String rest = String.join(
                "/",
                List.of(segments).subList(1, segments.length));
        String last = segments[segments.length - 1];
        String encodedLast = "%"
                + Integer.toHexString(last.charAt(0))
                + last.substring(1);
        String prefix = exact.substring(
                0,
                exact.length() - last.length());
        return List.of(
                new PathVariant("exact", exact),
                new PathVariant("duplicate-slash", "/" + first + "//" + rest),
                new PathVariant("dot", "/" + first + "/./" + rest),
                new PathVariant(
                        "dot-dot",
                        "/" + first + "/route-gate/../" + rest),
                new PathVariant(
                        "encoded-dot-lower",
                        "/" + first + "/%2e/" + rest),
                new PathVariant(
                        "encoded-dot-mixed",
                        "/" + first + "/%2E/" + rest),
                new PathVariant(
                        "encoded-dot-dot",
                        "/" + first + "/route-gate/%2e%2E/" + rest),
                new PathVariant(
                        "encoded-slash-lower",
                        "/" + first + "%2f" + rest),
                new PathVariant(
                        "encoded-slash-upper",
                        "/" + first + "%2F" + rest),
                new PathVariant(
                        "encoded-backslash",
                        "/" + first + "%5c" + rest),
                new PathVariant(
                        "raw-backslash",
                        "/" + first + "\\" + rest),
                new PathVariant(
                        "matrix-parameter",
                        "/" + first + ";route=gate/" + rest),
                new PathVariant("trailing-dot", exact + "."),
                new PathVariant("trailing-empty-segment", exact + "/"),
                new PathVariant("encoded-unreserved", prefix + encodedLast),
                new PathVariant("invalid-percent", exact + "/%"),
                new PathVariant("invalid-percent-hex", exact + "/%GG"),
                new PathVariant("invalid-utf8-overlong", exact + "/%C0%AF"),
                new PathVariant("invalid-utf8-three-byte", exact + "/%E0%80%AF"),
                new PathVariant("encoded-nul", exact + "/%00"),
                new PathVariant("encoded-control", exact + "/%1f"),
                new PathVariant(
                        "bounded-long-path",
                        exact + "/" + "a".repeat(2_048)));
    }

    private static Map<String, String> hostileRoutingHeaders() {
        return Map.ofEntries(
                Map.entry("X-HTTP-Method-Override", "DELETE"),
                Map.entry("X-Method-Override", "PATCH"),
                Map.entry(
                        "X-Original-URL",
                        "/api/v1/platform-admin/system-admins"),
                Map.entry("X-Rewrite-URL", "/actuator/health"),
                Map.entry(
                        "Forwarded",
                        "for=192.0.2.45;host="
                                + HEADER_CANARY
                                + ";proto=https"),
                Map.entry("X-Forwarded-For", "192.0.2.46"),
                Map.entry("X-Forwarded-Host", HEADER_CANARY),
                Map.entry("X-Forwarded-Proto", "https"),
                Map.entry("X-Forwarded-Prefix", "/internal/http-route-gate"));
    }

    private static String withCanaryQuery(String target) {
        return target
                + "?token="
                + QUERY_CANARY
                + "&password="
                + QUERY_CANARY
                + "&credential="
                + QUERY_CANARY;
    }

    private static void assertSuccessFingerprint(
            DomainCase domain,
            RawResponse response) {
        if (domain.name().equals("actuator")) {
            assertThat(response.body()).contains("\"status\":\"UP\"");
        } else if (domain.name().equals("platform-admin")
                || domain.name().equals("tenant-business")) {
            assertThat(response.body()).contains("\"items\"");
        }
    }

    private static void assertSafeResponse(
            RawResponse response,
            String domain,
            String variant,
            String session) {
        assertThat(response.status())
                .as("%s %s %s must not redirect", domain, variant, session)
                .matches(status -> status < 300 || status >= 400);
        String surface = response.headerText() + "\n" + response.body();
        assertThat(surface)
                .doesNotContain(
                        HEADER_CANARY,
                        QUERY_CANARY,
                        BODY_CANARY,
                        platformToken,
                        enteredTenantToken,
                        tenantToken,
                        PostgresqlApiFixture.SYSTEM_ADMIN_PASSWORD,
                        TENANT_PASSWORD,
                        "jdbc:postgresql:",
                        "org.springframework.",
                        "cn.xzkj.erp.",
                        "backend:8080",
                        "postgres:5432");
        String location = response.firstHeader("location");
        if (location != null) {
            assertThat(location)
                    .startsWith("/api/")
                    .doesNotContain("://", "backend", "actuator", QUERY_CANARY);
        }
    }

    private static boolean isSuccess(int status) {
        return status >= 200 && status < 300;
    }

    private static HttpResponse<String> jsonRequest(
            String method,
            String path,
            String token,
            String body) throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + port + path))
                .timeout(Duration.ofSeconds(5));
        if (token != null) {
            builder.header("Authorization", "Bearer " + token);
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

    private static RawResponse raw(
            String method,
            String target,
            String token,
            Map<String, String> requestHeaders,
            String body) throws Exception {
        try (java.net.Socket socket = new java.net.Socket()) {
            socket.connect(
                    new InetSocketAddress("127.0.0.1", port),
                    3_000);
            socket.setSoTimeout(5_000);

            Map<String, String> headers =
                    new LinkedHashMap<>(requestHeaders);
            if (token != null) {
                headers.put("Authorization", "Bearer " + token);
            }
            byte[] bodyBytes = body == null
                    ? new byte[0]
                    : body.getBytes(StandardCharsets.ISO_8859_1);
            if (bodyBytes.length > 0
                    && !containsHeader(headers, "Content-Length")
                    && !containsHeader(headers, "Transfer-Encoding")) {
                headers.put("Content-Length", Integer.toString(bodyBytes.length));
            }

            ByteArrayOutputStream request = new ByteArrayOutputStream();
            request.write((method
                    + " "
                    + target
                    + " HTTP/1.1\r\n"
                    + "Host: 127.0.0.1\r\n"
                    + "Connection: close\r\n")
                    .getBytes(StandardCharsets.ISO_8859_1));
            for (Map.Entry<String, String> header : headers.entrySet()) {
                assertThat(header.getKey()).doesNotContain("\r", "\n");
                assertThat(header.getValue()).doesNotContain("\r", "\n");
                request.write((header.getKey()
                        + ": "
                        + header.getValue()
                        + "\r\n")
                        .getBytes(StandardCharsets.ISO_8859_1));
            }
            request.write("\r\n".getBytes(StandardCharsets.ISO_8859_1));
            request.write(bodyBytes);
            socket.getOutputStream().write(request.toByteArray());
            socket.getOutputStream().flush();

            byte[] response = socket.getInputStream()
                    .readNBytes(MAX_RESPONSE_BYTES + 1);
            assertThat(response.length)
                    .as("response must remain bounded")
                    .isLessThanOrEqualTo(MAX_RESPONSE_BYTES);
            return parseResponse(new String(
                    response,
                    StandardCharsets.ISO_8859_1));
        }
    }

    private static boolean containsHeader(
            Map<String, String> headers,
            String expected) {
        return headers.keySet().stream()
                .anyMatch(value -> value.equalsIgnoreCase(expected));
    }

    private static RawResponse parseResponse(String raw) {
        int boundary = raw.indexOf("\r\n\r\n");
        assertThat(boundary).isGreaterThan(0);
        String[] lines = raw.substring(0, boundary).split("\r\n");
        assertThat(lines[0]).matches("HTTP/1\\.[01] [0-9]{3}.*");
        int status = Integer.parseInt(lines[0].substring(9, 12));
        Map<String, List<String>> headers = new LinkedHashMap<>();
        for (int index = 1; index < lines.length; index += 1) {
            int separator = lines[index].indexOf(':');
            assertThat(separator).isPositive();
            String name = lines[index]
                    .substring(0, separator)
                    .toLowerCase(Locale.ROOT);
            String value = lines[index].substring(separator + 1).strip();
            headers.computeIfAbsent(name, ignored -> new ArrayList<>())
                    .add(value);
        }
        return new RawResponse(
                status,
                headers,
                raw.substring(boundary + 4));
    }

    private static ListAppender<ILoggingEvent> captureLogs() {
        Logger root = (Logger) LoggerFactory.getLogger(
                org.slf4j.Logger.ROOT_LOGGER_NAME);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        root.addAppender(appender);
        return appender;
    }

    private static void stopCapturing(
            ListAppender<ILoggingEvent> appender) {
        Logger root = (Logger) LoggerFactory.getLogger(
                org.slf4j.Logger.ROOT_LOGGER_NAME);
        root.detachAppender(appender);
        appender.stop();
    }

    private static void assertLogsSafe(
            ListAppender<ILoggingEvent> appender) {
        String logs = logText(appender);
        assertThat(logs).doesNotContain(
                HEADER_CANARY,
                QUERY_CANARY,
                BODY_CANARY,
                platformToken,
                enteredTenantToken,
                tenantToken,
                PostgresqlApiFixture.SYSTEM_ADMIN_PASSWORD,
                TENANT_PASSWORD,
                "jdbc:postgresql:",
                "/api/%GG",
                "/api/%00",
                "%C0%AF",
                "IllegalArgumentException",
                "Http11InputBuffer.parseRequestLine");
    }

    private static String logText(
            ListAppender<ILoggingEvent> appender) {
        return appender.list.stream()
                .map(event -> event.getFormattedMessage()
                        + System.lineSeparator()
                        + ThrowableProxyUtil.asString(
                                event.getThrowableProxy()))
                .collect(java.util.stream.Collectors.joining(
                        System.lineSeparator()));
    }

    private record SessionCase(String name, String token) {
    }

    private record DomainCase(
            String name,
            String path,
            Set<String> allowedSessions) {
    }

    private record PathVariant(String name, String target) {
    }

    private record RawResponse(
            int status,
            Map<String, List<String>> headers,
            String body) {

        String firstHeader(String name) {
            List<String> values = headers.get(
                    name.toLowerCase(Locale.ROOT));
            return values == null || values.isEmpty()
                    ? null
                    : values.getFirst();
        }

        String headerText() {
            return headers.entrySet().stream()
                    .flatMap(entry -> entry.getValue().stream()
                            .map(value -> entry.getKey() + ":" + value))
                    .collect(java.util.stream.Collectors.joining("\n"));
        }
    }
}
