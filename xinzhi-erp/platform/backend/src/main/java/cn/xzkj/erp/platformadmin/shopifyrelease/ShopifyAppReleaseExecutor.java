package cn.xzkj.erp.platformadmin.shopifyrelease;

interface ShopifyAppReleaseExecutor {
    ReleaseResult release(char[] automationToken);

    record ReleaseResult(String version, String message) {
    }
}
