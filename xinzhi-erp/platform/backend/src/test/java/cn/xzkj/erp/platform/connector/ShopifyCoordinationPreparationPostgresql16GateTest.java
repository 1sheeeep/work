package cn.xzkj.erp.platform.connector;

import static org.assertj.core.api.Assertions.*;
import cn.xzkj.erp.platform.connector.ShopifyCoordinationPreparation.*;
import java.nio.file.*;
import java.time.Instant;
import java.sql.Timestamp;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.*;
import org.testcontainers.containers.PostgreSQLContainer;

class ShopifyCoordinationPreparationPostgresql16GateTest {
    private static final UUID TENANT=UUID.fromString("11111111-1111-4111-8111-111111111111"),SHOP=UUID.fromString("22222222-2222-4222-8222-222222222222");
    private static PostgreSQLContainer<?> postgres;private static JdbcTemplate db;private static DataSourceTransactionManager manager;
    @BeforeAll static void start()throws Exception {
        postgres=new PostgreSQLContainer<>("postgres:16-alpine").withImagePullPolicy(image->false)
                .withDatabaseName("owned_coordination").withUsername("synthetic").withPassword("synthetic");postgres.start();
        try {var ds=new DriverManagerDataSource(postgres.getJdbcUrl(),postgres.getUsername(),postgres.getPassword());db=new JdbcTemplate(ds);manager=new DataSourceTransactionManager(ds);
            db.execute(Files.readString(Path.of("../preparation/sql/shopify-coordination.sql")));
            db.execute("CREATE TABLE integration_preparation.owned_projection (resource_ref text primary key, digest text not null)");
        }catch(Exception error){postgres.close();throw error;}
    }
    @AfterAll static void stop(){if(postgres!=null)postgres.close();}
    @BeforeEach void seed(){
        db.execute("TRUNCATE integration_preparation.shopify_budget,integration_preparation.shopify_deliveries,integration_preparation.shopify_resource_versions,integration_preparation.shopify_reconciliation_checkpoints,integration_preparation.owned_projection");
        db.update("INSERT INTO integration_preparation.shopify_budget VALUES(?,?,'app-a',100,100,0.001,20,clock_timestamp(),clock_timestamp())",TENANT,SHOP);
    }
    private static ShopifyCoordinationPreparation source(String app){return new ShopifyCoordinationPreparation(db,manager,TENANT,SHOP,app,(tenant,shop,ref)->{});}
    private static VerifiedEvent event(String delivery,String topic,Instant version,String digest){return new VerifiedEvent(delivery,topic,"gid://shopify/Order/1",version,digest.repeat(64));}
    private static void project(JdbcTemplate transaction,VerifiedEvent event){transaction.update("INSERT INTO integration_preparation.owned_projection VALUES(?,?) ON CONFLICT(resource_ref) DO UPDATE SET digest=excluded.digest",event.resourceRef(),event.payloadDigest());}

    private static void pageBudget(){db.execute("UPDATE integration_preparation.shopify_budget SET capacity=50000,available=50000,foreground_reserve=100");}
    private static int checkpointCount(){return db.queryForObject("SELECT count(*) FROM integration_preparation.shopify_reconciliation_checkpoints",Integer.class);}

