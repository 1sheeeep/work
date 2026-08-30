package ai.xzkj.recruitment.resumes;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.common.ApiException;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;

@Service
public class OpenAiConfigurationService {
    private final OpenAiProperties properties;
    private final ResumeAnalysisRetentionProperties retention;
    private final OpenAiResumeClient client;
    private final AuditService audit;

    public OpenAiConfigurationService(OpenAiProperties properties, ResumeAnalysisRetentionProperties retention,
                                      OpenAiResumeClient client, AuditService audit) {
        this.properties = properties;
        this.retention = retention;
        this.client = client;
        this.audit = audit;
    }

    public OpenAiConfigurationStatusResponse status() {
        List<String> missing = new ArrayList<>();
        if (!properties.isEnabled()) missing.add("APP_OPENAI_ENABLED");
        if (properties.getApiKey().isBlank()) missing.add("OPENAI_API_KEY");
        if (properties.getModel().isBlank()) missing.add("OPENAI_MODEL");
        if (!properties.isOfficialEndpoint()) missing.add("OPENAI_BASE_URL（必须为 OpenAI 官方 HTTPS 地址）");
        boolean ready = missing.isEmpty();
        return new OpenAiConfigurationStatusResponse(
                properties.isEnabled(), !properties.getApiKey().isBlank(), !properties.getModel().isBlank(),
                properties.isOfficialEndpoint(), ready,
                properties.getModel().isBlank() ? "未配置" : properties.getModel(), endpointHost(),
                properties.getTimeout().toSeconds(), retention.getDays(), true,
                ready ? "READY_FOR_TEST" : "CONFIGURATION_REQUIRED", List.copyOf(missing)
        );
    }

    public OpenAiConnectionTestResponse testConnection() {
        try {
            OpenAiResumeClient.ConnectionCheck result = client.testConnection();
            audit.success("TEST_OPENAI_CONNECTION", "AI_CONFIGURATION", null, "OpenAI",
                    "OpenAI 服务端连通测试成功；模型 " + result.model() + "；请求 ID " + result.requestId()
                            + "；未发送候选人或简历数据");
            return new OpenAiConnectionTestResponse(true, result.model(), result.requestId(),
                    result.elapsedMilliseconds(), result.checkedAt(), "OpenAI 已连接，Structured Outputs 测试通过");
        } catch (ApiException exception) {
            audit.failure("TEST_OPENAI_CONNECTION", "AI_CONFIGURATION", null, "OpenAI",
                    "OpenAI 服务端连通测试失败；原因代码 " + exception.getCode() + "；未发送候选人或简历数据");
            throw exception;
        }
    }

    private String endpointHost() {
        try { return URI.create(properties.getBaseUrl()).getHost(); }
        catch (Exception exception) { return "无效地址"; }
    }
}
