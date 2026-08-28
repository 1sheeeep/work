package ai.xzkj.recruitment.auth;

import ai.xzkj.recruitment.common.ApiException;
import ai.xzkj.recruitment.config.SecurityProperties;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.*;

class LoginAttemptServiceTest {
    @Test void blocksAfterConfiguredFailuresWithoutExposingUsername() {
        var service = new LoginAttemptService(new SecurityProperties(2, Duration.ofMinutes(15), Duration.ofMinutes(10)),
                Clock.fixed(Instant.parse("2026-08-28T08:00:00Z"), ZoneOffset.UTC));
        service.recordFailure("127.0.0.1", "SensitiveUser");
        service.recordFailure("127.0.0.1", "SensitiveUser");
        assertThatThrownBy(() -> service.checkAllowed("127.0.0.1", "SensitiveUser"))
                .isInstanceOf(ApiException.class).hasMessage("登录尝试过多，请稍后再试");
        assertThat(service.anonymousReference("SensitiveUser")).doesNotContain("SensitiveUser").startsWith("login:");
    }

    @Test void successfulLoginClearsFailureCounter() {
        var service = new LoginAttemptService(new SecurityProperties(1, Duration.ofMinutes(15), Duration.ofMinutes(10)),
                Clock.fixed(Instant.parse("2026-08-28T08:00:00Z"), ZoneOffset.UTC));
        service.recordFailure("127.0.0.1", "user"); service.recordSuccess("127.0.0.1", "user");
        assertThatCode(() -> service.checkAllowed("127.0.0.1", "user")).doesNotThrowAnyException();
    }
}
