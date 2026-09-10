package cn.xzkj.erp.platformadmin.privacy;

import static cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditActions.SHOPIFY_COMPLIANCE_DATA_REDACTED;
import static cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditActions.SHOPIFY_COMPLIANCE_EXPORT_DELIVERED;
import static cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditActions.SHOPIFY_COMPLIANCE_EXPORT_PREPARED;

import cn.xzkj.erp.iam.application.IamConflictException;
import cn.xzkj.erp.iam.application.IamNotFoundException;
import cn.xzkj.erp.iam.application.IamValidationException;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyComplianceCompletion;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyComplianceOutcome;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyComplianceRequest;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyComplianceTopic;
import cn.xzkj.erp.platform.connector.ConnectorUnavailableException;
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
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Service
public class ShopifyComplianceOperationsService {

    public static final String DELIVERY_CONFIRMATION =
            "DELIVERED_TO_STORE_OWNER";
    public static final String REDACTION_CONFIRMATION =
            "ANONYMIZE_SHOPIFY_DATA";

    private static final int MAX_EXPORT_BYTES = 16 * 1024 * 1024;
    private static final String RESOURCE_TYPE = "shopify_compliance_request";

    private final ChannelConnectorGateway connectorGateway;
    private final ShopifyComplianceRepository repository;
    private final PlatformAdminAuditRecorder auditRecorder;
    private final CustomerServiceShopifyComplianceClient customerServiceClient;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public ShopifyComplianceOperationsService(
            ChannelConnectorGateway connectorGateway,
            ShopifyComplianceRepository repository,
            PlatformAdminAuditRecorder auditRecorder,
            CustomerServiceShopifyComplianceClient customerServiceClient,
            ObjectMapper objectMapper,
            Clock clock) {
        this.connectorGateway = connectorGateway;
        this.repository = repository;
        this.auditRecorder = auditRecorder;
        this.customerServiceClient = customerServiceClient;
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    public List<RequestView> list() {
        Instant now = clock.instant();
        return connectorGateway.listShopifyComplianceRequests().stream()
                .map(request -> view(
                        request,
                        repository.recordSeen(request),
                        now))
                .sorted((left, right) -> right.occurredAt()
                        .compareTo(left.occurredAt()))
                .toList();
    }

    public ExportDownload prepareExport(
            PlatformAdminActor actor,
            String eventId) {
        ShopifyComplianceRequest request = requirePending(eventId);
        requireTopic(request, ShopifyComplianceTopic.CUSTOMER_DATA_REQUEST);
        repository.recordSeen(request);
        try {
            CustomerDataExport data = repository.loadCustomerData(request);
            CustomerServiceExport customerService = customerServiceClient.export(request);
            ExportDocument document = new ExportDocument(
                    "XZ ERP",
                    request.eventId(),
                    request.shopDomain(),
                    request.occurredAt(),
                    clock.instant(),
                    data.shopifyCustomerIds(),
                    data.requestedShopifyOrderIds(),
                    data.orders().stream().map(
                            ShopifyComplianceOperationsService::outwardOrder)
                            .toList(),
                    customerService.data());
            byte[] content = objectMapper.writeValueAsBytes(document);
            if (content.length > MAX_EXPORT_BYTES) {
                repository.markFailure(request.eventId(), "EXPORT_TOO_LARGE");
                throw new IamConflictException();
            }
            int recordCount = data.orders().size()
                    + customerService.recordCount();
            repository.markExportPrepared(request.eventId(), recordCount);
            audit(actor, request, SHOPIFY_COMPLIANCE_EXPORT_PREPARED,
                    recordCount, ShopifyComplianceOutcome.EXPORTED);
            LocalDate date = LocalDate.ofInstant(clock.instant(), ZoneOffset.UTC);
            return new ExportDownload(
                    "shopify-customer-data-" + date + ".json",
                    content,
                    recordCount);
        } catch (JacksonException exception) {
            repository.markFailure(request.eventId(), "EXPORT_SERIALIZATION_FAILED");
            throw new IamConflictException();
        } catch (IllegalStateException exception) {
            repository.markFailure(request.eventId(), "EXPORT_LIMIT_EXCEEDED");
            throw new IamConflictException();
        } catch (CustomerServiceComplianceUnavailableException exception) {
            repository.markFailure(
                    request.eventId(), "CUSTOMER_SERVICE_EXPORT_UNAVAILABLE");
            throw new IamConflictException();
        }
    }

    public RequestView confirmExportDelivered(
            PlatformAdminActor actor,
            String eventId,
            String confirmation) {
        requireConfirmation(confirmation, DELIVERY_CONFIRMATION);
        ShopifyComplianceRequest request = requirePending(eventId);
        requireTopic(request, ShopifyComplianceTopic.CUSTOMER_DATA_REQUEST);
        Execution execution = repository.recordSeen(request);
        if (execution.exportPreparedAt() == null) {
            throw new IamConflictException();
        }
        ShopifyComplianceCompletion completion = complete(
                request, ShopifyComplianceOutcome.EXPORTED);
        repository.markCompleted(
                request.eventId(),
                completion.outcome(),
                completion.completedAt(),
                true);
        Execution completed = repository.find(request.eventId())
                .orElseThrow(IamNotFoundException::new);
        audit(actor, request, SHOPIFY_COMPLIANCE_EXPORT_DELIVERED,
                completed.recordCount(), completion.outcome());
        return view(request, completed, clock.instant());
    }

    public RequestView redact(
            PlatformAdminActor actor,
            String eventId,
            String confirmation) {
        requireConfirmation(confirmation, REDACTION_CONFIRMATION);
        ShopifyComplianceRequest request = requirePending(eventId);
        if (request.topic() == ShopifyComplianceTopic.CUSTOMER_DATA_REQUEST) {
            throw new IamValidationException();
        }
        repository.recordSeen(request);
        int recordCount;
        try {
            recordCount = repository.anonymize(request);
        } catch (IllegalStateException exception) {
            repository.markFailure(request.eventId(), "ANONYMIZATION_FAILED");
            throw new IamConflictException();
        }
        CustomerServiceRedaction customerService;
        try {
            customerService = customerServiceClient.redact(request);
        } catch (CustomerServiceComplianceUnavailableException exception) {
            repository.markFailure(
                    request.eventId(), "CUSTOMER_SERVICE_REDACTION_UNAVAILABLE");
            throw new IamConflictException();
        }
        recordCount += customerService.recordCount();
        repository.updateRedactionRecordCount(request.eventId(), recordCount);
        ShopifyComplianceOutcome outcome;
        if (recordCount == 0) {
            outcome = ShopifyComplianceOutcome.NOT_FOUND;
        } else if (request.topic() == ShopifyComplianceTopic.SHOP_REDACT) {
            outcome = ShopifyComplianceOutcome.DELETED;
        } else {
            outcome = ShopifyComplianceOutcome.ANONYMIZED;
        }
        ShopifyComplianceCompletion completion = complete(request, outcome);
        repository.markCompleted(
                request.eventId(),
                completion.outcome(),
                completion.completedAt(),
                false);
        Execution completed = repository.find(request.eventId())
                .orElseThrow(IamNotFoundException::new);
        audit(actor, request, SHOPIFY_COMPLIANCE_DATA_REDACTED,
                recordCount, completion.outcome());
        return view(request, completed, clock.instant());
    }

    private ShopifyComplianceCompletion complete(
            ShopifyComplianceRequest request,
            ShopifyComplianceOutcome outcome) {
        try {
            return connectorGateway.completeShopifyComplianceRequest(
                    request.eventId(), outcome);
        } catch (ConnectorUnavailableException exception) {
            repository.markFailure(request.eventId(), "CONNECTOR_UNAVAILABLE");
            throw exception;
        }
    }

    private ShopifyComplianceRequest requirePending(String eventId) {
        if (eventId == null || eventId.isBlank() || eventId.length() > 260) {
            throw new IamValidationException();
        }
        return connectorGateway.listShopifyComplianceRequests().stream()
                .filter(candidate -> eventId.equals(candidate.eventId()))
                .findFirst()
                .orElseThrow(IamNotFoundException::new);
    }

    private static void requireTopic(
            ShopifyComplianceRequest request,
            ShopifyComplianceTopic topic) {
        if (request.topic() != topic) {
            throw new IamValidationException();
        }
    }

    private static void requireConfirmation(String actual, String expected) {
        if (!expected.equals(actual)) {
            throw new IamValidationException();
        }
    }

    private void audit(
            PlatformAdminActor actor,
            ShopifyComplianceRequest request,
            String action,
            Integer recordCount,
            ShopifyComplianceOutcome outcome) {
        auditRecorder.record(new PlatformAdminAuditEvent(
                actor.adminId(),
                request.tenantId(),
                action,
                RESOURCE_TYPE,
                auditResourceId(request.eventId()),
                actor.requestId(),
                actor.sourceIp(),
                Map.of(
                        "topic", request.topic().name(),
                        "recordCount", Integer.toString(
                                recordCount == null ? 0 : recordCount),
                        "outcome", outcome.name())));
    }

    private static String auditResourceId(String eventId) {
        if (eventId.length() <= 160) {
            return eventId;
        }
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(eventId.getBytes(StandardCharsets.UTF_8));
            return "sha256:" + HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable", impossible);
        }
    }

