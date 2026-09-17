package ai.xzkj.recruitment.localconnector;

import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class LocalConnectorDateRangeControllerTest {
    @Test
    void forwardsTheSameDateRangeToBothDutyReviewQueries() {
        LocalConnectorService service = mock(LocalConnectorService.class);
        LocalConnectorController controller = new LocalConnectorController(service);
        Instant from = Instant.parse("2026-09-01T16:00:00Z");
        Instant to = Instant.parse("2026-09-15T16:00:00Z");

        controller.aiDutyEvents(from, to);
        controller.aiDutyReviewRequired(from, to);

        verify(service).listRecentAiDutyEvents(from, to);
        verify(service).listRecentAiDutyReviewRequired(from, to);
    }
}
