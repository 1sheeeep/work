package cn.xzkj.erp.settings.address;

import java.text.Normalizer;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
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
public class AddressMappingService {
    private static final String SETTING_SAVED = "settings.address_mapping.saved";
    private static final String CREATED = "settings.address_mapping.created";
    private static final String UPDATED = "settings.address_mapping.updated";
    private static final String DELETED = "settings.address_mapping.deleted";
    private final AddressMappingRepository repository;
    private final SecurityAuditRecorder auditRecorder;

    public AddressMappingService(AddressMappingRepository repository,
            SecurityAuditRecorder auditRecorder) {
        this.repository = repository;
        this.auditRecorder = auditRecorder;
    }

    @Transactional(readOnly = true)
    public AddressMappingSettingRecord getSetting(Actor actor) {
        requireActor(actor, false);
        return repository.findSetting(actor.tenantId());
    }

    @Transactional
    public AddressMappingSettingRecord saveSetting(Actor actor,
            long expectedVersion, boolean enabled) {
        requireActor(actor, true);
        if (expectedVersion < 0) throw new IllegalArgumentException("Version is invalid");
        AddressMappingSettingRecord current = repository.findSetting(actor.tenantId());
        if (current.version() != expectedVersion) conflict();
        try {
            if (!current.configured()) {
                repository.insertSetting(actor.tenantId(), enabled, actor);
            } else if (!repository.updateSetting(actor.tenantId(), expectedVersion,
                    enabled, actor)) {
                conflict();
            }
        } catch (DataIntegrityViolationException exception) {
            conflict();
        }
        audit(actor, SETTING_SAVED, actor.tenantId().toString(), Map.of(
                "previousEnabled", Boolean.toString(current.enabled()),
                "enabled", Boolean.toString(enabled)));
        return repository.findSetting(actor.tenantId());
    }

    @Transactional(readOnly = true)
    public MappingPage list(Actor actor, MappingQuery query) {
        requireActor(actor, false);
        Objects.requireNonNull(query, "Query is required");
        if (query.page() < 0 || query.size() < 1 || query.size() > 100) {
            throw new IllegalArgumentException("Pagination is invalid");
        }
        return repository.list(actor.tenantId(), new MappingQuery(
                query.platform(), country(query.countryCode()), query.addressType(),
                optional(query.keyword(), 120), query.page(), query.size()));
    }

    @Transactional
    public AddressMappingRecord create(Actor actor, MappingInput source) {
        requireActor(actor, true);
        MappingInput input = normalize(source);
        UUID id = UUID.randomUUID();
        try {
            repository.insert(actor.tenantId(), id, input,
                    sourceKey(input.sourceValue()), actor);
        } catch (DataIntegrityViolationException exception) {
            throw new ConflictException("Address mapping already exists");
        }
        audit(actor, CREATED, id.toString(), auditData(input));
        return repository.find(actor.tenantId(), id).orElseThrow();
    }

    @Transactional
    public AddressMappingRecord update(Actor actor, UUID id,
            long expectedVersion, MappingInput source) {
        requireActor(actor, true);
        if (id == null || expectedVersion < 0) {
            throw new IllegalArgumentException("Mapping identity is invalid");
        }
        repository.find(actor.tenantId(), id).orElseThrow(
                () -> new ResourceNotFoundException("Address mapping was not found"));
        MappingInput input = normalize(source);
        try {
            if (!repository.update(actor.tenantId(), id, expectedVersion, input,
                    sourceKey(input.sourceValue()), actor)) {
                conflict();
            }
        } catch (DataIntegrityViolationException exception) {
            throw new ConflictException("Address mapping already exists");
        }
        audit(actor, UPDATED, id.toString(), auditData(input));
        return repository.find(actor.tenantId(), id).orElseThrow();
    }

    @Transactional
    public void delete(Actor actor, UUID id, long expectedVersion) {
        requireActor(actor, true);
        if (id == null || expectedVersion < 0) {
            throw new IllegalArgumentException("Mapping identity is invalid");
        }
        AddressMappingRecord current = repository.find(actor.tenantId(), id)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Address mapping was not found"));
        if (!repository.delete(actor.tenantId(), id, expectedVersion, actor)) {
            conflict();
        }
        audit(actor, DELETED, id.toString(), auditData(new MappingInput(
                current.platform(), current.countryCode(), current.addressType(),
                current.sourceValue(), current.mappedValue(), current.enabled())));
    }

