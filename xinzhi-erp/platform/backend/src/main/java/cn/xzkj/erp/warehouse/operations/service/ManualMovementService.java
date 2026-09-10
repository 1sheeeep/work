package cn.xzkj.erp.warehouse.operations.service;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeAccess;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeEvaluator;
import cn.xzkj.erp.inventory.domain.InventoryEventType;
import cn.xzkj.erp.inventory.service.InventoryActor;
import cn.xzkj.erp.inventory.service.InventoryEventView;
import cn.xzkj.erp.inventory.service.InventoryOperationalDelta;
import cn.xzkj.erp.inventory.service.InventoryService;
import cn.xzkj.erp.platform.domain.SensitiveTextRedactor;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementDirection;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementAuditActions;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementApprovalStatus;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementEntryMode;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementReasonCode;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementSearchField;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementSource;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementStatus;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementTimeBucket;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementWmsStatus;
import cn.xzkj.erp.warehouse.operations.repository.ManualMovementStore;
import cn.xzkj.erp.warehouse.operations.repository.ManualMovementStore.CommandRecord;
import cn.xzkj.erp.warehouse.operations.repository.ManualMovementWorkflowStore;
import cn.xzkj.erp.warehouse.operations.repository.ManualMovementWorkflowStore.ConfigurationCommand;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementCommands.Batch;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementCommands.BatchItem;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementCommands.BoxInput;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementCommands.Review;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementCommands.LineInput;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementCommands.Save;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementCommands.Transition;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementViews.ContactInformation;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementViews.Detail;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementViews.Line;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementViews.LocationOption;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementViews.Mutation;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementViews.SkuOption;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementViews.Summary;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementViews.TimelineEvent;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementViews.WarehouseOption;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementViews.Settings;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementViews.MovementType;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementViews.PriceSnapshot;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementViews.BoxStock;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
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
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ManualMovementService {
    private static final String SOURCE_TYPE = "MANUAL_MOVEMENT";
    private static final Pattern REQUEST_ID =
            Pattern.compile("^[A-Za-z0-9._:-]{1,100}$");
    private static final int MAX_LINES = 500;
    static final int MAX_EXPORT_ROWS = 10_000;
    private static final String CSV_MEDIA_TYPE = "text/csv;charset=utf-8";
    private static final List<String> CSV_HEADER = List.of(
            "批次编号", "方向", "仓库编码", "仓库名称", "类型", "来源",
            "WMS状态", "审批状态", "计划数量", "实际数量", "金额", "币种",
            "创建人", "审核人", "单据状态", "创建时间");
    private final ManualMovementStore store;
    private final ManualMovementWorkflowStore workflowStore;
    private final InventoryService inventoryService;
    private final WarehouseScopeEvaluator scopeEvaluator;
    private final SecurityAuditRecorder auditRecorder;

    public ManualMovementService(
            ManualMovementStore store,
            ManualMovementWorkflowStore workflowStore,
            InventoryService inventoryService,
            WarehouseScopeEvaluator scopeEvaluator,
            SecurityAuditRecorder auditRecorder) {
        this.store = store;
        this.workflowStore = workflowStore;
        this.inventoryService = inventoryService;
        this.scopeEvaluator = scopeEvaluator;
        this.auditRecorder = auditRecorder;
    }

    @Transactional(readOnly = true)
    public Page<Summary> list(
            ManualMovementActor actor,
            UUID warehouseId,
            ManualMovementDirection direction,
            ManualMovementStatus status,
            ManualMovementReasonCode reasonCode,
            UUID movementTypeId,
            ManualMovementSource source,
            ManualMovementWmsStatus wmsStatus,
            ManualMovementApprovalStatus approvalStatus,
            ManualMovementSearchField searchField,
            ManualMovementTimeBucket timeBucket,
            String keyword,
            Instant createdFrom,
            Instant createdTo,
            Pageable pageable) {
        UUID tenantId = requireActor(actor);
        WarehouseScopeAccess access = scope(actor);
        if (warehouseId != null) {
            scopeEvaluator.requireVisible(access, warehouseId);
        }
        if (!access.allowsAll() && access.warehouseIds().isEmpty()) {
            return Page.empty(pageable);
        }
        String normalizedKeyword = normalizeKeyword(keyword);
        requireDateRange(createdFrom, createdTo);
        return store.list(
                tenantId,
                access.warehouseIds(),
                access.allowsAll(),
                warehouseId,
                direction,
                status,
                reasonCode,
                movementTypeId,
                source,
                wmsStatus,
                approvalStatus,
                searchField,
                timeBucket,
                normalizedKeyword,
                createdFrom,
                createdTo,
                pageable);
    }

    @Transactional(readOnly = true)
    public ManualMovementExport exportCsv(
            ManualMovementActor actor,
            UUID warehouseId,
            ManualMovementDirection direction,
            ManualMovementStatus status,
            ManualMovementReasonCode reasonCode,
            UUID movementTypeId,
            ManualMovementSource source,
            ManualMovementWmsStatus wmsStatus,
            ManualMovementApprovalStatus approvalStatus,
            ManualMovementSearchField searchField,
            ManualMovementTimeBucket timeBucket,
            String keyword,
            Instant createdFrom,
            Instant createdTo) {
        Page<Summary> page = list(
                actor, warehouseId, direction, status, reasonCode,
                movementTypeId, source, wmsStatus, approvalStatus,
                searchField, timeBucket, keyword, createdFrom, createdTo,
                PageRequest.of(0, MAX_EXPORT_ROWS + 1));
        if (page.getTotalElements() > MAX_EXPORT_ROWS
                || page.getNumberOfElements() > MAX_EXPORT_ROWS) {
            throw new ConflictException(
                    "Manual movement export exceeds the supported row limit");
        }
        String suffix = direction == null
                ? "all"
                : direction.name().toLowerCase(Locale.ROOT);
        return new ManualMovementExport(
                "manual-movements-" + suffix + ".csv",
                CSV_MEDIA_TYPE,
                page.getNumberOfElements(),
                csv(page.getContent()));
    }

    @Transactional(readOnly = true)
    public Detail get(ManualMovementActor actor, UUID movementId) {
        UUID tenantId = requireActor(actor);
        Summary summary = store.find(
                        tenantId, requireId(movementId), false)
                .orElseThrow(ManualMovementService::notFound);
        scopeEvaluator.requireVisible(scope(actor), summary.warehouseId());
        return store.detail(tenantId, summary);
    }

    @Transactional(readOnly = true)
    public List<TimelineEvent> timeline(
            ManualMovementActor actor, UUID movementId) {
        Detail detail = get(actor, movementId);
        return store.timeline(actor.tenantId(), detail.summary().id());
    }

    @Transactional(readOnly = true)
    public List<InventoryEventView> ledger(
            ManualMovementActor actor, UUID movementId) {
        Detail detail = get(actor, movementId);
        return inventoryService.listOperationalEvents(
                inventoryActor(actor),
                SOURCE_TYPE,
                detail.summary().id());
    }

    @Transactional(readOnly = true)
    public Page<WarehouseOption> warehouseOptions(
            ManualMovementActor actor,
            String keyword,
            Pageable pageable) {
        UUID tenantId = requireActor(actor);
        WarehouseScopeAccess access = scope(actor);
        if (!access.allowsAll() && access.warehouseIds().isEmpty()) {
            return Page.empty(pageable);
        }
        return store.warehouseOptions(
                tenantId,
                access.warehouseIds(),
                access.allowsAll(),
                normalizeKeyword(keyword),
                pageable);
    }

    @Transactional(readOnly = true)
    public Page<LocationOption> locationOptions(
            ManualMovementActor actor,
            UUID warehouseId,
            String keyword,
            Pageable pageable) {
        UUID tenantId = requireActor(actor);
        UUID requiredWarehouseId = requireId(warehouseId);
        scopeEvaluator.requireVisible(scope(actor), requiredWarehouseId);
        return store.locationOptions(
                tenantId,
                requiredWarehouseId,
                normalizeKeyword(keyword),
                pageable);
    }

    @Transactional(readOnly = true)
    public Page<SkuOption> skuOptions(
            ManualMovementActor actor,
            String keyword,
            Pageable pageable) {
        return store.skuOptions(
                requireActor(actor),
                normalizeKeyword(keyword),
                pageable);
    }

    @Transactional(readOnly = true)
    public PriceSnapshot priceSnapshot(
            ManualMovementActor actor,
            UUID skuId,
            ManualMovementDirection direction) {
        UUID tenantId = requireActor(actor);
        PriceSnapshot snapshot = workflowStore.priceSnapshot(
                        tenantId,
                        requireId(skuId),
                        java.util.Objects.requireNonNull(direction))
                .orElseThrow(ManualMovementService::notFound);
        scopeEvaluator.requireVisible(
                scope(actor), snapshot.warehouseId());
        return snapshot;
    }

    @Transactional(readOnly = true)
    public Settings settings(
            ManualMovementActor actor,
            ManualMovementDirection direction) {
        return workflowStore.settings(
                requireActor(actor),
                java.util.Objects.requireNonNull(direction));
    }

    @Transactional
    public Settings saveSettings(
            ManualMovementActor actor,
            ManualMovementDirection direction,
            boolean approvalRequired,
            boolean unitPriceRequired,
            boolean showCostPrice,
            String costUpdatePolicy,
            boolean contactRequired,
            long expectedVersion,
            UUID commandId) {
        UUID tenantId = requireWriteActor(actor);
        UUID requiredCommandId = requireId(commandId);
        ManualMovementDirection requiredDirection =
                java.util.Objects.requireNonNull(direction);
        String policy = normalizeText(costUpdatePolicy, 24);
        if (!Set.of("UPDATE_SNAPSHOT", "NO_UPDATE").contains(policy)) {
            throw new IllegalArgumentException(
                    "Unsupported cost update policy");
        }
        long requiredVersion = requireVersionValue(expectedVersion);
        String operation = "SAVE_SETTINGS";
        String fingerprint = sha256(List.of(
                operation,
                requiredDirection.name(),
                Boolean.toString(approvalRequired),
                Boolean.toString(unitPriceRequired),
                Boolean.toString(showCostPrice),
                policy,
                Boolean.toString(contactRequired),
                Long.toString(requiredVersion),
                requiredCommandId.toString()));
        workflowStore.lockConfigurationCommand(
                tenantId, requiredCommandId);
        Settings replay = replaySettings(
                tenantId,
                requiredCommandId,
                operation,
                fingerprint);
        if (replay != null) {
            return replay;
        }
        Settings saved = workflowStore.saveSettings(
                tenantId,
                requiredDirection,
                approvalRequired,
                unitPriceRequired,
                showCostPrice,
                policy,
                contactRequired,
                requiredVersion,
                actor);
        workflowStore.insertConfigurationCommand(
                tenantId,
                requiredCommandId,
                operation,
                fingerprint,
                settingsPayload(saved));
        audit(
                actor,
                ManualMovementAuditActions.SETTINGS_UPDATED,
                requiredDirection.name(),
                Map.of(
                        "direction", requiredDirection.name(),
                        "version", Long.toString(saved.version())));
        return saved;
    }

    @Transactional(readOnly = true)
    public Page<MovementType> types(
            ManualMovementActor actor,
            ManualMovementDirection direction,
            boolean includeInactive,
            Pageable pageable) {
        return workflowStore.types(
                requireActor(actor),
                direction,
                includeInactive,
                pageable);
    }

    @Transactional
    public MovementType saveType(
            ManualMovementActor actor,
            UUID typeId,
            ManualMovementDirection direction,
            String code,
            String name,
            String status,
            long expectedVersion,
            UUID commandId) {
        UUID tenantId = requireWriteActor(actor);
        UUID requiredCommandId = requireId(commandId);
        String normalizedCode = normalizeRequired(code, 40)
                .toUpperCase(Locale.ROOT);
        if (!normalizedCode.matches("^[A-Z][A-Z0-9_]{1,39}$")) {
            throw new IllegalArgumentException(
                    "Invalid movement type code");
        }
        String normalizedStatus = normalizeRequired(status, 16);
        if (!Set.of("ACTIVE", "INACTIVE").contains(normalizedStatus)) {
            throw new IllegalArgumentException(
                    "Invalid movement type status");
        }
        ManualMovementDirection requiredDirection =
                java.util.Objects.requireNonNull(direction);
        long requiredVersion = requireVersionValue(expectedVersion);
        String operation =
                typeId == null ? "CREATE_TYPE" : "UPDATE_TYPE";
        String fingerprint = sha256(List.of(
                operation,
                value(typeId),
                requiredDirection.name(),
                normalizedCode,
                normalizeRequired(name, 80),
                normalizedStatus,
                Long.toString(requiredVersion),
                requiredCommandId.toString()));
        workflowStore.lockConfigurationCommand(
                tenantId, requiredCommandId);
        MovementType replay = replayType(
                tenantId,
                requiredCommandId,
                operation,
                fingerprint);
        if (replay != null) {
            return replay;
        }
        MovementType saved = workflowStore.saveType(
                tenantId,
                typeId,
                requiredDirection,
                normalizedCode,
                normalizeRequired(name, 80),
                normalizedStatus,
                requiredVersion,
                actor);
        workflowStore.insertConfigurationCommand(
                tenantId,
                requiredCommandId,
                operation,
                fingerprint,
                typePayload(saved));
        audit(
                actor,
                ManualMovementAuditActions.TYPE_SAVED,
                saved.id().toString(),
                Map.of(
                        "direction", saved.direction().name(),
                        "status", saved.status(),
                        "version", Long.toString(saved.version())));
        return saved;
    }

    @Transactional(readOnly = true)
    public Page<BoxStock> boxStock(
            ManualMovementActor actor,
            UUID warehouseId,
            String keyword,
            Pageable pageable) {
        UUID tenantId = requireActor(actor);
        UUID requiredWarehouseId = requireId(warehouseId);
        scopeEvaluator.requireVisible(scope(actor), requiredWarehouseId);
        return workflowStore.boxStock(
                tenantId,
                requiredWarehouseId,
                normalizeKeyword(keyword),
                pageable);
    }

    @Transactional
    public Mutation create(
            ManualMovementActor actor, Save command) {
        UUID tenantId = requireWriteActor(actor);
        ValidatedSave validated = validate(command);
        if (validated.expectedVersion() != 0) {
            throw new ManualMovementConflictException("stale_version");
        }
        String fingerprint = fingerprint("CREATE", null, validated);
        store.lockCommand(tenantId, validated.commandId());
        Mutation replay = replay(
                tenantId,
                validated.commandId(),
                "CREATE",
                fingerprint);
        if (replay != null) {
            return replay;
        }
        scopeEvaluator.requireVisible(scope(actor), validated.warehouseId());
        lockActiveReferences(tenantId, validated);
        UUID movementId = UUID.randomUUID();
        store.insert(
                movementId,
                tenantId,
                movementNumber(validated.direction(), movementId),
                validated.warehouseId(),
                validated.direction(),
                validated.movementTypeId(),
                validated.reasonCode(),
                validated.source(),
                validated.entryMode(),
                validated.note(),
                validated.sourceReference(),
                validated.contactName(),
                validated.contactPhone(),
                validated.contactAddress(),
                validated.extensionAttributes(),
                actor);
        store.replaceLines(
                tenantId,
                movementId,
                validated.warehouseId(),
                validated.lines());
        store.replaceBoxes(
                tenantId,
                movementId,
                validated.warehouseId(),
                validated.boxes());
        store.insertTimelineEvent(
                tenantId,
                movementId,
                "CREATED",
                null,
                ManualMovementStatus.DRAFT,
                0,
                validated.commandId(),
                actor);
        store.insertCommand(
                tenantId,
                validated.commandId(),
                movementId,
                "CREATE",
                fingerprint,
                ManualMovementStatus.DRAFT,
                0);
        audit(
                actor,
                ManualMovementAuditActions.CREATED,
                movementId,
                ManualMovementStatus.DRAFT,
                0,
                validated);
        return new Mutation(
                movementId, ManualMovementStatus.DRAFT, 0, false);
    }

    @Transactional
    public Mutation update(
            ManualMovementActor actor,
            UUID movementId,
            Save command) {
        UUID tenantId = requireWriteActor(actor);
        UUID requiredId = requireId(movementId);
        ValidatedSave validated = validate(command);
        String fingerprint = fingerprint("UPDATE", requiredId, validated);
        store.lockCommand(tenantId, validated.commandId());
        Mutation replay = replay(
                tenantId,
                validated.commandId(),
                "UPDATE",
                fingerprint);
        if (replay != null) {
            return replay;
        }
        Summary current = lockedVisible(actor, tenantId, requiredId);
        requireVersion(current.version(), validated.expectedVersion());
        requireStatus(current.status(), ManualMovementStatus.DRAFT);
        scopeEvaluator.requireVisible(scope(actor), validated.warehouseId());
        lockActiveReferences(tenantId, validated);
        store.updateDraft(
                tenantId,
                requiredId,
                validated.expectedVersion(),
                validated.warehouseId(),
                validated.direction(),
                validated.movementTypeId(),
                validated.reasonCode(),
                validated.source(),
                validated.entryMode(),
                validated.note(),
                validated.sourceReference(),
                validated.contactName(),
                validated.contactPhone(),
                validated.contactAddress(),
                validated.extensionAttributes());
        store.replaceLines(
                tenantId,
                requiredId,
                validated.warehouseId(),
                validated.lines());
        store.replaceBoxes(
                tenantId,
                requiredId,
                validated.warehouseId(),
                validated.boxes());
        long nextVersion = Math.incrementExact(validated.expectedVersion());
        store.insertTimelineEvent(
                tenantId,
                requiredId,
                "UPDATED",
                ManualMovementStatus.DRAFT,
                ManualMovementStatus.DRAFT,
                nextVersion,
                validated.commandId(),
                actor);
        store.insertCommand(
                tenantId,
                validated.commandId(),
                requiredId,
                "UPDATE",
                fingerprint,
                ManualMovementStatus.DRAFT,
                nextVersion);
        audit(
                actor,
                ManualMovementAuditActions.UPDATED,
                requiredId,
                ManualMovementStatus.DRAFT,
                nextVersion,
                validated);
        return new Mutation(
                requiredId,
                ManualMovementStatus.DRAFT,
                nextVersion,
                false);
    }

    @Transactional
    public Mutation submit(
            ManualMovementActor actor,
            UUID movementId,
            Transition command) {
        UUID tenantId = requireWriteActor(actor);
        UUID requiredId = requireId(movementId);
        ValidatedTransition validated = validate(command);
        String fingerprint = fingerprint(
                "SUBMIT",
                requiredId,
                validated.expectedVersion(),
                validated.commandId());
        store.lockCommand(tenantId, validated.commandId());
        Mutation replay = replay(
                tenantId,
                validated.commandId(),
                "SUBMIT",
                fingerprint);
        if (replay != null) {
            return replay;
        }
        Summary current = lockedVisible(actor, tenantId, requiredId);
        requireVersion(current.version(), validated.expectedVersion());
        requireStatus(current.status(), ManualMovementStatus.DRAFT);
        ValidatedSave saved = validatedCurrent(
                current,
                store.lines(tenantId, requiredId),
                store.boxes(tenantId, requiredId),
                store.contactInformation(tenantId, requiredId));
        validateSubmission(tenantId, saved);
        lockActiveReferences(tenantId, saved);
        ManualMovementApprovalStatus approvalStatus =
                workflowStore.settings(
                                tenantId,
                                current.direction())
                        .approvalRequired()
                                ? ManualMovementApprovalStatus.PENDING
                                : ManualMovementApprovalStatus.NOT_REQUIRED;
        store.transition(
                tenantId,
                requiredId,
                validated.expectedVersion(),
                ManualMovementStatus.DRAFT,
                ManualMovementStatus.SUBMITTED);
        store.updateApproval(
                tenantId, requiredId, approvalStatus, actor, null);
        long nextVersion = Math.incrementExact(
                validated.expectedVersion());
        recordTransition(
                actor,
                current,
                "SUBMITTED",
                ManualMovementStatus.DRAFT,
                ManualMovementStatus.SUBMITTED,
                "SUBMIT",
                fingerprint,
                nextVersion,
                validated.commandId());
        audit(
                actor,
                ManualMovementAuditActions.SUBMITTED,
                current,
                ManualMovementStatus.SUBMITTED,
                nextVersion);
        return new Mutation(
                requiredId,
                ManualMovementStatus.SUBMITTED,
                nextVersion,
                false);
    }

    @Transactional
    public Mutation review(
            ManualMovementActor actor,
            UUID movementId,
            Review command) {
        UUID tenantId = requireWriteActor(actor);
        UUID requiredId = requireId(movementId);
        if (command == null) {
            throw new IllegalArgumentException(
                    "Review command is required");
        }
        long expectedVersion = requireVersionValue(
                command.expectedVersion());
        UUID reviewCommandId = requireId(command.commandId());
        String reviewNote = normalizeText(command.note(), 300);
        if (!command.approved() && reviewNote == null) {
            throw new IllegalArgumentException(
                    "A rejection reason is required");
        }
        String operation = command.approved() ? "APPROVE" : "REJECT";
        String fingerprint = sha256(List.of(
                operation,
                requiredId.toString(),
                Long.toString(expectedVersion),
                reviewCommandId.toString(),
                value(reviewNote)));
        store.lockCommand(tenantId, reviewCommandId);
        Mutation replay = replay(
                tenantId,
                reviewCommandId,
                operation,
                fingerprint);
        if (replay != null) {
            return replay;
        }
        Summary current = lockedVisible(actor, tenantId, requiredId);
        requireVersion(current.version(), expectedVersion);
        requireStatus(current.status(), ManualMovementStatus.SUBMITTED);
        if (current.approvalStatus()
                != ManualMovementApprovalStatus.PENDING) {
            throw new ManualMovementConflictException(
                    "illegal_transition");
        }
        ManualMovementStatus nextStatus = command.approved()
                ? ManualMovementStatus.SUBMITTED
                : ManualMovementStatus.DRAFT;
        ManualMovementApprovalStatus approval = command.approved()
                ? ManualMovementApprovalStatus.APPROVED
                : ManualMovementApprovalStatus.REJECTED;
        store.transition(
                tenantId,
                requiredId,
                expectedVersion,
                ManualMovementStatus.SUBMITTED,
                nextStatus);
        store.updateApproval(
                tenantId,
                requiredId,
                approval,
                actor,
                reviewNote);
        long nextVersion = Math.incrementExact(expectedVersion);
        String auditAction = command.approved()
                ? ManualMovementAuditActions.APPROVED
                : ManualMovementAuditActions.REJECTED;
        recordTransition(
                actor,
                current,
                command.approved() ? "APPROVED" : "REJECTED",
                ManualMovementStatus.SUBMITTED,
                nextStatus,
                operation,
                fingerprint,
                nextVersion,
                reviewCommandId);
        audit(
                actor,
                auditAction,
                current,
                nextStatus,
                nextVersion);
        return new Mutation(
                requiredId, nextStatus, nextVersion, false);
    }

    @Transactional
    public Mutation cancel(
            ManualMovementActor actor,
            UUID movementId,
            Transition command) {
        UUID tenantId = requireWriteActor(actor);
        UUID requiredId = requireId(movementId);
        ValidatedTransition validated = validate(command);
        String fingerprint = fingerprint(
                "CANCEL",
                requiredId,
                validated.expectedVersion(),
                validated.commandId());
        store.lockCommand(tenantId, validated.commandId());
        Mutation replay = replay(
                tenantId,
                validated.commandId(),
                "CANCEL",
                fingerprint);
        if (replay != null) {
            return replay;
        }
        Summary current = lockedVisible(actor, tenantId, requiredId);
        requireVersion(current.version(), validated.expectedVersion());
        if (current.status() != ManualMovementStatus.DRAFT
                && current.status() != ManualMovementStatus.SUBMITTED) {
            throw new ManualMovementConflictException(
                    "illegal_transition");
        }
        store.transition(
                tenantId,
                requiredId,
                validated.expectedVersion(),
                current.status(),
                ManualMovementStatus.CANCELLED);
        long nextVersion = Math.incrementExact(
                validated.expectedVersion());
        recordTransition(
                actor,
                current,
                "CANCELLED",
                current.status(),
                ManualMovementStatus.CANCELLED,
                "CANCEL",
                fingerprint,
                nextVersion,
                validated.commandId());
        audit(
                actor,
                ManualMovementAuditActions.CANCELLED,
                current,
                ManualMovementStatus.CANCELLED,
                nextVersion);
        return new Mutation(
                requiredId,
                ManualMovementStatus.CANCELLED,
                nextVersion,
                false);
    }

    @Transactional
    public Mutation post(
            ManualMovementActor actor,
            UUID movementId,
            Transition command) {
        UUID tenantId = requireWriteActor(actor);
        UUID requiredId = requireId(movementId);
        ValidatedTransition validated = validate(command);
        String fingerprint = fingerprint(
                "POST",
                requiredId,
                validated.expectedVersion(),
                validated.commandId());
        store.lockCommand(tenantId, validated.commandId());
        Mutation replay = replay(
                tenantId,
                validated.commandId(),
                "POST",
                fingerprint);
        if (replay != null) {
            return replay;
        }
        Summary current = lockedVisible(actor, tenantId, requiredId);
        requireVersion(current.version(), validated.expectedVersion());
        requireStatus(
                current.status(), ManualMovementStatus.SUBMITTED);
        if (current.approvalStatus()
                        == ManualMovementApprovalStatus.PENDING
                || current.approvalStatus()
                        == ManualMovementApprovalStatus.REJECTED) {
            throw new ManualMovementConflictException(
                    "approval_required");
        }
        List<Line> lines = store.lines(tenantId, requiredId);
        if (lines.isEmpty()) {
            throw new IllegalArgumentException(
                    "Manual movement lines are required");
        }
        ValidatedSave saved = validatedCurrent(
                current,
                lines,
                store.boxes(tenantId, requiredId),
                store.contactInformation(tenantId, requiredId));
        lockActiveReferences(tenantId, saved);
        List<InventoryOperationalDelta> deltas = lines.stream()
                .map(line -> new InventoryOperationalDelta(
                        line.id(),
                        line.skuId(),
                        current.warehouseId(),
                        current.direction().signed(line.quantity())))
                .toList();
        inventoryService.postOperationalDeltas(
                inventoryActor(actor),
                InventoryEventType.DOCUMENT_POST,
                SOURCE_TYPE,
                requiredId,
                ledgerReason(current),
                deltas);
        try {
            workflowStore.applyBoxPost(
                    tenantId,
                    requiredId,
                    current.warehouseId(),
                    current.direction());
        } catch (IllegalStateException exception) {
            throw new ManualMovementConflictException(
                    "box_stock_insufficient");
        }
        store.markActualQuantities(tenantId, requiredId);
        workflowStore.updatePriceSnapshots(tenantId, requiredId);
        store.transition(
                tenantId,
                requiredId,
                validated.expectedVersion(),
                ManualMovementStatus.SUBMITTED,
                ManualMovementStatus.POSTED);
        long nextVersion = Math.incrementExact(validated.expectedVersion());
        store.insertTimelineEvent(
                tenantId,
                requiredId,
                "POSTED",
                ManualMovementStatus.SUBMITTED,
                ManualMovementStatus.POSTED,
                nextVersion,
                validated.commandId(),
                actor);
        store.insertCommand(
                tenantId,
                validated.commandId(),
                requiredId,
                "POST",
                fingerprint,
                ManualMovementStatus.POSTED,
                nextVersion);
        audit(
                actor,
                ManualMovementAuditActions.POSTED,
                current,
                ManualMovementStatus.POSTED,
                nextVersion);
        return new Mutation(
                requiredId,
                ManualMovementStatus.POSTED,
                nextVersion,
                false);
    }

    @Transactional
    public Mutation reverse(
            ManualMovementActor actor,
            UUID movementId,
            Transition command) {
        UUID tenantId = requireWriteActor(actor);
        UUID requiredId = requireId(movementId);
        ValidatedTransition validated = validate(command);
        String fingerprint = fingerprint(
                "REVERSE",
                requiredId,
                validated.expectedVersion(),
                validated.commandId());
        store.lockCommand(tenantId, validated.commandId());
        Mutation replay = replay(
                tenantId,
                validated.commandId(),
                "REVERSE",
                fingerprint);
        if (replay != null) {
            return replay;
        }
        Summary current = lockedVisible(actor, tenantId, requiredId);
        requireVersion(current.version(), validated.expectedVersion());
        requireStatus(current.status(), ManualMovementStatus.POSTED);
        inventoryService.reverseOperationalDeltas(
                inventoryActor(actor),
                SOURCE_TYPE,
                requiredId,
                "MANUAL_MOVEMENT_REVERSAL");
        try {
            workflowStore.applyBoxReverse(
                    tenantId, requiredId, current.direction());
        } catch (IllegalStateException exception) {
            throw new ManualMovementConflictException(
                    "reversal_not_allowed");
        }
        store.transition(
                tenantId,
                requiredId,
                validated.expectedVersion(),
                ManualMovementStatus.POSTED,
                ManualMovementStatus.REVERSED);
        long nextVersion = Math.incrementExact(validated.expectedVersion());
        store.insertTimelineEvent(
                tenantId,
                requiredId,
                "REVERSED",
                ManualMovementStatus.POSTED,
                ManualMovementStatus.REVERSED,
                nextVersion,
                validated.commandId(),
                actor);
        store.insertCommand(
                tenantId,
                validated.commandId(),
                requiredId,
                "REVERSE",
                fingerprint,
                ManualMovementStatus.REVERSED,
                nextVersion);
        audit(
                actor,
                ManualMovementAuditActions.REVERSED,
                current,
                ManualMovementStatus.REVERSED,
                nextVersion);
        return new Mutation(
                requiredId,
                ManualMovementStatus.REVERSED,
                nextVersion,
                false);
    }

    @Transactional
    public List<Mutation> batchReview(
            ManualMovementActor actor,
            Batch command,
            boolean approved) {
        return orderedBatch(command).stream()
                .map(item -> review(
                        actor,
                        item.movementId(),
                        new Review(
                                item.expectedVersion(),
                                derivedCommandId(
                                        command.commandId(),
                                        item.movementId(),
                                approved
                                                ? "APPROVE"
                                                : "REJECT"),
                                approved,
                                command.note())))
                .toList();
    }

    @Transactional
    public List<Mutation> batchPost(
            ManualMovementActor actor, Batch command) {
        return orderedBatch(command).stream()
                .map(item -> post(
                        actor,
                        item.movementId(),
                        new Transition(
                                item.expectedVersion(),
                                derivedCommandId(
                                        command.commandId(),
                                        item.movementId(),
                                        "POST"))))
                .toList();
    }

    @Transactional
    public List<Mutation> batchCancel(
            ManualMovementActor actor, Batch command) {
        return orderedBatch(command).stream()
                .map(item -> cancel(
                        actor,
                        item.movementId(),
                        new Transition(
                                item.expectedVersion(),
                                derivedCommandId(
                                        command.commandId(),
                                        item.movementId(),
                                        "CANCEL"))))
                .toList();
    }

    private void recordTransition(
            ManualMovementActor actor,
            Summary current,
            String eventType,
            ManualMovementStatus from,
            ManualMovementStatus to,
            String operation,
            String fingerprint,
            long nextVersion,
            UUID commandId) {
        store.insertTimelineEvent(
                actor.tenantId(),
                current.id(),
                eventType,
                from,
                to,
                nextVersion,
                commandId,
                actor);
        store.insertCommand(
                actor.tenantId(),
                commandId,
                current.id(),
                operation,
                fingerprint,
                to,
                nextVersion);
    }

    private static List<BatchItem> orderedBatch(Batch command) {
        if (command == null
                || command.items() == null
                || command.items().isEmpty()
                || command.items().size() > 100) {
            throw new IllegalArgumentException(
                    "Batch items are required");
        }
        requireId(command.commandId());
        Set<UUID> ids = new HashSet<>();
        List<BatchItem> items = command.items().stream()
                .peek(item -> {
                    if (item == null
                            || !ids.add(requireId(item.movementId()))
                            || item.expectedVersion() < 0) {
                        throw new IllegalArgumentException(
                                "Invalid batch item");
                    }
                })
                .sorted(Comparator.comparing(
                        item -> item.movementId().toString()))
                .toList();
        return List.copyOf(items);
    }

    private static UUID derivedCommandId(
            UUID batchCommandId,
            UUID movementId,
            String operation) {
        String value = batchCommandId
                + ":"
                + movementId
                + ":"
                + operation;
        return UUID.nameUUIDFromBytes(
                value.getBytes(StandardCharsets.UTF_8));
    }

    private Mutation replay(
            UUID tenantId,
            UUID commandId,
            String operation,
            String fingerprint) {
        CommandRecord record =
                store.findCommand(tenantId, commandId).orElse(null);
        if (record == null) {
            return null;
        }
        if (!record.operation().equals(operation)
                || !record.fingerprint().equals(fingerprint)) {
            throw new ManualMovementConflictException(
                    "idempotency_conflict");
        }
        return new Mutation(
                record.movementId(),
                record.resultStatus(),
                record.resultVersion(),
                true);
    }

    private Settings replaySettings(
            UUID tenantId,
            UUID commandId,
            String operation,
            String fingerprint) {
        var record = workflowStore.configurationCommand(
                        tenantId, commandId)
                .orElse(null);
        if (record == null) {
            return null;
        }
        requireConfigurationReplay(record, operation, fingerprint);
        Map<String, Object> payload = record.responsePayload();
        return new Settings(
                ManualMovementDirection.valueOf(
                        payloadString(payload, "direction")),
                payloadBoolean(payload, "approvalRequired"),
                payloadBoolean(payload, "unitPriceRequired"),
                payloadBoolean(payload, "showCostPrice"),
                payloadString(payload, "costUpdatePolicy"),
                payloadBoolean(payload, "contactRequired"),
                payloadLong(payload, "version"));
    }

    private MovementType replayType(
            UUID tenantId,
            UUID commandId,
            String operation,
            String fingerprint) {
        var record = workflowStore.configurationCommand(
                        tenantId, commandId)
                .orElse(null);
        if (record == null) {
            return null;
        }
        requireConfigurationReplay(record, operation, fingerprint);
        Map<String, Object> payload = record.responsePayload();
        return new MovementType(
                UUID.fromString(payloadString(payload, "id")),
                ManualMovementDirection.valueOf(
                        payloadString(payload, "direction")),
                payloadString(payload, "code"),
                payloadString(payload, "name"),
                payloadString(payload, "status"),
                payloadLong(payload, "version"));
    }

    private static void requireConfigurationReplay(
            ConfigurationCommand record,
            String operation,
            String fingerprint) {
        if (!record.operation().equals(operation)
                || !record.fingerprint().equals(fingerprint)) {
            throw new ManualMovementConflictException(
                    "idempotency_conflict");
        }
    }

    private static Map<String, Object> settingsPayload(Settings value) {
        return Map.of(
                "direction", value.direction().name(),
                "approvalRequired", value.approvalRequired(),
                "unitPriceRequired", value.unitPriceRequired(),
                "showCostPrice", value.showCostPrice(),
                "costUpdatePolicy", value.costUpdatePolicy(),
                "contactRequired", value.contactInformationRequired(),
                "version", value.version());
    }

    private static Map<String, Object> typePayload(MovementType value) {
        return Map.of(
                "id", value.id().toString(),
                "direction", value.direction().name(),
                "code", value.code(),
                "name", value.name(),
                "status", value.status(),
                "version", value.version());
    }

    private static String payloadString(
            Map<String, Object> payload, String field) {
        Object value = payload.get(field);
        if (!(value instanceof String text) || text.isBlank()) {
            throw new IllegalStateException(
                    "Invalid configuration command payload");
        }
        return text;
    }

    private static boolean payloadBoolean(
            Map<String, Object> payload, String field) {
        Object value = payload.get(field);
        if (!(value instanceof Boolean result)) {
            throw new IllegalStateException(
                    "Invalid configuration command payload");
        }
        return result;
    }

    private static long payloadLong(
            Map<String, Object> payload, String field) {
        Object value = payload.get(field);
        if (!(value instanceof Number number)
                || number.longValue() < 0) {
            throw new IllegalStateException(
                    "Invalid configuration command payload");
        }
        return number.longValue();
    }

    private Summary lockedVisible(
            ManualMovementActor actor,
            UUID tenantId,
            UUID movementId) {
        Summary current = store.find(tenantId, movementId, true)
                .orElseThrow(ManualMovementService::notFound);
        scopeEvaluator.requireVisible(scope(actor), current.warehouseId());
        return current;
    }

    private void lockActiveReferences(
            UUID tenantId, ValidatedSave command) {
        requireActive(
                store.lockWarehouseStatus(
                        tenantId, command.warehouseId()),
                "warehouse");
        if (command.movementTypeId() != null) {
            MovementType type = workflowStore.type(
                            tenantId, command.movementTypeId())
                    .orElseThrow(ManualMovementService::notFound);
            if (type.direction() != command.direction()
                    || !"ACTIVE".equals(type.status())) {
                throw new ManualMovementConflictException(
                        "inactive_master_data");
            }
        }
        List<LineInput> ordered = command.lines().stream()
                .sorted(Comparator
                        .comparing((LineInput line) ->
                                line.skuId().toString())
                        .thenComparing(line ->
                                line.locationId().toString()))
                .toList();
        for (LineInput line : ordered) {
            requireActive(
                    store.lockSkuStatus(tenantId, line.skuId()),
                    "sku");
            requireActive(
                    store.lockLocationStatus(
                            tenantId,
                            command.warehouseId(),
                            line.locationId()),
                    "location");
        }
    }

    private static void requireActive(
            java.util.Optional<String> status, String resource) {
        String current = status.orElseThrow(
                ManualMovementService::notFound);
        if (!"ACTIVE".equals(current)) {
            throw new ManualMovementConflictException(
                    "inactive_master_data");
        }
    }

    private static ValidatedSave validate(Save command) {
        if (command == null) {
            throw new IllegalArgumentException(
                    "Manual movement command is required");
        }
        UUID warehouseId = requireId(command.warehouseId());
        ManualMovementDirection direction = command.direction();
        if (direction == null) {
            throw new IllegalArgumentException(
                    "Direction is required");
        }
        ManualMovementReasonCode reasonCode = command.reasonCode();
        if (reasonCode == null) {
            throw new IllegalArgumentException(
                    "Reason is required");
        }
        if (!reasonCode.supports(direction)) {
            throw new IllegalArgumentException(
                    "Reason does not support the direction");
        }
        List<LineInput> lines = validateLines(command.lines());
        ManualMovementSource source = command.source();
        if (source == null) {
            throw new IllegalArgumentException("Source is required");
        }
        ManualMovementEntryMode entryMode = command.entryMode();
        if (entryMode == null) {
            throw new IllegalArgumentException(
                    "Entry mode is required");
        }
        List<BoxInput> boxes = validateBoxes(
                direction,
                entryMode,
                command.boxes(),
                lines);
        return new ValidatedSave(
                warehouseId,
                direction,
                command.movementTypeId(),
                reasonCode,
                source,
                entryMode,
                normalizeText(command.note(), 500),
                normalizeText(command.sourceReference(), 100),
                normalizeText(command.contactName(), 80),
                normalizeText(command.contactPhone(), 40),
                normalizeText(command.contactAddress(), 300),
                normalizeAttributes(
                        command.extensionAttributes(), 20, 100, 300),
                lines,
                boxes,
                requireVersionValue(command.expectedVersion()),
                requireId(command.commandId()));
    }

    private static ValidatedSave validatedCurrent(
            Summary current,
            List<Line> lines,
            List<ManualMovementViews.Box> boxes,
            ContactInformation contactInformation) {
        return new ValidatedSave(
                current.warehouseId(),
                current.direction(),
                current.movementTypeId(),
                current.reasonCode(),
                current.source(),
                current.entryMode(),
                current.note(),
                current.sourceReference(),
                contactInformation.name(),
                contactInformation.phone(),
                contactInformation.address(),
                current.extensionAttributes(),
                lines.stream()
                        .map(line -> new LineInput(
                                line.skuId(),
                                line.locationId(),
                                line.quantity(),
                                line.unitPrice(),
                                line.currency(),
                                line.extensionAttributes(),
                                line.note()))
                        .toList(),
                boxes.stream()
                        .map(box -> new BoxInput(
                                box.sourceBoxStockId(),
                                box.customBoxNo(),
                                box.boxCount(),
                                box.boxNumberRule(),
                                box.lengthCm(),
                                box.widthCm(),
                                box.heightCm(),
                                box.grossWeightKg(),
                                box.items().stream()
                                        .map(item ->
                                                new ManualMovementCommands
                                                        .BoxItemInput(
                                                        item.skuId(),
                                                        item.quantityPerBox()))
                                        .toList()))
                        .toList(),
                current.version(),
                UUID.randomUUID());
    }

    private static List<LineInput> validateLines(List<LineInput> lines) {
        if (lines == null || lines.isEmpty() || lines.size() > MAX_LINES) {
            throw new IllegalArgumentException(
                    "Manual movement lines are required");
        }
        Set<UUID> skuIds = new HashSet<>();
        List<LineInput> normalized = new ArrayList<>(lines.size());
        for (LineInput line : lines) {
            if (line == null) {
                throw new IllegalArgumentException(
                        "Manual movement line is required");
            }
            UUID skuId = requireId(line.skuId());
            if (!skuIds.add(skuId)) {
                throw new IllegalArgumentException(
                        "Each SKU can appear only once");
            }
            if (line.quantity() <= 0) {
                throw new IllegalArgumentException(
                        "Line quantity must be positive");
            }
            normalized.add(new LineInput(
                    skuId,
                    requireId(line.locationId()),
                    line.quantity(),
                    normalizePrice(line.unitPrice()),
                    normalizeCurrency(
                            line.unitPrice(), line.currency()),
                    normalizeAttributes(
                            line.extensionAttributes(), 20, 100, 300),
                    normalizeText(line.note(), 300)));
        }
        return List.copyOf(normalized);
    }

    private static List<BoxInput> validateBoxes(
            ManualMovementDirection direction,
            ManualMovementEntryMode entryMode,
            List<BoxInput> boxes,
            List<LineInput> lines) {
        List<BoxInput> values = boxes == null ? List.of() : boxes;
        if (entryMode == ManualMovementEntryMode.BOX
                && values.isEmpty()) {
            throw new IllegalArgumentException(
                    "Box mode requires at least one box");
        }
        if (entryMode == ManualMovementEntryMode.PRODUCT
                && !values.isEmpty()) {
            throw new IllegalArgumentException(
                    "Product mode cannot contain boxes");
        }
        if (values.size() > 200) {
            throw new IllegalArgumentException(
                    "Too many movement boxes");
        }
        Map<UUID, Long> requiredQuantities = new LinkedHashMap<>();
        List<BoxInput> normalized = new ArrayList<>();
        Set<String> boxNumbers = new HashSet<>();
        for (BoxInput box : values) {
            if (box == null
                    || box.boxCount() <= 0
                    || box.items() == null
                    || box.items().isEmpty()
                    || box.items().size() > 100) {
                throw new IllegalArgumentException(
                        "Invalid movement box");
            }
            String customBoxNo = normalizeRequired(
                    box.customBoxNo(), 80);
            if (!boxNumbers.add(customBoxNo.toLowerCase(Locale.ROOT))) {
                throw new IllegalArgumentException(
                        "Box numbers must be unique");
            }
            if (!Set.of("SHARED_NUMBER", "UNIQUE_NUMBER")
                    .contains(box.boxNumberRule())) {
                throw new IllegalArgumentException(
                        "Invalid box number rule");
            }
            if (direction == ManualMovementDirection.OUTBOUND
                    && box.sourceBoxStockId() == null) {
                throw new IllegalArgumentException(
                        "Outbound boxes must select box stock");
            }
            Set<UUID> itemIds = new HashSet<>();
            List<ManualMovementCommands.BoxItemInput> items =
                    new ArrayList<>();
            for (ManualMovementCommands.BoxItemInput item
                    : box.items()) {
                UUID skuId = requireId(item.skuId());
                if (!itemIds.add(skuId)
                        || item.quantityPerBox() <= 0) {
                    throw new IllegalArgumentException(
                            "Invalid box SKU composition");
                }
                long total;
                try {
                    total = Math.multiplyExact(
                            box.boxCount(), item.quantityPerBox());
                    requiredQuantities.merge(
                            skuId, total, Math::addExact);
                } catch (ArithmeticException exception) {
                    throw new IllegalArgumentException(
                            "Box quantity is outside the supported range");
                }
                items.add(new ManualMovementCommands.BoxItemInput(
                        skuId, item.quantityPerBox()));
            }
            normalized.add(new BoxInput(
                    box.sourceBoxStockId(),
                    customBoxNo,
                    box.boxCount(),
                    box.boxNumberRule(),
                    positiveDecimal(box.lengthCm(), "box length"),
                    positiveDecimal(box.widthCm(), "box width"),
                    positiveDecimal(box.heightCm(), "box height"),
                    positiveDecimal(
                            box.grossWeightKg(), "box weight"),
                    List.copyOf(items)));
        }
        Map<UUID, Long> lineQuantities = new LinkedHashMap<>();
        for (LineInput line : lines) {
            lineQuantities.put(line.skuId(), line.quantity());
        }
        for (Map.Entry<UUID, Long> required
                : requiredQuantities.entrySet()) {
            if (lineQuantities.getOrDefault(required.getKey(), 0L)
                    < required.getValue()) {
                throw new IllegalArgumentException(
                        "Box contents exceed movement line quantity");
            }
        }
        return List.copyOf(normalized);
    }

    private void validateSubmission(
            UUID tenantId, ValidatedSave command) {
        Settings settings = workflowStore.settings(
                tenantId, command.direction());
        if (settings.unitPriceRequired()
                && command.lines().stream()
                        .anyMatch(line -> line.unitPrice() == null)) {
            throw new IllegalArgumentException(
                    "Unit price is required by movement settings");
        }
        if (settings.contactInformationRequired()
                && (command.contactName() == null
                        || command.contactPhone() == null
                        || command.contactAddress() == null)) {
            throw new IllegalArgumentException(
                    "Contact information is required by movement settings");
        }
        if (command.movementTypeId() != null) {
            MovementType type = workflowStore.type(
                            tenantId, command.movementTypeId())
                    .orElseThrow(ManualMovementService::notFound);
            if (type.direction() != command.direction()
                    || !"ACTIVE".equals(type.status())) {
                throw new ManualMovementConflictException(
                        "inactive_master_data");
            }
        }
    }

    private static ValidatedTransition validate(Transition command) {
        if (command == null) {
            throw new IllegalArgumentException(
                    "Manual movement transition is required");
        }
        return new ValidatedTransition(
                requireVersionValue(command.expectedVersion()),
                requireId(command.commandId()));
    }

    private void audit(
            ManualMovementActor actor,
            String action,
            UUID movementId,
            ManualMovementStatus status,
            long version,
            ValidatedSave command) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(),
                actor.userId(),
                actor.systemAdminId(),
                action,
                "inventory_manual_movement",
                movementId.toString(),
                actor.requestId(),
                actor.sourceIp(),
                Map.of(
                        "direction", command.direction().name(),
                        "warehouseId", command.warehouseId().toString(),
                        "status", status.name(),
                        "version", Long.toString(version),
                        "lineCount",
                                Integer.toString(command.lines().size()),
                        "totalQuantity",
                                Long.toString(total(command.lines())))));
    }

    private void audit(
            ManualMovementActor actor,
            String action,
            Summary current,
            ManualMovementStatus status,
            long version) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(),
                actor.userId(),
                actor.systemAdminId(),
                action,
                "inventory_manual_movement",
                current.id().toString(),
                actor.requestId(),
                actor.sourceIp(),
                Map.of(
                        "direction", current.direction().name(),
                        "warehouseId", current.warehouseId().toString(),
                        "status", status.name(),
                        "version", Long.toString(version),
                        "lineCount",
                                Integer.toString(current.lineCount()),
                        "totalQuantity",
                                Long.toString(current.totalQuantity()))));
    }

    private void audit(
            ManualMovementActor actor,
            String action,
            String resourceId,
            Map<String, String> details) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(),
                actor.userId(),
                actor.systemAdminId(),
                action,
                "inventory_manual_movement_configuration",
                resourceId,
                actor.requestId(),
                actor.sourceIp(),
                Map.copyOf(details)));
    }

    private WarehouseScopeAccess scope(ManualMovementActor actor) {
        return scopeEvaluator.evaluate(
                actor.tenantId(),
                actor.userId(),
                actor.systemAdminId());
    }

    private static InventoryActor inventoryActor(
            ManualMovementActor actor) {
        return new InventoryActor(
                actor.tenantId(),
                actor.userId(),
                actor.systemAdminId(),
                actor.requestId(),
                actor.sourceIp());
    }

    private static UUID requireActor(ManualMovementActor actor) {
        if (actor == null || actor.tenantId() == null) {
            throw new IllegalArgumentException(
                    "A tenant actor is required");
        }
        if ((actor.userId() == null)
                == (actor.systemAdminId() == null)) {
            throw new IllegalArgumentException(
                    "Exactly one actor identity is required");
        }
        return actor.tenantId();
    }

    private static UUID requireWriteActor(ManualMovementActor actor) {
        UUID tenantId = requireActor(actor);
        if (actor.requestId() == null
                || !REQUEST_ID.matcher(actor.requestId()).matches()) {
            throw new IllegalArgumentException(
                    "A safe request ID is required");
        }
        return tenantId;
    }

    private static UUID requireId(UUID value) {
        if (value == null) {
            throw new IllegalArgumentException("An ID is required");
        }
        return value;
    }

    private static long requireVersionValue(long value) {
        if (value < 0) {
            throw new IllegalArgumentException(
                    "Version must be non-negative");
        }
        return value;
    }

    private static void requireVersion(
            long actual, long expected) {
        if (actual != expected) {
            throw new ManualMovementConflictException("stale_version");
        }
    }

    private static void requireStatus(
            ManualMovementStatus actual,
            ManualMovementStatus expected) {
        if (actual != expected) {
            throw new ManualMovementConflictException(
                    "illegal_transition");
        }
    }

    private static void requireDateRange(
            Instant from, Instant to) {
        if (from != null && to != null && from.isAfter(to)) {
            throw new IllegalArgumentException(
                    "Invalid movement date range");
        }
    }

    private static String normalizeKeyword(String value) {
        String normalized = normalizeText(value, 100);
        return normalized == null
                ? null
                : normalized.toLowerCase(Locale.ROOT);
    }

    private static String normalizeText(
            String value, int maxLength) {
        String normalized = SensitiveTextRedactor.redactNullable(value);
        if (normalized != null && normalized.length() > maxLength) {
            throw new IllegalArgumentException("Text is too long");
        }
        return normalized;
    }

    private static String normalizeRequired(
            String value, int maxLength) {
        String normalized = normalizeText(value, maxLength);
        if (normalized == null) {
            throw new IllegalArgumentException("Text is required");
        }
        return normalized;
    }

    private static Map<String, String> normalizeAttributes(
            Map<String, String> values,
            int maxEntries,
            int maxKeyLength,
            int maxValueLength) {
        if (values == null || values.isEmpty()) {
            return Map.of();
        }
        if (values.size() > maxEntries) {
            throw new IllegalArgumentException(
                    "Too many extension attributes");
        }
        Map<String, String> normalized = new java.util.TreeMap<>();
        for (Map.Entry<String, String> entry : values.entrySet()) {
            String key = normalizeRequired(
                    entry.getKey(), maxKeyLength);
            String value = normalizeRequired(
                    entry.getValue(), maxValueLength);
            if (normalized.putIfAbsent(key, value) != null) {
                throw new IllegalArgumentException(
                        "Duplicate extension attribute");
            }
        }
        return Map.copyOf(normalized);
    }

    private static BigDecimal normalizePrice(BigDecimal value) {
        if (value == null) {
            return null;
        }
        if (value.signum() < 0 || value.scale() > 4) {
            throw new IllegalArgumentException("Invalid unit price");
        }
        return value.stripTrailingZeros();
    }

    private static String normalizeCurrency(
            BigDecimal price, String currency) {
        if (price == null && currency == null) {
            return null;
        }
        if (price == null || currency == null) {
            throw new IllegalArgumentException(
                    "Price and currency must be provided together");
        }
        String normalized = currency.strip().toUpperCase(Locale.ROOT);
        if (!normalized.matches("^[A-Z]{3}$")) {
            throw new IllegalArgumentException("Invalid currency");
        }
        return normalized;
    }

    private static BigDecimal positiveDecimal(
            BigDecimal value, String field) {
        if (value == null
                || value.signum() <= 0
                || value.scale() > 3) {
            throw new IllegalArgumentException(
                    "Invalid " + field);
        }
        return value.stripTrailingZeros();
    }

    private static String movementNumber(
            ManualMovementDirection direction, UUID id) {
        String prefix = direction == ManualMovementDirection.INBOUND
                ? "MI-"
                : "MO-";
        return prefix + id.toString()
                .replace("-", "")
                .substring(0, 16)
                .toUpperCase(Locale.ROOT);
    }

    private static String ledgerReason(Summary summary) {
        return "MANUAL_"
                + summary.direction().name()
                + "_"
                + summary.reasonCode().name();
    }

    private static long total(List<LineInput> lines) {
        long total = 0;
        for (LineInput line : lines) {
            try {
                total = Math.addExact(total, line.quantity());
            } catch (ArithmeticException exception) {
                throw new IllegalArgumentException(
                        "Total quantity is outside the supported range");
            }
        }
        return total;
    }

    private static String csv(List<Summary> movements) {
        StringBuilder output = new StringBuilder("\uFEFF");
        appendCsvRow(output, CSV_HEADER);
        for (Summary movement : movements) {
            appendCsvRow(output, List.of(
                    movement.movementNo(),
                    directionLabel(movement.direction()),
                    movement.warehouseBusinessCode(),
                    movement.warehouseName(),
                    nullable(movement.movementTypeName()).isEmpty()
                            ? reasonLabel(movement.reasonCode())
                            : movement.movementTypeName(),
                    sourceLabel(movement.source()),
                    wmsStatusLabel(movement.wmsStatus()),
                    approvalStatusLabel(movement.approvalStatus()),
                    Long.toString(movement.totalQuantity()),
                    Long.toString(movement.totalActualQuantity()),
                    decimal(movement.totalAmount()),
                    nullable(movement.currency()),
                    movement.createdBy(),
                    nullable(movement.reviewedBy()),
                    statusLabel(movement.status()),
                    movement.createdAt().toString()));
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
        if (!stripped.isEmpty() && "=+-@".indexOf(stripped.charAt(0)) >= 0) {
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

    private static String decimal(BigDecimal value) {
        return value == null ? "" : value.toPlainString();
    }

    private static String directionLabel(ManualMovementDirection value) {
        return value == ManualMovementDirection.INBOUND ? "手工入库" : "手工出库";
    }

    private static String statusLabel(ManualMovementStatus value) {
        return switch (value) {
            case DRAFT -> "草稿";
            case SUBMITTED -> "已提交";
            case POSTED -> "已过账";
            case REVERSED -> "已冲销";
            case CANCELLED -> "已作废";
        };
    }

    private static String reasonLabel(ManualMovementReasonCode value) {
        return switch (value) {
            case FOUND_STOCK -> "盘盈或发现库存";
            case DAMAGED_STOCK -> "库存损坏";
            case LOST_STOCK -> "库存丢失";
            case RECORDING_CORRECTION -> "账面记录纠正";
            case OTHER -> "其他";
        };
    }

    private static String sourceLabel(ManualMovementSource value) {
        return switch (value) {
            case MANUAL -> "手工新增";
            case TEMPLATE_IMPORT -> "模板导入";
            case OPEN_API -> "开放 API";
            case TMS -> "TMS";
            case WMS -> "WMS";
            case INVENTORY_SKU -> "库存 SKU";
        };
    }

    private static String wmsStatusLabel(ManualMovementWmsStatus value) {
        return switch (value) {
            case NOT_CONFIGURED -> "未配置";
            case NOT_REQUIRED -> "无需推送";
            case QUEUED -> "待推送";
            case SENT -> "已推送";
            case CANCELLED -> "已取消";
            case FAILED -> "推送失败";
        };
    }

    private static String approvalStatusLabel(
            ManualMovementApprovalStatus value) {
        return switch (value) {
            case NOT_REQUIRED -> "无需审核";
            case PENDING -> "待审核";
            case APPROVED -> "已完成（通过）";
            case REJECTED -> "未通过";
        };
    }

    private static String fingerprint(
            String operation,
            UUID movementId,
            ValidatedSave command) {
        List<String> parts = new ArrayList<>();
        parts.add(operation);
        parts.add(value(movementId));
        parts.add(command.warehouseId().toString());
        parts.add(command.direction().name());
        parts.add(value(command.movementTypeId()));
        parts.add(command.reasonCode().name());
        parts.add(command.source().name());
        parts.add(command.entryMode().name());
        parts.add(value(command.note()));
        parts.add(value(command.sourceReference()));
        parts.add(value(command.contactName()));
        parts.add(value(command.contactPhone()));
        parts.add(value(command.contactAddress()));
        command.extensionAttributes().entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .forEach(entry -> {
                    parts.add(entry.getKey());
                    parts.add(entry.getValue());
                });
        parts.add(Long.toString(command.expectedVersion()));
        for (LineInput line : command.lines()) {
            parts.add(line.skuId().toString());
            parts.add(line.locationId().toString());
            parts.add(Long.toString(line.quantity()));
            parts.add(value(line.unitPrice()));
            parts.add(value(line.currency()));
            line.extensionAttributes().entrySet().stream()
                    .sorted(Map.Entry.comparingByKey())
                    .forEach(entry -> {
                        parts.add(entry.getKey());
                        parts.add(entry.getValue());
                    });
            parts.add(value(line.note()));
        }
        for (BoxInput box : command.boxes()) {
            parts.add(value(box.sourceBoxStockId()));
            parts.add(box.customBoxNo());
            parts.add(Long.toString(box.boxCount()));
            parts.add(box.boxNumberRule());
            parts.add(box.lengthCm().toPlainString());
            parts.add(box.widthCm().toPlainString());
            parts.add(box.heightCm().toPlainString());
            parts.add(box.grossWeightKg().toPlainString());
            for (ManualMovementCommands.BoxItemInput item
                    : box.items()) {
                parts.add(item.skuId().toString());
                parts.add(Long.toString(item.quantityPerBox()));
            }
        }
        return sha256(parts);
    }

    private static String fingerprint(
            String operation,
            UUID movementId,
            long expectedVersion,
            UUID commandId) {
        return sha256(List.of(
                operation,
                movementId.toString(),
                Long.toString(expectedVersion),
                commandId.toString()));
    }

    private static String sha256(List<String> parts) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            for (String part : parts) {
                byte[] bytes = part.getBytes(StandardCharsets.UTF_8);
                digest.update(Integer.toString(bytes.length)
                        .getBytes(StandardCharsets.US_ASCII));
                digest.update((byte) ':');
                digest.update(bytes);
                digest.update((byte) '\n');
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException(
                    "SHA-256 is unavailable", exception);
        }
    }

    private static String value(Object value) {
        return value == null ? "" : value.toString();
    }

    private static ResourceNotFoundException notFound() {
        return new ResourceNotFoundException(
                "Manual movement was not found");
    }

    public record ManualMovementExport(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }

    private record ValidatedSave(
            UUID warehouseId,
            ManualMovementDirection direction,
            UUID movementTypeId,
            ManualMovementReasonCode reasonCode,
            ManualMovementSource source,
            ManualMovementEntryMode entryMode,
            String note,
            String sourceReference,
            String contactName,
            String contactPhone,
            String contactAddress,
            Map<String, String> extensionAttributes,
            List<LineInput> lines,
            List<BoxInput> boxes,
            long expectedVersion,
            UUID commandId) {
    }

    private record ValidatedTransition(
            long expectedVersion,
            UUID commandId) {
    }
}
