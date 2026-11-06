package org.box1.console;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.equalTo;
import static com.github.tomakehurst.wiremock.client.WireMock.equalToJson;
import static com.github.tomakehurst.wiremock.client.WireMock.get;
import static com.github.tomakehurst.wiremock.client.WireMock.matching;
import static com.github.tomakehurst.wiremock.client.WireMock.post;
import static com.github.tomakehurst.wiremock.client.WireMock.postRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.lessThan;
import static org.hamcrest.Matchers.nullValue;
import static org.hamcrest.Matchers.containsString;

import java.time.Instant;
import java.util.Map;

import com.github.tomakehurst.wiremock.http.Fault;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.security.TestSecurity;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Partial pages, ERP progress and pass-through behaviour against stubbed upstreams (decisions D-007, D-008). */
@QuarkusTest
@TestSecurity(user = "otto", roles = {"console-operator", "console-viewer", "console-developer"})
class UpstreamBehaviourTest {
    private static final String RECENT = "2026-11-05T10:00:05Z";

    @BeforeEach
    void reset() {
        UpstreamStubs.server.resetAll();
    }

    private static void adapter(String id, String dispatch, String ack, String outcome) {
        UpstreamStubs.server.stubFor(get(urlPathEqualTo("/fulfillment/api/fulfillments/ful_" + id))
            .willReturn(Fixtures.json(Fixtures.fulfillment(id, dispatch, ack, outcome))));
    }

    @Test
    void heldRequestShowsAsHeldNotFailedAlongsideTheOrderState() {
        Fixtures.stubOrder(UpstreamStubs.server, "ord_h1", "FULFILLMENT_REQUESTED", RECENT);
        adapter("h1", "UPLOADED", "ACKNOWLEDGED", "HELD");
        given().get("/api/v1/orders/ord_h1/summary").then().statusCode(200)
            .body("order.stateLabel", is("Awaiting ERP acknowledgement"))
            .body("erp.stage", is("HELD")).body("erp.label", is("Held by an ERP operator")).body("erp.tone", is("waiting"))
            .body("erp.linkMode", is("derived")).body("erp.fulfillmentRequestId", is("ful_h1"))
            .body("reservation.status", is("CONSUMED"))
            .body("timeline", hasSize(2)).body("timeline[1].description", is("Submitted → Stock reserved (after inventory.reserved.v1)."))
            .body("timeline[0].traceId", is("0af7651916cd43dd8448eb211c80319c"))
            .body("evidence.find { it.kind == 'source-revision' }.href",
                is("https://github.com/box1-org/order-service/commit/8fda08763e2a593d67cabea73fb84e762cb41a21"))
            .body("evidence.find { it.kind == 'trace' }.available", is(false))
            .body("sources.find { it.source == 'fulfillment-adapter' }.status", is("OK"));
    }

    @Test
    void adapterDownShowsErpDetailUnavailableNeverAGuess() {
        Fixtures.stubOrder(UpstreamStubs.server, "ord_d1", "FULFILLMENT_REQUESTED", RECENT);
        UpstreamStubs.server.stubFor(get(urlPathEqualTo("/fulfillment/api/fulfillments/ful_d1"))
            .willReturn(aResponse().withFault(Fault.CONNECTION_RESET_BY_PEER)));
        given().get("/api/v1/orders/ord_d1/summary").then().statusCode(200)
            .body("order.state", is("FULFILLMENT_REQUESTED")).body("order.stateLabel", is("Awaiting ERP acknowledgement"))
            .body("erp.stage", is("UNAVAILABLE")).body("erp.label", is("ERP detail unavailable"))
            .body("erp.outcome", nullValue()).body("erp.dispatch", nullValue())
            .body("sources.find { it.source == 'fulfillment-adapter' }.status", is("UNAVAILABLE"));
    }

