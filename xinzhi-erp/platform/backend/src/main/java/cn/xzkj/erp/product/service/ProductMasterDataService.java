package cn.xzkj.erp.product.service;

import static cn.xzkj.erp.product.domain.ProductAuditActions.CATEGORY_CREATED;
import static cn.xzkj.erp.product.domain.ProductAuditActions.CATEGORY_DELETED;
import static cn.xzkj.erp.product.domain.ProductAuditActions.CATEGORY_UPDATED;
import static cn.xzkj.erp.product.domain.ProductAuditActions.PACKAGE_MATERIAL_CREATED;
import static cn.xzkj.erp.product.domain.ProductAuditActions.PACKAGE_MATERIAL_DELETED;
import static cn.xzkj.erp.product.domain.ProductAuditActions.PACKAGE_MATERIAL_UPDATED;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Currency;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.product.domain.ProductCategory;
import cn.xzkj.erp.product.domain.ProductMasterDataStatus;
import cn.xzkj.erp.product.domain.ProductPackageMaterial;
import cn.xzkj.erp.product.repository.ProductCategoryRepository;
import cn.xzkj.erp.product.repository.ProductPackageMaterialRepository;
import cn.xzkj.erp.product.repository.ProductSpuRepository;

@Service
public class ProductMasterDataService {
    private static final int MAX_EXPORT_ROWS = 10_000;
    private static final String CSV_MEDIA_TYPE = "text/csv;charset=UTF-8";
    private static final List<String> CATEGORY_CSV_HEADER = List.of(
            "类目名称", "排序", "状态", "创建时间", "更新时间");
    private static final List<String> PACKAGE_MATERIAL_CSV_HEADER = List.of(
            "包材名称", "单价", "币种", "重量（克）", "包材层级",
            "长（毫米）", "宽（毫米）", "高（毫米）", "状态",
            "创建时间", "更新时间");

    private final ProductCategoryRepository categoryRepository;
    private final ProductPackageMaterialRepository packageRepository;
    private final ProductSpuRepository spuRepository;
    private final SecurityAuditRecorder auditRecorder;

    public ProductMasterDataService(
            ProductCategoryRepository categoryRepository,
            ProductPackageMaterialRepository packageRepository,
            ProductSpuRepository spuRepository,
            SecurityAuditRecorder auditRecorder) {
        this.categoryRepository = categoryRepository;
        this.packageRepository = packageRepository;
        this.spuRepository = spuRepository;
        this.auditRecorder = auditRecorder;
    }

    @Transactional(readOnly = true)
    public Page<ProductCategory> listCategories(
            UUID tenantId,
            ProductMasterDataStatus status,
            String query,
            Pageable pageable) {
        requireTenant(tenantId);
        String normalized = query(query);
        return categoryRepository.search(
                tenantId,
                status,
                normalized != null,
                normalized == null ? "" : normalized,
                pageable);
    }

    @Transactional(readOnly = true)
    public ProductCategoryExport exportCategoriesCsv(
            UUID tenantId,
            ProductMasterDataStatus status,
            String query) {
        Page<ProductCategory> page = listCategories(
                tenantId,
                status,
                query,
                PageRequest.of(0, MAX_EXPORT_ROWS + 1));
        if (page.getTotalElements() > MAX_EXPORT_ROWS
                || page.getNumberOfElements() > MAX_EXPORT_ROWS) {
            throw new ConflictException(
                    "Product category export exceeds the supported row limit");
        }
        return new ProductCategoryExport(
                "product-categories.csv",
                CSV_MEDIA_TYPE,
                page.getNumberOfElements(),
                categoryCsv(page.getContent()));
    }

