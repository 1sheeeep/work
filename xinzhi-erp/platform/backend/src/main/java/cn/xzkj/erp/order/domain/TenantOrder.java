package cn.xzkj.erp.order.domain;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import cn.xzkj.erp.platform.domain.TenantOwnedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;

@Entity
@Table(name = "tenant_orders")
public class TenantOrder extends TenantOwnedEntity {
    @Column(name = "shop_id", nullable = false, updatable = false)
    private UUID shopId;
    @Column(name = "external_order_ref", nullable = false, updatable = false, length = 160)
    private String externalOrderRef;
    @Column(name = "idempotency_key", nullable = false, updatable = false, length = 100)
    private String idempotencyKey;
    @Column(name = "request_fingerprint", nullable = false, updatable = false, length = 64)
    private String requestFingerprint;
    @Column(nullable = false, updatable = false, length = 3)
    private String currency;
    @Column(name = "buyer_reference", length = 200)
    private String buyerReference;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private OrderStatus status;
    @Column(name = "hold_reason", length = 500)
    private String holdReason;
    @Column(name = "line_count", nullable = false)
    private int lineCount;
    @Column(name = "placed_at", nullable = false, updatable = false)
    private Instant placedAt;
    @Column(name = "platform_status", length = 64)
    private String platformStatus;
    @Column(name = "payment_status", length = 24)
    private String paymentStatus;
    @Column(name = "logistics_channel", length = 80)
    private String logisticsChannel;
    @Column(name = "country_code", length = 2)
    private String countryCode;
    @Column(length = 120)
    private String province;
    @Column(name = "postal_code", length = 32)
    private String postalCode;
    @Column(name = "buyer_selected_logistics", length = 120)
    private String buyerSelectedLogistics;
    @Column(name = "total_amount_minor")
    private Long totalAmountMinor;
    @Column(name = "shipping_amount_minor")
    private Long shippingAmountMinor;
    @Column(name = "weight_grams", precision = 12, scale = 3)
    private BigDecimal weightGrams;
    @Column(name = "paid_at")
    private Instant paidAt;
    @Column(name = "ship_by_at")
    private Instant shipByAt;
    @Column(name = "shipped_at")
    private Instant shippedAt;
    @Column(name = "tracking_status", length = 32)
    private String trackingStatus;
    @Column(name = "fixed_category", length = 80)
    private String fixedCategory;
    @Column(name = "custom_category", length = 80)
    private String customCategory;
    @Column(name = "warehouse_id")
    private UUID warehouseId;
    @Column(name = "is_reshipment", nullable = false)
    private boolean reshipment;
    @Column(name = "reshipment_reason", length = 160)
    private String reshipmentReason;
    @Column(name = "platform_handover_required", nullable = false)
    private boolean platformHandoverRequired;
    @Column(nullable = false)
    private boolean printed;

    protected TenantOrder() { }

    public TenantOrder(UUID tenantId, UUID shopId, String externalOrderRef, String idempotencyKey,
            String requestFingerprint, String currency, String buyerReference, int lineCount, Instant placedAt) {
        super(tenantId);
        this.shopId = shopId;
        this.externalOrderRef = externalOrderRef;
        this.idempotencyKey = idempotencyKey;
        this.requestFingerprint = requestFingerprint;
        this.currency = currency;
        this.buyerReference = buyerReference;
        this.status = OrderStatus.RECEIVED;
        this.lineCount = lineCount;
        this.placedAt = placedAt;
    }

    public boolean transition(OrderStatus targetStatus, String normalizedHoldReason) {
        if (status == targetStatus) {
            return false;
        }
        boolean allowed = switch (status) {
            case UNPAID -> targetStatus == OrderStatus.REVIEW_PENDING
                    || targetStatus == OrderStatus.HOLD
                    || targetStatus == OrderStatus.CANCELLED;
            case RECEIVED -> targetStatus == OrderStatus.REVIEW_PENDING
                    || targetStatus == OrderStatus.MERGE_PENDING
                    || targetStatus == OrderStatus.HOLD
                    || targetStatus == OrderStatus.CANCELLED;
            case REVIEW_PENDING -> targetStatus == OrderStatus.READY_TO_FULFILL
                    || targetStatus == OrderStatus.MERGE_PENDING
                    || targetStatus == OrderStatus.HOLD
                    || targetStatus == OrderStatus.CANCELLED;
            case MERGE_PENDING -> targetStatus == OrderStatus.REVIEW_PENDING
                    || targetStatus == OrderStatus.READY_TO_FULFILL
                    || targetStatus == OrderStatus.HOLD
                    || targetStatus == OrderStatus.CANCELLED;
            case HOLD -> targetStatus == OrderStatus.REVIEW_PENDING
                    || targetStatus == OrderStatus.MERGE_PENDING
                    || targetStatus == OrderStatus.CANCELLED;
            case SHIPPED -> targetStatus == OrderStatus.DELIVERED;
            case READY_TO_FULFILL -> targetStatus == OrderStatus.CANCELLED;
            case FULFILLING, DELIVERED, CANCELLED -> false;
        };
        if (!allowed) {
            throw new IllegalStateException("Order status transition is not allowed");
        }
        if (targetStatus == OrderStatus.HOLD && normalizedHoldReason == null) {
            throw new IllegalArgumentException("A hold reason is required");
        }
        if (targetStatus != OrderStatus.HOLD && normalizedHoldReason != null) {
            throw new IllegalArgumentException("A reason is only accepted for HOLD");
        }
        status = targetStatus;
        holdReason = targetStatus == OrderStatus.HOLD ? normalizedHoldReason : null;
        return true;
    }

