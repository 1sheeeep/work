package cn.xzkj.erp.iam.domain;

import java.util.Set;

/**
 * Stable IAM contract consumed by the platform and shop-center module.
 * Defining a code does not grant it to any user or role.
 */
public final class PlatformPermissionCodes {

    public static final String PLATFORM_READ = "platform:read";
    public static final String PLATFORM_WRITE = "platform:write";
    public static final String SHOP_READ = "shop:read";
    public static final String SHOP_WRITE = "shop:write";
    public static final String SHOP_AUTHORIZATION_WRITE = "shop:authorization:write";
    public static final String SHOP_SYNC_READ = "shop:sync:read";
    public static final String SHOP_SYNC_WRITE = "shop:sync:write";

    private PlatformPermissionCodes() {
    }

    public static Set<String> all() {
        return Set.of(
                PLATFORM_READ,
                PLATFORM_WRITE,
                SHOP_READ,
                SHOP_WRITE,
                SHOP_AUTHORIZATION_WRITE,
                SHOP_SYNC_READ,
                SHOP_SYNC_WRITE);
    }
}
