package ai.xzkj.recruitment.jobs;

import ai.xzkj.recruitment.boss.BossAccount;
import ai.xzkj.recruitment.organization.Company;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "job_positions")
public class JobPosition {
    @Id private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "company_id", nullable = false)
    private Company company;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "boss_account_id", nullable = false)
    private BossAccount bossAccount;

    @Column(nullable = false, length = 120) private String title;
    @Column(nullable = false, length = 120) private String location;
    @Column(name = "salary_min_k", nullable = false) private int salaryMinK;
    @Column(name = "salary_max_k", nullable = false) private int salaryMaxK;
    @Column(name = "salary_months", nullable = false) private short salaryMonths;
    @Column(name = "experience_requirement", nullable = false, length = 80) private String experienceRequirement;
    @Column(name = "education_requirement", nullable = false, length = 80) private String educationRequirement;
    @Column(name = "recruitment_type", length = 40) private String recruitmentType;
    @Column(name = "job_category", length = 120) private String jobCategory;
    @Column(name = "overseas_requirement", length = 40) private String overseasRequirement;
    @Column(name = "job_keywords", length = 500) private String jobKeywords;
    @Column(name = "work_address", length = 240) private String workAddress;
    @Column(nullable = false, columnDefinition = "TEXT") private String description;
    @Column(name = "screening_requirements", columnDefinition = "TEXT") private String screeningRequirements;
    @Column(name = "reply_summary", columnDefinition = "TEXT") private String replySummary;
    @Column(name = "salary_display", length = 120) private String salaryDisplay;
    @Column(name = "knowledge_approved", nullable = false) private boolean knowledgeApproved;
    @Column(name = "knowledge_version", nullable = false) private int knowledgeVersion;
    @Column(name = "knowledge_approved_at") private Instant knowledgeApprovedAt;
    @Column(name = "capture_source", nullable = false, length = 32) private String captureSource;
    @Column(name = "capture_completeness") private Short captureCompleteness;
    @Column(name = "captured_at") private Instant capturedAt;
    @Column(name = "capture_verified", nullable = false) private boolean captureVerified;
    @Column(name = "capture_verified_at") private Instant captureVerifiedAt;
    @Column(name = "observed_source_key", length = 64) private String observedSourceKey;
    @Column(name = "last_observed_at") private Instant lastObservedAt;
    @Column(name = "observation_count", nullable = false) private int observationCount;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private JobPositionStatus status;

    @Version private long version;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;

    protected JobPosition() {
    }

    public JobPosition(Company company, BossAccount bossAccount, String title, String location,
                       int salaryMinK, int salaryMaxK, int salaryMonths,
                       String experienceRequirement, String educationRequirement,
                       String description, String screeningRequirements) {
        this.id = UUID.randomUUID();
        this.company = company;
        this.bossAccount = bossAccount;
        this.title = title;
        this.location = location;
        this.salaryMinK = salaryMinK;
        this.salaryMaxK = salaryMaxK;
        this.salaryMonths = (short) salaryMonths;
        this.experienceRequirement = experienceRequirement;
        this.educationRequirement = educationRequirement;
        this.description = description;
        this.screeningRequirements = screeningRequirements;
        this.captureSource = "MANUAL";
        this.status = JobPositionStatus.DRAFT;
        this.createdAt = Instant.now();
        this.updatedAt = this.createdAt;
    }

    public void update(Company company, BossAccount bossAccount, String title, String location,
                       int salaryMinK, int salaryMaxK, int salaryMonths,
                       String experienceRequirement, String educationRequirement,
                       String description, String screeningRequirements) {
        this.company = company;
        this.bossAccount = bossAccount;
        this.title = title;
        this.location = location;
        this.salaryMinK = salaryMinK;
        this.salaryMaxK = salaryMaxK;
        this.salaryMonths = (short) salaryMonths;
        this.experienceRequirement = experienceRequirement;
        this.educationRequirement = educationRequirement;
        this.description = description;
        this.screeningRequirements = screeningRequirements;
        if (!"MANUAL".equals(captureSource)) {
            this.captureVerified = false;
            this.captureVerifiedAt = null;
        }
    }

    public void changeStatus(JobPositionStatus status) { this.status = status; }

    public void updateKnowledge(String replySummary, String salaryDisplay, boolean approved) {
        this.replySummary = replySummary;
        this.salaryDisplay = salaryDisplay;
        this.knowledgeApproved = approved;
        this.knowledgeApprovedAt = approved ? Instant.now() : null;
        this.knowledgeVersion++;
    }

    public void markVisiblePageCapture(int completeness) {
        this.captureSource = "VISIBLE_PAGE";
        this.captureCompleteness = (short) completeness;
        this.capturedAt = Instant.now();
        this.captureVerified = false;
        this.captureVerifiedAt = null;
    }

    public boolean applyVisiblePageObservation(String sourceKey, String observedTitle, String observedLocation,
                                               Integer observedSalaryMinK, Integer observedSalaryMaxK,
                                               Integer observedSalaryMonths, String observedExperience,
                                               String observedEducation, String observedDescription,
                                               String observedSalaryDisplay, String observedRecruitmentType,
                                               String observedJobCategory, String observedOverseasRequirement,
                                               String observedJobKeywords, String observedWorkAddress,
                                               int completeness, Instant observedAt) {
        this.lastObservedAt = observedAt;
        this.observationCount++;
        if (this.observedSourceKey == null) this.observedSourceKey = sourceKey;
        if (this.status != JobPositionStatus.DRAFT || this.captureVerified || "MANUAL".equals(this.captureSource)) {
            return false;
        }
        boolean changed = false;
        changed |= assignTitle(observedTitle);
        changed |= assignText("location", observedLocation);
        changed |= assignText("experience", observedExperience);
        changed |= assignText("education", observedEducation);
        changed |= assignText("description", observedDescription);
        changed |= assignDetail("recruitmentType", observedRecruitmentType);
        changed |= assignDetail("jobCategory", observedJobCategory);
        changed |= assignDetail("overseasRequirement", observedOverseasRequirement);
        changed |= assignDetail("jobKeywords", observedJobKeywords);
        changed |= assignDetail("workAddress", observedWorkAddress);
        if (observedSalaryMinK != null && observedSalaryMaxK != null && observedSalaryMaxK >= observedSalaryMinK) {
            if (salaryMinK != observedSalaryMinK || salaryMaxK != observedSalaryMaxK) changed = true;
            salaryMinK = observedSalaryMinK;
            salaryMaxK = observedSalaryMaxK;
        }
        if (observedSalaryMonths != null && observedSalaryMonths >= 12 && observedSalaryMonths <= 16) {
            if (salaryMonths != observedSalaryMonths.shortValue()) changed = true;
            salaryMonths = observedSalaryMonths.shortValue();
        }
        String cleanSalary = cleanObserved(observedSalaryDisplay);
        if (cleanSalary != null && !cleanSalary.equals(salaryDisplay)) { salaryDisplay = cleanSalary; changed = true; }
        if (!"VISIBLE_PAGE".equals(captureSource) || captureCompleteness == null || captureCompleteness != (short) completeness) changed = true;
        captureSource = "VISIBLE_PAGE";
        captureCompleteness = (short) completeness;
        capturedAt = observedAt;
        captureVerified = false;
        captureVerifiedAt = null;
        return changed;
    }

    private boolean assignTitle(String value) {
        String clean = cleanObserved(value);
        if (clean == null || clean.equals(title)) return false;
        title = clean;
        return true;
    }

    private boolean assignText(String field, String value) {
        String clean = cleanObserved(value);
        if (clean == null) return false;
        return switch (field) {
            case "location" -> { boolean changed = !clean.equals(location); location = clean; yield changed; }
            case "experience" -> { boolean changed = !clean.equals(experienceRequirement); experienceRequirement = clean; yield changed; }
            case "education" -> { boolean changed = !clean.equals(educationRequirement); educationRequirement = clean; yield changed; }
            default -> { boolean changed = !clean.equals(description); description = clean; yield changed; }
        };
    }

    private String cleanObserved(String value) { return value == null || value.isBlank() ? null : value.trim(); }

    private boolean assignDetail(String field, String value) {
        String clean = cleanObserved(value);
        if (clean == null) return false;
        return switch (field) {
            case "recruitmentType" -> { boolean changed = !clean.equals(recruitmentType); recruitmentType = clean; yield changed; }
            case "jobCategory" -> { boolean changed = !clean.equals(jobCategory); jobCategory = clean; yield changed; }
            case "overseasRequirement" -> { boolean changed = !clean.equals(overseasRequirement); overseasRequirement = clean; yield changed; }
            case "jobKeywords" -> { boolean changed = !clean.equals(jobKeywords); jobKeywords = clean; yield changed; }
            default -> { boolean changed = !clean.equals(workAddress); workAddress = clean; yield changed; }
        };
    }

    public void markUnreadObservation(String sourceKey, boolean importedDraft) {
        if (importedDraft) {
            this.captureSource = "UNREAD_OBSERVATION";
            this.captureCompleteness = 1;
            this.capturedAt = Instant.now();
            this.captureVerified = false;
            this.captureVerifiedAt = null;
        }
        if (importedDraft && this.observedSourceKey == null) this.observedSourceKey = sourceKey;
        this.lastObservedAt = Instant.now();
        this.observationCount++;
    }

    public void verifyVisiblePageCapture() {
        this.captureVerified = true;
        this.captureVerifiedAt = Instant.now();
    }

    @PreUpdate
    void preUpdate() { this.updatedAt = Instant.now(); }

    public UUID getId() { return id; }
    public Company getCompany() { return company; }
    public BossAccount getBossAccount() { return bossAccount; }
    public String getTitle() { return title; }
    public String getLocation() { return location; }
    public int getSalaryMinK() { return salaryMinK; }
    public int getSalaryMaxK() { return salaryMaxK; }
    public int getSalaryMonths() { return salaryMonths; }
    public String getExperienceRequirement() { return experienceRequirement; }
    public String getEducationRequirement() { return educationRequirement; }
    public String getRecruitmentType() { return recruitmentType; }
    public String getJobCategory() { return jobCategory; }
    public String getOverseasRequirement() { return overseasRequirement; }
    public String getJobKeywords() { return jobKeywords; }
    public String getWorkAddress() { return workAddress; }
    public String getDescription() { return description; }
    public String getScreeningRequirements() { return screeningRequirements; }
    public String getReplySummary() { return replySummary; }
    public String getSalaryDisplay() { return salaryDisplay; }
    public boolean isKnowledgeApproved() { return knowledgeApproved; }
    public int getKnowledgeVersion() { return knowledgeVersion; }
    public Instant getKnowledgeApprovedAt() { return knowledgeApprovedAt; }
    public String getCaptureSource() { return captureSource; }
    public Short getCaptureCompleteness() { return captureCompleteness; }
    public Instant getCapturedAt() { return capturedAt; }
    public boolean isCaptureVerified() { return captureVerified; }
    public Instant getCaptureVerifiedAt() { return captureVerifiedAt; }
    public Instant getLastObservedAt() { return lastObservedAt; }
    public int getObservationCount() { return observationCount; }
    public String getObservedSourceKey() { return observedSourceKey; }
    public JobPositionStatus getStatus() { return status; }
    public long getVersion() { return version; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}
