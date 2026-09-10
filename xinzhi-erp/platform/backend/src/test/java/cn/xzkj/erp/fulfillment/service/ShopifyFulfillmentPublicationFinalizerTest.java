package cn.xzkj.erp.fulfillment.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

import cn.xzkj.erp.fulfillment.repository.ShopifyFulfillmentPublicationRepository;
import cn.xzkj.erp.fulfillment.service.FulfillmentService.Actor;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;

class ShopifyFulfillmentPublicationFinalizerTest {

    @Test
    void recordsPublicationStateAndAuditInOneFinalizationBoundary() {
        var publications = mock(
                ShopifyFulfillmentPublicationRepository.class);
        var audits = mock(SecurityAuditRecorder.class);
        var finalizer = new ShopifyFulfillmentPublicationFinalizer(
                publications, audits);
        UUID tenantId = UUID.randomUUID();
        UUID planId = UUID.randomUUID();
        UUID packageId = UUID.randomUUID();
        UUID publicationId = UUID.randomUUID();
        var actor = new Actor(
                tenantId, UUID.randomUUID(), null,
                "request-1", "127.0.0.1");

        finalizer.finalizePublished(
                actor, planId, packageId, publicationId,
                "fingerprint", "gid://shopify/Fulfillment/50",
                true, false);

        InOrder order = inOrder(publications, audits);
        order.verify(publications).markPublished(
                tenantId, publicationId, "fingerprint",
                "gid://shopify/Fulfillment/50", false);
        order.verify(audits).recordAtomically(any());
    }
}
