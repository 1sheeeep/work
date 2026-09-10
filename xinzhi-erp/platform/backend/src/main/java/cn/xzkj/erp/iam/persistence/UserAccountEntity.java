package cn.xzkj.erp.iam.persistence;

import cn.xzkj.erp.iam.domain.AccountStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "users")
public class UserAccountEntity {

    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "tenant_id", nullable = false)
    private TenantEntity tenant;

    @Column(nullable = false, length = 254, updatable = false)
    private String username;

    @Column(length = 254, updatable = false)
    private String email;

    @Column(name = "phone_number", length = 16)
    private String phoneNumber;

    @Column(name = "display_name", nullable = false, length = 160)
    private String displayName;

    @Column(name = "password_hash", length = 255)
    private String passwordHash;

    @Column(name = "one_subject_id", unique = true)
    private UUID oneSubjectId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private AccountStatus status;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(nullable = false)
    private long version;

    protected UserAccountEntity() {
    }

    public UserAccountEntity(
            UUID id,
            TenantEntity tenant,
            String email,
            String phoneNumber,
            String displayName,
            AccountStatus status,
            Instant createdAt) {
        this.id = id;
        this.tenant = tenant;
        this.username = email != null ? email : phoneNumber;
        this.email = email;
        this.phoneNumber = phoneNumber;
        this.displayName = displayName;
        this.status = status;
        this.createdAt = createdAt;
        this.updatedAt = createdAt;
    }

    public void rename(String displayName, Instant updatedAt) {
        this.displayName = displayName;
        this.updatedAt = updatedAt;
    }

    public void updateProfile(
            String displayName,
            String phoneNumber,
            Instant updatedAt) {
        this.displayName = displayName;
        this.phoneNumber = phoneNumber;
        this.updatedAt = updatedAt;
    }

    public void changeStatus(AccountStatus status, Instant updatedAt) {
        this.status = status;
        this.updatedAt = updatedAt;
    }

    public void initializePassword(
            String passwordHash,
            AccountStatus status,
            Instant updatedAt) {
        this.passwordHash = passwordHash;
        this.status = status;
        this.updatedAt = updatedAt;
    }

    public void changePassword(String passwordHash, Instant updatedAt) {
        this.passwordHash = passwordHash;
        this.updatedAt = updatedAt;
    }

    public void touch(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }

    public void linkOneSubject(
            UUID subjectId,
            String displayName,
            Instant updatedAt) {
        if (oneSubjectId != null && !oneSubjectId.equals(subjectId)) {
            throw new IllegalStateException("User is linked to another One subject");
        }
        oneSubjectId = subjectId;
        this.displayName = displayName;
        this.updatedAt = updatedAt;
    }

    public UUID getId() {
        return id;
    }

    public TenantEntity getTenant() {
        return tenant;
    }

    public String getUsername() {
        return username;
    }

    public String getEmail() {
        return email;
    }

    public String getPhoneNumber() {
        return phoneNumber;
    }

    public String getDisplayName() {
        return displayName;
    }

    public String getPasswordHash() {
        return passwordHash;
    }

    public UUID getOneSubjectId() {
        return oneSubjectId;
    }

    public AccountStatus getStatus() {
        return status;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public long getVersion() {
        return version;
    }
}
