package cn.xzkj.erp.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import cn.xzkj.erp.ErpApplication;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.core.env.SystemEnvironmentPropertySource;
import org.springframework.mock.env.MockEnvironment;

@ExtendWith(OutputCaptureExtension.class)
class ProductionProfileConfigurationTest {

    private static final String SAFE_JDBC_URL =
            "jdbc:postgresql://database.internal:5432/xz_erp";
    private static final String TEST_USER = "production_profile_test_user";
    private static final String PASSWORD_CANARY =
            "production-profile-password-canary";

    @Test
    void missingRequiredDatabaseSettingsFailStartupWithoutEchoingSecrets(
            CapturedOutput output) {
        assertMissingDatabaseSettingFails("ERP_DB_URL");
        assertMissingDatabaseSettingFails("ERP_DB_USER");
        assertMissingDatabaseSettingFails("ERP_DB_PASSWORD");

        assertThat(output.getAll())
                .doesNotContain(PASSWORD_CANARY)
                .doesNotContain(SAFE_JDBC_URL);
    }

    @Test
    void productionSafetyOverridesCannotBeReopenedByEnvironmentVariables() {
        MockEnvironment environment = new MockEnvironment();
        environment.setActiveProfiles("production");
        environment.getPropertySources().addFirst(
                new SystemEnvironmentPropertySource(
                        "simulatedProductionEnvironment",
                        Map.ofEntries(
                                Map.entry("ERP_DB_URL", SAFE_JDBC_URL),
                                Map.entry("ERP_DB_USER", TEST_USER),
                                Map.entry(
                                        "ERP_DB_PASSWORD",
                                        PASSWORD_CANARY),
                                Map.entry(
                                        "SPRING_DATASOURCE_URL",
                                        "jdbc:postgresql://localhost:5432/bypass"),
                                Map.entry(
                                        "SPRING_DATASOURCE_USERNAME",
                                        "bypass_user"),
                                Map.entry(
                                        "SPRING_DATASOURCE_PASSWORD",
                                        "bypass_password"),
                                Map.entry(
                                        "SPRING_FLYWAY_ENABLED",
                                        "true"),
                                Map.entry(
                                        "SPRING_JPA_HIBERNATE_DDL_AUTO",
                                        "update"),
                                Map.entry(
                                        "ERP_ENVIRONMENT",
                                        "local"),
                                Map.entry(
                                        "ERP_BOOTSTRAP_INITIAL_ADMIN_ENABLED",
                                        "true"),
                                Map.entry(
                                        "ERP_BOOTSTRAP_PLATFORM_ADMIN_ENABLED",
                                        "true"),
                                Map.entry(
                                        "MANAGEMENT_ENDPOINT_HEALTH_SHOW_DETAILS",
                                        "always"),
                                Map.entry(
                                        "MANAGEMENT_ENDPOINTS_WEB_EXPOSURE_INCLUDE",
                                        "*"),
                                Map.entry(
                                        "SPRING_WEB_ERROR_INCLUDE_PATH",
                                        "always"),
                                Map.entry(
                                        "MANAGEMENT_ENDPOINT_HEALTH_GROUP_LIVENESS_INCLUDE",
                                        "livenessState,db"),
                                Map.entry(
                                        "MANAGEMENT_ENDPOINT_HEALTH_GROUP_LIVENESS_EXCLUDE",
                                        "db"),
                                Map.entry(
                                        "LOGGING_LEVEL_ORG_HIBERNATE_ORM_JDBC_ERROR",
                                        "TRACE"),
                                Map.entry(
                                        "LOGGING_LEVEL_ORG_HIBERNATE_ORM_CONNECTIONS_POOLING",
                                        "OFF"),
                                Map.entry(
                                        "LOGGING_LEVEL_ORG_APACHE_COYOTE_HTTP11_HTTP11PROCESSOR",
                                        "INFO"))));

        new ProductionSafetyEnvironmentPostProcessor()
                .postProcessEnvironment(
                        environment,
                        new SpringApplication(ErpApplication.class));

        assertThat(environment.getProperty("spring.datasource.url"))
                .isEqualTo(SAFE_JDBC_URL);
        assertThat(environment.getProperty("spring.datasource.username"))
                .isEqualTo(TEST_USER);
        assertThat(environment.getProperty("spring.datasource.password"))
                .isEqualTo(PASSWORD_CANARY);
        assertThat(environment.getProperty("spring.flyway.enabled"))
                .isEqualTo("false");
        assertThat(environment.getProperty("spring.jpa.hibernate.ddl-auto"))
                .isEqualTo("validate");
        assertThat(environment.getProperty("erp.environment"))
                .isEqualTo("production");
        assertThat(environment.getProperty(
                "erp.bootstrap.initial-admin.enabled"))
                .isEqualTo("false");
        assertThat(environment.getProperty(
                "erp.bootstrap.platform-admin.enabled"))
                .isEqualTo("false");
        assertThat(environment.getProperty(
                "management.endpoint.health.show-details"))
                .isEqualTo("never");
        assertThat(environment.getProperty(
                "management.endpoints.web.exposure.include"))
                .isEqualTo("health,info");
        assertThat(environment.getProperty(
                "management.endpoint.health.group.readiness.include"))
                .isEqualTo("readinessState,db");
        assertThat(environment.getProperty(
                "management.endpoint.health.group.liveness.include"))
                .isEqualTo("livenessState");
        assertThat(environment.getProperty(
                "management.endpoint.health.group.liveness.exclude"))
                .isEmpty();
        assertThat(environment.getProperty(
                "spring.web.error.include-path"))
                .isEqualTo("never");
        assertThat(environment.getProperty(
                "logging.level.org.hibernate.orm.jdbc.error"))
                .isEqualTo("ERROR");
        assertThat(environment.getProperty(
                "logging.level.org.hibernate.orm.connections.pooling"))
                .isEqualTo("WARN");
        assertThat(environment.getProperty(
                "logging.level.org.apache.coyote.http11.Http11Processor"))
                .isEqualTo("WARN");
    }

