package cn.xzkj.erp.fulfillment.service;

import static cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.PackageStatus;
import static cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.PauseState;
import static cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.ShortageState;
import static cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.Status;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.Line;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.Package;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.PackageItem;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.Plan;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.PlanSummary;
import cn.xzkj.erp.fulfillment.inventory.InventoryReservationPort;
import cn.xzkj.erp.fulfillment.inventory.InventoryReservationPort.ConsumptionCommand;
import cn.xzkj.erp.fulfillment.inventory.InventoryReservationPort.CorrectionCommand;
import cn.xzkj.erp.fulfillment.inventory.InventoryReservationPort.ReleaseCommand;
import cn.xzkj.erp.fulfillment.inventory.InventoryReservationPort.ReservationCommand;
import cn.xzkj.erp.fulfillment.repository.FulfillmentRepository;
import cn.xzkj.erp.fulfillment.repository.FulfillmentRepository.AllocatedLine;
import cn.xzkj.erp.fulfillment.service.FulfillmentExceptions.Conflict;
import cn.xzkj.erp.fulfillment.service.FulfillmentExceptions.Invalid;
import cn.xzkj.erp.fulfillment.service.FulfillmentExceptions.NotFound;
import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeAccess;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeEvaluator;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;

@Service
public class FulfillmentService {

    private static final Pattern KEY = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$");
    private static final Pattern CODE = Pattern.compile("^[A-Z][A-Z0-9_]{0,63}$");
    private static final String PLAN_CREATED = "fulfillment.plan.created";
    private static final String ALLOCATION_CHANGED = "fulfillment.allocation.changed";
    private static final String PICK_RECORDED = "fulfillment.pick.recorded";
    private static final String PACKAGE_CREATED = "fulfillment.package.created";
    private static final String PACKAGE_SEALED = "fulfillment.package.sealed";
    private static final String PACKAGE_HANDED_OVER = "fulfillment.package.handed_over";
    private static final String HANDOVER_CORRECTED =
            "fulfillment.package.handover_corrected";
    private static final String CANCELLED = "fulfillment.cancelled";
    private static final String PAUSED = "fulfillment.paused";
    private static final String RESUMED = "fulfillment.resumed";

    private final FulfillmentRepository repository;
    private final InventoryReservationPort inventory;
    private final SecurityAuditRecorder auditRecorder;
    private final WarehouseScopeEvaluator scopeEvaluator;
    private final Clock clock;

    @Autowired
    public FulfillmentService(FulfillmentRepository repository, InventoryReservationPort inventory,
            SecurityAuditRecorder auditRecorder,
            WarehouseScopeEvaluator scopeEvaluator) {
        this(repository, inventory, auditRecorder, scopeEvaluator, Clock.systemUTC());
    }

    FulfillmentService(FulfillmentRepository repository, InventoryReservationPort inventory,
            SecurityAuditRecorder auditRecorder,
            WarehouseScopeEvaluator scopeEvaluator,
            Clock clock) {
        this.repository = repository;
        this.inventory = inventory;
        this.auditRecorder = auditRecorder;
        this.scopeEvaluator = scopeEvaluator;
        this.clock = clock;
    }

    FulfillmentService(
            FulfillmentRepository repository,
            InventoryReservationPort inventory,
            SecurityAuditRecorder auditRecorder,
            Clock clock) {
        this(repository, inventory, auditRecorder, null, clock);
    }

    @Transactional
    public Plan create(Actor actor, UUID orderId, String idempotencyKey) {
        String key = requiredKey(idempotencyKey);
        String fingerprint = sha256(orderId + "\n" + key);
        repository.lockCreationKey(actor.tenantId(), key);
        var replay = repository.findByCreationKey(actor.tenantId(), key);
        if (replay.isPresent()) {
            Plan existing = replay.get();
            if (!existing.orderId().equals(orderId)) {
                throw new Conflict("idempotency_conflict");
            }
            requireVisible(actor, existing);
            return existing;
        }
        requireOrderVisible(actor, orderId);
        var order = repository.findEligibleOrderForUpdate(actor.tenantId(), orderId)
                .orElseThrow(() -> new Conflict("order_not_ready"));
        UUID id = UUID.randomUUID();
        repository.insertPlan(id, actor.tenantId(), order, key, fingerprint);
        Plan created = require(actor.tenantId(), id);
        audit(actor, PLAN_CREATED, "fulfillment_plan", id, Map.of(
                "status", created.status().name(),
                "lineCount", Integer.toString(created.lines().size()),
                "plannedQuantity", Integer.toString(created.plannedQuantity())));
        return created;
    }

