package cn.xzkj.erp.logistics.inquiry;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.platform.api.PageEnvelope;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Validated
@RequestMapping("/api/v1/logistics/inquiries")
public class LogisticsInquiryController {
    private final LogisticsInquiryService service;

    public LogisticsInquiryController(LogisticsInquiryService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('logistics.read')")
    public PageEnvelope<InquiryResponse> list(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(defaultValue = "MY_INQUIRIES") @Size(max = 20) String view,
            @RequestParam(defaultValue = "ALL") @Size(max = 16) String status,
            @RequestParam(required = false) @Size(max = 100) String country,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate publishedFrom,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate publishedTo,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "25") @Min(1) @Max(100) int pageSize,
            HttpServletRequest request) {
        return PageEnvelope.from(service.list(actor(principal, request),
                new LogisticsInquiryService.Filters("MARKET".equalsIgnoreCase(view),
                        "ALL".equalsIgnoreCase(status) ? null : status,
                        country, publishedFrom, publishedTo),
                PageRequest.of(page, pageSize)), InquiryResponse::from);
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('logistics.read')")
    public InquiryDetailResponse detail(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id, HttpServletRequest request) {
        return InquiryDetailResponse.from(service.detail(actor(principal, request), id));
    }

    @GetMapping("/contact")
    @PreAuthorize("hasAuthority('logistics.read')")
    public ContactResponse contact(@AuthenticationPrincipal ErpPrincipal principal,
            HttpServletRequest request) {
        return ContactResponse.from(service.contact(actor(principal, request)));
    }

    @PutMapping("/contact")
    @PreAuthorize("hasAuthority('logistics.inquiry.write')")
    public ContactResponse saveContact(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody ContactRequest body, HttpServletRequest request) {
        return ContactResponse.from(service.saveContact(actor(principal, request),
                new LogisticsInquiryService.ContactInput(
                        body.contactName(), body.contactPhone()), body.version()));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('logistics.inquiry.write')")
    public InquiryResponse create(@AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody InquiryWriteRequest body,
            HttpServletRequest request) {
        return InquiryResponse.from(service.create(actor(principal, request),
                body.input()));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('logistics.inquiry.write')")
    public InquiryResponse update(@AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody InquiryWriteRequest body,
            HttpServletRequest request) {
        if (body.version() == null) {
            throw new IllegalArgumentException("Version is required when editing an inquiry");
        }
        return InquiryResponse.from(service.update(actor(principal, request), id,
                body.version(), body.input()));
    }

    @PostMapping("/{id}/status")
    @PreAuthorize("hasAuthority('logistics.inquiry.write')")
    public InquiryResponse transition(@AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody StatusRequest body,
            HttpServletRequest request) {
        return InquiryResponse.from(service.transition(actor(principal, request),
                id, body.version(), body.status()));
    }

    @PostMapping("/{id}/quotes")
    @PreAuthorize("hasAuthority('logistics.inquiry.write')")
    public InquiryDetailResponse addQuote(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody QuoteRequest body,
            HttpServletRequest request) {
        return InquiryDetailResponse.from(service.addQuote(actor(principal, request),
                id, body.input()));
    }

    @PostMapping("/{id}/quotes/{quoteId}/withdraw")
    @PreAuthorize("hasAuthority('logistics.inquiry.write')")
    public InquiryDetailResponse withdrawQuote(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id, @PathVariable UUID quoteId,
            @Valid @RequestBody VersionRequest body, HttpServletRequest request) {
        return InquiryDetailResponse.from(service.withdrawQuote(
                actor(principal, request), id, quoteId, body.version()));
    }

    private static LogisticsInquiryService.Actor actor(ErpPrincipal principal,
            HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId == null || !requestId.matches("^[A-Za-z0-9._:-]{1,100}$")) {
            requestId = UUID.randomUUID().toString();
        }
        return new LogisticsInquiryService.Actor(
                principal.tenantId(), principal.userId(), principal.systemAdminId(),
                principal.displayName(), requestId, request.getRemoteAddr());
    }

    public record InquiryWriteRequest(
            @NotBlank @Size(max = 160) String origin,
            @NotBlank @Size(max = 240) String destination,
            @Min(1) @Max(1_000_000) int weeklyOrderCount,
            @NotNull @DecimalMin("0.001") @DecimalMax("999999999.999")
            @Digits(integer = 9, fraction = 3) BigDecimal weeklyWeightKg,
            @NotBlank @Size(max = 120) String category,
            @NotBlank @Size(max = 100) String contactName,
            @NotBlank @Size(max = 40)
            @Pattern(regexp = "^[0-9+() -]{5,40}$") String contactPhone,
            @Size(max = 500) String note,
            @Min(0) Long version) {
        LogisticsInquiryService.InquiryInput input() {
            return new LogisticsInquiryService.InquiryInput(
                    origin, destination, weeklyOrderCount, weeklyWeightKg,
                    category, contactName, contactPhone, note);
        }
    }

    public record ContactRequest(
            @NotBlank @Size(max = 100) String contactName,
            @NotBlank @Size(max = 40)
            @Pattern(regexp = "^[0-9+() -]{5,40}$") String contactPhone,
            @Min(0) Long version) {
    }

    public record QuoteRequest(
            @NotBlank @Size(max = 120) String providerName,
            @NotBlank @Size(max = 120) String serviceName,
            @NotNull @DecimalMin("0.0000") @DecimalMax("99999999999999.9999")
            @Digits(integer = 14, fraction = 4) BigDecimal pricePerKg,
            @NotBlank @Size(min = 3, max = 3) String currency,
            @Min(1) @Max(365) int transitDays,
            @Size(max = 500) String note) {
        LogisticsInquiryService.QuoteInput input() {
            return new LogisticsInquiryService.QuoteInput(providerName, serviceName,
                    pricePerKg, currency, transitDays, note);
        }
    }

    public record StatusRequest(@Min(0) long version,
            @NotBlank @Size(max = 16) String status) {
    }

    public record VersionRequest(@Min(0) long version) {
    }

    public record InquiryResponse(UUID id, String inquiryNo, String origin,
            String destination, int weeklyOrderCount, BigDecimal weeklyWeightKg,
            String category, String contactName, String contactPhone,
            String status, String note, long activeQuoteCount,
            Instant publishedAt, String createdByDisplayName, long version,
            Instant createdAt, Instant updatedAt) {
        static InquiryResponse from(LogisticsInquiryRecord value) {
            return new InquiryResponse(value.id(), value.inquiryNo(), value.origin(),
                    value.destination(), value.weeklyOrderCount(),
                    value.weeklyWeightKg(), value.category(), value.contactName(),
                    value.contactPhone(), value.status(), value.note(),
                    value.activeQuoteCount(), value.publishedAt(),
                    value.createdByDisplayName(), value.version(), value.createdAt(),
                    value.updatedAt());
        }
    }

    public record QuoteResponse(UUID id, UUID inquiryId, String providerName,
            String serviceName, BigDecimal pricePerKg, String currency,
            int transitDays, String note, String status,
            String createdByDisplayName, long version,
            Instant createdAt, Instant updatedAt) {
        static QuoteResponse from(LogisticsInquiryQuoteRecord value) {
            return new QuoteResponse(value.id(), value.inquiryId(),
                    value.providerName(), value.serviceName(), value.pricePerKg(),
                    value.currency(), value.transitDays(), value.note(),
                    value.status(), value.createdByDisplayName(), value.version(),
                    value.createdAt(), value.updatedAt());
        }
    }

    public record InquiryDetailResponse(InquiryResponse inquiry,
            List<QuoteResponse> quotes) {
        static InquiryDetailResponse from(LogisticsInquiryDetail value) {
            return new InquiryDetailResponse(InquiryResponse.from(value.inquiry()),
                    value.quotes().stream().map(QuoteResponse::from).toList());
        }
    }

    public record ContactResponse(String contactName, String contactPhone,
            Long version, Instant updatedAt) {
        static ContactResponse from(LogisticsInquiryContactRecord value) {
            return value == null ? new ContactResponse(null, null, null, null)
                    : new ContactResponse(value.contactName(), value.contactPhone(),
                            value.version(), value.updatedAt());
        }
    }
}
