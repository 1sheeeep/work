package cn.xzkj.erp.logistics.matchingrule;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import java.time.Instant;
import java.time.LocalTime;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MatchingRuleService {
    private final MatchingRuleRepository repository;
    private final SecurityAuditRecorder auditRecorder;

    public MatchingRuleService(MatchingRuleRepository repository,
            SecurityAuditRecorder auditRecorder) {
        this.repository = repository;
        this.auditRecorder = auditRecorder;
    }

    @Transactional(readOnly = true)
    public Page<MatchingRuleRecord> list(Actor actor, Filters filters, Pageable pageable) {
        requireActor(actor);
        return repository.list(actor.tenantId(), normalize(filters), pageable);
    }

    @Transactional
    public MatchingRuleRecord create(Actor actor, RuleInput input) {
        requireActor(actor);
        RuleInput normalized = normalize(input);
        if (!repository.isEnabledChannel(actor.tenantId(), normalized.channel())) {
            throw new ConflictException(
                    "The selected logistics channel is not enabled or is unavailable");
        }
        UUID id = UUID.randomUUID();
        try {
            repository.insert(id, actor.tenantId(), normalized, actor);
        } catch (DataIntegrityViolationException exception) {
            throw new ConflictException("An active logistics matching rule with this name already exists");
        }
        audit(actor, "logistics.matching_rule.created", id,
                Map.of("channel", normalized.channel(), "priority", Integer.toString(normalized.priority())));
        return requireRule(actor.tenantId(), id);
    }

    @Transactional
    public MatchingRuleRecord archive(Actor actor, UUID id, long version) {
        requireActor(actor);
        MatchingRuleRecord current = requireRule(actor.tenantId(), id);
        if (!"ACTIVE".equals(current.status()) || version < 0
                || !repository.archive(actor.tenantId(), id, version, actor)) {
            throw new ConflictException("Logistics matching rule changed concurrently or is archived");
        }
        audit(actor, "logistics.matching_rule.archived", id,
                Map.of("previousVersion", Long.toString(version)));
        return requireRule(actor.tenantId(), id);
    }

    private MatchingRuleRecord requireRule(UUID tenantId, UUID id) {
        if (id == null) throw new IllegalArgumentException("Rule id is required");
        MatchingRuleRecord value = repository.find(tenantId, id);
        if (value == null) throw new ResourceNotFoundException("Matching rule was not found");
        return value;
    }

    private void audit(Actor actor, String action, UUID id, Map<String, String> details) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(), action,
                "logistics_matching_rule", id.toString(), actor.requestId(),
                actor.sourceIp(), details));
    }

    private static RuleInput normalize(RuleInput input) {
        if (input == null || input.priority() < 1 || input.priority() > 9999
                || (input.noHandoverStart() == null) != (input.noHandoverEnd() == null)) {
            throw new IllegalArgumentException("Matching rule is invalid");
        }
        return new RuleInput(required(input.name(), 100), input.priority(),
                optional(input.platform(), 100), optional(input.shop(), 160),
                required(input.channel(), 160), optional(input.warehouse(), 160),
                input.autoHandover(), input.noHandoverStart(), input.noHandoverEnd(),
                optional(input.note(), 500));
    }

    private static Filters normalize(Filters filters) {
        if (filters == null) return new Filters(null, null, null, null, null, null, null, null, null);
        String status = filters.status();
        if (status != null) {
            status = status.strip().toUpperCase(Locale.ROOT);
            status = switch (status) {
                case "ENABLED", "ACTIVE" -> "ACTIVE";
                case "DISABLED", "ARCHIVED" -> "ARCHIVED";
                default -> throw new IllegalArgumentException("Status is invalid");
            };
        }
        if (filters.priority() != null && (filters.priority() < 1 || filters.priority() > 9999)) {
            throw new IllegalArgumentException("Priority is invalid");
        }
        return new Filters(optionalLower(filters.platform(), 100), optionalLower(filters.shop(), 160),
                optionalLower(filters.channel(), 160), optionalLower(filters.warehouse(), 160),
                status, filters.autoHandover(), filters.priority(), filters.updatedFrom(),
                filters.updatedToExclusive(), optionalLower(filters.name(), 100));
    }

    private static String required(String value, int maximum) {
        String normalized = value == null ? "" : value.strip();
        if (normalized.isEmpty() || normalized.length() > maximum
                || normalized.chars().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException("Text value is invalid");
        }
        return normalized;
    }

    private static String optional(String value, int maximum) {
        return value == null || value.isBlank() ? null : required(value, maximum);
    }

    private static String optionalLower(String value, int maximum) {
        String normalized = optional(value, maximum);
        return normalized == null ? null : normalized.toLowerCase(Locale.ROOT);
    }

    private static void requireActor(Actor actor) {
        if (actor == null || actor.tenantId() == null
                || (actor.userId() == null) == (actor.systemAdminId() == null)
                || actor.displayName() == null || actor.displayName().isBlank()
                || actor.requestId() == null
                || !actor.requestId().matches("^[A-Za-z0-9._:-]{1,100}$")) {
            throw new AccessDeniedException("A tenant actor is required");
        }
    }

    public record Actor(UUID tenantId, UUID userId, UUID systemAdminId,
            String displayName, String requestId, String sourceIp) { }
    public record RuleInput(String name, int priority, String platform, String shop,
            String channel, String warehouse, boolean autoHandover,
            LocalTime noHandoverStart, LocalTime noHandoverEnd, String note) { }
    public record Filters(String platform, String shop, String channel, String warehouse,
            String status, Boolean autoHandover, Integer priority, Instant updatedFrom,
            Instant updatedToExclusive, String name) {
        public Filters(String platform, String shop, String channel, String warehouse,
                String status, Boolean autoHandover, Integer priority,
                Instant updatedFrom, Instant updatedToExclusive) {
            this(platform, shop, channel, warehouse, status, autoHandover, priority,
                    updatedFrom, updatedToExclusive, null);
        }
    }
}
