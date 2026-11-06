package org.box1.console.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.ws.rs.core.Response;

/** RFC 9457 problem details with a stable {@code code}; never carries upstream bodies, tokens or stack traces. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record Problem(String type, String title, int status, String detail, String code, String source) {
    public static final String MEDIA_TYPE = "application/problem+json";

    public static Problem of(int status, String title, String detail, String code) {
        return new Problem("about:blank", title, status, detail, code, null);
    }

    public static Problem upstream(int status, String title, String detail, String code, String source) {
        return new Problem("about:blank", title, status, detail, code, source);
    }

    public Response toResponse() {
        return Response.status(status).type(MEDIA_TYPE).entity(this).build();
    }

    /** Thrown inside resources to end a request with this problem. */
    public static final class Failure extends RuntimeException {
        private static final long serialVersionUID = 1L;
        private final transient Problem problem;

        public Failure(Problem problem) {
            super(problem.code(), null, false, false);
            this.problem = problem;
        }

        public Problem problem() {
            return problem;
        }
    }
}
