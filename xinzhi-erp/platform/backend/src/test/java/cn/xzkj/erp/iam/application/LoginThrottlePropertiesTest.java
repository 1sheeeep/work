package cn.xzkj.erp.iam.application;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

class LoginThrottlePropertiesTest {

    private final ApplicationContextRunner contextRunner =
            new ApplicationContextRunner()
                    .withUserConfiguration(LoginThrottleConfiguration.class);

    @Test
    void bindsDefaultsAndSupportedOverrides() {
        contextRunner.run(context -> {
            assertThat(context).hasNotFailed();
            LoginThrottleProperties properties =
                    context.getBean(LoginThrottleProperties.class);
            assertThat(properties.getMaxFailures()).isEqualTo(5);
            assertThat(properties.getWindow()).isEqualTo(Duration.ofMinutes(15));
            assertThat(properties.getLockDuration())
                    .isEqualTo(Duration.ofMinutes(15));
        });

        contextRunner.withPropertyValues(
                        "erp.security.login-throttle.max-failures=8",
                        "erp.security.login-throttle.window=PT30M",
                        "erp.security.login-throttle.lock-duration=PT1H")
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    LoginThrottleProperties properties =
                            context.getBean(LoginThrottleProperties.class);
                    assertThat(properties.getMaxFailures()).isEqualTo(8);
                    assertThat(properties.getWindow())
                            .isEqualTo(Duration.ofMinutes(30));
                    assertThat(properties.getLockDuration())
                            .isEqualTo(Duration.ofHours(1));
                });
    }

    @Test
    void rejectsUnsafeConfigurationAtStartup() {
        contextRunner.withPropertyValues(
                        "erp.security.login-throttle.max-failures=1")
                .run(context -> assertThat(context).hasFailed());

        contextRunner.withPropertyValues(
                        "erp.security.login-throttle.window=PT30S")
                .run(context -> assertThat(context).hasFailed());

        contextRunner.withPropertyValues(
                        "erp.security.login-throttle.lock-duration=PT25H")
                .run(context -> assertThat(context).hasFailed());
    }
}
