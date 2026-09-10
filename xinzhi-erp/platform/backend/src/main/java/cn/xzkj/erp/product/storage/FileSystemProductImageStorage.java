package cn.xzkj.erp.product.storage;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.OpenOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermission;
import java.nio.file.attribute.AclEntry;
import java.nio.file.attribute.AclEntryPermission;
import java.nio.file.attribute.AclEntryType;
import java.nio.file.attribute.AclFileAttributeView;
import java.nio.file.attribute.UserPrincipal;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.EnumSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;

import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import cn.xzkj.erp.product.domain.ProductSpuImage.StoredImage;

@Component
public class FileSystemProductImageStorage implements ProductImageStorage {
    static final int MAX_BYTES = 5 * 1024 * 1024;
    static final int MAX_DIMENSION = 10_000;
    static final long MAX_PIXELS = 40_000_000L;
    private static final Set<PosixFilePermission> OWNER_READ_WRITE = Set.of(
            PosixFilePermission.OWNER_READ,
            PosixFilePermission.OWNER_WRITE);
    private static final OpenOption[] CREATE_NEW = {
        StandardOpenOption.CREATE_NEW,
        StandardOpenOption.WRITE
    };

    private final String configuredRoot;

    public FileSystemProductImageStorage(
            @Value("${erp.product-images.root:}") String configuredRoot) {
        this.configuredRoot = configuredRoot == null
                ? ""
                : configuredRoot.strip();
    }

    @Override
    public StoredImage store(
            InputStream input,
            String originalFilename,
            String declaredContentType) {
        if (input == null) {
            throw new IllegalArgumentException("Image file is required");
        }
        String filename = requireSafeFilename(originalFilename);
        byte[] bytes = boundedBytes(input);
        ImageKind kind = detect(bytes, filename, declaredContentType);
        Dimensions dimensions = dimensions(bytes, kind);
        Path root = root();
        String objectKey = UUID.randomUUID().toString()
                .replace("-", "") + kind.extension();
        Path target = resolve(root, objectKey);
        try {
            Files.write(target, bytes, CREATE_NEW);
            applyOwnerOnlyPermissions(target);
        } catch (IOException failure) {
            try {
                Files.deleteIfExists(target);
            } catch (IOException ignored) {
                // The random key cannot be referenced without metadata.
            }
            throw new ProductImageStorageUnavailableException(
                    "Product image storage is unavailable",
                    failure);
        }
        return new StoredImage(
                objectKey,
                kind.contentType(),
                kind.extension(),
                bytes.length,
                sha256(bytes),
                dimensions.width(),
                dimensions.height());
    }

    @Override
    public StoredContent read(
            String objectKey,
            long expectedSize,
            String expectedSha256) {
        if (expectedSize < 1 || expectedSize > MAX_BYTES) {
            throw new IllegalArgumentException("Image size is invalid");
        }
        if (expectedSha256 == null
                || !expectedSha256.matches("^[0-9a-f]{64}$")) {
            throw new IllegalArgumentException("Image checksum is invalid");
        }
        Path target = resolve(root(), objectKey);
        try {
            if (!Files.isRegularFile(target, LinkOption.NOFOLLOW_LINKS)
                    || Files.isSymbolicLink(target)
                    || Files.size(target) != expectedSize) {
                throw new ProductImageStorageUnavailableException(
                        "Product image storage is unavailable");
            }
            byte[] bytes = Files.readAllBytes(target);
            if (bytes.length != expectedSize || !MessageDigest.isEqual(
                    HexFormat.of().parseHex(expectedSha256),
                    HexFormat.of().parseHex(sha256(bytes)))) {
                throw new ProductImageStorageUnavailableException(
                        "Product image storage is unavailable");
            }
            return new StoredContent(bytes);
        } catch (IOException failure) {
            throw new ProductImageStorageUnavailableException(
                    "Product image storage is unavailable",
                    failure);
        }
    }

