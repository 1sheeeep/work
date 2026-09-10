package cn.xzkj.erp.warehouse.operations.api;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import cn.xzkj.erp.inventory.api.InventoryDtos.EventResponse;
import cn.xzkj.erp.inventory.service.InventoryEventView;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementDirection;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementEntryMode;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementApprovalStatus;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementReasonCode;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementSearchField;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementSource;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementStatus;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementTimeBucket;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementWmsStatus;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementCommands;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementViews;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

public final class ManualMovementDtos {
    private ManualMovementDtos() {
    }

    public record ExportRequest(
            UUID warehouseId,
            ManualMovementDirection direction,
            ManualMovementStatus status,
            ManualMovementReasonCode reasonCode,
            UUID movementTypeId,
            ManualMovementSource source,
            ManualMovementWmsStatus wmsStatus,
            ManualMovementApprovalStatus approvalStatus,
            ManualMovementSearchField searchField,
            ManualMovementTimeBucket timeBucket,
            @Size(max = 100) String keyword,
            Instant createdFrom,
            Instant createdTo) {
    }

    public record ExportResponse(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }

    public record LineRequest(
            @NotNull UUID skuId,
            @NotNull UUID locationId,
            @Positive long quantity,
            @DecimalMin("0.0000") BigDecimal unitPrice,
            @Pattern(regexp = "^[A-Z]{3}$") String currency,
            @Size(max = 20) Map<String, String> extensionAttributes,
            @Size(max = 300) String note) {
        ManualMovementCommands.LineInput toCommand() {
            return new ManualMovementCommands.LineInput(
                    skuId,
                    locationId,
                    quantity,
                    unitPrice,
                    currency,
                    extensionAttributes,
                    note);
        }
    }

    public record BoxItemRequest(
            @NotNull UUID skuId,
            @Positive long quantityPerBox) {
        ManualMovementCommands.BoxItemInput toCommand() {
            return new ManualMovementCommands.BoxItemInput(
                    skuId, quantityPerBox);
        }
    }

    public record BoxRequest(
            UUID sourceBoxStockId,
            @NotBlank @Size(max = 80) String customBoxNo,
            @Positive long boxCount,
            @NotBlank
            @Pattern(regexp = "^(SHARED_NUMBER|UNIQUE_NUMBER)$")
            String boxNumberRule,
            @NotNull @DecimalMin(value = "0", inclusive = false)
            BigDecimal lengthCm,
            @NotNull @DecimalMin(value = "0", inclusive = false)
            BigDecimal widthCm,
            @NotNull @DecimalMin(value = "0", inclusive = false)
            BigDecimal heightCm,
            @NotNull @DecimalMin(value = "0", inclusive = false)
            BigDecimal grossWeightKg,
            @NotEmpty @Size(max = 100)
            List<@Valid BoxItemRequest> items) {
        ManualMovementCommands.BoxInput toCommand() {
            return new ManualMovementCommands.BoxInput(
                    sourceBoxStockId,
                    customBoxNo,
                    boxCount,
                    boxNumberRule,
                    lengthCm,
                    widthCm,
                    heightCm,
                    grossWeightKg,
                    items.stream()
                            .map(BoxItemRequest::toCommand)
                            .toList());
        }
    }

    public record SaveRequest(
            @NotNull UUID warehouseId,
            @NotNull ManualMovementDirection direction,
            UUID movementTypeId,
            @NotNull ManualMovementReasonCode reasonCode,
            @NotNull ManualMovementSource source,
            @NotNull ManualMovementEntryMode entryMode,
            @Size(max = 500) String note,
            @Size(max = 100) String sourceReference,
            @Size(max = 80) String contactName,
            @Size(max = 40) String contactPhone,
            @Size(max = 300) String contactAddress,
            @Size(max = 20) Map<String, String> extensionAttributes,
            @NotEmpty @Size(max = 500)
            List<@Valid LineRequest> lines,
            @Size(max = 200) List<@Valid BoxRequest> boxes,
            @NotNull @Min(0) Long expectedVersion,
            @NotNull UUID commandId) {
        ManualMovementCommands.Save toCommand() {
            return new ManualMovementCommands.Save(
                    warehouseId,
                    direction,
                    movementTypeId,
                    reasonCode,
                    source,
                    entryMode,
                    note,
                    sourceReference,
                    contactName,
                    contactPhone,
                    contactAddress,
                    extensionAttributes,
                    lines.stream().map(LineRequest::toCommand).toList(),
                    boxes == null
                            ? List.of()
                            : boxes.stream()
                                    .map(BoxRequest::toCommand)
                                    .toList(),
                    expectedVersion,
                    commandId);
        }
    }

