package org.box1.console;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.get;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;

import com.github.tomakehurst.wiremock.WireMockServer;

/** Synthetic upstream bodies shaped like the served OpenAPI documents (no real customer data). */
final class Fixtures {
    private Fixtures() {
    }

    static String order(String id, String state, String updatedAt) {
        return """
            {"orderId":"%s","state":"%s","customerId":"cust_demo_ada","sku":"SKU-42","quantity":2,"siteId":"site_east",
             "reservationId":"res_%s","statusReason":null,"createdAt":"2026-11-05T10:00:00Z","updatedAt":"%s",
             "correlationId":"c0ffee00-0000-4000-8000-000000000001","traceId":"0af7651916cd43dd8448eb211c80319c"}
            """.formatted(id, state, id.substring(4), updatedAt);
    }

    static String timeline(String id) {
        return """
            [{"sequence":11,"kind":"TRANSITION","fromState":null,"toState":"SUBMITTED","reasonCode":"ORDER_PLACED",
              "occurredAt":"2026-11-05T10:00:00Z","eventId":"5f0c7d2e-1111-4a5b-9c3d-000000000001","eventType":"order.placed.v1",
              "causationId":null,"correlationId":"c0ffee00-0000-4000-8000-000000000001","traceId":"0af7651916cd43dd8448eb211c80319c"},
             {"sequence":14,"kind":"TRANSITION","fromState":"SUBMITTED","toState":"RESERVED","reasonCode":"INVENTORY_RESERVED",
              "occurredAt":"2026-11-05T10:00:01Z","eventId":"5f0c7d2e-1111-4a5b-9c3d-000000000002","eventType":"inventory.reserved.v1",
              "causationId":null,"correlationId":"c0ffee00-0000-4000-8000-000000000001","traceId":"0af7651916cd43dd8448eb211c80319c"}]
            """;
    }

    static String fulfillment(String id, String dispatch, String ack, String outcome) {
        return """
            {"fulfillmentRequestId":"ful_%s","orderId":"ord_%s","dispatch":"%s","erpAcknowledgement":"%s","outcome":"%s",
             "needsAttentionReason":null,"revision":2,"uploads":1,"resends":0,"shipmentId":null,"statusAt":"2026-11-05T10:01:00Z"}
            """.formatted(id, id, dispatch, ack, outcome);
    }

    static void stubOrder(WireMockServer s, String id, String state, String updatedAt) {
        s.stubFor(get(urlPathEqualTo("/order/api/v1/orders/" + id)).willReturn(json(order(id, state, updatedAt))));
        s.stubFor(get(urlPathEqualTo("/order/api/v1/orders/" + id + "/timeline")).willReturn(json(timeline(id))));
        s.stubFor(get(urlPathEqualTo("/inventory/api/v1/reservations/res_" + id.substring(4))).willReturn(json(
            "{\"reservationId\":\"res_" + id.substring(4) + "\",\"status\":\"CONSUMED\",\"expiresAt\":null,\"updatedAt\":null}")));
        s.stubFor(get(urlPathEqualTo("/order/api/info")).willReturn(json(
            "{\"name\":\"order-service\",\"version\":\"1.0.0\",\"gitRef\":\"8fda08763e2a593d67cabea73fb84e762cb41a21\"}")));
    }

    static com.github.tomakehurst.wiremock.client.ResponseDefinitionBuilder json(String body) {
        return aResponse().withStatus(200).withHeader("Content-Type", "application/json").withBody(body);
    }
}
