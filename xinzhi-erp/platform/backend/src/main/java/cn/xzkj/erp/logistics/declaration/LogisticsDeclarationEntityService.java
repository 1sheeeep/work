package cn.xzkj.erp.logistics.declaration;

import java.util.LinkedHashSet;
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

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.logistics.declaration.LogisticsDeclarationEntityRepository.ShopOption;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;

@Service
public class LogisticsDeclarationEntityService {
    private static final String CREATED = "logistics.declaration_entity.created";
    private static final String UPDATED = "logistics.declaration_entity.updated";
    private static final String ARCHIVED = "logistics.declaration_entity.archived";
    private static final List<String> SEARCH_FIELDS = List.of(
            "NAME", "CODE", "PLATFORM", "SHOP");
    private final LogisticsDeclarationEntityRepository repository;
    private final SecurityAuditRecorder auditRecorder;

    public LogisticsDeclarationEntityService(
            LogisticsDeclarationEntityRepository repository,
            SecurityAuditRecorder auditRecorder) {
        this.repository = repository;
        this.auditRecorder = auditRecorder;
    }

    @Transactional(readOnly = true)
    public Page<LogisticsDeclarationEntityRecord> list(
            Actor actor, String status, String searchField, String keyword,
            Pageable pageable) {
        requireActor(actor);
        return repository.list(actor.tenantId(), status(status),
                searchField(searchField), optional(keyword, 120,
                        "Declaration entity filter is invalid"), pageable);
    }

    @Transactional(readOnly = true)
    public LogisticsDeclarationEntityRecord detail(Actor actor, UUID id) {
        requireActor(actor);
        return requiredRecord(actor.tenantId(), id);
    }

    @Transactional(readOnly = true)
    public Page<ShopOption> listShopOptions(
            Actor actor, String keyword, Pageable pageable) {
        requireActor(actor);
        return repository.listShopOptions(actor.tenantId(),
                optional(keyword, 120, "Shop filter is invalid"), pageable);
    }

    @Transactional
    public LogisticsDeclarationEntityRecord create(Actor actor, EntityInput input) {
        requireActor(actor);
        EntityInput normalized = normalize(input);
        requireBindableShops(actor.tenantId(), normalized.shopIds());
        UUID id = UUID.randomUUID();
        try {
            repository.insert(id, actor.tenantId(), normalized, actor.userId(),
                    actor.systemAdminId(), actor.requestId());
        } catch (DataIntegrityViolationException exception) {
            throw new ConflictException(
                    "An active declaration entity with this code already exists");
        }
        audit(actor, CREATED, id, Map.of(
                "bindingCount", Integer.toString(normalized.shopIds().size())));
        return requiredRecord(actor.tenantId(), id);
    }

    @Transactional
    public LogisticsDeclarationEntityRecord update(
            Actor actor, UUID id, long version, EntityInput input) {
        requireActor(actor);
        LogisticsDeclarationEntityRecord current = requiredRecord(actor.tenantId(), id);
        if (!"ACTIVE".equals(current.status()) || version < 0) {
            throw new ConflictException("Archived declaration entity cannot be changed");
        }
        EntityInput normalized = normalize(input);
        requireBindableShops(actor.tenantId(), normalized.shopIds());
        try {
            if (!repository.update(id, actor.tenantId(), version, normalized,
                    actor.userId(), actor.systemAdminId(), actor.requestId())) {
                throw new ConflictException("Declaration entity changed concurrently");
            }
        } catch (DataIntegrityViolationException exception) {
            throw new ConflictException(
                    "An active declaration entity with this code already exists");
        }
        audit(actor, UPDATED, id, Map.of(
                "bindingCount", Integer.toString(normalized.shopIds().size()),
                "previousVersion", Long.toString(version)));
        return requiredRecord(actor.tenantId(), id);
    }

