package cn.xzkj.erp.procurement.service;

public class ProcurementPlanConflictException extends RuntimeException {
    private final String reason;

    public ProcurementPlanConflictException(String reason) {
        super(reason);
        this.reason = reason;
    }

    public String reason() {
        return reason;
    }
}
