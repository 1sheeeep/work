package cn.xzkj.erp.product.domain;

import java.util.UUID;

import cn.xzkj.erp.platform.domain.TenantOwnedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;

@Entity
@Table(name = "tenant_product_listings")
public class ProductListing extends TenantOwnedEntity {

    @Column(name = "shop_id", nullable = false, updatable = false)
    private UUID shopId;
    @Column(name = "platform_id", nullable = false, updatable = false)
    private UUID platformId;
    @Column(name = "sku_id", nullable = false, updatable = false)
    private UUID skuId;
    @Column(name = "external_listing_ref", nullable = false, length = 160)
    private String externalListingRef;
    @Column(name = "external_variant_ref", length = 160)
    private String externalVariantRef;
    @Column(name = "external_inventory_item_ref", length = 160)
    private String externalInventoryItemRef;
    @Column(name = "external_status", length = 80)
    private String externalStatus;
    @Column(name = "metadata_note", length = 1000)
    private String metadataNote;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 24)
    private ListingStatus status;

    protected ProductListing() {
    }

    public ProductListing(UUID tenantId, UUID shopId, UUID platformId, UUID skuId, String externalListingRef,
            String externalVariantRef, String externalStatus, String metadataNote) {
        this(tenantId, shopId, platformId, skuId, externalListingRef,
                externalVariantRef, null, externalStatus, metadataNote);
    }

    public ProductListing(UUID tenantId, UUID shopId, UUID platformId, UUID skuId, String externalListingRef,
            String externalVariantRef, String externalInventoryItemRef,
            String externalStatus, String metadataNote) {
        super(tenantId);
        this.shopId = shopId;
        this.platformId = platformId;
        this.skuId = skuId;
        this.externalListingRef = externalListingRef;
        this.externalVariantRef = externalVariantRef;
        this.externalInventoryItemRef = externalInventoryItemRef;
        this.externalStatus = externalStatus;
        this.metadataNote = metadataNote;
        this.status = ListingStatus.ACTIVE;
    }

    public void update(String externalStatus, String metadataNote, ListingStatus status) {
        this.externalStatus = externalStatus;
        this.metadataNote = metadataNote;
        this.status = status;
    }

    public void archive() { status = ListingStatus.ARCHIVED; }
    public UUID getShopId() { return shopId; }
    public UUID getPlatformId() { return platformId; }
    public UUID getSkuId() { return skuId; }
    public String getExternalListingRef() { return externalListingRef; }
    public String getExternalVariantRef() { return externalVariantRef; }
    public String getExternalInventoryItemRef() { return externalInventoryItemRef; }
    public String getExternalStatus() { return externalStatus; }
    public String getMetadataNote() { return metadataNote; }
    public ListingStatus getStatus() { return status; }
}
