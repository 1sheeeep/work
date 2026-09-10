package cn.xzkj.erp.procurement.recommendation;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.procurement.recommendation.ProcurementRecommendationService.ProcurementGenerationSelection;
import cn.xzkj.erp.procurement.service.ProcurementPlanActor;
import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Validated
@RequestMapping("/api/v1/procurement/recommendations")
public class ProcurementRecommendationController {
    private static final int MAX_PAGE_SIZE = 100;
    private final ProcurementRecommendationService service;

    public ProcurementRecommendationController(
            ProcurementRecommendationService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('procurement.read')")
    public Response summarize(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) @Size(max = 100) String supplier,
            @RequestParam(required = false) @Size(max = 120) String keyword,
            @RequestParam(defaultValue = "false") boolean hideWithoutSupplier,
            @RequestParam(defaultValue = "false")
            boolean hideZeroRecommendation,
            @RequestParam Instant asOf,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "25")
            @Min(1) @Max(100) int size,
            HttpServletRequest request) {
        ProcurementRecommendationResult result = service.summarize(
                actor(principal, request, null), supplier, keyword,
                hideWithoutSupplier, hideZeroRecommendation, asOf,
                pageable(page, size));
        int totalPages = result.totalElements() == 0
                ? 0
                : Math.toIntExact(
                        (result.totalElements() + size - 1) / size);
        return new Response(
                result.items().stream().map(ItemResponse::from).toList(),
                result.locations().stream().map(LocationResponse::from).toList(),
                result.totalElements(), result.actionableCount(),
                result.totalRecommendedQuantity(),
                ProcurementRecommendationService.SALES_WINDOW_DAYS,
                ProcurementRecommendationService.DEFAULT_LEAD_TIME_DAYS,
                ProcurementRecommendationService.SAFETY_DAYS,
                asOf, page, size, totalPages);
    }

    @PostMapping("/exports")
    @PreAuthorize("hasAuthority('procurement.read')")
    public ExportResponse export(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody ExportRequest body,
            HttpServletRequest request) {
        var result = service.exportCsv(
                actor(principal, request, null), body.supplier(),
                body.keyword(), body.hideWithoutSupplier(),
                body.hideZeroRecommendation(), body.asOf());
        return new ExportResponse(
                result.filename(), result.mediaType(), result.rowCount(),
                result.content());
    }

    @PostMapping("/generate")
    @PreAuthorize("hasAuthority('procurement.write')")
    public GenerationResponse generate(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestHeader("X-Request-Id")
            @Size(min = 1, max = 100)
            @Pattern(regexp = "^[A-Za-z0-9._:-]+$") String requestId,
            @Valid @RequestBody GenerateRequest body,
            HttpServletRequest request) {
        var result = service.generate(
                actor(principal, request, requestId), body.commandId(),
                body.observedAt(), body.items().stream()
                        .map(item -> new ProcurementGenerationSelection(
                                item.skuId(), item.warehouseId(),
                                item.locationId(),
                                item.expectedRecommendedQuantity(),
                                item.quantity()))
                        .toList());
        return new GenerationResponse(
                result.commandId(), result.observedAt(),
                result.items().stream()
                        .map(item -> new GeneratedItemResponse(
                                item.purchaseOrderId(), item.purchaseNo(),
                                item.planId(), item.planNo(), item.skuId(),
                                item.warehouseId(), item.locationId(),
                                item.supplierId(), item.quantity()))
                        .toList());
    }

    private static ProcurementPlanActor actor(
            ErpPrincipal principal,
            HttpServletRequest request,
            String requestId) {
        return new ProcurementPlanActor(
                principal.tenantId(), principal.userId(),
                principal.systemAdminId(), principal.displayName(),
                requestId, request.getRemoteAddr());
    }

    private static PageRequest pageable(int page, int size) {
        if (page < 0 || size < 1 || size > MAX_PAGE_SIZE) {
            throw new ConstraintViolationException(Set.of());
        }
        return PageRequest.of(page, size);
    }

    public record Response(
            List<ItemResponse> items,
            List<LocationResponse> locations,
            long totalElements,
            long actionableCount,
            long totalRecommendedQuantity,
            int salesWindowDays,
            int defaultLeadTimeDays,
            int safetyDays,
            Instant observedAt,
            int page,
            int size,
            int totalPages) {
    }

    public record ItemResponse(
            UUID skuId,
            String skuCode,
            String skuName,
            String skuVariant,
            UUID warehouseId,
            String warehouseCode,
            String warehouseName,
            long onHand,
            long reserved,
            long available,
            long last28DaysSalesQuantity,
            long openPurchaseQuantity,
            UUID supplierId,
            String supplierCode,
            String supplierName,
            String supplierSkuCode,
            Integer supplierLeadTimeDays,
            int planningLeadTimeDays,
            int safetyDays,
            int targetCoverageDays,
            long targetStockQuantity,
            long recommendedQuantity,
            int activeLocationCount) {
        static ItemResponse from(ProcurementRecommendationItem value) {
            return new ItemResponse(
                    value.skuId(), value.skuCode(), value.skuName(),
                    value.skuVariant(), value.warehouseId(),
                    value.warehouseCode(), value.warehouseName(),
                    value.onHand(), value.reserved(), value.available(),
                    value.last28DaysSalesQuantity(),
                    value.openPurchaseQuantity(), value.supplierId(),
                    value.supplierCode(), value.supplierName(),
                    value.supplierSkuCode(), value.supplierLeadTimeDays(),
                    value.planningLeadTimeDays(), value.safetyDays(),
                    value.targetCoverageDays(), value.targetStockQuantity(),
                    value.recommendedQuantity(), value.activeLocationCount());
        }
    }

    public record LocationResponse(
            UUID id,
            UUID warehouseId,
            String businessCode,
            String name) {
        static LocationResponse from(ProcurementRecommendationLocation value) {
            return new LocationResponse(
                    value.id(), value.warehouseId(),
                    value.businessCode(), value.name());
        }
    }

    public record ExportRequest(
            @Size(max = 100) String supplier,
            @Size(max = 120) String keyword,
            boolean hideWithoutSupplier,
            boolean hideZeroRecommendation,
            @NotNull Instant asOf) {
        @JsonAnySetter
        public void rejectUnknownField(String field, Object value) {
            throw new IllegalArgumentException(
                    "Unknown procurement recommendation export request field");
        }
    }

    public record ExportResponse(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }

    public record GenerateRequest(
            @NotNull UUID commandId,
            @NotNull Instant observedAt,
            @NotEmpty @Size(max = 50) List<@Valid GenerateItemRequest> items) {
        @JsonAnySetter
        public void rejectUnknownField(String field, Object value) {
            throw new IllegalArgumentException(
                    "Unknown procurement recommendation generate request field");
        }
    }

    public record GenerateItemRequest(
            @NotNull UUID skuId,
            @NotNull UUID warehouseId,
            @NotNull UUID locationId,
            @Positive @Max(1_000_000_000L)
            long expectedRecommendedQuantity,
            @Positive @Max(1_000_000_000L) long quantity) {
        @JsonAnySetter
        public void rejectUnknownField(String field, Object value) {
            throw new IllegalArgumentException(
                    "Unknown procurement recommendation item field");
        }
    }

    public record GenerationResponse(
            UUID commandId,
            Instant observedAt,
            List<GeneratedItemResponse> items) {
    }

    public record GeneratedItemResponse(
            UUID purchaseOrderId,
            String purchaseNo,
            UUID planId,
            String planNo,
            UUID skuId,
            UUID warehouseId,
            UUID locationId,
            UUID supplierId,
            long quantity) {
    }
}
