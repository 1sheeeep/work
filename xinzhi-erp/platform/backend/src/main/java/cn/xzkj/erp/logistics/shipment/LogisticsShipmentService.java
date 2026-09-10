package cn.xzkj.erp.logistics.shipment;

import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.Plan;
import cn.xzkj.erp.fulfillment.service.FulfillmentExceptions.Conflict;
import cn.xzkj.erp.fulfillment.service.FulfillmentExceptions.Invalid;
import cn.xzkj.erp.fulfillment.service.FulfillmentExceptions.NotFound;
import cn.xzkj.erp.fulfillment.service.FulfillmentService;
import cn.xzkj.erp.fulfillment.service.FulfillmentService.Actor;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderOperations;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderOperations.OperationException;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderOperations.Shipment;
import cn.xzkj.erp.logistics.shipment.LogisticsShipmentRepository.ChannelSelection;
import cn.xzkj.erp.logistics.shipment.LogisticsShipmentRepository.ShipmentSnapshot;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class LogisticsShipmentService {
    private static final Logger LOG = LoggerFactory.getLogger(
            LogisticsShipmentService.class);
    private static final Pattern KEY = Pattern.compile(
            "^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$");
    private final LogisticsShipmentRepository repository;
    private final LogisticsShipmentStateService state;
    private final LogisticsProviderOperations providers;
    private final FulfillmentService fulfillment;

    public LogisticsShipmentService(
            LogisticsShipmentRepository repository,
            LogisticsShipmentStateService state,
            LogisticsProviderOperations providers,
            FulfillmentService fulfillment) {
        this.repository = repository;
        this.state = state;
        this.providers = providers;
        this.fulfillment = fulfillment;
    }

    public Plan book(Actor actor, UUID planId, UUID packageId,
            long packageVersion, UUID authorizationId, UUID channelId,
            String idempotencyKey) {
        requireKey(idempotencyKey);
        fulfillment.get(actor, planId);
        ShipmentSnapshot current = snapshot(actor.tenantId(), planId, packageId);
        if ("BOOKED".equals(current.bookingStatus())
                && idempotencyKey.equals(current.bookingKey())) {
            return fulfillment.get(actor, planId);
        }
        ChannelSelection channel = repository.channel(actor.tenantId(),
                authorizationId, channelId);
        if (channel == null) {
            throw new Conflict("logistics_channel_not_available");
        }
        validateReady(current, packageVersion);
        validateShipmentData(current);
        String clientReference = "ERP-"
                + packageId.toString().replace("-", "").toUpperCase();
        if (!state.claim(actor.tenantId(), planId, packageId,
                packageVersion, authorizationId, channelId,
                channel.providerCode(), clientReference, idempotencyKey)) {
            throw new Conflict("logistics_booking_conflict");
        }
        try {
            var result = providers.create(actor.tenantId(), authorizationId,
                    channelId, shipment(current, clientReference));
            state.complete(actor.tenantId(), packageId, idempotencyKey, result);
        } catch (OperationException exception) {
            state.fail(actor.tenantId(), packageId, idempotencyKey,
                    exception.definitive(), exception.safeCode());
            throw new Conflict(exception.definitive()
                    ? "logistics_provider_rejected"
                    : "logistics_booking_uncertain");
        } catch (RuntimeException exception) {
            state.fail(actor.tenantId(), packageId, idempotencyKey,
                    false, "LOGISTICS_BOOKING_INTERNAL_FAILURE");
            throw exception;
        }
        return fulfillment.get(actor, planId);
    }

    public Plan sync(Actor actor, UUID planId, UUID packageId) {
        fulfillment.get(actor, planId);
        ShipmentSnapshot shipment = snapshot(
                actor.tenantId(), planId, packageId);
        sync(shipment, true);
        return fulfillment.get(actor, planId);
    }

    public Plan handover(Actor actor, UUID planId, UUID packageId,
            long planVersion, long packageVersion, UUID commandId,
            Instant occurredAt) {
        ShipmentSnapshot shipment = snapshot(
                actor.tenantId(), planId, packageId);
        if (!"BOOKED".equals(shipment.bookingStatus())
                || shipment.trackingReference() == null
                || shipment.trackingReference().isBlank()) {
            throw new Conflict("logistics_waybill_not_ready");
        }
        fulfillment.handover(actor, planId, packageId,
                planVersion, packageVersion, commandId, occurredAt,
                shipment.providerCode(), channelCode(shipment),
                shipment.trackingReference());
        try {
            providers.confirmHandover(shipment.tenantId(),
                    shipment.authorizationId(), shipment.channelId(),
                    shipment.clientReference(),
                    shipment.providerOrderReference(),
                    shipment.trackingReference());
            state.providerHandover(shipment, false, null);
        } catch (OperationException exception) {
            state.providerHandover(shipment, true, exception.safeCode());
        }
        return fulfillment.get(actor, planId);
    }

    void synchronizeDue(int limit) {
        state.recoverStaleBookings();
        for (ShipmentSnapshot shipment : repository.due(limit)) {
            try {
                sync(shipment, false);
            } catch (RuntimeException exception) {
                state.syncFailed(shipment,
                        "LOGISTICS_SYNC_INTERNAL_FAILURE");
                LOG.warn("logistics tracking sync failed for package {}",
                        shipment.packageId(), exception);
            }
        }
        for (ShipmentSnapshot shipment : repository.pendingHandover(limit)) {
            try {
                retryProviderHandover(shipment);
            } catch (RuntimeException exception) {
                state.providerHandover(shipment, true,
                        "LOGISTICS_HANDOVER_INTERNAL_FAILURE");
                LOG.warn("logistics handover retry failed for package {}",
                        shipment.packageId(), exception);
            }
        }
    }

    private void sync(ShipmentSnapshot shipment, boolean failToCaller) {
        if (!List.of("BOOKED", "UNCERTAIN").contains(
                shipment.bookingStatus())) {
            if (failToCaller) throw new Conflict(
                    "logistics_waybill_not_ready");
            return;
        }
        try {
            var result = providers.track(shipment.tenantId(),
                    shipment.authorizationId(), shipment.channelId(),
                    shipment.clientReference(),
                    shipment.providerOrderReference(),
                    shipment.trackingReference());
            state.recordTracking(shipment, result);
        } catch (OperationException exception) {
            state.syncFailed(shipment, exception.safeCode());
            if (failToCaller) throw new Conflict(
                    "logistics_sync_failed");
        } catch (RuntimeException exception) {
            state.syncFailed(shipment,
                    "LOGISTICS_SYNC_INTERNAL_FAILURE");
            if (failToCaller) throw exception;
        }
    }

    private void retryProviderHandover(ShipmentSnapshot shipment) {
        try {
            providers.confirmHandover(shipment.tenantId(),
                    shipment.authorizationId(), shipment.channelId(),
                    shipment.clientReference(),
                    shipment.providerOrderReference(),
                    shipment.trackingReference());
            state.providerHandover(shipment, false, null);
        } catch (OperationException exception) {
            state.providerHandover(shipment, true, exception.safeCode());
        }
    }

    private static Shipment shipment(ShipmentSnapshot value,
            String clientReference) {
        return new Shipment(clientReference, value.recipientName(),
                value.recipientCompany(), value.recipientPhone(),
                value.recipientEmail(), value.addressLine1(),
                value.addressLine2(), value.city(), value.province(),
                value.postalCode(), value.countryCode(),
                value.weightGrams(), value.quantity(), value.currency(),
                value.items());
    }

    private static void validateReady(ShipmentSnapshot value,
            long packageVersion) {
        if (value.packageVersion() != packageVersion
                || !"SEALED".equals(value.packageStatus())
                || !List.of("PASSED", "OVERRIDDEN").contains(
                        value.weighingStatus())
                || value.weightGrams() <= 0
                || !List.of("NOT_REQUESTED", "FAILED").contains(
                        value.bookingStatus())) {
            throw new Conflict("logistics_booking_not_ready");
        }
    }

    private static void validateShipmentData(ShipmentSnapshot value) {
        if (blank(value.recipientName()) || blank(value.recipientPhone())
                || blank(value.addressLine1()) || blank(value.city())
                || blank(value.province()) || blank(value.postalCode())
                || value.countryCode() == null
                || !value.countryCode().matches("^[A-Z]{2}$")
                || value.currency() == null
                || !value.currency().matches("^[A-Z]{3}$")
                || value.items().isEmpty() || value.quantity() <= 0) {
            throw new Invalid("shipment_profile_incomplete");
        }
    }

    private ShipmentSnapshot snapshot(UUID tenantId, UUID planId,
            UUID packageId) {
        ShipmentSnapshot value = repository.snapshot(
                tenantId, planId, packageId);
        if (value == null) throw new NotFound();
        return value;
    }

    private String channelCode(ShipmentSnapshot shipment) {
        ChannelSelection channel = repository.channel(shipment.tenantId(),
                shipment.authorizationId(), shipment.channelId());
        if (channel == null) throw new Conflict(
                "logistics_channel_not_available");
        return channel.channelCode();
    }

    private static void requireKey(String value) {
        if (value == null || !KEY.matcher(value).matches()) {
            throw new Invalid("idempotencyKey");
        }
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }
}
