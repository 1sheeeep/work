package cn.xzkj.erp.logistics.trackingnumber;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.service.ConflictException;

@ExtendWith(MockitoExtension.class)
class TrackingNumberServiceTest {
    private static final UUID TENANT_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();
    private static final UUID NUMBER_ID = UUID.randomUUID();
    @Mock private TrackingNumberRepository repository;
    @Mock private SecurityAuditRecorder auditRecorder;
    private TrackingNumberService service;

    @BeforeEach
    void setUp() {
        service = new TrackingNumberService(repository, auditRecorder);
    }

    @Test
    void importsAnAtomicNormalizedBatchAndAuditsIt() {
        var result = service.importNumbers(actor(), "domestic_express", " SF ",
                List.of(" TN-1 ", "TN-2"));

        assertEquals(2, result.importedCount());
        verify(repository, times(2)).insert(any(), eq(TENANT_ID),
                eq(result.batchId()), eq("DOMESTIC_EXPRESS"), eq("SF"),
                any(), eq(USER_ID), eq(null), eq("request-1"));
        verify(auditRecorder).recordAtomically(any());
    }

    @Test
    void rejectsDuplicateInputBeforeWriting() {
        assertThrows(IllegalArgumentException.class, () -> service.importNumbers(
                actor(), "DOMESTIC_EXPRESS", "SF", List.of("TN-1", " TN-1 ")));
        verify(repository, never()).insert(any(), any(), any(), any(), any(),
                any(), any(), any(), any());
    }

    @Test
    void neverArchivesAUsedNumber() {
        when(repository.find(TENANT_ID, NUMBER_ID)).thenReturn(record("USED", 1));
        assertThrows(ConflictException.class,
                () -> service.archive(actor(), NUMBER_ID, 1));
        verify(repository, never()).archive(any(), any(), any(Long.class));
    }

    @Test
    void archivesOnlyTheExpectedUnusedVersion() {
        when(repository.find(TENANT_ID, NUMBER_ID))
                .thenReturn(record("UNUSED", 2), record("ARCHIVED", 3));
        when(repository.archive(TENANT_ID, NUMBER_ID, 2)).thenReturn(true);
        assertEquals("ARCHIVED", service.archive(actor(), NUMBER_ID, 2).status());
        verify(auditRecorder).recordAtomically(any());
    }

    private static TrackingNumberService.Actor actor() {
        return new TrackingNumberService.Actor(
                TENANT_ID, USER_ID, null, "request-1", "127.0.0.1");
    }
    private static TrackingNumberRecord record(String status, long version) {
        return new TrackingNumberRecord(
                NUMBER_ID, UUID.randomUUID(), "DOMESTIC_EXPRESS", "SF",
                "TN-1", status, "USED".equals(status) ? "ORDER-1" : null,
                "USED".equals(status) ? "PKG-1" : null,
                "USED".equals(status) ? Instant.parse("2026-08-07T00:00:00Z") : null,
                version, Instant.parse("2026-08-07T00:00:00Z"));
    }
}
