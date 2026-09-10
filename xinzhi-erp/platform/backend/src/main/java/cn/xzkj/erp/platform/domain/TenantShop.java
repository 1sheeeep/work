package cn.xzkj.erp.platform.domain;

import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;

@Entity
@Table(name = "tenant_shops")
public class TenantShop extends TenantOwnedEntity {

    @Column(name = "platform_id", nullable = false, updatable = false)
    private UUID platformId;

    @Column(name = "external_shop_ref", nullable = false, length = 160)
    private String externalShopRef;

    @Column(name = "display_name", nullable = false, length = 160)
    private String displayName;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 24)
    private ShopStatus status;

    protected TenantShop() {
    }

    public TenantShop(UUID tenantId, UUID platformId, String externalShopRef, String displayName) {
        super(tenantId);
        this.platformId = platformId;
        this.externalShopRef = externalShopRef;
        this.displayName = displayName;
        this.status = ShopStatus.ACTIVE;
    }

    public void archive() {
        status = ShopStatus.ARCHIVED;
    }

    public void update(String externalShopRef, String displayName, ShopStatus status) {
        this.externalShopRef = externalShopRef;
        this.displayName = displayName;
        this.status = status;
    }

    public UUID getPlatformId() {
        return platformId;
    }

    public String getExternalShopRef() {
        return externalShopRef;
    }

    public String getDisplayName() {
        return displayName;
    }

    public ShopStatus getStatus() {
        return status;
    }
}
