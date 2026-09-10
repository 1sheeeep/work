package cn.xzkj.erp.platformadmin.privacy;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.iam.application.IamConflictException;
import cn.xzkj.erp.iam.application.IamValidationException;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyComplianceCompletion;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyComplianceOutcome;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyComplianceRequest;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyComplianceTopic;
import cn.xzkj.erp.platformadmin.application.PlatformAdminActor;
import cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditEvent;
import cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditRecorder;
import cn.xzkj.erp.platformadmin.privacy.CustomerServiceShopifyComplianceClient.CustomerServiceExport;
import cn.xzkj.erp.platformadmin.privacy.CustomerServiceShopifyComplianceClient.CustomerServiceRedaction;
import cn.xzkj.erp.platformadmin.privacy.ShopifyComplianceRepository.CustomerDataExport;
import cn.xzkj.erp.platformadmin.privacy.ShopifyComplianceRepository.Execution;
import cn.xzkj.erp.platformadmin.privacy.ShopifyComplianceRepository.ExportLine;
import cn.xzkj.erp.platformadmin.privacy.ShopifyComplianceRepository.ExportOrder;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import tools.jackson.databind.ObjectMapper;

class ShopifyComplianceOperationsServiceTest {

    private static final Instant NOW = Instant.parse("2026-08-15T06:00:00Z");
    private static final UUID TENANT_ID =
            UUID.fromString("00000000-0000-4000-8000-000000000001");
    private static final UUID SHOP_ID =
            UUID.fromString("00000000-0000-4000-8000-000000000002");
    private static final UUID ADMIN_ID =
            UUID.fromString("00000000-0000-4000-8000-000000000003");
    private static final UUID SESSION_ID =
            UUID.fromString("00000000-0000-4000-8000-000000000004");
    private static final UUID INTERNAL_ORDER_ID =
            UUID.fromString("00000000-0000-4000-8000-000000000005");

    private ChannelConnectorGateway connector;
    private ShopifyComplianceRepository repository;
    private PlatformAdminAuditRecorder auditRecorder;
    private CustomerServiceShopifyComplianceClient customerServiceClient;
    private ShopifyComplianceOperationsService service;

    @BeforeEach
    void setUp() {
        connector = mock(ChannelConnectorGateway.class);
        repository = mock(ShopifyComplianceRepository.class);
        auditRecorder = mock(PlatformAdminAuditRecorder.class);
        customerServiceClient = mock(
                CustomerServiceShopifyComplianceClient.class);
        when(customerServiceClient.export(any())).thenReturn(
                new CustomerServiceExport(
                        0, new ObjectMapper().createObjectNode()));
        when(customerServiceClient.redact(any())).thenReturn(
                new CustomerServiceRedaction(0, 0, false));
        service = new ShopifyComplianceOperationsService(
                connector,
                repository,
                auditRecorder,
                customerServiceClient,
                new ObjectMapper(),
                Clock.fixed(NOW, ZoneOffset.UTC));
    }

    @Test
    void preparesCustomerDataWithoutLeakingInternalIdentifiers() {
        ShopifyComplianceRequest request = request(
                ShopifyComplianceTopic.CUSTOMER_DATA_REQUEST,
                List.of("customer:6001", "order:7001"));
        when(connector.listShopifyComplianceRequests())
                .thenReturn(List.of(request));
        when(repository.recordSeen(request)).thenReturn(execution(request));
        when(repository.loadCustomerData(request)).thenReturn(
                new CustomerDataExport(
                        List.of("6001"),
                        List.of("7001"),
                        List.of(exportOrder())));

        var download = service.prepareExport(actor(), request.eventId());

        String json = new String(download.content(), StandardCharsets.UTF_8);
        assertThat(json)
                .contains("buyer@example.com")
                .contains("gid://shopify/Order/7001")
                .doesNotContain(INTERNAL_ORDER_ID.toString())
                .doesNotContain("\"internalId\"")
                .doesNotContain("\"orderId\"")
                .contains("\"customerService\":{}");
        assertThat(download.recordCount()).isEqualTo(1);
        verify(repository).markExportPrepared(request.eventId(), 1);
        ArgumentCaptor<PlatformAdminAuditEvent> audit =
                ArgumentCaptor.forClass(PlatformAdminAuditEvent.class);
        verify(auditRecorder).record(audit.capture());
        assertThat(audit.getValue().details())
                .containsEntry("recordCount", "1")
                .doesNotContainKeys("email", "phone", "contact");
    }

