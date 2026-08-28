package ai.xzkj.recruitment.notifications;

import org.springframework.http.*;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.ObjectMapper;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.URI;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;

@Component
public class WebhookNotificationGateway implements NotificationGateway {
    private final NotificationProperties properties;
    private final ObjectMapper json;
    public WebhookNotificationGateway(NotificationProperties properties, ObjectMapper json) { this.properties = properties; this.json = json; }
    @Override public NotificationChannel channel() { return NotificationChannel.WEBHOOK; }

    @Override public NotificationResult notifyInterview(NotificationRequest request) {
        if (!properties.configured()) return new NotificationResult(false, "真实 HR Webhook 未配置");
        if (!properties.trialRecipientAllowed(request.recipientId())) return new NotificationResult(false, "当前 HR 不在 Webhook 试运行白名单");
        URI uri;
        try { uri = URI.create(properties.webhookUrl()); }
        catch (Exception exception) { return new NotificationResult(false, "HR Webhook URL 无效"); }
        if (!"https".equalsIgnoreCase(uri.getScheme()) && !(properties.allowInsecureHttp() && "http".equalsIgnoreCase(uri.getScheme()))) {
            return new NotificationResult(false, "HR Webhook 必须使用 HTTPS");
        }
        try {
            Map<String,Object> payload = new LinkedHashMap<>();
            payload.put("event", "interview.confirmed"); payload.put("notificationId", request.notificationId());
            payload.put("recipientId", request.recipientId()); payload.put("candidateReference", request.candidateReference());
            payload.put("jobTitle", request.jobTitle()); payload.put("startsAt", request.startsAt());
            payload.put("timezone", request.timezone()); payload.put("idempotencyKey", request.idempotencyKey());
            String body = json.writeValueAsString(payload), timestamp = String.valueOf(Instant.now().getEpochSecond());
            var factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(properties.timeout()).build());
            factory.setReadTimeout(properties.timeout());
            ResponseEntity<Void> response = RestClient.builder().requestFactory(factory).build().post().uri(uri)
                    .contentType(MediaType.APPLICATION_JSON).header("X-Recruitment-Timestamp", timestamp)
                    .header("X-Recruitment-Signature", "sha256=" + sign(timestamp + "." + body, properties.webhookSecret()))
                    .header("Idempotency-Key", request.idempotencyKey()).body(body).retrieve().toBodilessEntity();
            return new NotificationResult(response.getStatusCode().is2xxSuccessful(), "HR Webhook HTTP " + response.getStatusCode().value());
        } catch (Exception exception) { return new NotificationResult(false, "HR Webhook 调用失败：" + safe(exception.getMessage())); }
    }

    static String sign(String value, String secret) {
        try { Mac mac = Mac.getInstance("HmacSHA256"); mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256")); return HexFormat.of().formatHex(mac.doFinal(value.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception exception) { throw new IllegalStateException(exception); }
    }
    private String safe(String message) { if (message == null) return "未知错误"; String clean = message.replace('\n',' ').replace('\r',' '); return clean.substring(0, Math.min(300, clean.length())); }
}
