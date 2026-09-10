package cn.xzkj.erp.fulfillment.weighing;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cn.xzkj.erp.fulfillment.weighing.ShippingConfigurationRecords.PackagingTemplate;
import cn.xzkj.erp.fulfillment.weighing.ShippingConfigurationRecords.WeightTolerance;
import cn.xzkj.erp.fulfillment.weighing.ShippingWeighingRecords.PackageWeighing;
import cn.xzkj.erp.fulfillment.weighing.ShippingWeighingRecords.WeighingEvent;
import cn.xzkj.erp.fulfillment.weighing.ShippingWeighingRepository.ScaleIdentity;
import cn.xzkj.erp.fulfillment.weighing.ShippingWeighingRepository.WeightCalculation;
import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;

@Service
public class ShippingWeighingService {
    private static final String PACKAGING_ASSIGNED =
            "fulfillment.package.packaging_assigned";
    private static final String PACKAGE_WEIGHED = "fulfillment.package.weighed";
    private static final String WEIGHING_OVERRIDDEN =
            "fulfillment.package.weighing_overridden";
    private final ShippingWeighingRepository repository;
    private final SecurityAuditRecorder auditRecorder;
    private final Clock clock;

    @Autowired
    public ShippingWeighingService(
            ShippingWeighingRepository repository,
            SecurityAuditRecorder auditRecorder) {
        this(repository, auditRecorder, Clock.systemUTC());
    }

