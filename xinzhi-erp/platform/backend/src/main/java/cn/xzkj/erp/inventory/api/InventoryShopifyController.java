package cn.xzkj.erp.inventory.api;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.inventory.service.InventoryActor;
import cn.xzkj.erp.inventory.service.ShopifyInventoryPreviewService;
import cn.xzkj.erp.inventory.service.ShopifyInventoryPreviewService.ShopifyInventoryPreview;
import cn.xzkj.erp.inventory.service.ShopifyInventoryPublicationService;
import cn.xzkj.erp.inventory.repository.ShopifyInventoryPublicationRepository.ExceptionView;
import cn.xzkj.erp.inventory.repository.ShopifyInventoryPublicationRepository.Publication;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

@RestController
@RequestMapping("/api/v1/inventory-center/shopify")
public class InventoryShopifyController {

    private static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Shanghai");

    private final ShopifyInventoryPreviewService service;
    private final ShopifyInventoryPublicationService publications;

    public InventoryShopifyController(
            ShopifyInventoryPreviewService service,
            ShopifyInventoryPublicationService publications) {
        this.service = service;
        this.publications = publications;
    }

    @GetMapping("/preview")
    @PreAuthorize("hasAuthority('inventory.read') and hasAuthority('shop:read')")
    public ShopifyInventoryPreview preview(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam UUID shopId,
            @RequestParam UUID balanceId,
            HttpServletRequest request) {
        return service.preview(
                new InventoryActor(
                        principal.tenantId(), principal.userId(),
                        principal.systemAdminId(), null,
                        request.getRemoteAddr()),
                shopId,
                balanceId);
    }

    @PostMapping("/publications")
    @ResponseStatus(HttpStatus.ACCEPTED)
    @PreAuthorize("hasAuthority('inventory.shopify.publish') and hasAuthority('inventory.read') and hasAuthority('shop:read')")
    public PublicationResponse enqueue(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestHeader("Idempotency-Key")
            @Pattern(regexp = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$")
            String idempotencyKey,
            @RequestHeader("X-Request-Id")
            @Pattern(regexp = "^[A-Za-z0-9._:-]{1,100}$")
            String requestId,
            @Valid @RequestBody PublicationRequest body,
            HttpServletRequest request) {
        var result = publications.enqueue(
                actor(principal, request, requestId),
                body.shopId(), body.balanceId(),
                body.expectedBalanceVersion(),
                body.expectedShopifyAvailable(), idempotencyKey);
        return PublicationResponse.from(
                result.publication(), result.replayed());
    }

    @GetMapping("/publications/{publicationId}")
    @PreAuthorize("hasAuthority('inventory.shopify.publish') and hasAuthority('inventory.read')")
    public PublicationResponse getPublication(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID publicationId,
            HttpServletRequest request) {
        return PublicationResponse.from(
                publications.get(actor(principal, request, null), publicationId),
                false);
    }

    @GetMapping("/publications/latest")
    @PreAuthorize("hasAuthority('inventory.shopify.publish') and hasAuthority('inventory.read')")
    public PublicationResponse getLatestPublication(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam UUID shopId,
            @RequestParam UUID balanceId,
            HttpServletRequest request) {
        return PublicationResponse.from(
                publications.getLatest(
                        actor(principal, request, null), shopId, balanceId),
                false);
    }

    @GetMapping("/publications/exceptions")
    @PreAuthorize("hasAuthority('inventory.shopify.publish') and hasAuthority('inventory.read') and hasAuthority('shop:read')")
    public ExceptionListResponse listExceptions(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) UUID shopId,
            @RequestParam(required = false) LocalDate start,
            @RequestParam(required = false) LocalDate end,
            @RequestParam(required = false, defaultValue = "")
            @Size(max = 100) String keyword,
            @RequestParam(defaultValue = "50") @Min(1) @Max(200) int limit,
            HttpServletRequest request) {
        var items = publications.listExceptions(
                actor(principal, request, null), shopId,
                start == null ? null
                        : start.atStartOfDay(BUSINESS_ZONE).toInstant(),
                end == null ? null
                        : end.plusDays(1).atStartOfDay(BUSINESS_ZONE).toInstant(),
                keyword, limit).stream()
                .map(ExceptionResponse::from)
                .toList();
        return new ExceptionListResponse(items);
    }

    private static InventoryActor actor(
            ErpPrincipal principal,
            HttpServletRequest request,
            String requestId) {
        return new InventoryActor(
                principal.tenantId(), principal.userId(),
                principal.systemAdminId(), requestId,
                request.getRemoteAddr());
    }

    public record PublicationRequest(
            UUID shopId,
            UUID balanceId,
            @Min(0) long expectedBalanceVersion,
            @Min(-1_000_000_000) @Max(1_000_000_000)
            int expectedShopifyAvailable) {
    }

    public record PublicationResponse(
            UUID id,
            UUID shopId,
            UUID balanceId,
            long expectedBalanceVersion,
            int expectedShopifyAvailable,
            int targetAvailable,
            String status,
            int attemptCount,
            String safeErrorCode,
            boolean replayed) {
        static PublicationResponse from(
                Publication value, boolean replayed) {
            return new PublicationResponse(
                    value.id(), value.shopId(), value.balanceId(),
                    value.expectedBalanceVersion(),
                    value.expectedShopifyAvailable(),
                    value.targetAvailable(), value.status(),
                    value.attemptCount(), value.safeErrorCode(), replayed);
        }
    }

    public record ExceptionListResponse(List<ExceptionResponse> items) {
    }

    public record ExceptionResponse(
            UUID id,
            UUID shopId,
            String shopName,
            String externalShopRef,
            UUID balanceId,
            UUID skuId,
            String skuCode,
            String skuName,
            UUID warehouseId,
            String warehouseCode,
            String warehouseName,
            int expectedShopifyAvailable,
            int targetAvailable,
            String status,
            int attemptCount,
            String safeErrorCode,
            java.time.Instant createdAt,
            java.time.Instant updatedAt,
            java.time.Instant completedAt) {
        static ExceptionResponse from(ExceptionView value) {
            return new ExceptionResponse(
                    value.id(), value.shopId(), value.shopName(),
                    value.externalShopRef(), value.balanceId(), value.skuId(),
                    value.skuCode(), value.skuName(), value.warehouseId(),
                    value.warehouseCode(), value.warehouseName(),
                    value.expectedShopifyAvailable(), value.targetAvailable(),
                    value.status(), value.attemptCount(), value.safeErrorCode(),
                    value.createdAt(), value.updatedAt(), value.completedAt());
        }
    }
}
