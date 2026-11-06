package org.box1.console.upstream;

import java.net.http.HttpHeaders;

/**
 * Result of one upstream call. {@code status} is the HTTP status, or 0 when no HTTP answer arrived.
 * {@code sourceStatus} is what the page reports for this call.
 */
public record UpstreamResponse<T>(int status, T body, HttpHeaders headers, SourceStatus sourceStatus) {
    public boolean ok() {
        return status >= 200 && status < 300 && body != null;
    }

    public boolean notFound() {
        return status == 404;
    }
}
