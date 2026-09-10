package cn.xzkj.erp.product.domain;

import java.util.UUID;

import cn.xzkj.erp.platform.domain.TenantOwnedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

@Entity
@Table(name = "tenant_product_spu_images")
public class ProductSpuImage extends TenantOwnedEntity {

    @Column(name = "spu_id", nullable = false, updatable = false)
    private UUID spuId;

    @Column(name = "object_key", nullable = false, length = 64)
    private String objectKey;

    @Column(name = "content_type", nullable = false, length = 20)
    private String contentType;

    @Column(name = "file_extension", nullable = false, length = 5)
    private String fileExtension;

    @Column(name = "byte_size", nullable = false)
    private long byteSize;

    @Column(nullable = false, length = 64)
    private String sha256;

    @Column(name = "pixel_width", nullable = false)
    private int pixelWidth;

    @Column(name = "pixel_height", nullable = false)
    private int pixelHeight;

    @Column(name = "sort_order", nullable = false)
    private int sortOrder;

    @Column(name = "primary_image", nullable = false)
    private boolean primaryImage;

    @Column(name = "created_by_type", nullable = false, updatable = false,
            length = 24)
    private String createdByType;

    @Column(name = "created_by", nullable = false, updatable = false)
    private UUID createdBy;

    protected ProductSpuImage() {
    }

    public ProductSpuImage(
            UUID tenantId,
            UUID spuId,
            StoredImage stored,
            int sortOrder,
            boolean primaryImage,
            String createdByType,
            UUID createdBy) {
        super(tenantId);
        this.spuId = spuId;
        replace(stored);
        this.sortOrder = sortOrder;
        this.primaryImage = primaryImage;
        this.createdByType = createdByType;
        this.createdBy = createdBy;
    }

    public void replace(StoredImage stored) {
        this.objectKey = stored.objectKey();
        this.contentType = stored.contentType();
        this.fileExtension = stored.fileExtension();
        this.byteSize = stored.byteSize();
        this.sha256 = stored.sha256();
        this.pixelWidth = stored.pixelWidth();
        this.pixelHeight = stored.pixelHeight();
    }

    public void updatePresentation(int sortOrder, boolean primaryImage) {
        this.sortOrder = sortOrder;
        this.primaryImage = primaryImage;
    }

    public UUID getSpuId() { return spuId; }
    public String getObjectKey() { return objectKey; }
    public String getContentType() { return contentType; }
    public String getFileExtension() { return fileExtension; }
    public long getByteSize() { return byteSize; }
    public String getSha256() { return sha256; }
    public int getPixelWidth() { return pixelWidth; }
    public int getPixelHeight() { return pixelHeight; }
    public int getSortOrder() { return sortOrder; }
    public boolean isPrimaryImage() { return primaryImage; }
    public String getCreatedByType() { return createdByType; }
    public UUID getCreatedBy() { return createdBy; }

    public record StoredImage(
            String objectKey,
            String contentType,
            String fileExtension,
            long byteSize,
            String sha256,
            int pixelWidth,
            int pixelHeight) {
    }
}
