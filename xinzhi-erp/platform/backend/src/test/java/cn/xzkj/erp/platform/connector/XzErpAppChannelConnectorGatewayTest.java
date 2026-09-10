package cn.xzkj.erp.platform.connector;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;

import org.junit.jupiter.api.Test;

import com.sun.net.httpserver.HttpServer;

import cn.xzkj.erp.platform.service.ShopifyAuthorizationConflictException;

class XzErpAppChannelConnectorGatewayTest {

    private static final UUID TENANT =
            UUID.fromString("11111111-1111-4111-8111-111111111111");
    private static final UUID SHOP =
            UUID.fromString("22222222-2222-4222-8222-222222222222");

    @Test
    void productionClientNeverFollowsRedirects() {
        assertThat(XzErpAppChannelConnectorGateway.connectorHttpClient()
                .followRedirects())
                .isEqualTo(HttpClient.Redirect.NEVER);
    }

    @Test
    void rejectsInsecureNonLoopbackBaseUrl() {
        assertThatThrownBy(() -> new XzErpAppChannelConnectorGateway(
                "http://example.com",
                "token",
                Duration.ofSeconds(5),
                HttpClient.newHttpClient()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("requires HTTPS");
    }

    @Test
    void allowsExplicitSingleLabelContainerHostButNotPublicHttp() {
        var gateway = new XzErpAppChannelConnectorGateway(
                "http://shopify-connector:8790",
                "token",
                Duration.ofSeconds(5),
                true,
                HttpClient.newHttpClient());

        assertThat(gateway).isNotNull();
        assertThatThrownBy(() -> new XzErpAppChannelConnectorGateway(
                "http://example.com",
                "token",
                Duration.ofSeconds(5),
                true,
                HttpClient.newHttpClient()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("requires HTTPS");
    }

    @Test
    void startsShopifyOAuthThroughTheConnectorWithoutCredentials()
            throws IOException {
        HttpServer server = HttpServer.create(
                new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicReference<String> requestBody = new AtomicReference<>();
        server.createContext(
                "/api/v1/shopify-connector/installations/oauth/start",
                exchange -> {
                    assertThat(exchange.getRequestHeaders().getFirst(
                            "X-XZ-ERP-Connector-Token"))
                            .isEqualTo("expected-token");
                    requestBody.set(new String(
                            exchange.getRequestBody().readAllBytes(),
                            java.nio.charset.StandardCharsets.UTF_8));
                    byte[] response = ("""
                            {
                              "contractVersion": "shopify.connector.installation.v1",
                              "authorizationUrl": "https://connector.example/shopify/oauth/authorize?grant=%s"
                            }
                            """).formatted("A".repeat(43)).getBytes(
                                    java.nio.charset.StandardCharsets.UTF_8);
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

            var start = gateway.startShopifyAuthorization(
                    TENANT, SHOP, "demo.myshopify.com");

            assertThat(start.snapshot().mode()).isEqualTo(
                    ChannelConnectorGateway.ConnectorMode.XZ_ERP_APP);
            assertThat(start.snapshot().shopify().status()).isEqualTo(
                    ChannelConnectorGateway.ConnectionStatus.PENDING);
            assertThat(start.authorizationUrl()).isEqualTo(
                    "https://connector.example/shopify/oauth/authorize?grant="
                            + "A".repeat(43));
            assertThat(requestBody.get())
                    .contains(
                            "\"tenantId\":\"" + TENANT + "\"",
                            "\"shopId\":\"" + SHOP + "\"",
                            "\"legacyShopId\":\"" + SHOP + "\"",
                            "\"shopDomain\":\"demo.myshopify.com\"")
                    .doesNotContain("expected-token", "credential");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void uninstallsThroughConnectorBeforeProjectingDisconnectedState()
            throws IOException {
        HttpServer server = HttpServer.create(
                new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicReference<String> uninstallBody = new AtomicReference<>();
        server.createContext(
                "/api/v1/shopify-connector/installations/uninstall",
                exchange -> {
                    assertThat(exchange.getRequestMethod()).isEqualTo("POST");
                    assertThat(exchange.getRequestHeaders().getFirst(
                            "X-XZ-ERP-Connector-Token"))
                            .isEqualTo("expected-token");
                    uninstallBody.set(new String(
                            exchange.getRequestBody().readAllBytes(),
                            java.nio.charset.StandardCharsets.UTF_8));
                    byte[] response = """
                            {
                              "contractVersion":"shopify.connector.installation.v1",
                              "tenantId":"11111111-1111-4111-8111-111111111111",
                              "shopId":"22222222-2222-4222-8222-222222222222",
                              "shopDomain":"demo.myshopify.com",
                              "installationRevoked":true,
                              "sourceDisabled":true,
                              "cachesInvalidated":true,
                              "alreadyRevoked":false,
                              "revokedAt":"2026-08-22T00:00:00Z"
                            }
                            """.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                    exchange.getResponseHeaders().set("Content-Type", "application/json");
                    exchange.sendResponseHeaders(200, response.length);
                    exchange.getResponseBody().write(response);
                    exchange.close();
                });
        server.createContext(
                "/api/v1/erp-connector/shopify/connection",
                exchange -> {
                    byte[] response = """
                            {
                              "contractVersion":"shopify.connector.connection.v3",
                              "tenantId":"11111111-1111-4111-8111-111111111111",
                              "shopId":"22222222-2222-4222-8222-222222222222",
                              "state":"DISCONNECTED",
                              "grantedScopes":[],
                              "shopName":"Example Store",
                              "shopDomain":"demo.myshopify.com",
                              "checkedAt":"2026-08-22T00:00:01Z"
                            }
                            """.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                    exchange.getResponseHeaders().set("Content-Type", "application/json");
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

            var snapshot = gateway.uninstallShopify(TENANT, SHOP);

            assertThat(snapshot.shopify().status()).isEqualTo(
                    ChannelConnectorGateway.ConnectionStatus.REVOKED);
            assertThat(uninstallBody.get())
                    .contains("\"tenantId\":\"" + TENANT + "\"")
                    .contains("\"shopId\":\"" + SHOP + "\"")
                    .doesNotContain("expected-token", "credential");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void rejectsUnsafeShopifyOAuthStartResponses() throws IOException {
        AtomicReference<String> responseBody = new AtomicReference<>();
        HttpServer server = HttpServer.create(
                new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/api/v1/shopify-connector/installations/oauth/start",
                exchange -> {
                    byte[] response = responseBody.get().getBytes(
                            java.nio.charset.StandardCharsets.UTF_8);
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
            for (String response : List.of(
                    """
                    {"contractVersion":"shopify.connector.installation.v2","authorizationUrl":"https://connector.example/shopify/oauth/authorize?grant=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}
                    """,
                    """
                    {"contractVersion":"shopify.connector.installation.v1","authorizationUrl":"http://connector.example/shopify/oauth/authorize?grant=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}
                    """,
                    """
                    {"contractVersion":"shopify.connector.installation.v1","authorizationUrl":"https://connector.example/other?grant=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}
                    """,
                    """
                    {"contractVersion":"shopify.connector.installation.v1","authorizationUrl":"https://connector.example/shopify/oauth/authorize?grant=short"}
                    """)) {
                responseBody.set(response);
                assertThatThrownBy(() -> gateway.startShopifyAuthorization(
                        TENANT, SHOP, "demo.myshopify.com"))
                        .isInstanceOf(ConnectorUnavailableException.class);
            }
        } finally {
            server.stop(0);
        }
    }

    @Test
    void readsAndCompletesComplianceRequestsWithoutContactData()
            throws IOException {
        AtomicReference<String> completionBody = new AtomicReference<>();
        AtomicReference<String> listMethod = new AtomicReference<>();
        HttpServer server = HttpServer.create(
                new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/internal/v1/shopify/compliance-requests",
                exchange -> {
                    assertThat(exchange.getRequestHeaders().getFirst(
                            "X-XZ-ERP-Connector-Token"))
                            .isEqualTo("expected-token");
                    listMethod.set(exchange.getRequestMethod());
                    byte[] response = """
                            {
                              "requests": [{
                                "id": "shopify-compliance/customers/data_request/shopify-uninstall:compliance-123",
                                "kind": "shopify.compliance.requested",
                                "identity": {
                                  "tenantId": "11111111-1111-4111-8111-111111111111",
                                  "shopId": "22222222-2222-4222-8222-222222222222"
                                },
                                "shopDomain": "demo.myshopify.com",
                                "topic": "customers/data_request",
                                "referenceIds": ["customer:6001", "customer_email_sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "order:7001", "shop:8001"],
                                "occurredAt": "2026-08-06T00:00:00Z"
                              }]
                            }
                            """.getBytes(
                                    java.nio.charset.StandardCharsets.UTF_8);
                    exchange.getResponseHeaders().set(
                            "Content-Type", "application/json");
                    exchange.sendResponseHeaders(200, response.length);
                    exchange.getResponseBody().write(response);
                    exchange.close();
                });
        server.createContext(
                "/internal/v1/shopify/compliance-requests/complete",
                exchange -> {
                    completionBody.set(new String(
                            exchange.getRequestBody().readAllBytes(),
                            java.nio.charset.StandardCharsets.UTF_8));
                    byte[] response = """
                            {
                              "eventId": "shopify-compliance/customers/data_request/shopify-uninstall:compliance-123",
                              "outcome": "exported",
                              "completedAt": "2026-08-06T00:05:00Z",
                              "alreadyCompleted": false
                            }
                            """.getBytes(
                                    java.nio.charset.StandardCharsets.UTF_8);
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

            var requests = gateway.listShopifyComplianceRequests();

            assertThat(listMethod.get()).isEqualTo("GET");
            assertThat(requests).hasSize(1);
            assertThat(requests.getFirst().tenantId()).isEqualTo(TENANT);
            assertThat(requests.getFirst().shopId()).isEqualTo(SHOP);
            assertThat(requests.getFirst().topic()).isEqualTo(
                    ChannelConnectorGateway.ShopifyComplianceTopic
                            .CUSTOMER_DATA_REQUEST);
            assertThat(requests.getFirst().referenceIds())
                    .containsExactly(
                            "customer:6001",
                            "customer_email_sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                            "order:7001", "shop:8001");

            var completion = gateway.completeShopifyComplianceRequest(
                    "shopify-compliance/customers/data_request/shopify-uninstall:compliance-123",
                    ChannelConnectorGateway.ShopifyComplianceOutcome.EXPORTED);

            assertThat(completion.outcome()).isEqualTo(
                    ChannelConnectorGateway.ShopifyComplianceOutcome.EXPORTED);
            assertThat(completion.alreadyCompleted()).isFalse();
            assertThat(completionBody.get())
                    .isEqualTo("{\"eventId\":\"shopify-compliance/customers/data_request/shopify-uninstall:compliance-123\",\"outcome\":\"exported\"}")
                    .doesNotContain("customer:6001", "expected-token");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void rejectsComplianceRequestsContainingMalformedReferences()
            throws IOException {
        HttpServer server = HttpServer.create(
                new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/internal/v1/shopify/compliance-requests",
                exchange -> {
                    byte[] response = """
                            {
                              "requests": [{
                                "id": "shopify-compliance/customers/redact/shopify-uninstall:compliance-456",
                                "kind": "shopify.compliance.requested",
                                "identity": {
                                  "tenantId": "11111111-1111-4111-8111-111111111111",
                                  "shopId": "22222222-2222-4222-8222-222222222222"
                                },
                                "shopDomain": "demo.myshopify.com",
                                "topic": "customers/redact",
                                "referenceIds": ["customer:buyer@example.com", "shop:8001"],
                                "occurredAt": "2026-08-06T00:00:00Z"
                              }]
                            }
                            """.getBytes(
                                    java.nio.charset.StandardCharsets.UTF_8);
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

            assertThatThrownBy(gateway::listShopifyComplianceRequests)
                    .isInstanceOf(ConnectorUnavailableException.class);
        } finally {
            server.stop(0);
        }
    }

    @Test
    void fetchesReturnsThroughTheXzErpAppConnector() throws IOException {
        HttpServer server = HttpServer.create(
                new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicReference<String> requestBody = new AtomicReference<>();
        server.createContext(
                "/api/v1/erp-connector/shopify/return-catalog",
                exchange -> {
                    requestBody.set(new String(
                            exchange.getRequestBody().readAllBytes(),
                            java.nio.charset.StandardCharsets.UTF_8));
                    byte[] response = """
                            {
                              "contractVersion": "shopify.connector.return_catalog.v1",
                              "tenantId": "11111111-1111-4111-8111-111111111111",
                              "shopId": "22222222-2222-4222-8222-222222222222",
                              "state": "CONNECTED",
                              "pageInfo": {"hasNextPage": true, "endCursor": "next=="},
                              "fetchedAt": "2026-08-01T00:00:00Z",
                              "returns": [{
                                "id": "gid://shopify/Return/10",
                                "name": "#1001-R1",
                                "orderId": "gid://shopify/Order/20",
                                "orderName": "#1001",
                                "status": "OPEN",
                                "createdAt": "2026-08-01T00:00:00Z",
                                "requestApprovedAt": "2026-08-01T00:01:00Z",
                                "totalQuantity": 1,
                                "lineItems": [{
                                  "id": "gid://shopify/ReturnLineItem/30",
                                  "fulfillmentLineId": "gid://shopify/FulfillmentLineItem/40",
                                  "orderLineId": "gid://shopify/LineItem/50",
                                  "name": "Hoodie - Blue / M",
                                  "sku": "HD-B-M",
                                  "quantity": 1,
                                  "processableQuantity": 1,
                                  "processedQuantity": 0,
                                  "refundableQuantity": 1,
                                  "refundedQuantity": 0,
                                  "reasonHandle": "size-too-small",
                                  "reasonName": "Size too small"
                                }]
                              }]
                            }
                            """.getBytes(
                                    java.nio.charset.StandardCharsets.UTF_8);
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

            var page = gateway.fetchShopifyReturnCatalog(
                    TENANT, SHOP,
                    new ChannelConnectorGateway.ReturnCatalogRequest(
                            25, "cursor==", "name:1001"));

            assertThat(requestBody.get())
                    .contains("\"limit\":25", "\"cursor\":\"cursor==\"",
                            "\"query\":\"name:1001\"");
            assertThat(page.connectionStatus()).isEqualTo(
                    ChannelConnectorGateway.ConnectionStatus.CONNECTED);
            assertThat(page.cursor()).isEqualTo("next==");
            assertThat(page.returns()).singleElement().satisfies(item -> {
                assertThat(item.externalReturnRef())
                        .isEqualTo("gid://shopify/Return/10");
                assertThat(item.lineItems()).singleElement()
                        .satisfies(line -> assertThat(line.sku())
                                .isEqualTo("HD-B-M"));
            });
        } finally {
            server.stop(0);
        }
    }

    @Test
    void mapsGrantedScopesInConnectionSnapshot() throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicReference<String> requestBody = new AtomicReference<>();
        server.createContext("/api/v1/erp-connector/shopify/connection", exchange -> {
            if (!"expected-token".equals(exchange.getRequestHeaders()
                    .getFirst("X-XZ-ERP-Connector-Token"))) {
                exchange.sendResponseHeaders(403, -1);
                return;
            }
            requestBody.set(new String(exchange.getRequestBody().readAllBytes(),
                    java.nio.charset.StandardCharsets.UTF_8));
            byte[] response = """
                    {
                      "contractVersion": "shopify.connector.connection.v3",
                      "tenantId": "11111111-1111-4111-8111-111111111111",
                      "shopId": "22222222-2222-4222-8222-222222222222",
                      "state": "CONNECTED",
                      "grantedScopes": ["write_order_edits"],
                      "shopName": "Example Store",
                      "shopDomain": "example-store.myshopify.com",
                      "checkedAt": "2026-07-31T01:02:03Z"
                    }
                    """.getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();
        try {
            var gateway = new XzErpAppChannelConnectorGateway(
                    "http://127.0.0.1:" + server.getAddress().getPort(),
                    "expected-token",
                    Duration.ofSeconds(5),
                    HttpClient.newHttpClient());

            var snapshot = gateway.snapshot(TENANT, SHOP);

            assertThat(requestBody.get())
                    .contains("\"identity\"", "\"context\"")
                    .doesNotContain("\"limit\"", "\"cursor\"", "\"query\"");
            assertThat(snapshot.mode()).isEqualTo(
                    ChannelConnectorGateway.ConnectorMode.XZ_ERP_APP);
            assertThat(snapshot.shopify().shopName()).isEqualTo("Example Store");
            assertThat(snapshot.shopify().shopDomain())
                    .isEqualTo("example-store.myshopify.com");
            assertThat(snapshot.shopify().status()).isEqualTo(
                    ChannelConnectorGateway.ConnectionStatus.CONNECTED);
            assertThat(snapshot.shopifyScopes())
                    .anySatisfy(scope -> {
                        assertThat(scope.scope()).isEqualTo("write_order_edits");
                        assertThat(scope.status()).isEqualTo(
                                ChannelConnectorGateway.ShopifyScopeCoverageStatus.GRANTED);
                    })
                    .anySatisfy(scope -> {
                        assertThat(scope.scope()).isEqualTo("write_orders");
                        assertThat(scope.status()).isEqualTo(
                                ChannelConnectorGateway.ShopifyScopeCoverageStatus.MISSING);
                    })
                    .anySatisfy(scope -> {
                        assertThat(scope.scope()).isEqualTo("read_all_orders");
                        assertThat(scope.status()).isEqualTo(
                                ChannelConnectorGateway.ShopifyScopeCoverageStatus.MISSING);
                    });
        } finally {
            server.stop(0);
        }
    }

    @Test
    void mapsOnlyExplicitWriteScopesToTheirMatchingReadCoverage() {
        var coverage = ChannelConnectorGateway.plannedShopifyScopes(
                List.of(
                        "write_assigned_fulfillment_orders",
                        "write_merchant_managed_fulfillment_orders",
                        "write_third_party_fulfillment_orders",
                        "write_unknown"),
                true);

        assertThat(coverage)
                .filteredOn(scope -> scope.scope().equals(
                        "read_merchant_managed_fulfillment_orders")
                        || scope.scope().equals(
                                "write_merchant_managed_fulfillment_orders"))
                .allSatisfy(scope -> assertThat(scope.status()).isEqualTo(
                        ChannelConnectorGateway.ShopifyScopeCoverageStatus.GRANTED));
        assertThat(coverage)
                .noneMatch(scope -> scope.scope().contains(
                        "assigned_fulfillment_orders")
                        || scope.scope().contains(
                                "third_party_fulfillment_orders")
                        || scope.scope().equals("read_fulfillments")
                        || scope.scope().equals("write_fulfillments"));
        assertThat(coverage)
                .filteredOn(scope -> scope.scope().equals("read_orders"))
                .allSatisfy(scope -> assertThat(scope.status()).isEqualTo(
                        ChannelConnectorGateway.ShopifyScopeCoverageStatus.MISSING));
    }

    @Test
    void resolvesReadRequirementsFromGrantedWriteScopeCoverage() {
        var coverage = ChannelConnectorGateway.plannedShopifyScopes(
                List.of(
                        "write_orders",
                        "write_order_edits",
                        "write_merchant_managed_fulfillment_orders",
                        "write_returns"),
                true);

        assertThat(ChannelConnectorGateway.shopifyScopeCoverage(
                coverage, "read_orders")).isEqualTo(
                        ChannelConnectorGateway.ShopifyScopeCoverageStatus.GRANTED);
        assertThat(ChannelConnectorGateway.shopifyScopeCoverage(
                coverage, "read_order_edits")).isEqualTo(
                        ChannelConnectorGateway.ShopifyScopeCoverageStatus.GRANTED);
        assertThat(ChannelConnectorGateway.shopifyScopeCoverage(
                coverage, "read_merchant_managed_fulfillment_orders"))
                        .isEqualTo(
                                ChannelConnectorGateway.ShopifyScopeCoverageStatus.GRANTED);
        assertThat(ChannelConnectorGateway.shopifyScopeCoverage(
                coverage, "read_returns")).isEqualTo(
                        ChannelConnectorGateway.ShopifyScopeCoverageStatus.GRANTED);
        assertThat(ChannelConnectorGateway.shopifyScopeCoverage(
                coverage, "read_products")).isEqualTo(
                        ChannelConnectorGateway.ShopifyScopeCoverageStatus.MISSING);
        assertThat(ChannelConnectorGateway.shopifyScopeCoverage(
                coverage, "read_unknown")).isNull();
    }

    @Test
    void rejectsUnknownConnectionContractStateAndMismatchedIdentity()
            throws IOException {
        AtomicReference<String> responseBody = new AtomicReference<>();
        HttpServer server = HttpServer.create(
                new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/api/v1/erp-connector/shopify/connection",
                exchange -> {
                    byte[] response = responseBody.get().getBytes(
                            java.nio.charset.StandardCharsets.UTF_8);
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
            List<String> invalidResponses = List.of(
                    """
                    {"contractVersion":"shopify.connector.connection.v1","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222","state":"CONNECTED","grantedScopes":["read_orders"],"checkedAt":"2026-08-01T01:00:00Z"}
                    """,
                    """
                    {"contractVersion":"shopify.connector.connection.v3","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222","state":"UNKNOWN","grantedScopes":[],"checkedAt":"2026-08-01T01:00:00Z"}
                    """,
                    """
                    {"contractVersion":"shopify.connector.connection.v3","tenantId":"33333333-3333-4333-8333-333333333333","shopId":"22222222-2222-4222-8222-222222222222","state":"CONNECTED","grantedScopes":["read_orders"],"checkedAt":"2026-08-01T01:00:00Z"}
                    """,
                    """
                    {"contractVersion":"shopify.connector.connection.v3","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"44444444-4444-4444-8444-444444444444","state":"CONNECTED","grantedScopes":["read_orders"],"checkedAt":"2026-08-01T01:00:00Z"}
                    """,
                    """
                    {"contractVersion":"shopify.connector.connection.v3","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222","state":"CONNECTED","grantedScopes":["read_orders"]}
                    """,
                    """
                    {"contractVersion":"shopify.connector.connection.v3","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222","state":"CONNECTED","checkedAt":"2026-08-01T01:00:00Z"}
                    """,
                    """
                    {"contractVersion":"shopify.connector.connection.v3","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222","state":"CONNECTED","grantedScopes":null,"checkedAt":"2026-08-01T01:00:00Z"}
                    """,
                    """
                    {"contractVersion":"shopify.connector.connection.v3","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222","state":"CONNECTED","grantedScopes":["write_orders","read_orders"],"checkedAt":"2026-08-01T01:00:00Z"}
                    """,
                    """
                    {"contractVersion":"shopify.connector.connection.v3","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222","state":"CONNECTED","grantedScopes":["read_orders","read_orders"],"checkedAt":"2026-08-01T01:00:00Z"}
                    """,
                    """
                    {"contractVersion":"shopify.connector.connection.v3","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222","state":"CONNECTED","grantedScopes":["read_orders"],"checkedAt":"2026-08-01T01:00:00Z","capabilities":{"themeEmbedReady":false}}
                    """,
                    "{");
            for (String invalidResponse : invalidResponses) {
                responseBody.set(invalidResponse);
                assertThatThrownBy(() -> gateway.snapshot(TENANT, SHOP))
                        .isInstanceOf(ConnectorUnavailableException.class);
            }
        } finally {
            server.stop(0);
        }
    }

    @Test
    void fetchesCatalogThroughTheXzErpAppConnector() throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/v1/erp-connector/shopify/product-catalog", exchange -> {
            if (!"expected-token".equals(exchange.getRequestHeaders()
                    .getFirst("X-XZ-ERP-Connector-Token"))) {
                exchange.sendResponseHeaders(403, -1);
                return;
            }
            byte[] response = """
                    {
                      "contractVersion": "shopify.connector.product_catalog.v1",
                      "tenantId": "11111111-1111-4111-8111-111111111111",
                      "shopId": "22222222-2222-4222-8222-222222222222",
                      "state": "CONNECTED",
                      "pageInfo": {"hasNextPage": true, "endCursor": "next=="},
                      "fetchedAt": "2026-07-31T01:02:03Z",
                      "products": [{
                        "id": "gid://shopify/Product/100",
                        "title": "Catalog Hoodie",
                        "handle": "catalog-hoodie",
                        "status": "ACTIVE",
                        "updatedAt": "2026-07-30T01:02:03Z",
                        "variants": [{
                          "id": "gid://shopify/ProductVariant/200",
                          "inventoryItemId": "gid://shopify/InventoryItem/300",
                          "sku": "HD-B-M",
                          "title": "Blue / M",
                          "price": "39.90",
                          "currencyCode": "USD",
                          "availableForSale": true,
                          "inventoryTracked": true
                        }]
                      }]
                    }
                    """.getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();
        try {
            var gateway = new XzErpAppChannelConnectorGateway(
                    "http://127.0.0.1:" + server.getAddress().getPort(),
                    "expected-token",
                    Duration.ofSeconds(5),
                    HttpClient.newHttpClient());

            var page = gateway.fetchShopifyProductCatalog(
                    TENANT,
                    SHOP,
                    new ChannelConnectorGateway.ProductCatalogRequest(
                            25, null, "status:active"));

            assertThat(page.mode()).isEqualTo(
                    ChannelConnectorGateway.ConnectorMode.XZ_ERP_APP);
            assertThat(page.connectionStatus()).isEqualTo(
                    ChannelConnectorGateway.ConnectionStatus.CONNECTED);
            assertThat(page.cursor()).isEqualTo("next==");
            assertThat(page.hasNextPage()).isTrue();
            assertThat(page.products()).hasSize(1);
            assertThat(page.products().getFirst().variants().getFirst().sku())
                    .isEqualTo("HD-B-M");
            assertThat(page.products().getFirst().variants().getFirst()
                    .inventoryItemRef())
                    .isEqualTo("gid://shopify/InventoryItem/300");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void rejectsMalformedProductCatalogContractIdentityStateAndShape()
            throws IOException {
        AtomicReference<String> responseBody = new AtomicReference<>();
        HttpServer server = HttpServer.create(
                new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/api/v1/erp-connector/shopify/product-catalog",
                exchange -> {
                    byte[] response = responseBody.get().getBytes(
                            java.nio.charset.StandardCharsets.UTF_8);
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
            List<String> invalidResponses = List.of(
                    """
                    {"contractVersion":"shopify.connector.product_catalog.v2","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222","state":"CONNECTED","pageInfo":{"hasNextPage":false},"fetchedAt":"2026-08-01T01:00:00Z","products":[]}
                    """,
                    """
                    {"contractVersion":"shopify.connector.product_catalog.v1","tenantId":"33333333-3333-4333-8333-333333333333","shopId":"22222222-2222-4222-8222-222222222222","state":"CONNECTED","pageInfo":{"hasNextPage":false},"fetchedAt":"2026-08-01T01:00:00Z","products":[]}
                    """,
                    """
                    {"contractVersion":"shopify.connector.product_catalog.v1","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222","state":"UNKNOWN","pageInfo":{"hasNextPage":false},"fetchedAt":"2026-08-01T01:00:00Z","products":[]}
                    """,
                    """
                    {"contractVersion":"shopify.connector.product_catalog.v1","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222","state":"CONNECTED","fetchedAt":"2026-08-01T01:00:00Z","products":[]}
                    """,
                    """
                    {"contractVersion":"shopify.connector.product_catalog.v1","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222","state":"CONNECTED","pageInfo":{"hasNextPage":false},"fetchedAt":"2026-08-01T01:00:00Z"}
                    """,
                    """
                    {"contractVersion":"shopify.connector.product_catalog.v1","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222","state":"CONNECTED","pageInfo":{"hasNextPage":false},"fetchedAt":"2026-08-01T01:00:00Z","products":[],"accessToken":"shpat_forbidden"}
                    """);
            for (String invalidResponse : invalidResponses) {
                responseBody.set(invalidResponse);
                assertThatThrownBy(() -> gateway.fetchShopifyProductCatalog(
                        TENANT,
                        SHOP,
                        new ChannelConnectorGateway.ProductCatalogRequest(
                                25, null, null)))
                        .isInstanceOf(ConnectorUnavailableException.class);
            }
        } finally {
            server.stop(0);
        }
    }

    @Test
    void fetchesLocationsThroughTheXzErpAppConnector() throws IOException {
        HttpServer server = HttpServer.create(
                new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/api/v1/erp-connector/shopify/location-catalog",
                exchange -> {
                    if (!"expected-token".equals(exchange.getRequestHeaders()
                            .getFirst("X-XZ-ERP-Connector-Token"))) {
                        exchange.sendResponseHeaders(403, -1);
                        return;
                    }
                    byte[] response = """
                            {
                              "contractVersion": "shopify.connector.location_catalog.v1",
                              "tenantId": "11111111-1111-4111-8111-111111111111",
                              "shopId": "22222222-2222-4222-8222-222222222222",
                              "state": "CONNECTED",
                              "pageInfo": {"hasNextPage": true, "endCursor": "next=="},
                              "fetchedAt": "2026-07-31T01:02:03Z",
                              "locations": [{
                                "id": "gid://shopify/Location/100",
                                "name": "Toronto Warehouse",
                                "isActive": true,
                                "fulfillsOnlineOrders": true,
                                "hasActiveInventory": true,
                                "isFulfillmentService": false,
                                "address1": "1 Main Street",
                                "city": "Toronto",
                                "province": "Ontario",
                                "provinceCode": "ON",
                                "country": "Canada",
                                "countryCode": "CA",
                                "zip": "M1M 1M1"
                              }]
                            }
                            """.getBytes(
                                    java.nio.charset.StandardCharsets.UTF_8);
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
                    "expected-token",
                    Duration.ofSeconds(5),
                    HttpClient.newHttpClient());

            var page = gateway.fetchShopifyLocationCatalog(
                    TENANT,
                    SHOP,
                    new ChannelConnectorGateway.LocationCatalogRequest(
                            25, "opaque=="));

            assertThat(page.mode()).isEqualTo(
                    ChannelConnectorGateway.ConnectorMode.XZ_ERP_APP);
            assertThat(page.connectionStatus()).isEqualTo(
                    ChannelConnectorGateway.ConnectionStatus.CONNECTED);
            assertThat(page.cursor()).isEqualTo("next==");
            assertThat(page.hasNextPage()).isTrue();
            assertThat(page.locations()).singleElement().satisfies(location -> {
                assertThat(location.externalLocationRef())
                        .isEqualTo("gid://shopify/Location/100");
                assertThat(location.name()).isEqualTo("Toronto Warehouse");
                assertThat(location.active()).isTrue();
                assertThat(location.countryCode()).isEqualTo("CA");
            });
        } finally {
            server.stop(0);
        }
    }

    @Test
    void fetchesInventoryLevelThroughTheXzErpAppConnector() throws IOException {
        HttpServer server = HttpServer.create(
                new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/api/v1/erp-connector/shopify/inventory-level",
                exchange -> {
                    if (!"expected-token".equals(exchange.getRequestHeaders()
                            .getFirst("X-XZ-ERP-Connector-Token"))) {
                        exchange.sendResponseHeaders(403, -1);
                        return;
                    }
                    String body = new String(exchange.getRequestBody().readAllBytes(),
                            java.nio.charset.StandardCharsets.UTF_8);
                    assertThat(body).contains(
                            "\"inventoryItemId\":\"gid://shopify/InventoryItem/200\"",
                            "\"locationId\":\"gid://shopify/Location/100\"");
                    byte[] response = """
                            {
                              "contractVersion": "shopify.connector.inventory_level.v1",
                              "tenantId": "11111111-1111-4111-8111-111111111111",
                              "shopId": "22222222-2222-4222-8222-222222222222",
                              "state": "CONNECTED",
                              "inventoryItemId": "gid://shopify/InventoryItem/200",
                              "locationId": "gid://shopify/Location/100",
                              "tracked": true,
                              "active": true,
                              "availableQuantity": 7,
                              "onHandQuantity": 10,
                              "fetchedAt": "2026-08-01T00:00:00Z"
                            }
                            """.getBytes(java.nio.charset.StandardCharsets.UTF_8);
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

            var snapshot = gateway.fetchShopifyInventoryLevel(
                    TENANT, SHOP,
                    new ChannelConnectorGateway.InventoryLevelRequest(
                            "gid://shopify/InventoryItem/200",
                            "gid://shopify/Location/100"));

            assertThat(snapshot.connectionStatus()).isEqualTo(
                    ChannelConnectorGateway.ConnectionStatus.CONNECTED);
            assertThat(snapshot.tracked()).isTrue();
            assertThat(snapshot.availableQuantity()).isEqualTo(7);
            assertThat(snapshot.onHandQuantity()).isEqualTo(10);
        } finally {
            server.stop(0);
        }
    }

    @Test
    void remainingReadContractsRejectVersionIdentityStateAndUnknownFields() throws IOException {
        List<ReadContractCase> cases = List.of(
                new ReadContractCase("/api/v1/erp-connector/shopify/return-catalog",
                        """
                        {"contractVersion":"shopify.connector.return_catalog.v2","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222","state":"CONNECTED","pageInfo":{"hasNextPage":false},"fetchedAt":"2026-08-01T00:00:00Z","returns":[]}
                        """,
                        gateway -> gateway.fetchShopifyReturnCatalog(TENANT, SHOP, null)),
                new ReadContractCase("/api/v1/erp-connector/shopify/location-catalog",
                        """
                        {"contractVersion":"shopify.connector.location_catalog.v1","tenantId":"33333333-3333-4333-8333-333333333333","shopId":"22222222-2222-4222-8222-222222222222","state":"CONNECTED","pageInfo":{"hasNextPage":false},"fetchedAt":"2026-08-01T00:00:00Z","locations":[]}
                        """,
                        gateway -> gateway.fetchShopifyLocationCatalog(TENANT, SHOP, null)),
                new ReadContractCase("/api/v1/erp-connector/shopify/inventory-level",
                        """
                        {"contractVersion":"shopify.connector.inventory_level.v1","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222","state":"UNKNOWN","inventoryItemId":"gid://shopify/InventoryItem/200","locationId":"gid://shopify/Location/100","tracked":true,"active":true,"availableQuantity":7,"fetchedAt":"2026-08-01T00:00:00Z"}
                        """,
                        gateway -> gateway.fetchShopifyInventoryLevel(TENANT, SHOP,
                                new ChannelConnectorGateway.InventoryLevelRequest(
                                        "gid://shopify/InventoryItem/200", "gid://shopify/Location/100"))),
                new ReadContractCase("/api/v1/erp-connector/shopify/dispute-catalog",
                        """
                        {"contractVersion":"shopify.connector.dispute_catalog.v1","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222","state":"CONNECTED","pageInfo":{"hasNextPage":false},"fetchedAt":"2026-08-01T00:00:00Z","disputes":[],"accessToken":"shpat_forbidden"}
                        """,
                        gateway -> gateway.fetchShopifyDisputes(TENANT, SHOP, null)));
        for (ReadContractCase testCase : cases) {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext(testCase.path(), exchange -> {
                byte[] response = testCase.response().getBytes(java.nio.charset.StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(200, response.length);
                exchange.getResponseBody().write(response);
                exchange.close();
            });
            server.start();
            try {
                var gateway = new XzErpAppChannelConnectorGateway(
                        "http://127.0.0.1:" + server.getAddress().getPort(),
                        "expected-token", Duration.ofSeconds(5), HttpClient.newHttpClient());
                assertThatThrownBy(() -> testCase.call().accept(gateway))
                        .isInstanceOf(ConnectorUnavailableException.class);
            } finally {
                server.stop(0);
            }
        }
    }

    @Test
    void disputeCatalogUsesItsStrictRequestContractWithoutProductQuery()
            throws IOException {
        HttpServer server = HttpServer.create(
                new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicReference<String> requestBody = new AtomicReference<>();
        server.createContext(
                "/api/v1/erp-connector/shopify/dispute-catalog",
                exchange -> {
                    requestBody.set(new String(
                            exchange.getRequestBody().readAllBytes(),
                            java.nio.charset.StandardCharsets.UTF_8));
                    byte[] response = ("""
                            {
                              "contractVersion": "shopify.connector.dispute_catalog.v1",
                              "tenantId": "%s",
                              "shopId": "%s",
                              "state": "CONNECTED",
                              "disputes": [],
                              "pageInfo": {"hasNextPage": false},
                              "fetchedAt": "2026-08-27T00:00:00Z"
                            }
                            """).formatted(TENANT, SHOP).getBytes(
                                    java.nio.charset.StandardCharsets.UTF_8);
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

            var page = gateway.fetchShopifyDisputes(
                    TENANT, SHOP,
                    new ChannelConnectorGateway.DisputeCatalogRequest(
                            25, "next-page"));

            assertThat(page.connectionStatus()).isEqualTo(
                    ChannelConnectorGateway.ConnectionStatus.CONNECTED);
            assertThat(page.disputes()).isEmpty();
            assertThat(requestBody.get())
                    .contains("\"limit\":25", "\"cursor\":\"next-page\"")
                    .doesNotContain("\"query\"");
        } finally {
            server.stop(0);
        }
    }

    private record ReadContractCase(String path, String response,
            Consumer<XzErpAppChannelConnectorGateway> call) {
    }

    private record SafeWriteErrorCase(
            String path,
            int status,
            String response,
            Consumer<XzErpAppChannelConnectorGateway> call,
            String expectedCode,
            boolean expectedRetryable,
            String expectedCorrelationId) {
    }

    @Test
    void executesReturnDecisionPreviewAndRefundThroughStrictContracts()
            throws IOException {
        HttpServer server = HttpServer.create(
                new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/api/v1/erp-connector/shopify/return-decision",
                exchange -> respond(exchange, 200, """
                        {"contractVersion":"shopify.connector.return_decision.v1","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222","returnId":"gid://shopify/Return/10","status":"OPEN","recoveredFromShopify":false,"updatedAt":"2026-08-15T08:00:00Z"}
                        """));
        server.createContext(
                "/api/v1/erp-connector/shopify/return-refund-preview",
                exchange -> respond(exchange, 200, """
                        {"contractVersion":"shopify.connector.return_refund_preview.v1","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222","returnId":"gid://shopify/Return/10","state":"REFUNDABLE","lineItems":[{"returnLineId":"gid://shopify/ReturnLineItem/20","quantity":1}],"refundShipping":false,"refundDuties":[],"refundAmount":{"shopMoney":{"amount":"12.00","currencyCode":"USD"},"presentmentMoney":{"amount":"12.00","currencyCode":"USD"}},"maximumRefundable":{"shopMoney":{"amount":"12.00","currencyCode":"USD"},"presentmentMoney":{"amount":"12.00","currencyCode":"USD"}},"transactions":[],"previewToken":"opaque-preview","expiresAt":"2026-08-15T08:10:00Z","fetchedAt":"2026-08-15T08:00:00Z"}
                        """));
        server.createContext(
                "/api/v1/erp-connector/shopify/return-refund-process",
                exchange -> respond(exchange, 200, """
                        {"contractVersion":"shopify.connector.return_refund_process.v1","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222","returnId":"gid://shopify/Return/10","returnStatus":"CLOSED","outcome":"APPLIED","refundAmount":{"shopMoney":{"amount":"12.00","currencyCode":"USD"},"presentmentMoney":{"amount":"12.00","currencyCode":"USD"}},"transactions":[],"recoveredFromShopify":false,"updatedAt":"2026-08-15T08:01:00Z"}
                        """));
        server.start();
        try {
            var gateway = new XzErpAppChannelConnectorGateway(
                    "http://127.0.0.1:" + server.getAddress().getPort(),
                    "expected-token", Duration.ofSeconds(5),
                    HttpClient.newHttpClient());
            var lines = List.of(
                    new ChannelConnectorGateway.ReturnRefundLineSelection(
                            "gid://shopify/ReturnLineItem/20", 1));

            var decision = gateway.decideShopifyReturn(
                    TENANT, SHOP,
                    new ChannelConnectorGateway.ReturnDecisionRequest(
                            "gid://shopify/Return/10",
                            ChannelConnectorGateway.ReturnDecision.APPROVE,
                            null, null, true, "return-decision-10"));
            assertThat(decision.status()).isEqualTo("OPEN");

            var preview = gateway.previewShopifyReturnRefund(
                    TENANT, SHOP,
                    new ChannelConnectorGateway.ReturnRefundPreviewRequest(
                            "gid://shopify/Return/10", lines,
                            false, List.of()));
            assertThat(preview.previewToken()).isEqualTo("opaque-preview");
            assertThat(preview.refundAmount().presentmentMoney().amount())
                    .isEqualTo("12.00");

            var processed = gateway.processShopifyReturnRefund(
                    TENANT, SHOP,
                    new ChannelConnectorGateway.ReturnRefundProcessRequest(
                            "gid://shopify/Return/10", lines,
                            false, List.of(), "opaque-preview", true,
                            "return-refund-10"));
            assertThat(processed.outcome()).isEqualTo(
                    ChannelConnectorGateway.ReturnRefundProcessOutcome.APPLIED);
        } finally {
            server.stop(0);
        }
    }

    private static void respond(
            com.sun.net.httpserver.HttpExchange exchange,
            int status,
            String body) throws IOException {
        exchange.getRequestBody().readAllBytes();
        byte[] response = body.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, response.length);
        exchange.getResponseBody().write(response);
        exchange.close();
    }

    @Test
    void setsInventoryThroughTheXzErpAppConnector() throws IOException {
        UUID publicationId = UUID.fromString(
                "33333333-3333-4333-8333-333333333333");
        HttpServer server = HttpServer.create(
                new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/api/v1/erp-connector/shopify/inventory-set",
                exchange -> {
                    String body = new String(exchange.getRequestBody().readAllBytes(),
                            java.nio.charset.StandardCharsets.UTF_8);
                    assertThat(body).contains(
                            "\"expectedAvailable\":7",
                            "\"targetAvailable\":9",
                            "\"idempotencyKey\":\"inventory-command-1\"",
                            "\"referenceDocumentUri\":\"xz-erp://inventory-publications/"
                                    + publicationId + "\"");
                    byte[] response = """
                            {
                              "contractVersion": "shopify.connector.inventory_set.v1",
                              "tenantId": "11111111-1111-4111-8111-111111111111",
                              "shopId": "22222222-2222-4222-8222-222222222222",
                              "outcome": "APPLIED",
                              "inventoryItemId": "gid://shopify/InventoryItem/200",
                              "locationId": "gid://shopify/Location/100",
                              "expectedAvailable": 7,
                              "targetAvailable": 9,
                              "updatedAt": "2026-08-01T00:00:00Z"
                            }
                            """.getBytes(java.nio.charset.StandardCharsets.UTF_8);
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

            var result = gateway.setShopifyInventoryAvailable(
                    TENANT, SHOP,
                    new ChannelConnectorGateway.InventorySetRequest(
                            "gid://shopify/InventoryItem/200",
                            "gid://shopify/Location/100",
                            7, 9, "inventory-command-1", publicationId));

            assertThat(result.outcome()).isEqualTo(
                    ChannelConnectorGateway.InventorySetOutcome.APPLIED);
            assertThat(result.targetAvailable()).isEqualTo(9);
            assertThat(result.safeErrorCode()).isNull();
        } finally {
            server.stop(0);
        }
    }

    @Test
    void rejectsMalformedStandaloneWriteContracts() throws IOException {
        UUID publicationId = UUID.fromString("33333333-3333-4333-8333-333333333333");
        var cases = List.of(
                new ReadContractCase("/api/v1/erp-connector/shopify/inventory-set",
                        """
                        {"contractVersion":"shopify.connector.inventory_set.v1","tenantId":"99999999-9999-4999-8999-999999999999","shopId":"22222222-2222-4222-8222-222222222222","outcome":"APPLIED","inventoryItemId":"gid://shopify/InventoryItem/200","locationId":"gid://shopify/Location/100","expectedAvailable":7,"targetAvailable":9,"updatedAt":"2026-08-02T00:00:00Z"}
                        """,
                        gateway -> gateway.setShopifyInventoryAvailable(TENANT, SHOP,
                                new ChannelConnectorGateway.InventorySetRequest(
                                        "gid://shopify/InventoryItem/200", "gid://shopify/Location/100",
                                        7, 9, "inventory-command-1", publicationId))));
        for (ReadContractCase testCase : cases) {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext(testCase.path(), exchange -> {
                byte[] response = testCase.response().getBytes(java.nio.charset.StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(200, response.length);
                exchange.getResponseBody().write(response);
                exchange.close();
            });
            server.start();
            try {
                var gateway = new XzErpAppChannelConnectorGateway(
                        "http://127.0.0.1:" + server.getAddress().getPort(),
                        "expected-token", Duration.ofSeconds(5), HttpClient.newHttpClient());
                assertThatThrownBy(() -> testCase.call().accept(gateway))
                        .isInstanceOf(ConnectorUnavailableException.class);
            } finally {
                server.stop(0);
            }
        }
    }

    @Test
    void preservesOnlyWhitelistedStandaloneWriteErrors() throws IOException {
        UUID publicationId = UUID.fromString(
                "33333333-3333-4333-8333-333333333333");
        String correlationId = "erp-" + SHOP;
        var cases = List.of(
                new SafeWriteErrorCase(
                        "/api/v1/erp-connector/shopify/inventory-set",
                        403,
                        """
                        {"code":"FORBIDDEN","message":"provider shpat_forbidden","retryable":false,"correlationId":"%s"}
                        """.formatted(correlationId),
                        gateway -> gateway.setShopifyInventoryAvailable(
                                TENANT, SHOP,
                                new ChannelConnectorGateway.InventorySetRequest(
                                        "gid://shopify/InventoryItem/200",
                                        "gid://shopify/Location/100",
                                        7, 9, "inventory-command-1",
                                        publicationId)),
                        "FORBIDDEN", false, correlationId),
                new SafeWriteErrorCase(
                        "/api/v1/erp-connector/shopify/inventory-set",
                        400,
                        """
                        {"code":"INVALID_REQUEST","message":"provider detail","retryable":true,"correlationId":"%s","unexpected":"value"}
                        """.formatted(correlationId),
                        gateway -> gateway.setShopifyInventoryAvailable(
                                TENANT, SHOP,
                                new ChannelConnectorGateway.InventorySetRequest(
                                        "gid://shopify/InventoryItem/200",
                                        "gid://shopify/Location/100",
                                        7, 9, "inventory-command-1",
                                        publicationId)),
                        "CONNECTOR_UNAVAILABLE", true, null));

        for (SafeWriteErrorCase testCase : cases) {
            HttpServer server = HttpServer.create(
                    new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext(testCase.path(), exchange -> {
                exchange.getRequestBody().readAllBytes();
                byte[] response = testCase.response().getBytes(
                        java.nio.charset.StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set(
                        "Content-Type", "application/json");
                exchange.sendResponseHeaders(testCase.status(), response.length);
                exchange.getResponseBody().write(response);
                exchange.close();
            });
            server.start();
            try {
                var gateway = new XzErpAppChannelConnectorGateway(
                        "http://127.0.0.1:"
                                + server.getAddress().getPort(),
                        "expected-token", Duration.ofSeconds(5),
                        HttpClient.newHttpClient());

                assertThatThrownBy(() -> testCase.call().accept(gateway))
                        .isInstanceOfSatisfying(
                                ConnectorUnavailableException.class,
                                exception -> {
                                    assertThat(exception.code())
                                            .isEqualTo(testCase.expectedCode());
                                    assertThat(exception.retryable())
                                            .isEqualTo(testCase.expectedRetryable());
                                    assertThat(exception.correlationId())
                                            .isEqualTo(testCase.expectedCorrelationId());
                                    assertThat(exception.getMessage())
                                            .doesNotContain("provider", "Shopify",
                                                    "shpat", "secret");
                                });
            } finally {
                server.stop(0);
            }
        }
    }

    @Test
    void fetchesOrdersThroughTheXzErpAppConnector() throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/v1/erp-connector/shopify/order-catalog", exchange -> {
            if (!"expected-token".equals(exchange.getRequestHeaders()
                    .getFirst("X-XZ-ERP-Connector-Token"))) {
                exchange.sendResponseHeaders(403, -1);
                return;
            }
            byte[] response = """
                    {
                      "contractVersion": "shopify.connector.order_catalog.v1",
                      "tenantId": "11111111-1111-4111-8111-111111111111",
                      "shopId": "22222222-2222-4222-8222-222222222222",
                      "state": "CONNECTED",
                      "pageInfo": {"hasNextPage": true, "endCursor": "next=="},
                      "fetchedAt": "2026-07-31T01:02:03Z",
                      "orders": [{
                        "id": "gid://shopify/Order/100",
                        "legacyResourceId": "100",
                        "name": "#1001",
                        "email": "buyer@example.test",
                        "sourceName": "web",
                        "createdAt": "2026-07-30T01:02:03Z",
                        "updatedAt": "2026-07-31T01:02:03Z",
                        "displayFinancialStatus": "PAID",
                        "displayFulfillmentStatus": "UNFULFILLED",
                        "paymentGatewayNames": ["shopify_payments"],
                        "total": {"amount": "45.00", "currencyCode": "USD"},
                        "subtotal": {"amount": "39.00", "currencyCode": "USD"},
                        "shipping": {"amount": "6.00", "currencyCode": "USD"},
                        "shippingAddress": {
                          "name": "Demo Buyer",
                          "address1": "1 Main St",
                          "city": "New York",
                          "countryCode": "US",
                          "zip": "10001",
                          "formatted": ["1 Main St", "New York NY 10001"]
                        },
                        "customer": {
                          "id": "gid://shopify/Customer/500",
                          "legacyResourceId": "500",
                          "displayName": "Demo Buyer",
                          "email": "buyer@example.test",
                          "createdAt": "2026-07-01T01:02:03Z",
                          "updatedAt": "2026-07-29T01:02:03Z",
                          "verifiedEmail": true,
                          "tags": ["review"],
                          "numberOfOrders": "3",
                          "totalSpent": {"amount": "145.00", "currencyCode": "USD"},
                          "defaultLocation": {"city": "New York", "countryCode": "US"},
                          "lastOrder": {
                            "id": "gid://shopify/Order/99",
                            "name": "#1000",
                            "createdAt": "2026-07-01T01:02:03Z",
                            "displayFinancialStatus": "PAID",
                            "displayFulfillmentStatus": "FULFILLED",
                            "total": {"amount": "100.00", "currencyCode": "USD"}
                          }
                        },
                        "lineItems": [{
                          "id": "gid://shopify/LineItem/900",
                          "legacyResourceId": "900",
                          "productId": "gid://shopify/Product/800",
                          "variantId": "gid://shopify/ProductVariant/801",
                          "inventoryItemId": "gid://shopify/InventoryItem/802",
                          "name": "Catalog Hoodie - Blue / M",
                          "title": "Catalog Hoodie",
                          "quantity": 2,
                          "sku": "HD-B-M",
                          "variantTitle": "Blue / M",
                          "requiresShipping": true,
                          "discountedTotal": {"amount": "39.00", "currencyCode": "USD"},
                          "originalUnitPrice": {"amount": "19.50", "currencyCode": "USD"}
                        }],
                        "fulfillments": [{
                          "id": "gid://shopify/Fulfillment/700",
                          "status": "SUCCESS",
                          "createdAt": "2026-07-31T03:02:03Z",
                          "trackingInfo": [{"company": "UPS", "number": "1Z", "url": "https://track.example/1Z"}]
                        }]
                      }]
                    }
                    """.getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();
        try {
            var gateway = new XzErpAppChannelConnectorGateway(
                    "http://127.0.0.1:" + server.getAddress().getPort(),
                    "expected-token",
                    Duration.ofSeconds(5),
                    HttpClient.newHttpClient());

            var page = gateway.fetchShopifyOrderCatalog(
                    TENANT,
                    SHOP,
                    new ChannelConnectorGateway.OrderCatalogRequest(
                            25, null, "created_at:>=2026-07-01"));

            assertThat(page.mode()).isEqualTo(
                    ChannelConnectorGateway.ConnectorMode.XZ_ERP_APP);
            assertThat(page.connectionStatus()).isEqualTo(
                    ChannelConnectorGateway.ConnectionStatus.CONNECTED);
            assertThat(page.cursor()).isEqualTo("next==");
            assertThat(page.hasNextPage()).isTrue();
            assertThat(page.orders()).hasSize(1);
            assertThat(page.orders().getFirst().name()).isEqualTo("#1001");
            assertThat(page.orders().getFirst().lineItems().getFirst().sku())
                    .isEqualTo("HD-B-M");
            assertThat(page.orders().getFirst().lineItems().getFirst()
                    .inventoryItemRef())
                    .isEqualTo("gid://shopify/InventoryItem/802");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void rejectsMalformedOrderCatalogContractIdentityStateAndShape()
            throws IOException {
        AtomicReference<String> responseBody = new AtomicReference<>();
        HttpServer server = HttpServer.create(
                new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/api/v1/erp-connector/shopify/order-catalog",
                exchange -> {
                    byte[] response = responseBody.get().getBytes(
                            java.nio.charset.StandardCharsets.UTF_8);
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
            String validOrder = """
                    {"id":"gid://shopify/Order/1","name":"#1001","createdAt":"2026-08-01T20:00:00Z","total":{"amount":"10.00","currencyCode":"USD"},"lineItems":[],"fulfillments":[]}
                    """.strip();
            List<String> invalidResponses = List.of(
                    """
                    {"contractVersion":"shopify.connector.order_catalog.v2","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222","state":"CONNECTED","pageInfo":{"hasNextPage":false},"fetchedAt":"2026-08-01T23:00:00Z","orders":[]}
                    """,
                    """
                    {"contractVersion":"shopify.connector.order_catalog.v1","tenantId":"33333333-3333-4333-8333-333333333333","shopId":"22222222-2222-4222-8222-222222222222","state":"CONNECTED","pageInfo":{"hasNextPage":false},"fetchedAt":"2026-08-01T23:00:00Z","orders":[]}
                    """,
                    """
                    {"contractVersion":"shopify.connector.order_catalog.v1","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222","state":"UNKNOWN","pageInfo":{"hasNextPage":false},"fetchedAt":"2026-08-01T23:00:00Z","orders":[]}
                    """,
                    """
                    {"contractVersion":"shopify.connector.order_catalog.v1","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222","state":"CONNECTED","fetchedAt":"2026-08-01T23:00:00Z","orders":[]}
                    """,
                    """
                    {"contractVersion":"shopify.connector.order_catalog.v1","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222","state":"CONNECTED","pageInfo":{"hasNextPage":false},"fetchedAt":"2026-08-01T23:00:00Z"}
                    """,
                    """
                    {"contractVersion":"shopify.connector.order_catalog.v1","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222","state":"CONNECTED","pageInfo":{"hasNextPage":false},"fetchedAt":"2026-08-01T23:00:00Z","orders":[{"id":"gid://shopify/Order/1","name":"#1001","createdAt":"2026-08-01T20:00:00Z","total":{"amount":"10.00","currencyCode":"USD"},"fulfillments":[]}]}
                    """,
                    """
                    {"contractVersion":"shopify.connector.order_catalog.v1","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222","state":"CONNECTED","pageInfo":{"hasNextPage":false},"fetchedAt":"2026-08-01T23:00:00Z","orders":[{"id":"gid://shopify/Order/1","name":"#1001","createdAt":"2026-08-01T20:00:00Z","total":{"amount":"10.00","currencyCode":"USD"},"lineItems":[]}]}
                    """,
                    """
                    {"contractVersion":"shopify.connector.order_catalog.v1","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222","state":"CONNECTED","pageInfo":{"hasNextPage":false},"fetchedAt":"2026-08-01T23:00:00Z","orders":[],"accessToken":"shpat_forbidden"}
                    """);
            for (String invalidResponse : invalidResponses) {
                responseBody.set(invalidResponse);
                assertThatThrownBy(() -> gateway.fetchShopifyOrderCatalog(
                        TENANT,
                        SHOP,
                        new ChannelConnectorGateway.OrderCatalogRequest(
                                25, null, null)))
                        .isInstanceOf(ConnectorUnavailableException.class);
            }
            responseBody.set("""
                    {"contractVersion":"shopify.connector.order_catalog.v1","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222","state":"CONNECTED","pageInfo":{"hasNextPage":false},"fetchedAt":"2026-08-01T23:00:00Z","orders":[%s,%s]}
                    """.formatted(validOrder, validOrder));
            assertThatThrownBy(() -> gateway.fetchShopifyOrderCatalog(
                    TENANT,
                    SHOP,
                    new ChannelConnectorGateway.OrderCatalogRequest(
                            25, null, null)))
                    .isInstanceOf(ConnectorUnavailableException.class);
        } finally {
            server.stop(0);
        }
    }

    @Test
    void mapsProtectedCustomerDataRequirementToSafeAuthorizationConflict()
            throws IOException {
        HttpServer server = HttpServer.create(
                new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/api/v1/erp-connector/shopify/order-catalog",
                exchange -> {
                    exchange.getRequestBody().readAllBytes();
                    byte[] response = """
                            {"code":"PROTECTED_CUSTOMER_DATA_REQUIRED","message":"provider detail shpat_must_not_escape","retryable":false,"correlationId":"erp-22222222-2222-4222-8222-222222222222"}
                            """.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(403, response.length);
                    exchange.getResponseBody().write(response);
                    exchange.close();
                });
        server.start();
        try {
            var gateway = new XzErpAppChannelConnectorGateway(
                    "http://127.0.0.1:" + server.getAddress().getPort(),
                    "expected-token", Duration.ofSeconds(5),
                    HttpClient.newHttpClient());

            assertThatThrownBy(() -> gateway.fetchShopifyOrderCatalog(
                    TENANT,
                    SHOP,
                    new ChannelConnectorGateway.OrderCatalogRequest(
                            25, null, null)))
                    .isInstanceOfSatisfying(
                            ShopifyAuthorizationConflictException.class,
                            exception -> assertThat(exception.details())
                                    .containsEntry(
                                            "reason",
                                            "shopify_protected_customer_data_required"))
                    .hasMessageNotContaining("provider")
                    .hasMessageNotContaining("shpat");
        } finally {
            server.stop(0);
        }
    }
    @Test
    void updatesOrderShippingAddressThroughTheInternalConnector()
            throws IOException {
        HttpServer server = HttpServer.create(
                new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicReference<String> requestBody = new AtomicReference<>();
        server.createContext(
                "/api/v1/erp-connector/shopify/order-shipping-address",
                exchange -> {
                    if (!"expected-token".equals(exchange.getRequestHeaders()
                            .getFirst("X-XZ-ERP-Connector-Token"))) {
                        exchange.sendResponseHeaders(403, -1);
                        return;
                    }
                    requestBody.set(new String(exchange.getRequestBody().readAllBytes(),
                            java.nio.charset.StandardCharsets.UTF_8));
                    byte[] response = """
                            {
                              "contractVersion":"shopify.connector.order_shipping_address.v1",
                              "tenantId":"11111111-1111-4111-8111-111111111111",
                              "shopId":"22222222-2222-4222-8222-222222222222",
                              "orderId":"gid://shopify/Order/123",
                              "address":{
                                "name":"Ada Lovelace",
                                "firstName":"Ada",
                                "lastName":"Lovelace",
                                "address1":"1 Main Street",
                                "city":"Toronto",
                                "province":"Ontario",
                                "provinceCode":"ON",
                                "country":"Canada",
                                "countryCode":"CA",
                                "zip":"A1A1A1",
                                "formatted":[]
                              },
                              "updatedAt":"2026-07-31T10:00:00Z"
                            }
                            """.getBytes(java.nio.charset.StandardCharsets.UTF_8);
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

            var result = gateway.updateShopifyOrderShippingAddress(
                    TENANT, SHOP,
                    new ChannelConnectorGateway.OrderShippingAddressUpdateRequest(
                            "gid://shopify/Order/123",
                            "address-command-1",
                            new ChannelConnectorGateway.MailingAddress(
                                    null, "Ada", "Lovelace", null,
                                    "1 Main Street", null, "Toronto", null,
                                    "ON", null, "CA", "A1A1A1", null,
                                    List.of())));

            assertThat(result.address().name()).isEqualTo("Ada Lovelace");
            assertThat(result.address().countryCode()).isEqualTo("CA");
            assertThat(result.updatedAt().toString())
                    .isEqualTo("2026-07-31T10:00:00Z");
            assertThat(requestBody.get())
                    .contains("\"orderId\":\"gid://shopify/Order/123\"")
                    .contains("\"idempotencyKey\":\"address-command-1\"")
                    .doesNotContain("expected-token");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void rejectsMismatchedOrderShippingAddressConnectorResponse()
            throws IOException {
        HttpServer server = HttpServer.create(
                new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/api/v1/erp-connector/shopify/order-shipping-address",
                exchange -> {
                    byte[] response = """
                            {
                              "contractVersion":"shopify.connector.order_shipping_address.v1",
                              "tenantId":"33333333-3333-4333-8333-333333333333",
                              "shopId":"22222222-2222-4222-8222-222222222222",
                              "orderId":"gid://shopify/Order/123",
                              "address":{
                                "firstName":"Ada",
                                "lastName":"Lovelace",
                                "address1":"1 Main Street",
                                "city":"Toronto",
                                "provinceCode":"ON",
                                "countryCode":"CA",
                                "zip":"A1A1A1",
                                "formatted":[]
                              },
                              "updatedAt":"2026-07-31T10:00:00Z"
                            }
                            """.getBytes(java.nio.charset.StandardCharsets.UTF_8);
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
            var request = new ChannelConnectorGateway.OrderShippingAddressUpdateRequest(
                    "gid://shopify/Order/123",
                    "address-command-1",
                    new ChannelConnectorGateway.MailingAddress(
                            null, "Ada", "Lovelace", null,
                            "1 Main Street", null, "Toronto", null,
                            "ON", null, "CA", "A1A1A1", null,
                            List.of()));

            assertThatThrownBy(() -> gateway.updateShopifyOrderShippingAddress(
                    TENANT, SHOP, request))
                    .isInstanceOf(ConnectorUnavailableException.class);
        } finally {
            server.stop(0);
        }
    }

    @Test
    void publishesFulfillmentThroughTheInternalConnector()
            throws IOException {
        HttpServer server = HttpServer.create(
                new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicReference<String> requestBody = new AtomicReference<>();
        server.createContext(
                "/api/v1/erp-connector/shopify/fulfillment-publish",
                exchange -> {
                    if (!"expected-token".equals(exchange.getRequestHeaders()
                            .getFirst("X-XZ-ERP-Connector-Token"))) {
                        exchange.sendResponseHeaders(403, -1);
                        return;
                    }
                    requestBody.set(new String(
                            exchange.getRequestBody().readAllBytes(),
                            java.nio.charset.StandardCharsets.UTF_8));
                    byte[] response = """
                            {
                              "contractVersion":"shopify.connector.fulfillment_publish.v1",
                              "tenantId":"11111111-1111-4111-8111-111111111111",
                              "shopId":"22222222-2222-4222-8222-222222222222",
                              "orderId":"gid://shopify/Order/123",
                              "fulfillmentIds":["gid://shopify/Fulfillment/50"],
                              "tracking":{
                                "company":"UPS",
                                "number":"1Z123",
                                "url":"https://track.example/1Z123"
                              },
                              "recoveredFromShopify":false,
                              "updatedAt":"2026-07-31T10:00:00Z"
                            }
                            """.getBytes(
                                    java.nio.charset.StandardCharsets.UTF_8);
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

            var result = gateway.publishShopifyFulfillment(
                    TENANT, SHOP,
                    new ChannelConnectorGateway.FulfillmentPublishRequest(
                            "gid://shopify/Order/123",
                            "fulfillment-command-1", true,
                            new ChannelConnectorGateway.TrackingInfo(
                                    "UPS", "1Z123",
                                    "https://track.example/1Z123"),
                            List.of(new ChannelConnectorGateway
                                    .FulfillmentPublishLine(
                                            "gid://shopify/LineItem/40", 2))));

            assertThat(result.externalFulfillmentRefs())
                    .containsExactly("gid://shopify/Fulfillment/50");
            assertThat(result.tracking().number()).isEqualTo("1Z123");
            assertThat(result.recoveredFromShopify()).isFalse();
            assertThat(requestBody.get())
                    .contains("\"orderId\":\"gid://shopify/Order/123\"")
                    .contains("\"idempotencyKey\":\"fulfillment-command-1\"")
                    .contains("\"notifyCustomer\":true")
                    .doesNotContain("expected-token");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void rejectsMalformedFulfillmentPublishContract() throws IOException {
        AtomicReference<String> responseBody = new AtomicReference<>();
        HttpServer server = HttpServer.create(
                new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/api/v1/erp-connector/shopify/fulfillment-publish",
                exchange -> {
                    exchange.getRequestBody().readAllBytes();
                    byte[] response = responseBody.get().getBytes(
                            java.nio.charset.StandardCharsets.UTF_8);
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
            var command = new ChannelConnectorGateway.FulfillmentPublishRequest(
                    "gid://shopify/Order/123", "fulfillment-command-1", true,
                    new ChannelConnectorGateway.TrackingInfo(
                            "UPS", "1Z123", "https://track.example/1Z123"),
                    List.of(new ChannelConnectorGateway.FulfillmentPublishLine(
                            "gid://shopify/LineItem/40", 2)));
            for (String invalid : List.of(
                    """
                    {"contractVersion":"shopify.connector.fulfillment_publish.v2","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222","orderId":"gid://shopify/Order/123","fulfillmentIds":["gid://shopify/Fulfillment/50"],"tracking":{"number":"1Z123"},"recoveredFromShopify":false,"updatedAt":"2026-07-31T10:00:00Z"}
                    """,
                    """
                    {"contractVersion":"shopify.connector.fulfillment_publish.v1","tenantId":"99999999-9999-4999-8999-999999999999","shopId":"22222222-2222-4222-8222-222222222222","orderId":"gid://shopify/Order/123","fulfillmentIds":["gid://shopify/Fulfillment/50"],"tracking":{"number":"1Z123"},"recoveredFromShopify":false,"updatedAt":"2026-07-31T10:00:00Z"}
                    """,
                    """
                    {"contractVersion":"shopify.connector.fulfillment_publish.v1","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222","orderId":"gid://shopify/Order/123","fulfillmentIds":["gid://shopify/Fulfillment/50","gid://shopify/Fulfillment/51"],"tracking":{"number":"1Z123"},"recoveredFromShopify":false,"updatedAt":"2026-07-31T10:00:00Z"}
                    """,
                    """
                    {"contractVersion":"shopify.connector.fulfillment_publish.v1","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222","orderId":"gid://shopify/Order/123","fulfillmentIds":["gid://shopify/Fulfillment/not-numeric"],"tracking":{"number":"1Z123"},"recoveredFromShopify":false,"updatedAt":"2026-07-31T10:00:00Z"}
                    """,
                    """
                    {"contractVersion":"shopify.connector.fulfillment_publish.v1","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222","orderId":"gid://shopify/Order/123","fulfillmentIds":["gid://shopify/Fulfillment/50"],"tracking":{"number":"1Z123"},"updatedAt":"2026-07-31T10:00:00Z"}
                    """,
                    """
                    {"contractVersion":"shopify.connector.fulfillment_publish.v1","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222","orderId":"gid://shopify/Order/123","fulfillmentIds":["gid://shopify/Fulfillment/50"],"tracking":{"number":"1Z123"},"recoveredFromShopify":false}
                    """,
                    """
                    {"contractVersion":"shopify.connector.fulfillment_publish.v1","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222","orderId":"gid://shopify/Order/123","fulfillmentIds":["gid://shopify/Fulfillment/50"],"tracking":{"company":"UPS","number":"1Z123","url":"https://user:secret@track.example/1"},"recoveredFromShopify":false,"updatedAt":"2026-07-31T10:00:00Z"}
                    """,
                    """
                    {"contractVersion":"shopify.connector.fulfillment_publish.v1","tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222","orderId":"gid://shopify/Order/123","fulfillmentIds":["gid://shopify/Fulfillment/50"],"tracking":{"number":"1Z123"},"recoveredFromShopify":false,"updatedAt":"2026-07-31T10:00:00Z","accessToken":"shpat_forbidden"}
                    """)) {
                responseBody.set(invalid);
                assertThatThrownBy(() -> gateway.publishShopifyFulfillment(
                        TENANT, SHOP, command))
                        .isInstanceOf(ConnectorUnavailableException.class);
            }
        } finally {
            server.stop(0);
        }
    }

    @Test
    void preservesFulfillmentForbiddenAsNonRetryable() throws IOException {
        HttpServer server = HttpServer.create(
                new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/api/v1/erp-connector/shopify/fulfillment-publish",
                exchange -> {
                    exchange.getRequestBody().readAllBytes();
                    byte[] response = """
                            {"code":"FORBIDDEN","message":"provider shpat_forbidden","retryable":false,"correlationId":"erp-22222222-2222-4222-8222-222222222222"}
                            """.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(403, response.length);
                    exchange.getResponseBody().write(response);
                    exchange.close();
                });
        server.start();
        try {
            var gateway = new XzErpAppChannelConnectorGateway(
                    "http://127.0.0.1:" + server.getAddress().getPort(),
                    "expected-token", Duration.ofSeconds(5),
                    HttpClient.newHttpClient());
            assertThatThrownBy(() -> gateway.publishShopifyFulfillment(
                    TENANT, SHOP,
                    new ChannelConnectorGateway.FulfillmentPublishRequest(
                            "gid://shopify/Order/123",
                            "fulfillment-command-1", true,
                            new ChannelConnectorGateway.TrackingInfo(
                                    "UPS", "1Z123", null),
                            List.of(new ChannelConnectorGateway
                                    .FulfillmentPublishLine(
                                            "gid://shopify/LineItem/40", 2)))))
                    .isInstanceOfSatisfying(
                            ConnectorUnavailableException.class,
                            exception -> {
                                assertThat(exception.code())
                                        .isEqualTo("FORBIDDEN");
                                assertThat(exception.retryable()).isFalse();
                                assertThat(exception.correlationId())
                                        .isEqualTo("erp-" + SHOP);
                                assertThat(exception.getMessage())
                                        .doesNotContain("provider", "shpat");
                            });
        } finally {
            server.stop(0);
        }
    }

    @Test
    void editsOrderLineQuantityThroughTheInternalConnector()
            throws IOException {
        AtomicReference<String> requestBody = new AtomicReference<>();
        HttpServer server = HttpServer.create(
                new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/api/v1/erp-connector/shopify/order-edit-quantity",
                exchange -> {
                    requestBody.set(new String(
                            exchange.getRequestBody().readAllBytes(),
                            java.nio.charset.StandardCharsets.UTF_8));
                    byte[] response = """
                            {
                              "orderId":"gid://shopify/Order/123",
                              "orderLineId":"gid://shopify/LineItem/40",
                              "quantity":1,
                              "total":{"amount":"49.95","currencyCode":"USD"},
                              "recoveredFromShopify":false,
                              "updatedAt":"2026-07-31T10:00:00Z"
                            }
                            """.getBytes(
                                    java.nio.charset.StandardCharsets.UTF_8);
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

            var result = gateway.updateShopifyOrderLineQuantity(
                    TENANT, SHOP,
                    new ChannelConnectorGateway.OrderEditQuantityRequest(
                            "gid://shopify/Order/123",
                            "gid://shopify/LineItem/40",
                            "gid://shopify/ProductVariant/50",
                            2, 1, true, true, "order-edit-command-1"));

            assertThat(result.quantity()).isEqualTo(1);
            assertThat(result.total().amount()).isEqualTo("49.95");
            assertThat(requestBody.get())
                    .contains("\"expectedQuantity\":2")
                    .contains("\"quantity\":1")
                    .contains("\"restock\":true")
                    .contains("\"notifyCustomer\":true")
                    .doesNotContain("expected-token");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void addsOrderVariantThroughTheInternalConnector()
            throws IOException {
        AtomicReference<String> requestBody = new AtomicReference<>();
        HttpServer server = HttpServer.create(
                new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/api/v1/erp-connector/shopify/order-add-variant",
                exchange -> {
                    requestBody.set(new String(
                            exchange.getRequestBody().readAllBytes(),
                            java.nio.charset.StandardCharsets.UTF_8));
                    byte[] response = """
                            {
                              "orderId":"gid://shopify/Order/123",
                              "orderLineId":"gid://shopify/LineItem/40",
                              "variantId":"gid://shopify/ProductVariant/50",
                              "quantity":2,
                              "sku":"ERP-RED",
                              "title":"Travel Bag - Red",
                              "variantTitle":"Red",
                              "unitPrice":{"amount":"12.50","currencyCode":"USD"},
                              "total":{"amount":"84.95","currencyCode":"USD"},
                              "recoveredFromShopify":true,
                              "updatedAt":"2026-07-31T10:00:00Z"
                            }
                            """.getBytes(
                                    java.nio.charset.StandardCharsets.UTF_8);
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

            var result = gateway.addShopifyOrderVariant(
                    TENANT, SHOP,
                    new ChannelConnectorGateway.OrderAddVariantRequest(
                            "gid://shopify/Order/123",
                            "gid://shopify/ProductVariant/50",
                            2, true, true, "order-add-command-1"));

            assertThat(result.externalOrderLineRef())
                    .isEqualTo("gid://shopify/LineItem/40");
            assertThat(result.platformSku()).isEqualTo("ERP-RED");
            assertThat(result.unitPrice().amount()).isEqualTo("12.50");
            assertThat(result.recoveredFromShopify()).isTrue();
            assertThat(requestBody.get())
                    .contains("\"variantId\":\"gid://shopify/ProductVariant/50\"")
                    .contains("\"quantity\":2")
                    .contains("\"notifyCustomer\":true")
                    .contains("\"recoverExisting\":true")
                    .doesNotContain("expected-token");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void addsCustomOrderItemThroughTheInternalConnector()
            throws IOException {
        AtomicReference<String> requestBody = new AtomicReference<>();
        HttpServer server = HttpServer.create(
                new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/api/v1/erp-connector/shopify/order-add-custom-item",
                exchange -> {
                    requestBody.set(new String(
                            exchange.getRequestBody().readAllBytes(),
                            java.nio.charset.StandardCharsets.UTF_8));
                    byte[] response = """
                            {
                              "orderId":"gid://shopify/Order/123",
                              "orderLineId":"gid://shopify/LineItem/41",
                              "title":"Gift wrapping",
                              "unitPrice":{"amount":"12.50","currencyCode":"USD"},
                              "quantity":2,
                              "total":{"amount":"84.95","currencyCode":"USD"},
                              "recoveredFromShopify":true,
                              "updatedAt":"2026-08-01T01:00:00Z"
                            }
                            """.getBytes(
                                    java.nio.charset.StandardCharsets.UTF_8);
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

            var result = gateway.addShopifyOrderCustomItem(
                    TENANT, SHOP,
                    new ChannelConnectorGateway.OrderAddCustomItemRequest(
                            "gid://shopify/Order/123", "Gift wrapping",
                            new ChannelConnectorGateway.Money(
                                    "12.50", "USD"),
                            2, false, true, true, true,
                            "order-custom-command-1"));

            assertThat(result.externalOrderLineRef())
                    .isEqualTo("gid://shopify/LineItem/41");
            assertThat(result.title()).isEqualTo("Gift wrapping");
            assertThat(result.unitPrice().amount()).isEqualTo("12.50");
            assertThat(result.recoveredFromShopify()).isTrue();
            assertThat(requestBody.get())
                    .contains("\"title\":\"Gift wrapping\"")
                    .contains("\"unitPrice\":{\"amount\":\"12.50\",\"currencyCode\":\"USD\"}")
                    .contains("\"quantity\":2")
                    .contains("\"requiresShipping\":false")
                    .contains("\"taxable\":true")
                    .contains("\"notifyCustomer\":true")
                    .contains("\"recoverExisting\":true")
                    .doesNotContain("expected-token");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void addsOrderLineDiscountThroughTheInternalConnector()
            throws IOException {
        AtomicReference<String> requestBody = new AtomicReference<>();
        HttpServer server = HttpServer.create(
                new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/api/v1/erp-connector/shopify/order-line-discount",
                exchange -> {
                    requestBody.set(new String(
                            exchange.getRequestBody().readAllBytes(),
                            java.nio.charset.StandardCharsets.UTF_8));
                    byte[] response = """
                            {
                              "orderId":"gid://shopify/Order/123",
                              "orderLineId":"gid://shopify/LineItem/41",
                              "description":"VIP adjustment",
                              "discountType":"FIXED",
                              "fixedValue":{"amount":"5.00","currencyCode":"USD"},
                              "discountTotal":{"amount":"5.00","currencyCode":"USD"},
                              "total":{"amount":"79.95","currencyCode":"USD"},
                              "recoveredFromShopify":true,
                              "updatedAt":"2026-08-01T02:00:00Z"
                            }
                            """.getBytes(
                                    java.nio.charset.StandardCharsets.UTF_8);
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

            var result = gateway.addShopifyOrderLineDiscount(
                    TENANT, SHOP,
                    new ChannelConnectorGateway.OrderLineDiscountRequest(
                            "gid://shopify/Order/123",
                            "gid://shopify/LineItem/41",
                            "gid://shopify/ProductVariant/42", 2,
                            new ChannelConnectorGateway.Money("0.00", "USD"),
                            "VIP adjustment",
                            ChannelConnectorGateway.OrderLineDiscountType.FIXED,
                            new ChannelConnectorGateway.Money("5.00", "USD"),
                            null, true, true, "order-discount-command-1"));

            assertThat(result.discountTotal().amount()).isEqualTo("5.00");
            assertThat(result.total().amount()).isEqualTo("79.95");
            assertThat(result.recoveredFromShopify()).isTrue();
            assertThat(requestBody.get())
                    .contains("\"description\":\"VIP adjustment\"")
                    .contains("\"discountType\":\"FIXED\"")
                    .contains("\"fixedValue\":{\"amount\":\"5.00\",\"currencyCode\":\"USD\"}")
                    .contains("\"recoverExisting\":true")
                    .doesNotContain("expected-token");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void cancelsOrderThroughTheInternalConnector() throws IOException {
        AtomicReference<String> requestBody = new AtomicReference<>();
        HttpServer server = HttpServer.create(
                new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/api/v1/erp-connector/shopify/order-cancel",
                exchange -> {
                    requestBody.set(new String(
                            exchange.getRequestBody().readAllBytes(),
                            java.nio.charset.StandardCharsets.UTF_8));
                    byte[] response = """
                            {
                              "orderId":"gid://shopify/Order/123",
                              "reason":"CUSTOMER",
                              "cancelledAt":"2026-08-01T02:00:00Z",
                              "jobId":"gid://shopify/Job/456",
                              "recoveredFromShopify":true,
                              "updatedAt":"2026-08-01T02:00:01Z"
                            }
                            """.getBytes(
                                    java.nio.charset.StandardCharsets.UTF_8);
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

            var result = gateway.cancelShopifyOrder(
                    TENANT, SHOP,
                    new ChannelConnectorGateway.OrderCancellationRequest(
                            "gid://shopify/Order/123",
                            ChannelConnectorGateway.OrderCancellationReason.CUSTOMER,
                            "Customer requested cancellation",
                            true, true, true, true,
                            "order-cancel-command-1"));

            assertThat(result.externalOrderRef())
                    .isEqualTo("gid://shopify/Order/123");
            assertThat(result.reason())
                    .isEqualTo(ChannelConnectorGateway.OrderCancellationReason.CUSTOMER);
            assertThat(result.recoveredFromShopify()).isTrue();
            assertThat(requestBody.get())
                    .contains("\"orderId\":\"gid://shopify/Order/123\"")
                    .contains("\"reason\":\"CUSTOMER\"")
                    .contains("\"staffNote\":\"Customer requested cancellation\"")
                    .contains("\"refundOriginalPaymentMethods\":true")
                    .contains("\"restock\":true")
                    .contains("\"notifyCustomer\":true")
                    .contains("\"recoverExisting\":true")
                    .doesNotContain("expected-token");
        } finally {
            server.stop(0);
        }
    }
}
