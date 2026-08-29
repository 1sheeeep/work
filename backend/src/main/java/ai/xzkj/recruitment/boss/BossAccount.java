package ai.xzkj.recruitment.boss;

import ai.xzkj.recruitment.organization.Company;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
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
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;

@Entity
@Table(name = "boss_accounts")
public class BossAccount {
    @Id private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "company_id", nullable = false)
    private Company company;

    @Column(name = "display_name", nullable = false, length = 100)
    private String displayName;

    @Column(name = "external_identifier", nullable = false, length = 120)
    private String externalIdentifier;

    @Enumerated(EnumType.STRING)
    @Column(name = "gateway_type", nullable = false, length = 24)
    private BossGatewayType gatewayType;

    @Enumerated(EnumType.STRING)
    @Column(name = "mock_profile", length = 20)
    private MockBossProfile mockProfile;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private BossAccountStatus status;

    @Enumerated(EnumType.STRING)
    @Column(name = "connection_status", nullable = false, length = 20)
    private BossConnectionStatus connectionStatus;

    @ElementCollection(fetch = FetchType.LAZY)
    @CollectionTable(name = "boss_account_capabilities", joinColumns = @JoinColumn(name = "account_id"))
    @Enumerated(EnumType.STRING)
    @Column(name = "capability", nullable = false, length = 32)
    private Set<BossCapability> capabilities = new LinkedHashSet<>();

    @Column(name = "last_checked_at") private Instant lastCheckedAt;
    @Version private long version;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;

    protected BossAccount() {
    }

    public BossAccount(Company company, String displayName, String externalIdentifier, MockBossProfile mockProfile) {
        this(company,displayName,externalIdentifier,BossGatewayType.MOCK,mockProfile);
    }

    public BossAccount(Company company,String displayName,String externalIdentifier,BossGatewayType gatewayType,MockBossProfile mockProfile) {
        this.id = UUID.randomUUID();
        this.company = company;
        this.displayName = displayName;
        this.externalIdentifier = externalIdentifier;
        this.gatewayType = gatewayType;
        this.mockProfile = gatewayType==BossGatewayType.MOCK?mockProfile:null;
        this.status = BossAccountStatus.ACTIVE;
        this.connectionStatus = BossConnectionStatus.UNVERIFIED;
        this.createdAt = Instant.now();
        this.updatedAt = this.createdAt;
    }

    public void update(Company company, String displayName, String externalIdentifier, BossGatewayType gatewayType,MockBossProfile mockProfile) {
        this.company = company;
        this.displayName = displayName;
        this.externalIdentifier = externalIdentifier;
        MockBossProfile normalized=gatewayType==BossGatewayType.MOCK?mockProfile:null;
        if(this.gatewayType!=gatewayType||this.mockProfile!=normalized){
            this.gatewayType=gatewayType;
            this.mockProfile=normalized;
            this.connectionStatus = BossConnectionStatus.UNVERIFIED;
            this.capabilities.clear();
            this.lastCheckedAt = null;
        }
    }

    public void changeStatus(BossAccountStatus status) { this.status = status; }

    public void applyCapabilityCheck(BossConnectionStatus connectionStatus, Set<BossCapability> capabilities) {
        this.connectionStatus = connectionStatus;
        this.capabilities.clear();
        this.capabilities.addAll(capabilities);
        this.lastCheckedAt = Instant.now();
    }

    @PreUpdate
    void preUpdate() { this.updatedAt = Instant.now(); }

    public UUID getId() { return id; }
    public Company getCompany() { return company; }
    public String getDisplayName() { return displayName; }
    public String getExternalIdentifier() { return externalIdentifier; }
    public BossGatewayType getGatewayType() { return gatewayType; }
    public MockBossProfile getMockProfile() { return mockProfile; }
    public BossAccountStatus getStatus() { return status; }
    public BossConnectionStatus getConnectionStatus() { return connectionStatus; }
    public Set<BossCapability> getCapabilities() { return Set.copyOf(capabilities); }
    public Instant getLastCheckedAt() { return lastCheckedAt; }
    public long getVersion() { return version; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}
