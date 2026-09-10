package cn.xzkj.erp.product.domain;

import java.util.UUID;

import cn.xzkj.erp.platform.domain.TenantOwnedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;

@Entity
@Table(name = "tenant_product_categories")
public class ProductCategory extends TenantOwnedEntity {

    @Column(nullable = false, length = 200)
    private String name;

    @Column(name = "sort_order", nullable = false)
    private int sortOrder;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 24)
    private ProductMasterDataStatus status;

    protected ProductCategory() {
    }

    public ProductCategory(UUID tenantId, String name, int sortOrder) {
        super(tenantId);
        this.name = name;
        this.sortOrder = sortOrder;
        this.status = ProductMasterDataStatus.ACTIVE;
    }

    public void update(
            String name,
            int sortOrder,
            ProductMasterDataStatus status) {
        this.name = name;
        this.sortOrder = sortOrder;
        this.status = status;
    }

    public String getName() {
        return name;
    }

    public int getSortOrder() {
        return sortOrder;
    }

    public ProductMasterDataStatus getStatus() {
        return status;
    }
}
