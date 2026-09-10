package cn.xzkj.erp.logistics.forecast;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
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
public class LogisticsForecastBatchService {
    private static final Set<String> STATUSES = Set.of(
            "PENDING", "SUCCEEDED", "FAILED");
    private static final Pattern ORDER_REFERENCE = Pattern.compile(
            "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$");
    private static final DateTimeFormatter BATCH_TIME =
            DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss");
    private static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Shanghai");
    private final LogisticsForecastBatchRepository repository;
    private final SecurityAuditRecorder auditRecorder;

    public LogisticsForecastBatchService(
            LogisticsForecastBatchRepository repository,
            SecurityAuditRecorder auditRecorder) {
        this.repository = repository;
        this.auditRecorder = auditRecorder;
    }

    @Transactional(readOnly = true)
    public Page<LogisticsForecastBatchRecord> list(Actor actor, Filters filters,
            Pageable pageable) {
        requireActor(actor);
        return repository.list(actor.tenantId(), normalize(filters), pageable);
    }

    @Transactional
    public LogisticsForecastBatchRecord create(Actor actor, BatchInput input) {
        requireActor(actor);
        BatchInput normalized = normalize(input);
        UUID id = UUID.randomUUID();
        String batchNo = "FB-"
                + BATCH_TIME.format(ZonedDateTime.now(BUSINESS_ZONE)) + "-"
                + id.toString().replace("-", "").substring(0, 6)
                        .toUpperCase(Locale.ROOT);
        try {
            repository.insert(id, actor.tenantId(), batchNo, normalized, actor);
        } catch (DataIntegrityViolationException exception) {
            throw new ConflictException("Forecast batch could not be created");
        }
        audit(actor, "logistics.forecast_batch.created", id,
                Map.of("batchNo", batchNo,
                        "orderCount", Integer.toString(
                                normalized.orderReferences().size())));
        return requireBatch(actor.tenantId(), id);
    }

    @Transactional
    public LogisticsForecastBatchRecord updateStatus(Actor actor, UUID id,
            long version, String targetStatus, String resultMessage) {
        requireActor(actor);
        LogisticsForecastBatchRecord current = requireBatch(actor.tenantId(), id);
        String status = status(targetStatus, false);
        String message = optional(resultMessage, 500);
        if (("FAILED".equals(status) && message == null)
                || (!"FAILED".equals(status) && message != null)
                || version < 0
                || !repository.updateStatus(actor.tenantId(), id, version,
                        status, message, actor)) {
            throw new ConflictException(
                    "Forecast batch status changed concurrently or transition is invalid");
        }
        audit(actor, "logistics.forecast_batch.status_changed", id,
                Map.of("from", current.status(), "to", status));
        return requireBatch(actor.tenantId(), id);
    }

    @Transactional
    public LogisticsForecastBatchRecord markPrinted(Actor actor, UUID id,
            long version) {
        requireActor(actor);
        LogisticsForecastBatchRecord current = requireBatch(actor.tenantId(), id);
        if (!"SUCCEEDED".equals(current.status()) || current.printed()
                || version < 0
                || !repository.markPrinted(actor.tenantId(), id, version, actor)) {
            throw new ConflictException(
                    "Only an unprinted successful forecast batch can be marked printed");
        }
        audit(actor, "logistics.forecast_batch.printed", id,
                Map.of("previousVersion", Long.toString(version)));
        return requireBatch(actor.tenantId(), id);
    }

    private LogisticsForecastBatchRecord requireBatch(UUID tenantId, UUID id) {
        if (id == null) throw new IllegalArgumentException("Forecast batch id is required");
        LogisticsForecastBatchRecord value = repository.find(tenantId, id);
        if (value == null) {
            throw new ResourceNotFoundException("Forecast batch was not found");
        }
        return value;
    }

    private void audit(Actor actor, String action, UUID id,
            Map<String, String> details) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(), action,
                "logistics_forecast_batch", id.toString(), actor.requestId(),
                actor.sourceIp(), details));
    }

    private static BatchInput normalize(BatchInput input) {
        if (input == null || input.totalWeightKg() == null) {
            throw new IllegalArgumentException("Forecast batch is required");
        }
        BigDecimal weight;
        try {
            weight = input.totalWeightKg().setScale(3, RoundingMode.UNNECESSARY);
        } catch (ArithmeticException exception) {
            throw new IllegalArgumentException(
                    "Total weight must have at most three decimal places");
        }
        if (weight.signum() <= 0
                || weight.compareTo(new BigDecimal("999999999.999")) > 0) {
            throw new IllegalArgumentException("Total weight is invalid");
        }
        if (input.orderReferences() == null) {
            throw new IllegalArgumentException("Order references are required");
        }
        LinkedHashSet<String> unique = new LinkedHashSet<>();
        for (String reference : input.orderReferences()) {
            String normalized = reference == null ? "" : reference.strip();
            if (!ORDER_REFERENCE.matcher(normalized).matches()) {
                throw new IllegalArgumentException("Order reference is invalid");
            }
            unique.add(normalized);
        }
        if (unique.isEmpty() || unique.size() > 200
                || String.join(",", unique).length() > 2000) {
            throw new IllegalArgumentException("Order reference count is invalid");
        }
        return new BatchInput(required(input.batchType(), 80),
                required(input.forwarder(), 120), new ArrayList<>(unique), weight);
    }

    private static Filters normalize(Filters filters) {
        if (filters == null) {
            return new Filters(null, null, null, null, null, null);
        }
        return new Filters(status(filters.status(), true),
                optionalLower(filters.batchType(), 80),
                optionalLower(filters.creator(), 160), filters.printed(),
                optionalLower(filters.keyword(), 120),
                optionalLower(filters.forwarder(), 120));
    }

    private static String status(String value, boolean historyAllowed) {
        if (value == null || value.isBlank()
                || (historyAllowed && "HISTORY".equalsIgnoreCase(value))) {
            return null;
        }
        String normalized = value.strip().toUpperCase(Locale.ROOT);
        if (!STATUSES.contains(normalized)) {
            throw new IllegalArgumentException("Forecast status is invalid");
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

    public record BatchInput(String batchType, String forwarder,
            List<String> orderReferences, BigDecimal totalWeightKg) {
    }

    public record Filters(String status, String batchType, String creator,
            Boolean printed, String keyword, String forwarder) {
    }
}
