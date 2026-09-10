package cn.xzkj.erp.inventory.service;

import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import cn.xzkj.erp.inventory.repository.ShopifyInventoryPublicationRepository;
import cn.xzkj.erp.inventory.repository.ShopifyInventoryPublicationRepository.Claim;
import cn.xzkj.erp.inventory.repository.ShopifyInventoryPublicationRepository.Publication;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;

@ExtendWith(MockitoExtension.class)
class ShopifyInventoryPublicationWorkerTest {

    @Mock private ShopifyInventoryPublicationRepository publications;
    @Mock private ChannelConnectorGateway connector;
    @Mock private ShopifyInventoryPublicationFinalizer finalizer;

    private ShopifyInventoryPublicationWorker worker;

    @BeforeEach
    void setUp() {
        worker = new ShopifyInventoryPublicationWorker(
                publications, connector, finalizer);
    }

    @Test
    void refusesProviderMutationWhenLocalBalanceChangedAfterQueueing() {
        Publication item = publication();
        worker.process(new Claim(item, item.expectedBalanceVersion() + 1,
                item.targetAvailable(), true));

        verify(connector, never()).setShopifyInventoryAvailable(
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any());
        verify(finalizer).terminal(
                item, "STALE", "ERP_INVENTORY_STATE_CHANGED", null);
    }

    @Test
    void appliesExactCasResult() {
        Publication item = publication();
        var request = new ChannelConnectorGateway.InventorySetRequest(
                item.externalInventoryItemRef(), item.externalLocationRef(),
                item.expectedShopifyAvailable(), item.targetAvailable(),
                item.idempotencyKey(), item.id());
        Instant updatedAt = Instant.parse("2026-08-01T00:00:00Z");
        when(connector.setShopifyInventoryAvailable(
                item.tenantId(), item.shopId(), request))
                .thenReturn(new ChannelConnectorGateway.InventorySetResult(
                        ChannelConnectorGateway.InventorySetOutcome.APPLIED,
                        item.externalInventoryItemRef(),
                        item.externalLocationRef(),
                        item.expectedShopifyAvailable(),
                        item.targetAvailable(), null, updatedAt));

        worker.process(new Claim(
                item, item.expectedBalanceVersion(),
                item.targetAvailable(), true));

        verify(finalizer).terminal(item, "APPLIED", null, updatedAt);
    }

    @Test
    void keepsUncertainResultRecoverableWhenConnectorFails() {
        Publication item = publication();
        when(connector.setShopifyInventoryAvailable(
                org.mockito.ArgumentMatchers.eq(item.tenantId()),
                org.mockito.ArgumentMatchers.eq(item.shopId()),
                org.mockito.ArgumentMatchers.any()))
                .thenThrow(new RuntimeException("private provider detail"));

        worker.process(new Claim(
                item, item.expectedBalanceVersion(),
                item.targetAvailable(), true));

        verify(publications).markUncertain(item.tenantId(), item.id());
        verify(finalizer, never()).terminal(
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any());
    }

    private static Publication publication() {
        return new Publication(
                UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                "gid://shopify/InventoryItem/200",
                "gid://shopify/Location/100",
                4, 7, 9, "inventory-command-1",
                "a".repeat(64), "PROCESSING", 1, null,
                UUID.randomUUID(), null, "request-1", "127.0.0.1");
    }
}
