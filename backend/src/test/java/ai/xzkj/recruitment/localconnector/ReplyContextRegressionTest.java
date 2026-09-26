package ai.xzkj.recruitment.localconnector;

import ai.xzkj.recruitment.jobs.JobPosition;
import ai.xzkj.recruitment.resumes.OpenAiProperties;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ReplyContextRegressionTest {
    @Test void interviewResultIsNeverDecline() {
        var service = new InboundJobReplyService(new OpenAiProperties(), new ObjectMapper());
        var result = service.decide(mock(JobPosition.class), "没有通过", "候选人：面试过了\n候选人：之前\nHR：好的");
        assertFalse(result.replyAllowed());
        assertEquals("INTERVIEW_RESULT", result.category());
        assertTrue(InboundJobReplyService.isInterviewResultInquiry("没有通过", null));
        assertFalse(InboundJobReplyService.isInterviewResultInquiry("Excel比较熟悉", "面试过了"));
    }
    @Test void skillIntroductionAndTrainingQuestionNeedNoModelOrInventedFacts() {
        var job = mock(JobPosition.class);
        when(job.isKnowledgeApproved()).thenReturn(true);
        var service = new InboundJobReplyService(new OpenAiProperties(), new ObjectMapper());
        assertEquals("好的，了解了，谢谢您的介绍。", service.decide(job,
                "常用的办公软件类似于Photoshop,剪映，Excel，这类软件也比较熟悉").content());
        assertEquals("工作方面的具体情况，面试的时候会详细解答。", service.decide(job,
                "好的，那新人前期有人带吗？有没有KPI指标？").content());
        assertFalse(InboundJobReplyService.isSkillIntroduction("Excel比较熟悉，工资多少？"));
    }
}
