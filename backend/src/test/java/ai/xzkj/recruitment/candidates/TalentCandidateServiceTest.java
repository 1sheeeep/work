package ai.xzkj.recruitment.candidates;

import ai.xzkj.recruitment.auth.CurrentUserService;
import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.auth.UserRole;
import ai.xzkj.recruitment.boss.BossAccount;
import ai.xzkj.recruitment.boss.BossCapability;
import ai.xzkj.recruitment.boss.BossConnectionStatus;
import ai.xzkj.recruitment.jobs.JobPosition;
import ai.xzkj.recruitment.jobs.JobPositionStatus;
import ai.xzkj.recruitment.organization.Company;
import ai.xzkj.recruitment.organization.GroupProfile;
import ai.xzkj.recruitment.resumes.ResumeIntake;
import ai.xzkj.recruitment.resumes.ResumeIntakeRepository;
import ai.xzkj.recruitment.resumes.AiAssistanceRunRepository;
import ai.xzkj.recruitment.resumes.ResumeIntakeSource;
import ai.xzkj.recruitment.resumes.ResumeIntakeStatus;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class TalentCandidateServiceTest {
    @Mock CandidateProfileRepository profiles;
    @Mock CandidateJobContactRepository contacts;
    @Mock ResumeIntakeRepository intakes;
    @Mock ConversationMessageRepository messages;
    @Mock AiAssistanceRunRepository analyses;
    @Mock tools.jackson.databind.ObjectMapper mapper;
    @Mock CurrentUserService users;
    @Mock ResumeIntake intake;

    TalentCandidateService service;
    Company company;
    CandidateProfile profile;
    CandidateJobContact contact;

    @BeforeEach
    void setUp() {
        service = new TalentCandidateService(profiles, contacts, intakes, users);
        company = new Company(new GroupProfile("测试集团", "测试"), "测试企业", "TEST", null, null);
        BossAccount account = new BossAccount(company, "招聘账号", "boss-1");
        account.applyCapabilityCheck(BossConnectionStatus.CONNECTED,
                Set.of(BossCapability.JOB_SYNC, BossCapability.CANDIDATE_READ, BossCapability.MESSAGE_SEND));
        JobPosition job = new JobPosition(company, account, "Java 开发", "上海", 20, 30, 13,
                "3 年", "本科", "负责 Java 服务开发", "Spring");
        job.changeStatus(JobPositionStatus.ACTIVE);
        profile = new CandidateProfile(company, CandidateSource.BOSS, "a".repeat(64),
                "张三", "Java 开发", 5, "本科", "Java Spring");
        contact = new CandidateJobContact(profile, job, account);
        SystemUser user = new SystemUser("admin", "hash", "管理员", UserRole.SYSTEM_ADMIN);
        when(users.requireCurrentUser()).thenReturn(user);
        lenient().when(profiles.findAllByOrderByUpdatedAtDesc()).thenReturn(List.of(profile));
        lenient().when(contacts.findAllByOrderByUpdatedAtDesc()).thenReturn(List.of(contact));
        lenient().when(intakes.findAllByOrderByReceivedAtDesc()).thenReturn(List.of(intake));
        lenient().when(intake.getContact()).thenReturn(contact);
        lenient().when(intake.getProcessingStatus()).thenReturn("READY_FOR_AI");
        lenient().when(intake.getAnalysisStatus()).thenReturn("SUCCEEDED");
    }

    @Test
    void returnsOneDeduplicatedCandidateWithResumeAndJobSummary() {
        List<TalentCandidateResponse> result = service.list("Spring", null, null);

        assertThat(result).hasSize(1);
        assertThat(result.getFirst().displayName()).isEqualTo("张三");
        assertThat(result.getFirst().resumeCount()).isEqualTo(1);
        assertThat(result.getFirst().latestAnalysisStatus()).isEqualTo("SUCCEEDED");
        assertThat(result.getFirst().relatedJobs()).extracting(TalentCandidateResponse.JobSummary::title)
                .containsExactly("Java 开发");
    }

    @Test
    void pageReturnsStableMetadataAndAppliesAnalysisFilter() {
        TalentCandidatePageResponse result = service.page("Spring", null, null,
                null, null, null, "SUCCEEDED", 0, 10);

        assertThat(result.page()).isZero();
        assertThat(result.pageSize()).isEqualTo(10);
        assertThat(result.total()).isEqualTo(1);
        assertThat(result.items()).extracting(TalentCandidateResponse::displayName)
                .containsExactly("张三");
        assertThat(result.counts().analyzed()).isEqualTo(1);
        assertThat(result.counts().failed()).isZero();
    }

    @Test
    void detailAggregatesContactsAndResumeVersions() {
        TalentCandidateService detailService = new TalentCandidateService(profiles, contacts, intakes, users,
                messages, analyses, mapper);
        when(profiles.findById(profile.getId())).thenReturn(Optional.of(profile));
        when(contacts.findByCandidateIdOrderByUpdatedAtDesc(profile.getId())).thenReturn(List.of(contact));
        when(intakes.findByContact_Candidate_IdOrderByReceivedAtDesc(profile.getId())).thenReturn(List.of(intake));
        when(intake.getSource()).thenReturn(ResumeIntakeSource.BOSS_VISIBLE);
        when(intake.getDisplayLabel()).thenReturn("附件简历");
        when(intake.getStatus()).thenReturn(ResumeIntakeStatus.APPROVED_FOR_AI);
        when(intake.getAnalysisQueueStatus()).thenReturn("SUCCEEDED");
        when(intake.getAnalysisQueueAttempts()).thenReturn(1);
        when(analyses.findByResumeIntake_Contact_Candidate_IdOrderByCreatedAtDesc(profile.getId())).thenReturn(List.of());

        TalentCandidateDetailResponse result = detailService.detail(profile.getId());

        assertThat(result.candidate().displayName()).isEqualTo("张三");
        assertThat(result.contacts()).hasSize(1);
        assertThat(result.resumes()).singleElement().satisfies(resume -> {
            assertThat(resume.source()).isEqualTo(ResumeIntakeSource.BOSS_VISIBLE);
            assertThat(resume.displayLabel()).isEqualTo("附件简历");
        });
        assertThat(result.analyses()).isEmpty();
        assertThat(result.timeline()).isNotEmpty();
    }

    @Test
    void auditReturnsAggregateIntegrityCountsWithoutMessageContent() {
        TalentCandidateAuditResponse result = service.audit();

        assertThat(result.counts().candidateProfiles()).isEqualTo(1);
        assertThat(result.counts().candidateJobContacts()).isEqualTo(1);
        assertThat(result.counts().resumeIntakes()).isEqualTo(1);
        assertThat(result.counts().conversationMessages()).isZero();
        assertThat(result.counts().contactsWithoutMessages()).isEqualTo(1);
        assertThat(result.counts().duplicateCandidateKeys()).isZero();
    }

    @Test
    void duplicatePreviewGroupsOnlySameStrongIdentityAndDoesNotExposeIdentityValue() {
        CandidateProfile second = new CandidateProfile(company, CandidateSource.MANUAL, "b".repeat(64),
                "李四", null, null, null, null);
        profile.updateIdentity("p".repeat(64), null);
        second.updateIdentity("p".repeat(64), null);
        when(profiles.findAllByOrderByUpdatedAtDesc()).thenReturn(List.of(profile, second));
        when(contacts.findByCandidateIdOrderByUpdatedAtDesc(profile.getId())).thenReturn(List.of(contact));
        when(contacts.findByCandidateIdOrderByUpdatedAtDesc(second.getId())).thenReturn(List.of());
        when(intakes.findByContact_Candidate_IdOrderByReceivedAtDesc(profile.getId())).thenReturn(List.of(intake));
        when(intakes.findByContact_Candidate_IdOrderByReceivedAtDesc(second.getId())).thenReturn(List.of());

        CandidateDuplicatePreviewResponse result = service.duplicatePreview();

        assertThat(result.duplicateGroups()).isEqualTo(1);
        assertThat(result.groups()).singleElement().satisfies(group -> {
            assertThat(group.confidence()).isEqualTo("HIGH");
            assertThat(group.recommendation()).isEqualTo("MANUAL_CONFIRM");
            assertThat(group.candidates()).extracting(CandidateDuplicatePreviewResponse.Candidate::hasPhoneIdentity)
                    .containsExactly(true, true);
            assertThat(group.candidates()).noneMatch(candidate -> candidate.displayName().contains("p"));
        });
    }
}
