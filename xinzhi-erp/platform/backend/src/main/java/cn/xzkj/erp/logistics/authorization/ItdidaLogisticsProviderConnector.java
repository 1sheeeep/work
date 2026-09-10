package cn.xzkj.erp.logistics.authorization;

import cn.xzkj.erp.logistics.authorization.LogisticsProviderConnectorGateway.ProbeRequest;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderConnectorGateway.ProbeResult;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderConnectorGateway.DiscoveredChannel;
import cn.xzkj.erp.logistics.authorization.LogisticsCredentialCipher.CredentialMaterial;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderOperations.CreateResult;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderOperations.Item;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderOperations.OperationException;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderOperations.Shipment;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderOperations.TrackingEvent;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderOperations.TrackingResult;
import java.io.InputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Component
final class ItdidaLogisticsProviderConnector {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final int MAX_TOKEN_BYTES = 64 * 1024;
    private static final int MAX_CHANNEL_BYTES = 1024 * 1024;

    private final Map<String, Endpoint> endpoints;
    private final Duration timeout;
    private final HttpClient client;

    @Autowired
    ItdidaLogisticsProviderConnector(Environment environment) {
        this(Map.of(
                        LogisticsProviderCatalog.BIAOJU,
                        endpoint("镖锔科技物流", environment.getProperty(
                                "erp.logistics-connector.biaoju.base-url",
                                "https://yf56.itdida.com/itdida-api")),
                        LogisticsProviderCatalog.BAIDU_YIXIA,
                        endpoint("摆渡一下", environment.getProperty(
                                "erp.logistics-connector.baidu-yixia.base-url",
                                "https://erp.1st56.com/api/api-server/itdida-api"))),
                Duration.parse(environment.getProperty(
                        "erp.logistics-connector.itdida.timeout", "PT10S")),
                connectorHttpClient());
    }

    ItdidaLogisticsProviderConnector(Map<String, Endpoint> endpoints,
            Duration timeout, HttpClient client) {
        this.endpoints = Map.copyOf(Objects.requireNonNull(endpoints));
        this.timeout = validateTimeout(timeout);
        this.client = Objects.requireNonNull(client);
    }

    static Endpoint endpoint(String name, String rawBaseUrl) {
        return new Endpoint(name, validateBaseUrl(rawBaseUrl));
    }

    static HttpClient connectorHttpClient() {
        return HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
    }

    ProbeResult probe(ProbeRequest request) {
        Endpoint endpoint = endpoints.get(request.providerCode());
        if (endpoint == null) return ProbeResult.notConfigured();
        String token;
        try {
            token = fetchToken(endpoint, request.credentials().username(),
                    request.credentials().password());
        } catch (AuthorizationRejectedException exception) {
            return new ProbeResult("REJECTED",
                    endpoint.name() + "账号或密码不正确，或该账号尚未开通接口权限。");
        } catch (ConnectorUnavailableException exception) {
            return new ProbeResult("UNAVAILABLE",
                    endpoint.name() + "暂时无法完成账号验证，请稍后重试。");
        }
        try {
            List<DiscoveredChannel> channels = fetchChannels(endpoint, token);
            String message = channels.isEmpty()
                    ? endpoint.name() + "连接成功，当前账号暂无可用渠道。"
                    : endpoint.name() + "连接成功，已同步 " + channels.size()
                            + " 个可用渠道。";
            return new ProbeResult("CONNECTED", message, channels);
        } catch (AuthorizationRejectedException exception) {
            return new ProbeResult("REJECTED",
                    endpoint.name() + "账号已验证，但渠道接口拒绝访问，请联系物流商开通渠道权限。");
        } catch (ConnectorUnavailableException exception) {
            return new ProbeResult("UNAVAILABLE",
                    endpoint.name() + "账号已验证，但暂时无法读取可用渠道，请稍后重试。");
        }
    }

