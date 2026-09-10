package cn.xzkj.erp.iam.preparation;

import cn.xzkj.erp.iam.application.SessionTokenService;
import cn.xzkj.erp.iam.domain.AccountStatus;
import cn.xzkj.erp.iam.domain.TenantStatus;
import cn.xzkj.erp.iam.persistence.AuthSessionEntity;
import cn.xzkj.erp.iam.persistence.AuthSessionRepository;
import cn.xzkj.erp.iam.persistence.PermissionRepository;
import cn.xzkj.erp.iam.persistence.UserAccountEntity;
import cn.xzkj.erp.iam.persistence.UserAccountRepository;
import cn.xzkj.erp.tenantaccess.TenantEntitlementService;
import cn.xzkj.erp.tenantaccess.UserApplicationAccessService;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.DeserializationFeature;

/**
 * Explicit-construction preparation adapter; intentionally NOT a Spring bean,
 * controller or production login mode. Its tokens cannot pass the existing
 * 43-character native Bearer filter. No native auth behavior or schema changes.
 *
 * This slice verifies one reviewed association, with a real local ERP session
 * row and live permissions. An explicitly installed durable state adapter
 * supports reviewed associations, revocation epochs and multi-instance leases.
 * There is no production login mount or implicit schema installation.
 */
public final class CustomerServiceIdentityPreparation implements AutoCloseable {
    private static final String PREFIX = "cs-preparation_";
    private String tokenPrefix=PREFIX;
    private Duration leaseMaximum=Duration.ofMinutes(5);
    private static final String PATH = "/internal/v1/erp-identity-preparation/";
    private final Binding binding;
    private final URI base;
    private final String serviceToken;
    private HttpClient http;
    private final ObjectMapper json = new ObjectMapper().rebuild()
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();
    private final UserAccountRepository users;
    private final AuthSessionRepository sessions;
    private final PermissionRepository permissions;
    private final UserApplicationAccessService access;
    private final TenantEntitlementService entitlements;
    private final SessionTokenService tokens;
    private final TransactionTemplate transaction;
    private final Clock clock;
    private final Map<String, Link> links = new ConcurrentHashMap<>();
    private final PersistentIdentityPreparationState persistent;

    public record Binding(UUID tenantId, UUID erpUserId, String customerServiceUserId, String subjectRef, long version) {
        public Binding {
            Objects.requireNonNull(tenantId); Objects.requireNonNull(erpUserId);
            if (!safeRef(customerServiceUserId) || !safeRef(subjectRef) || version < 1 || version > 9007199254740991L)
                throw new IllegalArgumentException("Identity preparation binding invalid");
        }
    }

    private static final class Link {
        final String attempt, lease;
        final Instant expiresAt;
        Link(String attempt, String lease, Instant expiresAt) { this.attempt=attempt; this.lease=lease; this.expiresAt=expiresAt; }
    }

    public record SessionView(UUID sessionId, UUID tenantId, UUID userId, List<String> permissions, Instant expiresAt) {
        public SessionView { permissions = List.copyOf(permissions); }
    }
    public record IssuedSession(String token, SessionView session) {
        @Override public String toString() { return "IssuedSession[redacted]"; }
    }

    public static final class Rejected extends RuntimeException {
        private final boolean unavailable;
        Rejected(boolean unavailable) { super(unavailable ? "IDENTITY_PREPARATION_UNAVAILABLE" : "IDENTITY_PREPARATION_REJECTED"); this.unavailable=unavailable; }
        public boolean unavailable() { return unavailable; }
    }

    public CustomerServiceIdentityPreparation(Binding binding, URI base, String serviceToken,
            UserAccountRepository users, AuthSessionRepository sessions, PermissionRepository permissions,
            UserApplicationAccessService access, TenantEntitlementService entitlements,
            SessionTokenService tokens, PlatformTransactionManager transactionManager, Clock clock) {
        this(binding,base,serviceToken,users,sessions,permissions,access,entitlements,tokens,transactionManager,clock,null);
    }

