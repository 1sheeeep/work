package cn.xzkj.erp.order.domain;

import java.time.Instant;
import java.util.UUID;

/**
 * Tenant-owned operational details that are intentionally separated from the
 * immutable platform order identity. Every field is allowlisted in the API.
 */
public record OrderProfile(
        String salesRecordNumber,
        String shoppingCartReference,
        String customOrderReference,
        String customerId,
        String customerCode,
        String recipientName,
        String recipientPhone,
        String recipientEmail,
        String recipientCompany,
        String addressLine1,
        String addressLine2,
        String city,
        String district,
        String town,
        String doorCode,
        String shippingService,
        String trackingReference,
        String secondaryTrackingReference,
        Long itemAmountMinor,
        Long platformFeeMinor,
        Long insuranceFeeMinor,
        Long paymentFeeMinor,
        Long otherIncomeMinor,
        Long otherExpenseMinor,
        Long actualPaidMinor,
        Long profitMinor,
        Long taxMinor,
        Long estimatedShippingMinor,
        Long actualShippingMinor,
        String platformMessage,
        String platformRemark,
        String orderRemark,
        String declarationPlan,
        String declarationActual,
        String customerCategory,
        Integer productKindCount,
        UUID locationId,
        UUID pickerUserId,
        UUID shipperUserId,
        UUID salespersonUserId,
        UUID purchaserUserId,
        UUID developerUserId,
        UUID managerUserId,
        String supplierReference,
        String parentProductCategory,
        String childProductCategory,
        String productStatus,
        String extendedAttribute,
        Instant printedAt,
        Instant platformReturnedAt,
        Instant exceptionReviewedAt,
        Instant cancelledAt,
        Instant handedOverAt,
        Instant platformSpecifiedHandoverAt,
        Instant platformLabelRequestedAt,
        Instant deliveryDeadlineAt,
        Instant deliveredAt,
        long version,
        Instant createdAt,
        Instant updatedAt) {

    public static OrderProfile empty() {
        return new OrderProfile(
                // References and recipient.
                null, null, null, null, null, null, null, null, null,
                null, null, null, null, null, null, null, null, null,
                // Financials.
                null, null, null, null, null, null, null, null, null,
                null, null,
                // Messages and classification.
                null, null, null, null, null, null,
                // Product kind count and assignments.
                null, null, null, null, null, null, null, null,
                // Supplier/catalog attributes.
                null, null, null, null, null,
                // Operational times.
                null, null, null, null, null, null, null, null, null,
                // Server metadata.
                0, null, null);
    }

    public OrderProfile withRecipientAddress(
            String name,
            String phone,
            String company,
            String address1,
            String address2,
            String city) {
        return new OrderProfile(
                salesRecordNumber, shoppingCartReference, customOrderReference,
                customerId, customerCode, name, phone, recipientEmail, company,
                address1, address2, city, district, town, doorCode,
                shippingService, trackingReference, secondaryTrackingReference,
                itemAmountMinor, platformFeeMinor, insuranceFeeMinor,
                paymentFeeMinor, otherIncomeMinor, otherExpenseMinor,
                actualPaidMinor, profitMinor, taxMinor,
                estimatedShippingMinor, actualShippingMinor,
                platformMessage, platformRemark, orderRemark,
                declarationPlan, declarationActual, customerCategory,
                productKindCount, locationId, pickerUserId, shipperUserId,
                salespersonUserId, purchaserUserId, developerUserId,
                managerUserId, supplierReference, parentProductCategory,
                childProductCategory, productStatus, extendedAttribute,
                printedAt, platformReturnedAt, exceptionReviewedAt,
                cancelledAt, handedOverAt, platformSpecifiedHandoverAt,
                platformLabelRequestedAt, deliveryDeadlineAt, deliveredAt,
                version, createdAt, updatedAt);
    }

    public OrderProfile withCancelledAt(Instant value) {
        return new OrderProfile(
                salesRecordNumber, shoppingCartReference, customOrderReference,
                customerId, customerCode, recipientName, recipientPhone,
                recipientEmail, recipientCompany, addressLine1, addressLine2,
                city, district, town, doorCode, shippingService,
                trackingReference, secondaryTrackingReference,
                itemAmountMinor, platformFeeMinor, insuranceFeeMinor,
                paymentFeeMinor, otherIncomeMinor, otherExpenseMinor,
                actualPaidMinor, profitMinor, taxMinor,
                estimatedShippingMinor, actualShippingMinor,
                platformMessage, platformRemark, orderRemark,
                declarationPlan, declarationActual, customerCategory,
                productKindCount, locationId, pickerUserId, shipperUserId,
                salespersonUserId, purchaserUserId, developerUserId,
                managerUserId, supplierReference, parentProductCategory,
                childProductCategory, productStatus, extendedAttribute,
                printedAt, platformReturnedAt, exceptionReviewedAt, value,
                handedOverAt, platformSpecifiedHandoverAt,
                platformLabelRequestedAt, deliveryDeadlineAt, deliveredAt,
                version, createdAt, updatedAt);
    }
}
