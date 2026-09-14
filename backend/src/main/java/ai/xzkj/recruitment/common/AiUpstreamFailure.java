package ai.xzkj.recruitment.common;

import org.springframework.http.HttpStatus;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 统一表示 OpenAI 兼容服务的 HTTP 失败。
 * 只保留状态码、脱敏后的错误摘要和请求标识，不保存完整响应体或凭据。
 */
public final class AiUpstreamFailure extends ApiException {
    private static final Pattern MESSAGE = Pattern.compile(
            "\\\"message\\\"\\s*:\\s*\\\"((?:\\\\.|[^\\\"\\\\]){0,240})\\\"",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern API_KEY = Pattern.compile("(?i)(?:sk[-_][a-z0-9._-]{6,}|api[-_ ]?key\\s*[:=]\\s*)[a-z0-9._-]{6,}");
    private static final Pattern CONTROL = Pattern.compile("[\\u0000-\\u001f\\u007f]");

    private final int upstreamStatus;
    private final boolean retryable;
    private final String providerRequestId;

    private AiUpstreamFailure(String code, String message, int upstreamStatus,
                              boolean retryable, String providerRequestId) {
        super(HttpStatus.BAD_GATEWAY, code, message);
        this.upstreamStatus = upstreamStatus;
        this.retryable = retryable;
        this.providerRequestId = providerRequestId;
    }

    public int upstreamStatus() {
        return upstreamStatus;
    }

    public boolean isRetryable() {
        return retryable;
    }

    public String providerRequestId() {
        return providerRequestId;
    }

    public static AiUpstreamFailure inbound(String operation, int status, String body, String requestId) {
        String code = switch (status) {
            case 401, 403 -> "INBOUND_REPLY_AI_AUTH_FAILED";
            case 400, 404 -> "INBOUND_REPLY_AI_CONFIG_INVALID";
            case 402 -> "INBOUND_REPLY_AI_BILLING_REQUIRED";
            case 429 -> "INBOUND_REPLY_AI_RATE_LIMITED";
            default -> status >= 500 && status <= 599
                    ? "INBOUND_REPLY_AI_UPSTREAM_5XX"
                    : "INBOUND_REPLY_AI_REQUEST_FAILED";
        };
        return create(code, operation, status, body, requestId);
    }

    public static AiUpstreamFailure openAi(String operation, int status, String body, String requestId) {
        String code = switch (status) {
            case 401, 403 -> "OPENAI_AUTH_FAILED";
            case 400, 404 -> "OPENAI_MODEL_INVALID";
            case 402 -> "OPENAI_BILLING_REQUIRED";
            case 429 -> "OPENAI_LIMIT_REACHED";
            default -> "OPENAI_REQUEST_FAILED";
        };
        return create(code, operation, status, body, requestId);
    }

    private static AiUpstreamFailure create(String code, String operation, int status,
                                            String body, String requestId) {
        String summary = sanitizeSummary(body);
        StringBuilder message = new StringBuilder(operation == null || operation.isBlank()
                ? "AI 服务请求未完成" : operation + "未完成");
        message.append("（上游 HTTP ").append(status);
        if (!summary.isBlank()) message.append("：").append(summary);
        String safeRequestId = safeRequestId(requestId);
        if (!safeRequestId.isBlank()) message.append("；requestId=").append(safeRequestId);
        message.append("）");
        boolean retryable = status == 408 || status == 425 || status == 429 || (status >= 500 && status <= 599);
        return new AiUpstreamFailure(code, bounded(message.toString(), 300), status, retryable, safeRequestId);
    }

    static String sanitizeSummary(String body) {
        if (body == null || body.isBlank()) return "";
        Matcher matcher = MESSAGE.matcher(body);
        if (!matcher.find()) return "";
        String value = matcher.group(1);
        value = value.replace("\\\"", "\"").replace("\\n", " ").replace("\\r", " ").replace("\\t", " ");
        value = CONTROL.matcher(value).replaceAll(" ");
        value = API_KEY.matcher(value).replaceAll("[REDACTED]");
        value = value.replaceAll("\\s+", " ").trim();
        return bounded(value, 160);
    }

    private static String safeRequestId(String value) {
        if (value == null) return "";
        String clean = value.trim();
        if (!clean.matches("[A-Za-z0-9._:-]{1,80}")) return "";
        return clean;
    }

    private static String bounded(String value, int max) {
        if (value == null) return "";
        String clean = value.trim();
        return clean.substring(0, Math.min(max, clean.length()));
    }
}
