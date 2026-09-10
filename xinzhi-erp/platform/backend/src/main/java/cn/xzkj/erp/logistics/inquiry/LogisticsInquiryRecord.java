package cn.xzkj.erp.logistics.inquiry;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record LogisticsInquiryRecord(
        UUID id,
        String inquiryNo,
        String origin,
        String destination,
        int weeklyOrderCount,
        BigDecimal weeklyWeightKg,
        String category,
        String contactName,
        String contactPhone,
        String status,
        String note,
        long activeQuoteCount,
        Instant publishedAt,
        String createdByDisplayName,
        long version,
        Instant createdAt,
        Instant updatedAt) {
}

record LogisticsInquiryQuoteRecord(
        UUID id,
        UUID inquiryId,
        String providerName,
        String serviceName,
        BigDecimal pricePerKg,
        String currency,
        int transitDays,
        String note,
        String status,
        String createdByDisplayName,
        long version,
        Instant createdAt,
        Instant updatedAt) {
}

record LogisticsInquiryDetail(
        LogisticsInquiryRecord inquiry,
        List<LogisticsInquiryQuoteRecord> quotes) {
}

record LogisticsInquiryContactRecord(
        String contactName,
        String contactPhone,
        long version,
        Instant updatedAt) {
}
