package ai.xzkj.recruitment.localconnector;

import ai.xzkj.recruitment.boss.BossAccount;
import ai.xzkj.recruitment.common.ApiException;
import ai.xzkj.recruitment.jobs.JobPosition;
import ai.xzkj.recruitment.organization.Company;
import ai.xzkj.recruitment.organization.GroupProfile;
import ai.xzkj.recruitment.resumes.OpenAiProperties;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class InboundJobReplyHttpIntegrationTest {
    private HttpServer server;

    @AfterEach
    void stopServer() {
        if (server != null) server.stop(0);
    }

    @Test
    void acceptsARealHttpModelResponseOnlyAfterFactValidation() throws Exception {
        start(exchange -> respond(exchange, 200, completion("""
                {"primaryIntent":"SALARY","secondaryIntents":[],"relevant":true,"confidence":0.98,"action":"REPLY","riskLevel":"LOW",
                 "reply":"您好，招聘页面标注薪资为 8-13K。","evidenceKeys":["SALARY"]}
                """)));

        InboundJobReplyService.Decision result = service(Duration.ofSeconds(2)).decide(job(), "请问薪资是多少？");

        assertTrue(result.replyAllowed());
        assertEquals("SALARY", result.category());
        assertEquals("您好，招聘页面标注薪资为 8-13K。", result.content());
    }

    @Test
    void acceptsCompatibleEvidenceObjectsWithoutWeakeningFactValidation() throws Exception {
        start(exchange -> respond(exchange, 200, completion("""
                {"primaryIntent":"SALARY","secondaryIntents":[],"relevant":true,"confidence":0.98,"action":"REPLY","riskLevel":"LOW",
                 "reply":"您好，招聘页面标注薪资为 8-13K。","evidence":[{"criterion":"薪资","status":"FOUND"}]}
                """)));

        InboundJobReplyService.Decision result = service(Duration.ofSeconds(2)).decide(job(), "请问薪资是多少？");

        assertTrue(result.replyAllowed());
        assertEquals("SALARY", result.category());
    }

    @Test
    void ignoresNegativeEvidenceObjectsAndFailsClosed() throws Exception {
        start(exchange -> respond(exchange, 200, completion("""
                {"primaryIntent":"SALARY","secondaryIntents":[],"relevant":true,"confidence":0.98,"action":"REPLY","riskLevel":"LOW",
                 "reply":"您好，招聘页面标注薪资为 8-13K。","evidence":[{"criterion":"薪资","status":"MISS"}]}
                """)));

        InboundJobReplyService.Decision result = service(Duration.ofSeconds(2)).decide(job(), "请问薪资是多少？");

        assertFalse(result.replyAllowed());
        assertFalse(result.retryable());
        assertTrue(result.reason().contains("模型未提供事实证据字段"));
    }

    @Test
    void retriesWhenModelReturnsAnEmptyEvidenceArrayForAGroundedReply() throws Exception {
        start(exchange -> respond(exchange, 200, completion("""
                {"primaryIntent":"SALARY","secondaryIntents":[],"relevant":true,"confidence":0.98,"action":"REPLY","riskLevel":"LOW",
                 "reply":"您好，招聘页面标注薪资为 8-13K。","evidenceKeys":[]}
                """)));

        InboundJobReplyService.Decision result = service(Duration.ofSeconds(2)).decide(job(), "请问薪资是多少？");

        assertFalse(result.replyAllowed());
        assertTrue(result.retryable());
        assertTrue(result.reason().contains("模型未提供事实证据字段"));
    }

    @Test
    void rejectsHallucinatedFactsEvenWhenModelMarksThemRelevant() throws Exception {
        start(exchange -> respond(exchange, 200, completion("""
                {"primaryIntent":"SALARY","secondaryIntents":[],"relevant":true,"confidence":0.99,"action":"REPLY","riskLevel":"LOW",
                 "reply":"您好，该岗位薪资 20K，并且双休。","evidenceKeys":["SALARY"]}
                """)));

        InboundJobReplyService.Decision result = service(Duration.ofSeconds(2)).decide(job(), "薪资和休息怎么安排？");

        assertFalse(result.replyAllowed());
        assertFalse(result.retryable());
        assertTrue(result.reason().startsWith("AI 回复未通过岗位事实校验"));
    }

    @Test
    void answersSeveralRelatedQuestionsFromOnlyTheirPermittedFields() throws Exception {
        start(exchange -> respond(exchange, 200, completion("""
                {"primaryIntent":"JOB_INTEREST","secondaryIntents":["LOCATION","RESPONSIBILITIES"],"relevant":true,"confidence":0.97,"action":"REQUEST_RESUME","riskLevel":"LOW",
                 "reply":"可以聊聊，工作地点在广州市番禺区，主要负责客户咨询和订单跟进。您可以先发简历。",
                 "evidenceKeys":["NEXT_STEP","WORK_ADDRESS","DESCRIPTION"]}
                """)));

        InboundJobReplyService.Decision result = service(Duration.ofSeconds(2)).decide(
                job(), "可以聊聊吗？", "候选人：工作地点？\n候选人：这个岗位是干嘛的？");

        assertTrue(result.replyAllowed());
        assertEquals("JOB_INTEREST", result.category());
    }

    @Test
    void permitsAConstrainedClarificationWithoutExposingJobFacts() throws Exception {
        start(exchange -> respond(exchange, 200, completion("""
                {"primaryIntent":"OTHER_RECRUITMENT","secondaryIntents":[],"relevant":true,"confidence":0.91,
                 "action":"ASK_CLARIFICATION","riskLevel":"LOW",
                 "reply":"请问您具体想了解这个岗位的哪一方面？","evidenceKeys":[]}
                """)));

        InboundJobReplyService.Decision result = service(Duration.ofSeconds(2)).decide(job(), "这个怎么说？");

        assertTrue(result.replyAllowed());
        assertEquals("请问您具体想了解这个岗位的哪一方面？", result.content());
        assertTrue(result.reason().contains("受限澄清"));
    }

    @Test
    void answersAnOpenEndedJobQuestionFromApprovedJobKnowledge() throws Exception {
        start(exchange -> respond(exchange, 200, completion("""
                {"primaryIntent":"GENERAL_JOB_CONSULTATION","secondaryIntents":[],"relevant":true,"confidence":0.94,
                 "action":"REPLY","riskLevel":"LOW",
                 "reply":"这个岗位主要负责客户咨询、订单跟进及售后问题处理。","evidenceKeys":["DESCRIPTION"]}
                """)));

        InboundJobReplyService.Decision result = service(Duration.ofSeconds(2)).decide(job(), "这个岗平时大概是什么情况呀？");

        assertTrue(result.replyAllowed());
        assertEquals("GENERAL_JOB_CONSULTATION", result.category());
        assertEquals("这个岗位主要负责客户咨询、订单跟进及售后问题处理。", result.content());
    }

    @Test
    void reconcilesApprovedEvidenceWhenTheModelOmitsSecondaryIntents() throws Exception {
        start(exchange -> respond(exchange, 200, completion("""
                {"primaryIntent":"OTHER_RECRUITMENT","secondaryIntents":[],"relevant":true,"confidence":0.94,
                 "action":"REPLY","riskLevel":"LOW",
                 "reply":"主要负责客户咨询、订单跟进及售后问题处理，工作地点在广州市番禺区。",
                 "evidenceKeys":["DESCRIPTION","WORK_ADDRESS"]}
                """)));

        InboundJobReplyService.Decision result = service(Duration.ofSeconds(2)).decide(job(), "工作内容和工作地点是怎样的？");

        assertTrue(result.replyAllowed());
        assertEquals("OTHER_RECRUITMENT", result.category());
    }

    @Test
    void clarifiesARecruitmentRelatedButUnderspecifiedQuestion() throws Exception {
        start(exchange -> respond(exchange, 200, completion("""
                {"primaryIntent":"CLARIFICATION_REQUIRED","secondaryIntents":[],"relevant":true,"confidence":0.92,
                 "action":"ASK_CLARIFICATION","riskLevel":"LOW",
                 "reply":"可以的，您主要想了解工作内容、地点、薪资还是任职要求呢？","evidenceKeys":[]}
                """)));

        InboundJobReplyService.Decision result = service(Duration.ofSeconds(2)).decide(job(), "方便具体说说吗？");

        assertTrue(result.replyAllowed());
        assertEquals("CLARIFICATION_REQUIRED", result.category());
        assertTrue(result.reason().contains("受限澄清"));
    }

    @Test
    void sendsGroundedPartialAnswerAndMarksMissingFactForHrFollowUp() throws Exception {
        start(exchange -> respond(exchange, 200, completion("""
                {"primaryIntent":"JOB_INTEREST","secondaryIntents":["LOCATION"],"relevant":true,"confidence":0.95,
                 "action":"REQUEST_RESUME","riskLevel":"LOW",
                 "reply":"可以聊聊，您可以先发简历；具体工作地点需要招聘人员确认。","evidenceKeys":["NEXT_STEP"]}
                """)));

        InboundJobReplyService.Decision result = service(Duration.ofSeconds(2)).decide(
                jobWithoutLocation(), "可以聊聊吗？", "候选人：工作地点在哪里？");

        assertTrue(result.replyAllowed());
        assertTrue(result.reason().startsWith("已部分回答，仍需 HR 补充：LOCATION"));
    }

    @Test
    void allowsLowRiskSocialThanksWithoutJobFacts() throws Exception {
        start(exchange -> respond(exchange, 200, completion("""
                {"primaryIntent":"SOCIAL_THANKS","secondaryIntents":[],"relevant":true,"confidence":0.74,"action":"REPLY","riskLevel":"LOW",
                 "reply":"不客气，有其他想了解的可以随时告诉我。","evidenceKeys":[]}
                """)));

        InboundJobReplyService.Decision result = service(Duration.ofSeconds(2)).decide(job(), "谢谢");

        assertTrue(result.replyAllowed());
        assertEquals("SOCIAL_THANKS", result.category());
        assertTrue(result.reason().contains("低风险社交回复校验"));
    }

    @Test
    void blocksFactsInventedInsideASocialReply() throws Exception {
        start(exchange -> respond(exchange, 200, completion("""
                {"primaryIntent":"CANDIDATE_CONSIDERING","secondaryIntents":[],"relevant":true,"confidence":0.91,"action":"REPLY","riskLevel":"LOW",
                 "reply":"好的，您先考虑，这个岗位目前还在招聘中。","evidenceKeys":[]}
                """)));

        InboundJobReplyService.Decision result = service(Duration.ofSeconds(2)).decide(job(), "我考虑一下");

        assertFalse(result.replyAllowed());
        assertTrue(result.reason().startsWith("AI 社交回复未通过安全校验"));
    }

    @Test
    void keepsTrueOffTopicMessagesSilent() throws Exception {
        start(exchange -> respond(exchange, 200, completion("""
                {"primaryIntent":"TRUE_OFF_TOPIC","secondaryIntents":[],"relevant":false,"confidence":0.98,"action":"NO_REPLY","riskLevel":"LOW",
                 "reply":"","evidenceKeys":[]}
                """)));

        InboundJobReplyService.Decision result = service(Duration.ofSeconds(2)).decide(job(), "帮我推荐一部电影");

        assertFalse(result.replyAllowed());
        assertEquals("TRUE_OFF_TOPIC", result.category());
        assertTrue(result.reason().contains("招聘会话无关"));
    }

    @Test
    void treatsPureAcknowledgementAsExpectedSilence() throws Exception {
        start(exchange -> respond(exchange, 200, completion("""
                {"primaryIntent":"SOCIAL_ACKNOWLEDGEMENT","secondaryIntents":[],"relevant":true,"confidence":0.96,"action":"REPLY","riskLevel":"LOW",
                 "reply":"好的，有问题随时告诉我。","evidenceKeys":[]}
                """)));

        InboundJobReplyService.Decision result = service(Duration.ofSeconds(2)).decide(job(), "好的，收到");

        assertFalse(result.replyAllowed());
        assertTrue(result.reason().startsWith("正常静默："));
    }

    @Test
    void acknowledgesAnAlreadySentResumeWithoutJobFacts() throws Exception {
        start(exchange -> respond(exchange, 200, completion("""
                {"primaryIntent":"RESUME_SENT","secondaryIntents":[],"relevant":true,"confidence":0.96,"action":"REPLY","riskLevel":"LOW",
                 "reply":"收到您的简历，我会先查看。","evidenceKeys":[]}
                """)));

        InboundJobReplyService.Decision result = service(Duration.ofSeconds(2)).decide(
                job(), "简历已经发了", "HR：方便的话可以发一份简历。",
                new InboundJobReplyService.ConversationRuntime("RESUME_RECEIVED", true, false, false, false));

        assertTrue(result.replyAllowed());
        assertEquals("RESUME_SENT", result.category());
    }

    @Test
    void blocksModelFromRequestingResumeAfterTrustedReceipt() throws Exception {
        start(exchange -> respond(exchange, 200, completion("""
                {"primaryIntent":"JOB_INTEREST","secondaryIntents":[],"relevant":true,"confidence":0.97,"action":"REQUEST_RESUME","riskLevel":"LOW",
                 "reply":"可以聊聊，您可以先发一份简历。","evidenceKeys":["NEXT_STEP"]}
                """)));

        InboundJobReplyService.Decision result = service(Duration.ofSeconds(2)).decide(
                job(), "我对这个岗位感兴趣", "",
                new InboundJobReplyService.ConversationRuntime("RESUME_RECEIVED", true, false, false, false));

        assertFalse(result.replyAllowed());
        assertTrue(result.reason().contains("简历已经收到"));
    }

    @Test
    void turnsRateLimitIntoRetryableQueueFailureWithoutGeneratingAReply() throws Exception {
        start(exchange -> respond(exchange, 429, "{\"error\":{\"message\":\"rate limited\"}}"));

        ApiException error = assertThrows(ApiException.class,
                () -> service(Duration.ofSeconds(2)).decide(job(), "这个岗位还招人吗？"));

        assertEquals("INBOUND_REPLY_AI_REQUEST_FAILED", error.getCode());
    }

    @Test
    void rejectsMalformedModelOutputWithoutFallbackText() throws Exception {
        start(exchange -> respond(exchange, 200, completion("not-json")));

        ApiException error = assertThrows(ApiException.class,
                () -> service(Duration.ofSeconds(2)).decide(job(), "工作地点在哪里？"));

        assertEquals("INBOUND_REPLY_AI_INVALID", error.getCode());
    }

    @Test
    void retriesWhenACompatibleModelOmitsRequiredBooleanThenUsesTheCompleteResult() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        start(exchange -> respond(exchange, 200, completion(calls.incrementAndGet() == 1
                ? """
                  {"primaryIntent":"SALARY","secondaryIntents":[],"confidence":0.96,"action":"REPLY","riskLevel":"LOW","reply":"您好，招聘页面标注薪资为 8-13K。","evidenceKeys":["SALARY"]}
                  """
                : """
                  {"primaryIntent":"SALARY","secondaryIntents":[],"relevant":true,"confidence":0.96,"action":"REPLY","riskLevel":"LOW","reply":"您好，招聘页面标注薪资为 8-13K。","evidenceKeys":["SALARY"]}
                  """)));

        InboundJobReplyService.Decision result = service(Duration.ofSeconds(2)).decide(job(), "请问薪资是多少？");

        assertTrue(result.replyAllowed());
        assertEquals(2, calls.get());
    }

    @Test
    void retriesWhenACompatibleModelKeepsOmittingRequiredBoolean() throws Exception {
        start(exchange -> respond(exchange, 200, completion("""
                {"primaryIntent":"SALARY","secondaryIntents":[],"confidence":0.96,"action":"REPLY","riskLevel":"LOW","reply":"您好，招聘页面标注薪资为 8-13K。","evidenceKeys":["SALARY"]}
                """)));

        ApiException error = assertThrows(ApiException.class,
                () -> service(Duration.ofSeconds(2)).decide(job(), "请问薪资是多少？"));

        assertEquals("INBOUND_REPLY_AI_INVALID_RESULT", error.getCode());
    }

    @Test
    void timesOutSlowModelWithoutGeneratingAReply() throws Exception {
        start(exchange -> {
            try { Thread.sleep(300); } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
            try { respond(exchange, 200, completion("{}")); } catch (IOException ignored) { }
        });

        ApiException error = assertThrows(ApiException.class,
                () -> service(Duration.ofMillis(50)).decide(job(), "工作地点在哪里？"));

        assertEquals("INBOUND_REPLY_AI_TIMEOUT", error.getCode());
    }

    private void start(Handler handler) throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/chat/completions", exchange -> handler.handle(exchange));
        server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        server.start();
    }

    private InboundJobReplyService service(Duration timeout) {
        int port = server.getAddress().getPort();
        OpenAiProperties properties = new OpenAiProperties() {
            @Override public boolean isConfigured() { return true; }
        };
        properties.setEnabled(true);
        properties.setApiKey("test-only-key");
        properties.setModel("test-model");
        properties.setBaseUrl("http://127.0.0.1:" + port);
        properties.setTimeout(timeout);
        return new InboundJobReplyService(properties, new ObjectMapper());
    }

    private JobPosition job() {
        GroupProfile group = new GroupProfile("测试集团", "测试");
        Company company = new Company(group, "测试公司", "TEST", "广州", null);
        company.updateKnowledge("互联网", "100人", "测试公司", true);
        BossAccount account = new BossAccount(company, "测试招聘账号", "boss-test");
        JobPosition job = new JobPosition(company, account, "跨境客服", "广州", 8, 13, 12,
                "1年以上", "大专", "负责客户咨询、订单跟进及售后问题处理", null);
        job.updateReviewedDetails("社会招聘", "客服", null, "客户咨询、订单跟进", "广州市番禺区");
        job.updateKnowledge("负责客户咨询、订单跟进及售后问题处理", "8-13K", true);
        return job;
    }

    private JobPosition jobWithoutLocation() {
        GroupProfile group = new GroupProfile("测试集团", "测试");
        Company company = new Company(group, "测试公司", "TEST", "广州", null);
        company.updateKnowledge("互联网", "100人", "测试公司", true);
        BossAccount account = new BossAccount(company, "测试招聘账号", "boss-test");
        JobPosition job = new JobPosition(company, account, "跨境客服", "", 8, 13, 12,
                "1年以上", "大专", "负责客户咨询、订单跟进及售后问题处理", null);
        job.updateReviewedDetails("社会招聘", "客服", null, "客户咨询、订单跟进", null);
        job.updateKnowledge("负责客户咨询、订单跟进及售后问题处理", "8-13K", true);
        return job;
    }

    private String completion(String content) {
        try {
            ObjectMapper mapper = new ObjectMapper();
            var root = mapper.createObjectNode();
            root.putArray("choices").addObject().putObject("message").put("content", content);
            return mapper.writeValueAsString(root);
        } catch (Exception error) {
            throw new IllegalStateException(error);
        }
    }

    private void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (var output = exchange.getResponseBody()) { output.write(bytes); }
    }

    @FunctionalInterface
    private interface Handler { void handle(HttpExchange exchange) throws IOException; }
}
