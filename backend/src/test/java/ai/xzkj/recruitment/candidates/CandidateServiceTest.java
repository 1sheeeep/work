package ai.xzkj.recruitment.candidates;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.autoreply.AutoReplyAttemptRepository;
import ai.xzkj.recruitment.auth.CurrentUserService;
import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.auth.UserRole;
import ai.xzkj.recruitment.boss.*;
import ai.xzkj.recruitment.common.ApiException;
import ai.xzkj.recruitment.jobs.JobPosition;
import ai.xzkj.recruitment.jobs.JobPositionStatus;
import ai.xzkj.recruitment.organization.Company;
import ai.xzkj.recruitment.organization.GroupProfile;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class CandidateServiceTest {
    @Mock CandidateJobContactRepository contactRepository;
    @Mock ScreeningDecisionRepository decisionRepository;
    @Mock ConversationMessageRepository messageRepository;
    @Mock CurrentUserService currentUserService;
    @Mock AuditService auditService;
    @Mock AutoReplyAttemptRepository autoReplyAttemptRepository;
    CandidateService service;
    Company company; BossAccount account; JobPosition job; CandidateProfile profile;
    CandidateJobContact contact; SystemUser recruiter;

    @BeforeEach void setUp() {
        service = new CandidateService(contactRepository, decisionRepository, messageRepository,
                currentUserService, auditService, autoReplyAttemptRepository);
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

    @Test void listsOnlyAccessibleRealContacts() {
        when(currentUserService.requireCurrentUser()).thenReturn(recruiter);
        when(contactRepository.findAllByOrderByUpdatedAtDesc()).thenReturn(List.of(contact));
        when(decisionRepository.findByContactIdOrderByCreatedAtDesc(contact.getId())).thenReturn(List.of());
        assertThat(service.list(null,null,null,null,null)).hasSize(1);
    }
}
