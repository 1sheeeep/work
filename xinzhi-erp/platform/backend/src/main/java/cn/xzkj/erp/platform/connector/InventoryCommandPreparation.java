package cn.xzkj.erp.platform.connector;

import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.InventorySetOutcome;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.InventorySetRequest;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.InventorySetResult;
import cn.xzkj.erp.platform.service.ShopCenterActor;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.Set;
import java.time.Instant;
import java.time.Duration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Explicitly constructed, inventory-only durability rehearsal. No Spring bean,
 * HTTP endpoint, scheduler, migration or existing Gateway replacement.
 * Both participants must use the same journal before a real switch is safe.
 */
public final class InventoryCommandPreparation {
    public enum Provider { CS_STORE_APP, ERP_SAAS_APP }
    public enum State { UNKNOWN, APPLIED, REJECTED }
    public enum Operation { WRITE, ROUTE }
    @FunctionalInterface public interface Authorization {
        // Must check current business permission AND current shop scope on every call.
        void require(ShopCenterActor actor, UUID shopId, Operation operation);
    }
    @FunctionalInterface public interface InventoryWriter {
        InventorySetResult write(UUID tenantId, UUID shopId, InventorySetRequest request);
    }
    public record CustomerServiceActor(UUID tenantId,String originalUserRef) { }
    @FunctionalInterface public interface CustomerServiceAuthorization {
        // Check the ORIGINAL CS account's active state, CS business permission
        // and CS shop scope. Never infer/union ERP roles or require an ERP seat.
        void require(CustomerServiceActor actor,UUID shopId);
    }
    @FunctionalInterface public interface CommandReconciler {
        // Query the ORIGINAL provider's durable command receipt. Current stock
        // matching the target is NOT proof that this particular command applied.
        InventorySetResult lookup(UUID tenantId, UUID shopId, InventorySetRequest original);
    }
    @FunctionalInterface public interface SwitchVerifier {
        CandidateProof verify(UUID tenantId, UUID shopId, Provider candidate, long frozenVersion);
    }
    public record CandidateProof(Provider provider, String shopifyShopId, Set<String> scopes,
            Instant checkedAt, Instant synchronizedThrough, long erpFrozenVersion,
            long customerServiceFrozenVersion, int unresolvedExternalCommands, boolean pluginPreserved) {
        public CandidateProof { scopes=scopes==null?Set.of():Set.copyOf(scopes); }
    }
    public record Receipt(UUID commandId, Provider provider, long routeVersion, State state, String code) { }
    public record Route(Provider provider, long version, boolean frozen) { }
    public static final class Rejected extends RuntimeException {
        public Rejected(String code) { super(code); }
    }

    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final UUID tenantId;
    private final UUID shopId;
    private final Authorization authorization;
    private final Map<Provider, InventoryWriter> writers;
    private final Map<Provider, CommandReconciler> reconcilers;
    private final SwitchVerifier switchVerifier;
    private final String reviewedShopifyShopId;
    private final CustomerServiceAuthorization customerServiceAuthorization;

    public InventoryCommandPreparation(JdbcTemplate db, PlatformTransactionManager transactions,
            UUID tenantId, UUID shopId, Authorization authorization, Map<Provider, InventoryWriter> writers) {
        this(db,transactions,tenantId,shopId,authorization,writers,Map.of(),null,null);
    }

    public InventoryCommandPreparation(JdbcTemplate db, PlatformTransactionManager transactions,
            UUID tenantId, UUID shopId, Authorization authorization, Map<Provider, InventoryWriter> writers,
            Map<Provider, CommandReconciler> reconcilers, SwitchVerifier switchVerifier, String reviewedShopifyShopId) {
        this(db,transactions,tenantId,shopId,authorization,writers,reconcilers,switchVerifier,reviewedShopifyShopId,null);
    }
    public InventoryCommandPreparation(JdbcTemplate db, PlatformTransactionManager transactions,
            UUID tenantId, UUID shopId, Authorization authorization, Map<Provider, InventoryWriter> writers,
            Map<Provider, CommandReconciler> reconcilers, SwitchVerifier switchVerifier, String reviewedShopifyShopId,
            CustomerServiceAuthorization customerServiceAuthorization) {
        this.db = Objects.requireNonNull(db);
        this.tenantId = Objects.requireNonNull(tenantId);
        this.shopId = Objects.requireNonNull(shopId);
        this.authorization = Objects.requireNonNull(authorization);
        this.writers = Map.copyOf(writers);
        this.reconcilers=Map.copyOf(reconcilers);
        this.switchVerifier=switchVerifier;
        this.reviewedShopifyShopId=reviewedShopifyShopId;
        this.customerServiceAuthorization=customerServiceAuthorization;
        if (this.writers.size() != Provider.values().length) throw new Rejected("PROVIDERS_UNREVIEWED");
        tx = new TransactionTemplate(Objects.requireNonNull(transactions));
        // The intent MUST commit before any network I/O, even under an outer transaction.
        tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        tx.setTimeout(5);
    }

