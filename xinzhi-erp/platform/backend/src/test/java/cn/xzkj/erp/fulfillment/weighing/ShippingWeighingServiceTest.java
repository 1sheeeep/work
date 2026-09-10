package cn.xzkj.erp.fulfillment.weighing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import cn.xzkj.erp.fulfillment.weighing.ShippingConfigurationRecords.WeightTolerance;
import cn.xzkj.erp.fulfillment.weighing.ShippingWeighingRecords.PackageWeighing;
import cn.xzkj.erp.fulfillment.weighing.ShippingWeighingRecords.WeighingEvent;
import cn.xzkj.erp.fulfillment.weighing.ShippingWeighingRepository.ScaleIdentity;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.service.ConflictException;

class ShippingWeighingServiceTest {
    private static final UUID TENANT = UUID.fromString("10000000-0000-4000-8000-000000000001");
    private static final UUID USER = UUID.fromString("10000000-0000-4000-8000-000000000002");
    private static final UUID PLAN = UUID.fromString("10000000-0000-4000-8000-000000000003");
    private static final UUID PACKAGE = UUID.fromString("10000000-0000-4000-8000-000000000004");
    private static final UUID WAREHOUSE = UUID.fromString("10000000-0000-4000-8000-000000000005");
    private static final UUID SCALE = UUID.fromString("10000000-0000-4000-8000-000000000006");
    private static final UUID COMMAND = UUID.fromString("10000000-0000-4000-8000-000000000007");
    private static final Instant NOW = Instant.parse("2026-08-07T08:00:00Z");

    private ShippingWeighingRepository repository;
    private ShippingWeighingService service;
    private ShippingWeighingService.Actor actor;

    @BeforeEach
    void setUp() {
        repository = mock(ShippingWeighingRepository.class);
        service = new ShippingWeighingService(repository,
                mock(SecurityAuditRecorder.class),
                Clock.fixed(NOW, ZoneOffset.UTC));
        actor = new ShippingWeighingService.Actor(
                TENANT, USER, null, "request-1", "127.0.0.1");
    }

    @Test
    void passesMeasurementInsideGreaterOfAbsoluteAndPercentageTolerance() {
        when(repository.findPackage(TENANT, PLAN, PACKAGE, true))
                .thenReturn(Optional.of(packageState(1000L, 3L)));
        when(repository.activeScale(TENANT, WAREHOUSE, SCALE))
                .thenReturn(Optional.of(new ScaleIdentity(SCALE, "SCALE-1")));
        when(repository.effectiveTolerance(TENANT, WAREHOUSE))
                .thenReturn(new WeightTolerance(20, 300, false));
        WeighingEvent saved = event("PASSED", 1030, 30L, 30L, null);
        when(repository.record(eq(TENANT), eq(PLAN), eq(PACKAGE), eq(3L),
                eq(COMMAND), eq(SCALE), eq("SCALE"), eq(1000L), eq(1030L),
                eq(30L), eq(30L), eq("PASSED"), eq(null), eq(NOW),
                eq(USER), eq(null), eq("request-1"))).thenReturn(saved);

        assertEquals("PASSED", service.weigh(
                actor, PLAN, PACKAGE, 3, COMMAND, SCALE, 1030, NOW).result());
    }

    @Test
    void blocksMeasurementOutsideToleranceWithoutCreatingHandoverFact() {
        when(repository.findPackage(TENANT, PLAN, PACKAGE, true))
                .thenReturn(Optional.of(packageState(1000L, 3L)));
        when(repository.activeScale(TENANT, WAREHOUSE, SCALE))
                .thenReturn(Optional.of(new ScaleIdentity(SCALE, "SCALE-1")));
        when(repository.effectiveTolerance(TENANT, WAREHOUSE))
                .thenReturn(new WeightTolerance(30, 300, false));
        when(repository.record(any(), any(), any(), eq(3L), any(), any(),
                eq("SCALE"), eq(1000L), eq(1040L), eq(30L), eq(40L),
                eq("BLOCKED"), eq(null), any(), any(), any(), any()))
                .thenReturn(event("BLOCKED", 1040, 30L, 40L, null));

        assertEquals("BLOCKED", service.weigh(
                actor, PLAN, PACKAGE, 3, COMMAND, SCALE, 1040, NOW).result());
    }

    @Test
    void allowsReasonedManualOverrideWhenSkuWeightIsMissing() {
        when(repository.findPackage(TENANT, PLAN, PACKAGE, true))
                .thenReturn(Optional.of(packageState(null, 5L)));
        when(repository.record(any(), any(), any(), eq(5L), any(), eq(null),
                eq("MANUAL"), eq(null), eq(750L), eq(null), eq(null),
                eq("OVERRIDDEN"), eq("Scale unavailable"), any(), any(), any(), any()))
                .thenReturn(event("OVERRIDDEN", 750, null, null,
                        "Scale unavailable"));

        assertEquals("OVERRIDDEN", service.override(actor, PLAN, PACKAGE, 5,
                COMMAND, 750, NOW, " Scale unavailable ").result());
    }

    @Test
    void rejectsACommandReplayWithDifferentMeasurement() {
        when(repository.eventByCommand(TENANT, COMMAND)).thenReturn(Optional.of(
                event("PASSED", 1000, 30L, 0L, null)));

        assertThrows(ConflictException.class, () -> service.weigh(
                actor, PLAN, PACKAGE, 3, COMMAND, SCALE, 1001, NOW));
        verify(repository).eventByCommand(TENANT, COMMAND);
    }

    private static PackageWeighing packageState(Long expected, long version) {
        return new PackageWeighing(
                PLAN, PACKAGE, WAREHOUSE, "PKG-1", "SEALED", version,
                UUID.fromString("10000000-0000-4000-8000-000000000008"),
                "BOX-S", "Small box", 50L, expected, null, null, null,
                expected == null ? "MISSING_WEIGHT" : "PENDING",
                null, null, null);
    }

    private static WeighingEvent event(
            String result, long actual, Long tolerance, Long difference,
            String reason) {
        return new WeighingEvent(
                UUID.fromString("10000000-0000-4000-8000-000000000009"),
                PLAN, PACKAGE, COMMAND, reason == null ? SCALE : null,
                reason == null ? "SCALE" : "MANUAL", 1000L, actual,
                tolerance, difference, result, reason, NOW, NOW);
    }
}
