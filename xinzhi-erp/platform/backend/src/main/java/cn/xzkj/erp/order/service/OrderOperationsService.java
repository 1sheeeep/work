package cn.xzkj.erp.order.service;

import java.nio.charset.StandardCharsets;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.order.api.OrderOperationsDtos.BulkStatusItem;
import cn.xzkj.erp.order.api.OrderOperationsDtos.TransferFilterRequest;
import cn.xzkj.erp.order.api.OrderOperationsDtos.TransferResultResponse;
import cn.xzkj.erp.order.domain.OrderListItem;
import cn.xzkj.erp.order.domain.OrderStatus;
import cn.xzkj.erp.order.repository.OrderListQueryRepository;
import cn.xzkj.erp.order.repository.OrderListQueryRepository.Query;
import cn.xzkj.erp.order.repository.OrderTransferRepository;
import cn.xzkj.erp.order.repository.OrderTransferRepository.TransferJob;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.order.service.OrderCenterService.CreateLineCommand;
import cn.xzkj.erp.order.service.OrderCenterService.CreateOrderCommand;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;

@Service
public class OrderOperationsService {

    private static final int MAX_EXPORT_ROWS = 10_000;
    private static final int MAX_IMPORT_BYTES = 2 * 1024 * 1024;
    private static final int MAX_IMPORT_ROWS = 5_000;
    private static final int MAX_IMPORT_ORDERS = 200;
    private static final String BULK_STATUS_COMPLETED = "order.bulk_status.completed";
    private static final String EXPORT_COMPLETED = "order.export.completed";
    private static final String IMPORT_COMPLETED = "order.import.completed";
    private static final List<String> IMPORT_HEADER = List.of(
            "externalOrderRef", "shopId", "placedAt", "currency",
            "buyerReference", "externalLineRef", "title", "quantity",
            "unitPriceMinor", "skuId", "externalListingRef",
            "externalVariantRef");
    private static final DateTimeFormatter FILE_TIME =
            DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss").withZone(ZoneOffset.UTC);

    private final OrderCenterService orderService;
    private final OrderListQueryRepository listRepository;
    private final OrderTransferRepository transferRepository;
    private final SecurityAuditRecorder auditRecorder;
    private final Clock clock;

    @Autowired
    public OrderOperationsService(
            OrderCenterService orderService,
            OrderListQueryRepository listRepository,
            OrderTransferRepository transferRepository,
            SecurityAuditRecorder auditRecorder) {
        this(orderService, listRepository, transferRepository,
                auditRecorder, Clock.systemUTC());
    }

