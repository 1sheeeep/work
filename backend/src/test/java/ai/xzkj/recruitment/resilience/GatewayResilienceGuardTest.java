package ai.xzkj.recruitment.resilience;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.concurrent.Executors;

import static org.assertj.core.api.Assertions.assertThat;

class GatewayResilienceGuardTest {
    GatewayResilienceGuard guard;
    @AfterEach void close() { if (guard != null) guard.destroy(); }

    @Test void timesOutAndReturnsFallback() {
        guard = create(new GatewayProperties(Duration.ofMillis(20), 1, 10, 3, Duration.ofSeconds(30)));
        String result = guard.execute("slow", () -> { try { Thread.sleep(200); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); } return "late"; },
                value -> true, reason -> reason.name());
        assertThat(result).isEqualTo("TIMEOUT");
    }

    @Test void rateLimitsCallsWithinOneMinute() {
        guard = create(new GatewayProperties(Duration.ofSeconds(1), 2, 2, 3, Duration.ofSeconds(30)));
        assertThat(call("rate")).isEqualTo("ok");
        assertThat(call("rate")).isEqualTo("ok");
        assertThat(call("rate")).isEqualTo("RATE_LIMITED");
    }

    @Test void opensCircuitAfterConsecutiveFailures() {
        guard = create(new GatewayProperties(Duration.ofSeconds(1), 2, 10, 2, Duration.ofSeconds(30)));
        assertThat(failedCall()).isEqualTo("gateway-failed");
        assertThat(failedCall()).isEqualTo("gateway-failed");
        String blocked = guard.execute("circuit", () -> "should-not-run", value -> true, Enum::name);
        assertThat(blocked).isEqualTo("CIRCUIT_OPEN");
        assertThat(guard.snapshots().getFirst().circuitOpenUntil()).isNotNull();
    }

    private GatewayResilienceGuard create(GatewayProperties properties) {
        return new GatewayResilienceGuard(properties, new SimpleMeterRegistry(),
                Clock.fixed(Instant.parse("2026-08-28T08:00:00Z"), ZoneOffset.UTC), Executors.newVirtualThreadPerTaskExecutor());
    }
    private String call(String operation) { return guard.execute(operation, () -> "ok", value -> true, Enum::name); }
    private String failedCall() { return guard.execute("circuit", () -> "gateway-failed", value -> false, Enum::name); }
}