    /** Read-only lookup upstream, then audit a definitive original-source receipt.
     * There is deliberately no manual force-success/force-reject API. */
    public Receipt reconcile(ShopCenterActor actor, UUID commandId) {
        require(actor, Operation.ROUTE);
        if(commandId==null)throw new Rejected("COMMAND_INVALID");
        var commands=db.query("""
                SELECT provider,route_version,state,safe_code,inventory_item,location,expected_available,
                       target_available,idempotency_key FROM integration_preparation.inventory_commands
                WHERE tenant_id=? AND shop_id=? AND command_id=?
                """,(rs,row)->new Reconciliation(new Receipt(commandId,Provider.valueOf(rs.getString(1)),
                        rs.getLong(2),State.valueOf(rs.getString(3)),rs.getString(4)),
                        new InventorySetRequest(rs.getString(5),rs.getString(6),rs.getInt(7),rs.getInt(8),rs.getString(9),commandId)),tenantId,shopId,commandId);
        if(commands.size()!=1)throw new Rejected("COMMAND_NOT_FOUND");
        var command=commands.getFirst();var original=command.receipt();
        if(original.state()!=State.UNKNOWN)return original;
        var reconciler=reconcilers.get(original.provider());
        if(reconciler==null)throw new Rejected("ORIGINAL_SOURCE_RECONCILIATION_UNAVAILABLE");
        try {
            var result=reconciler.lookup(tenantId,shopId,command.request());
            var state=classify(command.request(),result);
            if(state==State.UNKNOWN)return original;
            String code=state==State.APPLIED?"APPLIED":result.safeErrorCode();
            return tx.execute(status->{
                require(actor,Operation.ROUTE);
                lockedRoute();
                int changed=db.update("""
                        UPDATE integration_preparation.inventory_commands SET state=?,safe_code=?,completed_at=clock_timestamp()
                        WHERE tenant_id=? AND shop_id=? AND command_id=? AND provider=? AND route_version=? AND state='UNKNOWN'
                        """,state.name(),code,tenantId,shopId,commandId,original.provider().name(),original.routeVersion());
                if(changed!=1)return original;
                db.update("""
                        INSERT INTO integration_preparation.inventory_reconciliation_audit
                        (tenant_id,shop_id,command_id,reviewer_id,provider,route_version,state)
                        VALUES(?,?,?,?,?,?,?)
                        """,tenantId,shopId,commandId,actor.userId(),original.provider().name(),original.routeVersion(),state.name());
                return new Receipt(commandId,original.provider(),original.routeVersion(),state,code);
            });
        } catch(RuntimeException unavailable) {return original;}
    }

    /** Called only by an authenticated, source-pinned internal adapter. Never
     * creates a command. The existing journal reservation is consumed exactly
     * once, across processes. Service authentication is not actor authorization. */
    public boolean claimSource(Provider authenticatedSource,long expectedVersion,InventorySetRequest request) {
        validate(request);
        if(authenticatedSource==null || expectedVersion<1)throw new Rejected("SOURCE_CLAIM_INVALID");
        return Boolean.TRUE.equals(tx.execute(status->{
            Route route=lockedRoute();
            if(route.provider()!=authenticatedSource || !(route.version()==expectedVersion
                    || (route.frozen() && route.version()==Math.addExact(expectedVersion,1))))return false;
            var actors=db.query("""
                    SELECT actor_id,origin_business,cs_actor_ref FROM integration_preparation.inventory_commands WHERE tenant_id=? AND shop_id=?
                    AND command_id=? AND payload_digest=? AND provider=? AND route_version=? AND state='UNKNOWN'
                    AND source_claimed_at IS NULL FOR UPDATE
                    """,(rs,n)->new CommandActor(rs.getObject(1,UUID.class),rs.getString(2),rs.getString(3)),tenantId,shopId,request.publicationId(),digest(request),authenticatedSource.name(),expectedVersion);
            if(actors.size()!=1)return false;
            requireCommandActor(actors.getFirst());
            return db.update("""
                    UPDATE integration_preparation.inventory_commands SET source_claimed_at=clock_timestamp()
                    WHERE tenant_id=? AND shop_id=? AND command_id=? AND source_claimed_at IS NULL
                    """,tenantId,shopId,request.publicationId())==1;
        }));
    }

