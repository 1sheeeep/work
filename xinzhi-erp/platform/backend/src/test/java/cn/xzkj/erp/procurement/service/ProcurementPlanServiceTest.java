package cn.xzkj.erp.procurement.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeAccess;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeEvaluator;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeMode;
import cn.xzkj.erp.procurement.domain.ProcurementPlanSearchField;
import cn.xzkj.erp.procurement.domain.ProcurementPlanSource;
import cn.xzkj.erp.procurement.domain.ProcurementPlanStatus;
import cn.xzkj.erp.procurement.repository.ProcurementPlanRepository;
import cn.xzkj.erp.procurement.repository.ProcurementPlanRepository.CommandRecord;
import cn.xzkj.erp.procurement.repository.ProcurementPlanRepository.CreateFacts;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.PageImpl;

class ProcurementPlanServiceTest {
    private static final UUID TENANT_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();
    private static final UUID PLAN_ID = UUID.randomUUID();
    private static final UUID SKU_ID = UUID.randomUUID();
    private static final UUID WAREHOUSE_ID = UUID.randomUUID();
    private static final UUID LOCATION_ID = UUID.randomUUID();
    private static final UUID COMMAND_ID = UUID.randomUUID();

    private ProcurementPlanRepository repository;
    private WarehouseScopeEvaluator scopeEvaluator;
    private SecurityAuditRecorder audits;
    private ProcurementPlanService service;

    @BeforeEach
    void setUp() {
        repository = mock(ProcurementPlanRepository.class);
        scopeEvaluator = mock(WarehouseScopeEvaluator.class);
        audits = mock(SecurityAuditRecorder.class);
        service = new ProcurementPlanService(repository, scopeEvaluator, audits);
        when(scopeEvaluator.evaluate(TENANT_ID, USER_ID, null))
                .thenReturn(new WarehouseScopeAccess(WarehouseScopeMode.ALL, Set.of()));
    }

    @Test
    void createsManualPlanFromLockedActiveFactsAndAuditsOnlyBoundedDetails() {
        CreateFacts facts = facts();
        ProcurementPlanView created = plan(ProcurementPlanStatus.UNPURCHASED, 0);
        when(repository.findCommand(TENANT_ID, COMMAND_ID)).thenReturn(Optional.empty());
        when(repository.findCreateFacts(TENANT_ID, SKU_ID, WAREHOUSE_ID, LOCATION_ID))
                .thenReturn(Optional.of(facts));
        when(repository.find(eq(TENANT_ID), any())).thenReturn(Optional.of(created));

        ProcurementPlanView result = service.create(
                actor(), COMMAND_ID, SKU_ID, WAREHOUSE_ID, LOCATION_ID,
                12, "  restock  ");

        assertThat(result).isSameAs(created);
        verify(scopeEvaluator).requireVisible(any(), eq(WAREHOUSE_ID));
        verify(repository).insert(
                any(), eq(TENANT_ID), any(),
                eq(ProcurementPlanSource.MANUAL), eq(facts), eq(12L),
                eq("restock"), eq("Operator"), eq(USER_ID), eq(null));
        verify(repository).insertCommand(
                eq(TENANT_ID), eq(COMMAND_ID), any(), eq("CREATE"), any(),
                eq(ProcurementPlanStatus.UNPURCHASED), eq(0L));
        ArgumentCaptor<SecurityAuditEvent> event =
                ArgumentCaptor.forClass(SecurityAuditEvent.class);
        verify(audits).recordAtomically(event.capture());
        assertThat(event.getValue().action()).isEqualTo("procurement_plan.created");
        assertThat(event.getValue().resourceType()).isEqualTo("procurement_plan");
        assertThat(event.getValue().details())
                .containsEntry("skuId", SKU_ID.toString())
                .containsEntry("warehouseId", WAREHOUSE_ID.toString())
                .containsEntry("locationId", LOCATION_ID.toString())
                .doesNotContainKeys("note", "voidReason");
    }

    @Test
    void replaysSameSuccessfulCommandBeforeCurrentStateWithoutSecondWriteOrAudit() {
        ProcurementPlanView voided = plan(ProcurementPlanStatus.VOIDED, 1);
        when(repository.findCommand(TENANT_ID, COMMAND_ID))
                .thenReturn(Optional.of(new CommandRecord(
                        PLAN_ID, "VOID", fingerprintForVoid(0, "obsolete"),
                        ProcurementPlanStatus.VOIDED, 1)));
        when(repository.find(TENANT_ID, PLAN_ID)).thenReturn(Optional.of(voided));

        ProcurementPlanView result = service.voidPlan(
                actor(), PLAN_ID, COMMAND_ID, 0, " obsolete ");

        assertThat(result).isSameAs(voided);
        verify(repository, never()).lock(TENANT_ID, PLAN_ID);
        verify(repository, never()).voidPlan(
                any(), any(), anyLong(), any(), any(), any(), any());
        verifyNoInteractions(audits);
    }