    @Transactional(readOnly = true)
    public PageResult<PlanSummary> list(Actor actor, Status status, UUID shopId, String keyword,
            int page, int size) {
        WarehouseScopeAccess scope = scope(actor);
        UUID tenantId = actor.tenantId();
        String safeKeyword = keyword == null || keyword.isBlank() ? null : keyword.strip();
        if (safeKeyword != null && safeKeyword.length() > 100) {
            throw new Invalid("keyword");
        }
        List<PlanSummary> items = repository.list(
                tenantId, status, shopId, safeKeyword, page, size,
                scope.allowsAll(), scope.allowsAll() ? null : actor.userId());
        long total = repository.count(
                tenantId, status, shopId, safeKeyword,
                scope.allowsAll(), scope.allowsAll() ? null : actor.userId());
        return new PageResult<>(items, page, size, total,
                total == 0 ? 0 : (int) ((total + size - 1) / size));
    }

    @Transactional(readOnly = true)
    public Plan get(Actor actor, UUID planId) {
        Plan plan = require(actor.tenantId(), planId);
        requireVisible(actor, plan);
        return plan;
    }

    @Transactional(readOnly = true)
    public Plan getByOrder(Actor actor, UUID orderId) {
        Plan plan = repository.findByOrderId(
                actor.tenantId(), orderId)
                .orElseThrow(NotFound::new);
        requireVisible(actor, plan);
        return plan;
    }

    @Transactional
    public Plan allocate(Actor actor, UUID planId, long version, UUID commandId,
            List<Allocation> requested) {
        String fingerprint = fingerprintAllocation(planId, version, requested);
        Plan replay = replay(actor, commandId, "ALLOCATE", planId, fingerprint);
        if (replay != null) {
            return replay;
        }
        Plan plan = lockVersion(actor.tenantId(), planId, version);
        requireVisible(actor, plan);
        requireActive(plan);
        if (plan.status() != Status.PENDING_ALLOCATION) {
            throw new Conflict("illegal_transition");
        }
        if (requested == null || requested.isEmpty()) {
            throw new Invalid("assignments");
        }
        requireAllVisible(
                scope(actor),
                requested.stream().map(Allocation::warehouseId)
                        .filter(Objects::nonNull)
                        .collect(java.util.stream.Collectors.toSet()));

        Map<UUID, Line> originalByOrderLine = new HashMap<>();
        Map<UUID, Integer> expectedQuantity = new HashMap<>();
        for (Line line : plan.lines()) {
            originalByOrderLine.putIfAbsent(line.orderLineId(), line);
            expectedQuantity.merge(line.orderLineId(), line.plannedQuantity(), Integer::sum);
        }
        Map<UUID, Integer> requestedQuantity = new HashMap<>();
        for (Allocation item : requested) {
            if (item.quantity() < 1 || item.warehouseId() == null
                    || !originalByOrderLine.containsKey(item.orderLineId())) {
                throw new Invalid("assignments");
            }
            if (!repository.warehouseAssignable(actor.tenantId(), item.warehouseId(), item.locationId())) {
                throw new NotFound();
            }
            requestedQuantity.merge(item.orderLineId(), item.quantity(), Integer::sum);
        }
        if (!expectedQuantity.equals(requestedQuantity)) {
            throw new Conflict("quantity_mismatch");
        }

        List<AllocatedLine> replacements = new ArrayList<>();
        Map<UUID, Short> sequence = new HashMap<>();
        boolean negative = false;
        for (Allocation item : requested.stream()
                .sorted(Comparator.comparing(Allocation::orderLineId)
                        .thenComparing(Allocation::warehouseId)
                        .thenComparing(item -> Objects.toString(item.locationId(), "")))
                .toList()) {
            Line source = originalByOrderLine.get(item.orderLineId());
            UUID lineId = UUID.randomUUID();
            short split = sequence.compute(item.orderLineId(),
                    (id, current) -> current == null ? (short) 0 : (short) (current + 1));
            var result = inventory.reserve(new ReservationCommand(
                    actor.tenantId(), commandId, planId, lineId, source.skuId(),
                    item.warehouseId(), item.locationId(), item.quantity(),
                    actor.userId(), actor.systemAdminId(), actor.requestId()));
            negative |= result.resultingQuantity() < 0;
            replacements.add(new AllocatedLine(
                    lineId, item.orderLineId(), split, source.skuId(), item.warehouseId(),
                    item.locationId(), item.quantity(), source.externalLineRef(),
                    source.skuBusinessCode(), source.skuName(), result.operationReference()));
        }
        repository.replaceAllocations(actor.tenantId(), planId, replacements);
        repository.updatePlanState(actor.tenantId(), planId, Status.ALLOCATED,
                plan.pauseState(), plan.pauseReasonCode(),
                negative ? ShortageState.PARTIAL : ShortageState.NONE, null,
                0, 0, 0, 0, version);
        repository.recordCommand(actor.tenantId(), commandId, "fulfillment_plan", planId,
                "ALLOCATE", fingerprint, version + 1);
        Plan result = require(actor.tenantId(), planId);
        audit(actor, ALLOCATION_CHANGED, "fulfillment_plan", planId, Map.of(
                "assignmentCount", Integer.toString(replacements.size()),
                "plannedQuantity", Integer.toString(result.plannedQuantity()),
                "shortageState", result.shortageState().name(),
                "version", Long.toString(result.version())));
        return result;
    }

