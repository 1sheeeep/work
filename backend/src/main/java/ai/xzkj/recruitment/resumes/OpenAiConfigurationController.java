package ai.xzkj.recruitment.resumes;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/ai-configuration")
public class OpenAiConfigurationController {
    private final OpenAiConfigurationService service;

    public OpenAiConfigurationController(OpenAiConfigurationService service) {
        this.service = service;
    }

    @GetMapping("/status")
    public OpenAiConfigurationStatusResponse status() {
        return service.status();
    }

    @PostMapping("/test")
    @PreAuthorize("hasRole('SYSTEM_ADMIN')")
    public OpenAiConnectionTestResponse testConnection() {
        return service.testConnection();
    }
}
