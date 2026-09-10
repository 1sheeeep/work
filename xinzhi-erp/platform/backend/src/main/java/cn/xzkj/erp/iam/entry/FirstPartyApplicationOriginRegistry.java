package cn.xzkj.erp.iam.entry;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class FirstPartyApplicationOriginRegistry {

    private final Map<FirstPartyApplication, String> origins;

    @Autowired
    public FirstPartyApplicationOriginRegistry(
            @Value("${erp.first-party.erp-origin:https://erp.xzkj.ai}") String erpOrigin,
            @Value("${erp.first-party.zhaoyaojing-origin:https://zhaoyaojing.xzkj.ai}")
                    String zhaoyaojingOrigin,
            @Value("${erp.first-party.asset-registry-origin:https://asset.xzkj.ai}")
                    String assetRegistryOrigin,
            @Value("${erp.environment:local}") String environment) {
        String normalizedErpOrigin = normalizeOrigin(erpOrigin, environment);
        String normalizedZhaoyaojingOrigin = normalizeOrigin(zhaoyaojingOrigin, environment);
        String normalizedAssetRegistryOrigin = normalizeOrigin(assetRegistryOrigin, environment);
        if (normalizedErpOrigin == null
                || normalizedZhaoyaojingOrigin == null || normalizedAssetRegistryOrigin == null
                || Set.of(
                        normalizedErpOrigin,
                        normalizedZhaoyaojingOrigin,
                        normalizedAssetRegistryOrigin).size() != 3) {
            throw new IllegalArgumentException(
                    "First-party applications must use distinct safe origins");
        }
        this.origins = Map.of(
                FirstPartyApplication.ERP, normalizedErpOrigin,
                FirstPartyApplication.ZHAOYAOJING, normalizedZhaoyaojingOrigin,
                FirstPartyApplication.ASSET_REGISTRY, normalizedAssetRegistryOrigin);
    }

    public String originFor(FirstPartyApplication application) {
        return origins.get(application);
    }

    public Map<String, String> publicDirectory() {
        Map<String, String> directory = new LinkedHashMap<>();
        origins.forEach((application, origin) -> directory.put(application.name(), origin));
        return Map.copyOf(directory);
    }

    private static String normalizeOrigin(String raw, String environment) {
        if (raw == null || raw.isBlank()) return null;
        try {
            URI uri = new URI(raw.strip());
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
            boolean loopback = host.equals("localhost") || host.equals("127.0.0.1") || host.equals("::1")
                    || host.endsWith(".localhost");
            boolean local = "local".equalsIgnoreCase(environment);
            if (uri.getRawUserInfo() != null || uri.getRawQuery() != null
                    || uri.getRawFragment() != null
                    || (!uri.getPath().isEmpty() && !"/".equals(uri.getPath()))
                    || host.isEmpty()
                    || !("https".equals(scheme) || (local && loopback && "http".equals(scheme)))) {
                return null;
            }
            return new URI(scheme, null, host, uri.getPort(), null, null, null).toASCIIString();
        } catch (URISyntaxException invalid) {
            return null;
        }
    }
}
