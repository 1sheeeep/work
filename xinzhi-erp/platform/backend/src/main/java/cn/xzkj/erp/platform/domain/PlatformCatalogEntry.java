package cn.xzkj.erp.platform.domain;

import java.util.Locale;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;

@Entity
@Table(name = "platform_catalog")
public class PlatformCatalogEntry extends SystemManagedEntity {

    @Column(nullable = false, length = 32)
    private String code;

    @Column(name = "display_name", nullable = false, length = 160)
    private String displayName;

    @Column(length = 500)
    private String description;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 24)
    private PlatformStatus status;

    protected PlatformCatalogEntry() {
    }

    public PlatformCatalogEntry(String code, String displayName, String description) {
        this.code = code.toUpperCase(Locale.ROOT);
        this.displayName = displayName;
        this.description = description;
        this.status = PlatformStatus.ACTIVE;
    }

    public void archive() {
        status = PlatformStatus.ARCHIVED;
    }

    public String getCode() {
        return code;
    }

    public String getDisplayName() {
        return displayName;
    }

    public String getDescription() {
        return description;
    }

    public PlatformStatus getStatus() {
        return status;
    }
}
