package cn.xzkj.erp.platform.connector;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.Test;

import com.sun.net.httpserver.HttpServer;

class XzErpAppChannelConnectorGatewayCustomerCatalogTest {

    private static final UUID TENANT =
            UUID.fromString("11111111-1111-4111-8111-111111111111");
    private static final UUID SHOP =
            UUID.fromString("22222222-2222-4222-8222-222222222222");

    @Test
    void readsTheStrictCustomerCatalogContract() throws IOException {
        var requestBody = new AtomicReference<String>();
        HttpServer server = HttpServer.create(
                new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/api/v1/erp-connector/shopify/customer-catalog",
                exchange -> {
                    assertThat(exchange.getRequestMethod()).isEqualTo("POST");
                    assertThat(exchange.getRequestHeaders().getFirst(
                            "X-XZ-ERP-Connector-Token"))
                            .isEqualTo("expected-token");
                    requestBody.set(new String(
                            exchange.getRequestBody().readAllBytes(),
                            StandardCharsets.UTF_8));
                    byte[] response = """
                            {
                              "contractVersion":"shopify.connector.customer_catalog.v1",
                              "tenantId":"11111111-1111-4111-8111-111111111111",
                              "shopId":"22222222-2222-4222-8222-222222222222",
                              "state":"CONNECTED",
                              "customers":[{
                                "id":"gid://shopify/Customer/1",
                                "legacyResourceId":"1",
                                "displayName":"Mia Customer",
                                "email":"mia@example.com",
                                "phone":"+15551234567",
                                "createdAt":"2026-01-02T03:04:05Z",
                                "updatedAt":"2026-08-14T05:06:07Z",
                                "verifiedEmail":true,
                                "tags":["VIP"],
                                "numberOfOrders":"3",
                                "totalSpent":{"amount":"120.50","currencyCode":"USD"},
                                "defaultLocation":{"city":"Austin","province":"Texas","country":"United States","countryCode":"US"},
                                "lastOrder":{"id":"gid://shopify/Order/9","name":"#1009","createdAt":"2026-08-10T01:02:03Z","displayFinancialStatus":"PAID","displayFulfillmentStatus":"FULFILLED","total":{"amount":"40.00","currencyCode":"USD"}}
                              }],
                              "pageInfo":{"hasNextPage":false,"endCursor":null},
                              "fetchedAt":"2026-08-15T08:00:00Z"
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
            var gateway = new XzErpAppChannelConnectorGateway(
                    "http://127.0.0.1:" + server.getAddress().getPort(),
                    "expected-token", Duration.ofSeconds(5),
                    HttpClient.newHttpClient());

            var page = gateway.fetchShopifyCustomerCatalog(
                    TENANT, SHOP,
                    new ChannelConnectorGateway.CustomerCatalogRequest(
                            25, null, "mia@example.com"));

            assertThat(page.connectionStatus()).isEqualTo(
                    ChannelConnectorGateway.ConnectionStatus.CONNECTED);
            assertThat(page.customers()).singleElement().satisfies(customer -> {
                assertThat(customer.displayName()).isEqualTo("Mia Customer");
                assertThat(customer.numberOfOrders()).isEqualTo("3");
                assertThat(customer.lastOrder().name()).isEqualTo("#1009");
            });
            assertThat(requestBody.get())
                    .contains(
                            "\"limit\":25",
                            "\"query\":\"mia@example.com\"",
                            "\"tenantId\":\"" + TENANT + "\"",
                            "\"shopId\":\"" + SHOP + "\"")
                    .doesNotContain("expected-token");
        } finally {
            server.stop(0);
        }
    }
}
