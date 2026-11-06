package org.box1.console.security;

import java.util.Optional;

import io.quarkus.oidc.AccessTokenCredential;
import io.quarkus.security.identity.SecurityIdentity;

/** The signed-in user's access token, held server-side in the encrypted session; it never leaves the backend. */
public final class SessionTokens {
    private SessionTokens() {
    }

    public static Optional<String> accessToken(SecurityIdentity identity) {
        AccessTokenCredential credential = identity.getCredential(AccessTokenCredential.class);
        return credential == null ? Optional.empty() : Optional.ofNullable(credential.getToken());
    }
}
