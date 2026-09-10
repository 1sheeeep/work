package cn.xzkj.erp.inventory.api;

import cn.xzkj.erp.inventory.domain.WarehouseTransferAllocationMethod;
import cn.xzkj.erp.inventory.domain.WarehouseTransferStatus;
import cn.xzkj.erp.inventory.domain.WarehouseTransferTransportMode;
import cn.xzkj.erp.inventory.service.WarehouseTransferDetail;
import cn.xzkj.erp.inventory.service.WarehouseTransferLineView;
import cn.xzkj.erp.inventory.service.WarehouseTransferSearchField;
import cn.xzkj.erp.inventory.service.WarehouseTransferSummary;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public final class InventoryTransferDtos {
    private InventoryTransferDtos() {
    }

    public record TransferLineRequest(
            @NotNull UUID balanceId,
            @Min(1) long quantity) {
    }

    public record CreateTransferRequest(
            @NotNull UUID commandId,
            @NotNull UUID sourceWarehouseId,
            @NotNull UUID targetWarehouseId,
            @NotNull LocalDate transferDate,
            WarehouseTransferTransportMode transportMode,
            @Min(0) Long freightAmountMinor,
            @Pattern(regexp = "^[A-Za-z]{3}$") String currencyCode,
            @Size(max = 160) String logisticsChannel,
            @Size(max = 160) String trackingNo,
            WarehouseTransferAllocationMethod allocationMethod,
            Instant expectedShipAt,
            Instant expectedArrivalAt,
            @Size(max = 500) String note,
            boolean submit,
            @NotEmpty @Size(max = 200)
            List<@Valid TransferLineRequest> lines) {
    }

    public record TransitionTransferRequest(
            @NotNull UUID commandId,
            @NotNull @Min(0) Long expectedVersion) {
    }

    public record ReceiveLineRequest(
            @NotNull UUID lineId,
            @Min(1) long quantity) {
    }

    public record ReceiveTransferRequest(
            @NotNull UUID commandId,
            @NotNull @Min(0) Long expectedVersion,
            @NotEmpty @Size(max = 200)
            List<@Valid ReceiveLineRequest> lines) {
    }

    public record TransferExportRequest(
            UUID sourceWarehouseId,
            UUID targetWarehouseId,
            @Size(max = 2) List<@NotNull WarehouseTransferStatus> statuses,
            WarehouseTransferTransportMode transportMode,
            @NotNull WarehouseTransferSearchField searchField,
            @Size(max = 100) String keyword,
            LocalDate from,
            LocalDate to) {
    }

    public record TransferExportResponse(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }

    public record TransferSummaryResponse(
            UUID id,
            String transferNo,
            WarehouseTransferStatus status,
            LocalDate transferDate,
            UUID sourceWarehouseId,
            String sourceWarehouseCode,
            String sourceWarehouseName,
            UUID targetWarehouseId,
            String targetWarehouseCode,
            String targetWarehouseName,
            WarehouseTransferTransportMode transportMode,
            Long freightAmountMinor,
            String currencyCode,
            String logisticsChannel,
            String trackingNo,
            WarehouseTransferAllocationMethod allocationMethod,
            Instant expectedShipAt,
            Instant expectedArrivalAt,
            String note,
            int lineCount,
            long totalQuantity,
            long version,
            String operatorDisplayName,
            String approverDisplayName,
            String shipperDisplayName,
            String receiverDisplayName,
            Instant createdAt,
            Instant updatedAt) {

        public static TransferSummaryResponse from(WarehouseTransferSummary source) {
            return new TransferSummaryResponse(
                    source.id(), source.transferNo(), source.status(),
                    source.transferDate(), source.sourceWarehouseId(),
                    source.sourceWarehouseCode(), source.sourceWarehouseName(),
                    source.targetWarehouseId(), source.targetWarehouseCode(),
                    source.targetWarehouseName(), source.transportMode(),
                    source.freightAmountMinor(), source.currencyCode(),
                    source.logisticsChannel(), source.trackingNo(),
                    source.allocationMethod(), source.expectedShipAt(),
                    source.expectedArrivalAt(), source.note(), source.lineCount(),
                    source.totalQuantity(), source.version(),
                    source.operatorDisplayName(), source.approverDisplayName(),
                    source.shipperDisplayName(), source.receiverDisplayName(),
                    source.createdAt(), source.updatedAt());
        }
    }

    public record TransferLineResponse(
            UUID id,
            UUID sourceBalanceId,
            UUID skuId,
            String skuCode,
            String skuName,
            long snapshotBalanceVersion,
            long snapshotOnHand,
            long snapshotReserved,
            long snapshotAvailable,
            long quantity,
            long receivedQuantity,
            long remainingQuantity,
            UUID shipmentEventId,
            UUID receiptEventId) {

        public static TransferLineResponse from(WarehouseTransferLineView source) {
            return new TransferLineResponse(
                    source.id(), source.sourceBalanceId(), source.skuId(),
                    source.skuCode(), source.skuName(),
                    source.snapshotBalanceVersion(), source.snapshotOnHand(),
                    source.snapshotReserved(), source.snapshotAvailable(),
                    source.quantity(), source.receivedQuantity(),
                    source.remainingQuantity(), source.shipmentEventId(),
                    source.receiptEventId());
        }
    }

    public record TransferDetailResponse(
            TransferSummaryResponse summary,
            List<TransferLineResponse> lines) {

        public static TransferDetailResponse from(WarehouseTransferDetail source) {
            return new TransferDetailResponse(
                    TransferSummaryResponse.from(source.summary()),
                    source.lines().stream().map(TransferLineResponse::from).toList());
        }
    }
}
