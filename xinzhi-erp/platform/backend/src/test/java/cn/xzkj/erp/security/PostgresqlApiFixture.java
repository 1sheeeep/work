package cn.xzkj.erp.security;

import cn.xzkj.erp.ErpApplication;
import cn.xzkj.erp.testing.BusinessApplicationTestData;
import jakarta.servlet.Filter;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.core.env.SystemEnvironmentPropertySource;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.web.FilterChainProxy;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.filter.ForwardedHeaderFilter;
import org.springframework.web.context.WebApplicationContext;
import org.testcontainers.containers.PostgreSQLContainer;

final class PostgresqlApiFixture implements AutoCloseable {

    static final UUID SYSTEM_ADMIN_ID =
            UUID.fromString("92000000-0000-0000-0000-000000000001");
    static final String SYSTEM_ADMIN_USERNAME = "error_gate_admin";
    static final String SYSTEM_ADMIN_PASSWORD =
            "error-gate-system-admin-password";

    private PostgreSQLContainer<?> postgres;
    private ConfigurableApplicationContext context;
    private String jdbcUrl;
    private String databaseUsername;
    private String databasePassword;
    private String imageName;
    private MockMvc mockMvc;

    void start() throws Exception {
        start(false, null);
    }

    void startProduction() throws Exception {
        start(true, null);
    }

    void startProductionWithParserLogLevelAttempt(
            String attemptedLevel) throws Exception {
        start(true, attemptedLevel);
    }

    private void start(
            boolean productionProfile,
            String attemptedParserLogLevel) throws Exception {
        String externalUrl = System.getenv("ERP_TEST_DB_URL");
        if (externalUrl != null && !externalUrl.isBlank()) {
            jdbcUrl = externalUrl;
            databaseUsername = requiredEnvironment("ERP_TEST_DB_USER");
            databasePassword = requiredEnvironment("ERP_TEST_DB_PASSWORD");
            imageName = "postgres:16-alpine";
        } else {
            postgres = new PostgreSQLContainer<>("postgres:16-alpine")
                    .withImagePullPolicy(imageName -> false)
                    .withDatabaseName("erp_api_error_gate")
                    .withUsername("erp_test")
                    .withPassword("erp_test");
            postgres.start();
            jdbcUrl = postgres.getJdbcUrl();
            databaseUsername = postgres.getUsername();
            databasePassword = postgres.getPassword();
            imageName = postgres.getDockerImageName();
        }

        Flyway flyway = Flyway.configure()
                .dataSource(jdbcUrl, databaseUsername, databasePassword)
                .locations("classpath:db/migration")
                .cleanDisabled(false)
                .load();
        flyway.clean();
        flyway.migrate();
        seedSystemAdmin();

        StandardEnvironment environment = new StandardEnvironment();
        Map<String, Object> properties = new HashMap<>();
        properties.put("server.port", "0");
        properties.put(
                "erp.security.login-throttle.max-failures",
                "20");
        if (productionProfile) {
            properties.put("ERP_DB_URL", jdbcUrl);
            properties.put("ERP_DB_USER", databaseUsername);
            properties.put("ERP_DB_PASSWORD", databasePassword);
            if (attemptedParserLogLevel != null) {
                environment.getPropertySources().remove(
                        StandardEnvironment
                                .SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME);
                environment.getPropertySources().remove(
                        StandardEnvironment
                                .SYSTEM_PROPERTIES_PROPERTY_SOURCE_NAME);
                environment.getPropertySources().addFirst(
                        new SystemEnvironmentPropertySource(
                                "http-routing-production-environment",
                                Map.of(
                                        "LOGGING_LEVEL_ORG_APACHE_COYOTE_HTTP11_HTTP11PROCESSOR",
                                        attemptedParserLogLevel)));
            }
            environment.setActiveProfiles("production");
        } else {
            properties.put("spring.datasource.url", jdbcUrl);
            properties.put(
                    "spring.datasource.username",
                    databaseUsername);
            properties.put(
                    "spring.datasource.password",
                    databasePassword);
            properties.put("erp.environment", "integration-test");
        }
        environment.getPropertySources().addFirst(new MapPropertySource(
                "api-error-redaction-integration-test",
                Map.copyOf(properties)));
        context = new SpringApplicationBuilder(ErpApplication.class)
                .web(WebApplicationType.SERVLET)
                .environment(environment)
                .run();
        mockMvc = MockMvcBuilders
                .webAppContextSetup((WebApplicationContext) context)
                .addFilters(context.getBean(
                        "springSecurityFilterChain",
                        Filter.class))
                .build();
    }

