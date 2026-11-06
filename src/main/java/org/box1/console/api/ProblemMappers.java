package org.box1.console.api;

import io.quarkus.security.ForbiddenException;
import io.quarkus.security.UnauthorizedException;
import jakarta.validation.ConstraintViolationException;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.core.Response;
import org.jboss.resteasy.reactive.server.ServerExceptionMapper;

/** Every console API error is Problem JSON with a stable code (typed errors for the generated client). */
public class ProblemMappers {

    @ServerExceptionMapper
    public Response failure(Problem.Failure failure) {
        return failure.problem().toResponse();
    }

    @ServerExceptionMapper
    public Response forbidden(ForbiddenException ignored) {
        return Problem.of(403, "Forbidden", "Your console roles do not allow this.", "ROLE_REQUIRED").toResponse();
    }

    @ServerExceptionMapper
    public Response unauthorized(UnauthorizedException ignored) {
        return Problem.of(401, "Sign-in required", "No console session. Open the console to sign in.", "SESSION_REQUIRED")
            .toResponse();
    }

    @ServerExceptionMapper
    public Response invalid(ConstraintViolationException error) {
        StringBuilder detail = new StringBuilder();
        error.getConstraintViolations().forEach(v -> {
            if (!detail.isEmpty()) {
                detail.append("; ");
            }
            String path = v.getPropertyPath().toString();
            detail.append(path.substring(path.lastIndexOf('.') + 1)).append(' ').append(v.getMessage());
        });
        return Problem.of(400, "Invalid request", detail.toString(), "INVALID_REQUEST").toResponse();
    }

    @ServerExceptionMapper
    public Response notFound(NotFoundException ignored) {
        return Problem.of(404, "Not found", "No such console resource.", "NOT_FOUND").toResponse();
    }
}
