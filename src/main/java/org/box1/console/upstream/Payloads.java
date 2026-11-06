package org.box1.console.upstream;

import java.time.Instant;
import java.util.List;

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
    public record UpTimelineEntry(Long sequence, String kind, String fromState, String toState, String reasonCode,
        Instant occurredAt, String eventId, String eventType, String causationId, String correlationId, String traceId) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpReservation(String reservationId, String status, Instant expiresAt, Instant updatedAt) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpStock(String siteId, String sku, Integer onHand, Integer reserved, Integer available, Instant updatedAt) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpFulfillment(String fulfillmentRequestId, String dispatch, String erpAcknowledgement, String outcome,
        String needsAttentionReason, Integer revision, Integer uploads, Integer resends, String shipmentId,
        Instant statusAt) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpInfo(String name, String version, String gitRef) {
    }

    /** The scenario controller's catalog entry (box1-org/scenario-controller {@code Views.ScenarioView}). */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpScenario(String name, String title, String description, String mechanism, String availability,
        String notPossibleReason, Integer defaultDurationSeconds, Integer maxDurationSeconds, String expectedObservation,
        String resetAction, List<String> operatorSteps) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpAudit(Long seq, String scenarioRunId, String scenario, String action, String outcome, String actor,
        String environment, String detail, Instant occurredAt, String stardate) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpRun(String scenarioRunId, String scenario, String title, String mode, String status, String detail,
        String operatorStep, String operatorStepId, String actor, String environment, Integer ttlSeconds,
        String correlationId, Instant startedAt, String startedStardate, Instant expiresAt, Instant endedAt,
        String resetResult, String resetDetail, Instant resetAt, List<UpAudit> audit) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpFixtureSite(String siteId, String displayName, String status) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpFixtureCustomer(String customerId, String displayName) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpFixtureProduct(String sku, String displayName) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpFixtureStock(String siteId, String sku, Integer openingQuantity) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpFixtures(List<UpFixtureSite> sites, List<UpFixtureCustomer> customers, List<UpFixtureProduct> products,
        List<UpFixtureStock> stock) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpSeed(Integer created, Integer unchanged) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpReset(String scenarioRunId, String resetId, String resetResult, String resetDetail) {
    }
}
