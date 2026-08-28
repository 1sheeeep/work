package ai.xzkj.recruitment.ai;
import jakarta.validation.Valid;import jakarta.validation.constraints.*;import org.springframework.security.access.prepost.PreAuthorize;import org.springframework.web.bind.annotation.*;import java.util.UUID;
@RestController @RequestMapping("/api/ai")
public class AiAssistanceController{private final AiAssistanceService service;public AiAssistanceController(AiAssistanceService service){this.service=service;}@PostMapping("/job-parse")@PreAuthorize("hasAnyRole('SYSTEM_ADMIN','RECRUITMENT_ADMIN')")public AiAssistanceService.JobParseResponse parse(@Valid@RequestBody JobParseRequest request){return service.parseJob(request.description());}@PostMapping("/candidate-screen/{contactId}")public AiAssistanceService.CandidateScreenResponse screen(@PathVariable UUID contactId){return service.screen(contactId);}public record JobParseRequest(@NotBlank@Size(max=10000)String description){}
}
