package cn.xzkj.erp.platformadmin.shopifyrelease;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
final class CliShopifyAppReleaseExecutor implements ShopifyAppReleaseExecutor {
    private static final String EXPECTED_CLIENT_ID =
            "6cef3dfc6b0d74e7c2709232f2938696";
    private static final int MAX_OUTPUT_BYTES = 32 * 1024;
    private static final DateTimeFormatter VERSION_TIME = DateTimeFormatter
            .ofPattern("yyyyMMdd-HHmmss", Locale.ROOT)
            .withZone(ZoneOffset.UTC);

    private final String executable;
    private final Path projectDirectory;
    private final Duration timeout;

    CliShopifyAppReleaseExecutor(
            @Value("${erp.shopify-release.cli-path:}") String configuredExecutable,
            @Value("${erp.shopify-release.project-directory:../customer-service}")
                    String configuredProjectDirectory,
            @Value("${erp.shopify-release.timeout:PT10M}") Duration timeout) {
        executable = configuredExecutable == null
                        || configuredExecutable.isBlank()
                ? (System.getProperty("os.name", "")
                                .toLowerCase(Locale.ROOT).contains("win")
                        ? "shopify.cmd" : "shopify")
                : configuredExecutable.strip();
        projectDirectory = Path.of(configuredProjectDirectory).toAbsolutePath()
                .normalize();
        this.timeout = timeout == null ? Duration.ofMinutes(10) : timeout;
        if (this.timeout.isZero() || this.timeout.isNegative()
                || this.timeout.compareTo(Duration.ofMinutes(15)) > 0) {
            throw new IllegalArgumentException(
                    "Shopify app release timeout must be 1-15 minutes");
        }
    }

    @Override
    public ReleaseResult release(char[] automationToken) {
        if (automationToken == null || automationToken.length < 20) {
            throw new ShopifyAppReleaseFailedException(
                    "Shopify App Automation Token 不完整，请重新保存令牌后重试。");
        }
        String version = "xinzhi-erp-" + VERSION_TIME.format(Instant.now());
        String token = new String(automationToken);
        Process process = null;
        Path workspace = null;
        try {
            workspace = prepareWorkspace(validateReleaseSource());
            ProcessBuilder command = new ProcessBuilder(
                    deployCommand(workspace, version));
            command.redirectErrorStream(true);
            command.environment().put("SHOPIFY_APP_AUTOMATION_TOKEN", token);
            command.environment().put("SHOPIFY_CLI_NO_ANALYTICS", "1");
            command.environment().put("CI", "1");
            command.environment().put("HOME",
                    workspace.resolve(".home").toString());
            command.environment().put("XDG_CONFIG_HOME",
                    workspace.resolve(".config").toString());
            process = command.start();
            Process started = process;
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            Thread outputReader = Thread.ofVirtual().start(() ->
                    drain(started.getInputStream(), output));
            boolean completed = process.waitFor(
                    timeout.toMillis(), TimeUnit.MILLISECONDS);
            if (!completed) {
                process.destroyForcibly();
                outputReader.join(Duration.ofSeconds(5));
                throw new ShopifyAppReleaseFailedException(
                        "Shopify CLI 发布超时，请检查网络后重试。");
            }
            outputReader.join(Duration.ofSeconds(5));
            String safeOutput = sanitize(output.toString(StandardCharsets.UTF_8),
                    token);
            if (process.exitValue() != 0) {
                throw new ShopifyAppReleaseFailedException(
                        releaseFailureMessage(safeOutput));
            }
            return new ReleaseResult(version,
                    "Shopify 应用配置与 Xinzhi Chat 插件已发布。");
        } catch (ShopifyAppReleaseFailedException exception) {
            throw exception;
        } catch (IOException exception) {
            throw new ShopifyAppReleaseFailedException(
                    "无法启动 Shopify CLI，请检查服务器发布组件是否完整。");
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            if (process != null) process.destroyForcibly();
            throw new ShopifyAppReleaseFailedException(
                    "Shopify 应用发布已中断，请重试。");
        } finally {
            token = "";
            deleteWorkspace(workspace);
        }
    }

    List<String> deployCommand(Path workspace, String version) {
        return List.of(
                executable,
                "app", "deploy",
                "--path", workspace.toString(),
                "--client-id", EXPECTED_CLIENT_ID,
                "--allow-updates",
                "--no-color",
                "--message", "Published from Xinzhi ERP platform admin",
                "--version", version);
    }

