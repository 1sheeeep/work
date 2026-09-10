package cn.xzkj.erp.logistics.address;

import java.util.Arrays;
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
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;

@Service
public class LogisticsAddressService {
    private static final String ADDRESS_CREATED = "logistics.address.created";
    private static final String ADDRESS_UPDATED = "logistics.address.updated";
    private static final String ADDRESS_ARCHIVED = "logistics.address.archived";
    private static final Set<String> COUNTRY_CODES =
            Set.copyOf(Arrays.asList(Locale.getISOCountries()));
    private static final List<String> TYPES = List.of(
            "RECEIVING_TRANSIT", "PLATFORM_SHIPPING", "SHIPPING");
    private final LogisticsAddressRepository repository;
    private final SecurityAuditRecorder auditRecorder;

    public LogisticsAddressService(
            LogisticsAddressRepository repository,
            SecurityAuditRecorder auditRecorder) {
        this.repository = repository;
        this.auditRecorder = auditRecorder;
    }

    @Transactional(readOnly = true)
    public Page<LogisticsAddressRecord> list(
            Actor actor, String type, String status, String keyword,
            Pageable pageable) {
        requireActor(actor);
        return repository.list(actor.tenantId(), optionalType(type), status(status),
                optional(keyword, 120, "Address filter is invalid"), pageable);
    }

    @Transactional(readOnly = true)
    public LogisticsAddressRecord detail(Actor actor, UUID id) {
        requireActor(actor);
        return requiredRecord(actor.tenantId(), id);
    }

    @Transactional
    public LogisticsAddressRecord create(Actor actor, AddressInput input) {
        requireActor(actor);
        AddressInput normalized = normalize(input);
        UUID id = UUID.randomUUID();
        try {
            repository.insert(id, actor.tenantId(), normalized, actor.userId(),
                    actor.systemAdminId(), actor.requestId());
        } catch (DataIntegrityViolationException exception) {
            throw new ConflictException("An active address with this name already exists");
        }
        audit(actor, ADDRESS_CREATED, id,
                Map.of("type", normalized.addressType()));
        return requiredRecord(actor.tenantId(), id);
    }

    @Transactional
    public LogisticsAddressRecord update(
            Actor actor, UUID id, long version, AddressInput input) {
        requireActor(actor);
        LogisticsAddressRecord current = requiredRecord(actor.tenantId(), id);
        if (!"ACTIVE".equals(current.status()) || version < 0) {
            throw new ConflictException("Archived address cannot be changed");
        }
        AddressInput normalized = normalize(input);
        try {
            if (!repository.update(id, actor.tenantId(), version, normalized,
                    actor.userId(), actor.systemAdminId(), actor.requestId())) {
                throw new ConflictException("Address changed concurrently");
            }
        } catch (DataIntegrityViolationException exception) {
            throw new ConflictException("An active address with this name already exists");
        }
        audit(actor, ADDRESS_UPDATED, id,
                Map.of("type", normalized.addressType(),
                        "previousVersion", Long.toString(version)));
        return requiredRecord(actor.tenantId(), id);
    }

    @Transactional
    public LogisticsAddressRecord archive(Actor actor, UUID id, long version) {
        requireActor(actor);
        LogisticsAddressRecord current = requiredRecord(actor.tenantId(), id);
        if (!"ACTIVE".equals(current.status()) || version < 0
                || !repository.archive(actor.tenantId(), id, version,
                        actor.userId(), actor.systemAdminId(), actor.requestId())) {
            throw new ConflictException("Address changed concurrently or is already archived");
        }
        audit(actor, ADDRESS_ARCHIVED, id,
                Map.of("type", current.addressType(),
                        "previousVersion", Long.toString(version)));
        return requiredRecord(actor.tenantId(), id);
    }

    private LogisticsAddressRecord requiredRecord(UUID tenantId, UUID id) {
        if (id == null) throw new IllegalArgumentException("Address id is required");
        LogisticsAddressRecord record = repository.find(tenantId, id);
        if (record == null) throw new ResourceNotFoundException("Address was not found");
        return record;
    }

    private void audit(Actor actor, String action, UUID id,
            Map<String, String> details) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(), action,
                "logistics_address", id.toString(), actor.requestId(),
                actor.sourceIp(), details));
    }

    private static AddressInput normalize(AddressInput input) {
        if (input == null) throw new IllegalArgumentException("Address is required");
        String countryCode = required(input.countryCode(), 2, "Country is invalid")
                .toUpperCase(Locale.ROOT);
        if (!COUNTRY_CODES.contains(countryCode)) {
            throw new IllegalArgumentException("Country is invalid");
        }
        String email = optional(input.contactEmail(), 254, "Email is invalid");
        if (email != null) email = email.toLowerCase(Locale.ROOT);
        return new AddressInput(
                requiredType(input.addressType()),
                required(input.name(), 160, "Address name is invalid"),
                required(input.contactName(), 160, "Contact name is invalid"),
                email, countryCode,
                optional(input.province(), 120, "Province is invalid"),
                optional(input.city(), 120, "City is invalid"),
                optional(input.district(), 120, "District is invalid"),
                required(input.addressLine1(), 300, "Address is invalid"),
                optional(input.postalCode(), 32, "Postal code is invalid"),
                optional(input.landline(), 40, "Landline is invalid"),
                optional(input.mobile(), 40, "Mobile is invalid"),
                optional(input.companyName(), 200, "Company is invalid"),
                optional(input.fax(), 40, "Fax is invalid"));
    }

    private static String optionalType(String value) {
        return value == null || value.isBlank() ? null : requiredType(value);
    }

    private static String requiredType(String value) {
        String normalized = value == null ? "" : value.strip().toUpperCase(Locale.ROOT);
        if (!TYPES.contains(normalized)) {
            throw new IllegalArgumentException("Address type is invalid");
        }
        return normalized;
    }

    private static String status(String value) {
        String normalized = value == null || value.isBlank()
                ? "ACTIVE" : value.strip().toUpperCase(Locale.ROOT);
        if ("ALL".equals(normalized)) return null;
        if (!List.of("ACTIVE", "ARCHIVED").contains(normalized)) {
            throw new IllegalArgumentException("Address status is invalid");
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
        if (value == null || value.isBlank()) return null;
        return required(value, maximum, message);
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

    public record AddressInput(
            String addressType,
            String name,
            String contactName,
            String contactEmail,
            String countryCode,
            String province,
            String city,
            String district,
            String addressLine1,
            String postalCode,
            String landline,
            String mobile,
            String companyName,
            String fax) {
    }
}
