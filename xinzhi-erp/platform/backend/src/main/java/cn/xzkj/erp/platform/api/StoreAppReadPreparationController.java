package cn.xzkj.erp.platform.api;

import java.util.UUID;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.platform.connector.StoreAppReadPreparationService;
import cn.xzkj.erp.platform.service.ShopCenterActor;
import jakarta.servlet.http.HttpServletResponse;

@RestController
@RequestMapping("/api/v1/platform-center/shops/{shopId}/store-app-read-preparation")
@ConditionalOnProperty(name = "erp.store-app-read-preparation.enabled", havingValue = "true")
public class StoreAppReadPreparationController {
    private final StoreAppReadPreparationService service;
    public StoreAppReadPreparationController(StoreAppReadPreparationService service) { this.service = service; }

    @GetMapping
    @PreAuthorize("hasAuthority('shop:read') and hasAuthority('shop:authorization:write')")
    public StoreAppReadPreparationService.StatusPreview status(
            @AuthenticationPrincipal ErpPrincipal principal, @PathVariable UUID shopId,
            HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return service.status(actor(principal), shopId);
    }

    @GetMapping("/orders")
    @PreAuthorize("hasAuthority('shop:read') and hasAuthority('shop:authorization:write') and hasAuthority('orders.read')")
    public StoreAppReadPreparationService.OrderPreview orders(
            @AuthenticationPrincipal ErpPrincipal principal, @PathVariable UUID shopId,
            @RequestParam(defaultValue = "10") int limit, @RequestParam(required = false) String cursor,
            HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return service.orders(actor(principal), shopId, limit, cursor);
    }

    private static ShopCenterActor actor(ErpPrincipal principal) {
        return new ShopCenterActor(principal.tenantId(), principal.userId(), principal.systemAdminId(), null, null);
    }
}
