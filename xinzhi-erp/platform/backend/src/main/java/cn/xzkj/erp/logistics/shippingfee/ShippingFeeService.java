package cn.xzkj.erp.logistics.shippingfee;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import java.util.Arrays;
import java.util.Currency;
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
public class ShippingFeeService {
    private static final Set<String> COUNTRY_CODES =
            Set.copyOf(Arrays.asList(Locale.getISOCountries()));
    private final ShippingFeeRepository repository;
    private final SecurityAuditRecorder auditRecorder;

    public ShippingFeeService(
            ShippingFeeRepository repository,
            SecurityAuditRecorder auditRecorder) {
        this.repository = repository;
        this.auditRecorder = auditRecorder;
    }

    @Transactional(readOnly = true)
    public Page<ShippingFeeRecords.Region> listRegions(
            Actor actor, String status, String keyword, Pageable pageable) {
        requireActor(actor);
        return repository.listRegions(
                actor.tenantId(), status(status), optional(keyword, 100), pageable);
    }

    @Transactional(readOnly = true)
    public Page<ShippingFeeRecords.Rule> listRules(
            Actor actor, String status, String regionKeyword,
            String ruleKeyword, Pageable pageable) {
        requireActor(actor);
        return repository.listRules(
                actor.tenantId(), status(status), optional(regionKeyword, 100),
                optional(ruleKeyword, 100), pageable);
    }

    @Transactional
    public ShippingFeeRecords.Region createRegion(
            Actor actor, RegionInput input) {
        requireActor(actor);
        RegionInput normalized = normalize(input);
        UUID id = UUID.randomUUID();
        try {
            repository.insertRegion(id, actor.tenantId(), normalized, actor);
        } catch (DataIntegrityViolationException exception) {
            throw new ConflictException(
                    "An active shipping region with this name already exists");
        }
        audit(actor, "logistics.shipping_fee_region.created", "shipping_fee_region",
                id, Map.of("countryCode", normalized.countryCode()));
        return requireRegion(actor.tenantId(), id);
    }

    @Transactional
    public ShippingFeeRecords.Rule createRule(Actor actor, RuleInput input) {
        requireActor(actor);
        RuleInput normalized = normalize(input);
        ShippingFeeRecords.Region region = requireRegion(
                actor.tenantId(), normalized.regionId());
        if (!"ACTIVE".equals(region.status())) {
            throw new ConflictException("Archived shipping region cannot receive rules");
        }
        UUID id = UUID.randomUUID();
        try {
            repository.insertRule(id, actor.tenantId(), normalized, actor);
        } catch (DataIntegrityViolationException exception) {
            throw new ConflictException(
                    "An active shipping fee rule with this name already exists");
        }
        audit(actor, "logistics.shipping_fee_rule.created", "shipping_fee_rule",
                id, Map.of("regionId", normalized.regionId().toString(),
                        "currencyCode", normalized.currencyCode()));
        return requireRule(actor.tenantId(), id);
    }

    @Transactional
    public ShippingFeeRecords.Region archiveRegion(
            Actor actor, UUID id, long version) {
        requireActor(actor);
        ShippingFeeRecords.Region current = requireRegion(actor.tenantId(), id);
        if (!"ACTIVE".equals(current.status()) || version < 0) {
            throw new ConflictException("Shipping region is already archived");
        }
        repository.archiveRulesForRegion(actor.tenantId(), id, actor);
        if (!repository.archiveRegion(actor.tenantId(), id, version, actor)) {
            throw new ConflictException("Shipping region changed concurrently");
        }
        audit(actor, "logistics.shipping_fee_region.archived", "shipping_fee_region",
                id, Map.of("previousVersion", Long.toString(version)));
        return requireRegion(actor.tenantId(), id);
    }

    @Transactional
    public ShippingFeeRecords.Rule archiveRule(
            Actor actor, UUID id, long version) {
        requireActor(actor);
        ShippingFeeRecords.Rule current = requireRule(actor.tenantId(), id);
        if (!"ACTIVE".equals(current.status()) || version < 0
                || !repository.archiveRule(
                        actor.tenantId(), id, version, actor)) {
            throw new ConflictException(
                    "Shipping fee rule changed concurrently or is archived");
        }
        audit(actor, "logistics.shipping_fee_rule.archived", "shipping_fee_rule",
                id, Map.of("previousVersion", Long.toString(version)));
        return requireRule(actor.tenantId(), id);
    }