    public record ReviewRequest(
            @NotNull @Min(0) Long expectedVersion,
            @NotNull UUID commandId,
            boolean approved,
            @Size(max = 300) String note) {
        ManualMovementCommands.Review toCommand() {
            return new ManualMovementCommands.Review(
                    expectedVersion, commandId, approved, note);
        }
    }

    public record BatchItemRequest(
            @NotNull UUID movementId,
            @NotNull @Min(0) Long expectedVersion) {
        ManualMovementCommands.BatchItem toCommand() {
            return new ManualMovementCommands.BatchItem(
                    movementId, expectedVersion);
        }
    }

    public record BatchRequest(
            @NotEmpty @Size(max = 100)
            List<@Valid BatchItemRequest> items,
            @NotNull UUID commandId,
            @Size(max = 300) String note) {
        ManualMovementCommands.Batch toCommand() {
            return new ManualMovementCommands.Batch(
                    items.stream()
                            .map(BatchItemRequest::toCommand)
                            .toList(),
                    commandId,
                    note);
        }
    }

    public record TransitionRequest(
            @NotNull @Min(0) Long expectedVersion,
            @NotNull UUID commandId) {
        ManualMovementCommands.Transition toCommand() {
            return new ManualMovementCommands.Transition(
                    expectedVersion, commandId);
        }
    }

    public record LineResponse(
            UUID id,
            int lineNumber,
            UUID skuId,
            String skuBusinessCode,
            String skuName,
            UUID locationId,
            String locationBusinessCode,
            String locationName,
            long quantity,
            Long actualQuantity,
            BigDecimal unitPrice,
            String currency,
            BigDecimal amount,
            Map<String, String> extensionAttributes,
            String note,
            Long currentOnHand,
            Long currentAvailable) {
        static LineResponse from(ManualMovementViews.Line line) {
            return new LineResponse(
                    line.id(),
                    line.lineNumber(),
                    line.skuId(),
                    line.skuBusinessCode(),
                    line.skuName(),
                    line.locationId(),
                    line.locationBusinessCode(),
                    line.locationName(),
                    line.quantity(),
                    line.actualQuantity(),
                    line.unitPrice(),
                    line.currency(),
                    line.amount(),
                    line.extensionAttributes(),
                    line.note(),
                    line.currentOnHand(),
                    line.currentAvailable());
        }
    }

    public record SummaryResponse(
            UUID id,
            String movementNo,
            ManualMovementDirection direction,
            ManualMovementStatus status,
            UUID warehouseId,
            String warehouseBusinessCode,
            String warehouseName,
            UUID movementTypeId,
            String movementTypeName,
            ManualMovementReasonCode reasonCode,
            ManualMovementSource source,
            ManualMovementWmsStatus wmsStatus,
            ManualMovementApprovalStatus approvalStatus,
            ManualMovementEntryMode entryMode,
            String note,
            String sourceReference,
            Map<String, String> extensionAttributes,
            int lineCount,
            long totalQuantity,
            long totalActualQuantity,
            BigDecimal totalAmount,
            String currency,
            long version,
            String createdBy,
            String reviewedBy,
            String reviewNote,
            Instant submittedAt,
            Instant postedAt,
            Instant reversedAt,
            Instant cancelledAt,
            Instant reviewedAt,
            Instant createdAt,
            Instant updatedAt) {
        static SummaryResponse from(ManualMovementViews.Summary summary) {
            return new SummaryResponse(
                    summary.id(),
                    summary.movementNo(),
                    summary.direction(),
                    summary.status(),
                    summary.warehouseId(),
                    summary.warehouseBusinessCode(),
                    summary.warehouseName(),
                    summary.movementTypeId(),
                    summary.movementTypeName(),
                    summary.reasonCode(),
                    summary.source(),
                    summary.wmsStatus(),
                    summary.approvalStatus(),
                    summary.entryMode(),
                    summary.note(),
                    summary.sourceReference(),
                    summary.extensionAttributes(),
                    summary.lineCount(),
                    summary.totalQuantity(),
                    summary.totalActualQuantity(),
                    summary.totalAmount(),
                    summary.currency(),
                    summary.version(),
                    summary.createdBy(),
                    summary.reviewedBy(),
                    summary.reviewNote(),
                    summary.submittedAt(),
                    summary.postedAt(),
                    summary.reversedAt(),
                    summary.cancelledAt(),
                    summary.reviewedAt(),
                    summary.createdAt(),
                    summary.updatedAt());
        }
    }