    /** Source-authenticated transport gate. Priority follows the journaled
     * ORIGINAL business, never the selected app source or caller headers. */
    public ShopifyCoordinationPreparation.Priority authorizeClaimedSourceBudget(Provider authenticatedSource,UUID commandId) {
        if(authenticatedSource==null || commandId==null)throw new Rejected("SOURCE_CLAIM_INVALID");
        var actors=db.query("""
                SELECT actor_id,origin_business,cs_actor_ref FROM integration_preparation.inventory_commands
                WHERE tenant_id=? AND shop_id=? AND command_id=? AND provider=? AND state='UNKNOWN' AND source_claimed_at IS NOT NULL
                """,(rs,n)->new CommandActor(rs.getObject(1,UUID.class),rs.getString(2),rs.getString(3)),tenantId,shopId,commandId,authenticatedSource.name());
        if(actors.size()!=1)throw new Rejected("SOURCE_CLAIM_INVALID");
        requireCommandActor(actors.getFirst());
        return "CS".equals(actors.getFirst().business())?ShopifyCoordinationPreparation.Priority.CUSTOMER_SERVICE_FOREGROUND:ShopifyCoordinationPreparation.Priority.ERP_BACKGROUND;
    }

    public Receipt execute(ShopCenterActor actor, long expectedVersion, InventorySetRequest request) {
        require(actor, Operation.WRITE);
        return executeCommand(new CommandActor(actor.userId(),"ERP",null),expectedVersion,request);
    }
    public Receipt executeCustomerService(CustomerServiceActor actor,long expectedVersion,InventorySetRequest request) {
        if(actor==null || !tenantId.equals(actor.tenantId()))throw new Rejected("ACCESS_DENIED");
        CommandActor commandActor=new CommandActor(null,"CS",actor.originalUserRef());
        requireCommandActor(commandActor);
        return executeCommand(commandActor,expectedVersion,request);
    }
    private Receipt executeCommand(CommandActor actor,long expectedVersion,InventorySetRequest request) {
        validate(request);
        if (expectedVersion <= 0) throw new Rejected("ROUTE_VERSION_INVALID");
        String digest = digest(request);
        Reservation reservation = tx.execute(status -> {
            Route route = lockedRoute();
            var existing = db.query("""
                    SELECT command_id,actor_id,origin_business,cs_actor_ref,payload_digest,provider,route_version,state,safe_code
                    FROM integration_preparation.inventory_commands
                    WHERE tenant_id=? AND shop_id=? AND (command_id=? OR idempotency_key=?)
                    """, (rs, row) -> {
                if (!request.publicationId().equals(rs.getObject("command_id", UUID.class))
                        || !Objects.equals(actor.erpUserId(),rs.getObject("actor_id", UUID.class))
                        || !actor.business().equals(rs.getString("origin_business"))
                        || !Objects.equals(actor.csUserRef(),rs.getString("cs_actor_ref"))
                        || !digest.equals(rs.getString("payload_digest"))
                        || expectedVersion != rs.getLong("route_version")) throw new Rejected("COMMAND_CONFLICT");
                return new Receipt(request.publicationId(), Provider.valueOf(rs.getString("provider")),
                        rs.getLong("route_version"), State.valueOf(rs.getString("state")), rs.getString("safe_code"));
            }, tenantId, shopId, request.publicationId(), request.idempotencyKey());
            // A replay returns the original receipt, never the new source's response.
            if (!existing.isEmpty()) return new Reservation(existing.getFirst(), false);
            if (route.version() != expectedVersion || route.frozen()) throw new Rejected("ROUTE_NOT_WRITABLE");
            Integer unresolved = db.queryForObject("""
                    SELECT count(*) FROM integration_preparation.inventory_commands
                    WHERE tenant_id=? AND shop_id=? AND inventory_item=? AND location=? AND state='UNKNOWN'
                    """, Integer.class, tenantId, shopId, request.externalInventoryItemRef(), request.externalLocationRef());
            if (unresolved != null && unresolved > 0) throw new Rejected("RESOURCE_RECONCILIATION_REQUIRED");
            db.update("""
                    INSERT INTO integration_preparation.inventory_commands
                    (tenant_id,shop_id,command_id,actor_id,origin_business,cs_actor_ref,payload_digest,idempotency_key,inventory_item,location,
                     expected_available,target_available,provider,route_version,state,safe_code)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'UNKNOWN','WRITE_RECONCILIATION_REQUIRED')
                    """, tenantId, shopId, request.publicationId(), actor.erpUserId(),actor.business(),actor.csUserRef(), digest,
                    request.idempotencyKey(), request.externalInventoryItemRef(), request.externalLocationRef(),
                    request.expectedAvailable(), request.targetAvailable(), route.provider().name(), route.version());
            return new Reservation(new Receipt(request.publicationId(), route.provider(), route.version(),
                    State.UNKNOWN, "WRITE_RECONCILIATION_REQUIRED"), true);
        });
        if (reservation == null) throw new Rejected("JOURNAL_UNAVAILABLE");
        Receipt initial = reservation.receipt();
        if (!reservation.owned()) return initial;
        try {
            // Recheck after durable reservation. A revoked request stays blocked; no fallback.
            requireCommandActor(actor);
            InventorySetResult result = writers.get(initial.provider()).write(tenantId, shopId, request);
            State outcome = classify(request, result);
            if (outcome == State.UNKNOWN) return initial;
            String code = outcome == State.APPLIED ? "APPLIED" : result.safeErrorCode();
            Integer changed = tx.execute(status -> db.update("""
                    UPDATE integration_preparation.inventory_commands SET state=?,safe_code=?,completed_at=clock_timestamp()
                    WHERE tenant_id=? AND shop_id=? AND command_id=? AND payload_digest=?
                      AND provider=? AND route_version=? AND state='UNKNOWN'
                    """, outcome.name(), code, tenantId, shopId, request.publicationId(), digest,
                    initial.provider().name(), initial.routeVersion()));
            if (changed == null || changed != 1) return initial;
            return new Receipt(initial.commandId(), initial.provider(), initial.routeVersion(), outcome, code);
        } catch (RuntimeException failure) {
            // No exception details or upstream bodies in receipts/logs; never retry here.
            return initial;
        }
    }

