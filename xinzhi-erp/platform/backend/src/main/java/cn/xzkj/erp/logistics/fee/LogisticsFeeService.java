package cn.xzkj.erp.logistics.fee;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class LogisticsFeeService {
    private static final Set<String> SEARCH_FIELDS = Set.of(
            "ORDER_NO", "TRACKING_NO", "TRANSACTION_NO");
    private static final Set<String> FILTER_STATUSES = Set.of(
            "UNCONFIRMED", "CONFIRMED", "ARCHIVED");
    private static final Pattern CURRENCY = Pattern.compile("^[A-Z]{3}$");
    private static final BigDecimal MAX_FEE = new BigDecimal("99999999999999.9999");
    private static final BigDecimal MAX_WEIGHT = new BigDecimal("999999999.999");
    private final LogisticsFeeRepository repository;
    private final SecurityAuditRecorder auditRecorder;

    public LogisticsFeeService(LogisticsFeeRepository repository,
            SecurityAuditRecorder auditRecorder) {
        this.repository = repository;
        this.auditRecorder = auditRecorder;
    }

    @Transactional(readOnly = true)
    public Page<LogisticsFeeRecord> list(Actor actor, Filters filters,
            Pageable pageable) {
        requireActor(actor);
        return repository.list(actor.tenantId(), normalize(filters), pageable);
    }

    @Transactional
    public LogisticsFeeRecord create(Actor actor, FeeInput input) {
        requireActor(actor);
        FeeInput normalized = normalize(input);
        UUID id = UUID.randomUUID();
        try {
            repository.insert(id, actor.tenantId(), normalized, actor);
        } catch (DataIntegrityViolationException exception) {
            throw new ConflictException("An active fee record already exists for this tracking reference");
        }
        audit(actor, "logistics.fee.created", id, normalized.trackingReference());
        return requireRecord(actor.tenantId(), id);
    }

    @Transactional
    public LogisticsFeeRecord update(Actor actor, UUID id, long version,
            FeeInput input) {
        requireActor(actor);
        LogisticsFeeRecord current = requireRecord(actor.tenantId(), id);
        if (!"ACTIVE".equals(current.lifecycleStatus())
                || !"UNCONFIRMED".equals(current.confirmationStatus())) {
            throw new ConflictException("Only an active unconfirmed fee record can be edited");
        }
        FeeInput normalized = normalize(input);
        try {
            if (version < 0 || !repository.update(actor.tenantId(), id, version,
                    normalized, actor)) {
                throw new ConflictException("Fee record changed concurrently");
            }
        } catch (DataIntegrityViolationException exception) {
            throw new ConflictException("An active fee record already exists for this tracking reference");
        }
        audit(actor, "logistics.fee.updated", id, normalized.trackingReference());
        return requireRecord(actor.tenantId(), id);
    }

    @Transactional
    public LogisticsFeeRecord confirm(Actor actor, UUID id, long version) {
        requireActor(actor);
        LogisticsFeeRecord current = requireRecord(actor.tenantId(), id);
        if (current.actualFee() == null || version < 0
                || !repository.confirm(actor.tenantId(), id, version, actor)) {
            throw new ConflictException(
                    "Only an active unconfirmed record with an actual fee can be confirmed");
        }
        audit(actor, "logistics.fee.confirmed", id, current.trackingReference());
        return requireRecord(actor.tenantId(), id);
    }

    @Transactional
    public LogisticsFeeRecord archive(Actor actor, UUID id, long version) {
        requireActor(actor);
        LogisticsFeeRecord current = requireRecord(actor.tenantId(), id);
        if (version < 0 || !repository.archive(actor.tenantId(), id, version, actor)) {
            throw new ConflictException("Only an active unconfirmed fee record can be archived");
        }
        audit(actor, "logistics.fee.archived", id, current.trackingReference());
        return requireRecord(actor.tenantId(), id);
    }

    private LogisticsFeeRecord requireRecord(UUID tenantId, UUID id) {
        if (id == null) throw new IllegalArgumentException("Fee record id is required");
        LogisticsFeeRecord value = repository.find(tenantId, id);
        if (value == null) throw new ResourceNotFoundException("Fee record was not found");
        return value;
    }

    private void audit(Actor actor, String action, UUID id, String trackingReference) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(), action,
                "logistics_fee_record", id.toString(), actor.requestId(),
                actor.sourceIp(), Map.of("trackingReference", trackingReference)));
    }

    private static FeeInput normalize(FeeInput value) {
        if (value == null || value.shippedOn() == null) {
            throw new IllegalArgumentException("Fee record and shipped date are required");
        }
        BigDecimal estimated = decimal(value.estimatedFee(), 4, MAX_FEE, true, "Estimated fee");
        BigDecimal actual = decimal(value.actualFee(), 4, MAX_FEE, true, "Actual fee");
        if (estimated == null && actual == null) {
            throw new IllegalArgumentException("Estimated fee or actual fee is required");
        }
        String currency = required(value.currency(), 3).toUpperCase(Locale.ROOT);
        if (!CURRENCY.matcher(currency).matches()) {
            throw new IllegalArgumentException("Currency must be an ISO three-letter code");
        }
        return new FeeInput(
                required(value.platformName(), 100), required(value.shopName(), 100),
                required(value.channelName(), 120), required(value.orderReference(), 120),
                required(value.trackingReference(), 120),
                optional(value.transactionReference(), 120), estimated, actual, currency,
                decimal(value.carrierWeightKg(), 3, MAX_WEIGHT, false, "Carrier weight"),
                decimal(value.warehouseWeightKg(), 3, MAX_WEIGHT, false, "Warehouse weight"),
                value.shippedOn(), optional(value.note(), 500));
    }

    private static Filters normalize(Filters filters) {
        if (filters == null) {
            return new Filters("UNCONFIRMED", "ORDER_NO", null, null,
                    null, null, null, null, null);
        }
        String status = filters.status() == null
                ? "UNCONFIRMED" : filters.status().strip().toUpperCase(Locale.ROOT);
        if (!FILTER_STATUSES.contains(status)) {
            throw new IllegalArgumentException("Fee record status is invalid");
        }
        String searchField = filters.searchField() == null
                ? "ORDER_NO" : filters.searchField().strip().toUpperCase(Locale.ROOT);
        if (!SEARCH_FIELDS.contains(searchField)) {
            throw new IllegalArgumentException("Fee search field is invalid");
        }
        if (filters.shippedFrom() != null && filters.shippedTo() != null
                && filters.shippedFrom().isAfter(filters.shippedTo())) {
            throw new IllegalArgumentException("Shipped date range is invalid");
        }
        return new Filters(status, searchField,
                optionalLower(filters.platform(), 100),
                optionalLower(filters.shop(), 100),
                optionalLower(filters.channel(), 120),
                optionalLower(filters.keyword(), 120), filters.hasActualFee(),
                filters.shippedFrom(), filters.shippedTo());
    }

    private static BigDecimal decimal(BigDecimal value, int scale,
            BigDecimal maximum, boolean zeroAllowed, String field) {
        if (value == null) return null;
        BigDecimal normalized;
        try {
            normalized = value.setScale(scale, RoundingMode.UNNECESSARY);
        } catch (ArithmeticException exception) {
            throw new IllegalArgumentException(field + " has too many decimal places");
        }
        if ((zeroAllowed ? normalized.signum() < 0 : normalized.signum() <= 0)
                || normalized.compareTo(maximum) > 0) {
            throw new IllegalArgumentException(field + " is invalid");
        }
        return normalized;
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
            String displayName, String requestId, String sourceIp) {
    }

    public record FeeInput(String platformName, String shopName, String channelName,
            String orderReference, String trackingReference,
            String transactionReference, BigDecimal estimatedFee,
            BigDecimal actualFee, String currency, BigDecimal carrierWeightKg,
            BigDecimal warehouseWeightKg, LocalDate shippedOn, String note) {
    }

    public record Filters(String status, String searchField, String platform,
            String shop, String channel, String keyword, Boolean hasActualFee,
            LocalDate shippedFrom, LocalDate shippedTo) {
        String lifecycleStatus() {
            return "ARCHIVED".equals(status) ? "ARCHIVED" : "ACTIVE";
        }

        String confirmationStatus() {
            return "ARCHIVED".equals(status) ? null : status;
        }
    }
}
