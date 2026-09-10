package cn.xzkj.erp.logistics.inquiry;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
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
public class LogisticsInquiryService {
    private static final Set<String> STATUSES = Set.of(
            "BIDDING", "PAUSED", "COMPLETED", "CANCELLED");
    private static final Pattern PHONE = Pattern.compile("^[0-9+() -]{5,40}$");
    private static final Pattern CURRENCY = Pattern.compile("^[A-Z]{3}$");
    private static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Shanghai");
    private static final DateTimeFormatter INQUIRY_DATE =
            DateTimeFormatter.ofPattern("yyyyMMdd");
    private final LogisticsInquiryRepository repository;
    private final SecurityAuditRecorder auditRecorder;

    public LogisticsInquiryService(LogisticsInquiryRepository repository,
            SecurityAuditRecorder auditRecorder) {
        this.repository = repository;
        this.auditRecorder = auditRecorder;
    }

    @Transactional(readOnly = true)
    public Page<LogisticsInquiryRecord> list(Actor actor, Filters filters,
            Pageable pageable) {
        requireActor(actor);
        return repository.list(actor.tenantId(), normalize(filters), pageable);
    }

    @Transactional(readOnly = true)
    public LogisticsInquiryDetail detail(Actor actor, UUID id) {
        requireActor(actor);
        LogisticsInquiryRecord inquiry = requireInquiry(actor.tenantId(), id);
        return new LogisticsInquiryDetail(inquiry,
                repository.quotes(actor.tenantId(), id));
    }

    @Transactional(readOnly = true)
    public LogisticsInquiryContactRecord contact(Actor actor) {
        requireActor(actor);
        return repository.contact(actor.tenantId());
    }

    @Transactional
    public LogisticsInquiryContactRecord saveContact(Actor actor,
            ContactInput input, Long version) {
        requireActor(actor);
        ContactInput normalized = normalize(input);
        if ((version != null && version < 0)
                || !repository.saveContact(actor.tenantId(), normalized, version, actor)) {
            throw new ConflictException(
                    "Inquiry contact was created or changed concurrently");
        }
        audit(actor, "logistics.inquiry_contact.saved", actor.tenantId(),
                Map.of());
        return repository.contact(actor.tenantId());
    }

    @Transactional
    public LogisticsInquiryRecord create(Actor actor, InquiryInput input) {
        requireActor(actor);
        InquiryInput normalized = normalize(input);
        UUID id = UUID.randomUUID();
        String inquiryNo = "LI-"
                + INQUIRY_DATE.format(ZonedDateTime.now(BUSINESS_ZONE)) + "-"
                + id.toString().replace("-", "").substring(0, 6)
                        .toUpperCase(Locale.ROOT);
        try {
            repository.insertInquiry(id, actor.tenantId(), inquiryNo,
                    normalized, actor);
        } catch (DataIntegrityViolationException exception) {
            throw new ConflictException("Logistics inquiry could not be created");
        }
        audit(actor, "logistics.inquiry.created", id,
                Map.of("inquiryNo", inquiryNo));
        return requireInquiry(actor.tenantId(), id);
    }

    @Transactional
    public LogisticsInquiryRecord update(Actor actor, UUID id, long version,
            InquiryInput input) {
        requireActor(actor);
        LogisticsInquiryRecord current = requireInquiry(actor.tenantId(), id);
        InquiryInput normalized = normalize(input);
        if (version < 0 || !repository.updateInquiry(actor.tenantId(), id,
                version, normalized, actor)) {
            throw new ConflictException(
                    "Only a current bidding or paused inquiry can be edited");
        }
        audit(actor, "logistics.inquiry.updated", id,
                Map.of("inquiryNo", current.inquiryNo()));
        return requireInquiry(actor.tenantId(), id);
    }