    private static RequestView view(
            ShopifyComplianceRequest request,
            Execution execution,
            Instant now) {
        String status;
        if (execution.connectorCompletedAt() != null) {
            status = "COMPLETED";
        } else if (execution.lastErrorCode() != null) {
            status = "RETRY_REQUIRED";
        } else if (execution.dataRedactedAt() != null) {
            status = "LOCAL_REDACTION_COMPLETE";
        } else if (execution.exportPreparedAt() != null) {
            status = "EXPORT_READY";
        } else {
            status = "PENDING";
        }
        return new RequestView(
                request.eventId(),
                request.shopDomain(),
                request.topic(),
                request.occurredAt(),
                execution.dueAt(),
                execution.dueAt().isBefore(now)
                        && execution.connectorCompletedAt() == null,
                status,
                execution.recordCount(),
                execution.exportPreparedAt(),
                execution.dataRedactedAt(),
                execution.deliveryConfirmedAt(),
                execution.completionOutcome(),
                execution.connectorCompletedAt(),
                execution.attemptCount(),
                execution.lastAttemptAt(),
                execution.lastErrorCode());
    }

    private static ExportOrderView outwardOrder(ExportOrder order) {
        return new ExportOrderView(
                order.shopifyOrderId(),
                order.currency(),
                order.buyerReference(),
                order.orderStatus(),
                order.platformStatus(),
                order.paymentStatus(),
                order.totalAmountMinor(),
                order.shippingAmountMinor(),
                order.placedAt(),
                order.paidAt(),
                order.shippedAt(),
                order.deliveredAt(),
                order.countryCode(),
                order.province(),
                order.postalCode(),
                order.shopifyCustomerId(),
                order.recipientName(),
                order.recipientPhone(),
                order.recipientEmail(),
                order.recipientCompany(),
                order.addressLine1(),
                order.addressLine2(),
                order.city(),
                order.district(),
                order.town(),
                order.doorCode(),
                order.shippingService(),
                order.trackingReference(),
                order.secondaryTrackingReference(),
                order.platformMessage(),
                order.platformRemark(),
                order.orderRemark(),
                order.lines().stream().map(
                        ShopifyComplianceOperationsService::outwardLine)
                        .toList());
    }

