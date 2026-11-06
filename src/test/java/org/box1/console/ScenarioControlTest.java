package org.box1.console;

import static com.github.tomakehurst.wiremock.client.WireMock.absent;
import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.anyUrl;
import static com.github.tomakehurst.wiremock.client.WireMock.equalTo;
import static com.github.tomakehurst.wiremock.client.WireMock.equalToJson;
import static com.github.tomakehurst.wiremock.client.WireMock.get;
import static com.github.tomakehurst.wiremock.client.WireMock.getRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.matching;
import static com.github.tomakehurst.wiremock.client.WireMock.post;
import static com.github.tomakehurst.wiremock.client.WireMock.postRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathMatching;
import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.junit.jupiter.api.Assertions.assertEquals;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.tomakehurst.wiremock.http.Fault;
import io.quarkus.test.junit.QuarkusMock;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.security.TestSecurity;
import org.box1.console.security.ScenarioToken;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Demo control through the scenario controller (box1-docs#19): the person's token goes to the controller and nowhere
 * else, the controller's own refusals reach the page in plain words, and nothing is invented when it does not answer.
 */
@QuarkusTest
@TestSecurity(user = "otto", roles = {"console-operator", "console-viewer"})
class ScenarioControlTest {
    private static final String TOKEN = "header." + Base64.getUrlEncoder().withoutPadding().encodeToString(
        "{\"resource_access\":{\"scenario-controller\":{\"roles\":[\"scenario-operator\",\"other\"]}}}"
            .getBytes(StandardCharsets.UTF_8)) + ".signature";
    private static final String RUN_ID = "scn_0123456789abcdef0123";
    private static final String CATALOG = """
        [{"name":"inventory-contention","title":"The Trouble with Tribbles","description":"Two orders race for the last unit",
          "mechanism":"SERVICE_API","availability":"AVAILABLE","defaultDurationSeconds":300,"maxDurationSeconds":900,
          "operatorSteps":[],"prerequisites":["fixtures seeded"]},
         {"name":"red-alert","title":"Red alert","mechanism":"SERVICE_API","availability":"NOT_YET_POSSIBLE",
          "notPossibleReason":"asset-service accepts only its own azp","operatorSteps":[]}]""";
    private static final String RUN = """
        {"scenarioRunId":"%s","scenario":"inventory-contention","title":"The Trouble with Tribbles","status":"RUNNING",
         "operatorStep":null,"actor":"sub-1 (otto)","ttlSeconds":120,"startedAt":"2026-11-06T19:00:00Z",
         "startedStardate":"-296152.1","impact":{"orders":[]},"audit":null}""".formatted(RUN_ID);

    /** Stands in for a signed-in session whose access token the controller accepts. */
    static class SessionToken extends ScenarioToken {
        private final Optional<String> token;

        SessionToken(Optional<String> token) {
            super(null, null, null);
            this.token = token;
        }

        @Override
        public Optional<String> forController() {
            return token;
        }

        @Override
        public List<String> roles() {
            return token.map(t -> rolesIn(t, new ObjectMapper())).orElse(List.of());
        }
    }

    @BeforeEach
    void reset() {
        UpstreamStubs.server.resetAll();
        QuarkusMock.installMockForType(new SessionToken(Optional.of(TOKEN)), ScenarioToken.class);
    }

    private static void scenarioStub(String method, String path, int status, String body) {
        var mapping = "GET".equals(method) ? get(urlPathEqualTo("/scenario" + path)) : post(urlPathEqualTo("/scenario" + path));
        UpstreamStubs.server.stubFor(mapping.willReturn(aResponse().withStatus(status)
            .withHeader("Content-Type", status >= 400 ? "application/problem+json" : "application/json").withBody(body)));
    }

    private static io.restassured.specification.RequestSpecification console() {
        return given().header("X-Box1-Console", "1").contentType("application/json");
    }

    @Test
    void catalogShowsTitlesAndAvailabilityAndCarriesTheSessionTokenToTheControllerOnly() {
        scenarioStub("GET", "/internal/v1/scenarios", 200, CATALOG);
        UpstreamStubs.server.stubFor(get(urlPathMatching("/inventory/.*")).willReturn(Fixtures.json("{\"items\":[]}")));
        // As on the cluster, asset-service refuses the console (its probe is cached, so other tests see the same).
        UpstreamStubs.server.stubFor(get(urlPathEqualTo("/asset/api/v1/alerts")).willReturn(aResponse().withStatus(401)));
        given().get("/api/v1/scenarios").then().statusCode(200)
            .body("items", hasSize(2))
            .body("items[0].name", is("inventory-contention")).body("items[0].title", is("The Trouble with Tribbles"))
            .body("items[0].availability", is("AVAILABLE")).body("items[1].notPossibleReason", containsString("azp"))
            .body("sources[0].status", is("OK"));
        UpstreamStubs.server.verify(getRequestedFor(urlPathEqualTo("/scenario/internal/v1/scenarios"))
            .withHeader("Authorization", equalTo("Bearer " + TOKEN)));
        // Every other upstream keeps the console's rule: no user token (review SEC-1/SEC-3 of #18).
        given().get("/api/v1/sites").then().statusCode(200);
        UpstreamStubs.server.verify(getRequestedFor(urlPathMatching("/inventory/.*")).withHeader("Authorization", absent()));
    }

    @Test
    void meReportsOnlyTheScenarioRolesTheControllerKnows() {
        given().get("/api/v1/me").then().statusCode(200).body("scenarioRoles", is(List.of("scenario-operator")));
    }

    @Test
    void withoutASessionTokenNothingIsForwardedAndTheRefusalIsExplained() {
        QuarkusMock.installMockForType(new SessionToken(Optional.empty()), ScenarioToken.class);
        scenarioStub("GET", "/internal/v1/runs", 401, "{\"title\":\"Unauthorized\",\"status\":401}");
        given().get("/api/v1/scenario-runs").then().statusCode(200).body("items", hasSize(0))
            .body("sources[0].status", is("NOT_AUTHORIZED")).body("sources[0].detail", containsString("scenario-viewer"));
        UpstreamStubs.server.verify(getRequestedFor(urlPathEqualTo("/scenario/internal/v1/runs")).withHeader("Authorization", absent()));
        given().get("/api/v1/me").then().statusCode(200).body("scenarioRoles", hasSize(0));
    }

    @Test
    void startSendsTheTtlWithTheTokenAndACorrelationIdAndReturnsTheRun() {
        scenarioStub("POST", "/internal/v1/scenarios/inventory-contention/start", 202, RUN);
        console().body(Map.of("ttlSeconds", 120)).post("/api/v1/scenarios/inventory-contention/start").then().statusCode(202)
            .body("scenarioRunId", is(RUN_ID)).body("status", is("RUNNING")).body("title", is("The Trouble with Tribbles"));
        UpstreamStubs.server.verify(postRequestedFor(urlPathEqualTo("/scenario/internal/v1/scenarios/inventory-contention/start"))
            .withHeader("Authorization", equalTo("Bearer " + TOKEN))
            .withHeader("X-Correlation-Id", matching("[0-9a-f-]{36}"))
            .withHeader("traceparent", matching("00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}"))
            .withRequestBody(equalToJson("{\"ttlSeconds\":120}")));
    }

    @Test
    void startWithoutATtlLetsTheControllerChoose() {
        scenarioStub("POST", "/internal/v1/scenarios/inventory-contention/start", 202, RUN);
        console().body("{}").post("/api/v1/scenarios/inventory-contention/start").then().statusCode(202);
        UpstreamStubs.server.verify(postRequestedFor(urlPathEqualTo("/scenario/internal/v1/scenarios/inventory-contention/start"))
            .withRequestBody(equalToJson("{}")));
    }

    @Test
    void theControllersOwnRefusalsReachThePageInPlainWords() {
        scenarioStub("POST", "/internal/v1/scenarios/inventory-contention/start", 409,
            "{\"title\":\"Conflict\",\"status\":409,\"detail\":\"Another scenario run is active: scn_aaaaaaaaaaaaaaaaaaaa\"}");
        console().body("{}").post("/api/v1/scenarios/inventory-contention/start").then().statusCode(409)
            .body("code", is("SCENARIO_CONFLICT")).body("detail", containsString("Another scenario run is active"))
            .body("source", is("scenario-controller"));
        scenarioStub("POST", "/internal/v1/scenarios/inventory-contention/start", 403,
            "{\"title\":\"Forbidden\",\"status\":403,\"detail\":\"This operation needs a scenario-controller role\"}");
        console().body("{}").post("/api/v1/scenarios/inventory-contention/start").then().statusCode(403)
            .body("code", is("SCENARIO_ROLE_REQUIRED")).body("detail", containsString("scenario-operator"));
        scenarioStub("POST", "/internal/v1/scenarios/red-alert/start", 404, "{\"title\":\"Not Found\",\"status\":404}");
        console().body("{}").post("/api/v1/scenarios/red-alert/start").then().statusCode(404).body("code", is("NOT_FOUND"));
    }

    @Test
    void anUnreachableControllerMeansTheOutcomeIsUnknownNeverAGuess() {
        UpstreamStubs.server.stubFor(post(anyUrl()).willReturn(aResponse().withFault(Fault.CONNECTION_RESET_BY_PEER)));
        console().body("{}").post("/api/v1/scenarios/inventory-contention/stop").then().statusCode(503)
            .body("code", is("UPSTREAM_UNAVAILABLE")).body("detail", containsString("Check the run list"));
    }

    @Test
    void namesRunIdsStepsAndTtlsAreValidatedBeforeAnyCall() {
        console().body("{}").post("/api/v1/scenarios/Not_A_Name/start").then().statusCode(400);
        console().body(Map.of("ttlSeconds", 5)).post("/api/v1/scenarios/inventory-contention/start").then().statusCode(400);
        console().body(Map.of("step", "crash armed")).post("/api/v1/scenario-runs/" + RUN_ID + "/confirm").then().statusCode(400);
        console().body(Map.of("step", "crash-armed")).post("/api/v1/scenario-runs/scn_short/confirm").then().statusCode(400);
        assertEquals(0, UpstreamStubs.server.getAllServeEvents().size(), "nothing reached the controller");
    }

    @Test
    @TestSecurity(user = "vera", roles = "console-viewer")
    void aViewerReadsButCannotAct() {
        scenarioStub("GET", "/internal/v1/scenarios", 200, CATALOG);
        given().get("/api/v1/scenarios").then().statusCode(200).body("items", hasSize(2));
        for (String path : List.of("/api/v1/scenarios/inventory-contention/start", "/api/v1/scenarios/inventory-contention/stop",
            "/api/v1/scenarios/inventory-contention/reset", "/api/v1/scenario-fixtures/seed")) {
            console().body("{}").post(path).then().statusCode(403).body("code", is("ROLE_REQUIRED"));
        }
        UpstreamStubs.server.verify(0, postRequestedFor(anyUrl()));
    }

    @Test
    void stopResetSeedAndConfirmPassThroughAndMap() {
        scenarioStub("POST", "/internal/v1/scenarios/inventory-contention/stop", 200, RUN.replace("RUNNING", "STOPPED"));
        console().body("{}").post("/api/v1/scenarios/inventory-contention/stop").then().statusCode(200).body("status", is("STOPPED"));
        scenarioStub("POST", "/internal/v1/scenarios/inventory-contention/reset", 200,
            "{\"resetId\":\"stardock-reset-1\",\"resetResult\":\"RESTORED\",\"resetDetail\":\"2 units restocked\"}");
        console().body("{}").post("/api/v1/scenarios/inventory-contention/reset").then().statusCode(200)
            .body("resetResult", is("RESTORED")).body("resetDetail", is("2 units restocked"));
        scenarioStub("POST", "/internal/v1/fixtures/seed", 200, "{\"created\":26,\"unchanged\":0}");
        console().body("{}").post("/api/v1/scenario-fixtures/seed").then().statusCode(200)
            .body("created", is(26)).body("unchanged", is(0));
        scenarioStub("POST", "/internal/v1/runs/" + RUN_ID + "/confirm", 200, RUN.replace("RUNNING", "AWAITING_OPERATOR"));
        console().body(Map.of("step", "crash-armed")).post("/api/v1/scenario-runs/" + RUN_ID + "/confirm").then().statusCode(200)
            .body("status", is("AWAITING_OPERATOR"));
        UpstreamStubs.server.verify(postRequestedFor(urlPathEqualTo("/scenario/internal/v1/runs/" + RUN_ID + "/confirm"))
            .withRequestBody(equalToJson("{\"step\":\"crash-armed\"}")).withHeader("Authorization", equalTo("Bearer " + TOKEN)));
    }

    @Test
    void runsAuditAndFixturesAreReadWithTheirSources() {
        scenarioStub("GET", "/internal/v1/runs", 200, "[" + RUN + "]");
        given().get("/api/v1/scenario-runs").then().statusCode(200).body("items[0].scenarioRunId", is(RUN_ID))
            .body("sources[0].status", is("OK"));
        UpstreamStubs.server.verify(getRequestedFor(urlPathEqualTo("/scenario/internal/v1/runs")).withQueryParam("limit", equalTo("20")));
        scenarioStub("GET", "/internal/v1/runs/" + RUN_ID, 200, RUN.replace("\"audit\":null",
            "\"audit\":[{\"seq\":7,\"action\":\"START\",\"outcome\":\"ACCEPTED\",\"actor\":\"sub-1 (otto)\"}]"));
        given().get("/api/v1/scenario-runs/" + RUN_ID).then().statusCode(200).body("audit[0].action", is("START"))
            .body("startedStardate", is("-296152.1"));
        scenarioStub("GET", "/internal/v1/audit", 200,
            "[{\"seq\":7,\"scenarioRunId\":\"" + RUN_ID + "\",\"action\":\"START\",\"outcome\":\"ACCEPTED\",\"actor\":\"sub-1 (otto)\"}]");
        given().get("/api/v1/scenario-audit").then().statusCode(200).body("items[0].actor", is("sub-1 (otto)"));
        scenarioStub("GET", "/internal/v1/fixtures", 200, """
            {"sites":[{"siteId":"site_ds9","displayName":"Deep Space Nine","status":"ACTIVE"}],
             "customers":[{"customerId":"cust_picard","displayName":"Captain Picard"}],
             "products":[{"sku":"CAT-TRIBBLE-PLUSH","displayName":"Tribble plush"}],
             "stock":[{"siteId":"site_ds9","sku":"CAT-TRIBBLE-PLUSH","openingQuantity":1}],"assets":[]}""");
        given().get("/api/v1/scenario-fixtures").then().statusCode(200).body("sites[0].siteId", is("site_ds9"))
            .body("stock[0].openingQuantity", is(1)).body("customers[0].customerId", is("cust_picard"));
        scenarioStub("GET", "/internal/v1/runs/" + RUN_ID, 404, "{\"title\":\"Not Found\",\"status\":404}");
        given().get("/api/v1/scenario-runs/" + RUN_ID).then().statusCode(404).body("code", is("NOT_FOUND"));
    }

    @Test
    void rolesAreReadFromTheControllersClaimOnlyAndUnreadableTokensHaveNone() {
        ObjectMapper json = new ObjectMapper();
        assertEquals(List.of("scenario-operator"), ScenarioToken.rolesIn(TOKEN, json));
        String elsewhere = "h." + Base64.getUrlEncoder().withoutPadding().encodeToString(
            "{\"resource_access\":{\"operations-console\":{\"roles\":[\"scenario-operator\"]}}}".getBytes(StandardCharsets.UTF_8)) + ".s";
        assertEquals(List.of(), ScenarioToken.rolesIn(elsewhere, json));
        assertEquals(List.of(), ScenarioToken.rolesIn("not-a-jwt", json));
        assertEquals(List.of(), ScenarioToken.rolesIn("a.!!!.c", json));
        given().get("/api/v1/me").then().body("scenarioRoles", is(List.of("scenario-operator")));
    }
}