    @Transactional
    public LogisticsInquiryRecord transition(Actor actor, UUID id, long version,
            String targetStatus) {
        requireActor(actor);
        LogisticsInquiryRecord current = requireInquiry(actor.tenantId(), id);
        String target = status(targetStatus, false);
        if (!allowed(current.status(), target) || version < 0
                || !repository.transition(actor.tenantId(), id, version,
                        current.status(), target, actor)) {
            throw new ConflictException(
                    "Inquiry status changed concurrently or transition is invalid");
        }
        audit(actor, "logistics.inquiry.status_changed", id,
                Map.of("from", current.status(), "to", target,
                        "inquiryNo", current.inquiryNo()));
        return requireInquiry(actor.tenantId(), id);
    }

    @Transactional
    public LogisticsInquiryDetail addQuote(Actor actor, UUID inquiryId,
            QuoteInput input) {
        requireActor(actor);
        LogisticsInquiryRecord current = requireInquiry(actor.tenantId(), inquiryId);
        QuoteInput normalized = normalize(input);
        UUID quoteId = UUID.randomUUID();
        if (!repository.insertQuote(quoteId, actor.tenantId(), inquiryId,
                normalized, actor)) {
            throw new ConflictException("Only a bidding inquiry can receive quotes");
        }
        audit(actor, "logistics.inquiry_quote.created", quoteId,
                Map.of("inquiryId", inquiryId.toString(),
                        "inquiryNo", current.inquiryNo()));
        return detail(actor, inquiryId);
    }

    @Transactional
    public LogisticsInquiryDetail withdrawQuote(Actor actor, UUID inquiryId,
            UUID quoteId, long version) {
        requireActor(actor);
        requireInquiry(actor.tenantId(), inquiryId);
        if (version < 0 || !repository.withdrawQuote(actor.tenantId(), inquiryId,
                quoteId, version, actor)) {
            throw new ConflictException(
                    "Only an active quote on an open inquiry can be withdrawn");
        }
        audit(actor, "logistics.inquiry_quote.withdrawn", quoteId,
                Map.of("inquiryId", inquiryId.toString()));
        return detail(actor, inquiryId);
    }

    private LogisticsInquiryRecord requireInquiry(UUID tenantId, UUID id) {
        if (id == null) throw new IllegalArgumentException("Inquiry id is required");
        LogisticsInquiryRecord value = repository.find(tenantId, id);
        if (value == null) {
            throw new ResourceNotFoundException("Logistics inquiry was not found");
        }
        return value;
    }

