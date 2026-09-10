package cn.xzkj.erp.product.supplyprice;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.Normalizer;
import java.time.LocalDate;
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
import cn.xzkj.erp.product.domain.ProductStatus;
import cn.xzkj.erp.product.supplyprice.ProductSupplyPriceRecord.SkuType;

@Service
public class ProductSupplyPriceService {
    private final ProductSupplyPriceRepository repository;
    private final SecurityAuditRecorder auditRecorder;

    public ProductSupplyPriceService(
            ProductSupplyPriceRepository repository,
            SecurityAuditRecorder auditRecorder) {
        this.repository = repository;
        this.auditRecorder = auditRecorder;
    }

    @Transactional(readOnly = true)
    public PricePage list(Actor actor, PriceQuery query) {
        requireActor(actor, false);
        Objects.requireNonNull(query, "Query is required");
        if (query.page() < 0 || query.size() < 1 || query.size() > 100) {
            invalid();
        }
        return repository.list(actor.tenantId(), new PriceQuery(
                query.status(), query.skuType(), optional(query.country(), 2,
                        true), optional(query.keyword(), 100, false),
                query.page(), query.size()));
    }

    @Transactional(readOnly = true)
    public ProductSupplyPriceRecord get(Actor actor, UUID id) {
        requireActor(actor, false);
        if (id == null) invalid();
        return find(actor.tenantId(), id);
    }

    @Transactional
    public ProductSupplyPriceRecord create(Actor actor, PriceDraft draft) {
        requireActor(actor, true);
        PriceInput input = normalize(draft, true);
        requireTarget(actor.tenantId(), input);
        requireNoOverlap(actor.tenantId(), null, input);
        UUID id = UUID.randomUUID();
        try {
            repository.insert(actor.tenantId(), id, input, actor);
        } catch (DataIntegrityViolationException exception) {
            throw new ConflictException("Supply price data is invalid");
        }
        audit(actor, "product.supply_price.created", id, input);
        return find(actor.tenantId(), id);
    }

    @Transactional
    public ProductSupplyPriceRecord update(
            Actor actor,
            UUID id,
            long expectedVersion,
            PriceDraft draft) {
        requireActor(actor, true);
        if (id == null || expectedVersion < 0) invalid();
        ProductSupplyPriceRecord current = find(actor.tenantId(), id);
        if (current.status() == ProductStatus.ARCHIVED) {
            throw new ConflictException("Archived supply price cannot be changed");
        }
        PriceInput input = normalize(new PriceDraft(
                current.skuType(), current.referenceId(), current.salesCountry(),
                draft.currency(), draft.unitPrice(), draft.minimumQuantity(),
                draft.validFrom(), draft.validTo(), draft.status(), draft.note()),
                false);
        requireNoOverlap(actor.tenantId(), id, input);
        try {
            if (!repository.update(actor.tenantId(), id, expectedVersion,
                    input, actor)) {
                conflict();
            }
        } catch (DataIntegrityViolationException exception) {
            throw new ConflictException("Supply price data is invalid");
        }
        audit(actor, "product.supply_price.updated", id, input);
        return find(actor.tenantId(), id);
    }

    @Transactional
    public ProductSupplyPriceRecord archive(
            Actor actor,
            UUID id,
            long expectedVersion) {
        requireActor(actor, true);
        if (id == null || expectedVersion < 0) invalid();
        ProductSupplyPriceRecord current = find(actor.tenantId(), id);
        if (current.status() == ProductStatus.ARCHIVED) return current;
        if (!repository.archive(actor.tenantId(), id, expectedVersion, actor)) {
            conflict();
        }
        audit(actor, "product.supply_price.archived", id,
                fromRecord(current, ProductStatus.ARCHIVED));
        return find(actor.tenantId(), id);
    }

    @Transactional
    public List<ProductSupplyPriceRecord> changeStatus(
            Actor actor,
            ProductStatus status,
            List<VersionedId> items) {
        requireActor(actor, true);
        if ((status != ProductStatus.ACTIVE && status != ProductStatus.INACTIVE)
                || items == null || items.isEmpty() || items.size() > 100
                || items.stream().anyMatch(item -> item == null
                || item.id() == null || item.expectedVersion() < 0)
                || items.stream().map(VersionedId::id).distinct().count()
                != items.size()) {
            invalid();
        }
        return items.stream().map(item -> {
            ProductSupplyPriceRecord current = find(actor.tenantId(), item.id());
            PriceInput input = fromRecord(current, status);
            if (status == ProductStatus.ACTIVE) {
                requireNoOverlap(actor.tenantId(), current.id(), input);
            }
            if (!repository.update(actor.tenantId(), current.id(),
                    item.expectedVersion(), input, actor)) {
                conflict();
            }
            audit(actor, "product.supply_price.status_changed", current.id(), input);
            return find(actor.tenantId(), current.id());
        }).toList();
    }

