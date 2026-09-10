package cn.xzkj.erp.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;

import cn.xzkj.erp.ErpApplication;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import org.flywaydb.core.Flyway;
import org.hibernate.tool.schema.spi.SchemaManagementException;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.core.env.SystemEnvironmentPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

@ExtendWith(OutputCaptureExtension.class)
class ProductionReadinessIntegrationTest {

    private static final String TEST_DATABASE = "production_profile_test";
    private static final String TEST_USER = "production_profile_test";
    private static final String PASSWORD_CANARY =
            "production-profile-pg16-password-canary";
    private static final Duration READINESS_TIMEOUT = Duration.ofSeconds(15);

    @Test
    void productionApplicationRequiresValidatedSchemaAndDatabaseReadiness(
            CapturedOutput output) throws Exception {
        PostgreSQLContainer<?> postgres = startPostgres();
        String jdbcUrl = withShortTimeouts(postgres.getJdbcUrl());

        try {
            Throwable schemaMismatch = catchThrowable(() ->
                    startProductionApplication(
                            jdbcUrl,
                            postgres.getUsername(),
                            postgres.getPassword()));
            assertThat(schemaMismatch).isNotNull();
            assertThat(hasCause(
                    schemaMismatch,
                    SchemaManagementException.class)).isTrue();
            assertSafeFailure(schemaMismatch);

            Flyway.configure()
                    .dataSource(
                            jdbcUrl,
                            postgres.getUsername(),
                            postgres.getPassword())
                    .locations("classpath:db/migration")
                    .load()
                    .migrate();

            try (ConfigurableApplicationContext context =
                    startProductionApplication(
                            jdbcUrl,
                            postgres.getUsername(),
                            postgres.getPassword())) {
                assertProductionSafetyProperties(context);
                assertThat(context.getBeansOfType(Flyway.class)).isEmpty();

                int port = context.getEnvironment().getRequiredProperty(
                        "local.server.port",
                        Integer.class);
                HttpResponse<String> ready = readiness(port);
                assertThat(ready.statusCode()).isEqualTo(200);
                assertHiddenHealthResponse(ready.body(), "UP", jdbcUrl);

                postgres.stop();

                HttpResponse<String> unavailable =
                        awaitUnavailableReadiness(port);
                assertThat(unavailable.statusCode()).isEqualTo(503);
                assertHiddenHealthResponse(
                        unavailable.body(),
                        "DOWN",
                        jdbcUrl);
            }

            Throwable unreachableDatabase = catchThrowable(() ->
                    startProductionApplication(
                            jdbcUrl,
                            TEST_USER,
                            PASSWORD_CANARY));
            assertThat(unreachableDatabase).isNotNull();
            assertThat(causeMessages(unreachableDatabase))
                    .contains(
                            "Unable to determine Dialect without JDBC metadata");
            assertSafeFailure(unreachableDatabase);
        } finally {
            if (postgres.isRunning()) {
                postgres.stop();
            }
        }

        assertThat(output.getAll()).doesNotContain(PASSWORD_CANARY);
    }

    private static PostgreSQLContainer<?> startPostgres() {
        PostgreSQLContainer<?> postgres =
                new PostgreSQLContainer<>("postgres:16-alpine")
                        .withDatabaseName(TEST_DATABASE)
                        .withUsername(TEST_USER)
                        .withPassword(PASSWORD_CANARY);
        try {
            postgres.start();
            return postgres;
        } catch (RuntimeException dockerUnavailable) {
            Assumptions.assumeTrue(
                    false,
                    "Docker is unavailable for the isolated PostgreSQL 16 test");
            throw dockerUnavailable;
        }
    }

