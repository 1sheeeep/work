package cn.xzkj.erp.platform.service;

import static cn.xzkj.erp.platform.domain.ShopCenterAuditActions.AUTHORIZATION_UPDATED;
import static cn.xzkj.erp.platform.domain.ShopCenterAuditActions.PLATFORM_ARCHIVED;
import static cn.xzkj.erp.platform.domain.ShopCenterAuditActions.PLATFORM_CREATED;
import static cn.xzkj.erp.platform.domain.ShopCenterAuditActions.SHOP_ARCHIVED;
import static cn.xzkj.erp.platform.domain.ShopCenterAuditActions.SHOP_CREATED;
import static cn.xzkj.erp.platform.domain.ShopCenterAuditActions.SHOP_UPDATED;
import static cn.xzkj.erp.platform.domain.ShopCenterAuditActions.SYNC_JOB_CREATED;
import static cn.xzkj.erp.platform.domain.ShopCenterAuditActions.SYNC_JOB_STATUS_CHANGED;

import java.time.Instant;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.stream.Collectors;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.domain.AuthorizationStatus;
import cn.xzkj.erp.platform.domain.CredentialReferenceValidator;
import cn.xzkj.erp.platform.domain.PlatformCatalogEntry;
import cn.xzkj.erp.platform.domain.PlatformStatus;
import cn.xzkj.erp.platform.domain.SensitiveTextRedactor;
import cn.xzkj.erp.platform.domain.ShopAuthorization;
import cn.xzkj.erp.platform.domain.ShopStatus;
import cn.xzkj.erp.platform.domain.ShopSyncJob;
import cn.xzkj.erp.platform.domain.SyncJobStatus;
import cn.xzkj.erp.platform.domain.SyncJobType;
import cn.xzkj.erp.platform.domain.TenantShop;
import cn.xzkj.erp.platform.repository.PlatformCatalogRepository;
import cn.xzkj.erp.platform.repository.ShopAuthorizationRepository;
import cn.xzkj.erp.platform.repository.ShopSyncJobRepository;
import cn.xzkj.erp.platform.repository.TenantShopRepository;

@Service
public class ShopCenterService {

    private static final String SHOPIFY_PLATFORM_CODE = "SHOPIFY";
    private static final String OTHER_PLATFORM_CODE = "OTHER";
    private static final String SHOPIFY_DOMAIN_SUFFIX = ".myshopify.com";
    private static final String INTERNAL_SHOP_PREFIX = "internal-";

    private final PlatformCatalogRepository platformRepository;
    private final TenantShopRepository shopRepository;
    private final ShopAuthorizationRepository authorizationRepository;
    private final ShopSyncJobRepository syncJobRepository;
    private final SecurityAuditRecorder auditRecorder;

    public ShopCenterService(
            PlatformCatalogRepository platformRepository,
            TenantShopRepository shopRepository,
            ShopAuthorizationRepository authorizationRepository,
            ShopSyncJobRepository syncJobRepository,
            SecurityAuditRecorder auditRecorder
    ) {
        this.platformRepository = platformRepository;
        this.shopRepository = shopRepository;
        this.authorizationRepository = authorizationRepository;
        this.syncJobRepository = syncJobRepository;
        this.auditRecorder = auditRecorder;
    }

    @Transactional
    public PlatformCatalogEntry createPlatform(
            ShopCenterActor actor,
            String code,
            String displayName,
            String description
    ) {
        requireActor(actor);
        String normalizedCode = code.trim().toUpperCase(Locale.ROOT);
        if (platformRepository.existsByCode(normalizedCode)) {
            throw new ConflictException("Platform code already exists");
        }
        PlatformCatalogEntry saved = platformRepository.save(new PlatformCatalogEntry(
                normalizedCode,
                displayName.trim(),
                trimNullable(description)
        ));
        audit(actor, PLATFORM_CREATED, "platform", saved.getId(),
                saved.getVersion(), Map.of("status", saved.getStatus().name()));
        return saved;
    }

    @Transactional(readOnly = true)
    public Page<PlatformCatalogEntry> listPlatforms(boolean includeArchived, Pageable pageable) {
        if (includeArchived) {
            return platformRepository.findAllByOrderByCode(pageable);
        }
        return platformRepository.findAllByStatusNotOrderByCode(PlatformStatus.ARCHIVED, pageable);
    }

