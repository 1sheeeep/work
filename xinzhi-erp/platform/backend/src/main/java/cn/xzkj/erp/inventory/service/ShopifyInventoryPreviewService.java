package cn.xzkj.erp.inventory.service;

import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

import org.springframework.stereotype.Service;

import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.domain.ShopStatus;
import cn.xzkj.erp.platform.repository.ShopifyLocationMappingRepository;
import cn.xzkj.erp.platform.repository.ShopifyLocationMappingRepository.LocationMapping;
import cn.xzkj.erp.platform.repository.TenantShopRepository;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.product.domain.ListingStatus;
import cn.xzkj.erp.product.domain.ProductListing;
import cn.xzkj.erp.product.repository.ProductListingRepository;

@Service
public class ShopifyInventoryPreviewService {

    private final InventoryService inventoryService;
    private final TenantShopRepository shopRepository;
    private final ProductListingRepository listingRepository;
    private final ShopifyLocationMappingRepository locationMappingRepository;
    private final ChannelConnectorGateway connector;

    public ShopifyInventoryPreviewService(
            InventoryService inventoryService,
            TenantShopRepository shopRepository,
            ProductListingRepository listingRepository,
            ShopifyLocationMappingRepository locationMappingRepository,
            ChannelConnectorGateway connector) {
        this.inventoryService = inventoryService;
        this.shopRepository = shopRepository;
        this.listingRepository = listingRepository;
        this.locationMappingRepository = locationMappingRepository;
        this.connector = connector;
    }

    public ShopifyInventoryPreview preview(
            InventoryActor actor,
            UUID shopId,
            UUID balanceId) {
        Objects.requireNonNull(actor, "Actor is required");
        UUID tenantId = Objects.requireNonNull(actor.tenantId(), "Tenant is required");
        Objects.requireNonNull(shopId, "Shop is required");
        Objects.requireNonNull(balanceId, "Inventory balance is required");
        var shop = shopRepository.findByIdAndTenantId(shopId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Shop was not found"));
        if (shop.getStatus() != ShopStatus.ACTIVE) {
            throw new ConflictException("Shopify inventory preview requires an active shop");
        }

        InventoryBalanceView balance = inventoryService.getBalance(actor, balanceId);
        List<ProductListing> listings = listingRepository
                .findAllByTenantIdAndShopIdAndSkuIdAndStatusAndExternalInventoryItemRefIsNotNull(
                        tenantId, shopId, balance.skuId(), ListingStatus.ACTIVE);
        if (listings.size() != 1) {
            throw new ConflictException(listings.isEmpty()
                    ? "SKU has no active Shopify inventory item mapping"
                    : "SKU has multiple active Shopify inventory item mappings");
        }
        ProductListing listing = listings.get(0);

        List<LocationMapping> mappings = locationMappingRepository.findAll(tenantId, shopId)
                .stream()
                .filter(mapping -> mapping.warehouseId().equals(balance.warehouseId()))
                .toList();
        if (mappings.size() != 1) {
            throw new ConflictException(mappings.isEmpty()
                    ? "Warehouse has no Shopify location mapping"
                    : "Warehouse has multiple Shopify location mappings");
        }
        LocationMapping mapping = mappings.get(0);
        if (!mapping.externalActive()) {
            throw new ConflictException("Mapped Shopify location is inactive");
        }

        var snapshot = connector.fetchShopifyInventoryLevel(
                tenantId,
                shopId,
                new ChannelConnectorGateway.InventoryLevelRequest(
                        listing.getExternalInventoryItemRef(),
                        mapping.externalLocationRef()));
        if (snapshot.connectionStatus()
                != ChannelConnectorGateway.ConnectionStatus.CONNECTED) {
            throw new ConflictException("Shopify inventory connection is not available");
        }
        if (!Objects.equals(snapshot.externalInventoryItemRef(),
                listing.getExternalInventoryItemRef())
                || !Objects.equals(snapshot.externalLocationRef(),
                        mapping.externalLocationRef())) {
            throw new ConflictException("Shopify inventory response identity does not match the request");
        }
        if (!snapshot.tracked() || !snapshot.active()) {
            throw new ConflictException(
                    "Shopify inventory item is not actively tracked at the mapped location");
        }
        if (snapshot.fetchedAt() == null) {
            throw new ConflictException("Shopify inventory response is incomplete");
        }
        long erpAvailable = balance.available();
        return new ShopifyInventoryPreview(
                shopId,
                balance.id(), balance.version(),
                balance.skuId(), balance.skuBusinessCode(), balance.skuName(),
                balance.warehouseId(), balance.warehouseBusinessCode(), balance.warehouseName(),
                listing.getExternalVariantRef(), listing.getExternalInventoryItemRef(),
                mapping.externalLocationRef(),
                balance.onHand(), balance.reserved(), erpAvailable,
                snapshot.availableQuantity(), snapshot.onHandQuantity(),
                Math.subtractExact(erpAvailable, snapshot.availableQuantity()),
                snapshot.fetchedAt());
    }

    public record ShopifyInventoryPreview(
            UUID shopId,
            UUID balanceId,
            long balanceVersion,
            UUID skuId,
            String skuCode,
            String skuName,
            UUID warehouseId,
            String warehouseCode,
            String warehouseName,
            String externalVariantRef,
            String externalInventoryItemRef,
            String externalLocationRef,
            long erpOnHand,
            long erpReserved,
            long erpAvailable,
            int shopifyAvailable,
            Integer shopifyOnHand,
            long availableDifference,
            Instant fetchedAt) {
    }
}
