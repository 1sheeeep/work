package ai.xzkj.recruitment.resumes;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;
import java.time.Instant;

@ConfigurationProperties(prefix = "app.resume.analysis-retention")
public class ResumeAnalysisRetentionProperties {
    private boolean enabled = true;
    private int days = 90;
    private int batchSize = 50;

    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public int getDays() { return days; }
    public void setDays(int days) { this.days = bounded(days, 1, 3650, "保留天数必须在 1 至 3650 天之间"); }
    public int getBatchSize() { return batchSize; }
    public void setBatchSize(int batchSize) { this.batchSize = bounded(batchSize, 1, 500, "清理批次必须在 1 至 500 条之间"); }
    public Instant expiresFrom(Instant createdAt) { return createdAt.plus(Duration.ofDays(days)); }

    private int bounded(int value, int min, int max, String message) {
        if (value < min || value > max) throw new IllegalArgumentException(message);
        return value;
    }
}
