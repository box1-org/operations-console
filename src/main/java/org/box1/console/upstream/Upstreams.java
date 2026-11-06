package org.box1.console.upstream;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpConnectTimeoutException;
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.util.EnumMap;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.MeterRegistry;
import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.context.Context;
import jakarta.enterprise.context.ApplicationScoped;
import org.jboss.logging.Logger;

/**
 * The only way the console backend calls another service. Short timeouts, at most N in-flight calls per source
 * (excess fails fast instead of queueing), no retries, W3C trace propagation, and a {@link SourceStatus} for every
 * call. Never logs tokens, bodies or customer fields.
 */
@ApplicationScoped
public class Upstreams {
    private static final Logger LOG = Logger.getLogger(Upstreams.class);

    private final UpstreamConfig config;
    private final ObjectMapper json;
    private final OpenTelemetry otel;
    private final MeterRegistry metrics;
    private final HttpClient http;
    private final Map<Source, Semaphore> bulkheads = new EnumMap<>(Source.class);

    public Upstreams(UpstreamConfig config, ObjectMapper json, OpenTelemetry otel, MeterRegistry metrics) {
        this.config = config;
        this.json = json;
        this.otel = otel;
        this.metrics = metrics;
        this.http = HttpClient.newBuilder().connectTimeout(config.connectTimeout())
            .followRedirects(HttpClient.Redirect.NEVER).build();
        for (Source source : Source.values()) {
            bulkheads.put(source, new Semaphore(config.maxConcurrentPerSource()));
        }
    }

    public boolean configured(Source source) {
        return config.url(source).isPresent();
    }

    public <T> UpstreamResponse<T> get(Source source, String pathAndQuery, Optional<String> bearer, TypeReference<T> type) {
        return call(source, "GET", pathAndQuery, bearer, Map.of(), null, type, config.readTimeout());
    }

    public <T> UpstreamResponse<T> post(Source source, String path, Optional<String> bearer, Map<String, String> headers,
        Object body, TypeReference<T> type) {
        return call(source, "POST", path, bearer, headers, body, type, config.readTimeout());
    }

    /** A POST whose work legitimately takes longer than a read (scenario seed, stop and reset). */
    public <T> UpstreamResponse<T> post(Source source, String path, Optional<String> bearer, Map<String, String> headers,
        Object body, TypeReference<T> type, Duration timeout) {
        return call(source, "POST", path, bearer, headers, body, type, timeout);
    }