    @Test
    void createReplayReturnsOriginalSuccessAfterPlanWasLaterVoided() {
        ProcurementPlanView current = plan(ProcurementPlanStatus.VOIDED, 1);
        when(repository.findCommand(TENANT_ID, COMMAND_ID))
                .thenReturn(Optional.of(new CommandRecord(
                        PLAN_ID, "CREATE", fingerprintForCreate(12, "restock"),
                        ProcurementPlanStatus.UNPURCHASED, 0)));
        when(repository.find(TENANT_ID, PLAN_ID)).thenReturn(Optional.of(current));

        ProcurementPlanView replay = service.create(
                actor(), COMMAND_ID, SKU_ID, WAREHOUSE_ID, LOCATION_ID,
                12, " restock ");

        assertThat(replay.status()).isEqualTo(ProcurementPlanStatus.UNPURCHASED);
        assertThat(replay.version()).isZero();
        assertThat(replay.voidReason()).isNull();
        assertThat(replay.voidedAt()).isNull();
        assertThat(replay.updatedAt()).isEqualTo(replay.createdAt());
        verify(repository, never()).findCreateFacts(any(), any(), any(), any());
        verify(repository, never()).insert(
                any(), any(), any(), any(), any(), anyLong(),
                any(), any(), any(), any());
        verifyNoInteractions(audits);
    }

    @Test
    void rejectsCommandReuseForDifferentPayloadWithoutBusinessWrite() {
        when(repository.findCommand(TENANT_ID, COMMAND_ID))
                .thenReturn(Optional.of(new CommandRecord(
                        PLAN_ID, "CREATE", "different", ProcurementPlanStatus.UNPURCHASED, 0)));

        assertThatThrownBy(() -> service.create(
                actor(), COMMAND_ID, SKU_ID, WAREHOUSE_ID, LOCATION_ID, 12, null))
                .isInstanceOf(ProcurementPlanConflictException.class)
                .extracting("reason")
                .isEqualTo("idempotency_conflict");
        verify(repository, never()).insert(
                any(), any(), any(), any(), any(), anyLong(),
                any(), any(), any(), any());
        verifyNoInteractions(audits);
    }

    @Test
    void distinguishesStaleVersionFromAlreadyVoidedState() {
        when(repository.findCommand(TENANT_ID, COMMAND_ID)).thenReturn(Optional.empty());
        when(repository.lock(TENANT_ID, PLAN_ID))
                .thenReturn(Optional.of(plan(ProcurementPlanStatus.UNPURCHASED, 2)));
        assertThatThrownBy(() -> service.voidPlan(
                actor(), PLAN_ID, COMMAND_ID, 1, "obsolete"))
                .isInstanceOf(ProcurementPlanConflictException.class)
                .extracting("reason").isEqualTo("optimistic_lock_conflict");

        when(repository.lock(TENANT_ID, PLAN_ID))
                .thenReturn(Optional.of(plan(ProcurementPlanStatus.VOIDED, 2)));
        assertThatThrownBy(() -> service.voidPlan(
                actor(), PLAN_ID, COMMAND_ID, 2, "obsolete"))
                .isInstanceOf(ProcurementPlanConflictException.class)
                .extracting("reason").isEqualTo("invalid_plan_state");
        verifyNoInteractions(audits);
    }

