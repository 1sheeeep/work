package cn.xzkj.erp.product.api;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonAnySetter;

import cn.xzkj.erp.product.domain.ProductCategory;
import cn.xzkj.erp.product.domain.ProductMasterDataStatus;
import cn.xzkj.erp.product.domain.ProductPackageMaterial;
import cn.xzkj.erp.product.service.ProductMasterDataService.PackageMaterialValues;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public final class ProductMasterDataDtos {
    private ProductMasterDataDtos() {
    }

    public record CreateCategoryRequest(
            @NotBlank @Size(max = 200) String name,
            @Min(0) @Max(1_000_000) int sortOrder) {
        @JsonAnySetter
        public void rejectUnknownField(String field, Object value) {
            throw new IllegalArgumentException(
                    "Unknown product category request field");
        }
    }

    public record UpdateCategoryRequest(
            @NotNull @Min(0) Long version,
            @NotBlank @Size(max = 200) String name,
            @Min(0) @Max(1_000_000) int sortOrder,
            @NotNull ProductMasterDataStatus status) {
        @JsonAnySetter
        public void rejectUnknownField(String field, Object value) {
            throw new IllegalArgumentException(
                    "Unknown product category request field");
        }
    }

    public record CategoryExportRequest(
            ProductMasterDataStatus status,
            @Size(max = 100) String query) {
        @JsonAnySetter
        public void rejectUnknownField(String field, Object value) {
            throw new IllegalArgumentException(
                    "Unknown product category export request field");
        }
    }

    public record CategoryExportResponse(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }

    public record CategoryResponse(
            UUID id,
            String name,
            int sortOrder,
            ProductMasterDataStatus status,
            Instant createdAt,
            Instant updatedAt,
            long version) {
        static CategoryResponse from(ProductCategory category) {
            return new CategoryResponse(
                    category.getId(),
                    category.getName(),
                    category.getSortOrder(),
                    category.getStatus(),
                    category.getCreatedAt(),
                    category.getUpdatedAt(),
                    category.getVersion());
        }
    }

    public record AssignableMemberResponse(UUID id, String displayName) {
    }

    public record CreatePackageMaterialRequest(
            @NotBlank @Size(max = 200) String name,
            @Pattern(regexp =
                    "(0|[1-9][0-9]{0,9})(\\.[0-9]{1,4})?")
                    String unitPrice,
            @Pattern(regexp = "[A-Za-z]{3}") String currencyCode,
            @Min(1) @Max(1_000_000_000L) Long weightGrams,
            @Min(1) @Max(100) Integer level,
            @Min(1) @Max(1_000_000) Long lengthMm,
            @Min(1) @Max(1_000_000) Long widthMm,
            @Min(1) @Max(1_000_000) Long heightMm) {
        @JsonAnySetter
        public void rejectUnknownField(String field, Object value) {
            throw new IllegalArgumentException(
                    "Unknown package material request field");
        }

        PackageMaterialValues values() {
            return new PackageMaterialValues(
                    name,
                    unitPrice,
                    currencyCode,
                    weightGrams,
                    level,
                    lengthMm,
                    widthMm,
                    heightMm);
        }
    }

    public record UpdatePackageMaterialRequest(
            @NotNull @Min(0) Long version,
            @NotBlank @Size(max = 200) String name,
            @Pattern(regexp =
                    "(0|[1-9][0-9]{0,9})(\\.[0-9]{1,4})?")
                    String unitPrice,
            @Pattern(regexp = "[A-Za-z]{3}") String currencyCode,
            @Min(1) @Max(1_000_000_000L) Long weightGrams,
            @Min(1) @Max(100) Integer level,
            @Min(1) @Max(1_000_000) Long lengthMm,
            @Min(1) @Max(1_000_000) Long widthMm,
            @Min(1) @Max(1_000_000) Long heightMm,
            @NotNull ProductMasterDataStatus status) {
        @JsonAnySetter
        public void rejectUnknownField(String field, Object value) {
            throw new IllegalArgumentException(
                    "Unknown package material request field");
        }

        PackageMaterialValues values() {
            return new PackageMaterialValues(
                    name,
                    unitPrice,
                    currencyCode,
                    weightGrams,
                    level,
                    lengthMm,
                    widthMm,
                    heightMm);
        }
    }

    public record PackageMaterialResponse(
            UUID id,
            String name,
            String unitPrice,
            String currencyCode,
            Long weightGrams,
            Integer level,
            Long lengthMm,
            Long widthMm,
            Long heightMm,
            ProductMasterDataStatus status,
            String createdByType,
            UUID createdBy,
            Instant createdAt,
            Instant updatedAt,
            long version) {
        static PackageMaterialResponse from(
                ProductPackageMaterial material) {
            return new PackageMaterialResponse(
                    material.getId(),
                    material.getName(),
                    material.getUnitPrice() == null
                            ? null
                            : material.getUnitPrice().toPlainString(),
                    material.getCurrencyCode(),
                    material.getWeightGrams(),
                    material.getPackageLevel(),
                    material.getLengthMm(),
                    material.getWidthMm(),
                    material.getHeightMm(),
                    material.getStatus(),
                    material.getCreatedByType(),
                    material.getCreatedBy(),
                    material.getCreatedAt(),
                    material.getUpdatedAt(),
                    material.getVersion());
        }
    }

    public record PackageMaterialExportRequest(
            ProductMasterDataStatus status,
            @Size(max = 100) String query) {
        @JsonAnySetter
        public void rejectUnknownField(String field, Object value) {
            throw new IllegalArgumentException(
                    "Unknown package material export request field");
        }
    }

    public record PackageMaterialExportResponse(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }
}
