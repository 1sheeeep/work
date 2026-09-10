package cn.xzkj.erp.logistics.labeltemplate;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class LabelTemplateService {
    private static final List<LabelTemplateRecord> STANDARD_TEMPLATES = List.of(
            standard(
                    "84000000-0000-4000-8000-000000000001",
                    "通用地址标签",
                    "地址标签",
                    100,
                    100,
                    "收件人：{{recipient}}\n地址：{{address}}\n订单号：{{order_number}}"),
            standard(
                    "84000000-0000-4000-8000-000000000002",
                    "通用商品标签",
                    "商品标签",
                    60,
                    40,
                    "{{name}}\nSKU：{{sku}}"));

    private final LabelTemplateRepository repository;
    private final SecurityAuditRecorder auditRecorder;

    public LabelTemplateService(
            LabelTemplateRepository repository,
            SecurityAuditRecorder auditRecorder) {
        this.repository = repository;
        this.auditRecorder = auditRecorder;
    }

    @Transactional(readOnly = true)
    public Page<LabelTemplateRecord> list(
            Actor actor,
            String scope,
            String documentCategory,
            String size,
            String keyword,
            Pageable pageable) {
        requireActor(actor);
        String normalizedScope = required(scope, 16).toUpperCase(Locale.ROOT);
        String category = optional(documentCategory, 80);
        String normalizedSize = normalizeSize(size);
        String name = optional(keyword, 120);
        if ("CUSTOM".equals(normalizedScope)) {
            return repository.list(
                    actor.tenantId(), category, normalizedSize, name, pageable);
        }
        if (!"STANDARD".equals(normalizedScope)) {
            throw new IllegalArgumentException("Template scope is invalid");
        }
        List<LabelTemplateRecord> filtered = STANDARD_TEMPLATES.stream()
                .filter(value -> category == null
                        || value.documentCategory().toLowerCase(Locale.ROOT)
                                .contains(category.toLowerCase(Locale.ROOT)))
                .filter(value -> normalizedSize == null
                        || normalizedSize.equals(
                                value.widthMm() + "x" + value.heightMm()))
                .filter(value -> name == null
                        || value.name().toLowerCase(Locale.ROOT)
                                .contains(name.toLowerCase(Locale.ROOT)))
                .toList();
        int from = Math.min((int) pageable.getOffset(), filtered.size());
        int to = Math.min(from + pageable.getPageSize(), filtered.size());
        return new PageImpl<>(
                new ArrayList<>(filtered.subList(from, to)),
                pageable,
                filtered.size());
    }

    @Transactional
    public LabelTemplateRecord create(Actor actor, TemplateInput input) {
        requireActor(actor);
        TemplateInput normalized = normalize(input);
        UUID id = UUID.randomUUID();
        try {
            repository.insert(id, actor.tenantId(), normalized, actor);
        } catch (DataIntegrityViolationException exception) {
            throw new ConflictException(
                    "An active label template with this name already exists");
        }
        audit(actor, "logistics.label_template.created", id,
                Map.of("documentCategory", normalized.documentCategory()));
        return requireTemplate(actor.tenantId(), id);
    }

    @Transactional
    public LabelTemplateRecord archive(Actor actor, UUID id, long version) {
        requireActor(actor);
        LabelTemplateRecord current = requireTemplate(actor.tenantId(), id);
        if (!"ACTIVE".equals(current.status()) || version < 0
                || !repository.archive(actor.tenantId(), id, version, actor)) {
            throw new ConflictException(
                    "Label template changed concurrently or is archived");
        }
        audit(actor, "logistics.label_template.archived", id,
                Map.of("previousVersion", Long.toString(version)));
        return requireTemplate(actor.tenantId(), id);
    }

    private LabelTemplateRecord requireTemplate(UUID tenantId, UUID id) {
        if (id == null) throw new IllegalArgumentException("Template id is required");
        LabelTemplateRecord value = repository.find(tenantId, id);
        if (value == null) {
            throw new ResourceNotFoundException("Label template was not found");
        }
        return value;
    }

    private void audit(
            Actor actor,
            String action,
            UUID id,
            Map<String, String> details) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(), action,
                "logistics_label_template", id.toString(), actor.requestId(),
                actor.sourceIp(), details));
    }

    private static TemplateInput normalize(TemplateInput input) {
        if (input == null || input.widthMm() < 20 || input.widthMm() > 300
                || input.heightMm() < 20 || input.heightMm() > 300) {
            throw new IllegalArgumentException("Label dimensions are invalid");
        }
        return new TemplateInput(
                required(input.name(), 120),
                required(input.documentCategory(), 80),
                input.widthMm(),
                input.heightMm(),
                required(input.content(), 4000),
                optional(input.note(), 500));
    }

    private static String normalizeSize(String value) {
        String normalized = optional(value, 40);
        if (normalized == null) return null;
        normalized = normalized.toLowerCase(Locale.ROOT)
                .replace("毫米", "")
                .replace("mm", "")
                .replace('×', 'x')
                .replace(" ", "");
        if (!normalized.matches("^[0-9]{2,3}x[0-9]{2,3}$")) {
            throw new IllegalArgumentException("Template size is invalid");
        }
        return normalized;
    }

    private static String required(String value, int maximum) {
        String normalized = value == null ? "" : value.strip();
        if (normalized.isEmpty() || normalized.length() > maximum
                || normalized.chars().anyMatch(character ->
                        Character.isISOControl(character)
                                && character != '\n' && character != '\r'
                                && character != '\t')) {
            throw new IllegalArgumentException("Text value is invalid");
        }
        return normalized;
    }

    private static String optional(String value, int maximum) {
        return value == null || value.isBlank() ? null : required(value, maximum);
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

    private static LabelTemplateRecord standard(
            String id,
            String name,
            String category,
            int width,
            int height,
            String content) {
        Instant fixed = Instant.parse("2026-01-01T00:00:00Z");
        return new LabelTemplateRecord(
                UUID.fromString(id), "STANDARD", name, category, width, height,
                content, null, "ACTIVE", "系统内置", 0, fixed, fixed);
    }

    public record Actor(
            UUID tenantId,
            UUID userId,
            UUID systemAdminId,
            String displayName,
            String requestId,
            String sourceIp) {
    }

    public record TemplateInput(
            String name,
            String documentCategory,
            int widthMm,
            int heightMm,
            String content,
            String note) {
    }
}
