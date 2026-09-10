package cn.xzkj.erp.iam.bootstrap;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileStore;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.OpenOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.FileAttribute;
import java.nio.file.attribute.AclEntry;
import java.nio.file.attribute.AclEntryPermission;
import java.nio.file.attribute.AclEntryType;
import java.nio.file.attribute.AclFileAttributeView;
import java.nio.file.attribute.PosixFilePermission;
import java.nio.file.attribute.PosixFilePermissions;
import java.nio.file.attribute.UserPrincipal;
import java.util.Arrays;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Component;

@Component
public class BootstrapTokenFileStore {

    private static final String JAVA_BASE_MODULE = "java.base";
    private static final String WINDOWS_FILE_SYSTEM_PROVIDER =
            "sun.nio.fs.WindowsFileSystemProvider";
    private static final Set<PosixFilePermission> OWNER_READ_WRITE = Set.of(
            PosixFilePermission.OWNER_READ,
            PosixFilePermission.OWNER_WRITE);
    private final ParentDirectoryDurability parentDirectoryDurability;

    public BootstrapTokenFileStore() {
        this(BootstrapTokenFileStore::forceParentDirectory);
    }

    BootstrapTokenFileStore(
            ParentDirectoryDurability parentDirectoryDurability) {
        this.parentDirectoryDurability = parentDirectoryDurability;
    }

    public void requireAvailable(Path outputPath) {
        Path parent = outputPath.getParent();
        if (!outputPath.isAbsolute()
                || parent == null
                || !Files.isDirectory(parent)
                || Files.exists(outputPath, LinkOption.NOFOLLOW_LINKS)) {
            throw new InitialAdminBootstrapException();
        }
    }

    public void createNew(Path outputPath, String rawToken) {
        byte[] tokenBytes = rawToken.getBytes(StandardCharsets.US_ASCII);
        boolean created = false;
        try {
            Path parent = outputPath.getParent();
            if (parent == null || !Files.isDirectory(parent)) {
                throw new InitialAdminBootstrapException();
            }
            FileStore fileStore = Files.getFileStore(parent);
            boolean posix = fileStore.supportsFileAttributeView("posix");
            boolean acl = !posix && fileStore.supportsFileAttributeView("acl");
            FileAttribute<?>[] attributes;
            if (posix) {
                attributes = new FileAttribute<?>[] {
                    PosixFilePermissions.asFileAttribute(OWNER_READ_WRITE)
                };
            } else if (acl) {
                AclFileAttributeView parentAcl = Files.getFileAttributeView(
                        parent,
                        AclFileAttributeView.class,
                        LinkOption.NOFOLLOW_LINKS);
                if (parentAcl == null) {
                    throw new InitialAdminBootstrapException();
                }
                UserPrincipal owner = parentAcl.getOwner();
                List<AclEntry> ownerOnlyAcl = List.of(AclEntry.newBuilder()
                        .setType(AclEntryType.ALLOW)
                        .setPrincipal(owner)
                        .setPermissions(EnumSet.allOf(AclEntryPermission.class))
                        .build());
                attributes = new FileAttribute<?>[] {
                    new FileAttribute<List<AclEntry>>() {
                        @Override
                        public String name() {
                            return "acl:acl";
                        }

                        @Override
                        public List<AclEntry> value() {
                            return ownerOnlyAcl;
                        }
                    }
                };
            } else {
                throw new InitialAdminBootstrapException();
            }
            Set<? extends OpenOption> options = Set.of(
                    StandardOpenOption.CREATE_NEW,
                    StandardOpenOption.WRITE);
            try (FileChannel channel =
                    FileChannel.open(outputPath, options, attributes)) {
                created = true;
                ByteBuffer buffer = ByteBuffer.wrap(tokenBytes);
                while (buffer.hasRemaining()) {
                    channel.write(buffer);
                }
                channel.force(true);
            }
            if (posix) {
                Files.setPosixFilePermissions(outputPath, OWNER_READ_WRITE);
                if (!Files.getPosixFilePermissions(outputPath)
                        .equals(OWNER_READ_WRITE)) {
                    throw new InitialAdminBootstrapException();
                }
            } else {
                requireOwnerOnlyAcl(outputPath);
            }
            parentDirectoryDurability.force(parent, posix, acl);
        } catch (IOException | UnsupportedOperationException fileFailure) {
            if (created) {
                deleteQuietly(outputPath);
            }
            throw new InitialAdminBootstrapException();
        } catch (RuntimeException fileFailure) {
            if (created) {
                deleteQuietly(outputPath);
            }
            throw new InitialAdminBootstrapException();
        } finally {
            Arrays.fill(tokenBytes, (byte) 0);
        }
    }

    private static void requireOwnerOnlyAcl(Path outputPath) throws IOException {
        AclFileAttributeView aclView = Files.getFileAttributeView(
                outputPath,
                AclFileAttributeView.class,
                LinkOption.NOFOLLOW_LINKS);
        if (aclView == null) {
            throw new InitialAdminBootstrapException();
        }
        UserPrincipal owner = aclView.getOwner();
        List<AclEntry> entries = aclView.getAcl();
        if (entries.isEmpty()
                || entries.stream().anyMatch(entry ->
                        entry.type() != AclEntryType.ALLOW
                                || !entry.principal().equals(owner))) {
            throw new InitialAdminBootstrapException();
        }
    }

    public void deleteQuietly(Path outputPath) {
        try {
            Files.deleteIfExists(outputPath);
        } catch (IOException ignored) {
            // The caller cannot safely expose filesystem details.
        }
    }

    private static void forceParentDirectory(
            Path parent,
            boolean posix,
            boolean acl) throws IOException {
        Class<?> providerType =
                parent.getFileSystem().provider().getClass();
        forceParentDirectory(
                parent,
                providerType.getModule().getName(),
                providerType.getName(),
                posix,
                acl,
                BootstrapTokenFileStore::forceDirectoryChannel);
    }

    static void forceParentDirectory(
            Path parent,
            String providerModule,
            String providerClass,
            boolean posix,
            boolean acl,
            DirectoryFsync directoryFsync) throws IOException {
        if (isUnsupportedWindowsDirectoryForce(
                providerModule,
                providerClass,
                posix,
                acl)) {
            return;
        }
        directoryFsync.force(parent);
    }

    static boolean isUnsupportedWindowsDirectoryForce(
            String providerModule,
            String providerClass,
            boolean posix,
            boolean acl) {
        // The JDK's default Windows provider rejects directory FileChannel.open
        // with AccessDeniedException. Classify that capability up front instead
        // of catching an exception that could represent a real ACL denial.
        return !posix
                && acl
                && JAVA_BASE_MODULE.equals(providerModule)
                && WINDOWS_FILE_SYSTEM_PROVIDER.equals(providerClass);
    }

    private static void forceDirectoryChannel(Path parent) throws IOException {
        try (FileChannel directory = FileChannel.open(
                parent,
                StandardOpenOption.READ)) {
            directory.force(true);
        }
    }

    @FunctionalInterface
    interface DirectoryFsync {

        void force(Path directory) throws IOException;
    }

    @FunctionalInterface
    interface ParentDirectoryDurability {

        void force(Path directory, boolean posix, boolean acl)
                throws IOException;
    }
}
