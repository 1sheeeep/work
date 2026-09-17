package ai.xzkj.recruitment.localconnector;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.UUID;

record HrReplyExampleImportRequest(@NotBlank @Size(max = 120000) String transcript,
                                   @Pattern(regexp = "[a-f0-9]{64}") String chatDigest) { }
record HrReplyExampleImportResponse(UUID jobPositionId, String jobTitle, int created, int duplicates, int skipped) { }