    CreateResult create(String providerCode, CredentialMaterial credentials,
            LogisticsAuthorizationChannelRecord channel, Shipment shipment) {
        Endpoint endpoint = operationalEndpoint(providerCode);
        try {
            String token = fetchToken(endpoint, credentials.username(),
                    credentials.password());
            Map<String, Object> order = new java.util.LinkedHashMap<>();
            order.put("keHuDanHao", shipment.clientReference());
            order.put("shouHuoQuDao", channel.channelCode());
            order.put("baoGuoLeiXing", "PAK");
            order.put("fuShuiJin", "DDU");
            order.put("guoJia", shipment.countryCode());
            order.put("shouJianRenXingMing", shipment.recipientName());
            order.put("shouJianRenDiZhi1", shipment.addressLine1());
            order.put("shouJianRenDiZhi2", shipment.addressLine2());
            order.put("shouJianRenDianHua", shipment.recipientPhone());
            order.put("shouJianRenShouJi", shipment.recipientPhone());
            order.put("shouJianRenYouBian", shipment.postalCode());
            order.put("shouJianRenChengShi", shipment.city());
            order.put("zhouMing", shipment.province());
            order.put("recipientEmail", shipment.recipientEmail());
            order.put("shouHuoShiZhong", java.math.BigDecimal.valueOf(
                    shipment.weightGrams(), 3));
            order.put("jianShu", 1);
            List<Map<String, Object>> declarations = new ArrayList<>();
            for (Item item : shipment.items()) {
                Map<String, Object> declaration = new java.util.LinkedHashMap<>();
                declaration.put("shenBaoPinMing", item.name());
                declaration.put("zhongWenPinMing", item.name());
                declaration.put("shenBaoShuLiang", item.quantity());
                declaration.put("shenBaoDanJia", LogisticsProviderOperations.decimal(
                        item.unitPriceMinor(), item.currency()));
                declaration.put("shenBaoBiZhong", item.currency());
                declaration.put("sku", item.sku());
                declarations.add(declaration);
            }
            order.put("shenBaoXinXiList", declarations);
            byte[] body = JSON.writeValueAsBytes(List.of(order));
            WireResponse response = send(HttpRequest.newBuilder(resolve(
                            endpoint, "/yundans"))
                    .timeout(timeout)
                    .header("Accept", "application/json")
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Bearer " + token)
                    .POST(HttpRequest.BodyPublishers.ofByteArray(body))
                    .build(), 2 * 1024 * 1024);
            rejectOrFail(response.status());
            JsonNode root = JSON.readTree(response.body());
            JsonNode result = firstResult(root);
            if (result == null) {
                throw new OperationException(
                        "PROVIDER_CREATE_RESPONSE_INVALID", false);
            }
            String providerOrder = LogisticsProviderPayloadSupport.text(
                    result, "xiTongDanHao", "id");
            String tracking = LogisticsProviderPayloadSupport.text(
                    result, "zhuanDanHao", "trackingNumber");
            String label = LogisticsProviderPayloadSupport.text(
                    result, "labelUrl", "label");
            String code = LogisticsProviderPayloadSupport.text(result, "code");
            if (providerOrder == null && tracking == null) {
                throw new OperationException(
                        "PROVIDER_CREATE_REJECTED_" + safeCode(code), true);
            }
            return new CreateResult(providerOrder, tracking,
                    safeUrl(label), tracking == null ? "CREATED" : "IN_TRANSIT",
                    LogisticsProviderPayloadSupport.text(result,
                            "message", "msg"));
        } catch (OperationException exception) {
            throw exception;
        } catch (AuthorizationRejectedException exception) {
            throw new OperationException(
                    "PROVIDER_AUTHORIZATION_REJECTED", true);
        } catch (ConnectorUnavailableException exception) {
            throw new OperationException("PROVIDER_CREATE_UNAVAILABLE", false);
        } catch (Exception exception) {
            interrupted(exception);
            throw new OperationException(
                    "PROVIDER_CREATE_PROCESSING_FAILED", false);
        }
    }