    @Transactional(readOnly = true)
    public PlatformCatalogEntry getPlatform(UUID platformId) {
        return findPlatform(platformId);
    }

    @Transactional
    public PlatformCatalogEntry archivePlatform(
            ShopCenterActor actor, UUID platformId) {
        requireActor(actor);
        PlatformCatalogEntry platform = findPlatformForUpdate(platformId);
        if (platform.getStatus() == PlatformStatus.ARCHIVED) {
            return platform;
        }
        if (shopRepository.existsByPlatformIdAndStatusNot(platformId, ShopStatus.ARCHIVED)) {
            throw new ConflictException("Archive or move active shops before archiving the platform");
        }
        platform.archive();
        PlatformCatalogEntry saved = platformRepository.save(platform);
        audit(actor, PLATFORM_ARCHIVED, "platform", saved.getId(),
                platform.getVersion() + 1,
                Map.of("status", saved.getStatus().name()));
        return saved;
    }

    @Transactional
    public ShopWithAuthorization createShop(
            ShopCenterActor actor,
            UUID platformId,
            String externalShopRef,
            String displayName
    ) {
        PlatformCatalogEntry platform = findPlatformForUpdate(platformId);
        if (platform.getStatus() != PlatformStatus.ACTIVE) {
            throw new ConflictException(
                    "Shops can only be created under an active supported platform");
        }
        if (SHOPIFY_PLATFORM_CODE.equals(platform.getCode())) {
            String normalizedExternalRef = requiredShopifyReference(
                    externalShopRef);
            String shopKey = normalizedExternalRef.substring(
                    0,
                    normalizedExternalRef.length()
                            - SHOPIFY_DOMAIN_SUFFIX.length());
            return persistShop(
                    actor,
                    platformId,
                    normalizedExternalRef,
                    "待授权 · " + shopKey,
                    AuthorizationStatus.NOT_AUTHORIZED);
        }
        if (OTHER_PLATFORM_CODE.equals(platform.getCode())) {
            String normalizedDisplayName = requiredDisplayName(displayName);
            return persistShop(
                    actor,
                    platformId,
                    INTERNAL_SHOP_PREFIX + UUID.randomUUID(),
                    normalizedDisplayName,
                    AuthorizationStatus.NOT_REQUIRED);
        }
        throw new ConflictException(
                "Shops can only be created under an active supported platform");
    }

    public ShopWithAuthorization createShop(
            ShopCenterActor actor,
            UUID platformId,
            String externalShopRef
    ) {
        return createShop(actor, platformId, externalShopRef, null);
    }

    @Transactional
    public ShopWithAuthorization createShopWithDisplayName(
            ShopCenterActor actor,
            UUID platformId,
            String externalShopRef,
            String displayName
    ) {
        PlatformCatalogEntry platform = findPlatformForUpdate(platformId);
        if (platform.getStatus() != PlatformStatus.ACTIVE
                || !SHOPIFY_PLATFORM_CODE.equals(platform.getCode())) {
            throw new ConflictException(
                    "Shops can only be created under an active Shopify platform");
        }
        return persistShop(
                actor,
                platformId,
                externalShopRef.trim(),
                requiredDisplayName(displayName),
                AuthorizationStatus.NOT_AUTHORIZED);
    }

    private ShopWithAuthorization persistShop(
            ShopCenterActor actor,
            UUID platformId,
            String normalizedExternalRef,
            String displayName,
            AuthorizationStatus initialAuthorizationStatus
    ) {
        UUID tenantId = requireActor(actor);
        if (shopRepository.existsByTenantIdAndPlatformIdAndExternalShopRef(
                tenantId,
                platformId,
                normalizedExternalRef
        )) {
            throw new ConflictException("Shop reference already exists for this platform and tenant");
        }

        TenantShop shop = shopRepository.save(new TenantShop(
                tenantId,
                platformId,
                normalizedExternalRef,
                displayName.trim()
        ));
        ShopAuthorization authorization = authorizationRepository.save(
                new ShopAuthorization(
                        tenantId,
                        shop.getId(),
                        initialAuthorizationStatus)
        );
        audit(actor, SHOP_CREATED, "shop", shop.getId(), shop.getVersion(),
                Map.of(
                        "platformId", shop.getPlatformId().toString(),
                        "status", shop.getStatus().name()));
        return new ShopWithAuthorization(shop, authorization);
    }

