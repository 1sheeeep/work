package cn.xzkj.erp.iam.audit;

import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class SecurityAuditEventTest {

    @Test
    void rejectsSensitiveOrOversizedDetails() {
        assertThatIllegalArgumentException().isThrownBy(() -> event(Map.of(
                "accessToken", "must-not-be-logged")));
        assertThatIllegalArgumentException().isThrownBy(() -> event(Map.of(
                "email", "person@example.invalid")));
        assertThatIllegalArgumentException().isThrownBy(() -> event(Map.of(
                "changedFields", "x".repeat(161))));
    }

    private static SecurityAuditEvent event(Map<String, String> details) {
        return new SecurityAuditEvent(
                UUID.randomUUID(),
                UUID.randomUUID(),
                "iam.user.updated",
                "user",
                UUID.randomUUID().toString(),
                "request-id",
                "127.0.0.1",
                details);
    }
}
