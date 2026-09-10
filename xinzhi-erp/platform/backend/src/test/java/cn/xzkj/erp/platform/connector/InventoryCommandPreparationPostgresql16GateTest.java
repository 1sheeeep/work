package cn.xzkj.erp.platform.connector;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.InventorySetOutcome;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.InventorySetRequest;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.InventorySetResult;
import cn.xzkj.erp.platform.connector.InventoryCommandPreparation.Provider;
import cn.xzkj.erp.platform.connector.InventoryCommandPreparation.State;
import cn.xzkj.erp.platform.connector.InventoryCommandPreparation.Rejected;
import cn.xzkj.erp.platform.service.ShopCenterActor;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.net.*;
import java.net.http.*;
import com.sun.net.httpserver.HttpServer;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.DeserializationFeature;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;

class InventoryCommandPreparationPostgresql16GateTest {
    private static final UUID TENANT=UUID.fromString("11111111-1111-4111-8111-111111111111");
    private static final UUID SHOP=UUID.fromString("22222222-2222-4222-8222-222222222222");
    private static final UUID USER=UUID.fromString("33333333-3333-4333-8333-333333333333");
    private static final ShopCenterActor ACTOR=new ShopCenterActor(TENANT,USER,null,"synthetic-request","127.0.0.1");
    private static PostgreSQLContainer<?> postgres;
    private static JdbcTemplate db;
    private static DataSourceTransactionManager transactions;
    @TempDir Path temporary;

    @BeforeAll static void startOwnedDatabase() throws Exception {
        postgres=new PostgreSQLContainer<>("postgres:16-alpine").withImagePullPolicy(image->false)
                .withDatabaseName("owned_inventory_rehearsal").withUsername("synthetic_inventory").withPassword("synthetic_inventory");
        postgres.start();
        try {
            var dataSource=new DriverManagerDataSource(postgres.getJdbcUrl(),postgres.getUsername(),postgres.getPassword());
            db=new JdbcTemplate(dataSource);transactions=new DataSourceTransactionManager(dataSource);
            db.execute(Files.readString(Path.of("../preparation/sql/inventory-command-journal.sql")));
            db.execute(Files.readString(Path.of("../preparation/sql/shopify-coordination.sql")));
        } catch(Exception failure) {postgres.close();throw failure;}
    }
    @AfterAll static void closeOwnedDatabase(){if(postgres!=null)postgres.close();}
    @BeforeEach void seedOnlyOwnedRehearsal() {
        db.execute("TRUNCATE integration_preparation.inventory_reconciliation_audit,integration_preparation.inventory_commands,integration_preparation.inventory_routes");
        db.execute("TRUNCATE integration_preparation.shopify_budget");
        db.update("INSERT INTO integration_preparation.inventory_routes VALUES (?,?,'CS_STORE_APP',1,false)",TENANT,SHOP);
    }

    @Test void concurrentReplicasPinOneSourceDrainBeforeSwitchAndReplayOriginalReceipt() throws Exception {
        var started=new CountDownLatch(1);var release=new CountDownLatch(1);
        var csCalls=new AtomicInteger();var saasCalls=new AtomicInteger();
        InventoryCommandPreparation.InventoryWriter cs=(tenant,shop,request)->{
            csCalls.incrementAndGet();started.countDown();
            try {if(!release.await(8,TimeUnit.SECONDS))throw new IllegalStateException("synthetic timeout");}
            catch(InterruptedException interrupted){Thread.currentThread().interrupt();throw new IllegalStateException();}
            return applied(request);
        };
        var first=candidate(cs,(tenant,shop,request)->{saasCalls.incrementAndGet();return applied(request);});
        var replica=candidate(cs,(tenant,shop,request)->{saasCalls.incrementAndGet();return applied(request);});
        var request=request();
        try(var workers=Executors.newFixedThreadPool(2)) {
            var original=workers.submit(()->first.execute(ACTOR,1,request));
            try {
                assertThat(started.await(8,TimeUnit.SECONDS)).isTrue();
                assertThat(replica.execute(ACTOR,1,request).state()).isEqualTo(State.UNKNOWN);
                assertThat(replica.freeze(ACTOR,1).version()).isEqualTo(2);
                assertThatThrownBy(()->replica.activateReviewedCandidate(ACTOR,2,Provider.ERP_SAAS_APP))
                        .isInstanceOf(Rejected.class).hasMessage("WRITE_RECONCILIATION_REQUIRED");
                assertThatThrownBy(()->first.execute(ACTOR,2,request())).hasMessage("ROUTE_NOT_WRITABLE");
            } finally {release.countDown();}
            assertThat(original.get(8,TimeUnit.SECONDS).state()).isEqualTo(State.APPLIED);
        }
        assertThat(replica.activateReviewedCandidate(ACTOR,2,Provider.ERP_SAAS_APP).version()).isEqualTo(3);
        var oldReceipt=replica.execute(ACTOR,1,request);
        assertThat(oldReceipt.provider()).isEqualTo(Provider.CS_STORE_APP);
        assertThat(oldReceipt.state()).isEqualTo(State.APPLIED);
        assertThat(replica.execute(ACTOR,3,request()).provider()).isEqualTo(Provider.ERP_SAAS_APP);
        assertThatThrownBy(()->replica.execute(ACTOR,1,request())).hasMessage("ROUTE_NOT_WRITABLE");
        assertThat(csCalls.get()).isEqualTo(1);assertThat(saasCalls.get()).isEqualTo(1);
    }

