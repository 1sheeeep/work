package cn.xzkj.erp.platform.connector;

import static org.assertj.core.api.Assertions.assertThat;

import cn.xzkj.erp.ErpApplication;
import cn.xzkj.erp.iam.application.*;
import cn.xzkj.erp.iam.persistence.*;
import cn.xzkj.erp.iam.preparation.*;
import cn.xzkj.erp.tenantaccess.*;
import cn.xzkj.erp.testing.BusinessApplicationTestData;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.SecureRandom;
import java.sql.DriverManager;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.regex.Pattern;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.core.annotation.Order;
import org.springframework.core.env.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.web.servlet.function.*;
import org.testcontainers.containers.PostgreSQLContainer;

public class IdentityPreparationBrowserTest {
    @TempDir Path temporary;
    private static final UUID TENANT=UUID.fromString("11111111-1111-4111-8111-111111111111");
    private static final UUID USER=UUID.fromString("33333333-3333-4333-8333-333333333333");
    private static final String ROOT=IdentityPreparationBrowser.ROOT;

    @Test void realHttpFormUsesCsrfIndependentCookiesAndNoTokenInHtmlOrRedirect() throws Exception {
        try(var fixture=new Owned(temporary)) {
            var cookies=new CookieManager(null,CookiePolicy.ACCEPT_ALL);
            var browser=HttpClient.newBuilder().cookieHandler(cookies).followRedirects(HttpClient.Redirect.NEVER).build();
            var page=get(browser,fixture.base+ROOT+"/login");
            assertThat(page.statusCode()).isEqualTo(200);
            assertThat(page.headers().firstValue("Referrer-Policy").orElseThrow()).isEqualTo("same-origin");
            assertThat(page.headers().firstValue("Content-Security-Policy").orElseThrow()).contains("form-action 'self'","frame-ancestors 'none'");
            assertThat(page.headers().allValues("Set-Cookie").toString()).contains("HttpOnly","SameSite=Strict");
            String csrf=csrf(page.body());
            String good="email=agent%40example.invalid&password=Synthetic-password-123&_csrf="+csrf;
            assertThat(post(browser,fixture.base,ROOT+"/login",good,null).statusCode()).isEqualTo(403);
            assertThat(post(browser,fixture.base,ROOT+"/login",good,"https://cross-site.invalid").statusCode()).isEqualTo(403);
            assertThat(post(browser,fixture.base,ROOT+"/login",good,"null").statusCode()).isEqualTo(403);
            assertThat(post(HttpClient.newHttpClient(),fixture.base,ROOT+"/login",good,fixture.base).statusCode()).isEqualTo(403);
            assertThat(post(browser,fixture.base,ROOT+"/login","email=agent%40example.invalid&password=Synthetic-password-123",fixture.base).statusCode()).isEqualTo(403);
            var wrong=post(browser,fixture.base,ROOT+"/login","email=agent%40example.invalid&password=wrong-synthetic-password&_csrf="+csrf,fixture.base);
            assertThat(wrong.statusCode()).isEqualTo(401);
            assertThat(wrong.body()).contains("role=\"alert\"","agent@example.invalid").doesNotContain("wrong-synthetic-password","value=\"Synthetic");
            var login=post(browser,fixture.base,ROOT+"/login",good,fixture.base);
            assertThat(login.statusCode()).isEqualTo(303);
            assertThat(login.headers().firstValue("Location").orElseThrow()).isEqualTo(ROOT+"/workbench");
            assertThat(login.body()).isEmpty();
            assertThat(login.headers().allValues("Set-Cookie").toString()).contains("HttpOnly","SameSite=Strict","Path="+ROOT);
            var workbench=get(browser,fixture.base+ROOT+"/workbench");
            assertThat(workbench.statusCode()).isEqualTo(200);
            assertThat(workbench.body()).contains("登录成功").doesNotContain("cs-preparation_","Synthetic-password","reviewed-subject");
            assertThat(get(browser,fixture.base+"/api/v1/auth/me").statusCode()).isEqualTo(401);
            var evidence=get(browser,fixture.go.baseUrl+"/rehearsal/evidence");
            assertThat(evidence.body()).contains("\"originalSessionValid\":true","\"receptionOnline\":false","\"originalUserUnchanged\":true");
            assertThat(post(browser,fixture.base,ROOT+"/logout","_csrf="+csrf(workbench.body()),fixture.base).statusCode()).isEqualTo(303);
            assertThat(get(browser,fixture.base+ROOT+"/workbench").statusCode()).isEqualTo(303);
            assertThat(fixture.db.queryForObject("SELECT count(*) FROM auth_sessions WHERE revoked_at IS NULL",Integer.class)).isZero();
            assertThat(get(browser,fixture.go.baseUrl+"/rehearsal/evidence").body()).contains("\"originalSessionValid\":true","\"receptionOnline\":false");
        }
    }

