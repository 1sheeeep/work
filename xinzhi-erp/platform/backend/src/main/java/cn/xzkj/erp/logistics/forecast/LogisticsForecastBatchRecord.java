package cn.xzkj.erp.logistics.forecast;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

record LogisticsForecastBatchRecord(
        UUID id, String batchNo, String batchType, String forwarder,
        List<String> orderReferences, int orderCount,
        BigDecimal totalWeightKg, String status, boolean printed,
        String resultMessage, String createdByDisplayName, long version,
        Instant createdAt, Instant updatedAt) {
}
