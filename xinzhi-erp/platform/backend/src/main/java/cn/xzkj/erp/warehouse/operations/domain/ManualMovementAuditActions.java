package cn.xzkj.erp.warehouse.operations.domain;

public final class ManualMovementAuditActions {
    public static final String CREATED = "inventory.manual.created";
    public static final String UPDATED = "inventory.manual.updated";
    public static final String SUBMITTED = "inventory.manual.submitted";
    public static final String APPROVED = "inventory.manual.approved";
    public static final String REJECTED = "inventory.manual.rejected";
    public static final String POSTED = "inventory.manual.posted";
    public static final String CANCELLED = "inventory.manual.cancelled";
    public static final String REVERSED = "inventory.manual.reversed";
    public static final String SETTINGS_UPDATED =
            "inventory.manual.settings.updated";
    public static final String TYPE_SAVED =
            "inventory.manual.type.saved";

    private ManualMovementAuditActions() {
    }
}