    private static String requiredShopifyReference(String externalShopRef) {
        String normalizedExternalRef = externalShopRef == null
                ? ""
                : externalShopRef.strip().toLowerCase(Locale.ROOT);
        if (!normalizedExternalRef.endsWith(SHOPIFY_DOMAIN_SUFFIX)) {
            normalizedExternalRef += SHOPIFY_DOMAIN_SUFFIX;
        }
        if (!normalizedExternalRef.matches(
                "^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.myshopify\\.com$")) {
            throw new IllegalArgumentException(
                    "Shopify shop reference must be a myshopify.com domain");
        }
        return normalizedExternalRef;
    }

    private static String requiredDisplayName(String displayName) {
        String normalized = displayName == null ? "" : displayName.trim();
        if (normalized.isEmpty() || normalized.length() > 160
                || normalized.chars().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException("Shop display name is invalid");
        }
        return normalized;
    }

    @Transactional
    public TenantShop applyConnectorShopIdentity(
            ShopCenterActor actor,
            UUID shopId,
            String expectedShopDomain,
            String shopName
    ) {
        UUID tenantId = requireActor(actor);
        TenantShop shop = findShopForUpdate(tenantId, shopId);
        String normalizedDomain = expectedShopDomain == null
                ? ""
                : expectedShopDomain.strip().toLowerCase(Locale.ROOT);
        String normalizedName = shopName == null ? "" : shopName.strip();
        if (!shop.getExternalShopRef().equalsIgnoreCase(normalizedDomain)) {
            throw new ConflictException(
                    "Connector shop domain does not match the ERP shop");
        }
        if (normalizedName.isEmpty() || normalizedName.length() > 160
                || normalizedName.chars().anyMatch(
                        character -> Character.isISOControl(character))) {
            throw new IllegalArgumentException("Connector shop name is invalid");
        }
        if (shop.getDisplayName().equals(normalizedName)) {
            return shop;
        }
        long expectedVersion = shop.getVersion();
        shop.update(shop.getExternalShopRef(), normalizedName, shop.getStatus());
        TenantShop saved = shopRepository.save(shop);
        audit(actor, SHOP_UPDATED, "shop", saved.getId(),
                expectedVersion + 1, Map.of(
                        "platformId", saved.getPlatformId().toString(),
                        "status", saved.getStatus().name(),
                        "source", "shopify_connector"));
        return saved;
    }

    @Transactional(readOnly = true)
    public Page<ShopWithAuthorization> listShops(UUID tenantId, boolean includeArchived, Pageable pageable) {
        return listShops(tenantId, includeArchived, null, null, null, null, pageable);
    }

    @Transactional(readOnly = true)
    public Page<ShopWithAuthorization> listShops(
            UUID tenantId,
            boolean includeArchived,
            String query,
            UUID platformId,
            ShopStatus status,
            AuthorizationStatus authorizationStatus,
            Pageable pageable
    ) {
        requireTenant(tenantId);
        Page<TenantShop> shops;
        if (query == null && platformId == null && status == null && authorizationStatus == null) {
            shops = includeArchived
                    ? shopRepository.findAllByTenantIdOrderByDisplayNameAscIdAsc(
                            tenantId,
                            pageable)
                    : shopRepository.findAllByTenantIdAndStatusNotOrderByDisplayNameAscIdAsc(
                            tenantId,
                            ShopStatus.ARCHIVED,
                            pageable
                    );
        } else {
            shops = shopRepository.findAllForTenantShopList(
                    tenantId,
                    includeArchived,
                    ShopStatus.ARCHIVED,
                    query,
                    platformId,
                    status,
                    authorizationStatus,
                    pageable
            );
        }
        List<ShopWithAuthorization> content = withAuthorizations(tenantId, shops.getContent());
        return new PageImpl<>(content, pageable, shops.getTotalElements());
    }

    @Transactional(readOnly = true)
    public ShopWithAuthorization getShop(UUID tenantId, UUID shopId) {
        TenantShop shop = findShop(tenantId, shopId);
        return new ShopWithAuthorization(shop, findAuthorization(tenantId, shopId));
    }