    @Test
    void adapterSlowGivesBoundedPartialPage() {
        Fixtures.stubOrder(UpstreamStubs.server, "ord_s1", "FULFILLMENT_REQUESTED", RECENT);
        UpstreamStubs.server.stubFor(get(urlPathEqualTo("/fulfillment/api/fulfillments/ful_s1"))
            .willReturn(Fixtures.json(Fixtures.fulfillment("s1", "UPLOADED", "ACKNOWLEDGED", "SHIPPED")).withFixedDelay(5000)));
        long start = System.nanoTime();
        given().get("/api/v1/orders/ord_s1/summary").then().statusCode(200)
            .body("erp.label", is("ERP detail unavailable")).body("erp.outcome", nullValue())
            .body("sources.find { it.source == 'fulfillment-adapter' }.detail", containsString("No answer within"));
        org.junit.jupiter.api.Assertions.assertTrue((System.nanoTime() - start) / 1_000_000 < 2500, "bounded by the page budget");
    }

    @Test
    void notYetReceivedByAdapterIsWaiting() {
        Fixtures.stubOrder(UpstreamStubs.server, "ord_n1", "FULFILLMENT_REQUESTED", RECENT);
        UpstreamStubs.server.stubFor(get(urlPathEqualTo("/fulfillment/api/fulfillments/ful_n1")).willReturn(aResponse().withStatus(404)));
        given().get("/api/v1/orders/ord_n1/summary").then().statusCode(200).body("erp.stage", is("NOT_RECEIVED"))
            .body("erp.tone", is("waiting"));
    }

    @Test
    void inventoryDownStillShowsOrderWithNamedFailedSource() {
        Fixtures.stubOrder(UpstreamStubs.server, "ord_i1", "SHIPPED", RECENT);
        adapter("i1", "UPLOADED", "ACKNOWLEDGED", "SHIPPED");
        UpstreamStubs.server.stubFor(get(urlPathEqualTo("/inventory/api/v1/reservations/res_i1")).willReturn(aResponse().withStatus(503)));
        given().get("/api/v1/orders/ord_i1/summary").then().statusCode(200)
            .body("order.state", is("SHIPPED")).body("reservation", nullValue()).body("erp.stage", is("SHIPPED"))
            .body("sources.find { it.source == 'inventory-service' }.status", is("UNAVAILABLE"));
    }

    @Test
    void orderServiceDownIsA503NamingTheSourceForDetailAndPartialForLists() {
        UpstreamStubs.server.stubFor(get(urlPathEqualTo("/order/api/v1/orders/ord_x1")).willReturn(aResponse().withFault(Fault.EMPTY_RESPONSE)));
        given().get("/api/v1/orders/ord_x1/summary").then().statusCode(503).body("code", is("UPSTREAM_UNAVAILABLE"))
            .body("source", is("order-service"));
        UpstreamStubs.server.stubFor(get(urlPathEqualTo("/order/api/v1/orders")).willReturn(aResponse().withStatus(500)));
        given().get("/api/v1/orders").then().statusCode(200).body("items", hasSize(0)).body("window.complete", is(false))
            .body("sources[0].status", is("UNAVAILABLE"));
        given().get("/api/v1/overview").then().statusCode(200).body("sources[0].source", is("order-service"))
            .body("sources[0].status", is("UNAVAILABLE")).body("indicators", nullValue()).body("exceptionQueue", hasSize(0));
        given().get("/api/v1/incidents").then().statusCode(200).body("items", hasSize(0)).body("window.complete", is(false));
    }

    @Test
    void unknownOrderIs404() {
        UpstreamStubs.server.stubFor(get(urlPathEqualTo("/order/api/v1/orders/ord_nope")).willReturn(aResponse().withStatus(404)));
        given().get("/api/v1/orders/ord_nope/summary").then().statusCode(404).body("code", is("NOT_FOUND"));
        given().get("/api/v1/orders/not-an-id/summary").then().statusCode(400);
    }

