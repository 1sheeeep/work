package ai.xzkj.recruitment.notifications;

import org.springframework.stereotype.Component;

@Component
public class MockNotificationGateway implements NotificationGateway {
    @Override public NotificationResult notifyInterview(NotificationRequest request) {
        if ("FAILURE".equals(request.mockOutcome())) return new NotificationResult(false, "Mock HR 通知失败，可重试");
        return new NotificationResult(true, "Mock HR 通知已送达");
    }
}
