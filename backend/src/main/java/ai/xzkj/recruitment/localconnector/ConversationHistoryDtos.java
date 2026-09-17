package ai.xzkj.recruitment.localconnector;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

record ConversationHistoryImportRequest(
        @NotBlank @Pattern(regexp = "[a-f0-9]{64}") String chatDigest,
        @NotBlank @Size(max = 120) String jobTitle,
        @NotNull @Size(min = 1, max = 1000) List<@Valid ConversationHistoryMessage> messages,
        @NotNull Instant observedAt,
        boolean possiblyTruncated) { }

record ConversationHistoryMessage(
        @NotBlank @Pattern(regexp = "[a-f0-9]{64}") String messageDigest,
        @NotBlank @Pattern(regexp = "INBOUND|OUTBOUND") String direction,
        Instant messageAt,
        @NotBlank @Size(max = 4000) String content) { }

record ConversationHistoryImportResponse(
        UUID jobPositionId,
        String jobTitle,
        int created,
        int duplicates,
        int skipped,
        boolean possiblyTruncated,
        Instant importedAt) { }
