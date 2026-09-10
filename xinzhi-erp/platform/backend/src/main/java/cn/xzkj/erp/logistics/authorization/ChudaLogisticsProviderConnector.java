package cn.xzkj.erp.logistics.authorization;

import cn.xzkj.erp.logistics.authorization.LogisticsCredentialCipher.CredentialMaterial;
import cn.xzkj.erp.logistics.authorization.LogisticsCredentialCipher.ProviderCredentialMaterial;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderConnectorGateway.ProbeRequest;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderConnectorGateway.ProbeResult;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderConnectorGateway.DiscoveredChannel;
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
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Component
final class ChudaLogisticsProviderConnector {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Logger LOGGER = LoggerFactory.getLogger(
            ChudaLogisticsProviderConnector.class);
    private static final int MAX_TOKEN_BYTES = 64 * 1024;
    private static final int MAX_CHANNEL_BYTES = 1024 * 1024;
    private static final String DEFAULT_BASE_URL =
            "https://erp.ocl56.com/api/api-server";

    private final URI baseUrl;
    private final Duration timeout;
    private final HttpClient client;

    @Autowired
    ChudaLogisticsProviderConnector(Environment environment) {
        this(environment.getProperty(
                        "erp.logistics-connector.chuda.base-url",
                        DEFAULT_BASE_URL),
                Duration.parse(environment.getProperty(
                        "erp.logistics-connector.chuda.timeout", "PT10S")),
                connectorHttpClient());
    }

    ChudaLogisticsProviderConnector(String rawBaseUrl, Duration timeout,
            HttpClient client) {
        this.baseUrl = validateBaseUrl(rawBaseUrl);
        this.timeout = validateTimeout(timeout);
        this.client = Objects.requireNonNull(client);
    }

    static HttpClient connectorHttpClient() {
        return HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
    }

    ProbeResult probe(ProbeRequest request,
            ProviderCredentialMaterial providerCredentials) {
        Objects.requireNonNull(providerCredentials);
        // The published token and channel contracts use the tenant account and
        // returned token only. Platform credentials stay available for the
        // provider's signed operational APIs and are not added to undocumented
        // headers here.
        String token;
        try {
            CredentialMaterial credentials = request.credentials();
            token = fetchToken(credentials.username(), credentials.password());
        } catch (AuthorizationRejectedException exception) {
            logFailure("token", exception);
            return new ProbeResult("REJECTED",
                    "触达物流账号或密码不正确，或该账号尚未开通接口权限。");
        } catch (ConnectorUnavailableException exception) {
            logFailure("token", exception);
            return new ProbeResult("UNAVAILABLE",
                    "触达物流暂时无法完成账号验证，请稍后重试。");
        }
        try {
            List<DiscoveredChannel> channels = fetchChannels(token);
            String message = channels.isEmpty()
                    ? "触达物流连接成功，当前账号暂无可用渠道。"
                    : "触达物流连接成功，已同步 " + channels.size() + " 个可用渠道。";
            return new ProbeResult("CONNECTED", message, channels);
        } catch (AuthorizationRejectedException exception) {
            logFailure("channels", exception);
            return new ProbeResult("REJECTED",
                    "触达物流账号已验证，但渠道接口拒绝访问，请联系物流商开通渠道权限。");
        } catch (ConnectorUnavailableException exception) {
            logFailure("channels", exception);
            return new ProbeResult("UNAVAILABLE",
                    "触达物流账号已验证，但暂时无法读取可用渠道，请稍后重试。");
        }
    }

