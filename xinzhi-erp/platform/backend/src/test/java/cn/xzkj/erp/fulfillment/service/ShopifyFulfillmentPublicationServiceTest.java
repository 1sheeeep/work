package cn.xzkj.erp.fulfillment.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;

import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.Line;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.Package;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.PackageItem;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.PackageStatus;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.PauseState;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.Plan;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.ShopifyPublicationStatus;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.ShortageState;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.Status;
import cn.xzkj.erp.fulfillment.repository.ShopifyFulfillmentPublicationRepository;
import cn.xzkj.erp.fulfillment.repository.ShopifyFulfillmentPublicationRepository.PublicationInput;
import cn.xzkj.erp.fulfillment.repository.ShopifyFulfillmentPublicationRepository.PublicationLine;
import cn.xzkj.erp.fulfillment.repository.ShopifyFulfillmentPublicationRepository.Reservation;
import cn.xzkj.erp.fulfillment.service.FulfillmentExceptions.Conflict;
import cn.xzkj.erp.fulfillment.service.FulfillmentService.Actor;
import cn.xzkj.erp.fulfillment.service.ShopifyFulfillmentPublicationService.PublishCommand;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ChannelSnapshot;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.Connection;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectionStatus;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectorMode;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.FulfillmentPublishRequest;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.FulfillmentPublishResult;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyPermissionScope;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyScopeCoverageStatus;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.TrackingInfo;
import cn.xzkj.erp.platform.connector.ConnectorUnavailableException;

class ShopifyFulfillmentPublicationServiceTest {

    private static final UUID TENANT = UUID.fromString(
            "f5000000-0000-4000-8000-000000000001");
    private static final UUID USER = UUID.fromString(
            "f5000000-0000-4000-8000-000000000002");
    private static final UUID PLAN = UUID.fromString(
            "f5000000-0000-4000-8000-000000000003");
    private static final UUID PACKAGE = UUID.fromString(
            "f5000000-0000-4000-8000-000000000004");
    private static final UUID ORDER = UUID.fromString(
            "f5000000-0000-4000-8000-000000000005");
    private static final UUID SHOP = UUID.fromString(
            "f5000000-0000-4000-8000-000000000006");
    private static final UUID LINE = UUID.fromString(
            "f5000000-0000-4000-8000-000000000007");
    private static final UUID ORDER_LINE = UUID.fromString(
            "f5000000-0000-4000-8000-000000000008");
    private static final UUID SKU = UUID.fromString(
            "f5000000-0000-4000-8000-000000000009");
    private static final UUID WAREHOUSE = UUID.fromString(
            "f5000000-0000-4000-8000-000000000010");
    private static final UUID PUBLICATION = UUID.fromString(
            "f5000000-0000-4000-8000-000000000011");
    private static final Instant NOW = Instant.parse(
            "2026-07-31T10:00:00Z");

    private FulfillmentService fulfillments;
    private ShopifyFulfillmentPublicationRepository publications;
    private ChannelConnectorGateway connector;
    private ShopifyFulfillmentPublicationFinalizer finalizer;
    private ShopifyFulfillmentPublicationService service;
    private Actor actor;

    @BeforeEach
    void setUp() {
        fulfillments = mock(FulfillmentService.class);
        publications = mock(
                ShopifyFulfillmentPublicationRepository.class);
        connector = mock(ChannelConnectorGateway.class);
        finalizer = mock(ShopifyFulfillmentPublicationFinalizer.class);
        service = new ShopifyFulfillmentPublicationService(
                fulfillments, publications, connector, finalizer);
        actor = new Actor(
                TENANT, USER, null, "request-1", "127.0.0.1");
        when(fulfillments.get(actor, PLAN)).thenReturn(
                plan(ShopifyPublicationStatus.NOT_PUBLISHED));
        when(publications.findInput(TENANT, PLAN, PACKAGE))
                .thenReturn(java.util.Optional.of(input()));
        when(connector.snapshot(TENANT, SHOP))
                .thenReturn(connectedSnapshot());
        when(publications.reserve(
                eq(TENANT), eq(PLAN), eq(PACKAGE),
                eq("web.fulfillment-1"), anyString(), eq(true), any()))
                .thenReturn(new Reservation(
                        PUBLICATION, false, false,
                        null, null, null));
    }

