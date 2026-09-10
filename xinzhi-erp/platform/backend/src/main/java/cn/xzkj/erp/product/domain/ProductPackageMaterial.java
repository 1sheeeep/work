package cn.xzkj.erp.product.domain;

import java.math.BigDecimal;
import java.util.UUID;

import cn.xzkj.erp.platform.domain.TenantOwnedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;

@Entity
@Table(name = "tenant_product_package_materials")
public class ProductPackageMaterial extends TenantOwnedEntity {

    @Column(nullable = false, length = 200)
    private String name;

    @Column(name = "unit_price", precision = 14, scale = 4)
    private BigDecimal unitPrice;

    @Column(name = "currency_code", length = 3)
    private String currencyCode;

    @Column(name = "weight_grams")
    private Long weightGrams;

    @Column(name = "package_level")
    private Integer packageLevel;

    @Column(name = "length_mm")
    private Long lengthMm;

    @Column(name = "width_mm")
    private Long widthMm;

    @Column(name = "height_mm")
    private Long heightMm;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 24)
    private ProductMasterDataStatus status;

    @Column(name = "created_by_type", nullable = false, updatable = false,
            length = 24)
    private String createdByType;

    @Column(name = "created_by", nullable = false, updatable = false)
    private UUID createdBy;

    protected ProductPackageMaterial() {
    }

    public ProductPackageMaterial(
            UUID tenantId,
            String name,
            BigDecimal unitPrice,
            String currencyCode,
            Long weightGrams,
            Integer packageLevel,
            Long lengthMm,
            Long widthMm,
            Long heightMm,
            String createdByType,
            UUID createdBy) {
        super(tenantId);
        this.name = name;
        this.unitPrice = unitPrice;
        this.currencyCode = currencyCode;
        this.weightGrams = weightGrams;
        this.packageLevel = packageLevel;
        this.lengthMm = lengthMm;
        this.widthMm = widthMm;
        this.heightMm = heightMm;
        this.status = ProductMasterDataStatus.ACTIVE;
        this.createdByType = createdByType;
        this.createdBy = createdBy;
    }

    public void update(
            String name,
            BigDecimal unitPrice,
            String currencyCode,
            Long weightGrams,
            Integer packageLevel,
            Long lengthMm,
            Long widthMm,
            Long heightMm,
            ProductMasterDataStatus status) {
        this.name = name;
        this.unitPrice = unitPrice;
        this.currencyCode = currencyCode;
        this.weightGrams = weightGrams;
        this.packageLevel = packageLevel;
        this.lengthMm = lengthMm;
        this.widthMm = widthMm;
        this.heightMm = heightMm;
        this.status = status;
    }

    public String getName() { return name; }
    public BigDecimal getUnitPrice() { return unitPrice; }
    public String getCurrencyCode() { return currencyCode; }
    public Long getWeightGrams() { return weightGrams; }
    public Integer getPackageLevel() { return packageLevel; }
    public Long getLengthMm() { return lengthMm; }
    public Long getWidthMm() { return widthMm; }
    public Long getHeightMm() { return heightMm; }
    public ProductMasterDataStatus getStatus() { return status; }
    public String getCreatedByType() { return createdByType; }
    public UUID getCreatedBy() { return createdBy; }
}
