package ai.xzkj.recruitment.notifications;

import ai.xzkj.recruitment.resilience.GatewayResilienceGuard;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;

@Component
@Primary
public class ResilientNotificationGateway implements NotificationGateway {
    private final MockNotificationGateway delegate;
    private final GatewayResilienceGuard guard;
    public ResilientNotificationGateway(MockNotificationGateway delegate, GatewayResilienceGuard guard) { this.delegate = delegate; this.guard = guard; }
    @Override public NotificationResult notifyInterview(NotificationRequest request) {
        return guard.execute("notification.interview", () -> delegate.notifyInterview(request), NotificationResult::succeeded,
                reason -> new NotificationResult(false, "Notification Gateway 保护已触发：" + reason.name() + "，可稍后幂等重试"));
    }
}