    @Override
    public void delete(String objectKey) {
        Path target = resolve(root(), objectKey);
        try {
            if (Files.exists(target, LinkOption.NOFOLLOW_LINKS)
                    && (!Files.isRegularFile(
                            target,
                            LinkOption.NOFOLLOW_LINKS)
                    || Files.isSymbolicLink(target))) {
                throw new ProductImageStorageUnavailableException(
                        "Product image storage is unavailable");
            }
            Files.deleteIfExists(target);
        } catch (IOException failure) {
            throw new ProductImageStorageUnavailableException(
                    "Product image storage is unavailable",
                    failure);
        }
    }

    @Override
    public void deleteUnreferenced(
            Set<String> referencedObjectKeys,
            Duration minimumAge) {
        if (referencedObjectKeys == null || minimumAge == null
                || minimumAge.isNegative() || minimumAge.isZero()) {
            throw new IllegalArgumentException(
                    "Image cleanup boundary is invalid");
        }
        Path root = root();
        Instant cutoff = Instant.now().minus(minimumAge);
        try (Stream<Path> entries = Files.list(root)) {
            entries.filter(path -> Files.isRegularFile(
                            path,
                            LinkOption.NOFOLLOW_LINKS))
                    .filter(path -> !Files.isSymbolicLink(path))
                    .filter(path -> path.getFileName().toString()
                            .matches("^[0-9a-f]{32}\\.(jpg|png)$"))
                    .filter(path -> !referencedObjectKeys.contains(
                            path.getFileName().toString()))
                    .filter(path -> {
                        try {
                            return Files.getLastModifiedTime(
                                    path,
                                    LinkOption.NOFOLLOW_LINKS)
                                    .toInstant()
                                    .isBefore(cutoff);
                        } catch (IOException failure) {
                            return false;
                        }
                    })
                    .forEach(path -> {
                        try {
                            Files.deleteIfExists(path);
                        } catch (IOException ignored) {
                            // A later bounded cleanup pass retries.
                        }
                    });
        } catch (IOException failure) {
            throw new ProductImageStorageUnavailableException(
                    "Product image storage is unavailable",
                    failure);
        }
    }

    private Path root() {
        if (configuredRoot.isBlank()) {
            throw new ProductImageStorageUnavailableException(
                    "Product image storage is not configured");
        }
        Path root;
        try {
            root = Path.of(configuredRoot).toAbsolutePath().normalize();
            Files.createDirectories(root);
        } catch (RuntimeException | IOException failure) {
            throw new ProductImageStorageUnavailableException(
                    "Product image storage is unavailable",
                    failure);
        }
        if (!Files.isDirectory(root, LinkOption.NOFOLLOW_LINKS)
                || Files.isSymbolicLink(root)) {
            throw new ProductImageStorageUnavailableException(
                    "Product image storage root is unsafe");
        }
        return root;
    }

    private static Path resolve(Path root, String objectKey) {
        if (objectKey == null
                || !objectKey.matches("^[0-9a-f]{32}\\.(jpg|png)$")) {
            throw new IllegalArgumentException("Image object key is invalid");
        }
        Path target = root.resolve(objectKey).normalize();
        if (!target.getParent().equals(root)) {
            throw new IllegalArgumentException("Image object key is invalid");
        }
        return target;
    }

    private static String requireSafeFilename(String value) {
        if (value == null || value.isBlank()
                || value.length() > 255
                || value.indexOf('\0') >= 0
                || value.contains("/")
                || value.contains("\\")) {
            throw new IllegalArgumentException(
                    "Image filename is invalid");
        }
        return value.strip();
    }

    private static byte[] boundedBytes(InputStream input) {
        try {
            byte[] bytes = input.readNBytes(MAX_BYTES + 1);
            if (bytes.length < 1 || bytes.length > MAX_BYTES) {
                throw new IllegalArgumentException(
                        "Image file size is invalid");
            }
            return bytes;
        } catch (IOException failure) {
            throw new IllegalArgumentException(
                    "Image file could not be read");
        }
    }

    private static ImageKind detect(
            byte[] bytes,
            String filename,
            String declaredContentType) {
        String lowerName = filename.toLowerCase(Locale.ROOT);
        if (isPng(bytes)
                && lowerName.endsWith(".png")
                && "image/png".equalsIgnoreCase(declaredContentType)) {
            return ImageKind.PNG;
        }
        if (isJpeg(bytes)
                && (lowerName.endsWith(".jpg")
                    || lowerName.endsWith(".jpeg"))
                && "image/jpeg".equalsIgnoreCase(declaredContentType)) {
            return ImageKind.JPEG;
        }
        throw new IllegalArgumentException(
                "Only matching PNG or JPEG images are allowed");
    }

