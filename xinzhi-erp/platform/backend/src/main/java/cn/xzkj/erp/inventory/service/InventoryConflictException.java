package cn.xzkj.erp.inventory.service;

public class InventoryConflictException extends RuntimeException {
    private final String reason;

    public InventoryConflictException(String reason) {
        super("Inventory command conflicts with current state");
        this.reason = reason;
    }

    public String reason() {
        return reason;
    }
}
