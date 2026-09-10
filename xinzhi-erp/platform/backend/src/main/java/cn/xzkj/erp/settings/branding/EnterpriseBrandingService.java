package cn.xzkj.erp.settings.branding;

import java.util.Map;
import java.util.UUID;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.service.ConflictException;

@Service
public class EnterpriseBrandingService {
    private final EnterpriseBrandingRepository repository;
    private final SecurityAuditRecorder auditRecorder;

    public EnterpriseBrandingService(EnterpriseBrandingRepository repository,
            SecurityAuditRecorder auditRecorder) {
        this.repository = repository;
        this.auditRecorder = auditRecorder;
    }

    @Transactional(readOnly = true)
    public EnterpriseBrandingRecord get(Actor actor) {
        requireActor(actor, false);
        return repository.find(actor.tenantId());
    }

    @Transactional
    public EnterpriseBrandingRecord saveSettings(Actor actor, long expectedVersion,
            SettingsInput input) {
        requireActor(actor, true);
        validVersion(expectedVersion);
        if (input == null || input.watermarkEnabled()
                && !input.watermarkUserName()
                && !input.watermarkCompanyName()
                && !input.watermarkTime()
                && !input.watermarkPhoneSuffix()) {
            throw new IllegalArgumentException("Watermark settings are invalid");
        }
        EnterpriseBrandingRecord current = repository.find(actor.tenantId());
        requireVersion(current, expectedVersion);
        try {
            if (!current.configured()) repository.insertSettings(actor.tenantId(), input, actor);
            else if (!repository.updateSettings(actor.tenantId(), expectedVersion, input, actor)) conflict();
        } catch (DataIntegrityViolationException exception) {
            conflict();
        }
        audit(actor, "settings.enterprise_branding.updated", Map.of(
                "watermarkEnabled", Boolean.toString(input.watermarkEnabled()),
                "elementCount", Integer.toString(elementCount(input))));
        return repository.find(actor.tenantId());
    }

    private void audit(Actor actor, String action, Map<String, String> details) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(actor.tenantId(),
                actor.userId(), actor.systemAdminId(), action,
                "enterprise_branding", actor.tenantId().toString(),
                actor.requestId(), actor.sourceIp(), details));
    }

    private static void requireVersion(EnterpriseBrandingRecord current,
            long expectedVersion) {
        if (current.version() != expectedVersion) conflict();
    }

    private static void validVersion(long version) {
        if (version < 0) throw new IllegalArgumentException("Branding version is invalid");
    }

    private static int elementCount(SettingsInput input) {
        int count = 0;
        if (input.watermarkUserName()) count++;
        if (input.watermarkCompanyName()) count++;
        if (input.watermarkTime()) count++;
        if (input.watermarkPhoneSuffix()) count++;
        return count;
    }

    private static void conflict() {
        throw new ConflictException("Enterprise branding changed concurrently");
    }

    private static void requireActor(Actor actor, boolean requestRequired) {
        if (actor == null || actor.tenantId() == null
                || (actor.userId() == null) == (actor.systemAdminId() == null)
                || actor.displayName() == null || actor.displayName().isBlank()
                || (requestRequired && (actor.requestId() == null
                || !actor.requestId().matches("^[A-Za-z0-9._:-]{1,100}$")))) {
            throw new AccessDeniedException("A tenant actor is required");
        }
    }

    public record Actor(UUID tenantId, UUID userId, UUID systemAdminId,
            String displayName, String requestId, String sourceIp) {
    }

    public record SettingsInput(boolean watermarkEnabled,
            boolean watermarkUserName, boolean watermarkCompanyName,
            boolean watermarkTime, boolean watermarkPhoneSuffix) {
    }
}