    @Test void lostReplySurvivesReconstructionAndDoesNotExpireOrPermitNewKeyForSameResource() {
        var effects=new AtomicInteger();var fallback=new AtomicInteger();
        InventoryCommandPreparation.InventoryWriter lostReply=(tenant,shop,request)->{
            effects.incrementAndGet();throw new IllegalStateException("synthetic-secret-do-not-echo");
        };
        InventoryCommandPreparation.InventoryWriter saas=(tenant,shop,request)->{fallback.incrementAndGet();return applied(request);};
        var request=request();
        var original=candidate(lostReply,saas).execute(ACTOR,1,request);
        assertThat(original.state()).isEqualTo(State.UNKNOWN);
        assertThat(original.toString()).doesNotContain("synthetic-secret");
        db.update("UPDATE integration_preparation.inventory_commands SET created_at=clock_timestamp()-interval '30 days'");
        var reconstructed=candidate(lostReply,saas);
        assertThat(reconstructed.execute(ACTOR,1,request)).isEqualTo(original);
        assertThatThrownBy(()->reconstructed.execute(ACTOR,1,request())).hasMessage("RESOURCE_RECONCILIATION_REQUIRED");
        reconstructed.freeze(ACTOR,1);
        assertThatThrownBy(()->reconstructed.activateReviewedCandidate(ACTOR,2,Provider.ERP_SAAS_APP))
                .hasMessage("WRITE_RECONCILIATION_REQUIRED");
        assertThat(effects.get()).isEqualTo(1);assertThat(fallback.get()).isZero();
        assertThat(db.queryForObject("SELECT idempotency_key FROM integration_preparation.inventory_commands",String.class)).isEqualTo(request.idempotencyKey());
        assertThat(db.queryForObject("SELECT expected_available FROM integration_preparation.inventory_commands",Integer.class)).isEqualTo(request.expectedAvailable());
        assertThat(db.queryForObject("SELECT target_available FROM integration_preparation.inventory_commands",Integer.class)).isEqualTo(request.targetAvailable());
    }

    @Test void replyPersistenceFailureKeepsUnknownWithoutReexecutingRemoteEffect() {
        db.execute("""
                CREATE FUNCTION integration_preparation.fail_completion() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'synthetic-private-database-error'; END; $$;
                CREATE TRIGGER fail_completion BEFORE UPDATE ON integration_preparation.inventory_commands
                FOR EACH ROW EXECUTE FUNCTION integration_preparation.fail_completion();
                """);
        try {
            var effects=new AtomicInteger();
            InventoryCommandPreparation.InventoryWriter writer=(tenant,shop,request)->{effects.incrementAndGet();return applied(request);};
            var request=request();var candidate=candidate(writer,writer);
            assertThat(candidate.execute(ACTOR,1,request).state()).isEqualTo(State.UNKNOWN);
            assertThat(candidate.execute(ACTOR,1,request).toString()).doesNotContain("private-database");
            assertThat(effects.get()).isEqualTo(1);
        } finally {
            db.execute("DROP TRIGGER fail_completion ON integration_preparation.inventory_commands; DROP FUNCTION integration_preparation.fail_completion()");
        }
    }

