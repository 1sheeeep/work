package cn.xzkj.erp.logistics.forecast;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.service.ConflictException;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class LogisticsForecastBatchServiceTest {
    private static final UUID TENANT_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();
    private LogisticsForecastBatchRepository repository;
    private SecurityAuditRecorder audits;
    private LogisticsForecastBatchService service;

    @BeforeEach
    void setUp() {
        repository = mock(LogisticsForecastBatchRepository.class);
        audits = mock(SecurityAuditRecorder.class);
        service = new LogisticsForecastBatchService(repository, audits);
    }

    @Test
    void createsPendingBatchWithNormalizedUniqueOrders() {
        when(repository.find(eq(TENANT_ID), any()))
                .thenAnswer(invocation -> record(invocation.getArgument(1),
                        "PENDING", false, 0));

        LogisticsForecastBatchRecord created = service.create(actor(),
                new LogisticsForecastBatchService.BatchInput(
                        " UAT Daily ", " UAT Forwarder ",
                        List.of("UAT-ORDER-001", " UAT-ORDER-001 ",
                                "UAT-ORDER-002"),
                        new BigDecimal("2.500")));

        assertThat(created.status()).isEqualTo("PENDING");
        verify(repository).insert(any(), eq(TENANT_ID), anyString(),
                eq(new LogisticsForecastBatchService.BatchInput(
                        "UAT Daily", "UAT Forwarder",
                        List.of("UAT-ORDER-001", "UAT-ORDER-002"),
                        new BigDecimal("2.500"))), eq(actor()));
        verify(audits).recordAtomically(any());
    }

    @Test
    void failedResultRequiresMessage() {
        UUID id = UUID.randomUUID();
        when(repository.find(TENANT_ID, id))
                .thenReturn(record(id, "PENDING", false, 0));

        assertThatThrownBy(() -> service.updateStatus(
                actor(), id, 0, "FAILED", null))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("transition is invalid");
    }

    private static LogisticsForecastBatchService.Actor actor() {
        return new LogisticsForecastBatchService.Actor(
                TENANT_ID, USER_ID, null, "UAT Operator",
                "forecast-batch-uat", "127.0.0.1");
    }

    private static LogisticsForecastBatchRecord record(UUID id, String status,
            boolean printed, long version) {
        Instant time = Instant.parse("2026-08-10T00:00:00Z");
        return new LogisticsForecastBatchRecord(id,
                "FB-20260810-000000-ABC123", "UAT Daily", "UAT Forwarder",
                List.of("UAT-ORDER-001", "UAT-ORDER-002"), 2,
                new BigDecimal("2.500"), status, printed, null,
                "UAT Operator", version, time, time);
    }
}