    ShippingWeighingService(
            ShippingWeighingRepository repository,
            SecurityAuditRecorder auditRecorder,
            Clock clock) {
        this.repository = repository;
        this.auditRecorder = auditRecorder;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public PackageWeighing get(UUID tenantId, UUID planId, UUID packageId) {
        requireTenant(tenantId);
        return requirePackage(tenantId, planId, packageId, false);
    }

    @Transactional
    public PackageWeighing assignPackaging(
            Actor actor, UUID planId, UUID packageId, long packageVersion,
            UUID templateId) {
        requireActor(actor);
        PackageWeighing packageState = requirePackage(
                actor.tenantId(), planId, packageId, true);
        if (!"DRAFT".equals(packageState.packageStatus())
                || packageState.packageVersion() != packageVersion) {
            throw new ConflictException("Package is no longer editable");
        }
        PackagingTemplate template = repository.availableTemplate(
                actor.tenantId(), packageState.warehouseId(), templateId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Active packaging template is not available in this warehouse"));
        WeightCalculation calculation = repository.calculateItemWeight(
                actor.tenantId(), packageId, template.standardWeightGrams());
        repository.assignPackaging(actor.tenantId(), planId, packageId,
                packageVersion, template, calculation);
        audit(actor, PACKAGING_ASSIGNED, "fulfillment_package",
                packageId, Map.of("planId", planId.toString(),
                        "packagingTemplateId", template.id().toString(),
                        "weightReady", Boolean.toString(calculation.complete())));
        return requirePackage(actor.tenantId(), planId, packageId, false);
    }

    @Transactional
    public WeighingEvent weigh(
            Actor actor, UUID planId, UUID packageId, long packageVersion,
            UUID commandId, UUID scaleId, long actualWeightGrams,
            Instant occurredAt) {
        requireActor(actor);
        validateMeasurement(commandId, actualWeightGrams, occurredAt);
        WeighingEvent replay = replay(actor.tenantId(), planId, packageId,
                commandId, "SCALE", scaleId, actualWeightGrams, null, occurredAt);
        if (replay != null) return replay;
        PackageWeighing packageState = requirePackage(
                actor.tenantId(), planId, packageId, true);
        if (!"SEALED".equals(packageState.packageStatus())
                || packageState.packageVersion() != packageVersion
                || packageState.expectedWeightGrams() == null) {
            throw new ConflictException("Package is not ready for scale weighing");
        }
        ScaleIdentity scale = repository.activeScale(
                actor.tenantId(), packageState.warehouseId(), scaleId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Active scale is not bound to this warehouse"));
        WeightTolerance tolerance = repository.effectiveTolerance(
                actor.tenantId(), packageState.warehouseId());
        long allowed = Math.max(tolerance.toleranceGrams(),
                ceilPercentage(packageState.expectedWeightGrams(),
                        tolerance.toleranceBasisPoints()));
        long difference = actualWeightGrams - packageState.expectedWeightGrams();
        String result = Math.abs(difference) <= allowed ? "PASSED" : "BLOCKED";
        WeighingEvent event = repository.record(
                actor.tenantId(), planId, packageId, packageVersion,
                commandId, scale.id(), "SCALE", packageState.expectedWeightGrams(),
                actualWeightGrams, allowed, difference, result, null, occurredAt,
                actor.userId(), actor.systemAdminId(), actor.requestId());
        audit(actor, PACKAGE_WEIGHED, "fulfillment_package", packageId,
                Map.of("planId", planId.toString(), "scaleId", scale.id().toString(),
                        "deviceNumber", scale.deviceNumber(), "result", result,
                        "actualWeightGrams", Long.toString(actualWeightGrams),
                        "differenceGrams", Long.toString(difference)));
        return event;
    }

    @Transactional
    public WeighingEvent override(
            Actor actor, UUID planId, UUID packageId, long packageVersion,
            UUID commandId, long actualWeightGrams, Instant occurredAt,
            String reason) {
        requireActor(actor);
        validateMeasurement(commandId, actualWeightGrams, occurredAt);
        String normalizedReason = reason == null ? "" : reason.strip();
        if (normalizedReason.isEmpty() || normalizedReason.length() > 500) {
            throw new IllegalArgumentException("Override reason is invalid");
        }
        WeighingEvent replay = replay(actor.tenantId(), planId, packageId,
                commandId, "MANUAL", null, actualWeightGrams,
                normalizedReason, occurredAt);
        if (replay != null) return replay;
        PackageWeighing packageState = requirePackage(
                actor.tenantId(), planId, packageId, true);
        if (!"SEALED".equals(packageState.packageStatus())
                || packageState.packageVersion() != packageVersion) {
            throw new ConflictException("Package is not ready for forced release");
        }
        Long allowed = null;
        Long difference = null;
        if (packageState.expectedWeightGrams() != null) {
            WeightTolerance tolerance = repository.effectiveTolerance(
                    actor.tenantId(), packageState.warehouseId());
            allowed = Math.max((long) tolerance.toleranceGrams(),
                    ceilPercentage(packageState.expectedWeightGrams(),
                            tolerance.toleranceBasisPoints()));
            difference = actualWeightGrams - packageState.expectedWeightGrams();
        }
        WeighingEvent event = repository.record(
                actor.tenantId(), planId, packageId, packageVersion,
                commandId, null, "MANUAL", packageState.expectedWeightGrams(),
                actualWeightGrams, allowed, difference, "OVERRIDDEN",
                normalizedReason, occurredAt, actor.userId(), actor.systemAdminId(),
                actor.requestId());
        audit(actor, WEIGHING_OVERRIDDEN, "fulfillment_package",
                packageId, Map.of("planId", planId.toString(),
                        "actualWeightGrams", Long.toString(actualWeightGrams),
                        "reason", normalizedReason));
        return event;
    }

    @Transactional(readOnly = true)
    public List<WeighingEvent> events(
            UUID tenantId, UUID planId, UUID packageId) {
        requireTenant(tenantId);
        requirePackage(tenantId, planId, packageId, false);
        return repository.listEvents(tenantId, planId, packageId);
    }

    private WeighingEvent replay(
            UUID tenantId, UUID planId, UUID packageId, UUID commandId,
            String source, UUID scaleId, long actualWeightGrams, String reason,
            Instant occurredAt) {
        WeighingEvent event = repository.eventByCommand(tenantId, commandId).orElse(null);
        if (event == null) return null;
        if (!event.planId().equals(planId) || !event.packageId().equals(packageId)
                || !event.source().equals(source) || !Objects.equals(event.scaleId(), scaleId)
                || event.actualWeightGrams() != actualWeightGrams
                || !Objects.equals(event.overrideReason(), reason)
                || !event.occurredAt().equals(occurredAt)) {
            throw new ConflictException("Command id was reused with different weighing data");
        }
        return event;
    }

    private PackageWeighing requirePackage(
            UUID tenantId, UUID planId, UUID packageId, boolean forUpdate) {
        if (planId == null || packageId == null) {
            throw new ResourceNotFoundException("Fulfillment package was not found");
        }
        return repository.findPackage(tenantId, planId, packageId, forUpdate)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Fulfillment package was not found"));
    }

    private void validateMeasurement(
            UUID commandId, long actualWeightGrams, Instant occurredAt) {
        if (commandId == null || actualWeightGrams < 1
                || actualWeightGrams > 999999999L || occurredAt == null
                || occurredAt.isAfter(clock.instant().plusSeconds(300))) {
            throw new IllegalArgumentException("Weighing measurement is invalid");
        }
    }

    private static long ceilPercentage(long expectedGrams, int basisPoints) {
        return Math.addExact(Math.multiplyExact(expectedGrams, basisPoints), 9999L) / 10000L;
    }

    private void audit(
            Actor actor, String action, String resourceType, UUID resourceId,
            Map<String, String> details) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(), action,
                resourceType, resourceId.toString(), actor.requestId(),
                actor.sourceIp(), details));
    }

    private static void requireActor(Actor actor) {
        if (actor == null) throw new IllegalArgumentException("Actor is required");
        requireTenant(actor.tenantId());
        if ((actor.userId() == null) == (actor.systemAdminId() == null)
                || actor.requestId() == null
                || !actor.requestId().matches("^[A-Za-z0-9._:-]{1,100}$")) {
            throw new IllegalArgumentException("Actor identity is invalid");
        }
    }

    private static void requireTenant(UUID tenantId) {
        if (tenantId == null) throw new IllegalArgumentException("Tenant is required");
    }

    public record Actor(
            UUID tenantId,
            UUID userId,
            UUID systemAdminId,
            String requestId,
            String sourceIp) {
    }
}
