package cn.xzkj.erp.product.bundle;

import java.text.Normalizer;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.product.domain.ProductStatus;

@Service
public class ProductBundleService {
    private static final Pattern BUSINESS_CODE =
            Pattern.compile("^[A-Z][A-Z0-9_-]{1,63}$");

    private final ProductBundleRepository repository;
    private final SecurityAuditRecorder auditRecorder;

    public ProductBundleService(
            ProductBundleRepository repository,
            SecurityAuditRecorder auditRecorder) {
        this.repository = repository;
        this.auditRecorder = auditRecorder;
    }

    @Transactional(readOnly = true)
    public BundlePage list(Actor actor, BundleQuery query) {
        requireActor(actor, false);
        Objects.requireNonNull(query, "Query is required");
        if (query.page() < 0 || query.size() < 1 || query.size() > 100
                || (query.fromInclusive() != null && query.toExclusive() != null
                && !query.fromInclusive().isBefore(query.toExclusive()))) {
            invalid();
        }
        ProductStatus status = query.status();
        if (status == ProductStatus.ARCHIVED) {
            return repository.list(actor.tenantId(), new BundleQuery(
                    status, optional(query.keyword(), 100),
                    query.fromInclusive(), query.toExclusive(),
                    query.page(), query.size()));
        }
        return repository.list(actor.tenantId(), new BundleQuery(
                status, optional(query.keyword(), 100),
                query.fromInclusive(), query.toExclusive(),
                query.page(), query.size()));
    }

    @Transactional(readOnly = true)
    public ProductBundleRecord get(Actor actor, UUID id) {
        requireActor(actor, false);
        if (id == null) invalid();
        return repository.find(actor.tenantId(), id).orElseThrow(
                () -> new ResourceNotFoundException(
                        "Product bundle was not found"));
    }

    @Transactional
    public ProductBundleRecord create(Actor actor, BundleDraft draft) {
        requireActor(actor, true);
        BundleInput input = normalize(draft, true);
        if (repository.existsByBusinessCode(
                actor.tenantId(), input.businessCodeKey())) {
            throw new ConflictException("Product bundle code already exists");
        }
        requireAvailableSkus(actor.tenantId(), input.components());
        UUID id = UUID.randomUUID();
        try {
            repository.insert(actor.tenantId(), id, input, actor);
        } catch (DataIntegrityViolationException exception) {
            throw new ConflictException("Product bundle data is invalid");
        }
        audit(actor, "product.bundle.created", id, input);
        return repository.find(actor.tenantId(), id).orElseThrow();
    }

    @Transactional
    public ProductBundleRecord update(
            Actor actor,
            UUID id,
            long expectedVersion,
            BundleDraft draft) {
        requireActor(actor, true);
        if (id == null || expectedVersion < 0) invalid();
        ProductBundleRecord current = repository.find(actor.tenantId(), id)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Product bundle was not found"));
        if (current.status() == ProductStatus.ARCHIVED) {
            throw new ConflictException("Archived product bundle cannot be changed");
        }
        BundleInput input = normalize(new BundleDraft(
                current.businessCode(), draft.name(), draft.description(),
                draft.status(), draft.components()), false);
        requireAvailableSkus(actor.tenantId(), input.components());
        try {
            if (!repository.update(
                    actor.tenantId(), id, expectedVersion, input, actor)) {
                conflict();
            }
        } catch (DataIntegrityViolationException exception) {
            throw new ConflictException("Product bundle data is invalid");
        }
        audit(actor, "product.bundle.updated", id, input);
        return repository.find(actor.tenantId(), id).orElseThrow();
    }

    @Transactional
    public ProductBundleRecord archive(
            Actor actor,
            UUID id,
            long expectedVersion) {
        requireActor(actor, true);
        if (id == null || expectedVersion < 0) invalid();
        ProductBundleRecord current = repository.find(actor.tenantId(), id)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Product bundle was not found"));
        if (current.status() == ProductStatus.ARCHIVED) {
            return current;
        }
        if (!repository.archive(
                actor.tenantId(), id, expectedVersion, actor)) {
            conflict();
        }
        BundleInput input = new BundleInput(
                current.businessCode(),
                current.businessCode().toLowerCase(Locale.ROOT),
                current.name(), current.description(), ProductStatus.ARCHIVED,
                current.components().stream()
                        .map(component -> new ComponentInput(
                                component.skuId(), component.quantity()))
                        .toList());
        audit(actor, "product.bundle.archived", id, input);
        return repository.find(actor.tenantId(), id).orElseThrow();
    }

