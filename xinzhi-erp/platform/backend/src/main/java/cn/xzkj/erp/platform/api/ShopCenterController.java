package cn.xzkj.erp.platform.api;

import java.net.URI;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.ResponseEntity;
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
import org.springframework.web.bind.annotation.RestController;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.platform.api.PlatformDtos.CreatePlatformRequest;
import cn.xzkj.erp.platform.api.PlatformDtos.PlatformResponse;
import cn.xzkj.erp.platform.api.ShopDtos.AuthorizationResponse;
import cn.xzkj.erp.platform.api.ShopDtos.CreateShopRequest;
import cn.xzkj.erp.platform.api.ShopDtos.ShopResponse;
import cn.xzkj.erp.platform.api.ShopDtos.UpdateAuthorizationRequest;
import cn.xzkj.erp.platform.api.ShopDtos.UpdateShopRequest;
import cn.xzkj.erp.platform.api.SyncJobDtos.CreateSyncJobRequest;
import cn.xzkj.erp.platform.api.SyncJobDtos.SyncJobResponse;
import cn.xzkj.erp.platform.api.SyncJobDtos.UpdateSyncJobRequest;
import cn.xzkj.erp.platform.domain.AuthorizationStatus;
import cn.xzkj.erp.platform.domain.ShopAuthorization;
import cn.xzkj.erp.platform.domain.ShopStatus;
import cn.xzkj.erp.platform.service.ShopCenterActor;
import cn.xzkj.erp.platform.service.ShopCenterService;
import cn.xzkj.erp.platform.service.ShopCenterService.ShopWithAuthorization;
import cn.xzkj.erp.settings.alias.ShopAliasService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

@RestController
@Validated
@RequestMapping("/api/v1/platform-center")
public class ShopCenterController {

    private static final int MAX_PAGE_SIZE = 200;
    private static final Pattern REQUEST_ID =
            Pattern.compile("^[A-Za-z0-9._:-]{1,100}$");

    private final ShopCenterService service;
    private final ShopAliasService aliasService;

    public ShopCenterController(ShopCenterService service,
            ShopAliasService aliasService) {
        this.service = service;
        this.aliasService = aliasService;
    }

    @PostMapping("/platforms")
    @PreAuthorize("hasAuthority('platform:write')")
    public ResponseEntity<PlatformResponse> createPlatform(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody CreatePlatformRequest request,
            HttpServletRequest httpRequest
    ) {
        PlatformResponse response = PlatformResponse.from(service.createPlatform(
                actor(principal, httpRequest),
                request.code(),
                request.displayName(),
                request.description()
        ));
        return ResponseEntity.created(URI.create(
                "/api/v1/platform-center/platforms/" + response.id()
        )).body(response);
    }

