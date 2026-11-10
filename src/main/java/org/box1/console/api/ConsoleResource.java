package org.box1.console.api;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Future;

import com.fasterxml.jackson.core.type.TypeReference;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.security.RolesAllowed;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DefaultValue;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.box1.InfoResource;
import org.box1.console.domain.ConsoleReads;
import org.box1.console.domain.ConsoleReads.Listed;
import org.box1.console.domain.ErpProgressMapper;
import org.box1.console.domain.Incidents;
import org.box1.console.domain.SiteMap;
import org.box1.console.domain.StateLabels;
import org.box1.console.domain.TimelineText;
import org.box1.console.security.AssetToken;
import org.box1.console.security.ConsoleRoles;
import org.box1.console.security.ScenarioToken;
import org.box1.console.security.SessionTokens;
import org.box1.console.upstream.Fanout;
import org.box1.console.upstream.Payloads.UpFulfillment;
import org.box1.console.upstream.Payloads.UpInfo;
import org.box1.console.upstream.Payloads.UpOrder;
import org.box1.console.upstream.Payloads.UpReservation;
import org.box1.console.upstream.Payloads.UpSiteStatus;
import org.box1.console.upstream.Payloads.UpTimelineEntry;
import org.box1.console.upstream.Source;
import org.box1.console.upstream.SourceStatus;
import org.box1.console.upstream.UpstreamConfig;
import org.box1.console.upstream.UpstreamResponse;
import org.box1.console.upstream.Upstreams;

/**
 * Console backend API (META-INF/openapi.yaml). Every role check is here; the pages only reflect them.
 * Aggregates report each upstream in {@code sources} and never invent values for a failed source.
 */
@Path("/api/v1")
@Produces(MediaType.APPLICATION_JSON)
public class ConsoleResource {
    private static final TypeReference<UpOrder> ORDER = new TypeReference<>() { };
    private static final Map<Source, String> REPOS = Map.of(Source.ORDER_SERVICE, "order-service",
        Source.INVENTORY_SERVICE, "inventory-service", Source.FULFILLMENT_ADAPTER, "fulfillment-adapter",
        Source.ASSET_SERVICE, "asset-service");
    private static final Duration INFO_TTL = Duration.ofSeconds(60);

    private final ConsoleReads reads;
    private final Upstreams upstreams;
    private final UpstreamConfig upstreamConfig;
    private final Fanout fanout;
    private final SecurityIdentity identity;
    private final InfoResource selfInfo;
    private final ScenarioToken scenarioToken;
    private final AssetToken assetToken;
    private final SiteMap siteMap;
    private final Map<Source, CachedInfo> infoCache = new ConcurrentHashMap<>();

    record CachedInfo(Instant at, UpstreamResponse<UpInfo> response) {
    }

    public ConsoleResource(ConsoleReads reads, Upstreams upstreams, UpstreamConfig upstreamConfig, Fanout fanout,
        SecurityIdentity identity, InfoResource selfInfo, ScenarioToken scenarioToken, AssetToken assetToken, SiteMap siteMap) {
        this.reads = reads;
        this.upstreams = upstreams;
        this.upstreamConfig = upstreamConfig;
        this.fanout = fanout;
        this.identity = identity;
        this.selfInfo = selfInfo;
        this.scenarioToken = scenarioToken;
        this.assetToken = assetToken;
        this.siteMap = siteMap;
    }

    @GET
    @Path("/me")
    @RolesAllowed("**")
    public Views.Me me() {
        List<String> roles = ConsoleRoles.ALL.stream().filter(identity::hasRole).toList();
        return new Views.Me(identity.getPrincipal().getName(), roles, reads.settings().environment(), scenarioToken.roles());
    }