    private static Dimensions dimensions(byte[] bytes, ImageKind kind) {
        try (ImageInputStream imageInput = ImageIO.createImageInputStream(
                new ByteArrayInputStream(bytes))) {
            if (imageInput == null) {
                throw new IllegalArgumentException(
                        "Image content is invalid");
            }
            var readers = ImageIO.getImageReaders(imageInput);
            if (!readers.hasNext()) {
                throw new IllegalArgumentException(
                        "Image content is invalid");
            }
            ImageReader reader = readers.next();
            try {
                reader.setInput(imageInput, true, true);
                String format = reader.getFormatName()
                        .toLowerCase(Locale.ROOT);
                boolean expectedFormat =
                        kind == ImageKind.PNG && "png".equals(format)
                        || kind == ImageKind.JPEG
                        && ("jpeg".equals(format) || "jpg".equals(format));
                if (!expectedFormat) {
                    throw new IllegalArgumentException(
                            "Image content is invalid");
                }
                int width = reader.getWidth(0);
                int height = reader.getHeight(0);
                if (width < 1 || height < 1
                        || width > MAX_DIMENSION
                        || height > MAX_DIMENSION
                        || (long) width * height > MAX_PIXELS) {
                    throw new IllegalArgumentException(
                            "Image dimensions are invalid");
                }
                return new Dimensions(width, height);
            } finally {
                reader.dispose();
            }
        } catch (IOException failure) {
            throw new IllegalArgumentException(
                    "Image content is invalid");
        }
    }

    private static boolean isPng(byte[] bytes) {
        byte[] signature = {
            (byte) 0x89, 0x50, 0x4e, 0x47,
            0x0d, 0x0a, 0x1a, 0x0a
        };
        if (bytes.length < signature.length) {
            return false;
        }
        for (int index = 0; index < signature.length; index++) {
            if (bytes[index] != signature[index]) {
                return false;
            }
        }
        return true;
    }

    private static boolean isJpeg(byte[] bytes) {
        return bytes.length >= 4
                && bytes[0] == (byte) 0xff
                && bytes[1] == (byte) 0xd8
                && bytes[2] == (byte) 0xff;
    }

    private static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable");
        }
    }

    private static void applyOwnerOnlyPermissions(Path path)
            throws IOException {
        if (Files.getFileStore(path)
                .supportsFileAttributeView("posix")) {
            Files.setPosixFilePermissions(path, OWNER_READ_WRITE);
            return;
        }
        AclFileAttributeView aclView = Files.getFileAttributeView(
                path,
                AclFileAttributeView.class,
                LinkOption.NOFOLLOW_LINKS);
        if (aclView != null) {
            UserPrincipal owner = aclView.getOwner();
            AclEntry ownerOnly = AclEntry.newBuilder()
                    .setType(AclEntryType.ALLOW)
                    .setPrincipal(owner)
                    .setPermissions(EnumSet.of(
                            AclEntryPermission.READ_DATA,
                            AclEntryPermission.WRITE_DATA,
                            AclEntryPermission.APPEND_DATA,
                            AclEntryPermission.READ_NAMED_ATTRS,
                            AclEntryPermission.WRITE_NAMED_ATTRS,
                            AclEntryPermission.READ_ATTRIBUTES,
                            AclEntryPermission.WRITE_ATTRIBUTES,
                            AclEntryPermission.DELETE,
                            AclEntryPermission.READ_ACL,
                            AclEntryPermission.WRITE_ACL,
                            AclEntryPermission.SYNCHRONIZE))
                    .build();
            aclView.setAcl(List.of(ownerOnly));
        }
    }

    private enum ImageKind {
        JPEG("image/jpeg", ".jpg"),
        PNG("image/png", ".png");

        private final String contentType;
        private final String extension;

        ImageKind(String contentType, String extension) {
            this.contentType = contentType;
            this.extension = extension;
        }

        String contentType() { return contentType; }
        String extension() { return extension; }
    }

    private record Dimensions(int width, int height) {
    }
}
