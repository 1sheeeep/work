package cn.xzkj.erp.platform.api;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;

import cn.xzkj.erp.platform.domain.AuthorizationStatus;
import cn.xzkj.erp.platform.domain.CredentialReferenceValidator;
import cn.xzkj.erp.platform.domain.ShopAuthorization;
import cn.xzkj.erp.platform.domain.ShopStatus;
import cn.xzkj.erp.platform.domain.TenantShop;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public final class ShopDtos {

    private ShopDtos() {
    }

    public record CreateShopRequest(
            @NotNull
            UUID platformId,
            @Size(max = 160)
            String externalShopRef,
            @Size(max = 160)
            String displayName
    ) {
    }

    public record UpdateShopRequest(
            @NotNull
            @Min(0)
            Long version,
            @NotBlank
            @Size(max = 160)
            String externalShopRef,
            @NotBlank
            @Size(max = 160)
            String displayName,
            @NotNull
            ShopStatus status
    ) {
    }

    public record UpdateAuthorizationRequest(
            @NotNull
            AuthorizationStatus status,
            @Pattern(regexp = CredentialReferenceValidator.REFERENCE_PATTERN)
            String credentialReference,
            @Size(max = 160)
            String providerAccountRef,
            @Size(max = 40)
            Set<@Pattern(regexp = "[A-Za-z0-9._:-]{1,80}") String> scopes,
            Instant authorizedAt,
            Instant expiresAt,
            Instant lastVerifiedAt,
            @Size(max = 1000)
            String errorSummary
    ) {
    }

    public record AuthorizationResponse(
            AuthorizationStatus status,
            boolean credentialConfigured,
            String credentialReferenceType,
            String providerAccountRef,
            Set<String> scopes,
            Instant authorizedAt,
            Instant expiresAt,
            Instant lastVerifiedAt,
            Instant revokedAt,
            String errorSummary,
            long version
    ) {
        public static AuthorizationResponse from(ShopAuthorization entity, Set<String> scopes) {
            return new AuthorizationResponse(
                    entity.getStatus(),
                    entity.getCredentialReference() != null,
                    CredentialReferenceValidator.referenceType(entity.getCredentialReference()),
                    entity.getProviderAccountRef(),
                    scopes,
                    entity.getAuthorizedAt(),
                    entity.getExpiresAt(),
                    entity.getLastVerifiedAt(),
                    entity.getRevokedAt(),
                    entity.getErrorSummary(),
                    entity.getVersion()
            );
        }
    }

    public record ShopResponse(
            UUID id,
            UUID platformId,
            String externalShopRef,
            String displayName,
            String localizedDisplayName,
            ShopStatus status,
            AuthorizationResponse authorization,
            Instant createdAt,
            Instant updatedAt,
            long version
    ) {
        public static ShopResponse from(
                TenantShop entity,
                AuthorizationResponse authorization
        ) {
            return from(entity, authorization, null);
        }

        public static ShopResponse from(
                TenantShop entity,
                AuthorizationResponse authorization,
                String localizedDisplayName
        ) {
            return new ShopResponse(
                    entity.getId(),
                    entity.getPlatformId(),
                    entity.getExternalShopRef(),
                    entity.getDisplayName(),
                    localizedDisplayName,
                    entity.getStatus(),
                    authorization,
                    entity.getCreatedAt(),
                    entity.getUpdatedAt(),
                    entity.getVersion()
            );
        }
    }
}