    public void applyOperationalMetadata(OperationalMetadata metadata) {
        platformStatus = metadata.platformStatus();
        paymentStatus = metadata.paymentStatus();
        logisticsChannel = metadata.logisticsChannel();
        countryCode = metadata.countryCode();
        province = metadata.province();
        postalCode = metadata.postalCode();
        buyerSelectedLogistics = metadata.buyerSelectedLogistics();
        totalAmountMinor = metadata.totalAmountMinor();
        shippingAmountMinor = metadata.shippingAmountMinor();
        weightGrams = metadata.weightGrams();
        paidAt = metadata.paidAt();
        shipByAt = metadata.shipByAt();
        shippedAt = metadata.shippedAt();
        trackingStatus = metadata.trackingStatus();
        fixedCategory = metadata.fixedCategory();
        customCategory = metadata.customCategory();
        warehouseId = metadata.warehouseId();
        reshipment = metadata.reshipment();
        reshipmentReason = metadata.reshipmentReason();
        platformHandoverRequired = metadata.platformHandoverRequired();
        printed = metadata.printed();
    }

    public void assignWarehouse(UUID targetWarehouseId) {
        warehouseId = targetWarehouseId;
    }

    public void incrementLineCount() {
        if (lineCount >= 100_000) {
            throw new IllegalStateException("Order line count limit reached");
        }
        lineCount++;
    }

    public UUID getShopId() { return shopId; }
    public String getExternalOrderRef() { return externalOrderRef; }
    public String getIdempotencyKey() { return idempotencyKey; }
    public String getRequestFingerprint() { return requestFingerprint; }
    public String getCurrency() { return currency; }
    public String getBuyerReference() { return buyerReference; }
    public OrderStatus getStatus() { return status; }
    public String getHoldReason() { return holdReason; }
    public int getLineCount() { return lineCount; }
    public Instant getPlacedAt() { return placedAt; }
    public String getPlatformStatus() { return platformStatus; }
    public String getPaymentStatus() { return paymentStatus; }
    public String getLogisticsChannel() { return logisticsChannel; }
    public String getCountryCode() { return countryCode; }
    public String getProvince() { return province; }
    public String getPostalCode() { return postalCode; }
    public String getBuyerSelectedLogistics() { return buyerSelectedLogistics; }
    public Long getTotalAmountMinor() { return totalAmountMinor; }
    public Long getShippingAmountMinor() { return shippingAmountMinor; }
    public BigDecimal getWeightGrams() { return weightGrams; }
    public Instant getPaidAt() { return paidAt; }
    public Instant getShipByAt() { return shipByAt; }
    public Instant getShippedAt() { return shippedAt; }
    public String getTrackingStatus() { return trackingStatus; }
    public String getFixedCategory() { return fixedCategory; }
    public String getCustomCategory() { return customCategory; }
    public UUID getWarehouseId() { return warehouseId; }
    public boolean isReshipment() { return reshipment; }
    public String getReshipmentReason() { return reshipmentReason; }
    public boolean isPlatformHandoverRequired() { return platformHandoverRequired; }
    public boolean isPrinted() { return printed; }

    public OperationalMetadata operationalMetadata() {
        return new OperationalMetadata(
                platformStatus, paymentStatus, logisticsChannel,
                countryCode, province, postalCode, buyerSelectedLogistics,
                totalAmountMinor, shippingAmountMinor, weightGrams,
                paidAt, shipByAt, shippedAt, trackingStatus,
                fixedCategory, customCategory, warehouseId, reshipment,
                reshipmentReason, platformHandoverRequired, printed);
    }

    public record OperationalMetadata(
            String platformStatus,
            String paymentStatus,
            String logisticsChannel,
            String countryCode,
            String province,
            String postalCode,
            String buyerSelectedLogistics,
            Long totalAmountMinor,
            Long shippingAmountMinor,
            BigDecimal weightGrams,
            Instant paidAt,
            Instant shipByAt,
            Instant shippedAt,
            String trackingStatus,
            String fixedCategory,
            String customCategory,
            UUID warehouseId,
            boolean reshipment,
            String reshipmentReason,
            boolean platformHandoverRequired,
            boolean printed) {

        public OperationalMetadata withShippingLocation(
                String targetCountryCode,
                String targetProvince,
                String targetPostalCode) {
            return new OperationalMetadata(
                    platformStatus, paymentStatus, logisticsChannel,
                    targetCountryCode, targetProvince, targetPostalCode,
                    buyerSelectedLogistics, totalAmountMinor,
                    shippingAmountMinor, weightGrams, paidAt, shipByAt,
                    shippedAt, trackingStatus, fixedCategory, customCategory,
                    warehouseId, reshipment, reshipmentReason,
                    platformHandoverRequired, printed);
        }

        public OperationalMetadata withTotalAmount(Long targetTotalAmountMinor) {
            return new OperationalMetadata(
                    platformStatus, paymentStatus, logisticsChannel,
                    countryCode, province, postalCode,
                    buyerSelectedLogistics, targetTotalAmountMinor,
                    shippingAmountMinor, weightGrams, paidAt, shipByAt,
                    shippedAt, trackingStatus, fixedCategory, customCategory,
                    warehouseId, reshipment, reshipmentReason,
                    platformHandoverRequired, printed);
        }

        public OperationalMetadata withShipByAt(Instant targetShipByAt) {
            return new OperationalMetadata(
                    platformStatus, paymentStatus, logisticsChannel,
                    countryCode, province, postalCode,
                    buyerSelectedLogistics, totalAmountMinor,
                    shippingAmountMinor, weightGrams, paidAt, targetShipByAt,
                    shippedAt, trackingStatus, fixedCategory, customCategory,
                    warehouseId, reshipment, reshipmentReason,
                    platformHandoverRequired, printed);
        }
    }
}
