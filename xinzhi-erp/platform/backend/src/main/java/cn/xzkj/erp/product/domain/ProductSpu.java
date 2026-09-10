package cn.xzkj.erp.product.domain;

import java.util.UUID;

import cn.xzkj.erp.platform.domain.TenantOwnedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;

@Entity
@Table(name = "tenant_product_spus")
public class ProductSpu extends TenantOwnedEntity {

    @Column(nullable = false, length = 64)
    private String businessCode;

    @Column(nullable = false, length = 200)
    private String name;

    @Column(name = "name_zh", nullable = false, length = 200)
    private String nameZh;

    @Column(name = "name_en", length = 200)
    private String nameEn;

    @Column(name = "brand_name", length = 160)
    private String brandName;

    @Column(name = "product_note", length = 2000)
    private String productNote;

    @Column(name = "category_id")
    private UUID categoryId;

    @Column(name = "category_name_snapshot", length = 200)
    private String categoryNameSnapshot;

    @Column(name = "length_mm")
    private Long lengthMm;

    @Column(name = "width_mm")
    private Long widthMm;

    @Column(name = "height_mm")
    private Long heightMm;

    @Column(name = "actual_weight_grams")
    private Long actualWeightGrams;

    @Column(name = "volumetric_divisor", nullable = false)
    private int volumetricDivisor;

    @Column(name = "package_material_id")
    private UUID packageMaterialId;

    @Column(name = "package_material_name_snapshot", length = 200)
    private String packageMaterialNameSnapshot;

    @Column(name = "packageable_count")
    private Integer packageableCount;

    @Column(name = "art_member_id")
    private UUID artMemberId;

    @Column(name = "art_member_name_snapshot", length = 160)
    private String artMemberNameSnapshot;

    @Column(name = "developer_member_id")
    private UUID developerMemberId;

    @Column(name = "developer_member_name_snapshot", length = 160)
    private String developerMemberNameSnapshot;

    @Column(name = "developer_assistant_member_id")
    private UUID developerAssistantMemberId;

    @Column(name = "developer_assistant_member_name_snapshot", length = 160)
    private String developerAssistantMemberNameSnapshot;

    @Column(name = "sales_member_id")
    private UUID salesMemberId;

    @Column(name = "sales_member_name_snapshot", length = 160)
    private String salesMemberNameSnapshot;

