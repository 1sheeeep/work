package ai.xzkj.recruitment.autoreply;

import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController @RequestMapping("/api/auto-replies")
public class AutoReplyController {
    private final AutoReplyService service;public AutoReplyController(AutoReplyService service){this.service=service;}
    @GetMapping("/policies") public List<AutoReplyResponse> policies(){return service.listPolicies();}
    @PutMapping("/policies/{accountId}") @PreAuthorize("hasAnyRole('SYSTEM_ADMIN','RECRUITMENT_ADMIN')") public AutoReplyResponse update(@PathVariable UUID accountId,@Valid @RequestBody AutoReplyRequest request){return service.update(accountId,request);}
    @PutMapping("/policies/{accountId}/away-mode") public AutoReplyResponse awayMode(@PathVariable UUID accountId,@Valid @RequestBody AwayModeRequest request){return service.changeAwayMode(accountId,request);}
    @GetMapping("/attempts") public List<AutoReplyAttemptResponse> attempts(){return service.listAttempts();}
}
