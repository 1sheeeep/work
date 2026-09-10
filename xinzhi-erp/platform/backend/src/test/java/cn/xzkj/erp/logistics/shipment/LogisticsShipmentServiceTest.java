package cn.xzkj.erp.logistics.shipment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.Plan;
import cn.xzkj.erp.fulfillment.service.FulfillmentExceptions.Conflict;
import cn.xzkj.erp.fulfillment.service.FulfillmentService;
import cn.xzkj.erp.fulfillment.service.FulfillmentService.Actor;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderOperations;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderOperations.CreateResult;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderOperations.Item;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderOperations.OperationException;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderOperations.TrackingResult;
import cn.xzkj.erp.logistics.shipment.LogisticsShipmentRepository.ChannelSelection;
import cn.xzkj.erp.logistics.shipment.LogisticsShipmentRepository.ShipmentSnapshot;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class LogisticsShipmentServiceTest {
    private LogisticsShipmentRepository repository;
    private LogisticsShipmentStateService state;
    private LogisticsProviderOperations providers;
    private FulfillmentService fulfillment;
    private LogisticsShipmentService service;
    private Actor actor;
    private UUID planId;
    private UUID packageId;
    private UUID authorizationId;
    private UUID channelId;
    private Plan plan;

    @BeforeEach
    void setUp() {
        repository = mock(LogisticsShipmentRepository.class);
        state = mock(LogisticsShipmentStateService.class);
        providers = mock(LogisticsProviderOperations.class);
        fulfillment = mock(FulfillmentService.class);
        service = new LogisticsShipmentService(
                repository, state, providers, fulfillment);
        actor = new Actor(UUID.randomUUID(), UUID.randomUUID(), null,
                "test-request", "127.0.0.1");
        planId = UUID.randomUUID();
        packageId = UUID.randomUUID();
        authorizationId = UUID.randomUUID();
        channelId = UUID.randomUUID();
        plan = mock(Plan.class);
        when(fulfillment.get(actor, planId)).thenReturn(plan);
    }

    @Test
    void booksProviderWaybillWithStableClientReference() {
        ShipmentSnapshot shipment = shipment("NOT_REQUESTED", null);
        when(repository.snapshot(actor.tenantId(), planId, packageId))
                .thenReturn(shipment);
        when(repository.channel(actor.tenantId(), authorizationId, channelId))
                .thenReturn(new ChannelSelection(
                        "HUALEI", "US-01", "美国专线"));
        when(state.claim(actor.tenantId(), planId, packageId, 4,
                authorizationId, channelId, "HUALEI",
                "ERP-" + packageId.toString().replace("-", "").toUpperCase(),
                "web.booking.test")).thenReturn(true);
        CreateResult created = new CreateResult(
                "ORDER-1", "TRACK-1", "https://label.example/1.pdf",
                "IN_TRANSIT", "accepted");
        when(providers.create(any(), any(), any(), any())).thenReturn(created);

        Plan result = service.book(actor, planId, packageId, 4,
                authorizationId, channelId, "web.booking.test");

        assertThat(result).isSameAs(plan);
        verify(state).complete(actor.tenantId(), packageId,
                "web.booking.test", created);
    }

    @Test
    void marksUnknownProviderCreateResultForSafeReconciliation() {
        ShipmentSnapshot shipment = shipment("NOT_REQUESTED", null);
        when(repository.snapshot(actor.tenantId(), planId, packageId))
                .thenReturn(shipment);
        when(repository.channel(actor.tenantId(), authorizationId, channelId))
                .thenReturn(new ChannelSelection(
                        "HUALEI", "US-01", "美国专线"));
        when(state.claim(any(), any(), any(), anyLong(), any(), any(),
                any(), any(), any())).thenReturn(true);
        when(providers.create(any(), any(), any(), any())).thenThrow(
                new OperationException("PROVIDER_CREATE_UNAVAILABLE", false));

        assertThatThrownBy(() -> service.book(actor, planId, packageId, 4,
                authorizationId, channelId, "web.booking.test"))
                .isInstanceOf(Conflict.class);
        verify(state).fail(actor.tenantId(), packageId, "web.booking.test",
                false, "PROVIDER_CREATE_UNAVAILABLE");
    }

    @Test
    void syncsTrackingAndWritesTheProviderResultThroughStateService() {
        ShipmentSnapshot shipment = shipment("BOOKED", "TRACK-1");
        TrackingResult tracking = new TrackingResult(
                "TRACK-1", null, "IN_TRANSIT", "transit",
                "包裹运输中", List.of());
        when(repository.snapshot(actor.tenantId(), planId, packageId))
                .thenReturn(shipment);
        when(providers.track(actor.tenantId(), authorizationId, channelId,
                shipment.clientReference(), shipment.providerOrderReference(),
                shipment.trackingReference())).thenReturn(tracking);

        assertThat(service.sync(actor, planId, packageId)).isSameAs(plan);
        verify(state).recordTracking(shipment, tracking);
    }

    @Test
    void savesLocalHandoverEvenWhenProviderConfirmationNeedsRetry() {
        ShipmentSnapshot shipment = shipment("BOOKED", "TRACK-1");
        when(repository.snapshot(actor.tenantId(), planId, packageId))
                .thenReturn(shipment);
        when(repository.channel(actor.tenantId(), authorizationId, channelId))
                .thenReturn(new ChannelSelection(
                        "HUALEI", "US-01", "美国专线"));
        when(fulfillment.handover(any(), any(), any(), anyLong(),
                anyLong(), any(), any(), any(), any(), any()))
                .thenReturn(plan);
        org.mockito.Mockito.doThrow(new OperationException(
                "PROVIDER_HANDOVER_UNAVAILABLE", false))
                .when(providers).confirmHandover(any(), any(), any(),
                        any(), any(), any());

        Plan result = service.handover(actor, planId, packageId,
                8, 4, UUID.randomUUID(), Instant.parse("2026-08-14T01:00:00Z"));

        assertThat(result).isSameAs(plan);
        verify(state).providerHandover(shipment, true,
                "PROVIDER_HANDOVER_UNAVAILABLE");
        verify(state, never()).syncFailed(any(), any());
    }

    private ShipmentSnapshot shipment(String bookingStatus,
            String trackingReference) {
        return new ShipmentSnapshot(
                actor.tenantId(), planId, packageId, UUID.randomUUID(),
                "#1001", "SEALED", "PASSED", 1200, 4,
                authorizationId, channelId, "HUALEI",
                "ERP-" + packageId.toString().replace("-", "").toUpperCase(),
                "ORDER-1", trackingReference,
                "https://label.example/1.pdf", bookingStatus,
                trackingReference == null ? null : "CREATED", null,
                "web.booking.test", null, null, false,
                "Ada Lovelace", "Example Ltd", "+1 555 0100",
                "ada@example.com", "1 Main Street", null,
                "San Francisco", "CA", "94105", "US", "USD",
                List.of(new Item("SKU-1", "T-shirt", 2, 1250, "USD")));
    }
}