    public record DetailResponse(
            SummaryResponse summary,
            List<LineResponse> lines,
            List<BoxResponse> boxes,
            ContactInformationResponse contactInformation) {
        static DetailResponse from(ManualMovementViews.Detail detail) {
            return new DetailResponse(
                    SummaryResponse.from(detail.summary()),
                    detail.lines().stream().map(LineResponse::from).toList(),
                    detail.boxes().stream().map(BoxResponse::from).toList(),
                    ContactInformationResponse.from(
                            detail.contactInformation()));
        }
    }

    public record ContactInformationResponse(
            String name,
            String phone,
            String address) {
        static ContactInformationResponse from(
                ManualMovementViews.ContactInformation contact) {
            return new ContactInformationResponse(
                    contact.name(),
                    contact.phone(),
                    contact.address());
        }
    }

    public record BoxItemResponse(
            UUID skuId,
            String skuBusinessCode,
            String skuName,
            long quantityPerBox) {
        static BoxItemResponse from(ManualMovementViews.BoxItem item) {
            return new BoxItemResponse(
                    item.skuId(),
                    item.skuBusinessCode(),
                    item.skuName(),
                    item.quantityPerBox());
        }
    }

    public record BoxResponse(
            UUID id,
            UUID sourceBoxStockId,
            String customBoxNo,
            long boxCount,
            String boxNumberRule,
            BigDecimal lengthCm,
            BigDecimal widthCm,
            BigDecimal heightCm,
            BigDecimal grossWeightKg,
            List<BoxItemResponse> items) {
        static BoxResponse from(ManualMovementViews.Box box) {
            return new BoxResponse(
                    box.id(),
                    box.sourceBoxStockId(),
                    box.customBoxNo(),
                    box.boxCount(),
                    box.boxNumberRule(),
                    box.lengthCm(),
                    box.widthCm(),
                    box.heightCm(),
                    box.grossWeightKg(),
                    box.items().stream().map(BoxItemResponse::from).toList());
        }
    }

    public record MutationResponse(
            UUID movementId,
            ManualMovementStatus status,
            long version,
            boolean replayed) {
        static MutationResponse from(
                ManualMovementViews.Mutation mutation) {
            return new MutationResponse(
                    mutation.movementId(),
                    mutation.status(),
                    mutation.version(),
                    mutation.replayed());
        }
    }

    public record PriceSnapshotResponse(
            BigDecimal unitPrice,
            String currency,
            long version) {
        static PriceSnapshotResponse from(
                ManualMovementViews.PriceSnapshot snapshot) {
            return new PriceSnapshotResponse(
                    snapshot.unitPrice(),
                    snapshot.currency(),
                    snapshot.version());
        }
    }

    public record TimelineResponse(
            UUID id,
            String eventType,
            ManualMovementStatus fromStatus,
            ManualMovementStatus toStatus,
            long movementVersion,
            String requestId,
            Instant recordedAt) {
        static TimelineResponse from(
                ManualMovementViews.TimelineEvent event) {
            return new TimelineResponse(
                    event.id(),
                    event.eventType(),
                    event.fromStatus(),
                    event.toStatus(),
                    event.movementVersion(),
                    event.requestId(),
                    event.recordedAt());
        }
    }

    public record TimelineListResponse(
            List<TimelineResponse> items) {
    }

