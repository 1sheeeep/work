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
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Component
final class HualeiLogisticsProviderConnector {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Logger LOGGER = LoggerFactory.getLogger(
            HualeiLogisticsProviderConnector.class);
    private static final int MAX_AUTH_BYTES = 8 * 1024;
    private static final int MAX_CHANNEL_BYTES = 2 * 1024 * 1024;
    private static final Pattern ACK_TRUE = Pattern.compile(
            "[\\\"']?ack[\\\"']?\\s*:\\s*[\\\"']?true[\\\"']?",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern CUSTOMER_ID = Pattern.compile(
            "[\\\"']?customer_id[\\\"']?\\s*:\\s*[\\\"']?([^\\\"',}\\s]{1,256})[\\\"']?",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern CUSTOMER_USER_ID = Pattern.compile(
            "[\\\"']?customer_userid[\\\"']?\\s*:\\s*[\\\"']?([^\\\"',}\\s]{1,256})[\\\"']?",
            Pattern.CASE_INSENSITIVE);

    private final Map<String, Endpoint> endpoints;
    private final Duration timeout;
    private final HttpClient client;

    @Autowired
    HualeiLogisticsProviderConnector(Environment environment) {
        this(Map.of(
                        LogisticsProviderCatalog.DAYUNJIA,
                        endpoint("深圳达运佳国际物流", environment.getProperty(
                                "erp.logistics-connector.dayunjia.base-url",
                                "http://43.138.180.250:8082"), environment.getProperty(
                                "erp.logistics-connector.dayunjia.label-base-url",
                                "http://43.138.180.250:8089")),
                        LogisticsProviderCatalog.HUALEI,
                        endpoint("华磊", environment.getProperty(
                                "erp.logistics-connector.hualei.base-url",
                                "http://106.55.154.6:8082"), environment.getProperty(
                                "erp.logistics-connector.hualei.label-base-url",
                                "http://106.55.154.6:8089")),
                        LogisticsProviderCatalog.TONGXI,
                        endpoint("桐溪供应链", environment.getProperty(
                                "erp.logistics-connector.tongxi.base-url",
                                "http://1.14.133.93:8082"), environment.getProperty(
                                "erp.logistics-connector.tongxi.label-base-url",
                                "http://1.14.133.93:8089")),
                        LogisticsProviderCatalog.JIAYUN_SHENGTU,
                        endpoint("嘉运晟途", environment.getProperty(
                                "erp.logistics-connector.jiayun-shengtu.base-url",
                                "http://106.55.154.6:8082"), environment.getProperty(
                                "erp.logistics-connector.jiayun-shengtu.label-base-url",
                                "http://106.55.154.6:8089")),
                        LogisticsProviderCatalog.SHANDIANHOU_XIAOBAO,
                        endpoint("闪电猴（小包）", environment.getProperty(
                                "erp.logistics-connector.shandianhou-xiaobao.base-url",
                                "http://182.254.152.160:8082"), environment.getProperty(
                                "erp.logistics-connector.shandianhou-xiaobao.label-base-url",
                                "http://124.222.46.80:8089"), Map.of(
                                        "14421", "美猴专线普货（偏远）",
                                        "18821", "美猴敏感专线（偏远）",
                                        "19241", "美猴带电专线（偏远）")),
                        LogisticsProviderCatalog.SHANDIANHOU_SHANGPAI,
                        shangpaiEndpoint("闪电猴（商派）", environment.getProperty(
                                "erp.logistics-connector.shandianhou-shangpai.base-url",
                                "https://tms.zhfulfill.com"), Map.of(
                                        "24058", "美猴专线普货-商派",
                                        "24060", "美猴专线带电-商派",
                                        "24061", "美猴专线敏感-商派"))),
                Duration.parse(environment.getProperty(
                        "erp.logistics-connector.hualei-family.timeout", "PT10S")),
                connectorHttpClient());
    }

    HualeiLogisticsProviderConnector(Map<String, Endpoint> endpoints,
            Duration timeout, HttpClient client) {
        this.endpoints = Map.copyOf(Objects.requireNonNull(endpoints));
        this.timeout = validateTimeout(timeout);
        this.client = Objects.requireNonNull(client);
    }

    static Endpoint endpoint(String name, String rawBaseUrl) {
        return new Endpoint(name, validateBaseUrl(rawBaseUrl));
    }

    static Endpoint endpoint(String name, String rawBaseUrl,
            String rawLabelBaseUrl) {
        return new Endpoint(name, validateBaseUrl(rawBaseUrl),
                validateBaseUrl(rawLabelBaseUrl), "", false,
                true, false, Map.of());
    }

    static Endpoint endpoint(String name, String rawBaseUrl,
            String rawLabelBaseUrl, Map<String, String> channels) {
        return new Endpoint(name, validateBaseUrl(rawBaseUrl),
                validateBaseUrl(rawLabelBaseUrl), "", false,
                true, false, channels);
    }

    static Endpoint shangpaiEndpoint(String name, String rawBaseUrl,
            Map<String, String> channels) {
        String baseUrl = validateBaseUrl(rawBaseUrl);
        return new Endpoint(name, baseUrl, baseUrl, "/api", true,
                false, true, channels);
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
        try {
            authenticate(endpoint, request.credentials().username(),
                    request.credentials().password());
            List<DiscoveredChannel> channels = fetchChannels(endpoint);
            return new ProbeResult("CONNECTED",
                    endpoint.name() + "连接成功，已同步 " + channels.size()
                            + " 个可用渠道。", channels);
        } catch (AuthorizationRejectedException exception) {
            logFailure(endpoint, "authentication", exception);
            return new ProbeResult("REJECTED",
                    endpoint.name() + "账号或密码不正确，或该账号尚未开通接口权限。");
        } catch (ConnectorUnavailableException exception) {
            logFailure(endpoint, exception.phase(), exception);
            if ("channels".equals(exception.phase())) {
                return new ProbeResult("UNAVAILABLE",
                        endpoint.name() + "账号已验证，但暂时无法读取可用渠道，请稍后重试。");
            }
            return new ProbeResult("UNAVAILABLE",
                    endpoint.name() + "暂时无法完成账号验证，请稍后重试。");
        }
    }

    CreateResult create(String providerCode, CredentialMaterial credentials,
            LogisticsAuthorizationChannelRecord channel, Shipment shipment) {
        Endpoint endpoint = operationalEndpoint(providerCode);
        try {
            AuthIdentity identity = authenticate(endpoint, credentials.username(),
                    credentials.password());
            Map<String, Object> payload = new java.util.LinkedHashMap<>();
            payload.put("customer_id", identity.customerId());
            payload.put("customer_userid", identity.customerUserId());
            payload.put("order_customerinvoicecode", shipment.clientReference());
            payload.put("product_id", channel.channelCode());
            payload.put("consignee_name", shipment.recipientName());
            payload.put("consignee_address", shipment.addressLine1()
                    + (shipment.addressLine2() == null
                    ? "" : " " + shipment.addressLine2()));
            payload.put("consignee_telephone", shipment.recipientPhone());
            payload.put("consignee_city", shipment.city());
            payload.put("consignee_state", shipment.province());
            payload.put("consignee_postcode", shipment.postalCode());
            payload.put("consignee_email", shipment.recipientEmail());
            payload.put("consignee_companyname", shipment.recipientCompany());
            payload.put("country", shipment.countryCode());
            payload.put("weight", java.math.BigDecimal.valueOf(
                    shipment.weightGrams(), 3));
            payload.put("cargo_type", "P");
            payload.put("trade_type", "ZYXT");
            List<Map<String, Object>> invoices = new ArrayList<>();
            for (Item item : shipment.items()) {
                Map<String, Object> invoice = new java.util.LinkedHashMap<>();
                invoice.put("invoice_title", item.name());
                invoice.put("invoice_amount", LogisticsProviderOperations.decimal(
                        item.unitPriceMinor(), item.currency()));
                invoice.put("invoice_pcs", item.quantity());
                invoice.put("invoice_currency", item.currency());
                invoice.put("sku", item.sku());
                invoice.put("sku_code", item.sku());
                invoices.add(invoice);
            }
            payload.put("orderInvoiceParam", invoices);
            String form = "param=" + encode(JSON.writeValueAsString(payload));
            HttpRequest.Builder createRequest = HttpRequest.newBuilder(URI.create(
                            endpoint.apiUrl("/createOrderApi.htm")
                                    + (endpoint.formEncodedCreate() ? "" : "?" + form)))
                    .timeout(timeout)
                    .header("Accept", "application/json,text/plain,*/*");
            if (endpoint.formEncodedCreate()) {
                createRequest.header("Content-Type",
                                "application/x-www-form-urlencoded; charset=UTF-8")
                        .POST(HttpRequest.BodyPublishers.ofString(
                                form, StandardCharsets.UTF_8));
            } else {
                createRequest.POST(HttpRequest.BodyPublishers.noBody());
            }
            WireResponse response = send(createRequest.build(),
                    MAX_CHANNEL_BYTES, "create");
            rejectOrFail(response, "create");
            JsonNode root = JSON.readTree(decode(response));
            if (!LogisticsProviderPayloadSupport.truthy(root, "ack")) {
                throw new OperationException("PROVIDER_CREATE_REJECTED", true);
            }
            String providerOrder = LogisticsProviderPayloadSupport.text(
                    root, "order_id");
            String tracking = LogisticsProviderPayloadSupport.text(
                    root, "tracking_number", "trackingNumber");
            if (providerOrder == null) {
                throw new OperationException(
                        "PROVIDER_CREATE_RESPONSE_INVALID", false);
            }
            String labelUrl = endpoint.labelBaseUrl()
                    + "/order/FastRpt/PDF_NEW.aspx?PrintType=lab10_10&order_id="
                    + encode(providerOrder);
            return new CreateResult(providerOrder, tracking, labelUrl,
                    tracking == null ? "CREATED" : "IN_TRANSIT",
                    LogisticsProviderPayloadSupport.text(root,
                            "product_tracknoapitype", "message"));
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
            authenticate(endpoint, credentials.username(), credentials.password());
            String lookup = trackingReference == null
                    ? resolveTrackingNumber(endpoint, clientReference,
                            providerOrderReference)
                    : trackingReference;
            if (lookup == null || lookup.isBlank()) {
                throw new OperationException("TRACKING_REFERENCE_PENDING", true);
            }
            WireResponse response = send(HttpRequest.newBuilder(URI.create(
                            endpoint.baseUrl() + "/selectTrack.htm?documentCode="
                                    + encode(lookup)))
                    .timeout(timeout)
                    .header("Accept", "application/json,text/plain,*/*")
                    .GET().build(), MAX_CHANNEL_BYTES, "tracking");
            rejectOrFail(response, "tracking");
            JsonNode root = JSON.readTree(decode(response));
            JsonNode container = root != null && root.isArray() && !root.isEmpty()
                    ? root.get(0) : root;
            if (container == null
                    || (container.has("ack")
                    && !LogisticsProviderPayloadSupport.truthy(container, "ack"))) {
                throw new OperationException(
                        "PROVIDER_TRACKING_REJECTED", true);
            }
            JsonNode parcel = container;
            if (container.path("data").isArray()
                    && !container.path("data").isEmpty()) {
                parcel = container.path("data").get(0);
            }
            JsonNode details = parcel.path("trackDetails");
            List<TrackingEvent> events = new ArrayList<>();
            if (details.isArray()) {
                for (JsonNode item : details) {
                    String description = LogisticsProviderPayloadSupport.text(
                            item, "track_content", "trackContent", "description");
                    if (description == null) continue;
                    String providerStatus = LogisticsProviderPayloadSupport.text(
                            item, "businessStatus", "status", "track_status");
                    String normalized = LogisticsProviderPayloadSupport.normalizeStatus(
                            providerStatus == null ? description : providerStatus);
                    Instant occurredAt = LogisticsProviderPayloadSupport.instant(
                            LogisticsProviderPayloadSupport.text(item,
                                    "track_date", "trackDate", "time"));
                    String location = LogisticsProviderPayloadSupport.text(
                            item, "track_location", "location", "city");
                    events.add(new TrackingEvent(
                            LogisticsProviderPayloadSupport.eventKey(
                                    providerStatus, description, location, occurredAt),
                            normalized, providerStatus, description, location,
                            occurredAt));
                }
            }
            String providerStatus = LogisticsProviderPayloadSupport.text(
                    parcel, "businessStatus", "status");
            String summary = LogisticsProviderPayloadSupport.text(
                    parcel, "trackContent", "message");
            String normalized = newestStatus(events,
                    LogisticsProviderPayloadSupport.normalizeStatus(
                            providerStatus == null ? summary : providerStatus));
            String resolvedTracking = LogisticsProviderPayloadSupport.text(
                    parcel, "trackingNumber", "tracking_number");
            return new TrackingResult(
                    resolvedTracking == null ? trackingReference : resolvedTracking,
                    providerOrderReference == null ? null
                            : endpoint.labelBaseUrl()
                                    + "/order/FastRpt/PDF_NEW.aspx?PrintType=lab10_10&order_id="
                                    + encode(providerOrderReference),
                    normalized, providerStatus, summary, events);
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

    void confirmHandover(String providerCode, CredentialMaterial credentials,
            String clientReference) {
        Endpoint endpoint = operationalEndpoint(providerCode);
        if (!endpoint.handoverSupported()) return;
        try {
            AuthIdentity identity = authenticate(endpoint, credentials.username(),
                    credentials.password());
            WireResponse response = send(HttpRequest.newBuilder(URI.create(
                            endpoint.apiUrl("/postOrderApi.htm") + "?customer_id="
                                    + encode(identity.customerId())
                                    + "&order_customerinvoicecode="
                                    + encode(clientReference)))
                    .timeout(timeout)
                    .header("Accept", "application/json,text/plain,*/*")
                    .POST(HttpRequest.BodyPublishers.noBody()).build(),
                    MAX_AUTH_BYTES, "handover");
            rejectOrFail(response, "handover");
            JsonNode root = JSON.readTree(decode(response));
            if (root != null && root.has("ack")
                    && !LogisticsProviderPayloadSupport.truthy(root, "ack")) {
                throw new OperationException(
                        "PROVIDER_HANDOVER_REJECTED", true);
            }
        } catch (OperationException exception) {
            throw exception;
        } catch (AuthorizationRejectedException exception) {
            throw new OperationException(
                    "PROVIDER_AUTHORIZATION_REJECTED", true);
        } catch (Exception exception) {
            interrupted(exception);
            throw new OperationException(
                    "PROVIDER_HANDOVER_UNAVAILABLE", false);
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

    private String resolveTrackingNumber(Endpoint endpoint,
            String clientReference, String providerOrderReference) {
        String lookup = endpoint.trackingLookupByOrderId()
                ? providerOrderReference : clientReference;
        if (lookup == null || lookup.isBlank()) return null;
        try {
            WireResponse response = send(HttpRequest.newBuilder(URI.create(
                            endpoint.apiUrl("/getOrderTrackingNumber.htm?")
                                    + (endpoint.trackingLookupByOrderId()
                                    ? "order_id=" : "documentCode=")
                                    + encode(lookup)))
                    .timeout(timeout)
                    .header("Accept", "application/json,text/plain,*/*")
                    .GET().build(), MAX_AUTH_BYTES, "tracking-number");
            rejectOrFail(response, "tracking-number");
            JsonNode root = JSON.readTree(decode(response));
            JsonNode value = root != null && root.isArray() && !root.isEmpty()
                    ? root.get(0) : root;
            String tracking = LogisticsProviderPayloadSupport.text(value,
                    "tracking_number", "trackingNumber",
                    "order_referencecode", "order_serveinvoicecode");
            if (tracking != null) return tracking;
            JsonNode children = value == null ? null : value.path("childno");
            return children != null && children.isArray() && !children.isEmpty()
                    ? fieldText(children.get(0)) : null;
        } catch (Exception exception) {
            return null;
        }
    }

    private static String newestStatus(List<TrackingEvent> events,
            String fallback) {
        return events.stream()
                .max(java.util.Comparator.comparing(TrackingEvent::occurredAt))
                .map(TrackingEvent::normalizedStatus)
                .orElse(fallback);
    }

    private AuthIdentity authenticate(Endpoint endpoint, String username,
            String password) {
        try {
            String query = "username=" + encode(username)
                    + "&password=" + encode(password);
            HttpRequest request = HttpRequest.newBuilder(URI.create(
                            endpoint.apiUrl("/selectAuth.htm") + "?" + query))
                    .timeout(timeout)
                    .header("Accept", "application/json,text/plain,*/*")
                    .GET()
                    .build();
            WireResponse response = send(request, MAX_AUTH_BYTES,
                    "authentication");
            rejectOrFail(response, "authentication");
            String body = decode(response);
            var customerId = CUSTOMER_ID.matcher(body);
            var customerUserId = CUSTOMER_USER_ID.matcher(body);
            if (!ACK_TRUE.matcher(body).find()
                    || !customerId.find()
                    || !customerUserId.find()) {
                if (body.toLowerCase().contains("ack")
                        && body.toLowerCase().contains("false")) {
                    throw new AuthorizationRejectedException(
                            "AUTHENTICATION_REJECTED", response);
                }
                throw new ConnectorUnavailableException(
                        "authentication", "INVALID_AUTH_RESPONSE", response);
            }
            return new AuthIdentity(customerId.group(1),
                    customerUserId.group(1));
        } catch (AuthorizationRejectedException | ConnectorUnavailableException exception) {
            throw exception;
        } catch (Exception exception) {
            interrupted(exception);
            throw new ConnectorUnavailableException(
                    "authentication", "AUTH_REQUEST_PROCESSING_FAILED");
        }
    }

    private List<DiscoveredChannel> fetchChannels(Endpoint endpoint) {
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(
                            endpoint.apiUrl("/getProductList.htm")))
                    .timeout(timeout)
                    .header("Accept", "application/json,text/plain,*/*")
                    .GET()
                    .build();
            WireResponse response = send(request, MAX_CHANNEL_BYTES, "channels");
            rejectOrFail(response, "channels");
            JsonNode root = JSON.readTree(decode(response));
            if (root == null || !root.isArray()) {
                throw new ConnectorUnavailableException(
                        "channels", "INVALID_CHANNEL_RESPONSE", response);
            }
            List<DiscoveredChannel> channels = new ArrayList<>();
            for (JsonNode entry : root) {
                if (entry == null || !entry.isObject()) continue;
                String code = fieldText(entry.path("product_id"));
                String name = fieldText(entry.path("product_shortname"));
                if (code != null && name != null
                        && (endpoint.channels().isEmpty()
                        || endpoint.channels().containsKey(code))) {
                    channels.add(new DiscoveredChannel(code,
                            endpoint.channels().getOrDefault(code, name)));
                }
            }
            if (!root.isEmpty() && channels.isEmpty()) {
                throw new ConnectorUnavailableException(
                        "channels", "INVALID_CHANNEL_RESPONSE", response);
            }
            return List.copyOf(channels);
        } catch (AuthorizationRejectedException | ConnectorUnavailableException exception) {
            throw exception;
        } catch (Exception exception) {
            interrupted(exception);
            throw new ConnectorUnavailableException(
                    "channels", "CHANNEL_REQUEST_PROCESSING_FAILED");
        }
    }

    private WireResponse send(HttpRequest request, int maximumBytes,
            String phase) {
        try {
            HttpResponse<InputStream> response = client.send(
                    request, HttpResponse.BodyHandlers.ofInputStream());
            try (InputStream input = response.body()) {
                byte[] body = input.readNBytes(maximumBytes + 1);
                WireResponse wire = new WireResponse(response.statusCode(),
                        safeContentType(response.headers().firstValue(
                                "Content-Type").orElse("missing")), body);
                if (body.length > maximumBytes) {
                    throw new ConnectorUnavailableException(
                            phase, "RESPONSE_TOO_LARGE", wire);
                }
                return wire;
            }
        } catch (ConnectorUnavailableException exception) {
            throw exception;
        } catch (Exception exception) {
            interrupted(exception);
            throw new ConnectorUnavailableException(phase,
                    exception instanceof InterruptedException
                            ? "REQUEST_INTERRUPTED" : "TRANSPORT_FAILURE");
        }
    }

    private static void rejectOrFail(WireResponse response, String phase) {
        int status = response.status();
        if (status == 400 || status == 401 || status == 403) {
            throw new AuthorizationRejectedException(
                    "UPSTREAM_AUTHORIZATION_REJECTED", response);
        }
        if (status < 200 || status >= 300) {
            throw new ConnectorUnavailableException(
                    phase, "UPSTREAM_HTTP_STATUS", response);
        }
    }

    private static String decode(WireResponse response) {
        String contentType = response.contentType().toLowerCase();
        Charset charset = contentType.contains("charset=gbk")
                || contentType.contains("charset=gb2312")
                ? Charset.forName("GBK") : StandardCharsets.UTF_8;
        return new String(response.body(), charset).strip();
    }

    private static String fieldText(JsonNode node) {
        if (node == null || (!node.isTextual() && !node.isNumber())) return null;
        String value = node.asText().strip();
        return value.isEmpty() || value.length() > 256 ? null : value;
    }

    private static String safeContentType(String value) {
        if (value == null || value.isBlank()) return "missing";
        String normalized = value.replaceAll("[^\\x20-\\x7E]", "?");
        return normalized.substring(0, Math.min(normalized.length(), 128));
    }

    private static void logFailure(Endpoint endpoint, String phase,
            ConnectorFailure failure) {
        LOGGER.warn(
                "hualei_connector_failure provider={} phase={} reason={} upstream_status={} content_type={} response_bytes={}",
                endpoint.name(), phase, failure.reason(), failure.upstreamStatus(),
                failure.contentType(), failure.responseBytes());
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private static String validateBaseUrl(String raw) {
        try {
            URI value = URI.create(raw == null ? "" : raw.strip());
            if (value.getHost() == null || value.getUserInfo() != null
                    || value.getQuery() != null || value.getFragment() != null
                    || !("http".equalsIgnoreCase(value.getScheme())
                    || "https".equalsIgnoreCase(value.getScheme()))) {
                throw new IllegalArgumentException(
                        "Hualei logistics connector base URL is invalid");
            }
            String path = value.getPath();
            if (path != null && path.contains("..")) {
                throw new IllegalArgumentException(
                        "Hualei logistics connector base URL is invalid");
            }
            return value.toString().replaceAll("/+$", "");
        } catch (IllegalArgumentException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new IllegalArgumentException(
                    "Hualei logistics connector base URL is invalid", exception);
        }
    }

    private static Duration validateTimeout(Duration value) {
        if (value == null || value.isZero() || value.isNegative()
                || value.compareTo(Duration.ofSeconds(30)) > 0) {
            throw new IllegalArgumentException(
                    "Hualei logistics connector timeout must be 1-30 seconds");
        }
        return value;
    }

    private static void interrupted(Exception exception) {
        if (exception instanceof InterruptedException) {
            Thread.currentThread().interrupt();
        }
    }

    record Endpoint(String name, String baseUrl, String labelBaseUrl,
            String apiPrefix, boolean formEncodedCreate,
            boolean handoverSupported, boolean trackingLookupByOrderId,
            Map<String, String> channels) {
        Endpoint {
            apiPrefix = apiPrefix == null ? "" : apiPrefix;
            channels = Map.copyOf(channels == null ? Map.of() : channels);
        }

        Endpoint(String name, String baseUrl) {
            this(name, baseUrl, baseUrl, "", false,
                    true, false, Map.of());
        }

        String apiUrl(String path) {
            return baseUrl + apiPrefix + path;
        }
    }

    private record AuthIdentity(String customerId, String customerUserId) {
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

        ConnectorFailure(String reason, WireResponse response) {
            this.reason = reason;
            this.upstreamStatus = response == null ? null : response.status();
            this.contentType = response == null ? null : response.contentType();
            this.responseBytes = response == null ? null : response.body().length;
        }

        String reason() { return reason; }
        Integer upstreamStatus() { return upstreamStatus; }
        String contentType() { return contentType; }
        Integer responseBytes() { return responseBytes; }
    }

    private static final class AuthorizationRejectedException
            extends ConnectorFailure {
        AuthorizationRejectedException(String reason, WireResponse response) {
            super(reason, response);
        }
    }

    private static final class ConnectorUnavailableException
            extends ConnectorFailure {
        private final String phase;

        ConnectorUnavailableException(String phase, String reason) {
            this(phase, reason, null);
        }

        ConnectorUnavailableException(String phase, String reason,
                WireResponse response) {
            super(reason, response);
            this.phase = phase;
        }

        String phase() { return phase; }
    }
}