    @Test
    void publishesImmutableHandedOverPackageAndRecordsSafeAudit() {
        when(fulfillments.get(actor, PLAN)).thenReturn(
                plan(ShopifyPublicationStatus.NOT_PUBLISHED),
                plan(ShopifyPublicationStatus.PUBLISHED));
        when(connector.publishShopifyFulfillment(
                eq(TENANT), eq(SHOP), any()))
                .thenReturn(new FulfillmentPublishResult(
                        List.of("gid://shopify/Fulfillment/50"),
                        new TrackingInfo(
                                "UPS", "1Z123",
                                "https://track.example/1Z123"),
                        false, NOW));

        var result = service.publish(
                actor, PLAN, PACKAGE,
                new PublishCommand(
                        "web.fulfillment-1", true,
                        "https://track.example/1Z123"));

        assertThat(result.externalFulfillmentRef())
                .isEqualTo("gid://shopify/Fulfillment/50");
        assertThat(result.replayed()).isFalse();
        ArgumentCaptor<FulfillmentPublishRequest> request =
                ArgumentCaptor.forClass(FulfillmentPublishRequest.class);
        verify(connector).publishShopifyFulfillment(
                eq(TENANT), eq(SHOP), request.capture());
        assertThat(request.getValue().externalOrderRef())
                .isEqualTo("gid://shopify/Order/1");
        assertThat(request.getValue().tracking().number())
                .isEqualTo("1Z123");
        assertThat(request.getValue().lines().getFirst()
                .externalOrderLineRef())
                .isEqualTo("gid://shopify/LineItem/40");
        verify(finalizer).finalizePublished(
                eq(actor), eq(PLAN), eq(PACKAGE), eq(PUBLICATION),
                anyString(), eq("gid://shopify/Fulfillment/50"),
                eq(true), eq(false));
    }

    @Test
    void exactPublishedReservationReplaysWithoutCallingConnector() {
        when(publications.reserve(
                eq(TENANT), eq(PLAN), eq(PACKAGE),
                eq("web.fulfillment-1"), anyString(), eq(true), any()))
                .thenReturn(new Reservation(
                        PUBLICATION, true, true,
                        "gid://shopify/Fulfillment/50", true, NOW));

        var result = service.publish(
                actor, PLAN, PACKAGE,
                new PublishCommand(
                        "web.fulfillment-1", true, null));

        assertThat(result.replayed()).isTrue();
        assertThat(result.recoveredFromShopify()).isTrue();
        verify(connector, never()).publishShopifyFulfillment(
                any(), any(), any());
    }

    @Test
    void missingFulfillmentScopesFailsBeforeReservationOrMutation() {
        when(connector.snapshot(TENANT, SHOP)).thenReturn(
                new ChannelSnapshot(
                        ConnectorMode.XZ_ERP_APP,
                        new Connection(
                                ConnectionStatus.CONNECTED,
                                null, null, NOW),
                        List.of(new ShopifyPermissionScope(
                                "read_orders", "orders",
                                ShopifyScopeCoverageStatus.GRANTED)),
                        List.of()));

        assertThatThrownBy(() -> service.publish(
                actor, PLAN, PACKAGE,
                new PublishCommand(
                        "web.fulfillment-1", true, null)))
                .isInstanceOf(Conflict.class)
                .extracting("reason")
                .isEqualTo("shopify_fulfillment_scope_missing");

        verify(publications, never()).reserve(
                any(), any(), any(), anyString(), anyString(),
                any(Boolean.class), any());
        verify(connector, never()).publishShopifyFulfillment(
                any(), any(), any());
    }

    @ParameterizedTest
    @ValueSource(strings = {"assigned", "third_party"})
    void unsupportedFulfillmentScopeTypesFailBeforeReservationOrMutation(
            String scopeType) {
        when(connector.snapshot(TENANT, SHOP)).thenReturn(
                new ChannelSnapshot(
                        ConnectorMode.XZ_ERP_APP,
                        new Connection(
                                ConnectionStatus.CONNECTED,
                                null, null, NOW),
                        List.of(
                                new ShopifyPermissionScope(
                                        "read_" + scopeType
                                                + "_fulfillment_orders",
                                        "read", ShopifyScopeCoverageStatus.GRANTED),
                                new ShopifyPermissionScope(
                                        "write_" + scopeType
                                                + "_fulfillment_orders",
                                        "write", ShopifyScopeCoverageStatus.GRANTED)),
                        List.of()));

        assertThatThrownBy(() -> service.publish(
                actor, PLAN, PACKAGE,
                new PublishCommand(
                        "web.fulfillment-1", true, null)))
                .isInstanceOf(Conflict.class)
                .extracting("reason")
                .isEqualTo("shopify_fulfillment_scope_missing");

        verify(publications, never()).reserve(
                any(), any(), any(), anyString(), anyString(),
                any(Boolean.class), any());
        verify(connector, never()).publishShopifyFulfillment(
                any(), any(), any());
    }

