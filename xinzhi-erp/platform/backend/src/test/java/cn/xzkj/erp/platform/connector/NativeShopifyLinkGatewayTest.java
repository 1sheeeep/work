package cn.xzkj.erp.platform.connector;

import static org.assertj.core.api.Assertions.*;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class NativeShopifyLinkGatewayTest {
    final String proof = "A".repeat(43), domain = "native-link-test.myshopify.com";
    final String scopeJson = ChannelConnectorGateway.SHOPIFY_SCOPE_PLAN.stream()
            .map(scope -> "\"" + scope.scope() + "\"").collect(java.util.stream.Collectors.joining(",", "[", "]"));
    final UUID tenant = UUID.randomUUID(), shop = UUID.randomUUID(), actor = UUID.randomUUID();
    final AtomicReference<String> request = new AtomicReference<>(), path = new AtomicReference<>();
    String response;
    int status = 200;
    HttpServer server;
    XzErpAppChannelConnectorGateway gateway;

    @BeforeEach void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            assertThat(exchange.getRequestMethod()).isEqualTo("POST");
            assertThat(exchange.getRequestURI().getRawQuery()).isNull();
            assertThat(exchange.getRequestHeaders().getFirst("X-XZ-ERP-Connector-Token")).isEqualTo("fixture-service-token");
            request.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            path.set(exchange.getRequestURI().getPath());
            byte[] body = response.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(status, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        gateway = new XzErpAppChannelConnectorGateway("http://127.0.0.1:" + server.getAddress().getPort(),
                "fixture-service-token", Duration.ofSeconds(3), HttpClient.newHttpClient());
    }
    @AfterEach void stop() { server.stop(0); }

    String preview(String expiry) {
        return """
                {"contractVersion":"shopify.connector.native_link.v1","pending":{
                "shopDomain":"%s","shopName":"Verified shop","grantedScopes":%s,"expiresAt":"%s"}}
                """.formatted(domain, scopeJson, expiry);
    }
    String confirmed() {
        String now = Instant.now().minusSeconds(1).toString();
        return """
                {"contractVersion":"shopify.connector.native_link.v1","installation":{
                "contractVersion":"shopify.connector.installation.v1","tenantId":"%s","shopId":"%s",
                "shopDomain":"%s","shopName":"Verified shop","state":"INSTALLED",
                "grantedScopes":%s,"installedAt":"%s","updatedAt":"%s"}}
                """.formatted(tenant, shop, domain, scopeJson, now, now);
    }

    @Test void previewForwardsOnlyProofAndAcceptsVerifiedPendingSummary() {
        response = preview(Instant.now().plusSeconds(600).toString());
        assertThat(gateway.previewNativeShopifyLink(proof).shopDomain()).isEqualTo(domain);
        assertThat(request.get()).isEqualTo("{\"proof\":\"" + proof + "\"}");
        assertThat(path.get()).endsWith("/native-link/preview");
    }
    @Test void rejectsExpiredOrOverlongPendingAndUnknownFields() {
        for (String invalid : new String[] { preview(Instant.now().minusSeconds(1).toString()),
                preview(Instant.now().plusSeconds(1800).toString()),
                preview(Instant.now().plusSeconds(60).toString()).replace(scopeJson, "[\"read_products\"]"),
                preview(Instant.now().plusSeconds(60).toString()).replace("\"pending\":", "\"accessToken\":\"not-allowed\",\"pending\":") }) {
            response = invalid;
            assertThatThrownBy(() -> gateway.previewNativeShopifyLink(proof)).isInstanceOf(ConnectorUnavailableException.class);
        }
    }
    @Test void confirmationUsesCanonicalIdsNativeActorAndLegacyShopId() {
        response = confirmed();
        assertThat(gateway.confirmNativeShopifyLink(tenant, shop, actor, domain, proof).shopify().status())
                .isEqualTo(ChannelConnectorGateway.ConnectionStatus.CONNECTED);
        assertThat(request.get()).contains("\"actorId\":\"" + actor, "\"legacyShopId\":\"" + shop,
                "\"tenantId\":\"" + tenant, "\"shopDomain\":\"" + domain, "\"proof\":\"" + proof)
                .doesNotContain("fixture-service-token");
    }
    @Test void rejectsWrongOwnerDomainStateOrUnknownCredentialsInReceipt() {
        for (String invalid : new String[] { confirmed().replace(tenant.toString(), UUID.randomUUID().toString()),
                confirmed().replace(domain, "foreign.myshopify.com"), confirmed().replace("INSTALLED", "NOT_CONFIGURED"),
                confirmed().replace(scopeJson, "[\"read_products\"]"),
                confirmed().replace("\"shopName\":", "\"accessToken\":\"not-allowed\",\"shopName\":") }) {
            response = invalid;
            assertThatThrownBy(() -> gateway.confirmNativeShopifyLink(tenant, shop, actor, domain, proof))
                    .isInstanceOf(ConnectorUnavailableException.class);
        }
    }
    @Test void errorsAreSafeAndOnlyExactConflictIsNonRetryable() {
        status = 409;
        response = "{\"code\":\"NATIVE_LINK_UNAVAILABLE\",\"error\":\"private provider detail\",\"retryable\":false}";
        assertThatThrownBy(() -> gateway.previewNativeShopifyLink(proof)).isInstanceOfSatisfying(
                ConnectorUnavailableException.class, error -> {
                    assertThat(error.code()).isEqualTo("NATIVE_LINK_UNAVAILABLE");
                    assertThat(error.retryable()).isFalse();
                    assertThat(error.getMessage()).doesNotContain("private", proof);
                });
        status = 503;
        assertThatThrownBy(() -> gateway.confirmNativeShopifyLink(tenant, shop, actor, domain, proof))
                .isInstanceOfSatisfying(ConnectorUnavailableException.class, error -> assertThat(error.retryable()).isTrue());
    }
    @Test void invalidProofNeverLeavesErp() {
        assertThatThrownBy(() -> gateway.previewNativeShopifyLink("secret-invalid"))
                .isInstanceOf(IllegalArgumentException.class).hasMessageNotContaining("secret-invalid");
        assertThat(request.get()).isNull();
    }
}