    @Column(name = "sensitive_attributes_revision", nullable = false)
    private long sensitiveAttributesRevision;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 24)
    private ProductStatus status;

    protected ProductSpu() {
    }

    public ProductSpu(
            UUID tenantId,
            String businessCode,
            String name,
            String brandName,
            String productNote) {
        this(tenantId, businessCode, name, null, brandName, productNote,
                null, null, null, null, null, 5000,
                null, null, null,
                null, null, null, null,
                null, null, null, null, null);
    }

    public ProductSpu(
            UUID tenantId,
            String businessCode,
            String nameZh,
            String nameEn,
            String brandName,
            String productNote,
            UUID categoryId,
            String categoryNameSnapshot,
            Long lengthMm,
            Long widthMm,
            Long heightMm,
            int volumetricDivisor,
            Long actualWeightGrams,
            UUID packageMaterialId,
            String packageMaterialNameSnapshot,
            Integer packageableCount,
            UUID artMemberId,
            String artMemberNameSnapshot,
            UUID developerMemberId,
            String developerMemberNameSnapshot,
            UUID developerAssistantMemberId,
            String developerAssistantMemberNameSnapshot,
            UUID salesMemberId,
            String salesMemberNameSnapshot) {
        super(tenantId);
        this.businessCode = businessCode;
        this.name = nameZh;
        this.nameZh = nameZh;
        this.nameEn = nameEn;
        this.brandName = brandName;
        this.productNote = productNote;
        updateMasterData(
                categoryId,
                categoryNameSnapshot,
                lengthMm,
                widthMm,
                heightMm,
                actualWeightGrams,
                volumetricDivisor,
                packageMaterialId,
                packageMaterialNameSnapshot,
                packageableCount,
                artMemberId,
                artMemberNameSnapshot,
                developerMemberId,
                developerMemberNameSnapshot,
                developerAssistantMemberId,
                developerAssistantMemberNameSnapshot,
                salesMemberId,
                salesMemberNameSnapshot);
        this.sensitiveAttributesRevision = 0;
        this.status = ProductStatus.ACTIVE;
    }

    public void update(
            String nameZh,
            String nameEn,
            String brandName,
            String productNote,
            ProductStatus status,
            UUID categoryId,
            String categoryNameSnapshot,
            Long lengthMm,
            Long widthMm,
            Long heightMm,
            Long actualWeightGrams,
            int volumetricDivisor,
            UUID packageMaterialId,
            String packageMaterialNameSnapshot,
            Integer packageableCount,
            UUID artMemberId,
            String artMemberNameSnapshot,
            UUID developerMemberId,
            String developerMemberNameSnapshot,
            UUID developerAssistantMemberId,
            String developerAssistantMemberNameSnapshot,
            UUID salesMemberId,
            String salesMemberNameSnapshot) {
        this.name = nameZh;
        this.nameZh = nameZh;
        this.nameEn = nameEn;
        this.brandName = brandName;
        this.productNote = productNote;
        this.status = status;
        updateMasterData(
                categoryId,
                categoryNameSnapshot,
                lengthMm,
                widthMm,
                heightMm,
                actualWeightGrams,
                volumetricDivisor,
                packageMaterialId,
                packageMaterialNameSnapshot,
                packageableCount,
                artMemberId,
                artMemberNameSnapshot,
                developerMemberId,
                developerMemberNameSnapshot,
                developerAssistantMemberId,
                developerAssistantMemberNameSnapshot,
                salesMemberId,
                salesMemberNameSnapshot);
    }

    private void updateMasterData(
            UUID categoryId,
            String categoryNameSnapshot,
            Long lengthMm,
            Long widthMm,
            Long heightMm,
            Long actualWeightGrams,
            int volumetricDivisor,
            UUID packageMaterialId,
            String packageMaterialNameSnapshot,
            Integer packageableCount,
            UUID artMemberId,
            String artMemberNameSnapshot,
            UUID developerMemberId,
            String developerMemberNameSnapshot,
            UUID developerAssistantMemberId,
            String developerAssistantMemberNameSnapshot,
            UUID salesMemberId,
            String salesMemberNameSnapshot) {
        this.categoryId = categoryId;
        this.categoryNameSnapshot = categoryNameSnapshot;
        this.lengthMm = lengthMm;
        this.widthMm = widthMm;
        this.heightMm = heightMm;
        this.actualWeightGrams = actualWeightGrams;
        this.volumetricDivisor = volumetricDivisor;
        this.packageMaterialId = packageMaterialId;
        this.packageMaterialNameSnapshot = packageMaterialNameSnapshot;
        this.packageableCount = packageableCount;
        this.artMemberId = artMemberId;
        this.artMemberNameSnapshot = artMemberNameSnapshot;
        this.developerMemberId = developerMemberId;
        this.developerMemberNameSnapshot = developerMemberNameSnapshot;
        this.developerAssistantMemberId = developerAssistantMemberId;
        this.developerAssistantMemberNameSnapshot =
                developerAssistantMemberNameSnapshot;
        this.salesMemberId = salesMemberId;
        this.salesMemberNameSnapshot = salesMemberNameSnapshot;
    }

    public void archive() {
        status = ProductStatus.ARCHIVED;
    }

    public void changeStatus(ProductStatus nextStatus) {
        if (nextStatus == null || nextStatus == ProductStatus.ARCHIVED) {
            throw new IllegalArgumentException("A non-archived product status is required");
        }
        status = nextStatus;
    }

    public void markSensitiveAttributesChanged() {
        sensitiveAttributesRevision = Math.incrementExact(
                sensitiveAttributesRevision);
    }

    public String getBusinessCode() { return businessCode; }
    public String getName() { return name; }
    public String getNameZh() { return nameZh; }
    public String getNameEn() { return nameEn; }
    public String getBrandName() { return brandName; }
    public String getProductNote() { return productNote; }
    public UUID getCategoryId() { return categoryId; }
    public String getCategoryNameSnapshot() { return categoryNameSnapshot; }
    public Long getLengthMm() { return lengthMm; }
    public Long getWidthMm() { return widthMm; }
    public Long getHeightMm() { return heightMm; }
    public Long getActualWeightGrams() { return actualWeightGrams; }
    public int getVolumetricDivisor() { return volumetricDivisor; }
    public UUID getPackageMaterialId() { return packageMaterialId; }
    public String getPackageMaterialNameSnapshot() {
        return packageMaterialNameSnapshot;
    }
    public Integer getPackageableCount() { return packageableCount; }
    public UUID getArtMemberId() { return artMemberId; }
    public String getArtMemberNameSnapshot() { return artMemberNameSnapshot; }
    public UUID getDeveloperMemberId() { return developerMemberId; }
    public String getDeveloperMemberNameSnapshot() {
        return developerMemberNameSnapshot;
    }
    public UUID getDeveloperAssistantMemberId() {
        return developerAssistantMemberId;
    }
    public String getDeveloperAssistantMemberNameSnapshot() {
        return developerAssistantMemberNameSnapshot;
    }
    public UUID getSalesMemberId() { return salesMemberId; }
    public String getSalesMemberNameSnapshot() {
        return salesMemberNameSnapshot;
    }
    public long getSensitiveAttributesRevision() {
        return sensitiveAttributesRevision;
    }
    public ProductStatus getStatus() { return status; }
}
