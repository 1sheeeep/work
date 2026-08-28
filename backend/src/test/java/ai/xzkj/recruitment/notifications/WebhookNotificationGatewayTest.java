package ai.xzkj.recruitment.notifications;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import java.time.*;
import java.util.UUID;
import static org.assertj.core.api.Assertions.*;

class WebhookNotificationGatewayTest {
    @Test void rejectsPlainHttpUnlessExplicitlyAllowed() {
        var properties = new NotificationProperties("WEBHOOK", "http://127.0.0.1/hook", "secret", Duration.ofSeconds(1), false, true, "*");
        var gateway = new WebhookNotificationGateway(properties, JsonMapper.builder().build());
        var result = gateway.notifyInterview(new NotificationGateway.NotificationRequest(UUID.randomUUID(), UUID.randomUUID(), "key", "IMPORT · abcdef12", "Java", Instant.now(), "Asia/Shanghai", "SUCCESS"));
        assertThat(result.succeeded()).isFalse(); assertThat(result.message()).contains("HTTPS");
    }
    @Test void hmacSignatureIsDeterministic() {
        assertThat(WebhookNotificationGateway.sign("123.payload", "secret")).isEqualTo(WebhookNotificationGateway.sign("123.payload", "secret")).hasSize(64);
        assertThat(WebhookNotificationGateway.sign("123.payload", "secret")).isNotEqualTo(WebhookNotificationGateway.sign("124.payload", "secret"));
    }
}
