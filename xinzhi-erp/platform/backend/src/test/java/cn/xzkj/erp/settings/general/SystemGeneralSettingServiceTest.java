package cn.xzkj.erp.settings.general;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.time.LocalTime;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;

@ExtendWith(MockitoExtension.class)
class SystemGeneralSettingServiceTest {
    private static final UUID TENANT_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();
    @Mock private SystemGeneralSettingRepository repository;
    @Mock private SecurityAuditRecorder auditRecorder;
    private SystemGeneralSettingService service;

    @BeforeEach
    void setUp() {
        service = new SystemGeneralSettingService(repository, auditRecorder);
    }

    @Test
    void savesTenantSettingsAndAuditsOnlyRuleValues() {
        when(repository.find(TENANT_ID)).thenReturn(
                record(false, "USD", null, null, 0),
                record(true, "CNY", LocalTime.of(23, 0),
                        LocalTime.of(6, 0), 0));

        SystemGeneralSettingRecord saved = service.save(actor(), 0, "CNY",
                LocalTime.of(23, 0), LocalTime.of(6, 0));

        assertThat(saved.defaultCurrency()).isEqualTo("CNY");
        verify(repository).insert(TENANT_ID, "CNY", LocalTime.of(23, 0),
                LocalTime.of(6, 0), actor());
        ArgumentCaptor<SecurityAuditEvent> audit =
                ArgumentCaptor.forClass(SecurityAuditEvent.class);
        verify(auditRecorder).recordAtomically(audit.capture());
        assertThat(audit.getValue().details())
                .containsEntry("defaultCurrency", "CNY")
                .containsEntry("orderPullBlackout", "23:00-06:00")
                .containsEntry("created", "true");
    }

    @Test
    void quietPeriodSupportsSameDayAndOvernightWindows() {
        when(repository.find(TENANT_ID)).thenReturn(
                record(true, "USD", LocalTime.of(2, 0),
                        LocalTime.of(4, 0), 0),
                record(true, "USD", LocalTime.of(23, 0),
                        LocalTime.of(6, 0), 0),
                record(true, "USD", LocalTime.of(23, 0),
                        LocalTime.of(6, 0), 0));

        assertThatThrownBy(() -> service.requireOrderPullAllowed(TENANT_ID,
                Instant.parse("2026-08-09T19:00:00Z")))
                .isInstanceOf(OrderPullBlackoutException.class);
        assertThatThrownBy(() -> service.requireOrderPullAllowed(TENANT_ID,
                Instant.parse("2026-08-09T16:00:00Z")))
                .isInstanceOf(OrderPullBlackoutException.class);
        service.requireOrderPullAllowed(TENANT_ID,
                Instant.parse("2026-08-10T05:00:00Z"));
    }

    @Test
    void rejectsInvalidCurrencyOrIncompleteWindowBeforeWriting() {
        assertThatThrownBy(() -> service.save(actor(), 0, "usd", null, null))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.save(actor(), 0, "USD",
                LocalTime.NOON, null))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.save(actor(), 0, "USD",
                LocalTime.NOON, LocalTime.NOON))
                .isInstanceOf(IllegalArgumentException.class);
        verify(repository, never()).find(any());
    }

    private static SystemGeneralSettingService.Actor actor() {
        return new SystemGeneralSettingService.Actor(
                TENANT_ID, USER_ID, null, "UAT Operator", "request-1",
                "127.0.0.1");
    }

    private static SystemGeneralSettingRecord record(boolean configured,
            String currency, LocalTime start, LocalTime end, long version) {
        Instant time = configured ? Instant.parse("2026-08-10T00:00:00Z") : null;
        return new SystemGeneralSettingRecord(configured, currency, start, end,
                version, configured ? "UAT Operator" : null, time, time);
    }
}
