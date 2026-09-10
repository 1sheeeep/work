package cn.xzkj.erp.settings.enterprise;

import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.service.ConflictException;

@Service
public class EnterpriseProfileService {
    private static final String SAVED = "settings.enterprise_profile.saved";
    private static final Pattern EMAIL = Pattern.compile(
            "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$");
    private static final Pattern PHONE = Pattern.compile("^[+()0-9 .-]{6,32}$");
    private static final Pattern QQ = Pattern.compile("^[0-9]{5,20}$");
    private final EnterpriseProfileRepository repository;
    private final SecurityAuditRecorder auditRecorder;

    public EnterpriseProfileService(
            EnterpriseProfileRepository repository,
            SecurityAuditRecorder auditRecorder) {
        this.repository = repository;
        this.auditRecorder = auditRecorder;
    }

    @Transactional(readOnly = true)
    public EnterpriseProfileRecord get(Actor actor) {
        requireActor(actor, false);
        return repository.find(actor.tenantId());
    }

    @Transactional
    public EnterpriseProfileRecord save(
            Actor actor, long expectedVersion, ProfileInput input) {
        requireActor(actor, true);
        if (expectedVersion < 0) {
            throw new IllegalArgumentException("Enterprise profile version is invalid");
        }
        ProfileInput normalized = normalize(input);
        EnterpriseProfileRecord current = repository.find(actor.tenantId());
        boolean created = !current.configured();
        if (current.version() != expectedVersion) {
            throw new ConflictException("Enterprise profile changed concurrently");
        }
        try {
            if (created) {
                repository.insert(actor.tenantId(), normalized, actor);
            } else if (!repository.update(actor.tenantId(), expectedVersion,
                    normalized, actor)) {
                throw new ConflictException("Enterprise profile changed concurrently");
            }
        } catch (DataIntegrityViolationException exception) {
            throw new ConflictException("Enterprise profile changed concurrently");
        }
        audit(actor, SAVED, created, expectedVersion);
        return repository.find(actor.tenantId());
    }

    private void audit(Actor actor, String action, boolean created,
            long previousVersion) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(), action,
                "enterprise_profile", actor.tenantId().toString(), actor.requestId(),
                actor.sourceIp(), Map.of(
                        "created", Boolean.toString(created),
                        "previousVersion", Long.toString(previousVersion))));
    }

    private static ProfileInput normalize(ProfileInput input) {
        if (input == null) {
            throw new IllegalArgumentException("Enterprise profile is required");
        }
        String email = required(input.contactEmail(), 254,
                "Contact email is invalid").toLowerCase(Locale.ROOT);
        if (!EMAIL.matcher(email).matches()) {
            throw new IllegalArgumentException("Contact email is invalid");
        }
        String mobile = required(input.contactMobile(), 32,
                "Contact mobile is invalid");
        if (!PHONE.matcher(mobile).matches()) {
            throw new IllegalArgumentException("Contact mobile is invalid");
        }
        String telephone = optional(input.contactTelephone(), 32,
                "Contact telephone is invalid");
        if (telephone != null && !PHONE.matcher(telephone).matches()) {
            throw new IllegalArgumentException("Contact telephone is invalid");
        }
        String qq = optional(input.contactQq(), 20, "Contact QQ is invalid");
        if (qq != null && !QQ.matcher(qq).matches()) {
            throw new IllegalArgumentException("Contact QQ is invalid");
        }
        return new ProfileInput(
                required(input.companyName(), 160, "Company name is invalid"),
                optional(input.province(), 100, "Province is invalid"),
                optional(input.city(), 100, "City is invalid"),
                optional(input.district(), 100, "District is invalid"),
                optional(input.detailedAddress(), 500, "Detailed address is invalid"),
                required(input.contactName(), 160, "Contact name is invalid"),
                email, qq, mobile, telephone);
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

    private static void requireActor(Actor actor, boolean requestRequired) {
        if (actor == null || actor.tenantId() == null
                || (actor.userId() == null) == (actor.systemAdminId() == null)
                || (requestRequired && (actor.requestId() == null
                || !actor.requestId().matches("^[A-Za-z0-9._:-]{1,100}$")))) {
            throw new AccessDeniedException("A tenant actor is required");
        }
    }

    public record Actor(UUID tenantId, UUID userId, UUID systemAdminId,
            String requestId, String sourceIp) {
    }

    public record ProfileInput(
            String companyName,
            String province,
            String city,
            String district,
            String detailedAddress,
            String contactName,
            String contactEmail,
            String contactQq,
            String contactMobile,
            String contactTelephone) {
    }
}