    @Transactional
    public ShopWithAuthorization updateShop(
            ShopCenterActor actor,
            UUID shopId,
            long expectedVersion,
            String externalShopRef,
            String displayName,
            ShopStatus status
    ) {
        UUID tenantId = requireActor(actor);
        TenantShop shop = findShopForUpdate(tenantId, shopId);
        if (shop.getVersion() != expectedVersion) {
            throw new ConflictException("Shop version does not match");
        }
        if (shop.getStatus() == ShopStatus.ARCHIVED) {
            throw new ConflictException("Archived shops cannot be changed");
        }
        if (status == ShopStatus.ARCHIVED) {
            throw new IllegalArgumentException("Use the archive operation to archive a shop");
        }
        String normalizedExternalRef = externalShopRef.trim();
        if (!normalizedExternalRef.equals(shop.getExternalShopRef())
                && shopRepository.existsByTenantIdAndPlatformIdAndExternalShopRef(
                        tenantId,
                        shop.getPlatformId(),
                        normalizedExternalRef
                )) {
            throw new ConflictException("Shop reference already exists for this platform and tenant");
        }
        shop.update(normalizedExternalRef, displayName.trim(), status);
        TenantShop saved = shopRepository.save(shop);
        audit(actor, SHOP_UPDATED, "shop", saved.getId(),
                expectedVersion + 1, Map.of(
                        "platformId", saved.getPlatformId().toString(),
                        "status", saved.getStatus().name()));
        return new ShopWithAuthorization(
                saved,
                findAuthorization(tenantId, shopId)
        );
    }

    @Transactional
    public ShopWithAuthorization archiveShop(
            ShopCenterActor actor, UUID shopId) {
        UUID tenantId = requireActor(actor);
        TenantShop shop = findShopForUpdate(tenantId, shopId);
        ShopAuthorization authorization = findAuthorization(tenantId, shopId);
        boolean changed = shop.getStatus() != ShopStatus.ARCHIVED;
        long previousVersion = shop.getVersion();
        if (changed) {
            if (authorization.getStatus() != AuthorizationStatus.NOT_REQUIRED
                    && authorization.getStatus() != AuthorizationStatus.NOT_AUTHORIZED
                    && authorization.getStatus() != AuthorizationStatus.REVOKED) {
                throw new ConflictException(
                        "Shopify app must be uninstalled before deleting the shop");
            }
            shop.archive();
            cancelOpenJobs(tenantId, shopId);
        }
        TenantShop savedShop = shopRepository.save(shop);
        ShopAuthorization savedAuthorization =
                authorizationRepository.save(authorization);
        if (changed) {
            audit(actor, SHOP_ARCHIVED, "shop", savedShop.getId(),
                    previousVersion + 1, Map.of(
                            "platformId", savedShop.getPlatformId().toString(),
                            "status", savedShop.getStatus().name()));
        }
        return new ShopWithAuthorization(savedShop, savedAuthorization);
    }

    @Transactional
    public ShopAuthorization updateAuthorization(
            ShopCenterActor actor,
            UUID shopId,
            AuthorizationStatus status,
            String credentialReference,
            String providerAccountRef,
            Set<String> scopes,
            Instant authorizedAt,
            Instant expiresAt,
            Instant lastVerifiedAt,
            String errorSummary
    ) {
        UUID tenantId = requireActor(actor);
        TenantShop shop = findShopForUpdate(tenantId, shopId);
        if (shop.getStatus() == ShopStatus.ARCHIVED) {
            throw new ConflictException("Authorization metadata cannot be changed for an archived shop");
        }
        if (status == AuthorizationStatus.NOT_REQUIRED) {
            throw new IllegalArgumentException(
                    "NOT_REQUIRED is managed by the internal shop platform");
        }

        String safeReference = CredentialReferenceValidator.validateNullable(credentialReference);
        if (status == AuthorizationStatus.AUTHORIZED && safeReference == null) {
            throw new IllegalArgumentException("AUTHORIZED status requires a credential reference");
        }
        Instant effectiveAuthorizedAt = status == AuthorizationStatus.AUTHORIZED && authorizedAt == null
                ? Instant.now()
                : authorizedAt;
        if (expiresAt != null && effectiveAuthorizedAt != null && !expiresAt.isAfter(effectiveAuthorizedAt)) {
            throw new IllegalArgumentException("Authorization expiry must be after authorization time");
        }
        String safeErrorSummary = SensitiveTextRedactor.redactNullable(errorSummary);
        if (status == AuthorizationStatus.ERROR && safeErrorSummary == null) {
            throw new IllegalArgumentException("ERROR status requires an error summary");
        }

        ShopAuthorization authorization = findAuthorization(tenantId, shopId);
        long previousVersion = authorization.getVersion();
        authorization.update(
                status,
                safeReference,
                trimNullable(providerAccountRef),
                joinScopes(scopes),
                effectiveAuthorizedAt,
                expiresAt,
                lastVerifiedAt,
                safeErrorSummary
        );
        ShopAuthorization saved = authorizationRepository.save(authorization);
        audit(actor, AUTHORIZATION_UPDATED, "shop_authorization",
                saved.getId(), previousVersion + 1, Map.of(
                        "shopId", saved.getShopId().toString(),
                        "status", saved.getStatus().name()));
        return saved;
    }

