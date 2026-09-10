package cn.xzkj.erp.analytics.productsales;

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
public class ProductSalesReportService {
    static final int MAX_EXPORT_ROWS = 10_000;
    private static final String CSV_MEDIA_TYPE = "text/csv;charset=utf-8";
    private static final List<String> CSV_HEADER = List.of(
            "库存SKU", "SKU名称", "规格", "关联订单数", "销售数量",
            "首次下单", "最近下单");
    private final ProductSalesReportRepository repository;
    private final WarehouseScopeEvaluator scopeEvaluator;

    public ProductSalesReportService(
            ProductSalesReportRepository repository,
            WarehouseScopeEvaluator scopeEvaluator) {
        this.repository = repository;
        this.scopeEvaluator = scopeEvaluator;
    }

    @Transactional(readOnly = true)
    public ProductSalesReportResult summarize(
            ProductSalesReportActor actor,
            String keyword,
            Instant placedFrom,
            Instant placedToExclusive,
            Pageable pageable) {
        requireActor(actor);
        if (placedFrom != null && placedToExclusive != null
                && !placedToExclusive.isAfter(placedFrom)) {
            throw new IllegalArgumentException(
                    "placedToExclusive must be after placedFrom");
        }
        WarehouseScopeAccess scope = scopeEvaluator.evaluate(
                actor.tenantId(), actor.userId(), actor.systemAdminId());
        if (!scope.allowsAll() && scope.warehouseIds().isEmpty()) {
            return ProductSalesReportResult.empty();
        }
        return repository.summarize(
                actor.tenantId(), scope.warehouseIds(), scope.allowsAll(),
                normalize(keyword), placedFrom, placedToExclusive, pageable);
    }

    @Transactional(readOnly = true)
    public ProductSalesReportExport exportCsv(
            ProductSalesReportActor actor,
            String keyword,
            Instant placedFrom,
            Instant placedToExclusive) {
        ProductSalesReportResult result = summarize(
                actor, keyword, placedFrom, placedToExclusive,
                PageRequest.of(0, MAX_EXPORT_ROWS + 1));
        if (result.totalSkuCount() > MAX_EXPORT_ROWS
                || result.items().size() > MAX_EXPORT_ROWS) {
            throw new ConflictException(
                    "Product sales report export exceeds the supported row limit");
        }
        return new ProductSalesReportExport(
                "product-sales-report.csv", CSV_MEDIA_TYPE,
                result.items().size(), csv(result.items()));
    }

    private static void requireActor(ProductSalesReportActor actor) {
        if (actor == null || actor.tenantId() == null
                || (actor.userId() == null) == (actor.systemAdminId() == null)) {
            throw new AccessDeniedException("A tenant actor is required");
        }
    }

    private static String normalize(String value) {
        if (value == null || value.isBlank()) return null;
        return value.strip().toLowerCase(Locale.ROOT);
    }

    private static String csv(List<ProductSalesReportItem> items) {
        StringBuilder output = new StringBuilder("\uFEFF");
        appendCsvRow(output, CSV_HEADER);
        for (ProductSalesReportItem item : items) {
            appendCsvRow(output, List.of(
                    item.skuCode(), item.skuName(), nullable(item.variantSummary()),
                    Long.toString(item.orderCount()),
                    Long.toString(item.salesQuantity()),
                    item.firstPlacedAt().toString(), item.lastPlacedAt().toString()));
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

    public record ProductSalesReportExport(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }
}
