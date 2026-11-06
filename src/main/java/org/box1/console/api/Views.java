package org.box1.console.api;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import org.box1.console.upstream.SourceStatus;

/** Response shapes of the console API; they mirror META-INF/openapi.yaml (checked by ContractDriftTest). */
public final class Views {
    private Views() {
    }

    /** {@code scenarioRoles}: the person's roles on the scenario controller (box1-docs#19), which it enforces itself. */
    public record Me(String username, List<String> roles, String environment, List<String> scenarioRoles) {
    }

    public record Order(String orderId, String state, String stateLabel, String statusReason, String customerId, String sku,
        Integer quantity, String siteId, String reservationId, Instant createdAt, Instant updatedAt, String correlationId,
        String traceId) {
    }

    public record Window(int scanned, boolean complete) {
    }

    public record OrderPage(List<Order> items, int page, int size, int total, Window window, List<SourceStatus> sources) {
    }

    public record PlacedOrder(Order order, boolean replayed) {
    }

    public record Reservation(String reservationId, String status, Instant expiresAt, Instant updatedAt) {
    }

    public record ErpProgress(String stage, String label, String tone, String detail, String linkMode,
        String fulfillmentRequestId, String dispatch, String erpAcknowledgement, String outcome, String needsAttentionReason,
        Integer revision, Integer uploads, Integer resends, String shipmentId, Instant statusAt) {
    }

    public record TimelineEntry(Long sequence, String kind, String description, String reasonCode, String fromState,
        String toState, Instant occurredAt, String eventId, String eventType, String causationId, String correlationId,
        String traceId) {
    }

    public record EvidenceLink(String kind, String label, boolean available, String href, String reason) {
    }

    public record OrderSummary(Order order, Reservation reservation, ErpProgress erp, List<TimelineEntry> timeline,
        boolean timelineComplete, List<EvidenceLink> evidence, List<SourceStatus> sources) {
    }

    public record Indicators(Map<String, Integer> byState, int stuck, int exceptions, int scanned, boolean windowComplete) {
    }

    public record Incident(String incidentId, String orderId, String kind, String title, Instant since, boolean active,
        boolean derived) {
    }

    public record Overview(Indicators indicators, List<Incident> exceptionQueue, int stuckThresholdMinutes,
        List<SourceStatus> sources) {
    }

    public record IncidentList(List<Incident> items, Window window, List<SourceStatus> sources) {
    }

    public record IncidentEvidence(Incident incident, OrderSummary summary, List<SourceStatus> sources) {
    }

    public record StockLevel(String sku, Integer onHand, Integer reserved, Integer available, Instant updatedAt) {
    }

    public record Site(String siteId, List<StockLevel> stock) {
    }

    public record SiteList(List<Site> items, String telemetryConsoleUrl, List<SourceStatus> sources) {
    }

    public record ServiceRevision(String service, String gitRef, String version, String commitUrl) {
    }

    public record Delivery(List<ServiceRevision> services, List<SourceStatus> sources) {
    }

    public record Scenario(String name, String title, String description, String mechanism, String availability,
        String notPossibleReason, Integer defaultDurationSeconds, Integer maxDurationSeconds, String expectedObservation,
        String resetAction, List<String> operatorSteps) {
    }

    public record ScenarioList(List<Scenario> items, String telemetryConsoleUrl, List<SourceStatus> sources) {
    }

    public record ScenarioAudit(Long seq, String scenarioRunId, String scenario, String action, String outcome, String actor,
        String environment, String detail, Instant occurredAt, String stardate) {
    }

    public record ScenarioRun(String scenarioRunId, String scenario, String title, String mode, String status, String detail,
        String operatorStep, String operatorStepId, String actor, String environment, Integer ttlSeconds,
        String correlationId, Instant startedAt, String startedStardate, Instant expiresAt, Instant endedAt,
        String resetResult, String resetDetail, Instant resetAt, List<ScenarioAudit> audit) {
    }

    public record ScenarioRunList(List<ScenarioRun> items, List<SourceStatus> sources) {
    }

    public record ScenarioAuditList(List<ScenarioAudit> items, List<SourceStatus> sources) {
    }

    public record FixtureSite(String siteId, String displayName, String status) {
    }

    public record FixtureCustomer(String customerId, String displayName) {
    }

    public record FixtureProduct(String sku, String displayName) {
    }

    public record FixtureStock(String siteId, String sku, Integer openingQuantity) {
    }

    public record ScenarioFixtures(List<FixtureSite> sites, List<FixtureCustomer> customers, List<FixtureProduct> products,
        List<FixtureStock> stock, List<SourceStatus> sources) {
    }

    public record SeedResult(int created, int unchanged) {
    }

    public record ResetResult(String scenarioRunId, String resetId, String resetResult, String resetDetail) {
    }
}