    @GET
    @Path("/overview")
    @RolesAllowed({ConsoleRoles.VIEWER, ConsoleRoles.OPERATOR, ConsoleRoles.DEVELOPER})
    public Views.Overview overview() {
        Listed<UpOrder> recent = recentOrders();
        Duration threshold = reads.settings().stuckThreshold();
        Instant now = Instant.now();
        if (recent.status().status() != SourceStatus.State.OK) {
            // The order service is the only source of these numbers: report them absent, never zero (review ARCH-1).
            return new Views.Overview(null, List.of(), (int) threshold.toMinutes(), List.of(recent.status()));
        }
        Map<String, Integer> byState = new LinkedHashMap<>();
        int stuck = 0;
        int exceptions = 0;
        for (UpOrder o : recent.items()) {
            if (o.state() != null) {
                byState.merge(o.state(), 1, Integer::sum);
            }
            if (Incidents.stuck(o, threshold, now)) {
                stuck++;
            }
            if ("EXCEPTION".equals(o.state())) {
                exceptions++;
            }
        }
        List<Views.Incident> queue = incidentsOf(recent.items(), threshold, now);
        return new Views.Overview(new Views.Indicators(byState, stuck, exceptions, recent.items().size(), recent.complete()),
            queue, (int) threshold.toMinutes(), List.of(recent.status()));
    }

    @GET
    @Path("/orders")
    @RolesAllowed({ConsoleRoles.VIEWER, ConsoleRoles.OPERATOR, ConsoleRoles.DEVELOPER})
    public Views.OrderPage orders(
        @QueryParam("state") @Pattern(regexp = "SUBMITTED|RESERVED|FULFILLMENT_REQUESTED|SHIPPED|COMPLETED|REJECTED|EXCEPTION|CANCELLED") String state,
        @QueryParam("siteId") @Pattern(regexp = "^site_[A-Za-z0-9_-]{1,64}$") String siteId,
        @QueryParam("sku") @Size(min = 1, max = 80) String sku,
        @QueryParam("sort") @DefaultValue("-createdAt") @Pattern(regexp = "-?(createdAt|updatedAt)") String sort,
        @QueryParam("page") @DefaultValue("0") @Min(0) int page,
        @QueryParam("size") @DefaultValue("20") @Min(1) @Max(100) int size) {
        Listed<UpOrder> recent = recentOrders();
        Comparator<UpOrder> order = sort.endsWith("updatedAt")
            ? Comparator.comparing(UpOrder::updatedAt, Comparator.nullsLast(Comparator.naturalOrder()))
            : Comparator.comparing(UpOrder::createdAt, Comparator.nullsLast(Comparator.naturalOrder()));
        if (sort.startsWith("-")) {
            order = order.reversed();
        }
        List<UpOrder> matching = recent.items().stream()
            .filter(o -> state == null || state.equals(o.state()))
            .filter(o -> siteId == null || siteId.equals(o.siteId()))
            .filter(o -> sku == null || sku.equals(o.sku()))
            .sorted(order).toList();
        List<Views.Order> pageItems = matching.stream().skip((long) page * size).limit(size).map(ConsoleResource::view).toList();
        return new Views.OrderPage(pageItems, page, size, matching.size(),
            new Views.Window(recent.items().size(), recent.complete()), List.of(recent.status()));
    }

    /** Request body for placing an order; mirrors the order service's CreateOrder. */
    public record PlaceOrder(
        @NotNull @Pattern(regexp = "^cust_[A-Za-z0-9_-]{1,64}$") String customerId,
        @NotBlank @Size(max = 80) String sku,
        @NotNull @Min(1) @Max(1000) Integer quantity,
        @NotNull @Pattern(regexp = "^site_[A-Za-z0-9_-]{1,64}$") String siteId) {
    }