    <T> UpstreamResponse<T> call(Source source, String method, String pathAndQuery, Optional<String> bearer,
        Map<String, String> headers, Object body, TypeReference<T> type, Duration timeout) {
        Optional<String> base = config.url(source);
        if (base.isEmpty()) {
            return record(source, new UpstreamResponse<>(0, null, null,
                SourceStatus.of(source, SourceStatus.State.NOT_CONFIGURED, "No URL is configured for this source.", null)));
        }
        Semaphore bulkhead = bulkheads.get(source);
        if (!bulkhead.tryAcquire()) {
            return record(source, new UpstreamResponse<>(0, null, null,
                SourceStatus.of(source, SourceStatus.State.DEGRADED, "Too many concurrent calls; try again.", null)));
        }
        long start = System.nanoTime();
        try {
            HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(base.get() + pathAndQuery))
                .timeout(timeout).header("Accept", "application/json");
            bearer.ifPresent(token -> request.header("Authorization", "Bearer " + token));
            headers.forEach(request::header);
            otel.getPropagators().getTextMapPropagator().inject(Context.current(), request, HttpRequest.Builder::header);
            if (body == null) {
                request.method(method, HttpRequest.BodyPublishers.noBody());
            } else {
                request.header("Content-Type", "application/json")
                    .method(method, HttpRequest.BodyPublishers.ofByteArray(json.writeValueAsBytes(body)));
            }
            HttpResponse<byte[]> response = http.send(request.build(), HttpResponse.BodyHandlers.ofByteArray());
            long latency = (System.nanoTime() - start) / 1_000_000;
            int status = response.statusCode();
            T parsed = null;
            if (status >= 200 && status < 300 && response.body().length > 0) {
                parsed = json.readValue(response.body(), type);
            }
            return record(source, new UpstreamResponse<>(status, parsed, response.headers(), statusFor(source, status, latency),
                problemDetail(status, response.body())));
        } catch (HttpConnectTimeoutException connectTimeout) {
            long latency = (System.nanoTime() - start) / 1_000_000;
            return record(source, new UpstreamResponse<>(0, null, null, SourceStatus.of(source, SourceStatus.State.UNAVAILABLE,
                "Could not connect within " + config.connectTimeout().toMillis() + " ms.", latency)));
        } catch (HttpTimeoutException readTimeout) {
            long latency = (System.nanoTime() - start) / 1_000_000;
            return record(source, new UpstreamResponse<>(0, null, null, SourceStatus.of(source, SourceStatus.State.UNAVAILABLE,
                "No answer within " + timeout.toMillis() + " ms.", latency)));
        } catch (IOException failure) {
            long latency = (System.nanoTime() - start) / 1_000_000;
            LOG.debugf("Upstream %s failed: %s", source.id(), failure.getClass().getSimpleName());
            return record(source, new UpstreamResponse<>(0, null, null, SourceStatus.of(source, SourceStatus.State.UNAVAILABLE,
                "Could not reach the service (" + failure.getClass().getSimpleName() + ").", latency)));
        } catch (IllegalArgumentException invalid) {
            // An unusable URI or header (for example an odd Link query from the upstream) degrades the source, never a 500.
            return record(source, new UpstreamResponse<>(0, null, null, SourceStatus.of(source, SourceStatus.State.UNAVAILABLE,
                "The request to this service could not be built.", null)));
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return record(source, new UpstreamResponse<>(0, null, null,
                SourceStatus.of(source, SourceStatus.State.UNAVAILABLE, "Interrupted.", null)));
        } finally {
            bulkhead.release();
        }
    }

    /** The {@code detail} of a 4xx problem body, if it is one; at most 300 characters, never the raw body. */
    private String problemDetail(int status, byte[] body) {
        if (status < 400 || status >= 500 || body.length == 0 || body.length > 16_384) {
            return null;
        }
        try {
            JsonNode detail = json.readTree(body).get("detail");
            if (detail == null || !detail.isTextual() || detail.asText().isBlank()) {
                return null;
            }
            String text = detail.asText().strip();
            return text.length() > 300 ? text.substring(0, 300) : text;
        } catch (IOException notJson) {
            return null;
        }
    }

    private static SourceStatus statusFor(Source source, int status, long latency) {
        if (status >= 200 && status < 300 || status == 404 || status == 409 || status == 400) {
            return SourceStatus.ok(source, latency);
        }
        if (status == 401 || status == 403) {
            return SourceStatus.of(source, SourceStatus.State.NOT_AUTHORIZED,
                "The service refused the console's credentials (HTTP " + status + ").", latency);
        }
        return SourceStatus.of(source, SourceStatus.State.UNAVAILABLE, "The service answered HTTP " + status + ".", latency);
    }

    private <T> UpstreamResponse<T> record(Source source, UpstreamResponse<T> response) {
        SourceStatus status = response.sourceStatus();
        String outcome = status.status().name();
        metrics.counter("console.upstream.calls", "source", source.id(), "outcome", outcome).increment();
        if (status.latencyMs() != null) {
            metrics.timer("console.upstream.duration", "source", source.id(), "outcome", outcome)
                .record(status.latencyMs(), TimeUnit.MILLISECONDS);
        }
        if (status.status() != SourceStatus.State.OK && status.status() != SourceStatus.State.NOT_CONFIGURED) {
            // One line per failed upstream call, carrying the trace ID via MDC; never the URL, headers or body.
            LOG.warnf("upstream=%s outcome=%s http=%d latencyMs=%s", source.id(), outcome, response.status(),
                status.latencyMs() == null ? "-" : status.latencyMs().toString());
        }
        return response;
    }
}
