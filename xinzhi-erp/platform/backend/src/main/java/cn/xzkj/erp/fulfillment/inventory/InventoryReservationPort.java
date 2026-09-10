package cn.xzkj.erp.fulfillment.inventory;

import java.util.UUID;

public interface InventoryReservationPort {

    ReservationResult reserve(ReservationCommand command);

    InventoryFact consume(ConsumptionCommand command);

    void release(ReleaseCommand command);

    InventoryFact reverseConsumption(CorrectionCommand command);

    record ReservationCommand(
            UUID tenantId,
            UUID commandId,
            UUID fulfillmentPlanId,
            UUID fulfillmentLineId,
            UUID skuId,
            UUID warehouseId,
            UUID locationId,
            int quantity,
            UUID actorUserId,
            UUID actorSystemAdminId,
            String requestId) {
    }

    record ReservationResult(String operationReference, long resultingQuantity) {
    }

    record ConsumptionCommand(
            UUID tenantId,
            UUID commandId,
            UUID shipmentEventId,
            UUID fulfillmentPlanId,
            UUID fulfillmentLineId,
            int quantity,
            UUID actorUserId,
            UUID actorSystemAdminId,
            String requestId) {
    }

    record ReleaseCommand(
            UUID tenantId,
            UUID commandId,
            UUID fulfillmentPlanId,
            UUID fulfillmentLineId,
            int quantity,
            UUID actorUserId,
            UUID actorSystemAdminId,
            String requestId) {
    }

    record CorrectionCommand(
            UUID tenantId,
            UUID commandId,
            UUID originalShipmentEventId,
            UUID correctionShipmentEventId,
            UUID fulfillmentPlanId,
            UUID fulfillmentLineId,
            int quantity,
            UUID actorUserId,
            UUID actorSystemAdminId,
            String requestId) {
    }

    record InventoryFact(UUID inventoryEventId, long onHandAfter, long balanceVersion) {
    }
}