    private void audit(Actor actor, String action, UUID id,
            Map<String, String> details) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(), action,
                "logistics_inquiry", id.toString(), actor.requestId(),
                actor.sourceIp(), details));
    }

    private static boolean allowed(String current, String target) {
        return switch (current) {
            case "BIDDING" -> Set.of("PAUSED", "COMPLETED", "CANCELLED")
                    .contains(target);
            case "PAUSED" -> Set.of("BIDDING", "COMPLETED", "CANCELLED")
                    .contains(target);
            default -> false;
        };
    }

    private static NormalizedFilters normalize(Filters filters) {
        if (filters == null) {
            return new NormalizedFilters(false, null, null, null, null);
        }
        Instant from = filters.publishedFrom() == null ? null
                : filters.publishedFrom().atStartOfDay(BUSINESS_ZONE).toInstant();
        Instant to = filters.publishedTo() == null ? null
                : filters.publishedTo().plusDays(1)
                        .atStartOfDay(BUSINESS_ZONE).toInstant();
        if (from != null && to != null && !from.isBefore(to)) {
            throw new IllegalArgumentException(
                    "Published start date cannot be after end date");
        }
        return new NormalizedFilters(filters.market(), status(filters.status(), true),
                optionalLower(filters.country(), 100), from, to);
    }

    private static InquiryInput normalize(InquiryInput input) {
        if (input == null || input.weeklyWeightKg() == null) {
            throw new IllegalArgumentException("Inquiry input is required");
        }
        if (input.weeklyOrderCount() < 1 || input.weeklyOrderCount() > 1_000_000) {
            throw new IllegalArgumentException("Weekly order count is invalid");
        }
        BigDecimal weight = decimal(input.weeklyWeightKg(), 3,
                new BigDecimal("0.001"), new BigDecimal("999999999.999"),
                "Weekly weight");
        ContactInput contact = normalize(new ContactInput(
                input.contactName(), input.contactPhone()));
        return new InquiryInput(required(input.origin(), 160),
                required(input.destination(), 240), input.weeklyOrderCount(),
                weight, required(input.category(), 120), contact.contactName(),
                contact.contactPhone(), optional(input.note(), 500));
    }

    private static ContactInput normalize(ContactInput input) {
        if (input == null) throw new IllegalArgumentException("Contact is required");
        String name = required(input.contactName(), 100);
        String phone = required(input.contactPhone(), 40);
        if (!PHONE.matcher(phone).matches()) {
            throw new IllegalArgumentException("Contact phone is invalid");
        }
        return new ContactInput(name, phone);
    }

    private static QuoteInput normalize(QuoteInput input) {
        if (input == null || input.pricePerKg() == null) {
            throw new IllegalArgumentException("Quote input is required");
        }
        String currency = required(input.currency(), 3).toUpperCase(Locale.ROOT);
        if (!CURRENCY.matcher(currency).matches()) {
            throw new IllegalArgumentException("Quote currency is invalid");
        }
        if (input.transitDays() < 1 || input.transitDays() > 365) {
            throw new IllegalArgumentException("Transit days are invalid");
        }
        return new QuoteInput(required(input.providerName(), 120),
                required(input.serviceName(), 120),
                decimal(input.pricePerKg(), 4, BigDecimal.ZERO,
                        new BigDecimal("99999999999999.9999"), "Price per kg"),
                currency, input.transitDays(), optional(input.note(), 500));
    }

    private static BigDecimal decimal(BigDecimal value, int scale,
            BigDecimal minimum, BigDecimal maximum, String label) {
        try {
            value = value.setScale(scale, RoundingMode.UNNECESSARY);
        } catch (ArithmeticException exception) {
            throw new IllegalArgumentException(label + " has too many decimal places");
        }
        if (value.compareTo(minimum) < 0 || value.compareTo(maximum) > 0) {
            throw new IllegalArgumentException(label + " is invalid");
        }
        return value;
    }

    private static String status(String value, boolean optional) {
        if ((value == null || value.isBlank()) && optional) return null;
        String normalized = value == null ? "" : value.strip().toUpperCase(Locale.ROOT);
        if (!STATUSES.contains(normalized)) {
            throw new IllegalArgumentException("Inquiry status is invalid");
        }
        return normalized;
    }

    private static String required(String value, int maximum) {
        String normalized = value == null ? "" : value.strip();
        if (normalized.isEmpty() || normalized.length() > maximum
                || normalized.chars().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException("Required inquiry text is invalid");
        }
        return normalized;
    }

    private static String optional(String value, int maximum) {
        if (value == null || value.isBlank()) return null;
        return required(value, maximum);
    }

    private static String optionalLower(String value, int maximum) {
        String normalized = optional(value, maximum);
        return normalized == null ? null : normalized.toLowerCase(Locale.ROOT);
    }

    private static void requireActor(Actor actor) {
        if (actor == null || actor.tenantId() == null
                || (actor.userId() == null) == (actor.systemAdminId() == null)) {
            throw new AccessDeniedException("A tenant actor is required");
        }
        required(actor.displayName(), 160);
        if (actor.requestId() == null
                || !actor.requestId().matches("^[A-Za-z0-9._:-]{1,100}$")) {
            throw new IllegalArgumentException("Request id is invalid");
        }
    }

    public record Actor(UUID tenantId, UUID userId, UUID systemAdminId,
            String displayName, String requestId, String sourceIp) {
    }

    public record Filters(boolean market, String status, String country,
            LocalDate publishedFrom, LocalDate publishedTo) {
    }

    record NormalizedFilters(boolean market, String status, String country,
            Instant publishedFrom, Instant publishedTo) {
    }

    public record InquiryInput(String origin, String destination,
            int weeklyOrderCount, BigDecimal weeklyWeightKg, String category,
            String contactName, String contactPhone, String note) {
    }

    public record QuoteInput(String providerName, String serviceName,
            BigDecimal pricePerKg, String currency, int transitDays, String note) {
    }

    public record ContactInput(String contactName, String contactPhone) {
    }
}