    CreateResult create(CredentialMaterial credentials,
            ProviderCredentialMaterial providerCredentials,
            LogisticsAuthorizationChannelRecord channel, Shipment shipment) {
        Objects.requireNonNull(providerCredentials);
        try {
            String token = fetchToken(credentials.username(),
                    credentials.password());
            Map<String, Object> order = new LinkedHashMap<>();
            order.put("clientBillNo", shipment.clientReference());
            order.put("receiveChannelCode", channel.channelCode());
            order.put("packageType", "1");
            order.put("weight", java.math.BigDecimal.valueOf(
                    shipment.weightGrams(), 3));
            order.put("quantity", 1);
            order.put("declaredCurrency", shipment.currency());
            java.math.BigDecimal total = shipment.items().stream()
                    .map(item -> LogisticsProviderOperations.decimal(
                            item.unitPriceMinor(), item.currency())
                            .multiply(java.math.BigDecimal.valueOf(item.quantity())))
                    .reduce(java.math.BigDecimal.ZERO,
                            java.math.BigDecimal::add);
            order.put("totalDeclaredCurrency", total);
            Map<String, Object> recipient = new LinkedHashMap<>();
            recipient.put("countryCode", shipment.countryCode());
            recipient.put("province", shipment.province());
            recipient.put("city", shipment.city());
            recipient.put("email", shipment.recipientEmail());
            recipient.put("postcode", shipment.postalCode());
            recipient.put("company", shipment.recipientCompany());
            recipient.put("name", shipment.recipientName());
            recipient.put("address1", shipment.addressLine1());
            recipient.put("address2", shipment.addressLine2());
            recipient.put("tel", shipment.recipientPhone());
            recipient.put("phone", shipment.recipientPhone());
            order.put("recipient", recipient);
            List<Map<String, Object>> commodities = new ArrayList<>();
            for (Item item : shipment.items()) {
                Map<String, Object> commodity = new LinkedHashMap<>();
                commodity.put("nameEn", item.name());
                commodity.put("nameCn", item.name());
                commodity.put("unitPrice", LogisticsProviderOperations.decimal(
                        item.unitPriceMinor(), item.currency()));
                commodity.put("quantity", item.quantity());
                commodity.put("amount", LogisticsProviderOperations.decimal(
                        item.unitPriceMinor(), item.currency())
                        .multiply(java.math.BigDecimal.valueOf(item.quantity())));
                commodity.put("sku", item.sku());
                commodities.add(commodity);
            }
            order.put("commodity", commodities);
            WireResponse response = send(HttpRequest.newBuilder(resolve(
                            "/waybill/create"))
                    .timeout(timeout)
                    .header("Accept", "application/json")
                    .header("Content-Type", "application/json")
                    .header("Authorization", token)
                    .POST(HttpRequest.BodyPublishers.ofByteArray(
                            JSON.writeValueAsBytes(List.of(order))))
                    .build(), 2 * 1024 * 1024);
            rejectOrFail(response);
            JsonNode root = JSON.readTree(response.body());
            JsonNode result = firstResult(root);
            if (result == null
                    || (result.has("success")
                    && !LogisticsProviderPayloadSupport.truthy(
                            result, "success"))) {
                throw new OperationException("PROVIDER_CREATE_REJECTED", true);
            }
            String providerOrder = LogisticsProviderPayloadSupport.text(
                    result, "id", "orderId");
            String tracking = LogisticsProviderPayloadSupport.text(
                    result, "waybillNo", "tailBillNo");
            String label = LogisticsProviderPayloadSupport.text(
                    result, "waybillLabelUrl", "tailLabelUrl");
            if (providerOrder == null && tracking == null) {
                throw new OperationException(
                        "PROVIDER_CREATE_RESPONSE_INVALID", false);
            }
            return new CreateResult(providerOrder, tracking, safeUrl(label),
                    tracking == null ? "CREATED" : "IN_TRANSIT",
                    LogisticsProviderPayloadSupport.text(result,
                            "msg", "message", "carrier"));
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

    TrackingResult track(CredentialMaterial credentials,
            ProviderCredentialMaterial providerCredentials,
            String clientReference, String providerOrderReference,
            String trackingReference) {
        Objects.requireNonNull(providerCredentials);
        try {
            String token = fetchToken(credentials.username(),
                    credentials.password());
            String lookup = trackingReference == null
                    ? providerOrderReference : trackingReference;
            if (lookup == null || lookup.isBlank()) lookup = clientReference;
            WireResponse response = send(HttpRequest.newBuilder(resolve(
                            "/itdida-api/queryTracks?no="
                                    + URLEncoder.encode(lookup,
                                    StandardCharsets.UTF_8)))
                    .timeout(timeout)
                    .header("Accept", "application/json")
                    .header("Authorization", token)
                    .GET().build(), 2 * 1024 * 1024);
            rejectOrFail(response);
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

    private static JsonNode firstResult(JsonNode root) {
        if (root == null || root.isNull() || root.isMissingNode()
                || root.isValueNode()) return null;
        if (root.isArray()) return root.isEmpty() ? null : root.get(0);
        for (String field : List.of("orderList", "data", "result", "list")) {
            JsonNode found = firstResult(root.path(field));
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

    private static String joinLocation(JsonNode item) {
        String country = LogisticsProviderPayloadSupport.text(
                item, "eventCountry", "country");
        String city = LogisticsProviderPayloadSupport.text(
                item, "eventCity", "city");
        if (country == null) return city;
        if (city == null) return country;
        return country + " / " + city;
    }

    private String fetchToken(String username, String password) {
        try {
            byte[] payload = JSON.writeValueAsBytes(
                    new TokenRequest(username, password));
            WireResponse response = send(HttpRequest.newBuilder(resolve("/oauth/token"))
                    .timeout(timeout)
                    .header("Accept", "application/json")
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofByteArray(payload))
                    .build(), MAX_TOKEN_BYTES);
            rejectOrFail(response);
            String token = parseToken(response);
            if (!validToken(token)) {
                throw new ConnectorUnavailableException(
                        "INVALID_TOKEN_RESPONSE", response);
            }
            return token;
        } catch (AuthorizationRejectedException | ConnectorUnavailableException exception) {
            throw exception;
        } catch (Exception exception) {
            interrupted(exception);
            throw new ConnectorUnavailableException(
                    "TOKEN_REQUEST_PROCESSING_FAILED");
        }
    }

    private List<DiscoveredChannel> fetchChannels(String token) {
        try {
            WireResponse response = send(HttpRequest.newBuilder(resolve("/channel/list"))
                    .timeout(timeout)
                    .header("Accept", "application/json")
                    .header("Authorization", token)
                    .POST(HttpRequest.BodyPublishers.noBody())
                    .build(), MAX_CHANNEL_BYTES);
            rejectOrFail(response);
            ChannelResponse[] channels = parseChannels(response);
            if (channels == null) {
                throw new ConnectorUnavailableException(
                        "INVALID_CHANNEL_RESPONSE", response);
            }
            int skipped = (int) Arrays.stream(channels)
                    .filter(Objects::isNull)
                    .count();
            if (skipped > 0) {
                LOGGER.warn(
                        "chuda_channel_entries_skipped skipped_entries={} total_entries={}",
                        skipped, channels.length);
            }
            List<DiscoveredChannel> discovered = Arrays.stream(channels)
                    .filter(Objects::nonNull)
                    .map(channel -> new DiscoveredChannel(
                            channel.channelCode(), channel.channelName()))
                    .toList();
            if (channels.length > 0 && discovered.isEmpty()) {
                throw new ConnectorUnavailableException(
                        "INVALID_CHANNEL_RESPONSE", response);
            }
            return discovered;
        } catch (AuthorizationRejectedException | ConnectorUnavailableException exception) {
            throw exception;
        } catch (Exception exception) {
            interrupted(exception);
            throw new ConnectorUnavailableException(
                    "CHANNEL_REQUEST_PROCESSING_FAILED_"
                            + safeExceptionType(exception)
                            + "_AT_" + safeFailureLocation(exception));
        }
    }

    private WireResponse send(HttpRequest request, int maximumBytes) {
        try {
            HttpResponse<InputStream> response = client.send(
                    request, HttpResponse.BodyHandlers.ofInputStream());
            try (InputStream input = response.body()) {
                byte[] body = input.readNBytes(maximumBytes + 1);
                if (body.length > maximumBytes) {
                    throw new ConnectorUnavailableException(
                            "RESPONSE_TOO_LARGE",
                            new WireResponse(response.statusCode(),
                                    safeContentType(response.headers()
                                            .firstValue("Content-Type")
                                            .orElse("missing")), body));
                }
                return new WireResponse(response.statusCode(),
                        safeContentType(response.headers()
                                .firstValue("Content-Type").orElse("missing")),
                        body);
            }
        } catch (ConnectorUnavailableException exception) {
            throw exception;
        } catch (Exception exception) {
            interrupted(exception);
            throw new ConnectorUnavailableException(
                    exception instanceof InterruptedException
                            ? "REQUEST_INTERRUPTED" : "TRANSPORT_FAILURE");
        }
    }

    private static void rejectOrFail(WireResponse response) {
        int status = response.status();
        if (status == 400 || status == 401 || status == 403) {
            throw new AuthorizationRejectedException(
                    "UPSTREAM_AUTHORIZATION_REJECTED", response);
        }
        if (status < 200 || status >= 300) {
            throw new ConnectorUnavailableException(
                    "UPSTREAM_HTTP_STATUS", response);
        }
    }

    private URI resolve(String path) {
        return URI.create(baseUrl.toString() + path);
    }

    private static URI validateBaseUrl(String raw) {
        try {
            URI value = URI.create(raw == null ? "" : raw.strip());
            String scheme = value.getScheme();
            String host = value.getHost();
            boolean loopback = "localhost".equalsIgnoreCase(host)
                    || "127.0.0.1".equals(host) || "::1".equals(host);
            if (host == null || value.getUserInfo() != null
                    || value.getQuery() != null || value.getFragment() != null
                    || !("https".equalsIgnoreCase(scheme)
                    || ("http".equalsIgnoreCase(scheme) && loopback))) {
                throw new IllegalArgumentException(
                        "Chuda logistics connector requires an HTTPS base URL");
            }
            String path = value.getPath();
            if (path == null || path.isBlank() || path.contains("..")) {
                throw new IllegalArgumentException(
                        "Chuda logistics connector base path is invalid");
            }
            return URI.create(value.toString().replaceAll("/+$", ""));
        } catch (IllegalArgumentException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new IllegalArgumentException(
                    "Chuda logistics connector base URL is invalid", exception);
        }
    }

    private static Duration validateTimeout(Duration value) {
        if (value == null || value.isZero() || value.isNegative()
                || value.compareTo(Duration.ofSeconds(30)) > 0) {
            throw new IllegalArgumentException(
                    "Chuda logistics connector timeout must be 1-30 seconds");
        }
        return value;
    }

    private static boolean validToken(String value) {
        return value != null && value.length() >= 20 && value.length() <= 4096
                && value.chars().allMatch(character -> character >= 0x21
                        && character <= 0x7E);
    }

    private static String parseToken(WireResponse response) {
        byte[] body = response.body();
        String raw = new String(body, StandardCharsets.UTF_8).strip();
        if (raw.startsWith("\uFEFF")) {
            raw = raw.substring(1).strip();
        }
        if (raw.startsWith("\"") && raw.endsWith("\"")) {
            try {
                return JSON.readValue(raw.getBytes(StandardCharsets.UTF_8),
                        String.class);
            } catch (Exception exception) {
                throw new ConnectorUnavailableException(
                        "INVALID_TOKEN_RESPONSE", response);
            }
        }
        if (raw.startsWith("{") && raw.endsWith("}")) {
            try {
                JsonNode root = JSON.readTree(
                        raw.getBytes(StandardCharsets.UTF_8));
                String token = textualToken(root);
                if (token != null) {
                    return token;
                }
                throw new ConnectorUnavailableException(
                        "UNSUPPORTED_TOKEN_OBJECT", response);
            } catch (ConnectorUnavailableException exception) {
                throw exception;
            } catch (Exception exception) {
                throw new ConnectorUnavailableException(
                        "INVALID_TOKEN_RESPONSE", response);
            }
        }
        return raw;
    }

    private static String textualToken(JsonNode root) {
        if (root == null || !root.isObject()) {
            return null;
        }
        for (String field : List.of("token", "accessToken", "access_token",
                "jwtToken")) {
            JsonNode candidate = root.path(field);
            if (candidate.isTextual()) {
                return candidate.asText();
            }
        }
        JsonNode data = root.path("data");
        if (data.isTextual()) {
            return data.asText();
        }
        return data.isObject() ? textualToken(data) : null;
    }

    private static ChannelResponse[] parseChannels(WireResponse response) {
        try {
            JsonNode root = JSON.readTree(response.body());
            JsonNode channels = channelArray(root, 0);
            if (channels == null) {
                throw new ConnectorUnavailableException(
                        "INVALID_CHANNEL_RESPONSE", response);
            }
            return JSON.readValue(JSON.writeValueAsBytes(channels),
                    ChannelResponse[].class);
        } catch (ConnectorUnavailableException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new ConnectorUnavailableException(
                    "INVALID_CHANNEL_RESPONSE", response);
        }
    }

    private static JsonNode channelArray(JsonNode node, int depth) {
        if (node == null || depth > 3) {
            return null;
        }
        if (node.isArray()) {
            return node;
        }
        if (!node.isObject()) {
            return null;
        }
        for (String field : List.of("data", "result", "list", "rows",
                "records")) {
            JsonNode candidate = node.path(field);
            JsonNode found = channelArray(candidate, depth + 1);
            if (found != null) {
                return found;
            }
        }
        return null;
    }

    private static String safeContentType(String value) {
        if (value == null || value.isBlank()) {
            return "missing";
        }
        String normalized = value.replaceAll("[^\\x20-\\x7E]", "?");
        return normalized.substring(0, Math.min(normalized.length(), 128));
    }

    private static String safeExceptionType(Exception exception) {
        String name = exception == null
                ? "UNKNOWN" : exception.getClass().getSimpleName();
        String normalized = name.replaceAll("[^A-Za-z0-9]", "");
        return normalized.isBlank() ? "UNKNOWN" : normalized;
    }

    private static String safeFailureLocation(Exception exception) {
        if (exception == null || exception.getStackTrace().length == 0) {
            return "UNKNOWN";
        }
        StackTraceElement origin = exception.getStackTrace()[0];
        String raw = origin.getClassName() + "_" + origin.getMethodName()
                + "_" + Math.max(origin.getLineNumber(), 0);
        String normalized = raw.replaceAll("[^A-Za-z0-9_.]", "");
        return normalized.isBlank() ? "UNKNOWN" : normalized;
    }

    private static void logFailure(String phase, ConnectorFailure failure) {
        LOGGER.warn(
                "chuda_connector_failure phase={} reason={} upstream_status={} content_type={} response_bytes={}",
                phase, failure.reason(), failure.upstreamStatus(),
                failure.contentType(), failure.responseBytes());
    }

    private static void interrupted(Exception exception) {
        if (exception instanceof InterruptedException) {
            Thread.currentThread().interrupt();
        }
    }

    private record TokenRequest(String username, String password) {
        @Override
        public String toString() {
            return "TokenRequest[username=[REDACTED], password=[REDACTED]]";
        }
    }

    private record ChannelResponse(String channelCode, String channelName) {
    }

    private record WireResponse(int status, String contentType, byte[] body) {
        @Override
        public String toString() {
            return "WireResponse[status=" + status + ", body=[REDACTED]]";
        }
    }

    private abstract static class ConnectorFailure extends RuntimeException {
        private final String reason;
        private final Integer upstreamStatus;
        private final String contentType;
        private final Integer responseBytes;

        ConnectorFailure(String reason) {
            this(reason, null);
        }

        ConnectorFailure(String reason, WireResponse response) {
            this.reason = reason;
            this.upstreamStatus = response == null ? null : response.status();
            this.contentType = response == null ? null : response.contentType();
            this.responseBytes = response == null ? null : response.body().length;
        }

        String reason() {
            return reason;
        }

        Integer upstreamStatus() {
            return upstreamStatus;
        }

        String contentType() {
            return contentType;
        }

        Integer responseBytes() {
            return responseBytes;
        }
    }

    private static final class AuthorizationRejectedException
            extends ConnectorFailure {
        AuthorizationRejectedException(String reason, WireResponse response) {
            super(reason, response);
        }
    }

    private static final class ConnectorUnavailableException
            extends ConnectorFailure {
        ConnectorUnavailableException(String reason) {
            super(reason);
        }

        ConnectorUnavailableException(String reason, WireResponse response) {
            super(reason, response);
        }
    }
}
