package cn.xzkj.erp.product.supplyprice;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.product.domain.ProductStatus;
import cn.xzkj.erp.product.supplyprice.ProductSupplyPriceRecord.SkuType;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

@RestController
@Validated
@RequestMapping("/api/v1/product-center/supply-prices")
public class ProductSupplyPriceController {
    private final ProductSupplyPriceService service;

    public ProductSupplyPriceController(ProductSupplyPriceService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('products.read')")
    public PageResponse list(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) ProductStatus status,
            @RequestParam(required = false) SkuType skuType,
            @RequestParam(required = false)
            @Pattern(regexp = "[A-Za-z]{2}") String country,
            @RequestParam(required = false) @Size(max = 100) String keyword,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "25") @Min(1) @Max(100) int size,
            HttpServletRequest request) {
        return PageResponse.from(service.list(actor(principal, request),
                new ProductSupplyPriceService.PriceQuery(
                        status, skuType, country, keyword, page, size)));
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('products.read')")
    public PriceResponse get(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id,
            HttpServletRequest request) {
        return PriceResponse.from(service.get(actor(principal, request), id));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('products.write')")
    @ResponseStatus(HttpStatus.CREATED)
    public PriceResponse create(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody CreateRequest body,
            HttpServletRequest request) {
        return PriceResponse.from(service.create(actor(principal, request),
                body.draft()));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('products.write')")
    public PriceResponse update(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id,
            @Valid @RequestBody UpdateRequest body,
            HttpServletRequest request) {
        return PriceResponse.from(service.update(actor(principal, request), id,
                body.expectedVersion(), body.draft()));
    }

    @PostMapping("/{id}/archive")
    @PreAuthorize("hasAuthority('products.write')")
    public PriceResponse archive(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id,
            @Valid @RequestBody ArchiveRequest body,
            HttpServletRequest request) {
        return PriceResponse.from(service.archive(actor(principal, request), id,
                body.expectedVersion()));
    }

    @PostMapping("/batch-status")
    @PreAuthorize("hasAuthority('products.write')")
    public BatchResponse batchStatus(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody BatchStatusRequest body,
            HttpServletRequest request) {
        return new BatchResponse(service.changeStatus(actor(principal, request), body.status(),
                body.items().stream().map(VersionedRequest::versioned).toList())
                .stream().map(PriceResponse::from).toList());
    }

    private static ProductSupplyPriceService.Actor actor(
            ErpPrincipal principal,
            HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId == null
                || !requestId.matches("^[A-Za-z0-9._:-]{1,100}$")) {
            requestId = UUID.randomUUID().toString();
        }
        return new ProductSupplyPriceService.Actor(
                principal.tenantId(), principal.userId(),
                principal.systemAdminId(), principal.displayName(), requestId,
                request.getRemoteAddr());
    }

    public record CreateRequest(
            @NotNull SkuType skuType,
            @NotNull UUID referenceId,
            @NotNull @Pattern(regexp = "[A-Za-z]{2}") String salesCountry,
            @NotNull @Pattern(regexp = "[A-Za-z]{3}") String currency,
            @NotNull @DecimalMin("0.0001")
            @DecimalMax("999999999999999.9999") @Digits(integer = 15, fraction = 4)
            BigDecimal unitPrice,
            @Min(1) @Max(1_000_000) int minimumQuantity,
            @NotNull LocalDate validFrom,
            LocalDate validTo,
            @Size(max = 500) String note) {
        ProductSupplyPriceService.PriceDraft draft() {
            return new ProductSupplyPriceService.PriceDraft(
                    skuType, referenceId, salesCountry, currency, unitPrice,
                    minimumQuantity, validFrom, validTo, ProductStatus.ACTIVE,
                    note);
        }
    }

    public record UpdateRequest(
            @Min(0) long expectedVersion,
            @NotNull @Pattern(regexp = "[A-Za-z]{3}") String currency,
            @NotNull @DecimalMin("0.0001")
            @DecimalMax("999999999999999.9999") @Digits(integer = 15, fraction = 4)
            BigDecimal unitPrice,
            @Min(1) @Max(1_000_000) int minimumQuantity,
            @NotNull LocalDate validFrom,
            LocalDate validTo,
            @NotNull ProductStatus status,
            @Size(max = 500) String note) {
        ProductSupplyPriceService.PriceDraft draft() {
            return new ProductSupplyPriceService.PriceDraft(
                    null, null, null, currency, unitPrice, minimumQuantity,
                    validFrom, validTo, status, note);
        }
    }

    public record ArchiveRequest(@Min(0) long expectedVersion) {
    }

    public record VersionedRequest(
            @NotNull UUID id,
            @Min(0) long expectedVersion) {
        ProductSupplyPriceService.VersionedId versioned() {
            return new ProductSupplyPriceService.VersionedId(id, expectedVersion);
        }
    }

    public record BatchStatusRequest(
            @NotNull ProductStatus status,
            @NotEmpty @Size(max = 100)
            List<@NotNull @Valid VersionedRequest> items) {
    }

    public record BatchResponse(List<PriceResponse> items) {
        public BatchResponse {
            items = List.copyOf(items);
        }
    }

    public record PriceResponse(
            UUID id,
            SkuType skuType,
            UUID referenceId,
            String skuCode,
            String skuName,
            String salesCountry,
            String currency,
            BigDecimal unitPrice,
            int minimumQuantity,
            LocalDate validFrom,
            LocalDate validTo,
            ProductStatus status,
            String note,
            long version,
            String createdByDisplayName,
            String updatedByDisplayName,
            Instant createdAt,
            Instant updatedAt) {
        static PriceResponse from(ProductSupplyPriceRecord source) {
            return new PriceResponse(
                    source.id(), source.skuType(), source.referenceId(),
                    source.skuCode(), source.skuName(), source.salesCountry(),
                    source.currency(), source.unitPrice(),
                    source.minimumQuantity(), source.validFrom(), source.validTo(),
                    source.status(), source.note(), source.version(),
                    source.createdByDisplayName(), source.updatedByDisplayName(),
                    source.createdAt(), source.updatedAt());
        }
    }

    public record PageResponse(
            List<PriceResponse> items,
            int page,
            int size,
            long totalElements,
            int totalPages) {
        static PageResponse from(ProductSupplyPriceService.PricePage source) {
            return new PageResponse(
                    source.items().stream().map(PriceResponse::from).toList(),
                    source.page(), source.size(), source.totalElements(),
                    source.totalPages());
        }
    }
}
