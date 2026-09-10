package cn.xzkj.erp.analytics.productboard;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Validated
@RequestMapping("/api/v1/analytics/dashboard-product-sales")
public class ProductSalesBoardController {
    private static final Duration WINDOW = Duration.ofDays(7);
    private final ProductSalesBoardService service;

    public ProductSalesBoardController(ProductSalesBoardService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('analytics.read') and hasAuthority('products.read')")
    public Response summarize(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
            Instant observedAt,
            @RequestParam(defaultValue = "5") @Min(1) @Max(10) int limit) {
        ProductSalesBoardResult result = service.summarize(
                new ProductSalesBoardActor(
                        principal.tenantId(), principal.userId(),
                        principal.systemAdminId()),
                observedAt, limit);
        return new Response(
                result.hotItems().stream().map(ItemResponse::from).toList(),
                result.lowItems().stream().map(ItemResponse::from).toList(),
                result.activeSkuCount(), result.soldSkuCount(),
                result.salesQuantity(), observedAt.minus(WINDOW), observedAt);
    }

    public record Response(
            List<ItemResponse> hotItems,
            List<ItemResponse> lowItems,
            long activeSkuCount,
            long soldSkuCount,
            long salesQuantity,
            Instant rangeFrom,
            Instant observedAt) {
    }

    public record ItemResponse(
            UUID skuId,
            String skuCode,
            String skuName,
            String variantSummary,
            long orderCount,
            long salesQuantity,
            Instant lastPlacedAt) {
        static ItemResponse from(ProductSalesBoardItem item) {
            return new ItemResponse(
                    item.skuId(), item.skuCode(), item.skuName(),
                    item.variantSummary(), item.orderCount(),
                    item.salesQuantity(), item.lastPlacedAt());
        }
    }
}
