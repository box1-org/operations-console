package org.box1.console.security;

import io.quarkus.security.AuthenticationCompletionException;
import io.quarkus.security.AuthenticationFailedException;
import io.quarkus.security.UnauthorizedException;
import io.vertx.core.http.HttpHeaders;
import io.vertx.ext.web.Router;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Singleton;

/**
 * An unreadable or expired session cookie (for example after a pod restart, when the per-pod session key changed)
 * fails authentication before any challenge is sent, and Quarkus would answer the API with an empty 401. The console
 * API promises 401 Problem JSON, so this handler writes the same body as {@link ApiAwareAuthenticationMechanism}.
 */
@Singleton
public class ApiAuthFailureHandler {

    void install(@Observes Router router) {
        router.route("/api/*").order(Integer.MIN_VALUE).failureHandler(context -> {
            Throwable failure = context.failure();
            boolean authFailure = failure instanceof AuthenticationFailedException
                || failure instanceof AuthenticationCompletionException || failure instanceof UnauthorizedException
                || (failure == null && context.statusCode() == 401);
            if (authFailure && !context.response().ended() && !context.response().headWritten()) {
                context.response().setStatusCode(401)
                    .putHeader(HttpHeaders.CONTENT_TYPE, "application/problem+json")
                    .putHeader(HttpHeaders.CACHE_CONTROL, "no-store")
                    .end(ApiAwareAuthenticationMechanism.UNAUTHORIZED_BODY);
            } else {
                context.next();
            }
        });
    }
}
