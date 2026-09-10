package cn.xzkj.erp.platform.connector;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import cn.xzkj.erp.ErpApplication;
import cn.xzkj.erp.iam.application.LoginCommand;
import cn.xzkj.erp.iam.application.IamActor;
import cn.xzkj.erp.iam.persistence.IamAssignmentStore;
import cn.xzkj.erp.iam.preparation.PersistentIdentityPreparationState;
import cn.xzkj.erp.iam.application.LoginService;
import cn.xzkj.erp.iam.application.PasswordHashingService;
import cn.xzkj.erp.iam.application.SessionTokenService;
import cn.xzkj.erp.iam.persistence.AuthSessionRepository;
import cn.xzkj.erp.iam.persistence.PermissionRepository;
import cn.xzkj.erp.iam.persistence.UserAccountRepository;
import cn.xzkj.erp.iam.preparation.CustomerServiceIdentityPreparation;
import cn.xzkj.erp.iam.preparation.CustomerServiceIdentityPreparation.Binding;
import cn.xzkj.erp.iam.preparation.CustomerServiceIdentityPreparation.Rejected;
import cn.xzkj.erp.tenantaccess.TenantEntitlementService;
import cn.xzkj.erp.tenantaccess.UserApplicationAccessService;
import cn.xzkj.erp.testing.BusinessApplicationTestData;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;
import java.nio.file.Files;
import java.sql.DriverManager;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.testcontainers.containers.PostgreSQLContainer;
import tools.jackson.databind.ObjectMapper;

