package cn.xzkj.erp.logistics.statistics;

import cn.xzkj.erp.iam.warehousescope.WarehouseScopeAccess;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeEvaluator;
import cn.xzkj.erp.logistics.statistics.LogisticsStatisticsView.Dimension;
import cn.xzkj.erp.logistics.tracking.LogisticsTrackingActor;
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
public class LogisticsStatisticsService {
    static final int MAX_EXPORT_ROWS = 10_000;
    private static final String CSV_MEDIA_TYPE = "text/csv;charset=utf-8";
    private static final List<String> CSV_HEADER = List.of(
            "统计维度", "分组值", "跟踪状态", "状态记录数", "分组记录数");
    private final LogisticsStatisticsRepository repository;
    private final WarehouseScopeEvaluator scopeEvaluator;

    public LogisticsStatisticsService(
            LogisticsStatisticsRepository repository,
            WarehouseScopeEvaluator scopeEvaluator) {
        this.repository = repository;
        this.scopeEvaluator = scopeEvaluator;
    }

    @Transactional(readOnly = true)
    public LogisticsStatisticsResult summarize(
            LogisticsTrackingActor actor,
            Dimension dimension,
            String value,
            Instant shippedFrom,
            Instant shippedToExclusive,
            Pageable pageable) {
        requireActor(actor);
        if (shippedFrom != null && shippedToExclusive != null
                && !shippedToExclusive.isAfter(shippedFrom)) {
            throw new IllegalArgumentException(
                    "shippedToExclusive must be after shippedFrom");
        }
        WarehouseScopeAccess scope = scopeEvaluator.evaluate(
                actor.tenantId(), actor.userId(), actor.systemAdminId());
        if (!scope.allowsAll() && scope.warehouseIds().isEmpty()) {
            return LogisticsStatisticsResult.empty();
        }
        Dimension requestedDimension = dimension == null
                ? Dimension.COUNTRY : dimension;
        return repository.summarize(
                actor.tenantId(), scope.warehouseIds(), scope.allowsAll(),
                requestedDimension, normalize(value), shippedFrom,
                shippedToExclusive, pageable);
    }

    @Transactional(readOnly = true)
    public LogisticsStatisticsExport exportCsv(
            LogisticsTrackingActor actor,
            Dimension dimension,
            String value,
            Instant shippedFrom,
            Instant shippedToExclusive) {
        Dimension requestedDimension = dimension == null
                ? Dimension.COUNTRY : dimension;
        LogisticsStatisticsResult result = summarize(
                actor, requestedDimension, value, shippedFrom,
                shippedToExclusive,
                PageRequest.of(0, MAX_EXPORT_ROWS + 1));
        if (result.totalGroups() > MAX_EXPORT_ROWS
                || result.items().size() > MAX_EXPORT_ROWS) {
            throw new ConflictException(
                    "Logistics statistics export exceeds the supported row limit");
        }
        long rowCount = result.items().stream()
                .mapToLong(group -> group.statuses().size())
                .sum();
        if (rowCount > MAX_EXPORT_ROWS) {
            throw new ConflictException(
                    "Logistics statistics export exceeds the supported row limit");
        }
        return new LogisticsStatisticsExport(
                "logistics-statistics.csv", CSV_MEDIA_TYPE,
                Math.toIntExact(rowCount),
                csv(requestedDimension, result.items()));
    }

    private static void requireActor(LogisticsTrackingActor actor) {
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
            Dimension dimension,
            List<LogisticsStatisticsView> groups) {
        StringBuilder output = new StringBuilder("\uFEFF");
        appendCsvRow(output, CSV_HEADER);
        String dimensionLabel = dimension == Dimension.COUNTRY
                ? "国家/地区" : "物流渠道";
        for (LogisticsStatisticsView group : groups) {
            for (LogisticsStatisticsView.StatusCount status : group.statuses()) {
                appendCsvRow(output, List.of(
                        dimensionLabel, nullable(group.groupValue()),
                        nullable(status.status()),
                        Long.toString(status.recordCount()),
                        Long.toString(group.recordCount())));
            }
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
        String safe = nullable(value);
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

    private static String nullable(String value) {
        return value == null ? "" : value;
    }

    public record LogisticsStatisticsExport(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }
}