    TrackingResult track(String providerCode, CredentialMaterial credentials,
            String clientReference, String providerOrderReference,
            String trackingReference) {
        Endpoint endpoint = operationalEndpoint(providerCode);
        try {
            String token = fetchToken(endpoint, credentials.username(),
                    credentials.password());
            String lookup = trackingReference == null
                    ? providerOrderReference : trackingReference;
            if (lookup == null || lookup.isBlank()) {
                lookup = clientReference;
            }
            WireResponse response = send(HttpRequest.newBuilder(resolve(endpoint,
                            "/queryTracks?no=" + encode(lookup)))
                    .timeout(timeout)
                    .header("Accept", "application/json")
                    .header("Authorization", "Bearer " + token)
                    .GET().build(), 2 * 1024 * 1024);
            rejectOrFail(response.status());
            JsonNode root = JSON.readTree(response.body());
            JsonNode result = firstResult(root);
            if (result == null) {
                throw new OperationException(
                        "PROVIDER_TRACKING_RESPONSE_INVALID", false);
            }
            JsonNode detail = result.path("detail").isObject()
                    ? result.path("detail") : result;
            String providerStatus = LogisticsProviderPayloadSupport.text(
                    detail, "status", "businessStatus");
            String resolvedTracking = LogisticsProviderPayloadSupport.text(
                    detail, "trackingNumber", "danHao", "no");
            JsonNode trackList = detail.path("trackList");
            List<TrackingEvent> events = new ArrayList<>();
            if (trackList.isArray()) {
                for (JsonNode item : trackList) {
                    String description = LogisticsProviderPayloadSupport.text(
                            item, "desc", "description", "eventCodeDesc");
                    if (description == null) continue;
                    String eventStatus = LogisticsProviderPayloadSupport.text(
                            item, "eventCode", "status");
                    String normalized = LogisticsProviderPayloadSupport.normalizeStatus(
                            eventStatus == null ? description : eventStatus);
                    Instant occurredAt = LogisticsProviderPayloadSupport.instant(
                            LogisticsProviderPayloadSupport.text(item,
                                    "time", "trackDate"));
                    String location = joinLocation(item);
                    events.add(new TrackingEvent(
                            LogisticsProviderPayloadSupport.eventKey(
                                    eventStatus, description, location, occurredAt),
                            normalized, eventStatus, description, location,
                            occurredAt));
                }
            }
            String normalized = events.stream()
                    .max(java.util.Comparator.comparing(TrackingEvent::occurredAt))
                    .map(TrackingEvent::normalizedStatus)
                    .orElse(LogisticsProviderPayloadSupport.normalizeStatus(
                            providerStatus));
            String summary = events.stream()
                    .max(java.util.Comparator.comparing(TrackingEvent::occurredAt))
                    .map(TrackingEvent::description).orElse(null);
            return new TrackingResult(
                    resolvedTracking == null ? trackingReference : resolvedTracking,
                    null, normalized, providerStatus, summary, events);
        } catch (OperationException exception) {
            throw exception;
        } catch (AuthorizationRejectedException exception) {
            throw new OperationException(
                    "PROVIDER_AUTHORIZATION_REJECTED", true);
        } catch (Exception exception) {
            interrupted(exception);
            throw new OperationException(
                    "PROVIDER_TRACKING_UNAVAILABLE", false);
        }
    }

    private Endpoint operationalEndpoint(String providerCode) {
        Endpoint endpoint = endpoints.get(providerCode);
        if (endpoint == null) {
            throw new OperationException(
                    "PROVIDER_OPERATION_NOT_SUPPORTED", true);
        }
        return endpoint;
    }

    private static JsonNode firstResult(JsonNode root) {
        if (root == null || root.isNull() || root.isMissingNode()
                || root.isValueNode()) return null;
        if (root.isArray()) return root.isEmpty() ? null : root.get(0);
        for (String field : List.of("data", "result", "orderList", "list")) {
            JsonNode candidate = root.path(field);
            JsonNode found = firstResult(candidate);
            if (found != null) return found;
        }
        return root.isObject() ? root : null;
    }