    @POST
    @Path("/orders")
    @Consumes(MediaType.APPLICATION_JSON)
    @RolesAllowed(ConsoleRoles.OPERATOR)
    public Response placeOrder(@HeaderParam("Idempotency-Key") @NotNull @Pattern(regexp = "^[A-Za-z0-9._:-]{1,255}$") String idempotencyKey,
        @Valid @NotNull PlaceOrder body) {
        String correlationId = UUID.randomUUID().toString();
        UpstreamResponse<UpOrder> r = upstreams.post(Source.ORDER_SERVICE, "/api/v1/orders", Optional.empty(),
            Map.of("Idempotency-Key", idempotencyKey, "X-Consumer-Id", "operations-console", "X-Correlation-Id", correlationId),
            body, ORDER);
        if (r.ok() && (r.status() == 201 || r.status() == 200)) {
            return Response.status(r.status()).entity(new Views.PlacedOrder(view(r.body()), r.status() == 200)).build();
        }
        if (r.status() == 409) {
            throw new Problem.Failure(Problem.upstream(409, "Conflict",
                "This idempotency key was already used with a different order.", "IDEMPOTENCY_CONFLICT", "order-service"));
        }
        if (r.status() == 400) {
            throw new Problem.Failure(Problem.upstream(400, "Order rejected",
                "The order service rejected the order as invalid.", "UPSTREAM_REJECTED", "order-service"));
        }
        if (r.status() >= 400 && r.status() < 500) {
            // A refusal is not an outage: retrying would not help, so do not say it is safe (review ARCH-4).
            throw new Problem.Failure(Problem.upstream(502, "Order service refused the order",
                "The order service refused the request (HTTP " + r.status() + "). No order was created.",
                "UPSTREAM_REFUSED", "order-service"));
        }
        throw new Problem.Failure(Problem.upstream(503, "Order service did not confirm the order",
            "The order may or may not have been created: " + r.sourceStatus().detail()
                + " Submit the same order again: the same submission key returns the existing order instead of a second one.",
            "UPSTREAM_UNAVAILABLE", "order-service"));
    }

    @GET
    @Path("/orders/{orderId}/summary")
    @RolesAllowed({ConsoleRoles.VIEWER, ConsoleRoles.OPERATOR, ConsoleRoles.DEVELOPER})
    public Views.OrderSummary summary(@PathParam("orderId") @Pattern(regexp = "^ord_[A-Za-z0-9_-]{1,64}$") String orderId) {
        return summarize(orderId, requireOrder(orderId));
    }

    @GET
    @Path("/incidents")
    @RolesAllowed({ConsoleRoles.VIEWER, ConsoleRoles.OPERATOR, ConsoleRoles.DEVELOPER})
    public Views.IncidentList incidents() {
        Listed<UpOrder> recent = recentOrders();
        return new Views.IncidentList(incidentsOf(recent.items(), reads.settings().stuckThreshold(), Instant.now()),
            new Views.Window(recent.items().size(), recent.complete()), List.of(recent.status()));
    }

    @GET
    @Path("/incidents/{incidentId}/evidence")
    @RolesAllowed({ConsoleRoles.VIEWER, ConsoleRoles.OPERATOR, ConsoleRoles.DEVELOPER})
    public Views.IncidentEvidence evidence(
        @PathParam("incidentId") @Pattern(regexp = "^inc_[A-Za-z0-9_-]{1,80}$") String incidentId) {
        String orderId = Incidents.orderIdOf(incidentId).orElseThrow(() -> new Problem.Failure(
            Problem.of(404, "Not found", "No such incident.", "NOT_FOUND")));
        UpOrder order = requireOrder(orderId);
        Views.OrderSummary summary = summarize(orderId, order);
        Views.Incident incident = Incidents.current(order, reads.settings().stuckThreshold(), Instant.now());
        return new Views.IncidentEvidence(incident, summary, summary.sources());
    }