    OrderOperationsService(
            OrderCenterService orderService,
            OrderListQueryRepository listRepository,
            OrderTransferRepository transferRepository,
            SecurityAuditRecorder auditRecorder,
            Clock clock) {
        this.orderService = orderService;
        this.listRepository = listRepository;
        this.transferRepository = transferRepository;
        this.auditRecorder = auditRecorder;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public TransferPage listTransfers(UUID tenantId, int page, int size) {
        if (tenantId == null || page < 0 || page > 1_000_000
                || size < 1 || size > 200) {
            throw new IllegalArgumentException("Invalid transfer page");
        }
        List<TransferJob> items = transferRepository.list(tenantId, page, size);
        long total = transferRepository.count(tenantId);
        return new TransferPage(items, page, size, total,
                total == 0 ? 0 : (int) ((total + size - 1) / size));
    }

    @Transactional
    public TransferResultResponse bulkStatus(
            OrderActor actor,
            UUID commandId,
            OrderStatus targetStatus,
            String reason,
            List<BulkStatusItem> requested) {
        if (actor == null || actor.tenantId() == null || commandId == null
                || targetStatus == null || requested == null || requested.isEmpty()
                || requested.size() > 200) {
            throw new IllegalArgumentException("Invalid bulk status request");
        }
        List<BulkStatusItem> items = requested.stream()
                .sorted(Comparator.comparing(BulkStatusItem::orderId))
                .toList();
        Set<UUID> unique = new HashSet<>();
        if (items.stream().anyMatch(item -> item.orderId() == null
                || item.version() < 0 || !unique.add(item.orderId()))) {
            throw new IllegalArgumentException("Bulk order identities must be unique");
        }
        String fingerprint = fingerprint(targetStatus, reason, items);
        transferRepository.lockCommand(actor.tenantId(), commandId);
        var replay = transferRepository.findCommand(actor.tenantId(), commandId).orElse(null);
        if (replay != null) {
            if (!Objects.equals(replay.fingerprint(), fingerprint)) {
                throw new ConflictException("Bulk command conflicts with an existing command");
            }
            return new TransferResultResponse(
                    replay.id(), replay.status(), replay.requestedCount(),
                    replay.succeededCount(), replay.failedCount(),
                    null, null, null);
        }

        for (BulkStatusItem item : items) {
            orderService.changeStatus(
                    actor, item.orderId(), item.version(), targetStatus, reason);
        }
        UUID jobId = transferRepository.recordCompletedCommand(
                actor.tenantId(), actor.userId(), actor.systemAdminId(),
                "BULK_STATUS", items.size(), commandId, fingerprint);
        audit(actor, BULK_STATUS_COMPLETED, jobId, Map.of(
                "targetStatus", targetStatus.name(),
                "orderCount", Integer.toString(items.size()),
                "commandId", commandId.toString()));
        return new TransferResultResponse(
                jobId, "SUCCEEDED", items.size(), items.size(), 0,
                null, null, null);
    }

    @Transactional
    public TransferResultResponse exportCsv(
            OrderActor actor, TransferFilterRequest filter) {
        requireActor(actor);
        Query query = query(filter);
        validateQuery(actor.tenantId(), query);
        var result = orderService.searchOrders(
                actor, query, 0, MAX_EXPORT_ROWS + 1);
        if (result.items().size() > MAX_EXPORT_ROWS) {
            throw new ConflictException("Export result exceeds the supported row limit");
        }
        byte[] content = csv(result.items()).getBytes(StandardCharsets.UTF_8);
        String filename = "orders-" + FILE_TIME.format(clock.instant()) + ".csv";
        UUID jobId = transferRepository.recordCompleted(
                actor.tenantId(), actor.userId(), actor.systemAdminId(),
                "EXPORT", result.items().size(), result.items().size(), 0,
                "inline:" + filename, filename, "text/csv", content);
        audit(actor, EXPORT_COMPLETED, jobId, Map.of(
                "rowCount", Integer.toString(result.items().size()),
                "format", "CSV"));
        return new TransferResultResponse(
                jobId, "SUCCEEDED", result.items().size(),
                result.items().size(), 0, filename, "text/csv",
                Base64.getEncoder().encodeToString(content));
    }

    @Transactional
    public TransferResultResponse importCsv(
            OrderActor actor, String idempotencyKey, byte[] content) {
        return importCsv(actor, idempotencyKey, "orders-import.csv", content);
    }

    @Transactional
    public TransferResultResponse importCsv(
            OrderActor actor, String idempotencyKey, String sourceFilename,
            byte[] content) {
        requireActor(actor);
        String filename = sourceFilename(sourceFilename);
        if (idempotencyKey == null
                || !idempotencyKey.matches("^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$")
                || content == null || content.length == 0
                || content.length > MAX_IMPORT_BYTES) {
            throw new IllegalArgumentException("Invalid order import");
        }
        List<List<String>> rows = parseCsv(content);
        if (rows.isEmpty() || !rows.getFirst().equals(IMPORT_HEADER)) {
            throw new IllegalArgumentException("CSV header does not match the order import contract");
        }
        if (rows.size() == 1 || rows.size() - 1 > MAX_IMPORT_ROWS) {
            throw new IllegalArgumentException("CSV row count is outside the supported range");
        }
        LinkedHashMap<String, CsvOrder> orders = new LinkedHashMap<>();
        for (int index = 1; index < rows.size(); index++) {
            List<String> row = rows.get(index);
            if (row.size() != IMPORT_HEADER.size()) {
                throw new IllegalArgumentException("CSV row has an invalid column count");
            }
            CsvLine line = csvLine(row);
            orders.compute(line.externalOrderRef(), (key, current) -> {
                if (current == null) {
                    return new CsvOrder(
                            line.shopId(), line.externalOrderRef(),
                            line.currency(), line.buyerReference(),
                            line.placedAt(), new ArrayList<>(List.of(line.command())));
                }
                current.requireSameHeader(line);
                current.lines().add(line.command());
                return current;
            });
        }
        if (orders.size() > MAX_IMPORT_ORDERS) {
            throw new IllegalArgumentException("CSV contains too many orders");
        }
        int index = 0;
        for (CsvOrder order : orders.values()) {
            String key = "imp." + sha256(idempotencyKey + "\n"
                    + order.externalOrderRef()).substring(0, 48)
                    + "." + index++;
            orderService.createOrder(actor, new CreateOrderCommand(
                    order.shopId(), order.externalOrderRef(), key,
                    order.currency(), order.buyerReference(),
                    order.placedAt(), List.copyOf(order.lines())));
        }
        UUID jobId = transferRepository.recordCompleted(
                actor.tenantId(), actor.userId(), actor.systemAdminId(),
                "IMPORT", orders.size(), orders.size(), 0,
                "upload:" + filename, null, null, null);
        audit(actor, IMPORT_COMPLETED, jobId, Map.of(
                "orderCount", Integer.toString(orders.size()),
                "rowCount", Integer.toString(rows.size() - 1),
                "format", "CSV"));
        return new TransferResultResponse(
                jobId, "SUCCEEDED", orders.size(), orders.size(), 0,
                null, null, null);
    }

    private void validateQuery(UUID tenantId, Query query) {
        if (query.shopId() != null
                && !listRepository.shopExists(tenantId, query.shopId())) {
            throw new ResourceNotFoundException("Shop not found");
        }
        if (query.warehouseId() != null
                && !listRepository.warehouseExists(tenantId, query.warehouseId())) {
            throw new ResourceNotFoundException("Warehouse not found");
        }
        if (invalidRange(query.minAmountMinor(), query.maxAmountMinor())
                || invalidRange(query.minWeightGrams(), query.maxWeightGrams())
                || invalidRange(query.placedFrom(), query.placedTo())
                || invalidRange(query.paidFrom(), query.paidTo())
                || invalidRange(query.minProductKinds(),
                        query.maxProductKinds())
                || invalidRange(query.timeFrom1(), query.timeTo1())
                || invalidRange(query.timeFrom2(), query.timeTo2())) {
            throw new IllegalArgumentException("Invalid export filter range");
        }
    }

    private static Query query(TransferFilterRequest filter) {
        TransferFilterRequest safe = filter == null
                ? new TransferFilterRequest(
                        null, null, null, null, null, null, null, null,
                        null, null, null, null, null, null, null, null,
                        null, null, null, null)
                : filter;
        return new Query(
                safe.shopId(), safe.warehouseId(), safe.status(),
                safe.paymentStatus(), safe.platformStatus(), safe.countryCode(),
                safe.trackingStatus(), safe.currency(), safe.printed(),
                safe.reshipment(), safe.minAmountMinor(), safe.maxAmountMinor(),
                safe.minWeightGrams(), safe.maxWeightGrams(),
                safe.placedFrom(), safe.placedTo(), safe.paidFrom(), safe.paidTo(),
                trim(safe.keyword()), trim(safe.skuKeyword()),
                safe.platformId(), safe.stage(),
                trim(safe.logisticsChannel()),
                trim(safe.fixedCategory()),
                trim(safe.customCategory()),
                trim(safe.customerCategory()),
                safe.locationId(), safe.pickerUserId(),
                safe.shipperUserId(), safe.salespersonUserId(),
                safe.purchaserUserId(), safe.developerUserId(),
                safe.managerUserId(), trim(safe.supplierReference()),
                trim(safe.parentProductCategory()),
                trim(safe.childProductCategory()),
                trim(safe.productStatus()),
                trim(safe.extendedAttribute()),
                safe.minProductKinds(), safe.maxProductKinds(),
                safe.conditionField1(), safe.conditionOperator1(),
                trim(safe.conditionValue1()),
                safe.conditionField2(), safe.conditionOperator2(),
                trim(safe.conditionValue2()), safe.conditionLogic(),
                safe.timeField1(), safe.timeFrom1(), safe.timeTo1(),
                safe.timeField2(), safe.timeFrom2(), safe.timeTo2(),
                safe.sortField(), safe.sortDirection());
    }

    private static String csv(List<OrderListItem> items) {
        StringBuilder output = new StringBuilder(768 + items.size() * 480);
        output.append('\ufeff');
        output.append("订单号,下单时间,店铺ID,店铺名称,买家引用,订单状态,平台状态,付款状态,")
                .append("国家,省州,邮编,物流渠道,买家选择物流,跟踪状态,币种,")
                .append("订单金额最小单位,实付金额最小单位,商品金额最小单位,运费收入最小单位,")
                .append("物流支出最小单位,预估物流支出最小单位,平台费用最小单位,保险费用最小单位,")
                .append("支付手续费最小单位,其他收入最小单位,其他支出最小单位,税费最小单位,")
                .append("利润最小单位,重量克,明细数,SKU摘要,商品摘要\n");
        for (OrderListItem item : items) {
            appendRow(output, List.of(
                    item.externalOrderRef(),
                    item.placedAt().toString(),
                    item.shopId().toString(),
                    Objects.toString(item.shopName(), ""),
                    Objects.toString(item.buyerReference(), ""),
                    item.status().name(),
                    Objects.toString(item.platformStatus(), ""),
                    Objects.toString(item.paymentStatus(), ""),
                    Objects.toString(item.countryCode(), ""),
                    Objects.toString(item.province(), ""),
                    Objects.toString(item.postalCode(), ""),
                    Objects.toString(item.logisticsChannel(), ""),
                    Objects.toString(item.buyerSelectedLogistics(), ""),
                    Objects.toString(item.trackingStatus(), ""),
                    item.currency(),
                    Objects.toString(item.totalAmountMinor(), ""),
                    Objects.toString(item.actualPaidMinor(), ""),
                    Objects.toString(item.itemAmountMinor(), ""),
                    Objects.toString(item.shippingAmountMinor(), ""),
                    Objects.toString(item.actualShippingMinor(), ""),
                    Objects.toString(item.estimatedShippingMinor(), ""),
                    Objects.toString(item.platformFeeMinor(), ""),
                    Objects.toString(item.insuranceFeeMinor(), ""),
                    Objects.toString(item.paymentFeeMinor(), ""),
                    Objects.toString(item.otherIncomeMinor(), ""),
                    Objects.toString(item.otherExpenseMinor(), ""),
                    Objects.toString(item.taxMinor(), ""),
                    Objects.toString(item.profitMinor(), ""),
                    Objects.toString(item.weightGrams(), ""),
                    Integer.toString(item.lineCount()),
                    Objects.toString(item.skuSummary(), ""),
                    Objects.toString(item.titleSummary(), "")));
        }
        return output.toString();
    }

    private static void appendRow(StringBuilder target, List<String> values) {
        for (int index = 0; index < values.size(); index++) {
            if (index > 0) {
                target.append(',');
            }
            String value = spreadsheetSafe(values.get(index)).replace("\"", "\"\"");
            target.append('"').append(value).append('"');
        }
        target.append('\n');
    }

    private static String spreadsheetSafe(String value) {
        if (value == null || value.isEmpty()) {
            return "";
        }
        int index = 0;
        while (index < value.length()
                && Character.isWhitespace(value.charAt(index))) {
            index++;
        }
        if (index < value.length()
                && "=+-@".indexOf(value.charAt(index)) >= 0) {
            return "'" + value;
        }
        return value;
    }

    private static CsvLine csvLine(List<String> row) {
        try {
            String externalOrderRef = required(row.get(0), 160);
            UUID shopId = UUID.fromString(row.get(1));
            Instant placedAt = Instant.parse(row.get(2));
            String currency = required(row.get(3), 3).toUpperCase();
            if (!currency.matches("^[A-Z]{3}$")) {
                throw new IllegalArgumentException("Invalid currency");
            }
            String buyerReference = optional(row.get(4), 200);
            String externalLineRef = required(row.get(5), 160);
            String title = required(row.get(6), 300);
            int quantity = Integer.parseInt(row.get(7));
            long unitPriceMinor = Long.parseLong(row.get(8));
            UUID skuId = row.get(9).isBlank() ? null : UUID.fromString(row.get(9));
            String listing = optional(row.get(10), 160);
            String variant = optional(row.get(11), 160);
            if (quantity < 1 || unitPriceMinor < 0
                    || (variant != null && listing == null)) {
                throw new IllegalArgumentException("Invalid order line values");
            }
            return new CsvLine(
                    shopId, externalOrderRef, placedAt, currency, buyerReference,
                    new CreateLineCommand(
                            skuId, listing, variant, externalLineRef, title,
                            quantity, unitPriceMinor, currency));
        } catch (RuntimeException exception) {
            throw new IllegalArgumentException("CSV contains an invalid order row", exception);
        }
    }

    private static List<List<String>> parseCsv(byte[] bytes) {
        String text;
        try {
            text = StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes)).toString();
        } catch (CharacterCodingException exception) {
            throw new IllegalArgumentException("CSV must be valid UTF-8", exception);
        }
        if (text.startsWith("\ufeff")) {
            text = text.substring(1);
        }
        List<List<String>> rows = new ArrayList<>();
        List<String> row = new ArrayList<>();
        StringBuilder field = new StringBuilder();
        boolean quoted = false;
        for (int index = 0; index < text.length(); index++) {
            char character = text.charAt(index);
            if (quoted) {
                if (character == '"' && index + 1 < text.length()
                        && text.charAt(index + 1) == '"') {
                    field.append('"');
                    index++;
                } else if (character == '"') {
                    quoted = false;
                } else {
                    field.append(character);
                }
            } else if (character == '"' && field.isEmpty()) {
                quoted = true;
            } else if (character == ',') {
                row.add(field.toString());
                field.setLength(0);
            } else if (character == '\n') {
                row.add(stripCarriageReturn(field.toString()));
                rows.add(List.copyOf(row));
                row.clear();
                field.setLength(0);
            } else {
                field.append(character);
            }
        }
        if (quoted) {
            throw new IllegalArgumentException("CSV contains an unclosed quoted field");
        }
        if (!field.isEmpty() || !row.isEmpty()) {
            row.add(stripCarriageReturn(field.toString()));
            rows.add(List.copyOf(row));
        }
        if (!rows.isEmpty() && rows.getLast().stream().allMatch(String::isBlank)) {
            rows.removeLast();
        }
        return rows;
    }

    private static String stripCarriageReturn(String value) {
        return value.endsWith("\r")
                ? value.substring(0, value.length() - 1) : value;
    }

    private static String required(String value, int max) {
        String result = optional(value, max);
        if (result == null) {
            throw new IllegalArgumentException("A required CSV value is missing");
        }
        return result;
    }

    private static String optional(String value, int max) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String result = value.strip();
        if (result.length() > max
                || result.chars().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException("CSV value is invalid");
        }
        return result;
    }

    private static String sourceFilename(String value) {
        String candidate = value == null ? "" : value.strip();
        int separator = Math.max(candidate.lastIndexOf('/'),
                candidate.lastIndexOf('\\'));
        if (separator >= 0) {
            candidate = candidate.substring(separator + 1).strip();
        }
        if (candidate.isEmpty()) {
            return "orders-import.csv";
        }
        if (candidate.length() > 160
                || candidate.chars().anyMatch(Character::isISOControl)
                || !candidate.toLowerCase(java.util.Locale.ROOT).endsWith(".csv")) {
            throw new IllegalArgumentException("CSV filename is invalid");
        }
        return candidate;
    }

    private void audit(
            OrderActor actor,
            String action,
            UUID jobId,
            Map<String, String> details) {
        requireActor(actor);
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(), action,
                "order_transfer_job", jobId.toString(), actor.requestId(),
                actor.sourceIp(), details));
    }

    private static String fingerprint(
            OrderStatus targetStatus,
            String reason,
            List<BulkStatusItem> items) {
        StringBuilder canonical = new StringBuilder(targetStatus.name())
                .append('\n').append(Objects.toString(trim(reason), "")).append('\n');
        items.forEach(item -> canonical.append(item.orderId()).append(':')
                .append(item.version()).append('\n'));
        return sha256(canonical.toString());
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 unavailable", exception);
        }
    }

    private static String trim(String value) {
        return value == null || value.isBlank() ? null : value.strip();
    }

    private static <T extends Comparable<T>> boolean invalidRange(T from, T to) {
        return from != null && to != null && from.compareTo(to) > 0;
    }

    private static void requireActor(OrderActor actor) {
        if (actor == null || actor.tenantId() == null
                || (actor.userId() == null) == (actor.systemAdminId() == null)) {
            throw new IllegalArgumentException("A tenant actor is required");
        }
    }

    public record TransferPage(
            List<TransferJob> items,
            int page,
            int size,
            long totalElements,
            int totalPages) {
    }

    private record CsvLine(
            UUID shopId,
            String externalOrderRef,
            Instant placedAt,
            String currency,
            String buyerReference,
            CreateLineCommand command) {
    }

    private record CsvOrder(
            UUID shopId,
            String externalOrderRef,
            String currency,
            String buyerReference,
            Instant placedAt,
            List<CreateLineCommand> lines) {
        void requireSameHeader(CsvLine line) {
            if (!shopId.equals(line.shopId())
                    || !currency.equals(line.currency())
                    || !Objects.equals(buyerReference, line.buyerReference())
                    || !placedAt.equals(line.placedAt())) {
                throw new IllegalArgumentException(
                        "Rows for the same order have conflicting header values");
            }
        }
    }
}