    private static String safeUrl(String value) {
        if (value == null) return null;
        try {
            URI uri = URI.create(value);
            if (uri.getHost() != null && uri.getUserInfo() == null
                    && ("https".equalsIgnoreCase(uri.getScheme())
                    || "http".equalsIgnoreCase(uri.getScheme()))) {
                return uri.toString();
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    private static String safeCode(String value) {
        if (value == null) return "UNKNOWN";
        String normalized = value.replaceAll("[^A-Za-z0-9_-]", "");
        return normalized.isBlank() ? "UNKNOWN"
                : normalized.substring(0, Math.min(24, normalized.length()));
    }

    private static String joinLocation(JsonNode item) {
        String country = LogisticsProviderPayloadSupport.text(
                item, "eventCountry", "country");
        String city = LogisticsProviderPayloadSupport.text(
                item, "eventCity", "city");
        if (country == null) return city;
        if (city == null) return country;
        return country + " / " + city;
    }

    private String fetchToken(Endpoint endpoint, String username,
            String password) {
        try {
            String form = "username=" + encode(username)
                    + "&password=" + encode(password);
            WireResponse response = send(HttpRequest.newBuilder(resolve(
                            endpoint, "/login"))
                    .timeout(timeout)
                    .header("Accept", "application/json")
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .POST(HttpRequest.BodyPublishers.ofString(
                            form, StandardCharsets.UTF_8))
                    .build(), MAX_TOKEN_BYTES);
            rejectOrFail(response.status());
            JsonNode root = JSON.readTree(response.body());
            if (root == null || !root.isObject()
                    || !root.path("success").asBoolean(false)
                    || !root.path("data").isTextual()) {
                throw new AuthorizationRejectedException();
            }
            String token = root.path("data").asText();
            if (!validToken(token)) {
                throw new AuthorizationRejectedException();
            }
            return token;
        } catch (AuthorizationRejectedException | ConnectorUnavailableException exception) {
            throw exception;
        } catch (Exception exception) {
            interrupted(exception);
            throw new ConnectorUnavailableException();
        }
    }

    private List<DiscoveredChannel> fetchChannels(Endpoint endpoint, String token) {
        try {
            WireResponse response = send(HttpRequest.newBuilder(resolve(
                            endpoint, "/getReceivingChannels"))
                    .timeout(timeout)
                    .header("Accept", "application/json")
                    .header("Authorization", "Bearer " + token)
                    .GET()
                    .build(), MAX_CHANNEL_BYTES);
            rejectOrFail(response.status());
            JsonNode root = JSON.readTree(response.body());
            if (root == null || !root.isObject()
                    || !root.path("success").asBoolean(false)
                    || !root.path("data").isArray()) {
                throw new ConnectorUnavailableException();
            }
            List<DiscoveredChannel> channels = new ArrayList<>();
            for (JsonNode item : root.path("data")) {
                if (!item.isObject() || !item.path("channelName").isTextual()) {
                    throw new ConnectorUnavailableException();
                }
                String name = item.path("channelName").asText();
                channels.add(new DiscoveredChannel(name, name));
            }
            return List.copyOf(channels);
        } catch (AuthorizationRejectedException | ConnectorUnavailableException exception) {
            throw exception;
        } catch (Exception exception) {
            interrupted(exception);
            throw new ConnectorUnavailableException();
        }
    }

    private WireResponse send(HttpRequest request, int maximumBytes) {
        try {
            HttpResponse<InputStream> response = client.send(
                    request, HttpResponse.BodyHandlers.ofInputStream());
            try (InputStream input = response.body()) {
                byte[] body = input.readNBytes(maximumBytes + 1);
                if (body.length > maximumBytes) {
                    throw new ConnectorUnavailableException();
                }
                return new WireResponse(response.statusCode(), body);
            }
        } catch (ConnectorUnavailableException exception) {
            throw exception;
        } catch (Exception exception) {
            interrupted(exception);
            throw new ConnectorUnavailableException();
        }
    }

    private static void rejectOrFail(int status) {
        if (status == 400 || status == 401 || status == 403 || status == 508) {
            throw new AuthorizationRejectedException();
        }
        if (status < 200 || status >= 300) {
            throw new ConnectorUnavailableException();
        }
    }

    private static URI resolve(Endpoint endpoint, String path) {
        return URI.create(endpoint.baseUrl() + path);
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private static String validateBaseUrl(String raw) {
        try {
            URI value = URI.create(raw == null ? "" : raw.strip());
            if (value.getHost() == null || value.getUserInfo() != null
                    || value.getQuery() != null || value.getFragment() != null
                    || !"https".equalsIgnoreCase(value.getScheme())) {
                throw new IllegalArgumentException(
                        "Itdida logistics connector requires an HTTPS base URL");
            }
            String path = value.getPath();
            if (path == null || path.isBlank() || path.contains("..")) {
                throw new IllegalArgumentException(
                        "Itdida logistics connector base path is invalid");
            }
            return value.toString().replaceAll("/+$", "");
        } catch (IllegalArgumentException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new IllegalArgumentException(
                    "Itdida logistics connector base URL is invalid", exception);
        }
    }

    private static Duration validateTimeout(Duration value) {
        if (value == null || value.isZero() || value.isNegative()
                || value.compareTo(Duration.ofSeconds(30)) > 0) {
            throw new IllegalArgumentException(
                    "Itdida logistics connector timeout must be 1-30 seconds");
        }
        return value;
    }

    private static boolean validToken(String value) {
        return value != null && value.length() >= 20 && value.length() <= 4096
                && value.chars().noneMatch(Character::isWhitespace)
                && value.chars().noneMatch(Character::isISOControl);
    }

    private static void interrupted(Exception exception) {
        if (exception instanceof InterruptedException) {
            Thread.currentThread().interrupt();
        }
    }

    record Endpoint(String name, String baseUrl) {
    }

    private record WireResponse(int status, byte[] body) {
        @Override
        public String toString() {
            return "WireResponse[status=" + status + ", body=[REDACTED]]";
        }
    }

    private static final class AuthorizationRejectedException
            extends RuntimeException {
    }

    private static final class ConnectorUnavailableException
            extends RuntimeException {
    }
}
