package cn.xzkj.erp.product.storage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class FileSystemProductImageStorageTest {

    private static final byte[] PNG = Base64.getDecoder().decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ"
            + "AAAADUlEQVQIHWP4z8DwHwAFgAI/ScLq4QAAAABJRU5ErkJggg==");

    @TempDir
    Path root;

    @Test
    void storesAndReadsOnlyAValidatedDirectUpload() throws Exception {
        FileSystemProductImageStorage storage = storage();

        var stored = storage.store(
                new ByteArrayInputStream(PNG),
                "sample.png",
                "image/png");

        assertThat(stored.objectKey()).matches("^[0-9a-f]{32}\\.png$");
        assertThat(stored.contentType()).isEqualTo("image/png");
        assertThat(stored.byteSize()).isEqualTo(PNG.length);
        assertThat(stored.pixelWidth()).isEqualTo(1);
        assertThat(stored.pixelHeight()).isEqualTo(1);
        assertThat(storage.read(
                stored.objectKey(), stored.byteSize(), stored.sha256()).bytes())
                .isEqualTo(PNG);
        assertThat(Files.list(root).toList()).hasSize(1);
    }

    @Test
    void rejectsFilenameMimeAndSignatureConfusionBeforeWriting() throws Exception {
        FileSystemProductImageStorage storage = storage();

        assertThatThrownBy(() -> storage.store(
                new ByteArrayInputStream(PNG),
                "../sample.png",
                "image/png"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> storage.store(
                new ByteArrayInputStream(PNG),
                "sample.jpg",
                "image/jpeg"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> storage.store(
                new ByteArrayInputStream(new byte[] {1, 2, 3}),
                "sample.png",
                "image/png"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(Files.list(root).toList()).isEmpty();
    }

    @Test
    void refusesUnsafeObjectKeysAndOnlyCleansOldUnreferencedObjects()
            throws Exception {
        FileSystemProductImageStorage storage = storage();
        var first = storage.store(
                new ByteArrayInputStream(PNG), "first.png", "image/png");
        var second = storage.store(
                new ByteArrayInputStream(PNG), "second.png", "image/png");
        Files.setLastModifiedTime(
                root.resolve(second.objectKey()),
                FileTime.from(Instant.now().minus(Duration.ofMinutes(2))));

        assertThatThrownBy(() -> storage.read(
                "../outside.png",
                1,
                "0".repeat(64)))
                .isInstanceOf(IllegalArgumentException.class);
        storage.deleteUnreferenced(
                Set.of(first.objectKey()), Duration.ofMinutes(1));

        assertThat(Files.exists(root.resolve(first.objectKey()))).isTrue();
        assertThat(Files.exists(root.resolve(second.objectKey()))).isFalse();
    }

    @Test
    void refusesSameLengthContentWhoseChecksumDoesNotMatchMetadata()
            throws Exception {
        FileSystemProductImageStorage storage = storage();
        var stored = storage.store(
                new ByteArrayInputStream(PNG), "sample.png", "image/png");
        byte[] tampered = PNG.clone();
        tampered[tampered.length - 1] ^= 1;
        Files.write(root.resolve(stored.objectKey()), tampered);

        assertThatThrownBy(() -> storage.read(
                stored.objectKey(), stored.byteSize(), stored.sha256()))
                .isInstanceOf(
                        ProductImageStorageUnavailableException.class)
                .hasMessage("Product image storage is unavailable");
    }

    private FileSystemProductImageStorage storage() {
        return new FileSystemProductImageStorage(root.toString());
    }
}
