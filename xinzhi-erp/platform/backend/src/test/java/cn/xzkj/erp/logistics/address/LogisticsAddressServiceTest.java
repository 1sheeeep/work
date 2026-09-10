package cn.xzkj.erp.logistics.address;

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

import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.service.ConflictException;

@ExtendWith(MockitoExtension.class)
class LogisticsAddressServiceTest {
    private static final UUID TENANT_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();
    private static final UUID ADDRESS_ID = UUID.randomUUID();
    @Mock private LogisticsAddressRepository repository;
    @Mock private SecurityAuditRecorder auditRecorder;
    private LogisticsAddressService service;

    @BeforeEach
    void setUp() {
        service = new LogisticsAddressService(repository, auditRecorder);
    }

    @Test
    void createsNormalizedTenantAddressWithoutAuditingContactData() {
        when(repository.find(eq(TENANT_ID), any())).thenAnswer(invocation ->
                record(invocation.getArgument(1), "ACTIVE", 0));

        LogisticsAddressRecord created = service.create(actor(), input());

        ArgumentCaptor<LogisticsAddressService.AddressInput> value =
                ArgumentCaptor.forClass(LogisticsAddressService.AddressInput.class);
        verify(repository).insert(eq(created.id()), eq(TENANT_ID), value.capture(),
                eq(USER_ID), eq(null), eq("request-1"));
        assertThat(value.getValue().addressType()).isEqualTo("SHIPPING");
        assertThat(value.getValue().name()).isEqualTo("上海发货仓");
        assertThat(value.getValue().countryCode()).isEqualTo("CN");
        assertThat(value.getValue().contactEmail()).isEqualTo("ops@example.com");
        verify(auditRecorder).recordAtomically(any());
    }

    @Test
    void rejectsUnknownCountryBeforeWriting() {
        var invalid = new LogisticsAddressService.AddressInput(
                "SHIPPING", "地址", "联系人", null, "ZZ", null, null,
                null, "地址一", null, null, null, null, null);
        assertThatThrownBy(() -> service.create(actor(), invalid))
                .isInstanceOf(IllegalArgumentException.class);
        verify(repository, never()).insert(any(), any(), any(), any(), any(), any());
    }

    @Test
    void updateUsesExpectedVersionAndFailsClosedOnConflict() {
        when(repository.find(TENANT_ID, ADDRESS_ID))
                .thenReturn(record(ADDRESS_ID, "ACTIVE", 3));
        when(repository.update(eq(ADDRESS_ID), eq(TENANT_ID), eq(3L), any(),
                eq(USER_ID), eq(null), eq("request-1"))).thenReturn(false);

        assertThatThrownBy(() -> service.update(actor(), ADDRESS_ID, 3, input()))
                .isInstanceOf(ConflictException.class);
        verify(auditRecorder, never()).recordAtomically(any());
    }

    @Test
    void archivesOnlyAnActiveExpectedVersion() {
        when(repository.find(TENANT_ID, ADDRESS_ID)).thenReturn(
                record(ADDRESS_ID, "ACTIVE", 2),
                record(ADDRESS_ID, "ARCHIVED", 3));
        when(repository.archive(TENANT_ID, ADDRESS_ID, 2, USER_ID, null,
                "request-1")).thenReturn(true);

        assertThat(service.archive(actor(), ADDRESS_ID, 2).status())
                .isEqualTo("ARCHIVED");
        verify(auditRecorder).recordAtomically(any());
    }

    @Test
    void neverChangesAnArchivedAddress() {
        when(repository.find(TENANT_ID, ADDRESS_ID))
                .thenReturn(record(ADDRESS_ID, "ARCHIVED", 4));
        assertThatThrownBy(() -> service.update(actor(), ADDRESS_ID, 4, input()))
                .isInstanceOf(ConflictException.class);
        verify(repository, never()).update(any(), any(), any(Long.class), any(),
                any(), any(), any());
    }

    private static LogisticsAddressService.Actor actor() {
        return new LogisticsAddressService.Actor(
                TENANT_ID, USER_ID, null, "request-1", "127.0.0.1");
    }

    private static LogisticsAddressService.AddressInput input() {
        return new LogisticsAddressService.AddressInput(
                " shipping ", " 上海发货仓 ", " 运营联系人 ",
                " OPS@EXAMPLE.COM ", " cn ", " 上海市 ", " 上海市 ",
                " 浦东新区 ", " 世纪大道 1 号 ", " 200120 ", null,
                " +86 13800000000 ", " 新知科技 ", null);
    }

    private static LogisticsAddressRecord record(
            UUID id, String status, long version) {
        Instant time = Instant.parse("2026-08-07T00:00:00Z");
        return new LogisticsAddressRecord(
                id, "SHIPPING", "上海发货仓", "运营联系人",
                "ops@example.com", "CN", "上海市", "上海市", "浦东新区",
                "世纪大道 1 号", "200120", null, "+86 13800000000",
                "新知科技", null, status, version, time, time);
    }
}
