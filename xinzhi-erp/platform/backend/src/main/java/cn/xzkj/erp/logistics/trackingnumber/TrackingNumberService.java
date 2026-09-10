package cn.xzkj.erp.logistics.trackingnumber;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;

@Service
public class TrackingNumberService {
    private static final String TRACKING_NUMBERS_IMPORTED =
            "logistics.tracking_numbers.imported";
    private static final String TRACKING_NUMBER_ARCHIVED =
            "logistics.tracking_number.archived";
    private final TrackingNumberRepository repository;
    private final SecurityAuditRecorder auditRecorder;

    public TrackingNumberService(
            TrackingNumberRepository repository,
            SecurityAuditRecorder auditRecorder) {
        this.repository = repository;
        this.auditRecorder = auditRecorder;
    }

    @Transactional(readOnly = true)
    public Page<TrackingNumberRecord> list(
            Actor actor, String type, String usage, String channel,
            String searchField, String keyword, Pageable pageable) {
        requireActor(actor);
        return repository.list(actor.tenantId(), optionalType(type), usage(usage),
                normalize(channel, 100), searchField(searchField),
                normalize(keyword, 120), pageable);
    }

    @Transactional
    public ImportResult importNumbers(
            Actor actor, String type, String channel, List<String> references) {
        requireActor(actor);
        String normalizedType = requiredType(type);
        String normalizedChannel = required(channel, 100, "Channel is invalid");
        if (references == null || references.isEmpty() || references.size() > 500) {
            throw new IllegalArgumentException("Tracking number batch size is invalid");
        }
        LinkedHashSet<String> unique = new LinkedHashSet<>();
        for (String reference : references) {
            String normalized = required(reference, 160, "Tracking number is invalid");
            if (normalized.chars().anyMatch(Character::isISOControl)
                    || !unique.add(normalized)) {
                throw new IllegalArgumentException("Tracking number batch contains duplicates");
            }
        }
        UUID batchId = UUID.randomUUID();
        try {
            for (String reference : unique) {
                repository.insert(UUID.randomUUID(), actor.tenantId(), batchId,
                        normalizedType, normalizedChannel, reference,
                        actor.userId(), actor.systemAdminId(), actor.requestId());
            }
        } catch (DataIntegrityViolationException exception) {
            throw new ConflictException("Tracking number already exists");
        }
        audit(actor, TRACKING_NUMBERS_IMPORTED, "tracking_number_batch",
                batchId, Map.of("count", Integer.toString(unique.size()),
                        "type", normalizedType));
        return new ImportResult(batchId, unique.size());
    }

    @Transactional
    public TrackingNumberRecord archive(Actor actor, UUID id, long version) {
        requireActor(actor);
        if (id == null || version < 0) throw new IllegalArgumentException("Tracking number is invalid");
        TrackingNumberRecord current = repository.find(actor.tenantId(), id);
        if (current == null) throw new ResourceNotFoundException("Tracking number was not found");
        if (!"UNUSED".equals(current.status())
                || !repository.archive(actor.tenantId(), id, version)) {
            throw new ConflictException("Used or changed tracking number cannot be archived");
        }
        TrackingNumberRecord updated = repository.find(actor.tenantId(), id);
        audit(actor, TRACKING_NUMBER_ARCHIVED, "tracking_number", id,
                Map.of("previousVersion", Long.toString(current.version()),
                        "status", "ARCHIVED"));
        return updated;
    }

    private void audit(Actor actor, String action, String resourceType,
            UUID resourceId, Map<String, String> details) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(), action,
                resourceType, resourceId.toString(), actor.requestId(),
                actor.sourceIp(), details));
    }

    private static void requireActor(Actor actor) {
        if (actor == null || actor.tenantId() == null
                || (actor.userId() == null) == (actor.systemAdminId() == null)
                || actor.requestId() == null
                || !actor.requestId().matches("^[A-Za-z0-9._:-]{1,100}$")) {
            throw new AccessDeniedException("A tenant actor is required");
        }
    }

    private static String optionalType(String value) {
        if (value == null || value.isBlank()) return null;
        return requiredType(value);
    }
    private static String requiredType(String value) {
        String normalized = value == null ? "" : value.strip().toUpperCase(Locale.ROOT);
        if (!List.of("DOMESTIC_EXPRESS", "CUSTOM_LOGISTICS").contains(normalized)) {
            throw new IllegalArgumentException("Tracking number type is invalid");
        }
        return normalized;
    }
    private static String usage(String value) {
        String normalized = value == null || value.isBlank()
                ? "ALL" : value.strip().toUpperCase(Locale.ROOT);
        if (!List.of("ALL", "USED", "UNUSED", "ARCHIVED").contains(normalized)) {
            throw new IllegalArgumentException("Tracking number status is invalid");
        }
        return normalized;
    }
    private static String searchField(String value) {
        return "ORDER_NO".equalsIgnoreCase(value) ? "ORDER_NO" : "TRACKING_NO";
    }
    private static String normalize(String value, int maximum) {
        if (value == null || value.isBlank()) return null;
        String normalized = value.strip().toLowerCase(Locale.ROOT);
        if (normalized.length() > maximum) throw new IllegalArgumentException("Filter is invalid");
        return normalized;
    }
    private static String required(String value, int maximum, String message) {
        String normalized = value == null ? "" : value.strip();
        if (normalized.isEmpty() || normalized.length() > maximum) {
            throw new IllegalArgumentException(message);
        }
        return normalized;
    }

    public record Actor(UUID tenantId, UUID userId, UUID systemAdminId,
            String requestId, String sourceIp) {}
    public record ImportResult(UUID batchId, int importedCount) {}
}
