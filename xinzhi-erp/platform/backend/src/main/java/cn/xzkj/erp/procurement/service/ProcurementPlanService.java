package cn.xzkj.erp.procurement.service;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeAccess;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeEvaluator;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.procurement.domain.ProcurementPlanSearchField;
import cn.xzkj.erp.procurement.domain.ProcurementPlanSource;
import cn.xzkj.erp.procurement.domain.ProcurementPlanStatus;
import cn.xzkj.erp.procurement.repository.ProcurementPlanRepository;
import cn.xzkj.erp.procurement.repository.ProcurementPlanRepository.CommandRecord;
import cn.xzkj.erp.procurement.service.ProcurementReferenceViews.LocationOption;
import cn.xzkj.erp.procurement.service.ProcurementReferenceViews.SkuOption;
import cn.xzkj.erp.procurement.service.ProcurementReferenceViews.WarehouseOption;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.HexFormat;
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
public class ProcurementPlanService {
    static final int MAX_EXPORT_ROWS = 10_000;
    private static final String CSV_MEDIA_TYPE = "text/csv;charset=utf-8";
    private static final List<String> CSV_HEADER = List.of(
            "计划编号", "状态", "来源", "SKU编号", "SKU名称", "规格",
            "仓库编码", "仓库名称", "库位编码", "库位名称", "计划数量",
            "备注", "申请人", "申请时间", "作废原因", "作废人", "作废时间",
            "更新时间");
    private static final long MAX_QUANTITY = 1_000_000_000L;
    private static final Pattern REQUEST_ID =
            Pattern.compile("^[A-Za-z0-9._:-]{1,100}$");
    private static final String RESOURCE_TYPE = "procurement_plan";
    private static final String CREATED = "procurement_plan.created";
    private static final String VOIDED = "procurement_plan.voided";

    private final ProcurementPlanRepository repository;
    private final WarehouseScopeEvaluator scopeEvaluator;
    private final SecurityAuditRecorder auditRecorder;

    public ProcurementPlanService(
            ProcurementPlanRepository repository,
            WarehouseScopeEvaluator scopeEvaluator,
            SecurityAuditRecorder auditRecorder) {
        this.repository = repository;
        this.scopeEvaluator = scopeEvaluator;
        this.auditRecorder = auditRecorder;
    }

    @Transactional(readOnly = true)
    public Page<ProcurementPlanView> list(
            ProcurementPlanActor actor,
            UUID warehouseId,
            UUID locationId,
            ProcurementPlanStatus status,
            ProcurementPlanSearchField searchField,
            String keyword,
            Instant createdFrom,
            Instant createdTo,
            Pageable pageable) {
        UUID tenantId = requireActor(actor);
        WarehouseScopeAccess scope = scope(actor);
        if (warehouseId != null) scopeEvaluator.requireVisible(scope, warehouseId);
        if (createdFrom != null && createdTo != null && createdFrom.isAfter(createdTo)) {
            throw new IllegalArgumentException("Invalid procurement plan date range");
        }
        if (!scope.allowsAll() && scope.warehouseIds().isEmpty()) {
            return Page.empty(pageable);
        }
        return repository.list(
                tenantId, scope.warehouseIds(), scope.allowsAll(), warehouseId,
                locationId, status,
                searchField == null ? ProcurementPlanSearchField.PLAN_NO : searchField,
                normalizeKeyword(keyword), createdFrom, createdTo, pageable);
    }

    @Transactional(readOnly = true)
    public ProcurementPlanExport exportCsv(
            ProcurementPlanActor actor,
            UUID warehouseId,
            UUID locationId,
            ProcurementPlanStatus status,
            ProcurementPlanSearchField searchField,
            String keyword,
            Instant createdFrom,
            Instant createdTo) {
        Page<ProcurementPlanView> page = list(
                actor, warehouseId, locationId, status, searchField, keyword,
                createdFrom, createdTo,
                PageRequest.of(0, MAX_EXPORT_ROWS + 1));
        if (page.getTotalElements() > MAX_EXPORT_ROWS
                || page.getNumberOfElements() > MAX_EXPORT_ROWS) {
            throw new ConflictException(
                    "Procurement plan export exceeds the supported row limit");
        }
        return new ProcurementPlanExport(
                "procurement-plans.csv", CSV_MEDIA_TYPE,
                page.getNumberOfElements(), csv(page.getContent()));
    }

