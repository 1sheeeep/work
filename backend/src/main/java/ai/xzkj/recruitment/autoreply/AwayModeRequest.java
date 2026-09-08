package ai.xzkj.recruitment.autoreply;

import jakarta.validation.constraints.NotNull;
import java.time.Instant;

public record AwayModeRequest(@NotNull AwayMode mode, Instant endsAt, Boolean autoReplyEnabled) {
    public AwayModeRequest(AwayMode mode, Instant endsAt) { this(mode, endsAt, null); }
    public boolean startsAutomaticReply() { return mode != AwayMode.IN_OFFICE && Boolean.TRUE.equals(autoReplyEnabled); }
}
