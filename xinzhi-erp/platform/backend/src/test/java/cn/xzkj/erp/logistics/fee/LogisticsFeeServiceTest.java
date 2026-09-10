package cn.xzkj.erp.logistics.fee;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.service.ConflictException;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class LogisticsFeeServiceTest {
    private static final UUID TENANT_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();
    private LogisticsFeeRepository repository;
    private SecurityAuditRecorder audits;
    private LogisticsFeeService service;

    @BeforeEach
    void setUp() {
        repository = mock(LogisticsFeeRepository.class);
        audits = mock(SecurityAuditRecorder.class);
        service = new LogisticsFeeService(repository, audits);
    }

    @Test
    void createsNormalizedFeeRecordAndKeepsOriginalCurrency() {
        when(repository.find(eq(TENANT_ID), any()))
                .thenAnswer(invocation -> record(invocation.getArgument(1),
                        new BigDecimal("24.0000"), new BigDecimal("25.4000"),
                        "UNCONFIRMED", "ACTIVE", 0));

        LogisticsFeeRecord created = service.create(actor(), input(
                new BigDecimal("24"), new BigDecimal("25.4"), " usd "));

        assertThat(created.feeVariance()).isEqualByComparingTo("1.4000");
        verify(repository).insert(any(), eq(TENANT_ID), eq(new LogisticsFeeService.FeeInput(
                "Shopify", "UAT Shop", "UAT Standard", "UAT-ORDER-001",
                "UAT-TRACK-001", "UAT-TX-001", new BigDecimal("24.0000"),
                new BigDecimal("25.4000"), "USD", new BigDecimal("2.600"),
                new BigDecimal("2.500"), LocalDate.of(2026, 8, 10), "UAT")),
                eq(actor()));
        verify(audits).recordAtomically(any());
    }

    @Test
    void confirmationRequiresAnActualFee() {
        UUID id = UUID.randomUUID();
        when(repository.find(TENANT_ID, id)).thenReturn(record(id,
                new BigDecimal("24.0000"), null, "UNCONFIRMED", "ACTIVE", 0));

        assertThatThrownBy(() -> service.confirm(actor(), id, 0))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("actual fee");
    }

    private static LogisticsFeeService.Actor actor() {
        return new LogisticsFeeService.Actor(TENANT_ID, USER_ID, null,
                "UAT Operator", "logistics-fee-uat", "127.0.0.1");
    }

    private static LogisticsFeeService.FeeInput input(BigDecimal estimated,
            BigDecimal actual, String currency) {
        return new LogisticsFeeService.FeeInput(
                " Shopify ", " UAT Shop ", " UAT Standard ",
                " UAT-ORDER-001 ", " UAT-TRACK-001 ", " UAT-TX-001 ",
                estimated, actual, currency, new BigDecimal("2.6"),
                new BigDecimal("2.5"), LocalDate.of(2026, 8, 10), " UAT ");
    }

    private static LogisticsFeeRecord record(UUID id, BigDecimal estimated,
            BigDecimal actual, String confirmation, String lifecycle, long version) {
        Instant time = Instant.parse("2026-08-10T00:00:00Z");
        return new LogisticsFeeRecord(id, "Shopify", "UAT Shop", "UAT Standard",
                "UAT-ORDER-001", "UAT-TRACK-001", "UAT-TX-001", estimated,
                actual, "USD", new BigDecimal("2.600"), new BigDecimal("2.500"),
                LocalDate.of(2026, 8, 10), confirmation, lifecycle, "UAT",
                null, null, "UAT Operator", version, time, time);
    }
}