    @Test
    void nonProductionProfilesAreNotModified() {
        MockEnvironment environment = new MockEnvironment()
                .withProperty(
                        "erp.bootstrap.initial-admin.enabled",
                        "true");
        environment.setActiveProfiles("local");

        new ProductionSafetyEnvironmentPostProcessor()
                .postProcessEnvironment(
                        environment,
                        new SpringApplication(ErpApplication.class));

        assertThat(environment.getPropertySources().contains(
                ProductionSafetyEnvironmentPostProcessor.PROPERTY_SOURCE_NAME))
                .isFalse();
        assertThat(environment.getProperty(
                "erp.bootstrap.initial-admin.enabled"))
                .isEqualTo("true");
    }

    private static void assertMissingDatabaseSettingFails(
            String missingProperty) {
        Map<String, Object> properties = new HashMap<>(Map.of(
                "ERP_DB_URL", SAFE_JDBC_URL,
                "ERP_DB_USER", TEST_USER,
                "ERP_DB_PASSWORD", PASSWORD_CANARY,
                "spring.main.banner-mode", "off",
                "logging.level.root", "OFF"));
        properties.remove(missingProperty);

        assertThatThrownBy(() -> startProduction(properties))
                .isInstanceOf(ProductionProfileConfigurationException.class)
                .hasMessage("Production profile configuration failed safely")
                .hasMessageNotContaining(PASSWORD_CANARY)
                .hasMessageNotContaining(SAFE_JDBC_URL);
    }

    private static ConfigurableApplicationContext startProduction(
            Map<String, Object> properties) {
        StandardEnvironment environment = new StandardEnvironment();
        environment.getPropertySources().remove(
                StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME);
        environment.getPropertySources().remove(
                StandardEnvironment.SYSTEM_PROPERTIES_PROPERTY_SOURCE_NAME);
        environment.getPropertySources().addFirst(
                new MapPropertySource(
                        "isolatedProductionProfileTest",
                        properties));
        environment.setActiveProfiles("production");

        return new SpringApplicationBuilder(ErpApplication.class)
                .environment(environment)
                .web(WebApplicationType.NONE)
                .logStartupInfo(false)
                .run();
    }
}
