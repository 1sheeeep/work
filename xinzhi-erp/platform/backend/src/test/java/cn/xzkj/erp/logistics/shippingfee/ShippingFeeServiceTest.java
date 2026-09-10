package cn.xzkj.erp.logistics.shippingfee;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class ShippingFeeServiceTest {
    private static final UUID TENANT_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();
    private static final UUID REGION_ID = UUID.randomUUID();
    private static final UUID RULE_ID = UUID.randomUUID();
    private ShippingFeeRepository repository;
    private SecurityAuditRecorder audits;
    private ShippingFeeService service;

    @BeforeEach
    void setUp() {
        repository = mock(ShippingFeeRepository.class);
        audits = mock(SecurityAuditRecorder.class);
        service = new ShippingFeeService(repository, audits);
    }

    @Test
    void createsNormalizedRegionAndRecordsAudit() {
        when(repository.findRegion(eq(TENANT_ID), any()))
                .thenAnswer(invocation -> region(invocation.getArgument(1)));

        ShippingFeeRecords.Region created = service.createRegion(
                actor(), new ShippingFeeService.RegionInput(
                        " US West ", "us", " Los Angeles ", " 90 ",
                        " UAT rate region "));

        assertThat(created.countryCode()).isEqualTo("US");
        verify(repository).insertRegion(any(), eq(TENANT_ID),
                eq(new ShippingFeeService.RegionInput(
                        "US West", "US", "Los Angeles", "90",
                        "UAT rate region")), eq(actor()));
        verify(audits).recordAtomically(any());
    }

    @Test
    void calculatesMaximumWeightAndMinorUnitTotals() {
        ShippingFeeRecords.Rule rule = rule();
        when(repository.estimateCandidates(
                TENANT_ID, "US", "Los Angeles", "90001", 1_200))
                .thenReturn(List.of(rule));

        List<ShippingFeeService.EstimateResult> result = service.estimate(
                actor(), new ShippingFeeService.EstimateInput(
                        "us", "Los Angeles", "90001", 800,
                        300L, 200L, 100L, 5_000L, "MAXIMUM"));

        assertThat(result).containsExactly(new ShippingFeeService.EstimateResult(
                REGION_ID, "US West", RULE_ID, "Standard",
                800, 1_200, 1_200, 1_600, 100, 1_700, "USD"));
    }

    @Test
    void requiresDimensionsForVolumetricModes() {
        assertThatThrownBy(() -> service.estimate(
                actor(), new ShippingFeeService.EstimateInput(
                        "US", null, null, 800,
                        null, null, null, null, "MAXIMUM")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Dimensions");
    }

    private static ShippingFeeService.Actor actor() {
        return new ShippingFeeService.Actor(
                TENANT_ID, USER_ID, null, "UAT Operator",
                "shipping-fee-uat", "127.0.0.1");
    }

    private static ShippingFeeRecords.Region region(UUID id) {
        return new ShippingFeeRecords.Region(
                id, "US West", "US", "Los Angeles", "90",
                "UAT rate region", "ACTIVE", "UAT Operator", 0,
                Instant.parse("2026-08-10T00:00:00Z"),
                Instant.parse("2026-08-10T00:00:00Z"));
    }

    private static ShippingFeeRecords.Rule rule() {
        return new ShippingFeeRecords.Rule(
                RULE_ID, REGION_ID, "US West", "US", "Standard",
                0, 2_000L, 1_000, 500, 100, "USD", null,
                "ACTIVE", "UAT Operator", 0,
                Instant.parse("2026-08-10T00:00:00Z"),
                Instant.parse("2026-08-10T00:00:00Z"));
    }
}
