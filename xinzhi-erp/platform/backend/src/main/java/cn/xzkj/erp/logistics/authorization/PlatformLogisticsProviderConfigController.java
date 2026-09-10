package cn.xzkj.erp.logistics.authorization;

import cn.xzkj.erp.logistics.authorization.LogisticsProviderSystemConfigService.ProviderConfigInput;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderSystemConfigService.ProviderConfigView;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderSystemConfigService.ProviderNameInput;
import cn.xzkj.erp.platformadmin.application.PlatformAdminActor;
import cn.xzkj.erp.iam.security.ErpPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.regex.Pattern;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Validated
@RestController
@RequestMapping("/api/v1/erp-operator/logistics-provider-configs")
public class PlatformLogisticsProviderConfigController {
    private static final Pattern REQUEST_ID =
            Pattern.compile("^[A-Za-z0-9._:-]{1,100}$");

    private final LogisticsProviderSystemConfigService service;

    public PlatformLogisticsProviderConfigController(
            LogisticsProviderSystemConfigService service) {
        this.service = service;
    }

    @GetMapping
    public List<ProviderConfigView> list() {
        return service.list();
    }

    @PutMapping("/{providerCode}")
    public ProviderConfigView configure(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable String providerCode,
            @Valid @RequestBody ConfigureProviderRequest body,
            HttpServletRequest request) {
        return service.configure(actor(principal, request), providerCode,
                new ProviderConfigInput(body.customerCode(),
                        body.authorizationCode(), body.secret(), body.version()));
    }

    @PutMapping("/{providerCode}/name")
    public ProviderConfigView rename(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable String providerCode,
            @Valid @RequestBody RenameProviderRequest body,
            HttpServletRequest request) {
        return service.rename(actor(principal, request), providerCode,
                new ProviderNameInput(body.providerName(), body.version()));
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

    public record ConfigureProviderRequest(
            @NotBlank @Size(max = 256) String customerCode,
            @NotBlank @Size(max = 2048) String authorizationCode,
            @NotBlank @Size(max = 2048) String secret,
            @PositiveOrZero long version) {
        @Override
        public String toString() {
            return "ConfigureProviderRequest[REDACTED]";
        }
    }

    public record RenameProviderRequest(
            @NotBlank @Size(max = 120) String providerName,
            @PositiveOrZero long version) {
    }
}
