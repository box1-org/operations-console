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
 * The signed-in user's access token as the scenario controller sees it (box1-docs#19). The token is forwarded to the
 * controller only, never to any other upstream, and only when {@code console.upstream.scenario-controller-forward-token}
 * is on. Its scenario roles are read so the pages can hide actions the controller would refuse; the controller still
 * enforces them.
 */
@ApplicationScoped
public class ScenarioToken {
    public static final String VIEWER = "scenario-viewer";
    public static final String OPERATOR = "scenario-operator";

    private final SecurityIdentity identity;
    private final UpstreamConfig config;
    private final ObjectMapper json;

    public ScenarioToken(SecurityIdentity identity, UpstreamConfig config, ObjectMapper json) {
        this.identity = identity;
        this.config = config;
        this.json = json;
    }

    /** The bearer token for a call to the scenario controller, if forwarding is enabled and a session token exists. */
    public Optional<String> forController() {
        return config.scenarioControllerForwardToken() ? SessionTokens.accessToken(identity) : Optional.empty();
    }

    /**
     * The scenario-controller client roles in the session's access token. Quarkus verified this token at sign-in
     * (roles come from the access token); this only reads a claim from it, so no signature check is repeated here.
     */
    public List<String> roles() {
        return forController().map(t -> rolesIn(t, json)).orElse(List.of());
    }

    /** The scenario-controller client roles named in a JWT's {@code resource_access} claim; unreadable means none. */
    public static List<String> rolesIn(String token, ObjectMapper json) {
        String[] parts = token.split("\\.");
        if (parts.length < 2) {
            return List.of();
        }
        try {
            JsonNode claims = json.readTree(new String(Base64.getUrlDecoder().decode(parts[1]), StandardCharsets.UTF_8));
            JsonNode roles = claims.path("resource_access").path("scenario-controller").path("roles");
            List<String> out = new ArrayList<>();
            roles.forEach(r -> {
                if (VIEWER.equals(r.asText()) || OPERATOR.equals(r.asText())) {
                    out.add(r.asText());
                }
            });
            return List.copyOf(out);
        } catch (IOException | IllegalArgumentException unreadable) {
            return List.of();
        }
    }
}
