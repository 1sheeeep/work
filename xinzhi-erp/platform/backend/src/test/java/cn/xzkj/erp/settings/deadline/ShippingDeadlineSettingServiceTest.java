package cn.xzkj.erp.settings.deadline;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.service.ConflictException;

@ExtendWith(MockitoExtension.class)
class ShippingDeadlineSettingServiceTest {
    private static final UUID TENANT_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();
    @Mock private ShippingDeadlineSettingRepository repository;
    @Mock private SecurityAuditRecorder auditRecorder;
    private ShippingDeadlineSettingService service;

    @BeforeEach
    void setUp() {
        service = new ShippingDeadlineSettingService(repository, auditRecorder);
    }

    @Test
    void createsVersionedTenantSettingAndAuditsOnlyRuleValues() {
        when(repository.find(TENANT_ID)).thenReturn(
                record(false, 3, 0), record(true, 5, 0));

        ShippingDeadlineSettingRecord saved = service.save(actor(), 0, 5);

        assertThat(saved.deadlineDays()).isEqualTo(5);
        verify(repository).insert(TENANT_ID, 5, actor());
        ArgumentCaptor<SecurityAuditEvent> audit =
                ArgumentCaptor.forClass(SecurityAuditEvent.class);
        verify(auditRecorder).recordAtomically(audit.capture());
        assertThat(audit.getValue().details()).containsEntry("previousDays", "3")
                .containsEntry("deadlineDays", "5")
                .containsEntry("created", "true");
    }

    @Test
    void staleVersionFailsBeforeAudit() {
        when(repository.find(TENANT_ID)).thenReturn(record(true, 3, 2));
        assertThatThrownBy(() -> service.save(actor(), 1, 4))
                .isInstanceOf(ConflictException.class);
        verify(repository, never()).update(any(), any(Long.class),
                any(Integer.class), any());
        verify(auditRecorder, never()).recordAtomically(any());
    }

    @Test
    void appliesTenantDefaultOnlyWhenSourceHasNoDeadline() {
        Instant baseline = Instant.parse("2026-08-10T00:00:00Z");
        Instant source = Instant.parse("2026-08-11T00:00:00Z");
        when(repository.deadlineDays(TENANT_ID)).thenReturn(5);

        assertThat(service.resolveShipByAt(TENANT_ID, baseline, null))
                .isEqualTo(Instant.parse("2026-08-15T00:00:00Z"));
        assertThat(service.resolveShipByAt(TENANT_ID, baseline, source))
                .isSameAs(source);
    }

    @Test
    void rejectsOutOfRangeValuesBeforeWriting() {
        assertThatThrownBy(() -> service.save(actor(), 0, 0))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.save(actor(), 0, 366))
                .isInstanceOf(IllegalArgumentException.class);
        verify(repository, never()).find(any());
    }

    private static ShippingDeadlineSettingService.Actor actor() {
        return new ShippingDeadlineSettingService.Actor(
                TENANT_ID, USER_ID, null, "UAT Operator", "request-1",
                "127.0.0.1");
    }

    private static ShippingDeadlineSettingRecord record(
            boolean configured, int days, long version) {
        Instant time = configured ? Instant.parse("2026-08-10T00:00:00Z") : null;
        return new ShippingDeadlineSettingRecord(configured, days, version,
                configured ? "UAT Operator" : null, time, time);
    }
}
