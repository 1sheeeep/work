package cn.xzkj.erp.logistics.matchingrule;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.service.ConflictException;
import java.time.Instant;
import java.time.LocalTime;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class MatchingRuleServiceTest {
    private static final UUID TENANT_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();
    private MatchingRuleRepository repository;
    private SecurityAuditRecorder audits;
    private MatchingRuleService service;

    @BeforeEach
    void setUp() {
        repository = mock(MatchingRuleRepository.class);
        audits = mock(SecurityAuditRecorder.class);
        service = new MatchingRuleService(repository, audits);
    }

    @Test
    void createsNormalizedRuleWithBlackoutWindowAndAudit() {
        when(repository.isEnabledChannel(TENANT_ID, "UAT Standard"))
                .thenReturn(true);
        when(repository.find(eq(TENANT_ID), any()))
                .thenAnswer(invocation -> record(invocation.getArgument(1)));

        MatchingRuleRecord created = service.create(actor(),
                new MatchingRuleService.RuleInput(
                        " UAT Shopify US Parcel ", 10, " Shopify ",
                        " UAT Store ", " UAT Standard ", " UAT Warehouse ",
                        true, LocalTime.of(22, 0), LocalTime.of(6, 0),
                        " UAT closed loop "));

        assertThat(created.name()).isEqualTo("UAT Shopify US Parcel");
        verify(repository).insert(any(), eq(TENANT_ID),
                eq(new MatchingRuleService.RuleInput(
                        "UAT Shopify US Parcel", 10, "Shopify", "UAT Store",
                        "UAT Standard", "UAT Warehouse", true,
                        LocalTime.of(22, 0), LocalTime.of(6, 0),
                        "UAT closed loop")), eq(actor()));
        verify(audits).recordAtomically(any());
    }

    @Test
    void rejectsAChannelThatHasNotBeenEnabledForUse() {
        when(repository.isEnabledChannel(TENANT_ID, "UAT Standard"))
                .thenReturn(false);

        assertThatThrownBy(() -> service.create(actor(),
                new MatchingRuleService.RuleInput(
                        "UAT Shopify US Parcel", 10, "Shopify",
                        "UAT Store", "UAT Standard", "UAT Warehouse",
                        true, null, null, null)))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("not enabled");
    }

    @Test
    void rejectsHalfSpecifiedBlackoutWindow() {
        assertThatThrownBy(() -> service.create(actor(),
                new MatchingRuleService.RuleInput(
                        "Rule", 10, null, null, "Channel", null,
                        true, LocalTime.of(22, 0), null, null)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("invalid");
    }

    @Test
    void archivesOnlyCurrentActiveVersion() {
        UUID id = UUID.randomUUID();
        when(repository.find(TENANT_ID, id)).thenReturn(record(id));
        when(repository.archive(TENANT_ID, id, 0, actor())).thenReturn(true);

        MatchingRuleRecord archived = service.archive(actor(), id, 0);

        assertThat(archived.id()).isEqualTo(id);
        verify(repository).archive(TENANT_ID, id, 0, actor());
        verify(audits).recordAtomically(any());
    }

    private static MatchingRuleService.Actor actor() {
        return new MatchingRuleService.Actor(
                TENANT_ID, USER_ID, null, "UAT Operator",
                "matching-rule-uat", "127.0.0.1");
    }

    private static MatchingRuleRecord record(UUID id) {
        Instant time = Instant.parse("2026-08-10T00:00:00Z");
        return new MatchingRuleRecord(
                id, "UAT Shopify US Parcel", 10, "Shopify", "UAT Store",
                "UAT Standard", "UAT Warehouse", true,
                LocalTime.of(22, 0), LocalTime.of(6, 0), "UAT closed loop",
                "ACTIVE", "UAT Operator", 0, time, time);
    }
}
