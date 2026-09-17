package ai.xzkj.recruitment.localconnector;

import ai.xzkj.recruitment.candidates.ConversationTimelineService;
import ai.xzkj.recruitment.candidates.MessageDirection;
import ai.xzkj.recruitment.common.ApiException;
import ai.xzkj.recruitment.jobs.JobPosition;
import ai.xzkj.recruitment.jobs.JobPositionRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Locale;

@Service
class ConversationHistoryService {
    private final JobPositionRepository jobs;
    private final ConversationTimelineService timeline;

    ConversationHistoryService(JobPositionRepository jobs, ConversationTimelineService timeline) {
        this.jobs = jobs;
        this.timeline = timeline;
    }

    @Transactional
    ConversationHistoryImportResponse importFromDevice(BrowserDevice device, ConversationHistoryImportRequest request) {
        if (device == null || device.getBossAccount() == null) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "DEVICE_REQUIRED", "浏览器设备未完成配对。");
        }
        Instant now = Instant.now();
        if (request.observedAt().isAfter(now.plusSeconds(300))) {
            throw bad("CONVERSATION_HISTORY_FUTURE", "聊天记录观测时间无效。");
        }
        for (ConversationHistoryMessage message : request.messages()) {
            if (message.messageAt() != null && message.messageAt().isAfter(now.plusSeconds(300))) {
                throw bad("CONVERSATION_MESSAGE_FUTURE", "聊天消息时间无效。");
            }
        }
        JobPosition job = resolveJob(device, request.jobTitle());
        List<ConversationTimelineService.HistoryMessage> messages = request.messages().stream()
                .map(message -> new ConversationTimelineService.HistoryMessage(
                        message.messageDigest(), MessageDirection.valueOf(message.direction()),
                        message.content(), message.messageAt()))
                .toList();
        ConversationTimelineService.HistoryImportResult result = timeline.recordObservedMessages(
                device.getBossAccount(), job, request.chatDigest(), messages, request.observedAt(), !request.possiblyTruncated());
        return new ConversationHistoryImportResponse(job.getId(), job.getTitle(), result.created(),
                result.duplicates(), result.skipped(), request.possiblyTruncated(), now);
    }

    private JobPosition resolveJob(BrowserDevice device, String title) {
        List<JobPosition> matches = jobs.findAllByBossAccountId(device.getBossAccount().getId()).stream()
                .filter(job -> normalizeJobTitle(job.getTitle()).equals(normalizeJobTitle(title)))
                .toList();
        if (matches.isEmpty()) throw bad("CONVERSATION_JOB_NOT_FOUND", "未找到与聊天记录匹配的岗位，未写入沟通时间线。");
        if (matches.size() > 1) throw bad("CONVERSATION_JOB_AMBIGUOUS", "聊天记录岗位对应多个岗位，未写入沟通时间线。");
        return matches.getFirst();
    }

    private String normalizeJobTitle(String value) {
        return value == null ? "" : value.toLowerCase(Locale.ROOT)
                .replaceAll("[\\s+·•/\\\\|｜()（）【】\\[\\]，,。.!！]+", "")
                .replaceAll("(?:急招|高薪|诚聘)", "");
    }

    private ApiException bad(String code, String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, code, message);
    }
}