    @Transactional(readOnly = true)
    public String resolveFirst(UUID tenantId, Platform platform,
            String countryCode, AddressType addressType,
            List<String> candidates, String fallback) {
        if (tenantId == null || platform == null || addressType == null) {
            return fallback;
        }
        String normalizedCountry;
        try {
            normalizedCountry = country(countryCode);
        } catch (IllegalArgumentException exception) {
            return fallback;
        }
        if (normalizedCountry == null || candidates == null) return fallback;
        for (String candidate : candidates) {
            String normalized;
            try {
                normalized = optional(candidate, 120);
            } catch (IllegalArgumentException exception) {
                continue;
            }
            if (normalized == null) continue;
            var mapped = repository.resolve(tenantId, platform,
                    normalizedCountry, addressType, sourceKey(normalized));
            if (mapped.isPresent()) return mapped.get();
        }
        return fallback;
    }

    private static MappingInput normalize(MappingInput source) {
        if (source == null || source.platform() == null
                || source.addressType() == null) {
            throw new IllegalArgumentException("Mapping fields are required");
        }
        String countryCode = country(source.countryCode());
        String sourceValue = required(source.sourceValue(), 120);
        String mappedValue = required(source.mappedValue(), 120);
        if (countryCode == null) {
            throw new IllegalArgumentException("Country code is invalid");
        }
        return new MappingInput(source.platform(), countryCode,
                source.addressType(), sourceValue, mappedValue, source.enabled());
    }

    private static String required(String value, int max) {
        String normalized = optional(value, max);
        if (normalized == null) throw new IllegalArgumentException("Text is required");
        return normalized;
    }

    private static String optional(String value, int max) {
        if (value == null) return null;
        String normalized = Normalizer.normalize(value, Normalizer.Form.NFKC).strip();
        if (normalized.isEmpty()) return null;
        if (normalized.length() > max || normalized.codePoints()
                .anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException("Text is invalid");
        }
        return normalized;
    }

    private static String country(String value) {
        String normalized = optional(value, 2);
        if (normalized == null) return null;
        normalized = normalized.toUpperCase(Locale.ROOT);
        return normalized.matches("^[A-Z]{2}$") ? normalized : null;
    }

    private static String sourceKey(String value) {
        return Normalizer.normalize(value, Normalizer.Form.NFKC)
                .strip().toLowerCase(Locale.ROOT);
    }

    private static Map<String, String> auditData(MappingInput input) {
        return Map.of(
                "platform", input.platform().name(),
                "countryCode", input.countryCode(),
                "addressType", input.addressType().name(),
                "sourceValue", input.sourceValue(),
                "mappedValue", input.mappedValue(),
                "enabled", Boolean.toString(input.enabled()));
    }

    private void audit(Actor actor, String action, String resourceId,
            Map<String, String> data) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(), action,
                "address_mapping", resourceId, actor.requestId(), actor.sourceIp(),
                data));
    }

    private static void conflict() {
        throw new ConflictException("Address mapping changed concurrently");
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

    public enum Platform { SHOPIFY }
    public enum AddressType { PROVINCE, CITY }

    public record Actor(UUID tenantId, UUID userId, UUID systemAdminId,
            String displayName, String requestId, String sourceIp) {
    }

    public record MappingInput(Platform platform, String countryCode,
            AddressType addressType, String sourceValue, String mappedValue,
            boolean enabled) {
    }

    public record MappingQuery(Platform platform, String countryCode,
            AddressType addressType, String keyword, int page, int size) {
    }

    public record MappingPage(List<AddressMappingRecord> items, int page,
            int size, long totalElements) {
        public MappingPage {
            items = List.copyOf(items);
        }

        public int totalPages() {
            return totalElements == 0 ? 0
                    : (int) ((totalElements + size - 1) / size);
        }
    }
}
