package cn.xzkj.erp.platformadmin.bootstrap;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnNotWebApplication;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(
        prefix = "erp.bootstrap.platform-admin",
        name = "enabled",
        havingValue = "true")
@ConditionalOnNotWebApplication
@EnableConfigurationProperties(PlatformAdminBootstrapProperties.class)
public class PlatformAdminBootstrapConfiguration {

    @Bean
    ApplicationRunner platformAdminBootstrapRunner(
            PlatformAdminBootstrapProperties properties,
            PlatformAdminBootstrapService service) {
        return new ApplicationRunner() {
            @Override
            public void run(ApplicationArguments arguments) {
                service.provision(properties.toCommand());
            }
        };
    }
}
