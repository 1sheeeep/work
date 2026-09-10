package cn.xzkj.erp.order.domain;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;

@Entity
@Table(name = "tenant_order_lines")
public class OrderLine {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    @Column(name = "tenant_id", nullable = false, updatable = false)
    private UUID tenantId;
    @Column(name = "order_id", nullable = false, updatable = false)
    private UUID orderId;
    @Column(name = "sku_id")
    private UUID skuId;
    @Enumerated(EnumType.STRING)
    @Column(name = "line_kind", nullable = false, length = 24)
    private OrderLineKind lineKind;
    @Column(name = "external_listing_ref", updatable = false, length = 160)
    private String externalListingRef;
    @Column(name = "external_variant_ref", updatable = false, length = 160)
    private String externalVariantRef;
    @Enumerated(EnumType.STRING)
    @Column(name = "sku_match_source", nullable = false, length = 32)
    private SkuMatchSource skuMatchSource;
    @Column(name = "external_line_ref", nullable = false, updatable = false, length = 160)
    private String externalLineRef;
    @Column(name = "title_snapshot", nullable = false, updatable = false, length = 300)
    private String titleSnapshot;
    @Column(nullable = false)
    private int quantity;
    @Column(name = "unit_price_minor", nullable = false, updatable = false)
    private long unitPriceMinor;
    @Column(nullable = false, updatable = false, length = 3)
    private String currency;
    @Column(name = "discount_total_minor", nullable = false)
    private long discountTotalMinor;
    @Column(name = "discount_description", length = 255)
    private String discountDescription;
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
    @Column(name = "platform_sku", length = 160)
    private String platformSku;
    @Column(name = "warehouse_id")
    private UUID warehouseId;
    @Column(name = "location_id")
    private UUID locationId;
    @Column(name = "purchase_reference", length = 160)
    private String purchaseReference;

    protected OrderLine() { }

    public OrderLine(UUID tenantId, UUID orderId, UUID skuId, String externalLineRef,
            String titleSnapshot, int quantity, long unitPriceMinor, String currency) {
        this(tenantId, orderId, skuId, OrderLineKind.PRODUCT,
                null, null,
                skuId == null ? SkuMatchSource.UNMATCHED : SkuMatchSource.PROVIDED,
                externalLineRef, titleSnapshot, quantity, unitPriceMinor, currency);
    }

    public static OrderLine customAmount(
            UUID tenantId,
            UUID orderId,
            String externalLineRef,
            String titleSnapshot,
            int quantity,
            long unitPriceMinor,
            String currency) {
        return new OrderLine(
                tenantId, orderId, null, OrderLineKind.CUSTOM_AMOUNT,
                null, null, SkuMatchSource.UNMATCHED, externalLineRef,
                titleSnapshot, quantity, unitPriceMinor, currency);
    }

    public OrderLine(UUID tenantId, UUID orderId, UUID skuId, String externalListingRef,
            String externalVariantRef, SkuMatchSource skuMatchSource, String externalLineRef,
            String titleSnapshot, int quantity, long unitPriceMinor, String currency) {
        this(tenantId, orderId, skuId, OrderLineKind.PRODUCT,
                externalListingRef, externalVariantRef, skuMatchSource,
                externalLineRef, titleSnapshot, quantity,
                unitPriceMinor, currency);
    }

    private OrderLine(UUID tenantId, UUID orderId, UUID skuId,
            OrderLineKind lineKind, String externalListingRef,
            String externalVariantRef, SkuMatchSource skuMatchSource,
            String externalLineRef, String titleSnapshot, int quantity,
            long unitPriceMinor, String currency) {
        this.tenantId = tenantId;
        this.orderId = orderId;
        this.skuId = skuId;
        this.lineKind = lineKind;
        this.externalListingRef = externalListingRef;
        this.externalVariantRef = externalVariantRef;
        this.skuMatchSource = skuMatchSource;
        this.externalLineRef = externalLineRef;
        this.titleSnapshot = titleSnapshot;
        this.quantity = quantity;
        this.unitPriceMinor = unitPriceMinor;
        this.currency = currency;
    }

    @PrePersist
    void onCreate() { createdAt = Instant.now(); }

    public boolean updateSkuMatch(UUID targetSkuId, SkuMatchSource targetSource) {
        if (java.util.Objects.equals(skuId, targetSkuId) && skuMatchSource == targetSource) {
            return false;
        }
        skuId = targetSkuId;
        skuMatchSource = targetSource;
        return true;
    }

    public boolean updateQuantity(int targetQuantity) {
        if (targetQuantity < 0 || targetQuantity > 100_000) {
            throw new IllegalArgumentException("Order line quantity is invalid");
        }
        if (quantity == targetQuantity) {
            return false;
        }
        quantity = targetQuantity;
        return true;
    }

    public void applyOperationalMetadata(
            String platformSku,
            UUID warehouseId,
            UUID locationId,
            String purchaseReference) {
        this.platformSku = platformSku;
        this.warehouseId = warehouseId;
        this.locationId = locationId;
        this.purchaseReference = purchaseReference;
    }

    public void applyShopifyDiscount(
            long expectedDiscountTotalMinor,
            long targetDiscountTotalMinor,
            String description) {
        if (expectedDiscountTotalMinor < 0
                || targetDiscountTotalMinor <= expectedDiscountTotalMinor
                || discountTotalMinor != expectedDiscountTotalMinor
                || description == null
                || description.isBlank()
                || description.strip().length() > 255) {
            throw new IllegalArgumentException(
                    "Order line discount state is invalid");
        }
        discountTotalMinor = targetDiscountTotalMinor;
        discountDescription = description.strip();
    }

    public UUID getId() { return id; }
    public UUID getTenantId() { return tenantId; }
    public UUID getOrderId() { return orderId; }
    public UUID getSkuId() { return skuId; }
    public OrderLineKind getLineKind() { return lineKind; }
    public String getExternalListingRef() { return externalListingRef; }
    public String getExternalVariantRef() { return externalVariantRef; }
    public SkuMatchSource getSkuMatchSource() { return skuMatchSource; }
    public String getExternalLineRef() { return externalLineRef; }
    public String getTitleSnapshot() { return titleSnapshot; }
    public int getQuantity() { return quantity; }
    public long getUnitPriceMinor() { return unitPriceMinor; }
    public String getCurrency() { return currency; }
    public long getDiscountTotalMinor() { return discountTotalMinor; }
    public String getDiscountDescription() { return discountDescription; }
    public Instant getCreatedAt() { return createdAt; }
    public String getPlatformSku() { return platformSku; }
    public UUID getWarehouseId() { return warehouseId; }
    public UUID getLocationId() { return locationId; }
    public String getPurchaseReference() { return purchaseReference; }
}