    private static String csrf(String html) {
        var match=Pattern.compile("name=\"_csrf\" value=\"([^\"]+)\"").matcher(html);assertThat(match.find()).isTrue();return match.group(1);
    }
    private static HttpResponse<String> get(HttpClient http,String uri)throws Exception {
        return http.send(HttpRequest.newBuilder(URI.create(uri)).timeout(Duration.ofSeconds(15)).build(),HttpResponse.BodyHandlers.ofString());
    }
    private static HttpResponse<String> post(HttpClient http,String base,String path,String form,String origin)throws Exception {
        var request=HttpRequest.newBuilder(URI.create(base+path)).timeout(Duration.ofSeconds(15)).header("Content-Type","application/x-www-form-urlencoded");
        if(origin!=null)request.header("Origin",origin);
        return http.send(request.POST(HttpRequest.BodyPublishers.ofString(form)).build(),HttpResponse.BodyHandlers.ofString());
    }

    // Executable fixed local fixture. No address, credential or real user inputs.
    public static void main(String[] args)throws Exception {
        if(args.length!=0)throw new IllegalArgumentException("Owned browser rehearsal takes no arguments");
        Path output=Files.createTempDirectory(Path.of("target").toAbsolutePath(),"owned-identity-browser-");
        try(var fixture=new Owned(output);var executor=Executors.newVirtualThreadPerTaskExecutor()) {
            System.out.println("OWNED_IDENTITY_BROWSER_READY "+fixture.base+ROOT+"/login");
            System.out.flush();
            try{executor.submit(()->System.in.read()).get(10,TimeUnit.MINUTES);}catch(TimeoutException deadline){System.in.close();}
        }
    }