    @ParameterizedTest
    @ValueSource(strings = {"CANCELED", "TIMEOUT", "CONNECTOR_UNAVAILABLE"})
    void ambiguousConnectorFailureIsMarkedUncertainAndFailsClosed(
            String code) {
        when(connector.publishShopifyFulfillment(
                eq(TENANT), eq(SHOP), any()))
                .thenThrow(new ConnectorUnavailableException(
                        code, !"CANCELED".equals(code), "correlation-1"));

        assertThatThrownBy(() -> service.publish(
                actor, PLAN, PACKAGE,
                new PublishCommand(
                        "web.fulfillment-1", true, null)))
                .isInstanceOf(Conflict.class)
                .extracting("reason")
                .isEqualTo("shopify_fulfillment_uncertain");

        verify(publications).markUncertain(
                eq(TENANT), eq(PUBLICATION), anyString(),
                eq("SHOPIFY_FULFILLMENT_UNCERTAIN"));
        verify(publications, never()).markPublished(
                any(), any(), anyString(), anyString(), any(Boolean.class));
    }

    @Test
    void definitiveInvalidRequestReleasesReservationWithoutUncertainState() {
        when(connector.publishShopifyFulfillment(
                eq(TENANT), eq(SHOP), any()))
                .thenThrow(new ConnectorUnavailableException(
                        "INVALID_REQUEST", false, "correlation-1"));

        assertThatThrownBy(() -> service.publish(
                actor, PLAN, PACKAGE,
                new PublishCommand(
                        "web.fulfillment-1", true, null)))
                .isInstanceOf(Conflict.class)
                .extracting("reason")
                .isEqualTo("shopify_fulfillment_rejected");

        verify(publications).discardFailedReservation(
                eq(TENANT), eq(PUBLICATION), anyString());
        verify(publications, never()).markUncertain(
                any(), any(), anyString(), anyString());
    }

    @Test
    void definitiveForbiddenReleasesReservationWithoutUncertainState() {
        when(connector.publishShopifyFulfillment(
                eq(TENANT), eq(SHOP), any()))
                .thenThrow(new ConnectorUnavailableException(
                        "FORBIDDEN", false, "correlation-1"));

        assertThatThrownBy(() -> service.publish(
                actor, PLAN, PACKAGE,
                new PublishCommand(
                        "web.fulfillment-1", true, null)))
                .isInstanceOf(Conflict.class)
                .extracting("reason")
                .isEqualTo("shopify_fulfillment_scope_missing");

        verify(publications).discardFailedReservation(
                eq(TENANT), eq(PUBLICATION), anyString());
        verify(publications, never()).markUncertain(
                any(), any(), anyString(), anyString());
    }

    @Test
    void failedDefinitiveReleaseFallsBackToUncertainState() {
        when(connector.publishShopifyFulfillment(
                eq(TENANT), eq(SHOP), any()))
                .thenThrow(new ConnectorUnavailableException(
                        "INVALID_REQUEST", false, "correlation-1"));
        org.mockito.Mockito.doThrow(
                new IllegalStateException("publication_state_conflict"))
                .when(publications).discardFailedReservation(
                        eq(TENANT), eq(PUBLICATION), anyString());

        assertThatThrownBy(() -> service.publish(
                actor, PLAN, PACKAGE,
                new PublishCommand(
                        "web.fulfillment-1", true, null)))
                .isInstanceOf(Conflict.class)
                .extracting("reason")
                .isEqualTo("shopify_fulfillment_uncertain");

        verify(publications).markUncertain(
                eq(TENANT), eq(PUBLICATION), anyString(),
                eq("SHOPIFY_FULFILLMENT_UNCERTAIN"));
    }

    @Test
    void existingReservationDefinitiveFailurePreservesRecoveryHistory() {
        when(publications.reserve(
                eq(TENANT), eq(PLAN), eq(PACKAGE),
                eq("web.fulfillment-1"), anyString(), eq(true), any()))
                .thenReturn(new Reservation(
                        PUBLICATION, true, false,
                        null, null, null));
        when(connector.publishShopifyFulfillment(
                eq(TENANT), eq(SHOP), any()))
                .thenThrow(new ConnectorUnavailableException(
                        "INVALID_REQUEST", false, "correlation-1"));

        assertThatThrownBy(() -> service.publish(
                actor, PLAN, PACKAGE,
                new PublishCommand(
                        "web.fulfillment-1", true, null)))
                .isInstanceOf(Conflict.class)
                .extracting("reason")
                .isEqualTo("shopify_fulfillment_uncertain");

        verify(publications, never()).discardFailedReservation(
                any(), any(), anyString());
        verify(publications).markUncertain(
                eq(TENANT), eq(PUBLICATION), anyString(),
                eq("SHOPIFY_FULFILLMENT_UNCERTAIN"));
    }

