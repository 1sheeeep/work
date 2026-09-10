package cn.xzkj.erp.inventory.service;

import java.util.Objects;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import cn.xzkj.erp.inventory.repository.ShopifyInventoryPublicationRepository;
import cn.xzkj.erp.inventory.repository.ShopifyInventoryPublicationRepository.Claim;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.InventorySetOutcome;

@Service
public class ShopifyInventoryPublicationWorker {

    private final ShopifyInventoryPublicationRepository publications;
    private final ChannelConnectorGateway connector;
    private final ShopifyInventoryPublicationFinalizer finalizer;

    public ShopifyInventoryPublicationWorker(
            ShopifyInventoryPublicationRepository publications,
            ChannelConnectorGateway connector,
            ShopifyInventoryPublicationFinalizer finalizer) {
        this.publications = publications;
        this.connector = connector;
        this.finalizer = finalizer;
    }

    @Scheduled(fixedDelayString =
            "${erp.inventory-publication.worker-delay-ms:5000}")
    public void processNext() {
        publications.claimNext().ifPresent(this::process);
    }

    void process(Claim claim) {
        var item = claim.publication();
        if (!claim.mappingsCurrent()
                || claim.currentBalanceVersion()
                        != item.expectedBalanceVersion()
                || claim.currentAvailable() != item.targetAvailable()) {
            finalizer.terminal(
                    item, "STALE", "ERP_INVENTORY_STATE_CHANGED", null);
            return;
        }
        ChannelConnectorGateway.InventorySetResult result;
        try {
            result = connector.setShopifyInventoryAvailable(
                    item.tenantId(), item.shopId(),
                    new ChannelConnectorGateway.InventorySetRequest(
                            item.externalInventoryItemRef(),
                            item.externalLocationRef(),
                            item.expectedShopifyAvailable(),
                            item.targetAvailable(),
                            item.idempotencyKey(), item.id()));
        } catch (RuntimeException exception) {
            publications.markUncertain(item.tenantId(), item.id());
            return;
        }
        if (!Objects.equals(result.externalInventoryItemRef(),
                item.externalInventoryItemRef())
                || !Objects.equals(result.externalLocationRef(),
                        item.externalLocationRef())
                || result.expectedAvailable()
                        != item.expectedShopifyAvailable()
                || result.targetAvailable() != item.targetAvailable()
                || result.updatedAt() == null) {
            publications.markUncertain(item.tenantId(), item.id());
            return;
        }
        if (result.outcome() == InventorySetOutcome.APPLIED) {
            finalizer.terminal(item, "APPLIED", null, result.updatedAt());
        } else if (result.outcome() == InventorySetOutcome.STALE) {
            finalizer.terminal(
                    item, "STALE", "SHOPIFY_INVENTORY_STALE",
                    result.updatedAt());
        } else if ("SHOPIFY_IDEMPOTENCY_BUSY".equals(
                result.safeErrorCode())) {
            publications.requeueBusy(item.tenantId(), item.id());
        } else {
            finalizer.terminal(
                    item, "REJECTED",
                    result.safeErrorCode() == null
                            ? "SHOPIFY_INVENTORY_REJECTED"
                            : result.safeErrorCode(),
                    result.updatedAt());
        }
    }
}