    @Transactional
    public ShopSyncJob createSyncJob(
            ShopCenterActor actor, UUID shopId, SyncJobType jobType) {
        UUID tenantId = requireActor(actor);
        TenantShop shop = findShopForUpdate(tenantId, shopId);
        if (shop.getStatus() != ShopStatus.ACTIVE) {
            throw new ConflictException("Sync jobs can only be created for active shops");
        }
        if (syncJobRepository.existsByTenantIdAndShopIdAndJobTypeAndStatusIn(
                tenantId,
                shopId,
                jobType,
                Set.of(SyncJobStatus.QUEUED, SyncJobStatus.RUNNING)
        )) {
            throw new ConflictException("An open sync job already exists for this shop and job type");
        }
        ShopSyncJob saved = syncJobRepository.save(
                new ShopSyncJob(tenantId, shopId, jobType));
        audit(actor, SYNC_JOB_CREATED, "shop_sync_job", saved.getId(),
                saved.getVersion(), Map.of(
                        "shopId", saved.getShopId().toString(),
                        "jobType", saved.getJobType().name(),
                        "status", saved.getStatus().name()));
        return saved;
    }

    @Transactional(readOnly = true)
    public Page<ShopSyncJob> listSyncJobs(UUID tenantId, UUID shopId, Pageable pageable) {
        findShop(tenantId, shopId);
        return syncJobRepository.findAllByTenantIdAndShopIdOrderByRequestedAtDesc(
                tenantId,
                shopId,
                pageable
        );
    }

    @Transactional
    public ShopSyncJob updateSyncJob(
            ShopCenterActor actor,
            UUID shopId,
            UUID syncJobId,
            SyncJobStatus status,
            int progressProcessed,
            Integer progressTotal,
            String errorCode,
            String errorSummary
    ) {
        UUID tenantId = requireActor(actor);
        findShopForUpdate(tenantId, shopId);
        ShopSyncJob job = syncJobRepository.findByIdAndTenantIdAndShopId(
                        syncJobId,
                        tenantId,
                        shopId
                )
                .orElseThrow(() -> new ResourceNotFoundException("Sync job was not found"));
        long previousVersion = job.getVersion();
        SyncJobStatus previousStatus = job.getStatus();
        int previousProcessed = job.getProgressProcessed();
        Integer previousTotal = job.getProgressTotal();
        String previousErrorCode = job.getErrorCode();
        String previousErrorSummary = job.getErrorSummary();
        job.transition(
                status,
                progressProcessed,
                progressTotal,
                trimNullable(errorCode),
                SensitiveTextRedactor.redactNullable(errorSummary)
        );
        ShopSyncJob saved = syncJobRepository.save(job);
        boolean changed = previousStatus != saved.getStatus()
                || previousProcessed != saved.getProgressProcessed()
                || !Objects.equals(previousTotal, saved.getProgressTotal())
                || !Objects.equals(previousErrorCode, saved.getErrorCode())
                || !Objects.equals(previousErrorSummary, saved.getErrorSummary());
        if (changed) {
            audit(actor, SYNC_JOB_STATUS_CHANGED, "shop_sync_job",
                    saved.getId(), previousVersion + 1, Map.of(
                            "shopId", saved.getShopId().toString(),
                            "jobType", saved.getJobType().name(),
                            "previousStatus", previousStatus.name(),
                            "status", saved.getStatus().name()));
        }
        return saved;
    }

