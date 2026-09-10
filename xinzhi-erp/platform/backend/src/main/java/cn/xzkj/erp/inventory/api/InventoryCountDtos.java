package cn.xzkj.erp.inventory.api;

import cn.xzkj.erp.inventory.domain.InventoryCountStatus;
import cn.xzkj.erp.inventory.service.InventoryCountDetail;
import cn.xzkj.erp.inventory.service.InventoryCountLineView;
import cn.xzkj.erp.inventory.service.InventoryCountSummary;
import cn.xzkj.erp.inventory.service.InventoryCountSearchField;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public final class InventoryCountDtos {
    private InventoryCountDtos() {
    }

    public record CountLineRequest(
            @NotNull UUID balanceId,
            long countedOnHand) {
    }

    public record CreateCountRequest(
            @NotNull UUID commandId,
            @NotNull UUID warehouseId,
            @NotNull LocalDate countDate,
            @Size(max = 500) String note,
            boolean submit,
            @NotEmpty @Size(max = 200)
            List<@Valid CountLineRequest> lines) {
    }

    public record TransitionCountRequest(
            @NotNull UUID commandId,
            @NotNull Long expectedVersion) {
    }

    public record CountExportRequest(
            UUID warehouseId,
            InventoryCountStatus status,
            @NotNull InventoryCountSearchField searchField,
            @Size(max = 100) String keyword,
            LocalDate from,
            LocalDate to,
            Long differenceMin,
            Long differenceMax) {
    }

    public record CountExportResponse(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }

    public record CountSummaryResponse(
            UUID id,
            String countNo,
            UUID warehouseId,
            String warehouseCode,
            String warehouseName,
            InventoryCountStatus status,
            LocalDate countDate,
            String note,
            int lineCount,
            long totalDifference,
            long version,
            String operatorDisplayName,
            String approverDisplayName,
            Instant createdAt,
            Instant updatedAt) {

        public static CountSummaryResponse from(InventoryCountSummary source) {
            return new CountSummaryResponse(
                    source.id(),
                    source.countNo(),
                    source.warehouseId(),
                    source.warehouseCode(),
                    source.warehouseName(),
                    source.status(),
                    source.countDate(),
                    source.note(),
                    source.lineCount(),
                    source.totalDifference(),
                    source.version(),
                    source.operatorDisplayName(),
                    source.approverDisplayName(),
                    source.createdAt(),
                    source.updatedAt());
        }
    }

    public record CountLineResponse(
            UUID id,
            UUID balanceId,
            UUID skuId,
            String skuCode,
            String skuName,
            long expectedBalanceVersion,
            long snapshotOnHand,
            long snapshotReserved,
            long snapshotAvailable,
            long countedOnHand,
            long difference,
            UUID resultEventId) {

        public static CountLineResponse from(InventoryCountLineView source) {
            return new CountLineResponse(
                    source.id(),
                    source.balanceId(),
                    source.skuId(),
                    source.skuCode(),
                    source.skuName(),
                    source.expectedBalanceVersion(),
                    source.snapshotOnHand(),
                    source.snapshotReserved(),
                    source.snapshotAvailable(),
                    source.countedOnHand(),
                    source.difference(),
                    source.resultEventId());
        }
    }

    public record CountDetailResponse(
            CountSummaryResponse summary,
            List<CountLineResponse> lines) {

        public static CountDetailResponse from(InventoryCountDetail source) {
            return new CountDetailResponse(
                    CountSummaryResponse.from(source.summary()),
                    source.lines().stream().map(CountLineResponse::from).toList());
        }
    }
}