    @Transactional
    public Plan recordPick(Actor actor, UUID planId, long version, UUID commandId,
            List<QuantityChange> quantities) {
        String fingerprint = fingerprintQuantities("PICK", planId, version, quantities);
        Plan replay = replay(actor, commandId, "PICK", planId, fingerprint);
        if (replay != null) {
            return replay;
        }
        Plan plan = lockVersion(actor.tenantId(), planId, version);
        requireVisible(actor, plan);
        requireActive(plan);
        if (plan.status() != Status.ALLOCATED && plan.status() != Status.PICKING) {
            throw new Conflict("illegal_transition");
        }
        Map<UUID, Integer> values = quantityMap(quantities);
        int totalPicked = 0;
        for (Line line : plan.lines()) {
            int picked = values.getOrDefault(line.id(), line.pickedQuantity());
            if (picked < line.packedQuantity() || picked > line.plannedQuantity()) {
                throw new Conflict("quantity_mismatch");
            }
            repository.updateLineProgress(actor.tenantId(), planId, line.id(), picked,
                    line.packedQuantity(), line.shippedQuantity(), line.cancelledQuantity());
            totalPicked += picked;
        }
        Status status = totalPicked == 0 ? Status.ALLOCATED : Status.PICKING;
        repository.updatePlanState(actor.tenantId(), planId, status, plan.pauseState(),
                plan.pauseReasonCode(), plan.shortageState(), null, totalPicked,
                plan.packedQuantity(), plan.shippedQuantity(), plan.cancelledQuantity(), version);
        audit(actor, commandId, "PICK", fingerprint, planId, version + 1,
                PICK_RECORDED, Map.of("pickedQuantity", Integer.toString(totalPicked)));
        return require(actor.tenantId(), planId);
    }

    @Transactional
    public Plan createPackage(Actor actor, UUID planId, long version, UUID commandId,
            UUID warehouseId, String packageNumber, List<PackageItem> items) {
        String fingerprint = sha256("PACKAGE\n" + planId + "\n" + version + "\n"
                + warehouseId + "\n" + packageNumber + "\n" + items);
        Plan replay = replay(actor, commandId, "PACKAGE", planId, fingerprint);
        if (replay != null) {
            return replay;
        }
        Plan plan = lockVersion(actor.tenantId(), planId, version);
        requireVisible(actor, plan);
        requireActive(plan);
        if (plan.status() != Status.PICKING && plan.status() != Status.PACKING) {
            throw new Conflict("illegal_transition");
        }
        if (packageNumber == null || packageNumber.isBlank() || packageNumber.strip().length() > 80
                || items == null || items.isEmpty()) {
            throw new Invalid("package");
        }
        Map<UUID, Line> lines = new HashMap<>();
        plan.lines().forEach(line -> lines.put(line.id(), line));
        int packedAdded = 0;
        for (PackageItem item : items) {
            Line line = lines.get(item.fulfillmentLineId());
            if (line == null || !warehouseId.equals(line.warehouseId()) || item.quantity() < 1
                    || line.packedQuantity() + item.quantity() > line.pickedQuantity()) {
                throw new Conflict("quantity_mismatch");
            }
            packedAdded += item.quantity();
        }
        UUID packageId = UUID.randomUUID();
        repository.insertPackage(packageId, actor.tenantId(), planId, warehouseId,
                packageNumber.strip(), items);
        for (PackageItem item : items) {
            Line line = lines.get(item.fulfillmentLineId());
            repository.updateLineProgress(actor.tenantId(), planId, line.id(), line.pickedQuantity(),
                    line.packedQuantity() + item.quantity(), line.shippedQuantity(),
                    line.cancelledQuantity());
        }
        int packed = plan.packedQuantity() + packedAdded;
        repository.updatePlanState(actor.tenantId(), planId, Status.PACKING, plan.pauseState(),
                plan.pauseReasonCode(), plan.shortageState(), null, plan.pickedQuantity(),
                packed, plan.shippedQuantity(), plan.cancelledQuantity(), version);
        audit(actor, commandId, "PACKAGE", fingerprint, planId, version + 1,
                PACKAGE_CREATED, Map.of(
                        "packageId", packageId.toString(),
                        "itemCount", Integer.toString(items.size()),
                        "packedQuantity", Integer.toString(packed)));
        return require(actor.tenantId(), planId);
    }

