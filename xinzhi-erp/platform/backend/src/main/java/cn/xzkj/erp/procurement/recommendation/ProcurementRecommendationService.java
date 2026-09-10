package cn.xzkj.erp.procurement.recommendation;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeAccess;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeEvaluator;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.procurement.recommendation.ProcurementRecommendationRepository.GeneratedReference;
import cn.xzkj.erp.procurement.service.ProcurementPlanActor;
import cn.xzkj.erp.procurement.service.ProcurementPlanService;
import cn.xzkj.erp.procurement.service.ProcurementPlanView;
import cn.xzkj.erp.procurement.service.ProcurementPurchaseOrderService;
import cn.xzkj.erp.procurement.service.ProcurementPurchaseOrderView;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ProcurementRecommendationService {
    public static final int SALES_WINDOW_DAYS =
            ProcurementRecommendationRepository.SALES_WINDOW_DAYS;
    public static final int DEFAULT_LEAD_TIME_DAYS =
            ProcurementRecommendationRepository.DEFAULT_LEAD_TIME_DAYS;
    public static final int SAFETY_DAYS =
            ProcurementRecommendationRepository.SAFETY_DAYS;
    static final int MAX_EXPORT_ROWS = 10_000;
    static final int MAX_GENERATION_ITEMS = 50;
    private static final long MAX_QUANTITY = 1_000_000_000L;
    private static final String CSV_MEDIA_TYPE = "text/csv;charset=utf-8";
    private static final String RESOURCE_TYPE = "procurement_recommendation_batch";
    private static final String GENERATED = "procurement_recommendation.generated";
    private static final List<String> CSV_HEADER = List.of(
            "SKU编号", "SKU名称", "规格", "仓库编码", "仓库名称",
            "现货", "预留", "可用", "近28天销量", "待到货",
            "首选供应商编码", "首选供应商名称", "供应商SKU",
            "供应商交期天数", "计算交期天数", "安全天数", "目标覆盖天数",
            "目标库存", "建议采购量", "可用库位数", "统计截至");

    private final ProcurementRecommendationRepository repository;
    private final WarehouseScopeEvaluator scopeEvaluator;
    private final ProcurementPlanService planService;
    private final ProcurementPurchaseOrderService purchaseOrderService;
    private final SecurityAuditRecorder auditRecorder;

    public ProcurementRecommendationService(
            ProcurementRecommendationRepository repository,
            WarehouseScopeEvaluator scopeEvaluator,
            ProcurementPlanService planService,
            ProcurementPurchaseOrderService purchaseOrderService,
            SecurityAuditRecorder auditRecorder) {
        this.repository = repository;
        this.scopeEvaluator = scopeEvaluator;
        this.planService = planService;
        this.purchaseOrderService = purchaseOrderService;
        this.auditRecorder = auditRecorder;
    }

    @Transactional(readOnly = true)
    public ProcurementRecommendationResult summarize(
            ProcurementPlanActor actor,
            String supplier,
            String keyword,
            boolean hideWithoutSupplier,
            boolean hideZeroRecommendation,
            Instant asOf,
            Pageable pageable) {
        requireActor(actor);
        if (asOf == null) {
            throw new IllegalArgumentException("asOf is required");
        }
        WarehouseScopeAccess scope = scope(actor);
        if (!scope.allowsAll() && scope.warehouseIds().isEmpty()) {
            return ProcurementRecommendationResult.empty();
        }
        return repository.summarize(
                actor.tenantId(), scope.warehouseIds(), scope.allowsAll(),
                normalize(supplier), normalize(keyword),
                hideWithoutSupplier, hideZeroRecommendation,
                asOf, pageable);
    }

    @Transactional(readOnly = true)
    public ProcurementRecommendationExport exportCsv(
            ProcurementPlanActor actor,
            String supplier,
            String keyword,
            boolean hideWithoutSupplier,
            boolean hideZeroRecommendation,
            Instant asOf) {
        ProcurementRecommendationResult result = summarize(
                actor, supplier, keyword, hideWithoutSupplier,
                hideZeroRecommendation, asOf,
                PageRequest.of(0, MAX_EXPORT_ROWS + 1));
        if (result.totalElements() > MAX_EXPORT_ROWS
                || result.items().size() > MAX_EXPORT_ROWS) {
            throw new ConflictException(
                    "Procurement recommendation export exceeds the supported row limit");
        }
        return new ProcurementRecommendationExport(
                "procurement-recommendations.csv", CSV_MEDIA_TYPE,
                result.items().size(), csv(result.items(), asOf));
    }

    @Transactional
    public ProcurementGenerationResult generate(
            ProcurementPlanActor actor,
            UUID commandId,
            Instant observedAt,
            List<ProcurementGenerationSelection> selections) {
        requireActor(actor);
        UUID requiredCommandId = requireId(commandId, "commandId");
        if (observedAt == null) {
            throw new IllegalArgumentException("observedAt is required");
        }
        if (selections == null || selections.isEmpty()
                || selections.size() > MAX_GENERATION_ITEMS) {
            throw new IllegalArgumentException(
                    "Procurement generation selection count is invalid");
        }
        WarehouseScopeAccess scope = scope(actor);
        Set<String> identities = new HashSet<>();
        List<PreparedSelection> prepared = new ArrayList<>();
        List<ProcurementGenerationItem> replays = new ArrayList<>();

        for (ProcurementGenerationSelection selection : selections) {
            validate(selection);
            String identity = selection.skuId() + ":" + selection.warehouseId();
            if (!identities.add(identity)) {
                throw new IllegalArgumentException(
                        "Procurement generation selections must be unique");
            }
            scopeEvaluator.requireVisible(scope, selection.warehouseId());
        }
        repository.lockSkus(
                actor.tenantId(), selections.stream()
                        .map(ProcurementGenerationSelection::skuId)
                        .collect(java.util.stream.Collectors.toSet()));

        for (ProcurementGenerationSelection selection : selections) {
            UUID planCommandId = derivedCommand(
                    "smart-plan", requiredCommandId, selection);
            UUID orderCommandId = derivedCommand(
                    "smart-order", requiredCommandId, selection);
            GeneratedReference replay = repository.findGenerated(
                    actor.tenantId(), orderCommandId).orElse(null);
            if (replay != null) {
                requireReplayIdentity(replay, selection);
                replays.add(from(replay));
                continue;
            }
            ProcurementRecommendationItem current = repository.find(
                            actor.tenantId(), scope.warehouseIds(),
                            scope.allowsAll(), selection.skuId(),
                            selection.warehouseId(), observedAt)
                    .orElseThrow(() -> new ResourceNotFoundException(
                            "Procurement recommendation was not found"));
            if (current.recommendedQuantity()
                    != selection.expectedRecommendedQuantity()) {
                throw new ConflictException(
                        "Procurement recommendation changed; refresh and retry");
            }
            if (current.recommendedQuantity() < 1) {
                throw new ConflictException(
                        "Procurement recommendation is no longer actionable");
            }
            if (current.supplierId() == null) {
                throw new ConflictException(
                        "A preferred supplier is required before generating a purchase order");
            }
            if (current.activeLocationCount() < 1) {
                throw new ConflictException(
                        "An active warehouse location is required before generating a purchase order");
            }
            prepared.add(new PreparedSelection(
                    selection, current, planCommandId, orderCommandId));
        }
        if (!replays.isEmpty() && !prepared.isEmpty()) {
            throw new ConflictException(
                    "Procurement generation retry state is incomplete");
        }
        if (!replays.isEmpty()) {
            return new ProcurementGenerationResult(
                    requiredCommandId, observedAt, List.copyOf(replays));
        }

        List<ProcurementGenerationItem> generated = new ArrayList<>();
        String note = "补货建议生成；统计截至 " + observedAt;
        for (PreparedSelection item : prepared) {
            ProcurementPlanView plan = planService.createSmart(
                    actor, item.planCommandId(), item.selection().skuId(),
                    item.selection().warehouseId(),
                    item.selection().locationId(),
                    item.selection().quantity(), note);
            ProcurementPurchaseOrderView order = purchaseOrderService.create(
                    actor, item.orderCommandId(), plan.id(), plan.version(),
                    item.current().supplierId(), note);
            generated.add(new ProcurementGenerationItem(
                    order.id(), order.purchaseNo(), plan.id(), plan.planNo(),
                    order.skuId(), order.warehouseId(), order.locationId(),
                    order.supplierId(), order.quantity()));
        }
        audit(actor, requiredCommandId, generated);
        return new ProcurementGenerationResult(
                requiredCommandId, observedAt, List.copyOf(generated));
    }

    private void audit(
            ProcurementPlanActor actor,
            UUID commandId,
            List<ProcurementGenerationItem> generated) {
        long totalQuantity = generated.stream()
                .mapToLong(ProcurementGenerationItem::quantity)
                .sum();
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(),
                GENERATED, RESOURCE_TYPE, commandId.toString(),
                actor.requestId(), actor.sourceIp(),
                Map.of(
                        "itemCount", Integer.toString(generated.size()),
                        "totalQuantity", Long.toString(totalQuantity))));
    }

    private WarehouseScopeAccess scope(ProcurementPlanActor actor) {
        return scopeEvaluator.evaluate(
                actor.tenantId(), actor.userId(), actor.systemAdminId());
    }

    private static void requireActor(ProcurementPlanActor actor) {
        if (actor == null || actor.tenantId() == null
                || (actor.userId() == null) == (actor.systemAdminId() == null)) {
            throw new AccessDeniedException("A tenant actor is required");
        }
    }

    private static void validate(ProcurementGenerationSelection selection) {
        if (selection == null) {
            throw new IllegalArgumentException(
                    "Procurement generation selection is required");
        }
        requireId(selection.skuId(), "skuId");
        requireId(selection.warehouseId(), "warehouseId");
        requireId(selection.locationId(), "locationId");
        if (selection.expectedRecommendedQuantity() < 1
                || selection.expectedRecommendedQuantity() > MAX_QUANTITY
                || selection.quantity() < 1
                || selection.quantity() > MAX_QUANTITY) {
            throw new IllegalArgumentException(
                    "Procurement generation quantity is invalid");
        }
    }

    private static UUID requireId(UUID value, String field) {
        if (value == null) {
            throw new IllegalArgumentException(field + " is required");
        }
        return value;
    }

    private static UUID derivedCommand(
            String operation,
            UUID commandId,
            ProcurementGenerationSelection selection) {
        String source = operation + ":" + commandId + ":"
                + selection.skuId() + ":" + selection.warehouseId();
        return UUID.nameUUIDFromBytes(source.getBytes(StandardCharsets.UTF_8));
    }

    private static void requireReplayIdentity(
            GeneratedReference replay,
            ProcurementGenerationSelection selection) {
        if (!replay.skuId().equals(selection.skuId())
                || !replay.warehouseId().equals(selection.warehouseId())
                || !replay.locationId().equals(selection.locationId())
                || replay.quantity() != selection.quantity()) {
            throw new ConflictException(
                    "Procurement generation command was already used for different data");
        }
    }

    private static ProcurementGenerationItem from(GeneratedReference value) {
        return new ProcurementGenerationItem(
                value.purchaseOrderId(), value.purchaseNo(),
                value.planId(), value.planNo(), value.skuId(),
                value.warehouseId(), value.locationId(),
                value.supplierId(), value.quantity());
    }

    private static String normalize(String value) {
        if (value == null || value.isBlank()) return null;
        return value.strip().toLowerCase(Locale.ROOT);
    }

    private static String csv(
            List<ProcurementRecommendationItem> items, Instant asOf) {
        StringBuilder output = new StringBuilder("\uFEFF");
        appendCsvRow(output, CSV_HEADER);
        for (ProcurementRecommendationItem item : items) {
            appendCsvRow(output, List.of(
                    item.skuCode(), item.skuName(), nullable(item.skuVariant()),
                    item.warehouseCode(), item.warehouseName(),
                    Long.toString(item.onHand()), Long.toString(item.reserved()),
                    Long.toString(item.available()),
                    Long.toString(item.last28DaysSalesQuantity()),
                    Long.toString(item.openPurchaseQuantity()),
                    nullable(item.supplierCode()), nullable(item.supplierName()),
                    nullable(item.supplierSkuCode()),
                    item.supplierLeadTimeDays() == null
                            ? "" : item.supplierLeadTimeDays().toString(),
                    Integer.toString(item.planningLeadTimeDays()),
                    Integer.toString(item.safetyDays()),
                    Integer.toString(item.targetCoverageDays()),
                    Long.toString(item.targetStockQuantity()),
                    Long.toString(item.recommendedQuantity()),
                    Integer.toString(item.activeLocationCount()),
                    asOf.toString()));
        }
        return output.toString();
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

    private record PreparedSelection(
            ProcurementGenerationSelection selection,
            ProcurementRecommendationItem current,
            UUID planCommandId,
            UUID orderCommandId) {
    }

    public record ProcurementGenerationSelection(
            UUID skuId,
            UUID warehouseId,
            UUID locationId,
            long expectedRecommendedQuantity,
            long quantity) {
    }

    public record ProcurementGenerationItem(
            UUID purchaseOrderId,
            String purchaseNo,
            UUID planId,
            String planNo,
            UUID skuId,
            UUID warehouseId,
            UUID locationId,
            UUID supplierId,
            long quantity) {
    }

    public record ProcurementGenerationResult(
            UUID commandId,
            Instant observedAt,
            List<ProcurementGenerationItem> items) {
    }

    public record ProcurementRecommendationExport(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }
}
