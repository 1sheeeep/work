package cn.xzkj.erp.warehouse.operations.domain;

public enum ManualMovementDirection {
    INBOUND(1),
    OUTBOUND(-1);

    private final int sign;

    ManualMovementDirection(int sign) {
        this.sign = sign;
    }

    public long signed(long quantity) {
        return Math.multiplyExact(quantity, sign);
    }
}