    @Transactional
    public Plan sealPackage(Actor actor, UUID planId, UUID packageId, long planVersion,
            long packageVersion, UUID commandId) {
        String fingerprint = sha256("SEAL\n" + planId + "\n" + packageId + "\n"
                + planVersion + "\n" + packageVersion);
        Plan replay = replay(actor, commandId, "SEAL", planId, fingerprint);
        if (replay != null) {
            return replay;
        }
        Plan plan = lockVersion(actor.tenantId(), planId, planVersion);
        requireVisible(actor, plan);
        requireActive(plan);
        Package target = packageById(plan, packageId);
        if (target.items().isEmpty()) {
            throw new Conflict("empty_package");
        }
        try {
            repository.sealPackage(actor.tenantId(), planId, packageId, packageVersion);
        } catch (IllegalStateException exception) {
            throw new Conflict("package_conflict");
        }
        Plan refreshed = require(actor.tenantId(), planId);
        boolean allPacked = refreshed.packedQuantity() + refreshed.cancelledQuantity()
                == refreshed.plannedQuantity();
        Status next = allPacked ? Status.READY_TO_SHIP : Status.PACKING;
        repository.updatePlanState(actor.tenantId(), planId, next, plan.pauseState(),
                plan.pauseReasonCode(), plan.shortageState(), null, plan.pickedQuantity(),
                plan.packedQuantity(), plan.shippedQuantity(), plan.cancelledQuantity(), planVersion);
        audit(actor, commandId, "SEAL", fingerprint, planId, planVersion + 1,
                PACKAGE_SEALED, Map.of("packageId", packageId.toString()));
        return require(actor.tenantId(), planId);
    }

