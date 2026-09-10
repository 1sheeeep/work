package cn.xzkj.erp.settings.notice;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class InternalNoticeService {
    private final InternalNoticeRepository repository;
    private final SecurityAuditRecorder auditRecorder;

    public InternalNoticeService(InternalNoticeRepository repository,
            SecurityAuditRecorder auditRecorder) {
        this.repository = repository;
        this.auditRecorder = auditRecorder;
    }

    @Transactional(readOnly = true)
    public Page<InternalNoticeRecord> list(Actor actor, Filters filters,
            Pageable pageable) {
        requireActor(actor);
        return repository.list(actor.tenantId(), normalize(filters), pageable);
    }

    @Transactional
    public InternalNoticeRecord create(Actor actor, NoticeInput input) {
        requireActor(actor);
        NoticeInput normalized = normalize(input);
        UUID id = UUID.randomUUID();
        repository.insert(id, actor.tenantId(), normalized, actor);
        audit(actor, "settings.notice.created", id,
                Map.of("pinned", Boolean.toString(normalized.pinned())));
        return requireNotice(actor.tenantId(), id);
    }

    @Transactional
    public InternalNoticeRecord setPinned(Actor actor, UUID id, long version,
            boolean pinned) {
        requireActor(actor);
        InternalNoticeRecord current = requireNotice(actor.tenantId(), id);
        if (!"ACTIVE".equals(current.status())) {
            throw new ConflictException("Archived notice cannot be pinned");
        }
        if (current.pinned() == pinned) return current;
        if (version < 0 || !repository.setPinned(actor.tenantId(), id, version,
                pinned, actor)) {
            throw new ConflictException("Notice changed concurrently");
        }
        audit(actor, "settings.notice.pin_changed", id,
                Map.of("pinned", Boolean.toString(pinned)));
        return requireNotice(actor.tenantId(), id);
    }

    @Transactional
    public InternalNoticeRecord transition(Actor actor, UUID id, long version,
            String targetStatus) {
        requireActor(actor);
        InternalNoticeRecord current = requireNotice(actor.tenantId(), id);
        String target = "ARCHIVED".equalsIgnoreCase(targetStatus)
                ? "ARCHIVED" : "ACTIVE".equalsIgnoreCase(targetStatus)
                        ? "ACTIVE" : null;
        if (target == null || target.equals(current.status())) {
            throw new ConflictException("Notice status transition is invalid");
        }
        if (version < 0 || !repository.transition(actor.tenantId(), id, version,
                current.status(), target, actor)) {
            throw new ConflictException("Notice changed concurrently");
        }
        audit(actor, "settings.notice.status_changed", id, Map.of(
                "fromStatus", current.status(), "toStatus", target));
        return requireNotice(actor.tenantId(), id);
    }

    @Transactional
    public List<InternalNoticeRecord> archiveBatch(Actor actor,
            List<VersionedNotice> notices) {
        requireActor(actor);
        if (notices == null || notices.isEmpty() || notices.size() > 100
                || notices.stream().anyMatch(value -> value == null
                || value.id() == null || value.version() < 0)
                || notices.stream().map(VersionedNotice::id).distinct().count()
                != notices.size()) {
            throw new IllegalArgumentException("Notices to archive are invalid");
        }
        return notices.stream().map(item -> transition(actor, item.id(),
                item.version(), "ARCHIVED")).toList();
    }

    private InternalNoticeRecord requireNotice(UUID tenantId, UUID id) {
        if (id == null) throw new ResourceNotFoundException("Notice was not found");
        InternalNoticeRecord value = repository.find(tenantId, id);
        if (value == null) throw new ResourceNotFoundException("Notice was not found");
        return value;
    }

    private void audit(Actor actor, String action, UUID id,
            Map<String, String> details) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(), action,
                "internal_notice", id.toString(), actor.requestId(),
                actor.sourceIp(), details));
    }

    private static Filters normalize(Filters filters) {
        Filters value = filters == null ? new Filters(null, null, null) : filters;
        String status = value.status() == null || value.status().isBlank()
                ? "ACTIVE" : value.status().strip().toUpperCase();
        if (!List.of("ACTIVE", "ARCHIVED").contains(status)) {
            throw new IllegalArgumentException("Notice status is invalid");
        }
        return new Filters(optional(value.title(), 160), status, value.pinned());
    }

    private static NoticeInput normalize(NoticeInput input) {
        if (input == null) throw new IllegalArgumentException("Notice is required");
        return new NoticeInput(
                required(input.title(), 160, "Notice title is invalid"),
                requiredMultiline(input.content(), 4000,
                        "Notice content is invalid"),
                input.pinned());
    }

    private static String required(String value, int maximum, String message) {
        String normalized = value == null ? "" : value.strip();
        if (normalized.isEmpty() || normalized.length() > maximum
                || normalized.chars().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException(message);
        }
        return normalized;
    }

    private static String optional(String value, int maximum) {
        return value == null || value.isBlank()
                ? null : required(value, maximum, "Notice text is invalid");
    }

    private static String requiredMultiline(String value, int maximum,
            String message) {
        String normalized = value == null ? "" : value.strip();
        if (normalized.isEmpty() || normalized.length() > maximum
                || normalized.chars().anyMatch(character ->
                        Character.isISOControl(character)
                                && character != '\n' && character != '\r')) {
            throw new IllegalArgumentException(message);
        }
        return normalized;
    }

    private static void requireActor(Actor actor) {
        if (actor == null || actor.tenantId() == null
                || (actor.userId() == null) == (actor.systemAdminId() == null)
                || actor.requestId() == null
                || !actor.requestId().matches("^[A-Za-z0-9._:-]{1,100}$")) {
            throw new AccessDeniedException("A tenant actor is required");
        }
        required(actor.displayName(), 160, "Actor display name is invalid");
    }

    public record Actor(UUID tenantId, UUID userId, UUID systemAdminId,
            String displayName, String requestId, String sourceIp) {
    }

    public record NoticeInput(String title, String content, boolean pinned) {
    }

    public record Filters(String title, String status, Boolean pinned) {
    }

    public record VersionedNotice(UUID id, long version) {
    }
}
