package ai.xzkj.recruitment.resilience;

import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.function.Supplier;

@Component
public class GatewayResilienceGuard implements DisposableBean {
    public enum FailureReason { TIMEOUT, RATE_LIMITED, CONCURRENCY_LIMITED, CIRCUIT_OPEN, GATEWAY_ERROR }
    public record Snapshot(String operation, int consecutiveFailures, Instant circuitOpenUntil, int requestsInWindow, int availablePermits) {}

    private final GatewayProperties properties;
    private final MeterRegistry meterRegistry;
    private final Clock clock;
    private final ExecutorService executor;
    private final ConcurrentHashMap<String, OperationState> states = new ConcurrentHashMap<>();

    @Autowired public GatewayResilienceGuard(GatewayProperties properties, MeterRegistry meterRegistry) {
        this(properties, meterRegistry, Clock.systemUTC(), Executors.newVirtualThreadPerTaskExecutor());
    }
    GatewayResilienceGuard(GatewayProperties properties, MeterRegistry meterRegistry, Clock clock, ExecutorService executor) {
        this.properties = properties; this.meterRegistry = meterRegistry; this.clock = clock; this.executor = executor;
    }

    public <T> T execute(String operation, Supplier<T> call, Predicate<T> succeeded, Function<FailureReason, T> fallback) {
        OperationState state = states.computeIfAbsent(operation, ignored -> new OperationState(properties.maxConcurrent()));
        Instant now = clock.instant();
        FailureReason rejected = state.beforeCall(now, properties);
        if (rejected != null) return rejected(operation, rejected, fallback);
        if (!state.permits.tryAcquire()) return rejected(operation, FailureReason.CONCURRENCY_LIMITED, fallback);
        Future<T> future = executor.submit(call::get);
        try {
            T value = future.get(properties.timeout().toMillis(), TimeUnit.MILLISECONDS);
            boolean successful = succeeded.test(value);
            if (successful) state.success(); else state.failure(clock.instant(), properties);
            meterRegistry.counter("recruitment.gateway.calls", "operation", operation, "result", successful ? "success" : "failure").increment();
            return value;
        } catch (TimeoutException exception) {
            future.cancel(true); state.failure(clock.instant(), properties);
            return rejected(operation, FailureReason.TIMEOUT, fallback);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt(); state.failure(clock.instant(), properties);
            return rejected(operation, FailureReason.GATEWAY_ERROR, fallback);
        } catch (ExecutionException | RuntimeException exception) {
            state.failure(clock.instant(), properties);
            return rejected(operation, FailureReason.GATEWAY_ERROR, fallback);
        } finally { state.permits.release(); }
    }

    public List<Snapshot> snapshots() {
        return states.entrySet().stream().map(entry -> entry.getValue().snapshot(entry.getKey(), clock.instant(), properties))
                .sorted(Comparator.comparing(Snapshot::operation)).toList();
    }

    private <T> T rejected(String operation, FailureReason reason, Function<FailureReason, T> fallback) {
        meterRegistry.counter("recruitment.gateway.calls", "operation", operation, "result", reason.name().toLowerCase()).increment();
        return fallback.apply(reason);
    }

    @Override public void destroy() { executor.shutdownNow(); }

    private static final class OperationState {
        private final Semaphore permits;
        private final ArrayDeque<Instant> requestTimes = new ArrayDeque<>();
        private int consecutiveFailures;
        private Instant circuitOpenUntil;
        private OperationState(int maxConcurrent) { permits = new Semaphore(maxConcurrent); }

        private synchronized FailureReason beforeCall(Instant now, GatewayProperties properties) {
            if (circuitOpenUntil != null) {
                if (circuitOpenUntil.isAfter(now)) return FailureReason.CIRCUIT_OPEN;
                circuitOpenUntil = null; consecutiveFailures = 0;
            }
            Instant cutoff = now.minusSeconds(60);
            while (!requestTimes.isEmpty() && requestTimes.peekFirst().isBefore(cutoff)) requestTimes.removeFirst();
            if (requestTimes.size() >= properties.rateLimitPerMinute()) return FailureReason.RATE_LIMITED;
            requestTimes.addLast(now); return null;
        }
        private synchronized void success() { consecutiveFailures = 0; circuitOpenUntil = null; }
        private synchronized void failure(Instant now, GatewayProperties properties) {
            consecutiveFailures++;
            if (consecutiveFailures >= properties.circuitFailureThreshold()) circuitOpenUntil = now.plus(properties.circuitOpenDuration());
        }
        private synchronized Snapshot snapshot(String operation, Instant now, GatewayProperties properties) {
            Instant cutoff = now.minusSeconds(60);
            while (!requestTimes.isEmpty() && requestTimes.peekFirst().isBefore(cutoff)) requestTimes.removeFirst();
            return new Snapshot(operation, consecutiveFailures, circuitOpenUntil, requestTimes.size(), permits.availablePermits());
        }
    }
}
