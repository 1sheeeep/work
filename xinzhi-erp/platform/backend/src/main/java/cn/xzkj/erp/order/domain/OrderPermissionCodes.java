package cn.xzkj.erp.order.domain;

import java.util.Set;

public final class OrderPermissionCodes {
    public static final String READ = "orders.read";
    public static final String WRITE = "orders.write";

    private OrderPermissionCodes() { }

    public static Set<String> all() {
        return Set.of(READ, WRITE);
    }
}
