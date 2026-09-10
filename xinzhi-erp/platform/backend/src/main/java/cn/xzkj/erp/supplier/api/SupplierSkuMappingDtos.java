package cn.xzkj.erp.supplier.api;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonAnySetter;

import cn.xzkj.erp.supplier.domain.SupplierSkuMapping;
import cn.xzkj.erp.supplier.domain.SupplierSkuMappingStatus;
import cn.xzkj.erp.supplier.service.PreferredSupplierSkuSummary;
import cn.xzkj.erp.supplier.service.SupplierSkuMappingSummary;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public final class SupplierSkuMappingDtos {
    private SupplierSkuMappingDtos() {
    }

    public record CreateMappingRequest(
            @NotNull UUID skuId,
            @Size(max = 120) String supplierSkuCode,
            @NotNull SupplierSkuMappingStatus status,
            @NotNull Boolean preferred,
            @Min(0) @Max(3650) Integer leadTimeDays,
            @DecimalMin("0.0001") @DecimalMax("999999999999999.9999")
            @Digits(integer = 15, fraction = 4) BigDecimal unitPrice,
            @Pattern(regexp = "(?i)[A-Z]{3}") String currencyCode,
            @Min(1) @Max(1_000_000_000) Long minimumOrderQuantity) {

        @JsonAnySetter
        public void rejectUnknownField(String field, Object value) {
            throw new IllegalArgumentException(
                    "Unknown supplier SKU mapping request field");
        }
    }

    public record UpdateMappingRequest(
            @NotNull @Min(0) Long version,
            @NotNull UUID skuId,
            @Size(max = 120) String supplierSkuCode,
            @NotNull SupplierSkuMappingStatus status,
            @NotNull Boolean preferred,
            @Min(0) @Max(3650) Integer leadTimeDays,
            @DecimalMin("0.0001") @DecimalMax("999999999999999.9999")
            @Digits(integer = 15, fraction = 4) BigDecimal unitPrice,
            @Pattern(regexp = "(?i)[A-Z]{3}") String currencyCode,
            @Min(1) @Max(1_000_000_000) Long minimumOrderQuantity) {

        @JsonAnySetter
        public void rejectUnknownField(String field, Object value) {
            throw new IllegalArgumentException(
                    "Unknown supplier SKU mapping request field");
        }
    }

    public record MappingResponse(
            UUID id,
            UUID supplierId,
            UUID skuId,
            String supplierSkuCode,
            SupplierSkuMappingStatus status,
            boolean preferred,
            Integer leadTimeDays,
            BigDecimal unitPrice,
            String currencyCode,
            Long minimumOrderQuantity,
            String skuBusinessCode,
            String skuName,
            Instant createdAt,
            Instant updatedAt,
            long version) {

        static MappingResponse from(SupplierSkuMappingSummary summary) {
            SupplierSkuMapping mapping = summary.mapping();
            return new MappingResponse(
                    mapping.getId(), mapping.getSupplierId(), mapping.getSkuId(),
                    mapping.getSupplierSkuCode(), mapping.getStatus(),
                    mapping.isPreferred(), mapping.getLeadTimeDays(),
                    mapping.getUnitPrice(), mapping.getCurrencyCode(),
                    mapping.getMinimumOrderQuantity(), summary.skuBusinessCode(),
                    summary.skuName(), mapping.getCreatedAt(),
                    mapping.getUpdatedAt(), mapping.getVersion());
        }
    }

    public record PreferredSupplierResponse(
            UUID skuId,
            String supplierSkuCode,
            UUID supplierId,
            String supplierBusinessCode,
            String supplierName) {
        static PreferredSupplierResponse from(
                PreferredSupplierSkuSummary source) {
            return new PreferredSupplierResponse(
                    source.skuId(), source.supplierSkuCode(),
                    source.supplierId(), source.supplierBusinessCode(),
                    source.supplierName());
        }
    }

    public record PreferredSupplierSummariesResponse(
            List<PreferredSupplierResponse> items) {
        public PreferredSupplierSummariesResponse {
            items = List.copyOf(items);
        }
    }
}
