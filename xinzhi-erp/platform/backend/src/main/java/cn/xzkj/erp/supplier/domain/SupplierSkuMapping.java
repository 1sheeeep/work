package cn.xzkj.erp.supplier.domain;

import java.math.BigDecimal;
import java.util.UUID;

import cn.xzkj.erp.platform.domain.TenantOwnedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;

@Entity
@Table(name = "tenant_supplier_sku_mappings")
public class SupplierSkuMapping extends TenantOwnedEntity {

    @Column(name = "supplier_id", nullable = false, updatable = false)
    private UUID supplierId;

    @Column(name = "sku_id", nullable = false, updatable = false)
    private UUID skuId;

    @Column(name = "supplier_sku_code", length = 120)
    private String supplierSkuCode;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 24)
    private SupplierSkuMappingStatus status;

    @Column(nullable = false)
    private boolean preferred;

    @Column(name = "lead_time_days")
    private Integer leadTimeDays;

    @Column(name = "unit_price", precision = 19, scale = 4)
    private BigDecimal unitPrice;

    @Column(name = "currency_code", length = 3)
    private String currencyCode;

    @Column(name = "minimum_order_quantity")
    private Long minimumOrderQuantity;

    protected SupplierSkuMapping() {
    }

    public SupplierSkuMapping(
            UUID tenantId,
            UUID supplierId,
            UUID skuId,
            String supplierSkuCode,
            SupplierSkuMappingStatus status,
            boolean preferred,
            Integer leadTimeDays,
            BigDecimal unitPrice,
            String currencyCode,
            Long minimumOrderQuantity) {
        super(tenantId);
        this.supplierId = supplierId;
        this.skuId = skuId;
        this.supplierSkuCode = supplierSkuCode;
        this.status = status;
        this.preferred = preferred;
        this.leadTimeDays = leadTimeDays;
        this.unitPrice = unitPrice;
        this.currencyCode = currencyCode;
        this.minimumOrderQuantity = minimumOrderQuantity;
    }

    public void update(
            String supplierSkuCode,
            SupplierSkuMappingStatus status,
            boolean preferred,
            Integer leadTimeDays,
            BigDecimal unitPrice,
            String currencyCode,
            Long minimumOrderQuantity) {
        this.supplierSkuCode = supplierSkuCode;
        this.status = status;
        this.preferred = preferred;
        this.leadTimeDays = leadTimeDays;
        this.unitPrice = unitPrice;
        this.currencyCode = currencyCode;
        this.minimumOrderQuantity = minimumOrderQuantity;
    }

    public UUID getSupplierId() {
        return supplierId;
    }

    public UUID getSkuId() {
        return skuId;
    }

    public String getSupplierSkuCode() {
        return supplierSkuCode;
    }

    public SupplierSkuMappingStatus getStatus() {
        return status;
    }

    public boolean isPreferred() {
        return preferred;
    }

    public Integer getLeadTimeDays() {
        return leadTimeDays;
    }

    public BigDecimal getUnitPrice() {
        return unitPrice;
    }

    public String getCurrencyCode() {
        return currencyCode;
    }

    public Long getMinimumOrderQuantity() {
        return minimumOrderQuantity;
    }
}