    @Test void orderPagesResumeByDeduplicationOnlyAndCheckpointAfterFinalPage(){
        pageBudget();var a=source("app-a");var through=Instant.parse("2026-09-01T01:00:00Z");var from=through.minusSeconds(3600);
        var first=event("page-one","orders/updated",from,"a");var calls=new AtomicInteger();var projections=new AtomicInteger();
        VerifiedOrderPageReader failing=(f,t,c,limit)->{
            assertThat(f).isEqualTo(from);assertThat(t).isEqualTo(through);assertThat(limit).isEqualTo(25);
            calls.incrementAndGet();if(c!=null)throw new IllegalStateException("synthetic timeout");
            return new VerifiedOrderPage(java.util.List.of(first),true,"next-one");
        };
        assertThatThrownBy(()->a.reconcileOrderWindow(from,through,failing,(d,e)->{project(d,e);projections.incrementAndGet();})).hasMessage("synthetic timeout");
        assertThat(calls.get()).isEqualTo(2);assertThat(checkpointCount()).isZero();assertThat(projections.get()).isEqualTo(1);
        // New object, same durable journal: replay first page without duplicate projection.
        int pages=source("app-a").reconcileOrderWindow(from,through,(f,t,c,limit)->c==null
                ?new VerifiedOrderPage(java.util.List.of(first),true,"next-one")
                :new VerifiedOrderPage(java.util.List.of(event("page-two","orders/updated",through,"b")),false,null),
                (d,e)->{project(d,e);projections.incrementAndGet();});
        assertThat(pages).isEqualTo(2);assertThat(checkpointCount()).isEqualTo(1);assertThat(projections.get()).isEqualTo(2);
        assertThat(db.queryForObject("SELECT available FROM integration_preparation.shopify_budget",Double.class)).isLessThan(46001);
    }
    @Test void orderPagingCannotSpendCustomerServiceReserveOrSkipAWindow(){
        var through=Instant.parse("2026-09-01T01:00:00Z");var from=through.minusSeconds(3600);
        assertThatThrownBy(()->source("app-a").reconcileOrderWindow(from,through,(f,t,c,l)->{throw new AssertionError("must not call source");},(d,e)->{}))
                .hasMessage("RECONCILIATION_BUDGET_UNAVAILABLE");
        assertThat(checkpointCount()).isZero();pageBudget();source("app-a").advanceReconciledCheckpoint("orders/updated",from,true);
        assertThatThrownBy(()->source("app-a").reconcileOrderWindow(from.plusSeconds(1),through,(f,t,c,l)->{throw new AssertionError();},(d,e)->{}))
                .hasMessage("RECONCILIATION_WINDOW_GAP");
    }
    @Test void orderPagingRejectsLoopAndStopsAtBoundWithoutCheckpoint(){
        pageBudget();var through=Instant.parse("2026-09-01T01:00:00Z");var from=through.minusSeconds(3600);var calls=new AtomicInteger();
        VerifiedOrderPageReader looping=(f,t,c,l)->{calls.incrementAndGet();return new VerifiedOrderPage(java.util.List.of(event("loop","orders/updated",from,"a")),true,"same");};
        assertThatThrownBy(()->source("app-a").reconcileOrderWindow(from,through,looping,ShopifyCoordinationPreparationPostgresql16GateTest::project)).hasMessage("RECONCILIATION_PAGE_INVALID");
        assertThat(calls.get()).isEqualTo(2);assertThat(checkpointCount()).isZero();calls.set(0);
        assertThatThrownBy(()->source("app-a").reconcileOrderWindow(from,through,(f,t,c,l)->new VerifiedOrderPage(
                java.util.List.of(event("bounded","orders/updated",from,"a")),true,"cursor-"+calls.incrementAndGet()),
                ShopifyCoordinationPreparationPostgresql16GateTest::project)).hasMessage("RECONCILIATION_PAGE_LIMIT");
        assertThat(calls.get()).isEqualTo(25);assertThat(checkpointCount()).isZero();
    }
    @Test void orderPagingRejectsEntireMalformedPageBeforeProjection(){
        pageBudget();var through=Instant.parse("2026-09-01T01:00:00Z");var from=through.minusSeconds(3600);
        for(var bad:java.util.List.of(event("early","orders/updated",from.minusSeconds(1),"a"),event("late","orders/updated",through.plusSeconds(1),"a"),
                new VerifiedEvent("product","products/update","gid://shopify/Product/1",from,"a".repeat(64)))) {
            assertThatThrownBy(()->source("app-a").reconcileOrderWindow(from,through,(f,t,c,l)->new VerifiedOrderPage(java.util.List.of(event("valid","orders/updated",from,"a"),bad),false,null),
                    (d,e)->{throw new AssertionError("no partial page projection");})).hasMessage("RECONCILIATION_PAGE_INVALID");
        }
        assertThat(checkpointCount()).isZero();assertThat(db.queryForObject("SELECT count(*) FROM integration_preparation.shopify_deliveries",Integer.class)).isZero();
    }
    @Test void orderPagingConflictOrRevocationCannotAdvanceProgress(){
        pageBudget();var through=Instant.parse("2026-09-01T01:00:00Z");var from=through.minusSeconds(3600);
        source("app-b").acceptVerified(event("existing","orders/updated",from,"a"),ShopifyCoordinationPreparationPostgresql16GateTest::project);
        assertThatThrownBy(()->source("app-a").reconcileOrderWindow(from,through,(f,t,c,l)->new VerifiedOrderPage(java.util.List.of(event("conflicting","orders/updated",from,"b")),false,null),
                (d,e)->{throw new AssertionError();})).hasMessage("EVENT_RECONCILIATION_REQUIRED");
        var revoked=new java.util.concurrent.atomic.AtomicBoolean();
        var source=new ShopifyCoordinationPreparation(db,manager,TENANT,SHOP,"app-a",(t,s,a)->{if(revoked.get())throw new InventoryCommandPreparation.Rejected("REVOKED");});
        assertThatThrownBy(()->source.reconcileOrderWindow(from,through,(f,t,c,l)->{revoked.set(true);return new VerifiedOrderPage(java.util.List.of(),false,null);},(d,e)->{})).hasMessage("REVOKED");
        assertThat(checkpointCount()).isZero();
    }

