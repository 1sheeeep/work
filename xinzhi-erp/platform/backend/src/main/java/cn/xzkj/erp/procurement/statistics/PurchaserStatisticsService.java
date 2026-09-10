package cn.xzkj.erp.procurement.statistics;

import cn.xzkj.erp.iam.warehousescope.WarehouseScopeAccess;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeEvaluator;
import cn.xzkj.erp.platform.service.ConflictException;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PurchaserStatisticsService {
    static final int MAX_EXPORT_ROWS = 10_000;
    private static final String CSV_MEDIA_TYPE = "text/csv;charset=utf-8";
    private static final List<String> CSV_HEADER = List.of(
            "统计期间（UTC）", "统计粒度", "采购员名称快照", "采购单数",
            "采购数量", "已收数量", "待收数量", "待审核", "待收货",
            "部分收货", "已收货");
    private final PurchaserStatisticsRepository repository;
    private final WarehouseScopeEvaluator scopeEvaluator;

    public PurchaserStatisticsService(
            PurchaserStatisticsRepository repository,
            WarehouseScopeEvaluator scopeEvaluator) {
        this.repository = repository;
        this.scopeEvaluator = scopeEvaluator;
    }

    @Transactional(readOnly = true)
    public PurchaserStatisticsResult summarize(
            PurchaserStatisticsActor actor,
            PurchaserStatisticsGranularity granularity,
            String purchaser,
            Instant orderedFrom,
            Instant orderedToExclusive,
            Pageable pageable) {
        requireActor(actor);
        if (granularity == null) {
            throw new IllegalArgumentException("granularity is required");
        }
        if (orderedFrom != null && orderedToExclusive != null
                && !orderedToExclusive.isAfter(orderedFrom)) {
            throw new IllegalArgumentException(
                    "orderedToExclusive must be after orderedFrom");
        }
        WarehouseScopeAccess scope = scopeEvaluator.evaluate(
                actor.tenantId(), actor.userId(), actor.systemAdminId());
        if (!scope.allowsAll() && scope.warehouseIds().isEmpty()) {
            return PurchaserStatisticsResult.empty();
        }
        return repository.summarize(
                actor.tenantId(), scope.warehouseIds(), scope.allowsAll(),
                granularity, normalize(purchaser), orderedFrom,
                orderedToExclusive, pageable);
    }

    @Transactional(readOnly = true)
    public PurchaserStatisticsExport exportCsv(
            PurchaserStatisticsActor actor,
            PurchaserStatisticsGranularity granularity,
            String purchaser,
            Instant orderedFrom,
            Instant orderedToExclusive) {
        PurchaserStatisticsResult result = summarize(
                actor, granularity, purchaser, orderedFrom,
                orderedToExclusive,
                PageRequest.of(0, MAX_EXPORT_ROWS + 1));
        if (result.totalGroups() > MAX_EXPORT_ROWS
                || result.items().size() > MAX_EXPORT_ROWS) {
            throw new ConflictException(
                    "Purchaser statistics export exceeds the supported row limit");
        }
        return new PurchaserStatisticsExport(
                "purchaser-statistics.csv", CSV_MEDIA_TYPE,
                result.items().size(), csv(granularity, result.items()));
    }

    private static void requireActor(PurchaserStatisticsActor actor) {
        if (actor == null || actor.tenantId() == null
                || (actor.userId() == null) == (actor.systemAdminId() == null)) {
            throw new AccessDeniedException("A tenant actor is required");
        }
    }

    private static String normalize(String value) {
        if (value == null || value.isBlank()) return null;
        return value.strip().toLowerCase(Locale.ROOT);
    }

    private static String csv(
            PurchaserStatisticsGranularity granularity,
            List<PurchaserStatisticsView> items) {
        StringBuilder output = new StringBuilder("\uFEFF");
        appendCsvRow(output, CSV_HEADER);
        for (PurchaserStatisticsView item : items) {
            appendCsvRow(output, List.of(
                    item.periodStart().toString(), granularity.name(),
                    item.purchaserDisplayName(), Long.toString(item.orderCount()),
                    Long.toString(item.orderedQuantity()),
                    Long.toString(item.receivedQuantity()),
                    Long.toString(item.outstandingQuantity()),
                    Long.toString(item.newOrderCount()),
                    Long.toString(item.approvedOrderCount()),
                    Long.toString(item.partiallyReceivedOrderCount()),
                    Long.toString(item.receivedOrderCount())));
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

    public record PurchaserStatisticsExport(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }
}
