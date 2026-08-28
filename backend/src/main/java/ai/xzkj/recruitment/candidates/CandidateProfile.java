package ai.xzkj.recruitment.candidates;

import ai.xzkj.recruitment.organization.Company;
import jakarta.persistence.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "candidate_profiles")
public class CandidateProfile {
    @Id private UUID id;
    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "company_id") private Company company;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 24) private CandidateSource source;
    @JdbcTypeCode(SqlTypes.CHAR) @Column(name = "dedup_key", nullable = false, length = 64, columnDefinition = "CHAR(64)") private String dedupKey;
    @Column(name = "display_name", nullable = false, length = 100) private String displayName;
    @Column(name = "current_title", length = 120) private String currentTitle;
    @Column(name = "years_experience") private Integer yearsExperience;
    @Column(length = 80) private String education;
    @Column(name = "skills_summary", columnDefinition = "TEXT") private String skillsSummary;
    @Enumerated(EnumType.STRING) @Column(name = "privacy_status", nullable = false, length = 20) private CandidatePrivacyStatus privacyStatus;
    @Version private long version;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;

    protected CandidateProfile() {}

    public CandidateProfile(Company company, CandidateSource source, String dedupKey, String displayName,
                            String currentTitle, Integer yearsExperience, String education, String skillsSummary) {
        this.id = UUID.randomUUID(); this.company = company; this.source = source; this.dedupKey = dedupKey;
        this.displayName = displayName; this.currentTitle = currentTitle; this.yearsExperience = yearsExperience;
        this.education = education; this.skillsSummary = skillsSummary; this.privacyStatus = CandidatePrivacyStatus.ACTIVE;
        this.createdAt = Instant.now(); this.updatedAt = this.createdAt;
    }

    public void refresh(String displayName, String currentTitle, Integer yearsExperience, String education, String skillsSummary) {
        if (privacyStatus == CandidatePrivacyStatus.ANONYMIZED) return;
        this.displayName = displayName; this.currentTitle = currentTitle; this.yearsExperience = yearsExperience;
        this.education = education; this.skillsSummary = skillsSummary;
    }

    public void anonymize() {
        this.displayName = "已匿名候选人"; this.currentTitle = null; this.yearsExperience = null;
        this.education = null; this.skillsSummary = null; this.privacyStatus = CandidatePrivacyStatus.ANONYMIZED;
    }

    @PreUpdate void preUpdate() { updatedAt = Instant.now(); }
    public UUID getId() { return id; }
    public Company getCompany() { return company; }
    public CandidateSource getSource() { return source; }
    public String getDedupKey() { return dedupKey; }
    public String getDisplayName() { return displayName; }
    public String getCurrentTitle() { return currentTitle; }
    public Integer getYearsExperience() { return yearsExperience; }
    public String getEducation() { return education; }
    public String getSkillsSummary() { return skillsSummary; }
    public CandidatePrivacyStatus getPrivacyStatus() { return privacyStatus; }
    public long getVersion() { return version; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}
