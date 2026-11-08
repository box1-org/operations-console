package org.box1.console.upstream;

import java.net.http.HttpHeaders;

/**
 * Result of one upstream call. {@code status} is the HTTP status, or 0 when no HTTP answer arrived.
 * {@code sourceStatus} is what the page reports for this call. {@code problemDetail} is the plain {@code detail} of an
 * RFC 9457 refusal (4xx) from the upstream, bounded in length, or null; only sources whose messages are written for
 * people may show it (the scenario controller's are). {@code problemCode} is that refusal's {@code code} when it is a
 * short upper-case identifier, for telling apart refusals that share a status.
 */
public record UpstreamResponse<T>(int status, T body, HttpHeaders headers, SourceStatus sourceStatus, String problemDetail,
    String problemCode) {
    public UpstreamResponse(int status, T body, HttpHeaders headers, SourceStatus sourceStatus) {
        this(status, body, headers, sourceStatus, null, null);
    }

    public UpstreamResponse(int status, T body, HttpHeaders headers, SourceStatus sourceStatus, String problemDetail) {
        this(status, body, headers, sourceStatus, problemDetail, null);
    }

    public boolean ok() {
        return status >= 200 && status < 300 && body != null;
    }

    public boolean notFound() {
        return status == 404;
    }
}
