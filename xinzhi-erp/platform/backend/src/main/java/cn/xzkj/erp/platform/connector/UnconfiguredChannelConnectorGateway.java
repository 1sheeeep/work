package cn.xzkj.erp.platform.connector;

import java.util.List;
import java.util.UUID;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(
        name = "erp.channel-connector.mode",
        havingValue = "unconfigured",
        matchIfMissing = true)
public class UnconfiguredChannelConnectorGateway implements ChannelConnectorGateway {

    @Override
    public ChannelSnapshot snapshot(UUID tenantId, UUID shopId) {
        return new ChannelSnapshot(
                ConnectorMode.UNCONFIGURED,
                new Connection(ConnectionStatus.NOT_CONNECTED, null, null, null),
                ChannelConnectorGateway.plannedShopifyScopes(List.of()),
                List.of());
    }

    @Override
    public ChannelSnapshot authorizeShopify(UUID tenantId, UUID shopId) {
        throw new ConnectorUnavailableException();
    }

    @Override
    public ChannelSnapshot retryShopify(UUID tenantId, UUID shopId) {
        throw new ConnectorUnavailableException();
    }

    @Override
    public ChannelSnapshot uninstallShopify(UUID tenantId, UUID shopId) {
        throw new ConnectorUnavailableException();
    }

    @Override
    public ProductCatalogPage fetchShopifyProductCatalog(
            UUID tenantId,
            UUID shopId,
            ProductCatalogRequest request) {
        throw new ConnectorUnavailableException();
    }

    @Override
    public LocationCatalogPage fetchShopifyLocationCatalog(
            UUID tenantId,
            UUID shopId,
            LocationCatalogRequest request) {
        throw new ConnectorUnavailableException();
    }

    @Override
    public InventoryLevelSnapshot fetchShopifyInventoryLevel(
            UUID tenantId,
            UUID shopId,
            InventoryLevelRequest request) {
        throw new ConnectorUnavailableException();
    }

    @Override
    public InventorySetResult setShopifyInventoryAvailable(
            UUID tenantId,
            UUID shopId,
            InventorySetRequest request) {
        throw new ConnectorUnavailableException();
    }

    @Override
    public OrderCatalogPage fetchShopifyOrderCatalog(
            UUID tenantId,
            UUID shopId,
            OrderCatalogRequest request) {
        throw new ConnectorUnavailableException();
    }

    @Override
    public CustomerCatalogPage fetchShopifyCustomerCatalog(
            UUID tenantId,
            UUID shopId,
            CustomerCatalogRequest request) {
        throw new ConnectorUnavailableException();
    }

    @Override
    public OrderShippingAddressUpdateResult updateShopifyOrderShippingAddress(
            UUID tenantId,
            UUID shopId,
            OrderShippingAddressUpdateRequest request) {
        throw new ConnectorUnavailableException();
    }

    @Override
    public OrderEditQuantityResult updateShopifyOrderLineQuantity(
            UUID tenantId,
            UUID shopId,
            OrderEditQuantityRequest request) {
        throw new ConnectorUnavailableException();
    }

    @Override
    public OrderAddVariantResult addShopifyOrderVariant(
            UUID tenantId,
            UUID shopId,
            OrderAddVariantRequest request) {
        throw new ConnectorUnavailableException();
    }

    @Override
    public OrderAddCustomItemResult addShopifyOrderCustomItem(
            UUID tenantId,
            UUID shopId,
            OrderAddCustomItemRequest request) {
        throw new ConnectorUnavailableException();
    }

    @Override
    public OrderLineDiscountResult addShopifyOrderLineDiscount(
            UUID tenantId,
            UUID shopId,
            OrderLineDiscountRequest request) {
        throw new ConnectorUnavailableException();
    }

    @Override
    public OrderCancellationResult cancelShopifyOrder(
            UUID tenantId, UUID shopId, OrderCancellationRequest request) {
        throw new ConnectorUnavailableException();
    }

    @Override
    public FulfillmentPublishResult publishShopifyFulfillment(
            UUID tenantId,
            UUID shopId,
            FulfillmentPublishRequest request) {
        throw new ConnectorUnavailableException();
    }

    @Override
    public DisputeCatalogPage fetchShopifyDisputes(
            UUID tenantId,
            UUID shopId,
            DisputeCatalogRequest request) {
        throw new ConnectorUnavailableException();
    }

    @Override
    public ReturnCatalogPage fetchShopifyReturnCatalog(
            UUID tenantId,
            UUID shopId,
            ReturnCatalogRequest request) {
        throw new ConnectorUnavailableException();
    }

    @Override
    public ReturnDecisionResult decideShopifyReturn(
            UUID tenantId, UUID shopId, ReturnDecisionRequest request) {
        throw new ConnectorUnavailableException();
    }

    @Override
    public ReturnRefundPreview previewShopifyReturnRefund(
            UUID tenantId, UUID shopId, ReturnRefundPreviewRequest request) {
        throw new ConnectorUnavailableException();
    }

    @Override
    public ReturnRefundProcessResult processShopifyReturnRefund(
            UUID tenantId, UUID shopId, ReturnRefundProcessRequest request) {
        throw new ConnectorUnavailableException();
    }

    @Override
    public List<ShopifyComplianceRequest> listShopifyComplianceRequests() {
        throw new ConnectorUnavailableException();
    }

    @Override
    public ShopifyComplianceCompletion completeShopifyComplianceRequest(
            String eventId,
            ShopifyComplianceOutcome outcome) {
        throw new ConnectorUnavailableException();
    }
}
