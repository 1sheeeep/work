package cn.xzkj.erp.analytics.inventoryaging;

import cn.xzkj.erp.iam.warehousescope.WarehouseScopeAccess;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeEvaluator;
import cn.xzkj.erp.platform.service.ConflictException;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class InventoryAgingReportService {
    static final int MAX_EXPORT_ROWS = 10_000;
    private static final String CSV_MEDIA_TYPE = "text/csv;charset=utf-8";
    private static final List<String> CSV_HEADER = List.of(
            "库存SKU", "商品名称", "仓库编码", "仓库名称", "最早在库日期",
            "最长库龄(天)", "库存总数", "0-30天", "31-60天", "61-90天",
            "91-365天", "365天以上");
    private static final ZoneOffset REPORT_ZONE = ZoneOffset.ofHours(8);
    private static final LocalDate MIN_REPORT_DATE = LocalDate.of(1, 1, 1);
    private static final LocalDate MAX_REPORT_DATE =
            LocalDate.of(9999, 12, 30);

    private final InventoryAgingReportRepository repository;
    private final WarehouseScopeEvaluator scopeEvaluator;

    public InventoryAgingReportService(
            InventoryAgingReportRepository repository,
            WarehouseScopeEvaluator scopeEvaluator) {
        this.repository = repository;
        this.scopeEvaluator = scopeEvaluator;
    }

    @Transactional(readOnly = true)
    public InventoryAgingReportResult summarize(
            InventoryAgingReportActor actor,
            LocalDate cutoffDate,
            UUID warehouseId,
            String keyword,
            Pageable pageable) {
        requireActor(actor);
        requireCutoff(cutoffDate);
        WarehouseScopeAccess scope = scopeEvaluator.evaluate(
                actor.tenantId(), actor.userId(), actor.systemAdminId());
        if (warehouseId != null) {
            scopeEvaluator.requireVisible(scope, warehouseId);
        }
        if (!scope.allowsAll() && scope.warehouseIds().isEmpty()) {
            return InventoryAgingReportResult.empty();
        }
        return repository.summarize(
                actor.tenantId(), scope.warehouseIds(), scope.allowsAll(),
                warehouseId, normalize(keyword), cutoffDate,
                cutoffDate.plusDays(1).atStartOfDay(REPORT_ZONE).toInstant(),
                pageable);
    }

    @Transactional(readOnly = true)
    public InventoryAgingReportExport exportCsv(
            InventoryAgingReportActor actor,
            LocalDate cutoffDate,
            UUID warehouseId,
            String keyword) {
        InventoryAgingReportResult result = summarize(
                actor, cutoffDate, warehouseId, keyword,
                PageRequest.of(0, MAX_EXPORT_ROWS + 1));
        if (result.totalElements() > MAX_EXPORT_ROWS
                || result.items().size() > MAX_EXPORT_ROWS) {
            throw new ConflictException(
                    "Inventory aging report export exceeds the supported row limit");
        }
        return new InventoryAgingReportExport(
                "inventory-aging-report.csv", CSV_MEDIA_TYPE,
                result.items().size(), csv(result.items()));
    }

    private static void requireActor(InventoryAgingReportActor actor) {
        if (actor == null || actor.tenantId() == null
                || (actor.userId() == null) == (actor.systemAdminId() == null)) {
            throw new AccessDeniedException("A tenant actor is required");
        }
    }

    private static void requireCutoff(LocalDate cutoffDate) {
        if (cutoffDate == null
                || cutoffDate.isBefore(MIN_REPORT_DATE)
                || cutoffDate.isAfter(MAX_REPORT_DATE)) {
            throw new IllegalArgumentException(
                    "Inventory aging cutoff date is invalid");
        }
    }

    private static String normalize(String value) {
        if (value == null || value.isBlank()) return null;
        return value.strip().toLowerCase(Locale.ROOT);
    }

    private static String csv(List<InventoryAgingReportItem> items) {
        StringBuilder output = new StringBuilder("\uFEFF");
        appendCsvRow(output, CSV_HEADER);
        for (InventoryAgingReportItem item : items) {
            appendCsvRow(output, List.of(
                    item.skuBusinessCode(), item.skuName(),
                    item.warehouseBusinessCode(), item.warehouseName(),
                    item.oldestInventoryDate().toString(),
                    Integer.toString(item.maximumAgeDays()),
                    Long.toString(item.totalQuantity()),
                    Long.toString(item.age0To30Quantity()),
                    Long.toString(item.age31To60Quantity()),
                    Long.toString(item.age61To90Quantity()),
                    Long.toString(item.age91To365Quantity()),
                    Long.toString(item.ageOver365Quantity())));
        }
        return output.toString();
    }

    private static void appendCsvRow(
            StringBuilder output,
            List<String> cells) {
        for (int index = 0; index < cells.size(); index++) {
            if (index > 0) output.append(',');
            output.append(csvCell(cells.get(index)));
        }
        output.append("\r\n");
    }

    private static String csvCell(String value) {
        String safe = value == null ? "" : value;
        String stripped = safe.stripLeading();
        if (!stripped.matches("-?\\d+")
                && !stripped.isEmpty()
                && "=+-@".indexOf(stripped.charAt(0)) >= 0) {
            safe = "'" + safe;
        }
        if (safe.indexOf(',') >= 0 || safe.indexOf('"') >= 0
                || safe.indexOf('\r') >= 0 || safe.indexOf('\n') >= 0) {
            return '"' + safe.replace("\"", "\"\"") + '"';
        }
        return safe;
    }

    public record InventoryAgingReportExport(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }
}
