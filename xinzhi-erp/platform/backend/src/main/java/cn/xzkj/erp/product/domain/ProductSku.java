package cn.xzkj.erp.product.domain;

import java.util.UUID;
import java.math.BigDecimal;

import cn.xzkj.erp.platform.domain.TenantOwnedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;

@Entity
@Table(name = "tenant_product_skus")
public class ProductSku extends TenantOwnedEntity {

    @Column(name = "spu_id", nullable = false)
    private UUID spuId;

    @Column(nullable = false, length = 64)
    private String businessCode;

    @Column(nullable = false, length = 200)
    private String name;

    @Column(name = "variant_summary", length = 1000)
    private String variantSummary;

    @Column(name = "name_en", length = 200)
    private String nameEn;

    @Column(name = "unit_cost", precision = 14, scale = 4)
    private BigDecimal unitCost;

    @Column(name = "currency_code", length = 3)
    private String currencyCode;

    @Column(name = "default_warehouse_id")
    private UUID defaultWarehouseId;

    @Column(name = "default_warehouse_name_snapshot", length = 200)
    private String defaultWarehouseNameSnapshot;

    @Column(name = "standard_weight_grams")
    private Long standardWeightGrams;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 24)
    private ProductStatus status;

    protected ProductSku() {
    }

    public ProductSku(UUID tenantId, UUID spuId, String businessCode, String name, String variantSummary) {
        this(tenantId, spuId, businessCode, name, variantSummary,
                null, null, null, null, null);
    }

    public ProductSku(
            UUID tenantId, UUID spuId, String businessCode, String name,
            String variantSummary, String nameEn, BigDecimal unitCost,
            String currencyCode, UUID defaultWarehouseId,
            String defaultWarehouseNameSnapshot) {
        super(tenantId);
        this.spuId = spuId;
        this.businessCode = businessCode;
        this.name = name;
        this.variantSummary = variantSummary;
        this.nameEn = nameEn;
        this.unitCost = unitCost;
        this.currencyCode = currencyCode;
        this.defaultWarehouseId = defaultWarehouseId;
        this.defaultWarehouseNameSnapshot = defaultWarehouseNameSnapshot;
        this.status = ProductStatus.ACTIVE;
    }

    public void update(String name, String variantSummary, ProductStatus status) {
        update(name, variantSummary, null, null, null, null, null, status);
    }

    public void update(
            String name, String variantSummary, String nameEn,
            BigDecimal unitCost, String currencyCode, UUID defaultWarehouseId,
            String defaultWarehouseNameSnapshot, ProductStatus status) {
        this.name = name;
        this.variantSummary = variantSummary;
        this.nameEn = nameEn;
        this.unitCost = unitCost;
        this.currencyCode = currencyCode;
        this.defaultWarehouseId = defaultWarehouseId;
        this.defaultWarehouseNameSnapshot = defaultWarehouseNameSnapshot;
        this.status = status;
    }

    public void archive() { status = ProductStatus.ARCHIVED; }
    public void updateStandardWeight(Long standardWeightGrams) {
        if (standardWeightGrams != null
                && (standardWeightGrams < 1 || standardWeightGrams > 999999999)) {
            throw new IllegalArgumentException("Standard weight is invalid");
        }
        this.standardWeightGrams = standardWeightGrams;
    }
    public void reassignTo(UUID targetSpuId) {
        if (targetSpuId == null) throw new IllegalArgumentException("Target SPU is required");
        spuId = targetSpuId;
    }
    public UUID getSpuId() { return spuId; }
    public String getBusinessCode() { return businessCode; }
    public String getName() { return name; }
    public String getVariantSummary() { return variantSummary; }
    public String getNameEn() { return nameEn; }
    public BigDecimal getUnitCost() { return unitCost; }
    public String getCurrencyCode() { return currencyCode; }
    public UUID getDefaultWarehouseId() { return defaultWarehouseId; }
    public String getDefaultWarehouseNameSnapshot() { return defaultWarehouseNameSnapshot; }
    public Long getStandardWeightGrams() { return standardWeightGrams; }
    public ProductStatus getStatus() { return status; }
}
