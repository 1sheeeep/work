package ai.xzkj.recruitment.interviews;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.List;
import java.util.UUID;

public record InterviewCreateRequest(@NotNull UUID contactId,@NotBlank @Size(max=64) String timezone,
                                     @NotNull MockNotificationOutcome mockNotificationOutcome,
                                     @NotNull @Size(min=2,max=5) List<@Valid InterviewSlotRequest> slots){}
