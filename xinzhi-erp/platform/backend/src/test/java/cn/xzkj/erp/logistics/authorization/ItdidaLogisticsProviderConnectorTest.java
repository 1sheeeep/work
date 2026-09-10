package cn.xzkj.erp.logistics.authorization;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import cn.xzkj.erp.logistics.authorization.ItdidaLogisticsProviderConnector.Endpoint;
import cn.xzkj.erp.logistics.authorization.LogisticsCredentialCipher.CredentialMaterial;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderConnectorGateway.ProbeRequest;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderOperations.Item;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderOperations.Shipment;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class ItdidaLogisticsProviderConnectorTest {
    @Test
    void exchangesCredentialsForTokenAndReadsReceivingChannels()
            throws IOException {
        HttpServer server = server();
        AtomicReference<String> loginBody = new AtomicReference<>();
        AtomicReference<String> authorization = new AtomicReference<>();
        server.createContext("/itdida-api/login", exchange -> {
            assertThat(exchange.getRequestMethod()).isEqualTo("POST");
            assertThat(exchange.getRequestHeaders().getFirst("Content-Type"))
                    .startsWith("application/x-www-form-urlencoded");
            loginBody.set(new String(exchange.getRequestBody().readAllBytes(),
                    StandardCharsets.UTF_8));
            respond(exchange, 200, """
                    {"success":true,"statusCode":200,
                     "data":"header.payload.signature-value"}
                    """);
        });
        server.createContext("/itdida-api/getReceivingChannels", exchange -> {
            assertThat(exchange.getRequestMethod()).isEqualTo("GET");
            authorization.set(exchange.getRequestHeaders()
                    .getFirst("Authorization"));
            respond(exchange, 200, """
                    {"success":true,"statusCode":200,"data":[
                      {"channelName":"美国专线"},{"channelName":"欧洲专线"}
                    ]}
                    """);
        });
        server.start();
        try {
            var result = connector(server, "BIAOJU", "镖锔科技物流")
                    .probe(request("BIAOJU", "user@example.com", "secret value"));

            assertThat(result.status()).isEqualTo("CONNECTED");
            assertThat(result.message()).contains("2 个可用渠道");
            assertThat(result.channels()).extracting("code", "name")
                    .containsExactly(
                            org.assertj.core.groups.Tuple.tuple("美国专线", "美国专线"),
                            org.assertj.core.groups.Tuple.tuple("欧洲专线", "欧洲专线"));
            assertThat(loginBody.get()).isEqualTo(
                    "username=user%40example.com&password=secret+value");
            assertThat(authorization.get()).isEqualTo(
                    "Bearer header.payload.signature-value");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void reportsRejectedLoginAndDoesNotCallChannels() throws IOException {
        HttpServer server = server();
        AtomicInteger channelCalls = new AtomicInteger();
        server.createContext("/itdida-api/login", exchange -> respond(exchange,
                508, "{\"success\":false,\"statusCode\":508}"));
        server.createContext("/itdida-api/getReceivingChannels", exchange -> {
            channelCalls.incrementAndGet();
            respond(exchange, 200, "{\"success\":true,\"data\":[]}");
        });
        server.start();
        try {
            var result = connector(server, "BAIDU_YIXIA", "摆渡一下")
                    .probe(request("BAIDU_YIXIA", "bad-user", "bad-password"));

            assertThat(result.status()).isEqualTo("REJECTED");
            assertThat(result.message()).doesNotContain(
                    "bad-user", "bad-password");
            assertThat(channelCalls).hasValue(0);
        } finally {
            server.stop(0);
        }
    }

    @Test
    void failsClosedWhenChannelResponseDoesNotMatchTheContract()
            throws IOException {
        HttpServer server = server();
        server.createContext("/itdida-api/login", exchange -> respond(exchange,
                200, "{\"success\":true,\"statusCode\":200,"
                        + "\"data\":\"header.payload.signature-value\"}"));
        server.createContext("/itdida-api/getReceivingChannels",
                exchange -> respond(exchange, 200,
                        "{\"success\":true,\"data\":{}}"));
        server.start();
        try {
            var result = connector(server, "BIAOJU", "镖锔科技物流")
                    .probe(request("BIAOJU", "user", "password"));

            assertThat(result.status()).isEqualTo("UNAVAILABLE");
            assertThat(result.message()).contains("账号已验证");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void createsAndTracksItdidaShipment() throws IOException {
        HttpServer server = server();
        AtomicReference<String> createBody = new AtomicReference<>();
        server.createContext("/itdida-api/login", exchange -> respond(exchange,
                200, "{\"success\":true,\"statusCode\":200,"
                        + "\"data\":\"header.payload.signature-value\"}"));
        server.createContext("/itdida-api/yundans", exchange -> {
            createBody.set(new String(exchange.getRequestBody().readAllBytes(),
                    StandardCharsets.UTF_8));
            respond(exchange, 200, """
                    {"success":true,"data":[{"xiTongDanHao":"ORDER-1",
                      "zhuanDanHao":"TRACK-1",
                      "labelUrl":"https://labels.example/1.pdf"}]}
                    """);
        });
        server.createContext("/itdida-api/queryTracks", exchange -> respond(
                exchange, 200, """
                {"success":true,"data":{"detail":{"trackingNumber":"TRACK-1",
                  "status":"IN_TRANSIT","trackList":[
                    {"desc":"包裹运输中","eventCode":"TRANSIT",
                     "time":"2026-08-14 10:00:00",
                     "eventCountry":"CN","eventCity":"深圳"}
                  ]}}}
                """));
        server.start();
        try {
            var connector = connector(server, "BIAOJU", "镖锔科技物流");
            var credentials = new CredentialMaterial("user", "password", null);

            var created = connector.create("BIAOJU", credentials,
                    channel("BIAOJU", "US-01", "美国专线"), shipment());
            var tracking = connector.track("BIAOJU", credentials,
                    "ERP-1", created.providerOrderReference(),
                    created.trackingReference());

            assertThat(created.providerOrderReference()).isEqualTo("ORDER-1");
            assertThat(created.trackingReference()).isEqualTo("TRACK-1");
            assertThat(created.labelUrl()).isEqualTo(
                    "https://labels.example/1.pdf");
            assertThat(createBody.get()).contains(
                    "\"keHuDanHao\":\"ERP-1\"",
                    "\"shouHuoQuDao\":\"US-01\"");
            assertThat(tracking.normalizedStatus()).isEqualTo("IN_TRANSIT");
            assertThat(tracking.summary()).isEqualTo("包裹运输中");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void requiresHttpsForProviderEndpoints() {
        assertThatThrownBy(() -> ItdidaLogisticsProviderConnector.endpoint(
                "镖锔科技物流", "http://yf56.itdida.com/itdida-api"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("HTTPS");
    }

    private static ItdidaLogisticsProviderConnector connector(HttpServer server,
            String providerCode, String providerName) {
        Endpoint endpoint = new Endpoint(providerName,
                "http://127.0.0.1:" + server.getAddress().getPort()
                        + "/itdida-api");
        return new ItdidaLogisticsProviderConnector(
                Map.of(providerCode, endpoint), Duration.ofSeconds(5),
                HttpClient.newHttpClient());
    }

    private static ProbeRequest request(String providerCode, String username,
            String password) {
        return new ProbeRequest(UUID.randomUUID(), UUID.randomUUID(), providerCode,
                new CredentialMaterial(username, password, null), "uat-itdida");
    }

    private static LogisticsAuthorizationChannelRecord channel(
            String providerCode, String code, String name) {
        Instant now = Instant.parse("2026-08-14T00:00:00Z");
        return new LogisticsAuthorizationChannelRecord(
                UUID.randomUUID(), UUID.randomUUID(), providerCode, "物流商",
                "测试账号", "ACTIVE", code, name, true, true, true,
                0, now, now);
    }

    private static Shipment shipment() {
        return new Shipment("ERP-1", "Ada", "Example", "+1 555 0100",
                "ada@example.com", "1 Main Street", null,
                "San Francisco", "CA", "94105", "US", 1200, 2, "USD",
                List.of(new Item("SKU-1", "T-shirt", 2, 1250, "USD")));
    }

    private static HttpServer server() throws IOException {
        return HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
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
