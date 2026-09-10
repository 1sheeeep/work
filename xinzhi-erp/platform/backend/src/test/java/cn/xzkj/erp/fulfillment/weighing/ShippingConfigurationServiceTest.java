package cn.xzkj.erp.fulfillment.weighing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import cn.xzkj.erp.fulfillment.weighing.ShippingConfigurationRecords.PackagingRule;
import cn.xzkj.erp.fulfillment.weighing.ShippingConfigurationRecords.PackagingTemplate;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.service.ConflictException;

@ExtendWith(MockitoExtension.class)
class ShippingConfigurationServiceTest {
    private static final UUID TENANT_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();
    private static final UUID SKU_ID = UUID.randomUUID();
    private static final UUID RULE_ID = UUID.randomUUID();
    private static final UUID TEMPLATE_ID = UUID.randomUUID();

    @Mock private ShippingConfigurationRepository repository;
    @Mock private SecurityAuditRecorder auditRecorder;
    private ShippingConfigurationService service;

    @BeforeEach
    void setUp() {
        service = new ShippingConfigurationService(repository, auditRecorder);
        when(repository.skuExists(TENANT_ID, SKU_ID)).thenReturn(true);
    }

    @Test
    void updatesAnActiveRuleWithOptimisticVersionAndSelfExclusion() {
        PackagingRule current = rule(2, 1, 5, "ACTIVE", TEMPLATE_ID);
        PackagingRule updated = rule(3, 2, 8, "ACTIVE", TEMPLATE_ID);
        when(repository.findRule(TENANT_ID, SKU_ID, RULE_ID))
                .thenReturn(Optional.of(current));
        when(repository.findTemplate(TENANT_ID, TEMPLATE_ID))
                .thenReturn(Optional.of(template("ACTIVE")));
        when(repository.overlapsActiveRule(
                TENANT_ID, SKU_ID, 2, 8, RULE_ID)).thenReturn(false);
        when(repository.updateRule(TENANT_ID, SKU_ID, RULE_ID, 2,
                2, 8, TEMPLATE_ID, "ACTIVE"))
                .thenReturn(Optional.of(updated));

        PackagingRule result = service.updateRule(actor(), SKU_ID, RULE_ID,
                2, 2, 8, TEMPLATE_ID, "active");

        assertEquals(updated, result);
        verify(repository).overlapsActiveRule(
                TENANT_ID, SKU_ID, 2, 8, RULE_ID);
        verify(auditRecorder).recordAtomically(any());
    }

    @Test
    void rejectsAnOverlappingActiveRangeBeforeWriting() {
        when(repository.findRule(TENANT_ID, SKU_ID, RULE_ID))
                .thenReturn(Optional.of(rule(2, 1, 5, "ACTIVE", TEMPLATE_ID)));
        when(repository.findTemplate(TENANT_ID, TEMPLATE_ID))
                .thenReturn(Optional.of(template("ACTIVE")));
        when(repository.overlapsActiveRule(
                TENANT_ID, SKU_ID, 4, 9, RULE_ID)).thenReturn(true);

        assertThrows(ConflictException.class, () -> service.updateRule(
                actor(), SKU_ID, RULE_ID, 2, 4, 9, TEMPLATE_ID, "ACTIVE"));

        verify(repository, never()).updateRule(any(), any(), any(),
                anyLong(), anyInt(), anyInt(),
                any(), any());
    }

    @Test
    void allowsDeactivationWhenTheReferencedTemplateIsInactive() {
        PackagingRule current = rule(2, 1, 5, "ACTIVE", TEMPLATE_ID);
        PackagingRule updated = rule(3, 1, 5, "INACTIVE", TEMPLATE_ID);
        when(repository.findRule(TENANT_ID, SKU_ID, RULE_ID))
                .thenReturn(Optional.of(current));
        when(repository.findTemplate(TENANT_ID, TEMPLATE_ID))
                .thenReturn(Optional.of(template("INACTIVE")));
        when(repository.updateRule(TENANT_ID, SKU_ID, RULE_ID, 2,
                1, 5, TEMPLATE_ID, "INACTIVE"))
                .thenReturn(Optional.of(updated));

        assertEquals(updated, service.updateRule(actor(), SKU_ID, RULE_ID,
                2, 1, 5, TEMPLATE_ID, "INACTIVE"));
        verify(repository, never()).overlapsActiveRule(
                any(), any(), anyInt(), anyInt(), any());
    }

    @Test
    void failsClosedWhenTheRuleVersionChanged() {
        when(repository.findRule(TENANT_ID, SKU_ID, RULE_ID))
                .thenReturn(Optional.of(rule(2, 1, 5, "ACTIVE", TEMPLATE_ID)));
        when(repository.findTemplate(TENANT_ID, TEMPLATE_ID))
                .thenReturn(Optional.of(template("ACTIVE")));
        when(repository.updateRule(TENANT_ID, SKU_ID, RULE_ID, 2,
                1, 5, TEMPLATE_ID, "ACTIVE"))
                .thenReturn(Optional.empty());

        assertThrows(ConflictException.class, () -> service.updateRule(
                actor(), SKU_ID, RULE_ID, 2, 1, 5, TEMPLATE_ID, "ACTIVE"));
        verify(auditRecorder, never()).recordAtomically(any());
    }

    private static ShippingConfigurationService.Actor actor() {
        return new ShippingConfigurationService.Actor(
                TENANT_ID, USER_ID, null, "request-1", "127.0.0.1");
    }

    private static PackagingTemplate template(String status) {
        return new PackagingTemplate(TEMPLATE_ID, "BOX_S", "Small box",
                "BOX", 50, null, null, null, status, 1,
                Instant.parse("2026-08-07T08:00:00Z"));
    }

    private static PackagingRule rule(
            long version, int minimum, int maximum, String status,
            UUID templateId) {
        return new PackagingRule(RULE_ID, SKU_ID, minimum, maximum,
                templateId, "BOX_S", "Small box", status, version,
                Instant.parse("2026-08-07T08:00:00Z"));
    }
}
