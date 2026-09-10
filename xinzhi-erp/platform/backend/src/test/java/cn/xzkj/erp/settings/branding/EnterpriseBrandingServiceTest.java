package cn.xzkj.erp.settings.branding;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;

@ExtendWith(MockitoExtension.class)
class EnterpriseBrandingServiceTest {
    private static final UUID TENANT_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();
    @Mock private EnterpriseBrandingRepository repository;
    @Mock private SecurityAuditRecorder auditRecorder;
    private EnterpriseBrandingService service;

    @BeforeEach
    void setUp() {
        service = new EnterpriseBrandingService(repository, auditRecorder);
    }

    @Test
    void storesValidWatermarkSettings() {
        when(repository.find(TENANT_ID)).thenReturn(empty(), configured(0));
        var input = new EnterpriseBrandingService.SettingsInput(true,
                true, true, true, false);

        service.saveSettings(actor(), 0, input);

        verify(repository).insertSettings(any(), any(), any());
        verify(auditRecorder).recordAtomically(any());
    }

    @Test
    void rejectsEnabledWatermarkWithoutContent() {
        assertThatThrownBy(() -> service.saveSettings(actor(), 0,
                new EnterpriseBrandingService.SettingsInput(true, false,
                        false, false, false)))
                .isInstanceOf(IllegalArgumentException.class);
        verify(repository, never()).insertSettings(any(), any(), any());
    }

    private static EnterpriseBrandingService.Actor actor() {
        return new EnterpriseBrandingService.Actor(TENANT_ID, USER_ID, null,
                "UAT Operator", "request-branding-1", "127.0.0.1");
    }

    private static EnterpriseBrandingRecord empty() {
        return new EnterpriseBrandingRecord(false, false,
                true, true, true, false, 0, null, null);
    }

    private static EnterpriseBrandingRecord configured(long version) {
        return new EnterpriseBrandingRecord(true, true, true, true,
                true, false, version, "UAT Operator",
                Instant.parse("2026-08-10T10:00:00Z"));
    }
}
