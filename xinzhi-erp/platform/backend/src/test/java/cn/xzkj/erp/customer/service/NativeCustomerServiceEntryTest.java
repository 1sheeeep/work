package cn.xzkj.erp.customer.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import cn.xzkj.erp.iam.application.SessionTokenService;
import cn.xzkj.erp.iam.persistence.*;
import cn.xzkj.erp.iam.preparation.NativeCustomerServiceIdentity;
import cn.xzkj.erp.tenantaccess.UserApplicationAccessService;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class NativeCustomerServiceEntryTest {
    final UUID tenant=UUID.randomUUID(),user=UUID.randomUUID(),sessionId=UUID.randomUUID();
    final Instant now=Instant.parse("2026-09-09T00:00:00Z");
    final String raw="a".repeat(43);
    final CustomerServiceEntryGrantRepository repository=mock(CustomerServiceEntryGrantRepository.class);
    final NativeCustomerServiceIdentity identity=mock(NativeCustomerServiceIdentity.class);
    final UserApplicationAccessService access=mock(UserApplicationAccessService.class);
    final PermissionRepository permissions=mock(PermissionRepository.class);
    final SessionTokenService tokens=mock(SessionTokenService.class);
    CustomerServiceEntryGrantEntity grant;
    NativeCustomerServiceEntry service;
    @BeforeEach void setup(){
        var session=mock(AuthSessionEntity.class);when(session.getId()).thenReturn(sessionId);
        grant=new CustomerServiceEntryGrantEntity(UUID.randomUUID(),tenant,user,session,"hash",NativeCustomerServiceEntry.ORIGIN,now.plusSeconds(60),now);
        when(tokens.hash(raw)).thenReturn("hash");when(repository.findForConsumptionByTokenHash("hash")).thenReturn(Optional.of(grant));
        when(access.applicationAccessible(tenant,user,"CHAT")).thenReturn(true);
        when(permissions.findCodesByTenantIdAndUserId(tenant,user)).thenReturn(List.of("customer_service.read"));
        when(identity.entrySubject(tenant,user,sessionId)).thenReturn("original-native-id");
        service=new NativeCustomerServiceEntry(mock(CustomerServiceEntryGrantService.class),repository,identity,tokens,access,permissions,Clock.fixed(now,ZoneOffset.UTC));
    }
    @Test void exactNativeIdOnceOnly(){
        assertThat(service.redeem(raw,tenant,user,NativeCustomerServiceEntry.ORIGIN).customerServiceUserId()).isEqualTo("original-native-id");
        assertThatThrownBy(()->service.redeem(raw,tenant,user,NativeCustomerServiceEntry.ORIGIN)).isInstanceOf(CustomerServiceEntryException.class);
        verify(identity,times(1)).entrySubject(tenant,user,sessionId);
    }
    @Test void wrongTargetAndSubjectDenied(){
        assertThatThrownBy(()->service.redeem(raw,tenant,user,"https://evil.example")).isInstanceOf(CustomerServiceEntryException.class);
        assertThatThrownBy(()->service.redeem(raw,tenant,UUID.randomUUID(),NativeCustomerServiceEntry.ORIGIN)).isInstanceOf(CustomerServiceEntryException.class);
        verifyNoInteractions(identity);
    }
    @Test void revokedAccessDenied(){
        when(access.applicationAccessible(tenant,user,"CHAT")).thenReturn(false);
        assertThatThrownBy(()->service.redeem(raw,tenant,user,NativeCustomerServiceEntry.ORIGIN)).isInstanceOf(CustomerServiceEntryException.class);
        assertThat(grant.getConsumedAt()).isNull();verifyNoInteractions(identity);
    }
    @Test void sourceRevocationDenied(){
        when(identity.entrySubject(tenant,user,sessionId)).thenThrow(new org.springframework.security.access.AccessDeniedException("revoked"));
        assertThatThrownBy(()->service.redeem(raw,tenant,user,NativeCustomerServiceEntry.ORIGIN)).isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
        assertThat(grant.getConsumedAt()).isNull();
    }
    @Test void expiredDenied(){
        service=new NativeCustomerServiceEntry(mock(CustomerServiceEntryGrantService.class),repository,identity,tokens,access,permissions,Clock.fixed(now.plusSeconds(60),ZoneOffset.UTC));
        assertThatThrownBy(()->service.redeem(raw,tenant,user,NativeCustomerServiceEntry.ORIGIN)).isInstanceOf(CustomerServiceEntryException.class);
        verifyNoInteractions(identity);
    }
}
