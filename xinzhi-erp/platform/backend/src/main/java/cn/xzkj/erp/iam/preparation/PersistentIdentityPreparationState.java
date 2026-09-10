package cn.xzkj.erp.iam.preparation;

import cn.xzkj.erp.iam.application.IamActor;
import cn.xzkj.erp.iam.persistence.IamAssignmentStore;
import cn.xzkj.erp.iam.preparation.CustomerServiceIdentityPreparation.Binding;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** No component/DDL/bootstrap: requires explicitly installed preparation schema. */
public final class PersistentIdentityPreparationState {
    private static final String CURRENT_LINK=" FROM integration_preparation.identity_sessions s JOIN integration_preparation.identity_bindings b ON b.tenant_id=s.tenant_id AND b.erp_user_id=s.erp_user_id JOIN integration_preparation.identity_epochs e ON e.tenant_id=b.tenant_id JOIN integration_preparation.identity_user_epochs u ON u.tenant_id=b.tenant_id AND u.user_id=b.erp_user_id WHERE s.token_hash=? AND b.tenant_id=? AND b.erp_user_id=? AND b.cs_user_id=? AND b.subject_ref=? AND b.version=? AND b.state='CONFIRMED' AND s.binding_version=b.version AND s.identity_epoch=e.epoch AND s.user_identity_epoch=u.epoch AND s.expires_at>now()";
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final IamAssignmentStore assignments;
    private final byte[] key;
    private final SecureRandom random = new SecureRandom();

    public PersistentIdentityPreparationState(JdbcTemplate db, PlatformTransactionManager transactions,
            IamAssignmentStore assignments, byte[] encryptionKey) {
        if (encryptionKey==null || encryptionKey.length!=32) throw invalid();
        this.db=db; this.tx=new TransactionTemplate(transactions); this.assignments=assignments; this.key=encryptionKey.clone();
    }

    /** Explicit reviewed change with optimistic version; never claims an email. */
    public void review(IamActor actor, Binding binding, long expectedVersion, String state, String evidence) {
        if (binding==null || actor==null || actor.systemAdminId()!=null || actor.userId()==null || !binding.tenantId().equals(actor.tenantId()) ||
                state==null || !List.of("UNREVIEWED","CONFLICT","CONFIRMED","DISABLED").contains(state) || evidence==null ||
                !evidence.matches("[A-Za-z0-9._:-]{1,128}") || binding.version()!=expectedVersion+1) throw invalid();
        tx.executeWithoutResult(status -> {
            if (!assignments.existsUserWithSystemRoleCode(actor.tenantId(),actor.userId(),"tenant_admin")) throw invalid();
            Integer valid=db.queryForObject("SELECT count(*) FROM public.users u JOIN public.tenants t ON t.id=u.tenant_id WHERE u.tenant_id=? AND u.id IN (?,?) AND u.status='ACTIVE' AND t.status='ACTIVE'",Integer.class,
                    binding.tenantId(),actor.userId(),binding.erpUserId());
            if (valid==null || valid!=(actor.userId().equals(binding.erpUserId())?1:2)) throw invalid();
            List<Long> current=db.query("SELECT version FROM integration_preparation.identity_bindings WHERE tenant_id=? AND erp_user_id=? FOR UPDATE",(rs,row)->rs.getLong(1),binding.tenantId(),binding.erpUserId());
            if ((current.isEmpty()?0:current.getFirst())!=expectedVersion) throw invalid();
            if(current.isEmpty()) db.update("INSERT INTO integration_preparation.identity_bindings(tenant_id,erp_user_id,cs_user_id,subject_ref,version,state,reviewed_by,evidence_ref) VALUES(?,?,?,?,?,?,?,?)",
                    binding.tenantId(),binding.erpUserId(),binding.customerServiceUserId(),binding.subjectRef(),binding.version(),state,actor.userId(),evidence);
            else db.update("UPDATE integration_preparation.identity_bindings SET cs_user_id=?,subject_ref=?,version=?,state=?,reviewed_by=?,evidence_ref=?,reviewed_at=now() WHERE tenant_id=? AND erp_user_id=?",
                    binding.customerServiceUserId(),binding.subjectRef(),binding.version(),state,actor.userId(),evidence,binding.tenantId(),binding.erpUserId());
            db.update("INSERT INTO integration_preparation.identity_audit(tenant_id,erp_user_id,version,state,actor_id,evidence_ref) VALUES(?,?,?,?,?,?)",
                    binding.tenantId(),binding.erpUserId(),binding.version(),state,actor.userId(),evidence);
        });
    }

