package ai.xzkj.recruitment.resumes;

import java.time.Instant;
import java.util.List;

record OpenAiConfigurationStatusResponse(
        boolean enabled,
        boolean apiKeyConfigured,
        boolean modelConfigured,
        boolean officialEndpoint,
        boolean ready,
        String model,
        String endpointHost,
        long timeoutSeconds,
        int resultRetentionDays,
        boolean requestStorageDisabled,
        String status,
        List<String> missingConfiguration
) {}

record OpenAiConnectionTestResponse(
        boolean success,
        String model,
        String requestId,
        long elapsedMilliseconds,
        Instant checkedAt,
        String message
) {}
