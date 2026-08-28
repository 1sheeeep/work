package ai.xzkj.recruitment.notifications;
import ai.xzkj.recruitment.audit.AuditService;import ai.xzkj.recruitment.auth.*;import ai.xzkj.recruitment.common.ApiException;import org.springframework.http.HttpStatus;import org.springframework.stereotype.Service;import java.time.Instant;import java.util.UUID;
@Service
public class NotificationTrialService{
 private final NotificationProperties properties;private final NotificationGateway gateway;private final CurrentUserService users;private final AuditService audit;
 public NotificationTrialService(NotificationProperties properties,NotificationGateway gateway,CurrentUserService users,AuditService audit){this.properties=properties;this.gateway=gateway;this.users=users;this.audit=audit;}
 public TrialResponse send(){SystemUser user=users.requireCurrentUser();if(user.getRole()!=UserRole.SYSTEM_ADMIN)throw new ApiException(HttpStatus.FORBIDDEN,"FORBIDDEN","仅系统管理员可发送试运行通知");if(!properties.webhook()||!properties.trialEnabled())throw new ApiException(HttpStatus.CONFLICT,"NOTIFICATION_TRIAL_DISABLED","未启用真实 Webhook 试运行");String key="trial-"+UUID.randomUUID();var result=gateway.notifyInterview(new NotificationGateway.NotificationRequest(UUID.randomUUID(),user.getId(),key,"trial-reference","预发布 HR 通知渠道试运行",Instant.now().plusSeconds(86400),"Asia/Shanghai","SUCCESS"));audit.success("TRIAL_HR_NOTIFICATION","NOTIFICATION_CHANNEL",null,"WEBHOOK 试运行","试运行结果 "+(result.succeeded()?"SUCCEEDED":"FAILED")+"，幂等键 "+key);return new TrialResponse(gateway.channel(),result.succeeded(),result.message(),key);}
 public record TrialResponse(NotificationChannel channel,boolean succeeded,String message,String idempotencyKey){}
}
