package cn.xzkj.erp.iam.bootstrap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AccessDeniedException;
import java.nio.file.FileStore;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.attribute.AclEntry;
import java.nio.file.attribute.AclEntryType;
import java.nio.file.attribute.AclFileAttributeView;
import java.nio.file.attribute.PosixFilePermission;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class BootstrapTokenFileStoreTest {

    private static final String WINDOWS_PROVIDER =
            "sun.nio.fs.WindowsFileSystemProvider";

    @TempDir
    Path temporaryDirectory;

    @Test
    void writesDurableOwnerOnlyTokenUnderNonAsciiPath() throws Exception {
        Path parent = Files.createDirectory(
                temporaryDirectory.resolve("引导凭据"));
        Path output = parent.resolve("初始令牌.token");
        String token = "A".repeat(43);

        new BootstrapTokenFileStore().createNew(output, token);

        assertThat(Files.readString(output, StandardCharsets.US_ASCII))
                .isEqualTo(token);
        assertOwnerOnly(output);
    }

    @Test
    void existingOutputRemainsUntouched() throws Exception {
        Path output = temporaryDirectory.resolve("existing.token");
        Files.writeString(output, "caller-owned-sentinel");

        assertThatThrownBy(() ->
                        new BootstrapTokenFileStore().createNew(
                                output,
                                "B".repeat(43)))
                .isExactlyInstanceOf(InitialAdminBootstrapException.class);

        assertThat(Files.readString(output))
                .isEqualTo("caller-owned-sentinel");
    }

    @Test
    void classifiesOnlyDefaultWindowsAclProviderAsUnsupported() {
        assertThat(BootstrapTokenFileStore
                        .isUnsupportedWindowsDirectoryForce(
                                "java.base",
                                WINDOWS_PROVIDER,
                                false,
                                true))
                .isTrue();
        assertThat(BootstrapTokenFileStore
                        .isUnsupportedWindowsDirectoryForce(
                                "custom.module",
                                WINDOWS_PROVIDER,
                                false,
                                true))
                .isFalse();
        assertThat(BootstrapTokenFileStore
                        .isUnsupportedWindowsDirectoryForce(
                                "java.base",
                                "example.WindowsFileSystemProvider",
                                false,
                                true))
                .isFalse();
        assertThat(BootstrapTokenFileStore
                        .isUnsupportedWindowsDirectoryForce(
                                "java.base",
                                WINDOWS_PROVIDER,
                                true,
                                true))
                .isFalse();
        assertThat(BootstrapTokenFileStore
                        .isUnsupportedWindowsDirectoryForce(
                                "java.base",
                                WINDOWS_PROVIDER,
                                false,
                                false))
                .isFalse();
    }

    @Test
    void unsupportedWindowsDirectoryForceIsNotAttempted() throws Exception {
        AtomicBoolean attempted = new AtomicBoolean();

        BootstrapTokenFileStore.forceParentDirectory(
                temporaryDirectory,
                "java.base",
                WINDOWS_PROVIDER,
                false,
                true,
                directory -> {
                    attempted.set(true);
                    throw new AccessDeniedException(directory.toString());
                });

        assertThat(attempted).isFalse();
    }

    @Test
    void ordinaryDirectoryIoFailuresAreNeverSwallowed() {
        IOException ordinaryFailure =
                new IOException("simulated ordinary directory I/O failure");

        assertThatThrownBy(() ->
                        BootstrapTokenFileStore.forceParentDirectory(
                                temporaryDirectory,
                                "java.base",
                                WINDOWS_PROVIDER,
                                true,
                                true,
                                directory -> {
                                    throw ordinaryFailure;
                                }))
                .isSameAs(ordinaryFailure);
    }

    @Test
    void directoryIoFailureRemainsFatalAndCleansNewTokenFile() {
        Path output = temporaryDirectory.resolve("must-be-cleaned.token");
        BootstrapTokenFileStore store = new BootstrapTokenFileStore(
                (directory, posix, acl) -> {
                    throw new IOException(
                            "simulated directory durability failure");
                });

        assertThatThrownBy(() ->
                        store.createNew(output, "C".repeat(43)))
                .isExactlyInstanceOf(InitialAdminBootstrapException.class)
                .hasMessage("Initial administrator bootstrap failed safely");

        assertThat(output).doesNotExist();
    }

    private static void assertOwnerOnly(Path output) throws Exception {
        FileStore fileStore = Files.getFileStore(output);
        if (fileStore.supportsFileAttributeView("posix")) {
            assertThat(Files.getPosixFilePermissions(output))
                    .isEqualTo(Set.of(
                            PosixFilePermission.OWNER_READ,
                            PosixFilePermission.OWNER_WRITE));
            return;
        }
        assertThat(fileStore.supportsFileAttributeView("acl")).isTrue();
        AclFileAttributeView aclView = Files.getFileAttributeView(
                output,
                AclFileAttributeView.class,
                LinkOption.NOFOLLOW_LINKS);
        assertThat(aclView).isNotNull();
        List<AclEntry> entries = aclView.getAcl();
        assertThat(entries).isNotEmpty();
        assertThat(entries).allSatisfy(entry -> {
            assertThat(entry.type()).isEqualTo(AclEntryType.ALLOW);
            assertThat(entry.principal()).isEqualTo(aclView.getOwner());
        });
    }
}
