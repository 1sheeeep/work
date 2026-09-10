package cn.xzkj.erp.logistics.tracking;

import cn.xzkj.erp.iam.warehousescope.WarehouseScopeAccess;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeEvaluator;
import cn.xzkj.erp.logistics.tracking.LogisticsTrackingView.PackageStatus;
import cn.xzkj.erp.logistics.tracking.LogisticsTrackingView.SearchField;
import cn.xzkj.erp.platform.service.ConflictException;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class LogisticsTrackingService {
    static final int MAX_EXPORT_ROWS = 10_000;
    private static final String CSV_MEDIA_TYPE = "text/csv;charset=utf-8";
    private static final List<String> CSV_HEADER = List.of(
            "平台编码", "平台名称", "店铺名称", "订单号", "目的国家", "仓库",
            "物流渠道", "主运单号", "备用运单号", "跟踪状态", "固定分类",
            "自定义分类", "发货时间", "更新时间");
    private final LogisticsTrackingRepository repository;
    private final WarehouseScopeEvaluator scopeEvaluator;

    public LogisticsTrackingService(
            LogisticsTrackingRepository repository,
            WarehouseScopeEvaluator scopeEvaluator) {
        this.repository = repository;
        this.scopeEvaluator = scopeEvaluator;
    }

    @Transactional(readOnly = true)
    public Page<LogisticsTrackingView> list(
            LogisticsTrackingActor actor,
            String shop,
            String carrier,
            String country,
            String warehouse,
            String category,
            SearchField searchField,
            String keyword,
            PackageStatus status,
            Instant shippedFrom,
            Instant shippedTo,
            Pageable pageable) {
        requireActor(actor);
        if (shippedFrom != null && shippedTo != null
                && shippedTo.isBefore(shippedFrom)) {
            throw new IllegalArgumentException(
                    "shippedTo must not precede shippedFrom");
        }
        WarehouseScopeAccess scope = scopeEvaluator.evaluate(
                actor.tenantId(), actor.userId(), actor.systemAdminId());
        if (!scope.allowsAll() && scope.warehouseIds().isEmpty()) {
            return Page.empty(pageable);
        }
        return repository.list(
                actor.tenantId(), scope.warehouseIds(), scope.allowsAll(),
                normalize(shop), normalize(carrier), normalizeCountry(country),
                normalize(warehouse), normalize(category),
                searchField == null ? SearchField.ORDER_NO : searchField,
                normalize(keyword), status, shippedFrom, shippedTo, pageable);
    }

    @Transactional(readOnly = true)
    public LogisticsTrackingExport exportCsv(
            LogisticsTrackingActor actor,
            String shop,
            String carrier,
            String country,
            String warehouse,
            String category,
            SearchField searchField,
            String keyword,
            PackageStatus status,
            Instant shippedFrom,
            Instant shippedTo) {
        Page<LogisticsTrackingView> page = list(
                actor, shop, carrier, country, warehouse, category,
                searchField, keyword, status, shippedFrom, shippedTo,
                PageRequest.of(0, MAX_EXPORT_ROWS + 1));
        if (page.getTotalElements() > MAX_EXPORT_ROWS
                || page.getNumberOfElements() > MAX_EXPORT_ROWS) {
            throw new ConflictException(
                    "Logistics tracking export exceeds the supported row limit");
        }
        return new LogisticsTrackingExport(
                "logistics-tracking.csv", CSV_MEDIA_TYPE,
                page.getNumberOfElements(), csv(page.getContent()));
    }

    private static String csv(List<LogisticsTrackingView> items) {
        StringBuilder output = new StringBuilder("\uFEFF");
        appendCsvRow(output, CSV_HEADER);
        for (LogisticsTrackingView item : items) {
            appendCsvRow(output, List.of(
                    item.platformCode(), item.platformName(), item.shopName(),
                    item.orderNo(), nullable(item.countryCode()),
                    nullable(item.warehouseSummary()),
                    nullable(item.logisticsChannel()),
                    nullable(item.trackingReference()),
                    nullable(item.secondaryTrackingReference()),
                    nullable(item.trackingStatus()), nullable(item.fixedCategory()),
                    nullable(item.customCategory()),
                    item.shippedAt() == null ? "" : item.shippedAt().toString(),
                    item.updatedAt().toString()));
        }
        return output.toString();
    }

    private static void appendCsvRow(
            StringBuilder output, List<String> cells) {
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

    private static String normalizeCountry(String value) {
        if (value == null || value.isBlank()) return null;
        return value.strip().toUpperCase(Locale.ROOT);
    }

    public record LogisticsTrackingExport(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }
}
