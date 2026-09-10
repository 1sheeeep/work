package cn.xzkj.erp.platformadmin.shopifyrelease;

import cn.xzkj.erp.platformadmin.application.PlatformAdminActor;
import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.platformadmin.shopifyrelease.ShopifyAppReleaseService.ReleaseView;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.util.regex.Pattern;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Validated
@RestController
@RequestMapping("/api/v1/erp-operator/shopify-app-release")
public class PlatformShopifyAppReleaseController {
    private static final Pattern REQUEST_ID =
            Pattern.compile("^[A-Za-z0-9._:-]{1,100}$");

    private final ShopifyAppReleaseService service;

    public PlatformShopifyAppReleaseController(ShopifyAppReleaseService service) {
        this.service = service;
    }

    @GetMapping
    public ReleaseView get() {
        return service.get();
    }

    @PutMapping("/token")
    public ReleaseView configure(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody ConfigureTokenRequest body,
            HttpServletRequest request) {
        return service.configure(actor(principal, request),
                body.automationToken().toCharArray(), body.version());
    }

    @DeleteMapping("/token")
    public ReleaseView clear(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody VersionRequest body,
            HttpServletRequest request) {
        return service.clear(actor(principal, request), body.version());
    }

    @PostMapping("/publish")
    public ReleaseView publish(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody VersionRequest body,
            HttpServletRequest request) {
        return service.release(actor(principal, request), body.version());
    }

    private static PlatformAdminActor actor(ErpPrincipal principal,
            HttpServletRequest request) {
        return new PlatformAdminActor(principal.systemAdminId(), principal.sessionId(),
                requestId(request), request.getRemoteAddr());
    }

    private static String requestId(HttpServletRequest request) {
        String value = request.getHeader("X-Request-Id");
        if (value == null) return null;
        value = value.strip();
        return REQUEST_ID.matcher(value).matches() ? value : null;
    }

    public record ConfigureTokenRequest(
            @NotBlank @Size(min = 20, max = 4096) String automationToken,
            @PositiveOrZero long version) {
        @Override
        public String toString() {
            return "ConfigureTokenRequest[REDACTED]";
        }
    }

    public record VersionRequest(@PositiveOrZero long version) {
    }
}
