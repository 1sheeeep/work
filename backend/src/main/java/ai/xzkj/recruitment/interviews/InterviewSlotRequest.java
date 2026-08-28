package ai.xzkj.recruitment.interviews;

import jakarta.validation.constraints.NotNull;
import java.time.Instant;

public record InterviewSlotRequest(@NotNull Instant startsAt,@NotNull Instant endsAt){}
