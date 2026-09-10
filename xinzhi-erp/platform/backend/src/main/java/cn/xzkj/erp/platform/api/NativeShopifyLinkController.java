package cn.xzkj.erp.platform.api;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.platform.service.NativeShopifyLinkService;
import cn.xzkj.erp.platform.service.ShopCenterActor;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.util.UUID;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/platform-center")
@PreAuthorize("hasAuthority('shop:authorization:write')")
public class NativeShopifyLinkController {
    private final NativeShopifyLinkService service;

    public NativeShopifyLinkController(NativeShopifyLinkService service) {
        this.service = service;
    }

    @PostMapping("/shopify/native-link/preview")
    public NativeShopifyLinkService.Preview preview(@AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody ProofRequest input, HttpServletRequest request) {
        return service.preview(actor(principal, request), input.proof());
    }

    @PostMapping("/shopify/native-link/prepare")
    public NativeShopifyLinkService.PreparedShop prepare(@AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody ProofRequest input, HttpServletRequest request) {
        return service.prepare(actor(principal, request), input.proof());
    }

    @PostMapping("/shops/{shopId}/channels/shopify/native-link/confirm")
    public NativeShopifyLinkService.PreparedShop confirm(@AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID shopId, @Valid @RequestBody ProofRequest input, HttpServletRequest request) {
        return service.confirm(actor(principal, request), shopId, input.proof());
    }

    private static ShopCenterActor actor(ErpPrincipal principal, HttpServletRequest request) {
        if (principal == null || principal.userId() == null || principal.tenantId() == null
                || principal.systemAdminId() != null) throw new AccessDeniedException("Native user required");
        if (request.getQueryString() != null) throw new IllegalArgumentException("Query is not supported");
        String requestId = request.getHeader("X-Request-ID");
        if (requestId == null || !requestId.matches("[A-Za-z0-9._:-]{1,100}")) {
            requestId = UUID.randomUUID().toString();
        }
        return new ShopCenterActor(principal.tenantId(), principal.userId(), null, requestId, request.getRemoteAddr());
    }

    public record ProofRequest(@NotNull @Pattern(regexp = "[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]") String proof) {
        @com.fasterxml.jackson.annotation.JsonAnySetter
        public void rejectUnknown(String key, Object value) {
            throw new IllegalArgumentException("Unexpected linking field");
        }
        @Override public String toString() { return "ProofRequest[REDACTED]"; }
    }
}
