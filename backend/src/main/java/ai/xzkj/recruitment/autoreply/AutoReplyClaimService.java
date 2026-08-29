package ai.xzkj.recruitment.autoreply;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;

@Service
public class AutoReplyClaimService {
    private final JdbcTemplate jdbc;
    public AutoReplyClaimService(JdbcTemplate jdbc){this.jdbc=jdbc;}

    public List<DueMessage> findDue(Instant now,int limit){return jdbc.query("""
        SELECT m.id AS message_id,c.id AS contact_id,p.id AS policy_id,a.id AS account_id
        FROM auto_reply_policies p
        JOIN boss_accounts a ON a.id=p.boss_account_id
        JOIN candidate_job_contacts c ON c.boss_account_id=a.id
        JOIN candidate_profiles cp ON cp.id=c.candidate_id
        JOIN conversation_messages m ON m.contact_id=c.id
        WHERE p.enabled=TRUE AND p.away_mode<>'IN_OFFICE' AND (p.away_ends_at IS NULL OR p.away_ends_at>CAST(? AS timestamptz))
          AND a.status='ACTIVE' AND a.connection_status IN ('CONNECTED','DEGRADED')
          AND cp.privacy_status='ACTIVE' AND c.human_taken_over=FALSE
          AND c.status NOT IN ('REJECTED')
          AND m.direction='INBOUND' AND m.delivery_status='RECEIVED'
          AND m.created_at <= CAST(? AS timestamptz) - (p.response_timeout_minutes * interval '1 minute')
          AND m.id=(SELECT latest.id FROM conversation_messages latest WHERE latest.contact_id=c.id ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1)
          AND EXISTS (SELECT 1 FROM boss_account_capabilities cap WHERE cap.account_id=a.id AND cap.capability='MESSAGE_SEND')
          AND NOT EXISTS (SELECT 1 FROM browser_conversation_bindings binding WHERE binding.contact_id=c.id)
          AND NOT EXISTS (SELECT 1 FROM auto_reply_attempts ar WHERE ar.inbound_message_id=m.id AND (ar.status<>'CLAIMED' OR ar.lease_until>?))
        ORDER BY m.created_at ASC LIMIT ?
        """,(rs,row)->new DueMessage(rs.getObject("message_id",UUID.class),rs.getObject("contact_id",UUID.class),rs.getObject("policy_id",UUID.class),rs.getObject("account_id",UUID.class)),Timestamp.from(now),Timestamp.from(now),Timestamp.from(now),limit);}

    public UUID claim(DueMessage due,String owner,Instant now,Instant leaseUntil){UUID id=UUID.randomUUID();List<UUID> ids=jdbc.query("""
        INSERT INTO auto_reply_attempts(id,policy_id,boss_account_id,contact_id,inbound_message_id,status,idempotency_key,owner_id,lease_until,attempt_count,created_at)
        VALUES (?,?,?,?,?,'CLAIMED',?,?,?,1,?)
        ON CONFLICT (inbound_message_id) DO UPDATE SET owner_id=EXCLUDED.owner_id,lease_until=EXCLUDED.lease_until,
          attempt_count=auto_reply_attempts.attempt_count+1,result_message=NULL
        WHERE auto_reply_attempts.status='CLAIMED' AND auto_reply_attempts.lease_until<=EXCLUDED.created_at
        RETURNING id
        """,(rs,row)->rs.getObject("id",UUID.class),id,due.policyId(),due.accountId(),due.contactId(),due.messageId(),"auto-reply:"+due.messageId(),owner,Timestamp.from(leaseUntil),Timestamp.from(now));return ids.isEmpty()?null:ids.getFirst();}

    public record DueMessage(UUID messageId,UUID contactId,UUID policyId,UUID accountId){}
}
