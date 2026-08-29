package ai.xzkj.recruitment.autoreply;

import jakarta.validation.constraints.NotNull;
import java.time.Instant;

public record AwayModeRequest(@NotNull AwayMode mode, Instant endsAt) {}
