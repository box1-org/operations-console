package org.box1.console;

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
import static org.hamcrest.Matchers.nullValue;

import java.util.List;
import java.util.Optional;

import io.quarkus.test.junit.QuarkusMock;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.security.TestSecurity;
import org.box1.console.security.AssetToken;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Edge site status on the Sites page (box1-docs#130): asset-service's GET /api/v1/sites is merged with inventory stock
 * and active alerts, so a site appears without stock rows, and an asset-service without site status (down, 404 or a
 * refused path) still leaves the inventory sites on the page with their status marked unavailable.
 */
@QuarkusTest
@TestSecurity(user = "otto", roles = {"console-viewer"})
class SiteStatusTest {
    private static final String TOKEN = "header.e30.signature";
    private static final String DIGEST = "sha256:a11d6786b9a86378148ae55194acfd1cfb2d150ad298334fe00798d026abe3fe";
    private static final String SITES = """
        {"items":[
         {"siteId":"site_ds9","state":"ONLINE","stateReasons":[],"lastSeenAt":"2026-11-10T12:00:00.120Z","lastSeenAgeSeconds":6,
          "lastReadingAt":"2026-11-10T12:00:01Z","reportedAt":"2026-11-10T12:00:00Z","bufferDepth":3,"siteEventBacklog":1,
          "bufferOldestAgeSeconds":4,"readingsDropped":0,"bootedImageDigest":"%1$s","stagedImageDigest":null,
          "rollbackImageDigest":null,"greenbootStatus":"GREEN","bundleDigest":null,"appVersions":{"ops":"1.0.0","gateway":"1.0.0"},
          "futureField":"ignored"},
         {"siteId":"site_spacedock","state":"OFFLINE","stateReasons":["HEARTBEAT_STALE"],"lastSeenAt":"2026-11-10T11:50:00Z",
          "lastSeenAgeSeconds":606,"lastReadingAt":null,"reportedAt":"2026-11-10T11:50:00Z","bufferDepth":250,"siteEventBacklog":7,
          "bufferOldestAgeSeconds":400,"readingsDropped":2,"bootedImageDigest":"%1$s","stagedImageDigest":null,
          "rollbackImageDigest":null,"greenbootStatus":"UNKNOWN","bundleDigest":null,"appVersions":{}}]}""".formatted(DIGEST);
    private static final String ALERT_AT_SPACEDOCK = """
        {"items":[{"alertId":"alr_1","assetId":"asset_pump_7","siteId":"site_spacedock","metricName":"temperature","unit":"C",
          "status":"ACTIVE","severity":"CRITICAL","threshold":80.0,"peakValue":96.5,"lastValue":92.0,
          "activatedAt":"2026-11-10T11:00:00Z","escalatedAt":null}],"nextCursor":null}""";
    private static final String NO_ALERTS = "{\"items\":[],\"nextCursor\":null}";

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
    }

    private static void inventory(String body) {
        UpstreamStubs.server.stubFor(get(urlPathEqualTo("/inventory/api/v1/inventory")).willReturn(Fixtures.json(body)));
    }

    private static void alerts(String body) {
        UpstreamStubs.server.stubFor(get(urlPathEqualTo("/asset/api/v1/alerts")).willReturn(Fixtures.json(body)));
    }

    private static void sites(String body) {
        UpstreamStubs.server.stubFor(get(urlPathEqualTo("/asset/api/v1/sites")).willReturn(Fixtures.json(body)));
    }

    private static String stockAt(String... siteIds) {
        StringBuilder rows = new StringBuilder("[");
        for (String id : siteIds) {
            rows.append(rows.length() > 1 ? "," : "").append("{\"siteId\":\"").append(id)
                .append("\",\"sku\":\"SKU-42\",\"onHand\":10,\"reserved\":2,\"available\":8,\"updatedAt\":\"2026-11-10T11:00:00Z\"}");
        }
        return rows.append("]").toString();
    }

    @Test
    void sitesReportedOnlyByAssetServiceAppearWithoutStock() {
        inventory("[]");
        alerts(NO_ALERTS);
        sites(SITES);
        given().get("/api/v1/sites").then().statusCode(200)
            .body("items", hasSize(2))
            .body("items[0].siteId", is("site_ds9")).body("items[0].stock", hasSize(0))
            .body("items[0].status.state", is("ONLINE")).body("items[0].status.stateReasons", hasSize(0))
            .body("items[0].status.lastSeenAt", is("2026-11-10T12:00:00.120Z")).body("items[0].status.lastSeenAgeSeconds", is(6))
            .body("items[0].status.bufferDepth", is(3)).body("items[0].status.siteEventBacklog", is(1))
            .body("items[0].status.bootedImageDigest", is(DIGEST)).body("items[0].status.greenbootStatus", is("GREEN"))
            .body("items[0].status.appVersions.ops", is("1.0.0"))
            .body("items[0].activeAlerts", is(0))
            .body("items[0].location.x", is(22.0f)).body("items[0].location.region", is("West (site-west)"))
            .body("items[1].siteId", is("site_spacedock")).body("items[1].status.state", is("OFFLINE"))
            .body("items[1].status.stateReasons", is(List.of("HEARTBEAT_STALE")))
            .body("items[1].location.x", is(78.0f)).body("items[1].location.region", is("East (site-east)"))
            .body("siteStatusSource.source", is("asset-service")).body("siteStatusSource.status", is("OK"));
        // The person's token goes to asset-service for the site status read, as for alerts (box1-docs#80).
        UpstreamStubs.server.verify(getRequestedFor(urlPathEqualTo("/asset/api/v1/sites"))
            .withHeader("Authorization", equalTo("Bearer " + TOKEN)));
    }

    @Test
    void inventoryOnlySitesHaveNoStatusWhenTheyNeverReported() {
        inventory(stockAt("site_nyc"));
        alerts(NO_ALERTS);
        sites("{\"items\":[]}");
        given().get("/api/v1/sites").then().statusCode(200)
            .body("items", hasSize(1)).body("items[0].siteId", is("site_nyc")).body("items[0].stock", hasSize(1))
            .body("items[0].status", nullValue()).body("items[0].activeAlerts", is(0)).body("items[0].location", nullValue())
            .body("siteStatusSource.status", is("OK"));
    }

    @Test
    void bothSourcesMergeByIdInInventoryOrderThenTheRest() {
        inventory(stockAt("site_nyc", "site_ds9"));
        alerts(ALERT_AT_SPACEDOCK);
        sites(SITES);
        given().get("/api/v1/sites").then().statusCode(200)
            .body("items.siteId", is(List.of("site_nyc", "site_ds9", "site_spacedock")))
            .body("items[0].status", nullValue())
            .body("items[1].stock", hasSize(1)).body("items[1].status.state", is("ONLINE")).body("items[1].activeAlerts", is(0))
            .body("items[2].stock", hasSize(0)).body("items[2].status.state", is("OFFLINE")).body("items[2].activeAlerts", is(1))
            .body("alerts", hasSize(1))
            .body("sources.find { it.source == 'inventory-service' }.status", is("OK"))
            .body("sources.find { it.source == 'asset-service' }.status", is("OK"));
    }

    @Test
    void assetServiceDownLeavesInventorySitesWithStatusUnavailable() {
        inventory(stockAt("site_ds9"));
        // No answer within the read timeout. (A reset connection is not used here: every stub shares one WireMock
        // host, so a reset can reach the inventory call's pooled connection too, which a real cluster never does.)
        UpstreamStubs.server.stubFor(get(urlPathMatching("/asset/.*")).willReturn(Fixtures.json("{}").withFixedDelay(2000)));
        given().get("/api/v1/sites").then().statusCode(200)
            .body("items", hasSize(1)).body("items[0].siteId", is("site_ds9")).body("items[0].stock", hasSize(1))
            .body("items[0].status", nullValue()).body("items[0].activeAlerts", nullValue())
            .body("items[0].location.region", is("West (site-west)"))
            .body("siteStatusSource.status", is("UNAVAILABLE"))
            .body("sources.find { it.source == 'asset-service' }.status", is("UNAVAILABLE"));
    }

    @Test
    void anAssetServiceWithoutSiteStatusAnswers404AndAlertsStillShow() {
        inventory(stockAt("site_ds9"));
        alerts(ALERT_AT_SPACEDOCK);
        UpstreamStubs.server.stubFor(get(urlPathEqualTo("/asset/api/v1/sites")).willReturn(aResponse().withStatus(404)));
        given().get("/api/v1/sites").then().statusCode(200)
            .body("items.siteId", is(List.of("site_ds9", "site_spacedock")))
            .body("items[0].status", nullValue()).body("items[1].activeAlerts", is(1))
            .body("siteStatusSource.status", is("UNAVAILABLE"))
            .body("siteStatusSource.detail", containsString("HTTP 404"))
            .body("sources.find { it.source == 'asset-service' }.status", is("OK"));
    }

    @Test
    void anOlderAssetServiceThatRefusesThePathIsNotBlamedOnTheReaderRole() {
        // asset-service denies paths it does not list, so before site status it answers 403 even to a reader.
        inventory(stockAt("site_ds9"));
        alerts(NO_ALERTS);
        UpstreamStubs.server.stubFor(get(urlPathEqualTo("/asset/api/v1/sites")).willReturn(aResponse().withStatus(403)));
        given().get("/api/v1/sites").then().statusCode(200)
            .body("items", hasSize(1)).body("items[0].status", nullValue())
            .body("siteStatusSource.status", is("NOT_AUTHORIZED"))
            .body("siteStatusSource.detail", containsString("may not serve site status yet"));
    }

    @Test
    void unknownStatesAreShownAsUnknownAndMalformedSiteIdsAreDropped() {
        inventory("[]");
        alerts(NO_ALERTS);
        sites("""
            {"items":[{"siteId":"site_ds9","state":"MAINTENANCE","stateReasons":["NEW_REASON"],"lastSeenAt":"2026-11-10T12:00:00Z",
              "lastSeenAgeSeconds":1,"reportedAt":"2026-11-10T12:00:00Z","bufferDepth":0,"siteEventBacklog":0,
              "bufferOldestAgeSeconds":0,"readingsDropped":0,"greenbootStatus":"GREEN","appVersions":{}},
             {"siteId":"<script>","state":"ONLINE","stateReasons":[],"appVersions":{}}]}""");
        given().get("/api/v1/sites").then().statusCode(200)
            .body("items", hasSize(1)).body("items[0].status.state", is("UNKNOWN"))
            .body("items[0].status.stateReasons", is(List.of("NEW_REASON")));
    }
}
