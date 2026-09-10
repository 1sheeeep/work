package cn.xzkj.erp.analytics.inventoryperiod;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.List;
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
@RequestMapping("/api/v1/analytics/inventory-period")
public class InventoryPeriodReportController {
    private static final int MAX_PAGE_SIZE = 100;
    private final InventoryPeriodReportService service;

    public InventoryPeriodReportController(
            InventoryPeriodReportService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAnyAuthority('inventory.read','analytics.read')")
    public Response summarize(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam @NotNull
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
            LocalDate periodFrom,
            @RequestParam @NotNull
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
            LocalDate periodTo,
            @RequestParam(required = false) UUID warehouseId,
            @RequestParam(required = false) @Size(max = 100) String keyword,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "50") @Min(1) @Max(MAX_PAGE_SIZE)
            int size) {
        InventoryPeriodReportResult result = service.summarize(
                new InventoryPeriodReportActor(
                        principal.tenantId(), principal.userId(),
                        principal.systemAdminId()),
                periodFrom, periodTo, warehouseId, keyword,
                pageable(page, size));
        int totalPages = result.totalElements() == 0
                ? 0
                : Math.toIntExact(
                        (result.totalElements() + size - 1) / size);
        return new Response(
                result.items().stream().map(ItemResponse::from).toList(),
                result.totalOpeningQuantity(),
                result.totalIncreasedQuantity(),
                result.totalDecreasedQuantity(),
                result.totalClosingQuantity(),
                page, size, result.totalElements(), totalPages);
    }

    @PostMapping("/exports")
    @PreAuthorize("hasAnyAuthority('inventory.read','analytics.read')")
    public ExportResponse export(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody ExportRequest body) {
        var result = service.exportCsv(
                new InventoryPeriodReportActor(
                        principal.tenantId(), principal.userId(),
                        principal.systemAdminId()),
                body.periodFrom(), body.periodTo(), body.warehouseId(),
                body.keyword());
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
            long totalOpeningQuantity,
            long totalIncreasedQuantity,
            long totalDecreasedQuantity,
            long totalClosingQuantity,
            int page,
            int size,
            long totalElements,
            int totalPages) {}

    public record ExportRequest(
            @NotNull LocalDate periodFrom,
            @NotNull LocalDate periodTo,
            UUID warehouseId,
            @Size(max = 100) String keyword) {
    }

    public record ExportResponse(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }

    public record ItemResponse(
            UUID skuId,
            String skuBusinessCode,
            String skuName,
            UUID warehouseId,
            String warehouseBusinessCode,
            String warehouseName,
            long openingQuantity,
            long increasedQuantity,
            long decreasedQuantity,
            long closingQuantity) {
        static ItemResponse from(InventoryPeriodReportItem value) {
            return new ItemResponse(
                    value.skuId(), value.skuBusinessCode(), value.skuName(),
                    value.warehouseId(), value.warehouseBusinessCode(),
                    value.warehouseName(), value.openingQuantity(),
                    value.increasedQuantity(), value.decreasedQuantity(),
                    value.closingQuantity());
        }
    }
}
