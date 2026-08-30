package ai.xzkj.recruitment.audit;

import ai.xzkj.recruitment.auth.CurrentUserService;
import org.springframework.stereotype.Service;

import java.util.UUID;
import java.util.regex.Pattern;

@Service
public class AuditService {
    private static final Pattern SENSITIVE = Pattern.compile("(?i)(password|token|cookie|secret|authorization|credential)(\\s*[:=]\\s*)([^,;\\s]+)");
    private final AuditLogRepository repository;
    private final CurrentUserService currentUserService;

    public AuditService(AuditLogRepository repository, CurrentUserService currentUserService) {
        this.repository = repository;
        this.currentUserService = currentUserService;
    }

    public void success(String action, String targetType, UUID targetId, String targetLabel, String details) {
        repository.save(new AuditLog(
                currentUserService.requireCurrentUser(),
                action,
                targetType,
                targetId,
                sanitize(targetLabel, 160),
                AuditResult.SUCCESS,
                sanitize(details, 1000)
        ));
    }

    public void failure(String action, String targetType, UUID targetId, String targetLabel, String details) {
        repository.save(new AuditLog(
                currentUserService.requireCurrentUser(),
                action,
                targetType,
                targetId,
                sanitize(targetLabel, 160),
                AuditResult.FAILURE,
                sanitize(details, 1000)
        ));
    }

    public void anonymousFailure(String action, String targetType, String targetLabel, String details) {
        repository.save(new AuditLog("anonymous", action, targetType, sanitize(targetLabel, 160),
                AuditResult.FAILURE, sanitize(details, 1000)));
    }

    public void systemSuccess(String action, String targetType, UUID targetId, String targetLabel, String details) {
        repository.save(new AuditLog("scheduler", action, targetType, sanitize(targetLabel, 160),
                AuditResult.SUCCESS, sanitize(details, 1000)));
    }

    private String sanitize(String value, int max) {
        if (value == null) return null;
        String clean = SENSITIVE.matcher(value.replace('\n', ' ').replace('\r', ' ')).replaceAll("$1$2[REDACTED]");
        return clean.length() <= max ? clean : clean.substring(0, max);
    }
}
