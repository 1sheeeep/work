package cn.xzkj.erp.product.service;

import static cn.xzkj.erp.product.domain.ProductAuditActions.IMAGE_DELETED;
import static cn.xzkj.erp.product.domain.ProductAuditActions.IMAGE_REPLACED;
import static cn.xzkj.erp.product.domain.ProductAuditActions.IMAGE_UPDATED;
import static cn.xzkj.erp.product.domain.ProductAuditActions.IMAGE_UPLOADED;

import java.io.InputStream;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.product.domain.ProductSpu;
import cn.xzkj.erp.product.domain.ProductSpuImage;
import cn.xzkj.erp.product.domain.ProductSpuImage.StoredImage;
import cn.xzkj.erp.product.domain.ProductStatus;
import cn.xzkj.erp.product.repository.ProductSpuImageRepository;
import cn.xzkj.erp.product.repository.ProductSpuRepository;
import cn.xzkj.erp.product.storage.ProductImageStorage;
import cn.xzkj.erp.product.storage.ProductImageStorage.StoredContent;

@Service
public class ProductImageService {
    private static final int MAX_IMAGES_PER_SPU = 10;
    private static final Duration ORPHAN_GRACE = Duration.ofHours(1);

    private final ProductSpuRepository spuRepository;
    private final ProductSpuImageRepository imageRepository;
    private final ProductImageStorage storage;
    private final SecurityAuditRecorder auditRecorder;

    public ProductImageService(
            ProductSpuRepository spuRepository,
            ProductSpuImageRepository imageRepository,
            ProductImageStorage storage,
            SecurityAuditRecorder auditRecorder) {
        this.spuRepository = spuRepository;
        this.imageRepository = imageRepository;
        this.storage = storage;
        this.auditRecorder = auditRecorder;
    }

    @Transactional(readOnly = true)
    public List<ProductSpuImage> list(UUID tenantId, UUID spuId) {
        requireSpu(tenantId, spuId);
        return imageRepository.findAllByTenantIdAndSpuId(
                tenantId,
                spuId);
    }

