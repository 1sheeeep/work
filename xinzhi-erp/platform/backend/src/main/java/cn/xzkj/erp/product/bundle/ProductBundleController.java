package cn.xzkj.erp.product.bundle;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import org.springframework.format.annotation.DateTimeFormat;
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
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

@RestController
@Validated
@RequestMapping("/api/v1/product-center/bundles")
public class ProductBundleController {
    private static final ZoneOffset BUSINESS_ZONE = ZoneOffset.ofHours(8);
    private static final String BUSINESS_CODE = "[A-Z][A-Z0-9_-]{1,63}";

    private final ProductBundleService service;

    public ProductBundleController(ProductBundleService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('products.read')")
    public PageResponse list(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) ProductStatus status,
            @RequestParam(required = false) @Size(max = 100) String keyword,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "25") @Min(1) @Max(100) int size,
            HttpServletRequest request) {
        Instant fromInclusive = from == null ? null
                : from.atStartOfDay().toInstant(BUSINESS_ZONE);
        Instant toExclusive = to == null ? null
                : to.plusDays(1).atStartOfDay().toInstant(BUSINESS_ZONE);
        return PageResponse.from(service.list(actor(principal, request),
                new ProductBundleService.BundleQuery(
                        status, keyword, fromInclusive, toExclusive, page, size)));
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('products.read')")
    public BundleResponse get(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id,
            HttpServletRequest request) {
        return BundleResponse.from(service.get(actor(principal, request), id));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('products.write')")
    @ResponseStatus(HttpStatus.CREATED)
    public BundleResponse create(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody CreateRequest body,
            HttpServletRequest request) {
        return BundleResponse.from(service.create(actor(principal, request),
                body.draft()));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('products.write')")
    public BundleResponse update(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id,
            @Valid @RequestBody UpdateRequest body,
            HttpServletRequest request) {
        return BundleResponse.from(service.update(actor(principal, request), id,
                body.expectedVersion(), body.draft()));
    }

    @PostMapping("/{id}/archive")
    @PreAuthorize("hasAuthority('products.write')")
    public BundleResponse archive(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id,
            @Valid @RequestBody ArchiveRequest body,
            HttpServletRequest request) {
        return BundleResponse.from(service.archive(actor(principal, request), id,
                body.expectedVersion()));
    }

    private static ProductBundleService.Actor actor(
            ErpPrincipal principal,
            HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId == null
                || !requestId.matches("^[A-Za-z0-9._:-]{1,100}$")) {
            requestId = UUID.randomUUID().toString();
        }
        return new ProductBundleService.Actor(
                principal.tenantId(), principal.userId(),
                principal.systemAdminId(), principal.displayName(), requestId,
                request.getRemoteAddr());
    }

    public record ComponentRequest(
            @NotNull UUID skuId,
            @Min(1) @Max(1_000_000) int quantity) {
        ProductBundleService.ComponentInput input() {
            return new ProductBundleService.ComponentInput(skuId, quantity);
        }
    }

    public record CreateRequest(
            @NotBlank @Pattern(regexp = BUSINESS_CODE) String businessCode,
            @NotBlank @Size(max = 200) String name,
            @Size(max = 1000) String description,
            @NotEmpty @Size(max = 100)
            List<@NotNull @Valid ComponentRequest> components) {
        ProductBundleService.BundleDraft draft() {
            return new ProductBundleService.BundleDraft(
                    businessCode, name, description, ProductStatus.ACTIVE,
                    components.stream().map(ComponentRequest::input).toList());
        }
    }

    public record UpdateRequest(
            @Min(0) long expectedVersion,
            @NotBlank @Size(max = 200) String name,
            @Size(max = 1000) String description,
            @NotNull ProductStatus status,
            @NotEmpty @Size(max = 100)
            List<@NotNull @Valid ComponentRequest> components) {
        ProductBundleService.BundleDraft draft() {
            return new ProductBundleService.BundleDraft(
                    null, name, description, status,
                    components.stream().map(ComponentRequest::input).toList());
        }
    }

    public record ArchiveRequest(@Min(0) long expectedVersion) {
    }

    public record ComponentResponse(
            UUID skuId,
            String skuCode,
            String skuName,
            int quantity) {
        static ComponentResponse from(ProductBundleRecord.Component source) {
            return new ComponentResponse(
                    source.skuId(), source.skuCode(), source.skuName(),
                    source.quantity());
        }
    }

    public record BundleResponse(
            UUID id,
            String businessCode,
            String name,
            String description,
            ProductStatus status,
            List<ComponentResponse> components,
            int componentCount,
            long totalUnits,
            long version,
            String createdByDisplayName,
            String updatedByDisplayName,
            Instant createdAt,
            Instant updatedAt) {
        static BundleResponse from(ProductBundleRecord source) {
            return new BundleResponse(
                    source.id(), source.businessCode(), source.name(),
                    source.description(), source.status(),
                    source.components().stream()
                            .map(ComponentResponse::from).toList(),
                    source.componentCount(), source.totalUnits(), source.version(),
                    source.createdByDisplayName(), source.updatedByDisplayName(),
                    source.createdAt(), source.updatedAt());
        }
    }

    public record PageResponse(
            List<BundleResponse> items,
            int page,
            int size,
            long totalElements,
            int totalPages) {
        static PageResponse from(ProductBundleService.BundlePage source) {
            return new PageResponse(
                    source.items().stream().map(BundleResponse::from).toList(),
                    source.page(), source.size(), source.totalElements(),
                    source.totalPages());
        }
    }
}
