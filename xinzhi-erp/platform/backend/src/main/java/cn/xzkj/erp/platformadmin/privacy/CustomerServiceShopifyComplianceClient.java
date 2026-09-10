package cn.xzkj.erp.platformadmin.privacy;

import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyComplianceRequest;
import java.io.InputStream;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Component
public class CustomerServiceShopifyComplianceClient {

    static final String CONTRACT_VERSION =
            "customer_service.shopify_compliance.v1";
    private static final int MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
    private static final Pattern EMAIL_HASH = Pattern.compile("^[a-f0-9]{64}$");
    private static final ObjectMapper JSON = new ObjectMapper()
            .rebuild()
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .build();

    private final URI baseOrigin;
    private final String serviceToken;
    private final Duration timeout;
    private final HttpClient client;

    @Autowired
    public CustomerServiceShopifyComplianceClient(
            @Value("${erp.customer-service.entry-origin:}") String rawOrigin,
            @Value("${erp.channel-connector.xz-erp-app.token:}") String rawToken,
            @Value("${erp.customer-service.compliance-timeout:PT20S}")
            Duration timeout,
            @Value("${erp.environment:local}") String environment) {
        this(rawOrigin, rawToken, timeout, environment,
                HttpClient.newBuilder()
                        .followRedirects(HttpClient.Redirect.NEVER)
                        .build());
    }

    CustomerServiceShopifyComplianceClient(
            String rawOrigin,
            String rawToken,
            Duration timeout,
            String environment,
            HttpClient client) {
        this.baseOrigin = normalizeOrigin(rawOrigin, environment);
        this.serviceToken = rawToken == null ? "" : rawToken.strip();
        this.timeout = timeout == null ? Duration.ofSeconds(20) : timeout;
        if (this.timeout.isZero() || this.timeout.isNegative()
                || this.timeout.compareTo(Duration.ofSeconds(60)) > 0) {
            throw new IllegalArgumentException(
                    "Customer-service compliance timeout must be 1-60 seconds");
        }
        this.client = Objects.requireNonNull(client);
    }

    CustomerServiceExport export(ShopifyComplianceRequest request) {
        ComplianceResponse response = post(
                "/api/v1/internal/customer-service/shopify-compliance/export",
                payload(request),
                ComplianceResponse.class,
                request.tenantId().toString());
        validateResponse(response, request.eventId());
        return new CustomerServiceExport(response.recordCount(), response.data());
    }

    CustomerServiceRedaction redact(ShopifyComplianceRequest request) {
        RedactionResponse response = post(
                "/api/v1/internal/customer-service/shopify-compliance/redact",
                payload(request),
                RedactionResponse.class,
                request.tenantId().toString());
        if (response == null
                || !CONTRACT_VERSION.equals(response.contractVersion())
                || !request.eventId().equals(response.eventId())
                || response.recordCount() < 0
                || response.recordCount() > 50_000
                || response.attachmentsDeleted() < 0
                || response.attachmentsDeleted() > response.recordCount()) {
            throw new CustomerServiceComplianceUnavailableException();
        }
        return new CustomerServiceRedaction(
                response.recordCount(),
                response.attachmentsDeleted(),
                response.alreadyCompleted());
    }

    private static CompliancePayload payload(ShopifyComplianceRequest request) {
        List<String> customerIds = new ArrayList<>();
        List<String> orderIds = new ArrayList<>();
        List<String> emailHashes = new ArrayList<>();
        for (String reference : request.referenceIds()) {
            if (reference.startsWith("customer:")) {
                customerIds.add(reference.substring("customer:".length()));
            } else if (reference.startsWith("order:")) {
                orderIds.add(reference.substring("order:".length()));
            } else if (reference.startsWith("customer_email_sha256:")) {
                String value = reference.substring(
                        "customer_email_sha256:".length());
                if (!EMAIL_HASH.matcher(value).matches()) {
                    throw new CustomerServiceComplianceUnavailableException();
                }
                emailHashes.add(value);
            }
        }
        return new CompliancePayload(
                request.eventId(),
                request.shopId().toString(),
                request.shopDomain(),
                request.topic().name(),
                distinct(customerIds),
                distinct(orderIds),
                distinct(emailHashes));
    }