    @ParameterizedTest @ValueSource(strings={"SHOPIFY_IDEMPOTENCY_BUSY","SHOPIFY_IDEMPOTENCY_CONFLICT","SHOPIFY_IDEMPOTENCY_FAILED","unexpected-private-error"})
    void ambiguousIdempotencyFailuresAreNotDefiniteRejections(String code) {
        var calls=new AtomicInteger();
        InventoryCommandPreparation.InventoryWriter writer=(tenant,shop,r)->{calls.incrementAndGet();return result(r,InventorySetOutcome.REJECTED,code);};
        var candidate=candidate(writer,writer);var request=request();
        assertThat(candidate.execute(ACTOR,1,request).state()).isEqualTo(State.UNKNOWN);
        assertThat(candidate.execute(ACTOR,1,request).code()).isEqualTo("WRITE_RECONCILIATION_REQUIRED");
        assertThat(calls.get()).isEqualTo(1);
    }

    @Test void onlyVerifiedNoEffectRejectionsReleaseTheResource() {
        InventoryCommandPreparation.InventoryWriter stale=(tenant,shop,r)->result(r,InventorySetOutcome.STALE,"SHOPIFY_INVENTORY_STALE");
        var candidate=candidate(stale,stale);
        assertThat(candidate.execute(ACTOR,1,request()).state()).isEqualTo(State.REJECTED);
        assertThat(candidate.execute(ACTOR,1,request()).state()).isEqualTo(State.REJECTED);
        candidate.freeze(ACTOR,1);
        assertThat(candidate.activateReviewedCandidate(ACTOR,2,Provider.ERP_SAAS_APP).frozen()).isFalse();
    }

    @Test void malformedAppliedReplyDoesNotReleaseTheResource() {
        InventoryCommandPreparation.InventoryWriter writer=(tenant,shop,r)->new InventorySetResult(InventorySetOutcome.APPLIED,
                "gid://shopify/InventoryItem/999",r.externalLocationRef(),r.expectedAvailable(),r.targetAvailable(),null,Instant.now());
        assertThat(candidate(writer,writer).execute(ACTOR,1,request()).state()).isEqualTo(State.UNKNOWN);
    }

    @Test void alteredPayloadActorOrVersionCannotReuseACommand() {
        InventoryCommandPreparation.InventoryWriter writer=(tenant,shop,r)->applied(r);
        var candidate=candidate(writer,writer);var request=request();candidate.execute(ACTOR,1,request);
        var altered=new InventorySetRequest(request.externalInventoryItemRef(),request.externalLocationRef(),1,8,request.idempotencyKey(),request.publicationId());
        assertThatThrownBy(()->candidate.execute(ACTOR,1,altered)).hasMessage("COMMAND_CONFLICT");
        assertThatThrownBy(()->candidate.execute(new ShopCenterActor(TENANT,UUID.randomUUID(),null,"synthetic","127.0.0.1"),1,request)).hasMessage("COMMAND_CONFLICT");
        assertThatThrownBy(()->candidate.execute(ACTOR,2,request)).hasMessage("COMMAND_CONFLICT");
        assertThatThrownBy(()->candidate.execute(ACTOR,1,new InventorySetRequest(request.externalInventoryItemRef(),request.externalLocationRef(),1,2,request.idempotencyKey(),UUID.randomUUID())))
                .hasMessage("COMMAND_CONFLICT");
        assertThat(db.queryForObject("SELECT count(*) FROM integration_preparation.inventory_commands",Integer.class)).isEqualTo(1);
    }

    @Test void outerTransactionRollbackCannotEraseAlreadyIssuedCommand() {
        InventoryCommandPreparation.InventoryWriter writer=(tenant,shop,r)->applied(r);
        var candidate=candidate(writer,writer);var request=request();
        new TransactionTemplate(transactions).execute(status->{
            assertThat(candidate.execute(ACTOR,1,request).state()).isEqualTo(State.APPLIED);
            status.setRollbackOnly();return null;
        });
        assertThat(candidate.execute(ACTOR,1,request).state()).isEqualTo(State.APPLIED);
        assertThat(db.queryForObject("SELECT count(*) FROM integration_preparation.inventory_commands",Integer.class)).isEqualTo(1);
    }

