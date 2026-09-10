package cn.xzkj.erp.fulfillment.service;

import static cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.PackageStatus;
import static cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.PauseState;
import static cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.ShortageState;
import static cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.ShopifyPublicationStatus;
import static cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.Status;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.Line;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.Package;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.PackageItem;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.Plan;
import cn.xzkj.erp.fulfillment.inventory.InventoryReservationPort;
import cn.xzkj.erp.fulfillment.inventory.InventoryReservationPort.ConsumptionCommand;
import cn.xzkj.erp.fulfillment.inventory.InventoryReservationPort.CorrectionCommand;
import cn.xzkj.erp.fulfillment.inventory.InventoryReservationPort.ReleaseCommand;
import cn.xzkj.erp.fulfillment.repository.FulfillmentRepository;
import cn.xzkj.erp.fulfillment.repository.FulfillmentRepository.CommandRecord;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeAccess;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeEvaluator;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeMode;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;

class FulfillmentServiceTest {

    private static final UUID TENANT =
            UUID.fromString("f4600000-0000-4000-8000-000000000001");
    private static final UUID USER =
            UUID.fromString("f4600000-0000-4000-8000-000000000002");
    private static final UUID PLAN =
            UUID.fromString("f4600000-0000-4000-8000-000000000010");
    private static final UUID ORDER =
            UUID.fromString("f4600000-0000-4000-8000-000000000011");
    private static final UUID SHOP =
            UUID.fromString("f4600000-0000-4000-8000-000000000012");
    private static final UUID LINE =
            UUID.fromString("f4600000-0000-4000-8000-000000000020");
    private static final UUID ORDER_LINE =
            UUID.fromString("f4600000-0000-4000-8000-000000000021");
    private static final UUID SKU =
            UUID.fromString("f4600000-0000-4000-8000-000000000022");
    private static final UUID WAREHOUSE =
            UUID.fromString("f4600000-0000-4000-8000-000000000023");
    private static final UUID PACKAGE =
            UUID.fromString("f4600000-0000-4000-8000-000000000030");
    private static final Instant NOW = Instant.parse("2026-07-30T12:00:00Z");

    private FulfillmentRepository repository;
    private InventoryReservationPort inventory;
    private SecurityAuditRecorder audits;
    private WarehouseScopeEvaluator scopes;
    private FulfillmentService service;
    private FulfillmentService.Actor actor;

    @BeforeEach
    void setUp() {
        repository = mock(FulfillmentRepository.class);
        inventory = mock(InventoryReservationPort.class);
        audits = mock(SecurityAuditRecorder.class);
        scopes = mock(WarehouseScopeEvaluator.class);
        when(scopes.evaluate(TENANT, USER, null)).thenReturn(
                new WarehouseScopeAccess(WarehouseScopeMode.ALL, java.util.Set.of()));
        service = new FulfillmentService(
                repository,
                inventory,
                audits,
                scopes,
                Clock.fixed(NOW, ZoneOffset.UTC));
        actor = new FulfillmentService.Actor(TENANT, USER, null, "request-1", "127.0.0.1");
    }