    @Test
    void rejectsBlankAndControlCharacterVoidReasonsBeforePersistence() {
        assertThatThrownBy(() -> service.voidPlan(
                actor(), PLAN_ID, COMMAND_ID, 0, "   "))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.voidPlan(
                actor(), PLAN_ID, COMMAND_ID, 0, "bad\u0001reason"))
                .isInstanceOf(IllegalArgumentException.class);
        verifyNoInteractions(repository, audits);
    }

    @Test
    void emptySelectedWarehouseScopeReturnsEmptyPageWithoutRepositoryRead() {
        when(scopeEvaluator.evaluate(TENANT_ID, USER_ID, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.SELECTED, Set.of()));

        var page = service.list(
                actor(), null, null, null, ProcurementPlanSearchField.PLAN_NO,
                null, null, null, PageRequest.of(0, 25));

        assertThat(page).isEmpty();
        verifyNoInteractions(repository);
    }

    @Test
    void exportsBoundedFilteredPlansWithSpreadsheetSafeCsv() {
        Instant from = Instant.parse("2026-08-01T00:00:00Z");
        Instant to = Instant.parse("2026-08-02T23:59:59.999Z");
        PageRequest exportPage = PageRequest.of(
                0, ProcurementPlanService.MAX_EXPORT_ROWS + 1);
        ProcurementPlanView value = new ProcurementPlanView(
                PLAN_ID, "PP-20260801-11111111",
                ProcurementPlanStatus.VOIDED, ProcurementPlanSource.MANUAL,
                SKU_ID, "SKU-1", "=Product,\"A\"", "+Black",
                WAREHOUSE_ID, "WH-1", "Warehouse",
                LOCATION_ID, "LOC-1", "Location", 12, "@restock",
                "Operator", Instant.parse("2026-08-01T10:00:00Z"),
                "obsolete", "Operator",
                Instant.parse("2026-08-01T11:00:00Z"), 1,
                Instant.parse("2026-08-01T11:00:00Z"));
        when(repository.list(
                TENANT_ID, Set.of(), true, WAREHOUSE_ID, LOCATION_ID,
                ProcurementPlanStatus.VOIDED, ProcurementPlanSearchField.SKU_NAME,
                "=product", from, to, exportPage))
                .thenReturn(new PageImpl<>(List.of(value), exportPage, 1));

        var result = service.exportCsv(
                actor(), WAREHOUSE_ID, LOCATION_ID,
                ProcurementPlanStatus.VOIDED, ProcurementPlanSearchField.SKU_NAME,
                " =Product ", from, to);

        assertThat(result.filename()).isEqualTo("procurement-plans.csv");
        assertThat(result.mediaType()).isEqualTo("text/csv;charset=utf-8");
        assertThat(result.rowCount()).isEqualTo(1);
        assertThat(result.content()).startsWith(
                "\uFEFF计划编号,状态,来源,SKU编号,SKU名称,规格,仓库编码,仓库名称,"
                        + "库位编码,库位名称,计划数量,备注,申请人,申请时间,作废原因,"
                        + "作废人,作废时间,更新时间\r\n");
        assertThat(result.content()).contains("\"'=Product,\"\"A\"\"\"");
        assertThat(result.content()).contains(",12,'@restock,Operator,");
    }

    @Test
    void rejectsPlanExportsAboveTheBoundedRowLimit() {
        PageRequest exportPage = PageRequest.of(
                0, ProcurementPlanService.MAX_EXPORT_ROWS + 1);
        when(repository.list(
                TENANT_ID, Set.of(), true, null, null, null,
                ProcurementPlanSearchField.PLAN_NO,
                null, null, null, exportPage))
                .thenReturn(new PageImpl<>(
                        List.of(), exportPage,
                        ProcurementPlanService.MAX_EXPORT_ROWS + 1L));

        assertThatThrownBy(() -> service.exportCsv(
                actor(), null, null, null,
                ProcurementPlanSearchField.PLAN_NO, null, null, null))
                .isInstanceOf(cn.xzkj.erp.platform.service.ConflictException.class);
    }

    @Test
    void countsOnlyUnpurchasedPlansVisibleInSelectedWarehouseScope() {
        Set<UUID> selectedWarehouses = Set.of(WAREHOUSE_ID);
        when(scopeEvaluator.evaluate(TENANT_ID, USER_ID, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.SELECTED, selectedWarehouses));
        when(repository.countByStatus(
                TENANT_ID, selectedWarehouses, false,
                ProcurementPlanStatus.UNPURCHASED))
                .thenReturn(7L);

        assertThat(service.countUnpurchased(actor())).isEqualTo(7);

        verify(repository).countByStatus(
                TENANT_ID, selectedWarehouses, false,
                ProcurementPlanStatus.UNPURCHASED);
    }

    @Test
    void emptySelectedWarehouseScopeReturnsZeroSummaryWithoutRepositoryRead() {
        when(scopeEvaluator.evaluate(TENANT_ID, USER_ID, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.SELECTED, Set.of()));

        assertThat(service.countUnpurchased(actor())).isZero();

        verifyNoInteractions(repository);
    }

    private static ProcurementPlanActor actor() {
        return new ProcurementPlanActor(
                TENANT_ID, USER_ID, null, "Operator", "request-1", "127.0.0.1");
    }

    private static CreateFacts facts() {
        return new CreateFacts(
                SKU_ID, "SKU-1", "Product", "Black",
                WAREHOUSE_ID, "WH-1", "Warehouse",
                LOCATION_ID, "LOC-1", "Location");
    }

    private static ProcurementPlanView plan(ProcurementPlanStatus status, long version) {
        boolean voided = status == ProcurementPlanStatus.VOIDED;
        return new ProcurementPlanView(
                PLAN_ID, "PP-20260801-11111111", status,
                ProcurementPlanSource.MANUAL, SKU_ID, "SKU-1", "Product", "Black",
                WAREHOUSE_ID, "WH-1", "Warehouse",
                LOCATION_ID, "LOC-1", "Location", 12, "restock", "Operator",
                Instant.parse("2026-08-01T10:00:00Z"),
                voided ? "obsolete" : null,
                voided ? "Operator" : null,
                voided ? Instant.parse("2026-08-01T11:00:00Z") : null,
                version, Instant.parse("2026-08-01T11:00:00Z"));
    }

    private static String fingerprintForVoid(long expectedVersion, String reason) {
        return fingerprint(
                "VOID", PLAN_ID.toString(), Long.toString(expectedVersion), reason);
    }

    private static String fingerprintForCreate(long quantity, String note) {
        return fingerprint(
                "CREATE", SKU_ID.toString(), WAREHOUSE_ID.toString(),
                LOCATION_ID.toString(), Long.toString(quantity), note);
    }

    private static String fingerprint(String... values) {
        try {
            var method = ProcurementPlanService.class.getDeclaredMethod(
                    "fingerprint", String[].class);
            method.setAccessible(true);
            return (String) method.invoke(null, (Object) values);
        } catch (ReflectiveOperationException exception) {
            throw new AssertionError(exception);
        }
    }
}