    @Test
    void completesAnExportOnlyAfterItWasPrepared() {
        ShopifyComplianceRequest request = request(
                ShopifyComplianceTopic.CUSTOMER_DATA_REQUEST,
                List.of("customer:6001"));
        Execution prepared = execution(request, NOW.minusSeconds(60), null,
                null, null, null);
        Execution completed = execution(
                request,
                prepared.exportPreparedAt(),
                null,
                NOW,
                ShopifyComplianceOutcome.EXPORTED,
                NOW);
        when(connector.listShopifyComplianceRequests())
                .thenReturn(List.of(request));
        when(repository.recordSeen(request)).thenReturn(prepared);
        when(connector.completeShopifyComplianceRequest(
                request.eventId(), ShopifyComplianceOutcome.EXPORTED))
                .thenReturn(new ShopifyComplianceCompletion(
                        request.eventId(),
                        ShopifyComplianceOutcome.EXPORTED,
                        NOW,
                        false));
        when(repository.find(request.eventId()))
                .thenReturn(Optional.of(completed));

        var result = service.confirmExportDelivered(
                actor(),
                request.eventId(),
                ShopifyComplianceOperationsService.DELIVERY_CONFIRMATION);

        assertThat(result.status()).isEqualTo("COMPLETED");
        verify(repository).markCompleted(
                request.eventId(), ShopifyComplianceOutcome.EXPORTED, NOW, true);
    }

    @Test
    void reportsNotFoundWhenRedactionHasNoMatchingErpRecords() {
        ShopifyComplianceRequest request = request(
                ShopifyComplianceTopic.CUSTOMER_REDACT,
                List.of("customer:6001"));
        when(connector.listShopifyComplianceRequests())
                .thenReturn(List.of(request));
        when(repository.recordSeen(request)).thenReturn(execution(request));
        when(repository.anonymize(request)).thenReturn(0);
        when(connector.completeShopifyComplianceRequest(
                request.eventId(), ShopifyComplianceOutcome.NOT_FOUND))
                .thenReturn(new ShopifyComplianceCompletion(
                        request.eventId(),
                        ShopifyComplianceOutcome.NOT_FOUND,
                        NOW,
                        false));
        Execution completed = execution(
                request,
                null,
                NOW,
                null,
                ShopifyComplianceOutcome.NOT_FOUND,
                NOW);
        when(repository.find(request.eventId()))
                .thenReturn(Optional.of(completed));

        var result = service.redact(
                actor(),
                request.eventId(),
                ShopifyComplianceOperationsService.REDACTION_CONFIRMATION);

        assertThat(result.completionOutcome())
                .isEqualTo(ShopifyComplianceOutcome.NOT_FOUND);
        verify(repository).markCompleted(
                request.eventId(), ShopifyComplianceOutcome.NOT_FOUND, NOW, false);
        verify(repository).updateRedactionRecordCount(request.eventId(), 0);
        verify(customerServiceClient).redact(request);
    }

    @Test
    void recordsShopRedactionAsDeletedAfterLocalAnonymization() {
        ShopifyComplianceRequest request = request(
                ShopifyComplianceTopic.SHOP_REDACT,
                List.of("shop:9001"));
        when(connector.listShopifyComplianceRequests())
                .thenReturn(List.of(request));
        when(repository.recordSeen(request)).thenReturn(execution(request));
        when(repository.anonymize(request)).thenReturn(2);
        when(connector.completeShopifyComplianceRequest(
                request.eventId(), ShopifyComplianceOutcome.DELETED))
                .thenReturn(new ShopifyComplianceCompletion(
                        request.eventId(),
                        ShopifyComplianceOutcome.DELETED,
                        NOW,
                        false));
        Execution completed = execution(
                request,
                null,
                NOW,
                null,
                ShopifyComplianceOutcome.DELETED,
                NOW);
        when(repository.find(request.eventId()))
                .thenReturn(Optional.of(completed));

        var result = service.redact(
                actor(),
                request.eventId(),
                ShopifyComplianceOperationsService.REDACTION_CONFIRMATION);

        assertThat(result.completionOutcome())
                .isEqualTo(ShopifyComplianceOutcome.DELETED);
        verify(repository).markCompleted(
                request.eventId(), ShopifyComplianceOutcome.DELETED, NOW, false);
        verify(repository).updateRedactionRecordCount(request.eventId(), 2);
        verify(customerServiceClient).redact(request);
    }