    @Transactional(readOnly = true)
    public List<EstimateResult> estimate(Actor actor, EstimateInput input) {
        requireActor(actor);
        EstimateInput normalized = normalize(input);
        long volumetricWeight = volumetricWeight(normalized);
        long chargeableWeight = switch (normalized.weighingMode()) {
            case "ACTUAL" -> normalized.weightGrams();
            case "VOLUMETRIC" -> volumetricWeight;
            case "MAXIMUM" -> Math.max(normalized.weightGrams(), volumetricWeight);
            default -> throw new IllegalArgumentException("Weighing mode is invalid");
        };
        return repository.estimateCandidates(
                        actor.tenantId(), normalized.countryCode(),
                        normalized.city(), normalized.postalCode(),
                        chargeableWeight)
                .stream().map(rule -> result(rule, normalized.weightGrams(),
                        volumetricWeight, chargeableWeight)).toList();
    }

    private static EstimateResult result(
            ShippingFeeRecords.Rule rule, long actualWeight,
            long volumetricWeight, long chargeableWeight) {
        try {
            long proportional = ceilingDivide(
                    Math.multiplyExact(
                            chargeableWeight, rule.perKilogramFeeMinor()),
                    1_000L);
            long shipping = Math.addExact(rule.baseFeeMinor(), proportional);
            long total = Math.addExact(shipping, rule.otherFeeMinor());
            return new EstimateResult(
                    rule.regionId(), rule.regionName(), rule.id(), rule.name(),
                    actualWeight, volumetricWeight, chargeableWeight,
                    shipping, rule.otherFeeMinor(), total, rule.currencyCode());
        } catch (ArithmeticException exception) {
            throw new IllegalArgumentException(
                    "Shipping fee estimate is outside the supported range");
        }
    }

    private static long volumetricWeight(EstimateInput input) {
        if ("ACTUAL".equals(input.weighingMode())) return 0;
        if (input.lengthMm() == null || input.widthMm() == null
                || input.heightMm() == null || input.volumetricDivisor() == null) {
            throw new IllegalArgumentException(
                    "Dimensions and volumetric divisor are required");
        }
        try {
            long volume = Math.multiplyExact(
                    Math.multiplyExact(input.lengthMm(), input.widthMm()),
                    input.heightMm());
            return ceilingDivide(volume, input.volumetricDivisor());
        } catch (ArithmeticException exception) {
            throw new IllegalArgumentException(
                    "Package dimensions are outside the supported range");
        }
    }

    private static long ceilingDivide(long value, long divisor) {
        return Math.addExact(value, divisor - 1) / divisor;
    }

    private ShippingFeeRecords.Region requireRegion(UUID tenantId, UUID id) {
        if (id == null) throw new IllegalArgumentException("Region id is required");
        ShippingFeeRecords.Region value = repository.findRegion(tenantId, id);
        if (value == null) {
            throw new ResourceNotFoundException("Shipping region was not found");
        }
        return value;
    }

    private ShippingFeeRecords.Rule requireRule(UUID tenantId, UUID id) {
        if (id == null) throw new IllegalArgumentException("Rule id is required");
        ShippingFeeRecords.Rule value = repository.findRule(tenantId, id);
        if (value == null) {
            throw new ResourceNotFoundException("Shipping fee rule was not found");
        }
        return value;
    }

