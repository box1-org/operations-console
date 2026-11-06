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
