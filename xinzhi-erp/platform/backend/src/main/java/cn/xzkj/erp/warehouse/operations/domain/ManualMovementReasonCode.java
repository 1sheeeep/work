package cn.xzkj.erp.warehouse.operations.domain;

import java.util.Set;

public enum ManualMovementReasonCode {
    FOUND_STOCK(Set.of(ManualMovementDirection.INBOUND)),
    DAMAGED_STOCK(Set.of(ManualMovementDirection.OUTBOUND)),
    LOST_STOCK(Set.of(ManualMovementDirection.OUTBOUND)),
    RECORDING_CORRECTION(Set.of(
            ManualMovementDirection.INBOUND,
            ManualMovementDirection.OUTBOUND)),
    OTHER(Set.of(
            ManualMovementDirection.INBOUND,
            ManualMovementDirection.OUTBOUND));

    private final Set<ManualMovementDirection> directions;

    ManualMovementReasonCode(Set<ManualMovementDirection> directions) {
        this.directions = directions;
    }

    public boolean supports(ManualMovementDirection direction) {
        return directions.contains(direction);
    }
}
