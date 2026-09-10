package cn.xzkj.erp.settings.deadline;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
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
public class ShippingDeadlineSettingService {
    private static final String SAVED = "settings.shipping_deadline.saved";
    private final ShippingDeadlineSettingRepository repository;
    private final SecurityAuditRecorder auditRecorder;

    public ShippingDeadlineSettingService(
            ShippingDeadlineSettingRepository repository,
            SecurityAuditRecorder auditRecorder) {
        this.repository = repository;
        this.auditRecorder = auditRecorder;
    }

    @Transactional(readOnly = true)
    public ShippingDeadlineSettingRecord get(Actor actor) {
        requireActor(actor, false);
        return repository.find(actor.tenantId());
    }

    @Transactional
    public ShippingDeadlineSettingRecord save(
            Actor actor, long expectedVersion, int deadlineDays) {
        requireActor(actor, true);
        if (expectedVersion < 0 || deadlineDays < 1 || deadlineDays > 365) {
            throw new IllegalArgumentException("Shipping deadline setting is invalid");
        }
        ShippingDeadlineSettingRecord current = repository.find(actor.tenantId());
        if (current.version() != expectedVersion) {
            throw new ConflictException("Shipping deadline setting changed concurrently");
        }
        try {
            if (!current.configured()) {
                repository.insert(actor.tenantId(), deadlineDays, actor);
            } else if (!repository.update(actor.tenantId(), expectedVersion,
                    deadlineDays, actor)) {
                throw new ConflictException(
                        "Shipping deadline setting changed concurrently");
            }
        } catch (DataIntegrityViolationException exception) {
            throw new ConflictException(
                    "Shipping deadline setting changed concurrently");
        }
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(), SAVED,
                "shipping_deadline_setting", actor.tenantId().toString(),
                actor.requestId(), actor.sourceIp(), Map.of(
                        "previousDays", Integer.toString(current.deadlineDays()),
                        "deadlineDays", Integer.toString(deadlineDays),
                        "created", Boolean.toString(!current.configured()))));
        return repository.find(actor.tenantId());
    }

    @Transactional(readOnly = true)
    public Instant resolveShipByAt(
            UUID tenantId, Instant baseline, Instant sourceDeadline) {
        if (sourceDeadline != null) return sourceDeadline;
        if (tenantId == null || baseline == null) {
            throw new IllegalArgumentException("Shipping deadline baseline is required");
        }
        return baseline.plus(repository.deadlineDays(tenantId), ChronoUnit.DAYS);
    }

    private static void requireActor(Actor actor, boolean requestRequired) {
        if (actor == null || actor.tenantId() == null
                || (actor.userId() == null) == (actor.systemAdminId() == null)
                || (requestRequired && (actor.requestId() == null
                || !actor.requestId().matches("^[A-Za-z0-9._:-]{1,100}$")
                || actor.displayName() == null || actor.displayName().isBlank()))) {
            throw new AccessDeniedException("A tenant actor is required");
        }
    }

    public record Actor(UUID tenantId, UUID userId, UUID systemAdminId,
            String displayName, String requestId, String sourceIp) {
    }
}