    @Transactional
    public Plan handover(Actor actor, UUID planId, UUID packageId, long planVersion,
            long packageVersion, UUID commandId, Instant occurredAt,
            String carrierCode, String serviceCode, String trackingReference) {
        String fingerprint = sha256("HANDOVER\n" + planId + "\n" + packageId + "\n"
                + planVersion + "\n" + packageVersion + "\n"
                + occurredAt + "\n" + carrierCode + "\n" + serviceCode + "\n" + trackingReference);
        Plan replay = replay(actor, commandId, "HANDOVER", planId, fingerprint);
        if (replay != null) {
            return replay;
        }
        Plan plan = lockVersion(actor.tenantId(), planId, planVersion);
        requireVisible(actor, plan);
        requireActive(plan);
        Package target = packageById(plan, packageId);
        if (target.status() != PackageStatus.SEALED
                || !Set.of("PASSED", "OVERRIDDEN").contains(target.weighingStatus().name())
                || target.weightGrams() == null || target.weightGrams().signum() <= 0
                || occurredAt == null
                || occurredAt.isAfter(clock.instant().plusSeconds(300))) {
            throw new Conflict("handover_not_ready");
        }
        int shippedAdded = target.items().stream().mapToInt(PackageItem::quantity).sum();
        UUID shipmentEventId = UUID.randomUUID();
        try {
            repository.handoverPackage(actor.tenantId(), planId, packageId, packageVersion,
                    target.weightGrams(), shipmentEventId, occurredAt, commandId.toString(),
                    actor.userId(), actor.requestId(), normalizedCode(carrierCode),
                    optionalCode(serviceCode), optionalReference(trackingReference),
                    plan.orderId(), plan.shopId());
        } catch (IllegalStateException exception) {
            throw new Conflict("package_conflict");
        }
        Map<UUID, Integer> packageQuantities = new HashMap<>();
        target.items().forEach(item -> packageQuantities.merge(
                item.fulfillmentLineId(), item.quantity(), Integer::sum));
        for (Map.Entry<UUID, Integer> item : packageQuantities.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .toList()) {
            inventory.consume(new ConsumptionCommand(
                    actor.tenantId(), commandId, shipmentEventId, planId,
                    item.getKey(), item.getValue(), actor.userId(),
                    actor.systemAdminId(), actor.requestId()));
        }
        for (Line line : plan.lines()) {
            int shipped = line.shippedQuantity() + packageQuantities.getOrDefault(line.id(), 0);
            repository.updateLineProgress(actor.tenantId(), planId, line.id(), line.pickedQuantity(),
                    line.packedQuantity(), shipped, line.cancelledQuantity());
        }
        int shipped = plan.shippedQuantity() + shippedAdded;
        int open = plan.plannedQuantity() - shipped - plan.cancelledQuantity();
        Status next = open == 0
                ? (plan.cancelledQuantity() == 0 ? Status.SHIPPED : Status.PARTIALLY_FULFILLED)
                : Status.PARTIALLY_SHIPPED;
        repository.updatePlanState(actor.tenantId(), planId, next, plan.pauseState(),
                plan.pauseReasonCode(), plan.shortageState(), null, plan.pickedQuantity(),
                plan.packedQuantity(), shipped, plan.cancelledQuantity(), planVersion);
        repository.updateFulfillmentOrderStatus(
                actor.tenantId(), plan.orderId(),
                next == Status.SHIPPED ? "SHIPPED" : "FULFILLING");
        audit(actor, commandId, "HANDOVER", fingerprint, planId, planVersion + 1,
                PACKAGE_HANDED_OVER, Map.of(
                        "packageId", packageId.toString(),
                        "shippedQuantity", Integer.toString(shipped),
                        "status", next.name()));
        return require(actor.tenantId(), planId);
    }

    public Plan handover(Actor actor, UUID planId, UUID packageId, long planVersion,
            long packageVersion, UUID commandId, BigDecimal ignoredLegacyWeight,
            Instant occurredAt, String carrierCode, String serviceCode,
            String trackingReference) {
        return handover(actor, planId, packageId, planVersion, packageVersion,
                commandId, occurredAt, carrierCode, serviceCode, trackingReference);
    }

