package cn.xzkj.erp.settings.exception;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
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
class OrderExceptionCategoryServiceTest {
    private static final UUID TENANT_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();
    @Mock private OrderExceptionCategoryRepository repository;
    @Mock private SecurityAuditRecorder auditRecorder;
    private OrderExceptionCategoryService service;

    @BeforeEach
    void setUp() {
        service = new OrderExceptionCategoryService(repository, auditRecorder);
    }

    @Test
    void normalizesAndSavesOrderedCategoriesWithAudit() {
        when(repository.find(TENANT_ID)).thenReturn(empty(), saved());
        service.save(actor(), 0, List.of(
                new OrderExceptionCategoryService.CategoryDraft(null,
                        " 地址信息待确认 ", " 联系客户核对地址 ", true),
                new OrderExceptionCategoryService.CategoryDraft(null,
                        "库存待确认", null, false)));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<OrderExceptionCategoryService.CategoryInput>> items =
                ArgumentCaptor.forClass(List.class);
        verify(repository).insertSet(TENANT_ID, actor());
        verify(repository).replaceItems(any(), items.capture(), any());
        assertThat(items.getValue()).hasSize(2);
        assertThat(items.getValue().get(0).name()).isEqualTo("地址信息待确认");
        assertThat(items.getValue().get(0).handlingGuidance())
                .isEqualTo("联系客户核对地址");
        assertThat(items.getValue().get(1).enabled()).isFalse();
        ArgumentCaptor<SecurityAuditEvent> audit =
                ArgumentCaptor.forClass(SecurityAuditEvent.class);
        verify(auditRecorder).recordAtomically(audit.capture());
        assertThat(audit.getValue().details())
                .containsEntry("categoryCount", "2")
                .containsEntry("enabledCount", "1");
    }

    @Test
    void rejectsDuplicateNamesBeforeWriting() {
        assertThatThrownBy(() -> service.save(actor(), 0, List.of(
                new OrderExceptionCategoryService.CategoryDraft(null,
                        "Address Review", null, true),
                new OrderExceptionCategoryService.CategoryDraft(null,
                        " address review ", null, true))))
                .isInstanceOf(IllegalArgumentException.class);
        verify(repository, never()).replaceItems(any(), any(), any());
    }

    private static OrderExceptionCategoryService.Actor actor() {
        return new OrderExceptionCategoryService.Actor(TENANT_ID, USER_ID, null,
                "UAT Operator", "request-1", "127.0.0.1");
    }

    private static OrderExceptionCategoryRecord empty() {
        return new OrderExceptionCategoryRecord(false, 0, null, null, null,
                List.of());
    }

    private static OrderExceptionCategoryRecord saved() {
        Instant now = Instant.parse("2026-08-10T08:00:00Z");
        return new OrderExceptionCategoryRecord(true, 0, "UAT Operator", now,
                now, List.of(new OrderExceptionCategoryRecord.Category(
                        UUID.randomUUID(), "地址信息待确认", "联系客户核对地址",
                        true, 0, now, now)));
    }
}
