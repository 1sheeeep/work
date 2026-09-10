package cn.xzkj.erp.procurement.statistics;

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
@RequestMapping("/api/v1/procurement/statistics/purchasers")
public class PurchaserStatisticsController {
    private static final int MAX_PAGE_SIZE = 100;
    private final PurchaserStatisticsService service;

    public PurchaserStatisticsController(PurchaserStatisticsService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('procurement.read')")
    public Response summarize(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(defaultValue = "DAY")
            PurchaserStatisticsGranularity granularity,
            @RequestParam(required = false) @Size(max = 100) String purchaser,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
            Instant orderedFrom,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
            Instant orderedToExclusive,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "25") @Min(1) @Max(MAX_PAGE_SIZE)
            int size) {
        PurchaserStatisticsResult result = service.summarize(
                new PurchaserStatisticsActor(
                        principal.tenantId(), principal.userId(),
                        principal.systemAdminId()),
                granularity, purchaser, orderedFrom, orderedToExclusive,
                pageable(page, size));
        int totalPages = result.totalGroups() == 0
                ? 0
                : Math.toIntExact((result.totalGroups() + size - 1) / size);
        return new Response(
                result.items().stream().map(ItemResponse::from).toList(),
                granularity.name(), result.totalOrders(),
                result.totalOrderedQuantity(), result.totalReceivedQuantity(),
                result.totalOutstandingQuantity(), page, size,
                result.totalGroups(), totalPages);
    }

    @PostMapping("/exports")
    @PreAuthorize("hasAuthority('procurement.read')")
    public ExportResponse export(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody ExportRequest body) {
        var result = service.exportCsv(
                new PurchaserStatisticsActor(
                        principal.tenantId(), principal.userId(),
                        principal.systemAdminId()),
                body.granularity(), body.purchaser(), body.orderedFrom(),
                body.orderedToExclusive());
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
            List<ItemResponse> items,
            String granularity,
            long totalOrders,
            long totalOrderedQuantity,
            long totalReceivedQuantity,
            long totalOutstandingQuantity,
            int page,
            int size,
            long totalElements,
            int totalPages) {}

    public record ExportRequest(
            PurchaserStatisticsGranularity granularity,
            @Size(max = 100) String purchaser,
            Instant orderedFrom,
            Instant orderedToExclusive) {}

    public record ExportResponse(
            String filename,
            String mediaType,
            int rowCount,
            String content) {}

    public record ItemResponse(
            LocalDate periodStart,
            String purchaserDisplayName,
            long orderCount,
            long orderedQuantity,
            long receivedQuantity,
            long outstandingQuantity,
            long newOrderCount,
            long approvedOrderCount,
            long partiallyReceivedOrderCount,
            long receivedOrderCount) {
        static ItemResponse from(PurchaserStatisticsView value) {
            return new ItemResponse(
                    value.periodStart(), value.purchaserDisplayName(),
                    value.orderCount(), value.orderedQuantity(),
                    value.receivedQuantity(), value.outstandingQuantity(),
                    value.newOrderCount(),
                    value.approvedOrderCount(),
                    value.partiallyReceivedOrderCount(),
                    value.receivedOrderCount());
        }
    }
}
