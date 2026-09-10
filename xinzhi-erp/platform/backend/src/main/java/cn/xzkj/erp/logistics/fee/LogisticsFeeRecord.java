package cn.xzkj.erp.logistics.fee;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

record LogisticsFeeRecord(
        UUID id, String platformName, String shopName, String channelName,
        String orderReference, String trackingReference,
        String transactionReference, BigDecimal estimatedFee,
        BigDecimal actualFee, String currency, BigDecimal carrierWeightKg,
        BigDecimal warehouseWeightKg, LocalDate shippedOn,
        String confirmationStatus, String lifecycleStatus, String note,
        String confirmedByDisplayName, Instant confirmedAt,
        String createdByDisplayName, long version,
        Instant createdAt, Instant updatedAt) {

    BigDecimal feeVariance() {
        return estimatedFee == null || actualFee == null
                ? null : actualFee.subtract(estimatedFee);
    }

    BigDecimal weightVarianceKg() {
        return carrierWeightKg == null || warehouseWeightKg == null
                ? null : carrierWeightKg.subtract(warehouseWeightKg);
    }
}
