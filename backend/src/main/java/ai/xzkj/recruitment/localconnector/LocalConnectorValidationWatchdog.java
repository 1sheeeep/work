package ai.xzkj.recruitment.localconnector;

import ai.xzkj.recruitment.audit.AuditService;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import java.time.Instant;

@Component
class LocalConnectorValidationWatchdog {
    private final LocalConnectorValidationCaseRepository validations;
    private final LocalConnectorCapabilityRepository capabilities;
    private final AuditService audit;
    LocalConnectorValidationWatchdog(LocalConnectorValidationCaseRepository validations,LocalConnectorCapabilityRepository capabilities,AuditService audit){this.validations=validations;this.capabilities=capabilities;this.audit=audit;}

    @Scheduled(fixedDelayString="${app.browser.validation-watchdog-interval:30s}",initialDelayString="${app.browser.validation-watchdog-interval:30s}")
    @Transactional void expireManualWindows(){Instant now=Instant.now();for(LocalConnectorValidationCase validation:validations.findByStatusAndTestExpiresAtBefore("MANUAL_TEST_RUNNING",now)){validation.fail("人工验收窗口已过期，能力已自动锁定",null,now);capabilities.findByDeviceIdAndCapability(validation.getDevice().getId(),validation.getActionType()).ifPresent(capability->capability.recordManualResult(false,validation.getPageEvidenceDigest(),now));audit.systemSuccess("EXPIRE_CONNECTOR_MANUAL_VALIDATION","LOCAL_CONNECTOR_VALIDATION",validation.getId(),validation.getDevice().getBossAccount().getDisplayName(),validation.getActionType()+" 人工验收窗口超时，未执行自动重试");}}
}
