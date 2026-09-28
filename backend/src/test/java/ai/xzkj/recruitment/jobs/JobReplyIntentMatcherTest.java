package ai.xzkj.recruitment.jobs;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class JobReplyIntentMatcherTest {
    @Test
    void usesOneMatcherForFixedAndSocialIntents() {
        assertEquals("WORK_TIME", JobReplyIntentMatcher.detectFixedIntent("请问月休几天"));
        assertEquals("WORK_TIME", JobReplyIntentMatcher.detectFixedIntent("能问一下为什么是下午开始上班么？"));
        assertEquals("BENEFITS", JobReplyIntentMatcher.detectFixedIntent("请问福利待遇有哪些？"));
        assertEquals("SALARY", JobReplyIntentMatcher.detectFixedIntent("请问薪资待遇是多少？"));
        assertNull(JobReplyIntentMatcher.detectFixedIntent("请问工资和福利待遇怎么样？"));
        assertEquals("MEALS_LODGING", JobReplyIntentMatcher.detectFixedIntent("请问有宿舍吗"));
        assertEquals("TRIAL_PERIOD", JobReplyIntentMatcher.detectFixedIntent("工作这边有试岗期吗"));
        assertEquals("RESUME_SENT", JobReplyIntentMatcher.detectSocialIntent("我刚刚发了简历"));
        assertEquals("SOCIAL_ACKNOWLEDGEMENT", JobReplyIntentMatcher.detectSocialIntent("好嘿"));
        assertEquals("SOCIAL_ACKNOWLEDGEMENT", JobReplyIntentMatcher.detectSocialIntent("了解了"));
        assertEquals("SOCIAL_ACKNOWLEDGEMENT", JobReplyIntentMatcher.detectSocialIntent("OK"));
        assertEquals("CANDIDATE_DECLINE", JobReplyIntentMatcher.detectSocialIntent("不好意思，距离太远不考虑了"));
        assertTrue(JobReplyIntentMatcher.isCandidateDecline("办公地点较远，不在考虑范围内"));
        assertTrue(JobReplyIntentMatcher.isCandidateDecline("工作位置很远，过去不方便"));
        assertNull(JobReplyIntentMatcher.detectSocialIntent("不好意思，想问一下薪资"));
    }
}
