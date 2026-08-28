package ai.xzkj.recruitment.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.JoinTable;
import jakarta.persistence.ManyToMany;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import ai.xzkj.recruitment.organization.Company;

import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;

@Entity
@Table(name = "system_users")
public class SystemUser {
    @Id
    private UUID id;

    @Column(nullable = false, unique = true, length = 64)
    private String username;

    @Column(name = "password_hash", nullable = false)
    private String passwordHash;

    @Column(name = "display_name", nullable = false, length = 100)
    private String displayName;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private UserRole role;

    @Column(nullable = false)
    private boolean enabled;

    @ManyToMany
    @JoinTable(
            name = "user_company_scopes",
            joinColumns = @JoinColumn(name = "user_id"),
            inverseJoinColumns = @JoinColumn(name = "company_id")
    )
    private Set<Company> companyScopes = new LinkedHashSet<>();

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected SystemUser() {
    }

    public SystemUser(String username, String passwordHash, String displayName, UserRole role) {
        this.id = UUID.randomUUID();
        this.username = username;
        this.passwordHash = passwordHash;
        this.displayName = displayName;
        this.role = role;
        this.enabled = true;
        this.createdAt = Instant.now();
        this.updatedAt = this.createdAt;
    }

    public void updateProfile(String displayName, UserRole role, Set<Company> companyScopes) {
        this.displayName = displayName;
        this.role = role;
        this.companyScopes.clear();
        this.companyScopes.addAll(companyScopes);
    }

    public void changeEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public void changePassword(String passwordHash) {
        this.passwordHash = passwordHash;
    }

    public void assignCompanyScopes(Set<Company> companyScopes) {
        this.companyScopes.clear();
        this.companyScopes.addAll(companyScopes);
    }

    @PreUpdate
    void preUpdate() { this.updatedAt = Instant.now(); }

    public UUID getId() { return id; }
    public String getUsername() { return username; }
    public String getPasswordHash() { return passwordHash; }
    public String getDisplayName() { return displayName; }
    public UserRole getRole() { return role; }
    public boolean isEnabled() { return enabled; }
    public Set<Company> getCompanyScopes() { return Set.copyOf(companyScopes); }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}
