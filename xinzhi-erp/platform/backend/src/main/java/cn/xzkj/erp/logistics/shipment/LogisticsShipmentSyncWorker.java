package cn.xzkj.erp.logistics.shipment;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
class LogisticsShipmentSyncWorker {
    private final LogisticsShipmentService service;

    LogisticsShipmentSyncWorker(LogisticsShipmentService service) {
        this.service = service;
    }

    @Scheduled(fixedDelayString =
            "${erp.logistics-shipment.sync-delay-ms:300000}")
    void synchronize() {
        service.synchronizeDue(50);
    }
}