    public CustomerServiceIdentityPreparation(Binding binding, URI base, String serviceToken,
            UserAccountRepository users, AuthSessionRepository sessions, PermissionRepository permissions,
            UserApplicationAccessService access, TenantEntitlementService entitlements,
            SessionTokenService tokens, PlatformTransactionManager transactionManager, Clock clock,
            PersistentIdentityPreparationState persistent) {
        this.persistent=persistent;
        this.binding=Objects.requireNonNull(binding);
        Objects.requireNonNull(base);
        boolean loopback = "http".equals(base.getScheme()) && ("127.0.0.1".equals(base.getHost()) || "localhost".equals(base.getHost()));
        if (!(loopback || "https".equals(base.getScheme())) || base.getHost()==null || base.getRawUserInfo()!=null || base.getRawQuery()!=null || base.getRawFragment()!=null ||
                !(base.getPath().isEmpty() || base.getPath().equals("/")) || serviceToken==null || !serviceToken.matches("[!-~]{32,256}"))
            throw new IllegalArgumentException("Identity preparation connection invalid");
        this.base=base; this.serviceToken=serviceToken;
        this.users=Objects.requireNonNull(users); this.sessions=Objects.requireNonNull(sessions); this.permissions=Objects.requireNonNull(permissions);
        this.access=Objects.requireNonNull(access); this.entitlements=Objects.requireNonNull(entitlements); this.tokens=Objects.requireNonNull(tokens);
        this.transaction=new TransactionTemplate(Objects.requireNonNull(transactionManager)); this.clock=Objects.requireNonNull(clock);
        this.http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3))
                .followRedirects(HttpClient.Redirect.NEVER).build();
    }

    /** Password is transient and cleared, including on failure. Never log it.
     * The random attempt binds the two BACKEND exchanges to this invocation;
     * a future browser handler still needs origin/CSRF and HttpOnly session binding.
     */
    public synchronized IssuedSession login(UUID tenantId, String email, char[] password) {
        try {
            if (!binding.tenantId().equals(tenantId) || email==null || email.isBlank() || email.length()>254 || password==null || password.length==0 || password.length>72) throw rejected();
            links.entrySet().removeIf(entry -> !clock.instant().isBefore(entry.getValue().expiresAt));
            if (links.size()>=128) throw new Rejected(true);
            transaction.execute(status -> { localUser(); return null; });
            var epoch=persistent==null?null:persistent.requireBinding(binding);
            String attempt=tokens.issue().rawValue();
            var request=request(attempt); request.put("email",email); request.put("password",new String(password));
            JsonNode verified;
            try { verified=call("verify",request); } finally { request.remove("password"); }
            Instant grantExpiry=validateClaims(verified,Duration.ofSeconds(30));
            String grant=opaque(verified,"grant");
            if (verified.has("lease")) throw rejected();
            if (!clock.instant().isBefore(grantExpiry)) throw rejected();
            var exchange=request(attempt); exchange.put("grant",grant);
            var exchanged=call("exchange",exchange);
            Instant expiry=validateClaims(exchanged,leaseMaximum);
            String lease=opaque(exchanged,"lease");
            if (exchanged.has("grant")) throw rejected();
            // No ERP email lookup: only the exact, pre-existing reviewed ID.
            return transaction.execute(status -> {
                UserAccountEntity user=localUser();
                String raw=tokenPrefix+tokens.issue().rawValue();
                String hash=tokens.hash(raw);
                var row=new AuthSessionEntity(UUID.randomUUID(),binding.tenantId(),user,hash,expiry,clock.instant());
                sessions.save(row);
                var view=view(row);
                if(persistent!=null) { sessions.flush(); persistent.save(hash,row.getId(),binding,epoch,attempt,lease,expiry); }
                // Register only after the database commit succeeds. Orphaned
                // rows on process loss are unusable without this instance's link.
                org.springframework.transaction.support.TransactionSynchronizationManager.registerSynchronization(
                    new org.springframework.transaction.support.TransactionSynchronization() {
                        @Override public void afterCommit() { if(persistent==null)links.put(hash,new Link(attempt,lease,expiry)); }
                    });
                return new IssuedSession(raw,view);
            });
        } finally { if (password!=null) Arrays.fill(password,'\0'); }
    }

    public SessionView validateSession(String raw) {
        return validateSessionHash(sessionHash(raw));
    }

    /** Server-side revalidation for a stored session; never exposed as a bearer API. */
    public SessionView validateSessionHash(String hash) {
        if (hash == null || !hash.matches("[a-f0-9]{64}")) throw rejected();
        Link link=links.get(hash);
        if(persistent!=null) {
            var saved=persistent.load(hash,binding);
            link=new Link(saved.attempt(),saved.lease(),saved.expires());
        }
        if (link==null || !clock.instant().isBefore(link.expiresAt)) { links.remove(hash); throw rejected(); }
        var request=request(link.attempt); request.put("lease",link.lease);
        try {
            var current=call("validate",request);
            if (!validateClaims(current,leaseMaximum).equals(link.expiresAt) || current.has("grant") || current.has("lease")) throw rejected();
            return transaction.execute(status -> {
                // Re-check after the remote round trip: a rapid local revoke
                // and restore while waiting must not authorize this request.
                if(persistent!=null)persistent.assertCurrent(hash,binding);
                localUser();
                var row=sessions.findActiveByTokenHash(hash,clock.instant()).orElseThrow(CustomerServiceIdentityPreparation::rejected);
                if (!row.getTenantId().equals(binding.tenantId()) || !row.getUser().getId().equals(binding.erpUserId())) throw rejected();
                return view(row);
            });
        } catch (Rejected failure) {
            // Transport errors deny this request but are not claimed as an
            // account revocation. An observed denial permanently drops the link.
            if (!failure.unavailable()) { links.remove(hash); if(persistent!=null)persistent.remove(hash,binding); }
            throw failure;
        }
    }

    /** Local logout works even if CS is unavailable; no CS logout/presence call. */
    public void logout(String raw) {
        String hash=sessionHash(raw);
        transaction.executeWithoutResult(status -> sessions.findActiveByTokenHash(hash,clock.instant()).ifPresent(row -> {
            if (!row.getTenantId().equals(binding.tenantId()) || !row.getUser().getId().equals(binding.erpUserId())) throw rejected();
            sessions.revokeScopedSessionIfOpen(row.getId(),binding.tenantId(),binding.erpUserId(),clock.instant());
        }));
        links.remove(hash);
        if(persistent!=null)persistent.remove(hash,binding);
    }

    private UserAccountEntity localUser() {
        var user=users.findByIdAndTenant_Id(binding.erpUserId(),binding.tenantId()).orElseThrow(CustomerServiceIdentityPreparation::rejected);
        if (user.getStatus()!=AccountStatus.ACTIVE || user.getTenant().getStatus()!=TenantStatus.ACTIVE ||
                !access.applicationAccessible(binding.tenantId(),binding.erpUserId(),"ERP")) throw rejected();
        return user;
    }

    private SessionView view(AuthSessionEntity row) {
        return new SessionView(row.getId(),binding.tenantId(),binding.erpUserId(),
                entitlements.filterPermissionCodes(binding.tenantId(),permissions.findCodesByTenantIdAndUserId(binding.tenantId(),binding.erpUserId())),row.getExpiresAt());
    }

    private JsonNode call(String operation, Map<String,String> payload) {
        if (!List.of("verify","exchange","validate").contains(operation)) throw rejected();
        try {
            var request=HttpRequest.newBuilder(base.resolve(PATH+operation)).timeout(Duration.ofSeconds(5))
                    .header("Content-Type","application/json").header("X-XZ-Identity-Service-Token",serviceToken)
                    .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(payload))).build();
            var response=http.send(request,HttpResponse.BodyHandlers.limiting(HttpResponse.BodyHandlers.ofByteArray(),8192));
            if (response.statusCode()!=200) throw new Rejected(response.statusCode()==429 || response.statusCode()>=500);
            if (!response.headers().allValues("Cache-Control").equals(List.of("no-store"))) throw rejected();
            JsonNode value=json.readTree(response.body());
            if (value==null || !value.isObject()) throw rejected();
            return value;
        } catch (Rejected failure) { throw failure;
        } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); throw new Rejected(true);
        } catch (Exception failure) { throw new Rejected(true); }
    }

    private Instant validateClaims(JsonNode value, Duration maximum) {
        if (!"CUSTOMER_SERVICE".equals(text(value,"source")) || !"ERP".equals(text(value,"target")) ||
                !binding.tenantId().toString().equals(text(value,"tenantId")) || !binding.erpUserId().toString().equals(text(value,"erpUserId")) ||
                !binding.customerServiceUserId().equals(text(value,"customerServiceUserId")) || !binding.subjectRef().equals(text(value,"subjectRef")) ||
                !value.path("bindingVersion").isIntegralNumber() || !value.path("bindingVersion").canConvertToLong() || value.path("bindingVersion").asLong()!=binding.version()) throw rejected();
        try {
            Instant expiry=Instant.parse(text(value,"expiresAt"));
            if (!clock.instant().isBefore(expiry) || expiry.isAfter(clock.instant().plus(maximum).plusSeconds(2))) throw rejected();
            return expiry;
        } catch (java.time.DateTimeException failure) { throw rejected(); }
    }
    private Map<String,String> request(String attempt) { return new HashMap<>(Map.of("tenantId",binding.tenantId().toString(),"target","ERP","attempt",attempt)); }
    private String sessionHash(String raw) { if (raw==null || !raw.matches(java.util.regex.Pattern.quote(tokenPrefix)+"[A-Za-z0-9_-]{43}")) throw rejected(); return tokens.hash(raw); }
    /** Only the explicitly enabled runtime bean may opt into normal ERP use.
     * Durable binding/revocation is mandatory; rehearsal tokens stay isolated. */
    public CustomerServiceIdentityPreparation useNativeRuntimeProtocol() {
        if(persistent==null || !links.isEmpty())throw new IllegalStateException("Durable native identity required");
        tokenPrefix="cs-native_";leaseMaximum=Duration.ofHours(8);return this;
    }
    public CustomerServiceIdentityPreparation trustNativeCertificate(javax.net.ssl.SSLContext context) {
        if(!"cs-native_".equals(tokenPrefix) || context==null)throw new IllegalStateException("Native TLS configuration required");
        http.shutdownNow();
        http=HttpClient.newBuilder().sslContext(context).connectTimeout(Duration.ofSeconds(3)).followRedirects(HttpClient.Redirect.NEVER).build();
        return this;
    }
    private static String text(JsonNode node,String field) { if (!node.path(field).isString()) throw rejected(); return node.path(field).asString(); }
    private static String opaque(JsonNode node,String field) { String value=text(node,field); if (!value.matches("[A-Za-z0-9_-]{43}")) throw rejected(); return value; }
    private static boolean safeRef(String value) { return value!=null && value.matches("[A-Za-z0-9._:-]{1,128}"); }
    private static Rejected rejected() { return new Rejected(false); }

    @Override public void close() {
        links.clear();
        http.shutdownNow();
    }
}