    /** Freeze new commands first; in-flight owners may still record their original reply. */
    public Route freeze(ShopCenterActor actor, long expectedVersion) {
        require(actor, Operation.ROUTE);
        return tx.execute(status -> {
            Route current = lockedRoute();
            if (current.version() != expectedVersion || current.frozen()) throw new Rejected("ROUTE_CONFLICT");
            return updateRoute(current.provider(), Math.addExact(current.version(), 1), true);
        });
    }

    /**
     * Local journal barrier only, NOT production switch acceptance. Candidate identity,
     * scopes/checkpoints and both services' adoption must be verified by the caller.
     * No force/ignore-unknown/automatic timeout expiry is provided.
     */
    public Route activateReviewedCandidate(ShopCenterActor actor, long frozenVersion, Provider candidate) {
        require(actor, Operation.ROUTE);
        if (candidate == null || !writers.containsKey(candidate)) throw new Rejected("PROVIDER_UNREVIEWED");
        return tx.execute(status -> {
            Route current = lockedRoute();
            if (!current.frozen() || current.version() != frozenVersion) throw new Rejected("ROUTE_CONFLICT");
            Integer pending = db.queryForObject("""
                    SELECT count(*) FROM integration_preparation.inventory_commands
                    WHERE tenant_id=? AND shop_id=? AND state='UNKNOWN'
                    """, Integer.class, tenantId, shopId);
            if (pending == null || pending != 0) throw new Rejected("WRITE_RECONCILIATION_REQUIRED");
            verifyCandidate(candidate,frozenVersion);
            return updateRoute(candidate, Math.addExact(current.version(), 1), false);
        });
    }

    private void verifyCandidate(Provider candidate,long frozenVersion) {
        if(switchVerifier==null || reviewedShopifyShopId==null || !reviewedShopifyShopId.matches("gid://shopify/Shop/[1-9][0-9]{0,19}"))throw new Rejected("SWITCH_PROOF_REQUIRED");
        CandidateProof proof=switchVerifier.verify(tenantId,shopId,candidate,frozenVersion);
        Instant now=Instant.now();
        if(proof==null || proof.provider()!=candidate || !reviewedShopifyShopId.equals(proof.shopifyShopId())
                || !proof.scopes().containsAll(Set.of("write_inventory","read_locations"))
                || proof.checkedAt()==null || proof.checkedAt().isAfter(now) || proof.checkedAt().isBefore(now.minusSeconds(60))
                || proof.synchronizedThrough()==null || proof.synchronizedThrough().isAfter(proof.checkedAt())
                || Duration.between(proof.synchronizedThrough(),proof.checkedAt()).compareTo(Duration.ofSeconds(60))>0
                || proof.erpFrozenVersion()!=frozenVersion || proof.customerServiceFrozenVersion()!=frozenVersion
                || proof.unresolvedExternalCommands()!=0 || !proof.pluginPreserved()) throw new Rejected("SWITCH_PROOF_INVALID");
    }

