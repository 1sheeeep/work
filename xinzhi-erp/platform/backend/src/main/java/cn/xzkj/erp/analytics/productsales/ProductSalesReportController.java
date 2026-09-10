package cn.xzkj.erp.analytics.productsales;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import java.time.Instant;
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
@RequestMapping("/api/v1/analytics/product-sales")
public class ProductSalesReportController {
    private static final int MAX_PAGE_SIZE = 100;
    private final ProductSalesReportService service;

    public ProductSalesReportController(ProductSalesReportService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('analytics.read')")
    public Response summarize(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) @Size(max = 100) String keyword,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
            Instant placedFrom,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
            Instant placedToExclusive,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "25") @Min(1) @Max(MAX_PAGE_SIZE)
            int size) {
        ProductSalesReportResult result = service.summarize(
                new ProductSalesReportActor(
                        principal.tenantId(), principal.userId(),
                        principal.systemAdminId()),
                keyword, placedFrom, placedToExclusive, pageable(page, size));
        int totalPages = result.totalSkuCount() == 0
                ? 0
                : Math.toIntExact((result.totalSkuCount() + size - 1) / size);
        return new Response(
                result.items().stream().map(ItemResponse::from).toList(),
                result.totalSkuCount(), result.totalSalesQuantity(),
                page, size, totalPages);
    }

    @PostMapping("/exports")
    @PreAuthorize("hasAuthority('analytics.read')")
    public ExportResponse export(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody ExportRequest body) {
        var result = service.exportCsv(
                new ProductSalesReportActor(
                        principal.tenantId(), principal.userId(),
                        principal.systemAdminId()),
                body.keyword(), body.placedFrom(), body.placedToExclusive());
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
            long totalSkuCount,
            long totalSalesQuantity,
            int page,
            int size,
            int totalPages) {
    }

    public record ExportRequest(
            @Size(max = 100) String keyword,
            Instant placedFrom,
            Instant placedToExclusive) {
    }

    public record ExportResponse(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }

    public record ItemResponse(
            UUID skuId,
            String skuCode,
            String skuName,
            String variantSummary,
            long orderCount,
            long salesQuantity,
            Instant firstPlacedAt,
            Instant lastPlacedAt) {
        static ItemResponse from(ProductSalesReportItem item) {
            return new ItemResponse(
                    item.skuId(), item.skuCode(), item.skuName(),
                    item.variantSummary(), item.orderCount(),
                    item.salesQuantity(), item.firstPlacedAt(),
                    item.lastPlacedAt());
        }
    }
}