    @Test
    void handoverCreatesShipmentFactAndOutboxOnceAndExactReplayDoesNotMutate() {
        UUID commandId = UUID.fromString("f4600000-0000-4000-8000-000000000040");
        Instant occurredAt = NOW.minusSeconds(30);
        Plan sealed = plan(Status.READY_TO_SHIP, 2, 2, 0, 0, 7,
                line(2, 2, 0, 0),
                new Package(PACKAGE, WAREHOUSE, "PKG-1", PackageStatus.SEALED,
                        new BigDecimal("550.000"), 3, NOW.minusSeconds(60), null,
                        null, null, null,
                        ShopifyPublicationStatus.NOT_PUBLISHED,
                        null, null, null, null,
                        List.of(new PackageItem(LINE, 2))));
        Plan shipped = plan(Status.SHIPPED, 2, 2, 2, 0, 8,
                line(2, 2, 2, 0),
                new Package(PACKAGE, WAREHOUSE, "PKG-1", PackageStatus.HANDED_OVER,
                        new BigDecimal("550.000"), 4, NOW.minusSeconds(60), occurredAt,
                        "SF", "STANDARD", "TRACK-1",
                        ShopifyPublicationStatus.NOT_PUBLISHED,
                        null, null, null, null,
                        List.of(new PackageItem(LINE, 2))));

        when(repository.command(TENANT, commandId)).thenReturn(Optional.empty());
        when(repository.lock(TENANT, PLAN)).thenReturn(Optional.of(sealed));
        when(repository.find(TENANT, PLAN, false)).thenReturn(Optional.of(shipped));

        Plan result = service.handover(
                actor, PLAN, PACKAGE, 7, 3, commandId, new BigDecimal("550.000"),
                occurredAt, "SF", "STANDARD", "TRACK-1");

        assertThat(result.status()).isEqualTo(Status.SHIPPED);
        ArgumentCaptor<ConsumptionCommand> consumption =
                ArgumentCaptor.forClass(ConsumptionCommand.class);
        verify(inventory).consume(consumption.capture());
        assertThat(consumption.getValue().tenantId()).isEqualTo(TENANT);
        assertThat(consumption.getValue().fulfillmentLineId()).isEqualTo(LINE);
        assertThat(consumption.getValue().quantity()).isEqualTo(2);
        verify(repository).handoverPackage(
                eq(TENANT), eq(PLAN), eq(PACKAGE), eq(3L),
                eq(new BigDecimal("550.000")), any(UUID.class), eq(occurredAt),
                eq(commandId.toString()), eq(USER), eq("request-1"), eq("SF"),
                eq("STANDARD"), eq("TRACK-1"), eq(ORDER), eq(SHOP));
        verify(repository).updateLineProgress(TENANT, PLAN, LINE, 2, 2, 2, 0);
        verify(repository).updatePlanState(
                TENANT, PLAN, Status.SHIPPED, PauseState.ACTIVE, null,
                ShortageState.NONE, null, 2, 2, 2, 0, 7);

        ArgumentCaptor<String> fingerprint = ArgumentCaptor.forClass(String.class);
        verify(repository).recordCommand(
                eq(TENANT), eq(commandId), eq("fulfillment_plan"), eq(PLAN),
                eq("HANDOVER"), fingerprint.capture(), eq(8L));

        when(repository.command(TENANT, commandId)).thenReturn(Optional.of(
                new CommandRecord(PLAN, "HANDOVER", fingerprint.getValue(), 8)));
        Plan replay = service.handover(
                actor, PLAN, PACKAGE, 7, 3, commandId, new BigDecimal("550.000"),
                occurredAt, "SF", "STANDARD", "TRACK-1");

        assertThat(replay.status()).isEqualTo(Status.SHIPPED);
        verify(repository, times(1)).handoverPackage(
                any(), any(), any(), anyLong(), any(), any(), any(), anyString(),
                any(), anyString(), anyString(), anyString(), anyString(), any(), any());
        verify(repository, times(1)).recordCommand(
                any(), any(), anyString(), any(), anyString(), anyString(), anyLong());
        verify(inventory, times(1)).consume(any());
    }

