package cn.xzkj.erp.procurement.recommendation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeAccess;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeEvaluator;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeMode;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.procurement.recommendation.ProcurementRecommendationRepository.GeneratedReference;
import cn.xzkj.erp.procurement.recommendation.ProcurementRecommendationService.ProcurementGenerationSelection;
import cn.xzkj.erp.procurement.service.ProcurementPlanActor;
import cn.xzkj.erp.procurement.service.ProcurementPlanService;
import cn.xzkj.erp.procurement.service.ProcurementPlanView;
import cn.xzkj.erp.procurement.service.ProcurementPurchaseOrderService;
import cn.xzkj.erp.procurement.service.ProcurementPurchaseOrderView;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class ProcurementRecommendationServiceTest {
    private static final UUID TENANT_ID = uuid("10000000-0000-4000-8000-000000000001");
    private static final UUID USER_ID = uuid("10000000-0000-4000-8000-000000000002");
    private static final UUID SKU_ID = uuid("10000000-0000-4000-8000-000000000003");
    private static final UUID WAREHOUSE_ID = uuid("10000000-0000-4000-8000-000000000004");
    private static final UUID LOCATION_ID = uuid("10000000-0000-4000-8000-000000000005");
    private static final UUID SUPPLIER_ID = uuid("10000000-0000-4000-8000-000000000006");
    private static final UUID COMMAND_ID = uuid("10000000-0000-4000-8000-000000000007");
    private static final UUID PLAN_ID = uuid("10000000-0000-4000-8000-000000000008");
    private static final UUID ORDER_ID = uuid("10000000-0000-4000-8000-000000000009");
    private static final Instant OBSERVED_AT = Instant.parse("2026-08-11T05:00:00Z");

    private ProcurementRecommendationRepository repository;
    private WarehouseScopeEvaluator scopeEvaluator;
    private ProcurementPlanService planService;
    private ProcurementPurchaseOrderService orderService;
    private SecurityAuditRecorder auditRecorder;
    private ProcurementRecommendationService service;

    @BeforeEach
    void setUp() {
        repository = mock(ProcurementRecommendationRepository.class);
        scopeEvaluator = mock(WarehouseScopeEvaluator.class);
        planService = mock(ProcurementPlanService.class);
        orderService = mock(ProcurementPurchaseOrderService.class);
        auditRecorder = mock(SecurityAuditRecorder.class);
        service = new ProcurementRecommendationService(
                repository, scopeEvaluator, planService, orderService,
                auditRecorder);
        when(scopeEvaluator.evaluate(TENANT_ID, USER_ID, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.ALL, Set.of()));
    }

    @Test
    void createsSmartPlanAndPendingPurchaseOrderFromCurrentRecommendation() {
        ProcurementGenerationSelection selection = selection(16);
        when(repository.findGenerated(eq(TENANT_ID), any()))
                .thenReturn(Optional.empty());
        when(repository.find(
                TENANT_ID, Set.of(), true, SKU_ID, WAREHOUSE_ID, OBSERVED_AT))
                .thenReturn(Optional.of(recommendation(16)));
        ProcurementPlanView plan = mock(ProcurementPlanView.class);
        when(plan.id()).thenReturn(PLAN_ID);
        when(plan.planNo()).thenReturn("PP-1");
        when(plan.version()).thenReturn(0L);
        when(planService.createSmart(
                eq(actor()), any(), eq(SKU_ID), eq(WAREHOUSE_ID),
                eq(LOCATION_ID), eq(16L), any()))
                .thenReturn(plan);
        ProcurementPurchaseOrderView order = mock(ProcurementPurchaseOrderView.class);
        when(order.id()).thenReturn(ORDER_ID);
        when(order.purchaseNo()).thenReturn("PO-1");
        when(order.skuId()).thenReturn(SKU_ID);
        when(order.warehouseId()).thenReturn(WAREHOUSE_ID);
        when(order.locationId()).thenReturn(LOCATION_ID);
        when(order.supplierId()).thenReturn(SUPPLIER_ID);
        when(order.quantity()).thenReturn(16L);
        when(orderService.create(
                eq(actor()), any(), eq(PLAN_ID), eq(0L),
                eq(SUPPLIER_ID), any()))
                .thenReturn(order);

        var result = service.generate(
                actor(), COMMAND_ID, OBSERVED_AT, List.of(selection));

        assertThat(result.commandId()).isEqualTo(COMMAND_ID);
        assertThat(result.items()).singleElement().satisfies(item -> {
            assertThat(item.purchaseOrderId()).isEqualTo(ORDER_ID);
            assertThat(item.planId()).isEqualTo(PLAN_ID);
            assertThat(item.quantity()).isEqualTo(16);
        });
        verify(scopeEvaluator).requireVisible(any(), eq(WAREHOUSE_ID));
        verify(repository).lockSkus(TENANT_ID, Set.of(SKU_ID));
        verify(planService).createSmart(
                eq(actor()), any(), eq(SKU_ID), eq(WAREHOUSE_ID),
                eq(LOCATION_ID), eq(16L), any());
        verify(orderService).create(
                eq(actor()), any(), eq(PLAN_ID), eq(0L),
                eq(SUPPLIER_ID), any());
        ArgumentCaptor<SecurityAuditEvent> audit =
                ArgumentCaptor.forClass(SecurityAuditEvent.class);
        verify(auditRecorder).recordAtomically(audit.capture());
        assertThat(audit.getValue().action())
                .isEqualTo("procurement_recommendation.generated");
        assertThat(audit.getValue().resourceType())
                .isEqualTo("procurement_recommendation_batch");
        assertThat(audit.getValue().resourceId())
                .isEqualTo(COMMAND_ID.toString());
        assertThat(audit.getValue().details())
                .containsEntry("itemCount", "1")
                .containsEntry("totalQuantity", "16");
    }

    @Test
    void rejectsChangedRecommendationBeforeCreatingBusinessRecords() {
        when(repository.findGenerated(eq(TENANT_ID), any()))
                .thenReturn(Optional.empty());
        when(repository.find(
                TENANT_ID, Set.of(), true, SKU_ID, WAREHOUSE_ID, OBSERVED_AT))
                .thenReturn(Optional.of(recommendation(15)));

        assertThatThrownBy(() -> service.generate(
                actor(), COMMAND_ID, OBSERVED_AT, List.of(selection(16))))
                .isInstanceOf(ConflictException.class);
        verify(planService, never()).createSmart(
                any(), any(), any(), any(), any(), anyLong(), any());
        verify(auditRecorder, never()).recordAtomically(any());
        verify(orderService, never()).create(
                any(), any(), any(), anyLong(), any(), any());
    }

    @Test
    void replaysAnExistingGeneratedOrderWithoutRecomputingMutableFacts() {
        when(repository.findGenerated(eq(TENANT_ID), any()))
                .thenReturn(Optional.of(new GeneratedReference(
                        ORDER_ID, "PO-1", PLAN_ID, "PP-1", SKU_ID,
                        WAREHOUSE_ID, LOCATION_ID, SUPPLIER_ID, 16)));

        var result = service.generate(
                actor(), COMMAND_ID, OBSERVED_AT, List.of(selection(16)));

        assertThat(result.items()).singleElement()
                .extracting(item -> item.purchaseOrderId())
                .isEqualTo(ORDER_ID);
        verify(repository, never()).find(
                any(), any(), eq(true), any(), any(), any());
        verify(planService, never()).createSmart(
                any(), any(), any(), any(), any(), anyLong(), any());
        verify(auditRecorder, never()).recordAtomically(any());
    }

    private static ProcurementRecommendationItem recommendation(long quantity) {
        return new ProcurementRecommendationItem(
                SKU_ID, "SKU-A", "Product A", null,
                WAREHOUSE_ID, "WH-A", "Warehouse A",
                5, 0, 5, 28, 0,
                SUPPLIER_ID, "SUP-A", "Supplier A", null,
                14, 14, 7, 21, 21, quantity, 1);
    }

    private static ProcurementGenerationSelection selection(long expected) {
        return new ProcurementGenerationSelection(
                SKU_ID, WAREHOUSE_ID, LOCATION_ID, expected, 16);
    }

    private static ProcurementPlanActor actor() {
        return new ProcurementPlanActor(
                TENANT_ID, USER_ID, null, "Buyer",
                "request-1", "127.0.0.1");
    }

    private static UUID uuid(String value) {
        return UUID.fromString(value);
    }
}