    private Path validateReleaseSource() {
        try {
            Path root = projectDirectory.toRealPath();
            Path config = root.resolve("shopify.app.toml");
            Path packageManifest = root.resolve("package.json");
            Path packageLock = root.resolve("package-lock.json");
            Path extension = root.resolve("extensions/xinzhi-support-chat")
                    .toRealPath();
            if (!extension.startsWith(root) || !Files.isRegularFile(config)
                    || !Files.isRegularFile(packageManifest)
                    || !Files.isRegularFile(packageLock)
                    || !Files.isRegularFile(extension.resolve(
                            "shopify.extension.toml"))) {
                throw new IOException("Shopify release source is incomplete");
            }
            String appConfig = Files.readString(config, StandardCharsets.UTF_8);
            String extensionConfig = Files.readString(extension.resolve(
                    "shopify.extension.toml"), StandardCharsets.UTF_8);
            if (!appConfig.contains("client_id = \"" + EXPECTED_CLIENT_ID + "\"")
                    || !appConfig.contains("name = \"Xinzhi ERP\"")
                    || !extensionConfig.contains("name = \"Xinzhi Chat\"")
                    || !extensionConfig.contains("type = \"theme\"")) {
                throw new IOException("Shopify app identity does not match");
            }
            return root;
        } catch (IOException exception) {
            throw new ShopifyAppReleaseFailedException(
                    "服务器中的 Xinzhi ERP 插件发布文件不完整，无法发布。");
        }
    }

    private static Path prepareWorkspace(Path sourceRoot) throws IOException {
        Path workspace = Files.createTempDirectory("xinzhi-shopify-release-");
        try {
            Files.createDirectories(workspace.resolve("extensions"));
            Files.copy(sourceRoot.resolve("shopify.app.toml"),
                    workspace.resolve("shopify.app.toml"));
            Files.copy(sourceRoot.resolve("package.json"),
                    workspace.resolve("package.json"));
            Files.copy(sourceRoot.resolve("package-lock.json"),
                    workspace.resolve("package-lock.json"));
            copyDirectory(
                    sourceRoot.resolve("extensions/xinzhi-support-chat"),
                    workspace.resolve("extensions/xinzhi-support-chat"));
            Files.createDirectories(workspace.resolve(".home"));
            Files.createDirectories(workspace.resolve(".config"));
            return workspace;
        } catch (IOException exception) {
            deleteWorkspace(workspace);
            throw exception;
        }
    }

    private static void copyDirectory(Path source, Path target)
            throws IOException {
        try (var paths = Files.walk(source)) {
            for (Path path : paths.toList()) {
                Path destination = target.resolve(source.relativize(path));
                if (Files.isDirectory(path)) {
                    Files.createDirectories(destination);
                } else if (Files.isRegularFile(path)) {
                    Files.copy(path, destination);
                }
            }
        }
    }

    private static void deleteWorkspace(Path workspace) {
        if (workspace == null) return;
        try (var paths = Files.walk(workspace)) {
            paths.sorted(Comparator.reverseOrder()).forEach(path -> {
                try {
                    Files.deleteIfExists(path);
                } catch (IOException ignored) {
                    // A later container restart also clears the tmpfs workspace.
                }
            });
        } catch (IOException ignored) {
            // A later container restart also clears the tmpfs workspace.
        }
    }

    private static void drain(InputStream input, ByteArrayOutputStream output) {
        byte[] buffer = new byte[4096];
        try (input) {
            int read;
            while ((read = input.read(buffer)) != -1) {
                int remaining = MAX_OUTPUT_BYTES - output.size();
                if (remaining > 0) {
                    output.write(buffer, 0, Math.min(read, remaining));
                }
            }
        } catch (IOException ignored) {
            // Process exit status remains the authority; output is diagnostic only.
        } finally {
            Arrays.fill(buffer, (byte) 0);
        }
    }

    private static String sanitize(String value, String token) {
        String sanitized = value == null ? "" : value.strip();
        if (token != null && !token.isBlank()) {
            sanitized = sanitized.replace(token, "[REDACTED]");
        }
        sanitized = sanitized.replaceAll("(?i)(token[=:]\\s*)[^\\s]+", "$1[REDACTED]");
        return sanitized.length() <= 2000
                ? sanitized
                : sanitized.substring(sanitized.length() - 2000);
    }

    static String releaseFailureMessage(String safeOutput) {
        if (safeOutput.contains("Unauthorized")
                || safeOutput.contains("unauthorized")
                || safeOutput.contains("401")) {
            return "Automation Token 无效或不属于 Xinzhi ERP 应用，请替换令牌后重试。";
        }
        if (safeOutput.contains("Flag not specified")
                && safeOutput.contains("--allow-updates")) {
            return "Shopify 发布参数不完整，请更新 ERP 发布组件后重试。";
        }
        if (safeOutput.isBlank()) {
            return "Shopify CLI 发布失败，请检查服务器网络后重试。";
        }
        return "Shopify CLI 发布失败：" + safeOutput;
    }
}