    @GET
    @Path("/sites")
    @RolesAllowed({ConsoleRoles.VIEWER, ConsoleRoles.OPERATOR, ConsoleRoles.DEVELOPER})
    public Views.SiteList sites() {
        Optional<String> token = reads.forwardable(SessionTokens.accessToken(identity));
        long deadline = System.nanoTime() + upstreamConfig.pageBudget().toNanos();
        Future<Listed<UpStockAlias>> stockF = fanout.submit(() -> wrapStock(reads.stock(token)));
        Optional<String> assetBearer = assetToken.forAssetService();
        Future<Listed<UpAlertAlias>> alertsF = fanout.submit(() -> wrapAlerts(reads.activeAlerts(assetBearer)));
        Future<Listed<UpSiteStatusAlias>> statusF = fanout.submit(() -> wrapSiteStatus(reads.siteStatuses(assetBearer)));
        Listed<UpStockAlias> stock = Fanout.await(stockF, deadline, new Listed<>(List.of(), false, late(Source.INVENTORY_SERVICE)));
        Listed<UpAlertAlias> alerts = Fanout.await(alertsF, deadline, new Listed<>(List.of(), false, late(Source.ASSET_SERVICE)));
        Listed<UpSiteStatusAlias> statuses = Fanout.await(statusF, deadline,
            new Listed<>(List.of(), false, late(Source.ASSET_SERVICE)));
        Map<String, List<Views.StockLevel>> bySite = new LinkedHashMap<>();
        for (UpStockAlias s : stock.items()) {
            bySite.computeIfAbsent(s.value().siteId(), k -> new ArrayList<>()).add(new Views.StockLevel(s.value().sku(),
                s.value().onHand(), s.value().reserved(), s.value().available(), s.value().updatedAt()));
        }
        SourceStatus stockStatus = stock.status();
        if (!stock.complete() && stockStatus.status() == SourceStatus.State.OK) {
            stockStatus = SourceStatus.of(Source.INVENTORY_SERVICE, SourceStatus.State.DEGRADED,
                "Only the first " + stock.items().size() + " stock rows were read.", stockStatus.latencyMs());
        }
        List<Views.Alert> active = alerts.items().stream().map(UpAlertAlias::value).map(a -> new Views.Alert(a.alertId(),
            a.siteId(), a.assetId(), a.metricName(), a.unit(), a.severity(), a.threshold(), a.peakValue(), a.lastValue(),
            a.activatedAt(), a.escalatedAt())).toList();
        SourceStatus.State alertsState = alerts.status().status();
        boolean alertsRead = alertsState == SourceStatus.State.OK || alertsState == SourceStatus.State.DEGRADED;
        SourceStatus statusSource = statuses.status();
        if (statusSource.status() == SourceStatus.State.NOT_AUTHORIZED && alertsState == SourceStatus.State.OK
            && assetBearer.isPresent()) {
            // The same token read alerts, so the reader role is not what is missing (box1-docs#130).
            statusSource = SourceStatus.of(Source.ASSET_SERVICE, statusSource.status(), "asset-service answered the alerts "
                + "read but refused the site status read: the deployed asset-service may not serve site status yet.",
                statusSource.latencyMs());
        }
        Map<String, Views.SiteStatus> statusBySite = new LinkedHashMap<>();
        statuses.items().stream().map(UpSiteStatusAlias::value).forEach(st -> statusBySite.put(st.siteId(), view(st)));
        Map<String, Integer> alertsBySite = new LinkedHashMap<>();
        active.stream().filter(a -> a.siteId() != null).forEach(a -> alertsBySite.merge(a.siteId(), 1, Integer::sum));

        // Inventory order first (the place-order page lists sites in that order), then the others by siteId.
        List<String> ids = new ArrayList<>(bySite.keySet());
        java.util.TreeSet<String> others = new java.util.TreeSet<>(statusBySite.keySet());
        others.addAll(alertsBySite.keySet());
        others.removeIf(bySite::containsKey);
        ids.addAll(others);
        List<Views.Site> sites = ids.stream().map(id -> new Views.Site(id, bySite.getOrDefault(id, List.of()),
            statusBySite.get(id), alertsRead ? alertsBySite.getOrDefault(id, 0) : null,
            siteMap.locate(id).map(l -> new Views.MapLocation(l.x(), l.y(), l.region())).orElse(null))).toList();
        return new Views.SiteList(sites, active, reads.settings().telemetryConsoleUrl(), List.of(stockStatus, alerts.status()),
            statusSource);
    }

