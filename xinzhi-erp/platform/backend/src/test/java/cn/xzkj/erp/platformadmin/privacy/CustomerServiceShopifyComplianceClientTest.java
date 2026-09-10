package cn.xzkj.erp.platformadmin.privacy;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyComplianceRequest;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyComplianceTopic;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class CustomerServiceShopifyComplianceClientTest {

    @Test
    void sendsTenantScopedMinimizedPrivacyContract() throws Exception {
        AtomicReference<String> requestBody = new AtomicReference<>();
        AtomicReference<String> tenantHeader = new AtomicReference<>();
        AtomicReference<String> tokenHeader = new AtomicReference<>();
        HttpServer server = HttpServer.create(
                new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/api/v1/internal/customer-service/shopify-compliance/export",
                exchange -> {
                    tenantHeader.set(exchange.getRequestHeaders().getFirst(
                            "X-XZ-Tenant-ID"));
                    tokenHeader.set(exchange.getRequestHeaders().getFirst(
                            "X-XZ-ERP-Connector-Token"));
                    requestBody.set(new String(
                            exchange.getRequestBody().readAllBytes(),
                            StandardCharsets.UTF_8));
                    byte[] response = """
                            {
                              "contractVersion": "customer_service.shopify_compliance.v1",
                              "eventId": "shopify-compliance/customers/data_request/event-1",
                              "recordCount": 1,
                              "data": {"conversations": [{"id": "conversation-1"}]}
                            }
                            """.getBytes(StandardCharsets.UTF_8);
                    exchange.getResponseHeaders().set(
                            "Content-Type", "application/json");
                    exchange.sendResponseHeaders(200, response.length);
                    exchange.getResponseBody().write(response);
                    exchange.close();
                });
        server.start();
        try {
            CustomerServiceShopifyComplianceClient client =
                    new CustomerServiceShopifyComplianceClient(
                            "http://127.0.0.1:" + server.getAddress().getPort(),
                            "expected-token", Duration.ofSeconds(5), "local",
                            HttpClient.newHttpClient());
            ShopifyComplianceRequest request = request();

            var export = client.export(request);

            assertThat(export.recordCount()).isEqualTo(1);
            assertThat(export.data().get("conversations").get(0).get("id")
                    .asText()).isEqualTo("conversation-1");
            assertThat(tenantHeader.get()).isEqualTo(request.tenantId().toString());
            assertThat(tokenHeader.get()).isEqualTo("expected-token");
            assertThat(requestBody.get())
                    .contains("\"customerIds\":[\"6001\"]")
                    .contains("\"orderIds\":[\"7001\"]")
                    .contains("\"customerEmailSha256\":[\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"]")
                    .doesNotContain("buyer@example.com");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void failsClosedWhenCustomerServiceOriginIsNotConfigured() {
        CustomerServiceShopifyComplianceClient client =
                new CustomerServiceShopifyComplianceClient(
                        "", "expected-token", Duration.ofSeconds(5), "production",
                        HttpClient.newHttpClient());

        assertThatThrownBy(() -> client.export(request()))
                .isInstanceOf(
                        CustomerServiceComplianceUnavailableException.class);
    }

    @Test
    void acceptsAnIdempotentRedactionReceiptOnlyForTheSameEvent()
            throws Exception {
        HttpServer server = HttpServer.create(
                new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/api/v1/internal/customer-service/shopify-compliance/redact",
                exchange -> {
                    byte[] response = """
                            {
                              "contractVersion": "customer_service.shopify_compliance.v1",
                              "eventId": "shopify-compliance/customers/redact/event-2",
                              "recordCount": 3,
                              "attachmentsDeleted": 1,
                              "alreadyCompleted": true
                            }
                            """.getBytes(StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(200, response.length);
                    exchange.getResponseBody().write(response);
                    exchange.close();
                });
        server.start();
        try {
            CustomerServiceShopifyComplianceClient client =
                    new CustomerServiceShopifyComplianceClient(
                            "http://127.0.0.1:" + server.getAddress().getPort(),
                            "expected-token", Duration.ofSeconds(5), "local",
                            HttpClient.newHttpClient());

            var result = client.redact(redactionRequest());

            assertThat(result.recordCount()).isEqualTo(3);
            assertThat(result.attachmentsDeleted()).isEqualTo(1);
            assertThat(result.alreadyCompleted()).isTrue();
        } finally {
            server.stop(0);
        }
    }

    private static ShopifyComplianceRequest request() {
        return new ShopifyComplianceRequest(
                "shopify-compliance/customers/data_request/event-1",
                UUID.fromString("00000000-0000-4000-8000-000000000001"),
                UUID.fromString("00000000-0000-4000-8000-000000000002"),
                "demo.myshopify.com",
                ShopifyComplianceTopic.CUSTOMER_DATA_REQUEST,
                List.of(
                        "customer:6001",
                        "customer_email_sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                        "order:7001",
                        "shop:8001"),
                Instant.parse("2026-08-15T00:00:00Z"));
    }

    private static ShopifyComplianceRequest redactionRequest() {
        ShopifyComplianceRequest request = request();
        return new ShopifyComplianceRequest(
                "shopify-compliance/customers/redact/event-2",
                request.tenantId(), request.shopId(), request.shopDomain(),
                ShopifyComplianceTopic.CUSTOMER_REDACT,
                request.referenceIds(), request.occurredAt());
    }
}
