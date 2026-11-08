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

    /** An asset-service alert episode (GET /api/v1/alerts); only the fields the console shows. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpAlert(String alertId, String assetId, String siteId, String metricName, String unit, String status,
        String severity, Double threshold, Double peakValue, Double lastValue, Instant activatedAt, Instant escalatedAt) {
    }

    /** One page of asset-service results. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpPage<T>(List<T> items, String nextCursor) {
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

    /** agentic-operations' answer to POST /api/v1/ai/incidents/{incidentId}/analyze (box1-docs#101). */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpAnalysisSubmitted(String analysisId, String status) {
    }

    /** One finding; every finding cites evidence refs (ev_N) from the same analysis. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpFinding(String statement, List<String> evidenceRefs, String confidence) {
    }

    /** A proposed action. agentic-operations never executes it; the console has no way to either. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpSuggestedAction(String type, String description, String expectedEffect, String rollback) {
    }

    /** One evidence entry; {@code data} (untrusted raw evidence) is deliberately not read. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpEvidence(String ref, String type, String source, Instant timestamp, Instant retrievedAt,
        String retrievalStatus, String detail, String link, Boolean truncated) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpModelInfo(String modelId, String contextProfile, Integer promptTokens, Integer completionTokens) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpQuality(Integer citedFindings, Integer unsupportedAssertions, Integer droppedActions) {
    }

    /** GET /api/v1/ai/analyses/{analysisId}: only the fields the console shows. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpAnalysis(String analysisId, String incidentId, String orderId, String incidentType, String status,
        String statusDetail, Instant createdAt, Instant completedAt, String summary, List<UpFinding> findings,
        List<String> unknowns, List<UpSuggestedAction> suggestedActions, List<UpEvidence> evidence, UpModelInfo model,
        UpQuality quality) {
    }

    /** agentic-operations' Assistant conversations (box1-docs#101, D-016). */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpConversationCreated(String conversationId) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpTurnQueued(String conversationId, String turnId, String status) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpChatStep(String tool, String target, String decision, String retrievalStatus, Long durationMs) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpChatModelUse(String modelId, Integer modelCalls, Integer toolCalls, Integer promptTokens,
        Integer completionTokens) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpChatTurn(String turnId, String question, String status, String statusDetail, String answer,
        List<UpChatStep> steps, UpChatModelUse model, Instant startedAt, Instant completedAt) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpConversation(String conversationId, Instant createdAt, Instant updatedAt, List<UpChatTurn> turns) {
    }
}
