package org.box1.console.security;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Optional;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.enterprise.context.ApplicationScoped;
import org.box1.console.upstream.UpstreamConfig;

/**
 * The signed-in user's access token as agentic-operations sees it (box1-docs#101). It is forwarded to
 * agentic-operations only, and only when {@code console.upstream.agentic-operations-forward-token} is on. Its
 * {@code aiops-*} roles are read so the Assistant can say what the person may do; agentic-operations enforces them.
 */
@ApplicationScoped
public class AiopsToken {
    public static final String VIEWER = "aiops-viewer";
    public static final String ANALYST = "aiops-analyst";

    private final SecurityIdentity identity;
    private final UpstreamConfig config;
    private final ObjectMapper json;

    public AiopsToken(SecurityIdentity identity, UpstreamConfig config, ObjectMapper json) {
        this.identity = identity;
        this.config = config;
        this.json = json;
    }

    /** The bearer token for a call to agentic-operations, if forwarding is enabled and a session token exists. */
    public Optional<String> forService() {
        return config.agenticOperationsForwardToken() ? SessionTokens.accessToken(identity) : Optional.empty();
    }

    /** The person's agentic-operations client roles; read from the session token Quarkus verified at sign-in. */
    public List<String> roles() {
        return forService().map(t -> rolesIn(t, json)).orElse(List.of());
    }

    /** The aiops roles named in a JWT's {@code resource_access.agentic-operations} claim; unreadable means none. */
    public static List<String> rolesIn(String token, ObjectMapper json) {
        String[] parts = token.split("\\.");
        if (parts.length < 2) {
            return List.of();
        }
        try {
            JsonNode claims = json.readTree(new String(Base64.getUrlDecoder().decode(parts[1]), StandardCharsets.UTF_8));
            JsonNode roles = claims.path("resource_access").path("agentic-operations").path("roles");
            List<String> out = new ArrayList<>();
            roles.forEach(r -> {
                if (VIEWER.equals(r.asText()) || ANALYST.equals(r.asText())) {
                    out.add(r.asText());
                }
            });
            return List.copyOf(out);
        } catch (IOException | IllegalArgumentException unreadable) {
            return List.of();
        }
    }
}
