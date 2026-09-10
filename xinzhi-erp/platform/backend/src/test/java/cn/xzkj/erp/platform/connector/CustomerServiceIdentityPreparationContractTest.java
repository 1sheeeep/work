package cn.xzkj.erp.platform.connector;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import cn.xzkj.erp.iam.application.SessionTokenService;
import cn.xzkj.erp.iam.domain.AccountStatus;
import cn.xzkj.erp.iam.domain.TenantStatus;
import cn.xzkj.erp.iam.persistence.*;
import cn.xzkj.erp.iam.preparation.CustomerServiceIdentityPreparation;
import cn.xzkj.erp.iam.preparation.CustomerServiceIdentityPreparation.Binding;
import cn.xzkj.erp.iam.preparation.CustomerServiceIdentityPreparation.Rejected;
import cn.xzkj.erp.tenantaccess.TenantEntitlementService;
import cn.xzkj.erp.tenantaccess.UserApplicationAccessService;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import tools.jackson.databind.ObjectMapper;

class CustomerServiceIdentityPreparationContractTest {
    private final java.util.List<CustomerServiceIdentityPreparation> ownedCandidates=new java.util.ArrayList<>();
    @org.junit.jupiter.api.AfterEach void closeCandidateClients(){ownedCandidates.forEach(CustomerServiceIdentityPreparation::close);}
    private static final UUID TENANT=UUID.fromString("11111111-1111-4111-8111-111111111111");
    private static final UUID USER=UUID.fromString("33333333-3333-4333-8333-333333333333");
    private static final Binding BINDING=new Binding(TENANT,USER,"cs-existing-agent","reviewed-subject-1",7);
    private final AuthSessionRepository sessions=mock(AuthSessionRepository.class);
    private final UserAccountRepository users=mock(UserAccountRepository.class);

    @ParameterizedTest @ValueSource(strings={"http://example.invalid","https://user:pass@example.invalid","https://example.invalid/path","https://example.invalid?token=canary","https://example.invalid#canary","file:///tmp/identity"})
    void unsafeServiceLocationsAreRejectedBeforeAnyIO(String url) {
        assertThatThrownBy(()->candidate(url)).isInstanceOf(IllegalArgumentException.class).hasMessage("Identity preparation connection invalid");
        verifyNoInteractions(sessions);
    }