    @GET
    @Path("/delivery")
    @RolesAllowed(ConsoleRoles.DEVELOPER)
    public Views.Delivery delivery() {
        long deadline = System.nanoTime() + upstreamConfig.pageBudget().toNanos();
        Map<Source, Future<UpstreamResponse<UpInfo>>> futures = new LinkedHashMap<>();
        for (Source s : REPOS.keySet().stream().sorted().toList()) {
            futures.put(s, fanout.submit(() -> cachedInfo(s)));
        }
        InfoResource.ApplicationInfo self = selfInfo.info();
        List<Views.ServiceRevision> services = new ArrayList<>();
        services.add(new Views.ServiceRevision("operations-console", self.gitRef(), self.version(), commitUrl("operations-console", self.gitRef())));
        List<SourceStatus> sources = new ArrayList<>();
        futures.forEach((s, f) -> {
            UpstreamResponse<UpInfo> r = Fanout.await(f, deadline, new UpstreamResponse<>(0, null, null, late(s)));
            sources.add(r.sourceStatus());
            String ref = r.ok() ? r.body().gitRef() : null;
            services.add(new Views.ServiceRevision(s.id(), ref, r.ok() ? r.body().version() : null, commitUrl(REPOS.get(s), ref)));
        });
        return new Views.Delivery(services, sources);
    }

    // ---- helpers ----

    /** The recent-orders window, bounded by the page budget like every other read (review OPS-5). */
    private Listed<UpOrder> recentOrders() {
        long deadline = System.nanoTime() + upstreamConfig.pageBudget().toNanos();
        return Fanout.await(fanout.submit(reads::recentOrders), deadline,
            new Listed<>(List.of(), false, late(Source.ORDER_SERVICE)));
    }

    /** Lets a typed list cross the Fanout without an unchecked generic array. */
    record UpStockAlias(org.box1.console.upstream.Payloads.UpStock value) {
    }

    /** Lets a typed alert list cross the Fanout without an unchecked generic array. */
    record UpAlertAlias(org.box1.console.upstream.Payloads.UpAlert value) {
    }

    /** Lets a typed site status list cross the Fanout without an unchecked generic array. */
    record UpSiteStatusAlias(UpSiteStatus value) {
    }

    private static Listed<UpSiteStatusAlias> wrapSiteStatus(Listed<UpSiteStatus> listed) {
        return new Listed<>(listed.items().stream().map(UpSiteStatusAlias::new).toList(), listed.complete(), listed.status());
    }

    private static final java.util.Set<String> SITE_STATES = java.util.Set.of("ONLINE", "DEGRADED", "OFFLINE");