    @Transactional(readOnly = true)
    public ImageContent content(
            UUID tenantId,
            UUID spuId,
            UUID imageId) {
        requireSpu(tenantId, spuId);
        ProductSpuImage image = imageRepository
                .findByIdAndTenantIdAndSpuId(
                        imageId,
                        tenantId,
                        spuId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Product image was not found"));
        StoredContent content = storage.read(
                image.getObjectKey(),
                image.getByteSize(),
                image.getSha256());
        return new ImageContent(
                content.bytes(),
                image.getContentType(),
                image.getSha256());
    }

    @Transactional
    public ProductSpuImage upload(
            ProductActor actor,
            UUID spuId,
            InputStream input,
            String originalFilename,
            String declaredContentType,
            int sortOrder,
            boolean primary) {
        UUID tenantId = requireActor(actor);
        requireSortOrder(sortOrder);
        cleanupOldOrphans();
        requireMutableSpu(tenantId, spuId);
        List<ProductSpuImage> existing = imageRepository
                .findAllForUpdateByTenantIdAndSpuId(
                        tenantId,
                        spuId);
        if (existing.size() >= MAX_IMAGES_PER_SPU) {
            throw new ConflictException(
                    "A product can have at most 10 images");
        }
        StoredImage stored = storage.store(
                input,
                originalFilename,
                declaredContentType);
        deleteOnRollback(stored.objectKey());
        if (primary) {
            clearPrimary(existing);
        }
        ProductSpuImage saved = imageRepository.save(
                new ProductSpuImage(
                        tenantId,
                        spuId,
                        stored,
                        sortOrder,
                        primary,
                        actorType(actor),
                        actorId(actor)));
        imageRepository.flush();
        audit(actor, IMAGE_UPLOADED, saved, Map.of(
                "primary", Boolean.toString(saved.isPrimaryImage()),
                "sortOrder", Integer.toString(saved.getSortOrder()),
                "contentType", saved.getContentType(),
                "byteSize", Long.toString(saved.getByteSize())));
        return saved;
    }

    @Transactional
    public ProductSpuImage updatePresentation(
            ProductActor actor,
            UUID spuId,
            UUID imageId,
            long expectedVersion,
            int sortOrder,
            boolean primary) {
        UUID tenantId = requireActor(actor);
        requireSortOrder(sortOrder);
        requireMutableSpu(tenantId, spuId);
        List<ProductSpuImage> images = imageRepository
                .findAllForUpdateByTenantIdAndSpuId(
                        tenantId,
                        spuId);
        ProductSpuImage image = images.stream()
                .filter(candidate -> candidate.getId().equals(imageId))
                .findFirst()
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Product image was not found"));
        requireVersion(image.getVersion(), expectedVersion);
        if (primary) {
            clearPrimary(images);
        }
        image.updatePresentation(sortOrder, primary);
        ProductSpuImage saved = imageRepository.save(image);
        imageRepository.flush();
        audit(actor, IMAGE_UPDATED, saved, Map.of(
                "primary", Boolean.toString(saved.isPrimaryImage()),
                "sortOrder", Integer.toString(saved.getSortOrder())));
        return saved;
    }

    @Transactional
    public ProductSpuImage replace(
            ProductActor actor,
            UUID spuId,
            UUID imageId,
            long expectedVersion,
            InputStream input,
            String originalFilename,
            String declaredContentType) {
        UUID tenantId = requireActor(actor);
        cleanupOldOrphans();
        requireMutableSpu(tenantId, spuId);
        ProductSpuImage image = imageRepository.findForUpdate(
                        imageId,
                        tenantId,
                        spuId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Product image was not found"));
        requireVersion(image.getVersion(), expectedVersion);
        StoredImage stored = storage.store(
                input,
                originalFilename,
                declaredContentType);
        deleteOnRollback(stored.objectKey());
        String oldObjectKey = image.getObjectKey();
        image.replace(stored);
        ProductSpuImage saved = imageRepository.save(image);
        imageRepository.flush();
        deleteAfterCommit(oldObjectKey);
        audit(actor, IMAGE_REPLACED, saved, Map.of(
                "contentType", saved.getContentType(),
                "byteSize", Long.toString(saved.getByteSize())));
        return saved;
    }

    @Transactional
    public void delete(
            ProductActor actor,
            UUID spuId,
            UUID imageId,
            long expectedVersion) {
        UUID tenantId = requireActor(actor);
        requireMutableSpu(tenantId, spuId);
        ProductSpuImage image = imageRepository.findForUpdate(
                        imageId,
                        tenantId,
                        spuId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Product image was not found"));
        requireVersion(image.getVersion(), expectedVersion);
        String objectKey = image.getObjectKey();
        boolean primary = image.isPrimaryImage();
        imageRepository.delete(image);
        imageRepository.flush();
        deleteAfterCommit(objectKey);
        audit(actor, IMAGE_DELETED, image, Map.of(
                "primary", Boolean.toString(primary)));
    }

    private void cleanupOldOrphans() {
        Set<String> referenced = Set.copyOf(
                imageRepository.findAllObjectKeys());
        storage.deleteUnreferenced(referenced, ORPHAN_GRACE);
    }

    private static void clearPrimary(List<ProductSpuImage> images) {
        images.stream()
                .filter(ProductSpuImage::isPrimaryImage)
                .forEach(image -> image.updatePresentation(
                        image.getSortOrder(),
                        false));
    }

    private ProductSpu requireSpu(UUID tenantId, UUID spuId) {
        requireTenant(tenantId);
        return spuRepository.findByIdAndTenantId(spuId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Product SPU was not found"));
    }

    private ProductSpu requireMutableSpu(UUID tenantId, UUID spuId) {
        requireTenant(tenantId);
        ProductSpu spu = spuRepository
                .findForUpdateByIdAndTenantId(spuId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Product SPU was not found"));
        if (spu.getStatus() == ProductStatus.ARCHIVED) {
            throw new ConflictException(
                    "Archived SPUs cannot have images changed");
        }
        return spu;
    }

    private void audit(
            ProductActor actor,
            String action,
            ProductSpuImage image,
            Map<String, String> facts) {
        Map<String, String> details = new LinkedHashMap<>();
        details.put("version", Long.toString(image.getVersion()));
        details.put("spuId", image.getSpuId().toString());
        details.putAll(facts);
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(),
                actor.userId(),
                actor.systemAdminId(),
                action,
                "product_image",
                image.getId().toString(),
                actor.requestId(),
                actor.sourceIp(),
                details));
    }

    private void deleteOnRollback(String objectKey) {
        requireTransactionSynchronization();
        TransactionSynchronizationManager.registerSynchronization(
                new TransactionSynchronization() {
                    @Override
                    public void afterCompletion(int status) {
                        if (status != STATUS_COMMITTED) {
                            deleteQuietly(objectKey);
                        }
                    }
                });
    }

    private void deleteAfterCommit(String objectKey) {
        requireTransactionSynchronization();
        TransactionSynchronizationManager.registerSynchronization(
                new TransactionSynchronization() {
                    @Override
                    public void afterCommit() {
                        deleteQuietly(objectKey);
                    }
                });
    }

    private void deleteQuietly(String objectKey) {
        try {
            storage.delete(objectKey);
        } catch (RuntimeException ignored) {
            // The bounded orphan cleanup retries files older than one hour.
        }
    }

    private static void requireTransactionSynchronization() {
        if (!TransactionSynchronizationManager
                .isSynchronizationActive()) {
            throw new IllegalStateException(
                    "Image mutation requires transaction synchronization");
        }
    }

    private static UUID requireActor(ProductActor actor) {
        if (actor == null) {
            throw new IllegalArgumentException("Actor is required");
        }
        requireTenant(actor.tenantId());
        if ((actor.userId() == null) == (actor.systemAdminId() == null)) {
            throw new IllegalArgumentException(
                    "Exactly one actor identity is required");
        }
        return actor.tenantId();
    }

    private static UUID actorId(ProductActor actor) {
        return actor.userId() != null
                ? actor.userId()
                : actor.systemAdminId();
    }

    private static String actorType(ProductActor actor) {
        return actor.userId() != null ? "TENANT_USER" : "SYSTEM_ADMIN";
    }

    private static void requireTenant(UUID tenantId) {
        if (tenantId == null) {
            throw new IllegalArgumentException("Tenant ID is required");
        }
    }

    private static void requireVersion(long actual, long expected) {
        if (expected < 0 || actual != expected) {
            throw new ConflictException("The resource has changed");
        }
    }

    private static void requireSortOrder(int sortOrder) {
        if (sortOrder < 0 || sortOrder > 32767) {
            throw new IllegalArgumentException("sortOrder is out of range");
        }
    }

    public record ImageContent(
            byte[] bytes,
            String contentType,
            String sha256) {
        public ImageContent {
            bytes = bytes.clone();
        }

        @Override
        public byte[] bytes() {
            return bytes.clone();
        }
    }
}