    @Transactional
    public Plan correctHandover(
            Actor actor, UUID planId, UUID packageId, long planVersion,
            long packageVersion, UUID commandId, Instant occurredAt,
            String reasonCode) {
        String reason = normalizedCode(reasonCode);
        String fingerprint = sha256("HANDOVER_CORRECTION\n" + planId + "\n"
                + packageId + "\n" + planVersion + "\n" + packageVersion
                + "\n" + occurredAt + "\n" + reason);
        Plan replay = replay(
                actor, commandId, "HANDOVER_CORRECTION", planId, fingerprint);
        if (replay != null) {
            return replay;
        }
        Plan plan = lockVersion(actor.tenantId(), planId, planVersion);
        requireVisible(actor, plan);
        Package target = packageById(plan, packageId);
        if (target.status() != PackageStatus.HANDED_OVER
                || target.shopifyPublicationStatus()
                        != cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.ShopifyPublicationStatus.NOT_PUBLISHED
                || occurredAt == null
                || occurredAt.isAfter(clock.instant().plusSeconds(300))) {
            throw new Conflict("handover_correction_not_allowed");
        }
        UUID originalEventId = repository.handoverEventId(
                        actor.tenantId(), planId, packageId)
                .orElseThrow(() -> new Conflict(
                        "handover_correction_not_allowed"));
        UUID correctionEventId = UUID.randomUUID();
        try {
            repository.recordHandoverCorrection(
                    actor.tenantId(), planId, packageId, packageVersion,
                    correctionEventId, originalEventId, occurredAt,
                    commandId.toString(), actor.userId(), actor.requestId(),
                    reason, plan.orderId(), plan.shopId());
        } catch (IllegalStateException exception) {
            throw new Conflict("package_conflict");
        }
        Map<UUID, Integer> packageQuantities = new HashMap<>();
        target.items().forEach(item -> packageQuantities.merge(
                item.fulfillmentLineId(), item.quantity(), Integer::sum));
        for (Map.Entry<UUID, Integer> item : packageQuantities.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .toList()) {
            inventory.reverseConsumption(new CorrectionCommand(
                    actor.tenantId(), commandId, originalEventId,
                    correctionEventId, planId, item.getKey(),
                    item.getValue(), actor.userId(), actor.systemAdminId(),
                    actor.requestId()));
        }
        for (Line line : plan.lines()) {
            int quantity = packageQuantities.getOrDefault(line.id(), 0);
            repository.updateLineProgress(
                    actor.tenantId(), planId, line.id(),
                    line.pickedQuantity(),
                    line.packedQuantity() - quantity,
                    line.shippedQuantity() - quantity,
                    line.cancelledQuantity());
        }
        int corrected = target.items().stream()
                .mapToInt(PackageItem::quantity).sum();
        int packed = plan.packedQuantity() - corrected;
        int shipped = plan.shippedQuantity() - corrected;
        repository.updatePlanState(
                actor.tenantId(), planId, Status.PACKING,
                plan.pauseState(), plan.pauseReasonCode(),
                plan.shortageState(), null, plan.pickedQuantity(), packed,
                shipped, plan.cancelledQuantity(), planVersion);
        repository.updateFulfillmentOrderStatus(
                actor.tenantId(), plan.orderId(), "FULFILLING");
        audit(actor, commandId, "HANDOVER_CORRECTION", fingerprint,
                planId, planVersion + 1, HANDOVER_CORRECTED, Map.of(
                        "packageId", packageId.toString(),
                        "originalShipmentEventId", originalEventId.toString(),
                        "correctionShipmentEventId", correctionEventId.toString(),
                        "correctedQuantity", Integer.toString(corrected),
                        "reasonCode", reason));
        return require(actor.tenantId(), planId);
    }

    @Transactional
    public Plan cancelOpen(Actor actor, UUID planId, long version, UUID commandId, String reasonCode) {
        String reason = normalizedCode(reasonCode);
        String fingerprint = sha256("CANCEL\n" + planId + "\n" + version + "\n" + reason);
        Plan replay = replay(actor, commandId, "CANCEL", planId, fingerprint);
        if (replay != null) {
            return replay;
        }
        Plan plan = lockVersion(actor.tenantId(), planId, version);
        requireVisible(actor, plan);
        if (isTerminal(plan.status())) {
            throw new Conflict("terminal_state");
        }
        int open = plan.plannedQuantity() - plan.shippedQuantity() - plan.cancelledQuantity();
        if (open <= 0) {
            throw new Conflict("no_open_quantity");
        }
        for (Line line : plan.lines()) {
            int lineOpen = line.plannedQuantity() - line.shippedQuantity() - line.cancelledQuantity();
            if (lineOpen > 0 && line.warehouseId() != null
                    && line.inventoryOperationRef() != null) {
                inventory.release(new ReleaseCommand(
                        actor.tenantId(), commandId, planId, line.id(), lineOpen,
                        actor.userId(), actor.systemAdminId(), actor.requestId()));
            }
            repository.updateLineProgress(actor.tenantId(), planId, line.id(), line.pickedQuantity(),
                    line.packedQuantity(), line.shippedQuantity(),
                    line.cancelledQuantity() + Math.max(0, lineOpen));
        }
        int cancelled = plan.cancelledQuantity() + open;
        repository.voidOpenPackages(actor.tenantId(), planId);
        Status next = plan.shippedQuantity() == 0 ? Status.CANCELLED : Status.PARTIALLY_FULFILLED;
        repository.updatePlanState(actor.tenantId(), planId, next, PauseState.ACTIVE,
                null, plan.shortageState(), null, plan.pickedQuantity(),
                plan.packedQuantity(), plan.shippedQuantity(), cancelled, version);
        repository.updateFulfillmentOrderStatus(
                actor.tenantId(), plan.orderId(),
                plan.shippedQuantity() == 0 ? "CANCELLED" : "SHIPPED");
        audit(actor, commandId, "CANCEL", fingerprint, planId, version + 1,
                CANCELLED, Map.of(
                        "reasonCode", reason,
                        "cancelledQuantity", Integer.toString(open),
                        "status", next.name()));
        return require(actor.tenantId(), planId);
    }

