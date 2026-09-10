package cn.xzkj.erp.procurement.api;

import cn.xzkj.erp.procurement.domain.ProcurementPurchaseOrderSearchField;
import cn.xzkj.erp.procurement.domain.ProcurementPurchaseOrderStatus;
import cn.xzkj.erp.procurement.domain.ProcurementReceiptSort;
import cn.xzkj.erp.procurement.service.ProcurementPurchaseReturnView;
import cn.xzkj.erp.procurement.service.ProcurementPurchaseOrderView;
import cn.xzkj.erp.procurement.service.ProcurementReceiptView;
import cn.xzkj.erp.procurement.service.ProcurementReturnableOrderView;
import cn.xzkj.erp.procurement.service.ProcurementSupplierOption;
import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.UUID;

public final class ProcurementPurchaseOrderDtos {
    private ProcurementPurchaseOrderDtos() {
    }

    public record PurchaseOrderCreateRequest(
            @NotNull UUID commandId,
            @NotNull UUID planId,
            @NotNull @PositiveOrZero Long expectedPlanVersion,
            @NotNull UUID supplierId,
            @Size(max = 500) String orderNote) {
        @JsonAnySetter
        public void rejectUnknownField(String field, Object value) {
            throw new IllegalArgumentException(
                    "Unknown procurement purchase order create request field");
        }
    }

    public record DirectPurchaseOrderCreateRequest(
            @NotNull UUID commandId,
            @NotNull UUID supplierId,
            @NotNull UUID skuId,
            @NotNull UUID warehouseId,
            @NotNull UUID locationId,
            @NotNull @Positive Long quantity,
            @Size(max = 500) String orderNote) {
        @JsonAnySetter
        public void rejectUnknownField(String field, Object value) {
            throw new IllegalArgumentException(
                    "Unknown direct purchase order create request field");
        }
    }

    public record PurchaseOrderReceiptRequest(
            @NotNull UUID commandId,
            @NotNull @PositiveOrZero Long expectedVersion,
            @NotNull @Positive Long quantity) {
        @JsonAnySetter
        public void rejectUnknownField(String field, Object value) {
            throw new IllegalArgumentException(
                    "Unknown procurement purchase order receipt request field");
        }
    }

    public record PurchaseOrderReviewRequest(
            @NotNull @PositiveOrZero Long expectedVersion,
            @NotNull Boolean approved,
            @Size(max = 500) String reviewNote) {
        @JsonAnySetter
        public void rejectUnknownField(String field, Object value) {
            throw new IllegalArgumentException(
                    "Unknown procurement purchase order review request field");
        }
    }

    public record PurchaseReturnCreateRequest(
            @NotNull UUID commandId,
            @NotNull UUID purchaseOrderId,
            @NotNull @PositiveOrZero Long expectedOrderVersion,
            @NotNull @Positive Long quantity,
            @NotNull @Size(min = 1, max = 500) String reason) {
        @JsonAnySetter
        public void rejectUnknownField(String field, Object value) {
            throw new IllegalArgumentException(
                    "Unknown procurement purchase return request field");
        }
    }

    public record FollowUpExportRequest(
            @NotNull ProcurementPurchaseOrderSearchField searchField,
            @Size(max = 120) String keyword,
            Instant createdFrom,
            Instant createdTo) {
    }

    public record FollowUpExportResponse(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }

    public record PurchaseOrderExportRequest(
            ProcurementPurchaseOrderStatus status,
            boolean receivableOnly,
            @NotNull ProcurementPurchaseOrderSearchField searchField,
            @Size(max = 120) String keyword,
            Instant createdFrom,
            Instant createdTo) {
    }

    public record PurchaseOrderExportResponse(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }

    public record ReceiptLedgerExportRequest(
            @Size(max = 120) String supplierKeyword,
            @Size(max = 120) String purchaseKeyword,
            Instant receivedFrom,
            Instant receivedTo,
            @NotNull ProcurementReceiptSort sort) {
    }

    public record ReceiptLedgerExportResponse(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }

    public record PurchaseOrderResponse(
            UUID purchaseOrderId,
            String purchaseNo,
            ProcurementPurchaseOrderStatus status,
            UUID planId,
            String planNo,
            UUID supplierId,
            String supplierCode,
            String supplierName,
            String supplierSkuCode,
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
            long receivedQuantity,
            String orderNote,
            String orderedByDisplayName,
            String reviewDecision,
            String reviewNote,
            String reviewedByDisplayName,
            Instant reviewedAt,
            long version,
            Instant lastReceivedAt,
            Instant createdAt,
            Instant updatedAt) {
        public static PurchaseOrderResponse from(ProcurementPurchaseOrderView value) {
            return new PurchaseOrderResponse(
                    value.id(), value.purchaseNo(), value.status(), value.planId(),
                    value.planNo(), value.supplierId(), value.supplierCode(),
                    value.supplierName(), value.supplierSkuCode(), value.skuId(),
                    value.skuCode(), value.skuName(), value.skuVariant(),
                    value.warehouseId(), value.warehouseCode(), value.warehouseName(),
                    value.locationId(), value.locationCode(), value.locationName(),
                    value.quantity(), value.receivedQuantity(), value.orderNote(),
                    value.orderedByDisplayName(), value.reviewDecision(),
                    value.reviewNote(), value.reviewedByDisplayName(),
                    value.reviewedAt(), value.version(),
                    value.lastReceivedAt(), value.createdAt(), value.updatedAt());
        }
    }

    public record SupplierOptionResponse(
            UUID supplierId,
            String supplierCode,
            String supplierName,
            String supplierSkuCode,
            boolean preferred,
            Integer leadTimeDays) {
        public static SupplierOptionResponse from(ProcurementSupplierOption value) {
            return new SupplierOptionResponse(
                    value.supplierId(), value.supplierCode(), value.supplierName(),
                    value.supplierSkuCode(), value.preferred(), value.leadTimeDays());
        }
    }

    public record PurchaseOrderReceiptResponse(
            UUID receiptId,
            UUID purchaseOrderId,
            String purchaseNo,
            String planNo,
            UUID supplierId,
            String supplierCode,
            String supplierName,
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
            UUID inventoryEventId,
            long inventoryLedgerSequence,
            long inventoryBalanceAfter,
            String receivedByDisplayName,
            Instant receivedAt) {
        public static PurchaseOrderReceiptResponse from(
                ProcurementReceiptView value) {
            return new PurchaseOrderReceiptResponse(
                    value.id(), value.purchaseOrderId(), value.purchaseNo(),
                    value.planNo(), value.supplierId(), value.supplierCode(),
                    value.supplierName(), value.skuId(), value.skuCode(),
                    value.skuName(), value.skuVariant(), value.warehouseId(),
                    value.warehouseCode(), value.warehouseName(),
                    value.locationId(), value.locationCode(),
                    value.locationName(), value.quantity(),
                    value.inventoryEventId(), value.inventoryLedgerSequence(),
                    value.inventoryBalanceAfter(),
                    value.receivedByDisplayName(), value.receivedAt());
        }
    }

    public record PurchaseReturnResponse(
            UUID purchaseReturnId,
            String returnNo,
            UUID purchaseOrderId,
            String purchaseNo,
            String planNo,
            UUID supplierId,
            String supplierCode,
            String supplierName,
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
            String reason,
            UUID inventoryEventId,
            long inventoryLedgerSequence,
            long inventoryBalanceAfter,
            String returnedByDisplayName,
            Instant returnedAt) {
        public static PurchaseReturnResponse from(
                ProcurementPurchaseReturnView value) {
            return new PurchaseReturnResponse(
                    value.id(), value.returnNo(), value.purchaseOrderId(),
                    value.purchaseNo(), value.planNo(), value.supplierId(),
                    value.supplierCode(), value.supplierName(), value.skuId(),
                    value.skuCode(), value.skuName(), value.skuVariant(),
                    value.warehouseId(), value.warehouseCode(),
                    value.warehouseName(), value.locationId(),
                    value.locationCode(), value.locationName(), value.quantity(),
                    value.reason(), value.inventoryEventId(),
                    value.inventoryLedgerSequence(),
                    value.inventoryBalanceAfter(),
                    value.returnedByDisplayName(), value.returnedAt());
        }
    }

    public record ReturnableOrderResponse(
            UUID purchaseOrderId,
            String purchaseNo,
            String supplierCode,
            String supplierName,
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
            long receivedQuantity,
            long returnedQuantity,
            long returnableQuantity,
            long version) {
        public static ReturnableOrderResponse from(
                ProcurementReturnableOrderView value) {
            return new ReturnableOrderResponse(
                    value.purchaseOrderId(), value.purchaseNo(),
                    value.supplierCode(), value.supplierName(), value.skuId(),
                    value.skuCode(), value.skuName(), value.skuVariant(),
                    value.warehouseId(), value.warehouseCode(),
                    value.warehouseName(), value.locationId(),
                    value.locationCode(), value.locationName(),
                    value.receivedQuantity(), value.returnedQuantity(),
                    value.returnableQuantity(), value.version());
        }
    }
}