    static final class Holder {CustomerServiceIdentityPreparation candidate;}
    @TestConfiguration(proxyBeanMethods=false)
    static class BrowserConfig {
        // Local browser diagnostics only: no bodies, identifiers, cookies,
        // passwords, CSRF tokens or query strings are logged.
        @Bean org.springframework.boot.web.servlet.FilterRegistrationBean<jakarta.servlet.Filter> ownedBrowserAudit() {
            var registration=new org.springframework.boot.web.servlet.FilterRegistrationBean<jakarta.servlet.Filter>();
            registration.setFilter((request,response,chain)->{
                chain.doFilter(request,response);
                var http=(jakarta.servlet.http.HttpServletRequest)request;
                var result=(jakarta.servlet.http.HttpServletResponse)response;
                String expected="http://127.0.0.1:"+http.getLocalPort();
                String origin=http.getHeader("Origin");
                String originClass=origin==null?"absent":expected.equals(origin)?"same":"other";
                System.out.println("OWNED_BROWSER_HTTP method="+http.getMethod()+" status="+result.getStatus()
                        +" origin="+originClass+" hostMatches="+("127.0.0.1:"+http.getLocalPort()).equals(http.getHeader("Host"))
                        +" crossSite="+"cross-site".equals(http.getHeader("Sec-Fetch-Site")));
            });
            registration.addUrlPatterns(ROOT+"/*");return registration;
        }
        @Bean @Order(0) SecurityFilterChain ownedIdentityBrowserSecurity(HttpSecurity http)throws Exception {return IdentityPreparationBrowser.security(http);}
        @Bean RouterFunction<ServerResponse> ownedIdentityBrowserRoutes(Holder holder,ConfigurableApplicationContext app) {
            return new IdentityPreparationBrowser(TENANT,()->holder.candidate,
                    ()->URI.create("http://127.0.0.1:"+app.getEnvironment().getRequiredProperty("local.server.port"))).routes();
        }
    }
    static final class Owned implements AutoCloseable {
        final PostgreSQLContainer<?> erp=new PostgreSQLContainer<>("postgres:16-alpine").withImagePullPolicy(image->false)
                .withDatabaseName("identity_browser_rehearsal").withUsername("synthetic_erp").withPassword("synthetic_erp");
        final PostgreSQLContainer<?> cs=new PostgreSQLContainer<>("postgres:16-alpine").withImagePullPolicy(image->false)
                .withDatabaseName("cs_identity_rehearsal").withUsername("synthetic_cs_owner").withPassword("synthetic_cs_owner");
        ConfigurableApplicationContext app;SyntheticStoreAppProcess go;JdbcTemplate db;String base;final Holder holder=new Holder();
        Owned(Path temporary)throws Exception {
            try {
                erp.start();cs.start();
                try(var c=DriverManager.getConnection(cs.getJdbcUrl(),cs.getUsername(),cs.getPassword());var s=c.createStatement()) {
                    s.execute("COMMENT ON DATABASE cs_identity_rehearsal IS 'xz-erp-owned-identity-rehearsal-v1'");
                    s.execute(Files.readString(Path.of("../customer-service/deploy/postgres-init/001_customer_service_schema_roles.sql")));
                }
                go=SyntheticStoreAppProcess.startIdentityPostgres(temporary,cs.getMappedPort(5432));
                try(var c=DriverManager.getConnection(cs.getJdbcUrl(),"customer_service_migrator","not-a-real-secret-customer-service-migrator");var s=c.createStatement()) {
                    s.execute(Files.readString(Path.of("../preparation/sql/customer-service-identity.sql")));
                }
                var env=new StandardEnvironment();env.getPropertySources().remove(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME);env.getPropertySources().remove(StandardEnvironment.SYSTEM_PROPERTIES_PROPERTY_SOURCE_NAME);
                Map<String,Object> p=new HashMap<>();p.put("spring.datasource.url",erp.getJdbcUrl());p.put("spring.datasource.username",erp.getUsername());p.put("spring.datasource.password",erp.getPassword());
                p.put("server.address","127.0.0.1");p.put("server.port","0");p.put("erp.environment","integration-test");p.put("logging.level.root","ERROR");p.put("spring.main.banner-mode","off");p.put("erp.channel-connector.mode","unconfigured");
                p.put("server.servlet.session.cookie.name","XZ_PREP_CSRF");p.put("server.servlet.session.cookie.path",ROOT);p.put("server.servlet.session.cookie.same-site","strict");p.put("server.servlet.session.cookie.http-only",true);
                p.put("server.tomcat.max-http-form-post-size","4KB");p.put("server.servlet.session.tracking-modes","cookie");
                env.getPropertySources().addFirst(new MapPropertySource("owned-browser-rehearsal",p));
                app=new SpringApplicationBuilder(ErpApplication.class,BrowserConfig.class).web(WebApplicationType.SERVLET).environment(env)
                        .initializers(c->c.getBeanFactory().registerSingleton("ownedBrowserHolder",holder)).run();
                db=new JdbcTemplate(app.getBean(DataSource.class));CustomerServiceIdentityPreparationPostgresql16GateTest.seed(db,app);
                try(var c=app.getBean(DataSource.class).getConnection()){BusinessApplicationTestData.enableErpForTenant(c,TENANT);}
                db.update("UPDATE roles SET code='tenant_admin',system_role=true WHERE id='55555555-5555-4555-8555-555555555555'");
                db.execute(Files.readString(Path.of("../preparation/sql/erp-identity.sql")));
                byte[] key=new byte[32];new SecureRandom().nextBytes(key);
                var state=new PersistentIdentityPreparationState(db,app.getBean(PlatformTransactionManager.class),app.getBean(IamAssignmentStore.class),key);
                for(int v=1;v<=7;v++)state.review(new IamActor(TENANT,USER,"owned-browser-review","127.0.0.1"),binding(v),v-1,"CONFIRMED","synthetic-review-"+v);
                holder.candidate=new CustomerServiceIdentityPreparation(binding(7),URI.create(go.baseUrl),"synthetic-identity-service-token-not-real",
                        app.getBean(UserAccountRepository.class),app.getBean(AuthSessionRepository.class),app.getBean(PermissionRepository.class),app.getBean(UserApplicationAccessService.class),app.getBean(TenantEntitlementService.class),app.getBean(SessionTokenService.class),app.getBean(PlatformTransactionManager.class),app.getBean(Clock.class),state);
                base="http://127.0.0.1:"+app.getEnvironment().getRequiredProperty("local.server.port");
            }catch(Exception failure){close();throw failure;}
        }
        private static CustomerServiceIdentityPreparation.Binding binding(int v){return new CustomerServiceIdentityPreparation.Binding(TENANT,USER,"cs-existing-agent","reviewed-subject-1",v);}
        public void close()throws Exception {
            try {if(holder.candidate!=null)holder.candidate.close();if(app!=null)app.close();}
            finally {try{if(go!=null)go.close();}finally{try{cs.close();}finally{erp.close();}}}
        }
    }
}
