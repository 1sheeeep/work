package cn.xzkj.erp.supplier.api;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonAnySetter;

import cn.xzkj.erp.supplier.domain.Supplier;
import cn.xzkj.erp.supplier.domain.SupplierStatus;
import cn.xzkj.erp.supplier.api.SupplierSkuMappingDtos.CreateMappingRequest;
import cn.xzkj.erp.supplier.api.SupplierSkuMappingDtos.MappingResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public final class SupplierDtos {
    public static final String BUSINESS_CODE_PATTERN =
            "(?i)[A-Z][A-Z0-9_-]{1,63}";

    private SupplierDtos() {
    }

    public record CreateSupplierRequest(
            @NotBlank
            @Pattern(regexp = BUSINESS_CODE_PATTERN)
            String businessCode,
            @NotBlank
            @Size(max = 200)
            String name,
            @Size(max = 120)
            String contactName,
            @Size(max = 40)
            String contactPhone,
            @Email
            @Size(max = 254)
            String contactEmail,
            @Size(max = 500)
            String address,
            @Size(max = 120)
            String taxRegistrationNumber,
            @Pattern(regexp = "(?i)[A-Z]{3}")
            String settlementCurrency,
            @Min(0) @Max(3650)
            Integer paymentTermsDays,
            @Size(max = 2000)
            String notes) {
        @JsonAnySetter
        public void rejectUnknownField(String field, Object value) {
            throw new IllegalArgumentException("Unknown supplier request field");
        }
    }

    public record UpdateSupplierRequest(
            @NotNull @Min(0) Long version,
            @NotBlank
            @Pattern(regexp = BUSINESS_CODE_PATTERN)
            String businessCode,
            @NotBlank
            @Size(max = 200)
            String name,
            @NotNull SupplierStatus status,
            @Size(max = 120)
            String contactName,
            @Size(max = 40)
            String contactPhone,
            @Email
            @Size(max = 254)
            String contactEmail,
            @Size(max = 500)
            String address,
            @Size(max = 120)
            String taxRegistrationNumber,
            @Pattern(regexp = "(?i)[A-Z]{3}")
            String settlementCurrency,
            @Min(0) @Max(3650)
            Integer paymentTermsDays,
            @Size(max = 2000)
            String notes) {
        @JsonAnySetter
        public void rejectUnknownField(String field, Object value) {
            throw new IllegalArgumentException("Unknown supplier request field");
        }
    }

    public record ImportSuppliersRequest(
            @NotEmpty @Size(max = 200)
            List<@NotNull @Valid CreateSupplierRequest> items) {
        public ImportSuppliersRequest {
            items = items == null ? null : List.copyOf(items);
        }

        @JsonAnySetter
        public void rejectUnknownField(String field, Object value) {
            throw new IllegalArgumentException("Unknown supplier import field");
        }
    }

    public record ImportSuppliersResponse(
            int createdCount,
            List<SupplierResponse> items) {
        public ImportSuppliersResponse {
            items = List.copyOf(items);
        }
    }

    public record CreateSupplierWithMappingRequest(
            @NotNull @Valid CreateSupplierRequest supplier,
            @NotNull @Valid CreateMappingRequest mapping) {
        @JsonAnySetter
        public void rejectUnknownField(String field, Object value) {
            throw new IllegalArgumentException(
                    "Unknown supplier onboarding field");
        }
    }

    public record SupplierWithMappingResponse(
            SupplierResponse supplier,
            MappingResponse mapping) {
    }

    public record SupplierResponse(
            UUID id,
            String businessCode,
            String name,
            SupplierStatus status,
            String contactName,
            String contactPhone,
            String contactEmail,
            String address,
            String taxRegistrationNumber,
            String settlementCurrency,
            Integer paymentTermsDays,
            String notes,
            Instant createdAt,
            Instant updatedAt,
            long version) {
        static SupplierResponse from(Supplier supplier) {
            return new SupplierResponse(
                    supplier.getId(),
                    supplier.getBusinessCode(),
                    supplier.getName(),
                    supplier.getStatus(),
                    supplier.getContactName(),
                    supplier.getContactPhone(),
                    supplier.getContactEmail(),
                    supplier.getAddress(),
                    supplier.getTaxRegistrationNumber(),
                    supplier.getSettlementCurrency(),
                    supplier.getPaymentTermsDays(),
                    supplier.getNotes(),
                    supplier.getCreatedAt(),
                    supplier.getUpdatedAt(),
                    supplier.getVersion());
        }
    }
}
