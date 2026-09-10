package cn.xzkj.erp.platform.connector;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.ObjectMapper;

class StoreAppReadPreparationProcessTest {
    @TempDir Path temporary;

    @Test void actualJavaCallsActualGoAndLeavesTheSyntheticOwnerUntouched() throws Exception {
        try (var process = SyntheticStoreAppProcess.start(temporary)) {
            var reader = XzErpAppChannelConnectorGateway.storeAppReadPreparation(process.baseUrl,
                    StoreAppReadPreparationTest.TOKEN, new XzErpAppChannelConnectorGateway.StoreAppReadBinding(
                            StoreAppReadPreparationTest.TENANT, StoreAppReadPreparationTest.SHOP, 7));
            var status = reader.snapshot(StoreAppReadPreparationTest.TENANT, StoreAppReadPreparationTest.SHOP);
            var page = reader.fetchShopifyOrderCatalog(StoreAppReadPreparationTest.TENANT, StoreAppReadPreparationTest.SHOP,
                    new ChannelConnectorGateway.OrderCatalogRequest(10, null, null));
            assertThat(status.mode()).isEqualTo(ChannelConnectorGateway.ConnectorMode.CUSTOMER_SERVICE_STORE_APP_READ_ONLY);
            assertThat(status.shopify().shopDomain()).isEqualTo(StoreAppReadPreparationTest.DOMAIN);
            assertThat(page.orders()).singleElement().satisfies(order -> assertThat(order.name()).isEqualTo("#SYNTHETIC-123"));
            assertThatThrownBy(() -> reader.snapshot(UUID.randomUUID(), StoreAppReadPreparationTest.SHOP)).isInstanceOf(ConnectorUnavailableException.class);
            assertThatThrownBy(() -> reader.uninstallShopify(StoreAppReadPreparationTest.TENANT, StoreAppReadPreparationTest.SHOP)).isInstanceOf(ConnectorUnavailableException.class);
            var wrongVersion = XzErpAppChannelConnectorGateway.storeAppReadPreparation(process.baseUrl,
                    StoreAppReadPreparationTest.TOKEN, new XzErpAppChannelConnectorGateway.StoreAppReadBinding(
                            StoreAppReadPreparationTest.TENANT, StoreAppReadPreparationTest.SHOP, 6));
            assertThatThrownBy(() -> wrongVersion.snapshot(StoreAppReadPreparationTest.TENANT, StoreAppReadPreparationTest.SHOP)).isInstanceOf(ConnectorUnavailableException.class);
            var response = HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create(process.baseUrl + "/rehearsal/evidence"))
                    .timeout(Duration.ofSeconds(5)).build(), HttpResponse.BodyHandlers.ofString());
            var evidence = new ObjectMapper().readTree(response.body());
            assertThat(evidence.path("ownerStateUnchanged").asBoolean()).isTrue();
            assertThat(evidence.path("productionReady").asBoolean()).isFalse();
            assertThat(evidence.path("identityReads").asInt()).isEqualTo(2);
            assertThat(evidence.path("orderReads").asInt()).isEqualTo(1);
            assertThat(evidence.path("blockedUpstreamRequests").asInt()).isZero();
            assertThat(response.body()).doesNotContain("synthetic-owner-token", "service-credential");
        }
    }
}

