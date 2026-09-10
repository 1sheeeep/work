package cn.xzkj.erp.logistics.tracking;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.logistics.tracking.LogisticsTrackingView.PackageStatus;
import cn.xzkj.erp.logistics.tracking.LogisticsTrackingView.SearchField;
import cn.xzkj.erp.platform.api.PageEnvelope;
import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Validated
@RequestMapping("/api/v1/logistics/tracking")
public class LogisticsTrackingController {
    private static final int MAX_PAGE_SIZE = 200;
    private final LogisticsTrackingService service;

    public LogisticsTrackingController(LogisticsTrackingService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('logistics.read')")
    public PageEnvelope<Response> list(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) @Size(max = 100) String shop,
            @RequestParam(required = false) @Size(max = 100) String carrier,
            @RequestParam(required = false)
            @Pattern(regexp = "(?i)^[A-Z]{2}$") String country,
            @RequestParam(required = false) @Size(max = 100) String warehouse,
            @RequestParam(required = false) @Size(max = 100) String category,
            @RequestParam(defaultValue = "ORDER_NO") SearchField searchField,
            @RequestParam(required = false) @Size(max = 120) String keyword,
            @RequestParam(required = false) PackageStatus status,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
            Instant shippedFrom,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
            Instant shippedTo,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "25") @Min(1) @Max(MAX_PAGE_SIZE) int size) {
        return PageEnvelope.from(service.list(
                        new LogisticsTrackingActor(
                                principal.tenantId(), principal.userId(),
                                principal.systemAdminId()),
                        shop, carrier, country, warehouse, category,
                        searchField, keyword, status, shippedFrom, shippedTo,
                        pageable(page, size)),
                Response::from);
    }

    @PostMapping("/exports")
    @PreAuthorize("hasAuthority('logistics.read')")
    public ExportResponse export(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody ExportRequest body) {
        var result = service.exportCsv(
                new LogisticsTrackingActor(
                        principal.tenantId(), principal.userId(),
                        principal.systemAdminId()),
                body.shop(), body.carrier(), body.country(), body.warehouse(),
                body.category(), body.searchField(), body.keyword(),
                body.status(), body.shippedFrom(), body.shippedTo());
        return new ExportResponse(
                result.filename(), result.mediaType(), result.rowCount(),
                result.content());
    }

    private static PageRequest pageable(int page, int size) {
        if (page < 0 || size < 1 || size > MAX_PAGE_SIZE) {
            throw new ConstraintViolationException(Set.of());
        }
        return PageRequest.of(page, size);
    }

    public record Response(
            UUID orderId,
            String platformCode,
            String platformName,
            String shopName,
            String orderNo,
            String countryCode,
            String warehouseSummary,
            String logisticsChannel,
            String trackingReference,
            String secondaryTrackingReference,
            String trackingStatus,
            String fixedCategory,
            String customCategory,
            Instant shippedAt,
            Instant updatedAt) {
        static Response from(LogisticsTrackingView value) {
            return new Response(
                    value.orderId(), value.platformCode(), value.platformName(),
                    value.shopName(), value.orderNo(), value.countryCode(),
                    value.warehouseSummary(), value.logisticsChannel(),
                    value.trackingReference(), value.secondaryTrackingReference(),
                    value.trackingStatus(), value.fixedCategory(),
                    value.customCategory(), value.shippedAt(), value.updatedAt());
        }
    }

    public record ExportRequest(
            @Size(max = 100) String shop,
            @Size(max = 100) String carrier,
            @Pattern(regexp = "(?i)^[A-Z]{2}$") String country,
            @Size(max = 100) String warehouse,
            @Size(max = 100) String category,
            @NotNull SearchField searchField,
            @Size(max = 120) String keyword,
            PackageStatus status,
            Instant shippedFrom,
            Instant shippedTo) {
        @JsonAnySetter
        public void rejectUnknownField(String field, Object value) {
            throw new IllegalArgumentException(
                    "Unknown logistics tracking export request field");
        }
    }

    public record ExportResponse(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }
}