    private void require(ShopCenterActor actor, Operation operation) {
        if (actor == null || actor.userId() == null || actor.systemAdminId() != null
                || !tenantId.equals(actor.tenantId())) throw new Rejected("ACCESS_DENIED");
        authorization.require(actor, shopId, operation);
    }
    private void requireCommandActor(CommandActor actor) {
        if("ERP".equals(actor.business())) {
            require(new ShopCenterActor(tenantId,actor.erpUserId(),null,"preparation-command","internal"),Operation.WRITE);
        }else if("CS".equals(actor.business()) && actor.erpUserId()==null && actor.csUserRef()!=null
                && actor.csUserRef().matches("[A-Za-z0-9_-]{1,128}") && customerServiceAuthorization!=null) {
            customerServiceAuthorization.require(new CustomerServiceActor(tenantId,actor.csUserRef()),shopId);
        }else throw new Rejected("ACCESS_DENIED");
    }

    private Route lockedRoute() {
        var routes = db.query("""
                SELECT provider,version,frozen FROM integration_preparation.inventory_routes
                WHERE tenant_id=? AND shop_id=? FOR UPDATE
                """, (rs, row) -> new Route(Provider.valueOf(rs.getString(1)), rs.getLong(2), rs.getBoolean(3)), tenantId, shopId);
        if (routes.size() != 1) throw new Rejected("ROUTE_UNREVIEWED");
        return routes.getFirst();
    }

    private Route updateRoute(Provider provider, long version, boolean frozen) {
        if (db.update("""
                UPDATE integration_preparation.inventory_routes SET provider=?,version=?,frozen=?
                WHERE tenant_id=? AND shop_id=?
                """, provider.name(), version, frozen, tenantId, shopId) != 1) throw new Rejected("ROUTE_CONFLICT");
        return new Route(provider, version, frozen);
    }

    private static void validate(InventorySetRequest r) {
        if (r == null || r.publicationId() == null || r.idempotencyKey() == null || !r.idempotencyKey().matches("[A-Za-z0-9._:-]{1,100}")
                || r.externalInventoryItemRef() == null || !r.externalInventoryItemRef().matches("gid://shopify/InventoryItem/[1-9][0-9]{0,19}")
                || r.externalLocationRef() == null || !r.externalLocationRef().matches("gid://shopify/Location/[1-9][0-9]{0,19}")
                || r.expectedAvailable() < -1_000_000_000 || r.expectedAvailable() > 1_000_000_000
                || r.targetAvailable() < -1_000_000_000 || r.targetAvailable() > 1_000_000_000) {
            throw new Rejected("INVENTORY_COMMAND_INVALID");
        }
    }

    private static State classify(InventorySetRequest request, InventorySetResult result) {
        if (result == null || result.updatedAt() == null || result.outcome() == null
                || !request.externalInventoryItemRef().equals(result.externalInventoryItemRef())
                || !request.externalLocationRef().equals(result.externalLocationRef())
                || request.expectedAvailable() != result.expectedAvailable() || request.targetAvailable() != result.targetAvailable()) return State.UNKNOWN;
        if (result.outcome() == InventorySetOutcome.APPLIED && (result.safeErrorCode() == null || result.safeErrorCode().isEmpty())) return State.APPLIED;
        if (result.outcome() == InventorySetOutcome.STALE && "SHOPIFY_INVENTORY_STALE".equals(result.safeErrorCode())) return State.REJECTED;
        if (result.outcome() == InventorySetOutcome.REJECTED && "SHOPIFY_INVENTORY_REJECTED".equals(result.safeErrorCode())) return State.REJECTED;
        // Busy/conflict/failed idempotency replies do NOT establish a no-effect outcome.
        return State.UNKNOWN;
    }

    private static String digest(InventorySetRequest request) {
        String value = String.join("\n", "inventory-command-v1", request.publicationId().toString(),
                request.idempotencyKey(), request.externalInventoryItemRef(), request.externalLocationRef(),
                Integer.toString(request.expectedAvailable()), Integer.toString(request.targetAvailable()));
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException("SHA256_UNAVAILABLE"); }
    }

    private record Reservation(Receipt receipt, boolean owned) { }
    private record Reconciliation(Receipt receipt,InventorySetRequest request) { }
    private record CommandActor(UUID erpUserId,String business,String csUserRef) { }
}
