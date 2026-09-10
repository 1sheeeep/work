package cn.xzkj.erp.inventory.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.inventory.repository.ShopifyInventoryPublicationRepository;
import cn.xzkj.erp.inventory.repository.ShopifyInventoryPublicationRepository.ExceptionView;
import cn.xzkj.erp.inventory.repository.ShopifyInventoryPublicationRepository.Publication;
import cn.xzkj.erp.inventory.repository.ShopifyInventoryPublicationRepository.Reservation;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.service.ShopifyAuthorizationConflictException;

@ExtendWith(MockitoExtension.class)
class ShopifyInventoryPublicationServiceTest {

    @Mock private ShopifyInventoryPublicationRepository publications;
    @Mock private ChannelConnectorGateway connector;
    @Mock private SecurityAuditRecorder auditRecorder;

    private ShopifyInventoryPublicationService service;

    @BeforeEach
    void setUp() {
        service = new ShopifyInventoryPublicationService(
                publications, connector, auditRecorder);
    }

    @Test
    void queuesVersionedPublicationAndAuditsCreation() {
        Fixture fixture = fixture();
        allowInventoryWrite(fixture);
        Publication publication = publication(fixture);
        when(publications.enqueue(
                eq(fixture.tenantId()), eq(fixture.shopId()), eq(fixture.balanceId()),
                eq(4L), eq(7), eq("inventory-command-1"), anyString(),
                eq(fixture.actor().userId()), isNull(),
                eq("request-1"), eq("127.0.0.1")))
                .thenReturn(new Reservation(publication, true));

        var result = service.enqueue(
                fixture.actor(), fixture.shopId(), fixture.balanceId(),
                4, 7, "inventory-command-1");

        assertThat(result.replayed()).isFalse();
        assertThat(result.publication().targetAvailable()).isEqualTo(9);
        ArgumentCaptor<SecurityAuditEvent> audit =
                ArgumentCaptor.forClass(SecurityAuditEvent.class);
        verify(auditRecorder).recordAtomically(audit.capture());
        assertThat(audit.getValue().action())
                .isEqualTo("inventory.shopify.publish.queued");
        assertThat(audit.getValue().details())
                .doesNotContainKey("idempotencyKey");
    }

    @Test
    void idempotentReplayDoesNotCreateDuplicateSuccessAudit() {
        Fixture fixture = fixture();
        allowInventoryWrite(fixture);
        when(publications.enqueue(
                eq(fixture.tenantId()), eq(fixture.shopId()), eq(fixture.balanceId()),
                eq(4L), eq(7), eq("inventory-command-1"), anyString(),
                eq(fixture.actor().userId()), isNull(),
                eq("request-1"), eq("127.0.0.1")))
                .thenReturn(new Reservation(publication(fixture), false));

        var result = service.enqueue(
                fixture.actor(), fixture.shopId(), fixture.balanceId(),
                4, 7, "inventory-command-1");

        assertThat(result.replayed()).isTrue();
        verify(auditRecorder, never()).recordAtomically(any());
    }

    @Test
    void reportsMissingShopifyInventoryWriteScopeWithoutQueuing() {
        Fixture fixture = fixture();
        when(connector.snapshot(fixture.tenantId(), fixture.shopId()))
                .thenReturn(new ChannelConnectorGateway.ChannelSnapshot(
                        ChannelConnectorGateway.ConnectorMode.XZ_ERP_APP,
                        new ChannelConnectorGateway.Connection(
                                ChannelConnectorGateway.ConnectionStatus.CONNECTED,
                                null, null, Instant.now()),
                        List.of(new ChannelConnectorGateway.ShopifyPermissionScope(
                                "write_inventory", "Inventory",
                                ChannelConnectorGateway.ShopifyScopeCoverageStatus.MISSING)),
                        List.of()));

        org.assertj.core.api.Assertions.assertThatThrownBy(() -> service.enqueue(
                        fixture.actor(), fixture.shopId(), fixture.balanceId(),
                        4, 7, "inventory-command-1"))
                .isInstanceOf(ShopifyAuthorizationConflictException.class)
                .satisfies(error -> assertThat(
                        ((ShopifyAuthorizationConflictException) error).details())
                        .containsEntry("reason", "shopify_scope_missing")
                        .containsEntry("scope", "write_inventory"));
        verify(publications, never()).enqueue(
                any(), any(), any(),
                org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.anyInt(),
                anyString(), anyString(), any(), any(), any(), any());
    }