    @Test
    void cancellingAfterPartialShipmentCancelsOnlyOpenQuantityAndPreservesShipment() {
        UUID commandId = UUID.fromString("f4600000-0000-4000-8000-000000000041");
        Plan partial = plan(Status.PARTIALLY_SHIPPED, 5, 4, 2, 0, 11,
                line(5, 4, 2, 0));
        Plan completed = plan(Status.PARTIALLY_FULFILLED, 5, 4, 2, 3, 12,
                line(5, 4, 2, 3));

        when(repository.command(TENANT, commandId)).thenReturn(Optional.empty());
        when(repository.lock(TENANT, PLAN)).thenReturn(Optional.of(partial));
        when(repository.find(TENANT, PLAN, false)).thenReturn(Optional.of(completed));

        Plan result = service.cancelOpen(actor, PLAN, 11, commandId, "CUSTOMER_CANCELLED");

        assertThat(result.status()).isEqualTo(Status.PARTIALLY_FULFILLED);
        assertThat(result.shippedQuantity()).isEqualTo(2);
        assertThat(result.cancelledQuantity()).isEqualTo(3);
        verify(repository).updateLineProgress(TENANT, PLAN, LINE, 4, 4, 2, 3);
        verify(repository).updatePlanState(
                TENANT, PLAN, Status.PARTIALLY_FULFILLED, PauseState.ACTIVE, null,
                ShortageState.NONE, null, 4, 4, 2, 3, 11);
        verify(repository).recordCommand(
                eq(TENANT), eq(commandId), eq("fulfillment_plan"), eq(PLAN),
                eq("CANCEL"), anyString(), eq(12L));
        ArgumentCaptor<ReleaseCommand> release =
                ArgumentCaptor.forClass(ReleaseCommand.class);
        verify(inventory).release(release.capture());
        assertThat(release.getValue().quantity()).isEqualTo(3);
        assertThat(release.getValue().fulfillmentLineId()).isEqualTo(LINE);
    }

    @Test
    void correctionAppendsOneProtectedFactAndReversesInventoryWithoutMutatingOriginal() {
        UUID commandId = UUID.fromString(
                "f4600000-0000-4000-8000-000000000042");
        UUID originalEvent = UUID.fromString(
                "f4600000-0000-4000-8000-000000000043");
        Plan handedOver = plan(
                Status.SHIPPED, 2, 2, 2, 0, 8,
                line(2, 2, 2, 0),
                new Package(PACKAGE, WAREHOUSE, "PKG-1",
                        PackageStatus.HANDED_OVER,
                        new BigDecimal("550.000"), 4,
                        NOW.minusSeconds(60), NOW.minusSeconds(30),
                        "SF", "STANDARD", "TRACK-1",
                        ShopifyPublicationStatus.NOT_PUBLISHED,
                        null, null, null, null,
                        List.of(new PackageItem(LINE, 2))));
        Plan corrected = plan(
                Status.PACKING, 2, 2, 0, 0, 9,
                line(2, 2, 0, 0),
                new Package(PACKAGE, WAREHOUSE, "PKG-1",
                        PackageStatus.HANDOVER_CORRECTED,
                        new BigDecimal("550.000"), 5,
                        NOW.minusSeconds(60), NOW.minusSeconds(30),
                        "SF", "STANDARD", "TRACK-1",
                        ShopifyPublicationStatus.NOT_PUBLISHED,
                        null, null, null, null,
                        List.of(new PackageItem(LINE, 2))));

        when(repository.command(TENANT, commandId))
                .thenReturn(Optional.empty());
        when(repository.lock(TENANT, PLAN))
                .thenReturn(Optional.of(handedOver));
        when(repository.handoverEventId(TENANT, PLAN, PACKAGE))
                .thenReturn(Optional.of(originalEvent));
        when(repository.find(TENANT, PLAN, false))
                .thenReturn(Optional.of(corrected));

        Plan result = service.correctHandover(
                actor, PLAN, PACKAGE, 8, 4, commandId,
                NOW.minusSeconds(10), "WAREHOUSE_CORRECTION");

        assertThat(result.status()).isEqualTo(Status.PACKING);
        verify(repository).recordHandoverCorrection(
                eq(TENANT), eq(PLAN), eq(PACKAGE), eq(4L),
                any(UUID.class), eq(originalEvent), eq(NOW.minusSeconds(10)),
                eq(commandId.toString()), eq(USER), eq("request-1"),
                eq("WAREHOUSE_CORRECTION"), eq(ORDER), eq(SHOP));
        ArgumentCaptor<CorrectionCommand> correction =
                ArgumentCaptor.forClass(CorrectionCommand.class);
        verify(inventory).reverseConsumption(correction.capture());
        assertThat(correction.getValue().originalShipmentEventId())
                .isEqualTo(originalEvent);
        assertThat(correction.getValue().quantity()).isEqualTo(2);
        verify(repository, never()).handoverPackage(
                any(), any(), any(), anyLong(), any(), any(), any(), anyString(),
                any(), anyString(), anyString(), anyString(), anyString(), any(), any());
    }

