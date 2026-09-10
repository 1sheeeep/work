package cn.xzkj.erp.inventory.service;

import java.time.Instant;
import java.util.Map;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.inventory.repository.ShopifyInventoryPublicationRepository;
import cn.xzkj.erp.inventory.repository.ShopifyInventoryPublicationRepository.Publication;

@Service
public class ShopifyInventoryPublicationFinalizer {

    private final ShopifyInventoryPublicationRepository publications;
    private final SecurityAuditRecorder auditRecorder;

    public ShopifyInventoryPublicationFinalizer(
            ShopifyInventoryPublicationRepository publications,
            SecurityAuditRecorder auditRecorder) {
        this.publications = publications;
        this.auditRecorder = auditRecorder;
    }

    @Transactional
    public void terminal(
            Publication publication,
            String status,
            String safeErrorCode,
            Instant providerUpdatedAt) {
        publications.markTerminal(
                publication.tenantId(), publication.id(), status,
                safeErrorCode, providerUpdatedAt);
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                publication.tenantId(), publication.actorUserId(),
                publication.actorSystemAdminId(),
                "inventory.shopify.publish." + status.toLowerCase(),
                "shopify_inventory_publication",
                publication.id().toString(), publication.requestId(),
                publication.sourceIp(), Map.of(
                        "shopId", publication.shopId().toString(),
                        "balanceId", publication.balanceId().toString(),
                        "targetAvailable",
                        Integer.toString(publication.targetAvailable()),
                        "safeErrorCode",
                        safeErrorCode == null ? "NONE" : safeErrorCode)));
    }
}
