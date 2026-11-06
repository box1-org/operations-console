package org.box1.console.upstream;

import java.time.Duration;
import java.util.Optional;

import io.smallrye.config.ConfigMapping;
import io.smallrye.config.WithDefault;

/** Upstream base URLs and limits (decision D-007). An empty URL means the source is not configured. */
@ConfigMapping(prefix = "console.upstream")
public interface UpstreamConfig {
    Optional<String> orderServiceUrl();

    Optional<String> inventoryServiceUrl();

    Optional<String> fulfillmentAdapterUrl();

    Optional<String> assetServiceUrl();

    Optional<String> scenarioControllerUrl();

    @WithDefault("1s")
    Duration connectTimeout();

    @WithDefault("2500ms")
    Duration readTimeout();

    @WithDefault("3s")
    Duration pageBudget();

    @WithDefault("8")
    int maxConcurrentPerSource();

    /**
     * Send the signed-in user's access token to the scenario controller, and only to it. The console's Keycloak client
     * adds the audience {@code scenario-controller} and the person's scenario roles for exactly this (box1-docs#19).
     */
    @WithDefault("false")
    boolean scenarioControllerForwardToken();

    /**
     * Send the signed-in user's access token to asset-service, for reads only. The console's Keycloak client adds the
     * audience {@code asset-service} and maps only {@code telemetry-reader}; asset-service accepts the console's tokens
     * with that role alone (box1-docs#80, interim until the client is confidential, box1-docs#79).
     */
    @WithDefault("false")
    boolean assetServiceForwardToken();

    /** Seed, stop and reset wait for the controller's work (a reset waits for its orders to be decided). */
    @WithDefault("45s")
    Duration scenarioActionTimeout();

    default Optional<String> url(Source source) {
        Optional<String> url = switch (source) {
            case ORDER_SERVICE -> orderServiceUrl();
            case INVENTORY_SERVICE -> inventoryServiceUrl();
            case FULFILLMENT_ADAPTER -> fulfillmentAdapterUrl();
            case ASSET_SERVICE -> assetServiceUrl();
            case SCENARIO_CONTROLLER -> scenarioControllerUrl();
        };
        return url.map(String::trim).filter(u -> !u.isEmpty()).map(u -> u.endsWith("/") ? u.substring(0, u.length() - 1) : u);
    }
}