    @Transactional(readOnly = true)
    public long countUnpurchased(ProcurementPlanActor actor) {
        UUID tenantId = requireActor(actor);
        WarehouseScopeAccess scope = scope(actor);
        if (!scope.allowsAll() && scope.warehouseIds().isEmpty()) {
            return 0;
        }
        return repository.countByStatus(
                tenantId, scope.warehouseIds(), scope.allowsAll(),
                ProcurementPlanStatus.UNPURCHASED);
    }

    @Transactional(readOnly = true)
    public ProcurementPlanView get(ProcurementPlanActor actor, UUID planId) {
        UUID tenantId = requireActor(actor);
        ProcurementPlanView plan = repository.find(tenantId, requireId(planId))
                .orElseThrow(ProcurementPlanService::notFound);
        requireVisible(actor, plan);
        return plan;
    }

    @Transactional
    public ProcurementPlanView create(
            ProcurementPlanActor actor,
            UUID commandId,
            UUID skuId,
            UUID warehouseId,
            UUID locationId,
            long quantity,
            String note) {
        return createWithSource(
                actor, commandId, skuId, warehouseId, locationId,
                quantity, note, ProcurementPlanSource.MANUAL);
    }

    @Transactional
    public ProcurementPlanView createSmart(
            ProcurementPlanActor actor,
            UUID commandId,
            UUID skuId,
            UUID warehouseId,
            UUID locationId,
            long quantity,
            String note) {
        return createWithSource(
                actor, commandId, skuId, warehouseId, locationId,
                quantity, note, ProcurementPlanSource.SMART);
    }

    private ProcurementPlanView createWithSource(
            ProcurementPlanActor actor,
            UUID commandId,
            UUID skuId,
            UUID warehouseId,
            UUID locationId,
            long quantity,
            String note,
            ProcurementPlanSource source) {
        UUID tenantId = requireWriteActor(actor);
        UUID requiredCommandId = requireId(commandId);
        UUID requiredSkuId = requireId(skuId);
        UUID requiredWarehouseId = requireId(warehouseId);
        UUID requiredLocationId = requireId(locationId);
        scopeEvaluator.requireVisible(scope(actor), requiredWarehouseId);
        if (quantity < 1 || quantity > MAX_QUANTITY) {
            throw new IllegalArgumentException("Procurement plan quantity is invalid");
        }
        String normalizedNote = normalizeText(note, 500, "note", false);
        String operation = "CREATE";
        String fingerprint = source == ProcurementPlanSource.MANUAL
                ? fingerprint(
                        operation, requiredSkuId.toString(),
                        requiredWarehouseId.toString(),
                        requiredLocationId.toString(), Long.toString(quantity),
                        normalizedNote)
                : fingerprint(
                        operation, source.name(), requiredSkuId.toString(),
                        requiredWarehouseId.toString(),
                        requiredLocationId.toString(), Long.toString(quantity),
                        normalizedNote);
        repository.lockCommand(tenantId, requiredCommandId);
        ProcurementPlanView replay = replay(
                actor, requiredCommandId, operation, fingerprint);
        if (replay != null) return replay;

        ProcurementPlanRepository.CreateFacts facts = repository.findCreateFacts(
                        tenantId, requiredSkuId, requiredWarehouseId, requiredLocationId)
                .orElseThrow(ProcurementPlanService::notFound);
        UUID planId = UUID.randomUUID();
        String planNo = "PP-"
                + LocalDate.now(ZoneOffset.UTC).format(DateTimeFormatter.BASIC_ISO_DATE)
                + "-" + planId.toString().replace("-", "")
                        .substring(0, 28).toUpperCase(Locale.ROOT);
        repository.insert(
                planId, tenantId, planNo, source, facts, quantity,
                normalizedNote, displayName(actor),
                actor.userId(), actor.systemAdminId());
        ProcurementPlanView created = repository.find(tenantId, planId).orElseThrow();
        repository.insertCommand(
                tenantId, requiredCommandId, planId, operation, fingerprint,
                created.status(), created.version());
        audit(actor, CREATED, created);
        return created;
    }