    record Epoch(long tenant,long user) {}
    Epoch requireBinding(Binding b) {
        List<Epoch> epochs=db.query("SELECT e.epoch,u.epoch FROM integration_preparation.identity_bindings b JOIN integration_preparation.identity_epochs e ON e.tenant_id=b.tenant_id JOIN integration_preparation.identity_user_epochs u ON u.tenant_id=b.tenant_id AND u.user_id=b.erp_user_id WHERE b.tenant_id=? AND b.erp_user_id=? AND b.cs_user_id=? AND b.subject_ref=? AND b.version=? AND b.state='CONFIRMED'",
                (rs,row)->new Epoch(rs.getLong(1),rs.getLong(2)),b.tenantId(),b.erpUserId(),b.customerServiceUserId(),b.subjectRef(),b.version());
        if(epochs.size()!=1) throw invalid(); return epochs.getFirst();
    }

    void save(String hash, UUID session, Binding b, Epoch epoch, String attempt, String lease, Instant expires) {
        if(!requireBinding(b).equals(epoch)) throw invalid();
        byte[] nonce=new byte[12];random.nextBytes(nonce);
        byte[] encrypted=crypt(Cipher.ENCRYPT_MODE,hash,nonce,lease.getBytes(StandardCharsets.US_ASCII));
        db.update("INSERT INTO integration_preparation.identity_sessions(token_hash,session_id,tenant_id,erp_user_id,binding_version,identity_epoch,user_identity_epoch,attempt,lease_nonce,encrypted_lease,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                hash,session,b.tenantId(),b.erpUserId(),b.version(),epoch.tenant(),epoch.user(),attempt,nonce,encrypted,Timestamp.from(expires));
    }

    SavedLink load(String hash,Binding b) {
        List<SavedLink> results=db.query("SELECT s.attempt,s.lease_nonce,s.encrypted_lease,s.expires_at"+CURRENT_LINK,
                (rs,row)->new SavedLink(rs.getString(1),new String(crypt(Cipher.DECRYPT_MODE,hash,rs.getBytes(2),rs.getBytes(3)),StandardCharsets.US_ASCII),rs.getTimestamp(4).toInstant()),
                hash,b.tenantId(),b.erpUserId(),b.customerServiceUserId(),b.subjectRef(),b.version());
        if(results.size()!=1)throw invalid();return results.getFirst();
    }

    void assertCurrent(String hash,Binding b) {
        Integer count=db.queryForObject("SELECT count(*)"+CURRENT_LINK,Integer.class,hash,b.tenantId(),b.erpUserId(),b.customerServiceUserId(),b.subjectRef(),b.version());
        if(count==null || count!=1)throw invalid();
    }

    void remove(String hash,Binding b) { db.update("DELETE FROM integration_preparation.identity_sessions WHERE token_hash=? AND tenant_id=? AND erp_user_id=?",hash,b.tenantId(),b.erpUserId()); }

    private byte[] crypt(int mode,String hash,byte[] nonce,byte[] input) {
        try {
            if(nonce.length!=12) throw invalid();
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(mode,new SecretKeySpec(key,"AES"),new GCMParameterSpec(128,nonce));
            cipher.updateAAD(("erp-identity-preparation-v1:"+hash).getBytes(StandardCharsets.US_ASCII));return cipher.doFinal(input);
        } catch(Exception failure) { throw invalid(); }
        finally { if(mode==Cipher.ENCRYPT_MODE)Arrays.fill(input,(byte)0); }
    }

    record SavedLink(String attempt,String lease,Instant expires) { @Override public String toString(){return "SavedLink[redacted]";} }
    private static CustomerServiceIdentityPreparation.Rejected invalid(){return new CustomerServiceIdentityPreparation.Rejected(false);}
}