    private static ExportLineView outwardLine(ExportLine line) {
        return new ExportLineView(
                line.shopifyLineItemId(),
                line.title(),
                line.sku(),
                line.quantity(),
                line.unitPriceMinor(),
                line.currency());
    }

    public record RequestView(
            String eventId,
            String shopDomain,
            ShopifyComplianceTopic topic,
            Instant occurredAt,
            Instant dueAt,
            boolean overdue,
            String status,
            Integer recordCount,
            Instant exportPreparedAt,
            Instant dataRedactedAt,
            Instant deliveryConfirmedAt,
            ShopifyComplianceOutcome completionOutcome,
            Instant connectorCompletedAt,
            int attemptCount,
            Instant lastAttemptAt,
            String lastErrorCode) {
    }

    public record ExportDownload(
            String fileName,
            byte[] content,
            int recordCount) {

        public ExportDownload {
            content = content.clone();
        }

        @Override
        public byte[] content() {
            return content.clone();
        }
    }

    public record ExportDocument(
            String application,
            String eventId,
            String shopDomain,
            Instant requestedAt,
            Instant generatedAt,
            List<String> requestedShopifyCustomerIds,
            List<String> requestedShopifyOrderIds,
            List<ExportOrderView> orders,
            JsonNode customerService) {
    }

    public record ExportOrderView(
            String shopifyOrderId,
            String currency,
            String buyerReference,
            String orderStatus,
            String platformStatus,
            String paymentStatus,
            Long totalAmountMinor,
            Long shippingAmountMinor,
            Instant placedAt,
            Instant paidAt,
            Instant shippedAt,
            Instant deliveredAt,
            String countryCode,
            String province,
            String postalCode,
            String shopifyCustomerId,
            String recipientName,
            String recipientPhone,
            String recipientEmail,
            String recipientCompany,
            String addressLine1,
            String addressLine2,
            String city,
            String district,
            String town,
            String doorCode,
            String shippingService,
            String trackingReference,
            String secondaryTrackingReference,
            String platformMessage,
            String platformRemark,
            String orderRemark,
            List<ExportLineView> lines) {
    }

    public record ExportLineView(
            String shopifyLineItemId,
            String title,
            String sku,
            int quantity,
            long unitPriceMinor,
            String currency) {
    }
}
