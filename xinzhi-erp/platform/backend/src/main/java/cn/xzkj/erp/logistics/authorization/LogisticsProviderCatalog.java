package cn.xzkj.erp.logistics.authorization;

import java.util.List;
import java.util.Locale;

final class LogisticsProviderCatalog {
    static final String CHUDA = "CHUDA";
    static final String DAYUNJIA = "DAYUNJIA";
    static final String BIAOJU = "BIAOJU";
    static final String BAIDU_YIXIA = "BAIDU_YIXIA";
    static final String HUALEI = "HUALEI";
    static final String TONGXI = "TONGXI";
    static final String JIAYUN_SHENGTU = "JIAYUN_SHENGTU";
    static final String SHANDIANHOU_XIAOBAO = "SHANDIANHOU_XIAOBAO";
    static final String SHANDIANHOU_SHANGPAI = "SHANDIANHOU_SHANGPAI";

    private static final List<Provider> PROVIDERS = List.of(
            new Provider(CHUDA, "触达物流",
                    "https://apifox.com/apidoc/shared-6b688401-abee-4e1d-80e7-22172efc817c",
                    "SYSTEM_CREDENTIALS", "客户编码、授权码和密钥",
                    "Token 与渠道接口"),
            new Provider(DAYUNJIA, "深圳达运佳国际物流",
                    "http://doc.sz56t.com:8090/doc-wiki#/page/share/view?space=23bdefb8e45248fcb5e4a98f54bb8416&pageId=232",
                    "BUILT_IN", "账号密码认证",
                    "下单接口：http://43.138.180.250:8082"),
            new Provider(BIAOJU, "镖锔科技物流",
                    "https://yf56.itdida.com/itdida-api/swagger-ui.html",
                    "BUILT_IN", "账号密码换取 Token 并读取渠道",
                    "API：https://yf56.itdida.com/itdida-api"),
            new Provider(BAIDU_YIXIA, "摆渡一下",
                    "https://1st56.apifox.cn/252015650e0",
                    "BUILT_IN", "账号密码换取 Token 并读取渠道",
                    "API：https://erp.1st56.com/api/api-server/itdida-api"),
            new Provider(HUALEI, "华磊",
                    "http://doc.sz56t.com:8090/doc-wiki#/page/share/view?space=23bdefb8e45248fcb5e4a98f54bb8416&pageId=232",
                    "BUILT_IN", "账号密码认证",
                    "下单：http://106.55.154.6:8082 · 面单：http://106.55.154.6:8089"),
            new Provider(TONGXI, "桐溪供应链",
                    "http://doc.sz56t.com:8090/doc-wiki#/page/share/view?space=23bdefb8e45248fcb5e4a98f54bb8416&pageId=232",
                    "BUILT_IN", "账号密码认证",
                    "下单：http://1.14.133.93:8082 · 面单：http://1.14.133.93:8089"),
            new Provider(JIAYUN_SHENGTU, "嘉运晟途",
                    "http://doc.sz56t.com:8090/doc-wiki#/page/share/view?space=23bdefb8e45248fcb5e4a98f54bb8416&pageId=232",
                    "BUILT_IN", "账号密码认证",
                    "下单：http://106.55.154.6:8082 · 面单：http://106.55.154.6:8089"),
            new Provider(SHANDIANHOU_XIAOBAO, "闪电猴（小包）",
                    "http://www.sz56t.com:8090/pages/viewpage.action?pageId=3473454",
                    "BUILT_IN", "账号密码认证",
                    "下单：http://182.254.152.160:8082 · 面单：http://124.222.46.80:8089"),
            new Provider(SHANDIANHOU_SHANGPAI, "闪电猴（商派）",
                    "https://s.apifox.cn/1aa1d96c-e5f0-49ca-a57a-9b02c11e5e00/444184807e0",
                    "BUILT_IN", "账号密码认证",
                    "API：https://tms.zhfulfill.com"));

    private LogisticsProviderCatalog() {
    }

    static List<Provider> all() {
        return PROVIDERS;
    }

    static Provider require(String rawProviderCode) {
        String code = rawProviderCode == null ? ""
                : rawProviderCode.strip().toUpperCase(Locale.ROOT);
        return PROVIDERS.stream()
                .filter(provider -> provider.code().equals(code))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException(
                        "Logistics provider is not supported"));
    }

    record Provider(String code, String name, String documentationUrl,
            String configurationMode, String configurationSummary,
            String endpointSummary) {
    }
}
