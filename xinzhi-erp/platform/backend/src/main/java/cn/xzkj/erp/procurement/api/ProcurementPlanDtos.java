package cn.xzkj.erp.procurement.api;

import cn.xzkj.erp.procurement.domain.ProcurementPlanSource;
import cn.xzkj.erp.procurement.domain.ProcurementPlanSearchField;
import cn.xzkj.erp.procurement.domain.ProcurementPlanStatus;
import cn.xzkj.erp.procurement.service.ProcurementPlanView;
import cn.xzkj.erp.procurement.service.ProcurementReferenceViews.LocationOption;
import cn.xzkj.erp.procurement.service.ProcurementReferenceViews.SkuOption;
import cn.xzkj.erp.procurement.service.ProcurementReferenceViews.WarehouseOption;
import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.UUID;

public final class ProcurementPlanDtos {
    private ProcurementPlanDtos() {
    }

    public record CreateRequest(
            @NotNull UUID commandId,
            @NotNull UUID skuId,
            @NotNull UUID warehouseId,
            @NotNull UUID locationId,
            @Positive @Max(1_000_000_000L) long quantity,
            @Size(max = 500) String note) {
        @JsonAnySetter
        public void rejectUnknownField(String field, Object value) {
            throw new IllegalArgumentException(
                    "Unknown procurement plan create request field");
        }
    }

    public record VoidRequest(
            @NotNull UUID commandId,
            @NotNull @PositiveOrZero Long expectedVersion,
            @NotBlank @Size(max = 500) String reason) {
        @JsonAnySetter
        public void rejectUnknownField(String field, Object value) {
            throw new IllegalArgumentException(
                    "Unknown procurement plan void request field");
        }
    }

    public record ExportRequest(
            UUID warehouseId,
            UUID locationId,
            ProcurementPlanStatus status,
            @NotNull ProcurementPlanSearchField searchField,
            @Size(max = 120) String keyword,
            Instant createdFrom,
            Instant createdTo) {
        @JsonAnySetter
        public void rejectUnknownField(String field, Object value) {
            throw new IllegalArgumentException(
                    "Unknown procurement plan export request field");
        }
    }

    public record ExportResponse(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }

    public record PlanResponse(
            UUID planId,
            String planNo,
            ProcurementPlanStatus status,
            ProcurementPlanSource source,
            UUID skuId,
            String skuCode,
            String skuName,
            String skuVariant,
            UUID warehouseId,
            String warehouseCode,
            String warehouseName,
            UUID locationId,
            String locationCode,
            String locationName,
            long quantity,
            String note,
            String applicantDisplayName,
            Instant createdAt,
            String voidReason,
            String voidedByDisplayName,
            Instant voidedAt,
            long version,
            Instant updatedAt) {
        public static PlanResponse from(ProcurementPlanView value) {
            return new PlanResponse(
                    value.id(), value.planNo(), value.status(), value.source(),
                    value.skuId(), value.skuCode(), value.skuName(),
                    value.skuVariant(), value.warehouseId(),
                    value.warehouseCode(), value.warehouseName(),
                    value.locationId(), value.locationCode(), value.locationName(),
                    value.quantity(), value.note(), value.applicantDisplayName(),
                    value.createdAt(),
                    value.voidReason(), value.voidedByDisplayName(),
                    value.voidedAt(), value.version(), value.updatedAt());
        }
    }

    public record SummaryResponse(long unpurchasedPlans) {
    }

    public record SkuOptionResponse(
            UUID id,
            String businessCode,
            String name,
            String variantSummary) {
        public static SkuOptionResponse from(SkuOption value) {
            return new SkuOptionResponse(
                    value.id(), value.businessCode(), value.name(),
                    value.variantSummary());
        }
    }

    public record WarehouseOptionResponse(
            UUID id, String businessCode, String name) {
        public static WarehouseOptionResponse from(WarehouseOption value) {
            return new WarehouseOptionResponse(
                    value.id(), value.businessCode(), value.name());
        }
    }

    public record LocationOptionResponse(
            UUID id, UUID warehouseId, String businessCode, String name) {
        public static LocationOptionResponse from(LocationOption value) {
            return new LocationOptionResponse(
                    value.id(), value.warehouseId(),
                    value.businessCode(), value.name());
        }
    }
}
