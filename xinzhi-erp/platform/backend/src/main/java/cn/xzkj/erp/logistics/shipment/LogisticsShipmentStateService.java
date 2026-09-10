package cn.xzkj.erp.logistics.shipment;

import cn.xzkj.erp.logistics.authorization.LogisticsProviderOperations.CreateResult;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderOperations.TrackingResult;
import cn.xzkj.erp.logistics.shipment.LogisticsShipmentRepository.ShipmentSnapshot;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
class LogisticsShipmentStateService {
    private final LogisticsShipmentRepository repository;

    LogisticsShipmentStateService(LogisticsShipmentRepository repository) {
        this.repository = repository;
    }

    @Transactional
    boolean claim(UUID tenantId, UUID planId, UUID packageId,
            long packageVersion, UUID authorizationId, UUID channelId,
            String providerCode, String clientReference, String bookingKey) {
        return repository.claimBooking(tenantId, planId, packageId,
                packageVersion, authorizationId, channelId, providerCode,
                clientReference, bookingKey);
    }

    @Transactional
    void complete(UUID tenantId, UUID packageId, String bookingKey,
            CreateResult result) {
        repository.completeBooking(tenantId, packageId, bookingKey,
                result.providerOrderReference(), result.trackingReference(),
                result.labelUrl(), result.normalizedStatus(),
                result.providerStatus());
    }

    @Transactional
    void fail(UUID tenantId, UUID packageId, String bookingKey,
            boolean definitive, String safeCode) {
        repository.failBooking(tenantId, packageId, bookingKey,
                definitive, safeCode);
    }

    @Transactional
    void recordTracking(ShipmentSnapshot shipment, TrackingResult result) {
        repository.recordTracking(shipment.tenantId(), shipment,
                result.trackingReference(), result.labelUrl(),
                result.normalizedStatus(), result.providerStatus(),
                result.summary(), result.events());
    }

    @Transactional
    void syncFailed(ShipmentSnapshot shipment, String safeCode) {
        repository.recordSyncFailure(
                shipment.tenantId(), shipment.packageId(), safeCode);
    }

    @Transactional
    void providerHandover(ShipmentSnapshot shipment, boolean pending,
            String safeCode) {
        repository.setProviderHandoverPending(
                shipment.tenantId(), shipment.packageId(), pending, safeCode);
    }

    @Transactional
    void recoverStaleBookings() {
        repository.recoverStaleBookings();
    }
}