    @Transactional
    public Plan pause(Actor actor, UUID planId, long version, UUID commandId, String reasonCode) {
        String reason = normalizedCode(reasonCode);
        String fingerprint = sha256("PAUSE\n" + planId + "\n" + version + "\n" + reason);
        Plan replay = replay(actor, commandId, "PAUSE", planId, fingerprint);
        if (replay != null) {
            return replay;
        }
        Plan plan = lockVersion(actor.tenantId(), planId, version);
        requireVisible(actor, plan);
        if (isTerminal(plan.status()) || plan.pauseState() == PauseState.PAUSED) {
            throw new Conflict("illegal_transition");
        }
        repository.updatePlanState(actor.tenantId(), planId, plan.status(), PauseState.PAUSED,
                reason, plan.shortageState(), null, plan.pickedQuantity(), plan.packedQuantity(),
                plan.shippedQuantity(), plan.cancelledQuantity(), version);
        audit(actor, commandId, "PAUSE", fingerprint, planId, version + 1,
                PAUSED, Map.of("reasonCode", reason));
        return require(actor.tenantId(), planId);
    }

    @Transactional
    public Plan resume(Actor actor, UUID planId, long version, UUID commandId) {
        String fingerprint = sha256("RESUME\n" + planId + "\n" + version);
        Plan replay = replay(actor, commandId, "RESUME", planId, fingerprint);
        if (replay != null) {
            return replay;
        }
        Plan plan = lockVersion(actor.tenantId(), planId, version);
        requireVisible(actor, plan);
        if (plan.pauseState() != PauseState.PAUSED || isTerminal(plan.status())) {
            throw new Conflict("illegal_transition");
        }
        repository.updatePlanState(actor.tenantId(), planId, plan.status(), PauseState.ACTIVE,
                null, plan.shortageState(), null, plan.pickedQuantity(), plan.packedQuantity(),
                plan.shippedQuantity(), plan.cancelledQuantity(), version);
        audit(actor, commandId, "RESUME", fingerprint, planId, version + 1,
                RESUMED, Map.of());
        return require(actor.tenantId(), planId);
    }

    private Plan lockVersion(UUID tenantId, UUID planId, long version) {
        Plan plan = repository.lock(tenantId, planId).orElseThrow(NotFound::new);
        if (plan.version() != version) {
            throw new Conflict("stale_version");
        }
        return plan;
    }

    private Plan require(UUID tenantId, UUID planId) {
        return repository.find(tenantId, planId, false).orElseThrow(NotFound::new);
    }

    private static void requireActive(Plan plan) {
        if (plan.pauseState() == PauseState.PAUSED) {
            throw new Conflict("plan_paused");
        }
        if (isTerminal(plan.status())) {
            throw new Conflict("terminal_state");
        }
    }

    private static boolean isTerminal(Status status) {
        return status == Status.SHIPPED || status == Status.PARTIALLY_FULFILLED
                || status == Status.CANCELLED;
    }

    private static Package packageById(Plan plan, UUID packageId) {
        return plan.packages().stream().filter(item -> item.id().equals(packageId))
                .findFirst().orElseThrow(NotFound::new);
    }

    private Plan replay(Actor actor, UUID commandId, String type, UUID resourceId,
            String fingerprint) {
        UUID tenantId = actor.tenantId();
        if (commandId == null) {
            throw new Invalid("commandId");
        }
        repository.lockCommand(tenantId, commandId);
        var existing = repository.command(tenantId, commandId).orElse(null);
        if (existing == null) {
            return null;
        }
        if (!existing.resourceId().equals(resourceId)
                || !existing.commandType().equals(type)
                || !existing.fingerprint().equals(fingerprint)) {
            throw new Conflict("idempotency_conflict");
        }
        Plan plan = require(tenantId, resourceId);
        requireVisible(actor, plan);
        return plan;
    }

    private void requireOrderVisible(Actor actor, UUID orderId) {
        WarehouseScopeAccess scope = scope(actor);
        if (scope.allowsAll()) {
            return;
        }
        Set<UUID> warehouses =
                Set.copyOf(repository.orderWarehouseIds(actor.tenantId(), orderId));
        if (warehouses.isEmpty()) {
            throw new NotFound();
        }
        requireAllVisible(scope, warehouses);
    }

