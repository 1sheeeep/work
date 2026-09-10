package cn.xzkj.erp.settings.alias;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;

@Service
public class ShopAliasService {
    private static final String SAVED = "settings.shop_alias.saved";
    private final ShopAliasRepository repository;
    private final SecurityAuditRecorder auditRecorder;

    public ShopAliasService(ShopAliasRepository repository,
            SecurityAuditRecorder auditRecorder) {
        this.repository = repository;
        this.auditRecorder = auditRecorder;
    }

    @Transactional(readOnly = true)
    public AliasPage list(Actor actor, AliasQuery query) {
        requireActor(actor, false);
        if (query == null || query.page() < 0 || query.size() < 1
                || query.size() > 100) {
            throw new IllegalArgumentException("Pagination is invalid");
        }
        return repository.list(actor.tenantId(), new AliasQuery(
                optional(query.keyword()), query.page(), query.size()));
    }

    @Transactional
    public ShopAliasRecord save(Actor actor, UUID shopId, long expectedVersion,
            AliasInput source) {
        requireActor(actor, true);
        if (shopId == null || expectedVersion < 0) {
            throw new IllegalArgumentException("Shop alias identity is invalid");
        }
        AliasInput input = normalize(source);
        ShopAliasRecord current = repository.find(actor.tenantId(), shopId)
                .orElseThrow(() -> new ResourceNotFoundException("Shop was not found"));
        if (current.version() != expectedVersion) conflict();
        try {
            if (!current.configured()) {
                repository.insert(actor.tenantId(), shopId, input, actor);
            } else if (!repository.update(actor.tenantId(), shopId,
                    expectedVersion, input, actor)) {
                conflict();
            }
        } catch (DataIntegrityViolationException exception) {
            conflict();
        }
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(), SAVED,
                "shop_alias", shopId.toString(), actor.requestId(),
                actor.sourceIp(), Map.of(
                        "shopDisplayName", current.shopDisplayName(),
                        "configuredLanguages", Integer.toString(count(input)),
                        "created", Boolean.toString(!current.configured()))));
        return repository.find(actor.tenantId(), shopId).orElseThrow();
    }

    @Transactional(readOnly = true)
    public Map<UUID, String> localizedNames(UUID tenantId,
            Collection<UUID> shopIds, String acceptLanguage) {
        Language language = language(acceptLanguage);
        if (tenantId == null || shopIds == null || shopIds.isEmpty()
                || language == Language.NONE) return Map.of();
        Map<UUID, String> result = new LinkedHashMap<>();
        repository.findAliases(tenantId, shopIds).forEach((shopId, aliases) -> {
            String value = language == Language.CHINESE
                    ? aliases.chinese() : aliases.english();
            if (value != null) result.put(shopId, value);
        });
        return Map.copyOf(result);
    }

    @Transactional(readOnly = true)
    public String localizedName(UUID tenantId, UUID shopId,
            String acceptLanguage) {
        return localizedNames(tenantId, List.of(shopId), acceptLanguage).get(shopId);
    }

    private static AliasInput normalize(AliasInput source) {
        if (source == null) throw new IllegalArgumentException("Aliases are required");
        return new AliasInput(optional(source.aliasEn()), optional(source.aliasZhCn()),
                optional(source.aliasEs()), optional(source.aliasId()),
                optional(source.aliasTh()), optional(source.aliasRu()),
                optional(source.aliasPt()), optional(source.aliasVi()),
                optional(source.aliasMs()));
    }

    private static String optional(String value) {
        if (value == null) return null;
        String normalized = value.strip();
        if (normalized.isEmpty()) return null;
        if (normalized.length() > 160 || normalized.chars()
                .anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException("Alias is invalid");
        }
        return normalized;
    }

    private static Language language(String value) {
        if (value == null) return Language.NONE;
        String normalized = value.toLowerCase(Locale.ROOT);
        if (normalized.startsWith("zh")) return Language.CHINESE;
        if (normalized.startsWith("en")) return Language.ENGLISH;
        return Language.NONE;
    }

    private static int count(AliasInput input) {
        return (int) java.util.stream.Stream.of(input.aliasEn(), input.aliasZhCn(), input.aliasEs(),
                input.aliasId(), input.aliasTh(), input.aliasRu(), input.aliasPt(),
                input.aliasVi(), input.aliasMs()).filter(java.util.Objects::nonNull).count();
    }

    private static void requireActor(Actor actor, boolean requestRequired) {
        if (actor == null || actor.tenantId() == null
                || (actor.userId() == null) == (actor.systemAdminId() == null)
                || (requestRequired && (actor.requestId() == null
                || !actor.requestId().matches("^[A-Za-z0-9._:-]{1,100}$")
                || actor.displayName() == null || actor.displayName().isBlank()))) {
            throw new AccessDeniedException("A tenant actor is required");
        }
    }

    private static void conflict() {
        throw new ConflictException("Shop alias changed concurrently");
    }

    private enum Language { NONE, ENGLISH, CHINESE }

    public record Actor(UUID tenantId, UUID userId, UUID systemAdminId,
            String displayName, String requestId, String sourceIp) {
    }

    public record AliasInput(String aliasEn, String aliasZhCn, String aliasEs,
            String aliasId, String aliasTh, String aliasRu, String aliasPt,
            String aliasVi, String aliasMs) {
    }

    public record AliasQuery(String keyword, int page, int size) {
    }

    public record AliasPage(List<ShopAliasRecord> items, int page, int size,
            long totalElements) {
        public AliasPage { items = List.copyOf(items); }
        public int totalPages() {
            return totalElements == 0 ? 0
                    : (int) ((totalElements + size - 1) / size);
        }
    }
}
