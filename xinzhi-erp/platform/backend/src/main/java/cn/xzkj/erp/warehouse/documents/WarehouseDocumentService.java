package cn.xzkj.erp.warehouse.documents;

import cn.xzkj.erp.iam.warehousescope.WarehouseScopeAccess;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeEvaluator;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.warehouse.documents.WarehouseDocumentView.ApprovalStatus;
import cn.xzkj.erp.warehouse.documents.WarehouseDocumentView.Direction;
import cn.xzkj.erp.warehouse.documents.WarehouseDocumentView.SearchField;
import cn.xzkj.erp.warehouse.documents.WarehouseDocumentView.Source;
import cn.xzkj.erp.warehouse.documents.WarehouseDocumentView.Status;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class WarehouseDocumentService {
    static final int MAX_EXPORT_ROWS = 10_000;
    private static final String CSV_MEDIA_TYPE = "text/csv;charset=utf-8";
    private static final List<String> CSV_HEADER = List.of(
            "单号", "单据方向", "单据类型", "仓库编码", "仓库名称",
            "单据状态", "审批状态", "来源", "商品行数", "总数量",
            "总金额", "币种", "创建人", "创建时间", "过账时间", "来源单号");
    private final WarehouseDocumentRepository repository;
    private final WarehouseScopeEvaluator scopeEvaluator;

    public WarehouseDocumentService(
            WarehouseDocumentRepository repository,
            WarehouseScopeEvaluator scopeEvaluator) {
        this.repository = repository;
        this.scopeEvaluator = scopeEvaluator;
    }

    @Transactional(readOnly = true)
    public Page<WarehouseDocumentView> list(
            WarehouseDocumentActor actor,
            UUID warehouseId,
            Direction direction,
            Source source,
            Status status,
            ApprovalStatus approvalStatus,
            SearchField searchField,
            String keyword,
            Instant occurredFrom,
            Instant occurredTo,
            Pageable pageable) {
        requireActor(actor);
        if (occurredFrom != null && occurredTo != null
                && occurredTo.isBefore(occurredFrom)) {
            throw new IllegalArgumentException("occurredTo must not precede occurredFrom");
        }
        WarehouseScopeAccess scope = scopeEvaluator.evaluate(
                actor.tenantId(), actor.userId(), actor.systemAdminId());
        if (warehouseId != null) scopeEvaluator.requireVisible(scope, warehouseId);
        if (!scope.allowsAll() && scope.warehouseIds().isEmpty()) {
            return Page.empty(pageable);
        }
        String normalizedKeyword = normalize(keyword);
        return repository.list(
                actor.tenantId(), scope.warehouseIds(), scope.allowsAll(),
                warehouseId, direction, source, status, approvalStatus,
                searchField == null ? SearchField.DOCUMENT_NO : searchField,
                normalizedKeyword, occurredFrom, occurredTo, pageable);
    }

    @Transactional(readOnly = true)
    public WarehouseDocumentExport exportCsv(
            WarehouseDocumentActor actor,
            UUID warehouseId,
            Direction direction,
            Source source,
            Status status,
            ApprovalStatus approvalStatus,
            SearchField searchField,
            String keyword,
            Instant occurredFrom,
            Instant occurredTo) {
        Page<WarehouseDocumentView> page = list(
                actor, warehouseId, direction, source, status, approvalStatus,
                searchField, keyword, occurredFrom, occurredTo,
                PageRequest.of(0, MAX_EXPORT_ROWS + 1));
        if (page.getTotalElements() > MAX_EXPORT_ROWS
                || page.getNumberOfElements() > MAX_EXPORT_ROWS) {
            throw new ConflictException(
                    "Warehouse document export exceeds the supported row limit");
        }
        String content = csv(page.getContent());
        String suffix = direction == null
                ? "all"
                : direction.name().toLowerCase(Locale.ROOT);
        return new WarehouseDocumentExport(
                "warehouse-documents-" + suffix + ".csv",
                CSV_MEDIA_TYPE,
                page.getNumberOfElements(),
                content);
    }

    private static String csv(List<WarehouseDocumentView> documents) {
        StringBuilder output = new StringBuilder("\uFEFF");
        appendCsvRow(output, CSV_HEADER);
        for (WarehouseDocumentView document : documents) {
            appendCsvRow(output, List.of(
                    document.documentNo(),
                    directionLabel(document.direction()),
                    document.documentType(),
                    document.warehouseCode(),
                    document.warehouseName(),
                    statusLabel(document.status()),
                    approvalStatusLabel(document.approvalStatus()),
                    sourceLabel(document.source()),
                    Long.toString(document.lineCount()),
                    Long.toString(document.totalQuantity()),
                    decimal(document.totalAmount()),
                    nullable(document.currency()),
                    document.operatorDisplayName(),
                    document.occurredAt().toString(),
                    instant(document.postedAt()),
                    nullable(document.sourceReference())));
        }
        return output.toString();
    }

    private static void appendCsvRow(StringBuilder output, List<String> cells) {
        for (int index = 0; index < cells.size(); index++) {
            if (index > 0) output.append(',');
            output.append(csvCell(cells.get(index)));
        }
        output.append("\r\n");
    }

    private static String csvCell(String value) {
        String safe = nullable(value);
        String stripped = safe.stripLeading();
        if (!stripped.isEmpty() && "=+-@".indexOf(stripped.charAt(0)) >= 0) {
            safe = "'" + safe;
        }
        if (safe.indexOf(',') >= 0 || safe.indexOf('"') >= 0
                || safe.indexOf('\r') >= 0 || safe.indexOf('\n') >= 0) {
            return '"' + safe.replace("\"", "\"\"") + '"';
        }
        return safe;
    }

    private static String nullable(String value) {
        return value == null ? "" : value;
    }

    private static String decimal(BigDecimal value) {
        return value == null ? "" : value.toPlainString();
    }

    private static String instant(Instant value) {
        return value == null ? "" : value.toString();
    }

    private static String directionLabel(Direction value) {
        return value == Direction.INBOUND ? "入库" : "出库";
    }

    private static String sourceLabel(Source value) {
        return switch (value) {
            case MANUAL_MOVEMENT -> "手工出入库";
            case PROCUREMENT_RECEIPT -> "采购签收";
            case WAREHOUSE_TRANSFER -> "分仓调拨";
            case ORDER_FULFILLMENT -> "订单履约出库";
            case INVENTORY_COUNT -> "库存盘点";
        };
    }

    private static String statusLabel(Status value) {
        return switch (value) {
            case DRAFT -> "草稿";
            case SUBMITTED -> "已提交";
            case POSTED -> "已过账";
            case PARTIALLY_REVERSED -> "部分冲销";
            case REVERSED -> "已冲销";
            case CANCELLED -> "已取消";
        };
    }

    private static String approvalStatusLabel(ApprovalStatus value) {
        return switch (value) {
            case NOT_REQUIRED -> "无需审批";
            case PENDING -> "待审批";
            case APPROVED -> "已通过";
            case REJECTED -> "已驳回";
        };
    }

    public record WarehouseDocumentExport(
            String filename,
            String mediaType,
            int rowCount,
            String content) {}

    private static void requireActor(WarehouseDocumentActor actor) {
        if (actor == null || actor.tenantId() == null
                || (actor.userId() == null) == (actor.systemAdminId() == null)) {
            throw new AccessDeniedException("A tenant actor is required");
        }
    }

    private static String normalize(String value) {
        if (value == null || value.isBlank()) return null;
        return value.strip().toLowerCase(Locale.ROOT);
    }
}
