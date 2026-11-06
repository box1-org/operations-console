package org.box1.console.security;

import java.util.Set;

import io.quarkus.oidc.runtime.OidcAuthenticationMechanism;
import io.quarkus.security.identity.IdentityProviderManager;
import io.quarkus.security.identity.SecurityIdentity;
import io.quarkus.security.identity.request.AuthenticationRequest;
import io.quarkus.vertx.http.runtime.security.ChallengeData;
import io.quarkus.vertx.http.runtime.security.HttpAuthenticationMechanism;
import io.quarkus.vertx.http.runtime.security.HttpCredentialTransport;
import io.smallrye.mutiny.Uni;
import io.vertx.core.http.HttpHeaders;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

/**
 * The Keycloak code flow, except that console API calls without a session get 401 Problem JSON instead of a
 * redirect to Keycloak (the prompt requires 401 for anonymous console API calls). Page navigations still redirect.
 * It ranks above the OIDC mechanism, so its challenge is the one sent; it is a plain bean (not an alternative) so the
 * platform's other mechanisms keep working.
 */
@ApplicationScoped
public class ApiAwareAuthenticationMechanism implements HttpAuthenticationMechanism {
    static final String UNAUTHORIZED_BODY = "{\"type\":\"about:blank\",\"title\":\"Sign-in required\",\"status\":401,"
        + "\"detail\":\"No console session. Open the console to sign in.\",\"code\":\"SESSION_REQUIRED\"}";

    @Inject
    OidcAuthenticationMechanism delegate;

    static boolean isApi(RoutingContext context) {
        return context.normalizedPath().startsWith("/api/");
    }

    @Override
    public Uni<SecurityIdentity> authenticate(RoutingContext context, IdentityProviderManager identityProviderManager) {
        return delegate.authenticate(context, identityProviderManager);
    }

    @Override
    public Uni<ChallengeData> getChallenge(RoutingContext context) {
        if (isApi(context)) {
            return Uni.createFrom().item(new ChallengeData(401, null, null));
        }
        return delegate.getChallenge(context);
    }

    @Override
    public Uni<Boolean> sendChallenge(RoutingContext context) {
        if (isApi(context)) {
            context.response().setStatusCode(401)
                .putHeader(HttpHeaders.CONTENT_TYPE, "application/problem+json")
                .putHeader(HttpHeaders.CACHE_CONTROL, "no-store")
                .end(UNAUTHORIZED_BODY);
            return Uni.createFrom().item(Boolean.TRUE);
        }
        return delegate.sendChallenge(context);
    }

    @Override
    public int getPriority() {
        return delegate.getPriority() + 10;
    }

    @Override
    public Set<Class<? extends AuthenticationRequest>> getCredentialTypes() {
        return delegate.getCredentialTypes();
    }

    @Override
    public Uni<HttpCredentialTransport> getCredentialTransport(RoutingContext context) {
        return delegate.getCredentialTransport(context);
    }
}
