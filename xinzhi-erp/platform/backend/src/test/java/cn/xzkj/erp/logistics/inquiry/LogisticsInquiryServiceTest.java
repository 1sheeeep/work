package cn.xzkj.erp.logistics.inquiry;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.service.ConflictException;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class LogisticsInquiryServiceTest {
    private static final UUID TENANT_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();
    private LogisticsInquiryRepository repository;
    private SecurityAuditRecorder audits;
    private LogisticsInquiryService service;

    @BeforeEach
    void setUp() {
        repository = mock(LogisticsInquiryRepository.class);
        audits = mock(SecurityAuditRecorder.class);
        service = new LogisticsInquiryService(repository, audits);
    }

    @Test
    void createsNormalizedInquiryAndAuditsIt() {
        when(repository.find(eq(TENANT_ID), any())).thenAnswer(invocation ->
                record(invocation.getArgument(1), "BIDDING", 0));

        LogisticsInquiryRecord created = service.create(actor(), new LogisticsInquiryService.InquiryInput(
                " 中国深圳 ", " 美国本土 ", 120, new BigDecimal("360.5"),
                " 服装 ", " UAT 联系人 ", " +86 138 0000 0000 ", " UAT "));

        assertThat(created.status()).isEqualTo("BIDDING");
        verify(repository).insertInquiry(any(), eq(TENANT_ID),
                org.mockito.ArgumentMatchers.matches("LI-[0-9]{8}-[A-Z0-9]{6}"),
                eq(new LogisticsInquiryService.InquiryInput(
                        "中国深圳", "美国本土", 120, new BigDecimal("360.500"),
                        "服装", "UAT 联系人", "+86 138 0000 0000", "UAT")),
                eq(actor()));
        verify(audits).recordAtomically(any());
    }

    @Test
    void savesContactWithoutPuttingContactDataInAuditDetails() {
        var input = new LogisticsInquiryService.ContactInput(
                " UAT Contact ", " +86 138 0000 0000 ");
        var saved = new LogisticsInquiryContactRecord(
                "UAT Contact", "+86 138 0000 0000", 0,
                Instant.parse("2026-08-10T01:00:00Z"));
        when(repository.saveContact(TENANT_ID,
                new LogisticsInquiryService.ContactInput(
                        "UAT Contact", "+86 138 0000 0000"), null, actor()))
                .thenReturn(true);
        when(repository.contact(TENANT_ID)).thenReturn(saved);

        assertThat(service.saveContact(actor(), input, null)).isEqualTo(saved);

        ArgumentCaptor<SecurityAuditEvent> event =
                ArgumentCaptor.forClass(SecurityAuditEvent.class);
        verify(audits).recordAtomically(event.capture());
        assertThat(event.getValue().action())
                .isEqualTo("logistics.inquiry_contact.saved");
        assertThat(event.getValue().details()).isEmpty();
    }

    @Test
    void onlyOpenInquiryReceivesQuote() {
        UUID inquiryId = UUID.randomUUID();
        when(repository.find(TENANT_ID, inquiryId))
                .thenReturn(record(inquiryId, "BIDDING", 0));
        when(repository.insertQuote(any(), eq(TENANT_ID), eq(inquiryId),
                any(), eq(actor()))).thenReturn(false);

        assertThatThrownBy(() -> service.addQuote(actor(), inquiryId,
                new LogisticsInquiryService.QuoteInput(
                        "承运商", "标准专线", new BigDecimal("4.8"),
                        "usd", 8, null)))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("bidding");
    }

    @Test
    void completedInquiryCannotResume() {
        UUID inquiryId = UUID.randomUUID();
        when(repository.find(TENANT_ID, inquiryId))
                .thenReturn(record(inquiryId, "COMPLETED", 1));

        assertThatThrownBy(() -> service.transition(actor(), inquiryId, 1, "BIDDING"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("transition");
    }

    private static LogisticsInquiryService.Actor actor() {
        return new LogisticsInquiryService.Actor(TENANT_ID, USER_ID, null,
                "UAT Operator", "logistics-inquiry-uat", "127.0.0.1");
    }

    private static LogisticsInquiryRecord record(UUID id, String status, long version) {
        Instant time = Instant.parse("2026-08-10T01:00:00Z");
        return new LogisticsInquiryRecord(id, "LI-20260810-ABC123", "中国深圳",
                "美国本土", 120, new BigDecimal("360.500"), "服装",
                "UAT 联系人", "+86 138 0000 0000", status, "UAT", 0,
                time, "UAT Operator", version, time, time);
    }
}
