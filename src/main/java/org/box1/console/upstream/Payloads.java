package org.box1.console.upstream;

import java.time.Instant;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/** What the console reads from each upstream's served API. Unknown fields are ignored (additive upstream changes). */
public final class Payloads {
    private Payloads() {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpOrder(String orderId, String state, String customerId, String sku, Integer quantity, String siteId,
        String reservationId, String statusReason, Instant createdAt, Instant updatedAt, String correlationId,
        String traceId) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpTimelineEntry(long sequence, String kind, String fromState, String toState, String reasonCode,
        Instant occurredAt, String eventId, String eventType, String causationId, String correlationId, String traceId) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpReservation(String reservationId, String status, Instant expiresAt, Instant updatedAt) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpStock(String siteId, String sku, int onHand, int reserved, int available, Instant updatedAt) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpFulfillment(String fulfillmentRequestId, String dispatch, String erpAcknowledgement, String outcome,
        String needsAttentionReason, Integer revision, Integer uploads, Integer resends, String shipmentId,
        Instant statusAt) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpInfo(String name, String version, String gitRef) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpScenario(String name, String description) {
    }
}
