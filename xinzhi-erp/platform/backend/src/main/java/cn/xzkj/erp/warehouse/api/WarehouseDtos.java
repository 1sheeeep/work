package cn.xzkj.erp.warehouse.api;

import java.time.Instant;
import java.util.UUID;

import cn.xzkj.erp.warehouse.domain.Warehouse;
import cn.xzkj.erp.warehouse.domain.WarehouseLocation;
import cn.xzkj.erp.warehouse.domain.WarehouseStatus;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public final class WarehouseDtos {
    public static final String BUSINESS_CODE_PATTERN = "(?i)[A-Z][A-Z0-9_-]{1,63}";

    private WarehouseDtos() {
    }

    public record CreateWarehouseRequest(
            @NotBlank @Pattern(regexp = BUSINESS_CODE_PATTERN) String businessCode,
            @NotBlank @Size(max = 200) String name) {
    }

    public record UpdateWarehouseRequest(
            @NotNull @Min(0) Long version,
            @NotBlank @Size(max = 200) String name,
            @NotNull WarehouseStatus status) {
    }

    public record CreateLocationRequest(
            @NotBlank @Pattern(regexp = BUSINESS_CODE_PATTERN) String businessCode,
            @NotBlank @Size(max = 200) String name) {
    }

    public record UpdateLocationRequest(
            @NotNull @Min(0) Long version,
            @NotBlank @Size(max = 200) String name,
            @NotNull WarehouseStatus status) {
    }

    public record ArchiveRequest(@NotNull @Min(0) Long version) {
    }

    public record WarehouseExportRequest(
            WarehouseStatus status,
            @Size(max = 100) String keyword) {
    }

    public record WarehouseExportResponse(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }

    public record WarehouseLocationExportRequest(
            WarehouseStatus status,
            @Size(max = 100) String keyword) {
    }

    public record WarehouseLocationExportResponse(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }

    public record WarehouseResponse(
            UUID id,
            String businessCode,
            String name,
            WarehouseStatus status,
            long version,
            Instant createdAt,
            Instant updatedAt) {
        static WarehouseResponse from(Warehouse entity) {
            return new WarehouseResponse(
                    entity.getId(),
                    entity.getBusinessCode(),
                    entity.getName(),
                    entity.getStatus(),
                    entity.getVersion(),
                    entity.getCreatedAt(),
                    entity.getUpdatedAt());
        }
    }

    public record LocationResponse(
            UUID id,
            UUID warehouseId,
            String businessCode,
            String name,
            WarehouseStatus status,
            long version,
            Instant createdAt,
            Instant updatedAt) {
        static LocationResponse from(WarehouseLocation entity) {
            return new LocationResponse(
                    entity.getId(),
                    entity.getWarehouseId(),
                    entity.getBusinessCode(),
                    entity.getName(),
                    entity.getStatus(),
                    entity.getVersion(),
                    entity.getCreatedAt(),
                    entity.getUpdatedAt());
        }
    }
}
