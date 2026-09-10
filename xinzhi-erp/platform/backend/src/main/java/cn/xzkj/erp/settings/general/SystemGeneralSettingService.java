package cn.xzkj.erp.settings.general;

import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.Currency;
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
public class SystemGeneralSettingService {
    static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Shanghai");
    private static final String SAVED = "settings.system_general.saved";
    private final SystemGeneralSettingRepository repository;
    private final SecurityAuditRecorder auditRecorder;

    public SystemGeneralSettingService(SystemGeneralSettingRepository repository,
            SecurityAuditRecorder auditRecorder) {
        this.repository = repository;
        this.auditRecorder = auditRecorder;
    }

    @Transactional(readOnly = true)
    public SystemGeneralSettingRecord get(Actor actor) {
        requireActor(actor, false);
        return repository.find(actor.tenantId());
    }

    @Transactional
    public SystemGeneralSettingRecord save(Actor actor, long expectedVersion,
            String defaultCurrency, LocalTime start, LocalTime end) {
        requireActor(actor, true);
        validate(expectedVersion, defaultCurrency, start, end);
        SystemGeneralSettingRecord current = repository.find(actor.tenantId());
        if (current.version() != expectedVersion) {
            throw new ConflictException("System settings changed concurrently");
        }
        try {
            if (!current.configured()) {
                repository.insert(actor.tenantId(), defaultCurrency, start, end,
                        actor);
            } else if (!repository.update(actor.tenantId(), expectedVersion,
                    defaultCurrency, start, end, actor)) {
                throw new ConflictException("System settings changed concurrently");
            }
        } catch (DataIntegrityViolationException exception) {
            throw new ConflictException("System settings changed concurrently");
        }
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(), SAVED,
                "system_general_setting", actor.tenantId().toString(),
                actor.requestId(), actor.sourceIp(), Map.of(
                        "previousCurrency", current.defaultCurrency(),
                        "defaultCurrency", defaultCurrency,
                        "previousBlackout", interval(current.orderPullBlackoutStart(),
                                current.orderPullBlackoutEnd()),
                        "orderPullBlackout", interval(start, end),
                        "created", Boolean.toString(!current.configured()))));
        return repository.find(actor.tenantId());
    }

    @Transactional(readOnly = true)
    public String defaultCurrency(UUID tenantId) {
        return repository.find(tenantId).defaultCurrency();
    }

    @Transactional(readOnly = true)
    public void requireOrderPullAllowed(UUID tenantId, Instant now) {
        if (tenantId == null || now == null) {
            throw new IllegalArgumentException("Tenant and current time are required");
        }
        SystemGeneralSettingRecord setting = repository.find(tenantId);
        LocalTime start = setting.orderPullBlackoutStart();
        LocalTime end = setting.orderPullBlackoutEnd();
        if (start == null || end == null) return;
        LocalTime current = now.atZone(BUSINESS_ZONE).toLocalTime();
        boolean blocked = start.isBefore(end)
                ? !current.isBefore(start) && current.isBefore(end)
                : !current.isBefore(start) || current.isBefore(end);
        if (blocked) throw new OrderPullBlackoutException(end);
    }

    private static void validate(long expectedVersion, String currency,
            LocalTime start, LocalTime end) {
        if (expectedVersion < 0 || currency == null
                || !currency.matches("^[A-Z]{3}$")
                || (start == null) != (end == null)
                || (start != null && start.equals(end))) {
            throw new IllegalArgumentException("System settings are invalid");
        }
        try {
            Currency.getInstance(currency);
        } catch (IllegalArgumentException exception) {
            throw new IllegalArgumentException("Currency is invalid", exception);
        }
    }

    private static String interval(LocalTime start, LocalTime end) {
        return start == null ? "disabled" : start + "-" + end;
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
