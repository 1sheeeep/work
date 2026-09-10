package cn.xzkj.erp.order.api;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import cn.xzkj.erp.order.domain.OrderStatus;
import cn.xzkj.erp.order.domain.OrderQueryContracts.ConditionField;
import cn.xzkj.erp.order.domain.OrderQueryContracts.ConditionLogic;
import cn.xzkj.erp.order.domain.OrderQueryContracts.ConditionOperator;
import cn.xzkj.erp.order.domain.OrderQueryContracts.ListStage;
import cn.xzkj.erp.order.domain.OrderQueryContracts.SortDirection;
import cn.xzkj.erp.order.domain.OrderQueryContracts.SortField;
import cn.xzkj.erp.order.domain.OrderQueryContracts.TimeField;
import cn.xzkj.erp.order.repository.OrderTransferRepository.TransferJob;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

public final class OrderOperationsDtos {
    private OrderOperationsDtos() {
    }

    public record BulkStatusRequest(
            @NotNull UUID commandId,
            @NotNull OrderStatus targetStatus,
            @Size(max = 500) String reason,
            @NotEmpty @Size(max = 200) List<@Valid BulkStatusItem> orders) {
    }

    public record BulkStatusItem(
            @NotNull UUID orderId,
            @PositiveOrZero long version) {
    }

    public record TransferFilterRequest(
            UUID shopId,
            UUID warehouseId,
            OrderStatus status,
            @Pattern(regexp = "UNPAID|PAID|PARTIALLY_REFUNDED|REFUNDED")
            String paymentStatus,
            @Size(max = 64) String platformStatus,
            @Pattern(regexp = "^[A-Z]{2}$") String countryCode,
            @Size(max = 32) String trackingStatus,
            @Pattern(regexp = "^[A-Z]{3}$") String currency,
            Boolean printed,
            Boolean reshipment,
            @PositiveOrZero Long minAmountMinor,
            @PositiveOrZero Long maxAmountMinor,
            BigDecimal minWeightGrams,
            BigDecimal maxWeightGrams,
            Instant placedFrom,
            Instant placedTo,
            Instant paidFrom,
            Instant paidTo,
            @Size(max = 100) String keyword,
            @Size(max = 100) String skuKeyword,
            UUID platformId,
            ListStage stage,
            @Size(max = 80) String logisticsChannel,
            @Size(max = 80) String fixedCategory,
            @Size(max = 80) String customCategory,
            @Size(max = 80) String customerCategory,
            UUID locationId,
            UUID pickerUserId,
            UUID shipperUserId,
            UUID salespersonUserId,
            UUID purchaserUserId,
            UUID developerUserId,
            UUID managerUserId,
            @Size(max = 160) String supplierReference,
            @Size(max = 120) String parentProductCategory,
            @Size(max = 120) String childProductCategory,
            @Size(max = 40) String productStatus,
            @Size(max = 160) String extendedAttribute,
            @jakarta.validation.constraints.Min(1) Integer minProductKinds,
            @jakarta.validation.constraints.Min(1) Integer maxProductKinds,
            ConditionField conditionField1,
            ConditionOperator conditionOperator1,
            @Size(max = 200) String conditionValue1,
            ConditionField conditionField2,
            ConditionOperator conditionOperator2,
            @Size(max = 200) String conditionValue2,
            ConditionLogic conditionLogic,
            TimeField timeField1,
            Instant timeFrom1,
            Instant timeTo1,
            TimeField timeField2,
            Instant timeFrom2,
            Instant timeTo2,
            SortField sortField,
            SortDirection sortDirection) {

        public TransferFilterRequest(
                UUID shopId,
                UUID warehouseId,
                OrderStatus status,
                String paymentStatus,
                String platformStatus,
                String countryCode,
                String trackingStatus,
                String currency,
                Boolean printed,
                Boolean reshipment,
                Long minAmountMinor,
                Long maxAmountMinor,
                BigDecimal minWeightGrams,
                BigDecimal maxWeightGrams,
                Instant placedFrom,
                Instant placedTo,
                Instant paidFrom,
                Instant paidTo,
                String keyword,
                String skuKeyword) {
            this(
                    shopId, warehouseId, status, paymentStatus,
                    platformStatus, countryCode, trackingStatus, currency,
                    printed, reshipment, minAmountMinor, maxAmountMinor,
                    minWeightGrams, maxWeightGrams, placedFrom, placedTo,
                    paidFrom, paidTo, keyword, skuKeyword,
                    null, null, null, null, null, null, null, null,
                    null, null, null, null, null, null, null, null,
                    null, null, null, null, null, null, null, null,
                    null, null, null, null, null, null, null, null,
                    null, null, null);
        }
    }

    public record TransferResultResponse(
            UUID jobId,
            String status,
            int requestedCount,
            int succeededCount,
            int failedCount,
            String filename,
            String mediaType,
            String contentBase64) {
    }

    public record TransferJobResponse(
            UUID id,
            String jobType,
            String status,
            int requestedCount,
            int succeededCount,
            int failedCount,
            String safeErrorSummary,
            long version,
            Instant createdAt,
            Instant completedAt) {

        public static TransferJobResponse from(TransferJob job) {
            return new TransferJobResponse(
                    job.id(), job.jobType(), job.status(),
                    job.requestedCount(), job.succeededCount(), job.failedCount(),
                    job.safeErrorSummary(), job.version(),
                    job.createdAt(), job.completedAt());
        }
    }

    public record ImportOptions(
            @NotBlank
            @Pattern(regexp = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$")
            String idempotencyKey) {
    }
}
