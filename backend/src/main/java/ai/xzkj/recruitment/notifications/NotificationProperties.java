package ai.xzkj.recruitment.notifications;
import org.springframework.boot.context.properties.ConfigurationProperties;import java.time.Duration;
@ConfigurationProperties("app.notification")
public record NotificationProperties(String mode,String webhookUrl,String webhookSecret,Duration timeout,boolean allowInsecureHttp,boolean trialEnabled,String trialRecipientIds){
 public NotificationProperties{if(mode==null||mode.isBlank())mode="MOCK";if(timeout==null)timeout=Duration.ofSeconds(5);}
 public boolean webhook(){return "WEBHOOK".equalsIgnoreCase(mode);}public boolean configured(){return webhookUrl!=null&&!webhookUrl.isBlank()&&webhookSecret!=null&&!webhookSecret.isBlank();}
 public boolean trialRecipientAllowed(java.util.UUID id){if(!trialEnabled)return true;if(trialRecipientIds==null||trialRecipientIds.isBlank())return false;return java.util.Arrays.stream(trialRecipientIds.split(",")).map(String::trim).anyMatch(value->value.equals("*")||value.equalsIgnoreCase(id.toString()));}
}
