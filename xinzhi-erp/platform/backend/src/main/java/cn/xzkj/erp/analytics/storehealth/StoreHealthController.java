package cn.xzkj.erp.analytics.storehealth;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.platform.domain.AuthorizationStatus;
import cn.xzkj.erp.platform.domain.PlatformCatalogEntry;
import cn.xzkj.erp.platform.domain.ShopAuthorization;
import cn.xzkj.erp.platform.domain.ShopSyncJob;
import cn.xzkj.erp.platform.domain.TenantShop;
import cn.xzkj.erp.platform.service.ShopCenterService;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Validated
@RequestMapping("/api/v1/analytics/store-health")
public class StoreHealthController {
    private static final int MAX_PAGE_SIZE = 100;
    private static final int MAX_PLATFORM_COUNT = 200;
    private final ShopCenterService shopCenterService;

    public StoreHealthController(ShopCenterService shopCenterService) {
        this.shopCenterService = shopCenterService;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('analytics.read')")
    public Response list(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) @Size(max = 100) String query,
            @RequestParam(required = false) @Size(max = 32) String platform,
            @RequestParam(required = false) AuthorizationStatus authorizationStatus,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "25") @Min(1) @Max(MAX_PAGE_SIZE) int size) {
        UUID tenantId = principal.tenantId();
        List<PlatformCatalogEntry> platforms = shopCenterService.listPlatforms(
                false, PageRequest.of(0, MAX_PLATFORM_COUNT)).getContent();
        Map<UUID, PlatformCatalogEntry> platformsById = platforms.stream()
                .collect(Collectors.toUnmodifiableMap(
                        PlatformCatalogEntry::getId, Function.identity()));
        UUID platformId = platformId(platforms, platform);
        if (platform != null && platformId == null) {
            return Response.empty(page, size, PlatformResponse.from(platforms));
        }

        Page<ShopCenterService.ShopWithAuthorization> shops = shopCenterService.listShops(
                tenantId, false, normalize(query), platformId, null,
                authorizationStatus, PageRequest.of(page, size));
        List<StoreHealthItem> items = shops.getContent().stream()
                .map(value -> item(tenantId, platformsById, value))
                .toList();
        return new Response(
                items,
                PlatformResponse.from(platforms),
                shops.getNumber(),
                shops.getSize(),
                shops.getTotalElements(),
                shops.getTotalPages());
    }

    private StoreHealthItem item(
            UUID tenantId,
            Map<UUID, PlatformCatalogEntry> platforms,
            ShopCenterService.ShopWithAuthorization value) {
        TenantShop shop = value.shop();
        ShopAuthorization authorization = value.authorization();
        PlatformCatalogEntry platform = platforms.get(shop.getPlatformId());
        ShopSyncJob latestSync = shopCenterService.listSyncJobs(
                tenantId, shop.getId(), PageRequest.of(0, 1))
                .stream().findFirst().orElse(null);
        return new StoreHealthItem(
                shop.getId(),
                platform == null ? "UNKNOWN" : platform.getCode(),
                platform == null ? "未知平台" : platform.getDisplayName(),
                shop.getDisplayName(),
                shop.getExternalShopRef(),
                shop.getStatus().name(),
                authorization.getStatus().name(),
                scopes(authorization.getScopeSummary()),
                authorization.getLastVerifiedAt(),
                shop.getUpdatedAt(),
                latestSync == null ? null : SyncResponse.from(latestSync));
    }

    private static UUID platformId(
            List<PlatformCatalogEntry> platforms,
            String requestedCode) {
        String normalized = normalize(requestedCode);
        if (normalized == null) return null;
        return platforms.stream()
                .filter(value -> value.getCode().equalsIgnoreCase(normalized))
                .map(PlatformCatalogEntry::getId)
                .findFirst()
                .orElse(null);
    }

    private static String normalize(String value) {
        return value == null || value.isBlank()
                ? null
                : value.strip().toLowerCase(Locale.ROOT);
    }

    private static List<String> scopes(String summary) {
        if (summary == null || summary.isBlank()) return List.of();
        return List.of(summary.split("[,\\s]+"))
                .stream()
                .map(String::strip)
                .filter(value -> !value.isEmpty())
                .distinct()
                .sorted()
                .toList();
    }

    public record Response(
            List<StoreHealthItem> items,
            List<PlatformResponse> platforms,
            int page,
            int size,
            long totalElements,
            int totalPages) {
        static Response empty(
                int page,
                int size,
                List<PlatformResponse> platforms) {
            return new Response(List.of(), platforms, page, size, 0, 0);
        }
    }

    public record PlatformResponse(String code, String displayName) {
        static List<PlatformResponse> from(List<PlatformCatalogEntry> values) {
            return values.stream()
                    .map(value -> new PlatformResponse(
                            value.getCode(), value.getDisplayName()))
                    .toList();
        }
    }

    public record StoreHealthItem(
            UUID shopId,
            String platformCode,
            String platformName,
            String shopName,
            String externalShopRef,
            String shopStatus,
            String authorizationStatus,
            List<String> scopes,
            Instant lastVerifiedAt,
            Instant updatedAt,
            SyncResponse latestSync) {
    }

    public record SyncResponse(
            String jobType,
            String status,
            int progressProcessed,
            Integer progressTotal,
            int attemptCount,
            String safeErrorSummary,
            Instant requestedAt,
            Instant completedAt) {
        static SyncResponse from(ShopSyncJob value) {
            return new SyncResponse(
                    value.getJobType().name(),
                    value.getStatus().name(),
                    value.getProgressProcessed(),
                    value.getProgressTotal(),
                    value.getAttemptCount(),
                    value.getErrorSummary(),
                    value.getRequestedAt(),
                    value.getCompletedAt());
        }
    }
}