    @Transactional(readOnly = true)
    public ProductCategory getCategory(UUID tenantId, UUID categoryId) {
        requireTenant(tenantId);
        return categoryRepository.findByIdAndTenantId(categoryId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Product category was not found"));
    }

    @Transactional
    public ProductCategory createCategory(
            ProductActor actor,
            String name,
            int sortOrder) {
        UUID tenantId = requireActor(actor);
        String normalizedName = name(name);
        requireSortOrder(sortOrder);
        if (categoryRepository.existsNormalizedName(
                tenantId,
                normalizedName.toLowerCase(Locale.ROOT),
                null)) {
            throw new ConflictException("Product category already exists");
        }
        try {
            ProductCategory saved = categoryRepository.save(
                    new ProductCategory(
                            tenantId,
                            normalizedName,
                            sortOrder));
            audit(actor, CATEGORY_CREATED, "product_category",
                    saved.getId(), saved.getVersion(), Map.of(
                            "status", saved.getStatus().name(),
                            "sortOrder", Integer.toString(saved.getSortOrder())));
            return saved;
        } catch (DataIntegrityViolationException concurrentDuplicate) {
            throw new ConflictException("Product category already exists");
        }
    }

    @Transactional
    public ProductCategory updateCategory(
            ProductActor actor,
            UUID categoryId,
            long expectedVersion,
            String name,
            int sortOrder,
            ProductMasterDataStatus status) {
        UUID tenantId = requireActor(actor);
        ProductCategory category = categoryRepository
                .findForUpdateByIdAndTenantId(categoryId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Product category was not found"));
        requireVersion(category.getVersion(), expectedVersion);
        String normalizedName = name(name);
        requireSortOrder(sortOrder);
        if (categoryRepository.existsNormalizedName(
                tenantId,
                normalizedName.toLowerCase(Locale.ROOT),
                categoryId)) {
            throw new ConflictException("Product category already exists");
        }
        category.update(
                normalizedName,
                sortOrder,
                requireStatus(status));
        try {
            ProductCategory saved = categoryRepository.save(category);
            audit(actor, CATEGORY_UPDATED, "product_category",
                    saved.getId(), expectedVersion + 1, Map.of(
                            "status", saved.getStatus().name(),
                            "sortOrder", Integer.toString(saved.getSortOrder())));
            return saved;
        } catch (DataIntegrityViolationException concurrentDuplicate) {
            throw new ConflictException("Product category already exists");
        }
    }

    @Transactional
    public void deleteCategory(
            ProductActor actor,
            UUID categoryId,
            long expectedVersion) {
        UUID tenantId = requireActor(actor);
        ProductCategory category = categoryRepository
                .findForUpdateByIdAndTenantId(categoryId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Product category was not found"));
        requireVersion(category.getVersion(), expectedVersion);
        if (spuRepository.existsByTenantIdAndCategoryId(
                tenantId,
                categoryId)) {
            throw new ConflictException(
                    "Referenced product categories cannot be deleted");
        }
        categoryRepository.delete(category);
        audit(actor, CATEGORY_DELETED, "product_category",
                categoryId, expectedVersion, Map.of());
    }

    @Transactional(readOnly = true)
    public Page<ProductPackageMaterial> listPackageMaterials(
            UUID tenantId,
            ProductMasterDataStatus status,
            String query,
            Pageable pageable) {
        requireTenant(tenantId);
        String normalized = query(query);
        return packageRepository.search(
                tenantId,
                status,
                normalized != null,
                normalized == null ? "" : normalized,
                pageable);
    }

    @Transactional(readOnly = true)
    public ProductPackageMaterialExport exportPackageMaterialsCsv(
            UUID tenantId,
            ProductMasterDataStatus status,
            String query) {
        Page<ProductPackageMaterial> page = listPackageMaterials(
                tenantId,
                status,
                query,
                PageRequest.of(0, MAX_EXPORT_ROWS + 1));
        if (page.getTotalElements() > MAX_EXPORT_ROWS
                || page.getNumberOfElements() > MAX_EXPORT_ROWS) {
            throw new ConflictException(
                    "Package material export exceeds the supported row limit");
        }
        return new ProductPackageMaterialExport(
                "product-package-materials.csv",
                CSV_MEDIA_TYPE,
                page.getNumberOfElements(),
                packageMaterialCsv(page.getContent()));
    }

    @Transactional(readOnly = true)
    public ProductPackageMaterial getPackageMaterial(
            UUID tenantId,
            UUID materialId) {
        requireTenant(tenantId);
        return packageRepository.findByIdAndTenantId(materialId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Product package material was not found"));
    }

    @Transactional
    public ProductPackageMaterial createPackageMaterial(
            ProductActor actor,
            PackageMaterialValues values) {
        UUID tenantId = requireActor(actor);
        PackageMaterialValues normalized = normalize(values);
        if (packageRepository.existsNormalizedName(
                tenantId,
                normalized.name().toLowerCase(Locale.ROOT),
                null)) {
            throw new ConflictException(
                    "Product package material already exists");
        }
        ProductPackageMaterial material = new ProductPackageMaterial(
                tenantId,
                normalized.name(),
                normalized.unitPrice(),
                normalized.currencyCode(),
                normalized.weightGrams(),
                normalized.packageLevel(),
                normalized.lengthMm(),
                normalized.widthMm(),
                normalized.heightMm(),
                actorType(actor),
                actorId(actor));
        try {
            ProductPackageMaterial saved = packageRepository.save(material);
            audit(actor, PACKAGE_MATERIAL_CREATED,
                    "product_package_material", saved.getId(),
                    saved.getVersion(), Map.of(
                            "status", saved.getStatus().name()));
            return saved;
        } catch (DataIntegrityViolationException concurrentDuplicate) {
            throw new ConflictException(
                    "Product package material already exists");
        }
    }

    @Transactional
    public ProductPackageMaterial updatePackageMaterial(
            ProductActor actor,
            UUID materialId,
            long expectedVersion,
            PackageMaterialValues values,
            ProductMasterDataStatus status) {
        UUID tenantId = requireActor(actor);
        ProductPackageMaterial material = packageRepository
                .findForUpdateByIdAndTenantId(materialId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Product package material was not found"));
        requireVersion(material.getVersion(), expectedVersion);
        PackageMaterialValues normalized = normalize(values);
        if (packageRepository.existsNormalizedName(
                tenantId,
                normalized.name().toLowerCase(Locale.ROOT),
                materialId)) {
            throw new ConflictException(
                    "Product package material already exists");
        }
        material.update(
                normalized.name(),
                normalized.unitPrice(),
                normalized.currencyCode(),
                normalized.weightGrams(),
                normalized.packageLevel(),
                normalized.lengthMm(),
                normalized.widthMm(),
                normalized.heightMm(),
                requireStatus(status));
        try {
            ProductPackageMaterial saved = packageRepository.save(material);
            audit(actor, PACKAGE_MATERIAL_UPDATED,
                    "product_package_material", saved.getId(),
                    expectedVersion + 1, Map.of(
                            "status", saved.getStatus().name()));
            return saved;
        } catch (DataIntegrityViolationException concurrentDuplicate) {
            throw new ConflictException(
                    "Product package material already exists");
        }
    }

    @Transactional
    public void deletePackageMaterial(
            ProductActor actor,
            UUID materialId,
            long expectedVersion) {
        UUID tenantId = requireActor(actor);
        ProductPackageMaterial material = packageRepository
                .findForUpdateByIdAndTenantId(materialId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Product package material was not found"));
        requireVersion(material.getVersion(), expectedVersion);
        if (spuRepository.existsByTenantIdAndPackageMaterialId(
                tenantId,
                materialId)) {
            throw new ConflictException(
                    "Referenced package materials cannot be deleted");
        }
        packageRepository.delete(material);
        audit(actor, PACKAGE_MATERIAL_DELETED,
                "product_package_material", materialId,
                expectedVersion, Map.of());
    }

    private static PackageMaterialValues normalize(
            PackageMaterialValues values) {
        if (values == null) {
            throw new IllegalArgumentException(
                    "Package material values are required");
        }
        String normalizedName = name(values.name());
        BigDecimal price = price(values.unitPriceText());
        String currency = currency(values.currencyCode());
        if ((price == null) != (currency == null)) {
            throw new IllegalArgumentException(
                    "unitPrice and currencyCode must be provided together");
        }
        boolean hasAnyDimension = values.lengthMm() != null
                || values.widthMm() != null
                || values.heightMm() != null;
        boolean hasAllDimensions = values.lengthMm() != null
                && values.widthMm() != null
                && values.heightMm() != null;
        if (hasAnyDimension && !hasAllDimensions) {
            throw new IllegalArgumentException(
                    "lengthMm, widthMm, and heightMm must be provided together");
        }
        range(values.weightGrams(), 1, 1_000_000_000L, "weightGrams");
        range(values.packageLevel(), 1, 100, "packageLevel");
        range(values.lengthMm(), 1, 1_000_000L, "lengthMm");
        range(values.widthMm(), 1, 1_000_000L, "widthMm");
        range(values.heightMm(), 1, 1_000_000L, "heightMm");
        return new PackageMaterialValues(
                normalizedName,
                price == null ? null : price.toPlainString(),
                currency,
                values.weightGrams(),
                values.packageLevel(),
                values.lengthMm(),
                values.widthMm(),
                values.heightMm());
    }

    private static BigDecimal price(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        if (!value.matches(
                "(0|[1-9][0-9]{0,9})(\\.[0-9]{1,4})?")) {
            throw new IllegalArgumentException(
                    "unitPrice must be an exact decimal string");
        }
        BigDecimal price = new BigDecimal(value);
        if (price.scale() > 4
                || price.compareTo(BigDecimal.ZERO) < 0
                || price.compareTo(
                        new BigDecimal("9999999999.9999")) > 0) {
            throw new IllegalArgumentException("unitPrice is out of range");
        }
        return price.setScale(4, RoundingMode.UNNECESSARY);
    }

    private static String currency(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String code = value.trim().toUpperCase(Locale.ROOT);
        if (!code.matches("[A-Z]{3}")) {
            throw new IllegalArgumentException("currencyCode is invalid");
        }
        try {
            Currency.getInstance(code);
        } catch (IllegalArgumentException invalid) {
            throw new IllegalArgumentException("currencyCode is invalid");
        }
        return code;
    }

    private void audit(
            ProductActor actor,
            String action,
            String resourceType,
            UUID resourceId,
            long version,
            Map<String, String> facts) {
        var details = new java.util.LinkedHashMap<String, String>();
        details.put("version", Long.toString(version));
        details.putAll(facts);
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(),
                actor.userId(),
                actor.systemAdminId(),
                action,
                resourceType,
                resourceId.toString(),
                actor.requestId(),
                actor.sourceIp(),
                details));
    }

    private static UUID requireActor(ProductActor actor) {
        if (actor == null) {
            throw new IllegalArgumentException("Actor is required");
        }
        requireTenant(actor.tenantId());
        if ((actor.userId() == null) == (actor.systemAdminId() == null)) {
            throw new IllegalArgumentException(
                    "Exactly one actor identity is required");
        }
        return actor.tenantId();
    }

    private static UUID actorId(ProductActor actor) {
        return actor.userId() != null
                ? actor.userId()
                : actor.systemAdminId();
    }

    private static String actorType(ProductActor actor) {
        return actor.userId() != null ? "TENANT_USER" : "SYSTEM_ADMIN";
    }

    private static void requireTenant(UUID tenantId) {
        if (tenantId == null) {
            throw new IllegalArgumentException("Tenant ID is required");
        }
    }

    private static void requireVersion(long actual, long expected) {
        if (expected < 0 || actual != expected) {
            throw new ConflictException("The resource has changed");
        }
    }

    private static ProductMasterDataStatus requireStatus(
            ProductMasterDataStatus status) {
        if (status == null) {
            throw new IllegalArgumentException("Status is required");
        }
        return status;
    }

    private static void requireSortOrder(int sortOrder) {
        if (sortOrder < 0 || sortOrder > 1_000_000) {
            throw new IllegalArgumentException("sortOrder is out of range");
        }
    }

    private static String name(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Name is required");
        }
        String normalized = value.trim();
        if (normalized.length() > 200) {
            throw new IllegalArgumentException("Name is too long");
        }
        return normalized;
    }

    private static String query(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String normalized = value.trim();
        if (normalized.length() > 100) {
            throw new IllegalArgumentException("Query is too long");
        }
        return normalized.toLowerCase(Locale.ROOT);
    }

    private static String categoryCsv(List<ProductCategory> categories) {
        StringBuilder output = new StringBuilder("\uFEFF");
        appendCsvRow(output, CATEGORY_CSV_HEADER);
        for (ProductCategory category : categories) {
            appendCsvRow(output, List.of(
                    category.getName(),
                    Integer.toString(category.getSortOrder()),
                    statusLabel(category.getStatus()),
                    category.getCreatedAt().toString(),
                    category.getUpdatedAt().toString()));
        }
        return output.toString();
    }

    private static String packageMaterialCsv(
            List<ProductPackageMaterial> materials) {
        StringBuilder output = new StringBuilder("\uFEFF");
        appendCsvRow(output, PACKAGE_MATERIAL_CSV_HEADER);
        for (ProductPackageMaterial material : materials) {
            appendCsvRow(output, List.of(
                    material.getName(),
                    value(material.getUnitPrice()),
                    value(material.getCurrencyCode()),
                    value(material.getWeightGrams()),
                    value(material.getPackageLevel()),
                    value(material.getLengthMm()),
                    value(material.getWidthMm()),
                    value(material.getHeightMm()),
                    statusLabel(material.getStatus()),
                    material.getCreatedAt().toString(),
                    material.getUpdatedAt().toString()));
        }
        return output.toString();
    }

    private static String value(Object value) {
        return value == null ? "" : value.toString();
    }

    private static void appendCsvRow(StringBuilder output, List<String> cells) {
        for (int index = 0; index < cells.size(); index++) {
            if (index > 0) output.append(',');
            output.append(csvCell(cells.get(index)));
        }
        output.append("\r\n");
    }

    private static String csvCell(String value) {
        String safe = value == null ? "" : value;
        String stripped = safe.stripLeading();
        if (!stripped.isEmpty() && "=+-@".indexOf(stripped.charAt(0)) >= 0) {
            safe = "'" + safe;
        }
        if (safe.indexOf(',') >= 0 || safe.indexOf('"') >= 0
                || safe.indexOf('\r') >= 0 || safe.indexOf('\n') >= 0) {
            return '"' + safe.replace("\"", "\"\"") + '"';
        }
        return safe;
    }

    private static String statusLabel(ProductMasterDataStatus status) {
        return switch (status) {
            case ACTIVE -> "启用";
            case INACTIVE -> "停用";
            case ARCHIVED -> "已归档";
        };
    }

    private static void range(
            Number value,
            long minimum,
            long maximum,
            String field) {
        if (value != null
                && (value.longValue() < minimum
                || value.longValue() > maximum)) {
            throw new IllegalArgumentException(field + " is out of range");
        }
    }

    public record PackageMaterialValues(
            String name,
            String unitPriceText,
            String currencyCode,
            Long weightGrams,
            Integer packageLevel,
            Long lengthMm,
            Long widthMm,
            Long heightMm) {
        public BigDecimal unitPrice() {
            return price(unitPriceText);
        }
    }

    public record ProductCategoryExport(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }

    public record ProductPackageMaterialExport(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }
}
