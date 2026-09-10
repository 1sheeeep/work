package cn.xzkj.erp.logistics.fee;

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
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
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
@RequestMapping("/api/v1/logistics/fees")
public class LogisticsFeeController {
    private final LogisticsFeeService service;

    public LogisticsFeeController(LogisticsFeeService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('logistics.read')")
    public PageEnvelope<FeeResponse> list(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(defaultValue = "UNCONFIRMED") @Size(max = 16) String status,
            @RequestParam(defaultValue = "ORDER_NO") @Size(max = 20) String searchField,
            @RequestParam(required = false) @Size(max = 100) String platform,
            @RequestParam(required = false) @Size(max = 100) String shop,
            @RequestParam(required = false) @Size(max = 120) String channel,
            @RequestParam(required = false) @Size(max = 120) String keyword,
            @RequestParam(required = false) Boolean hasActualFee,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate shippedFrom,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate shippedTo,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "25") @Min(1) @Max(100) int pageSize,
            HttpServletRequest request) {
        return PageEnvelope.from(service.list(actor(principal, request),
                new LogisticsFeeService.Filters(status, searchField, platform,
                        shop, channel, keyword, hasActualFee, shippedFrom, shippedTo),
                PageRequest.of(page, pageSize)), FeeResponse::from);
    }

    @PostMapping
    @PreAuthorize("hasAuthority('logistics.fee.write')")
    public FeeResponse create(@AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody FeeWriteRequest body,
            HttpServletRequest request) {
        return FeeResponse.from(service.create(actor(principal, request), body.input()));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('logistics.fee.write')")
    public FeeResponse update(@AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody FeeWriteRequest body,
            HttpServletRequest request) {
        if (body.version() == null) {
            throw new IllegalArgumentException("Version is required when editing a fee record");
        }
        return FeeResponse.from(service.update(actor(principal, request), id,
                body.version(), body.input()));
    }

    @PostMapping("/{id}/confirm")
    @PreAuthorize("hasAuthority('logistics.fee.write')")
    public FeeResponse confirm(@AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody VersionRequest body,
            HttpServletRequest request) {
        return FeeResponse.from(service.confirm(actor(principal, request),
                id, body.version()));
    }

    @PostMapping("/{id}/archive")
    @PreAuthorize("hasAuthority('logistics.fee.write')")
    public FeeResponse archive(@AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody VersionRequest body,
            HttpServletRequest request) {
        return FeeResponse.from(service.archive(actor(principal, request),
                id, body.version()));
    }

    private static LogisticsFeeService.Actor actor(ErpPrincipal principal,
            HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId == null || !requestId.matches("^[A-Za-z0-9._:-]{1,100}$")) {
            requestId = UUID.randomUUID().toString();
        }
        return new LogisticsFeeService.Actor(
                principal.tenantId(), principal.userId(), principal.systemAdminId(),
                principal.displayName(), requestId, request.getRemoteAddr());
    }

    public record FeeWriteRequest(
            @NotBlank @Size(max = 100) String platformName,
            @NotBlank @Size(max = 100) String shopName,
            @NotBlank @Size(max = 120) String channelName,
            @NotBlank @Size(max = 120) String orderReference,
            @NotBlank @Size(max = 120) String trackingReference,
            @Size(max = 120) String transactionReference,
            @DecimalMin("0.0000") @DecimalMax("99999999999999.9999")
            @Digits(integer = 14, fraction = 4) BigDecimal estimatedFee,
            @DecimalMin("0.0000") @DecimalMax("99999999999999.9999")
            @Digits(integer = 14, fraction = 4) BigDecimal actualFee,
            @NotBlank @Size(min = 3, max = 3) String currency,
            @DecimalMin("0.001") @DecimalMax("999999999.999")
            @Digits(integer = 9, fraction = 3) BigDecimal carrierWeightKg,
            @DecimalMin("0.001") @DecimalMax("999999999.999")
            @Digits(integer = 9, fraction = 3) BigDecimal warehouseWeightKg,
            @NotNull LocalDate shippedOn,
            @Size(max = 500) String note,
            @Min(0) Long version) {
        LogisticsFeeService.FeeInput input() {
            return new LogisticsFeeService.FeeInput(
                    platformName, shopName, channelName, orderReference,
                    trackingReference, transactionReference, estimatedFee,
                    actualFee, currency, carrierWeightKg, warehouseWeightKg,
                    shippedOn, note);
        }
    }

    public record VersionRequest(@Min(0) long version) {
    }

    public record FeeResponse(UUID id, String platformName, String shopName,
            String channelName, String orderReference, String trackingReference,
            String transactionReference, BigDecimal estimatedFee,
            BigDecimal actualFee, BigDecimal feeVariance, String currency,
            BigDecimal carrierWeightKg, BigDecimal warehouseWeightKg,
            BigDecimal weightVarianceKg, LocalDate shippedOn,
            String confirmationStatus, String lifecycleStatus, String note,
            String confirmedByDisplayName, Instant confirmedAt,
            String createdByDisplayName, long version,
            Instant createdAt, Instant updatedAt) {
        static FeeResponse from(LogisticsFeeRecord value) {
            return new FeeResponse(value.id(), value.platformName(), value.shopName(),
                    value.channelName(), value.orderReference(),
                    value.trackingReference(), value.transactionReference(),
                    value.estimatedFee(), value.actualFee(), value.feeVariance(),
                    value.currency(), value.carrierWeightKg(),
                    value.warehouseWeightKg(), value.weightVarianceKg(),
                    value.shippedOn(), value.confirmationStatus(),
                    value.lifecycleStatus(), value.note(),
                    value.confirmedByDisplayName(), value.confirmedAt(),
                    value.createdByDisplayName(), value.version(),
                    value.createdAt(), value.updatedAt());
        }
    }
}
