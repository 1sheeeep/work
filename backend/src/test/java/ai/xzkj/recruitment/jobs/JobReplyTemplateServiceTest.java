package ai.xzkj.recruitment.jobs;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class JobReplyTemplateServiceTest {
    @Test
    void variesApprovedFactWordingWithoutChangingTheFactOrRepeatingTheLastHrReply() {
        JobPosition job = mock(JobPosition.class);
        UUID jobId = UUID.randomUUID();
        when(job.getId()).thenReturn(jobId);
        when(job.isKnowledgeApproved()).thenReturn(true);
        when(job.getWorkTime()).thenReturn("大小周，上午九点至下午六点");
        List<JobReplyTemplate> stored = new ArrayList<>();
        JobReplyTemplateRepository repository = mock(JobReplyTemplateRepository.class);
        when(repository.findAllByJobPositionId(jobId)).thenReturn(stored);
        when(repository.save(any(JobReplyTemplate.class))).thenAnswer(invocation -> {
            JobReplyTemplate template = invocation.getArgument(0);
            stored.add(template);
            return template;
        });
        JobReplyTemplateService service = new JobReplyTemplateService(repository);
        String first = service.renderFixedFact(job, "请问上班时间是几点？", "").orElseThrow().content();
        String next = service.renderFixedFact(job, "请问上班时间是几点？", "HR：" + first).orElseThrow().content();
        assertTrue(first.contains("大小周，上午九点至下午六点"));
        assertTrue(next.contains("大小周，上午九点至下午六点"));
        assertNotEquals(first, next);
    }

    @Test
    void answersBenefitsFromApprovedJobDataInsteadOfSkippingOnTheWordDaiyu() {
        JobPosition job = mock(JobPosition.class);
        UUID jobId = UUID.randomUUID();
        when(job.getId()).thenReturn(jobId);
        when(job.isKnowledgeApproved()).thenReturn(true);
        when(job.getBenefits()).thenReturn("转正后缴纳社保；节日福利");
        List<JobReplyTemplate> stored = new ArrayList<>();
        JobReplyTemplateRepository repository = mock(JobReplyTemplateRepository.class);
        when(repository.findAllByJobPositionId(jobId)).thenReturn(stored);
        when(repository.save(any(JobReplyTemplate.class))).thenAnswer(invocation -> {
            JobReplyTemplate template = invocation.getArgument(0);
            stored.add(template);
            return template;
        });
        String reply = new JobReplyTemplateService(repository)
                .renderFixedFact(job, "请问福利待遇有哪些？", "").orElseThrow().content();
        assertTrue(reply.contains("转正后缴纳社保；节日福利"));
    }

    @Test
    void doesNotInventThreeDayTrialPeriodWhenApprovedJobHasNoTrialFact() {
        JobPosition job = mock(JobPosition.class);
        UUID jobId = UUID.randomUUID();
        when(job.getId()).thenReturn(jobId);
        when(job.isKnowledgeApproved()).thenReturn(true);

        List<JobReplyTemplate> stored = new ArrayList<>();
        JobReplyTemplateRepository repository = mock(JobReplyTemplateRepository.class);
        when(repository.findAllByJobPositionId(jobId)).thenReturn(stored);
        when(repository.save(any(JobReplyTemplate.class))).thenAnswer(invocation -> {
            JobReplyTemplate template = invocation.getArgument(0);
            stored.add(template);
            return template;
        });

        JobReplyTemplateService service = new JobReplyTemplateService(repository);
        var rendered = service.renderFixedFact(job, "请问有试岗期吗");

        assertTrue(rendered.isEmpty());
    }

    @Test
    void usesOnlyExplicitApprovedJobTrialFact() {
        JobPosition job = mock(JobPosition.class);
        UUID jobId = UUID.randomUUID();
        when(job.getId()).thenReturn(jobId);
        when(job.isKnowledgeApproved()).thenReturn(true);
        when(job.getReplySummary()).thenReturn("本岗位设有7天试岗期，试岗结果不影响已工作期间的工资结算。");

        List<JobReplyTemplate> stored = new ArrayList<>();
        JobReplyTemplateRepository repository = mock(JobReplyTemplateRepository.class);
        when(repository.findAllByJobPositionId(jobId)).thenReturn(stored);
        when(repository.save(any(JobReplyTemplate.class))).thenAnswer(invocation -> {
            JobReplyTemplate template = invocation.getArgument(0);
            stored.add(template);
            return template;
        });

        var rendered = new JobReplyTemplateService(repository).renderFixedFact(job, "请问有试岗期吗");

        assertTrue(rendered.isPresent());
        assertTrue(rendered.get().content().contains("7天试岗期"));
    }

    @Test
    void doesNotTreatAnUnverifiedTrialMentionAsApprovedDuration() {
        JobPosition job = mock(JobPosition.class);
        UUID jobId = UUID.randomUUID();
        when(job.getId()).thenReturn(jobId);
        when(job.isKnowledgeApproved()).thenReturn(true);
        when(job.getReplySummary()).thenReturn("具体试岗、社保和排班细则由 HR 核实。");

        List<JobReplyTemplate> stored = new ArrayList<>();
        JobReplyTemplateRepository repository = mock(JobReplyTemplateRepository.class);
        when(repository.findAllByJobPositionId(jobId)).thenReturn(stored);
        when(repository.save(any(JobReplyTemplate.class))).thenAnswer(invocation -> {
            JobReplyTemplate template = invocation.getArgument(0);
            stored.add(template);
            return template;
        });

        assertTrue(new JobReplyTemplateService(repository).renderFixedFact(job, "请问试岗几天").isEmpty());
    }
}
