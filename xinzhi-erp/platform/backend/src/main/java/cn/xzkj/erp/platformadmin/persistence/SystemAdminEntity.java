package cn.xzkj.erp.platformadmin.persistence;

import cn.xzkj.erp.platformadmin.domain.SystemAdminStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "system_admins")
public class SystemAdminEntity {

    @Id
    private UUID id;

    @Column(nullable = false, length = 254)
    private String username;

    @Column(length = 254)
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
    private SystemAdminStatus status;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(nullable = false)
    private long version;

    protected SystemAdminEntity() {
    }

    public SystemAdminEntity(
            UUID id,
            String username,
            String email,
            String phoneNumber,
            String displayName,
            Instant now) {
        this.id = id;
        this.username = username;
        this.email = email;
        this.phoneNumber = phoneNumber;
        this.displayName = displayName;
        this.status = SystemAdminStatus.PENDING_ACTIVATION;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public SystemAdminEntity(
            UUID id,
            String email,
            String displayName,
            Instant now) {
        this(id, email, email, null, displayName, now);
    }

    public void rename(String displayName, Instant now) {
        this.displayName = displayName;
        this.updatedAt = now;
    }

    public void updateIdentity(
            String username,
            String email,
            String phoneNumber,
            String displayName,
            Instant now) {
        this.username = username;
        this.email = email;
        this.phoneNumber = phoneNumber;
        this.displayName = displayName;
        this.updatedAt = now;
    }

    public void activate(Instant now) {
        this.status = SystemAdminStatus.ACTIVE;
        this.updatedAt = now;
    }

    public void disable(Instant now) {
        this.status = SystemAdminStatus.DISABLED;
        this.updatedAt = now;
    }

    public void softDelete(Instant now) {
        this.status = SystemAdminStatus.DELETED;
        this.passwordHash = null;
        this.updatedAt = now;
    }

    public void initializePassword(
            String passwordHash,
            SystemAdminStatus resultingStatus,
            Instant now) {
        this.passwordHash = passwordHash;
        this.status = resultingStatus;
        this.updatedAt = now;
    }

    public void changePassword(String passwordHash, Instant now) {
        this.passwordHash = passwordHash;
        this.updatedAt = now;
    }

    public void prepareRecoveryActivation(Instant now) {
        this.status = SystemAdminStatus.PENDING_ACTIVATION;
        this.updatedAt = now;
    }

    public void linkOneSubject(
            UUID subjectId,
            String email,
            String displayName,
            Instant now) {
        if (oneSubjectId != null && !oneSubjectId.equals(subjectId)) {
            throw new IllegalStateException(
                    "System administrator is linked to another One subject");
        }
        oneSubjectId = subjectId;
        username = email;
        this.email = email;
        phoneNumber = null;
        this.displayName = displayName;
        updatedAt = now;
    }

    public UUID getId() {
        return id;
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

    public SystemAdminStatus getStatus() {
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
