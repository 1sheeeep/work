package cn.xzkj.erp.product.storage;

import java.io.InputStream;
import java.time.Duration;
import java.util.Set;

import cn.xzkj.erp.product.domain.ProductSpuImage.StoredImage;

public interface ProductImageStorage {
    StoredImage store(
            InputStream input,
            String originalFilename,
            String declaredContentType);

    StoredContent read(
            String objectKey,
            long expectedSize,
            String expectedSha256);

    void delete(String objectKey);

    void deleteUnreferenced(Set<String> referencedObjectKeys, Duration minimumAge);

    record StoredContent(byte[] bytes) {
        public StoredContent {
            bytes = bytes.clone();
        }

        @Override
        public byte[] bytes() {
            return bytes.clone();
        }
    }
}
