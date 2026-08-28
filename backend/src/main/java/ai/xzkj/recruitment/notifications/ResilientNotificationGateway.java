package ai.xzkj.recruitment.notifications;

import ai.xzkj.recruitment.resilience.GatewayResilienceGuard;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;

@Component
@Primary
public class ResilientNotificationGateway implements NotificationGateway {
    private final MockNotificationGateway mock;
    private final WebhookNotificationGateway webhook;
    private final NotificationProperties properties;
    private final GatewayResilienceGuard guard;
    public ResilientNotificationGateway(MockNotificationGateway mock, WebhookNotificationGateway webhook,
                                        NotificationProperties properties, GatewayResilienceGuard guard) {
        this.mock = mock; this.webhook = webhook; this.properties = properties; this.guard = guard;
    }
    @Override public NotificationChannel channel() { return properties.webhook() ? NotificationChannel.WEBHOOK : NotificationChannel.IN_APP_MOCK; }
    @Override public NotificationResult notifyInterview(NotificationRequest request) {
        NotificationGateway delegate = properties.webhook() ? webhook : mock;
        return guard.execute("notification.interview", () -> delegate.notifyInterview(request), NotificationResult::succeeded,
                reason -> new NotificationResult(false, "Notification Gateway 保护已触发：" + reason.name() + "，可稍后幂等重试"));
    }
}
