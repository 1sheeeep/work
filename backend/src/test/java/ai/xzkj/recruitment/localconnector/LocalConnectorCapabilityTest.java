package ai.xzkj.recruitment.localconnector;

import org.junit.jupiter.api.Test;
import java.time.Instant;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class LocalConnectorCapabilityTest {
    @Test void recordsReadOnlyEvidenceForAReadCapability(){
        LocalConnectorCapability capability=new LocalConnectorCapability(mock(BrowserDevice.class),"CHAT_LIST_READ");
        Instant now=Instant.parse("2026-08-30T09:00:00Z");
        capability.verifyReadOnly("a".repeat(64),"真实页面已识别",now);
        assertThat(capability.getStatus()).isEqualTo("READ_ONLY_VERIFIED");
        assertThat(capability.getVerifiedAt()).isEqualTo(now);
    }

    @Test void neverPromotesAWriteCapabilityFromReadOnlyEvidence(){
        LocalConnectorCapability capability=new LocalConnectorCapability(mock(BrowserDevice.class),"SEND_MESSAGE");
        capability.verifyReadOnly("a".repeat(64),"无效证据",Instant.now());
        assertThat(capability.getStatus()).isEqualTo("UNVERIFIED");
        assertThat(capability.getVerifiedAt()).isNull();
    }
}
