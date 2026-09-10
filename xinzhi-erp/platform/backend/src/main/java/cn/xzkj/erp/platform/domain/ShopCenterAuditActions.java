package cn.xzkj.erp.platform.domain;

public final class ShopCenterAuditActions {
    public static final String PLATFORM_CREATED = "platform.created";
    public static final String PLATFORM_ARCHIVED = "platform.archived";
    public static final String SHOP_CREATED = "shop.created";
    public static final String SHOP_UPDATED = "shop.updated";
    public static final String SHOP_ARCHIVED = "shop.archived";
    public static final String AUTHORIZATION_UPDATED =
            "shop_authorization.updated";
    public static final String SYNC_JOB_CREATED = "shop_sync_job.created";
    public static final String SYNC_JOB_STATUS_CHANGED =
            "shop_sync_job.status_changed";

    private ShopCenterAuditActions() {
    }
}
