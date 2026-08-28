package ai.xzkj.recruitment.ai;
import org.springframework.boot.context.properties.ConfigurationProperties;
import java.time.Duration;
@ConfigurationProperties("app.ai")
public record AiProperties(String mode,String baseUrl,String apiKey,String model,String promptVersion,Duration timeout,boolean allowCandidateData){
 public AiProperties{if(mode==null||mode.isBlank())mode="MOCK";if(baseUrl==null||baseUrl.isBlank())baseUrl="https://api.openai.com/v1";if(model==null||model.isBlank())model="mock-recruitment-v1";if(promptVersion==null||promptVersion.isBlank())promptVersion="recruitment-assistant-v1";if(timeout==null)timeout=Duration.ofSeconds(15);}
 public boolean real(){return "OPENAI_COMPATIBLE".equalsIgnoreCase(mode);}
}
