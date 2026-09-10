package cn.xzkj.erp.product.domain;

public final class ProductAuditActions {
    public static final String SPU_CREATED = "product_spu.created";
    public static final String SPU_UPDATED = "product_spu.updated";
    public static final String SPU_ARCHIVED = "product_spu.archived";
    public static final String SKU_CREATED = "product_sku.created";
    public static final String SKU_UPDATED = "product_sku.updated";
    public static final String SKU_WEIGHT_UPDATED = "product_sku.weight_updated";
    public static final String SKU_ARCHIVED = "product_sku.archived";
    public static final String LISTING_CREATED = "product_listing.created";
    public static final String LISTING_UPDATED = "product_listing.updated";
    public static final String LISTING_ARCHIVED = "product_listing.archived";
    public static final String CATEGORY_CREATED = "product_category.created";
    public static final String CATEGORY_UPDATED = "product_category.updated";
    public static final String CATEGORY_DELETED = "product_category.deleted";
    public static final String PACKAGE_MATERIAL_CREATED =
            "product_package_material.created";
    public static final String PACKAGE_MATERIAL_UPDATED =
            "product_package_material.updated";
    public static final String PACKAGE_MATERIAL_DELETED =
            "product_package_material.deleted";
    public static final String IMAGE_UPLOADED = "product_image.uploaded";
    public static final String IMAGE_UPDATED = "product_image.updated";
    public static final String IMAGE_REPLACED = "product_image.replaced";
    public static final String IMAGE_DELETED = "product_image.deleted";

    private ProductAuditActions() {
    }
}
