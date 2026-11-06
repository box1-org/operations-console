package org.box1.console.security;

import java.util.Optional;
import java.util.Set;

import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.box1.console.api.Problem;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.resteasy.reactive.server.ServerRequestFilter;

/**
 * CSRF defence for state-changing console API calls (decision D-003). The session cookie is SameSite=Strict, but
 * every *.box1.org application is same-site, so a state-changing call must also carry {@code X-Box1-Console: 1}
 * (which no cross-origin page can send, because CORS never allows it), a JSON body, and, when the browser sends
 * an Origin, the console's own public origin.
 */
public class ConsoleRequestGuard {
    static final String HEADER = "X-Box1-Console";
    private static final Set<String> SAFE = Set.of("GET", "HEAD", "OPTIONS");

    @ConfigProperty(name = "console.public-origin")
    Optional<String> publicOrigin;

    @ServerRequestFilter(preMatching = true)
    public Optional<Response> guard(ContainerRequestContext request) {
        String path = request.getUriInfo().getPath();
        if (SAFE.contains(request.getMethod()) || !path.startsWith("/api/v1/")) {
            return Optional.empty();
        }
        if (!"1".equals(request.getHeaderString(HEADER))) {
            return reject("State-changing console calls must send X-Box1-Console: 1.", "CONSOLE_HEADER_REQUIRED");
        }
        MediaType type = request.getMediaType();
        if (type == null || !type.isCompatible(MediaType.APPLICATION_JSON_TYPE)) {
            return reject("State-changing console calls must send a JSON body.", "JSON_REQUIRED");
        }
        String origin = request.getHeaderString("Origin");
        if (origin != null && publicOrigin.isPresent() && !publicOrigin.get().equals(origin)) {
            return reject("The request did not come from the console's own origin.", "ORIGIN_MISMATCH");
        }
        return Optional.empty();
    }

    private static Optional<Response> reject(String detail, String code) {
        return Optional.of(Problem.of(403, "Forbidden", detail, code).toResponse());
    }
}