    /** An unknown future state is shown as UNKNOWN rather than guessed (the console contract lists the values). */
    static Views.SiteStatus view(UpSiteStatus s) {
        String state = s.state() != null && SITE_STATES.contains(s.state()) ? s.state() : "UNKNOWN";
        return new Views.SiteStatus(state, s.stateReasons() == null ? List.of()
            : s.stateReasons().stream().filter(java.util.Objects::nonNull).toList(),
            s.lastSeenAt(), s.lastSeenAgeSeconds(), s.lastReadingAt(), s.reportedAt(), s.bufferDepth(), s.siteEventBacklog(),
            s.bufferOldestAgeSeconds(), s.readingsDropped(), s.bootedImageDigest(), s.stagedImageDigest(),
            s.rollbackImageDigest(), s.greenbootStatus(), s.bundleDigest(),
            s.appVersions() == null ? Map.of() : s.appVersions().entrySet().stream()
                .filter(e -> e.getKey() != null && e.getValue() != null)
                .collect(java.util.stream.Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue, (a, b) -> a,
                    java.util.TreeMap::new)));
    }

    private static Listed<UpAlertAlias> wrapAlerts(Listed<org.box1.console.upstream.Payloads.UpAlert> listed) {
        return new Listed<>(listed.items().stream().map(UpAlertAlias::new).toList(), listed.complete(), listed.status());
    }

    private static Listed<UpStockAlias> wrapStock(Listed<org.box1.console.upstream.Payloads.UpStock> listed) {
        return new Listed<>(listed.items().stream().map(UpStockAlias::new).toList(), listed.complete(), listed.status());
    }

    private UpOrder requireOrder(String orderId) {
        UpstreamResponse<UpOrder> r = reads.order(orderId);
        if (r.ok()) {
            return r.body();
        }
        if (r.notFound()) {
            throw new Problem.Failure(Problem.of(404, "Not found", "The order service has no order " + orderId + ".", "NOT_FOUND"));
        }
        throw new Problem.Failure(Problem.upstream(503, "Order service unavailable",
            "The order is owned by the order service, which did not answer: " + r.sourceStatus().detail(),
            "UPSTREAM_UNAVAILABLE", "order-service"));
    }

    private Views.OrderSummary summarize(String orderId, UpOrder order) {
        Optional<String> token = reads.forwardable(SessionTokens.accessToken(identity));
        long deadline = System.nanoTime() + upstreamConfig.pageBudget().toNanos();
        String linkMode = reads.fulfillmentRequestIdFor(orderId).isPresent() ? "derived" : "none";

        Future<Listed<UpTimelineEntry>> timelineF = fanout.submit(() -> reads.timeline(orderId));
        Future<UpstreamResponse<UpReservation>> reservationF = order.reservationId() == null ? null
            : fanout.submit(() -> reads.reservation(order.reservationId(), token));
        Optional<String> fulfillmentId = ErpProgressMapper.applies(order.state())
            ? reads.fulfillmentRequestIdFor(orderId) : Optional.empty();
        Future<UpstreamResponse<UpFulfillment>> fulfillmentF = fulfillmentId
            .map(id -> fanout.submit(() -> reads.fulfillment(id, token))).orElse(null);
        Future<UpstreamResponse<UpInfo>> infoF = fanout.submit(() -> cachedInfo(Source.ORDER_SERVICE));

        List<SourceStatus> sources = new ArrayList<>();
        Listed<UpTimelineEntry> timeline = Fanout.await(timelineF, deadline,
            new Listed<>(List.of(), false, late(Source.ORDER_SERVICE)));
        sources.add(timeline.status());

        Views.Reservation reservation = null;
        if (reservationF != null) {
            UpstreamResponse<UpReservation> r = Fanout.await(reservationF, deadline,
                new UpstreamResponse<>(0, null, null, late(Source.INVENTORY_SERVICE)));
            sources.add(r.sourceStatus());
            if (r.ok()) {
                reservation = new Views.Reservation(r.body().reservationId(), r.body().status(), r.body().expiresAt(), r.body().updatedAt());
            }
        }

        Views.ErpProgress erp;
        if (!ErpProgressMapper.applies(order.state())) {
            erp = ErpProgressMapper.notApplicable(linkMode);
        } else if (fulfillmentF == null) {
            erp = ErpProgressMapper.unavailable("No published API links an order to its fulfillment request (gap G-1).",
                linkMode, null);
            sources.add(SourceStatus.of(Source.FULFILLMENT_ADAPTER, SourceStatus.State.NOT_CONFIGURED,
                "Order-to-fulfillment link not enabled (gap G-1).", null));
        } else {
            UpstreamResponse<UpFulfillment> r = Fanout.await(fulfillmentF, deadline,
                new UpstreamResponse<>(0, null, null, late(Source.FULFILLMENT_ADAPTER)));
            sources.add(r.sourceStatus());
            if (r.ok()) {
                erp = ErpProgressMapper.from(r.body(), linkMode);
            } else if (r.notFound()) {
                erp = ErpProgressMapper.notReceived(linkMode, fulfillmentId.get());
            } else {
                erp = ErpProgressMapper.unavailable(r.sourceStatus().detail(), linkMode, fulfillmentId.get());
            }
        }

        UpstreamResponse<UpInfo> info = Fanout.await(infoF, deadline, new UpstreamResponse<>(0, null, null, late(Source.ORDER_SERVICE)));
        List<Views.EvidenceLink> evidence = new ArrayList<>();
        evidence.add(traceEvidence(order.traceId()));
        evidence.add(logsEvidence(order.traceId()));
        Optional<String> dashboard = reads.settings().dashboardUrl().map(String::strip).filter(u -> !u.isEmpty());
        evidence.add(new Views.EvidenceLink("dashboard", "Order flow dashboard", dashboard.isPresent(), dashboard.orElse(null),
            dashboard.isPresent() ? null : "No dashboard is configured. Use the IDs in the timeline."));
        String ref = info.ok() ? info.body().gitRef() : null;
        String url = commitUrl("order-service", ref);
        evidence.add(new Views.EvidenceLink("source-revision", "order-service " + (ref == null ? "revision unknown" : shortRef(ref)),
            url != null, url, url == null ? "The order service did not report its revision." : null));

        List<Views.TimelineEntry> entries = timeline.items().stream()
            .filter(e -> e.sequence() != null).sorted(Comparator.comparing(UpTimelineEntry::sequence))
            .map(e -> new Views.TimelineEntry(e.sequence(), e.kind(), TimelineText.describe(e), e.reasonCode(), e.fromState(),
                e.toState(), e.occurredAt(), e.eventId(), e.eventType(), e.causationId(), e.correlationId(), e.traceId()))
            .toList();
        return new Views.OrderSummary(view(order), reservation, erp, entries, timeline.complete(), evidence, sources);
    }

    private static final java.util.regex.Pattern TRACE_ID = java.util.regex.Pattern.compile("^[0-9a-f]{32}$");

    /** The order's trace in the OpenShift trace viewer (box1-docs#22), when a template is set and the ID is valid. */
    private Views.EvidenceLink traceEvidence(String traceId) {
        return traceLink("trace", "Trace " + Optional.ofNullable(traceId).orElse("(none)"),
            reads.settings().traceUrlTemplate(), "No trace viewer is configured.", traceId);
    }

    /** Every service's application logs for the order's trace in the OpenShift log viewer (box1-docs#22). */
    private Views.EvidenceLink logsEvidence(String traceId) {
        return traceLink("logs", "Logs for this trace (all services)", reads.settings().logsUrlTemplate(),
            "No log viewer is configured.", traceId);
    }

    private static Views.EvidenceLink traceLink(String kind, String label, Optional<String> configured, String unconfigured,
        String traceId) {
        Optional<String> template = configured.map(String::strip).filter(t -> t.contains("{traceId}"));
        if (template.isEmpty()) {
            return new Views.EvidenceLink(kind, label, false, null, unconfigured + " Use the IDs in the timeline.");
        }
        if (traceId == null || !TRACE_ID.matcher(traceId).matches() || traceId.chars().allMatch(c -> c == '0')) {
            return new Views.EvidenceLink(kind, label, false, null, "The order service reported no valid trace ID.");
        }
        return new Views.EvidenceLink(kind, label, true, template.get().replace("{traceId}", traceId), null);
    }

    private UpstreamResponse<UpInfo> cachedInfo(Source source) {
        CachedInfo cached = infoCache.get(source);
        if (cached != null && cached.at().plus(INFO_TTL).isAfter(Instant.now())) {
            return cached.response();
        }
        UpstreamResponse<UpInfo> fresh = reads.info(source);
        if (fresh.ok()) {
            infoCache.put(source, new CachedInfo(Instant.now(), fresh));
        }
        return fresh;
    }

    private static List<Views.Incident> incidentsOf(List<UpOrder> orders, Duration threshold, Instant now) {
        return orders.stream().map(o -> Incidents.derive(o, threshold, now)).flatMap(Optional::stream)
            .sorted(Comparator.comparing(Views.Incident::since, Comparator.nullsLast(Comparator.naturalOrder()))).toList();
    }

    private static SourceStatus late(Source source) {
        return SourceStatus.of(source, SourceStatus.State.UNAVAILABLE, "No answer within the page time budget.", null);
    }

    static Views.Order view(UpOrder o) {
        return new Views.Order(o.orderId(), o.state(), StateLabels.label(o.state()), o.statusReason(), o.customerId(), o.sku(),
            o.quantity(), o.siteId(), o.reservationId(), o.createdAt(), o.updatedAt(),
            o.correlationId(), o.traceId());
    }

    private static String commitUrl(String repo, String ref) {
        return ref != null && ref.matches("[0-9a-f]{40}") ? "https://github.com/box1-org/" + repo + "/commit/" + ref : null;
    }

    private static String shortRef(String ref) {
        return ref.length() > 12 ? ref.substring(0, 12) : ref;
    }
}
