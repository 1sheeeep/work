package cn.xzkj.erp.warehouse.operations.domain;

import java.util.Set;

public final class ManualMovementPermissionCodes {
    public static final String READ = "inventory.read";
    public static final String WRITE = "inventory.manual.write";
    public static final String POST = "inventory.manual.post";
    public static final String APPROVE = "inventory.manual.approve";
    public static final String CONFIGURE = "inventory.manual.configure";
    public static final String REVERSE = "inventory.reverse";
    public static final Set<String> ALL =
            Set.of(READ, WRITE, POST, APPROVE, CONFIGURE, REVERSE);

    private ManualMovementPermissionCodes() {
    }
}