    @Test void authorizationRecheckedBeforeProviderAndDeniedInputsDoNotCreateCommands() {
        InventoryCommandPreparation.InventoryWriter forbidden=(tenant,shop,r)->{throw new AssertionError("provider must not run");};
        var candidate=candidate(forbidden,forbidden);
        assertThatThrownBy(()->candidate.execute(new ShopCenterActor(UUID.randomUUID(),USER,null,"synthetic","127.0.0.1"),1,request())).hasMessage("ACCESS_DENIED");
        assertThatThrownBy(()->candidate.execute(new ShopCenterActor(TENANT,USER,USER,"synthetic","127.0.0.1"),1,request())).hasMessage("ACCESS_DENIED");
        var request=request();
        assertThatThrownBy(()->candidate.execute(ACTOR,1,new InventorySetRequest(request.externalInventoryItemRef(),request.externalLocationRef(),1,2,"invalid key\n",request.publicationId())))
                .hasMessage("INVENTORY_COMMAND_INVALID");
        assertThat(db.queryForObject("SELECT count(*) FROM integration_preparation.inventory_commands",Integer.class)).isZero();
        var checks=new AtomicInteger();
        var revoked=new InventoryCommandPreparation(db,transactions,TENANT,SHOP,(actor,shop,operation)->{
            if(checks.incrementAndGet()>1)throw new Rejected("ACCESS_DENIED");
        },Map.of(Provider.CS_STORE_APP,forbidden,Provider.ERP_SAAS_APP,forbidden));
        assertThat(revoked.execute(ACTOR,1,request).state()).isEqualTo(State.UNKNOWN);
        assertThat(checks.get()).isEqualTo(2);
        assertThat(InventoryCommandPreparation.class.getAnnotations()).isEmpty();
    }

    private static InventoryCommandPreparation candidate(InventoryCommandPreparation.InventoryWriter cs,InventoryCommandPreparation.InventoryWriter saas) {
        return new InventoryCommandPreparation(db,transactions,TENANT,SHOP,(actor,shop,operation)->{},
                Map.of(Provider.CS_STORE_APP,cs,Provider.ERP_SAAS_APP,saas),Map.of(),
                (tenant,shop,provider,version)->new InventoryCommandPreparation.CandidateProof(provider,"gid://shopify/Shop/123",
                        Set.of("write_inventory","read_locations"),Instant.now(),Instant.now().minusSeconds(1),version,version,0,true),"gid://shopify/Shop/123",
                (actor,shop)->{if(!"original-cs-agent".equals(actor.originalUserRef()))throw new Rejected("ACCESS_DENIED");});
    }
    @Test void unresolvedOriginalSourceReceiptCanBeReconciledWithoutRepeatingWrite() {
        var writes=new AtomicInteger();var lookups=new AtomicInteger();
        InventoryCommandPreparation.InventoryWriter lost=(tenant,shop,r)->{writes.incrementAndGet();throw new IllegalStateException("lost reply");};
        var writers=Map.of(Provider.CS_STORE_APP,lost,Provider.ERP_SAAS_APP,lost);
        var candidate=new InventoryCommandPreparation(db,transactions,TENANT,SHOP,(actor,shop,operation)->{},writers,
                Map.of(Provider.CS_STORE_APP,(tenant,shop,r)->{lookups.incrementAndGet();return applied(r);},
                        Provider.ERP_SAAS_APP,(tenant,shop,r)->{throw new AssertionError("wrong source");}),null,null);
        var request=request();
        assertThat(candidate.execute(ACTOR,1,request).state()).isEqualTo(State.UNKNOWN);
        candidate.freeze(ACTOR,1);
        assertThat(candidate.reconcile(ACTOR,request.publicationId()).state()).isEqualTo(State.APPLIED);
        assertThat(candidate.reconcile(ACTOR,request.publicationId()).state()).isEqualTo(State.APPLIED);
        assertThat(writes.get()).isEqualTo(1);assertThat(lookups.get()).isEqualTo(1);
        assertThat(db.queryForObject("SELECT count(*) FROM integration_preparation.inventory_reconciliation_audit",Integer.class)).isEqualTo(1);
        assertThat(candidate.execute(ACTOR,1,request).provider()).isEqualTo(Provider.CS_STORE_APP);
    }

