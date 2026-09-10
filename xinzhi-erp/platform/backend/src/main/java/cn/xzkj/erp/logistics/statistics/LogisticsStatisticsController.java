package cn.xzkj.erp.logistics.statistics;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.logistics.statistics.LogisticsStatisticsView.Dimension;
import cn.xzkj.erp.logistics.tracking.LogisticsTrackingActor;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import java.time.Instant;
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
@RequestMapping("/api/v1/logistics/statistics")
public class LogisticsStatisticsController {
    private static final int MAX_PAGE_SIZE = 100;
    private final LogisticsStatisticsService service;

    public LogisticsStatisticsController(LogisticsStatisticsService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('logistics.read')")
    public Response summarize(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(defaultValue = "COUNTRY") Dimension dimension,
            @RequestParam(required = false) @Size(max = 100) String value,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
            Instant shippedFrom,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
            Instant shippedToExclusive,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "25") @Min(1) @Max(MAX_PAGE_SIZE)
            int size) {
        LogisticsStatisticsResult result = service.summarize(
                new LogisticsTrackingActor(
                        principal.tenantId(), principal.userId(),
                        principal.systemAdminId()),
                dimension, value, shippedFrom, shippedToExclusive,
                pageable(page, size));
        int totalPages = result.totalGroups() == 0
                ? 0
                : Math.toIntExact(
                        (result.totalGroups() + size - 1) / size);
        return new Response(
                result.items().stream().map(GroupResponse::from).toList(),
                result.totalStatuses().stream()
                        .map(StatusResponse::from).toList(),
                dimension, result.totalRecords(), page, size,
                result.totalGroups(), totalPages);
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
                body.dimension(), body.value(), body.shippedFrom(),
                body.shippedToExclusive());
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
            List<GroupResponse> items,
            List<StatusResponse> totalStatuses,
            Dimension dimension,
            long totalRecords,
            int page,
            int size,
            long totalElements,
            int totalPages) {}

    public record ExportRequest(
            Dimension dimension,
            @Size(max = 100) String value,
            Instant shippedFrom,
            Instant shippedToExclusive) {
    }

    public record ExportResponse(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }

    public record GroupResponse(
            String groupValue,
            long recordCount,
            List<StatusResponse> statuses) {
        static GroupResponse from(LogisticsStatisticsView value) {
            return new GroupResponse(
                    value.groupValue(), value.recordCount(),
                    value.statuses().stream().map(StatusResponse::from).toList());
        }
    }

    public record StatusResponse(String status, long recordCount) {
        static StatusResponse from(
                LogisticsStatisticsView.StatusCount value) {
            return new StatusResponse(value.status(), value.recordCount());
        }
    }
}