    @Test
    void listFiltersSortsAndPagesWithinTheWindowAndFollowsOnlyTheLinkQuery() {
        String page1 = "[" + Fixtures.order("ord_a", "SHIPPED", "2026-11-05T10:00:03Z") + ","
            + Fixtures.order("ord_b", "EXCEPTION", "2026-11-05T10:00:04Z") + "]";
        String page2 = "[" + Fixtures.order("ord_c", "FULFILLMENT_REQUESTED", "2026-11-05T09:00:00Z") + "]";
        UpstreamStubs.server.stubFor(get(urlPathEqualTo("/order/api/v1/orders")).withQueryParam("cursor", equalTo("abc"))
            .willReturn(Fixtures.json(page2)));
        UpstreamStubs.server.stubFor(get(urlPathEqualTo("/order/api/v1/orders")).withQueryParam("cursor", com.github.tomakehurst.wiremock.client.WireMock.absent())
            .willReturn(Fixtures.json(page1).withHeader("Link", "<https://evil.example/steal?limit=100&cursor=abc>; rel=\"next\"")));
        given().queryParam("state", "EXCEPTION").get("/api/v1/orders").then().statusCode(200)
            .body("total", is(1)).body("items[0].orderId", is("ord_b")).body("window.scanned", is(3)).body("window.complete", is(true));
        given().queryParam("sort", "updatedAt").queryParam("size", 1).queryParam("page", 1).get("/api/v1/orders").then()
            .body("items[0].orderId", is("ord_a")).body("total", is(3));
        given().queryParam("state", "NOPE").get("/api/v1/orders").then().statusCode(400).body("code", is("INVALID_REQUEST"));
        given().get("/api/v1/overview").then().statusCode(200).body("indicators.exceptions", is(1))
            .body("indicators.stuck", is(1)).body("exceptionQueue.kind", hasItem("AWAITING_ERP_TOO_LONG"))
            .body("exceptionQueue.kind", hasItem("ORDER_EXCEPTION"));
    }

    @Test
    void placingTwiceWithTheSameKeyReturnsTheSameOrderAndForwardsTheKey() {
        String created = Fixtures.order("ord_p1", "SUBMITTED", RECENT);
        UpstreamStubs.server.stubFor(post(urlPathEqualTo("/order/api/v1/orders")).inScenario("idem")
            .whenScenarioStateIs(com.github.tomakehurst.wiremock.stubbing.Scenario.STARTED)
            .willReturn(aResponse().withStatus(201).withHeader("Content-Type", "application/json").withBody(created))
            .willSetStateTo("created"));
        UpstreamStubs.server.stubFor(post(urlPathEqualTo("/order/api/v1/orders")).inScenario("idem").whenScenarioStateIs("created")
            .willReturn(aResponse().withStatus(200).withHeader("Idempotency-Replayed", "true")
                .withHeader("Content-Type", "application/json").withBody(created)));
        Map<String, Object> body = Map.of("customerId", "cust_demo_ada", "sku", "SKU-42", "quantity", 2, "siteId", "site_east");
        for (int i = 0; i < 2; i++) {
            given().header("X-Box1-Console", "1").header("Idempotency-Key", "demo-baseline-1").contentType("application/json")
                .body(body).post("/api/v1/orders").then().statusCode(i == 0 ? 201 : 200)
                .body("order.orderId", is("ord_p1")).body("replayed", is(i == 1));
        }
        UpstreamStubs.server.verify(2, postRequestedFor(urlPathEqualTo("/order/api/v1/orders"))
            .withHeader("Idempotency-Key", equalTo("demo-baseline-1")).withHeader("X-Consumer-Id", equalTo("operations-console"))
            .withHeader("traceparent", matching("00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}"))
            .withRequestBody(equalToJson("{\"customerId\":\"cust_demo_ada\",\"sku\":\"SKU-42\",\"quantity\":2,\"siteId\":\"site_east\"}")));
    }

    @Test
    void placeOrderMapsConflictInvalidAndOutage() {
        Map<String, Object> body = Map.of("customerId", "cust_demo_ada", "sku", "SKU-42", "quantity", 2, "siteId", "site_east");
        UpstreamStubs.server.stubFor(post(urlPathEqualTo("/order/api/v1/orders")).willReturn(aResponse().withStatus(409)));
        given().header("X-Box1-Console", "1").header("Idempotency-Key", "k").contentType("application/json").body(body)
            .post("/api/v1/orders").then().statusCode(409).body("code", is("IDEMPOTENCY_CONFLICT"));
        UpstreamStubs.server.stubFor(post(urlPathEqualTo("/order/api/v1/orders")).willReturn(aResponse().withFixedDelay(3000)));
        given().header("X-Box1-Console", "1").header("Idempotency-Key", "k").contentType("application/json").body(body)
            .post("/api/v1/orders").then().statusCode(503).body("code", is("UPSTREAM_UNAVAILABLE")).body("source", is("order-service"));
        given().header("X-Box1-Console", "1").header("Idempotency-Key", "k").contentType("application/json")
            .body(Map.of("customerId", "bob", "sku", "SKU-42", "quantity", 0, "siteId", "site_east"))
            .post("/api/v1/orders").then().statusCode(400).body("code", is("INVALID_REQUEST"));
        given().header("X-Box1-Console", "1").contentType("application/json").body(body)
            .post("/api/v1/orders").then().statusCode(400);
        // A refusal is not an outage: no "retry is safe" (review ARCH-4).
        UpstreamStubs.server.stubFor(post(urlPathEqualTo("/order/api/v1/orders")).willReturn(aResponse().withStatus(403)));
        given().header("X-Box1-Console", "1").header("Idempotency-Key", "k").contentType("application/json").body(body)
            .post("/api/v1/orders").then().statusCode(502).body("code", is("UPSTREAM_REFUSED"));
    }

