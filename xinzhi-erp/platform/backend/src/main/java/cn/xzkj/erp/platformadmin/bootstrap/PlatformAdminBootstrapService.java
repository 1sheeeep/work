package cn.xzkj.erp.platformadmin.bootstrap;

import static cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditActions.BOOTSTRAP_PROVISIONED;
import static cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditActions.BOOTSTRAP_RECOVERY_ISSUED;

import cn.xzkj.erp.iam.bootstrap.BootstrapTokenFileStore;
import cn.xzkj.erp.platformadmin.application.PlatformAdminCredentialService;
import cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditEvent;
import cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditRecorder;
import cn.xzkj.erp.platformadmin.domain.PlatformAdminCredentialPurpose;
import cn.xzkj.erp.platformadmin.domain.SystemAdminStatus;
import cn.xzkj.erp.platformadmin.persistence.SystemAdminEntity;
import cn.xzkj.erp.platformadmin.persistence.SystemAdminRepository;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Service
public class PlatformAdminBootstrapService {

    private final PlatformAdminBootstrapLock lock;
    private final SystemAdminRepository adminRepository;
    private final PlatformAdminCredentialService credentialService;
    private final BootstrapTokenFileStore tokenFileStore;
    private final PlatformAdminAuditRecorder auditRecorder;
    private final Clock clock;

    public PlatformAdminBootstrapService(
            PlatformAdminBootstrapLock lock,
            SystemAdminRepository adminRepository,
            PlatformAdminCredentialService credentialService,
            BootstrapTokenFileStore tokenFileStore,
            PlatformAdminAuditRecorder auditRecorder,
            Clock clock) {
        this.lock = lock;
        this.adminRepository = adminRepository;
        this.credentialService = credentialService;
        this.tokenFileStore = tokenFileStore;
        this.auditRecorder = auditRecorder;
        this.clock = clock;
    }

    @Transactional
    public void provision(PlatformAdminBootstrapCommand command) {
        lock.acquire();
        try {
            if (command.recovery()) {
                recover(command);
            } else {
                provisionInitial(command);
            }
        } catch (PlatformAdminBootstrapException safeFailure) {
            throw safeFailure;
        } catch (DataIntegrityViolationException conflictingState) {
            throw new PlatformAdminBootstrapException();
        }
    }

    private void provisionInitial(PlatformAdminBootstrapCommand command) {
        SystemAdminEntity existing = findByIdentity(command);
        if (existing != null) {
            if (!existing.getDisplayName().equals(command.displayName())
                    || existing.getStatus() == SystemAdminStatus.DELETED) {
                throw new PlatformAdminBootstrapException();
            }
            return;
        }
        if (adminRepository.count() != 0) {
            throw new PlatformAdminBootstrapException();
        }
        tokenFileStore.requireAvailable(command.tokenOutputPath());
        SystemAdminEntity admin = adminRepository.saveAndFlush(
                new SystemAdminEntity(
                        UUID.randomUUID(),
                        command.username(),
                        command.email(),
                        command.phoneNumber(),
                        command.displayName(),
                        clock.instant()));
        PlatformAdminCredentialService.IssuedCredential credential =
                credentialService.issue(
                        admin,
                        PlatformAdminCredentialPurpose.ACTIVATION,
                        null,
                        Duration.ofMinutes(command.ttlMinutes()));
        auditRecorder.recordAtomically(new PlatformAdminAuditEvent(
                null,
                null,
                BOOTSTRAP_PROVISIONED,
                "system_admin",
                admin.getId().toString(),
                null,
                null,
                Map.of("ttlMinutes", Integer.toString(command.ttlMinutes()))));
        writeToken(command.tokenOutputPath(), credential.token());
    }

    private void recover(PlatformAdminBootstrapCommand command) {
        SystemAdminEntity admin = findByIdentity(command);
        if (admin == null) {
            throw new PlatformAdminBootstrapException();
        }
        if (admin.getStatus() == SystemAdminStatus.DELETED
                || !admin.getDisplayName().equals(command.displayName())) {
            throw new PlatformAdminBootstrapException();
        }
        if (Files.exists(command.tokenOutputPath())) {
            return;
        }
        tokenFileStore.requireAvailable(command.tokenOutputPath());
        PlatformAdminCredentialPurpose purpose;
        if (admin.getStatus() == SystemAdminStatus.ACTIVE) {
            purpose = PlatformAdminCredentialPurpose.RESET;
        } else {
            admin.prepareRecoveryActivation(clock.instant());
            adminRepository.saveAndFlush(admin);
            purpose = PlatformAdminCredentialPurpose.ACTIVATION;
        }
        PlatformAdminCredentialService.IssuedCredential credential =
                credentialService.issue(
                        admin,
                        purpose,
                        null,
                        Duration.ofMinutes(command.ttlMinutes()));
        auditRecorder.recordAtomically(new PlatformAdminAuditEvent(
                null,
                null,
                BOOTSTRAP_RECOVERY_ISSUED,
                "system_admin",
                admin.getId().toString(),
                null,
                null,
                Map.of(
                        "purpose",
                        purpose.name(),
                        "ttlMinutes",
                        Integer.toString(command.ttlMinutes()))));
        writeToken(command.tokenOutputPath(), credential.token());
    }

    private SystemAdminEntity findByIdentity(
            PlatformAdminBootstrapCommand command) {
        return command.email() != null
                ? adminRepository.findByEmail(command.email()).orElse(null)
                : adminRepository
                        .findByPhoneNumber(command.phoneNumber())
                        .orElse(null);
    }

    private void writeToken(Path outputPath, String rawToken) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            throw new PlatformAdminBootstrapException();
        }
        AtomicBoolean created = new AtomicBoolean();
        TransactionSynchronizationManager.registerSynchronization(
                new TransactionSynchronization() {
                    @Override
                    public void afterCompletion(int status) {
                        if (status != STATUS_COMMITTED && created.get()) {
                            tokenFileStore.deleteQuietly(outputPath);
                        }
                    }
                });
        tokenFileStore.createNew(outputPath, rawToken);
        created.set(true);
    }
}
