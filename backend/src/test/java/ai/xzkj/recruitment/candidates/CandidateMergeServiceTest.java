package ai.xzkj.recruitment.candidates;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.auth.CurrentUserService;
import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.auth.UserRole;
import ai.xzkj.recruitment.organization.Company;
import ai.xzkj.recruitment.organization.GroupProfile;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class CandidateMergeServiceTest {
    @Test
    void mergeMarksAliasesAndCreatesAuditedOperation() {
        CandidateProfileRepository profiles = mock(CandidateProfileRepository.class);
        CandidateMergeOperationRepository operations = mock(CandidateMergeOperationRepository.class);
        CandidateMergeItemRepository items = mock(CandidateMergeItemRepository.class);
        CurrentUserService users = mock(CurrentUserService.class);
        AuditService audit = mock(AuditService.class);
        CandidateMergeService service = new CandidateMergeService(profiles, operations, items, users, audit);
        Company company = new Company(new GroupProfile("集团", "G"), "企业", "C", null, null);
        CandidateProfile primary = new CandidateProfile(company, CandidateSource.BOSS, "a".repeat(64), "张三", null, null, null, null);
        CandidateProfile alias = new CandidateProfile(company, CandidateSource.MANUAL, "b".repeat(64), "张三", null, null, null, null);
        SystemUser admin = new SystemUser("admin", "hash", "管理员", UserRole.SYSTEM_ADMIN);
        when(users.requireCurrentUser()).thenReturn(admin);
        when(profiles.findById(primary.getId())).thenReturn(Optional.of(primary));
        when(profiles.findById(alias.getId())).thenReturn(Optional.of(alias));
        when(operations.save(any(CandidateMergeOperation.class))).thenAnswer(invocation -> invocation.getArgument(0));

        CandidateMergeOperationResponse result = service.merge(new CandidateMergeRequest(primary.getId(), List.of(alias.getId())));

        assertThat(result.status()).isEqualTo("ACTIVE");
        assertThat(result.primaryCandidateId()).isEqualTo(primary.getId());
        assertThat(alias.getMergedIntoId()).isEqualTo(primary.getId());
        verify(items).save(any(CandidateMergeItem.class));
        verify(audit).success(eq("MERGE_TALENT_CANDIDATES"), eq("CANDIDATE_PROFILE"), eq(primary.getId()), any(), any());
    }

    @Test
    void undoRestoresAliasAndMarksOperationUndone() {
        CandidateProfileRepository profiles = mock(CandidateProfileRepository.class);
        CandidateMergeOperationRepository operations = mock(CandidateMergeOperationRepository.class);
        CandidateMergeItemRepository items = mock(CandidateMergeItemRepository.class);
        CurrentUserService users = mock(CurrentUserService.class);
        AuditService audit = mock(AuditService.class);
        CandidateMergeService service = new CandidateMergeService(profiles, operations, items, users, audit);
        Company company = new Company(new GroupProfile("集团", "G"), "企业", "C", null, null);
        CandidateProfile primary = new CandidateProfile(company, CandidateSource.BOSS, "a".repeat(64), "张三", null, null, null, null);
        CandidateProfile alias = new CandidateProfile(company, CandidateSource.MANUAL, "b".repeat(64), "张三", null, null, null, null);
        SystemUser admin = new SystemUser("admin", "hash", "管理员", UserRole.SYSTEM_ADMIN);
        alias.markMerged(primary.getId(), admin, java.time.Instant.now());
        CandidateMergeOperation operation = new CandidateMergeOperation(company, primary, admin, java.time.Instant.now());
        CandidateMergeItem item = new CandidateMergeItem(operation, alias, primary);
        when(users.requireCurrentUser()).thenReturn(admin);
        when(operations.findByIdAndStatus(operation.getId(), "ACTIVE")).thenReturn(Optional.of(operation));
        when(items.findByOperationId(operation.getId())).thenReturn(List.of(item));

        CandidateMergeOperationResponse result = service.undo(operation.getId());

        assertThat(result.status()).isEqualTo("UNDONE");
        assertThat(alias.isMerged()).isFalse();
        assertThat(operation.getUndoneAt()).isNotNull();
        verify(audit).success(eq("UNDO_TALENT_CANDIDATE_MERGE"), eq("CANDIDATE_MERGE_OPERATION"), eq(operation.getId()), any(), any());
    }
}
