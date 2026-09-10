package cn.xzkj.erp.analytics.inventoryaging;

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
@RequestMapping("/api/v1/analytics/inventory-aging")
public class InventoryAgingReportController {
    private static final int MAX_PAGE_SIZE = 100;
    private final InventoryAgingReportService service;

    public InventoryAgingReportController(
            InventoryAgingReportService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAnyAuthority('inventory.read','analytics.read')")
    public Response summarize(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam @NotNull
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
            LocalDate cutoffDate,
            @RequestParam(required = false) UUID warehouseId,
            @RequestParam(required = false) @Size(max = 100) String keyword,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "50") @Min(1) @Max(MAX_PAGE_SIZE)
            int size) {
        InventoryAgingReportResult result = service.summarize(
                actor(principal), cutoffDate, warehouseId, keyword,
                pageable(page, size));
        int totalPages = result.totalElements() == 0
                ? 0
                : Math.toIntExact(
                        (result.totalElements() + size - 1) / size);
        return new Response(
                result.items().stream().map(ItemResponse::from).toList(),
                result.totalQuantity(), result.age0To30Quantity(),
                result.age31To60Quantity(), result.age61To90Quantity(),
                result.age91To365Quantity(), result.ageOver365Quantity(),
                page, size, result.totalElements(), totalPages);
    }

    @PostMapping("/exports")
    @PreAuthorize("hasAnyAuthority('inventory.read','analytics.read')")
    public ExportResponse export(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody ExportRequest body) {
        var result = service.exportCsv(
                actor(principal), body.cutoffDate(), body.warehouseId(),
                body.keyword());
        return new ExportResponse(
                result.filename(), result.mediaType(), result.rowCount(),
                result.content());
    }

    private static InventoryAgingReportActor actor(ErpPrincipal principal) {
        return new InventoryAgingReportActor(
                principal.tenantId(), principal.userId(),
                principal.systemAdminId());
    }

    private static PageRequest pageable(int page, int size) {
        if (page < 0 || size < 1 || size > MAX_PAGE_SIZE) {
            throw new ConstraintViolationException(Set.of());
        }
        return PageRequest.of(page, size);
    }

    public record Response(
            List<ItemResponse> items,
            long totalQuantity,
            long age0To30Quantity,
            long age31To60Quantity,
            long age61To90Quantity,
            long age91To365Quantity,
            long ageOver365Quantity,
            int page,
            int size,
            long totalElements,
            int totalPages) {
    }

    public record ExportRequest(
            @NotNull LocalDate cutoffDate,
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
            LocalDate oldestInventoryDate,
            int maximumAgeDays,
            long totalQuantity,
            long age0To30Quantity,
            long age31To60Quantity,
            long age61To90Quantity,
            long age91To365Quantity,
            long ageOver365Quantity) {

        static ItemResponse from(InventoryAgingReportItem value) {
            return new ItemResponse(
                    value.skuId(), value.skuBusinessCode(), value.skuName(),
                    value.warehouseId(), value.warehouseBusinessCode(),
                    value.warehouseName(), value.oldestInventoryDate(),
                    value.maximumAgeDays(), value.totalQuantity(),
                    value.age0To30Quantity(), value.age31To60Quantity(),
                    value.age61To90Quantity(), value.age91To365Quantity(),
                    value.ageOver365Quantity());
        }
    }
}
