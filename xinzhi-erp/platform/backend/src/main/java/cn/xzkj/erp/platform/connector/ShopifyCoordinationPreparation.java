package cn.xzkj.erp.platform.connector;

import java.time.Instant;
import java.sql.Timestamp;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/** Explicit source-only coordinator. No routes, bean, timer or external I/O.
 * Both businesses must call the SAME durable coordinator before using an app.
 * Source owners retain webhook HMAC verification and raw payloads/credentials. */
public final class ShopifyCoordinationPreparation {
    public enum Priority { CUSTOMER_SERVICE_FOREGROUND, ERP_BACKGROUND }
    public enum EventOutcome { APPLIED, DUPLICATE, STALE, CONFLICT }
    public record Budget(boolean allowed, long retryAfterSeconds) { }
    public record VerifiedEvent(String deliveryId,String topic,String resourceRef,Instant version,String payloadDigest) { }
    public record VerifiedOrderPage(List<VerifiedEvent> events,boolean hasNextPage,String endCursor) {
        public VerifiedOrderPage { events=List.copyOf(events); }
    }
    @FunctionalInterface public interface VerifiedOrderPageReader {
        // Trusted source-owner adapter only: validate installation/shop/scopes,
        // apply the inclusive updated-at window, reject partial GraphQL errors
        // and truncated nested data, and use bounded I/O with no hidden retry.
        // Not a browser callback or proof of access to all historical orders.
        VerifiedOrderPage read(Instant from,Instant through,String after,int limit);
    }
    @FunctionalInterface public interface SourceAuthorization {
        // Recheck source installation + stable Shopify identity on every call.
        void require(UUID tenant,UUID shop,String appRef);
    }
    @FunctionalInterface public interface EventProjection {
        // Must write only through this transaction's JdbcTemplate. No network or
        // external side effect: receipt/version/projection commit atomically.
        void apply(JdbcTemplate transaction,VerifiedEvent event);
    }
    private static final List<String> TOPICS=List.of("orders/updated","products/update","inventory_levels/update");
    private final JdbcTemplate db;private final TransactionTemplate tx;
    private final UUID tenant,shop;private final String app;private final SourceAuthorization authorization;
    public ShopifyCoordinationPreparation(JdbcTemplate db,PlatformTransactionManager manager,UUID tenant,UUID shop,String app,SourceAuthorization authorization) {
        this.db=Objects.requireNonNull(db);this.tenant=Objects.requireNonNull(tenant);this.shop=Objects.requireNonNull(shop);
        if(app==null || !app.matches("[A-Za-z0-9_-]{1,128}"))throw rejected("SOURCE_INVALID");
        this.app=app;this.authorization=Objects.requireNonNull(authorization);tx=new TransactionTemplate(manager);
        tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);tx.setTimeout(5);
    }
    /** Cost reservation is pessimistic; an unknown response never refunds cost.
     * Rate data must have been explicitly installed from a verified source observation.
     * No automatic sleeps/retries, particularly not on mutations. */
    public Budget reserve(Priority priority,int requestedCost) {
        require();if(priority==null || requestedCost<1 || requestedCost>1000)throw rejected("COST_INVALID");
        return tx.execute(status->{
            var budgets=db.query("""
                    SELECT capacity,LEAST(capacity,available+GREATEST(0,extract(epoch FROM clock_timestamp()-updated_at))*restore_rate),
                           restore_rate,foreground_reserve,observed_at<clock_timestamp()-interval '5 minutes' OR observed_at>clock_timestamp()
                    FROM integration_preparation.shopify_budget WHERE tenant_id=? AND shop_id=? AND app_ref=? FOR UPDATE
                    """,(rs,n)->new double[]{rs.getDouble(1),rs.getDouble(2),rs.getDouble(3),rs.getDouble(4),rs.getBoolean(5)?1:0},tenant,shop,app);
            if(budgets.size()!=1 || budgets.getFirst()[4]!=0)throw rejected("BUDGET_OBSERVATION_REQUIRED");
            double[] b=budgets.getFirst();double reserve=priority==Priority.ERP_BACKGROUND?b[3]:0;
            if(requestedCost+reserve>b[0])return new Budget(false,60);
            if(b[1]<requestedCost+reserve)return new Budget(false,Math.max(1,(long)Math.ceil((requestedCost+reserve-b[1])/b[2])));
            db.update("UPDATE integration_preparation.shopify_budget SET available=?,updated_at=clock_timestamp() WHERE tenant_id=? AND shop_id=? AND app_ref=?",b[1]-requestedCost,tenant,shop,app);
            return new Budget(true,0);
        });
    }
    /** Conservative feedback: concurrent/out-of-order responses may lower the
     * balance but never inflate it. Reservations are not refunded on retry. */
    public void observeThrottle(double capacity,double currentlyAvailable,double restoreRate) {
        require();if(!Double.isFinite(capacity) || !Double.isFinite(currentlyAvailable) || !Double.isFinite(restoreRate)
                || capacity<=0 || capacity>100000 || currentlyAvailable<0 || currentlyAvailable>capacity || restoreRate<=0 || restoreRate>10000)throw rejected("BUDGET_RESPONSE_INVALID");
        tx.executeWithoutResult(status->{
            int changed=db.update("""
                    UPDATE integration_preparation.shopify_budget SET capacity=LEAST(capacity,?),available=LEAST(available,?),restore_rate=LEAST(restore_rate,?),
                    observed_at=clock_timestamp(),updated_at=clock_timestamp()
                    WHERE tenant_id=? AND shop_id=? AND app_ref=? AND foreground_reserve<?
                    """,capacity,currentlyAvailable,restoreRate,tenant,shop,app,capacity);
            if(changed!=1)throw rejected("BUDGET_OBSERVATION_REQUIRED");
        });
    }
    /** Only owner-verified deliveries for the allowlisted data topics. Privacy,
     * uninstall and revocation MUST continue through each app's existing owner
     * handler, irrespective of active business source; never deduped here. */
    public EventOutcome acceptVerified(VerifiedEvent event,EventProjection projection) {
        require();validate(event);Objects.requireNonNull(projection);
        return tx.execute(status->{
            // Shared resource lock across APP identities; also serializes first
            // insert when there is no projection row yet. Hash collisions only
            // reduce concurrency, never merge identities in the actual keys.
            lockTopic(event.topic());
            db.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0))",Object.class,tenant+":"+shop+":"+event.topic()+":"+event.resourceRef());
            var duplicate=db.query("""
                    SELECT topic,resource_ref,resource_version,payload_digest,outcome FROM integration_preparation.shopify_deliveries
                    WHERE tenant_id=? AND shop_id=? AND app_ref=? AND delivery_id=?
                    """,(rs,n)->{
                if(!rs.getString(1).equals(event.topic()) || !rs.getString(2).equals(event.resourceRef())
                        || !rs.getTimestamp(3).toInstant().equals(event.version()) || !rs.getString(4).equals(event.payloadDigest()))throw rejected("DELIVERY_CONFLICT");
                return EventOutcome.valueOf(rs.getString(5));
            },tenant,shop,app,event.deliveryId());
            if(!duplicate.isEmpty())return duplicate.getFirst()==EventOutcome.CONFLICT?EventOutcome.CONFLICT:EventOutcome.DUPLICATE;
            var current=db.query("""
                    SELECT resource_version,payload_digest FROM integration_preparation.shopify_resource_versions
                    WHERE tenant_id=? AND shop_id=? AND topic=? AND resource_ref=? FOR UPDATE
                    """,(rs,n)->new VerifiedEvent("",event.topic(),event.resourceRef(),rs.getTimestamp(1).toInstant(),rs.getString(2)),tenant,shop,event.topic(),event.resourceRef());
            EventOutcome outcome=EventOutcome.APPLIED;
            if(!current.isEmpty()) {
                var previous=current.getFirst();int order=event.version().compareTo(previous.version());
                if(order<0)outcome=EventOutcome.STALE;
                else if(order==0)outcome=previous.payloadDigest().equals(event.payloadDigest())?EventOutcome.DUPLICATE:EventOutcome.CONFLICT;
            }
            if(outcome==EventOutcome.APPLIED) {
                projection.apply(db,event);
                db.update("""
                        INSERT INTO integration_preparation.shopify_resource_versions VALUES(?,?,?,?,?,?)
                        ON CONFLICT(tenant_id,shop_id,topic,resource_ref) DO UPDATE SET resource_version=excluded.resource_version,payload_digest=excluded.payload_digest
                        """,tenant,shop,event.topic(),event.resourceRef(),Timestamp.from(event.version()),event.payloadDigest());
            }
            db.update("INSERT INTO integration_preparation.shopify_deliveries(tenant_id,shop_id,app_ref,delivery_id,topic,resource_ref,resource_version,payload_digest,outcome) VALUES(?,?,?,?,?,?,?,?,?)",
                    tenant,shop,app,event.deliveryId(),event.topic(),event.resourceRef(),Timestamp.from(event.version()),event.payloadDigest(),outcome.name());
            return outcome;
        });
    }
    /** The caller advances this only after ALL pages through the chosen cutoff
     * were durably applied. A failed page/ambiguous event cannot advance it. */
    public void advanceReconciledCheckpoint(String topic,Instant through,boolean allPagesApplied) {
        require();if(!TOPICS.contains(topic) || through==null || through.isAfter(Instant.now()) || !allPagesApplied)throw rejected("CHECKPOINT_INCOMPLETE");
        tx.executeWithoutResult(status->{
            lockTopic(topic);
            Integer conflicts=db.queryForObject("SELECT count(*) FROM integration_preparation.shopify_deliveries WHERE tenant_id=? AND shop_id=? AND topic=? AND outcome='CONFLICT'",Integer.class,tenant,shop,topic);
            if(conflicts==null || conflicts!=0)throw rejected("EVENT_RECONCILIATION_REQUIRED");
            db.update("""
                    INSERT INTO integration_preparation.shopify_reconciliation_checkpoints VALUES(?,?,?,?,?)
                    ON CONFLICT(tenant_id,shop_id,app_ref,topic) DO UPDATE SET synchronized_through=GREATEST(integration_preparation.shopify_reconciliation_checkpoints.synchronized_through,excluded.synchronized_through)
                    """,tenant,shop,app,topic,Timestamp.from(through));
        });
    }
    /** Bounded local preparation runner; no scheduler or production registration.
     * On failure, committed events remain deduplicable but the checkpoint stays
     * put. Retry starts at the same inclusive window, not an uncommitted cursor.
     * One owner request per page must fit the conservative 1000-point reserve. */
    public int reconcileOrderWindow(Instant from,Instant through,VerifiedOrderPageReader reader,EventProjection projection) {
        require();Objects.requireNonNull(reader);Objects.requireNonNull(projection);
        if(from==null || through==null || from.isAfter(through) || through.isAfter(Instant.now())
                || from.getNano()%1000!=0 || through.getNano()%1000!=0
                || java.time.Duration.between(from,through).compareTo(java.time.Duration.ofDays(1))>0)
            throw rejected("RECONCILIATION_WINDOW_INVALID");
        var checkpoints=db.query("SELECT synchronized_through FROM integration_preparation.shopify_reconciliation_checkpoints WHERE tenant_id=? AND shop_id=? AND app_ref=? AND topic='orders/updated'",
                (rs,n)->rs.getTimestamp(1).toInstant(),tenant,shop,app);
        if(!checkpoints.isEmpty() && from.isAfter(checkpoints.getFirst()))throw rejected("RECONCILIATION_WINDOW_GAP");
        String cursor=null;var cursors=new java.util.HashSet<String>();
        for(int pageNumber=1;pageNumber<=25;pageNumber++) {
            if(!reserve(Priority.ERP_BACKGROUND,1000).allowed())throw rejected("RECONCILIATION_BUDGET_UNAVAILABLE");
            require();
            var page=reader.read(from,through,cursor,25);
            require();
            if(page==null || page.events().size()>25 || (page.hasNextPage()
                    && (page.events().isEmpty() || page.endCursor()==null || page.endCursor().isBlank()
                    || page.endCursor().length()>4096 || !cursors.add(page.endCursor()))))
                throw rejected("RECONCILIATION_PAGE_INVALID");
            // Validate the whole page before allowing any of its projections.
            for(var event:page.events()) {
                validate(event);
                if(!event.topic().equals("orders/updated") || event.version().isBefore(from) || event.version().isAfter(through))
                    throw rejected("RECONCILIATION_PAGE_INVALID");
            }
            for(var event:page.events())if(acceptVerified(event,projection)==EventOutcome.CONFLICT)
                throw rejected("EVENT_RECONCILIATION_REQUIRED");
            if(!page.hasNextPage()) {
                advanceReconciledCheckpoint("orders/updated",through,true);
                return pageNumber;
            }
            cursor=page.endCursor();
        }
        throw rejected("RECONCILIATION_PAGE_LIMIT");
    }
    private void validate(VerifiedEvent e) {
        if(e==null || e.deliveryId()==null || !e.deliveryId().matches("[A-Za-z0-9_-]{1,128}") || !TOPICS.contains(e.topic())
                || e.resourceRef()==null || !validResource(e.topic(),e.resourceRef())
                || e.version()==null || e.version().isAfter(Instant.now()) || e.version().getNano()%1000!=0
                || e.payloadDigest()==null || !e.payloadDigest().matches("[a-f0-9]{64}"))throw rejected("EVENT_INVALID");
    }
    private static boolean validResource(String topic,String resource) {
        String id="[1-9][0-9]{0,19}";
        return switch(topic) {
            case "orders/updated" -> resource.matches("gid://shopify/Order/"+id);
            case "products/update" -> resource.matches("gid://shopify/Product/"+id);
            // Canonical owner-normalized pair, not a fabricated Shopify GID.
            case "inventory_levels/update" -> resource.matches("inventory-item:"+id+":location:"+id);
            default -> false;
        };
    }
    private void lockTopic(String topic) {
        // Small preparation slice: serialize event commits with checkpoint
        // review so a concurrent conflict cannot slip past its final check.
        db.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0))",Object.class,tenant+":"+shop+":topic:"+topic);
    }
    private void require(){authorization.require(tenant,shop,app);}
    private static InventoryCommandPreparation.Rejected rejected(String code){return new InventoryCommandPreparation.Rejected(code);}
}
