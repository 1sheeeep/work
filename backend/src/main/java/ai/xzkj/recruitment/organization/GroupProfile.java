package ai.xzkj.recruitment.organization;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "group_profiles")
public class GroupProfile {
    @Id
    private UUID id;

    @Column(nullable = false, length = 120)
    private String name;

    @Column(name = "short_name", nullable = false, length = 60)
    private String shortName;

    @Column(nullable = false, length = 60)
    private String timezone;

    @Column(length = 500)
    private String description;

    @Version
    private long version;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected GroupProfile() {
    }

    public GroupProfile(String name, String shortName) {
        this.id = UUID.randomUUID();
        this.name = name;
        this.shortName = shortName;
        this.timezone = "Asia/Shanghai";
        this.createdAt = Instant.now();
        this.updatedAt = this.createdAt;
    }

    public void update(String name, String shortName, String timezone, String description) {
        this.name = name;
        this.shortName = shortName;
        this.timezone = timezone;
        this.description = description;
    }

    @PreUpdate
    void preUpdate() { this.updatedAt = Instant.now(); }

    public UUID getId() { return id; }
    public String getName() { return name; }
    public String getShortName() { return shortName; }
    public String getTimezone() { return timezone; }
    public String getDescription() { return description; }
    public long getVersion() { return version; }
    public Instant getUpdatedAt() { return updatedAt; }
}
