package ai.xzkj.recruitment.resumes;

import ai.xzkj.recruitment.jobs.JobPosition;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class OpenAiResumeClientTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void acceptsOnlyAllowedHttpsAiServiceHosts() {
        OpenAiProperties properties = new OpenAiProperties();

        properties.setBaseUrl("https://api.openai.com/v1");
        assertThat(properties.isOfficialEndpoint()).isTrue();
        properties.setBaseUrl("https://dashscope.aliyuncs.com/compatible-mode/v1");
        assertThat(properties.isOfficialEndpoint()).isTrue();
        properties.setBaseUrl("https://ws-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1");
        assertThat(properties.isOfficialEndpoint()).isTrue();
        properties.setBaseUrl("http://ws-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1");
        assertThat(properties.isOfficialEndpoint()).isFalse();
        properties.setBaseUrl("https://maas.aliyuncs.com.example.org/compatible-mode/v1");
        assertThat(properties.isOfficialEndpoint()).isFalse();
    }

    @Test
    void buildsChatCompletionsStructuredOutputPayloadWithoutResponsesFields() {
        OpenAiProperties properties = new OpenAiProperties();
        properties.setModel("qwen3.8-flash");
        OpenAiResumeClient client = new OpenAiResumeClient(properties, mapper);

        JsonNode payload = client.createPayload(mock(JobPosition.class), "已核对的简历文本", "anonymous-id");

        assertThat(payload.path("model").stringValue()).isEqualTo("qwen3.8-flash");
        assertThat(payload.path("messages").isArray()).isTrue();
        assertThat(payload.path("messages").size()).isEqualTo(2);
        assertThat(payload.path("messages").path(0).path("role").stringValue()).isEqualTo("system");
        assertThat(payload.path("messages").path(1).path("role").stringValue()).isEqualTo("user");
        assertThat(payload.path("response_format").path("type").stringValue()).isEqualTo("json_schema");
        assertThat(payload.path("response_format").path("json_schema").path("strict").asBoolean()).isTrue();
        JsonNode schema = payload.path("response_format").path("json_schema").path("schema");
        assertThat(schema.path("properties").path("evidence").path("minItems").asInt()).isEqualTo(1);
        assertThat(schema.path("properties").path("evidence").path("maxItems").asInt()).isEqualTo(8);
        assertThat(schema.path("properties").path("followUpQuestions").path("minItems").asInt()).isEqualTo(3);
        assertThat(schema.path("properties").path("followUpQuestions").path("maxItems").asInt()).isEqualTo(5);
        assertThat(payload.has("input")).isFalse();
        assertThat(payload.has("instructions")).isFalse();
        assertThat(payload.has("text")).isFalse();
        assertThat(payload.has("store")).isFalse();
        assertThat(payload.has("safety_identifier")).isFalse();
    }
}