    @Test void missingOrAmbiguousReconciliationCannotClearUnknown() {
        InventoryCommandPreparation.InventoryWriter lost=(tenant,shop,r)->{throw new IllegalStateException();};
        var request=request();var basic=candidate(lost,lost);basic.execute(ACTOR,1,request);
        assertThatThrownBy(()->basic.reconcile(ACTOR,request.publicationId())).hasMessage("ORIGINAL_SOURCE_RECONCILIATION_UNAVAILABLE");
        var unresolved=new InventoryCommandPreparation(db,transactions,TENANT,SHOP,(actor,shop,operation)->{},
                Map.of(Provider.CS_STORE_APP,lost,Provider.ERP_SAAS_APP,lost),
                Map.of(Provider.CS_STORE_APP,(tenant,shop,r)->result(r,InventorySetOutcome.REJECTED,"SHOPIFY_IDEMPOTENCY_BUSY")),null,null);
        assertThat(unresolved.reconcile(ACTOR,request.publicationId()).state()).isEqualTo(State.UNKNOWN);
        assertThat(db.queryForObject("SELECT count(*) FROM integration_preparation.inventory_reconciliation_audit",Integer.class)).isZero();
    }

    @Test void authenticatedSourceMustConsumeAnExactDurableClaimAndCannotReplayAfterRestart() {
        InventoryCommandPreparation.InventoryWriter pending=(tenant,shop,r)->{throw new IllegalStateException();};
        var first=candidate(pending,pending);var r=request();first.execute(ACTOR,1,r);
        assertThat(first.claimSource(Provider.ERP_SAAS_APP,1,r)).isFalse();
        assertThat(first.claimSource(Provider.CS_STORE_APP,2,r)).isFalse();
        var altered=new InventorySetRequest(r.externalInventoryItemRef(),r.externalLocationRef(),r.expectedAvailable(),99,r.idempotencyKey(),r.publicationId());
        assertThat(first.claimSource(Provider.CS_STORE_APP,1,altered)).isFalse();
        first.freeze(ACTOR,1);
        assertThat(first.claimSource(Provider.CS_STORE_APP,1,r)).isTrue();
        assertThat(candidate(pending,pending).claimSource(Provider.CS_STORE_APP,1,r)).isFalse();
        assertThat(candidate(pending,pending).claimSource(Provider.CS_STORE_APP,1,request())).isFalse();
    }

