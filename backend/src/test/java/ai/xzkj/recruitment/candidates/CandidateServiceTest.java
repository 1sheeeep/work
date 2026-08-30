package ai.xzkj.recruitment.candidates;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.autoreply.AutoReplyAttemptRepository;
import ai.xzkj.recruitment.auth.CurrentUserService;
import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.auth.UserRole;
import ai.xzkj.recruitment.boss.*;
import ai.xzkj.recruitment.common.ApiException;
import ai.xzkj.recruitment.jobs.JobPosition;
import ai.xzkj.recruitment.jobs.JobPositionRepository;
import ai.xzkj.recruitment.jobs.JobPositionStatus;
import ai.xzkj.recruitment.organization.Company;
import ai.xzkj.recruitment.organization.GroupProfile;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class CandidateServiceTest {
    @Mock CandidateProfileRepository profileRepository;
    @Mock CandidateJobContactRepository contactRepository;
    @Mock ScreeningDecisionRepository decisionRepository;
    @Mock ConversationMessageRepository messageRepository;
    @Mock JobPositionRepository jobRepository;
    @Mock CurrentUserService currentUserService;
    @Mock AuditService auditService;
    @Mock AutoReplyAttemptRepository autoReplyAttemptRepository;
    CandidateService service;
    Company company; BossAccount account; JobPosition job; CandidateProfile profile;
    CandidateJobContact contact; SystemUser recruiter;

    @BeforeEach void setUp() {
        service = new CandidateService(profileRepository, contactRepository, decisionRepository, messageRepository,
                jobRepository, currentUserService, auditService, autoReplyAttemptRepository);
        company = new Company(new GroupProfile("测试集团", "测试"), "测试企业", "TEST", null, null);
        account = new BossAccount(company, "全能力账号", "boss-full");
        account.applyCapabilityCheck(BossConnectionStatus.CONNECTED, Set.of(BossCapability.JOB_SYNC,
                BossCapability.CANDIDATE_READ, BossCapability.MESSAGE_SEND));
        job = new JobPosition(company, account, "Java 开发", "上海", 20, 30, 13, "3 年", "本科", "JD", "Spring");
        job.changeStatus(JobPositionStatus.ACTIVE);
        profile = new CandidateProfile(company, CandidateSource.BOSS, "a".repeat(64), "张三", "Java 开发", 5, "本科", "Spring");
        contact = new CandidateJobContact(profile, job, account);
        recruiter = new SystemUser("recruiter", "hash", "招聘专员", UserRole.RECRUITER);
        recruiter.assignCompanyScopes(Set.of(company));
    }

    @Test void createsCandidateWithHashedDedupAndSeparateDecisions() {
        when(currentUserService.requireCurrentUser()).thenReturn(recruiter);
        when(jobRepository.findWithDetailsById(job.getId())).thenReturn(Optional.of(job));
        when(profileRepository.findByCompanyIdAndSourceAndDedupKey(eq(company.getId()), eq(CandidateSource.BOSS), any())).thenReturn(Optional.empty());
        when(profileRepository.save(any())).thenAnswer(i -> i.getArgument(0));
        when(contactRepository.findByCandidateIdAndJobPositionId(any(), eq(job.getId()))).thenReturn(Optional.empty());
        when(contactRepository.save(any())).thenAnswer(i -> i.getArgument(0));
        when(decisionRepository.findByContactIdOrderByCreatedAtDesc(any())).thenReturn(List.of());

        CandidateCreateResponse response = service.create(request());

        assertThat(response.replayed()).isFalse();
        assertThat(response.candidate().status()).isEqualTo(CandidateContactStatus.QUALIFIED);
        verify(decisionRepository, times(2)).save(any());
    }

    @Test void repeatsExistingCandidateJobContactWithoutNewScreeningRecords() {
        when(currentUserService.requireCurrentUser()).thenReturn(recruiter);
        when(jobRepository.findWithDetailsById(job.getId())).thenReturn(Optional.of(job));
        when(profileRepository.findByCompanyIdAndSourceAndDedupKey(eq(company.getId()), eq(CandidateSource.BOSS), any())).thenReturn(Optional.of(profile));
        when(contactRepository.findByCandidateIdAndJobPositionId(profile.getId(), job.getId())).thenReturn(Optional.of(contact));
        when(contactRepository.findWithDetailsById(contact.getId())).thenReturn(Optional.of(contact));
        when(decisionRepository.findByContactIdOrderByCreatedAtDesc(contact.getId())).thenReturn(List.of());

        assertThat(service.create(request()).replayed()).isTrue();
        verify(decisionRepository, never()).save(any());
    }

    private CandidateCreateRequest request() {
        return new CandidateCreateRequest(job.getId(), CandidateSource.BOSS, "external-001", "张三",
                "Java 开发", 5, "本科", "Spring Boot", ScreeningOutcome.PASS, "满足硬性要求",
                ScreeningOutcome.PASS, "技能匹配", "mock-model-v1", "prompt-v1");
    }
}
