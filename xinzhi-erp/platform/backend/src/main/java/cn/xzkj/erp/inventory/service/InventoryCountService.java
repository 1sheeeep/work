package cn.xzkj.erp.inventory.service;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeAccess;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeEvaluator;
import cn.xzkj.erp.inventory.domain.InventoryCountStatus;
import cn.xzkj.erp.inventory.domain.InventoryEventType;
import cn.xzkj.erp.inventory.repository.InventoryCountRepository;
import cn.xzkj.erp.inventory.repository.InventoryCountRepository.CommandRecord;
import cn.xzkj.erp.platform.domain.SensitiveTextRedactor;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
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
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class InventoryCountService {
    static final int MAX_EXPORT_ROWS = 10_000;
    private static final String CSV_MEDIA_TYPE = "text/csv;charset=utf-8";
    private static final List<String> CSV_HEADER = List.of(
            "盘点批次", "仓库编码", "仓库名称", "状态", "盘点日期", "备注",
            "SKU个数", "总差值", "操作人", "审批人", "创建时间", "更新时间");
    private static final int MAX_LINES = 200;
    private static final long MAX_QUANTITY = 1_000_000_000L;
    private static final String RESOURCE_TYPE = "inventory_count";
    private static final String CREATED = "inventory.count.created";
    private static final String SUBMITTED = "inventory.count.submitted";
    private static final String APPROVED = "inventory.count.approved";
    private static final String REJECTED = "inventory.count.rejected";
    private static final String CANCELLED = "inventory.count.cancelled";

    private final InventoryCountRepository repository;
    private final InventoryService inventoryService;
    private final WarehouseScopeEvaluator scopeEvaluator;
    private final SecurityAuditRecorder auditRecorder;

    public InventoryCountService(
            InventoryCountRepository repository,
            InventoryService inventoryService,
            WarehouseScopeEvaluator scopeEvaluator,
            SecurityAuditRecorder auditRecorder) {
        this.repository = repository;
        this.inventoryService = inventoryService;
        this.scopeEvaluator = scopeEvaluator;
        this.auditRecorder = auditRecorder;
    }

    @Transactional(readOnly = true)
    public Page<InventoryCountSummary> list(
            InventoryCountActor actor,
            UUID warehouseId,
            InventoryCountStatus status,
            InventoryCountSearchField searchField,
            String keyword,
            LocalDate from,
            LocalDate to,
            Long differenceMin,
            Long differenceMax,
            Pageable pageable) {
        UUID tenantId = requireActor(actor);
        WarehouseScopeAccess scope = scope(actor);
        if (warehouseId != null) scopeEvaluator.requireVisible(scope, warehouseId);
        if (from != null && to != null && from.isAfter(to)) {
            throw new IllegalArgumentException("Invalid inventory count date range");
        }
        if (differenceMin != null && differenceMax != null
                && differenceMin > differenceMax) {
            throw new IllegalArgumentException("Invalid inventory count difference range");
        }
        if (!scope.allowsAll() && scope.warehouseIds().isEmpty()) {
            return Page.empty(pageable);
        }
        return repository.list(
                tenantId,
                scope.warehouseIds(),
                scope.allowsAll(),
                warehouseId,
                status,
                searchField == null ? InventoryCountSearchField.BATCH : searchField,
                normalizeKeyword(keyword),
                from,
                to,
                differenceMin,
                differenceMax,
                pageable);
    }

    @Transactional(readOnly = true)
    public InventoryCountExport exportCsv(
            InventoryCountActor actor,
            UUID warehouseId,
            InventoryCountStatus status,
            InventoryCountSearchField searchField,
            String keyword,
            LocalDate from,
            LocalDate to,
            Long differenceMin,
            Long differenceMax) {
        Page<InventoryCountSummary> page = list(
                actor, warehouseId, status, searchField, keyword, from, to,
                differenceMin, differenceMax,
                PageRequest.of(0, MAX_EXPORT_ROWS + 1));
        if (page.getTotalElements() > MAX_EXPORT_ROWS
                || page.getNumberOfElements() > MAX_EXPORT_ROWS) {
            throw new ConflictException(
                    "Inventory count export exceeds the supported row limit");
        }
        return new InventoryCountExport(
                "inventory-counts.csv", CSV_MEDIA_TYPE,
                page.getNumberOfElements(), csv(page.getContent()));
    }

    @Transactional(readOnly = true)
    public InventoryCountDetail get(InventoryCountActor actor, UUID countId) {
        UUID tenantId = requireActor(actor);
        InventoryCountDetail detail = repository.find(tenantId, requireId(countId))
                .orElseThrow(InventoryCountService::notFound);
        scopeEvaluator.requireVisible(scope(actor), detail.summary().warehouseId());
        return detail;
    }

    @Transactional
    public InventoryCountDetail create(
            InventoryCountActor actor,
            UUID commandId,
            UUID warehouseId,
            LocalDate countDate,
            String note,
            boolean submit,
            List<LineInput> inputs) {
        UUID tenantId = requireWriteActor(actor);
        UUID requiredCommandId = requireId(commandId);
        UUID requiredWarehouseId = requireId(warehouseId);
        scopeEvaluator.requireVisible(scope(actor), requiredWarehouseId);
        if (countDate == null) {
            throw new IllegalArgumentException("Inventory count date is required");
        }
        String normalizedNote = normalizeNote(note);
        List<SnapshotLine> lines = snapshotLines(actor, requiredWarehouseId, inputs);
        String operation = "CREATE";
        String fingerprint = fingerprint(
                operation,
                requiredWarehouseId.toString(),
                countDate.toString(),
                normalizedNote,
                Boolean.toString(submit),
                lines.stream()
                        .map(line -> line.balance().id() + ":" + line.countedOnHand())
                        .sorted()
                        .toList()
                        .toString());
        repository.lockCommand(tenantId, requiredCommandId);
        InventoryCountDetail replay = replay(
                tenantId, requiredCommandId, operation, fingerprint);
        if (replay != null) return replay;

        UUID countId = UUID.randomUUID();
        String countNo = "IC-" + countDate.format(DateTimeFormatter.BASIC_ISO_DATE)
                + "-" + countId.toString().substring(0, 8).toUpperCase(Locale.ROOT);
        repository.insertBatch(
                countId,
                tenantId,
                countNo,
                requiredWarehouseId,
                countDate,
                normalizedNote,
                normalizeDisplayName(actor.displayName()),
                actor.userId(),
                actor.systemAdminId());
        for (SnapshotLine line : lines) {
            InventoryBalanceView balance = line.balance();
            repository.insertLine(
                    UUID.randomUUID(),
                    tenantId,
                    countId,
                    balance.id(),
                    balance.skuId(),
                    balance.warehouseId(),
                    balance.version(),
                    balance.onHand(),
                    balance.reserved(),
                    line.countedOnHand());
        }
        InventoryCountSummary summary = repository.find(tenantId, countId)
                .orElseThrow()
                .summary();
        if (submit) {
            summary = transition(
                    actor,
                    summary,
                    InventoryCountStatus.PENDING,
                    InventoryCountStatus.APPROVAL);
        }
        repository.insertCommand(
                tenantId,
                requiredCommandId,
                countId,
                operation,
                fingerprint,
                summary.status(),
                summary.version());
        audit(actor, CREATED, summary);
        return repository.find(tenantId, countId).orElseThrow();
    }

    @Transactional
    public InventoryCountDetail submit(
            InventoryCountActor actor,
            UUID countId,
            UUID commandId,
            long expectedVersion) {
        ActionResult result = action(
                actor,
                countId,
                commandId,
                expectedVersion,
                "SUBMIT",
                InventoryCountStatus.PENDING,
                InventoryCountStatus.APPROVAL);
        if (!result.replayed()) audit(actor, SUBMITTED, result.detail().summary());
        return result.detail();
    }

    @Transactional
    public InventoryCountDetail approve(
            InventoryCountActor actor,
            UUID countId,
            UUID commandId,
            long expectedVersion) {
        UUID tenantId = requireWriteActor(actor);
        String operation = "APPROVE";
        String fingerprint = fingerprint(
                operation, requireId(countId).toString(), Long.toString(expectedVersion));
        repository.lockCommand(tenantId, requireId(commandId));
        InventoryCountDetail replay = replay(
                tenantId, commandId, operation, fingerprint);
        if (replay != null) return replay;
        InventoryCountSummary current = lockedVisible(actor, countId);
        requireState(current, InventoryCountStatus.APPROVAL, expectedVersion);
        List<InventoryCountLineView> lines = repository.listLines(tenantId, countId);
        for (InventoryCountLineView line : lines) {
            if (line.difference() == 0) continue;
            InventoryMutationResult mutation = inventoryService.adjust(
                    inventoryActor(actor),
                    InventoryEventType.CORRECTION,
                    line.skuId(),
                    current.warehouseId(),
                    line.difference(),
                    line.expectedBalanceVersion(),
                    "INVENTORY_COUNT",
                    "Inventory count " + current.countNo(),
                    "count." + countId + "." + line.id());
            repository.setResultEvent(tenantId, line.id(), mutation.event().id());
        }
        InventoryCountSummary completed = transition(
                actor,
                current,
                InventoryCountStatus.APPROVAL,
                InventoryCountStatus.COMPLETED);
        repository.insertCommand(
                tenantId,
                commandId,
                countId,
                operation,
                fingerprint,
                completed.status(),
                completed.version());
        audit(actor, APPROVED, completed);
        return repository.find(tenantId, countId).orElseThrow();
    }

    @Transactional
    public InventoryCountDetail reject(
            InventoryCountActor actor,
            UUID countId,
            UUID commandId,
            long expectedVersion) {
        ActionResult result = action(
                actor,
                countId,
                commandId,
                expectedVersion,
                "REJECT",
                InventoryCountStatus.APPROVAL,
                InventoryCountStatus.REJECTED);
        if (!result.replayed()) audit(actor, REJECTED, result.detail().summary());
        return result.detail();
    }

    @Transactional
    public InventoryCountDetail cancel(
            InventoryCountActor actor,
            UUID countId,
            UUID commandId,
            long expectedVersion) {
        UUID tenantId = requireWriteActor(actor);
        String operation = "CANCEL";
        String fingerprint = fingerprint(
                operation, requireId(countId).toString(), Long.toString(expectedVersion));
        repository.lockCommand(tenantId, requireId(commandId));
        InventoryCountDetail replay = replay(
                tenantId, commandId, operation, fingerprint);
        if (replay != null) return replay;
        InventoryCountSummary current = lockedVisible(actor, countId);
        if (current.version() != expectedVersion
                || (current.status() != InventoryCountStatus.PENDING
                && current.status() != InventoryCountStatus.APPROVAL)) {
            throw new InventoryConflictException("invalid_count_state");
        }
        InventoryCountSummary cancelled = transition(
                actor, current, current.status(), InventoryCountStatus.CANCELLED);
        repository.insertCommand(
                tenantId,
                commandId,
                countId,
                operation,
                fingerprint,
                cancelled.status(),
                cancelled.version());
        audit(actor, CANCELLED, cancelled);
        return repository.find(tenantId, countId).orElseThrow();
    }

    private ActionResult action(
            InventoryCountActor actor,
            UUID countId,
            UUID commandId,
            long expectedVersion,
            String operation,
            InventoryCountStatus expectedStatus,
            InventoryCountStatus nextStatus) {
        UUID tenantId = requireWriteActor(actor);
        String fingerprint = fingerprint(
                operation, requireId(countId).toString(), Long.toString(expectedVersion));
        repository.lockCommand(tenantId, requireId(commandId));
        InventoryCountDetail replay = replay(
                tenantId, commandId, operation, fingerprint);
        if (replay != null) return new ActionResult(replay, true);
        InventoryCountSummary current = lockedVisible(actor, countId);
        requireState(current, expectedStatus, expectedVersion);
        InventoryCountSummary changed = transition(
                actor, current, expectedStatus, nextStatus);
        repository.insertCommand(
                tenantId,
                commandId,
                countId,
                operation,
                fingerprint,
                changed.status(),
                changed.version());
        return new ActionResult(
                repository.find(tenantId, countId).orElseThrow(), false);
    }

    private InventoryCountSummary transition(
            InventoryCountActor actor,
            InventoryCountSummary current,
            InventoryCountStatus expectedStatus,
            InventoryCountStatus nextStatus) {
        boolean reviewed = nextStatus == InventoryCountStatus.COMPLETED
                || nextStatus == InventoryCountStatus.REJECTED;
        int updated = repository.transition(
                actor.tenantId(),
                current.id(),
                current.version(),
                expectedStatus,
                nextStatus,
                reviewed ? normalizeDisplayName(actor.displayName()) : null,
                reviewed ? actor.userId() : null,
                reviewed ? actor.systemAdminId() : null);
        if (updated != 1) {
            throw new InventoryConflictException("invalid_count_state");
        }
        return repository.find(actor.tenantId(), current.id()).orElseThrow().summary();
    }

    private InventoryCountSummary lockedVisible(InventoryCountActor actor, UUID countId) {
        InventoryCountSummary current = repository.lock(
                        actor.tenantId(), requireId(countId))
                .orElseThrow(InventoryCountService::notFound);
        scopeEvaluator.requireVisible(scope(actor), current.warehouseId());
        return current;
    }

    private List<SnapshotLine> snapshotLines(
            InventoryCountActor actor,
            UUID warehouseId,
            List<LineInput> inputs) {
        if (inputs == null || inputs.isEmpty() || inputs.size() > MAX_LINES) {
            throw new IllegalArgumentException("Between 1 and 200 inventory count lines are required");
        }
        Set<UUID> balanceIds = new HashSet<>();
        List<SnapshotLine> lines = new ArrayList<>(inputs.size());
        for (LineInput input : inputs) {
            if (input == null || !balanceIds.add(requireId(input.balanceId()))) {
                throw new IllegalArgumentException("Inventory count balances must be unique");
            }
            if (input.countedOnHand() < -MAX_QUANTITY
                    || input.countedOnHand() > MAX_QUANTITY) {
                throw new IllegalArgumentException("Inventory count quantity is outside the supported range");
            }
            InventoryBalanceView balance = inventoryService.getBalance(
                    inventoryActor(actor), input.balanceId());
            if (!balance.warehouseId().equals(warehouseId)) {
                throw new IllegalArgumentException("Inventory count balance belongs to another warehouse");
            }
            try {
                Math.subtractExact(input.countedOnHand(), balance.onHand());
            } catch (ArithmeticException exception) {
                throw new IllegalArgumentException("Inventory count difference is outside the supported range");
            }
            lines.add(new SnapshotLine(balance, input.countedOnHand()));
        }
        return lines.stream()
                .sorted(Comparator.comparing(value -> value.balance().id().toString()))
                .toList();
    }

    private InventoryCountDetail replay(
            UUID tenantId,
            UUID commandId,
            String operation,
            String fingerprint) {
        CommandRecord command = repository.findCommand(tenantId, commandId).orElse(null);
        if (command == null) return null;
        if (!command.operation().equals(operation)
                || !command.fingerprint().equals(fingerprint)) {
            throw new InventoryConflictException("idempotency_conflict");
        }
        return repository.find(tenantId, command.countId())
                .orElseThrow(InventoryCountService::notFound);
    }

    private void audit(
            InventoryCountActor actor,
            String action,
            InventoryCountSummary summary) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(),
                actor.userId(),
                actor.systemAdminId(),
                action,
                RESOURCE_TYPE,
                summary.id().toString(),
                actor.requestId(),
                actor.sourceIp(),
                Map.of(
                        "warehouseId", summary.warehouseId().toString(),
                        "status", summary.status().name(),
                        "version", Long.toString(summary.version()),
                        "lineCount", Integer.toString(summary.lineCount()),
                        "totalDifference", Long.toString(summary.totalDifference()))));
    }

    private WarehouseScopeAccess scope(InventoryCountActor actor) {
        return scopeEvaluator.evaluate(
                actor.tenantId(), actor.userId(), actor.systemAdminId());
    }

    private static InventoryActor inventoryActor(InventoryCountActor actor) {
        return new InventoryActor(
                actor.tenantId(),
                actor.userId(),
                actor.systemAdminId(),
                actor.requestId(),
                actor.sourceIp());
    }

    private static void requireState(
            InventoryCountSummary current,
            InventoryCountStatus status,
            long version) {
        if (version < 0 || current.version() != version || current.status() != status) {
            throw new InventoryConflictException("invalid_count_state");
        }
    }

    private static UUID requireActor(InventoryCountActor actor) {
        if (actor == null || actor.tenantId() == null) {
            throw new IllegalArgumentException("A tenant actor is required");
        }
        return actor.tenantId();
    }

    private static UUID requireWriteActor(InventoryCountActor actor) {
        UUID tenantId = requireActor(actor);
        if ((actor.userId() == null) == (actor.systemAdminId() == null)
                || actor.requestId() == null || actor.requestId().isBlank()) {
            throw new IllegalArgumentException("A traceable inventory count actor is required");
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
            throw new IllegalArgumentException("Inventory count keyword is too long");
        }
        return normalized;
    }

    private static String normalizeNote(String value) {
        String normalized = SensitiveTextRedactor.redactNullable(value);
        if (normalized == null || normalized.isBlank()) return null;
        normalized = normalized.strip();
        if (normalized.length() > 500) {
            throw new IllegalArgumentException("Inventory count note is too long");
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

    private static String csv(List<InventoryCountSummary> counts) {
        StringBuilder output = new StringBuilder("\uFEFF");
        appendCsvRow(output, CSV_HEADER);
        for (InventoryCountSummary count : counts) {
            appendCsvRow(output, List.of(
                    count.countNo(), count.warehouseCode(), count.warehouseName(),
                    statusLabel(count.status()), count.countDate().toString(),
                    nullable(count.note()), Integer.toString(count.lineCount()),
                    Long.toString(count.totalDifference()),
                    count.operatorDisplayName(), nullable(count.approverDisplayName()),
                    count.createdAt().toString(), count.updatedAt().toString()));
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

    private static String statusLabel(InventoryCountStatus status) {
        return switch (status) {
            case PENDING -> "待提交";
            case APPROVAL -> "审批中";
            case COMPLETED -> "已完成";
            case REJECTED -> "未通过";
            case CANCELLED -> "已作废";
        };
    }

    private static ResourceNotFoundException notFound() {
        return new ResourceNotFoundException("Inventory count was not found");
    }

    public record LineInput(UUID balanceId, long countedOnHand) {
    }

    public record InventoryCountExport(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }

    private record SnapshotLine(
            InventoryBalanceView balance,
            long countedOnHand) {
    }

    private record ActionResult(
            InventoryCountDetail detail,
            boolean replayed) {
    }
}