    private void requireVisible(Actor actor, Plan plan) {
        WarehouseScopeAccess scope = scope(actor);
        if (scope.allowsAll()) {
            return;
        }
        Set<UUID> warehouses =
                Set.copyOf(repository.warehouseIds(actor.tenantId(), plan.id()));
        if (warehouses.isEmpty()) {
            throw new NotFound();
        }
        requireAllVisible(scope, warehouses);
    }

    private void requireAllVisible(
            WarehouseScopeAccess scope, Set<UUID> warehouses) {
        try {
            scopeEvaluator.requireAllVisible(scope, warehouses);
        } catch (ResourceNotFoundException exception) {
            throw new NotFound();
        }
    }

    private WarehouseScopeAccess scope(Actor actor) {
        if (actor == null || actor.tenantId() == null) {
            throw new Invalid("actor");
        }
        if (scopeEvaluator == null) {
            return new WarehouseScopeAccess(
                    cn.xzkj.erp.iam.warehousescope.WarehouseScopeMode.ALL,
                    Set.of());
        }
        return scopeEvaluator.evaluate(
                actor.tenantId(), actor.userId(), actor.systemAdminId());
    }

    private void audit(Actor actor, UUID commandId, String commandType,
            String fingerprint, UUID planId, long responseVersion, String action,
            Map<String, String> details) {
        repository.recordCommand(actor.tenantId(), commandId, "fulfillment_plan", planId,
                commandType, fingerprint, responseVersion);
        audit(actor, action, "fulfillment_plan", planId, details);
    }

    private void audit(Actor actor, String action, String resourceType, UUID resourceId,
            Map<String, String> details) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(), action,
                resourceType, resourceId.toString(), actor.requestId(), actor.sourceIp(), details));
    }

    private static Map<UUID, Integer> quantityMap(List<QuantityChange> changes) {
        if (changes == null || changes.isEmpty()) {
            throw new Invalid("quantities");
        }
        Map<UUID, Integer> result = new HashMap<>();
        for (QuantityChange change : changes) {
            if (change.lineId() == null || change.quantity() < 0
                    || result.put(change.lineId(), change.quantity()) != null) {
                throw new Invalid("quantities");
            }
        }
        return result;
    }

    private static String fingerprintAllocation(UUID planId, long version, List<Allocation> items) {
        return sha256("ALLOCATE\n" + planId + "\n" + version + "\n"
                + (items == null ? "" : items.stream()
                        .sorted(Comparator.comparing(Allocation::orderLineId)
                                .thenComparing(Allocation::warehouseId)
                                .thenComparing(item -> Objects.toString(item.locationId(), "")))
                        .toList()));
    }

    private static String fingerprintQuantities(String type, UUID planId, long version,
            List<QuantityChange> items) {
        return sha256(type + "\n" + planId + "\n" + version + "\n"
                + (items == null ? "" : items.stream()
                        .sorted(Comparator.comparing(QuantityChange::lineId)).toList()));
    }

    private static String requiredKey(String value) {
        if (value == null || !KEY.matcher(value.strip()).matches()) {
            throw new Invalid("idempotencyKey");
        }
        return value.strip();
    }

    private static String normalizedCode(String value) {
        if (value == null || !CODE.matcher(value.strip().toUpperCase()).matches()) {
            throw new Invalid("code");
        }
        return value.strip().toUpperCase();
    }

    private static String optionalCode(String value) {
        return value == null || value.isBlank() ? null : normalizedCode(value);
    }

    private static String optionalReference(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String stripped = value.strip();
        if (stripped.length() > 160 || stripped.chars().anyMatch(Character::isISOControl)) {
            throw new Invalid("trackingReference");
        }
        return stripped;
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 unavailable", exception);
        }
    }

    public record Actor(
            UUID tenantId,
            UUID userId,
            UUID systemAdminId,
            String requestId,
            String sourceIp) {
    }

    public record Allocation(
            UUID orderLineId,
            int quantity,
            UUID warehouseId,
            UUID locationId) {
    }

    public record QuantityChange(UUID lineId, int quantity) {
    }

    public record PageResult<T>(
            List<T> items,
            int page,
            int size,
            long totalElements,
            int totalPages) {
    }
}
