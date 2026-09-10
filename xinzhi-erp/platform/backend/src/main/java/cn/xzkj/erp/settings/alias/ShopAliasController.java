package cn.xzkj.erp.settings.alias;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

@RestController
@Validated
@RequestMapping("/api/v1/settings/shop-aliases")
public class ShopAliasController {
    private final ShopAliasService service;

    public ShopAliasController(ShopAliasService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('settings.read')")
    public PageResponse list(@AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) @Size(max = 160) String keyword,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "25") @Min(1) @Max(100) int size,
            HttpServletRequest request) {
        return PageResponse.from(service.list(actor(principal, request),
                new ShopAliasService.AliasQuery(keyword, page, size)));
    }

    @PutMapping("/{shopId}")
    @PreAuthorize("hasAuthority('settings.parameter.write')")
    public AliasResponse save(@AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID shopId,
            @Valid @RequestBody SaveRequest body,
            HttpServletRequest request) {
        return AliasResponse.from(service.save(actor(principal, request), shopId,
                body.expectedVersion(), body.input()));
    }

    private static ShopAliasService.Actor actor(ErpPrincipal principal,
            HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId == null || !requestId.matches("^[A-Za-z0-9._:-]{1,100}$")) {
            requestId = UUID.randomUUID().toString();
        }
        return new ShopAliasService.Actor(principal.tenantId(), principal.userId(),
                principal.systemAdminId(), principal.displayName(), requestId,
                request.getRemoteAddr());
    }

    public record SaveRequest(@Min(0) long expectedVersion,
            @Size(max = 160) String aliasEn,
            @Size(max = 160) String aliasZhCn,
            @Size(max = 160) String aliasEs,
            @Size(max = 160) String aliasId,
            @Size(max = 160) String aliasTh,
            @Size(max = 160) String aliasRu,
            @Size(max = 160) String aliasPt,
            @Size(max = 160) String aliasVi,
            @Size(max = 160) String aliasMs) {
        ShopAliasService.AliasInput input() {
            return new ShopAliasService.AliasInput(aliasEn, aliasZhCn, aliasEs,
                    aliasId, aliasTh, aliasRu, aliasPt, aliasVi, aliasMs);
        }
    }

    public record AliasResponse(UUID shopId, String shopDisplayName,
            String platformCode, String aliasEn, String aliasZhCn,
            String aliasEs, String aliasId, String aliasTh, String aliasRu,
            String aliasPt, String aliasVi, String aliasMs, boolean configured,
            long version, String updatedByDisplayName, Instant updatedAt) {
        static AliasResponse from(ShopAliasRecord source) {
            return new AliasResponse(source.shopId(), source.shopDisplayName(),
                    source.platformCode(), source.aliasEn(), source.aliasZhCn(),
                    source.aliasEs(), source.aliasId(), source.aliasTh(),
                    source.aliasRu(), source.aliasPt(), source.aliasVi(),
                    source.aliasMs(), source.configured(), source.version(),
                    source.updatedByDisplayName(), source.updatedAt());
        }
    }

    public record PageResponse(List<AliasResponse> items, int page, int size,
            long totalElements, int totalPages) {
        static PageResponse from(ShopAliasService.AliasPage source) {
            return new PageResponse(source.items().stream().map(AliasResponse::from)
                    .toList(), source.page(), source.size(), source.totalElements(),
                    source.totalPages());
        }
    }
}
