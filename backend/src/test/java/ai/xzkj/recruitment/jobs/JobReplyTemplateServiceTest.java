package ai.xzkj.recruitment.jobs;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class JobReplyTemplateServiceTest {
    @Test
    void fallsBackToThreeDayTrialPeriodWhenApprovedJobHasNoTrialFact() {
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

        assertTrue(rendered.isPresent());
        assertEquals("TRIAL_PERIOD", rendered.get().intent());
        assertEquals("岗位试岗安排为3天，具体细节面试时再详细沟通。", rendered.get().content());
    }
}
