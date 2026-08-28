package ai.xzkj.recruitment.interviews;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.List;

public record InterviewSlotsRequest(@NotNull @Size(min=2,max=5) List<@Valid InterviewSlotRequest> slots){}
