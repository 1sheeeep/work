package cn.xzkj.erp.platform.api;

import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ChannelSnapshot;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.OrderCatalogPage;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ProductCatalogPage;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyAuthorizationStart;
import cn.xzkj.erp.platform.service.ShopCenterActor;
import cn.xzkj.erp.platform.service.ShopChannelService;
import cn.xzkj.erp.platform.service.ShopifyLocationMappingService;
import cn.xzkj.erp.platform.service.ShopifyLocationMappingService.LocationMappingCatalog;
import cn.xzkj.erp.platform.service.ShopifyLocationMappingService.LocationMappingItem;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

@RestController
@Validated
@RequestMapping("/api/v1/platform-center/shops/{shopId}/channels")
public class ShopChannelController {

    private static final Pattern REQUEST_ID = Pattern.compile("^[A-Za-z0-9._:-]{1,100}$");

    private final ShopChannelService service;
    private final ShopifyLocationMappingService locationMappingService;

    public ShopChannelController(
            ShopChannelService service,
            ShopifyLocationMappingService locationMappingService) {
        this.service = service;
        this.locationMappingService = locationMappingService;
    }

    @GetMapping
    @PreAuthorize("hasAnyAuthority('shop:read', 'customer_service.read')")
    public ChannelSnapshot get(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID shopId,
            HttpServletRequest request) {
        return service.get(actor(principal, request), shopId);
    }

    @GetMapping("/shopify/product-catalog")
    @PreAuthorize("hasAuthority('products.listing.read')")
    public ProductCatalogPage fetchShopifyProductCatalog(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID shopId,
            @RequestParam(defaultValue = "50") int limit,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) @Size(max = 500) String query,
            HttpServletRequest request) {
        return service.fetchShopifyProductCatalog(
                actor(principal, request),
                shopId,
                limit,
                cursor,
                query);
    }

    @GetMapping("/shopify/order-catalog")
    @PreAuthorize("hasAuthority('orders.read')")
    public OrderCatalogPage fetchShopifyOrderCatalog(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID shopId,
            @RequestParam(defaultValue = "50") int limit,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) @Size(max = 500) String query,
            HttpServletRequest request) {
        return service.fetchShopifyOrderCatalog(
                actor(principal, request),
                shopId,
                limit,
                cursor,
                query);
    }

    @GetMapping("/shopify/location-mappings")
    @PreAuthorize("hasAuthority('shop:read') and hasAuthority('warehouses.read')")
    public LocationMappingCatalog getShopifyLocationMappings(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID shopId,
            HttpServletRequest request) {
        return locationMappingService.list(actor(principal, request), shopId);
    }

    @PutMapping("/shopify/location-mappings")
    @PreAuthorize("hasAuthority('shop:write') and hasAuthority('warehouses.write')")
    public LocationMappingItem upsertShopifyLocationMapping(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID shopId,
            @Valid @RequestBody UpsertLocationMappingRequest input,
            HttpServletRequest request) {
        return locationMappingService.upsert(
                actor(principal, request),
                shopId,
                input.externalLocationRef(),
                input.warehouseId());
    }

    @DeleteMapping("/shopify/location-mappings/{mappingId}")
    @PreAuthorize("hasAuthority('shop:write') and hasAuthority('warehouses.write')")
    public void deleteShopifyLocationMapping(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID shopId,
            @PathVariable UUID mappingId,
            HttpServletRequest request) {
        locationMappingService.delete(
                actor(principal, request), shopId, mappingId);
    }

    @PostMapping("/shopify/authorize")
    @PreAuthorize("hasAuthority('shop:authorization:write')")
    public ShopifyAuthorizationStart authorizeShopify(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID shopId,
            HttpServletRequest request) {
        return service.authorizeShopify(actor(principal, request), shopId);
    }

    @PostMapping("/shopify/retry")
    @PreAuthorize("hasAuthority('shop:authorization:write')")
    public ChannelSnapshot retryShopify(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID shopId,
            HttpServletRequest request) {
        return service.retryShopify(actor(principal, request), shopId);
    }

    @PostMapping("/shopify/uninstall")
    @PreAuthorize("hasAuthority('shop:authorization:write')")
    public ChannelSnapshot uninstallShopify(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID shopId,
            HttpServletRequest request) {
        return service.uninstallShopify(actor(principal, request), shopId);
    }

    private static ShopCenterActor actor(ErpPrincipal principal, HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId != null) {
            requestId = requestId.strip();
            if (!REQUEST_ID.matcher(requestId).matches()) {
                requestId = null;
            }
        }
        return new ShopCenterActor(
                principal.tenantId(),
                principal.userId(),
                principal.systemAdminId(),
                requestId,
                request.getRemoteAddr());
    }

    public record UpsertLocationMappingRequest(
            @NotBlank @Size(max = 160) String externalLocationRef,
            @NotNull UUID warehouseId) {
    }
}
