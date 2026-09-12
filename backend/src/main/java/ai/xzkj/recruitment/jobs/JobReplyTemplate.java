package ai.xzkj.recruitment.jobs;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import jakarta.persistence.Version;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "job_reply_templates", uniqueConstraints = @UniqueConstraint(
        name = "uq_job_reply_templates_job_intent", columnNames = {"job_position_id", "intent"}))
public class JobReplyTemplate {
    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "job_position_id", nullable = false)
    private JobPosition jobPosition;

    @Column(nullable = false, length = 48)
    private String intent;

    @Column(name = "template_text", nullable = false, length = 1000)
    private String templateText;

    @Column(name = "required_fact_keys", nullable = false, length = 500)
    private String requiredFactKeys;

    @Column(nullable = false)
    private boolean enabled;

    @Version
    private long version;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected JobReplyTemplate() {
    }

    JobReplyTemplate(JobPosition jobPosition, String intent, String templateText,
                     String requiredFactKeys, Instant now) {
        this.id = UUID.randomUUID();
        this.jobPosition = jobPosition;
        this.intent = intent;
        this.templateText = templateText;
        this.requiredFactKeys = requiredFactKeys;
        this.enabled = true;
        this.createdAt = now;
        this.updatedAt = now;
    }

    void refresh(String templateText, String requiredFactKeys, Instant now) {
        this.templateText = templateText;
        this.requiredFactKeys = requiredFactKeys;
        this.enabled = true;
        this.updatedAt = now;
    }

    String getIntent() {
        return intent;
    }

    String getTemplateText() {
        return templateText;
    }

    String getRequiredFactKeys() {
        return requiredFactKeys;
    }

    boolean isEnabled() {
        return enabled;
    }
}