    @Transactional
    public LogisticsDeclarationEntityRecord archive(
            Actor actor, UUID id, long version) {
        requireActor(actor);
        LogisticsDeclarationEntityRecord current = requiredRecord(actor.tenantId(), id);
        if (!"ACTIVE".equals(current.status()) || version < 0
                || !repository.archive(actor.tenantId(), id, version,
                        actor.userId(), actor.systemAdminId(), actor.requestId())) {
            throw new ConflictException(
                    "Declaration entity changed concurrently or is already archived");
        }
        audit(actor, ARCHIVED, id, Map.of(
                "bindingCount", Integer.toString(current.shops().size()),
                "previousVersion", Long.toString(version)));
        return requiredRecord(actor.tenantId(), id);
    }

    private LogisticsDeclarationEntityRecord requiredRecord(
            UUID tenantId, UUID id) {
        if (id == null) {
            throw new IllegalArgumentException("Declaration entity id is required");
        }
        LogisticsDeclarationEntityRecord record = repository.find(tenantId, id);
        if (record == null) {
            throw new ResourceNotFoundException("Declaration entity was not found");
        }
        return record;
    }

    private void requireBindableShops(UUID tenantId, Set<UUID> shopIds) {
        if (repository.countBindableShops(tenantId, shopIds) != shopIds.size()) {
            throw new IllegalArgumentException(
                    "One or more selected shops are unavailable");
        }
    }

    private void audit(Actor actor, String action, UUID id,
            Map<String, String> details) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(), action,
                "logistics_declaration_entity", id.toString(), actor.requestId(),
                actor.sourceIp(), details));
    }

    private static EntityInput normalize(EntityInput input) {
        if (input == null) {
            throw new IllegalArgumentException("Declaration entity is required");
        }
        Set<UUID> shops = input.shopIds() == null
                ? Set.of() : new LinkedHashSet<>(input.shopIds());
        if (shops.size() > 100 || shops.stream().anyMatch(java.util.Objects::isNull)) {
            throw new IllegalArgumentException("Selected shops are invalid");
        }
        String code = required(input.enterpriseCode(), 100,
                "Enterprise code is invalid").toUpperCase(Locale.ROOT);
        if (!code.matches("^[A-Z0-9][A-Z0-9._:/ -]{0,99}$")) {
            throw new IllegalArgumentException("Enterprise code is invalid");
        }
        return new EntityInput(
                required(input.name(), 200, "Enterprise name is invalid"),
                code, Set.copyOf(shops));
    }

    private static String searchField(String value) {
        String normalized = value == null || value.isBlank()
                ? "NAME" : value.strip().toUpperCase(Locale.ROOT);
        if (!SEARCH_FIELDS.contains(normalized)) {
            throw new IllegalArgumentException("Search field is invalid");
        }
        return normalized;
    }

    private static String status(String value) {
        String normalized = value == null || value.isBlank()
                ? "ACTIVE" : value.strip().toUpperCase(Locale.ROOT);
        if ("ALL".equals(normalized)) return null;
        if (!List.of("ACTIVE", "ARCHIVED").contains(normalized)) {
            throw new IllegalArgumentException("Declaration entity status is invalid");
        }
        return normalized;
    }

    private static String required(String value, int maximum, String message) {
        String normalized = value == null ? "" : value.strip();
        if (normalized.isEmpty() || normalized.length() > maximum
                || normalized.chars().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException(message);
        }
        return normalized;
    }

    private static String optional(String value, int maximum, String message) {
        return value == null || value.isBlank()
                ? null : required(value, maximum, message);
    }

    private static void requireActor(Actor actor) {
        if (actor == null || actor.tenantId() == null
                || (actor.userId() == null) == (actor.systemAdminId() == null)
                || actor.requestId() == null
                || !actor.requestId().matches("^[A-Za-z0-9._:-]{1,100}$")) {
            throw new AccessDeniedException("A tenant actor is required");
        }
    }

    public record Actor(UUID tenantId, UUID userId, UUID systemAdminId,
            String requestId, String sourceIp) {
    }

    public record EntityInput(String name, String enterpriseCode,
            Set<UUID> shopIds) {
    }
}
