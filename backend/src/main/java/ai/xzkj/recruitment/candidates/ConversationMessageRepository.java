package ai.xzkj.recruitment.candidates;

import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ConversationMessageRepository extends JpaRepository<ConversationMessage, UUID> {
    @EntityGraph(attributePaths = {"createdBy"})
    List<ConversationMessage> findTop50ByContactIdOrderByCreatedAtAsc(UUID contactId);
    List<ConversationMessage> findByContactIdOrderByCreatedAtAsc(UUID contactId);
    Optional<ConversationMessage> findByContactIdAndExternalMessageId(UUID contactId, String externalMessageId);
    Optional<ConversationMessage> findByIdAndContactId(UUID id, UUID contactId);
    Optional<ConversationMessage> findFirstByContactIdOrderByCreatedAtDescIdDesc(UUID contactId);
}
