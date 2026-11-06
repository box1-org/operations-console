package org.box1.console.upstream;

import java.net.http.HttpHeaders;

/**
 * Result of one upstream call. {@code status} is the HTTP status, or 0 when no HTTP answer arrived.
 * {@code sourceStatus} is what the page reports for this call. {@code problemDetail} is the plain {@code detail} of an
 * RFC 9457 refusal (4xx) from the upstream, bounded in length, or null; only sources whose messages are written for
 * people may show it (the scenario controller's are).
 */
public record UpstreamResponse<T>(int status, T body, HttpHeaders headers, SourceStatus sourceStatus, String problemDetail) {
    public UpstreamResponse(int status, T body, HttpHeaders headers, SourceStatus sourceStatus) {
        this(status, body, headers, sourceStatus, null);
    }

    public boolean ok() {
        return status >= 200 && status < 300 && body != null;
    }

    public boolean notFound() {
        return status == 404;
    }
}
