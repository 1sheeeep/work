package cn.xzkj.erp.settings.exception;

import java.text.Normalizer;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
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
public class OrderExceptionCategoryService {
    private static final String SAVED = "settings.order_exception_categories.saved";
    private final OrderExceptionCategoryRepository repository;
    private final SecurityAuditRecorder auditRecorder;

    public OrderExceptionCategoryService(OrderExceptionCategoryRepository repository,
            SecurityAuditRecorder auditRecorder) {
        this.repository = repository;
        this.auditRecorder = auditRecorder;
    }

    @Transactional(readOnly = true)
    public OrderExceptionCategoryRecord get(Actor actor) {
        requireActor(actor, false);
        return repository.find(actor.tenantId());
    }

    @Transactional
    public OrderExceptionCategoryRecord save(Actor actor, long expectedRevision,
            List<CategoryDraft> drafts) {
        requireActor(actor, true);
        if (expectedRevision < 0 || drafts == null || drafts.size() > 50) {
            throw new IllegalArgumentException("Category request is invalid");
        }
        List<CategoryInput> items = normalize(drafts);
        OrderExceptionCategoryRecord current = repository.find(actor.tenantId());
        if (current.revision() != expectedRevision) conflict();
        try {
            if (!current.configured()) {
                repository.insertSet(actor.tenantId(), actor);
            } else if (!repository.updateSet(actor.tenantId(), expectedRevision, actor)) {
                conflict();
            }
            repository.replaceItems(actor.tenantId(), items, actor);
        } catch (DataIntegrityViolationException exception) {
            throw new ConflictException("Order exception categories conflict");
        }
        long enabledCount = items.stream().filter(CategoryInput::enabled).count();
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(), SAVED,
                "order_exception_category_set", actor.tenantId().toString(),
                actor.requestId(), actor.sourceIp(), Map.of(
                        "categoryCount", Integer.toString(items.size()),
                        "enabledCount", Long.toString(enabledCount))));
        return repository.find(actor.tenantId());
    }

    private static List<CategoryInput> normalize(List<CategoryDraft> drafts) {
        HashSet<String> names = new HashSet<>();
        HashSet<UUID> ids = new HashSet<>();
        return java.util.stream.IntStream.range(0, drafts.size()).mapToObj(index -> {
            CategoryDraft draft = drafts.get(index);
            if (draft == null) throw new IllegalArgumentException("Category is required");
            UUID id = draft.id() == null ? UUID.randomUUID() : draft.id();
            if (!ids.add(id)) throw new IllegalArgumentException("Category id is duplicated");
            String name = required(draft.name(), 80);
            String key = name.toLowerCase(Locale.ROOT);
            if (!names.add(key)) throw new IllegalArgumentException("Category name is duplicated");
            return new CategoryInput(id, name, key,
                    optional(draft.handlingGuidance(), 240), draft.enabled());
        }).toList();
    }

    private static String required(String value, int max) {
        String normalized = optional(value, max);
        if (normalized == null) throw new IllegalArgumentException("Text is required");
        return normalized;
    }

    private static String optional(String value, int max) {
        if (value == null) return null;
        String normalized = Normalizer.normalize(value, Normalizer.Form.NFKC).strip();
        if (normalized.isEmpty()) return null;
        if (normalized.length() > max || normalized.codePoints()
                .anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException("Text is invalid");
        }
        return normalized;
    }

    private static void conflict() {
        throw new ConflictException("Order exception categories changed concurrently");
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

    public record CategoryDraft(UUID id, String name, String handlingGuidance,
            boolean enabled) {
    }

    record CategoryInput(UUID id, String name, String nameKey,
            String handlingGuidance, boolean enabled) {
    }
}