    @Test void orderPagingRejectsInvalidWindowAndOversizedPageButAcceptsVerifiedEmptyEnd(){
        pageBudget();var through=Instant.parse("2026-09-01T01:00:00Z");var from=through.minusSeconds(3600);
        assertThatThrownBy(()->source("app-a").reconcileOrderWindow(through,from,(f,t,c,l)->{throw new AssertionError();},(d,e)->{})).hasMessage("RECONCILIATION_WINDOW_INVALID");
        assertThatThrownBy(()->source("app-a").reconcileOrderWindow(from.minusSeconds(86400),through,(f,t,c,l)->{throw new AssertionError();},(d,e)->{})).hasMessage("RECONCILIATION_WINDOW_INVALID");
        assertThatThrownBy(()->source("app-a").reconcileOrderWindow(from,through,(f,t,c,l)->new VerifiedOrderPage(
                java.util.Collections.nCopies(26,event("oversize","orders/updated",from,"a")),false,null),(d,e)->{throw new AssertionError();})).hasMessage("RECONCILIATION_PAGE_INVALID");
        assertThat(checkpointCount()).isZero();
        assertThat(source("app-a").reconcileOrderWindow(from,through,(f,t,c,l)->new VerifiedOrderPage(java.util.List.of(),false,null),(d,e)->{throw new AssertionError();})).isEqualTo(1);
        assertThat(checkpointCount()).isEqualTo(1);
    }

