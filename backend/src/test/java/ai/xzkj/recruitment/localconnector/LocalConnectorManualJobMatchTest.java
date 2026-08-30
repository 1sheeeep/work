package ai.xzkj.recruitment.localconnector;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.auth.CurrentUserService;
import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.auth.UserRole;
import ai.xzkj.recruitment.autoreply.AutoReplyPolicyRepository;
import ai.xzkj.recruitment.boss.BossAccount;
import ai.xzkj.recruitment.boss.BossAccountRepository;
import ai.xzkj.recruitment.common.ApiException;
import ai.xzkj.recruitment.jobs.JobPosition;
import ai.xzkj.recruitment.jobs.JobPositionRepository;
import ai.xzkj.recruitment.jobs.JobPositionStatus;
import ai.xzkj.recruitment.organization.Company;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class LocalConnectorManualJobMatchTest {
    @Test void rejectsAJobFromAnotherRecruitmentAccount() {
        Fixture f = new Fixture();
        UUID observationId=UUID.randomUUID(),sourceAccountId=UUID.randomUUID(),otherAccountId=UUID.randomUUID(),jobId=UUID.randomUUID();
        BrowserUnreadObservation observation=f.observation(observationId,sourceAccountId,"前端开发工程师");
        JobPosition job=mock(JobPosition.class);BossAccount other=mock(BossAccount.class);
        when(job.getStatus()).thenReturn(JobPositionStatus.ACTIVE);when(job.getBossAccount()).thenReturn(other);when(other.getId()).thenReturn(otherAccountId);
        when(f.observations.findAllById(any())).thenReturn(List.of(observation));when(f.jobs.findWithDetailsById(jobId)).thenReturn(Optional.of(job));

        assertThatThrownBy(()->f.service.manualJobMatch(new ManualJobMatchRequest(List.of(observationId),jobId,"前端开发工程师","前端开发工程师",true)))
                .isInstanceOf(ApiException.class).hasMessageContaining("同一招聘账号");
        verify(observation,never()).manuallyMatchJob(any(),any(),any());
    }

    @Test void rejectsAnActiveJobWhoseKnowledgeIsNotApproved() {
        Fixture f = new Fixture();
        UUID observationId=UUID.randomUUID(),accountId=UUID.randomUUID(),jobId=UUID.randomUUID();
        BrowserUnreadObservation observation=f.observation(observationId,accountId,"前端开发工程师");
        JobPosition job=mock(JobPosition.class);BossAccount account=mock(BossAccount.class);Company company=mock(Company.class);
        when(job.getStatus()).thenReturn(JobPositionStatus.ACTIVE);when(job.getBossAccount()).thenReturn(account);when(account.getId()).thenReturn(accountId);
        when(job.getTitle()).thenReturn("前端开发工程师");when(job.getCompany()).thenReturn(company);when(job.getCaptureSource()).thenReturn("MANUAL");
        when(f.observations.findAllById(any())).thenReturn(List.of(observation));when(f.jobs.findWithDetailsById(jobId)).thenReturn(Optional.of(job));

        assertThatThrownBy(()->f.service.manualJobMatch(new ManualJobMatchRequest(List.of(observationId),jobId,"前端开发工程师","前端开发工程师",true)))
                .isInstanceOf(ApiException.class).hasMessageContaining("知识尚未完整审核");
        verify(observation,never()).manuallyMatchJob(any(),any(),any());
    }

    private static class Fixture {
        final BrowserUnreadObservationRepository observations=mock(BrowserUnreadObservationRepository.class);
        final JobPositionRepository jobs=mock(JobPositionRepository.class);
        final CurrentUserService users=mock(CurrentUserService.class);
        final LocalConnectorService service;

        Fixture(){
            SystemUser user=mock(SystemUser.class);when(user.getRole()).thenReturn(UserRole.SYSTEM_ADMIN);when(users.requireCurrentUser()).thenReturn(user);
            service=new LocalConnectorService(mock(BrowserDeviceRepository.class),mock(BrowserPairingCodeRepository.class),observations,
                    mock(LocalConnectorCapabilityRepository.class),mock(LocalConnectorActionTaskRepository.class),mock(LocalConnectorValidationCaseRepository.class),
                    mock(AutoReplyPolicyRepository.class),mock(BossAccountRepository.class),jobs,users,mock(AuditService.class));
        }

        BrowserUnreadObservation observation(UUID id,UUID accountId,String title){
            BrowserUnreadObservation item=mock(BrowserUnreadObservation.class);BossAccount account=mock(BossAccount.class);Company company=mock(Company.class);
            when(item.getId()).thenReturn(id);when(item.getAccount()).thenReturn(account);when(account.getId()).thenReturn(accountId);when(account.getCompany()).thenReturn(company);
            when(item.isUnread()).thenReturn(true);when(item.getDraftQualification()).thenReturn("JOB_UNMATCHED");when(item.getObservedJobTitle()).thenReturn(title);
            return item;
        }
    }
}
