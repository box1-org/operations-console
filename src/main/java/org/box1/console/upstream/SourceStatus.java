package org.box1.console.upstream;

import java.time.Instant;

/** How one upstream answered while building a response (#17's sourceStatus). Values from a failed source are absent. */
public record SourceStatus(Source source, State status, String detail, Long latencyMs, Instant observedAt) {
    public enum State { OK, DEGRADED, UNAVAILABLE, NOT_AUTHORIZED, NOT_CONFIGURED }

    public static SourceStatus ok(Source source, long latencyMs) {
        return new SourceStatus(source, State.OK, null, latencyMs, Instant.now());
    }

    public static SourceStatus of(Source source, State state, String detail, Long latencyMs) {
        return new SourceStatus(source, state, detail, latencyMs, Instant.now());
    }
}