    MockMvc mockMvc() {
        return mockMvc;
    }

    MockMvc mockMvcWithFrameworkForwardHeaders() {
        return MockMvcBuilders
                .webAppContextSetup((WebApplicationContext) context)
                .addFilters(
                        new ForwardedHeaderFilter(),
                        context.getBean(
                                "springSecurityFilterChain",
                                Filter.class))
                .build();
    }

    int port() {
        return context.getEnvironment().getRequiredProperty(
                "local.server.port",
                Integer.class);
    }

    String property(String name) {
        return context.getEnvironment().getRequiredProperty(name);
    }

    <T> T bean(Class<T> type) {
        return context.getBean(type);
    }

    List<String> securityFilterClassNames() {
        return context.getBean(FilterChainProxy.class)
                .getFilterChains()
                .stream()
                .flatMap(chain -> chain.getFilters().stream())
                .map(filter -> filter.getClass().getName())
                .distinct()
                .sorted()
                .toList();
    }

    String imageName() {
        return imageName;
    }

    boolean isRunning() throws Exception {
        return singleLong("SELECT 1") == 1;
    }

    String jdbcUrl() {
        return jdbcUrl;
    }

    String databaseUsername() {
        return databaseUsername;
    }

    String databasePassword() {
        return databasePassword;
    }

    long singleLong(String sql, Object... parameters) throws Exception {
        try (Connection connection = connection();
                PreparedStatement statement =
                        connection.prepareStatement(sql)) {
            setParameters(statement, parameters);
            try (ResultSet result = statement.executeQuery()) {
                result.next();
                return result.getLong(1);
            }
        }
    }

    String singleString(String sql, Object... parameters) throws Exception {
        try (Connection connection = connection();
                PreparedStatement statement =
                        connection.prepareStatement(sql)) {
            setParameters(statement, parameters);
            try (ResultSet result = statement.executeQuery()) {
                result.next();
                return result.getString(1);
            }
        }
    }

    int executeUpdate(String sql, Object... parameters) throws Exception {
        try (Connection connection = connection();
                PreparedStatement statement =
                        connection.prepareStatement(sql)) {
            setParameters(statement, parameters);
            return statement.executeUpdate();
        }
    }

    void enableErp(UUID tenantId) throws Exception {
        try (Connection connection = connection()) {
            BusinessApplicationTestData.enableErpForTenant(
                    connection,
                    tenantId);
        }
    }

    private void seedSystemAdmin() throws Exception {
        String storedHash = "{bcrypt}"
                + new BCryptPasswordEncoder(12)
                        .encode(SYSTEM_ADMIN_PASSWORD);
        try (Connection connection = connection();
                PreparedStatement statement = connection.prepareStatement("""
                        INSERT INTO system_admins (
                            id, username, display_name, password_hash,
                            status, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, 'ACTIVE', now(), now())
                        """)) {
            statement.setObject(1, SYSTEM_ADMIN_ID);
            statement.setString(2, SYSTEM_ADMIN_USERNAME);
            statement.setString(3, "Error Gate System Admin");
            statement.setString(4, storedHash);
            statement.executeUpdate();
        }
    }

    private Connection connection() throws Exception {
        return DriverManager.getConnection(
                jdbcUrl,
                databaseUsername,
                databasePassword);
    }

    private static void setParameters(
            PreparedStatement statement,
            Object... parameters) throws Exception {
        for (int index = 0; index < parameters.length; index++) {
            statement.setObject(index + 1, parameters[index]);
        }
    }

    private static String requiredEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(name + " is required");
        }
        return value;
    }

    @Override
    public void close() {
        if (context != null) {
            context.close();
        }
        if (postgres != null) {
            postgres.stop();
        }
    }
}
