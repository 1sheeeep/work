package cn.xzkj.erp.inventory.api;

import cn.xzkj.erp.inventory.domain.InventoryEventType;
import cn.xzkj.erp.inventory.service.InventoryBalanceView;
import cn.xzkj.erp.inventory.service.InventoryEventView;
import cn.xzkj.erp.inventory.service.InventoryMutationResult;
import cn.xzkj.erp.inventory.service.InventorySkuSummaryView;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class InventoryDtos {
    private InventoryDtos() {
    }

    public record AdjustmentRequest(
            @NotNull InventoryEventType type,
            @NotNull UUID skuId,
            @NotNull UUID warehouseId,
            long signedDelta,
            @NotNull @Min(0) Long expectedVersion,
            @NotBlank
            @Pattern(regexp = "^[A-Za-z][A-Za-z0-9_]{1,63}$")
            String reason,
            @Size(max = 500) String note) {
    }

    public record ReversalRequest(
            @NotNull @Min(0) Long expectedVersion,
            @NotBlank
            @Pattern(regexp = "^[A-Za-z][A-Za-z0-9_]{1,63}$")
            String reason,
            @Size(max = 500) String note) {
    }

    public record BalanceResponse(
            UUID id,
            UUID skuId,
            String skuBusinessCode,
            String skuName,
            UUID warehouseId,
            String warehouseBusinessCode,
            String warehouseName,
            long onHand,
            long reserved,
            long available,
            long version,
            Instant updatedAt) {

        public static BalanceResponse from(InventoryBalanceView source) {
            return new BalanceResponse(
                    source.id(),
                    source.skuId(),
                    source.skuBusinessCode(),
                    source.skuName(),
                    source.warehouseId(),
                    source.warehouseBusinessCode(),
                    source.warehouseName(),
                    source.onHand(),
                    source.reserved(),
                    source.available(),
                    source.version(),
                    source.updatedAt());
        }
    }

    public record SkuSummaryResponse(
            UUID skuId,
            long onHand,
            long reserved,
            long available) {

        public static SkuSummaryResponse from(
                InventorySkuSummaryView source) {
            return new SkuSummaryResponse(
                    source.skuId(),
                    source.onHand(),
                    source.reserved(),
                    source.available());
        }
    }

    public record SkuSummariesResponse(
            List<SkuSummaryResponse> items) {

        public SkuSummariesResponse {
            items = List.copyOf(items);
        }
    }

    public record EventResponse(
            UUID id,
            long ledgerSequence,
            InventoryEventType eventType,
            UUID skuId,
            String skuBusinessCode,
            String skuName,
            UUID warehouseId,
            String warehouseBusinessCode,
            String warehouseName,
            long signedDelta,
            long balanceAfter,
            long balanceVersionAfter,
            String reason,
            UUID reversalOfEventId,
            String requestId,
            Instant recordedAt) {

        public static EventResponse from(InventoryEventView source) {
            return new EventResponse(
                    source.id(),
                    source.ledgerSequence(),
                    source.eventType(),
                    source.skuId(),
                    source.skuBusinessCode(),
                    source.skuName(),
                    source.warehouseId(),
                    source.warehouseBusinessCode(),
                    source.warehouseName(),
                    source.signedDelta(),
                    source.balanceAfter(),
                    source.balanceVersionAfter(),
                    source.reason(),
                    source.reversalOfEventId(),
                    source.requestId(),
                    source.recordedAt());
        }
    }

    public record MutationResponse(
            EventResponse event,
            BalanceResponse balance,
            boolean replayed) {

        public static MutationResponse from(InventoryMutationResult source) {
            return new MutationResponse(
                    EventResponse.from(source.event()),
                    BalanceResponse.from(source.balance()),
                    source.replayed());
        }
    }
}
