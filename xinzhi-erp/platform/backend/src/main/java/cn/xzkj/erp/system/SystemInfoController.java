package cn.xzkj.erp.system;

import cn.xzkj.erp.iam.entry.FirstPartyApplicationOriginRegistry;
import java.time.Instant;
import java.util.Map;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/system")
public class SystemInfoController {

    private final String environment;
    private final FirstPartyApplicationOriginRegistry applicationOrigins;

    public SystemInfoController(
            @Value("${erp.environment}") String environment,
            FirstPartyApplicationOriginRegistry applicationOrigins) {
        this.environment = environment;
        this.applicationOrigins = applicationOrigins;
    }

    @GetMapping("/info")
    public Map<String, Object> info() {
        return Map.of(
                "service", "xz-erp",
                "status", "ready",
                "environment", environment,
                "architecture", "modular-monolith",
                "identityMode", "local",
                "firstPartyApplications", applicationOrigins.publicDirectory(),
                "timestamp", Instant.now().toString()
        );
    }
}
