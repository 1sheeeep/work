package cn.xzkj.erp.logistics.authorization;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import cn.xzkj.erp.logistics.authorization.LogisticsCredentialCipher.CredentialMaterial;
import cn.xzkj.erp.logistics.authorization.LogisticsCredentialCipher.ProviderCredentialMaterial;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderConnectorGateway.ProbeRequest;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderOperations.Item;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderOperations.Shipment;
import cn.xzkj.erp.testing.LogCapture;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class ChudaLogisticsProviderConnectorTest {
    @Test
    void productionClientDoesNotFollowRedirects() {
        assertThat(ChudaLogisticsProviderConnector.connectorHttpClient()
                .followRedirects()).isEqualTo(HttpClient.Redirect.NEVER);
    }

    @Test
    void rejectsInsecurePublicBaseUrl() {
        assertThatThrownBy(() -> new ChudaLogisticsProviderConnector(
                "http://erp.ocl56.com/api/api-server", Duration.ofSeconds(5),
                HttpClient.newHttpClient()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("requires an HTTPS base URL");
    }

    @Test
    void exchangesCredentialsForTokenAndValidatesAvailableChannels()
            throws IOException {
        HttpServer server = server();
        AtomicReference<String> tokenBody = new AtomicReference<>();
        AtomicReference<String> authorization = new AtomicReference<>();
        server.createContext("/api/api-server/oauth/token", exchange -> {
            assertThat(exchange.getRequestMethod()).isEqualTo("POST");
            assertThat(exchange.getRequestHeaders().getFirst("Authorization")).isNull();
            tokenBody.set(new String(exchange.getRequestBody().readAllBytes(),
                    StandardCharsets.UTF_8));
            respond(exchange, 200, "header.payload.signature-value");
        });
        server.createContext("/api/api-server/channel/list", exchange -> {
            assertThat(exchange.getRequestMethod()).isEqualTo("POST");
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            respond(exchange, 200, """
                    [
                      {"channelCode":"US-01","channelName":"美国专线"},
                      {"channelCode":"EU-02","channelName":"欧洲专线"}
                    ]
                    """);
        });
        server.start();
        try {
            var connector = connector(server);

            var result = connector.probe(request("warehouse-user", "secret value"),
                    providerCredentials());

            assertThat(result.status()).isEqualTo("CONNECTED");
            assertThat(result.message()).contains("2 个可用渠道");
            assertThat(result.channels())
                    .containsExactly(
                            new LogisticsProviderConnectorGateway.DiscoveredChannel(
                                    "US-01", "美国专线"),
                            new LogisticsProviderConnectorGateway.DiscoveredChannel(
                                    "EU-02", "欧洲专线"));
            assertThat(tokenBody.get())
                    .contains("\"username\":\"warehouse-user\"",
                            "\"password\":\"secret value\"");
            assertThat(authorization.get()).isEqualTo("header.payload.signature-value");
            assertThat(request("warehouse-user", "secret value").toString())
                    .doesNotContain("warehouse-user", "secret value");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void remainsCompatibleWithAJsonEncodedToken() throws IOException {
        HttpServer server = server();
        AtomicReference<String> authorization = new AtomicReference<>();
        server.createContext("/api/api-server/oauth/token",
                exchange -> respond(exchange, 200,
                        "\"header.payload.signature-value\""));
        server.createContext("/api/api-server/channel/list", exchange -> {
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            respond(exchange, 200, "[]");
        });
        server.start();
        try {
            var result = connector(server).probe(request("user", "password"),
                    providerCredentials());

            assertThat(result.status()).isEqualTo("CONNECTED");
            assertThat(authorization.get()).isEqualTo(
                    "header.payload.signature-value");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void readsTokenFromAProductionStyleJsonEnvelope() throws IOException {
        HttpServer server = server();
        AtomicReference<String> authorization = new AtomicReference<>();
        server.createContext("/api/api-server/oauth/token",
                exchange -> respond(exchange, 200, """
                        {"success":true,"data":"header.payload.signature-value"}
                        """));
        server.createContext("/api/api-server/channel/list", exchange -> {
            authorization.set(exchange.getRequestHeaders()
                    .getFirst("Authorization"));
            respond(exchange, 200, "[]");
        });
        server.start();
        try {
            var result = connector(server).probe(request("user", "password"),
                    providerCredentials());

            assertThat(result.status()).isEqualTo("CONNECTED");
            assertThat(authorization.get()).isEqualTo(
                    "header.payload.signature-value");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void stripsUtf8BomFromPlainToken() throws IOException {
        HttpServer server = server();
        AtomicReference<String> authorization = new AtomicReference<>();
        server.createContext("/api/api-server/oauth/token",
                exchange -> respond(exchange, 200,
                        "\uFEFFheader.payload.signature-value"));
        server.createContext("/api/api-server/channel/list", exchange -> {
            authorization.set(exchange.getRequestHeaders()
                    .getFirst("Authorization"));
            respond(exchange, 200, "[]");
        });
        server.start();
        try {
            var result = connector(server).probe(request("user", "password"),
                    providerCredentials());

            assertThat(result.status()).isEqualTo("CONNECTED");
            assertThat(authorization.get()).isEqualTo(
                    "header.payload.signature-value");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void skipsNullEntriesWhileKeepingUsableChannels() throws IOException {
        HttpServer server = server();
        server.createContext("/api/api-server/oauth/token",
                exchange -> respond(exchange, 200,
                        "\"header.payload.signature-value\""));
        server.createContext("/api/api-server/channel/list",
                exchange -> respond(exchange, 200, """
                        [
                          null,
                          {"channelCode":"US-01","channelName":"美国专线"}
                        ]
                        """));
        server.start();
        try (LogCapture logs = LogCapture.start()) {
            var result = connector(server).probe(request("user", "password"),
                    providerCredentials());

            assertThat(result.status()).isEqualTo("CONNECTED");
            assertThat(result.channels()).containsExactly(
                    new LogisticsProviderConnectorGateway.DiscoveredChannel(
                            "US-01", "美国专线"));
            assertThat(logs.rendered())
                    .contains("chuda_channel_entries_skipped",
                            "skipped_entries=1", "total_entries=2")
                    .doesNotContain("header.payload.signature-value",
                            "password");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void readsChannelsFromAProductionStyleJsonEnvelope() throws IOException {
        HttpServer server = server();
        server.createContext("/api/api-server/oauth/token",
                exchange -> respond(exchange, 200,
                        "{\"success\":true,\"data\":\"header.payload.signature-value\"}"));
        server.createContext("/api/api-server/channel/list",
                exchange -> respond(exchange, 200, """
                        {
                          "success": true,
                          "data": {
                            "records": [
                              {"channelCode":"US-01","channelName":"美国专线"},
                              {"channelCode":"EU-02","channelName":"欧洲专线"}
                            ]
                          }
                        }
                        """));
        server.start();
        try {
            var result = connector(server).probe(request("user", "password"),
                    providerCredentials());

            assertThat(result.status()).isEqualTo("CONNECTED");
            assertThat(result.channels()).containsExactly(
                    new LogisticsProviderConnectorGateway.DiscoveredChannel(
                            "US-01", "美国专线"),
                    new LogisticsProviderConnectorGateway.DiscoveredChannel(
                            "EU-02", "欧洲专线"));
        } finally {
            server.stop(0);
        }
    }

    @Test
    void reportsRejectedCredentialsWithoutCallingChannelApi() throws IOException {
        HttpServer server = server();
        AtomicInteger channelCalls = new AtomicInteger();
        server.createContext("/api/api-server/oauth/token",
                exchange -> respond(exchange, 401,
                        "{\"code\":401,\"msg\":\"unauthorized\"}"));
        server.createContext("/api/api-server/channel/list", exchange -> {
            channelCalls.incrementAndGet();
            respond(exchange, 200, "[]");
        });
        server.start();
        try {
            var result = connector(server).probe(request("bad-user", "bad-password"),
                    providerCredentials());

            assertThat(result.status()).isEqualTo("REJECTED");
            assertThat(result.message()).doesNotContain("bad-user", "bad-password");
            assertThat(channelCalls).hasValue(0);
        } finally {
            server.stop(0);
        }
    }

    @Test
    void failsClosedWhenProviderResponseDoesNotMatchTheDocumentedContract()
            throws IOException {
        HttpServer server = server();
        server.createContext("/api/api-server/oauth/token",
                exchange -> respond(exchange, 200,
                        "\"header.payload.signature-value\""));
        server.createContext("/api/api-server/channel/list",
                exchange -> respond(exchange, 200,
                        "{\"channelCode\":\"US-01\",\"channelName\":\"invalid\"}"));
        server.start();
        try (LogCapture logs = LogCapture.start()) {
            var result = connector(server).probe(request("user", "password"),
                    providerCredentials());

            assertThat(result.status()).isEqualTo("UNAVAILABLE");
            assertThat(result.message()).contains("账号已验证");
            assertThat(logs.rendered())
                    .contains("phase=channels",
                            "reason=INVALID_CHANNEL_RESPONSE",
                            "upstream_status=200",
                            "content_type=application/json",
                            "response_bytes=")
                    .doesNotContain("header.payload.signature-value",
                            "password", "\"channelName\":\"invalid\"");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void recordsSafeUpstreamStatusWithoutLoggingResponseBody()
            throws IOException {
        HttpServer server = server();
        server.createContext("/api/api-server/oauth/token",
                exchange -> respond(exchange, 200,
                        "\"header.payload.signature-value\""));
        server.createContext("/api/api-server/channel/list",
                exchange -> respond(exchange, 503,
                        "provider-private-error-detail"));
        server.start();
        try (LogCapture logs = LogCapture.start()) {
            var result = connector(server).probe(
                    request("warehouse-user", "secret value"),
                    providerCredentials());

            assertThat(result.status()).isEqualTo("UNAVAILABLE");
            assertThat(logs.rendered())
                    .contains("phase=channels",
                            "reason=UPSTREAM_HTTP_STATUS",
                            "upstream_status=503",
                            "content_type=application/json",
                            "response_bytes=29")
                    .doesNotContain("provider-private-error-detail",
                            "warehouse-user", "secret value",
                            "header.payload.signature-value");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void createsAndTracksChudaShipment() throws IOException {
        HttpServer server = server();
        AtomicReference<String> createBody = new AtomicReference<>();
        server.createContext("/api/api-server/oauth/token",
                exchange -> respond(exchange, 200,
                        "header.payload.signature-value"));
        server.createContext("/api/api-server/waybill/create", exchange -> {
            createBody.set(new String(exchange.getRequestBody().readAllBytes(),
                    StandardCharsets.UTF_8));
            respond(exchange, 200, """
                    {"success":true,"data":{"id":"ORDER-1",
                      "waybillNo":"TRACK-1",
                      "waybillLabelUrl":"https://labels.example/1.pdf"}}
                    """);
        });
        server.createContext("/api/api-server/itdida-api/queryTracks",
                exchange -> respond(exchange, 200, """
                {"success":true,"data":{"detail":{"trackingNumber":"TRACK-1",
                  "status":"IN_TRANSIT","trackList":[
                    {"desc":"包裹运输中","eventCode":"TRANSIT",
                     "time":"2026-08-14 10:00:00",
                     "eventCountry":"CN","eventCity":"深圳"}
                  ]}}}
                """));
        server.start();
        try {
            var connector = connector(server);
            var credentials = new CredentialMaterial("user", "password", null);

            var created = connector.create(credentials, providerCredentials(),
                    channel(), shipment());
            var tracking = connector.track(credentials, providerCredentials(),
                    "ERP-1", created.providerOrderReference(),
                    created.trackingReference());

            assertThat(created.providerOrderReference()).isEqualTo("ORDER-1");
            assertThat(created.trackingReference()).isEqualTo("TRACK-1");
            assertThat(createBody.get()).contains(
                    "\"clientBillNo\":\"ERP-1\"",
                    "\"receiveChannelCode\":\"US-01\"");
            assertThat(tracking.normalizedStatus()).isEqualTo("IN_TRANSIT");
            assertThat(tracking.summary()).isEqualTo("包裹运输中");
        } finally {
            server.stop(0);
        }
    }

    private static HttpServer server() throws IOException {
        return HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    }

    private static ChudaLogisticsProviderConnector connector(HttpServer server) {
        return new ChudaLogisticsProviderConnector(
                "http://127.0.0.1:" + server.getAddress().getPort()
                        + "/api/api-server",
                Duration.ofSeconds(5), HttpClient.newHttpClient());
    }

    private static ProbeRequest request(String username, String password) {
        return new ProbeRequest(UUID.randomUUID(), UUID.randomUUID(), "CHUDA",
                new CredentialMaterial(username, password, null), "uat-probe");
    }

    private static ProviderCredentialMaterial providerCredentials() {
        return new ProviderCredentialMaterial(
                "customer", "authorization", "provider-secret");
    }

    private static LogisticsAuthorizationChannelRecord channel() {
        Instant now = Instant.parse("2026-08-14T00:00:00Z");
        return new LogisticsAuthorizationChannelRecord(
                UUID.randomUUID(), UUID.randomUUID(), "CHUDA", "触达物流",
                "测试账号", "ACTIVE", "US-01", "美国专线",
                true, true, true, 0, now, now);
    }

    private static Shipment shipment() {
        return new Shipment("ERP-1", "Ada", "Example", "+1 555 0100",
                "ada@example.com", "1 Main Street", null,
                "San Francisco", "CA", "94105", "US", 1200, 2, "USD",
                List.of(new Item("SKU-1", "T-shirt", 2, 1250, "USD")));
    }

    private static void respond(HttpExchange exchange, int status, String body)
            throws IOException {
        byte[] response = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, response.length);
        exchange.getResponseBody().write(response);
        exchange.close();
    }
}
