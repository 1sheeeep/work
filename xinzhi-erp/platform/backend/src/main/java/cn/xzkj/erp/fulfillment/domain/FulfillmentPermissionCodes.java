package cn.xzkj.erp.fulfillment.domain;

public final class FulfillmentPermissionCodes {

    public static final String READ = "fulfillments.read";
    public static final String ALLOCATE = "fulfillments.allocate.write";
    public static final String PICK = "fulfillments.pick.write";
    public static final String PACK = "fulfillments.pack.write";
    public static final String SHIP = "fulfillments.ship.write";
    public static final String CORRECT_SHIPMENT =
            "fulfillments.ship.correct.write";
    public static final String CANCEL = "fulfillments.cancel.write";
    public static final String MANAGE_EXCEPTIONS = "fulfillments.exception.write";

    private FulfillmentPermissionCodes() {
    }
}