class CustomerServiceIdentityPreparationPostgresql16GateTest {
    @SuppressWarnings("resource")
    @Test void nativeRuntimeUsesNormalLoginMeLogoutAndRejectsOldPasswordAndOldBearer() throws Exception {
        try(var pg=new PostgreSQLContainer<>("postgres:16-alpine").withImagePullPolicy(image->false)
                .withDatabaseName("owned_runtime").withUsername("synthetic").withPassword("synthetic");
            var go=SyntheticStoreAppProcess.startIdentity(temporary)) {
            pg.start();var environment=new StandardEnvironment();
            environment.getPropertySources().remove(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME);
            environment.getPropertySources().remove(StandardEnvironment.SYSTEM_PROPERTIES_PROPERTY_SOURCE_NAME);
            environment.getPropertySources().addFirst(new MapPropertySource("owned-runtime",Map.of(
                "spring.datasource.url",pg.getJdbcUrl(),"spring.datasource.username",pg.getUsername(),"spring.datasource.password",pg.getPassword(),
                "server.address","127.0.0.1","server.port","0","erp.environment","integration-test","logging.level.root","ERROR","spring.main.banner-mode","off","erp.channel-connector.mode","unconfigured")));
            try(var app=new SpringApplicationBuilder(ErpApplication.class).web(WebApplicationType.SERVLET).environment(environment).run()) {
                var db=new JdbcTemplate(app.getBean(DataSource.class));seed(db,app,EMAIL,"decoy@example.invalid");
                try(var c=app.getBean(DataSource.class).getConnection()){BusinessApplicationTestData.enableErpForTenant(c,TENANT);}
                var login=app.getBean(LoginService.class);
                var old=login.login(new LoginCommand("identity_rehearsal",EMAIL,ERP_PASSWORD,"old-local","127.0.0.1"));
                db.update("UPDATE roles SET code='tenant_admin',system_role=true WHERE id=?",ROLE);
                db.execute(Files.readString(Path.of("../preparation/sql/erp-identity.sql")));
                byte[] key=new byte[32];new SecureRandom().nextBytes(key);
                state(app,db,key).review(new IamActor(TENANT,USER,"review","127.0.0.1"),binding(1),0,"CONFIRMED","owned-runtime");
                for(int v=2;v<=7;v++)state(app,db,key).review(new IamActor(TENANT,USER,"review","127.0.0.1"),binding(v),v-1,"CONFIRMED","owned-runtime");
                try(var nativeIdentity=new cn.xzkj.erp.iam.preparation.NativeCustomerServiceIdentity(db,app.getBean(PlatformTransactionManager.class),
                    app.getBean(UserAccountRepository.class),app.getBean(AuthSessionRepository.class),app.getBean(PermissionRepository.class),app.getBean(IamAssignmentStore.class),
                    app.getBean(UserApplicationAccessService.class),app.getBean(TenantEntitlementService.class),app.getBean(SessionTokenService.class),app.getBean(cn.xzkj.erp.iam.audit.SecurityAuditRecorder.class),app.getBean(Clock.class),TENANT,URI.create(go.baseUrl),"synthetic-identity-service-token-not-real",java.util.Base64.getEncoder().encodeToString(key),"")) {
                    login.setNativeIdentity(nativeIdentity);
                    app.getBean(cn.xzkj.erp.iam.security.BearerTokenAuthenticationFilter.class).setNativeIdentity(nativeIdentity);
                    app.getBean(cn.xzkj.erp.iam.application.IamAdministrationService.class).setNativeIdentity(nativeIdentity);
                    String base="http://127.0.0.1:"+app.getEnvironment().getRequiredProperty("local.server.port");
                    assertThat(get(base,"/api/v1/auth/me",old.accessToken()).statusCode()).isEqualTo(401);
                    String body="{\"tenantCode\":\"identity_rehearsal\",\"username\":\""+EMAIL+"\",\"password\":\""+CS_PASSWORD+"\"}";
                    assertThat(post(base,"/api/v1/auth/login",body.replace(CS_PASSWORD,ERP_PASSWORD)).statusCode()).isEqualTo(401);
                    var response=post(base,"/api/v1/auth/login",body);assertThat(response.statusCode()).isEqualTo(200);
                    String token=new ObjectMapper().readTree(response.body()).path("accessToken").asString();
                    assertThat(token).startsWith("cs-native_");
                    assertThat(get(base,"/api/v1/auth/me",token).statusCode()).isEqualTo(200);
                    var evidence=new ObjectMapper().readTree(get(go.baseUrl,"/rehearsal/evidence",null).body());
                    assertThat(evidence.path("receptionOnline").asBoolean()).isFalse();assertThat(evidence.path("originalUserUnchanged").asBoolean()).isTrue();
                    assertThatThrownBy(()->nativeIdentity.requireLocalPasswordAllowed(TENANT,USER)).isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
                    db.update("DELETE FROM user_roles WHERE tenant_id=? AND user_id=?",TENANT,USER);
                    var me=new ObjectMapper().readTree(get(base,"/api/v1/auth/me",token).body());assertThat(me.path("permissions").size()).isZero();
                    var logout=HTTP.send(HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/session")).header("Authorization","Bearer "+token).DELETE().build(),HttpResponse.BodyHandlers.ofString());
                    assertThat(logout.statusCode()).isEqualTo(204);assertThat(get(base,"/api/v1/auth/me",token).statusCode()).isEqualTo(401);
                    var next=post(base,"/api/v1/auth/login",body);assertThat(next.statusCode()).isEqualTo(200);
                    String revoked=new ObjectMapper().readTree(next.body()).path("accessToken").asString();
                    assertThat(post(go.baseUrl,"/rehearsal/control/disable","{}").statusCode()).isEqualTo(204);
                    assertThat(get(base,"/api/v1/auth/me",revoked).statusCode()).isEqualTo(401);
                    assertThat(post(go.baseUrl,"/rehearsal/control/activate","{}").statusCode()).isEqualTo(204);
                    assertThat(get(base,"/api/v1/auth/me",revoked).statusCode()).isEqualTo(401);
                }
            }
        }
    }
    @SuppressWarnings("resource")
    @Test void explicitAccountOnboardingIsAtomicPasswordlessAndNeverMergesByEmail() throws Exception {
        try(var pg=new PostgreSQLContainer<>("postgres:16-alpine").withImagePullPolicy(image->false)
                .withDatabaseName("owned_onboarding").withUsername("synthetic").withPassword("synthetic")) {
            pg.start();
            org.flywaydb.core.Flyway.configure().dataSource(pg.getJdbcUrl(),pg.getUsername(),pg.getPassword()).load().migrate();
            try(var c=DriverManager.getConnection(pg.getJdbcUrl(),pg.getUsername(),pg.getPassword())) {
                var db=new JdbcTemplate(new org.springframework.jdbc.datasource.SingleConnectionDataSource(c,true));
                UUID tenant=UUID.randomUUID(),admin=UUID.randomUUID(),employee=UUID.randomUUID(),role=UUID.randomUUID();
                db.update("INSERT INTO tenants(id,code,name) VALUES(?,'owned_onboarding','Synthetic')",tenant);
                db.update("INSERT INTO users(id,tenant_id,username,email,display_name,password_hash) VALUES(?,?,'owner@example.invalid','owner@example.invalid','Owner','synthetic-old-hash'),(?,?,'test@example.invalid','test@example.invalid','Test','synthetic-test-hash')",admin,tenant,employee,tenant);
                db.update("INSERT INTO roles(id,tenant_id,code,name,system_role) VALUES(?,?,'tenant_admin','Admin',true)",role,tenant);
                db.update("INSERT INTO user_roles(tenant_id,user_id,role_id) VALUES(?,?,?),(?,?,?)",tenant,admin,role,tenant,employee,role);
                BusinessApplicationTestData.enableErpForTenant(c,tenant);
                var people=new java.util.ArrayList<Map<String,String>>();
                for(int n=0;n<18;n++)people.add(Map.of("id","user_synthetic"+n,"email",n==0?"owner@example.invalid":n==1?"test@example.invalid":"staff"+n+"@example.invalid","display_name","Synthetic "+n,"status","active"));
                String plan=new ObjectMapper().writeValueAsString(Map.of("tenantId",tenant,"tenantCode","owned_onboarding","adminUserId",admin,"evidence","native-cs-onboarding-synthetic",
                    "users",people,"existingMappings",List.of(Map.of("sourceUserId","user_synthetic0","erpUserId",admin,"mode","admin"),Map.of("sourceUserId","user_synthetic1","erpUserId",employee,"mode","employee"))));
                String sql=Files.readString(Path.of("../preparation/sql/native-cs-account-onboarding.sql"));
                for(String invalid:List.of(plan.replace("\"active\"","\"disabled\""),plan.replace("\"employee\"","\"admin\""),plan.replace("\"sourceUserId\":\"user_synthetic1\"","\"sourceUserId\":\"user_missing000\""),plan.replace("staff17@example.invalid","owner@example.invalid"))) {
                    c.setAutoCommit(false);
                    db.queryForObject("SELECT set_config('xz.onboarding',?,true)",String.class,invalid);
                    assertThatThrownBy(()->db.execute(sql)).isInstanceOf(org.springframework.dao.DataAccessException.class);
                    c.rollback();c.setAutoCommit(true);
                    assertThat(db.queryForObject("SELECT count(*) FROM users",Integer.class)).isEqualTo(2);
                    assertThat(db.queryForObject("SELECT count(*) FROM user_roles",Integer.class)).isEqualTo(2);
                }
                c.setAutoCommit(false);db.queryForObject("SELECT set_config('xz.onboarding',?,true)",String.class,plan);db.execute(sql);c.commit();c.setAutoCommit(true);
                assertThat(db.queryForObject("SELECT count(*) FROM users",Integer.class)).isEqualTo(18);
                assertThat(db.queryForObject("SELECT count(*) FROM user_roles",Integer.class)).isEqualTo(1);
                assertThat(db.queryForObject("SELECT user_id FROM user_roles",UUID.class)).isEqualTo(admin);
                assertThat(db.queryForObject("SELECT count(*) FROM users WHERE password_hash IS NULL",Integer.class)).isEqualTo(16);
                assertThat(db.queryForObject("SELECT password_hash FROM users WHERE id=?",String.class,admin)).isEqualTo("synthetic-old-hash");
                assertThat(db.queryForObject("SELECT password_hash FROM users WHERE id=?",String.class,employee)).isEqualTo("synthetic-test-hash");
                assertThat(db.queryForObject("SELECT count(*) FROM user_enabled_applications WHERE application_code='ERP'",Integer.class)).isEqualTo(18);
                assertThat(db.queryForObject("SELECT count(*) FROM tenant_user_warehouse_scopes WHERE mode='SELECTED'",Integer.class)).isEqualTo(17);
                assertThat(db.queryForObject("SELECT count(*) FROM audit_logs WHERE request_id='native-cs-onboarding-synthetic' AND details->>'loginIntegrationEnabled'='false'",Integer.class)).isEqualTo(18);
                c.setAutoCommit(false);db.queryForObject("SELECT set_config('xz.onboarding',?,true)",String.class,plan);
                assertThatThrownBy(()->db.execute(sql)).hasMessageContaining("ONBOARDING_ALREADY_RECORDED_CHECK_RECEIPT");
                c.rollback();c.setAutoCommit(true);
                assertThat(db.queryForObject("SELECT count(*) FROM users",Integer.class)).isEqualTo(18);
            }
        }
    }
    @TempDir Path temporary;
    private final List<CustomerServiceIdentityPreparation> ownedCandidates=new java.util.ArrayList<>();
    @org.junit.jupiter.api.AfterEach void closeCandidateClients(){ownedCandidates.forEach(CustomerServiceIdentityPreparation::close);}
    private static final UUID TENANT=UUID.fromString("11111111-1111-4111-8111-111111111111");
    private static final UUID USER=UUID.fromString("33333333-3333-4333-8333-333333333333");
    private static final UUID DECOY=UUID.fromString("44444444-4444-4444-8444-444444444444");
    private static final UUID ROLE=UUID.fromString("55555555-5555-4555-8555-555555555555");
    private static final String CS_PASSWORD="Synthetic-password-123";
    private static final String ERP_PASSWORD="Synthetic-native-ERP-password-123";
    private static final String EMAIL="agent@example.invalid";
    private static final HttpClient HTTP=HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build();

    @SuppressWarnings("resource")
    @Test void durableTwoDatabaseIdentitySurvivesReplicasAndRejectsUnobservedRevocations() throws Exception {
        try(var postgres=new PostgreSQLContainer<>("postgres:16-alpine").withImagePullPolicy(image->false)
                .withDatabaseName("identity_preparation").withUsername("synthetic_erp").withPassword("synthetic_erp");
            var cs=new PostgreSQLContainer<>("postgres:16-alpine").withImagePullPolicy(image->false)
                .withDatabaseName("cs_identity_rehearsal").withUsername("synthetic_cs_owner").withPassword("synthetic_cs_owner")) {
            postgres.start();cs.start();
            try(var connection=DriverManager.getConnection(cs.getJdbcUrl(),cs.getUsername(),cs.getPassword());var statement=connection.createStatement()) {
                statement.execute("COMMENT ON DATABASE cs_identity_rehearsal IS 'xz-erp-owned-identity-rehearsal-v1'");
                statement.execute(Files.readString(Path.of("../customer-service/deploy/postgres-init/001_customer_service_schema_roles.sql")));
            }
            var environment=new StandardEnvironment();
            environment.getPropertySources().remove(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME);
            environment.getPropertySources().remove(StandardEnvironment.SYSTEM_PROPERTIES_PROPERTY_SOURCE_NAME);
            Map<String,Object> config=new HashMap<>();
            config.put("spring.datasource.url",postgres.getJdbcUrl());config.put("spring.datasource.username",postgres.getUsername());config.put("spring.datasource.password",postgres.getPassword());
            config.put("server.address","127.0.0.1");config.put("server.port","0");config.put("erp.environment","integration-test");
            config.put("logging.level.root","ERROR");config.put("spring.main.banner-mode","off");config.put("erp.channel-connector.mode","unconfigured");
            environment.getPropertySources().addFirst(new MapPropertySource("owned-durable-identity-preparation",config));
            try(var app=new SpringApplicationBuilder(ErpApplication.class).web(WebApplicationType.SERVLET).environment(environment).run();
                var go=SyntheticStoreAppProcess.startIdentityPostgres(temporary,cs.getMappedPort(5432))) {
                var db=new JdbcTemplate(app.getBean(DataSource.class));seed(db,app);
                try(var connection=app.getBean(DataSource.class).getConnection()){BusinessApplicationTestData.enableErpForTenant(connection,TENANT);}
                db.update("UPDATE roles SET code='tenant_admin',system_role=true WHERE id=?",ROLE);
                db.execute(Files.readString(Path.of("../preparation/sql/erp-identity.sql")));
                try(var connection=DriverManager.getConnection(cs.getJdbcUrl(),"customer_service_migrator","not-a-real-secret-customer-service-migrator");var statement=connection.createStatement()) {
                    statement.execute(Files.readString(Path.of("../preparation/sql/customer-service-identity.sql")));
                }
                byte[] key=new byte[32];new SecureRandom().nextBytes(key);
                var state=state(app,db,key);var actor=new IamActor(TENANT,USER,"synthetic-review","127.0.0.1");
                assertThatThrownBy(()->state.review(new IamActor(TENANT,DECOY,"no-role","127.0.0.1"),binding(1),0,"CONFIRMED","evidence-1")).isInstanceOf(Rejected.class);
                assertThatThrownBy(()->state.review(new IamActor(TENANT,USER,DECOY,"platform","127.0.0.1"),binding(1),0,"CONFIRMED","evidence-1")).isInstanceOf(Rejected.class);
                for(int version=1;version<=7;version++)state.review(actor,binding(version),version-1,"CONFIRMED","synthetic-reviewed-"+version);
                assertThatThrownBy(()->state.review(actor,binding(7),6,"DISABLED","stale-review")).isInstanceOf(Rejected.class);
                assertThat(db.queryForObject("SELECT count(*) FROM integration_preparation.identity_audit",Integer.class)).isEqualTo(7);
                var before=protectedTables(db);
                var candidate=candidate(app,go.baseUrl,7,state);
                var first=candidate.login(TENANT,EMAIL,CS_PASSWORD.toCharArray());
                assertThat(candidate.validateSession(first.token()).userId()).isEqualTo(USER);
                assertThat(candidate(app,go.baseUrl,7,state(app,db,key)).validateSession(first.token()).userId()).isEqualTo(USER);
                db.update("UPDATE users SET status='DISABLED' WHERE id=?",DECOY);
                db.update("UPDATE users SET status='ACTIVE' WHERE id=?",DECOY);
                assertThat(candidate.validateSession(first.token()).userId()).isEqualTo(USER); // unrelated account does not end this session
                String stored=db.queryForObject("SELECT encode(encrypted_lease,'hex') FROM integration_preparation.identity_sessions",String.class);
                assertThat(stored).hasSize(118); // 43-byte opaque lease plus 16-byte GCM tag
                byte[] wrongKey=new byte[32];new SecureRandom().nextBytes(wrongKey);
                assertThatThrownBy(()->candidate(app,go.baseUrl,7,state(app,db,wrongKey)).validateSession(first.token())).isInstanceOf(Rejected.class);
                // A failed decryption with a wrong process key cannot revoke a legitimate session.
                assertThat(candidate.validateSession(first.token()).userId()).isEqualTo(USER);
                try(var replica=SyntheticStoreAppProcess.startIdentityPostgres(temporary,cs.getMappedPort(5432))) {
                    var restarted=candidate(app,replica.baseUrl,7,state(app,db,key));
                    assertThat(restarted.validateSession(first.token()).userId()).isEqualTo(USER);
                    String attempt="Z".repeat(43);
                    String input="{\"tenantId\":\""+TENANT+"\",\"target\":\"ERP\",\"attempt\":\""+attempt+"\",\"email\":\"agent@example.invalid\",\"password\":\"Synthetic-password-123\"}";
                    var verified=HTTP.send(identityRequest(go.baseUrl,"verify",input),HttpResponse.BodyHandlers.ofString());
                    assertThat(verified.statusCode()).isEqualTo(200);
                    String grant=new ObjectMapper().readTree(verified.body()).path("grant").asString();
                    String exchange="{\"tenantId\":\""+TENANT+"\",\"target\":\"ERP\",\"attempt\":\""+attempt+"\",\"grant\":\""+grant+"\"}";
                    var left=HTTP.sendAsync(identityRequest(go.baseUrl,"exchange",exchange),HttpResponse.BodyHandlers.discarding());
                    var right=HTTP.sendAsync(identityRequest(replica.baseUrl,"exchange",exchange),HttpResponse.BodyHandlers.discarding());
                    assertThat(List.of(left.get().statusCode(),right.get().statusCode())).containsExactlyInAnyOrder(200,401);
                    assertThat(post(replica.baseUrl,"/rehearsal/control/online","{}").statusCode()).isEqualTo(204);
                    assertThat(post(go.baseUrl,"/rehearsal/control/offline","{}").statusCode()).isEqualTo(204);
                    assertThat(restarted.validateSession(first.token()).userId()).isEqualTo(USER);
                    assertThat(post(go.baseUrl,"/rehearsal/control/disable","{}").statusCode()).isEqualTo(204);
                    assertThat(post(replica.baseUrl,"/rehearsal/control/activate","{}").statusCode()).isEqualTo(204);
                    assertThatThrownBy(()->restarted.validateSession(first.token())).isInstanceOf(Rejected.class);
                    assertThatThrownBy(()->candidate.validateSession(first.token())).isInstanceOf(Rejected.class);
                }
                var second=candidate.login(TENANT,EMAIL,CS_PASSWORD.toCharArray());
                // Revoke and restore AFTER ERP has read its lease, while its
                // remote CS validation is in flight. Final authorization must
                // atomically re-check the current epochs, not its old snapshot.
                var revokingProxy=com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1",0),0);
                revokingProxy.createContext("/internal/v1/erp-identity-preparation/validate",exchange->{
                    try {
                        db.update("UPDATE users SET status='DISABLED' WHERE id=?",USER);
                        db.update("UPDATE users SET status='ACTIVE' WHERE id=?",USER);
                        String body=new String(exchange.getRequestBody().readNBytes(4096),java.nio.charset.StandardCharsets.UTF_8);
                        var response=HTTP.send(identityRequest(go.baseUrl,"validate",body),HttpResponse.BodyHandlers.ofByteArray());
                        exchange.getResponseHeaders().set("Cache-Control","no-store");
                        exchange.sendResponseHeaders(response.statusCode(),response.body().length);exchange.getResponseBody().write(response.body());
                    }catch(Exception failure){exchange.sendResponseHeaders(503,-1);}finally{exchange.close();}
                });
                revokingProxy.start();
                try {
                    String proxyBase="http://127.0.0.1:"+revokingProxy.getAddress().getPort();
                    assertThatThrownBy(()->candidate(app,proxyBase,7,state(app,db,key)).validateSession(second.token())).isInstanceOf(Rejected.class);
                }finally{revokingProxy.stop(0);}
                assertThat(db.queryForObject("SELECT status FROM users WHERE id=?",String.class,USER)).isEqualTo("ACTIVE");
                var third=candidate.login(TENANT,EMAIL,CS_PASSWORD.toCharArray());
                db.update("DELETE FROM user_enabled_applications WHERE tenant_id=? AND user_id=? AND application_code='ERP'",TENANT,USER);
                try(var connection=app.getBean(DataSource.class).getConnection()){BusinessApplicationTestData.enableErpForTenant(connection,TENANT);}
                assertThatThrownBy(()->candidate.validateSession(third.token())).isInstanceOf(Rejected.class);
                var fourth=candidate.login(TENANT,EMAIL,CS_PASSWORD.toCharArray());
                state.review(actor,binding(8),7,"DISABLED","synthetic-revocation");
                assertThatThrownBy(()->candidate.validateSession(fourth.token())).isInstanceOf(Rejected.class);
                assertThat(db.queryForObject("SELECT count(*) FROM integration_preparation.identity_audit",Integer.class)).isEqualTo(8);
                assertThat(protectedTables(db)).isEqualTo(before);
                assertThat(get(go.baseUrl,"/api/v1/auth/me","synthetic-original-cs-session").statusCode()).isEqualTo(200);
                assertThat(new ObjectMapper().readTree(get(go.baseUrl,"/rehearsal/evidence",null).body()).path("receptionOnline").asBoolean()).isFalse();
                assertThat(app.getBeansOfType(CustomerServiceIdentityPreparation.class)).isEmpty();
                assertThat(get("http://127.0.0.1:"+app.getEnvironment().getRequiredProperty("local.server.port"),"/api/v1/auth/me",fourth.token()).statusCode()).isEqualTo(401);
                assertThat(db.update("DELETE FROM auth_sessions WHERE user_id=?",USER)).isEqualTo(4);
                assertThat(db.queryForObject("SELECT count(*) FROM integration_preparation.identity_sessions",Integer.class)).isZero();
            }
        }
    }

    private static Binding binding(long version){return new Binding(TENANT,USER,"cs-existing-agent","reviewed-subject-1",version);}
    private static PersistentIdentityPreparationState state(ConfigurableApplicationContext app,JdbcTemplate db,byte[] key){
        return new PersistentIdentityPreparationState(db,app.getBean(PlatformTransactionManager.class),app.getBean(IamAssignmentStore.class),key);
    }
    private CustomerServiceIdentityPreparation candidate(ConfigurableApplicationContext app,String base,long version,PersistentIdentityPreparationState state){
        var candidate=new CustomerServiceIdentityPreparation(binding(version),URI.create(base),"synthetic-identity-service-token-not-real",
                app.getBean(UserAccountRepository.class),app.getBean(AuthSessionRepository.class),app.getBean(PermissionRepository.class),
                app.getBean(UserApplicationAccessService.class),app.getBean(TenantEntitlementService.class),app.getBean(SessionTokenService.class),app.getBean(PlatformTransactionManager.class),app.getBean(Clock.class),state);
        ownedCandidates.add(candidate);return candidate;
    }

    @SuppressWarnings("resource")
    @Test void realGoCredentialsCreateIndependentERPRowWithLiveLocalPermissionsAndNoProductionMount() throws Exception {
        // Own PostgreSQL 16 only. No external DB URL, environment credentials,
        // production CS project or platform settings are read by the fixture.
        try(var postgres=new PostgreSQLContainer<>("postgres:16-alpine").withImagePullPolicy(image->false)
                .withDatabaseName("identity_preparation").withUsername("synthetic_erp").withPassword("synthetic_erp");
            var go=SyntheticStoreAppProcess.startIdentity(temporary)) {
            postgres.start();
            var environment=new StandardEnvironment();
            environment.getPropertySources().remove(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME);
            environment.getPropertySources().remove(StandardEnvironment.SYSTEM_PROPERTIES_PROPERTY_SOURCE_NAME);
            Map<String,Object> config=new HashMap<>();
            config.put("spring.datasource.url",postgres.getJdbcUrl()); config.put("spring.datasource.username",postgres.getUsername());config.put("spring.datasource.password",postgres.getPassword());
            config.put("server.address","127.0.0.1");config.put("server.port","0");config.put("erp.environment","integration-test");
            config.put("logging.level.root","ERROR");config.put("spring.main.banner-mode","off");config.put("erp.channel-connector.mode","unconfigured");
            environment.getPropertySources().addFirst(new MapPropertySource("owned-identity-preparation",config));
            try(var app=new SpringApplicationBuilder(ErpApplication.class).web(WebApplicationType.SERVLET).environment(environment).run()) {
                var dataSource=app.getBean(DataSource.class);var db=new JdbcTemplate(dataSource);seed(db,app);
                assertThat(app.getBeansOfType(CustomerServiceIdentityPreparation.class)).isEmpty();
                var candidate=candidate(app,go.baseUrl,7);
                // Enterprise and member business access must ALREADY exist.
                assertThatThrownBy(()->candidate.login(TENANT,EMAIL,CS_PASSWORD.toCharArray())).isInstanceOf(Rejected.class);
                assertThat(db.queryForObject("SELECT count(*) FROM auth_sessions",Integer.class)).isZero();
                try(var connection=dataSource.getConnection()){BusinessApplicationTestData.enableErpForTenant(connection,TENANT);}
                Map<String,String> before=protectedTables(db);
                char[] bad="incorrect-synthetic-password".toCharArray();
                assertThatThrownBy(()->candidate.login(TENANT,EMAIL,bad)).isInstanceOf(Rejected.class);
                for(char c:bad) assertThat(c).isEqualTo('\0');
                assertThat(db.queryForObject("SELECT count(*) FROM auth_sessions",Integer.class)).isZero();
                char[] good=CS_PASSWORD.toCharArray();
                var first=candidate.login(TENANT,EMAIL,good);
                for(char c:good) assertThat(c).isEqualTo('\0');
                assertThat(first.toString()).doesNotContain(first.token());
                assertThat(first.session().userId()).isEqualTo(USER).isNotEqualTo(DECOY);
                assertThat(first.session().permissions()).containsExactly("orders.read").doesNotContain("workbench.access");
                assertThat(candidate.validateSession(first.token()).userId()).isEqualTo(USER);
                assertThat(protectedTables(db)).isEqualTo(before);
                assertThat(db.queryForObject("SELECT count(*) FROM auth_sessions WHERE user_id=?",Integer.class,USER)).isEqualTo(1);
                assertThat(db.queryForObject("SELECT count(*) FROM auth_sessions WHERE user_id=?",Integer.class,DECOY)).isZero();
                var evidence=new ObjectMapper().readTree(get(go.baseUrl,"/rehearsal/evidence",null).body());
                assertThat(evidence.path("originalUserUnchanged").asBoolean()).isTrue();
                assertThat(evidence.path("originalSessionValid").asBoolean()).isTrue();
                assertThat(evidence.path("receptionOnline").asBoolean()).isFalse();

                String erp="http://127.0.0.1:"+app.getEnvironment().getRequiredProperty("local.server.port");
                // Candidate session is intentionally unusable at current ERP or
                // CS APIs. Ordinary native ERP sessions remain operational.
                assertThat(get(erp,"/api/v1/auth/me",first.token()).statusCode()).isEqualTo(401);
                assertThat(get(go.baseUrl,"/api/v1/auth/me",first.token()).statusCode()).isEqualTo(401);
                var nativeERP=app.getBean(LoginService.class).login(new LoginCommand("identity_rehearsal","existing-erp@example.invalid",ERP_PASSWORD,"synthetic-native-login","127.0.0.1"));
                assertThat(get(erp,"/api/v1/auth/me",nativeERP.accessToken()).statusCode()).isEqualTo(200);
                assertThatThrownBy(()->candidate.validateSession(nativeERP.accessToken())).isInstanceOf(Rejected.class);
                assertThatThrownBy(()->candidate(app,go.baseUrl,7).validateSession(first.token())).isInstanceOf(Rejected.class); // restart fails closed
                db.update("DELETE FROM user_enabled_applications WHERE tenant_id=? AND user_id=? AND application_code='ERP'",TENANT,USER);
                assertThatThrownBy(()->candidate.validateSession(first.token())).isInstanceOf(Rejected.class);
                try(var connection=dataSource.getConnection()){BusinessApplicationTestData.enableErpForTenant(connection,TENANT);}
                assertThatThrownBy(()->candidate.validateSession(first.token())).isInstanceOf(Rejected.class); // restoring access cannot resurrect an observed revoked lease
                candidate.logout(first.token());
                assertThatThrownBy(()->candidate.validateSession(first.token())).isInstanceOf(Rejected.class);
                assertThat(get(erp,"/api/v1/auth/me",nativeERP.accessToken()).statusCode()).isEqualTo(200);
                assertThat(get(go.baseUrl,"/api/v1/auth/me","synthetic-original-cs-session").statusCode()).isEqualTo(200);
                assertThat(protectedTables(db)).isEqualTo(before);

                var second=candidate.login(TENANT,EMAIL,CS_PASSWORD.toCharArray());
                // Native CS login independently starts reception; ERP logout
                // must not undo it or revoke the resulting CS business session.
                var csLogin=post(go.baseUrl,"/api/v1/auth/login","{\"email\":\"agent@example.invalid\",\"password\":\"Synthetic-password-123\"}");
                assertThat(csLogin.statusCode()).isEqualTo(200);
                String csSession=new ObjectMapper().readTree(csLogin.body()).path("token").asString();
                assertThat(new ObjectMapper().readTree(get(go.baseUrl,"/rehearsal/evidence",null).body()).path("receptionOnline").asBoolean()).isTrue();
                assertThat(candidate.validateSession(second.token()).userId()).isEqualTo(USER);
                candidate.logout(second.token());
                assertThat(get(go.baseUrl,"/api/v1/auth/me",csSession).statusCode()).isEqualTo(200);
                assertThat(new ObjectMapper().readTree(get(go.baseUrl,"/rehearsal/evidence",null).body()).path("receptionOnline").asBoolean()).isTrue();

                var third=candidate.login(TENANT,EMAIL,CS_PASSWORD.toCharArray());
                db.update("DELETE FROM role_permissions WHERE role_id=?",ROLE);
                assertThat(candidate.validateSession(third.token()).permissions()).isEmpty();
                db.update("UPDATE users SET status='DISABLED' WHERE id=?",USER);
                assertThatThrownBy(()->candidate.validateSession(third.token())).isInstanceOf(Rejected.class);
                db.update("UPDATE users SET status='ACTIVE' WHERE id=?",USER);
                assertThatThrownBy(()->candidate.validateSession(third.token())).isInstanceOf(Rejected.class);
                var fourth=candidate.login(TENANT,EMAIL,CS_PASSWORD.toCharArray());
                assertThat(post(go.baseUrl,"/rehearsal/control/disable","{}").statusCode()).isEqualTo(204);
                assertThatThrownBy(()->candidate.validateSession(fourth.token())).isInstanceOf(Rejected.class);
                assertThat(post(go.baseUrl,"/rehearsal/control/activate","{}").statusCode()).isEqualTo(204);
                assertThatThrownBy(()->candidate.validateSession(fourth.token())).isInstanceOf(Rejected.class);
                // Fifth successful attempt would exceed the same minute's
                // server limit (one earlier failed attempt); use the existing
                // native ERP row to show account changes did not change IDs.
                assertThat(db.queryForObject("SELECT count(*) FROM users",Integer.class)).isEqualTo(2);
                assertThat(db.queryForObject("SELECT count(*) FROM users WHERE id=? AND email='existing-erp@example.invalid'",Integer.class,USER)).isEqualTo(1);
                assertThat(db.queryForObject("SELECT password_hash FROM users WHERE id=?",String.class,USER))
                        .isNotEqualTo(CS_PASSWORD); // full account snapshot already checked before explicit fixture faults
            }
        }
    }

    private CustomerServiceIdentityPreparation candidate(ConfigurableApplicationContext app,String base,long version) {
        var candidate=new CustomerServiceIdentityPreparation(new Binding(TENANT,USER,"cs-existing-agent","reviewed-subject-1",version),URI.create(base),"synthetic-identity-service-token-not-real",
                app.getBean(UserAccountRepository.class),app.getBean(AuthSessionRepository.class),app.getBean(PermissionRepository.class),
                app.getBean(UserApplicationAccessService.class),app.getBean(TenantEntitlementService.class),app.getBean(SessionTokenService.class),app.getBean(PlatformTransactionManager.class),app.getBean(Clock.class));
        ownedCandidates.add(candidate);return candidate;
    }
    private static HttpRequest identityRequest(String base,String operation,String body){
        return HttpRequest.newBuilder(URI.create(base+"/internal/v1/erp-identity-preparation/"+operation)).timeout(Duration.ofSeconds(10))
                .header("X-XZ-Identity-Service-Token","synthetic-identity-service-token-not-real").header("Content-Type","application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body)).build();
    }
    static void seed(JdbcTemplate db,ConfigurableApplicationContext app) {
        seed(db,app,"existing-erp@example.invalid","agent@example.invalid");
    }
    static void seed(JdbcTemplate db,ConfigurableApplicationContext app,String firstEmail,String secondEmail) {
        db.update("INSERT INTO tenants (id,code,name) VALUES (?,'identity_rehearsal','Synthetic identity enterprise')",TENANT);
        String hash=app.getBean(PasswordHashingService.class).hashForStorage(ERP_PASSWORD.toCharArray());
        db.update("INSERT INTO users (id,tenant_id,username,email,display_name,status,password_hash) VALUES (?,?,?,?,'Original ERP user','ACTIVE',?)",USER,TENANT,firstEmail,firstEmail,hash);
        db.update("INSERT INTO users (id,tenant_id,username,email,display_name,status,password_hash) VALUES (?,?,?,?,'Different same-email user','ACTIVE',?)",DECOY,TENANT,secondEmail,secondEmail,hash);
        db.update("INSERT INTO roles (id,tenant_id,code,name) VALUES (?,?,'identity_reader','Original ERP role')",ROLE,TENANT);
        db.update("INSERT INTO user_roles (tenant_id,user_id,role_id) VALUES (?,?,?)",TENANT,USER,ROLE);
        assertThat(db.update("INSERT INTO role_permissions (tenant_id,role_id,permission_id) SELECT ?,?,id FROM permissions WHERE code='orders.read'",TENANT,ROLE)).isEqualTo(1);
    }
    private static Map<String,String> protectedTables(JdbcTemplate db) {
        var result=new HashMap<String,String>();
        for(String table:List.of("users","roles","user_roles","role_permissions","tenant_shops","shop_authorizations","tenant_orders"))
            result.put(table,db.queryForObject("SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) FROM "+table+" t",String.class));
        return result;
    }
    private static HttpResponse<String> get(String base,String path,String token) throws Exception {
        var builder=HttpRequest.newBuilder(URI.create(base+path)).timeout(Duration.ofSeconds(10));if(token!=null)builder.header("Authorization","Bearer "+token);
        return HTTP.send(builder.build(),HttpResponse.BodyHandlers.ofString());
    }
    private static HttpResponse<String> post(String base,String path,String body) throws Exception {
        return HTTP.send(HttpRequest.newBuilder(URI.create(base+path)).timeout(Duration.ofSeconds(10)).header("Content-Type","application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.ofString());
    }
}