    @GetMapping("/platforms")
    @PreAuthorize("hasAuthority('platform:read')")
    public PageEnvelope<PlatformResponse> listPlatforms(
            @RequestParam(defaultValue = "false") boolean includeArchived,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "50") @Min(1) @Max(MAX_PAGE_SIZE) int size
    ) {
        return PageEnvelope.from(service.listPlatforms(includeArchived, pageable(page, size)), PlatformResponse::from);
    }

    @GetMapping("/platforms/{platformId}")
    @PreAuthorize("hasAuthority('platform:read')")
    public PlatformResponse getPlatform(
            @PathVariable UUID platformId
    ) {
        return PlatformResponse.from(service.getPlatform(platformId));
    }

    @PostMapping("/platforms/{platformId}/archive")
    @PreAuthorize("hasAuthority('platform:write')")
    public PlatformResponse archivePlatform(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID platformId,
            HttpServletRequest httpRequest
    ) {
        return PlatformResponse.from(service.archivePlatform(
                actor(principal, httpRequest), platformId));
    }

    @PostMapping("/shops")
    @PreAuthorize("hasAuthority('shop:write')")
    public ResponseEntity<ShopResponse> createShop(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody CreateShopRequest request,
            HttpServletRequest httpRequest
    ) {
        ShopWithAuthorization created = service.createShop(
                actor(principal, httpRequest),
                request.platformId(),
                request.externalShopRef(),
                request.displayName()
        );
        ShopResponse response = mapShop(created, aliasService.localizedName(
                principal.tenantId(), created.shop().getId(),
                httpRequest.getHeader("Accept-Language")));
        return ResponseEntity.created(URI.create(
                "/api/v1/platform-center/shops/" + response.id()
        )).body(response);
    }

    @GetMapping("/shops")
    @PreAuthorize("hasAnyAuthority('shop:read', 'customer_service.read')")
    public PageEnvelope<ShopResponse> listShops(
            @AuthenticationPrincipal(expression = "tenantId") UUID tenantId,
            @RequestParam(defaultValue = "false") boolean includeArchived,
            @RequestParam(required = false) String query,
            @RequestParam(required = false) UUID platformId,
            @RequestParam(required = false) ShopStatus status,
            @RequestParam(required = false) AuthorizationStatus authorizationStatus,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "50") @Min(1) @Max(MAX_PAGE_SIZE) int size,
            HttpServletRequest httpRequest
    ) {
        String normalizedQuery = normalizeShopQuery(query);
        Page<ShopWithAuthorization> shops;
        if (normalizedQuery == null && platformId == null && status == null && authorizationStatus == null) {
            shops = service.listShops(tenantId, includeArchived, pageable(page, size));
        } else {
            shops = service.listShops(
                    tenantId,
                    includeArchived,
                    normalizedQuery,
                    platformId,
                    status,
                    authorizationStatus,
                    pageable(page, size)
            );
        }
        Map<UUID, String> aliases = aliasService.localizedNames(tenantId,
                shops.getContent().stream().map(value -> value.shop().getId()).toList(),
                httpRequest.getHeader("Accept-Language"));
        return PageEnvelope.from(shops, value -> mapShop(value,
                aliases.get(value.shop().getId())));
    }

    @GetMapping("/shops/{shopId}")
    @PreAuthorize("hasAuthority('shop:read')")
    public ShopResponse getShop(
            @AuthenticationPrincipal(expression = "tenantId") UUID tenantId,
            @PathVariable UUID shopId,
            HttpServletRequest request
    ) {
        return mapShop(service.getShop(tenantId, shopId), aliasService.localizedName(
                tenantId, shopId, request.getHeader("Accept-Language")));
    }

    @PutMapping("/shops/{shopId}")
    @PreAuthorize("hasAuthority('shop:write')")
    public ShopResponse updateShop(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID shopId,
            @Valid @RequestBody UpdateShopRequest request,
            HttpServletRequest httpRequest
    ) {
        ShopWithAuthorization updated = service.updateShop(
                actor(principal, httpRequest),
                shopId,
                request.version(),
                request.externalShopRef(),
                request.displayName(),
                request.status()
        );
        return mapShop(updated, aliasService.localizedName(principal.tenantId(),
                shopId, httpRequest.getHeader("Accept-Language")));
    }

    @PostMapping("/shops/{shopId}/archive")
    @PreAuthorize("hasAuthority('shop:write')")
    public ShopResponse archiveShop(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID shopId,
            HttpServletRequest httpRequest
    ) {
        ShopWithAuthorization archived = service.archiveShop(
                actor(principal, httpRequest), shopId);
        return mapShop(archived, aliasService.localizedName(principal.tenantId(),
                shopId, httpRequest.getHeader("Accept-Language")));
    }

    @PutMapping("/shops/{shopId}/authorization")
    @PreAuthorize("hasAuthority('shop:authorization:write')")
    public AuthorizationResponse updateAuthorization(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID shopId,
            @Valid @RequestBody UpdateAuthorizationRequest request,
            HttpServletRequest httpRequest
    ) {
        ShopAuthorization authorization = service.updateAuthorization(
                actor(principal, httpRequest),
                shopId,
                request.status(),
                request.credentialReference(),
                request.providerAccountRef(),
                request.scopes(),
                request.authorizedAt(),
                request.expiresAt(),
                request.lastVerifiedAt(),
                request.errorSummary()
        );
        return mapAuthorization(authorization);
    }

    @PostMapping("/shops/{shopId}/sync-jobs")
    @PreAuthorize("hasAuthority('shop:sync:write')")
    public ResponseEntity<SyncJobResponse> createSyncJob(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID shopId,
            @Valid @RequestBody CreateSyncJobRequest request,
            HttpServletRequest httpRequest
    ) {
        SyncJobResponse response = SyncJobResponse.from(
                service.createSyncJob(
                        actor(principal, httpRequest),
                        shopId,
                        request.jobType())
        );
        return ResponseEntity.created(URI.create(
                "/api/v1/platform-center/shops/" + shopId + "/sync-jobs/" + response.id()
        )).body(response);
    }

    @GetMapping("/shops/{shopId}/sync-jobs")
    @PreAuthorize("hasAuthority('shop:sync:read')")
    public PageEnvelope<SyncJobResponse> listSyncJobs(
            @AuthenticationPrincipal(expression = "tenantId") UUID tenantId,
            @PathVariable UUID shopId,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "50") @Min(1) @Max(MAX_PAGE_SIZE) int size
    ) {
        return PageEnvelope.from(
                service.listSyncJobs(tenantId, shopId, pageable(page, size)),
                SyncJobResponse::from
        );
    }

    @PutMapping("/shops/{shopId}/sync-jobs/{syncJobId}/status")
    @PreAuthorize("hasAuthority('shop:sync:write')")
    public SyncJobResponse updateSyncJob(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID shopId,
            @PathVariable UUID syncJobId,
            @Valid @RequestBody UpdateSyncJobRequest request,
            HttpServletRequest httpRequest
    ) {
        return SyncJobResponse.from(service.updateSyncJob(
                actor(principal, httpRequest),
                shopId,
                syncJobId,
                request.status(),
                request.progressProcessed(),
                request.progressTotal(),
                request.errorCode(),
                request.errorSummary()
        ));
    }

    private static ShopResponse mapShop(ShopWithAuthorization value,
            String localizedDisplayName) {
        return ShopResponse.from(value.shop(), mapAuthorization(value.authorization()),
                localizedDisplayName);
    }

    private static ShopCenterActor actor(
            ErpPrincipal principal,
            HttpServletRequest request) {
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

    private static AuthorizationResponse mapAuthorization(ShopAuthorization authorization) {
        return AuthorizationResponse.from(
                authorization,
                ShopCenterService.splitScopes(authorization.getScopeSummary())
        );
    }

    private static Pageable pageable(int page, int size) {
        if (page < 0) {
            throw new IllegalArgumentException("Page index must not be negative");
        }
        if (size < 1 || size > MAX_PAGE_SIZE) {
            throw new IllegalArgumentException("Page size must be between 1 and " + MAX_PAGE_SIZE);
        }
        return PageRequest.of(page, size);
    }

    private static String normalizeShopQuery(String query) {
        if (query == null) {
            return null;
        }
        String normalized = query.trim();
        if (normalized.isEmpty() || normalized.length() > 100) {
            throw new IllegalArgumentException("Shop query must contain between 1 and 100 characters");
        }
        return normalized;
    }
}
