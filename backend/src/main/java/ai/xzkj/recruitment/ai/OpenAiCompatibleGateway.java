package ai.xzkj.recruitment.ai;

import ai.xzkj.recruitment.candidates.ScreeningOutcome;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import tools.jackson.databind.*;
import java.net.http.HttpClient;
import java.util.*;

@Component
public class OpenAiCompatibleGateway implements AiGateway{
 private final AiProperties properties;private final ObjectMapper json;
 public OpenAiCompatibleGateway(AiProperties properties,ObjectMapper json){this.properties=properties;this.json=json;}
 public JobSuggestion parseJob(String description){String prompt="从以下职位 JD 提取 JSON，仅返回 title,location,salaryMinK,salaryMaxK,salaryMonths,experienceRequirement,educationRequirement,screeningRequirements,rationale。\n"+description;JsonNode node=completion(prompt);return new JobSuggestion(text(node,"title","待确认职位"),text(node,"location","待确认"),integer(node,"salaryMinK",10),integer(node,"salaryMaxK",20),integer(node,"salaryMonths",12),text(node,"experienceRequirement","待确认"),text(node,"educationRequirement","待确认"),text(node,"screeningRequirements","请 HR 复核"),text(node,"rationale","由外部 AI 生成，须人工复核"));}
 public ScreeningSuggestion screenCandidate(CandidateFacts candidate,JobFacts job){String prompt="你是招聘辅助工具，不得使用敏感属性。根据候选人与职位事实返回 JSON，outcome 只能为 PASS/REVIEW/REJECT，并提供 rationale。\n候选人:"+candidate+"\n职位:"+job;JsonNode node=completion(prompt);ScreeningOutcome outcome;try{outcome=ScreeningOutcome.valueOf(text(node,"outcome","REVIEW").toUpperCase(Locale.ROOT));}catch(Exception e){outcome=ScreeningOutcome.REVIEW;}return new ScreeningSuggestion(outcome,text(node,"rationale","模型未提供充分理由，请人工复核"));}
 private JsonNode completion(String prompt){if(properties.apiKey()==null||properties.apiKey().isBlank())throw new IllegalStateException("外部 AI API Key 未配置");var factory=new JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(properties.timeout()).build());factory.setReadTimeout(properties.timeout());RestClient client=RestClient.builder().requestFactory(factory).baseUrl(properties.baseUrl()).defaultHeader("Authorization","Bearer "+properties.apiKey()).build();Map<String,Object> body=Map.of("model",properties.model(),"temperature",0,"messages",List.of(Map.of("role","system","content","只返回严格 JSON，不包含 Markdown。"),Map.of("role","user","content",prompt)));String response=client.post().uri("/chat/completions").contentType(MediaType.APPLICATION_JSON).body(body).retrieve().body(String.class);try{JsonNode root=json.readTree(response);String content=root.path("choices").path(0).path("message").path("content").asText();return json.readTree(content.replace("```json","").replace("```","").trim());}catch(Exception e){throw new IllegalStateException("外部 AI 返回的 JSON 无法解析",e);}}
 private String text(JsonNode node,String key,String fallback){String value=node.path(key).asText();return value==null||value.isBlank()?fallback:value;}private int integer(JsonNode node,String key,int fallback){return node.path(key).isNumber()?node.path(key).asInt():fallback;}
}
