package ai.xzkj.recruitment.browsercompanion;
import org.springframework.data.jpa.repository.*;import java.util.*;
interface BrowserDeviceRepository extends JpaRepository<BrowserDevice,UUID>{@EntityGraph(attributePaths={"bossAccount","bossAccount.company"})Optional<BrowserDevice> findByTokenHashAndStatus(String hash,String status);@EntityGraph(attributePaths={"bossAccount","bossAccount.company"})List<BrowserDevice> findAllByOrderByCreatedAtDesc();Optional<BrowserDevice> findFirstByBossAccountIdAndStatus(UUID id,String status);}
interface BrowserPairingCodeRepository extends JpaRepository<BrowserPairingCode,UUID>{@EntityGraph(attributePaths={"account","account.company","createdBy"})Optional<BrowserPairingCode> findByTokenHash(String hash);}
interface BrowserConversationBindingRepository extends JpaRepository<BrowserConversationBinding,UUID>{@EntityGraph(attributePaths={"account","contact","contact.candidate","contact.jobPosition"})Optional<BrowserConversationBinding> findByAccountIdAndExternalChatKey(UUID accountId,String key);boolean existsByContactId(UUID contactId);}
interface BrowserSendClaimRepository extends JpaRepository<BrowserSendClaim,UUID>{
 @EntityGraph(attributePaths={"device","binding","binding.contact","inboundMessage"}) Optional<BrowserSendClaim> findByIdAndDeviceId(UUID id,UUID deviceId);
 Optional<BrowserSendClaim> findByInboundMessageId(UUID inboundMessageId);
}
interface BrowserUnreadObservationRepository extends JpaRepository<BrowserUnreadObservation,UUID>{@EntityGraph(attributePaths={"account","account.company"})List<BrowserUnreadObservation> findAllByUnreadTrueOrderByFirstSeenAtAsc();@EntityGraph(attributePaths={"account","account.company"})Optional<BrowserUnreadObservation> findWithAccountById(UUID id);Optional<BrowserUnreadObservation> findByAccountIdAndChatDigest(UUID accountId,String chatDigest);@EntityGraph(attributePaths={"account","fillDevice"})Optional<BrowserUnreadObservation> findByFillClaimId(UUID claimId);}
