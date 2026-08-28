package ai.xzkj.recruitment.candidates;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import java.util.*;
@RestController @RequestMapping("/api/candidate-imports")
public class CandidateImportController{
 private final CandidateImportService service;public CandidateImportController(CandidateImportService service){this.service=service;}
 @PostMapping(value="/preview",consumes="multipart/form-data") public CandidateImportResponse preview(@RequestParam UUID jobPositionId,@RequestPart MultipartFile file){return service.preview(jobPositionId,file);}
 @PostMapping("/{id}/confirm") public CandidateImportResponse confirm(@PathVariable UUID id){return service.confirm(id);}
 @GetMapping public List<CandidateImportResponse> list(){return service.list();}
 @GetMapping("/{id}") public CandidateImportResponse detail(@PathVariable UUID id){return service.detail(id);}
}
