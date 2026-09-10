package cn.xzkj.erp.order.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ChannelSnapshot;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.Connection;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectionStatus;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectorMode;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.Money;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.MoneyBag;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ReturnDecision;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ReturnDecisionRequest;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ReturnDecisionResult;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ReturnRefundLineSelection;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ReturnRefundPreview;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ReturnRefundPreviewRequest;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ReturnRefundPreviewState;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ReturnRefundProcessOutcome;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ReturnRefundProcessRequest;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ReturnRefundProcessResult;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyPermissionScope;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyScopeCoverageStatus;
import cn.xzkj.erp.platform.service.ShopifyAuthorizationConflictException;

class OrderShopifyAfterSalesServiceTest {

    private static final UUID TENANT =
            UUID.fromString("fa000000-0000-4000-8000-000000000001");
    private static final UUID USER =
            UUID.fromString("fa000000-0000-4000-8000-000000000002");
    private static final UUID SHOP =
            UUID.fromString("fa000000-0000-4000-8000-000000000003");
    private static final String RETURN = "gid://shopify/Return/10";
    private static final String RETURN_LINE =
            "gid://shopify/ReturnLineItem/20";
    private static final Instant NOW = Instant.parse("2026-08-15T08:00:00Z");

    private ChannelConnectorGateway connector;
    private SecurityAuditRecorder audit;
    private OrderShopifyAfterSalesService service;
    private OrderActor actor;

    @BeforeEach
    void setUp() {
        connector = mock(ChannelConnectorGateway.class);
        audit = mock(SecurityAuditRecorder.class);
        service = new OrderShopifyAfterSalesService(connector, audit);
        actor = new OrderActor(TENANT, USER, null, "request-1", "127.0.0.1");
    }

    @Test
    void rejectsReturnWriteWhenWriteReturnsWasNotGranted() {
        when(connector.snapshot(TENANT, SHOP)).thenReturn(snapshot(
                "read_orders", "read_returns"));

        assertThatThrownBy(() -> service.decideReturn(actor, SHOP,
                new ReturnDecisionRequest(
                        RETURN, ReturnDecision.APPROVE, null, null,
                        true, "return.approve-10")))
                .isInstanceOf(ShopifyAuthorizationConflictException.class);

        verify(connector, never()).decideShopifyReturn(any(), any(), any());
        verify(audit, never()).recordAtomically(any());
    }

    @Test
    void rejectsAConnectorReturnPageThatExceedsTheRequestedLimit() {
        when(connector.snapshot(TENANT, SHOP)).thenReturn(snapshot(
                "read_orders", "read_returns"));
        var returns = List.of(
                mock(ChannelConnectorGateway.ShopifyReturn.class),
                mock(ChannelConnectorGateway.ShopifyReturn.class));
        when(connector.fetchShopifyReturnCatalog(eq(TENANT), eq(SHOP), any()))
                .thenReturn(new ChannelConnectorGateway.ReturnCatalogPage(
                        ChannelConnectorGateway.ConnectorMode.XZ_ERP_APP,
                        ConnectionStatus.CONNECTED,
                        null,
                        false,
                        NOW,
                        returns));

        assertThatThrownBy(() -> service.returns(
                TENANT, SHOP, 1, null, null))
                .isInstanceOf(cn.xzkj.erp.platform.service.ConflictException.class)
                .hasMessage("Shopify return catalog is unavailable");
    }

    @Test
    void approvesReturnAndWritesSecurityAudit() {
        when(connector.snapshot(TENANT, SHOP)).thenReturn(snapshot(
                "read_orders", "read_returns", "write_returns"));
        var provider = new ReturnDecisionResult(
                RETURN, "OPEN", false, NOW);
        when(connector.decideShopifyReturn(eq(TENANT), eq(SHOP), any()))
                .thenReturn(provider);

        var result = service.decideReturn(actor, SHOP,
                new ReturnDecisionRequest(
                        RETURN, ReturnDecision.APPROVE, null, null,
                        true, "return.approve-10"));

        assertThat(result).isSameAs(provider);
        verify(audit).recordAtomically(any());
    }

    @Test
    void refundRequiresPreviewTokenAndValidLineSelection() {
        var lines = List.of(new ReturnRefundLineSelection(RETURN_LINE, 1));
        var request = new ReturnRefundProcessRequest(
                RETURN, lines, false, List.of(), "", true,
                "return.refund-10");

        assertThatThrownBy(() -> service.processRefund(actor, SHOP, request))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Refund preview token is invalid");
        verify(connector, never()).processShopifyReturnRefund(any(), any(), any());
    }

    @Test
    void previewsThenProcessesRefundAndAuditsResult() {
        when(connector.snapshot(TENANT, SHOP)).thenReturn(snapshot(
                "read_orders", "read_returns", "write_returns"));
        var lines = List.of(new ReturnRefundLineSelection(RETURN_LINE, 1));
        var money = new MoneyBag(new Money("12.00", "USD"), null);
        var preview = new ReturnRefundPreview(
                RETURN, ReturnRefundPreviewState.REFUNDABLE, lines, false,
                List.of(), null, null, money, money, List.of(),
                "opaque-preview", NOW.plusSeconds(300), NOW);
        var previewRequest = new ReturnRefundPreviewRequest(
                RETURN, lines, false, List.of());
        when(connector.previewShopifyReturnRefund(
                TENANT, SHOP, previewRequest)).thenReturn(preview);

        assertThat(service.previewRefund(TENANT, SHOP, previewRequest))
                .isSameAs(preview);

        var processRequest = new ReturnRefundProcessRequest(
                RETURN, lines, false, List.of(), "opaque-preview", true,
                "return.refund-10");
        var processed = new ReturnRefundProcessResult(
                RETURN, "CLOSED", ReturnRefundProcessOutcome.APPLIED,
                money, List.of(), false, NOW);
        when(connector.processShopifyReturnRefund(
                TENANT, SHOP, processRequest)).thenReturn(processed);

        assertThat(service.processRefund(actor, SHOP, processRequest))
                .isSameAs(processed);
        verify(audit).recordAtomically(any());
    }

    private static ChannelSnapshot snapshot(String... scopes) {
        return new ChannelSnapshot(
                ConnectorMode.XZ_ERP_APP,
                new Connection(ConnectionStatus.CONNECTED, null, null, NOW),
                java.util.Arrays.stream(scopes).map(value ->
                        new ShopifyPermissionScope(
                                value, value, ShopifyScopeCoverageStatus.GRANTED))
                        .toList(),
                List.of());
    }
}
