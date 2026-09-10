package cn.xzkj.erp.analytics.orderstatus;

import cn.xzkj.erp.iam.warehousescope.WarehouseScopeAccess;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeEvaluator;
import cn.xzkj.erp.order.domain.OrderStatus;
import cn.xzkj.erp.platform.service.ConflictException;
import java.time.Instant;
import java.util.EnumMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OrderStatusReportService {
    static final int MAX_EXPORT_ROWS = 10_000;
    private static final String CSV_MEDIA_TYPE = "text/csv;charset=utf-8";
    private static final List<String> CSV_HEADER = List.of(
            "日期（UTC）", "订单总数", "待付款", "已接收", "待审核", "待合并",
            "已搁置", "待履约", "履约中", "已发货", "已送达", "已取消");
    private final OrderStatusReportRepository repository;
    private final WarehouseScopeEvaluator scopeEvaluator;

    public OrderStatusReportService(
            OrderStatusReportRepository repository,
            WarehouseScopeEvaluator scopeEvaluator) {
        this.repository = repository;
        this.scopeEvaluator = scopeEvaluator;
    }

    @Transactional(readOnly = true)
    public OrderStatusReportResult summarize(
            OrderStatusReportActor actor,
            String shop,
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
            return OrderStatusReportResult.empty();
        }
        return repository.summarize(
                actor.tenantId(), scope.warehouseIds(), scope.allowsAll(),
                normalize(shop), placedFrom, placedToExclusive, pageable);
    }

    @Transactional(readOnly = true)
    public OrderStatusReportExport exportCsv(
            OrderStatusReportActor actor,
            String shop,
            Instant placedFrom,
            Instant placedToExclusive) {
        OrderStatusReportResult result = summarize(
                actor, shop, placedFrom, placedToExclusive,
                PageRequest.of(0, MAX_EXPORT_ROWS + 1));
        if (result.totalDays() > MAX_EXPORT_ROWS
                || result.items().size() > MAX_EXPORT_ROWS) {
            throw new ConflictException(
                    "Order status report export exceeds the supported row limit");
        }
        return new OrderStatusReportExport(
                "order-status-report.csv", CSV_MEDIA_TYPE,
                result.items().size(), csv(result.items()));
    }

    private static void requireActor(OrderStatusReportActor actor) {
        if (actor == null || actor.tenantId() == null
                || (actor.userId() == null) == (actor.systemAdminId() == null)) {
            throw new AccessDeniedException("A tenant actor is required");
        }
    }

    private static String normalize(String value) {
        if (value == null || value.isBlank()) return null;
        return value.strip().toLowerCase(Locale.ROOT);
    }

    private static String csv(List<OrderStatusReportView> days) {
        StringBuilder output = new StringBuilder("\uFEFF");
        appendCsvRow(output, CSV_HEADER);
        for (OrderStatusReportView day : days) {
            Map<OrderStatus, Long> counts = new EnumMap<>(OrderStatus.class);
            for (OrderStatusReportView.StatusCount status : day.statuses()) {
                counts.merge(status.status(), status.orderCount(), Long::sum);
            }
            appendCsvRow(output, List.of(
                    day.reportDate().toString(), Long.toString(day.orderCount()),
                    count(counts, OrderStatus.UNPAID),
                    count(counts, OrderStatus.RECEIVED),
                    count(counts, OrderStatus.REVIEW_PENDING),
                    count(counts, OrderStatus.MERGE_PENDING),
                    count(counts, OrderStatus.HOLD),
                    count(counts, OrderStatus.READY_TO_FULFILL),
                    count(counts, OrderStatus.FULFILLING),
                    count(counts, OrderStatus.SHIPPED),
                    count(counts, OrderStatus.DELIVERED),
                    count(counts, OrderStatus.CANCELLED)));
        }
        return output.toString();
    }

    private static String count(
            Map<OrderStatus, Long> counts,
            OrderStatus status) {
        return Long.toString(counts.getOrDefault(status, 0L));
    }

    private static void appendCsvRow(
            StringBuilder output,
            List<String> cells) {
        output.append(String.join(",", cells)).append("\r\n");
    }

    public record OrderStatusReportExport(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }
}
