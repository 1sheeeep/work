package cn.xzkj.erp.inventory.service;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeAccess;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeEvaluator;
import cn.xzkj.erp.inventory.domain.InventoryEventType;
import cn.xzkj.erp.inventory.domain.WarehouseTransferAllocationMethod;
import cn.xzkj.erp.inventory.domain.WarehouseTransferStatus;
import cn.xzkj.erp.inventory.domain.WarehouseTransferTransportMode;
import cn.xzkj.erp.inventory.repository.WarehouseTransferRepository;
import cn.xzkj.erp.inventory.repository.WarehouseTransferRepository.CommandRecord;
import cn.xzkj.erp.platform.domain.SensitiveTextRedactor;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.warehouse.domain.WarehouseStatus;
import cn.xzkj.erp.warehouse.repository.WarehouseRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class WarehouseTransferService {
    static final int MAX_EXPORT_ROWS = 10_000;
    private static final String CSV_MEDIA_TYPE = "text/csv;charset=utf-8";
    private static final List<String> CSV_HEADER = List.of(
            "调拨批次", "状态", "调拨日期", "起始仓库编码", "起始仓库名称",
            "目标仓库编码", "目标仓库名称", "运输方式", "SKU个数", "调拨数量",
            "物流渠道", "跟踪号", "运费金额(最小货币单位)", "货币", "计费方式",
            "预计发货时间", "预计到货时间", "备注", "操作人", "审批人",
            "发货人", "签收人", "创建时间", "更新时间");
    private static final int MAX_LINES = 200;
    private static final long MAX_QUANTITY = 1_000_000_000L;
    private static final Pattern CURRENCY = Pattern.compile("^[A-Z]{3}$");
    private static final String RESOURCE_TYPE = "warehouse_transfer";
    private static final String CREATED = "inventory.transfer.created";
    private static final String SUBMITTED = "inventory.transfer.submitted";
    private static final String APPROVED = "inventory.transfer.approved";
    private static final String REJECTED = "inventory.transfer.rejected";
    private static final String SHIPPED = "inventory.transfer.shipped";
    private static final String PARTIALLY_RECEIVED =
            "inventory.transfer.partially_received";
    private static final String RECEIVED = "inventory.transfer.received";
    private static final String CANCELLED = "inventory.transfer.cancelled";

    private final WarehouseTransferRepository repository;
    private final WarehouseRepository warehouseRepository;
    private final InventoryService inventoryService;
    private final WarehouseScopeEvaluator scopeEvaluator;
    private final SecurityAuditRecorder auditRecorder;

    public WarehouseTransferService(
            WarehouseTransferRepository repository,
            WarehouseRepository warehouseRepository,
            InventoryService inventoryService,
            WarehouseScopeEvaluator scopeEvaluator,
            SecurityAuditRecorder auditRecorder) {
        this.repository = repository;
        this.warehouseRepository = warehouseRepository;
        this.inventoryService = inventoryService;
        this.scopeEvaluator = scopeEvaluator;
        this.auditRecorder = auditRecorder;
    }

    @Transactional(readOnly = true)
    public Page<WarehouseTransferSummary> list(
            WarehouseTransferActor actor,
            UUID sourceWarehouseId,
            UUID targetWarehouseId,
            WarehouseTransferStatus status,
            WarehouseTransferTransportMode transportMode,
            WarehouseTransferSearchField searchField,
            String keyword,
            LocalDate from,
            LocalDate to,
            Pageable pageable) {
        return list(
                actor, sourceWarehouseId, targetWarehouseId,
                status == null ? List.of() : List.of(status),
                transportMode, searchField, keyword, from, to, pageable);
    }

    @Transactional(readOnly = true)
    public Page<WarehouseTransferSummary> list(
            WarehouseTransferActor actor,
            UUID sourceWarehouseId,
            UUID targetWarehouseId,
            List<WarehouseTransferStatus> statuses,
            WarehouseTransferTransportMode transportMode,
            WarehouseTransferSearchField searchField,
            String keyword,
            LocalDate from,
            LocalDate to,
            Pageable pageable) {
        UUID tenantId = requireActor(actor);
        WarehouseScopeAccess scope = scope(actor);
        if (sourceWarehouseId != null) {
            scopeEvaluator.requireVisible(scope, sourceWarehouseId);
        }
        if (targetWarehouseId != null) {
            scopeEvaluator.requireVisible(scope, targetWarehouseId);
        }
        if (from != null && to != null && from.isAfter(to)) {
            throw new IllegalArgumentException("Invalid warehouse transfer date range");
        }
        List<WarehouseTransferStatus> normalizedStatuses = statuses == null
                ? List.of()
                : statuses.stream().distinct().toList();
        if (normalizedStatuses.size() > 2) {
            throw new IllegalArgumentException(
                    "Warehouse transfer list supports at most two statuses");
        }
        if (!scope.allowsAll() && scope.warehouseIds().isEmpty()) {
            return Page.empty(pageable);
        }
        return repository.list(
                tenantId,
                scope.warehouseIds(),
                scope.allowsAll(),
                sourceWarehouseId,
                targetWarehouseId,
                normalizedStatuses,
                transportMode,
                searchField == null ? WarehouseTransferSearchField.BATCH : searchField,
                normalizeKeyword(keyword),
                from,
                to,
                pageable);
    }

    @Transactional(readOnly = true)
    public WarehouseTransferExport exportCsv(
            WarehouseTransferActor actor,
            UUID sourceWarehouseId,
            UUID targetWarehouseId,
            List<WarehouseTransferStatus> statuses,
            WarehouseTransferTransportMode transportMode,
            WarehouseTransferSearchField searchField,
            String keyword,
            LocalDate from,
            LocalDate to) {
        Page<WarehouseTransferSummary> page = list(
                actor, sourceWarehouseId, targetWarehouseId, statuses,
                transportMode, searchField, keyword, from, to,
                PageRequest.of(0, MAX_EXPORT_ROWS + 1));
        List<WarehouseTransferSummary> rows = page.getContent();
        if (page.getTotalElements() > MAX_EXPORT_ROWS
                || rows.size() > MAX_EXPORT_ROWS) {
            throw new ConflictException(
                    "Warehouse transfer export exceeds the supported row limit");
        }
        return new WarehouseTransferExport(
                "warehouse-transfers.csv", CSV_MEDIA_TYPE,
                rows.size(), csv(rows));
    }

    @Transactional(readOnly = true)
    public WarehouseTransferDetail get(
            WarehouseTransferActor actor, UUID transferId) {
        UUID tenantId = requireActor(actor);
        WarehouseTransferDetail detail = repository.find(
                        tenantId, requireId(transferId))
                .orElseThrow(WarehouseTransferService::notFound);
        requireVisible(actor, detail.summary());
        return detail;
    }

    @Transactional
    public WarehouseTransferDetail create(
            WarehouseTransferActor actor,
            UUID commandId,
            UUID sourceWarehouseId,
            UUID targetWarehouseId,
            LocalDate transferDate,
            WarehouseTransferTransportMode transportMode,
            Long freightAmountMinor,
            String currencyCode,
            String logisticsChannel,
            String trackingNo,
            WarehouseTransferAllocationMethod allocationMethod,
            Instant expectedShipAt,
            Instant expectedArrivalAt,
            String note,
            boolean submit,
            List<LineInput> inputs) {
        UUID tenantId = requireWriteActor(actor);
        UUID requiredCommandId = requireId(commandId);
        UUID sourceId = requireId(sourceWarehouseId);
        UUID targetId = requireId(targetWarehouseId);
        if (sourceId.equals(targetId)) {
            throw new IllegalArgumentException("Source and target warehouses must differ");
        }
        WarehouseScopeAccess scope = scope(actor);
        scopeEvaluator.requireVisible(scope, sourceId);
        scopeEvaluator.requireVisible(scope, targetId);
        requireActiveWarehouse(tenantId, sourceId);
        requireActiveWarehouse(tenantId, targetId);
        if (transferDate == null) {
            throw new IllegalArgumentException("Warehouse transfer date is required");
        }
        WarehouseTransferTransportMode normalizedTransport = transportMode == null
                ? WarehouseTransferTransportMode.UNSET : transportMode;
        WarehouseTransferAllocationMethod normalizedAllocation = allocationMethod == null
                ? WarehouseTransferAllocationMethod.WEIGHT : allocationMethod;
        String normalizedCurrency = normalizeCurrency(freightAmountMinor, currencyCode);
        if (freightAmountMinor != null && freightAmountMinor < 0) {
            throw new IllegalArgumentException("Warehouse transfer freight cannot be negative");
        }
        if (expectedShipAt != null && expectedArrivalAt != null
                && expectedShipAt.isAfter(expectedArrivalAt)) {
            throw new IllegalArgumentException("Expected ship time cannot follow expected arrival time");
        }
        String normalizedLogistics = normalizeText(logisticsChannel, 160, "logistics channel");
        String normalizedTracking = normalizeText(trackingNo, 160, "tracking number");
        String normalizedNote = normalizeText(note, 500, "note");
        List<SnapshotLine> lines = snapshotLines(actor, sourceId, inputs);
        String operation = "CREATE";
        String fingerprint = fingerprint(
                operation,
                sourceId.toString(),
                targetId.toString(),
                transferDate.toString(),
                normalizedTransport.name(),
                freightAmountMinor == null ? null : freightAmountMinor.toString(),
                normalizedCurrency,
                normalizedLogistics,
                normalizedTracking,
                normalizedAllocation.name(),
                expectedShipAt == null ? null : expectedShipAt.toString(),
                expectedArrivalAt == null ? null : expectedArrivalAt.toString(),
                normalizedNote,
                Boolean.toString(submit),
                lines.stream()
                        .map(line -> line.balance().id() + ":" + line.quantity())
                        .toList().toString());
        repository.lockCommand(tenantId, requiredCommandId);
        WarehouseTransferDetail replay = replay(
                tenantId, requiredCommandId, operation, fingerprint);
        if (replay != null) return replay;

        UUID transferId = UUID.randomUUID();
        String transferNo = "WT-"
                + transferDate.format(DateTimeFormatter.BASIC_ISO_DATE)
                + "-" + transferId.toString().substring(0, 8)
                        .toUpperCase(Locale.ROOT);
        repository.insertTransfer(
                transferId,
                tenantId,
                transferNo,
                transferDate,
                sourceId,
                targetId,
                normalizedTransport,
                freightAmountMinor,
                normalizedCurrency,
                normalizedLogistics,
                normalizedTracking,
                normalizedAllocation,
                expectedShipAt,
                expectedArrivalAt,
                normalizedNote,
                normalizeDisplayName(actor.displayName()),
                actor.userId(),
                actor.systemAdminId());
        for (SnapshotLine line : lines) {
            InventoryBalanceView balance = line.balance();
            repository.insertLine(
                    UUID.randomUUID(), tenantId, transferId, balance.id(),
                    balance.skuId(), sourceId, targetId, balance.version(),
                    balance.onHand(), balance.reserved(), line.quantity());
        }
        WarehouseTransferSummary summary = repository.find(tenantId, transferId)
                .orElseThrow().summary();
        if (submit) {
            summary = transition(
                    actor, summary, WarehouseTransferStatus.DRAFT,
                    WarehouseTransferStatus.APPROVAL);
        }
        repository.insertCommand(
                tenantId, requiredCommandId, transferId, operation,
                fingerprint, summary.status(), summary.version());
        audit(actor, CREATED, summary);
        return repository.find(tenantId, transferId).orElseThrow();
    }

    @Transactional
    public WarehouseTransferDetail submit(
            WarehouseTransferActor actor, UUID transferId,
            UUID commandId, long expectedVersion) {
        ActionResult result = simpleAction(
                actor, transferId, commandId, expectedVersion, "SUBMIT",
                WarehouseTransferStatus.DRAFT, WarehouseTransferStatus.APPROVAL);
        if (!result.replayed()) audit(actor, SUBMITTED, result.detail().summary());
        return result.detail();
    }

    @Transactional
    public WarehouseTransferDetail approve(
            WarehouseTransferActor actor, UUID transferId,
            UUID commandId, long expectedVersion) {
        ActionResult result = simpleAction(
                actor, transferId, commandId, expectedVersion, "APPROVE",
                WarehouseTransferStatus.APPROVAL,
                WarehouseTransferStatus.READY_TO_SHIP);
        if (!result.replayed()) audit(actor, APPROVED, result.detail().summary());
        return result.detail();
    }

    @Transactional
    public WarehouseTransferDetail reject(
            WarehouseTransferActor actor, UUID transferId,
            UUID commandId, long expectedVersion) {
        ActionResult result = simpleAction(
                actor, transferId, commandId, expectedVersion, "REJECT",
                WarehouseTransferStatus.APPROVAL, WarehouseTransferStatus.REJECTED);
        if (!result.replayed()) audit(actor, REJECTED, result.detail().summary());
        return result.detail();
    }

    @Transactional
    public WarehouseTransferDetail cancel(
            WarehouseTransferActor actor, UUID transferId,
            UUID commandId, long expectedVersion) {
        UUID tenantId = requireWriteActor(actor);
        String operation = "CANCEL";
        String fingerprint = actionFingerprint(operation, transferId, expectedVersion);
        repository.lockCommand(tenantId, requireId(commandId));
        WarehouseTransferDetail replay = replay(
                tenantId, commandId, operation, fingerprint);
        if (replay != null) return replay;
        WarehouseTransferSummary current = lockedVisible(actor, transferId);
        if (expectedVersion < 0 || current.version() != expectedVersion
                || (current.status() != WarehouseTransferStatus.DRAFT
                && current.status() != WarehouseTransferStatus.APPROVAL
                && current.status() != WarehouseTransferStatus.READY_TO_SHIP)) {
            throw new InventoryConflictException("invalid_transfer_state");
        }
        WarehouseTransferSummary changed = transition(
                actor, current, current.status(), WarehouseTransferStatus.CANCELLED);
        repository.insertCommand(
                tenantId, commandId, transferId, operation, fingerprint,
                changed.status(), changed.version());
        audit(actor, CANCELLED, changed);
        return repository.find(tenantId, transferId).orElseThrow();
    }

    @Transactional
    public WarehouseTransferDetail ship(
            WarehouseTransferActor actor, UUID transferId,
            UUID commandId, long expectedVersion) {
        UUID tenantId = requireWriteActor(actor);
        String operation = "SHIP";
        String fingerprint = actionFingerprint(operation, transferId, expectedVersion);
        repository.lockCommand(tenantId, requireId(commandId));
        WarehouseTransferDetail replay = replay(
                tenantId, commandId, operation, fingerprint);
        if (replay != null) return replay;
        WarehouseTransferSummary current = lockedVisible(actor, transferId);
        requireState(current, WarehouseTransferStatus.READY_TO_SHIP, expectedVersion);
        List<WarehouseTransferLineView> lines = repository.listLines(tenantId, transferId)
                .stream()
                .sorted(Comparator.comparing(line -> line.sourceBalanceId().toString()))
                .toList();
        for (WarehouseTransferLineView line : lines) {
            if (line.shipmentEventId() != null || line.receiptEventId() != null) {
                throw new InventoryConflictException("invalid_transfer_state");
            }
            InventoryBalanceView balance = inventoryService.getBalance(
                    inventoryActor(actor), line.sourceBalanceId());
            if (!balance.skuId().equals(line.skuId())
                    || !balance.warehouseId().equals(current.sourceWarehouseId())) {
                throw new InventoryConflictException("transfer_balance_changed");
            }
            if (balance.available() < line.quantity()) {
                throw new InventoryConflictException("insufficient_available_inventory");
            }
            InventoryMutationResult result = inventoryService.adjust(
                    inventoryActor(actor),
                    InventoryEventType.WAREHOUSE_TRANSFER_SHIPMENT,
                    line.skuId(), current.sourceWarehouseId(),
                    -line.quantity(), balance.version(),
                    "WAREHOUSE_TRANSFER_SHIPMENT",
                    "Warehouse transfer " + current.transferNo(),
                    "transfer.ship." + transferId + "." + line.id());
            repository.setShipmentEvent(tenantId, line.id(), result.event().id());
        }
        WarehouseTransferSummary changed = transition(
                actor, current, WarehouseTransferStatus.READY_TO_SHIP,
                WarehouseTransferStatus.IN_TRANSIT);
        repository.insertCommand(
                tenantId, commandId, transferId, operation, fingerprint,
                changed.status(), changed.version());
        audit(actor, SHIPPED, changed);
        return repository.find(tenantId, transferId).orElseThrow();
    }

    @Transactional
    public WarehouseTransferDetail receive(
            WarehouseTransferActor actor, UUID transferId,
            UUID commandId, long expectedVersion) {
        UUID tenantId = requireWriteActor(actor);
        String operation = "RECEIVE";
        String fingerprint = actionFingerprint(operation, transferId, expectedVersion);
        repository.lockCommand(tenantId, requireId(commandId));
        WarehouseTransferDetail replay = replay(
                tenantId, commandId, operation, fingerprint);
        if (replay != null) return replay;
        WarehouseTransferSummary current = lockedVisible(actor, transferId);
        requireReceivableState(current, expectedVersion);
        List<WarehouseTransferLineView> lines = repository.listLines(tenantId, transferId)
                .stream()
                .sorted(Comparator.comparing(line -> line.skuId().toString()))
                .toList();
        for (WarehouseTransferLineView line : lines) {
            if (line.shipmentEventId() == null) {
                throw new InventoryConflictException("invalid_transfer_state");
            }
            if (line.remainingQuantity() > 0) {
                postReceipt(
                        actor, current, line, line.remainingQuantity(), commandId,
                        "transfer.receive." + transferId + "." + line.id());
            }
        }
        WarehouseTransferSummary changed = transition(
                actor, current, current.status(),
                WarehouseTransferStatus.RECEIVED);
        repository.insertCommand(
                tenantId, commandId, transferId, operation, fingerprint,
                changed.status(), changed.version());
        audit(actor, RECEIVED, changed);
        return repository.find(tenantId, transferId).orElseThrow();
    }

    @Transactional
    public WarehouseTransferDetail receivePartial(
            WarehouseTransferActor actor,
            UUID transferId,
            UUID commandId,
            long expectedVersion,
            List<ReceiptInput> inputs) {
        UUID tenantId = requireWriteActor(actor);
        UUID requiredCommandId = requireId(commandId);
        List<ReceiptInput> normalizedInputs = normalizeReceiptInputs(inputs);
        String operation = "RECEIVE_PARTIAL";
        String fingerprint = fingerprint(
                operation,
                requireId(transferId).toString(),
                Long.toString(expectedVersion),
                normalizedInputs.stream()
                        .map(input -> input.lineId() + ":" + input.quantity())
                        .toList().toString());
        repository.lockCommand(tenantId, requiredCommandId);
        WarehouseTransferDetail replay = replay(
                tenantId, requiredCommandId, operation, fingerprint);
        if (replay != null) return replay;
        WarehouseTransferSummary current = lockedVisible(actor, transferId);
        requireReceivableState(current, expectedVersion);
        Map<UUID, WarehouseTransferLineView> lines = repository
                .listLines(tenantId, transferId).stream()
                .collect(java.util.stream.Collectors.toMap(
                        WarehouseTransferLineView::id, line -> line));
        long totalRemaining = 0;
        long requested = 0;
        try {
            for (WarehouseTransferLineView line : lines.values()) {
                totalRemaining = Math.addExact(
                        totalRemaining, line.remainingQuantity());
            }
            for (ReceiptInput input : normalizedInputs) {
                WarehouseTransferLineView line = lines.get(input.lineId());
                if (line == null || line.shipmentEventId() == null
                        || input.quantity() > line.remainingQuantity()) {
                    throw new InventoryConflictException(
                            "invalid_partial_receipt_quantity");
                }
                requested = Math.addExact(requested, input.quantity());
            }
        } catch (ArithmeticException exception) {
            throw new IllegalArgumentException(
                    "Warehouse transfer receipt quantity is outside the supported range");
        }
        if (requested >= totalRemaining) {
            throw new InventoryConflictException(
                    "partial_receipt_must_leave_remaining");
        }
        for (ReceiptInput input : normalizedInputs) {
            WarehouseTransferLineView line = lines.get(input.lineId());
            postReceipt(
                    actor, current, line, input.quantity(), requiredCommandId,
                    "transfer.receive.partial." + requiredCommandId
                            + "." + line.id());
        }
        WarehouseTransferSummary changed = transition(
                actor, current, current.status(),
                WarehouseTransferStatus.PARTIALLY_RECEIVED);
        repository.insertCommand(
                tenantId, requiredCommandId, transferId, operation,
                fingerprint, changed.status(), changed.version());
        audit(actor, PARTIALLY_RECEIVED, changed);
        return repository.find(tenantId, transferId).orElseThrow();
    }

    private void postReceipt(
            WarehouseTransferActor actor,
            WarehouseTransferSummary current,
            WarehouseTransferLineView line,
            long quantity,
            UUID commandId,
            String idempotencyKey) {
        Page<InventoryBalanceView> balances = inventoryService.listBalances(
                inventoryActor(actor), current.targetWarehouseId(), line.skuId(),
                null, PageRequest.of(0, 2));
        if (balances.getTotalElements() > 1) {
            throw new InventoryConflictException("duplicate_inventory_balance");
        }
        long expectedBalanceVersion = balances.isEmpty()
                ? 0 : balances.getContent().getFirst().version();
        InventoryMutationResult result = inventoryService.adjust(
                inventoryActor(actor),
                InventoryEventType.WAREHOUSE_TRANSFER_RECEIPT,
                line.skuId(), current.targetWarehouseId(),
                quantity, expectedBalanceVersion,
                "WAREHOUSE_TRANSFER_RECEIPT",
                "Warehouse transfer " + current.transferNo(),
                idempotencyKey);
        repository.recordReceipt(
                actor.tenantId(), current.id(), line.id(), quantity,
                result.event().id(), commandId,
                normalizeDisplayName(actor.displayName()),
                actor.userId(), actor.systemAdminId());
    }

    private static List<ReceiptInput> normalizeReceiptInputs(
            List<ReceiptInput> inputs) {
        if (inputs == null || inputs.isEmpty() || inputs.size() > MAX_LINES) {
            throw new IllegalArgumentException(
                    "Between 1 and 200 partial receipt lines are required");
        }
        Set<UUID> lineIds = new HashSet<>();
        List<ReceiptInput> normalized = new ArrayList<>(inputs.size());
        for (ReceiptInput input : inputs) {
            if (input == null || !lineIds.add(requireId(input.lineId()))) {
                throw new IllegalArgumentException(
                        "Partial receipt lines must be unique");
            }
            if (input.quantity() <= 0 || input.quantity() > MAX_QUANTITY) {
                throw new IllegalArgumentException(
                        "Partial receipt quantity is outside the supported range");
            }
            normalized.add(input);
        }
        return normalized.stream()
                .sorted(Comparator.comparing(input -> input.lineId().toString()))
                .toList();
    }

    private ActionResult simpleAction(
            WarehouseTransferActor actor, UUID transferId, UUID commandId,
            long expectedVersion, String operation,
            WarehouseTransferStatus expectedStatus,
            WarehouseTransferStatus nextStatus) {
        UUID tenantId = requireWriteActor(actor);
        String fingerprint = actionFingerprint(operation, transferId, expectedVersion);
        repository.lockCommand(tenantId, requireId(commandId));
        WarehouseTransferDetail replay = replay(
                tenantId, commandId, operation, fingerprint);
        if (replay != null) return new ActionResult(replay, true);
        WarehouseTransferSummary current = lockedVisible(actor, transferId);
        requireState(current, expectedStatus, expectedVersion);
        WarehouseTransferSummary changed = transition(
                actor, current, expectedStatus, nextStatus);
        repository.insertCommand(
                tenantId, commandId, transferId, operation, fingerprint,
                changed.status(), changed.version());
        return new ActionResult(
                repository.find(tenantId, transferId).orElseThrow(), false);
    }

    private WarehouseTransferSummary transition(
            WarehouseTransferActor actor,
            WarehouseTransferSummary current,
            WarehouseTransferStatus expectedStatus,
            WarehouseTransferStatus nextStatus) {
        int updated = repository.transition(
                actor.tenantId(), current.id(), current.version(), expectedStatus,
                nextStatus, normalizeDisplayName(actor.displayName()),
                actor.userId(), actor.systemAdminId());
        if (updated != 1) {
            throw new InventoryConflictException("invalid_transfer_state");
        }
        return repository.find(actor.tenantId(), current.id())
                .orElseThrow().summary();
    }

    private List<SnapshotLine> snapshotLines(
            WarehouseTransferActor actor,
            UUID sourceWarehouseId,
            List<LineInput> inputs) {
        if (inputs == null || inputs.isEmpty() || inputs.size() > MAX_LINES) {
            throw new IllegalArgumentException(
                    "Between 1 and 200 warehouse transfer lines are required");
        }
        Set<UUID> balanceIds = new HashSet<>();
        Set<UUID> skuIds = new HashSet<>();
        List<SnapshotLine> lines = new ArrayList<>(inputs.size());
        for (LineInput input : inputs) {
            if (input == null || !balanceIds.add(requireId(input.balanceId()))) {
                throw new IllegalArgumentException(
                        "Warehouse transfer balances must be unique");
            }
            if (input.quantity() <= 0 || input.quantity() > MAX_QUANTITY) {
                throw new IllegalArgumentException(
                        "Warehouse transfer quantity is outside the supported range");
            }
            InventoryBalanceView balance = inventoryService.getBalance(
                    inventoryActor(actor), input.balanceId());
            if (!balance.warehouseId().equals(sourceWarehouseId)) {
                throw new IllegalArgumentException(
                        "Warehouse transfer balance belongs to another warehouse");
            }
            if (!skuIds.add(balance.skuId())) {
                throw new IllegalArgumentException(
                        "Warehouse transfer SKUs must be unique");
            }
            if (balance.available() < input.quantity()) {
                throw new InventoryConflictException(
                        "insufficient_available_inventory");
            }
            lines.add(new SnapshotLine(balance, input.quantity()));
        }
        return lines.stream()
                .sorted(Comparator.comparing(line -> line.balance().id().toString()))
                .toList();
    }

    private WarehouseTransferSummary lockedVisible(
            WarehouseTransferActor actor, UUID transferId) {
        WarehouseTransferSummary current = repository.lock(
                        actor.tenantId(), requireId(transferId))
                .orElseThrow(WarehouseTransferService::notFound);
        requireVisible(actor, current);
        return current;
    }

    private void requireVisible(
            WarehouseTransferActor actor, WarehouseTransferSummary summary) {
        WarehouseScopeAccess scope = scope(actor);
        scopeEvaluator.requireVisible(scope, summary.sourceWarehouseId());
        scopeEvaluator.requireVisible(scope, summary.targetWarehouseId());
    }

    private void requireActiveWarehouse(UUID tenantId, UUID warehouseId) {
        if (warehouseRepository.findByIdAndTenantId(warehouseId, tenantId)
                .filter(warehouse -> warehouse.getStatus() == WarehouseStatus.ACTIVE)
                .isEmpty()) {
            throw new ResourceNotFoundException("Warehouse was not found");
        }
    }

    private WarehouseTransferDetail replay(
            UUID tenantId, UUID commandId,
            String operation, String fingerprint) {
        CommandRecord command = repository.findCommand(tenantId, commandId)
                .orElse(null);
        if (command == null) return null;
        if (!command.operation().equals(operation)
                || !command.fingerprint().equals(fingerprint)) {
            throw new InventoryConflictException("idempotency_conflict");
        }
        return repository.find(tenantId, command.transferId())
                .orElseThrow(WarehouseTransferService::notFound);
    }

    private void audit(
            WarehouseTransferActor actor,
            String action,
            WarehouseTransferSummary summary) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(),
                action, RESOURCE_TYPE, summary.id().toString(),
                actor.requestId(), actor.sourceIp(),
                Map.of(
                        "sourceWarehouseId", summary.sourceWarehouseId().toString(),
                        "targetWarehouseId", summary.targetWarehouseId().toString(),
                        "status", summary.status().name(),
                        "version", Long.toString(summary.version()),
                        "lineCount", Integer.toString(summary.lineCount()),
                        "totalQuantity", Long.toString(summary.totalQuantity()))));
    }

    private WarehouseScopeAccess scope(WarehouseTransferActor actor) {
        return scopeEvaluator.evaluate(
                actor.tenantId(), actor.userId(), actor.systemAdminId());
    }

    private static InventoryActor inventoryActor(WarehouseTransferActor actor) {
        return new InventoryActor(
                actor.tenantId(), actor.userId(), actor.systemAdminId(),
                actor.requestId(), actor.sourceIp());
    }

    private static void requireState(
            WarehouseTransferSummary current,
            WarehouseTransferStatus status,
            long version) {
        if (version < 0 || current.version() != version
                || current.status() != status) {
            throw new InventoryConflictException("invalid_transfer_state");
        }
    }

    private static void requireReceivableState(
            WarehouseTransferSummary current,
            long version) {
        if (version < 0 || current.version() != version
                || (current.status() != WarehouseTransferStatus.IN_TRANSIT
                && current.status()
                        != WarehouseTransferStatus.PARTIALLY_RECEIVED)) {
            throw new InventoryConflictException("invalid_transfer_state");
        }
    }

    private static String actionFingerprint(
            String operation, UUID transferId, long expectedVersion) {
        return fingerprint(operation, requireId(transferId).toString(),
                Long.toString(expectedVersion));
    }

    private static UUID requireActor(WarehouseTransferActor actor) {
        if (actor == null || actor.tenantId() == null) {
            throw new IllegalArgumentException("A tenant actor is required");
        }
        return actor.tenantId();
    }

    private static UUID requireWriteActor(WarehouseTransferActor actor) {
        UUID tenantId = requireActor(actor);
        if ((actor.userId() == null) == (actor.systemAdminId() == null)
                || actor.requestId() == null || actor.requestId().isBlank()) {
            throw new IllegalArgumentException(
                    "A traceable warehouse transfer actor is required");
        }
        return tenantId;
    }

    private static UUID requireId(UUID value) {
        if (value == null) throw new IllegalArgumentException("An ID is required");
        return value;
    }

    private static String normalizeKeyword(String value) {
        if (value == null || value.isBlank()) return null;
        String normalized = value.strip().toLowerCase(Locale.ROOT);
        if (normalized.length() > 100) {
            throw new IllegalArgumentException("Warehouse transfer keyword is too long");
        }
        return normalized;
    }

    private static String normalizeCurrency(Long freight, String currency) {
        if (freight == null) {
            if (currency != null && !currency.isBlank()) {
                throw new IllegalArgumentException(
                        "Currency requires a warehouse transfer freight amount");
            }
            return null;
        }
        String normalized = currency == null
                ? null : currency.strip().toUpperCase(Locale.ROOT);
        if (normalized == null || !CURRENCY.matcher(normalized).matches()) {
            throw new IllegalArgumentException("A three-letter currency code is required");
        }
        return normalized;
    }

    private static String normalizeText(String value, int maxLength, String label) {
        String normalized = SensitiveTextRedactor.redactNullable(value);
        if (normalized == null || normalized.isBlank()) return null;
        normalized = normalized.strip();
        if (normalized.length() > maxLength) {
            throw new IllegalArgumentException(
                    "Warehouse transfer " + label + " is too long");
        }
        return normalized;
    }

    private static String normalizeDisplayName(String value) {
        if (value == null || value.isBlank()) return "System administrator";
        String normalized = value.strip();
        if (normalized.length() > 160) {
            throw new IllegalArgumentException("Actor display name is too long");
        }
        return normalized;
    }

    private static String fingerprint(String... values) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            for (String value : values) {
                byte[] bytes = (value == null ? "" : value)
                        .getBytes(StandardCharsets.UTF_8);
                digest.update(Integer.toString(bytes.length)
                        .getBytes(StandardCharsets.US_ASCII));
                digest.update((byte) ':');
                digest.update(bytes);
                digest.update((byte) '|');
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    private static String csv(List<WarehouseTransferSummary> transfers) {
        StringBuilder output = new StringBuilder("\uFEFF");
        appendCsvRow(output, CSV_HEADER);
        for (WarehouseTransferSummary transfer : transfers) {
            appendCsvRow(output, List.of(
                    transfer.transferNo(), statusLabel(transfer.status()),
                    transfer.transferDate().toString(),
                    transfer.sourceWarehouseCode(),
                    transfer.sourceWarehouseName(),
                    transfer.targetWarehouseCode(),
                    transfer.targetWarehouseName(),
                    transportLabel(transfer.transportMode()),
                    Integer.toString(transfer.lineCount()),
                    Long.toString(transfer.totalQuantity()),
                    nullable(transfer.logisticsChannel()),
                    nullable(transfer.trackingNo()),
                    transfer.freightAmountMinor() == null
                            ? "" : Long.toString(transfer.freightAmountMinor()),
                    nullable(transfer.currencyCode()),
                    allocationLabel(transfer.allocationMethod()),
                    transfer.expectedShipAt() == null
                            ? "" : transfer.expectedShipAt().toString(),
                    transfer.expectedArrivalAt() == null
                            ? "" : transfer.expectedArrivalAt().toString(),
                    nullable(transfer.note()),
                    transfer.operatorDisplayName(),
                    nullable(transfer.approverDisplayName()),
                    nullable(transfer.shipperDisplayName()),
                    nullable(transfer.receiverDisplayName()),
                    transfer.createdAt().toString(),
                    transfer.updatedAt().toString()));
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

    private static String statusLabel(WarehouseTransferStatus status) {
        return switch (status) {
            case DRAFT -> "新调拨单";
            case APPROVAL -> "审核中";
            case READY_TO_SHIP -> "待发货";
            case IN_TRANSIT -> "待签收";
            case PARTIALLY_RECEIVED -> "部分签收";
            case RECEIVED -> "已签收";
            case REJECTED -> "未通过";
            case CANCELLED -> "已作废";
        };
    }

    private static String transportLabel(WarehouseTransferTransportMode mode) {
        return switch (mode) {
            case UNSET -> "未设置";
            case LAND -> "陆地运输";
            case AIR -> "空运";
            case SEA -> "海运";
        };
    }

    private static String allocationLabel(
            WarehouseTransferAllocationMethod method) {
        return switch (method) {
            case WEIGHT -> "重量";
            case VOLUMETRIC_WEIGHT -> "体积重";
            case VOLUME -> "体积";
        };
    }

    private static ResourceNotFoundException notFound() {
        return new ResourceNotFoundException("Warehouse transfer was not found");
    }

    public record LineInput(UUID balanceId, long quantity) {
    }

    public record ReceiptInput(UUID lineId, long quantity) {
    }

    public record WarehouseTransferExport(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }

    private record SnapshotLine(InventoryBalanceView balance, long quantity) {
    }

    private record ActionResult(
            WarehouseTransferDetail detail,
            boolean replayed) {
    }
}