    @Test
    void localFinalizationFailureDoesNotOverwriteRecoverablePublishingState() {
        when(fulfillments.get(actor, PLAN)).thenReturn(
                plan(ShopifyPublicationStatus.NOT_PUBLISHED),
                plan(ShopifyPublicationStatus.PUBLISHED));
        when(connector.publishShopifyFulfillment(
                eq(TENANT), eq(SHOP), any()))
                .thenReturn(new FulfillmentPublishResult(
                        List.of("gid://shopify/Fulfillment/50"),
                        new TrackingInfo("UPS", "1Z123", null),
                        false, NOW));
        org.mockito.Mockito.doThrow(
                new IllegalStateException("finalization unavailable"))
                .when(finalizer).finalizePublished(
                        eq(actor), eq(PLAN), eq(PACKAGE), eq(PUBLICATION),
                        anyString(), eq("gid://shopify/Fulfillment/50"),
                        eq(true), eq(false));

        assertThatThrownBy(() -> service.publish(
                actor, PLAN, PACKAGE,
                new PublishCommand(
                        "web.fulfillment-1", true, null)))
                .isInstanceOf(Conflict.class)
                .extracting("reason")
                .isEqualTo("shopify_fulfillment_uncertain");

        verify(publications, never()).markUncertain(
                any(), any(), anyString(), anyString());
    }

    @Test
    void rejectsTrackingUrlCredentialsBeforeReservation() {
        assertThatThrownBy(() -> service.publish(
                actor, PLAN, PACKAGE,
                new PublishCommand(
                        "web.fulfillment-1", true,
                        "https://user:secret@track.example/1Z123")))
                .isInstanceOf(FulfillmentExceptions.Invalid.class);

        verify(publications, never()).reserve(
                any(), any(), any(), anyString(), anyString(),
                any(Boolean.class), any());
    }

    private static PublicationInput input() {
        return new PublicationInput(
                PLAN, PACKAGE, ORDER, SHOP,
                "gid://shopify/Order/1", "PKG-1", "UPS", "GROUND",
                "1Z123", NOW.minusSeconds(60),
                List.of(new PublicationLine(
                        "gid://shopify/LineItem/40", 2)));
    }

    private static Plan plan(ShopifyPublicationStatus publicationStatus) {
        return new Plan(
                PLAN, TENANT, ORDER, SHOP, 4,
                "gid://shopify/Order/1", Status.SHIPPED,
                PauseState.ACTIVE, null, ShortageState.NONE, null,
                2, 2, 2, 2, 0, 8,
                NOW.minusSeconds(600), NOW, NOW,
                List.of(new Line(
                        LINE, ORDER_LINE, (short) 0, SKU,
                        WAREHOUSE, null, 2, 2, 2, 2, 0,
                        "gid://shopify/LineItem/40", "SKU-1", "Widget",
                        "inventory-ref", null)),
                List.of(new Package(
                        PACKAGE, WAREHOUSE, "PKG-1",
                        PackageStatus.HANDED_OVER,
                        new BigDecimal("500.000"), 4,
                        NOW.minusSeconds(120), NOW.minusSeconds(60),
                        "UPS", "GROUND", "1Z123",
                        publicationStatus,
                        publicationStatus == ShopifyPublicationStatus.NOT_PUBLISHED
                                ? null : true,
                        publicationStatus == ShopifyPublicationStatus.NOT_PUBLISHED
                                ? null : "https://track.example/1Z123",
                        publicationStatus == ShopifyPublicationStatus.PUBLISHED
                                ? "gid://shopify/Fulfillment/50" : null,
                        publicationStatus == ShopifyPublicationStatus.PUBLISHED
                                ? NOW : null,
                        List.of(new PackageItem(LINE, 2)))));
    }

    private static ChannelSnapshot connectedSnapshot() {
        return new ChannelSnapshot(
                ConnectorMode.XZ_ERP_APP,
                new Connection(
                        ConnectionStatus.CONNECTED, null, null, NOW),
                ChannelConnectorGateway.plannedShopifyScopes(
                        List.of(
                                "write_merchant_managed_fulfillment_orders"),
                        true),
                List.of());
    }
}