    private void requireAvailableSkus(
            UUID tenantId,
            List<ComponentInput> components) {
        List<UUID> ids = components.stream().map(ComponentInput::skuId).toList();
        if (repository.availableSkuIds(tenantId, ids).size() != ids.size()) {
            throw new ConflictException(
                    "A product bundle component is unavailable");
        }
    }

    private static BundleInput normalize(BundleDraft draft, boolean create) {
        if (draft == null || draft.components() == null
                || draft.components().isEmpty()
                || draft.components().size() > 100) {
            invalid();
        }
        String businessCode = required(draft.businessCode(), 64)
                .toUpperCase(Locale.ROOT);
        if (!BUSINESS_CODE.matcher(businessCode).matches()) invalid();
        String name = required(draft.name(), 200);
        ProductStatus status = create && draft.status() == null
                ? ProductStatus.ACTIVE : draft.status();
        if (status != ProductStatus.ACTIVE
                && status != ProductStatus.INACTIVE) {
            invalid();
        }
        List<ComponentInput> components = List.copyOf(draft.components());
        if (components.stream().anyMatch(component -> component == null
                || component.skuId() == null
                || component.quantity() < 1
                || component.quantity() > 1_000_000)
                || new HashSet<>(components.stream()
                        .map(ComponentInput::skuId).toList()).size()
                        != components.size()) {
            invalid();
        }
        return new BundleInput(
                businessCode, businessCode.toLowerCase(Locale.ROOT), name,
                optional(draft.description(), 1000), status, components);
    }

    private static String required(String value, int max) {
        String normalized = optional(value, max);
        if (normalized == null) invalid();
        return normalized;
    }

    private static String optional(String value, int max) {
        if (value == null) return null;
        String normalized = Normalizer.normalize(value, Normalizer.Form.NFKC)
                .strip();
        if (normalized.isEmpty()) return null;
        if (normalized.length() > max || normalized.codePoints()
                .anyMatch(Character::isISOControl)) {
            invalid();
        }
        return normalized;
    }

    private void audit(
            Actor actor,
            String action,
            UUID id,
            BundleInput input) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(),
                action, "product_bundle", id.toString(), actor.requestId(),
                actor.sourceIp(), Map.of(
                        "businessCode", input.businessCode(),
                        "status", input.status().name(),
                        "componentCount", Integer.toString(
                                input.components().size()))));
    }

    private static void requireActor(Actor actor, boolean requestRequired) {
        if (actor == null || actor.tenantId() == null
                || (actor.userId() == null) == (actor.systemAdminId() == null)
                || (requestRequired && (actor.requestId() == null
                || !actor.requestId().matches("^[A-Za-z0-9._:-]{1,100}$")
                || actor.displayName() == null
                || actor.displayName().isBlank()))) {
            throw new AccessDeniedException("A tenant actor is required");
        }
    }

    private static void invalid() {
        throw new IllegalArgumentException("Product bundle is invalid");
    }

    private static void conflict() {
        throw new ConflictException("Product bundle changed concurrently");
    }

    public record Actor(
            UUID tenantId,
            UUID userId,
            UUID systemAdminId,
            String displayName,
            String requestId,
            String sourceIp) {
    }

    public record ComponentInput(UUID skuId, int quantity) {
    }

    public record BundleDraft(
            String businessCode,
            String name,
            String description,
            ProductStatus status,
            List<ComponentInput> components) {
        public BundleDraft {
            components = components == null ? null : List.copyOf(components);
        }
    }

    record BundleInput(
            String businessCode,
            String businessCodeKey,
            String name,
            String description,
            ProductStatus status,
            List<ComponentInput> components) {
        BundleInput {
            components = List.copyOf(components);
        }
    }

    public record BundleQuery(
            ProductStatus status,
            String keyword,
            Instant fromInclusive,
            Instant toExclusive,
            int page,
            int size) {
    }

    public record BundlePage(
            List<ProductBundleRecord> items,
            int page,
            int size,
            long totalElements) {
        public BundlePage {
            items = List.copyOf(items);
        }

        public int totalPages() {
            return totalElements == 0 ? 0
                    : (int) ((totalElements + size - 1) / size);
        }
    }
}
