package cn.xzkj.erp.customer.service;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class CustomerServiceEntryControllerTest {

    private static final String ORIGIN = "https://customer.example.test";
    private static final UUID TENANT_ID =
            UUID.fromString("10000000-0000-4000-8000-000000000001");
    private static final UUID USER_ID =
            UUID.fromString("20000000-0000-4000-8000-000000000001");

    @Test
    void successfulGrantResponseIsNeverCacheable() throws Exception {
        mockMvc(false)
                .perform(post("/api/v1/customer-service/entry-grants")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"targetOrigin\":\"" + ORIGIN + "\"}"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON));
    }

    @Test
    void rejectedGrantResponseIsNeverCacheableAndDoesNotEchoRequest() throws Exception {
        mockMvc(true)
                .perform(post("/api/v1/customer-service/entry-grants")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"targetOrigin\":\"" + ORIGIN + "\"}"))
                .andExpect(status().isConflict())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andExpect(content().string(org.hamcrest.Matchers.not(
                        org.hamcrest.Matchers.containsString(ORIGIN))));
    }

    private static MockMvc mockMvc(boolean reject) {
        return MockMvcBuilders
                .standaloneSetup(new CustomerServiceEntryController(new StubGrantService(reject)))
                .setControllerAdvice(new CustomerServiceEntryExceptionHandler())
                .build();
    }

    @Test
    void nativeInvalidGrantIsForbiddenWithoutEchoingSecrets() throws Exception {
        var nativeEntry=org.mockito.Mockito.mock(NativeCustomerServiceEntry.class);
        org.mockito.Mockito.when(nativeEntry.redeem(org.mockito.ArgumentMatchers.anyString(),org.mockito.ArgumentMatchers.any(),org.mockito.ArgumentMatchers.any(),org.mockito.ArgumentMatchers.anyString()))
            .thenThrow(CustomerServiceEntryException.invalidGrant());
        MockMvcBuilders.standaloneSetup(new NativeCustomerServiceEntryController(nativeEntry))
            .setControllerAdvice(new CustomerServiceEntryExceptionHandler()).build()
            .perform(post("/api/v1/internal/customer-service/native-entry/redeem").contentType(MediaType.APPLICATION_JSON)
                .content("{\"grant\":\""+"a".repeat(43)+"\",\"tenantId\":\""+TENANT_ID+"\",\"userId\":\""+USER_ID+"\",\"targetOrigin\":\"https://kf.xzkj.ai\"}"))
            .andExpect(status().isForbidden()).andExpect(header().string(HttpHeaders.CACHE_CONTROL,"no-store"))
            .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("a".repeat(43)))));
    }

    private static final class StubGrantService extends CustomerServiceEntryGrantService {

        private final boolean reject;

        StubGrantService(boolean reject) {
            super(
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    tenantId -> java.util.List.of(),
                    new SecureRandom(),
                    Clock.systemUTC(),
                    ORIGIN,
                    "production",
                    Duration.ofMinutes(1),
                    Duration.ofMinutes(15),
                    null,
                    null);
            this.reject = reject;
        }

        @Override
        public IssuedEntryGrant issue(
                ErpPrincipal principal,
                String requestedTargetOrigin,
                String requestId,
                String sourceIp) {
            if (reject) {
                throw CustomerServiceEntryException.invalidTarget();
            }
            return new IssuedEntryGrant(
                    "a".repeat(43),
                    ORIGIN + "/api/v1/auth/erp/entry",
                    TENANT_ID,
                    USER_ID,
                    Instant.now().plusSeconds(60));
        }
    }
}
