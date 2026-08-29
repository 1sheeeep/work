package ai.xzkj.recruitment.autoreply;

import jakarta.validation.constraints.*;
import java.time.Instant;
import java.time.LocalTime;

public record AutoReplyRequest(
        boolean enabled, @NotNull AwayMode awayMode, Instant awayEndsAt, boolean autoSendEnabled,
        @Min(5) @Max(10080) int responseTimeoutMinutes,
        @Min(1) @Max(200) int dailyLimit,
        @Min(30) @Max(86400) int minimumIntervalSeconds,
        @NotNull LocalTime sendingWindowStart, @NotNull LocalTime sendingWindowEnd,
        @NotBlank @Size(max=64) String timezone,
        @Min(1) @Max(20) int maxConsecutiveFailures,
        @NotBlank @Size(max=1000) String replyTemplate) {}
