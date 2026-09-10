package cn.xzkj.erp.analytics.inventoryperiod;

import cn.xzkj.erp.iam.warehousescope.WarehouseScopeAccess;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeEvaluator;
import cn.xzkj.erp.platform.service.ConflictException;
import java.time.Instant;
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
public class InventoryPeriodReportService {
    static final int MAX_EXPORT_ROWS = 10_000;
    private static final String CSV_MEDIA_TYPE = "text/csv;charset=utf-8";
    private static final List<String> CSV_HEADER = List.of(
            "库存SKU", "商品名称", "仓库编码", "仓库名称", "期初数量",
            "期间增加", "期间减少", "期末数量");
    private static final ZoneOffset REPORT_ZONE = ZoneOffset.ofHours(8);
    private static final LocalDate MIN_REPORT_DATE = LocalDate.of(1, 1, 1);
    private static final LocalDate MAX_REPORT_DATE =
            LocalDate.of(9999, 12, 30);

    private final InventoryPeriodReportRepository repository;
    private final WarehouseScopeEvaluator scopeEvaluator;

    public InventoryPeriodReportService(
            InventoryPeriodReportRepository repository,
            WarehouseScopeEvaluator scopeEvaluator) {
        this.repository = repository;
        this.scopeEvaluator = scopeEvaluator;
    }

    @Transactional(readOnly = true)
    public InventoryPeriodReportResult summarize(
            InventoryPeriodReportActor actor,
            LocalDate periodFrom,
            LocalDate periodTo,
            UUID warehouseId,
            String keyword,
            Pageable pageable) {
        requireActor(actor);
        requirePeriod(periodFrom, periodTo);
        WarehouseScopeAccess scope = scopeEvaluator.evaluate(
                actor.tenantId(), actor.userId(), actor.systemAdminId());
        if (warehouseId != null) {
            scopeEvaluator.requireVisible(scope, warehouseId);
        }
        if (!scope.allowsAll() && scope.warehouseIds().isEmpty()) {
            return InventoryPeriodReportResult.empty();
        }
        Instant from = periodFrom.atStartOfDay(REPORT_ZONE).toInstant();
        Instant toExclusive = periodTo.plusDays(1)
                .atStartOfDay(REPORT_ZONE).toInstant();
        return repository.summarize(
                actor.tenantId(), scope.warehouseIds(), scope.allowsAll(),
                warehouseId, normalize(keyword), from, toExclusive,
                pageable);
    }

    @Transactional(readOnly = true)
    public InventoryPeriodReportExport exportCsv(
            InventoryPeriodReportActor actor,
            LocalDate periodFrom,
            LocalDate periodTo,
            UUID warehouseId,
            String keyword) {
        InventoryPeriodReportResult result = summarize(
                actor, periodFrom, periodTo, warehouseId, keyword,
                PageRequest.of(0, MAX_EXPORT_ROWS + 1));
        if (result.totalElements() > MAX_EXPORT_ROWS
                || result.items().size() > MAX_EXPORT_ROWS) {
            throw new ConflictException(
                    "Inventory period report export exceeds the supported row limit");
        }
        return new InventoryPeriodReportExport(
                "inventory-period-report.csv", CSV_MEDIA_TYPE,
                result.items().size(), csv(result.items()));
    }

    private static void requireActor(InventoryPeriodReportActor actor) {
        if (actor == null || actor.tenantId() == null
                || (actor.userId() == null) == (actor.systemAdminId() == null)) {
            throw new AccessDeniedException("A tenant actor is required");
        }
    }

    private static void requirePeriod(LocalDate from, LocalDate to) {
        if (from == null || to == null) {
            throw new IllegalArgumentException(
                    "Inventory report period is required");
        }
        if (from.isBefore(MIN_REPORT_DATE) || from.isAfter(MAX_REPORT_DATE)
                || to.isBefore(MIN_REPORT_DATE)
                || to.isAfter(MAX_REPORT_DATE)) {
            throw new IllegalArgumentException(
                    "Inventory report period is outside the supported range");
        }
        if (from.isAfter(to)) {
            throw new IllegalArgumentException(
                    "Inventory report start date cannot exceed end date");
        }
    }

    private static String normalize(String value) {
        if (value == null || value.isBlank()) return null;
        return value.strip().toLowerCase(Locale.ROOT);
    }

    private static String csv(List<InventoryPeriodReportItem> items) {
        StringBuilder output = new StringBuilder("\uFEFF");
        appendCsvRow(output, CSV_HEADER);
        for (InventoryPeriodReportItem item : items) {
            appendCsvRow(output, List.of(
                    item.skuBusinessCode(), item.skuName(),
                    item.warehouseBusinessCode(), item.warehouseName(),
                    Long.toString(item.openingQuantity()),
                    Long.toString(item.increasedQuantity()),
                    Long.toString(item.decreasedQuantity()),
                    Long.toString(item.closingQuantity())));
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

    public record InventoryPeriodReportExport(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }
}
