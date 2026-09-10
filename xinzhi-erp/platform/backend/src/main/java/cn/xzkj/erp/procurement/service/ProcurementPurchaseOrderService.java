package cn.xzkj.erp.procurement.service;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeAccess;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeEvaluator;
import cn.xzkj.erp.inventory.domain.InventoryEventType;
import cn.xzkj.erp.inventory.service.InventoryActor;
import cn.xzkj.erp.inventory.service.InventoryBalanceView;
import cn.xzkj.erp.inventory.service.InventoryMutationResult;
import cn.xzkj.erp.inventory.service.InventoryService;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.procurement.domain.ProcurementPlanStatus;
import cn.xzkj.erp.procurement.domain.ProcurementPurchaseOrderSearchField;
import cn.xzkj.erp.procurement.domain.ProcurementPurchaseOrderStatus;
import cn.xzkj.erp.procurement.domain.ProcurementReceiptSort;
import cn.xzkj.erp.procurement.repository.ProcurementPlanRepository;
import cn.xzkj.erp.procurement.repository.ProcurementPurchaseOrderRepository;
import cn.xzkj.erp.procurement.repository.ProcurementPurchaseOrderRepository.CommandRecord;
import cn.xzkj.erp.procurement.repository.ProcurementPurchaseOrderRepository.CreateFacts;
import cn.xzkj.erp.procurement.repository.ProcurementPurchaseOrderRepository.ReceiptCommandRecord;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.HexFormat;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ProcurementPurchaseOrderService {
    static final int MAX_EXPORT_ROWS = 10_000;
    private static final String CSV_MEDIA_TYPE = "text/csv;charset=utf-8";
    private static final List<String> PURCHASE_ORDER_CSV_HEADER = List.of(
            "采购单号", "状态", "计划编号", "供应商编码", "供应商名称",
            "供应商SKU", "SKU编号", "SKU名称", "规格", "仓库编码", "仓库名称",
            "库位编码", "库位名称", "采购数量", "已收数量", "待收数量",
            "订单备注", "下单员", "最近到货", "创建时间", "更新时间");
    private static final List<String> FOLLOW_UP_CSV_HEADER = List.of(
            "采购单号", "计划编号", "SKU编号", "SKU名称", "规格",
            "仓库编码", "仓库名称", "库位编码", "库位名称", "供应商编码",
            "供应商名称", "供应商SKU", "采购数量", "已到货", "待到货",
            "状态", "下单员", "下单时间", "最近到货");
    private static final List<String> RECEIPT_LEDGER_CSV_HEADER = List.of(
            "入库时间", "采购单号", "计划编号", "供应商编码", "供应商名称",
            "SKU编号", "SKU名称", "规格", "仓库编码", "仓库名称", "库位编码",
            "库位名称", "本次入库", "入库后库存", "库存事件序号", "库存事件ID",
            "操作人");
    private static final Pattern REQUEST_ID = Pattern.compile("^[A-Za-z0-9._:-]{1,100}$");
    private static final String RESOURCE_TYPE = "procurement_purchase_order";
    private static final String CREATED = "procurement_purchase_order.created";
    private static final String APPROVED = "procurement_purchase_order.approved";
    private static final String REJECTED = "procurement_purchase_order.rejected";
    private static final String RECEIVED = "procurement_purchase_order.received";
    private final ProcurementPurchaseOrderRepository repository;
    private final ProcurementPlanRepository planRepository;
    private final WarehouseScopeEvaluator scopeEvaluator;
    private final SecurityAuditRecorder auditRecorder;
    private final InventoryService inventoryService;

    public ProcurementPurchaseOrderService(
            ProcurementPurchaseOrderRepository repository,
            ProcurementPlanRepository planRepository,
            WarehouseScopeEvaluator scopeEvaluator,
            SecurityAuditRecorder auditRecorder,
            InventoryService inventoryService) {
        this.repository = repository;
        this.planRepository = planRepository;
        this.scopeEvaluator = scopeEvaluator;
        this.auditRecorder = auditRecorder;
        this.inventoryService = inventoryService;
    }

    @Transactional(readOnly = true)
    public Page<ProcurementPurchaseOrderView> list(
            ProcurementPlanActor actor, UUID warehouseId, UUID supplierId,
            ProcurementPurchaseOrderStatus status, boolean receivableOnly,
            ProcurementPurchaseOrderSearchField searchField, String keyword,
            Instant createdFrom, Instant createdTo, Pageable pageable) {
        UUID tenantId = requireActor(actor);
        WarehouseScopeAccess scope = scope(actor);
        if (warehouseId != null) scopeEvaluator.requireVisible(scope, warehouseId);
        if (createdFrom != null && createdTo != null && createdFrom.isAfter(createdTo)) {
            throw new IllegalArgumentException("Invalid procurement order date range");
        }
        if (!scope.allowsAll() && scope.warehouseIds().isEmpty()) {
            return Page.empty(pageable);
        }
        return repository.list(
                tenantId, scope.warehouseIds(), scope.allowsAll(), warehouseId,
                supplierId, status, receivableOnly,
                searchField == null
                        ? ProcurementPurchaseOrderSearchField.PURCHASE_NO : searchField,
                normalizeKeyword(keyword), createdFrom, createdTo, pageable);
    }

    @Transactional(readOnly = true)
    public ProcurementFollowUpExport exportFollowUpCsv(
            ProcurementPlanActor actor,
            ProcurementPurchaseOrderSearchField searchField,
            String keyword,
            Instant createdFrom,
            Instant createdTo) {
        Page<ProcurementPurchaseOrderView> page = list(
                actor, null, null, null, true, searchField, keyword,
                createdFrom, createdTo,
                PageRequest.of(0, MAX_EXPORT_ROWS + 1));
        if (page.getTotalElements() > MAX_EXPORT_ROWS
                || page.getNumberOfElements() > MAX_EXPORT_ROWS) {
            throw new ConflictException(
                    "Procurement follow-up export exceeds the supported row limit");
        }
        if (page.stream().anyMatch(order ->
                order.status() == ProcurementPurchaseOrderStatus.RECEIVED)) {
            throw new IllegalStateException(
                    "Procurement follow-up export contains a received order");
        }
        return new ProcurementFollowUpExport(
                "procurement-follow-up.csv", CSV_MEDIA_TYPE,
                page.getNumberOfElements(), followUpCsv(page.getContent()));
    }

    @Transactional(readOnly = true)
    public ProcurementPurchaseOrderExport exportCsv(
            ProcurementPlanActor actor,
            ProcurementPurchaseOrderStatus status,
            boolean receivableOnly,
            ProcurementPurchaseOrderSearchField searchField,
            String keyword,
            Instant createdFrom,
            Instant createdTo) {
        Page<ProcurementPurchaseOrderView> page = list(
                actor, null, null, status, receivableOnly, searchField, keyword,
                createdFrom, createdTo,
                PageRequest.of(0, MAX_EXPORT_ROWS + 1));
        if (page.getTotalElements() > MAX_EXPORT_ROWS
                || page.getNumberOfElements() > MAX_EXPORT_ROWS) {
            throw new ConflictException(
                    "Procurement purchase order export exceeds the supported row limit");
        }
        if (receivableOnly && page.stream().anyMatch(order ->
                order.status() == ProcurementPurchaseOrderStatus.RECEIVED)) {
            throw new IllegalStateException(
                    "Procurement receiving export contains a received order");
        }
        return new ProcurementPurchaseOrderExport(
                "procurement-orders.csv", CSV_MEDIA_TYPE,
                page.getNumberOfElements(), purchaseOrderCsv(page.getContent()));
    }

    @Transactional(readOnly = true)
    public ProcurementPurchaseOrderView get(
            ProcurementPlanActor actor, UUID purchaseOrderId) {
        ProcurementPurchaseOrderView order = repository.find(
                        requireActor(actor), requireId(purchaseOrderId))
                .orElseThrow(ProcurementPurchaseOrderService::notFound);
        scopeEvaluator.requireVisible(scope(actor), order.warehouseId());
        return order;
    }

    @Transactional(readOnly = true)
    public Page<ProcurementReceiptView> listReceipts(
            ProcurementPlanActor actor, UUID purchaseOrderId,
            String supplierKeyword, String purchaseKeyword,
            Instant receivedFrom, Instant receivedTo,
            ProcurementReceiptSort sort, Pageable pageable) {
        UUID tenantId = requireActor(actor);
        WarehouseScopeAccess scope = scope(actor);
        if (receivedFrom != null && receivedTo != null
                && receivedFrom.isAfter(receivedTo)) {
            throw new IllegalArgumentException(
                    "Invalid procurement receipt date range");
        }
        if (!scope.allowsAll() && scope.warehouseIds().isEmpty()) {
            return Page.empty(pageable);
        }
        if (purchaseOrderId != null) {
            ProcurementPurchaseOrderView order = repository.find(
                            tenantId, requireId(purchaseOrderId))
                    .orElseThrow(ProcurementPurchaseOrderService::notFound);
            scopeEvaluator.requireVisible(scope, order.warehouseId());
        }
        return repository.listReceipts(
                tenantId, scope.warehouseIds(), scope.allowsAll(),
                purchaseOrderId, normalizeKeyword(supplierKeyword),
                normalizeKeyword(purchaseKeyword),
                receivedFrom, receivedTo,
                sort == null ? ProcurementReceiptSort.RECEIVED_AT : sort,
                pageable);
    }

    @Transactional(readOnly = true)
    public ProcurementReceiptLedgerExport exportReceiptLedgerCsv(
            ProcurementPlanActor actor,
            String supplierKeyword,
            String purchaseKeyword,
            Instant receivedFrom,
            Instant receivedTo,
            ProcurementReceiptSort sort) {
        Page<ProcurementReceiptView> page = listReceipts(
                actor, null, supplierKeyword, purchaseKeyword,
                receivedFrom, receivedTo, sort,
                PageRequest.of(0, MAX_EXPORT_ROWS + 1));
        if (page.getTotalElements() > MAX_EXPORT_ROWS
                || page.getNumberOfElements() > MAX_EXPORT_ROWS) {
            throw new ConflictException(
                    "Procurement receipt ledger export exceeds the supported row limit");
        }
        return new ProcurementReceiptLedgerExport(
                "procurement-receipt-ledger.csv", CSV_MEDIA_TYPE,
                page.getNumberOfElements(), receiptLedgerCsv(page.getContent()));
    }

    @Transactional(readOnly = true)
    public Page<ProcurementSupplierOption> supplierOptions(
            ProcurementPlanActor actor, UUID planId, String keyword,
            Pageable pageable) {
        UUID tenantId = requireActor(actor);
        ProcurementPlanView plan = planRepository.find(tenantId, requireId(planId))
                .orElseThrow(ProcurementPurchaseOrderService::planNotFound);
        scopeEvaluator.requireVisible(scope(actor), plan.warehouseId());
        if (plan.status() != ProcurementPlanStatus.UNPURCHASED) {
            throw new ProcurementPurchaseOrderConflictException("invalid_plan_state");
        }
        return repository.listSupplierOptions(
                tenantId, planId, normalizeKeyword(keyword), pageable);
    }

    @Transactional(readOnly = true)
    public Page<ProcurementSupplierOption> supplierOptionsForSku(
            ProcurementPlanActor actor, UUID skuId, String keyword,
            Pageable pageable) {
        return repository.listSupplierOptionsForSku(
                requireActor(actor), requireId(skuId),
                normalizeKeyword(keyword), pageable);
    }

    @Transactional
    public ProcurementPurchaseOrderView create(
            ProcurementPlanActor actor, UUID commandId, UUID planId,
            long expectedPlanVersion, UUID supplierId, String orderNote) {
        UUID tenantId = requireWriteActor(actor);
        UUID requiredCommandId = requireId(commandId);
        UUID requiredPlanId = requireId(planId);
        UUID requiredSupplierId = requireId(supplierId);
        if (expectedPlanVersion < 0) {
            throw new IllegalArgumentException("Procurement plan version is invalid");
        }
        String normalizedNote = normalizeText(orderNote, 500);
        String fingerprint = fingerprint(
                requiredPlanId.toString(), Long.toString(expectedPlanVersion),
                requiredSupplierId.toString(), normalizedNote);
        repository.lockCommand(tenantId, requiredCommandId);
        CommandRecord command = repository.findCommand(tenantId, requiredCommandId)
                .orElse(null);
        if (command != null) {
            if (!command.fingerprint().equals(fingerprint)) {
                throw new ProcurementPurchaseOrderConflictException("idempotency_conflict");
            }
            ProcurementPurchaseOrderView replay = repository.find(
                            tenantId, command.purchaseOrderId())
                    .orElseThrow(ProcurementPurchaseOrderService::notFound);
            scopeEvaluator.requireVisible(scope(actor), replay.warehouseId());
            return replay;
        }

        ProcurementPlanView plan = planRepository.lock(tenantId, requiredPlanId)
                .orElseThrow(ProcurementPurchaseOrderService::planNotFound);
        scopeEvaluator.requireVisible(scope(actor), plan.warehouseId());
        if (plan.status() != ProcurementPlanStatus.UNPURCHASED) {
            throw new ProcurementPurchaseOrderConflictException("invalid_plan_state");
        }
        if (plan.version() != expectedPlanVersion) {
            throw new ProcurementPurchaseOrderConflictException("optimistic_lock_conflict");
        }
        CreateFacts facts = repository.findCreateFacts(
                        tenantId, requiredPlanId, requiredSupplierId)
                .orElseThrow(() -> new ProcurementPurchaseOrderConflictException(
                        "supplier_mapping_unavailable"));
        UUID purchaseOrderId = UUID.randomUUID();
        String purchaseNo = "PO-"
                + LocalDate.now(ZoneOffset.UTC).format(DateTimeFormatter.BASIC_ISO_DATE)
                + "-" + purchaseOrderId.toString().replace("-", "")
                        .substring(0, 28).toUpperCase(Locale.ROOT);
        repository.insert(
                purchaseOrderId, tenantId, purchaseNo, requiredPlanId, facts,
                normalizedNote, displayName(actor), actor.userId(),
                actor.systemAdminId());
        if (planRepository.markOrdered(
                tenantId, requiredPlanId, expectedPlanVersion) != 1) {
            throw new ProcurementPurchaseOrderConflictException(
                    "optimistic_lock_conflict");
        }
        ProcurementPurchaseOrderView created = repository.find(
                        tenantId, purchaseOrderId)
                .orElseThrow(ProcurementPurchaseOrderService::notFound);
        repository.insertCommand(
                tenantId, requiredCommandId, purchaseOrderId, fingerprint);
        audit(actor, CREATED, created);
        return created;
    }

    @Transactional
    public ProcurementPurchaseOrderView createDirect(
            ProcurementPlanActor actor, UUID commandId, UUID supplierId,
            UUID skuId, UUID warehouseId, UUID locationId, long quantity,
            String orderNote) {
        UUID tenantId = requireWriteActor(actor);
        UUID requiredCommandId = requireId(commandId);
        UUID requiredSupplierId = requireId(supplierId);
        UUID requiredSkuId = requireId(skuId);
        UUID requiredWarehouseId = requireId(warehouseId);
        UUID requiredLocationId = requireId(locationId);
        if (quantity < 1 || quantity > 1_000_000_000L) {
            throw new IllegalArgumentException("Procurement order quantity is invalid");
        }
        scopeEvaluator.requireVisible(scope(actor), requiredWarehouseId);
        String normalizedNote = normalizeText(orderNote, 500);
        String fingerprint = fingerprint(
                "DIRECT", requiredSupplierId.toString(), requiredSkuId.toString(),
                requiredWarehouseId.toString(), requiredLocationId.toString(),
                Long.toString(quantity), normalizedNote);
        repository.lockCommand(tenantId, requiredCommandId);
        CommandRecord command = repository.findCommand(tenantId, requiredCommandId)
                .orElse(null);
        if (command != null) {
            if (!command.fingerprint().equals(fingerprint)) {
                throw new ProcurementPurchaseOrderConflictException(
                        "idempotency_conflict");
            }
            ProcurementPurchaseOrderView replay = repository.find(
                            tenantId, command.purchaseOrderId())
                    .orElseThrow(ProcurementPurchaseOrderService::notFound);
            scopeEvaluator.requireVisible(scope(actor), replay.warehouseId());
            return replay;
        }

        CreateFacts facts = repository.findDirectCreateFacts(
                        tenantId, requiredSkuId, requiredWarehouseId,
                        requiredLocationId, requiredSupplierId, quantity)
                .orElseThrow(() -> new ProcurementPurchaseOrderConflictException(
                        "purchase_reference_unavailable"));
        UUID purchaseOrderId = UUID.randomUUID();
        String purchaseNo = "PO-"
                + LocalDate.now(ZoneOffset.UTC).format(DateTimeFormatter.BASIC_ISO_DATE)
                + "-" + purchaseOrderId.toString().replace("-", "")
                        .substring(0, 28).toUpperCase(Locale.ROOT);
        repository.insert(
                purchaseOrderId, tenantId, purchaseNo, null, facts,
                normalizedNote, displayName(actor), actor.userId(),
                actor.systemAdminId());
        ProcurementPurchaseOrderView created = repository.find(
                        tenantId, purchaseOrderId)
                .orElseThrow(ProcurementPurchaseOrderService::notFound);
        repository.insertCommand(
                tenantId, requiredCommandId, purchaseOrderId, fingerprint);
        audit(actor, CREATED, created);
        return created;
    }

    @Transactional
    public ProcurementPurchaseOrderView receive(
            ProcurementPlanActor actor, UUID purchaseOrderId, UUID commandId,
            long expectedVersion, long quantity) {
        UUID tenantId = requireWriteActor(actor);
        UUID requiredOrderId = requireId(purchaseOrderId);
        UUID requiredCommandId = requireId(commandId);
        if (expectedVersion < 0 || quantity < 1) {
            throw new IllegalArgumentException("Procurement receipt input is invalid");
        }
        String fingerprint = fingerprint(
                requiredOrderId.toString(), Long.toString(expectedVersion),
                Long.toString(quantity));
        repository.lockReceiptCommand(tenantId, requiredCommandId);
        ReceiptCommandRecord command = repository.findReceiptCommand(
                        tenantId, requiredCommandId)
                .orElse(null);
        if (command != null) {
            if (!command.purchaseOrderId().equals(requiredOrderId)
                    || !command.fingerprint().equals(fingerprint)) {
                throw new ProcurementPurchaseOrderConflictException(
                        "idempotency_conflict");
            }
            ProcurementPurchaseOrderView replay = repository.find(
                            tenantId, requiredOrderId)
                    .orElseThrow(ProcurementPurchaseOrderService::notFound);
            scopeEvaluator.requireVisible(scope(actor), replay.warehouseId());
            return replay;
        }

        ProcurementPurchaseOrderView current = repository.lock(
                        tenantId, requiredOrderId)
                .orElseThrow(ProcurementPurchaseOrderService::notFound);
        scopeEvaluator.requireVisible(scope(actor), current.warehouseId());
        if (current.version() != expectedVersion) {
            throw new ProcurementPurchaseOrderConflictException(
                    "optimistic_lock_conflict");
        }
        if (current.status() != ProcurementPurchaseOrderStatus.APPROVED
                && current.status()
                        != ProcurementPurchaseOrderStatus.PARTIALLY_RECEIVED) {
            throw new ProcurementPurchaseOrderConflictException(
                    "invalid_order_state");
        }
        long remaining;
        try {
            remaining = Math.subtractExact(
                    current.quantity(), current.receivedQuantity());
        } catch (ArithmeticException exception) {
            throw new ProcurementPurchaseOrderConflictException(
                    "invalid_order_state");
        }
        if (quantity > remaining) {
            throw new ProcurementPurchaseOrderConflictException(
                    "receipt_quantity_exceeds_remaining");
        }

        Page<InventoryBalanceView> balances = inventoryService.listBalances(
                inventoryActor(actor), current.warehouseId(), current.skuId(),
                null, PageRequest.of(0, 2));
        if (balances.getTotalElements() > 1) {
            throw new ProcurementPurchaseOrderConflictException(
                    "duplicate_inventory_balance");
        }
        long expectedBalanceVersion = balances.isEmpty()
                ? 0 : balances.getContent().getFirst().version();
        InventoryMutationResult inventory = inventoryService.adjust(
                inventoryActor(actor), InventoryEventType.PURCHASE_ORDER_RECEIPT,
                current.skuId(), current.warehouseId(), quantity,
                expectedBalanceVersion, "PURCHASE_ORDER_RECEIPT",
                "Purchase order " + current.purchaseNo(),
                "procurement.receipt." + requiredCommandId);

        repository.insertReceipt(
                UUID.randomUUID(), tenantId, requiredOrderId, quantity,
                inventory.event().id(), displayName(actor), actor.userId(),
                actor.systemAdminId(), actor.requestId());
        long nextReceived = Math.addExact(current.receivedQuantity(), quantity);
        ProcurementPurchaseOrderStatus nextStatus = nextReceived == current.quantity()
                ? ProcurementPurchaseOrderStatus.RECEIVED
                : ProcurementPurchaseOrderStatus.PARTIALLY_RECEIVED;
        if (repository.markReceived(
                tenantId, requiredOrderId, expectedVersion, quantity,
                nextStatus) != 1) {
            throw new ProcurementPurchaseOrderConflictException(
                    "optimistic_lock_conflict");
        }
        ProcurementPurchaseOrderView changed = repository.find(
                        tenantId, requiredOrderId)
                .orElseThrow(ProcurementPurchaseOrderService::notFound);
        repository.insertReceiptCommand(
                tenantId, requiredCommandId, requiredOrderId,
                fingerprint, changed.version());
        audit(actor, changed, quantity, inventory.event().id());
        return changed;
    }

    @Transactional
    public ProcurementPurchaseOrderView review(
            ProcurementPlanActor actor, UUID purchaseOrderId,
            long expectedVersion, boolean approved, String reviewNote) {
        UUID tenantId = requireWriteActor(actor);
        UUID requiredOrderId = requireId(purchaseOrderId);
        if (expectedVersion < 0) {
            throw new IllegalArgumentException(
                    "Procurement review version is invalid");
        }
        String normalizedNote = normalizeText(reviewNote, 500);
        if (!approved && normalizedNote == null) {
            throw new IllegalArgumentException(
                    "A rejection reason is required");
        }
        ProcurementPurchaseOrderView current = repository.lock(
                        tenantId, requiredOrderId)
                .orElseThrow(ProcurementPurchaseOrderService::notFound);
        scopeEvaluator.requireVisible(scope(actor), current.warehouseId());
        if (current.version() != expectedVersion) {
            throw new ProcurementPurchaseOrderConflictException(
                    "optimistic_lock_conflict");
        }
        if (current.status() != ProcurementPurchaseOrderStatus.NEW_ORDER) {
            throw new ProcurementPurchaseOrderConflictException(
                    "invalid_order_state");
        }
        if (repository.review(
                tenantId, requiredOrderId, expectedVersion, approved,
                normalizedNote, displayName(actor), actor.userId(),
                actor.systemAdminId()) != 1) {
            throw new ProcurementPurchaseOrderConflictException(
                    "optimistic_lock_conflict");
        }
        ProcurementPurchaseOrderView changed = repository.find(
                        tenantId, requiredOrderId)
                .orElseThrow(ProcurementPurchaseOrderService::notFound);
        audit(actor, approved ? APPROVED : REJECTED, changed);
        return changed;
    }

    private void audit(
            ProcurementPlanActor actor, String action,
            ProcurementPurchaseOrderView created) {
        Map<String, String> details = new HashMap<>();
        if (created.planId() != null) {
            details.put("planId", created.planId().toString());
        }
        details.put("supplierId", created.supplierId().toString());
        details.put("skuId", created.skuId().toString());
        details.put("warehouseId", created.warehouseId().toString());
        details.put("locationId", created.locationId().toString());
        details.put("quantity", Long.toString(created.quantity()));
        details.put("status", created.status().name());
        details.put("version", Long.toString(created.version()));
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(),
                action, RESOURCE_TYPE,
                created.id().toString(), actor.requestId(), actor.sourceIp(),
                Map.copyOf(details)));
    }

    private void audit(
            ProcurementPlanActor actor, ProcurementPurchaseOrderView order,
            long quantity, UUID inventoryEventId) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(),
                RECEIVED, RESOURCE_TYPE, order.id().toString(),
                actor.requestId(), actor.sourceIp(),
                Map.of(
                        "warehouseId", order.warehouseId().toString(),
                        "skuId", order.skuId().toString(),
                        "receiptQuantity", Long.toString(quantity),
                        "receivedQuantity", Long.toString(order.receivedQuantity()),
                        "status", order.status().name(),
                        "version", Long.toString(order.version()),
                        "inventoryEventId", inventoryEventId.toString())));
    }

    private static InventoryActor inventoryActor(ProcurementPlanActor actor) {
        return new InventoryActor(
                actor.tenantId(), actor.userId(), actor.systemAdminId(),
                actor.requestId(), actor.sourceIp());
    }

    private WarehouseScopeAccess scope(ProcurementPlanActor actor) {
        return scopeEvaluator.evaluate(
                actor.tenantId(), actor.userId(), actor.systemAdminId());
    }

    private static UUID requireActor(ProcurementPlanActor actor) {
        if (actor == null || actor.tenantId() == null) {
            throw new IllegalArgumentException("A tenant actor is required");
        }
        return actor.tenantId();
    }

    private static UUID requireWriteActor(ProcurementPlanActor actor) {
        UUID tenantId = requireActor(actor);
        if ((actor.userId() == null) == (actor.systemAdminId() == null)
                || actor.requestId() == null
                || !REQUEST_ID.matcher(actor.requestId()).matches()) {
            throw new IllegalArgumentException(
                    "A traceable procurement order actor is required");
        }
        return tenantId;
    }

    private static UUID requireId(UUID value) {
        if (value == null) throw new IllegalArgumentException("An ID is required");
        return value;
    }

    private static String displayName(ProcurementPlanActor actor) {
        if (actor.displayName() == null || actor.displayName().isBlank()) {
            return actor.systemAdminId() == null ? "租户用户" : "系统管理员";
        }
        String normalized = actor.displayName().strip();
        if (normalized.length() > 160) {
            throw new IllegalArgumentException("Operator display name is too long");
        }
        return normalized;
    }

    private static String normalizeKeyword(String value) {
        if (value == null || value.isBlank()) return null;
        String normalized = value.strip().toLowerCase(Locale.ROOT);
        if (normalized.length() > 120) {
            throw new IllegalArgumentException("Procurement order keyword is too long");
        }
        return normalized;
    }

    private static String normalizeText(String value, int maximum) {
        if (value == null || value.isBlank()) return null;
        String normalized = value.strip();
        if (normalized.codePoints().anyMatch(Character::isISOControl)
                || normalized.length() > maximum) {
            throw new IllegalArgumentException("Procurement order note is invalid");
        }
        return normalized;
    }

    private static String followUpCsv(
            List<ProcurementPurchaseOrderView> orders) {
        StringBuilder output = new StringBuilder("\uFEFF");
        appendCsvRow(output, FOLLOW_UP_CSV_HEADER);
        for (ProcurementPurchaseOrderView order : orders) {
            appendCsvRow(output, List.of(
                    order.purchaseNo(), nullable(order.planNo()), order.skuCode(),
                    order.skuName(), nullable(order.skuVariant()),
                    order.warehouseCode(), order.warehouseName(),
                    order.locationCode(), order.locationName(),
                    order.supplierCode(), order.supplierName(),
                    nullable(order.supplierSkuCode()),
                    Long.toString(order.quantity()),
                    Long.toString(order.receivedQuantity()),
                    Long.toString(order.quantity() - order.receivedQuantity()),
                    order.status() == ProcurementPurchaseOrderStatus.NEW_ORDER
                            ? "待收货" : "部分收货",
                    order.orderedByDisplayName(), order.createdAt().toString(),
                    order.lastReceivedAt() == null
                            ? "" : order.lastReceivedAt().toString()));
        }
        return output.toString();
    }

    private static String purchaseOrderCsv(
            List<ProcurementPurchaseOrderView> orders) {
        StringBuilder output = new StringBuilder("\uFEFF");
        appendCsvRow(output, PURCHASE_ORDER_CSV_HEADER);
        for (ProcurementPurchaseOrderView order : orders) {
            appendCsvRow(output, List.of(
                    order.purchaseNo(), purchaseOrderStatus(order.status()),
                    nullable(order.planNo()), order.supplierCode(), order.supplierName(),
                    nullable(order.supplierSkuCode()), order.skuCode(),
                    order.skuName(), nullable(order.skuVariant()),
                    order.warehouseCode(), order.warehouseName(),
                    order.locationCode(), order.locationName(),
                    Long.toString(order.quantity()),
                    Long.toString(order.receivedQuantity()),
                    Long.toString(order.quantity() - order.receivedQuantity()),
                    nullable(order.orderNote()), order.orderedByDisplayName(),
                    order.lastReceivedAt() == null
                            ? "" : order.lastReceivedAt().toString(),
                    order.createdAt().toString(), order.updatedAt().toString()));
        }
        return output.toString();
    }

    private static String purchaseOrderStatus(
            ProcurementPurchaseOrderStatus status) {
        return switch (status) {
            case NEW_ORDER -> "待审核";
            case APPROVED -> "待收货";
            case REJECTED -> "已驳回";
            case PARTIALLY_RECEIVED -> "部分收货";
            case RECEIVED -> "已收货";
        };
    }

    private static String receiptLedgerCsv(
            List<ProcurementReceiptView> receipts) {
        StringBuilder output = new StringBuilder("\uFEFF");
        appendCsvRow(output, RECEIPT_LEDGER_CSV_HEADER);
        for (ProcurementReceiptView receipt : receipts) {
            appendCsvRow(output, List.of(
                    receipt.receivedAt().toString(), receipt.purchaseNo(),
                    nullable(receipt.planNo()), receipt.supplierCode(),
                    receipt.supplierName(), receipt.skuCode(),
                    receipt.skuName(), nullable(receipt.skuVariant()),
                    receipt.warehouseCode(), receipt.warehouseName(),
                    receipt.locationCode(), receipt.locationName(),
                    Long.toString(receipt.quantity()),
                    Long.toString(receipt.inventoryBalanceAfter()),
                    Long.toString(receipt.inventoryLedgerSequence()),
                    receipt.inventoryEventId().toString(),
                    receipt.receivedByDisplayName()));
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

    private static String fingerprint(String... values) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            for (String value : values) {
                byte[] bytes = value == null
                        ? new byte[] {-1} : value.getBytes(StandardCharsets.UTF_8);
                digest.update(Integer.toString(bytes.length)
                        .getBytes(StandardCharsets.US_ASCII));
                digest.update((byte) ':');
                digest.update(bytes);
                digest.update((byte) ';');
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    private static ResourceNotFoundException notFound() {
        return new ResourceNotFoundException("Procurement purchase order was not found");
    }

    private static ResourceNotFoundException planNotFound() {
        return new ResourceNotFoundException("Procurement plan was not found");
    }

    public record ProcurementFollowUpExport(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }

    public record ProcurementPurchaseOrderExport(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }

    public record ProcurementReceiptLedgerExport(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }
}
