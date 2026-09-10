package cn.xzkj.erp.logistics.authorization;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface LogisticsProviderOperations {
    CreateResult create(UUID tenantId, UUID authorizationId, UUID channelId,
            Shipment shipment);

    TrackingResult track(UUID tenantId, UUID authorizationId, UUID channelId,
            String clientReference, String providerOrderReference,
            String trackingReference);

    void confirmHandover(UUID tenantId, UUID authorizationId, UUID channelId,
            String clientReference, String providerOrderReference,
            String trackingReference);

    record Shipment(
            String clientReference,
            String recipientName,
            String recipientCompany,
            String recipientPhone,
            String recipientEmail,
            String addressLine1,
            String addressLine2,
            String city,
            String province,
            String postalCode,
            String countryCode,
            long weightGrams,
            int quantity,
            String currency,
            List<Item> items) {
        public Shipment {
            items = items == null ? List.of() : List.copyOf(items);
        }
    }

    record Item(
            String sku,
            String name,
            int quantity,
            long unitPriceMinor,
            String currency) {
    }

    record CreateResult(
            String providerOrderReference,
            String trackingReference,
            String labelUrl,
            String normalizedStatus,
            String providerStatus) {
    }

    record TrackingResult(
            String trackingReference,
            String labelUrl,
            String normalizedStatus,
            String providerStatus,
            String summary,
            List<TrackingEvent> events) {
        public TrackingResult {
            events = events == null ? List.of() : List.copyOf(events);
        }
    }

    record TrackingEvent(
            String providerEventKey,
            String normalizedStatus,
            String providerStatus,
            String description,
            String location,
            Instant occurredAt) {
    }

    final class OperationException extends RuntimeException {
        private final String safeCode;
        private final boolean definitive;

        public OperationException(String safeCode, boolean definitive) {
            super(safeCode);
            this.safeCode = safeCode;
            this.definitive = definitive;
        }

        public String safeCode() {
            return safeCode;
        }

        public boolean definitive() {
            return definitive;
        }
    }

    static BigDecimal decimal(long minor, String currency) {
        int scale = switch (currency) {
            case "JPY", "KRW" -> 0;
            default -> 2;
        };
        return BigDecimal.valueOf(minor, scale);
    }
}
