package ai.xzkj.recruitment.organization;

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
@Table(name = "companies")
public class Company {
    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "group_id", nullable = false)
    private GroupProfile group;

    @Column(nullable = false, length = 120)
    private String name;

    @Column(nullable = false, length = 32)
    private String code;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private CompanyStatus status;

    @Column(length = 120)
    private String location;

    @Column(length = 500)
    private String notes;

    @Column(name = "knowledge_industry", length = 120)
    private String knowledgeIndustry;

    @Column(name = "knowledge_scale", length = 120)
    private String knowledgeScale;

    @Column(name = "knowledge_summary", columnDefinition = "TEXT")
    private String knowledgeSummary;

    @Column(name = "knowledge_approved", nullable = false)
    private boolean knowledgeApproved;

    @Column(name = "knowledge_version", nullable = false)
    private int knowledgeVersion;

    @Column(name = "knowledge_approved_at")
    private Instant knowledgeApprovedAt;

    @Version
    private long version;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected Company() {
    }

    public Company(GroupProfile group, String name, String code, String location, String notes) {
        this.id = UUID.randomUUID();
        this.group = group;
        this.name = name;
        this.code = code;
        this.status = CompanyStatus.ACTIVE;
        this.location = location;
        this.notes = notes;
        this.createdAt = Instant.now();
        this.updatedAt = this.createdAt;
    }

    public void update(String name, String code, String location, String notes) {
        this.name = name;
        this.code = code;
        this.location = location;
        this.notes = notes;
    }

    public void changeStatus(CompanyStatus status) { this.status = status; }

    public void updateKnowledge(String industry, String scale, String summary, boolean approved) {
        this.knowledgeIndustry = industry;
        this.knowledgeScale = scale;
        this.knowledgeSummary = summary;
        this.knowledgeApproved = approved;
        this.knowledgeApprovedAt = approved ? Instant.now() : null;
        this.knowledgeVersion++;
    }

    @PreUpdate
    void preUpdate() { this.updatedAt = Instant.now(); }

    public UUID getId() { return id; }
    public String getName() { return name; }
    public String getCode() { return code; }
    public CompanyStatus getStatus() { return status; }
    public String getLocation() { return location; }
    public String getNotes() { return notes; }
    public String getKnowledgeIndustry() { return knowledgeIndustry; }
    public String getKnowledgeScale() { return knowledgeScale; }
    public String getKnowledgeSummary() { return knowledgeSummary; }
    public boolean isKnowledgeApproved() { return knowledgeApproved; }
    public int getKnowledgeVersion() { return knowledgeVersion; }
    public Instant getKnowledgeApprovedAt() { return knowledgeApprovedAt; }
    public long getVersion() { return version; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}
