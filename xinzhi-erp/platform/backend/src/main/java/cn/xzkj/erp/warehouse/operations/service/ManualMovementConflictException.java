package cn.xzkj.erp.warehouse.operations.service;

public class ManualMovementConflictException extends RuntimeException {
    private static final java.util.Set<String> REASONS =
            java.util.Set.of(
                    "stale_version",
                    "illegal_transition",
                    "idempotency_conflict",
                    "inactive_master_data",
                    "approval_required",
                    "box_stock_insufficient",
                    "reversal_not_allowed");
    private final String reason;

    public ManualMovementConflictException(String reason) {
        super("Manual movement conflict");
        this.reason = REASONS.contains(reason)
                ? reason
                : "illegal_transition";
    }

    public String reason() {
        return reason;
    }
}
