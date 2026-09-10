package cn.xzkj.erp.config;

import java.util.Map;
import org.springframework.boot.EnvironmentPostProcessor;
import org.springframework.boot.SpringApplication;
import org.springframework.core.Ordered;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.Profiles;

public final class ProductionSafetyEnvironmentPostProcessor
        implements EnvironmentPostProcessor, Ordered {

    static final String PROPERTY_SOURCE_NAME = "productionSafetyOverrides";

    private static final Map<String, Object> SAFETY_OVERRIDES = Map.ofEntries(
            Map.entry("spring.datasource.url", "${ERP_DB_URL}"),
            Map.entry("spring.datasource.username", "${ERP_DB_USER}"),
            Map.entry("spring.datasource.password", "${ERP_DB_PASSWORD}"),
            Map.entry("spring.flyway.enabled", "false"),
            Map.entry("spring.jpa.hibernate.ddl-auto", "validate"),
            Map.entry("management.endpoint.health.show-details", "never"),
            Map.entry("management.endpoint.health.show-components", "never"),
            Map.entry(
                    "management.endpoint.health.group.liveness.show-details",
                    "never"),
            Map.entry(
                    "management.endpoint.health.group.liveness.show-components",
                    "never"),
            Map.entry(
                    "management.endpoint.health.group.liveness.include",
                    "livenessState"),
            Map.entry(
                    "management.endpoint.health.group.liveness.exclude",
                    ""),
            Map.entry(
                    "management.endpoint.health.group.readiness.include",
                    "readinessState,db"),
            Map.entry(
                    "management.endpoint.health.group.readiness.exclude",
                    ""),
            Map.entry(
                    "management.endpoint.health.group.readiness.show-details",
                    "never"),
            Map.entry(
                    "management.endpoint.health.group.readiness.show-components",
                    "never"),
            Map.entry(
                    "management.endpoints.web.exposure.include",
                    "health,info"),
            Map.entry("spring.web.error.include-path", "never"),
            Map.entry(
                    "logging.level.org.hibernate.orm.jdbc.error",
                    "ERROR"),
            Map.entry(
                    "logging.level.org.apache.coyote.http11.Http11Processor",
                    "WARN"),
            Map.entry(
                    "logging.level.org.hibernate.orm.connections.pooling",
                    "WARN"),
            Map.entry("erp.environment", "production"),
            Map.entry("erp.bootstrap.initial-admin.enabled", "false"),
            Map.entry("erp.bootstrap.platform-admin.enabled", "false"));

    @Override
    public void postProcessEnvironment(
            ConfigurableEnvironment environment,
            SpringApplication application) {
        if (!environment.acceptsProfiles(Profiles.of("production"))) {
            return;
        }

        requireNonBlank(environment, "ERP_DB_URL");
        requireNonBlank(environment, "ERP_DB_USER");
        requireNonBlank(environment, "ERP_DB_PASSWORD");

        environment.getPropertySources().addFirst(
                new MapPropertySource(
                        PROPERTY_SOURCE_NAME,
                        SAFETY_OVERRIDES));
    }

    @Override
    public int getOrder() {
        return Ordered.LOWEST_PRECEDENCE - 100;
    }

    private static void requireNonBlank(
            ConfigurableEnvironment environment,
            String propertyName) {
        String value = environment.getProperty(propertyName);
        if (value == null || value.isBlank()) {
            throw new ProductionProfileConfigurationException();
        }
    }
}
