package cn.xzkj.erp.inventory.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.inventory.repository.ShopifyInventoryPublicationRepository;
import cn.xzkj.erp.inventory.repository.ShopifyInventoryPublicationRepository.ExceptionView;
import cn.xzkj.erp.inventory.repository.ShopifyInventoryPublicationRepository.Publication;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectionStatus;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyScopeCoverageStatus;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.platform.service.ShopifyAuthorizationConflictException;

@Service
public class ShopifyInventoryPublicationService {

    private static final Pattern KEY =
            Pattern.compile("^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$");
    private static final String QUEUED = "inventory.shopify.publish.queued";

    private final ShopifyInventoryPublicationRepository publications;
    private final ChannelConnectorGateway connector;
    private final SecurityAuditRecorder auditRecorder;

    public ShopifyInventoryPublicationService(
            ShopifyInventoryPublicationRepository publications,
            ChannelConnectorGateway connector,
            SecurityAuditRecorder auditRecorder) {
        this.publications = publications;
        this.connector = connector;
        this.auditRecorder = auditRecorder;
    }

    @Transactional
    public PublicationResult enqueue(
            InventoryActor actor,
            UUID shopId,
            UUID balanceId,
            long expectedBalanceVersion,
            int expectedShopifyAvailable,
            String idempotencyKey) {
        if (actor == null || actor.tenantId() == null
                || shopId == null || balanceId == null
                || expectedBalanceVersion < 0) {
            throw new IllegalArgumentException(
                    "Inventory publication request is invalid");
        }
        String key = idempotencyKey == null ? "" : idempotencyKey.strip();
        if (!KEY.matcher(key).matches()) {
            throw new IllegalArgumentException(
                    "Inventory publication idempotency key is invalid");
        }
        if (expectedShopifyAvailable < -1_000_000_000
                || expectedShopifyAvailable > 1_000_000_000) {
            throw new IllegalArgumentException(
                    "Expected Shopify inventory is outside supported bounds");
        }
        requireShopifyInventoryWriteAccess(actor.tenantId(), shopId);
        String fingerprint = fingerprint(
                shopId, balanceId, expectedBalanceVersion,
                expectedShopifyAvailable);
        ShopifyInventoryPublicationRepository.Reservation reservation;
        try {
            reservation = publications.enqueue(
                    actor.tenantId(), shopId, balanceId,
                    expectedBalanceVersion, expectedShopifyAvailable,
                    key, fingerprint, actor.userId(), actor.systemAdminId(),
                    actor.requestId(), actor.sourceIp());
        } catch (IllegalStateException exception) {
            throw new ConflictException(exception.getMessage());
        }
        Publication publication = reservation.publication();
        if (reservation.created()) {
            audit(actor, QUEUED, publication, Map.of(
                            "shopId", shopId.toString(),
                            "balanceId", balanceId.toString(),
                            "balanceVersion", Long.toString(expectedBalanceVersion),
                            "expectedShopifyAvailable",
                            Integer.toString(expectedShopifyAvailable),
                            "targetAvailable",
                            Integer.toString(publication.targetAvailable())));
        }
        return new PublicationResult(publication, !reservation.created());
    }

    public Publication get(InventoryActor actor, UUID publicationId) {
        if (actor == null || actor.tenantId() == null || publicationId == null) {
            throw new IllegalArgumentException("Publication is required");
        }
        return publications.findById(actor.tenantId(), publicationId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Shopify inventory publication was not found"));
    }

    public Publication getLatest(
            InventoryActor actor, UUID shopId, UUID balanceId) {
        if (actor == null || actor.tenantId() == null
                || shopId == null || balanceId == null) {
            throw new IllegalArgumentException(
                    "Shop and inventory balance are required");
        }
        return publications.findLatest(actor.tenantId(), shopId, balanceId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Shopify inventory publication was not found"));
    }

    public List<ExceptionView> listExceptions(
            InventoryActor actor,
            UUID shopId,
            Instant createdFrom,
            Instant createdBefore,
            String keyword,
            int limit) {
        if (actor == null || actor.tenantId() == null
                || limit < 1 || limit > 200) {
            throw new IllegalArgumentException(
                    "Inventory publication exception query is invalid");
        }
        if (createdFrom != null && createdBefore != null
                && !createdFrom.isBefore(createdBefore)) {
            throw new IllegalArgumentException(
                    "Inventory publication exception date range is invalid");
        }
        String normalizedKeyword = keyword == null ? null : keyword.strip();
        if (normalizedKeyword != null && normalizedKeyword.length() > 100) {
            throw new IllegalArgumentException(
                    "Inventory publication exception keyword is invalid");
        }
        return publications.findExceptions(
                actor.tenantId(), shopId, createdFrom, createdBefore,
                normalizedKeyword, limit);
    }

    private void requireShopifyInventoryWriteAccess(
            UUID tenantId, UUID shopId) {
        var snapshot = connector.snapshot(tenantId, shopId);
        if (snapshot.shopify().status() != ConnectionStatus.CONNECTED) {
            throw ShopifyAuthorizationConflictException.notConnected();
        }
        var scope = snapshot.shopifyScopes().stream()
                .filter(item -> "write_inventory".equals(item.scope()))
                .findFirst()
                .orElseThrow(ShopifyAuthorizationConflictException::scopeUnavailable);
        if (scope.status() != ShopifyScopeCoverageStatus.GRANTED) {
            throw ShopifyAuthorizationConflictException.missingScope(
                    "write_inventory");
        }
    }

    private void audit(
            InventoryActor actor,
            String action,
            Publication publication,
            Map<String, String> details) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(),
                action, "shopify_inventory_publication",
                publication.id().toString(), actor.requestId(),
                actor.sourceIp(), details));
    }

    private static String fingerprint(
            UUID shopId, UUID balanceId, long balanceVersion,
            int expectedShopifyAvailable) {
        String canonical = String.join("\n",
                "SHOPIFY_INVENTORY_PUBLICATION",
                shopId.toString(), balanceId.toString(),
                Long.toString(balanceVersion),
                Integer.toString(expectedShopifyAvailable));
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256")
                            .digest(canonical.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable", impossible);
        }
    }

    public record PublicationResult(Publication publication, boolean replayed) {
    }
}
