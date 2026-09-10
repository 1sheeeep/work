package cn.xzkj.erp.platformadmin.shopifyrelease;

import static cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditActions.SHOPIFY_APP_RELEASE_FAILED;
import static cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditActions.SHOPIFY_APP_RELEASE_SUCCEEDED;
import static cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditActions.SHOPIFY_APP_RELEASE_TOKEN_CLEARED;
import static cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditActions.SHOPIFY_APP_RELEASE_TOKEN_UPDATED;

import cn.xzkj.erp.iam.application.IamConflictException;
import cn.xzkj.erp.iam.application.IamOptimisticLockException;
import cn.xzkj.erp.platformadmin.application.PlatformAdminActor;
import cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditEvent;
import cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditRecorder;
import cn.xzkj.erp.platformadmin.shopifyrelease.ShopifyAppReleaseRepository.StoredRelease;
import jakarta.annotation.PostConstruct;
import java.time.Instant;
import java.util.Arrays;
import java.util.Map;
import org.springframework.stereotype.Service;

@Service
public class ShopifyAppReleaseService {
    public static final String APP_NAME = "Xinzhi ERP";
    public static final String EXTENSION_NAME = "Xinzhi Chat";
    public static final String CLIENT_ID =
            "6cef3dfc6b0d74e7c2709232f2938696";

    private final ShopifyAppReleaseRepository repository;
    private final ShopifyAppReleaseCredentialCipher cipher;
    private final ShopifyAppReleaseExecutor executor;
    private final PlatformAdminAuditRecorder auditRecorder;

    public ShopifyAppReleaseService(
            ShopifyAppReleaseRepository repository,
            ShopifyAppReleaseCredentialCipher cipher,
            ShopifyAppReleaseExecutor executor,
            PlatformAdminAuditRecorder auditRecorder) {
        this.repository = repository;
        this.cipher = cipher;
        this.executor = executor;
        this.auditRecorder = auditRecorder;
    }

    @PostConstruct
    void recoverInterruptedRelease() {
        repository.failInterruptedRelease();
    }

    public ReleaseView get() {
        return view(repository.find());
    }

    public ReleaseView configure(PlatformAdminActor actor, char[] token,
            long expectedVersion) {
        requireActor(actor);
        if (expectedVersion < 0 || token == null
                || token.length < 20 || token.length > 4096) {
            throw new IllegalArgumentException(
                    "A complete Shopify Automation Token is required");
        }
        try {
            if (!repository.saveToken(cipher.encrypt(token), expectedVersion,
                    actor.adminId())) {
                throw new IamOptimisticLockException();
            }
        } finally {
            Arrays.fill(token, '\0');
        }
        audit(actor, SHOPIFY_APP_RELEASE_TOKEN_UPDATED,
                Map.of("appName", APP_NAME));
        return get();
    }

    public ReleaseView clear(PlatformAdminActor actor, long expectedVersion) {
        requireActor(actor);
        if (expectedVersion < 0 || !repository.delete(expectedVersion)) {
            throw new IamOptimisticLockException();
        }
        audit(actor, SHOPIFY_APP_RELEASE_TOKEN_CLEARED,
                Map.of("appName", APP_NAME));
        return get();
    }

    public ReleaseView release(PlatformAdminActor actor, long expectedVersion) {
        requireActor(actor);
        StoredRelease current = repository.find();
        if (current == null) {
            throw new IamConflictException();
        }
        if (expectedVersion < 0 || current.version() != expectedVersion
                || !repository.markRunning(expectedVersion, actor.adminId())) {
            throw new IamOptimisticLockException();
        }
        long runningVersion = expectedVersion + 1;
        char[] token = null;
        ShopifyAppReleaseExecutor.ReleaseResult result;
        try {
            token = cipher.decrypt(current.token());
            result = executor.release(token);
        } catch (ShopifyAppReleaseFailedException exception) {
            String message = bounded(exception.getMessage());
            repository.finish(runningVersion, "FAILED",
                    current.releaseVersion(), message, false,
                    actor.adminId());
            audit(actor, SHOPIFY_APP_RELEASE_FAILED,
                    Map.of("appName", APP_NAME));
            throw new ShopifyAppReleaseFailedException(message);
        } catch (IllegalStateException exception) {
            String message = "无法读取保存的 Automation Token，请重新保存令牌后重试。";
            repository.finish(runningVersion, "FAILED",
                    current.releaseVersion(), message, false,
                    actor.adminId());
            audit(actor, SHOPIFY_APP_RELEASE_FAILED,
                    Map.of("appName", APP_NAME));
            throw new ShopifyAppReleaseFailedException(message);
        } finally {
            if (token != null) Arrays.fill(token, '\0');
        }
        if (!repository.finish(runningVersion, "SUCCEEDED",
                result.version(), bounded(result.message()), true,
                actor.adminId())) {
            throw new IamOptimisticLockException();
        }
        audit(actor, SHOPIFY_APP_RELEASE_SUCCEEDED, Map.of(
                "appName", APP_NAME,
                "releaseVersion", result.version()));
        return get();
    }

    private static ReleaseView view(StoredRelease stored) {
        return new ReleaseView(
                APP_NAME,
                EXTENSION_NAME,
                CLIENT_ID,
                stored != null,
                stored == null ? "NOT_CONFIGURED" : stored.status(),
                stored == null ? null : stored.releaseVersion(),
                stored == null ? null : stored.releaseMessage(),
                stored == null ? null : stored.releasedAt(),
                stored == null ? null : stored.updatedAt(),
                stored == null ? 0 : stored.version());
    }

    private static void requireActor(PlatformAdminActor actor) {
        if (actor == null || actor.adminId() == null) {
            throw new IllegalArgumentException("System administrator is required");
        }
    }

    private void audit(PlatformAdminActor actor, String action,
            Map<String, String> details) {
        auditRecorder.record(new PlatformAdminAuditEvent(
                actor.adminId(), null, action,
                "shopify_app_release", CLIENT_ID,
                actor.requestId(), actor.sourceIp(), details));
    }

    private static String bounded(String value) {
        value = value == null ? "" : value.strip();
        return value.length() <= 4000 ? value
                : value.substring(value.length() - 4000);
    }

    public record ReleaseView(
            String appName,
            String extensionName,
            String clientId,
            boolean tokenConfigured,
            String status,
            String releaseVersion,
            String message,
            Instant releasedAt,
            Instant updatedAt,
            long version) {
    }
}