    @Test
    void returnsLatestTenantScopedPublicationForShopAndBalance() {
        Fixture fixture = fixture();
        Publication publication = publication(fixture);
        when(publications.findLatest(
                fixture.tenantId(), fixture.shopId(), fixture.balanceId()))
                .thenReturn(java.util.Optional.of(publication));

        assertThat(service.getLatest(
                fixture.actor(), fixture.shopId(), fixture.balanceId()))
                .isSameAs(publication);
        verify(publications).findLatest(
                fixture.tenantId(), fixture.shopId(), fixture.balanceId());
    }

    @Test
    void listsTenantScopedExceptionsWithBoundedFilters() {
        Fixture fixture = fixture();
        Instant from = Instant.parse("2026-08-01T00:00:00Z");
        Instant before = Instant.parse("2026-08-07T00:00:00Z");
        ExceptionView exception = new ExceptionView(
                UUID.randomUUID(), fixture.shopId(), "Flagship",
                "flagship.myshopify.com", fixture.balanceId(),
                UUID.randomUUID(), "SKU_100", "Test product",
                UUID.randomUUID(), "WH_NORTH", "North warehouse",
                7, 9, "STALE", 1, "SHOPIFY_INVENTORY_STALE",
                from, before.minusSeconds(10), before.minusSeconds(10));
        when(publications.findExceptions(
                fixture.tenantId(), fixture.shopId(), from, before,
                "SKU_100", 100)).thenReturn(List.of(exception));

        assertThat(service.listExceptions(
                fixture.actor(), fixture.shopId(), from, before,
                " SKU_100 ", 100)).containsExactly(exception);
        verify(publications).findExceptions(
                fixture.tenantId(), fixture.shopId(), from, before,
                "SKU_100", 100);
    }

    @Test
    void rejectsInvalidExceptionDateRange() {
        Fixture fixture = fixture();
        Instant point = Instant.parse("2026-08-06T00:00:00Z");

        org.assertj.core.api.Assertions.assertThatThrownBy(() ->
                service.listExceptions(
                        fixture.actor(), null, point, point, null, 50))
                .isInstanceOf(IllegalArgumentException.class);
        verify(publications, never()).findExceptions(
                any(), any(), any(), any(), any(),
                org.mockito.ArgumentMatchers.anyInt());
    }

    private void allowInventoryWrite(Fixture fixture) {
        when(connector.snapshot(fixture.tenantId(), fixture.shopId()))
                .thenReturn(new ChannelConnectorGateway.ChannelSnapshot(
                        ChannelConnectorGateway.ConnectorMode.XZ_ERP_APP,
                        new ChannelConnectorGateway.Connection(
                                ChannelConnectorGateway.ConnectionStatus.CONNECTED,
                                null, null, Instant.now()),
                        List.of(new ChannelConnectorGateway.ShopifyPermissionScope(
                                "write_inventory", "Inventory",
                                ChannelConnectorGateway.ShopifyScopeCoverageStatus.GRANTED)),
                        List.of()));
    }

    private static Publication publication(Fixture fixture) {
        return new Publication(
                UUID.randomUUID(), fixture.tenantId(), fixture.shopId(),
                fixture.balanceId(), UUID.randomUUID(), UUID.randomUUID(),
                "gid://shopify/InventoryItem/200",
                "gid://shopify/Location/100", 4, 7, 9,
                "inventory-command-1", "a".repeat(64), "QUEUED", 0,
                null, fixture.actor().userId(), null,
                "request-1", "127.0.0.1");
    }

    private static Fixture fixture() {
        UUID tenantId = UUID.randomUUID();
        return new Fixture(
                tenantId, UUID.randomUUID(), UUID.randomUUID(),
                new InventoryActor(
                        tenantId, UUID.randomUUID(), null,
                        "request-1", "127.0.0.1"));
    }

    private record Fixture(
            UUID tenantId, UUID shopId, UUID balanceId,
            InventoryActor actor) {
    }
}