    @Test void replicasShareBudgetAndReserveForegroundCapacity()throws Exception {
        try(var workers=Executors.newFixedThreadPool(8)) {
            var allowed=new AtomicInteger();var tasks=new java.util.ArrayList<Future<?>>();
            for(int i=0;i<8;i++)tasks.add(workers.submit(()->{if(source("app-a").reserve(Priority.ERP_BACKGROUND,20).allowed())allowed.incrementAndGet();}));
            for(var task:tasks)task.get(10,TimeUnit.SECONDS);
            assertThat(allowed.get()).isEqualTo(4);
        }
        assertThat(source("app-a").reserve(Priority.ERP_BACKGROUND,1).allowed()).isFalse();
        assertThat(source("app-a").reserve(Priority.CUSTOMER_SERVICE_FOREGROUND,20).allowed()).isTrue();
        assertThat(source("app-a").reserve(Priority.CUSTOMER_SERVICE_FOREGROUND,1).allowed()).isFalse();
    }
    @Test void unreviewedStaleOrRevokedBudgetFailsClosedAndFeedbackCannotInflateIt(){
        assertThatThrownBy(()->source("app-b").reserve(Priority.ERP_BACKGROUND,1)).hasMessage("BUDGET_OBSERVATION_REQUIRED");
        var a=source("app-a");a.reserve(Priority.ERP_BACKGROUND,70);a.observeThrottle(100,100,0.001);
        assertThat(db.queryForObject("SELECT available FROM integration_preparation.shopify_budget",Double.class)).isLessThan(31);
        a.observeThrottle(100,2,0.001);assertThat(a.reserve(Priority.CUSTOMER_SERVICE_FOREGROUND,3).allowed()).isFalse();
        assertThatThrownBy(()->a.observeThrottle(100,Double.NaN,1)).hasMessage("BUDGET_RESPONSE_INVALID");
        db.execute("UPDATE integration_preparation.shopify_budget SET observed_at=clock_timestamp()-interval '6 minutes'");
        assertThatThrownBy(()->a.reserve(Priority.CUSTOMER_SERVICE_FOREGROUND,1)).hasMessage("BUDGET_OBSERVATION_REQUIRED");
        var denied=new ShopifyCoordinationPreparation(db,manager,TENANT,SHOP,"app-a",(tenant,shop,ref)->{throw new InventoryCommandPreparation.Rejected("REVOKED");});
        assertThatThrownBy(()->denied.reserve(Priority.CUSTOMER_SERVICE_FOREGROUND,1)).hasMessage("REVOKED");
    }
    @Test void oldFeedbackCannotRaiseCapacityOrRefillRateAndInvalidStoredBudgetIsRejected(){
        var a=source("app-a");a.observeThrottle(200,100,10);
        assertThat(db.queryForObject("SELECT capacity FROM integration_preparation.shopify_budget",Double.class)).isEqualTo(100);
        assertThat(db.queryForObject("SELECT restore_rate FROM integration_preparation.shopify_budget",Double.class)).isEqualTo(0.001);
        assertThatThrownBy(()->db.execute("UPDATE integration_preparation.shopify_budget SET available='NaN'::numeric")).isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
        assertThatThrownBy(()->db.execute("UPDATE integration_preparation.shopify_budget SET available=101")).isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
        db.execute("UPDATE integration_preparation.shopify_budget SET observed_at=clock_timestamp()+interval '1 minute'");
        assertThatThrownBy(()->a.reserve(Priority.CUSTOMER_SERVICE_FOREGROUND,1)).hasMessage("BUDGET_OBSERVATION_REQUIRED");
    }
    @Test void duplicateAcrossApplicationsAndOutOfOrderEventsCannotReapply(){
        var a=source("app-a");var b=source("app-b");Instant version=Instant.parse("2026-09-01T00:00:00Z");
        var first=event("delivery-a","orders/updated",version,"a");
        assertThat(a.acceptVerified(first,ShopifyCoordinationPreparationPostgresql16GateTest::project)).isEqualTo(EventOutcome.APPLIED);
        assertThat(a.acceptVerified(first,(d,e)->{throw new AssertionError();})).isEqualTo(EventOutcome.DUPLICATE);
        assertThat(b.acceptVerified(event("different-app-delivery","orders/updated",version,"a"),(d,e)->{throw new AssertionError();})).isEqualTo(EventOutcome.DUPLICATE);
        assertThat(b.acceptVerified(event("older","orders/updated",version.minusSeconds(1),"b"),(d,e)->{throw new AssertionError();})).isEqualTo(EventOutcome.STALE);
        assertThat(db.queryForObject("SELECT digest FROM integration_preparation.owned_projection",String.class)).isEqualTo("a".repeat(64));
        assertThat(db.queryForObject("SELECT count(*) FROM integration_preparation.shopify_deliveries",Integer.class)).isEqualTo(3);
    }
    @Test void projectionFailureRollsBackReceiptAndCanBeRetriedSafely(){
        var a=source("app-a");var event=event("retry","orders/updated",Instant.parse("2026-09-01T00:00:00Z"),"a");
        assertThatThrownBy(()->a.acceptVerified(event,(d,e)->{project(d,e);throw new IllegalStateException("synthetic");})).isInstanceOf(IllegalStateException.class);
        assertThat(db.queryForObject("SELECT count(*) FROM integration_preparation.owned_projection",Integer.class)).isZero();
        assertThat(db.queryForObject("SELECT count(*) FROM integration_preparation.shopify_deliveries",Integer.class)).isZero();
        assertThat(a.acceptVerified(event,ShopifyCoordinationPreparationPostgresql16GateTest::project)).isEqualTo(EventOutcome.APPLIED);
    }
    @Test void sameVersionDifferentPayloadIsQuarantinedAndBlocksCheckpoint(){
        var a=source("app-a");Instant version=Instant.parse("2026-09-01T00:00:00Z");
        a.acceptVerified(event("one","orders/updated",version,"a"),ShopifyCoordinationPreparationPostgresql16GateTest::project);
        assertThat(source("app-b").acceptVerified(event("conflict","orders/updated",version,"b"),(d,e)->{throw new AssertionError();})).isEqualTo(EventOutcome.CONFLICT);
        assertThatThrownBy(()->a.advanceReconciledCheckpoint("orders/updated",version,true)).hasMessage("EVENT_RECONCILIATION_REQUIRED");
        assertThatThrownBy(()->a.acceptVerified(event("one","orders/updated",version,"b"),(d,e)->{})).hasMessage("DELIVERY_CONFLICT");
    }
    @Test void checkpointNeverRegressesOrAdvancesForIncompletePagesAndOwnerTopicsStaySeparate(){
        var a=source("app-a");Instant version=Instant.parse("2026-09-01T00:00:00Z");
        assertThatThrownBy(()->a.advanceReconciledCheckpoint("orders/updated",version,false)).hasMessage("CHECKPOINT_INCOMPLETE");
        a.advanceReconciledCheckpoint("orders/updated",version,true);a.advanceReconciledCheckpoint("orders/updated",version.minusSeconds(10),true);
        assertThat(db.queryForObject("SELECT synchronized_through FROM integration_preparation.shopify_reconciliation_checkpoints",Timestamp.class).toInstant()).isEqualTo(version);
        for(String topic:java.util.List.of("app/uninstalled","customers/redact","shop/redact"))assertThatThrownBy(()->a.acceptVerified(event("owner",topic,version,"a"),(d,e)->{})).hasMessage("EVENT_INVALID");
        assertThat(ShopifyCoordinationPreparation.class.getAnnotations()).isEmpty();
    }
    @Test void topicAndResourceIdentityMustMatchAndInventoryUsesBothKeys(){
        Instant version=Instant.parse("2026-09-01T00:00:00Z");var a=source("app-a");
        assertThatThrownBy(()->a.acceptVerified(event("wrong","products/update",version,"a"),(d,e)->{})).hasMessage("EVENT_INVALID");
        for(String resource:java.util.List.of("inventory-item:1:location:2","inventory-item:1:location:3")) {
            var value=new VerifiedEvent(resource.endsWith("2")?"location-a":"location-b","inventory_levels/update",resource,version,"a".repeat(64));
            assertThat(a.acceptVerified(value,ShopifyCoordinationPreparationPostgresql16GateTest::project)).isEqualTo(EventOutcome.APPLIED);
        }
        assertThat(db.queryForObject("SELECT count(*) FROM integration_preparation.owned_projection",Integer.class)).isEqualTo(2);
        assertThatThrownBy(()->a.acceptVerified(new VerifiedEvent("bad-level","inventory_levels/update","gid://shopify/InventoryLevel/1",version,"a".repeat(64)),(d,e)->{})).hasMessage("EVENT_INVALID");
    }
}
