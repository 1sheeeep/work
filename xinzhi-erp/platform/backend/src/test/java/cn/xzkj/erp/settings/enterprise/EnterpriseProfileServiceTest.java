package cn.xzkj.erp.settings.enterprise;

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
class EnterpriseProfileServiceTest {
    private static final UUID TENANT_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();
    @Mock private EnterpriseProfileRepository repository;
    @Mock private SecurityAuditRecorder auditRecorder;
    private EnterpriseProfileService service;

    @BeforeEach
    void setUp() {
        service = new EnterpriseProfileService(repository, auditRecorder);
    }

    @Test
    void createsNormalizedProfileWithoutAuditingContactData() {
        when(repository.find(TENANT_ID)).thenReturn(
                record(false, 0, null),
                record(true, 0, "新知科技"));

        EnterpriseProfileRecord saved = service.save(actor(), 0, input());

        assertThat(saved.configured()).isTrue();
        ArgumentCaptor<EnterpriseProfileService.ProfileInput> value =
                ArgumentCaptor.forClass(EnterpriseProfileService.ProfileInput.class);
        verify(repository).insert(eq(TENANT_ID), value.capture(), eq(actor()));
        assertThat(value.getValue().companyName()).isEqualTo("新知科技");
        assertThat(value.getValue().contactEmail()).isEqualTo("ops@example.com");
        assertThat(value.getValue().province()).isNull();
        ArgumentCaptor<SecurityAuditEvent> audit =
                ArgumentCaptor.forClass(SecurityAuditEvent.class);
        verify(auditRecorder).recordAtomically(audit.capture());
        assertThat(audit.getValue().details())
                .containsOnlyKeys("created", "previousVersion");
        assertThat(audit.getValue().details().toString())
                .doesNotContain("ops@example.com", "+86 13800000000", "新知科技");
    }

    @Test
    void updatesOnlyTheExpectedVersion() {
        when(repository.find(TENANT_ID)).thenReturn(record(true, 3, "旧名称"));
        when(repository.update(eq(TENANT_ID), eq(3L), any(), eq(actor())))
                .thenReturn(false);

        assertThatThrownBy(() -> service.save(actor(), 3, input()))
                .isInstanceOf(ConflictException.class);
        verify(auditRecorder, never()).recordAtomically(any());
    }

    @Test
    void rejectsInvalidContactFieldsBeforeWriting() {
        var invalid = new EnterpriseProfileService.ProfileInput(
                "公司", null, null, null, null, "联系人",
                "not-an-email", "abc", "mobile", null);
        assertThatThrownBy(() -> service.save(actor(), 0, invalid))
                .isInstanceOf(IllegalArgumentException.class);
        verify(repository, never()).find(any());
    }

    @Test
    void readDoesNotRequireAMutationRequestId() {
        when(repository.find(TENANT_ID)).thenReturn(record(false, 0, null));
        var actor = new EnterpriseProfileService.Actor(
                TENANT_ID, USER_ID, null, null, "127.0.0.1");
        assertThat(service.get(actor).tenantCode()).isEqualTo("tenant-a");
    }

    private static EnterpriseProfileService.Actor actor() {
        return new EnterpriseProfileService.Actor(
                TENANT_ID, USER_ID, null, "request-1", "127.0.0.1");
    }

    private static EnterpriseProfileService.ProfileInput input() {
        return new EnterpriseProfileService.ProfileInput(
                " 新知科技 ", " ", "上海", "浦东新区", "世纪大道 1 号",
                " 张三 ", " OPS@EXAMPLE.COM ", "12345678",
                "+86 13800000000", "021-12345678");
    }

    private static EnterpriseProfileRecord record(
            boolean configured, long version, String companyName) {
        Instant time = configured ? Instant.parse("2026-08-07T00:00:00Z") : null;
        return new EnterpriseProfileRecord(
                "tenant-a", "Tenant A", configured, companyName, null,
                configured ? "上海" : null, configured ? "浦东新区" : null,
                configured ? "世纪大道 1 号" : null,
                configured ? "张三" : null,
                configured ? "ops@example.com" : null,
                configured ? "12345678" : null,
                configured ? "+86 13800000000" : null,
                configured ? "021-12345678" : null,
                version, time, time);
    }
}
