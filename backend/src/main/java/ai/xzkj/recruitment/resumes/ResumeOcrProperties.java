package ai.xzkj.recruitment.resumes;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

@ConfigurationProperties(prefix = "app.resume.ocr")
public class ResumeOcrProperties {
    private boolean enabled;
    private String host = "resume-ocr";
    private int port = 8090;
    private Duration connectTimeout = Duration.ofSeconds(3);
    private Duration timeout = Duration.ofSeconds(30);

    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public String getHost() { return host; }
    public void setHost(String host) { this.host = host == null ? "" : host.trim(); }
    public int getPort() { return port; }
    public void setPort(int port) { this.port = port; }
    public Duration getConnectTimeout() { return connectTimeout; }
    public void setConnectTimeout(Duration connectTimeout) { this.connectTimeout = connectTimeout == null ? Duration.ofSeconds(3) : connectTimeout; }
    public Duration getTimeout() { return timeout; }
    public void setTimeout(Duration timeout) { this.timeout = timeout == null ? Duration.ofSeconds(30) : timeout; }
}