    @ParameterizedTest @ValueSource(strings={"source","target","tenantId","erpUserId","customerServiceUserId","subjectRef","bindingVersion","expiresAt","grant","trailing","large","redirect","error","cache"})
    void forgedMalformedOrOverbroadUpstreamCannotCreateERPSession(String fault) throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        AtomicInteger calls=new AtomicInteger();
        server.createContext("/",exchange->{
            calls.incrementAndGet();exchange.getRequestBody().close();
            Map<String,Object> payload=new HashMap<>(Map.of("source","CUSTOMER_SERVICE","target","ERP","tenantId",TENANT.toString(),"erpUserId",USER.toString(),
                    "customerServiceUserId","cs-existing-agent","subjectRef","reviewed-subject-1","bindingVersion",7,"expiresAt",Instant.now().plusSeconds(29).toString(),"grant","G".repeat(43)));
            switch(fault) {
                case "source","target","tenantId","erpUserId","customerServiceUserId","subjectRef"->payload.put(fault,"wrong-claim");
                case "bindingVersion"->payload.put(fault,8);
                case "expiresAt"->payload.put(fault,Instant.now().plusSeconds(3600).toString());
                case "grant"->payload.put(fault,"invalid-grant");
                default->{}
            }
            String body=new ObjectMapper().writeValueAsString(payload);
            if(fault.equals("trailing"))body+="{}";
            if(fault.equals("large"))body="x".repeat(9000);
            if(fault.equals("error"))body="private-upstream-canary";
            byte[] bytes=body.getBytes(StandardCharsets.UTF_8);
            if(!fault.equals("cache"))exchange.getResponseHeaders().set("Cache-Control","no-store");
            exchange.getResponseHeaders().set("Content-Type","application/json");
            if(fault.equals("redirect"))exchange.getResponseHeaders().set("Location","http://127.0.0.1:"+server.getAddress().getPort()+"/redirected");
            exchange.sendResponseHeaders(fault.equals("redirect")?302:fault.equals("error")?503:200,bytes.length);
            try(var output=exchange.getResponseBody()){output.write(bytes);}
        });server.start();
        try {
            var candidate=candidate("http://127.0.0.1:"+server.getAddress().getPort());
            char[] password="Synthetic-password-123".toCharArray();
            assertThatThrownBy(()->candidate.login(TENANT,"agent@example.invalid",password)).isInstanceOf(Rejected.class)
                    .hasMessageNotContaining("private-upstream-canary").hasMessageNotContaining("Synthetic-password");
            for(char c:password)assertThat(c).isEqualTo('\0');
            assertThat(calls.get()).isEqualTo(1);
            verifyNoInteractions(sessions);
            verify(users,never()).findByTenant_IdAndEmail(any(),any());
        } finally { server.stop(0); }
    }

    @Test void nullPasswordAndWrongEnterpriseDoNotCallAccountLookup() {
        var candidate=candidate("http://127.0.0.1:1");clearInvocations(users);
        assertThatThrownBy(()->candidate.login(TENANT,"agent@example.invalid",null)).isInstanceOf(Rejected.class);
        char[] password="synthetic".toCharArray();
        assertThatThrownBy(()->candidate.login(UUID.randomUUID(),"agent@example.invalid",password)).isInstanceOf(Rejected.class);
        verifyNoInteractions(users,sessions);
        for(char c:password)assertThat(c).isEqualTo('\0');
    }

    @Test void slowResponseBodyHasABoundedDeadline() throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        var executor=java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor();server.setExecutor(executor);
        server.createContext("/",exchange->{
            exchange.getRequestBody().close();exchange.getResponseHeaders().set("Cache-Control","no-store");exchange.sendResponseHeaders(200,100);
            try {Thread.sleep(6500);}catch(InterruptedException interrupted){Thread.currentThread().interrupt();}
            exchange.close();
        });server.start();
        try {
            var candidate=candidate("http://127.0.0.1:"+server.getAddress().getPort());long start=System.nanoTime();
            assertThatThrownBy(()->candidate.login(TENANT,"agent@example.invalid","synthetic-password".toCharArray())).isInstanceOf(Rejected.class);
            assertThat(Duration.ofNanos(System.nanoTime()-start)).isLessThan(Duration.ofSeconds(6));
            verifyNoInteractions(sessions);
        }finally{server.stop(0);executor.shutdownNow();executor.close();}
    }

    private CustomerServiceIdentityPreparation candidate(String base) {
        var user=mock(UserAccountEntity.class);var tenant=mock(TenantEntity.class);var access=mock(UserApplicationAccessService.class);
        when(tenant.getStatus()).thenReturn(TenantStatus.ACTIVE);when(user.getTenant()).thenReturn(tenant);when(user.getStatus()).thenReturn(AccountStatus.ACTIVE);
        when(users.findByIdAndTenant_Id(USER,TENANT)).thenReturn(Optional.of(user));when(access.applicationAccessible(TENANT,USER,"ERP")).thenReturn(true);
        var transactions=mock(PlatformTransactionManager.class);when(transactions.getTransaction(any())).thenAnswer(invocation->new SimpleTransactionStatus());
        var candidate=new CustomerServiceIdentityPreparation(BINDING,URI.create(base),"synthetic-identity-service-token-not-real",users,sessions,mock(PermissionRepository.class),access,
                mock(TenantEntitlementService.class),new SessionTokenService(new SecureRandom(),Clock.systemUTC(),Duration.ofMinutes(5)),transactions,Clock.systemUTC());
        ownedCandidates.add(candidate);return candidate;
    }
}
