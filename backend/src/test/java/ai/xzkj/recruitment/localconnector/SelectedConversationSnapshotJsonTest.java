package ai.xzkj.recruitment.localconnector;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;

class SelectedConversationSnapshotJsonTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void acceptsOlderBridgeSnapshotsWithoutResumeCaptureFlag() {
        SelectedConversationSnapshot snapshot = mapper.readValue(snapshotJson(""), SelectedConversationSnapshot.class);

        assertNull(snapshot.resumeCaptureRequested());
        assertEquals("INBOUND", snapshot.direction());
        assertFalse(snapshot.selectedUnread());
    }

    @Test
    void acceptsExplicitFalseResumeCaptureFlag() {
        SelectedConversationSnapshot snapshot = mapper.readValue(
                snapshotJson(", \"resumeCaptureRequested\": false"), SelectedConversationSnapshot.class);

        assertFalse(snapshot.resumeCaptureRequested());
    }

    private String snapshotJson(String extra) {
        return "{" +
                "\"chatDigest\":\"" + "a".repeat(64) + "\"," +
                "\"messageDigest\":\"" + "b".repeat(64) + "\"," +
                "\"direction\":\"INBOUND\"," +
                "\"messageAt\":\"2026-09-17T10:24:00Z\"," +
                "\"selectedUnread\":false," +
                "\"conversationSignals\":{" +
                "\"requestResumeAvailable\":false," +
                "\"resumeReceived\":false," +
                "\"exchangeWechatAvailable\":false," +
                "\"exchangePhoneAvailable\":false," +
                "\"wechatExchanged\":false," +
                "\"phoneExchanged\":false," +
                "\"scheduleInterviewAvailable\":false," +
                "\"interviewScheduled\":false}," +
                "\"messageText\":\"测试消息\"," +
                "\"observedAt\":\"2026-09-17T10:25:00Z\"" + extra + "}";
    }
}
