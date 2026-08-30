package ai.xzkj.recruitment.resumes;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.net.URI;
import java.time.Duration;

@ConfigurationProperties(prefix = "app.openai")
public class OpenAiProperties {
    private boolean enabled;
    private String apiKey = "";
    private String model = "";
    private String baseUrl = "https://api.openai.com/v1";
    private Duration timeout = Duration.ofSeconds(60);

    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public String getApiKey() { return apiKey; }
    public void setApiKey(String apiKey) { this.apiKey = apiKey == null ? "" : apiKey.trim(); }
    public String getModel() { return model; }
    public void setModel(String model) { this.model = model == null ? "" : model.trim(); }
    public String getBaseUrl() { return baseUrl; }
    public void setBaseUrl(String baseUrl) { this.baseUrl = baseUrl == null ? "" : baseUrl.trim(); }
    public Duration getTimeout() { return timeout; }
    public void setTimeout(Duration timeout) { this.timeout = timeout == null ? Duration.ofSeconds(60) : timeout; }

    public boolean isConfigured() {
        return enabled && !apiKey.isBlank() && !model.isBlank() && isOfficialEndpoint();
    }

    public boolean isOfficialEndpoint() {
        try {
            URI uri = URI.create(baseUrl);
            String host = uri.getHost();
            return "https".equalsIgnoreCase(uri.getScheme()) && host != null
                    && ("api.openai.com".equalsIgnoreCase(host) || host.toLowerCase().endsWith(".api.openai.com"));
        } catch (Exception exception) {
            return false;
        }
    }
}
