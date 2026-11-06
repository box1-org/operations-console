package org.box1.console.security;

import java.util.Optional;

import io.quarkus.security.identity.SecurityIdentity;
import jakarta.enterprise.context.ApplicationScoped;
import org.box1.console.upstream.UpstreamConfig;

/**
 * The signed-in user's access token for reads from asset-service (box1-docs#80). It is forwarded to asset-service
 * only, and only when {@code console.upstream.asset-service-forward-token} is on. The console's Keycloak client adds
 * the audience {@code asset-service} and maps only the {@code telemetry-reader} role, and asset-service keeps only that
 * role for tokens issued to the console, so the person's own reader role decides what they see.
 */
@ApplicationScoped
public class AssetToken {
    private final SecurityIdentity identity;
    private final UpstreamConfig config;

    public AssetToken(SecurityIdentity identity, UpstreamConfig config) {
        this.identity = identity;
        this.config = config;
    }

    /** The bearer token for a read from asset-service, if forwarding is enabled and a session token exists. */
    public Optional<String> forAssetService() {
        return config.assetServiceForwardToken() ? SessionTokens.accessToken(identity) : Optional.empty();
    }
}
