package cn.xzkj.erp.settings.approval;

import java.text.Normalizer;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;

@Service
public class ApprovalRuleService {
    private final ApprovalRuleRepository repository;
    private final SecurityAuditRecorder auditRecorder;

    public ApprovalRuleService(ApprovalRuleRepository repository,
            SecurityAuditRecorder auditRecorder) {
        this.repository = repository;
        this.auditRecorder = auditRecorder;
    }

    @Transactional(readOnly = true)
    public RulePage list(Actor actor, RuleQuery query) {
        requireActor(actor, false);
        Objects.requireNonNull(query, "Query is required");
        if (query.page() < 0 || query.size() < 1 || query.size() > 100) {
            throw new IllegalArgumentException("Pagination is invalid");
        }
        return repository.list(actor.tenantId(), new RuleQuery(query.enabled(),
                query.documentType(), optional(query.keyword(), 120), query.page(),
                query.size()));
    }

    @Transactional(readOnly = true)
    public List<ApproverCandidate> candidates(Actor actor) {
        requireActor(actor, false);
        return repository.candidates(actor.tenantId());
    }

    @Transactional
    public ApprovalRuleRecord create(Actor actor, RuleDraft draft) {
        requireActor(actor, true);
        RuleInput input = normalize(draft);
        UUID id = UUID.randomUUID();
        try {
            repository.insert(actor.tenantId(), id, input, actor);
        } catch (DataIntegrityViolationException exception) {
            throw new ConflictException("Approval rule name or approver is invalid");
        }
        audit(actor, "settings.approval_rule.created", id, input);
        return repository.find(actor.tenantId(), id).orElseThrow();
    }

    @Transactional
    public ApprovalRuleRecord update(Actor actor, UUID id, long expectedVersion,
            RuleDraft draft) {
        requireActor(actor, true);
        if (id == null || expectedVersion < 0) invalid();
        repository.find(actor.tenantId(), id).orElseThrow(
                () -> new ResourceNotFoundException("Approval rule was not found"));
        RuleInput input = normalize(draft);
        try {
            if (!repository.update(actor.tenantId(), id, expectedVersion, input,
                    actor)) conflict();
        } catch (DataIntegrityViolationException exception) {
            throw new ConflictException("Approval rule name or approver is invalid");
        }
        audit(actor, "settings.approval_rule.updated", id, input);
        return repository.find(actor.tenantId(), id).orElseThrow();
    }

    @Transactional
    public ApprovalRuleRecord setEnabled(Actor actor, UUID id,
            long expectedVersion, boolean enabled) {
        requireActor(actor, true);
        ApprovalRuleRecord current = repository.find(actor.tenantId(), id)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Approval rule was not found"));
        if (!repository.setEnabled(actor.tenantId(), id, expectedVersion, enabled,
                actor)) conflict();
        RuleInput input = new RuleInput(current.priority(), current.name(),
                current.name().toLowerCase(Locale.ROOT), current.documentType(),
                current.description(), enabled, current.approvers().stream()
                        .map(ApprovalRuleRecord.Approver::userId).toList());
        audit(actor, "settings.approval_rule.status_changed", id, input);
        return repository.find(actor.tenantId(), id).orElseThrow();
    }

    @Transactional
    public void delete(Actor actor, UUID id, long expectedVersion) {
        requireActor(actor, true);
        ApprovalRuleRecord current = repository.find(actor.tenantId(), id)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Approval rule was not found"));
        if (!repository.delete(actor.tenantId(), id, expectedVersion)) conflict();
        RuleInput input = new RuleInput(current.priority(), current.name(),
                current.name().toLowerCase(Locale.ROOT), current.documentType(),
                current.description(), current.enabled(), current.approvers().stream()
                        .map(ApprovalRuleRecord.Approver::userId).toList());
        audit(actor, "settings.approval_rule.deleted", id, input);
    }

    private static RuleInput normalize(RuleDraft draft) {
        if (draft == null || draft.documentType() == null
                || draft.priority() < 1 || draft.priority() > 10
                || draft.approverUserIds() == null
                || draft.approverUserIds().isEmpty()
                || draft.approverUserIds().size() > 5) invalid();
        List<UUID> approvers = List.copyOf(draft.approverUserIds());
        if (approvers.stream().anyMatch(Objects::isNull)
                || new HashSet<>(approvers).size() != approvers.size()) invalid();
        String name = required(draft.name(), 120);
        return new RuleInput(draft.priority(), name,
                name.toLowerCase(Locale.ROOT), draft.documentType(),
                optional(draft.description(), 500), draft.enabled(), approvers);
    }

    private static String required(String value, int max) {
        String normalized = optional(value, max);
        if (normalized == null) invalid();
        return normalized;
    }

    private static String optional(String value, int max) {
        if (value == null) return null;
        String normalized = Normalizer.normalize(value, Normalizer.Form.NFKC).strip();
        if (normalized.isEmpty()) return null;
        if (normalized.length() > max || normalized.codePoints()
                .anyMatch(Character::isISOControl)) invalid();
        return normalized;
    }

    private void audit(Actor actor, String action, UUID id, RuleInput input) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(actor.tenantId(),
                actor.userId(), actor.systemAdminId(), action, "approval_rule",
                id.toString(), actor.requestId(), actor.sourceIp(), Map.of(
                        "documentType", input.documentType().name(),
                        "priority", Integer.toString(input.priority()),
                        "enabled", Boolean.toString(input.enabled()),
                        "approverCount", Integer.toString(input.approverUserIds().size()))));
    }

    private static void invalid() {
        throw new IllegalArgumentException("Approval rule is invalid");
    }

    private static void conflict() {
        throw new ConflictException("Approval rule changed concurrently");
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

    public enum DocumentType {
        PROCUREMENT_ORDER, INVENTORY_COUNT, WAREHOUSE_TRANSFER,
        MANUAL_INBOUND, MANUAL_OUTBOUND
    }

    public record Actor(UUID tenantId, UUID userId, UUID systemAdminId,
            String displayName, String requestId, String sourceIp) {
    }

    public record RuleDraft(int priority, String name, DocumentType documentType,
            String description, boolean enabled, List<UUID> approverUserIds) {
    }

    record RuleInput(int priority, String name, String nameKey,
            DocumentType documentType, String description, boolean enabled,
            List<UUID> approverUserIds) {
        RuleInput { approverUserIds = List.copyOf(approverUserIds); }
    }

    public record RuleQuery(Boolean enabled, DocumentType documentType,
            String keyword, int page, int size) {
    }

    public record RulePage(List<ApprovalRuleRecord> items, int page, int size,
            long totalElements) {
        public RulePage { items = List.copyOf(items); }
        public int totalPages() {
            return totalElements == 0 ? 0
                    : (int) ((totalElements + size - 1) / size);
        }
    }

    public record ApproverCandidate(UUID userId, String displayName) {
    }
}
