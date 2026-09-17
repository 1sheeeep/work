package ai.xzkj.recruitment.candidates;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ConversationMessageDeduplicatorTest {
    @Test
    void keepsOneMessageWhenTheSameTurnWasImportedWithDifferentExternalIds() {
        ConversationMessage first = message("boss:first", MessageDirection.INBOUND,
                "好的我这边设计什么问题了", Instant.parse("2026-09-17T09:52:00Z"));
        ConversationMessage duplicate = message("boss:second", MessageDirection.INBOUND,
                "好的我这边设计什么问题了", Instant.parse("2026-09-17T09:52:12Z"));

        assertThat(ConversationMessageDeduplicator.forDisplay(List.of(first, duplicate)))
                .containsExactly(first);
    }

    @Test
    void doesNotCollapseDifferentTurnsOrDirections() {
        ConversationMessage inbound = message("boss:first", MessageDirection.INBOUND, "好的", Instant.parse("2026-09-17T09:52:00Z"));
        ConversationMessage later = message("boss:second", MessageDirection.INBOUND, "好的", Instant.parse("2026-09-17T10:04:00Z"));
        ConversationMessage outbound = message("ai:third", MessageDirection.OUTBOUND, "好的", Instant.parse("2026-09-17T09:52:00Z"));

        assertThat(ConversationMessageDeduplicator.forDisplay(List.of(inbound, later, outbound)))
                .containsExactly(inbound, later, outbound);
    }

    private ConversationMessage message(String externalId, MessageDirection direction, String content, Instant createdAt) {
        ConversationMessage message = mock(ConversationMessage.class);
        when(message.getExternalMessageId()).thenReturn(externalId);
        when(message.getDirection()).thenReturn(direction);
        when(message.getContent()).thenReturn(content);
        when(message.getCreatedAt()).thenReturn(createdAt);
        return message;
    }
}