    public record LedgerResponse(EventResponse event) {
        static LedgerResponse from(InventoryEventView event) {
            return new LedgerResponse(EventResponse.from(event));
        }
    }

    public record LedgerListResponse(
            List<LedgerResponse> items) {
    }

    public record WarehouseOptionResponse(
            UUID id,
            String businessCode,
            String name) {
        static WarehouseOptionResponse from(
                ManualMovementViews.WarehouseOption option) {
            return new WarehouseOptionResponse(
                    option.id(), option.businessCode(), option.name());
        }
    }

    public record LocationOptionResponse(
            UUID id,
            UUID warehouseId,
            String businessCode,
            String name) {
        static LocationOptionResponse from(
                ManualMovementViews.LocationOption option) {
            return new LocationOptionResponse(
                    option.id(),
                    option.warehouseId(),
                    option.businessCode(),
                    option.name());
        }
    }

    public record SkuOptionResponse(
            UUID id,
            String businessCode,
            String name,
            String variantSummary) {
        static SkuOptionResponse from(
                ManualMovementViews.SkuOption option) {
            return new SkuOptionResponse(
                    option.id(),
                    option.businessCode(),
                    option.name(),
                    option.variantSummary());
        }
    }

    public record SettingsResponse(
            ManualMovementDirection direction,
            boolean approvalRequired,
            boolean unitPriceRequired,
            boolean showCostPrice,
            String costUpdatePolicy,
            boolean contactInformationRequired,
            long version) {
        static SettingsResponse from(ManualMovementViews.Settings settings) {
            return new SettingsResponse(
                    settings.direction(),
                    settings.approvalRequired(),
                    settings.unitPriceRequired(),
                    settings.showCostPrice(),
                    settings.costUpdatePolicy(),
                    settings.contactInformationRequired(),
                    settings.version());
        }
    }

    public record SettingsRequest(
            boolean approvalRequired,
            boolean unitPriceRequired,
            boolean showCostPrice,
            @NotNull
            @Pattern(regexp = "^(UPDATE_SNAPSHOT|NO_UPDATE)$")
            String costUpdatePolicy,
            boolean contactInformationRequired,
            @NotNull @Min(0) Long expectedVersion,
            @NotNull UUID commandId) {
    }

    public record MovementTypeResponse(
            UUID id,
            ManualMovementDirection direction,
            String code,
            String name,
            String status,
            long version) {
        static MovementTypeResponse from(
                ManualMovementViews.MovementType type) {
            return new MovementTypeResponse(
                    type.id(),
                    type.direction(),
                    type.code(),
                    type.name(),
                    type.status(),
                    type.version());
        }
    }

    public record MovementTypeRequest(
            @NotNull ManualMovementDirection direction,
            @NotBlank
            @Pattern(regexp = "^[A-Z][A-Z0-9_]{1,39}$")
            String code,
            @NotBlank @Size(max = 80) String name,
            @NotNull @Pattern(regexp = "^(ACTIVE|INACTIVE)$")
            String status,
            @NotNull @Min(0) Long expectedVersion,
            @NotNull UUID commandId) {
    }

    public record BoxStockResponse(
            UUID id,
            UUID warehouseId,
            String customBoxNo,
            String boxNumberRule,
            BigDecimal lengthCm,
            BigDecimal widthCm,
            BigDecimal heightCm,
            BigDecimal grossWeightKg,
            long availableCount,
            long version,
            List<BoxItemResponse> items) {
        static BoxStockResponse from(ManualMovementViews.BoxStock stock) {
            return new BoxStockResponse(
                    stock.id(),
                    stock.warehouseId(),
                    stock.customBoxNo(),
                    stock.boxNumberRule(),
                    stock.lengthCm(),
                    stock.widthCm(),
                    stock.heightCm(),
                    stock.grossWeightKg(),
                    stock.availableCount(),
                    stock.version(),
                    stock.items().stream()
                            .map(BoxItemResponse::from)
                            .toList());
        }
    }

    public record BatchResponse(
            List<MutationResponse> items) {
        static BatchResponse from(
                List<ManualMovementViews.Mutation> mutations) {
            return new BatchResponse(
                    mutations.stream()
                            .map(MutationResponse::from)
                            .toList());
        }
    }
}