    @Transactional
    public ProcurementPlanView voidPlan(
            ProcurementPlanActor actor,
            UUID planId,
            UUID commandId,
            long expectedVersion,
            String reason) {
        UUID tenantId = requireWriteActor(actor);
        UUID requiredPlanId = requireId(planId);
        UUID requiredCommandId = requireId(commandId);
        if (expectedVersion < 0) {
            throw new IllegalArgumentException("Procurement plan version is invalid");
        }
        String normalizedReason = normalizeText(reason, 500, "void reason", true);
        String operation = "VOID";
        String fingerprint = fingerprint(
                operation, requiredPlanId.toString(),
                Long.toString(expectedVersion), normalizedReason);
        repository.lockCommand(tenantId, requiredCommandId);
        ProcurementPlanView replay = replay(
                actor, requiredCommandId, operation, fingerprint);
        if (replay != null) return replay;

        ProcurementPlanView current = repository.lock(tenantId, requiredPlanId)
                .orElseThrow(ProcurementPlanService::notFound);
        requireVisible(actor, current);
        if (current.status() != ProcurementPlanStatus.UNPURCHASED) {
            throw new ProcurementPlanConflictException("invalid_plan_state");
        }
        if (current.version() != expectedVersion) {
            throw new ProcurementPlanConflictException("optimistic_lock_conflict");
        }
        if (repository.voidPlan(
                tenantId, requiredPlanId, expectedVersion, normalizedReason,
                displayName(actor), actor.userId(), actor.systemAdminId()) != 1) {
            throw new ProcurementPlanConflictException("optimistic_lock_conflict");
        }
        ProcurementPlanView changed = repository.find(tenantId, requiredPlanId)
                .orElseThrow(ProcurementPlanService::notFound);
        repository.insertCommand(
                tenantId, requiredCommandId, requiredPlanId, operation,
                fingerprint, changed.status(), changed.version());
        audit(actor, VOIDED, changed);
        return changed;
    }

    @Transactional(readOnly = true)
    public Page<SkuOption> skuOptions(
            ProcurementPlanActor actor, String keyword, Pageable pageable) {
        return repository.listSkuOptions(
                requireActor(actor), normalizeKeyword(keyword), pageable);
    }

    @Transactional(readOnly = true)
    public Page<WarehouseOption> warehouseOptions(
            ProcurementPlanActor actor, String keyword, Pageable pageable) {
        UUID tenantId = requireActor(actor);
        WarehouseScopeAccess scope = scope(actor);
        if (!scope.allowsAll() && scope.warehouseIds().isEmpty()) {
            return Page.empty(pageable);
        }
        return repository.listWarehouseOptions(
                tenantId, scope.warehouseIds(), scope.allowsAll(),
                normalizeKeyword(keyword), pageable);
    }

    @Transactional(readOnly = true)
    public Page<LocationOption> locationOptions(
            ProcurementPlanActor actor,
            UUID warehouseId,
            String keyword,
            Pageable pageable) {
        UUID tenantId = requireActor(actor);
        UUID requiredWarehouseId = requireId(warehouseId);
        scopeEvaluator.requireVisible(scope(actor), requiredWarehouseId);
        return repository.listLocationOptions(
                tenantId, requiredWarehouseId,
                normalizeKeyword(keyword), pageable);
    }

    private ProcurementPlanView replay(
            ProcurementPlanActor actor,
            UUID commandId,
            String operation,
            String fingerprint) {
        CommandRecord command = repository.findCommand(actor.tenantId(), commandId)
                .orElse(null);
        if (command == null) return null;
        if (!command.operation().equals(operation)
                || !command.fingerprint().equals(fingerprint)) {
            throw new ProcurementPlanConflictException("idempotency_conflict");
        }
        ProcurementPlanView plan = repository.find(actor.tenantId(), command.planId())
                .orElseThrow(ProcurementPlanService::notFound);
        requireVisible(actor, plan);
        if ("CREATE".equals(command.operation())) {
            return new ProcurementPlanView(
                    plan.id(), plan.planNo(), command.resultStatus(), plan.source(),
                    plan.skuId(), plan.skuCode(), plan.skuName(), plan.skuVariant(),
                    plan.warehouseId(), plan.warehouseCode(), plan.warehouseName(),
                    plan.locationId(), plan.locationCode(), plan.locationName(),
                    plan.quantity(), plan.note(), plan.applicantDisplayName(),
                    plan.createdAt(), null, null, null, command.resultVersion(),
                    plan.createdAt());
        }
        if (plan.status() != command.resultStatus()
                || plan.version() != command.resultVersion()) {
            throw new IllegalStateException("Procurement command result is inconsistent");
        }
        return plan;
    }