    private void audit(
            ShopCenterActor actor,
            String action,
            String resourceType,
            UUID resourceId,
            long version,
            Map<String, String> facts) {
        Map<String, String> details = new java.util.LinkedHashMap<>();
        details.put("version", Long.toString(version));
        details.putAll(facts);
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(),
                actor.userId(),
                actor.systemAdminId(),
                action,
                resourceType,
                resourceId.toString(),
                actor.requestId(),
                actor.sourceIp(),
                details));
    }

    private static UUID requireActor(ShopCenterActor actor) {
        if (actor == null) {
            throw new IllegalArgumentException("Actor is required");
        }
        requireTenant(actor.tenantId());
        boolean userActor = actor.userId() != null;
        boolean systemAdminActor = actor.systemAdminId() != null;
        if (userActor == systemAdminActor) {
            throw new IllegalArgumentException("Exactly one actor identity is required");
        }
        return actor.tenantId();
    }

    public static Set<String> splitScopes(String scopeSummary) {
        if (scopeSummary == null || scopeSummary.isBlank()) {
            return Collections.emptySet();
        }
        return Arrays.stream(scopeSummary.split(","))
                .filter(value -> !value.isBlank())
                .collect(Collectors.toUnmodifiableSet());
    }

    private void cancelOpenJobs(UUID tenantId, UUID shopId) {
        syncJobRepository.findAllByTenantIdAndShopIdAndStatusIn(
                        tenantId,
                        shopId,
                        Set.of(SyncJobStatus.QUEUED, SyncJobStatus.RUNNING)
                )
                .stream()
                .forEach(job -> {
                    job.transition(
                            SyncJobStatus.CANCELLED,
                            job.getProgressProcessed(),
                            job.getProgressTotal(),
                            null,
                            null
                    );
                    syncJobRepository.save(job);
                });
    }

    private PlatformCatalogEntry findPlatform(UUID platformId) {
        return platformRepository.findById(platformId)
                .orElseThrow(() -> new ResourceNotFoundException("Platform was not found"));
    }

    private PlatformCatalogEntry findPlatformForUpdate(UUID platformId) {
        return platformRepository.findForUpdateById(platformId)
                .orElseThrow(() -> new ResourceNotFoundException("Platform was not found"));
    }

    private TenantShop findShop(UUID tenantId, UUID shopId) {
        requireTenant(tenantId);
        return shopRepository.findByIdAndTenantId(shopId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Shop was not found"));
    }

    private TenantShop findShopForUpdate(UUID tenantId, UUID shopId) {
        requireTenant(tenantId);
        return shopRepository.findForUpdateByIdAndTenantId(shopId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Shop was not found"));
    }

    private ShopAuthorization findAuthorization(UUID tenantId, UUID shopId) {
        return authorizationRepository.findByTenantIdAndShopId(tenantId, shopId)
                .orElseThrow(() -> new ResourceNotFoundException("Shop authorization metadata was not found"));
    }

    private List<ShopWithAuthorization> withAuthorizations(UUID tenantId, List<TenantShop> shops) {
        if (shops.isEmpty()) {
            return List.of();
        }
        Map<UUID, ShopAuthorization> authorizationsByShop = authorizationRepository
                .findAllByTenantIdAndShopIdIn(
                        tenantId,
                        shops.stream().map(TenantShop::getId).toList()
                )
                .stream()
                .collect(Collectors.toMap(ShopAuthorization::getShopId, authorization -> authorization));
        return shops.stream()
                .map(shop -> new ShopWithAuthorization(
                        shop,
                        requireAuthorization(authorizationsByShop, shop.getId())
                ))
                .toList();
    }

    private static ShopAuthorization requireAuthorization(
            Map<UUID, ShopAuthorization> authorizationsByShop,
            UUID shopId
    ) {
        ShopAuthorization authorization = authorizationsByShop.get(shopId);
        if (authorization == null) {
            throw new ResourceNotFoundException("Shop authorization metadata was not found");
        }
        return authorization;
    }

    private static String joinScopes(Set<String> scopes) {
        if (scopes == null || scopes.isEmpty()) {
            return null;
        }
        String scopeSummary = String.join(",", new TreeSet<>(scopes));
        if (scopeSummary.length() > 1000) {
            throw new IllegalArgumentException("Combined authorization scopes must not exceed 1000 characters");
        }
        return scopeSummary;
    }

    private static String trimNullable(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static void requireTenant(UUID tenantId) {
        if (tenantId == null) {
            throw new IllegalArgumentException("Tenant ID is required");
        }
    }

    public record ShopWithAuthorization(
            TenantShop shop,
            ShopAuthorization authorization
    ) {
    }
}
