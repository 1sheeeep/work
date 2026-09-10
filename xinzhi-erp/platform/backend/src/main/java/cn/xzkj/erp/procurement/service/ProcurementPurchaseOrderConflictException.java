package cn.xzkj.erp.procurement.service;

public class ProcurementPurchaseOrderConflictException extends RuntimeException {
    private final String reason;

    public ProcurementPurchaseOrderConflictException(String reason) {
        super("Procurement purchase order conflict");
        this.reason = reason;
    }

    public String getReason() {
        return reason;
    }
}
