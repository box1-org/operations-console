package org.box1.console.upstream;

import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import io.opentelemetry.context.Context;
import jakarta.annotation.PreDestroy;
import jakarta.enterprise.context.ApplicationScoped;

/** Runs upstream reads in parallel on virtual threads, carrying the trace context; waits no longer than a deadline. */
@ApplicationScoped
public class Fanout {
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();

    public <T> Future<T> submit(Callable<T> task) {
        return executor.submit(Context.current().wrap(task));
    }

    /** The task's result, or {@code fallback} when it did not finish by {@code deadlineNanos} (System.nanoTime based). */
    public static <T> T await(Future<T> future, long deadlineNanos, T fallback) {
        long remaining = deadlineNanos - System.nanoTime();
        try {
            return future.get(Math.max(remaining, 0), TimeUnit.NANOSECONDS);
        } catch (TimeoutException late) {
            future.cancel(true);
            return fallback;
        } catch (ExecutionException failed) {
            return fallback;
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return fallback;
        }
    }

    @PreDestroy
    void close() {
        executor.shutdownNow();
    }
}
