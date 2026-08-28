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
    @Column(nullable = false, columnDefinition = "TEXT") private String description;
    @Column(name = "screening_requirements", columnDefinition = "TEXT") private String screeningRequirements;

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
    }

    public void changeStatus(JobPositionStatus status) { this.status = status; }

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
    public String getDescription() { return description; }
    public String getScreeningRequirements() { return screeningRequirements; }
    public JobPositionStatus getStatus() { return status; }
    public long getVersion() { return version; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}
