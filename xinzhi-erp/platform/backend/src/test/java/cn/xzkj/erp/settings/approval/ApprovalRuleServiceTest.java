package cn.xzkj.erp.settings.approval;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
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
class ApprovalRuleServiceTest {
    private static final UUID TENANT_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();
    private static final UUID APPROVER_A = UUID.randomUUID();
    private static final UUID APPROVER_B = UUID.randomUUID();

    @Mock private ApprovalRuleRepository repository;
    @Mock private SecurityAuditRecorder auditRecorder;
    private ApprovalRuleService service;

    @BeforeEach
    void setUp() {
        service = new ApprovalRuleService(repository, auditRecorder);
    }

    @Test
    void createsNormalizedRuleWithOrderedApproversAndAudit() {
        when(repository.find(any(), any())).thenAnswer(invocation ->
                Optional.of(record(invocation.getArgument(1), 0, true)));

        ApprovalRuleRecord created = service.create(actor(),
                new ApprovalRuleService.RuleDraft(2, " 采购单复核 ",
                        ApprovalRuleService.DocumentType.PROCUREMENT_ORDER,
                        " 提交后按顺序复核 ", true,
                        List.of(APPROVER_B, APPROVER_A)));

        ArgumentCaptor<ApprovalRuleService.RuleInput> input =
                ArgumentCaptor.forClass(ApprovalRuleService.RuleInput.class);
        verify(repository).insert(any(), any(), input.capture(), any());
        assertThat(input.getValue().name()).isEqualTo("采购单复核");
        assertThat(input.getValue().description()).isEqualTo("提交后按顺序复核");
        assertThat(input.getValue().approverUserIds())
                .containsExactly(APPROVER_B, APPROVER_A);
        assertThat(created.approvers()).extracting(ApprovalRuleRecord.Approver::userId)
                .containsExactly(APPROVER_B, APPROVER_A);

        ArgumentCaptor<SecurityAuditEvent> audit =
                ArgumentCaptor.forClass(SecurityAuditEvent.class);
        verify(auditRecorder).recordAtomically(audit.capture());
        assertThat(audit.getValue().details())
                .containsEntry("documentType", "PROCUREMENT_ORDER")
                .containsEntry("priority", "2")
                .containsEntry("approverCount", "2");
    }

    @Test
    void rejectsDuplicateApproversBeforeWriting() {
        assertThatThrownBy(() -> service.create(actor(),
                new ApprovalRuleService.RuleDraft(1, "采购审核",
                        ApprovalRuleService.DocumentType.PROCUREMENT_ORDER,
                        null, true, List.of(APPROVER_A, APPROVER_A))))
                .isInstanceOf(IllegalArgumentException.class);
        verify(repository, never()).insert(any(), any(), any(), any());
    }

    @Test
    void rejectsStaleStatusChange() {
        UUID id = UUID.randomUUID();
        when(repository.find(TENANT_ID, id)).thenReturn(Optional.of(record(id, 3, true)));
        when(repository.setEnabled(TENANT_ID, id, 2, false, actor())).thenReturn(false);

        assertThatThrownBy(() -> service.setEnabled(actor(), id, 2, false))
                .isInstanceOf(ConflictException.class);
        verify(auditRecorder, never()).recordAtomically(any());
    }

    private static ApprovalRuleService.Actor actor() {
        return new ApprovalRuleService.Actor(TENANT_ID, USER_ID, null,
                "UAT Operator", "request-approval-1", "127.0.0.1");
    }

    private static ApprovalRuleRecord record(UUID id, long version, boolean enabled) {
        Instant now = Instant.parse("2026-08-10T09:00:00Z");
        return new ApprovalRuleRecord(id, 2, "采购单复核",
                ApprovalRuleService.DocumentType.PROCUREMENT_ORDER,
                "提交后按顺序复核", enabled, List.of(
                        new ApprovalRuleRecord.Approver(APPROVER_B, "Reviewer B", 1),
                        new ApprovalRuleRecord.Approver(APPROVER_A, "Reviewer A", 2)),
                version, "UAT Operator", "UAT Operator", now, now);
    }
}