    @Test
    void correctionIsBlockedAfterShopifyPublicationStarts() {
        UUID commandId = UUID.fromString(
                "f4600000-0000-4000-8000-000000000044");
        Plan published = plan(
                Status.SHIPPED, 2, 2, 2, 0, 8,
                line(2, 2, 2, 0),
                new Package(PACKAGE, WAREHOUSE, "PKG-1",
                        PackageStatus.HANDED_OVER,
                        new BigDecimal("550.000"), 4,
                        NOW.minusSeconds(60), NOW.minusSeconds(30),
                        "SF", "STANDARD", "TRACK-1",
                        ShopifyPublicationStatus.PUBLISHED,
                        true, "https://track.example/TRACK-1",
                        "gid://shopify/Fulfillment/50", NOW,
                        List.of(new PackageItem(LINE, 2))));

        when(repository.command(TENANT, commandId))
                .thenReturn(Optional.empty());
        when(repository.lock(TENANT, PLAN))
                .thenReturn(Optional.of(published));

        assertThatThrownBy(() -> service.correctHandover(
                actor, PLAN, PACKAGE, 8, 4, commandId,
                NOW.minusSeconds(10), "WAREHOUSE_CORRECTION"))
                .isInstanceOf(FulfillmentExceptions.Conflict.class)
                .extracting("reason")
                .isEqualTo("handover_correction_not_allowed");

        verify(repository, never()).handoverEventId(any(), any(), any());
        verify(inventory, never()).reverseConsumption(any());
    }

    @Test
    void selectedEmptyScopeMakesReadAndCommandsIndistinguishableFromNotFound() {
        Plan allocated = plan(
                Status.ALLOCATED, 2, 0, 0, 0, 1,
                line(2, 0, 0, 0));
        when(repository.find(TENANT, PLAN, false))
                .thenReturn(Optional.of(allocated));
        when(repository.lock(TENANT, PLAN))
                .thenReturn(Optional.of(allocated));
        when(scopes.evaluate(TENANT, USER, null)).thenReturn(
                new WarehouseScopeAccess(
                        WarehouseScopeMode.SELECTED, java.util.Set.of()));
        doThrow(new ResourceNotFoundException("Warehouse was not found"))
                .when(scopes).requireAllVisible(any(), eq(java.util.Set.of(WAREHOUSE)));

        assertThatThrownBy(() -> service.get(actor, PLAN))
                .isInstanceOf(FulfillmentExceptions.NotFound.class);
        assertThatThrownBy(() -> service.pause(
                actor, PLAN, 1, UUID.randomUUID(), "MANUAL_REVIEW"))
                .isInstanceOf(FulfillmentExceptions.NotFound.class);
    }

    private static Plan plan(Status status, int planned, int picked, int shipped,
            int cancelled, long version, Line line, Package... packages) {
        return new Plan(
                PLAN, TENANT, ORDER, SHOP, 1, "ORDER-1", status, PauseState.ACTIVE,
                null, ShortageState.NONE, null, planned, picked, picked, shipped,
                cancelled, version, NOW.minusSeconds(600), NOW, null,
                List.of(line), List.of(packages));
    }

    private static Line line(int planned, int picked, int shipped, int cancelled) {
        return new Line(
                LINE, ORDER_LINE, (short) 0, SKU, WAREHOUSE, null,
                planned, picked, picked, shipped, cancelled, "LINE-1",
                "SKU-1", "商品一", "reservation-1", null);
    }
}
