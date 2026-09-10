package cn.xzkj.erp.order.api;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import cn.xzkj.erp.order.domain.OrderDashboardSummary;
import cn.xzkj.erp.order.domain.OrderLine;
import cn.xzkj.erp.order.domain.OrderListItem;
import cn.xzkj.erp.order.domain.OrderActivity;
import cn.xzkj.erp.order.domain.OrderProfile;
import cn.xzkj.erp.order.domain.OrderStatus;
import cn.xzkj.erp.order.domain.SkuMatchQueueItem;
import cn.xzkj.erp.order.domain.SkuMatchSource;
import cn.xzkj.erp.order.domain.TenantOrder;
import cn.xzkj.erp.order.service.OrderCenterService.OrderAggregate;
import cn.xzkj.erp.order.service.SkuSalesSummaryView;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

public final class OrderDtos {
    private OrderDtos() { }

    public record CreateOrderRequest(
            @NotNull UUID shopId,
            @NotBlank @Size(max = 160) String externalOrderRef,
            @NotBlank @Pattern(regexp = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$") String idempotencyKey,
            @NotBlank @Pattern(regexp = "^[A-Z]{3}$") String currency,
            @Size(max = 200) String buyerReference,
            @NotNull Instant placedAt,
            UUID warehouseId,
            @Valid OperationalFields operational,
            @Valid OrderProfileRequest profile,
            @NotNull @Size(min = 1, max = 200) List<@Valid CreateOrderLineRequest> lines) { }

    public record OrderProfileRequest(
            @Valid ReferenceFields references,
            @Valid RecipientFields recipient,
            @Valid FinancialFields financials,
            @Valid MessageFields messages,
            @Valid ClassificationFields classification,
            @Valid AssignmentFields assignments,
            @Valid OperationalTimes times) {
    }

    public record ReferenceFields(
            @Size(max = 160) String salesRecordNumber,
            @Size(max = 160) String shoppingCartReference,
            @Size(max = 160) String customOrderReference,
            @Size(max = 160) String customerId,
            @Size(max = 160) String customerCode,
            @Size(max = 120) String shippingService,
            @Size(max = 160) String trackingReference,
            @Size(max = 160) String secondaryTrackingReference) {
    }

    public record RecipientFields(
            @Size(max = 200) String name,
            @Size(max = 40) String phone,
            @Size(max = 254) String email,
            @Size(max = 200) String company,
            @Size(max = 300) String addressLine1,
            @Size(max = 300) String addressLine2,
            @Size(max = 120) String city,
            @Size(max = 120) String district,
            @Size(max = 120) String town,
            @Size(max = 80) String doorCode) {
    }

    public record FinancialFields(
            @PositiveOrZero Long itemAmountMinor,
            @PositiveOrZero Long platformFeeMinor,
            @PositiveOrZero Long insuranceFeeMinor,
            @PositiveOrZero Long paymentFeeMinor,
            @PositiveOrZero Long otherIncomeMinor,
            @PositiveOrZero Long otherExpenseMinor,
            @PositiveOrZero Long actualPaidMinor,
            Long profitMinor,
            Long taxMinor,
            @PositiveOrZero Long estimatedShippingMinor,
            @PositiveOrZero Long actualShippingMinor) {
    }

    public record MessageFields(
            @Size(max = 1000) String platformMessage,
            @Size(max = 1000) String platformRemark,
            @Size(max = 1000) String orderRemark,
            @Size(max = 1000) String declarationPlan,
            @Size(max = 1000) String declarationActual) {
    }

    public record ClassificationFields(
            @Size(max = 80) String customerCategory,
            @Positive Integer productKindCount,
            @Size(max = 160) String supplierReference,
            @Size(max = 120) String parentProductCategory,
            @Size(max = 120) String childProductCategory,
            @Size(max = 40) String productStatus,
            @Size(max = 160) String extendedAttribute) {
    }

    public record AssignmentFields(
            UUID locationId,
            UUID pickerUserId,
            UUID shipperUserId,
            UUID salespersonUserId,
            UUID purchaserUserId,
            UUID developerUserId,
            UUID managerUserId) {
    }

    public record OperationalTimes(
            Instant printedAt,
            Instant platformReturnedAt,
            Instant exceptionReviewedAt,
            Instant cancelledAt,
            Instant handedOverAt,
            Instant platformSpecifiedHandoverAt,
            Instant platformLabelRequestedAt,
            Instant deliveryDeadlineAt,
            Instant deliveredAt) {
    }

    public record UpdateOrderProfileRequest(
            @NotNull @PositiveOrZero Long version,
            @NotNull @PositiveOrZero Long profileVersion,
            UUID warehouseId,
            @Valid OperationalFields operational,
            @NotNull @Valid OrderProfileRequest profile) {
    }

    public record ShopifyShippingAddressUpdateRequest(
            @NotNull @PositiveOrZero Long version,
            @NotNull @PositiveOrZero Long profileVersion,
            @NotBlank
            @Pattern(regexp = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$")
            String idempotencyKey,
            @NotNull @Valid ShopifyShippingAddressRequest address) {
    }

    public record ShopifyShippingAddressRequest(
            @Size(max = 100) String firstName,
            @Size(max = 100) String lastName,
            @Size(max = 200) String company,
            @NotBlank @Size(max = 300) String address1,
            @Size(max = 300) String address2,
            @NotBlank @Size(max = 120) String city,
            @Size(max = 32) String provinceCode,
            @NotBlank @Pattern(regexp = "^[A-Z]{2}$") String countryCode,
            @Size(max = 32) String zip,
            @Size(max = 40) String phone) {
    }

    public record OperationalFields(
            @Pattern(regexp = "UNPAID|PAID|PARTIALLY_REFUNDED|REFUNDED")
            String paymentStatus,
            @Size(max = 64) String platformStatus,
            @Size(max = 80) String logisticsChannel,
            @Pattern(regexp = "^[A-Z]{2}$") String countryCode,
            @Size(max = 120) String province,
            @Size(max = 32) String postalCode,
            @Size(max = 120) String buyerSelectedLogistics,
            @PositiveOrZero Long totalAmountMinor,
            @PositiveOrZero Long shippingAmountMinor,
            @jakarta.validation.constraints.DecimalMin(
                    value = "0", inclusive = false)
            BigDecimal weightGrams,
            Instant paidAt,
            Instant shipByAt,
            Instant shippedAt,
            @Size(max = 32) String trackingStatus,
            @Size(max = 80) String fixedCategory,
            @Size(max = 80) String customCategory,
            Boolean reshipment,
            @Size(max = 500) String reshipmentReason,
            Boolean platformHandoverRequired,
            Boolean printed) {
    }

    public record CreateOrderLineRequest(
            UUID skuId,
            @Size(max = 160) String externalListingRef,
            @Size(max = 160) String externalVariantRef,
            @NotBlank @Size(max = 160) String externalLineRef,
            @NotBlank @Size(max = 300) String titleSnapshot,
            @NotNull @Positive Integer quantity,
            @NotNull @PositiveOrZero Long unitPriceMinor,
            @NotBlank @Pattern(regexp = "^[A-Z]{3}$") String currency) { }

    public record UpdateOrderStatusRequest(
            @NotNull @PositiveOrZero Long version,
            @NotNull OrderStatus targetStatus,
            @Size(max = 500) String reason) { }

    public record UpdateLineSkuMatchRequest(
            @NotNull @PositiveOrZero Long version,
            UUID skuId) { }

    public record DashboardSummaryResponse(
            long totalOrders,
            long unpaidOrders,
            long receivedOrders,
            long reviewPendingOrders,
            long mergePendingOrders,
            long holdOrders,
            long readyToFulfillOrders,
            long fulfillingOrders,
            long shippedOrders,
            long deliveredOrders,
            long cancelledOrders,
            long editableOrders,
            long unmatchedLines,
            Instant oldestUnmatchedPlacedAt) {
        static DashboardSummaryResponse from(OrderDashboardSummary summary) {
            return new DashboardSummaryResponse(
                    summary.totalOrders(),
                    summary.unpaidOrders(),
                    summary.receivedOrders(),
                    summary.reviewPendingOrders(),
                    summary.mergePendingOrders(),
                    summary.holdOrders(),
                    summary.readyToFulfillOrders(),
                    summary.fulfillingOrders(),
                    summary.shippedOrders(),
                    summary.deliveredOrders(),
                    summary.cancelledOrders(),
                    summary.editableOrders(),
                    summary.unmatchedLines(),
                    summary.oldestUnmatchedPlacedAt());
        }
    }

    public record SkuSalesSummaryResponse(
            UUID skuId,
            long sales7,
            long sales28,
            long sales42) {

        public static SkuSalesSummaryResponse from(
                SkuSalesSummaryView value) {
            return new SkuSalesSummaryResponse(
                    value.skuId(),
                    value.sales7(),
                    value.sales28(),
                    value.sales42());
        }
    }

    public record SkuSalesSummariesResponse(
            List<SkuSalesSummaryResponse> items) {

        public SkuSalesSummariesResponse {
            items = List.copyOf(items);
        }
    }

    public record SkuMatchQueueItemResponse(
            UUID orderId,
            long orderVersion,
            OrderStatus orderStatus,
            UUID shopId,
            String externalOrderRef,
            Instant placedAt,
            UUID lineId,
            String externalLineRef,
            String titleSnapshot,
            String externalListingRef,
            String externalVariantRef,
            UUID skuId,
            SkuMatchSource skuMatchSource) {
        static SkuMatchQueueItemResponse from(SkuMatchQueueItem item) {
            return new SkuMatchQueueItemResponse(
                    item.orderId(), item.orderVersion(), item.orderStatus(), item.shopId(),
                    item.externalOrderRef(), item.placedAt(), item.lineId(), item.externalLineRef(),
                    item.titleSnapshot(), item.externalListingRef(), item.externalVariantRef(),
                    item.skuId(), item.skuMatchSource());
        }
    }

    public record OrderLineResponse(UUID id, UUID skuId, String skuCode,
            cn.xzkj.erp.order.domain.OrderLineKind lineKind,
            String externalListingRef, String externalVariantRef,
            SkuMatchSource skuMatchSource, String externalLineRef, String titleSnapshot,
            int quantity, long unitPriceMinor, String currency,
            long discountTotalMinor, String discountDescription, Instant createdAt,
            String platformSku, UUID warehouseId, UUID locationId, String purchaseReference) {
        static OrderLineResponse from(OrderLine line, String skuCode) {
            return new OrderLineResponse(line.getId(), line.getSkuId(), skuCode,
                    line.getLineKind(),
                    line.getExternalListingRef(),
                    line.getExternalVariantRef(), line.getSkuMatchSource(), line.getExternalLineRef(),
                    line.getTitleSnapshot(), line.getQuantity(), line.getUnitPriceMinor(),
                    line.getCurrency(), line.getDiscountTotalMinor(),
                    line.getDiscountDescription(), line.getCreatedAt(), line.getPlatformSku(),
                    line.getWarehouseId(), line.getLocationId(), line.getPurchaseReference());
        }
    }

    public record OrderSummaryResponse(UUID id, UUID shopId, String shopName,
            UUID warehouseId,
            String externalOrderRef, String currency,
            String buyerReference, OrderStatus status, String holdReason, int lineCount, Instant placedAt,
            Instant createdAt, Instant updatedAt, long version, String platformStatus,
            String paymentStatus, String logisticsChannel, String countryCode, String province,
            String postalCode, String buyerSelectedLogistics, Long totalAmountMinor,
            Long shippingAmountMinor, BigDecimal weightGrams, Instant paidAt, Instant shipByAt,
            Instant shippedAt, String trackingStatus, String fixedCategory, String customCategory,
            boolean reshipment, String reshipmentReason, boolean platformHandoverRequired,
            boolean printed, String salesRecordNumber, String shoppingCartReference,
            String customOrderReference, String trackingReference,
            String secondaryTrackingReference, Long actualPaidMinor, Long profitMinor,
            Long actualShippingMinor, Long itemAmountMinor, Long platformFeeMinor,
            Long insuranceFeeMinor, Long paymentFeeMinor, Long otherIncomeMinor,
            Long otherExpenseMinor, Long taxMinor, Long estimatedShippingMinor,
            String salespersonDisplayName,
            String managerDisplayName, String orderRemark, String customerCategory,
            Integer productKindCount, String supplierReference,
            String parentProductCategory, String childProductCategory,
            String productStatus, String extendedAttribute,
            String warehouseDisplayName, String locationBusinessCode,
            String pickerDisplayName, String shipperDisplayName,
            String purchaserDisplayName, String developerDisplayName,
            Instant printedAt,
            Instant platformReturnedAt, Instant exceptionReviewedAt,
            Instant platformSpecifiedHandoverAt, Instant platformLabelRequestedAt,
            Instant deliveryDeadlineAt, Instant cancelledAt, Instant handedOverAt,
            Instant deliveredAt, String skuSummary, String titleSummary) {
        static OrderSummaryResponse from(OrderListItem order) {
            return new OrderSummaryResponse(order.id(), order.shopId(), order.shopName(),
                    order.warehouseId(),
                    order.externalOrderRef(), order.currency(), order.buyerReference(), order.status(),
                    order.holdReason(), order.lineCount(), order.placedAt(), order.createdAt(),
                    order.updatedAt(), order.version(), order.platformStatus(), order.paymentStatus(),
                    order.logisticsChannel(), order.countryCode(), order.province(), order.postalCode(),
                    order.buyerSelectedLogistics(), order.totalAmountMinor(),
                    order.shippingAmountMinor(), order.weightGrams(), order.paidAt(),
                    order.shipByAt(), order.shippedAt(), order.trackingStatus(),
                    order.fixedCategory(), order.customCategory(), order.reshipment(),
                    order.reshipmentReason(), order.platformHandoverRequired(), order.printed(),
                    order.salesRecordNumber(), order.shoppingCartReference(),
                    order.customOrderReference(), order.trackingReference(),
                    order.secondaryTrackingReference(),
                    order.actualPaidMinor(), order.profitMinor(), order.actualShippingMinor(),
                    order.itemAmountMinor(), order.platformFeeMinor(),
                    order.insuranceFeeMinor(), order.paymentFeeMinor(),
                    order.otherIncomeMinor(), order.otherExpenseMinor(),
                    order.taxMinor(), order.estimatedShippingMinor(),
                    order.salespersonDisplayName(), order.managerDisplayName(),
                    order.orderRemark(),
                    order.customerCategory(), order.productKindCount(),
                    order.supplierReference(), order.parentProductCategory(),
                    order.childProductCategory(), order.productStatus(),
                    order.extendedAttribute(),
                    order.warehouseDisplayName(), order.locationBusinessCode(),
                    order.pickerDisplayName(), order.shipperDisplayName(),
                    order.purchaserDisplayName(), order.developerDisplayName(),
                    order.printedAt(), order.platformReturnedAt(), order.exceptionReviewedAt(),
                    order.platformSpecifiedHandoverAt(), order.platformLabelRequestedAt(),
                    order.deliveryDeadlineAt(), order.cancelledAt(),
                    order.handedOverAt(), order.deliveredAt(),
                    order.skuSummary(), order.titleSummary());
        }
    }

    public record OrderResponse(UUID id, UUID shopId, UUID warehouseId,
            String externalOrderRef, String currency,
            String buyerReference, OrderStatus status, String holdReason, int lineCount, Instant placedAt,
            Instant createdAt, Instant updatedAt, long version, String platformStatus,
            String paymentStatus, String logisticsChannel, String countryCode, String province,
            String postalCode, String buyerSelectedLogistics, Long totalAmountMinor,
            Long shippingAmountMinor, BigDecimal weightGrams, Instant paidAt, Instant shipByAt,
            Instant shippedAt, String trackingStatus, String fixedCategory, String customCategory,
            boolean reshipment, String reshipmentReason, boolean platformHandoverRequired,
            boolean printed, OrderProfile profile,
            List<OrderActivity> activities,
            List<OrderLineResponse> lines) {
        static OrderResponse from(OrderAggregate aggregate) {
            TenantOrder order = aggregate.order();
            return new OrderResponse(order.getId(), order.getShopId(), order.getWarehouseId(),
                    order.getExternalOrderRef(),
                    order.getCurrency(), order.getBuyerReference(), order.getStatus(), order.getHoldReason(),
                    order.getLineCount(), order.getPlacedAt(), order.getCreatedAt(), order.getUpdatedAt(),
                    order.getVersion(), order.getPlatformStatus(), order.getPaymentStatus(),
                    order.getLogisticsChannel(), order.getCountryCode(), order.getProvince(),
                    order.getPostalCode(), order.getBuyerSelectedLogistics(),
                    order.getTotalAmountMinor(), order.getShippingAmountMinor(), order.getWeightGrams(),
                    order.getPaidAt(), order.getShipByAt(), order.getShippedAt(),
                    order.getTrackingStatus(), order.getFixedCategory(), order.getCustomCategory(),
                    order.isReshipment(), order.getReshipmentReason(),
                    order.isPlatformHandoverRequired(), order.isPrinted(),
                    aggregate.profile(), aggregate.activities(),
                    aggregate.lines().stream()
                            .map(line -> OrderLineResponse.from(
                                    line,
                                    line.getSkuId() == null ? null
                                            : aggregate.skuBusinessCodes()
                                                .get(line.getSkuId())))
                            .toList());
        }
    }

    public static OrderProfile toDomain(OrderProfileRequest request) {
        if (request == null) {
            return OrderProfile.empty();
        }
        ReferenceFields references = request.references();
        RecipientFields recipient = request.recipient();
        FinancialFields financials = request.financials();
        MessageFields messages = request.messages();
        ClassificationFields classification = request.classification();
        AssignmentFields assignments = request.assignments();
        OperationalTimes times = request.times();
        return new OrderProfile(
                references == null ? null : references.salesRecordNumber(),
                references == null ? null : references.shoppingCartReference(),
                references == null ? null : references.customOrderReference(),
                references == null ? null : references.customerId(),
                references == null ? null : references.customerCode(),
                recipient == null ? null : recipient.name(),
                recipient == null ? null : recipient.phone(),
                recipient == null ? null : recipient.email(),
                recipient == null ? null : recipient.company(),
                recipient == null ? null : recipient.addressLine1(),
                recipient == null ? null : recipient.addressLine2(),
                recipient == null ? null : recipient.city(),
                recipient == null ? null : recipient.district(),
                recipient == null ? null : recipient.town(),
                recipient == null ? null : recipient.doorCode(),
                references == null ? null : references.shippingService(),
                references == null ? null : references.trackingReference(),
                references == null ? null
                        : references.secondaryTrackingReference(),
                financials == null ? null : financials.itemAmountMinor(),
                financials == null ? null : financials.platformFeeMinor(),
                financials == null ? null : financials.insuranceFeeMinor(),
                financials == null ? null : financials.paymentFeeMinor(),
                financials == null ? null : financials.otherIncomeMinor(),
                financials == null ? null : financials.otherExpenseMinor(),
                financials == null ? null : financials.actualPaidMinor(),
                financials == null ? null : financials.profitMinor(),
                financials == null ? null : financials.taxMinor(),
                financials == null ? null
                        : financials.estimatedShippingMinor(),
                financials == null ? null
                        : financials.actualShippingMinor(),
                messages == null ? null : messages.platformMessage(),
                messages == null ? null : messages.platformRemark(),
                messages == null ? null : messages.orderRemark(),
                messages == null ? null : messages.declarationPlan(),
                messages == null ? null : messages.declarationActual(),
                classification == null ? null
                        : classification.customerCategory(),
                classification == null ? null
                        : classification.productKindCount(),
                assignments == null ? null : assignments.locationId(),
                assignments == null ? null : assignments.pickerUserId(),
                assignments == null ? null : assignments.shipperUserId(),
                assignments == null ? null
                        : assignments.salespersonUserId(),
                assignments == null ? null : assignments.purchaserUserId(),
                assignments == null ? null : assignments.developerUserId(),
                assignments == null ? null : assignments.managerUserId(),
                classification == null ? null
                        : classification.supplierReference(),
                classification == null ? null
                        : classification.parentProductCategory(),
                classification == null ? null
                        : classification.childProductCategory(),
                classification == null ? null
                        : classification.productStatus(),
                classification == null ? null
                        : classification.extendedAttribute(),
                times == null ? null : times.printedAt(),
                times == null ? null : times.platformReturnedAt(),
                times == null ? null : times.exceptionReviewedAt(),
                times == null ? null : times.cancelledAt(),
                times == null ? null : times.handedOverAt(),
                times == null ? null
                        : times.platformSpecifiedHandoverAt(),
                times == null ? null : times.platformLabelRequestedAt(),
                times == null ? null : times.deliveryDeadlineAt(),
                times == null ? null : times.deliveredAt(),
                0, null, null);
    }

    public static TenantOrder.OperationalMetadata toDomain(
            OperationalFields fields, UUID warehouseId) {
        if (fields == null) {
            return new TenantOrder.OperationalMetadata(
                    null, null, null, null, null, null, null,
                    null, null, null, null, null, null, null, null, null,
                    warehouseId, false, null, false, false);
        }
        return new TenantOrder.OperationalMetadata(
                fields.platformStatus(),
                fields.paymentStatus(),
                fields.logisticsChannel(),
                fields.countryCode(),
                fields.province(),
                fields.postalCode(),
                fields.buyerSelectedLogistics(),
                fields.totalAmountMinor(),
                fields.shippingAmountMinor(),
                fields.weightGrams(),
                fields.paidAt(),
                fields.shipByAt(),
                fields.shippedAt(),
                fields.trackingStatus(),
                fields.fixedCategory(),
                fields.customCategory(),
                warehouseId,
                Boolean.TRUE.equals(fields.reshipment()),
                fields.reshipmentReason(),
                Boolean.TRUE.equals(fields.platformHandoverRequired()),
                Boolean.TRUE.equals(fields.printed()));
    }
}
