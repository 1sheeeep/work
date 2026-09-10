package cn.xzkj.erp.analytics.listingsales;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
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
@RequestMapping("/api/v1/analytics/listing-sales")
public class ListingRealtimeSalesController {
    private static final int MAX_PAGE_SIZE = 100;
    private final ListingRealtimeSalesService service;

    public ListingRealtimeSalesController(ListingRealtimeSalesService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('analytics.read')")
    public Response summarize(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) @Size(max = 100) String keyword,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
            Instant rangeFrom,
            @RequestParam
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
            Instant asOf,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "25") @Min(1) @Max(MAX_PAGE_SIZE)
            int size) {
        ListingRealtimeSalesResult result = service.summarize(
                new ListingRealtimeSalesActor(
                        principal.tenantId(), principal.userId(),
                        principal.systemAdminId()),
                keyword, rangeFrom, asOf, pageable(page, size));
        int totalPages = result.totalListingCount() == 0
                ? 0
                : Math.toIntExact(
                        (result.totalListingCount() + size - 1) / size);
        return new Response(
                result.items().stream().map(ItemResponse::from).toList(),
                result.totalListingCount(),
                result.totalRangeSalesQuantity(), asOf,
                page, size, totalPages);
    }

    @PostMapping("/exports")
    @PreAuthorize("hasAuthority('analytics.read')")
    public ExportResponse export(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody ExportRequest body) {
        var result = service.exportCsv(
                new ListingRealtimeSalesActor(
                        principal.tenantId(), principal.userId(),
                        principal.systemAdminId()),
                body.keyword(), body.rangeFrom(), body.asOf());
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
            long totalListingCount,
            long totalRangeSalesQuantity,
            Instant observedAt,
            int page,
            int size,
            int totalPages) {
    }

    public record ExportRequest(
            @Size(max = 100) String keyword,
            Instant rangeFrom,
            @NotNull Instant asOf) {
    }

    public record ExportResponse(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }

    public record ItemResponse(
            UUID listingId,
            String platformCode,
            String platformName,
            UUID shopId,
            String shopName,
            String externalListingRef,
            String externalVariantRef,
            UUID skuId,
            String skuCode,
            String skuName,
            String variantSummary,
            long rangeSalesQuantity,
            long rangeOrderCount,
            long todaySalesQuantity,
            long yesterdaySalesQuantity,
            long last7DaysSalesQuantity,
            long last28DaysSalesQuantity,
            long last42DaysSalesQuantity,
            Instant lastPlacedAt) {
        static ItemResponse from(ListingRealtimeSalesItem item) {
            return new ItemResponse(
                    item.listingId(), item.platformCode(), item.platformName(),
                    item.shopId(), item.shopName(),
                    item.externalListingRef(), item.externalVariantRef(),
                    item.skuId(), item.skuCode(), item.skuName(),
                    item.variantSummary(), item.rangeSalesQuantity(),
                    item.rangeOrderCount(), item.todaySalesQuantity(),
                    item.yesterdaySalesQuantity(),
                    item.last7DaysSalesQuantity(),
                    item.last28DaysSalesQuantity(),
                    item.last42DaysSalesQuantity(), item.lastPlacedAt());
        }
    }
}
