package ai.xzkj.recruitment.localconnector;

import org.junit.jupiter.api.Test;
import java.time.Instant;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class LocalConnectorOfflineDrillTest {
    @Test void preservesFixtureEvidenceWithoutPromotingAnyCapability(){
        String before="a".repeat(64),after="b".repeat(64),receipt="c".repeat(64);
        OfflineDrillReport report=new OfflineDrillReport("SEND_MESSAGE","PASSED","FIXTURE_ONLY",before,after,receipt,null);
        LocalConnectorOfflineDrill drill=new LocalConnectorOfflineDrill(mock(BrowserDevice.class),report,Instant.parse("2026-08-30T12:00:00Z"));
        assertThat(drill.getEvidenceSource()).isEqualTo("FIXTURE_ONLY");
        assertThat(drill.getOutcome()).isEqualTo("PASSED");
        assertThat(drill.getBeforeDigest()).isEqualTo(before);
        assertThat(drill.getAfterDigest()).isEqualTo(after);
        assertThat(drill.getReceiptDigest()).isEqualTo(receipt);
    }
}
