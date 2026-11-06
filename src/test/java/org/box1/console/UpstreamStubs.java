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
        return Map.of(
            "console.upstream.order-service-url", base + "/order",
            "console.upstream.inventory-service-url", base + "/inventory",
            "console.upstream.fulfillment-adapter-url", base + "/fulfillment",
            "console.upstream.asset-service-url", base + "/asset",
            "console.fulfillment-link", "derived",
            "console.upstream.read-timeout", "800ms",
            "console.upstream.page-budget", "1500ms");
    }

    @Override
    public void stop() {
        if (server != null) {
            server.stop();
        }
    }
}
