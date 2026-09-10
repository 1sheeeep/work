package cn.xzkj.erp.fulfillment.service;

import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cn.xzkj.erp.fulfillment.repository.ShopifyFulfillmentPublicationRepository;
import cn.xzkj.erp.fulfillment.service.FulfillmentService.Actor;
import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;

@Service
public class ShopifyFulfillmentPublicationFinalizer {

    private static final String SHOPIFY_FULFILLMENT_PUBLISHED =
            "fulfillment.shopify.published";

    private final ShopifyFulfillmentPublicationRepository publications;
    private final SecurityAuditRecorder auditRecorder;

    public ShopifyFulfillmentPublicationFinalizer(
            ShopifyFulfillmentPublicationRepository publications,
            SecurityAuditRecorder auditRecorder) {
        this.publications = publications;
        this.auditRecorder = auditRecorder;
    }

    @Transactional
    public void finalizePublished(
            Actor actor,
            UUID planId,
            UUID packageId,
            UUID publicationId,
            String fingerprint,
            String externalFulfillmentRef,
            boolean notifyCustomer,
            boolean recoveredFromShopify) {
        publications.markPublished(
                actor.tenantId(), publicationId, fingerprint,
                externalFulfillmentRef, recoveredFromShopify);
        audit(actor, SHOPIFY_FULFILLMENT_PUBLISHED, packageId, Map.of(
                "planId", planId.toString(),
                "packageId", packageId.toString(),
                "fulfillmentRef", externalFulfillmentRef,
                "notifyCustomer", Boolean.toString(notifyCustomer),
                "recovered", Boolean.toString(recoveredFromShopify)));
    }

    private void audit(
            Actor actor,
            String action,
            UUID packageId,
            Map<String, String> details) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(),
                action, "fulfillment_package", packageId.toString(),
                actor.requestId(), actor.sourceIp(), details));
    }
}
