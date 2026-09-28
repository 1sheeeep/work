package ai.xzkj.recruitment.jobs;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class JobReplyTemplateServiceTest {
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
