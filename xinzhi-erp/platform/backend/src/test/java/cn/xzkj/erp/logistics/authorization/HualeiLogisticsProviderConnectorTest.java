package cn.xzkj.erp.logistics.authorization;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import cn.xzkj.erp.logistics.authorization.HualeiLogisticsProviderConnector.Endpoint;
import cn.xzkj.erp.logistics.authorization.LogisticsCredentialCipher.CredentialMaterial;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderConnectorGateway.ProbeRequest;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderOperations.Item;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderOperations.Shipment;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class HualeiLogisticsProviderConnectorTest {
    @Test
    void authenticatesAgainstThePublishedSelectAuthContract() throws IOException {
        HttpServer server = server();
        AtomicReference<String> query = new AtomicReference<>();
        server.createContext("/selectAuth.htm", exchange -> {
            assertThat(exchange.getRequestMethod()).isEqualTo("GET");
            query.set(exchange.getRequestURI().getRawQuery());
            respond(exchange, 200, """
                    {'customer_id':'6581','customer_userid':'6901','ack':'true'}
                    """);
        });
        server.createContext("/getProductList.htm", exchange -> respond(exchange,
                200, """
                        [
                          {"product_id":"3161","product_shortname":"美国专线","express_type":"XBGH"},
                          {"product_id":"1821","product_shortname":"欧洲专线","product_note":"带电"}
                        ]
                        """, Charset.forName("GBK"), "text/html;charset=GBK"));
        server.start();
        try {
            var connector = connector(server, "JIAYUN_SHENGTU", "嘉运晟途");

            var result = connector.probe(request("JIAYUN_SHENGTU",
                    "warehouse user", "secret+value"));

            assertThat(result.status()).isEqualTo("CONNECTED");
            assertThat(result.message()).contains("嘉运晟途", "2 个可用渠道");
            assertThat(result.channels()).containsExactly(
                    new LogisticsProviderConnectorGateway.DiscoveredChannel(
                            "3161", "美国专线"),
                    new LogisticsProviderConnectorGateway.DiscoveredChannel(
                            "1821", "欧洲专线"));
            assertThat(query.get()).isEqualTo(
                    "username=warehouse+user&password=secret%2Bvalue");
            assertThat(request("JIAYUN_SHENGTU", "warehouse user", "secret+value")
                    .toString()).doesNotContain("warehouse user", "secret+value");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void rejectsInvalidCredentialsWithoutLeakingThem() throws IOException {
        HttpServer server = server();
        AtomicInteger channelCalls = new AtomicInteger();
        server.createContext("/selectAuth.htm", exchange -> respond(exchange, 200,
                "{'customer_id':'','customer_userid':'','ack':'false'}"));
        server.createContext("/getProductList.htm", exchange -> {
            channelCalls.incrementAndGet();
            respond(exchange, 200, "[]");
        });
        server.start();
        try {
            var result = connector(server, "HUALEI", "华磊")
                    .probe(request("HUALEI", "bad-user", "bad-password"));

            assertThat(result.status()).isEqualTo("REJECTED");
            assertThat(result.message()).doesNotContain(
                    "bad-user", "bad-password");
            assertThat(channelCalls).hasValue(0);
        } finally {
            server.stop(0);
        }
    }

    @Test
    void acceptsAlphanumericIdsAndBooleanAck() throws IOException {
        HttpServer server = server();
        server.createContext("/selectAuth.htm", exchange -> respond(exchange, 200,
                "{customer_id:'DYJ-A1',customer_userid:'user_01',ack:true}"));
        server.createContext("/getProductList.htm",
                exchange -> respond(exchange, 200, "[]"));
        server.start();
        try {
            var result = connector(server, "DAYUNJIA", "深圳达运佳国际物流")
                    .probe(request("DAYUNJIA", "user", "password"));

            assertThat(result.status()).isEqualTo("CONNECTED");
            assertThat(result.channels()).isEmpty();
        } finally {
            server.stop(0);
        }
    }

    @Test
    void reportsChannelContractFailureAfterSuccessfulAuthentication()
            throws IOException {
        HttpServer server = server();
        server.createContext("/selectAuth.htm", exchange -> respond(exchange, 200,
                "{'customer_id':'6581','customer_userid':'6901','ack':'true'}"));
        server.createContext("/getProductList.htm",
                exchange -> respond(exchange, 200, "{\"unexpected\":true}"));
        server.start();
        try {
            var result = connector(server, "DAYUNJIA", "深圳达运佳国际物流")
                    .probe(request("DAYUNJIA", "user", "password"));

            assertThat(result.status()).isEqualTo("UNAVAILABLE");
            assertThat(result.message()).contains("账号已验证", "无法读取可用渠道");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void createsTracksAndConfirmsHualeiShipment() throws IOException {
        HttpServer server = server();
        AtomicReference<String> createQuery = new AtomicReference<>();
        AtomicInteger handovers = new AtomicInteger();
        server.createContext("/selectAuth.htm", exchange -> respond(exchange, 200,
                "{'customer_id':'6581','customer_userid':'6901','ack':'true'}"));
        server.createContext("/createOrderApi.htm", exchange -> {
            createQuery.set(exchange.getRequestURI().getRawQuery());
            respond(exchange, 200, """
                    {"ack":true,"order_id":"ORDER-1",
                     "tracking_number":"TRACK-1","message":"accepted"}
                    """);
        });
        server.createContext("/selectTrack.htm", exchange -> respond(exchange, 200,
                """
                [{"ack":true,"data":[{"trackingNumber":"TRACK-1",
                  "businessStatus":"IN_TRANSIT","trackDetails":[
                    {"track_content":"包裹已揽收","businessStatus":"PICKED",
                     "track_date":"2026-08-14 09:30:00","track_location":"深圳"}
                  ]}]}]
                """));
        server.createContext("/postOrderApi.htm", exchange -> {
            handovers.incrementAndGet();
            respond(exchange, 200, "{\"ack\":true}");
        });
        server.start();
        try {
            var connector = connector(server, "JIAYUN_SHENGTU", "嘉运晟途");
            var credentials = new CredentialMaterial("user", "password", null);

            var created = connector.create("JIAYUN_SHENGTU", credentials,
                    channel("JIAYUN_SHENGTU", "3161", "美国专线"), shipment());
            var tracking = connector.track("JIAYUN_SHENGTU", credentials,
                    "ERP-1", created.providerOrderReference(),
                    created.trackingReference());
            connector.confirmHandover("JIAYUN_SHENGTU", credentials, "ERP-1");

            assertThat(created.providerOrderReference()).isEqualTo("ORDER-1");
            assertThat(created.trackingReference()).isEqualTo("TRACK-1");
            assertThat(created.labelUrl()).contains("ORDER-1");
            assertThat(createQuery.get()).contains("param=");
            assertThat(tracking.normalizedStatus()).isEqualTo("IN_TRANSIT");
            assertThat(tracking.events()).singleElement()
                    .extracting("description", "location")
                    .containsExactly("包裹已揽收", "深圳");
            assertThat(handovers).hasValue(1);
        } finally {
            server.stop(0);
        }
    }

    @Test
    void supportsShandianhouShangpaiPathsFormBodyAndChannelAllowlist()
            throws IOException {
        HttpServer server = server();
        AtomicReference<String> createBody = new AtomicReference<>();
        AtomicReference<String> contentType = new AtomicReference<>();
        AtomicReference<String> trackingQuery = new AtomicReference<>();
        server.createContext("/api/selectAuth.htm", exchange -> respond(exchange,
                200, "{\"customer_id\":6581,\"customer_userid\":6581,\"ack\":true}"));
        server.createContext("/api/getProductList.htm", exchange -> respond(exchange,
                200, """
                        [
                          {"product_id":"24058","product_shortname":"旧名称1"},
                          {"product_id":"99999","product_shortname":"其他渠道"},
                          {"product_id":"24060","product_shortname":"旧名称2"},
                          {"product_id":"24061","product_shortname":"旧名称3"}
                        ]
                        """));
        server.createContext("/api/createOrderApi.htm", exchange -> {
            assertThat(exchange.getRequestMethod()).isEqualTo("POST");
            assertThat(exchange.getRequestURI().getRawQuery()).isNull();
            contentType.set(exchange.getRequestHeaders().getFirst("Content-Type"));
            createBody.set(new String(exchange.getRequestBody().readAllBytes(),
                    StandardCharsets.UTF_8));
            respond(exchange, 200, """
                    {"ack":true,"order_id":"SDH10000000001",
                     "tracking_number":"","message":"accepted"}
                    """);
        });
        server.createContext("/api/getOrderTrackingNumber.htm", exchange -> {
            trackingQuery.set(exchange.getRequestURI().getRawQuery());
            respond(exchange, 200, """
                    {"status":"200","order_referencecode":"1Z123456789"}
                    """);
        });
        server.createContext("/selectTrack.htm", exchange -> respond(exchange, 200,
                """
                [{"ack":true,"data":[{"trackingNumber":"1Z123456789",
                  "businessStatus":"DELIVERED","trackDetails":[
                    {"track_content":"已签收","track_status":"DELIVERED",
                     "track_date":"2026-08-14 09:30:00","track_location":"洛杉矶"}
                  ]}]}]
                """));
        server.start();
        try {
            String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
            Endpoint endpoint = HualeiLogisticsProviderConnector.shangpaiEndpoint(
                    "闪电猴（商派）", baseUrl, Map.of(
                            "24058", "美猴专线普货-商派",
                            "24060", "美猴专线带电-商派",
                            "24061", "美猴专线敏感-商派"));
            var connector = new HualeiLogisticsProviderConnector(
                    Map.of("SHANDIANHOU_SHANGPAI", endpoint),
                    Duration.ofSeconds(5), HttpClient.newHttpClient());
            var credentials = new CredentialMaterial("user", "password", null);

            var probe = connector.probe(request(
                    "SHANDIANHOU_SHANGPAI", "user", "password"));
            var created = connector.create("SHANDIANHOU_SHANGPAI", credentials,
                    channel("SHANDIANHOU_SHANGPAI", "24058",
                            "美猴专线普货-商派"), shipment());
            var tracking = connector.track("SHANDIANHOU_SHANGPAI", credentials,
                    "ERP-1", created.providerOrderReference(), null);
            connector.confirmHandover("SHANDIANHOU_SHANGPAI", credentials,
                    "ERP-1");

            assertThat(probe.status()).isEqualTo("CONNECTED");
            assertThat(probe.channels()).containsExactly(
                    new LogisticsProviderConnectorGateway.DiscoveredChannel(
                            "24058", "美猴专线普货-商派"),
                    new LogisticsProviderConnectorGateway.DiscoveredChannel(
                            "24060", "美猴专线带电-商派"),
                    new LogisticsProviderConnectorGateway.DiscoveredChannel(
                            "24061", "美猴专线敏感-商派"));
            assertThat(contentType.get()).startsWith(
                    "application/x-www-form-urlencoded");
            assertThat(createBody.get()).startsWith("param=");
            assertThat(trackingQuery.get()).isEqualTo(
                    "order_id=SDH10000000001");
            assertThat(tracking.trackingReference()).isEqualTo("1Z123456789");
            assertThat(tracking.normalizedStatus()).isEqualTo("DELIVERED");
            assertThat(created.labelUrl()).isEqualTo(baseUrl
                    + "/order/FastRpt/PDF_NEW.aspx?PrintType=lab10_10&order_id=SDH10000000001");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void rejectsAnEndpointWithEmbeddedCredentials() {
        assertThatThrownBy(() -> HualeiLogisticsProviderConnector.endpoint(
                "华磊", "http://user:password@example.com:8082"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void productionClientDoesNotFollowRedirects() {
        assertThat(HualeiLogisticsProviderConnector.connectorHttpClient()
                .followRedirects()).isEqualTo(HttpClient.Redirect.NEVER);
    }

    private static HualeiLogisticsProviderConnector connector(HttpServer server,
            String providerCode, String providerName) {
        Endpoint endpoint = HualeiLogisticsProviderConnector.endpoint(providerName,
                "http://127.0.0.1:" + server.getAddress().getPort());
        return new HualeiLogisticsProviderConnector(
                Map.of(providerCode, endpoint), Duration.ofSeconds(5),
                HttpClient.newHttpClient());
    }

    private static ProbeRequest request(String providerCode, String username,
            String password) {
        return new ProbeRequest(UUID.randomUUID(), UUID.randomUUID(), providerCode,
                new CredentialMaterial(username, password, null), "uat-hualei");
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
        respond(exchange, status, body, StandardCharsets.UTF_8,
                "text/html;charset=UTF-8");
    }

    private static void respond(HttpExchange exchange, int status, String body,
            Charset charset, String contentType) throws IOException {
        byte[] response = body.getBytes(charset);
        exchange.getResponseHeaders().set("Content-Type", contentType);
        exchange.sendResponseHeaders(status, response.length);
        exchange.getResponseBody().write(response);
        exchange.close();
    }
}
