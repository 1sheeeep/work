package cn.xzkj.erp.logistics.authorization;

import static cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditActions.LOGISTICS_PROVIDER_CONFIG_UPDATED;

import cn.xzkj.erp.logistics.authorization.LogisticsCredentialCipher.ProviderCredentialMaterial;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderSystemConfigRepository.StoredProviderConfig;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderSystemConfigRepository.StoredProviderName;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platformadmin.application.PlatformAdminActor;
import cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditEvent;
import cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditRecorder;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class LogisticsProviderSystemConfigService {
    private final LogisticsProviderSystemConfigRepository repository;
    private final LogisticsCredentialCipher cipher;
    private final PlatformAdminAuditRecorder auditRecorder;

    public LogisticsProviderSystemConfigService(
            LogisticsProviderSystemConfigRepository repository,
            LogisticsCredentialCipher cipher,
            PlatformAdminAuditRecorder auditRecorder) {
        this.repository = repository;
        this.cipher = cipher;
        this.auditRecorder = auditRecorder;
    }

    @Transactional(readOnly = true)
    public List<ProviderConfigView> list() {
        return LogisticsProviderCatalog.all().stream()
                .map(provider -> view(provider.code()))
                .toList();
    }

    @Transactional
    public ProviderConfigView configure(PlatformAdminActor actor,
            String rawProviderCode, ProviderConfigInput input) {
        if (actor == null || actor.adminId() == null) {
            throw new IllegalArgumentException("System administrator is required");
        }
        String providerCode = providerCode(rawProviderCode);
        if (input == null || input.version() < 0) {
            throw new IllegalArgumentException("Provider configuration is required");
        }
        ProviderCredentialMaterial material = new ProviderCredentialMaterial(
                required(input.customerCode(), 256),
                requiredSecret(input.authorizationCode(), 2048),
                requiredSecret(input.secret(), 2048));
        try {
            boolean saved = repository.save(providerCode,
                    cipher.encryptProvider(providerCode, material),
                    input.version(), actor.adminId());
            if (!saved) {
                throw new ConflictException(
                        "Logistics provider configuration changed concurrently");
            }
        } catch (DataIntegrityViolationException exception) {
            throw new ConflictException(
                    "Logistics provider configuration changed concurrently");
        }
        auditRecorder.recordAtomically(new PlatformAdminAuditEvent(
                actor.adminId(), null, LOGISTICS_PROVIDER_CONFIG_UPDATED,
                "logistics_provider_config", providerCode, actor.requestId(),
                actor.sourceIp(), Map.of("providerCode", providerCode)));
        return view(providerCode);
    }

    @Transactional
    public ProviderConfigView rename(PlatformAdminActor actor,
            String rawProviderCode, ProviderNameInput input) {
        if (actor == null || actor.adminId() == null) {
            throw new IllegalArgumentException("System administrator is required");
        }
        String providerCode = catalogProviderCode(rawProviderCode);
        if (input == null || input.version() < 0) {
            throw new IllegalArgumentException("Provider display name is required");
        }
        String providerName = required(input.providerName(), 120);
        try {
            if (!repository.saveName(providerCode, providerName,
                    input.version(), actor.adminId())) {
                throw new ConflictException(
                        "Logistics provider display name changed concurrently");
            }
        } catch (DataIntegrityViolationException exception) {
            throw new ConflictException(
                    "Logistics provider display name changed concurrently");
        }
        auditRecorder.recordAtomically(new PlatformAdminAuditEvent(
                actor.adminId(), null, LOGISTICS_PROVIDER_CONFIG_UPDATED,
                "logistics_provider_display_name", providerCode, actor.requestId(),
                actor.sourceIp(), Map.of("providerCode", providerCode,
                        "field", "displayName")));
        return view(providerCode);
    }

    @Transactional(readOnly = true)
    ProviderCredentialMaterial credentials(String rawProviderCode) {
        String providerCode = providerCode(rawProviderCode);
        StoredProviderConfig stored = repository.find(providerCode);
        return stored == null ? null
                : cipher.decryptProvider(providerCode, stored.credential());
    }

    private ProviderConfigView view(String providerCode) {
        LogisticsProviderCatalog.Provider provider =
                LogisticsProviderCatalog.require(providerCode);
        StoredProviderConfig stored = repository.find(providerCode);
        StoredProviderName storedName = repository.findName(providerCode);
        boolean systemCredentials = "SYSTEM_CREDENTIALS".equals(
                provider.configurationMode());
        boolean configured = !systemCredentials || stored != null;
        Instant updatedAt = latest(
                stored == null ? null : stored.updatedAt(),
                storedName == null ? null : storedName.updatedAt());
        return new ProviderConfigView(providerCode,
                storedName == null ? provider.name() : storedName.displayName(),
                provider.documentationUrl(), provider.configurationMode(),
                provider.configurationSummary(), provider.endpointSummary(),
                configured, systemCredentials && configured,
                systemCredentials && configured,
                systemCredentials && configured,
                updatedAt,
                stored == null ? 0 : stored.version(),
                storedName == null ? 0 : storedName.version());
    }

    private static Instant latest(Instant left, Instant right) {
        if (left == null) return right;
        if (right == null) return left;
        return left.isAfter(right) ? left : right;
    }

    private static String providerCode(String raw) {
        LogisticsProviderCatalog.Provider provider =
                LogisticsProviderCatalog.require(catalogProviderCode(raw));
        if (!LogisticsProviderCatalog.CHUDA.equals(provider.code())) {
            throw new IllegalArgumentException("Logistics provider is not supported");
        }
        return provider.code();
    }

    private static String catalogProviderCode(String raw) {
        String value = raw == null ? "" : raw.strip().toUpperCase(Locale.ROOT);
        return LogisticsProviderCatalog.require(value).code();
    }

    private static String required(String raw, int maximum) {
        String value = raw == null ? "" : raw.strip();
        if (value.isEmpty() || value.length() > maximum
                || value.chars().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException("Provider configuration is invalid");
        }
        return value;
    }

    private static String requiredSecret(String raw, int maximum) {
        if (raw == null || raw.isBlank() || raw.length() > maximum
                || raw.chars().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException("Provider configuration is invalid");
        }
        return raw;
    }

    public record ProviderConfigInput(String customerCode,
            String authorizationCode, String secret, long version) {
        @Override
        public String toString() {
            return "ProviderConfigInput[REDACTED]";
        }
    }

    public record ProviderNameInput(String providerName, long version) {
    }

    public record ProviderConfigView(String providerCode, String providerName,
            String documentationUrl, String configurationMode,
            String configurationSummary, String endpointSummary,
            boolean configured,
            boolean customerCodeConfigured,
            boolean authorizationCodeConfigured, boolean secretConfigured,
            Instant updatedAt, long version, long nameVersion) {
    }
}
