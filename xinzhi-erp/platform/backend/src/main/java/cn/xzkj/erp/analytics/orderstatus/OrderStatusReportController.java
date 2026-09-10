package cn.xzkj.erp.analytics.orderstatus;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
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
@RequestMapping("/api/v1/analytics/order-status")
public class OrderStatusReportController {
    private static final int MAX_PAGE_SIZE = 100;
    private final OrderStatusReportService service;

    public OrderStatusReportController(OrderStatusReportService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('analytics.read')")
    public Response summarize(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) @Size(max = 100) String shop,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
            Instant placedFrom,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
            Instant placedToExclusive,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "25") @Min(1) @Max(MAX_PAGE_SIZE)
            int size) {
        OrderStatusReportResult result = service.summarize(
                new OrderStatusReportActor(
                        principal.tenantId(), principal.userId(),
                        principal.systemAdminId()),
                shop, placedFrom, placedToExclusive, pageable(page, size));
        int totalPages = result.totalDays() == 0
                ? 0
                : Math.toIntExact((result.totalDays() + size - 1) / size);
        return new Response(
                result.items().stream().map(DayResponse::from).toList(),
                result.totalOrders(), page, size, result.totalDays(),
                totalPages);
    }

    @PostMapping("/exports")
    @PreAuthorize("hasAuthority('analytics.read')")
    public ExportResponse export(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody ExportRequest body) {
        var result = service.exportCsv(
                new OrderStatusReportActor(
                        principal.tenantId(), principal.userId(),
                        principal.systemAdminId()),
                body.shop(), body.placedFrom(), body.placedToExclusive());
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
            List<DayResponse> items,
            long totalOrders,
            int page,
            int size,
            long totalElements,
            int totalPages) {}

    public record ExportRequest(
            @Size(max = 100) String shop,
            Instant placedFrom,
            Instant placedToExclusive) {
    }

    public record ExportResponse(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }

    public record DayResponse(
            LocalDate reportDate,
            long orderCount,
            List<StatusResponse> statuses) {
        static DayResponse from(OrderStatusReportView value) {
            return new DayResponse(
                    value.reportDate(), value.orderCount(),
                    value.statuses().stream().map(StatusResponse::from).toList());
        }
    }

    public record StatusResponse(String status, long orderCount) {
        static StatusResponse from(
                OrderStatusReportView.StatusCount value) {
            return new StatusResponse(
                    value.status().name(), value.orderCount());
        }
    }
}