    private <T> T post(
            String path,
            CompliancePayload payload,
            Class<T> responseType,
            String tenantId) {
        if (baseOrigin == null || serviceToken.isBlank()) {
            throw new CustomerServiceComplianceUnavailableException();
        }
        try {
            byte[] body = JSON.writeValueAsBytes(payload);
            HttpRequest request = HttpRequest.newBuilder(baseOrigin.resolve(path))
                    .timeout(timeout)
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json")
                    .header("X-XZ-ERP-Connector-Token", serviceToken)
                    .header("X-XZ-Tenant-ID", tenantId)
                    .POST(HttpRequest.BodyPublishers.ofByteArray(body))
                    .build();
            HttpResponse<InputStream> response = client.send(
                    request, HttpResponse.BodyHandlers.ofInputStream());
            try (InputStream stream = response.body()) {
                byte[] raw = stream.readNBytes(MAX_RESPONSE_BYTES + 1);
                if (raw.length > MAX_RESPONSE_BYTES
                        || response.statusCode() < 200
                        || response.statusCode() >= 300) {
                    throw new CustomerServiceComplianceUnavailableException();
                }
                return JSON.readValue(raw, responseType);
            }
        } catch (CustomerServiceComplianceUnavailableException exception) {
            throw exception;
        } catch (Exception exception) {
            if (exception instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            throw new CustomerServiceComplianceUnavailableException();
        }
    }

    private static void validateResponse(
            ComplianceResponse response,
            String eventId) {
        if (response == null
                || !CONTRACT_VERSION.equals(response.contractVersion())
                || !eventId.equals(response.eventId())
                || response.recordCount() < 0
                || response.recordCount() > 50_000
                || response.data() == null
                || !response.data().isObject()) {
            throw new CustomerServiceComplianceUnavailableException();
        }
    }

    private static List<String> distinct(List<String> values) {
        Set<String> unique = new LinkedHashSet<>(values);
        return List.copyOf(unique);
    }

    private static URI normalizeOrigin(String raw, String environment) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            URI uri = new URI(raw.strip());
            String scheme = uri.getScheme() == null
                    ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            String host = uri.getHost() == null
                    ? "" : uri.getHost().toLowerCase(Locale.ROOT);
            boolean loopback = host.equals("localhost")
                    || host.equals("127.0.0.1") || host.equals("::1");
            boolean local = "local".equalsIgnoreCase(environment);
            if (uri.getRawUserInfo() != null || uri.getRawQuery() != null
                    || uri.getRawFragment() != null
                    || (!uri.getPath().isEmpty() && !"/".equals(uri.getPath()))
                    || host.isEmpty()
                    || !("https".equals(scheme)
                    || (local && loopback && "http".equals(scheme)))) {
                return null;
            }
            return new URI(
                    scheme, null, host, uri.getPort(), "/", null, null);
        } catch (URISyntaxException invalid) {
            return null;
        }
    }

    record CustomerServiceExport(int recordCount, JsonNode data) {
    }

    record CustomerServiceRedaction(
            int recordCount,
            int attachmentsDeleted,
            boolean alreadyCompleted) {
    }

    private record CompliancePayload(
            String eventId,
            String shopId,
            String shopDomain,
            String topic,
            List<String> customerIds,
            List<String> orderIds,
            List<String> customerEmailSha256) {
    }

    private record ComplianceResponse(
            String contractVersion,
            String eventId,
            int recordCount,
            JsonNode data) {
    }

    private record RedactionResponse(
            String contractVersion,
            String eventId,
            int recordCount,
            int attachmentsDeleted,
            boolean alreadyCompleted) {
    }
}

final class CustomerServiceComplianceUnavailableException
        extends RuntimeException {

    CustomerServiceComplianceUnavailableException() {
        super("Customer-service compliance operation is unavailable");
    }
}