    private void audit(
            ProcurementPlanActor actor,
            String action,
            ProcurementPlanView plan) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(),
                action, RESOURCE_TYPE, plan.id().toString(),
                actor.requestId(), actor.sourceIp(),
                Map.of(
                        "warehouseId", plan.warehouseId().toString(),
                        "locationId", plan.locationId().toString(),
                        "skuId", plan.skuId().toString(),
                        "status", plan.status().name(),
                        "source", plan.source().name(),
                        "quantity", Long.toString(plan.quantity()),
                        "version", Long.toString(plan.version()))));
    }

    private WarehouseScopeAccess scope(ProcurementPlanActor actor) {
        return scopeEvaluator.evaluate(
                actor.tenantId(), actor.userId(), actor.systemAdminId());
    }

    private void requireVisible(
            ProcurementPlanActor actor, ProcurementPlanView plan) {
        scopeEvaluator.requireVisible(scope(actor), plan.warehouseId());
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
                    "A traceable procurement plan actor is required");
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
            throw new IllegalArgumentException("Applicant display name is too long");
        }
        return normalized;
    }

    private static String normalizeKeyword(String value) {
        if (value == null || value.isBlank()) return null;
        String normalized = value.strip().toLowerCase(Locale.ROOT);
        if (normalized.length() > 120) {
            throw new IllegalArgumentException("Procurement plan keyword is too long");
        }
        return normalized;
    }

    private static String normalizeText(
            String value, int maximum, String field, boolean required) {
        if (value == null || value.isBlank()) {
            if (required) throw new IllegalArgumentException(field + " is required");
            return null;
        }
        String normalized = value.strip();
        if (normalized.codePoints().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException(field + " contains control characters");
        }
        if (normalized.length() > maximum) {
            throw new IllegalArgumentException(field + " is too long");
        }
        return normalized;
    }

    private static String csv(List<ProcurementPlanView> plans) {
        StringBuilder output = new StringBuilder("\uFEFF");
        appendCsvRow(output, CSV_HEADER);
        for (ProcurementPlanView plan : plans) {
            appendCsvRow(output, List.of(
                    plan.planNo(), statusLabel(plan.status()),
                    sourceLabel(plan.source()),
                    plan.skuCode(), plan.skuName(), nullable(plan.skuVariant()),
                    plan.warehouseCode(), plan.warehouseName(),
                    plan.locationCode(), plan.locationName(),
                    Long.toString(plan.quantity()), nullable(plan.note()),
                    plan.applicantDisplayName(), plan.createdAt().toString(),
                    nullable(plan.voidReason()),
                    nullable(plan.voidedByDisplayName()),
                    plan.voidedAt() == null ? "" : plan.voidedAt().toString(),
                    plan.updatedAt().toString()));
        }
        return output.toString();
    }

    private static String statusLabel(ProcurementPlanStatus status) {
        return switch (status) {
            case UNPURCHASED -> "未采购";
            case ORDERED -> "已生成采购单";
            case VOIDED -> "已作废";
        };
    }

    private static String sourceLabel(ProcurementPlanSource source) {
        return switch (source) {
            case MANUAL -> "手工";
            case SMART -> "补货建议";
        };
    }

    private static void appendCsvRow(
            StringBuilder output, List<String> cells) {
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
                        ? new byte[] {-1}
                        : value.getBytes(StandardCharsets.UTF_8);
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
        return new ResourceNotFoundException("Procurement plan was not found");
    }

    public record ProcurementPlanExport(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }
}