    @Test void actualJavaGoSourcesAndShopifyClientShareClaimsSwitchAndFenceLostReplies() throws Exception {
        String serviceToken="synthetic-inventory-service-only-0001",claimToken="synthetic-inventory-claim-only-00001";
        var json=new ObjectMapper().rebuild().enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES,DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();
        var active=new AtomicReference<InventoryCommandPreparation>();
        var budgetRequests=new AtomicInteger();var foregroundRequests=new AtomicInteger();
        for(String app:java.util.List.of("owned-cs-app","owned-saas-app"))
            db.update("INSERT INTO integration_preparation.shopify_budget VALUES(?,?,?,10000,10000,0.001,100,clock_timestamp(),clock_timestamp())",TENANT,SHOP,app);
        var claimServer=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        claimServer.createContext("/owned-budget",exchange->{
            int response=403;
            try {
                if(!exchange.getRequestMethod().equals("POST") || !claimToken.equals(exchange.getRequestHeaders().getFirst("X-Owned-Claim")))throw new IllegalArgumentException();
                byte[] body=exchange.getRequestBody().readNBytes(2049);if(body.length>2048)throw new IllegalArgumentException();
                var request=json.readValue(body,OwnedBudgetWire.class);
                String prefix="xz-erp://inventory-publications/";
                if(request.requestedCost()!=1000 || request.commandRef()==null || !request.commandRef().startsWith(prefix))throw new IllegalArgumentException();
                var source=Provider.valueOf(exchange.getRequestHeaders().getFirst("X-Owned-Source"));
                var priority=active.get().authorizeClaimedSourceBudget(source,UUID.fromString(request.commandRef().substring(prefix.length())));
                String app=source==Provider.CS_STORE_APP?"owned-cs-app":"owned-saas-app";
                var budget=new ShopifyCoordinationPreparation(db,transactions,TENANT,SHOP,app,(tenant,shop,ref)->{});
                budgetRequests.incrementAndGet();
                if(priority==ShopifyCoordinationPreparation.Priority.CUSTOMER_SERVICE_FOREGROUND)foregroundRequests.incrementAndGet();
                response=budget.reserve(priority,request.requestedCost()).allowed()?204:429;
            }catch(Exception rejected){response=403;}
            exchange.sendResponseHeaders(response,-1);exchange.close();
        });
        claimServer.createContext("/owned-claim",exchange->{
            int response=403;
            try {
                if(!exchange.getRequestMethod().equals("POST") || !claimToken.equals(exchange.getRequestHeaders().getFirst("X-Owned-Claim")))throw new IllegalArgumentException();
                byte[] body=exchange.getRequestBody().readNBytes(16385);if(body.length>16384)throw new IllegalArgumentException();
                var wire=json.readValue(body,OwnedInventoryWire.class);
                if(!TENANT.toString().equals(wire.identity().tenantId()) || !SHOP.toString().equals(wire.identity().shopId())
                        || !wire.referenceDocumentUri().startsWith("xz-erp://inventory-publications/"))throw new IllegalArgumentException();
                var r=new InventorySetRequest(wire.inventoryItemId(),wire.locationId(),wire.expectedAvailable(),wire.targetAvailable(),wire.idempotencyKey(),UUID.fromString(wire.referenceDocumentUri().substring("xz-erp://inventory-publications/".length())));
                Provider source=Provider.valueOf(exchange.getRequestHeaders().getFirst("X-Owned-Source"));
                long version=Long.parseLong(exchange.getRequestHeaders().getFirst("X-XZ-Inventory-Route-Version"));
                response=active.get().claimSource(source,version,r)?204:409;
            }catch(Exception rejected){response=409;}
            exchange.sendResponseHeaders(response,-1);exchange.close();
        });
        try(var workers=Executors.newVirtualThreadPerTaskExecutor()) {
            claimServer.setExecutor(workers);claimServer.start();
            try(var go=SyntheticStoreAppProcess.startInventory(temporary,claimServer.getAddress().getPort())) {
                var cs=new InventorySourcePreparationClient(db,URI.create(go.baseUrl),Provider.CS_STORE_APP,serviceToken,TENANT,SHOP,7);
                var saas=new InventorySourcePreparationClient(db,URI.create(go.baseUrl),Provider.ERP_SAAS_APP,serviceToken,TENANT,SHOP,7);
                var journal=candidate(cs,saas);active.set(journal);
                var first=request();var receipt=journal.execute(ACTOR,1,first);
                assertThat(receipt.state()).isEqualTo(State.APPLIED);assertThat(receipt.provider()).isEqualTo(Provider.CS_STORE_APP);
                assertThat(journal.execute(ACTOR,1,first)).isEqualTo(receipt);
                journal.freeze(ACTOR,1);journal.activateReviewedCandidate(ACTOR,2,Provider.ERP_SAAS_APP);
                UUID secondID=UUID.randomUUID();var second=new InventorySetRequest(first.externalInventoryItemRef(),first.externalLocationRef(),2,3,"owned-second-"+secondID,secondID);
                var csActor=new InventoryCommandPreparation.CustomerServiceActor(TENANT,"original-cs-agent");
                assertThat(journal.executeCustomerService(csActor,3,second).state()).isEqualTo(State.APPLIED);
                assertThat(db.queryForObject("SELECT cs_actor_ref FROM integration_preparation.inventory_commands WHERE command_id=?",String.class,secondID)).isEqualTo("original-cs-agent");
                assertThat(db.queryForObject("SELECT actor_id FROM integration_preparation.inventory_commands WHERE command_id=?",UUID.class,secondID)).isNull();
                assertThat(journal.execute(ACTOR,1,first)).isEqualTo(receipt);
                UUID lostID=UUID.randomUUID();var lost=new InventorySetRequest(first.externalInventoryItemRef(),first.externalLocationRef(),3,4,"lost-"+lostID,lostID);
                assertThat(journal.execute(ACTOR,3,lost).state()).isEqualTo(State.UNKNOWN);
                var reconstructed=candidate(cs,saas);active.set(reconstructed);
                assertThat(reconstructed.execute(ACTOR,3,lost).state()).isEqualTo(State.UNKNOWN);
                // Budget exhaustion blocks before the actual Shopify transport,
                // while the durable claim stays UNKNOWN and is never refunded/retried.
                db.update("UPDATE integration_preparation.shopify_budget SET available=0 WHERE app_ref='owned-saas-app'");
                UUID blockedID=UUID.randomUUID();
                var blocked=new InventorySetRequest("gid://shopify/InventoryItem/9",first.externalLocationRef(),0,1,"budget-blocked-"+blockedID,blockedID);
                assertThat(reconstructed.execute(ACTOR,3,blocked).state()).isEqualTo(State.UNKNOWN);
                reconstructed.freeze(ACTOR,3);
                assertThatThrownBy(()->reconstructed.activateReviewedCandidate(ACTOR,4,Provider.CS_STORE_APP)).hasMessage("WRITE_RECONCILIATION_REQUIRED");
                var evidence=HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create(go.baseUrl+"/rehearsal/evidence")).GET().build(),HttpResponse.BodyHandlers.ofString());
                var result=json.readTree(evidence.body());assertThat(result.get("quantity").asInt()).isEqualTo(4);
                assertThat(result.get("effects").size()).isEqualTo(3);assertThat(result.get("effects").get(lost.idempotencyKey()).asInt()).isEqualTo(1);
                assertThat(result.get("socketToShopify").asBoolean()).isFalse();
                assertThat(evidence.body()).doesNotContain("owner-only",serviceToken,claimToken);
                assertThat(db.queryForObject("SELECT count(*) FROM integration_preparation.inventory_commands WHERE source_claimed_at IS NOT NULL",Integer.class)).isEqualTo(4);
                assertThat(budgetRequests.get()).isEqualTo(5);assertThat(foregroundRequests.get()).isEqualTo(1);
                assertThat(db.queryForObject("SELECT available FROM integration_preparation.shopify_budget WHERE app_ref='owned-cs-app'",Double.class)).isBetween(8000d,8001d);
            } finally {claimServer.stop(0);}
        }
    }
    private record OwnedIdentity(String tenantId,String shopId) { }
    private record OwnedContext(String correlationId,String requestId) { }
    private record OwnedInventoryWire(OwnedIdentity identity,OwnedContext context,String inventoryItemId,String locationId,int expectedAvailable,int targetAvailable,String idempotencyKey,String referenceDocumentUri) { }
    private record OwnedBudgetWire(String commandRef,int requestedCost) { }

    @Test void transportBudgetRequiresUnresolvedClaimAndCurrentOriginalActorPermission(){
        var allowed=new java.util.concurrent.atomic.AtomicBoolean(true);
        InventoryCommandPreparation.InventoryWriter pending=(tenant,shop,r)->{throw new IllegalStateException();};
        var journal=new InventoryCommandPreparation(db,transactions,TENANT,SHOP,(actor,shop,op)->{
            if(!allowed.get())throw new Rejected("REVOKED");
        },Map.of(Provider.CS_STORE_APP,pending,Provider.ERP_SAAS_APP,pending));
        var r=request();journal.execute(ACTOR,1,r);
        assertThatThrownBy(()->journal.authorizeClaimedSourceBudget(Provider.CS_STORE_APP,r.publicationId())).hasMessage("SOURCE_CLAIM_INVALID");
        assertThat(journal.claimSource(Provider.CS_STORE_APP,1,r)).isTrue();
        assertThat(journal.authorizeClaimedSourceBudget(Provider.CS_STORE_APP,r.publicationId())).isEqualTo(ShopifyCoordinationPreparation.Priority.ERP_BACKGROUND);
        assertThatThrownBy(()->journal.authorizeClaimedSourceBudget(Provider.ERP_SAAS_APP,r.publicationId())).hasMessage("SOURCE_CLAIM_INVALID");
        allowed.set(false);
        assertThatThrownBy(()->journal.authorizeClaimedSourceBudget(Provider.CS_STORE_APP,r.publicationId())).hasMessage("REVOKED");
        allowed.set(true);
        db.update("UPDATE integration_preparation.inventory_commands SET state='APPLIED',safe_code='APPLIED',completed_at=clock_timestamp() WHERE command_id=?",r.publicationId());
        assertThatThrownBy(()->journal.authorizeClaimedSourceBudget(Provider.CS_STORE_APP,r.publicationId())).hasMessage("SOURCE_CLAIM_INVALID");
    }

    @Test void csOnlyActorUsesOriginalBusinessAuthorizationWithoutErpMembershipOrRoleUnion(){
        var csChecks=new AtomicInteger();
        InventoryCommandPreparation.InventoryWriter pending=(tenant,shop,r)->{throw new IllegalStateException();};
        var both=new InventoryCommandPreparation(db,transactions,TENANT,SHOP,(actor,shop,op)->{throw new AssertionError("CS must not assume an ERP account");},
                Map.of(Provider.CS_STORE_APP,pending,Provider.ERP_SAAS_APP,pending),Map.of(),null,null,
                (actor,shop)->{csChecks.incrementAndGet();if(!"native-user-only".equals(actor.originalUserRef()))throw new Rejected("ACCESS_DENIED");});
        var nativeActor=new InventoryCommandPreparation.CustomerServiceActor(TENANT,"native-user-only");var r=request();
        assertThat(both.executeCustomerService(nativeActor,1,r).state()).isEqualTo(State.UNKNOWN);
        assertThat(both.claimSource(Provider.CS_STORE_APP,1,r)).isTrue();
        assertThat(csChecks.get()).isEqualTo(3);
        assertThatThrownBy(()->both.executeCustomerService(new InventoryCommandPreparation.CustomerServiceActor(TENANT,"different-native-user"),1,request())).hasMessage("ACCESS_DENIED");
        assertThatThrownBy(()->both.executeCustomerService(new InventoryCommandPreparation.CustomerServiceActor(UUID.randomUUID(),"native-user-only"),1,request())).hasMessage("ACCESS_DENIED");
        assertThat(db.queryForObject("SELECT count(*) FROM integration_preparation.inventory_commands",Integer.class)).isEqualTo(1);
        var noCs=new InventoryCommandPreparation(db,transactions,TENANT,SHOP,(actor,shop,op)->{},Map.of(Provider.CS_STORE_APP,pending,Provider.ERP_SAAS_APP,pending));
        assertThatThrownBy(()->noCs.executeCustomerService(nativeActor,1,request())).hasMessage("ACCESS_DENIED");
    }

    @Test void oldJournalConstructorCannotSilentlyBypassSwitchProofs() {
        InventoryCommandPreparation.InventoryWriter writer=(tenant,shop,r)->applied(r);
        var basic=new InventoryCommandPreparation(db,transactions,TENANT,SHOP,(actor,shop,operation)->{},Map.of(Provider.CS_STORE_APP,writer,Provider.ERP_SAAS_APP,writer));
        basic.freeze(ACTOR,1);
        assertThatThrownBy(()->basic.activateReviewedCandidate(ACTOR,2,Provider.ERP_SAAS_APP)).hasMessage("SWITCH_PROOF_REQUIRED");
        assertThat(db.queryForObject("SELECT frozen FROM integration_preparation.inventory_routes",Boolean.class)).isTrue();
    }

    @ParameterizedTest @ValueSource(strings={"provider","shop","scopes","stale","future","checkpoint","erp","cs","pending","plugin"})
    void incompleteSourceOrParticipantProofCannotSwitch(String defect) {
        InventoryCommandPreparation.InventoryWriter writer=(tenant,shop,r)->applied(r);
        var candidate=new InventoryCommandPreparation(db,transactions,TENANT,SHOP,(actor,shop,operation)->{},
                Map.of(Provider.CS_STORE_APP,writer,Provider.ERP_SAAS_APP,writer),Map.of(),(tenant,shop,provider,version)->{
                    Instant now=Instant.now();
                    return new InventoryCommandPreparation.CandidateProof(defect.equals("provider")?Provider.CS_STORE_APP:provider,
                            defect.equals("shop")?"gid://shopify/Shop/999":"gid://shopify/Shop/123",
                            defect.equals("scopes")?Set.of("read_inventory"):Set.of("write_inventory","read_locations"),
                            defect.equals("stale")?now.minusSeconds(120):defect.equals("future")?now.plusSeconds(120):now,
                            defect.equals("checkpoint")?now.minusSeconds(300):now.minusSeconds(1),
                            defect.equals("erp")?1:version,defect.equals("cs")?1:version,defect.equals("pending")?1:0,!defect.equals("plugin"));
                },"gid://shopify/Shop/123");
        candidate.freeze(ACTOR,1);
        assertThatThrownBy(()->candidate.activateReviewedCandidate(ACTOR,2,Provider.ERP_SAAS_APP)).hasMessage("SWITCH_PROOF_INVALID");
        assertThat(db.queryForObject("SELECT provider FROM integration_preparation.inventory_routes",String.class)).isEqualTo("CS_STORE_APP");
    }
    private static InventorySetRequest request() {
        UUID id=UUID.randomUUID();return new InventorySetRequest("gid://shopify/InventoryItem/1","gid://shopify/Location/2",1,2,"inventory-command:"+id,id);
    }
    private static InventorySetResult applied(InventorySetRequest r){return result(r,InventorySetOutcome.APPLIED,null);}
    private static InventorySetResult result(InventorySetRequest r,InventorySetOutcome outcome,String code) {
        return new InventorySetResult(outcome,r.externalInventoryItemRef(),r.externalLocationRef(),r.expectedAvailable(),r.targetAvailable(),code,Instant.now());
    }
}
