package cn.xzkj.erp.logistics.authorization;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.logistics.authorization.LogisticsCredentialCipher.CredentialMaterial;
import cn.xzkj.erp.logistics.authorization.LogisticsCredentialCipher.StoredCredential;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderConnectorGateway.ProbeRequest;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderConnectorGateway.ProbeResult;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderConnectorGateway.DiscoveredChannel;
import cn.xzkj.erp.platform.domain.CredentialReferenceValidator;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class LogisticsAuthorizationService {
    private static final Set<String> CATEGORIES = Set.of(
            "PLATFORM", "SELF_FULFILLED", "FIRST_MILE",
            "OVERSEAS", "CLOUD_FACTORY", "CUSTOM");
    private static final Set<String> STATUSES = Set.of("ACTIVE", "PENDING", "ARCHIVED");
    private static final Set<String> PROVIDER_CODES = Set.of(
            "CHUDA", "DAYUNJIA", "BIAOJU", "BAIDU_YIXIA",
            "HUALEI", "TONGXI", "JIAYUN_SHENGTU",
            "SHANDIANHOU_XIAOBAO", "SHANDIANHOU_SHANGPAI",
            "YUNEXPRESS", "CUSTOM");
    private static final Set<String> PROBE_STATUSES = Set.of(
            "CONNECTED", "NOT_CONFIGURED", "REJECTED", "UNAVAILABLE");
    private final LogisticsAuthorizationRepository repository;
    private final SecurityAuditRecorder auditRecorder;
    private final LogisticsCredentialCipher credentialCipher;
    private final LogisticsProviderConnectorGateway connector;
    private final LogisticsAuthorizationProbeFinalizer probeFinalizer;

    public LogisticsAuthorizationService(LogisticsAuthorizationRepository repository,
            SecurityAuditRecorder auditRecorder,
            LogisticsCredentialCipher credentialCipher,
            LogisticsProviderConnectorGateway connector,
            LogisticsAuthorizationProbeFinalizer probeFinalizer) {
        this.repository = repository;
        this.auditRecorder = auditRecorder;
        this.credentialCipher = credentialCipher;
        this.connector = connector;
        this.probeFinalizer = probeFinalizer;
    }

    @Transactional(readOnly = true)
    public Page<LogisticsAuthorizationRecord> list(Actor actor, String category,
            String name, String status, Pageable pageable) {
        requireActor(actor);
        return repository.list(actor.tenantId(), category(category),
                optionalLower(name, 120), status(status), pageable);
    }

    @Transactional(readOnly = true)
    public LogisticsAuthorizationRecord get(Actor actor, UUID authorizationId) {
        requireActor(actor);
        return requireAuthorization(actor.tenantId(), authorizationId);
    }

    @Transactional(readOnly = true)
    public List<LogisticsAuthorizationChannelRecord> listChannels(
            Actor actor, UUID authorizationId) {
        requireActor(actor);
        requireAuthorization(actor.tenantId(), authorizationId);
        return repository.listChannels(actor.tenantId(), authorizationId);
    }

    @Transactional(readOnly = true)
    public List<LogisticsAuthorizationChannelRecord> listEnabledChannels(Actor actor) {
        requireActor(actor);
        return repository.listEnabledChannels(actor.tenantId());
    }

    @Transactional
    public LogisticsAuthorizationRecord create(Actor actor, AuthorizationInput input) {
        return create(actor, input, null);
    }

    @Transactional
    public LogisticsAuthorizationRecord create(Actor actor, AuthorizationInput input,
            CredentialMaterial credentials) {
        requireActor(actor);
        NormalizedAuthorization normalized = normalize(input, credentials);
        LogisticsAuthorizationRecord existing = repository.findByIdentity(
                actor.tenantId(), normalized.input().category(),
                normalized.input().providerName(), normalized.input().accountLabel());
        if (existing != null) {
            throw new ConflictException("The logistics provider account already exists; "
                    + "enable or update the existing account instead");
        }
        UUID id = UUID.randomUUID();
        try {
            repository.insert(id, actor.tenantId(), normalized.input(), actor);
            if (normalized.credentials() != null) {
                repository.saveCredential(id, actor.tenantId(),
                        credentialCipher.encrypt(actor.tenantId(), id,
                                normalized.input().providerCode(),
                                normalized.credentials()), actor);
            }
        } catch (DataIntegrityViolationException exception) {
            throw new ConflictException(
                    "A current logistics provider account already exists");
        }
        audit(actor, "logistics.authorization.created", id,
                Map.of("category", normalized.input().category(),
                        "providerCode", normalized.input().providerCode(),
                        "integrationMode", normalized.input().integrationMode()));
        return requireAuthorization(actor.tenantId(), id);
    }

    public ProbeOutcome probe(Actor actor, UUID id, long version) {
        requireActor(actor);
        if (version < 0) throw new IllegalArgumentException("Version is required");
        LogisticsAuthorizationRecord current = requireAuthorization(actor.tenantId(), id);
        if ("ARCHIVED".equals(current.status()) || current.version() != version) {
            throw new ConflictException(
                    "Logistics provider connection changed concurrently or is archived");
        }
        if (!"DIRECT_CREDENTIALS".equals(current.integrationMode())) {
            throw new IllegalArgumentException(
                    "Direct logistics credentials are required for connection testing");
        }
        StoredCredential stored = repository.findCredential(actor.tenantId(), id);
        CredentialMaterial credentials = credentialCipher.decrypt(
                actor.tenantId(), id, current.providerCode(), stored);
        ProbeResult result = connector.probe(new ProbeRequest(
                actor.tenantId(), id, current.providerCode(), credentials,
                actor.requestId()));
        ProbeResult normalized = normalizeProbe(result);
        LogisticsAuthorizationRecord authorization = probeFinalizer.complete(
                actor, current, version, normalized);
        return new ProbeOutcome(authorization, normalized.status(),
                normalized.message());
    }

    @Transactional
    public LogisticsAuthorizationRecord replaceCredentials(Actor actor, UUID id,
            long version, CredentialMaterial credentials) {
        requireActor(actor);
        LogisticsAuthorizationRecord current = requireAuthorization(actor.tenantId(), id);
        CredentialMaterial normalized = normalizeCredentials(credentials);
        if (normalized == null || !"DIRECT_CREDENTIALS".equals(current.integrationMode())
                || version < 0 || current.version() != version
                || !repository.prepareCredentialReplacement(
                        actor.tenantId(), id, version, actor)) {
            throw new ConflictException(
                    "Logistics provider credentials changed concurrently or cannot be replaced");
        }
        repository.saveCredential(id, actor.tenantId(),
                credentialCipher.encrypt(actor.tenantId(), id,
                        current.providerCode(), normalized), actor);
        audit(actor, "logistics.authorization.credentials_replaced", id,
                Map.of("providerCode", current.providerCode(),
                        "previousVersion", Long.toString(version)));
        return requireAuthorization(actor.tenantId(), id);
    }

    @Transactional
    public LogisticsAuthorizationRecord renameAccount(Actor actor, UUID id,
            long version, String rawAccountLabel) {
        requireActor(actor);
        LogisticsAuthorizationRecord current = requireAuthorization(actor.tenantId(), id);
        if (version < 0 || current.version() != version) {
            throw new ConflictException(
                    "Logistics provider account changed concurrently");
        }
        String accountLabel = required(rawAccountLabel, 160);
        if (current.accountLabel().equals(accountLabel)) return current;
        LogisticsAuthorizationRecord duplicate = repository.findByIdentity(
                actor.tenantId(), current.category(), current.providerName(), accountLabel);
        if (duplicate != null && !duplicate.id().equals(id)) {
            throw new ConflictException("The freight account name is already in use");
        }
        try {
            if (!repository.updateAccountLabel(actor.tenantId(), id, version,
                    accountLabel, actor)) {
                throw new ConflictException(
                        "Logistics provider account changed concurrently");
            }
        } catch (DataIntegrityViolationException exception) {
            throw new ConflictException("The freight account name is already in use");
        }
        audit(actor, "logistics.authorization.account_renamed", id,
                Map.of("providerCode", current.providerCode(),
                        "previousVersion", Long.toString(version)));
        return requireAuthorization(actor.tenantId(), id);
    }

    @Transactional
    public LogisticsAuthorizationRecord archive(Actor actor, UUID id, long version) {
        requireActor(actor);
        LogisticsAuthorizationRecord current = requireAuthorization(actor.tenantId(), id);
        if ("ARCHIVED".equals(current.status()) || version < 0
                || !repository.archive(actor.tenantId(), id, version, actor)) {
            throw new ConflictException(
                    "Logistics provider connection changed concurrently or is archived");
        }
        repository.disableAllChannels(actor.tenantId(), id, actor);
        audit(actor, "logistics.authorization.archived", id,
                Map.of("previousVersion", Long.toString(version)));
        return requireAuthorization(actor.tenantId(), id);
    }

    @Transactional
    public LogisticsAuthorizationChannelRecord setChannelEnabled(
            Actor actor, UUID authorizationId, UUID channelId,
            long version, boolean enabled) {
        requireActor(actor);
        if (channelId == null || version < 0) {
            throw new IllegalArgumentException("Logistics channel and version are required");
        }
        requireAuthorization(actor.tenantId(), authorizationId);
        LogisticsAuthorizationChannelRecord current = repository.findChannel(
                actor.tenantId(), authorizationId, channelId);
        if (current == null) {
            throw new ResourceNotFoundException("Logistics channel was not found");
        }
        if (current.enabled() == enabled) return current;
        if (!repository.setChannelEnabled(actor.tenantId(), authorizationId,
                channelId, version, enabled, actor)) {
            throw new ConflictException(
                    "Logistics channel changed concurrently or is not available");
        }
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(),
                enabled ? "logistics.authorization.channel_enabled"
                        : "logistics.authorization.channel_disabled",
                "logistics_authorization_channel", channelId.toString(),
                actor.requestId(), actor.sourceIp(),
                Map.of("authorizationId", authorizationId.toString(),
                        "channelCode", current.channelCode())));
        return repository.findChannel(actor.tenantId(), authorizationId, channelId);
    }

    @Transactional
    public LogisticsAuthorizationRecord enable(Actor actor, UUID id, long version) {
        requireActor(actor);
        LogisticsAuthorizationRecord current = requireAuthorization(actor.tenantId(), id);
        if (!"ARCHIVED".equals(current.status()) || version < 0
                || current.version() != version
                || ("DIRECT_CREDENTIALS".equals(current.integrationMode())
                    && repository.findCredential(actor.tenantId(), id) == null)
                || !repository.enable(actor.tenantId(), id, version, actor)) {
            throw new ConflictException(
                    "Logistics provider connection changed concurrently or cannot be enabled");
        }
        audit(actor, "logistics.authorization.enabled", id,
                Map.of("previousVersion", Long.toString(version)));
        return requireAuthorization(actor.tenantId(), id);
    }

    @Transactional
    public void unbind(Actor actor, UUID id, long version) {
        requireActor(actor);
        LogisticsAuthorizationRecord current = requireAuthorization(actor.tenantId(), id);
        if (!"ARCHIVED".equals(current.status()) || version < 0
                || current.version() != version
                || !repository.deleteArchived(actor.tenantId(), id, version)) {
            throw new ConflictException(
                    "Only a disabled logistics provider account can be unbound");
        }
        audit(actor, "logistics.authorization.unbound", id,
                Map.of("providerCode", current.providerCode(),
                        "accountLabel", current.accountLabel(),
                        "previousVersion", Long.toString(version)));
    }

    private LogisticsAuthorizationRecord requireAuthorization(UUID tenantId, UUID id) {
        if (id == null) throw new IllegalArgumentException("Authorization id is required");
        LogisticsAuthorizationRecord value = repository.find(tenantId, id);
        if (value == null) {
            throw new ResourceNotFoundException("Logistics provider connection was not found");
        }
        return value;
    }

    private void audit(Actor actor, String action, UUID id,
            Map<String, String> details) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(), action,
                "logistics_authorization", id.toString(), actor.requestId(),
                actor.sourceIp(), details));
    }

    private static NormalizedAuthorization normalize(AuthorizationInput input,
            CredentialMaterial credentials) {
        if (input == null) throw new IllegalArgumentException("Authorization is required");
        String mode = required(input.integrationMode(), 32).toUpperCase(Locale.ROOT);
        if (!"MANUAL".equals(mode) && !"CREDENTIAL_REFERENCE".equals(mode)
                && !"DIRECT_CREDENTIALS".equals(mode)) {
            throw new IllegalArgumentException("Integration mode is invalid");
        }
        String reference = CredentialReferenceValidator.validateNullable(
                input.credentialReference());
        if (("MANUAL".equals(mode) && reference != null)
                || ("CREDENTIAL_REFERENCE".equals(mode) && reference == null)
                || ("DIRECT_CREDENTIALS".equals(mode) && reference != null)) {
            throw new IllegalArgumentException("Credential reference does not match integration mode");
        }
        CredentialMaterial normalizedCredentials = normalizeCredentials(credentials);
        if (("DIRECT_CREDENTIALS".equals(mode)) != (normalizedCredentials != null)) {
            throw new IllegalArgumentException(
                    "Direct credentials do not match integration mode");
        }
        AuthorizationInput normalized = new AuthorizationInput(category(input.category()),
                providerCode(input.providerCode()),
                required(input.providerName(), 120), required(input.accountLabel(), 160),
                mode, reference, optional(input.contactName(), 120),
                optional(input.note(), 500));
        return new NormalizedAuthorization(normalized, normalizedCredentials);
    }

    private static CredentialMaterial normalizeCredentials(CredentialMaterial value) {
        if (value == null) return null;
        return new CredentialMaterial(required(value.username(), 256),
                requiredCredential(value.password(), 256),
                optionalCredential(value.key(), 512));
    }

    private static ProbeResult normalizeProbe(ProbeResult value) {
        if (value == null || value.status() == null
                || !PROBE_STATUSES.contains(value.status())
                || value.message() == null || value.message().isBlank()
                || value.message().length() > 500
                || value.message().chars().anyMatch(Character::isISOControl)) {
            return new ProbeResult("UNAVAILABLE", "物流商连接验证暂时不可用，请稍后重试。");
        }
        if (!"CONNECTED".equals(value.status())) {
            return new ProbeResult(value.status(), value.message().strip());
        }
        try {
            return new ProbeResult(value.status(), value.message().strip(),
                    normalizeChannels(value.channels()));
        } catch (IllegalArgumentException exception) {
            return new ProbeResult("UNAVAILABLE",
                    "物流商渠道数据格式异常，请稍后重试或联系物流商。");
        }
    }

    private static List<DiscoveredChannel> normalizeChannels(
            List<DiscoveredChannel> values) {
        if (values == null || values.size() > 2_000) {
            throw new IllegalArgumentException("Logistics channel list is invalid");
        }
        LinkedHashMap<String, DiscoveredChannel> unique = new LinkedHashMap<>();
        for (DiscoveredChannel value : values) {
            if (value == null) throw new IllegalArgumentException("Logistics channel is invalid");
            String code = required(value.code(), 160);
            String name = required(value.name(), 160);
            unique.putIfAbsent(code, new DiscoveredChannel(code, name));
        }
        return List.copyOf(unique.values());
    }

    private static String providerCode(String value) {
        String normalized = required(value, 64).toUpperCase(Locale.ROOT);
        if (!PROVIDER_CODES.contains(normalized)) {
            throw new IllegalArgumentException("Logistics provider is invalid");
        }
        return normalized;
    }

    private static String category(String value) {
        String normalized = required(value, 24).toUpperCase(Locale.ROOT);
        if (!CATEGORIES.contains(normalized)) {
            throw new IllegalArgumentException("Logistics category is invalid");
        }
        return normalized;
    }

    private static String status(String value) {
        if (value == null || value.isBlank() || "ALL".equalsIgnoreCase(value)) return null;
        String normalized = value.strip().toUpperCase(Locale.ROOT);
        if (!STATUSES.contains(normalized)) {
            throw new IllegalArgumentException("Authorization status is invalid");
        }
        return normalized;
    }

    private static String required(String value, int maximum) {
        String normalized = value == null ? "" : value.strip();
        if (normalized.isEmpty() || normalized.length() > maximum
                || normalized.chars().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException("Text value is invalid");
        }
        return normalized;
    }

    private static String optional(String value, int maximum) {
        return value == null || value.isBlank() ? null : required(value, maximum);
    }

    private static String requiredCredential(String value, int maximum) {
        if (value == null || value.isBlank() || value.length() > maximum
                || value.chars().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException("Credential value is invalid");
        }
        return value;
    }

    private static String optionalCredential(String value, int maximum) {
        return value == null || value.isBlank()
                ? null : requiredCredential(value, maximum);
    }

    private static String optionalLower(String value, int maximum) {
        String normalized = optional(value, maximum);
        return normalized == null ? null : normalized.toLowerCase(Locale.ROOT);
    }

    private static void requireActor(Actor actor) {
        if (actor == null || actor.tenantId() == null
                || (actor.userId() == null) == (actor.systemAdminId() == null)
                || actor.displayName() == null || actor.displayName().isBlank()
                || actor.requestId() == null
                || !actor.requestId().matches("^[A-Za-z0-9._:-]{1,100}$")) {
            throw new AccessDeniedException("A tenant actor is required");
        }
    }

    public record Actor(UUID tenantId, UUID userId, UUID systemAdminId,
            String displayName, String requestId, String sourceIp) {
    }

    public record AuthorizationInput(String category, String providerCode,
            String providerName,
            String accountLabel, String integrationMode,
            String credentialReference, String contactName, String note) {
    }

    private record NormalizedAuthorization(AuthorizationInput input,
            CredentialMaterial credentials) {
    }

    public record ProbeOutcome(LogisticsAuthorizationRecord authorization,
            String status, String message) {
    }
}
