package cn.xzkj.erp.iam.bootstrap;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.EnvironmentPostProcessor;
import org.springframework.core.env.ConfigurableEnvironment;

public class InitialAdminBootstrapEnvironmentPostProcessor
        implements EnvironmentPostProcessor {

    @Override
    public void postProcessEnvironment(
            ConfigurableEnvironment environment,
            SpringApplication application) {
        boolean enabled = environment.getProperty(
                "erp.bootstrap.initial-admin.enabled",
                Boolean.class,
                false);
        boolean platformAdminEnabled = environment.getProperty(
                "erp.bootstrap.platform-admin.enabled",
                Boolean.class,
                false);
        String webApplicationType =
                environment.getProperty("spring.main.web-application-type");
        if ((enabled || platformAdminEnabled)
                && !"none".equalsIgnoreCase(webApplicationType)) {
            throw new InitialAdminBootstrapException();
        }
    }
}
