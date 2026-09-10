package cn.xzkj.erp.iam.bootstrap;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.condition.ConditionalOnNotWebApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(
        prefix = "erp.bootstrap.initial-admin",
        name = "enabled",
        havingValue = "true")
@ConditionalOnNotWebApplication
@EnableConfigurationProperties(InitialAdminBootstrapProperties.class)
public class InitialAdminBootstrapConfiguration {

    @Bean
    InitialAdminBootstrapRunner initialAdminBootstrapRunner(
            InitialAdminBootstrapProperties properties,
            InitialAdminBootstrapService service) {
        return new InitialAdminBootstrapRunner(properties, service);
    }
}
