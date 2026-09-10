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
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.procurement.domain.ProcurementReturnSearchField;
import cn.xzkj.erp.procurement.repository.ProcurementPurchaseReturnRepository;
import cn.xzkj.erp.procurement.repository.ProcurementPurchaseReturnRepository.ReturnCommandRecord;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ProcurementPurchaseReturnService {
    private static final String RESOURCE_TYPE = "procurement_purchase_return";
    private static final String CREATED = "procurement_purchase_return.created";

    private final ProcurementPurchaseReturnRepository repository;
    private final WarehouseScopeEvaluator scopeEvaluator;
    private final InventoryService inventoryService;
    private final SecurityAuditRecorder auditRecorder;

    public ProcurementPurchaseReturnService(
            ProcurementPurchaseReturnRepository repository,
            WarehouseScopeEvaluator scopeEvaluator,
            InventoryService inventoryService,
            SecurityAuditRecorder auditRecorder) {
        this.repository = repository;
        this.scopeEvaluator = scopeEvaluator;
        this.inventoryService = inventoryService;
        this.auditRecorder = auditRecorder;
    }

    @Transactional(readOnly = true)
    public Page<ProcurementPurchaseReturnView> list(
            ProcurementPlanActor actor, ProcurementReturnSearchField searchField,
            String keyword, Instant returnedFrom, Instant returnedTo,
            Pageable pageable) {
        UUID tenantId = requireActor(actor);
        if (returnedFrom != null && returnedTo != null
                && returnedFrom.isAfter(returnedTo)) {
            throw new IllegalArgumentException(
                    "Invalid procurement return date range");
        }
        WarehouseScopeAccess scope = scope(actor);
        if (!scope.allowsAll() && scope.warehouseIds().isEmpty()) {
            return Page.empty(pageable);
        }
        return repository.list(
                tenantId, scope.warehouseIds(), scope.allowsAll(),
                searchField == null
                        ? ProcurementReturnSearchField.RETURN_NO : searchField,
                normalizeKeyword(keyword), returnedFrom, returnedTo, pageable);
    }

    @Transactional(readOnly = true)
    public Page<ProcurementReturnableOrderView> listReturnableOrders(
            ProcurementPlanActor actor, String keyword, Pageable pageable) {
        UUID tenantId = requireActor(actor);
        WarehouseScopeAccess scope = scope(actor);
        if (!scope.allowsAll() && scope.warehouseIds().isEmpty()) {
            return Page.empty(pageable);
        }
        return repository.listReturnableOrders(
                tenantId, scope.warehouseIds(), scope.allowsAll(),
                normalizeKeyword(keyword), pageable);
    }

    @Transactional
    public ProcurementPurchaseReturnView create(
            ProcurementPlanActor actor, UUID commandId, UUID purchaseOrderId,
            long expectedOrderVersion, long quantity, String reason) {
        UUID tenantId = requireWriteActor(actor);
        UUID requiredCommandId = requireId(commandId);
        UUID requiredOrderId = requireId(purchaseOrderId);
        String normalizedReason = normalizeReason(reason);
        if (expectedOrderVersion < 0 || quantity < 1) {
            throw new IllegalArgumentException(
                    "Procurement return input is invalid");
        }
        String fingerprint = fingerprint(
                requiredOrderId.toString(),
                Long.toString(expectedOrderVersion),
                Long.toString(quantity), normalizedReason);
        repository.lockCommand(tenantId, requiredCommandId);
        ReturnCommandRecord command = repository.findCommand(
                        tenantId, requiredCommandId)
                .orElse(null);
        if (command != null) {
            if (!command.fingerprint().equals(fingerprint)) {
                throw new ProcurementPurchaseOrderConflictException(
                        "idempotency_conflict");
            }
            ProcurementPurchaseReturnView replay = repository.find(
                            tenantId, command.purchaseReturnId())
                    .orElseThrow(ProcurementPurchaseReturnService::notFound);
            scopeEvaluator.requireVisible(scope(actor), replay.warehouseId());
            return replay;
        }

        ProcurementReturnableOrderView order = repository.lockReturnableOrder(
                        tenantId, requiredOrderId)
                .orElseThrow(ProcurementPurchaseReturnService::orderNotFound);
        scopeEvaluator.requireVisible(scope(actor), order.warehouseId());
        if (order.version() != expectedOrderVersion) {
            throw new ProcurementPurchaseOrderConflictException(
                    "optimistic_lock_conflict");
        }
        if (quantity > order.returnableQuantity()) {
            throw new ProcurementPurchaseOrderConflictException(
                    "return_quantity_exceeds_received");
        }

        Page<InventoryBalanceView> balances = inventoryService.listBalances(
                inventoryActor(actor), order.warehouseId(), order.skuId(),
                null, PageRequest.of(0, 2));
        if (balances.getTotalElements() > 1) {
            throw new ProcurementPurchaseOrderConflictException(
                    "duplicate_inventory_balance");
        }
        if (balances.isEmpty()
                || balances.getContent().getFirst().onHand() < quantity) {
            throw new ProcurementPurchaseOrderConflictException(
                    "insufficient_inventory");
        }
        InventoryBalanceView balance = balances.getContent().getFirst();
        UUID returnId = UUID.randomUUID();
        String returnNo = "PR-"
                + LocalDate.now(ZoneOffset.UTC)
                        .format(DateTimeFormatter.BASIC_ISO_DATE)
                + "-" + returnId.toString().replace("-", "")
                        .substring(0, 28).toUpperCase(Locale.ROOT);
        InventoryMutationResult inventory = inventoryService.adjust(
                inventoryActor(actor), InventoryEventType.PURCHASE_ORDER_RETURN,
                order.skuId(), order.warehouseId(), -quantity,
                balance.version(), "PURCHASE_ORDER_RETURN",
                "Purchase return " + returnNo + " for " + order.purchaseNo(),
                "procurement.return." + requiredCommandId);
        repository.insert(
                returnId, tenantId, returnNo, requiredOrderId, quantity,
                normalizedReason, inventory.event().id(), displayName(actor),
                actor.userId(), actor.systemAdminId(), actor.requestId());
        if (repository.markReturned(
                tenantId, requiredOrderId, expectedOrderVersion, quantity) != 1) {
            throw new ProcurementPurchaseOrderConflictException(
                    "optimistic_lock_conflict");
        }
        ProcurementPurchaseReturnView created = repository.find(
                        tenantId, returnId)
                .orElseThrow(ProcurementPurchaseReturnService::notFound);
        repository.insertCommand(
                tenantId, requiredCommandId, returnId, fingerprint);
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                tenantId, actor.userId(), actor.systemAdminId(), CREATED,
                RESOURCE_TYPE, returnId.toString(), actor.requestId(),
                actor.sourceIp(), Map.of(
                        "purchaseOrderId", requiredOrderId.toString(),
                        "quantity", Long.toString(quantity),
                        "inventoryEventId", inventory.event().id().toString(),
                        "returnNo", returnNo)));
        return created;
    }

    private WarehouseScopeAccess scope(ProcurementPlanActor actor) {
        return scopeEvaluator.evaluate(
                actor.tenantId(), actor.userId(), actor.systemAdminId());
    }

    private static InventoryActor inventoryActor(ProcurementPlanActor actor) {
        return new InventoryActor(
                actor.tenantId(), actor.userId(), actor.systemAdminId(),
                actor.requestId(), actor.sourceIp());
    }

    private static UUID requireActor(ProcurementPlanActor actor) {
        if (actor == null || actor.tenantId() == null
                || (actor.userId() == null) == (actor.systemAdminId() == null)) {
            throw new IllegalArgumentException(
                    "Procurement return actor is invalid");
        }
        return actor.tenantId();
    }

    private static UUID requireWriteActor(ProcurementPlanActor actor) {
        UUID tenantId = requireActor(actor);
        if (actor.requestId() == null || actor.requestId().isBlank()) {
            throw new IllegalArgumentException(
                    "Procurement return request id is required");
        }
        return tenantId;
    }

    private static UUID requireId(UUID value) {
        if (value == null) throw new IllegalArgumentException("Identity is required");
        return value;
    }

    private static String displayName(ProcurementPlanActor actor) {
        if (actor.displayName() == null || actor.displayName().isBlank()) {
            throw new IllegalArgumentException("Display name is required");
        }
        return actor.displayName().trim();
    }

    private static String normalizeKeyword(String value) {
        if (value == null || value.isBlank()) return null;
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        if (normalized.length() > 120) {
            throw new IllegalArgumentException("Keyword is too long");
        }
        return normalized;
    }

    private static String normalizeReason(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Return reason is required");
        }
        String normalized = value.trim();
        if (normalized.length() > 500
                || normalized.chars().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException("Return reason is invalid");
        }
        return normalized;
    }

    private static String fingerprint(String... values) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            for (String value : values) {
                byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
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
        return new ResourceNotFoundException(
                "Procurement purchase return was not found");
    }

    private static ResourceNotFoundException orderNotFound() {
        return new ResourceNotFoundException(
                "Returnable purchase order was not found");
    }
}