    @Test
    void evidenceForAnOrderWithoutAnIncidentClaimsNeitherKindNorResolution() {
        Fixtures.stubOrder(UpstreamStubs.server, "ord_q1", "SUBMITTED", RECENT);
        given().get("/api/v1/incidents/inc_ord_q1/evidence").then().statusCode(200)
            .body("incident.kind", is("NONE")).body("incident.active", is(false))
            .body("incident.title", containsString("No active incident"));
        given().get("/api/v1/incidents/inc_other/evidence").then().statusCode(404);
    }

    @Test
    void exceptionOrdersStillShowTheirErpDetail() {
        Fixtures.stubOrder(UpstreamStubs.server, "ord_e1", "EXCEPTION", RECENT);
        adapter("e1", "UPLOADED", "ACKNOWLEDGED", "REJECTED");
        given().get("/api/v1/orders/ord_e1/summary").then().statusCode(200).body("erp.stage", is("REJECTED"));
    }

    @Test
    void anUnusableNextLinkMarksTheWindowIncompleteInsteadOfFailing() {
        UpstreamStubs.server.stubFor(get(urlPathEqualTo("/order/api/v1/orders")).willReturn(Fixtures.json(
            "[" + Fixtures.order("ord_l1", "SHIPPED", RECENT) + "]").withHeader("Link", "</api/v1/orders?cursor=a b#x>; title=\"x\"; rel=\"next\"")));
        given().get("/api/v1/orders").then().statusCode(200).body("items", hasSize(1)).body("window.complete", is(false));
        given().get("/api/v1/overview").then().statusCode(200).body("indicators.windowComplete", is(false));
    }

    @Test
    void assetServiceRefusalIsReportedAsNotAuthorized() {
        UpstreamStubs.server.stubFor(get(urlPathEqualTo("/inventory/api/v1/inventory")).willReturn(Fixtures.json(
            "[{\"siteId\":\"site_east\",\"sku\":\"SKU-42\",\"onHand\":10,\"reserved\":2,\"available\":8,\"updatedAt\":\"" + Instant.now() + "\"}]")));
        UpstreamStubs.server.stubFor(get(urlPathEqualTo("/asset/api/v1/alerts")).willReturn(aResponse().withStatus(401)));
        given().get("/api/v1/sites").then().statusCode(200).body("items[0].siteId", is("site_east"))
            .body("items[0].stock[0].available", is(8))
            .body("sources.find { it.source == 'asset-service' }.status", is("NOT_AUTHORIZED"))
            .body("sources.find { it.source == 'asset-service' }.detail", containsString("its own client"));
    }

    @Test
    void deliveryReportsEachRevisionOrItsAbsence() {
        UpstreamStubs.server.stubFor(get(urlPathEqualTo("/order/api/info")).willReturn(Fixtures.json(
            "{\"name\":\"order-service\",\"version\":\"1.0.0\",\"gitRef\":\"8fda08763e2a593d67cabea73fb84e762cb41a21\"}")));
        given().get("/api/v1/delivery").then().statusCode(200)
            .body("services.find { it.service == 'order-service' }.commitUrl", containsString("/order-service/commit/8fda0876"))
            .body("services.find { it.service == 'inventory-service' }.gitRef", nullValue())
            .body("sources.size()", lessThan(5));
    }
}
