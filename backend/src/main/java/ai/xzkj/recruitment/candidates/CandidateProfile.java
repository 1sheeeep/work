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
    /** 企业范围内用于跨来源合并的不可逆身份摘要，不保存手机号/邮箱原文。 */
    @JdbcTypeCode(SqlTypes.CHAR) @Column(name = "identity_phone_digest", length = 64, columnDefinition = "CHAR(64)") private String identityPhoneDigest;
    @JdbcTypeCode(SqlTypes.CHAR) @Column(name = "identity_email_digest", length = 64, columnDefinition = "CHAR(64)") private String identityEmailDigest;
    @Column(name = "merged_into_id") private UUID mergedIntoId;
    @Column(name = "merged_at") private Instant mergedAt;
    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "merged_by") private ai.xzkj.recruitment.auth.SystemUser mergedBy;
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
        // Timeline observations often only know the BOSS conversation digest. Do not
        // let that fallback overwrite a real name already verified from a resume.
        if (displayName != null && !displayName.isBlank()
                && (!isAnonymousPlaceholder(displayName) || isAnonymousPlaceholder(this.displayName))) {
            this.displayName = displayName;
        }
        this.currentTitle = currentTitle; this.yearsExperience = yearsExperience;
        this.education = education; this.skillsSummary = skillsSummary;
    }

    private boolean isAnonymousPlaceholder(String value) {
        if (value == null || value.isBlank()) return true;
        String normalized = value.trim().toLowerCase(java.util.Locale.ROOT);
        return normalized.startsWith("匿名候选人") || normalized.startsWith("已匿名候选人")
                || normalized.equals("匿名") || normalized.equals("unknown");
    }

    /** Updates only the display name when a trusted resume extractor identifies it. */
    public void updateRecognizedName(String recognizedName) {
        if (privacyStatus == CandidatePrivacyStatus.ANONYMIZED || recognizedName == null || recognizedName.isBlank()) return;
        this.displayName = recognizedName.trim();
    }

    public void updateIdentity(String phoneDigest, String emailDigest) {
        if (privacyStatus == CandidatePrivacyStatus.ANONYMIZED) return;
        if (phoneDigest != null && !phoneDigest.isBlank()) this.identityPhoneDigest = phoneDigest;
        if (emailDigest != null && !emailDigest.isBlank()) this.identityEmailDigest = emailDigest;
    }

    public void markMerged(UUID primaryCandidateId, ai.xzkj.recruitment.auth.SystemUser user, Instant now) {
        if (primaryCandidateId == null || primaryCandidateId.equals(id)) throw new IllegalArgumentException("候选人不能合并到自身");
        this.mergedIntoId = primaryCandidateId;
        this.mergedBy = user;
        this.mergedAt = now == null ? Instant.now() : now;
    }

    public void undoMerge() {
        this.mergedIntoId = null;
        this.mergedBy = null;
        this.mergedAt = null;
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
    public String getIdentityPhoneDigest() { return identityPhoneDigest; }
    public String getIdentityEmailDigest() { return identityEmailDigest; }
    public UUID getMergedIntoId() { return mergedIntoId; }
    public Instant getMergedAt() { return mergedAt; }
    public ai.xzkj.recruitment.auth.SystemUser getMergedBy() { return mergedBy; }
    public boolean isMerged() { return mergedIntoId != null; }
    public CandidatePrivacyStatus getPrivacyStatus() { return privacyStatus; }
    public long getVersion() { return version; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}
