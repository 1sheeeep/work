package cn.xzkj.erp.iam.preparation;

import cn.xzkj.erp.iam.application.*;
import cn.xzkj.erp.iam.persistence.*;
import cn.xzkj.erp.iam.audit.*;
import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.tenantaccess.*;
import java.net.URI;
import java.time.Clock;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.security.access.AccessDeniedException;

/** Disabled by default. Fixed reviewed identities only, never email claiming,
 * provisioning, native-CS login/logout, or fallback to the old ERP password. */
@Service
@ConditionalOnProperty(name="erp.native-customer-service-identity.enabled",havingValue="true")
public class NativeCustomerServiceIdentity implements AutoCloseable {
    private final JdbcTemplate db;
    private final SessionTokenService tokens;
    private final SecurityAuditRecorder audit;
    private final Map<UUID,CustomerServiceIdentityPreparation> clients=new HashMap<>();
    private final UUID tenant;

    public NativeCustomerServiceIdentity(JdbcTemplate db,PlatformTransactionManager transactions,
        UserAccountRepository users,AuthSessionRepository sessions,PermissionRepository permissions,
        IamAssignmentStore assignments,UserApplicationAccessService access,TenantEntitlementService entitlements,
        SessionTokenService tokens,SecurityAuditRecorder audit,Clock clock,
        @Value("${erp.native-customer-service-identity.tenant-id}") UUID tenant,
        @Value("${erp.native-customer-service-identity.base-url}") URI base,
        @Value("${erp.native-customer-service-identity.service-token}") String serviceToken,
        @Value("${erp.native-customer-service-identity.encryption-key}") String encryptionKey,
        @Value("${erp.native-customer-service-identity.trusted-certificate:}") String trustedCertificate) {
        this.db=db;this.tokens=tokens;this.tenant=tenant;this.audit=audit;
        byte[] key;
        try {key=Base64.getDecoder().decode(encryptionKey);}catch(IllegalArgumentException invalid){throw new IllegalArgumentException("Invalid identity key");}
        var state=new PersistentIdentityPreparationState(db,transactions,assignments,key);Arrays.fill(key,(byte)0);
        var bindings=db.query("SELECT erp_user_id,cs_user_id,subject_ref,version FROM integration_preparation.identity_bindings WHERE tenant_id=? AND state='CONFIRMED'",
            (r,n)->new CustomerServiceIdentityPreparation.Binding(tenant,r.getObject(1,UUID.class),r.getString(2),r.getString(3),r.getLong(4)),tenant);
        if(bindings.isEmpty() || bindings.size()>100)throw new IllegalStateException("Reviewed identities required");
        var tls=certificateContext(trustedCertificate);
        try {for(var b:bindings){
            var client=new CustomerServiceIdentityPreparation(b,base,serviceToken,users,sessions,permissions,access,entitlements,tokens,transactions,clock,state);
            try {
                client.useNativeRuntimeProtocol();
                if(tls!=null)client.trustNativeCertificate(tls);
                clients.put(b.erpUserId(),client);
            } catch(RuntimeException failure) {
                client.close();
                throw failure;
            }
        }}
        catch(RuntimeException failure){close();throw failure;}
    }
    private static javax.net.ssl.SSLContext certificateContext(String path) {
        if(path.isBlank())return null;
        try(var input=java.nio.file.Files.newInputStream(java.nio.file.Path.of(path))) {
            var certificate=java.security.cert.CertificateFactory.getInstance("X.509").generateCertificate(input);
            var store=java.security.KeyStore.getInstance(java.security.KeyStore.getDefaultType());store.load(null,null);store.setCertificateEntry("native-identity",certificate);
            var trust=javax.net.ssl.TrustManagerFactory.getInstance(javax.net.ssl.TrustManagerFactory.getDefaultAlgorithm());trust.init(store);
            var tls=javax.net.ssl.SSLContext.getInstance("TLS");tls.init(null,trust.getTrustManagers(),null);return tls;
        }catch(Exception invalid){throw new IllegalArgumentException("Invalid native identity certificate");}
    }
    public boolean isBound(UUID tenantId,UUID userId) {
        if(!tenant.equals(tenantId))return false;
        // A disabled/deleted mapping must never restore the previous ERP password.
        return clients.containsKey(userId) || Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM integration_preparation.identity_audit WHERE tenant_id=? AND erp_user_id=? AND state='CONFIRMED')",Boolean.class,tenantId,userId));
    }
    public void requireLocalPasswordAllowed(UUID tenantId,UUID userId) {
        if(isBound(tenantId,userId))throw new AccessDeniedException("Manage this account's password in customer service");
    }
    public LoginResult login(UserAccountEntity user,LoginCommand command) {
        var client=clients.get(user.getId());if(client==null)throw new InvalidLoginException();
        try {
            var issued=client.login(user.getTenant().getId(),user.getEmail(),command.password().toCharArray());
            audit.recordAtomically(new SecurityAuditEvent(tenant,user.getId(),cn.xzkj.erp.iam.domain.SecurityAuditActions.LOGIN_SUCCEEDED,"auth_session",issued.session().sessionId().toString(),command.requestId(),command.sourceIp(),Map.of("source","original_customer_service")));
            var t=user.getTenant();
            return new LoginResult(issued.token(),issued.session().expiresAt(),t.getId(),t.getCode(),t.getName(),user.getId(),user.getUsername(),user.getEmail(),user.getDisplayName(),issued.session().permissions());
        } catch(CustomerServiceIdentityPreparation.Rejected rejected) {
            if(rejected.unavailable())throw new DataAccessResourceFailureException("Identity source unavailable");
            throw new InvalidLoginException();
        }
    }
    public boolean supports(String token){return token!=null && token.matches("cs-native_[A-Za-z0-9_-]{43}");}
    public String entrySubject(UUID tenantId, UUID userId, UUID sessionId) {
        if (!tenant.equals(tenantId) || !clients.containsKey(userId)) throw new AccessDeniedException("Native identity required");
        var hashes=db.query("SELECT token_hash FROM integration_preparation.identity_sessions WHERE tenant_id=? AND erp_user_id=? AND session_id=?",(r,n)->r.getString(1),tenantId,userId,sessionId);
        if(hashes.size()!=1)throw new AccessDeniedException("Native session required");
        try { clients.get(userId).validateSessionHash(hashes.getFirst()); }
        catch(CustomerServiceIdentityPreparation.Rejected rejected) {
            if(rejected.unavailable())throw new DataAccessResourceFailureException("Identity source unavailable");
            throw new AccessDeniedException("Native session expired");
        }
        var ids=db.query("SELECT cs_user_id FROM integration_preparation.identity_bindings WHERE tenant_id=? AND erp_user_id=? AND state='CONFIRMED'",(r,n)->r.getString(1),tenantId,userId);
        if(ids.size()!=1)throw new AccessDeniedException("Native binding required");
        return ids.getFirst();
    }
    public boolean validate(String token) {
        if(!supports(token))return false;
        var ids=db.query("SELECT erp_user_id FROM integration_preparation.identity_sessions WHERE token_hash=? AND tenant_id=?",(r,n)->r.getObject(1,UUID.class),tokens.hash(token),tenant);
        if(ids.size()!=1 || !clients.containsKey(ids.getFirst()))return false;
        try {clients.get(ids.getFirst()).validateSession(token);return true;}
        catch(CustomerServiceIdentityPreparation.Rejected rejected){
            if(rejected.unavailable())throw new DataAccessResourceFailureException("Identity source unavailable");return false;
        }
    }
    @Transactional public void clearSession(ErpPrincipal principal) {
        if(tenant.equals(principal.tenantId()))db.update("DELETE FROM integration_preparation.identity_sessions WHERE session_id=? AND tenant_id=? AND erp_user_id=?",principal.sessionId(),tenant,principal.userId());
    }
    @jakarta.annotation.PreDestroy @Override public void close(){clients.values().forEach(CustomerServiceIdentityPreparation::close);clients.clear();}
}
