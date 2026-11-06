package org.box1.console;

import static com.github.tomakehurst.wiremock.client.WireMock.absent;
import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.equalTo;
import static com.github.tomakehurst.wiremock.client.WireMock.get;
import static com.github.tomakehurst.wiremock.client.WireMock.getRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathMatching;
import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;

import java.util.Optional;

import io.quarkus.test.junit.QuarkusMock;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.security.TestSecurity;
import org.box1.console.security.AssetToken;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Active alerts on the Sites page (box1-docs#80): the person's token goes to asset-service for that read only, their
 * own telemetry-reader role decides what they see, and a refusal is shown in plain words with no invented alerts.
 */
@QuarkusTest
@TestSecurity(user = "otto", roles = {"console-viewer"})
class AssetAlertsTest {
    private static final String TOKEN = "header.e30.signature";
    private static final String ALERTS = """
        {"items":[{"alertId":"alr_1","assetId":"asset_pump_7","siteId":"site_east","metricName":"temperature","unit":"C",
          "status":"ACTIVE","severity":"CRITICAL","threshold":80.0,"firstValue":81.0,"peakValue":96.5,"lastValue":92.0,
          "readingCount":4,"activatedAt":"2026-11-06T19:00:00Z","escalatedAt":"2026-11-06T19:01:00Z"}],"nextCursor":null}""";

    static class SessionToken extends AssetToken {
        SessionToken() {
            super(null, null);
        }

        @Override
        public Optional<String> forAssetService() {
            return Optional.of(TOKEN);
        }
    }

    @BeforeEach
    void reset() {
        UpstreamStubs.server.resetAll();
        QuarkusMock.installMockForType(new SessionToken(), AssetToken.class);
        UpstreamStubs.server.stubFor(get(urlPathMatching("/inventory/.*")).willReturn(Fixtures.json("[]")));
    }

    @Test
    void aReaderSeesActiveAlertsAndTheTokenGoesToAssetServiceOnly() {
        UpstreamStubs.server.stubFor(get(urlPathEqualTo("/asset/api/v1/alerts")).willReturn(Fixtures.json(ALERTS)));
        given().get("/api/v1/sites").then().statusCode(200)
            .body("alerts", hasSize(1)).body("alerts[0].assetId", is("asset_pump_7")).body("alerts[0].severity", is("CRITICAL"))
            .body("alerts[0].peakValue", is(96.5f))
            .body("sources.find { it.source == 'asset-service' }.status", is("OK"));
        UpstreamStubs.server.verify(getRequestedFor(urlPathEqualTo("/asset/api/v1/alerts"))
            .withQueryParam("status", equalTo("ACTIVE")).withHeader("Authorization", equalTo("Bearer " + TOKEN)));
        UpstreamStubs.server.verify(getRequestedFor(urlPathMatching("/inventory/.*")).withHeader("Authorization", absent()));
    }

    @Test
    void withoutTheReaderRoleThePageSaysSoAndShowsNoAlerts() {
        UpstreamStubs.server.stubFor(get(urlPathEqualTo("/asset/api/v1/alerts")).willReturn(aResponse().withStatus(403)));
        given().get("/api/v1/sites").then().statusCode(200).body("alerts", hasSize(0))
            .body("sources.find { it.source == 'asset-service' }.status", is("NOT_AUTHORIZED"))
            .body("sources.find { it.source == 'asset-service' }.detail", containsString("telemetry-reader"));
    }

    @Test
    void aRefusedTokenIsNotCachedForTheNextPerson() {
        UpstreamStubs.server.stubFor(get(urlPathEqualTo("/asset/api/v1/alerts")).willReturn(aResponse().withStatus(403)));
        given().get("/api/v1/sites").then().statusCode(200).body("alerts", hasSize(0));
        UpstreamStubs.server.stubFor(get(urlPathEqualTo("/asset/api/v1/alerts")).willReturn(Fixtures.json(ALERTS)));
        given().get("/api/v1/sites").then().statusCode(200).body("alerts", hasSize(1));
    }
}
