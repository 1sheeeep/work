package ai.xzkj.recruitment.audit;

import ai.xzkj.recruitment.auth.CurrentUserService;
import org.springframework.stereotype.Service;

import java.util.UUID;

@Service
public class AuditService {
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
                targetLabel,
                AuditResult.SUCCESS,
                details
        ));
    }
}
