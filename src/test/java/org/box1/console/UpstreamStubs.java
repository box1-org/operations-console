package org.box1.console;

import java.util.Map;

import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.core.WireMockConfiguration;
import io.quarkus.test.common.QuarkusTestResourceLifecycleManager;

/** One WireMock server stands in for every upstream, each under its own path prefix. */
public class UpstreamStubs implements QuarkusTestResourceLifecycleManager {
    static WireMockServer server;

    @Override
    public Map<String, String> start() {
        server = new WireMockServer(WireMockConfiguration.options().dynamicPort());
        server.start();
        String base = "http://localhost:" + server.port();
        return Map.ofEntries(
            Map.entry("console.upstream.order-service-url", base + "/order"),
            Map.entry("console.upstream.inventory-service-url", base + "/inventory"),
            Map.entry("console.upstream.fulfillment-adapter-url", base + "/fulfillment"),
            Map.entry("console.upstream.asset-service-url", base + "/asset"),
            Map.entry("console.upstream.scenario-controller-url", base + "/scenario"),
            Map.entry("console.upstream.scenario-controller-forward-token", "true"),
            Map.entry("console.upstream.agentic-operations-url", base + "/aiops"),
            Map.entry("console.upstream.agentic-operations-forward-token", "true"),
            Map.entry("console.fulfillment-link", "derived"),
            Map.entry("console.upstream.read-timeout", "800ms"),
            Map.entry("console.upstream.page-budget", "1500ms"),
            Map.entry("console.upstream.scenario-action-timeout", "2s"));
    }

    @Override
    public void stop() {
        if (server != null) {
            server.stop();
        }
    }
}