    private ProductSupplyPriceRecord find(UUID tenantId, UUID id) {
        return repository.find(tenantId, id).orElseThrow(
                () -> new ResourceNotFoundException(
                        "Supply price was not found"));
    }

    private void requireTarget(UUID tenantId, PriceInput input) {
        if (!repository.targetAvailable(
                tenantId, input.skuType(), input.referenceId())) {
            throw new ConflictException("Supply price SKU is unavailable");
        }
    }

    private void requireNoOverlap(
            UUID tenantId,
            UUID excludedId,
            PriceInput input) {
        if (input.status() == ProductStatus.ACTIVE
                && repository.overlaps(tenantId, excludedId, input)) {
            throw new ConflictException(
                    "An active supply price already covers this period");
        }
    }

    private static PriceInput normalize(PriceDraft draft, boolean create) {
        if (draft == null || draft.skuType() == null
                || draft.referenceId() == null || draft.unitPrice() == null
                || draft.validFrom() == null || draft.minimumQuantity() < 1
                || draft.minimumQuantity() > 1_000_000
                || (draft.validTo() != null
                && draft.validTo().isBefore(draft.validFrom()))) {
            invalid();
        }
        String country = required(draft.salesCountry(), 2, true);
        String currency = required(draft.currency(), 3, true);
        if (!country.matches("^[A-Z]{2}$")
                || !currency.matches("^[A-Z]{3}$")
                || draft.unitPrice().signum() <= 0
                || draft.unitPrice().precision() > 19
                || draft.unitPrice().scale() > 4) {
            invalid();
        }
        BigDecimal price = draft.unitPrice().setScale(4, RoundingMode.UNNECESSARY);
        ProductStatus status = create && draft.status() == null
                ? ProductStatus.ACTIVE : draft.status();
        if (status != ProductStatus.ACTIVE
                && status != ProductStatus.INACTIVE) {
            invalid();
        }
        return new PriceInput(
                draft.skuType(), draft.referenceId(), country, currency, price,
                draft.minimumQuantity(), draft.validFrom(), draft.validTo(),
                status, optional(draft.note(), 500, false));
    }

    private static PriceInput fromRecord(
            ProductSupplyPriceRecord current,
            ProductStatus status) {
        return new PriceInput(
                current.skuType(), current.referenceId(), current.salesCountry(),
                current.currency(), current.unitPrice(), current.minimumQuantity(),
                current.validFrom(), current.validTo(), status, current.note());
    }

    private void audit(
            Actor actor,
            String action,
            UUID id,
            PriceInput input) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(), action,
                "product_supply_price", id.toString(), actor.requestId(),
                actor.sourceIp(), Map.of(
                        "skuType", input.skuType().name(),
                        "referenceId", input.referenceId().toString(),
                        "salesCountry", input.salesCountry(),
                        "status", input.status().name())));
    }

    private static String required(String value, int max, boolean uppercase) {
        String normalized = optional(value, max, uppercase);
        if (normalized == null) invalid();
        return normalized;
    }

    private static String optional(String value, int max, boolean uppercase) {
        if (value == null) return null;
        String normalized = Normalizer.normalize(value, Normalizer.Form.NFKC)
                .strip();
        if (uppercase) normalized = normalized.toUpperCase(Locale.ROOT);
        if (normalized.isEmpty()) return null;
        if (normalized.length() > max || normalized.codePoints()
                .anyMatch(Character::isISOControl)) {
            invalid();
        }
        return normalized;
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

    private static void invalid() {
        throw new IllegalArgumentException("Supply price is invalid");
    }

    private static void conflict() {
        throw new ConflictException("Supply price changed concurrently");
    }

    public record Actor(
            UUID tenantId,
            UUID userId,
            UUID systemAdminId,
            String displayName,
            String requestId,
            String sourceIp) {
    }

    public record PriceDraft(
            SkuType skuType,
            UUID referenceId,
            String salesCountry,
            String currency,
            BigDecimal unitPrice,
            int minimumQuantity,
            LocalDate validFrom,
            LocalDate validTo,
            ProductStatus status,
            String note) {
    }

    public record PriceInput(
            SkuType skuType,
            UUID referenceId,
            String salesCountry,
            String currency,
            BigDecimal unitPrice,
            int minimumQuantity,
            LocalDate validFrom,
            LocalDate validTo,
            ProductStatus status,
            String note) {
    }

    public record PriceQuery(
            ProductStatus status,
            SkuType skuType,
            String country,
            String keyword,
            int page,
            int size) {
    }

    public record PricePage(
            List<ProductSupplyPriceRecord> items,
            int page,
            int size,
            long totalElements) {
        public int totalPages() {
            return totalElements == 0 ? 0
                    : Math.toIntExact((totalElements + size - 1) / size);
        }
    }

    public record VersionedId(UUID id, long expectedVersion) {
    }
}