    private static ConfigurableApplicationContext startProductionApplication(
            String jdbcUrl,
            String username,
            String password) {
        StandardEnvironment environment = new StandardEnvironment();
        environment.getPropertySources().remove(
                StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME);
        environment.getPropertySources().remove(
                StandardEnvironment.SYSTEM_PROPERTIES_PROPERTY_SOURCE_NAME);
        environment.getPropertySources().addFirst(
                new MapPropertySource(
                        "productionReadinessTestSettings",
                        Map.ofEntries(
                                Map.entry("server.port", "0"),
                                Map.entry(
                                        "spring.datasource.hikari.connection-timeout",
                                        "1000"),
                                Map.entry(
                                        "spring.datasource.hikari.validation-timeout",
                                        "1000"),
                                Map.entry(
                                        "spring.datasource.hikari.initialization-fail-timeout",
                                        "1000"),
                                Map.entry(
                                        "spring.datasource.hikari.maximum-pool-size",
                                        "2"),
                                Map.entry(
                                        "spring.main.banner-mode",
                                        "off"),
                                Map.entry(
                                        "logging.level.root",
                                        "WARN"))));
        environment.getPropertySources().addFirst(
                new SystemEnvironmentPropertySource(
                        "isolatedProductionReadinessEnvironment",
                        Map.ofEntries(
                                Map.entry("ERP_DB_URL", jdbcUrl),
                                Map.entry("ERP_DB_USER", username),
                                Map.entry("ERP_DB_PASSWORD", password),
                                Map.entry(
                                        "ERP_BOOTSTRAP_INITIAL_ADMIN_ENABLED",
                                        "true"),
                                Map.entry(
                                        "ERP_BOOTSTRAP_PLATFORM_ADMIN_ENABLED",
                                        "true"),
                                Map.entry(
                                        "SPRING_FLYWAY_ENABLED",
                                        "true"),
                                Map.entry(
                                        "MANAGEMENT_ENDPOINT_HEALTH_SHOW_DETAILS",
                                        "always"),
                                Map.entry(
                                        "MANAGEMENT_ENDPOINTS_WEB_EXPOSURE_INCLUDE",
                                        "*"),
                                Map.entry(
                                        "SPRING_WEB_ERROR_INCLUDE_PATH",
                                        "always"))));
        environment.setActiveProfiles("production");

        return new SpringApplicationBuilder(ErpApplication.class)
                .environment(environment)
                .logStartupInfo(false)
                .run();
    }

    private static void assertProductionSafetyProperties(
            ConfigurableApplicationContext context) {
        assertThat(context.getEnvironment().getProperty("erp.environment"))
                .isEqualTo("production");
        assertThat(context.getEnvironment().getProperty(
                "erp.bootstrap.initial-admin.enabled"))
                .isEqualTo("false");
        assertThat(context.getEnvironment().getProperty(
                "erp.bootstrap.platform-admin.enabled"))
                .isEqualTo("false");
        assertThat(context.getEnvironment().getProperty(
                "spring.flyway.enabled"))
                .isEqualTo("false");
        assertThat(context.getEnvironment().getProperty(
                "spring.jpa.hibernate.ddl-auto"))
                .isEqualTo("validate");
        assertThat(context.getEnvironment().getProperty(
                "management.endpoint.health.show-details"))
                .isEqualTo("never");
        assertThat(context.getEnvironment().getProperty(
                "management.endpoints.web.exposure.include"))
                .isEqualTo("health,info");
        assertThat(context.getEnvironment().getProperty(
                "management.endpoint.health.group.readiness.include"))
                .isEqualTo("readinessState,db");
        assertThat(context.getEnvironment().getProperty(
                "spring.web.error.include-path"))
                .isEqualTo("never");
    }

    private static HttpResponse<String> awaitUnavailableReadiness(int port)
            throws Exception {
        long deadline = System.nanoTime() + READINESS_TIMEOUT.toNanos();
        HttpResponse<String> response = readiness(port);
        while (response.statusCode() != 503
                && System.nanoTime() < deadline) {
            Thread.sleep(200);
            response = readiness(port);
        }
        return response;
    }

    private static HttpResponse<String> readiness(int port)
            throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(
                        "http://127.0.0.1:"
                                + port
                                + "/actuator/health/readiness"))
                .timeout(Duration.ofSeconds(3))
                .GET()
                .build();
        return HttpClient.newHttpClient().send(
                request,
                HttpResponse.BodyHandlers.ofString());
    }

    private static void assertHiddenHealthResponse(
            String body,
            String status,
            String jdbcUrl) {
        assertThat(body)
                .contains("\"status\":\"" + status + "\"")
                .doesNotContain("components")
                .doesNotContain("details")
                .doesNotContain("db")
                .doesNotContain("jdbc:")
                .doesNotContain(jdbcUrl)
                .doesNotContain(TEST_USER)
                .doesNotContain(PASSWORD_CANARY);
    }

    private static void assertSafeFailure(Throwable failure) {
        assertThat(causeMessages(failure))
                .doesNotContain(PASSWORD_CANARY);
    }

    private static String causeMessages(Throwable failure) {
        StringBuilder messages = new StringBuilder();
        for (Throwable cause = failure;
                cause != null;
                cause = cause.getCause()) {
            messages.append(cause.getClass().getName())
                    .append(':')
                    .append(cause.getMessage())
                    .append('\n');
        }
        return messages.toString();
    }

    private static boolean hasCause(
            Throwable failure,
            Class<? extends Throwable> type) {
        for (Throwable cause = failure;
                cause != null;
                cause = cause.getCause()) {
            if (type.isInstance(cause)) {
                return true;
            }
        }
        return false;
    }

    private static String withShortTimeouts(String jdbcUrl) {
        return jdbcUrl
                + (jdbcUrl.contains("?") ? "&" : "?")
                + "connectTimeout=1&socketTimeout=1";
    }
}