    @Test
    void doesNotCompleteConnectorWhenCustomerServiceRedactionFails() {
        ShopifyComplianceRequest request = request(
                ShopifyComplianceTopic.CUSTOMER_REDACT,
                List.of("customer:6001"));
        when(connector.listShopifyComplianceRequests())
                .thenReturn(List.of(request));
        when(repository.recordSeen(request)).thenReturn(execution(request));
        when(repository.anonymize(request)).thenReturn(1);
        when(customerServiceClient.redact(request)).thenThrow(
                new CustomerServiceComplianceUnavailableException());

        assertThatThrownBy(() -> service.redact(
                actor(),
                request.eventId(),
                ShopifyComplianceOperationsService.REDACTION_CONFIRMATION))
                .isInstanceOf(IamConflictException.class);

        verify(repository).markFailure(
                request.eventId(), "CUSTOMER_SERVICE_REDACTION_UNAVAILABLE");
        verify(connector, never()).completeShopifyComplianceRequest(
                any(), any());
    }

    @Test
    void rejectsAConfirmationThatDidNotComeFromTheExplicitOperatorAction() {
        assertThatThrownBy(() -> service.redact(
                actor(), "event", "YES"))
                .isInstanceOf(IamValidationException.class);
        verify(connector, never()).listShopifyComplianceRequests();
        verify(repository, never()).anonymize(any());
    }

    private static ShopifyComplianceRequest request(
            ShopifyComplianceTopic topic,
            List<String> references) {
        String wireTopic = switch (topic) {
            case CUSTOMER_DATA_REQUEST -> "customers/data_request";
            case CUSTOMER_REDACT -> "customers/redact";
            case SHOP_REDACT -> "shop/redact";
        };
        return new ShopifyComplianceRequest(
                "shopify-compliance/" + wireTopic + "/event-1",
                TENANT_ID,
                SHOP_ID,
                "example.myshopify.com",
                topic,
                references,
                NOW.minusSeconds(3600));
    }

    private static PlatformAdminActor actor() {
        return new PlatformAdminActor(
                ADMIN_ID, SESSION_ID, "request-1", "127.0.0.1");
    }

    private static Execution execution(ShopifyComplianceRequest request) {
        return execution(request, null, null, null, null, null);
    }

    private static Execution execution(
            ShopifyComplianceRequest request,
            Instant exportPreparedAt,
            Instant dataRedactedAt,
            Instant deliveryConfirmedAt,
            ShopifyComplianceOutcome outcome,
            Instant completedAt) {
        return new Execution(
                request.eventId(),
                request.tenantId(),
                request.shopId(),
                request.topic(),
                request.occurredAt(),
                request.occurredAt().plusSeconds(30L * 24 * 60 * 60),
                1,
                exportPreparedAt,
                dataRedactedAt,
                deliveryConfirmedAt,
                outcome,
                completedAt,
                1,
                NOW,
                null);
    }

    private static ExportOrder exportOrder() {
        return new ExportOrder(
                INTERNAL_ORDER_ID,
                "gid://shopify/Order/7001",
                "USD",
                "buyer-1",
                "PAID",
                "OPEN",
                "PAID",
                1299L,
                299L,
                NOW.minusSeconds(7200),
                NOW.minusSeconds(7100),
                null,
                null,
                "US",
                "CA",
                "94107",
                "gid://shopify/Customer/6001",
                "Buyer",
                "+14155550100",
                "buyer@example.com",
                null,
                "1 Market St",
                null,
                "San Francisco",
                null,
                null,
                null,
                "Standard",
                "TRACK-1",
                null,
                "Please leave at door",
                null,
                null,
                List.of(new ExportLine(
                        INTERNAL_ORDER_ID,
                        "gid://shopify/LineItem/8001",
                        "Product",
                        "SKU-1",
                        1,
                        1000L,
                        "USD")));
    }
}