    private void audit(
            Actor actor, String action, String resourceType, UUID id,
            Map<String, String> details) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(), action,
                resourceType, id.toString(), actor.requestId(), actor.sourceIp(),
                details));
    }

    private static RegionInput normalize(RegionInput input) {
        if (input == null) throw new IllegalArgumentException("Region is required");
        String country = required(input.countryCode(), 2).toUpperCase(Locale.ROOT);
        if (!COUNTRY_CODES.contains(country)) {
            throw new IllegalArgumentException("Country code is invalid");
        }
        return new RegionInput(
                required(input.name(), 100), country,
                optional(input.city(), 100),
                optional(input.postalCodePrefix(), 32),
                optional(input.note(), 500));
    }

    private static RuleInput normalize(RuleInput input) {
        if (input == null || input.regionId() == null
                || input.minimumWeightGrams() < 0
                || (input.maximumWeightGrams() != null
                    && input.maximumWeightGrams() < input.minimumWeightGrams())
                || input.baseFeeMinor() < 0
                || input.perKilogramFeeMinor() < 0
                || input.otherFeeMinor() < 0) {
            throw new IllegalArgumentException("Shipping fee rule is invalid");
        }
        String currency = required(input.currencyCode(), 3)
                .toUpperCase(Locale.ROOT);
        try {
            Currency.getInstance(currency);
        } catch (IllegalArgumentException exception) {
            throw new IllegalArgumentException("Currency is invalid");
        }
        return new RuleInput(
                input.regionId(), required(input.name(), 100),
                input.minimumWeightGrams(), input.maximumWeightGrams(),
                input.baseFeeMinor(), input.perKilogramFeeMinor(),
                input.otherFeeMinor(), currency, optional(input.note(), 500));
    }

    private static EstimateInput normalize(EstimateInput input) {
        if (input == null || input.weightGrams() < 1
                || input.weightGrams() > 100_000_000L) {
            throw new IllegalArgumentException("Package weight is invalid");
        }
        String country = required(input.countryCode(), 2).toUpperCase(Locale.ROOT);
        if (!COUNTRY_CODES.contains(country)) {
            throw new IllegalArgumentException("Country code is invalid");
        }
        String mode = required(input.weighingMode(), 16).toUpperCase(Locale.ROOT);
        if (!List.of("ACTUAL", "VOLUMETRIC", "MAXIMUM").contains(mode)) {
            throw new IllegalArgumentException("Weighing mode is invalid");
        }
        Long length = positiveDimension(input.lengthMm());
        Long width = positiveDimension(input.widthMm());
        Long height = positiveDimension(input.heightMm());
        Long divisor = input.volumetricDivisor();
        if (divisor != null && (divisor < 1 || divisor > 100_000)) {
            throw new IllegalArgumentException("Volumetric divisor is invalid");
        }
        return new EstimateInput(
                country, optional(input.city(), 100),
                optional(input.postalCode(), 32), input.weightGrams(),
                length, width, height, divisor, mode);
    }

    private static Long positiveDimension(Long value) {
        if (value == null) return null;
        if (value < 1 || value > 1_000_000) {
            throw new IllegalArgumentException("Package dimension is invalid");
        }
        return value;
    }

    private static String status(String value) {
        String normalized = value == null || value.isBlank()
                ? "ALL" : value.strip().toUpperCase(Locale.ROOT);
        return switch (normalized) {
            case "ALL" -> null;
            case "ENABLED", "ACTIVE" -> "ACTIVE";
            case "DISABLED", "ARCHIVED" -> "ARCHIVED";
            default -> throw new IllegalArgumentException("Status is invalid");
        };
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

    private static void requireActor(Actor actor) {
        if (actor == null || actor.tenantId() == null
                || (actor.userId() == null) == (actor.systemAdminId() == null)
                || actor.displayName() == null || actor.displayName().isBlank()
                || actor.requestId() == null
                || !actor.requestId().matches("^[A-Za-z0-9._:-]{1,100}$")) {
            throw new AccessDeniedException("A tenant actor is required");
        }
    }

    public record Actor(
            UUID tenantId, UUID userId, UUID systemAdminId,
            String displayName, String requestId, String sourceIp) {
    }

    public record RegionInput(
            String name, String countryCode, String city,
            String postalCodePrefix, String note) {
    }

    public record RuleInput(
            UUID regionId, String name, long minimumWeightGrams,
            Long maximumWeightGrams, long baseFeeMinor,
            long perKilogramFeeMinor, long otherFeeMinor,
            String currencyCode, String note) {
    }

    public record EstimateInput(
            String countryCode, String city, String postalCode,
            long weightGrams, Long lengthMm, Long widthMm, Long heightMm,
            Long volumetricDivisor, String weighingMode) {
    }

    public record EstimateResult(
            UUID regionId, String regionName, UUID ruleId, String ruleName,
            long actualWeightGrams, long volumetricWeightGrams,
            long chargeableWeightGrams, long shippingFeeMinor,
            long otherFeeMinor, long totalFeeMinor, String currencyCode) {
    }
}
