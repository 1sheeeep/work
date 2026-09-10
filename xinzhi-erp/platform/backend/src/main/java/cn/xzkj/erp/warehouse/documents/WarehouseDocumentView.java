package cn.xzkj.erp.warehouse.documents;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record WarehouseDocumentView(
        UUID id,
        UUID relatedDocumentId,
        Source source,
        Direction direction,
        String documentNo,
        String sourceReference,
        String documentType,
        UUID warehouseId,
        String warehouseCode,
        String warehouseName,
        Status status,
        ApprovalStatus approvalStatus,
        long lineCount,
        long totalQuantity,
        BigDecimal totalAmount,
        String currency,
        String operatorDisplayName,
        Instant occurredAt,
        Instant postedAt) {

    public enum Source {
        MANUAL_MOVEMENT,
        PROCUREMENT_RECEIPT,
        WAREHOUSE_TRANSFER,
        ORDER_FULFILLMENT,
        INVENTORY_COUNT
    }

    public enum Direction {
        INBOUND,
        OUTBOUND
    }

    public enum Status {
        DRAFT,
        SUBMITTED,
        POSTED,
        PARTIALLY_REVERSED,
        REVERSED,
        CANCELLED
    }

    public enum ApprovalStatus {
        NOT_REQUIRED,
        PENDING,
        APPROVED,
        REJECTED
    }

    public enum SearchField {
        DOCUMENT_NO,
        SKU,
        LOCATION,
        NOTE,
        OPERATOR
    }
}
