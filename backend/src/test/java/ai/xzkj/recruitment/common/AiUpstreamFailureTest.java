package ai.xzkj.recruitment.common;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class AiUpstreamFailureTest {
    @Test
    void mapsAuthenticationToNonRetryableInboundFailureAndRedactsCredentials() {
        AiUpstreamFailure failure = AiUpstreamFailure.inbound(
                "消息理解与岗位回复生成", 401,
                "{\"error\":{\"message\":\"Authentication failed sk-test-secret-value\"}}",
                "req-123");

        assertThat(failure.getCode()).isEqualTo("INBOUND_REPLY_AI_AUTH_FAILED");
        assertThat(failure.isRetryable()).isFalse();
        assertThat(failure.getMessage()).contains("HTTP 401", "req-123").doesNotContain("sk-test-secret-value");
    }

    @Test
    void mapsRateLimitToRetryableOpenAiFailure() {
        AiUpstreamFailure failure = AiUpstreamFailure.openAi(
                "AI 岗位匹配请求", 429,
                "{\"error\":{\"message\":\"rate limited\"}}",
                "req-429");

        assertThat(failure.getCode()).isEqualTo("OPENAI_LIMIT_REACHED");
        assertThat(failure.isRetryable()).isTrue();
        assertThat(failure.getMessage()).contains("HTTP 429", "rate limited");
    }
}
