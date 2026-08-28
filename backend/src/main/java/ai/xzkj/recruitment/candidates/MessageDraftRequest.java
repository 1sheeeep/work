package ai.xzkj.recruitment.candidates;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record MessageDraftRequest(@NotNull MessageSenderType senderType,
                                  @NotBlank @Size(max = 5000) String content,
                                  @Size(max = 80) String modelVersion,
                                  @Size(max = 80) String promptVersion) {}
