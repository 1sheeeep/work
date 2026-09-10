package cn.xzkj.erp.inventory.service;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeAccess;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeEvaluator;
import cn.xzkj.erp.inventory.domain.InventoryEventType;
import cn.xzkj.erp.inventory.repository.InventoryStore;
import cn.xzkj.erp.inventory.repository.InventoryStore.BalanceState;
import cn.xzkj.erp.inventory.repository.InventoryStore.IdempotencyRecord;
import cn.xzkj.erp.inventory.repository.InventoryStore.MasterDataState;
import cn.xzkj.erp.inventory.repository.InventoryStore.SourceEvent;
import cn.xzkj.erp.platform.domain.SensitiveTextRedactor;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.product.domain.ProductStatus;
import cn.xzkj.erp.warehouse.domain.WarehouseStatus;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class InventoryService {
    private static final ZoneOffset INVENTORY_QUERY_ZONE =
            ZoneOffset.ofHours(8);
    private static final LocalDate MIN_INVENTORY_QUERY_DATE =
            LocalDate.of(1, 1, 1);
    private static final LocalDate MAX_INVENTORY_QUERY_DATE =
            LocalDate.of(9999, 12, 31);
    private static final String INVENTORY_EVENT_RECORDED =
            "inventory.event.recorded";
    private static final Pattern SAFE_CODE =
            Pattern.compile("^[A-Z][A-Z0-9_]{1,63}$");
    private static final Pattern IDEMPOTENCY_KEY =
            Pattern.compile("^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$");
    private static final Pattern REQUEST_ID =
            Pattern.compile("^[A-Za-z0-9._:-]{1,100}$");
    private static final int MAX_NOTE_LENGTH = 500;
    private static final String ADJUSTMENT_OPERATION = "ADJUSTMENT";
    private static final String REVERSAL_OPERATION = "REVERSAL";

    private final InventoryStore store;
    private final WarehouseScopeEvaluator scopeEvaluator;
    private final SecurityAuditRecorder auditRecorder;

    public InventoryService(
            InventoryStore store,
            WarehouseScopeEvaluator scopeEvaluator,
            SecurityAuditRecorder auditRecorder) {
        this.store = store;
        this.scopeEvaluator = scopeEvaluator;
        this.auditRecorder = auditRecorder;
    }

    @Transactional(readOnly = true)
    public Page<InventoryBalanceView> listBalances(
            InventoryActor actor,
            UUID warehouseId,
            UUID skuId,
            String keyword,
            Pageable pageable) {
        return listBalances(
                actor,
                warehouseId,
                skuId,
                InventoryBalanceSearchField.ALL,
                keyword,
                pageable);
    }

    @Transactional(readOnly = true)
    public Page<InventoryBalanceView> listBalances(
            InventoryActor actor,
            UUID warehouseId,
            UUID skuId,
            InventoryBalanceSearchField searchField,
            String keyword,
            Pageable pageable) {
        return listBalances(
                actor,
                warehouseId,
                skuId,
                searchField,
                keyword,
                null,
                null,
                null,
                null,
                pageable);
    }

    @Transactional(readOnly = true)
    public Page<InventoryBalanceView> listBalances(
            InventoryActor actor,
            UUID warehouseId,
            UUID skuId,
            InventoryBalanceSearchField searchField,
            String keyword,
            Long onHandMin,
            Long onHandMax,
            Pageable pageable) {
        return listBalances(
                actor,
                warehouseId,
                skuId,
                searchField,
                keyword,
                onHandMin,
                onHandMax,
                null,
                null,
                pageable);
    }

    @Transactional(readOnly = true)
    public Page<InventoryBalanceView> listBalances(
            InventoryActor actor,
            UUID warehouseId,
            UUID skuId,
            InventoryBalanceSearchField searchField,
            String keyword,
            Long onHandMin,
            Long onHandMax,
            LocalDate updatedFrom,
            LocalDate updatedTo,
            Pageable pageable) {
        return listBalances(
                actor,
                warehouseId,
                skuId,
                null,
                searchField,
                keyword,
                onHandMin,
                onHandMax,
                updatedFrom,
                updatedTo,
                pageable);
    }

    @Transactional(readOnly = true)
    public Page<InventoryBalanceView> listBalances(
            InventoryActor actor,
            UUID warehouseId,
            UUID skuId,
            UUID categoryId,
            InventoryBalanceSearchField searchField,
            String keyword,
            Long onHandMin,
            Long onHandMax,
            LocalDate updatedFrom,
            LocalDate updatedTo,
            Pageable pageable) {
        UUID tenantId = requireActor(actor);
        WarehouseScopeAccess scope = scope(actor);
        requireVisibleFilter(scope, warehouseId);
        if (onHandMin != null
                && onHandMax != null
                && onHandMin > onHandMax) {
            throw new IllegalArgumentException(
                    "Minimum on-hand quantity cannot exceed maximum");
        }
        if (updatedFrom != null
                && updatedTo != null
                && updatedFrom.isAfter(updatedTo)) {
            throw new IllegalArgumentException(
                    "Balance updated-from date cannot exceed updated-to date");
        }
        if (!supportedInventoryQueryDate(updatedFrom)
                || !supportedInventoryQueryDate(updatedTo)) {
            throw new IllegalArgumentException(
                    "Balance updated date is outside the supported range");
        }
        Instant updatedFromInclusive = updatedFrom == null
                ? null
                : updatedFrom.atStartOfDay(INVENTORY_QUERY_ZONE).toInstant();
        Instant updatedBefore = updatedTo == null
                ? null
                : updatedTo.plusDays(1)
                        .atStartOfDay(INVENTORY_QUERY_ZONE)
                        .toInstant();
        String normalizedKeyword = normalizeKeyword(keyword);
        if (!scope.allowsAll() && scope.warehouseIds().isEmpty()) {
            return Page.empty(pageable);
        }
        return store.listBalances(
                tenantId,
                scope.warehouseIds(),
                scope.allowsAll(),
                warehouseId,
                skuId,
                categoryId,
                java.util.Objects.requireNonNull(searchField),
                normalizedKeyword,
                onHandMin,
                onHandMax,
                updatedFromInclusive,
                updatedBefore,
                pageable);
    }

    private static boolean supportedInventoryQueryDate(LocalDate value) {
        return value == null
                || (!value.isBefore(MIN_INVENTORY_QUERY_DATE)
                    && !value.isAfter(MAX_INVENTORY_QUERY_DATE));
    }

    @Transactional(readOnly = true)
    public InventoryBalanceView getBalance(
            InventoryActor actor, UUID balanceId) {
        UUID tenantId = requireActor(actor);
        InventoryBalanceView balance = findBalance(tenantId, balanceId);
        scopeEvaluator.requireVisible(scope(actor), balance.warehouseId());
        return balance;
    }

    @Transactional(readOnly = true)
    public List<InventorySkuSummaryView> listSkuSummaries(
            InventoryActor actor,
            List<UUID> skuIds) {
        UUID tenantId = requireActor(actor);
        if (skuIds == null || skuIds.isEmpty() || skuIds.size() > 50
                || skuIds.stream().anyMatch(java.util.Objects::isNull)) {
            throw new IllegalArgumentException(
                    "Between 1 and 50 SKU identities are required");
        }
        Set<UUID> requiredSkuIds = Set.copyOf(skuIds);
        WarehouseScopeAccess scope = scope(actor);
        if (!scope.allowsAll() && scope.warehouseIds().isEmpty()) {
            return List.of();
        }
        return store.listSkuSummaries(
                tenantId,
                scope.warehouseIds(),
                scope.allowsAll(),
                requiredSkuIds);
    }

    @Transactional
    public InventoryMutationResult adjust(
            InventoryActor actor,
            InventoryEventType eventType,
            UUID skuId,
            UUID warehouseId,
            long signedDelta,
            long expectedVersion,
            String reason,
            String note,
            String idempotencyKey) {
        UUID tenantId = requireWriteActor(actor);
        if (eventType != InventoryEventType.OPENING_BALANCE
                && eventType != InventoryEventType.CORRECTION
                && eventType != InventoryEventType.WAREHOUSE_TRANSFER_SHIPMENT
                && eventType != InventoryEventType.WAREHOUSE_TRANSFER_RECEIPT
                && eventType != InventoryEventType.PURCHASE_ORDER_RECEIPT
                && eventType != InventoryEventType.PURCHASE_ORDER_RETURN) {
            throw new IllegalArgumentException("Invalid adjustment type");
        }
        requireDelta(signedDelta);
        requireExpectedVersion(expectedVersion);
        UUID requiredSkuId = requireId(skuId);
        UUID requiredWarehouseId = requireId(warehouseId);
        scopeEvaluator.requireVisible(scope(actor), requiredWarehouseId);
        String normalizedReason = normalizeReason(reason);
        String normalizedNote = normalizeNote(note);
        String normalizedKey = normalizeIdempotencyKey(idempotencyKey);
        String fingerprint = fingerprint(
                eventType.name(),
                requiredSkuId.toString(),
                requiredWarehouseId.toString(),
                Long.toString(signedDelta),
                Long.toString(expectedVersion),
                normalizedReason,
                normalizedNote);
        store.lockIdempotency(tenantId, ADJUSTMENT_OPERATION, normalizedKey);
        InventoryMutationResult replay = replay(
                actor,
                tenantId,
                ADJUSTMENT_OPERATION,
                normalizedKey,
                fingerprint);
        if (replay != null) {
            return replay;
        }
        requireActiveMasterData(
                store.lockMasterData(
                        tenantId, requiredSkuId, requiredWarehouseId));
        BalanceState balance =
                store.lockBalance(tenantId, requiredSkuId, requiredWarehouseId);
        requireVersion(balance.version(), expectedVersion);
        long nextOnHand = addExact(balance.onHand(), signedDelta);
        InventoryMutationResult result = persistMutation(
                actor,
                eventType,
                requiredSkuId,
                requiredWarehouseId,
                signedDelta,
                balance,
                nextOnHand,
                normalizedReason,
                normalizedNote,
                null,
                ADJUSTMENT_OPERATION,
                normalizedKey,
                fingerprint);
        audit(actor, result.event(), INVENTORY_EVENT_RECORDED);
        return result;
    }

    @Transactional
    public InventoryMutationResult reverse(
            InventoryActor actor,
            UUID eventId,
            long expectedVersion,
            String reason,
            String note,
            String idempotencyKey) {
        UUID tenantId = requireWriteActor(actor);
        UUID requiredEventId = requireId(eventId);
        requireExpectedVersion(expectedVersion);
        String normalizedReason = normalizeReason(reason);
        String normalizedNote = normalizeNote(note);
        String normalizedKey = normalizeIdempotencyKey(idempotencyKey);
        String fingerprint = fingerprint(
                requiredEventId.toString(),
                Long.toString(expectedVersion),
                normalizedReason,
                normalizedNote);
        store.lockIdempotency(tenantId, REVERSAL_OPERATION, normalizedKey);
        InventoryMutationResult replay = replay(
                actor,
                tenantId,
                REVERSAL_OPERATION,
                normalizedKey,
                fingerprint);
        if (replay != null) {
            return replay;
        }
        InventoryEventView original = store.lockEvent(tenantId, requiredEventId)
                .orElseThrow(InventoryService::notFound);
        if (store.hasOperationalSource(tenantId, requiredEventId)) {
            throw new InventoryConflictException("reversal_not_allowed");
        }
        scopeEvaluator.requireVisible(scope(actor), original.warehouseId());
        requireActiveMasterData(store.lockMasterData(
                tenantId, original.skuId(), original.warehouseId()));
        if (original.eventType() == InventoryEventType.REVERSAL
                || original.eventType() == InventoryEventType.FULFILLMENT_SHIPMENT
                || original.eventType()
                        == InventoryEventType.WAREHOUSE_TRANSFER_SHIPMENT
                || original.eventType()
                        == InventoryEventType.WAREHOUSE_TRANSFER_RECEIPT
                || original.eventType()
                        == InventoryEventType.PURCHASE_ORDER_RECEIPT
                || original.eventType()
                        == InventoryEventType.PURCHASE_ORDER_RETURN
                || store.hasReversal(tenantId, requiredEventId)) {
            throw new InventoryConflictException("reversal_not_allowed");
        }
        BalanceState balance = store.lockBalance(
                tenantId, original.skuId(), original.warehouseId());
        requireVersion(balance.version(), expectedVersion);
        long delta;
        try {
            delta = Math.negateExact(original.signedDelta());
        } catch (ArithmeticException exception) {
            throw new IllegalArgumentException(
                    "Inventory delta is outside the supported range");
        }
        long nextOnHand = addExact(balance.onHand(), delta);
        InventoryMutationResult result = persistMutation(
                actor,
                InventoryEventType.REVERSAL,
                original.skuId(),
                original.warehouseId(),
                delta,
                balance,
                nextOnHand,
                normalizedReason,
                normalizedNote,
                requiredEventId,
                REVERSAL_OPERATION,
                normalizedKey,
                fingerprint);
        audit(actor, result.event(), INVENTORY_EVENT_RECORDED);
        return result;
    }

    @Transactional
    public InventoryOperationalResult postOperationalDeltas(
            InventoryActor actor,
            InventoryEventType eventType,
            String sourceType,
            UUID sourceId,
            String reason,
            List<InventoryOperationalDelta> deltas) {
        UUID tenantId = requireWriteActor(actor);
        if (!isOperationalType(eventType)) {
            throw new IllegalArgumentException("Invalid operational event type");
        }
        String normalizedSourceType = normalizeReason(sourceType);
        UUID requiredSourceId = requireId(sourceId);
        String normalizedReason = normalizeReason(reason);
        if (deltas == null || deltas.isEmpty() || deltas.size() > 10000) {
            throw new IllegalArgumentException("Operational deltas are required");
        }
        List<InventoryOperationalDelta> ordered = deltas.stream()
                .peek(InventoryService::validateOperationalDelta)
                .sorted(Comparator
                        .comparing((InventoryOperationalDelta value) ->
                                value.warehouseId().toString())
                        .thenComparing(value -> value.skuId().toString())
                        .thenComparing(value -> value.sourceLineId().toString()))
                .toList();
        Set<UUID> sourceLineIds = new HashSet<>();
        Set<BalanceKey> balanceKeys = new HashSet<>();
        for (InventoryOperationalDelta delta : ordered) {
            if (!sourceLineIds.add(delta.sourceLineId())) {
                throw new IllegalArgumentException(
                        "Operational source lines must be unique");
            }
            if (!balanceKeys.add(new BalanceKey(
                    delta.skuId(), delta.warehouseId()))) {
                throw new IllegalArgumentException(
                        "Operational balance dimensions must be unique");
            }
        }
        WarehouseScopeAccess scope = scope(actor);
        for (InventoryOperationalDelta delta : ordered) {
            scopeEvaluator.requireVisible(scope, delta.warehouseId());
            requireActiveMasterData(store.lockMasterData(
                    tenantId, delta.skuId(), delta.warehouseId()));
        }
        Map<BalanceKey, BalanceState> balances = new LinkedHashMap<>();
        for (InventoryOperationalDelta delta : ordered) {
            BalanceKey key = new BalanceKey(
                    delta.skuId(), delta.warehouseId());
            balances.put(
                    key,
                    store.lockBalance(
                            tenantId, delta.skuId(), delta.warehouseId()));
        }
        List<InventoryEventView> events = new ArrayList<>(ordered.size());
        List<InventoryBalanceView> updatedBalances =
                new ArrayList<>(ordered.size());
        for (InventoryOperationalDelta delta : ordered) {
            BalanceKey key = new BalanceKey(
                    delta.skuId(), delta.warehouseId());
            BalanceState balance = balances.get(key);
            long nextOnHand = addExact(balance.onHand(), delta.signedDelta());
            long nextVersion = Math.incrementExact(balance.version());
            InventoryEventView event = store.insertOperationalEvent(
                    UUID.randomUUID(),
                    tenantId,
                    eventType,
                    delta.skuId(),
                    delta.warehouseId(),
                    delta.signedDelta(),
                    nextOnHand,
                    nextVersion,
                    normalizedReason,
                    normalizedSourceType,
                    requiredSourceId,
                    delta.sourceLineId(),
                    null,
                    actor.userId(),
                    actor.systemAdminId(),
                    actor.requestId());
            store.updateBalance(
                    balance.id(),
                    balance.version(),
                    nextOnHand,
                    nextVersion,
                    event.id());
            audit(actor, event, INVENTORY_EVENT_RECORDED);
            events.add(event);
            updatedBalances.add(findBalance(tenantId, balance.id()));
        }
        return new InventoryOperationalResult(
                List.copyOf(events), List.copyOf(updatedBalances));
    }

    @Transactional(readOnly = true)
    public List<InventoryEventView> listOperationalEvents(
            InventoryActor actor,
            String sourceType,
            UUID sourceId) {
        UUID tenantId = requireActor(actor);
        String normalizedSourceType = normalizeReason(sourceType);
        UUID requiredSourceId = requireId(sourceId);
        List<SourceEvent> sourceEvents = store.listSourceEvents(
                tenantId,
                normalizedSourceType,
                requiredSourceId,
                null,
                false);
        WarehouseScopeAccess scope = scope(actor);
        for (SourceEvent sourceEvent : sourceEvents) {
            scopeEvaluator.requireVisible(
                    scope, sourceEvent.event().warehouseId());
        }
        return sourceEvents.stream().map(SourceEvent::event).toList();
    }

    @Transactional
    public InventoryOperationalResult reverseOperationalDeltas(
            InventoryActor actor,
            String sourceType,
            UUID sourceId,
            String reason) {
        UUID tenantId = requireWriteActor(actor);
        String normalizedSourceType = normalizeReason(sourceType);
        UUID requiredSourceId = requireId(sourceId);
        String normalizedReason = normalizeReason(reason);
        List<SourceEvent> sourceEvents = store.listSourceEvents(
                tenantId,
                normalizedSourceType,
                requiredSourceId,
                InventoryEventType.DOCUMENT_POST,
                true);
        if (sourceEvents.isEmpty()) {
            throw notFound();
        }
        Set<BalanceKey> keys = new HashSet<>();
        WarehouseScopeAccess scope = scope(actor);
        for (SourceEvent sourceEvent : sourceEvents) {
            InventoryEventView original = sourceEvent.event();
            requireId(sourceEvent.sourceLineId());
            scopeEvaluator.requireVisible(scope, original.warehouseId());
            requireActiveMasterData(store.lockMasterData(
                    tenantId,
                    original.skuId(),
                    original.warehouseId()));
            if (store.hasReversal(tenantId, original.id())) {
                throw new InventoryConflictException(
                        "reversal_not_allowed");
            }
            if (!keys.add(new BalanceKey(
                    original.skuId(), original.warehouseId()))) {
                throw new IllegalArgumentException(
                        "Operational balance dimensions must be unique");
            }
        }
        Map<BalanceKey, BalanceState> balances = new LinkedHashMap<>();
        for (SourceEvent sourceEvent : sourceEvents) {
            InventoryEventView original = sourceEvent.event();
            BalanceKey key = new BalanceKey(
                    original.skuId(), original.warehouseId());
            balances.put(
                    key,
                    store.lockBalance(
                            tenantId,
                            original.skuId(),
                            original.warehouseId()));
        }
        List<InventoryEventView> events =
                new ArrayList<>(sourceEvents.size());
        List<InventoryBalanceView> updatedBalances =
                new ArrayList<>(sourceEvents.size());
        for (SourceEvent sourceEvent : sourceEvents) {
            InventoryEventView original = sourceEvent.event();
            BalanceKey key = new BalanceKey(
                    original.skuId(), original.warehouseId());
            BalanceState balance = balances.get(key);
            long delta;
            try {
                delta = Math.negateExact(original.signedDelta());
            } catch (ArithmeticException exception) {
                throw new IllegalArgumentException(
                        "Inventory delta is outside the supported range");
            }
            long nextOnHand = addExact(balance.onHand(), delta);
            long nextVersion = Math.incrementExact(balance.version());
            InventoryEventView event = store.insertOperationalEvent(
                    UUID.randomUUID(),
                    tenantId,
                    InventoryEventType.REVERSAL,
                    original.skuId(),
                    original.warehouseId(),
                    delta,
                    nextOnHand,
                    nextVersion,
                    normalizedReason,
                    normalizedSourceType,
                    requiredSourceId,
                    sourceEvent.sourceLineId(),
                    original.id(),
                    actor.userId(),
                    actor.systemAdminId(),
                    actor.requestId());
            store.updateBalance(
                    balance.id(),
                    balance.version(),
                    nextOnHand,
                    nextVersion,
                    event.id());
            audit(actor, event, INVENTORY_EVENT_RECORDED);
            events.add(event);
            updatedBalances.add(findBalance(tenantId, balance.id()));
        }
        return new InventoryOperationalResult(
                List.copyOf(events), List.copyOf(updatedBalances));
    }

    private InventoryMutationResult persistMutation(
            InventoryActor actor,
            InventoryEventType eventType,
            UUID skuId,
            UUID warehouseId,
            long delta,
            BalanceState balance,
            long nextOnHand,
            String reason,
            String note,
            UUID reversalOf,
            String operation,
            String idempotencyKey,
            String fingerprint) {
        UUID eventId = UUID.randomUUID();
        long nextVersion = Math.incrementExact(balance.version());
        InventoryEventView event = store.insertEvent(
                eventId,
                actor.tenantId(),
                eventType,
                skuId,
                warehouseId,
                delta,
                nextOnHand,
                nextVersion,
                reason,
                note,
                reversalOf,
                actor.userId(),
                actor.systemAdminId(),
                actor.requestId());
        store.updateBalance(
                balance.id(),
                balance.version(),
                nextOnHand,
                nextVersion,
                eventId);
        store.insertIdempotency(
                actor.tenantId(),
                operation,
                idempotencyKey,
                fingerprint,
                eventId);
        return new InventoryMutationResult(
                event, findBalance(actor.tenantId(), balance.id()), false);
    }

    private void audit(
            InventoryActor actor,
            InventoryEventView event,
            String action) {
        auditRecorder.recordAtomically(auditEvent(actor, event, action));
    }

    private InventoryMutationResult replay(
            InventoryActor actor,
            UUID tenantId,
            String operation,
            String idempotencyKey,
            String fingerprint) {
        IdempotencyRecord record = store.findIdempotency(
                        tenantId, operation, idempotencyKey)
                .orElse(null);
        if (record == null) {
            return null;
        }
        if (!record.fingerprint().equals(fingerprint)) {
            throw new InventoryConflictException("idempotency_conflict");
        }
        InventoryEventView event = store.findEvent(
                        tenantId, record.resultEventId())
                .orElseThrow(InventoryService::notFound);
        scopeEvaluator.requireVisible(scope(actor), event.warehouseId());
        InventoryBalanceView current = store.listBalances(
                        tenantId,
                        Set.of(),
                        true,
                        event.warehouseId(),
                        event.skuId(),
                        null,
                        Pageable.ofSize(1))
                .getContent()
                .stream()
                .findFirst()
                .orElseThrow(InventoryService::notFound);
        InventoryBalanceView original = new InventoryBalanceView(
                current.id(),
                current.skuId(),
                current.skuBusinessCode(),
                current.skuName(),
                current.warehouseId(),
                current.warehouseBusinessCode(),
                current.warehouseName(),
                event.balanceAfter(),
                current.reserved(),
                event.balanceVersionAfter(),
                event.recordedAt());
        return new InventoryMutationResult(event, original, true);
    }

    private static SecurityAuditEvent auditEvent(
            InventoryActor actor, InventoryEventView event, String action) {
        return new SecurityAuditEvent(
                actor.tenantId(),
                actor.userId(),
                actor.systemAdminId(),
                action,
                "inventory_event",
                event.id().toString(),
                actor.requestId(),
                actor.sourceIp(),
                Map.of(
                        "eventType", event.eventType().name(),
                        "skuId", event.skuId().toString(),
                        "warehouseId", event.warehouseId().toString(),
                        "signedDelta", Long.toString(event.signedDelta()),
                        "balanceAfter", Long.toString(event.balanceAfter()),
                        "balanceVersion",
                                Long.toString(event.balanceVersionAfter()),
                        "reason", event.reason()));
    }

    private InventoryBalanceView findBalance(UUID tenantId, UUID balanceId) {
        return store.findBalance(tenantId, requireId(balanceId))
                .orElseThrow(InventoryService::notFound);
    }

    private WarehouseScopeAccess scope(InventoryActor actor) {
        return scopeEvaluator.evaluate(
                actor.tenantId(), actor.userId(), actor.systemAdminId());
    }

    private void requireVisibleFilter(
            WarehouseScopeAccess scope, UUID warehouseId) {
        if (warehouseId != null) {
            scopeEvaluator.requireVisible(scope, warehouseId);
        }
    }

    private static UUID requireActor(InventoryActor actor) {
        if (actor == null || actor.tenantId() == null) {
            throw new IllegalArgumentException("A tenant actor is required");
        }
        if ((actor.userId() == null) == (actor.systemAdminId() == null)) {
            throw new IllegalArgumentException("Exactly one actor identity is required");
        }
        return actor.tenantId();
    }

    private static UUID requireWriteActor(InventoryActor actor) {
        UUID tenantId = requireActor(actor);
        if (actor.requestId() == null
                || !REQUEST_ID.matcher(actor.requestId()).matches()) {
            throw new IllegalArgumentException("A valid request ID is required");
        }
        return tenantId;
    }

    private static void requireActiveMasterData(MasterDataState state) {
        if (state == null) {
            throw notFound();
        }
        if (state.skuStatus() != ProductStatus.ACTIVE
                || state.warehouseStatus() != WarehouseStatus.ACTIVE) {
            throw new InventoryConflictException("master_data_inactive");
        }
    }

    private static void requireVersion(long current, long expected) {
        if (current != expected) {
            throw new InventoryConflictException("stale_version");
        }
    }

    private static void requireExpectedVersion(long version) {
        if (version < 0) {
            throw new IllegalArgumentException("Invalid expected version");
        }
    }

    private static void requireDelta(long delta) {
        if (delta == 0 || delta == Long.MIN_VALUE) {
            throw new IllegalArgumentException("Delta must be a reversible nonzero integer");
        }
    }

    private static boolean isOperationalType(InventoryEventType eventType) {
        return eventType == InventoryEventType.DOCUMENT_POST;
    }

    private static void validateOperationalDelta(
            InventoryOperationalDelta delta) {
        if (delta == null) {
            throw new IllegalArgumentException(
                    "Operational delta is required");
        }
        requireId(delta.sourceLineId());
        requireId(delta.skuId());
        requireId(delta.warehouseId());
        requireDelta(delta.signedDelta());
    }

    private static UUID requireId(UUID value) {
        if (value == null) {
            throw new IllegalArgumentException("An ID is required");
        }
        return value;
    }

    private static long addExact(long left, long right) {
        try {
            return Math.addExact(left, right);
        } catch (ArithmeticException exception) {
            throw new IllegalArgumentException(
                    "Inventory quantity is outside the supported range");
        }
    }

    private static String normalizeReason(String value) {
        String reason = required(value).toUpperCase(Locale.ROOT);
        if (!SAFE_CODE.matcher(reason).matches()) {
            throw new IllegalArgumentException("Invalid inventory reason");
        }
        return reason;
    }

    private static String normalizeNote(String value) {
        String note = SensitiveTextRedactor.redactNullable(value);
        if (note != null && note.length() > MAX_NOTE_LENGTH) {
            throw new IllegalArgumentException("Inventory note is too long");
        }
        return note;
    }

    private static String normalizeKeyword(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return value.strip().toLowerCase(Locale.ROOT);
    }

    private static String normalizeIdempotencyKey(String value) {
        String key = required(value);
        if (!IDEMPOTENCY_KEY.matcher(key).matches()) {
            throw new IllegalArgumentException("Invalid idempotency key");
        }
        return key;
    }

    private static String required(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("A required value is missing");
        }
        return value.strip();
    }

    private static String fingerprint(String... values) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            for (String value : values) {
                byte[] bytes = (value == null ? "<null>" : value)
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

    private static ResourceNotFoundException notFound() {
        return new ResourceNotFoundException("Inventory resource was not found");
    }

    private record BalanceKey(UUID skuId, UUID warehouseId) {
    }
}
