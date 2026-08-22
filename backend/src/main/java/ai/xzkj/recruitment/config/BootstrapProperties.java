package ai.xzkj.recruitment.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.bootstrap")
public record BootstrapProperties(
        String adminUsername,
        String adminPassword,
        String groupName,
        String groupShortName
) {
}
