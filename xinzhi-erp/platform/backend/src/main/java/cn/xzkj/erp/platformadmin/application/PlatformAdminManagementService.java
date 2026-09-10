package cn.xzkj.erp.platformadmin.application;

import static cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditActions.SYSTEM_ADMIN_CREATED;
import static cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditActions.SYSTEM_ADMIN_DELETED;
import static cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditActions.SYSTEM_ADMIN_STATUS_CHANGED;
import static cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditActions.SYSTEM_ADMIN_UPDATED;
import static cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditActions.SYSTEM_ADMIN_PASSWORD_RESET;

import cn.xzkj.erp.iam.application.IamConflictException;
import cn.xzkj.erp.iam.application.IamNotFoundException;
import cn.xzkj.erp.iam.application.IamOptimisticLockException;
import cn.xzkj.erp.iam.application.IamValidationException;
import cn.xzkj.erp.iam.application.PasswordHashingService;
import cn.xzkj.erp.iam.domain.LoginIdentifier;
import cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditEvent;
import cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditRecorder;
import cn.xzkj.erp.platformadmin.domain.PlatformAdminCredentialPurpose;
import cn.xzkj.erp.platformadmin.domain.SystemAdminStatus;
import cn.xzkj.erp.platformadmin.persistence.PlatformAdminCredentialRepository;
import cn.xzkj.erp.platformadmin.persistence.PlatformAdminSessionRepository;
import cn.xzkj.erp.platformadmin.persistence.PlatformTenantSessionRepository;
import cn.xzkj.erp.platformadmin.persistence.SystemAdminEntity;
import cn.xzkj.erp.platformadmin.persistence.SystemAdminRepository;
import java.time.Clock;
import java.time.Instant;
import java.util.Map;
import java.util.Arrays;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PlatformAdminManagementService {

    public static final int MAX_PAGE_SIZE = 200;
    public static final int MAX_PAGE_NUMBER = 1_000_000;

    private final SystemAdminRepository adminRepository;
    private final PlatformAdminCredentialService credentialService;
    private final PlatformAdminCredentialRepository credentialRepository;
    private final PlatformAdminSessionRepository sessionRepository;
    private final PlatformTenantSessionRepository tenantSessionRepository;
    private final PlatformAdminAuditRecorder auditRecorder;
    private final PasswordHashingService passwordHashingService;
    private final Clock clock;

    public PlatformAdminManagementService(
            SystemAdminRepository adminRepository,
            PlatformAdminCredentialService credentialService,
            PlatformAdminCredentialRepository credentialRepository,
            PlatformAdminSessionRepository sessionRepository,
            PlatformTenantSessionRepository tenantSessionRepository,
            PlatformAdminAuditRecorder auditRecorder,
            PasswordHashingService passwordHashingService,
            Clock clock) {
        this.adminRepository = adminRepository;
        this.credentialService = credentialService;
        this.credentialRepository = credentialRepository;
        this.sessionRepository = sessionRepository;
        this.tenantSessionRepository = tenantSessionRepository;
        this.auditRecorder = auditRecorder;
        this.passwordHashingService = passwordHashingService;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public Page<SystemAdminView> list(int page, int size) {
        if (page < 0 || page > MAX_PAGE_NUMBER
                || size < 1 || size > MAX_PAGE_SIZE) {
            throw new IamValidationException();
        }
        return adminRepository.findAll(PageRequest.of(
                        page,
                        size,
                        Sort.by(
                                Sort.Order.asc("username")
                                        .ignoreCase(),
                                Sort.Order.asc("id"))))
                .map(PlatformAdminManagementService::view);
    }

    @Transactional
    public CreatedSystemAdmin create(
            PlatformAdminActor actor,
            String loginIdentifier,
            String displayName) {
        LoginIdentifier.Normalized identity = requireLoginIdentifier(
                loginIdentifier);
        String normalizedDisplayName = requireText(displayName, 160);
        if ((identity.email() != null
                && adminRepository.existsByEmail(identity.email()))
                || (identity.phoneNumber() != null
                && adminRepository.existsByPhoneNumber(identity.phoneNumber()))) {
            throw new IamConflictException();
        }
        Instant now = clock.instant();
        SystemAdminEntity admin;
        try {
            admin = adminRepository.saveAndFlush(new SystemAdminEntity(
                    UUID.randomUUID(),
                    identity.username(),
                    identity.email(),
                    identity.phoneNumber(),
                    normalizedDisplayName,
                    now));
        } catch (DataIntegrityViolationException concurrentUsername) {
            throw new IamConflictException();
        }
        PlatformAdminCredentialService.IssuedCredential credential =
                credentialService.issue(
                        admin,
                        PlatformAdminCredentialPurpose.ACTIVATION,
                        actor.adminId());
        audit(actor, SYSTEM_ADMIN_CREATED, admin, Map.of());
        return new CreatedSystemAdmin(view(admin), credential);
    }

    @Transactional
    public SystemAdminView update(
            PlatformAdminActor actor,
            UUID adminId,
            String loginIdentifier,
            String displayName,
            long expectedVersion) {
        SystemAdminEntity admin = requireForUpdate(adminId);
        requireNotDeleted(admin);
        requireVersion(admin, expectedVersion);
        LoginIdentifier.Normalized identity = requireLoginIdentifier(
                loginIdentifier);
        if ((identity.email() != null
                && !identity.email().equals(admin.getEmail())
                && adminRepository.existsByEmail(identity.email()))
                || (identity.phoneNumber() != null
                && !identity.phoneNumber().equals(admin.getPhoneNumber())
                && adminRepository.existsByPhoneNumber(identity.phoneNumber()))) {
            throw new IamConflictException();
        }
        admin.updateIdentity(
                identity.username(),
                identity.email(),
                identity.phoneNumber(),
                requireText(displayName, 160),
                clock.instant());
        SystemAdminEntity saved = adminRepository.saveAndFlush(admin);
        audit(actor, SYSTEM_ADMIN_UPDATED, saved, Map.of());
        return view(saved);
    }

    @Transactional
    public SystemAdminView activate(
            PlatformAdminActor actor,
            UUID adminId,
            long expectedVersion) {
        requireOther(actor, adminId);
        SystemAdminEntity admin = requireForUpdate(adminId);
        requireVersion(admin, expectedVersion);
        if (admin.getStatus() == SystemAdminStatus.ACTIVE) {
            return view(admin);
        }
        if (admin.getStatus() != SystemAdminStatus.DISABLED
                || admin.getPasswordHash() == null) {
            throw new IamConflictException();
        }
        SystemAdminStatus previous = admin.getStatus();
        admin.activate(clock.instant());
        SystemAdminEntity saved = adminRepository.saveAndFlush(admin);
        auditStatus(actor, saved, previous);
        return view(saved);
    }

    @Transactional
    public SystemAdminView disable(
            PlatformAdminActor actor,
            UUID adminId,
            long expectedVersion) {
        requireOther(actor, adminId);
        SystemAdminEntity admin = requireForUpdate(adminId);
        requireVersion(admin, expectedVersion);
        if (admin.getStatus() == SystemAdminStatus.DISABLED) {
            return view(admin);
        }
        if (admin.getStatus() != SystemAdminStatus.ACTIVE) {
            throw new IamConflictException();
        }
        Instant now = clock.instant();
        SystemAdminStatus previous = admin.getStatus();
        admin.disable(now);
        SystemAdminEntity saved = adminRepository.saveAndFlush(admin);
        revokeSessions(adminId, now);
        auditStatus(actor, saved, previous);
        return view(saved);
    }

    @Transactional
    public SystemAdminView delete(
            PlatformAdminActor actor,
            UUID adminId,
            long expectedVersion) {
        requireOther(actor, adminId);
        SystemAdminEntity admin = requireForUpdate(adminId);
        requireVersion(admin, expectedVersion);
        if (admin.getStatus() == SystemAdminStatus.DELETED) {
            return view(admin);
        }
        Instant now = clock.instant();
        SystemAdminStatus previous = admin.getStatus();
        admin.softDelete(now);
        SystemAdminEntity saved = adminRepository.saveAndFlush(admin);
        credentialRepository.revokeAllOpen(adminId, now);
        revokeSessions(adminId, now);
        audit(
                actor,
                SYSTEM_ADMIN_DELETED,
                saved,
                Map.of("previousStatus", previous.name()));
        return view(saved);
    }

    @Transactional
    public PlatformAdminCredentialService.IssuedCredential issueReset(
            PlatformAdminActor actor,
            UUID adminId) {
        requireOther(actor, adminId);
        SystemAdminEntity admin = requireForUpdate(adminId);
        return credentialService.issue(
                admin,
                PlatformAdminCredentialPurpose.RESET,
                actor.adminId());
    }

    @Transactional
    public void resetPassword(
            PlatformAdminActor actor,
            UUID adminId,
            char[] newPassword,
            long expectedVersion) {
        resetPassword(
                actor,
                adminId,
                newPassword,
                Long.valueOf(expectedVersion));
    }

    @Transactional
    public void resetOwnPassword(
            PlatformAdminActor actor,
            char[] newPassword) {
        resetPassword(actor, actor.adminId(), newPassword, null);
    }

    private void resetPassword(
            PlatformAdminActor actor,
            UUID adminId,
            char[] newPassword,
            Long expectedVersion) {
        try {
            SystemAdminEntity admin = requireForUpdate(adminId);
            requireNotDeleted(admin);
            if (expectedVersion != null) {
                requireVersion(admin, expectedVersion.longValue());
            }
            if (admin.getStatus() != SystemAdminStatus.ACTIVE
                    && admin.getStatus() != SystemAdminStatus.DISABLED) {
                throw new IamConflictException();
            }
            String passwordHash;
            try {
                passwordHash = passwordHashingService.hashForStorage(
                        newPassword);
            } catch (IllegalArgumentException invalidPassword) {
                throw new IamValidationException();
            }
            Instant now = clock.instant();
            admin.changePassword(passwordHash, now);
            adminRepository.saveAndFlush(admin);
            credentialRepository.revokeAllOpen(adminId, now);
            revokeSessions(adminId, now);
            audit(actor, SYSTEM_ADMIN_PASSWORD_RESET, admin, Map.of());
        } finally {
            if (newPassword != null) {
                Arrays.fill(newPassword, '\0');
            }
        }
    }

    private void revokeSessions(UUID adminId, Instant now) {
        tenantSessionRepository.revokeAllForAdmin(adminId, now);
        sessionRepository.revokeAllForAdmin(adminId, now);
    }

    private SystemAdminEntity requireForUpdate(UUID adminId) {
        return adminRepository.findByIdForUpdate(adminId)
                .orElseThrow(IamNotFoundException::new);
    }

    private static void requireNotDeleted(SystemAdminEntity admin) {
        if (admin.getStatus() == SystemAdminStatus.DELETED) {
            throw new IamNotFoundException();
        }
    }

    private static void requireOther(
            PlatformAdminActor actor,
            UUID adminId) {
        if (actor.adminId().equals(adminId)) {
            throw new IamConflictException();
        }
    }

    private static void requireVersion(
            SystemAdminEntity admin,
            long expectedVersion) {
        if (admin.getVersion() != expectedVersion) {
            throw new IamOptimisticLockException();
        }
    }

    private static LoginIdentifier.Normalized requireLoginIdentifier(
            String value) {
        try {
            return LoginIdentifier.normalizeRequired(value);
        } catch (IllegalArgumentException invalidIdentifier) {
            throw new IamValidationException();
        }
    }

    private static String requireText(String value, int maximum) {
        if (value == null) {
            throw new IamValidationException();
        }
        String normalized = value.strip();
        if (normalized.isEmpty() || normalized.length() > maximum) {
            throw new IamValidationException();
        }
        return normalized;
    }

    private void auditStatus(
            PlatformAdminActor actor,
            SystemAdminEntity admin,
            SystemAdminStatus previous) {
        audit(
                actor,
                SYSTEM_ADMIN_STATUS_CHANGED,
                admin,
                Map.of(
                        "previousStatus",
                        previous.name(),
                        "status",
                        admin.getStatus().name()));
    }

    private void audit(
            PlatformAdminActor actor,
            String action,
            SystemAdminEntity admin,
            Map<String, String> details) {
        auditRecorder.recordAtomically(new PlatformAdminAuditEvent(
                actor.adminId(),
                null,
                action,
                "system_admin",
                admin.getId().toString(),
                actor.requestId(),
                actor.sourceIp(),
                details));
    }

    public static SystemAdminView view(SystemAdminEntity admin) {
        return new SystemAdminView(
                admin.getId(),
                admin.getUsername(),
                admin.getEmail(),
                admin.getPhoneNumber(),
                admin.getDisplayName(),
                admin.getStatus(),
                admin.getCreatedAt(),
                admin.getUpdatedAt(),
                admin.getVersion());
    }

    public record SystemAdminView(
            UUID id,
            String username,
            String email,
            String phoneNumber,
            String displayName,
            SystemAdminStatus status,
            Instant createdAt,
            Instant updatedAt,
            long version) {
    }

    public record CreatedSystemAdmin(
            SystemAdminView admin,
            PlatformAdminCredentialService.IssuedCredential credential) {
    }
}
