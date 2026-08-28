package ai.xzkj.recruitment.candidates;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record InboundMessageRequest(@NotBlank @Size(max = 120) String externalMessageId,
                                    @NotBlank @Size(max = 5000) String content) {}