// Owned test process only; the compiled command ignores all production config.
final class SyntheticStoreAppProcess implements AutoCloseable {
    final Process process;
    final String baseUrl;
    private SyntheticStoreAppProcess(Process process, String baseUrl) { this.process = process; this.baseUrl = baseUrl; }
    static SyntheticStoreAppProcess start(Path temporary) throws Exception {
        return startCommand(temporary, "store-app-read-rehearsal");
    }
    static SyntheticStoreAppProcess startIdentity(Path temporary) throws Exception {
        return startCommand(temporary, "identity-preparation-rehearsal");
    }
    static SyntheticStoreAppProcess startIdentityPostgres(Path temporary,int port) throws Exception {
        return startCommand(temporary,"identity-preparation-rehearsal",port);
    }
    static SyntheticStoreAppProcess startInventory(Path temporary,int claimPort) throws Exception {
        return startCommand(temporary,"inventory-preparation-rehearsal",claimPort);
    }
    private static SyntheticStoreAppProcess startCommand(Path temporary, String command) throws Exception {
        return startCommand(temporary,command,null);
    }
    private static SyntheticStoreAppProcess startCommand(Path temporary,String command,Integer port) throws Exception {
        temporary=temporary.toAbsolutePath().normalize();
        Path source = Path.of("../customer-service").toAbsolutePath().normalize();
        Path binary = temporary.resolve(command + (System.getProperty("os.name").startsWith("Windows") ? ".exe" : ""));
        var buildCommand = new ProcessBuilder("go", "build", "-o", binary.toString(), "./cmd/" + command)
                .directory(source.toFile()).redirectErrorStream(true).redirectOutput(temporary.resolve("go-build.log").toFile());
        retainSafeEnvironment(buildCommand);
        // The Maven gate intentionally strips user app configuration. Go still
        // needs a cache on Windows; use only this checkout's generated output.
        buildCommand.environment().put("GOCACHE", Path.of("target/store-app-read-preparation-go-cache").toAbsolutePath().normalize().toString());
        buildCommand.environment().put("GOENV", "off");
        buildCommand.environment().put("GOPROXY", "off");
        buildCommand.environment().put("GOSUMDB", "off");
        buildCommand.environment().put("GOTOOLCHAIN", "local");
        Process build = buildCommand.start();
        try {
            if (!build.waitFor(90, TimeUnit.SECONDS) || build.exitValue() != 0) throw new IllegalStateException("Synthetic Go rehearsal build failed");
        } finally { if (build.isAlive()) { build.destroyForcibly(); build.waitFor(5, TimeUnit.SECONDS); } }
        var launch = port==null?java.util.List.of(binary.toString()):java.util.List.of(binary.toString(),command.equals("inventory-preparation-rehearsal")?"--owned-claim-port":"--owned-postgres");
        var launchCommand = new ProcessBuilder(launch).directory(temporary.toFile())
                .redirectError(temporary.resolve("go-rehearsal.log").toFile());
        retainSafeEnvironment(launchCommand);
        Process process = launchCommand.start();
        if(port!=null) {try(var input=process.outputWriter()){input.write("{\"port\":"+port+"}\n");}}
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            try {
                String line = executor.submit(() -> process.inputReader().readLine()).get(40, TimeUnit.SECONDS);
                if(line==null) throw new IllegalStateException("Synthetic Go rehearsal exited before readiness");
                var metadata = new ObjectMapper().readTree(line);
                String base = metadata.path("url").asString();
                if (!metadata.path("synthetic").asBoolean() || !base.matches("http://127\\.0\\.0\\.1:[0-9]{1,5}")) throw new IllegalStateException("Synthetic Go rehearsal startup failed");
                return new SyntheticStoreAppProcess(process, base);
            } catch (Exception failure) {
                process.destroyForcibly(); process.waitFor(5, TimeUnit.SECONDS); throw failure;
            }
        }
    }
    private static void retainSafeEnvironment(ProcessBuilder process) {
        var allowed=java.util.Set.of("PATH","PATHEXT","SYSTEMROOT","COMSPEC","USERPROFILE","TEMP","TMP","LOCALAPPDATA");
        process.environment().keySet().removeIf(key->!allowed.contains(key.toUpperCase(java.util.Locale.ROOT)));
    }
    @Override public void close() throws Exception {
        process.destroy();
        if (!process.waitFor(5, TimeUnit.SECONDS)) { process.destroyForcibly(); process.waitFor(5, TimeUnit.SECONDS); }
    }
}
