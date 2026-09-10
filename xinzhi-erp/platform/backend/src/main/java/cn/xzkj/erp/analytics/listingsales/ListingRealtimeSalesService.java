package cn.xzkj.erp.analytics.listingsales;

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
public class ListingRealtimeSalesService {
    static final int MAX_EXPORT_ROWS = 10_000;
    private static final String CSV_MEDIA_TYPE = "text/csv;charset=utf-8";
    private static final List<String> CSV_HEADER = List.of(
            "平台编码", "平台名称", "店铺", "Listing", "Listing变体", "库存SKU",
            "SKU名称", "规格", "所选区间销量", "所选区间订单数", "今日销量",
            "昨日销量", "近7天销量", "近28天销量", "近42天销量", "最近下单",
            "统计截至");
    private final ListingRealtimeSalesRepository repository;
    private final WarehouseScopeEvaluator scopeEvaluator;

    public ListingRealtimeSalesService(
            ListingRealtimeSalesRepository repository,
            WarehouseScopeEvaluator scopeEvaluator) {
        this.repository = repository;
        this.scopeEvaluator = scopeEvaluator;
    }

    @Transactional(readOnly = true)
    public ListingRealtimeSalesResult summarize(
            ListingRealtimeSalesActor actor,
            String keyword,
            Instant rangeFrom,
            Instant asOf,
            Pageable pageable) {
        requireActor(actor);
        if (asOf == null) {
            throw new IllegalArgumentException("asOf is required");
        }
        if (rangeFrom != null && !asOf.isAfter(rangeFrom)) {
            throw new IllegalArgumentException("asOf must be after rangeFrom");
        }
        WarehouseScopeAccess scope = scopeEvaluator.evaluate(
                actor.tenantId(), actor.userId(), actor.systemAdminId());
        if (!scope.allowsAll() && scope.warehouseIds().isEmpty()) {
            return ListingRealtimeSalesResult.empty();
        }
        return repository.summarize(
                actor.tenantId(), scope.warehouseIds(), scope.allowsAll(),
                normalize(keyword), rangeFrom, asOf, pageable);
    }

    @Transactional(readOnly = true)
    public ListingRealtimeSalesExport exportCsv(
            ListingRealtimeSalesActor actor,
            String keyword,
            Instant rangeFrom,
            Instant asOf) {
        ListingRealtimeSalesResult result = summarize(
                actor, keyword, rangeFrom, asOf,
                PageRequest.of(0, MAX_EXPORT_ROWS + 1));
        if (result.totalListingCount() > MAX_EXPORT_ROWS
                || result.items().size() > MAX_EXPORT_ROWS) {
            throw new ConflictException(
                    "Listing realtime sales export exceeds the supported row limit");
        }
        return new ListingRealtimeSalesExport(
                "listing-realtime-sales.csv", CSV_MEDIA_TYPE,
                result.items().size(), csv(result.items(), asOf));
    }

    private static void requireActor(ListingRealtimeSalesActor actor) {
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
            List<ListingRealtimeSalesItem> items,
            Instant asOf) {
        StringBuilder output = new StringBuilder("\uFEFF");
        appendCsvRow(output, CSV_HEADER);
        for (ListingRealtimeSalesItem item : items) {
            appendCsvRow(output, List.of(
                    item.platformCode(), item.platformName(), item.shopName(),
                    item.externalListingRef(), nullable(item.externalVariantRef()),
                    item.skuCode(), item.skuName(), nullable(item.variantSummary()),
                    Long.toString(item.rangeSalesQuantity()),
                    Long.toString(item.rangeOrderCount()),
                    Long.toString(item.todaySalesQuantity()),
                    Long.toString(item.yesterdaySalesQuantity()),
                    Long.toString(item.last7DaysSalesQuantity()),
                    Long.toString(item.last28DaysSalesQuantity()),
                    Long.toString(item.last42DaysSalesQuantity()),
                    item.lastPlacedAt().toString(), asOf.toString()));
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

    public record ListingRealtimeSalesExport(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }
}
