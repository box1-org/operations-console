package org.box1.console.api;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;

import com.fasterxml.jackson.core.type.TypeReference;
import jakarta.annotation.security.RolesAllowed;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.box1.console.domain.ConsoleReads;
import org.box1.console.security.ConsoleRoles;
import org.box1.console.security.ScenarioToken;
import org.box1.console.upstream.Payloads.UpAudit;
import org.box1.console.upstream.Payloads.UpFixtures;
import org.box1.console.upstream.Payloads.UpReset;
import org.box1.console.upstream.Payloads.UpRun;
import org.box1.console.upstream.Payloads.UpScenario;
import org.box1.console.upstream.Payloads.UpSeed;
import org.box1.console.upstream.Source;
import org.box1.console.upstream.SourceStatus;
import org.box1.console.upstream.UpstreamConfig;
import org.box1.console.upstream.UpstreamResponse;
import org.box1.console.upstream.Upstreams;

/**
 * Demo control through the scenario controller (box1-docs#19). The console checks its own roles (viewer reads,
 * operator acts); the controller then checks the person's own scenario roles from the forwarded token and records
 * the person in its audit. The console holds no scenario state and offers no action the controller does not have.
 */
@Path("/api/v1")
@Produces(MediaType.APPLICATION_JSON)
public class ScenarioControlResource {
    static final String NAME = "^[a-z][a-z0-9-]{1,48}$";
    static final String RUN_ID = "^scn_[0-9a-f]{20}$";
    static final String STEP = "^[a-z][a-z0-9-]{1,40}$";
    private static final String SOURCE = Source.SCENARIO_CONTROLLER.id();

    private static final TypeReference<List<UpScenario>> SCENARIOS = new TypeReference<>() { };
    private static final TypeReference<List<UpRun>> RUNS = new TypeReference<>() { };
    private static final TypeReference<UpRun> RUN = new TypeReference<>() { };
    private static final TypeReference<List<UpAudit>> AUDIT = new TypeReference<>() { };
    private static final TypeReference<UpFixtures> FIXTURES = new TypeReference<>() { };
    private static final TypeReference<UpSeed> SEED = new TypeReference<>() { };
    private static final TypeReference<UpReset> RESET = new TypeReference<>() { };

    private final Upstreams upstreams;
    private final UpstreamConfig config;
    private final ScenarioToken token;
    private final ConsoleReads reads;

    public ScenarioControlResource(Upstreams upstreams, UpstreamConfig config, ScenarioToken token, ConsoleReads reads) {
        this.upstreams = upstreams;
        this.config = config;
        this.token = token;
        this.reads = reads;
    }

    /** Start body: the TTL is optional; the controller applies the scenario's default and maximum. */
    public record StartScenario(@Min(30) @Max(3600) Integer ttlSeconds) {
    }

    /** An operator's confirmation of a step the controller cannot observe (for example the ERP worker restarting). */
    public record ConfirmStep(@NotNull @Pattern(regexp = STEP) String step) {
    }

    // ---- reads (any console role) ----

    @GET
    @Path("/scenarios")
    @RolesAllowed({ConsoleRoles.VIEWER, ConsoleRoles.OPERATOR, ConsoleRoles.DEVELOPER})
    public Views.ScenarioList scenarios() {
        String telemetry = reads.settings().telemetryConsoleUrl();
        if (!upstreams.configured(Source.SCENARIO_CONTROLLER)) {
            return new Views.ScenarioList(List.of(), telemetry, List.of(notConfigured()));
        }
        UpstreamResponse<List<UpScenario>> r = upstreams.get(Source.SCENARIO_CONTROLLER, "/internal/v1/scenarios",
            token.forController(), SCENARIOS);
        List<Views.Scenario> items = r.ok() ? r.body().stream().map(ScenarioControlResource::view).toList() : List.of();
        return new Views.ScenarioList(items, telemetry, List.of(refusalAware(r)));
    }

    @GET
    @Path("/scenario-runs")
    @RolesAllowed({ConsoleRoles.VIEWER, ConsoleRoles.OPERATOR, ConsoleRoles.DEVELOPER})
    public Views.ScenarioRunList runs() {
        if (!upstreams.configured(Source.SCENARIO_CONTROLLER)) {
            return new Views.ScenarioRunList(List.of(), List.of(notConfigured()));
        }
        UpstreamResponse<List<UpRun>> r = upstreams.get(Source.SCENARIO_CONTROLLER, "/internal/v1/runs?limit=20",
            token.forController(), RUNS);
        return new Views.ScenarioRunList(r.ok() ? r.body().stream().map(ScenarioControlResource::view).toList() : List.of(),
            List.of(refusalAware(r)));
    }

    @GET
    @Path("/scenario-runs/{scenarioRunId}")
    @RolesAllowed({ConsoleRoles.VIEWER, ConsoleRoles.OPERATOR, ConsoleRoles.DEVELOPER})
    public Views.ScenarioRun run(@PathParam("scenarioRunId") @Pattern(regexp = RUN_ID) String runId) {
        requireConfigured();
        return view(require(upstreams.get(Source.SCENARIO_CONTROLLER, "/internal/v1/runs/" + runId, token.forController(), RUN),
            "No such scenario run."));
    }

    @GET
    @Path("/scenario-audit")
    @RolesAllowed({ConsoleRoles.VIEWER, ConsoleRoles.OPERATOR, ConsoleRoles.DEVELOPER})
    public Views.ScenarioAuditList audit() {
        if (!upstreams.configured(Source.SCENARIO_CONTROLLER)) {
            return new Views.ScenarioAuditList(List.of(), List.of(notConfigured()));
        }
        UpstreamResponse<List<UpAudit>> r = upstreams.get(Source.SCENARIO_CONTROLLER, "/internal/v1/audit?limit=50",
            token.forController(), AUDIT);
        return new Views.ScenarioAuditList(r.ok() ? r.body().stream().map(ScenarioControlResource::view).toList() : List.of(),
            List.of(refusalAware(r)));
    }

    @GET
    @Path("/scenario-fixtures")
    @RolesAllowed({ConsoleRoles.VIEWER, ConsoleRoles.OPERATOR, ConsoleRoles.DEVELOPER})
    public Views.ScenarioFixtures fixtures() {
        if (!upstreams.configured(Source.SCENARIO_CONTROLLER)) {
            return new Views.ScenarioFixtures(List.of(), List.of(), List.of(), List.of(), List.of(notConfigured()));
        }
        UpstreamResponse<UpFixtures> r = upstreams.get(Source.SCENARIO_CONTROLLER, "/internal/v1/fixtures",
            token.forController(), FIXTURES);
        if (!r.ok()) {
            return new Views.ScenarioFixtures(List.of(), List.of(), List.of(), List.of(), List.of(refusalAware(r)));
        }
        UpFixtures f = r.body();
        return new Views.ScenarioFixtures(
            map(f.sites(), s -> new Views.FixtureSite(s.siteId(), s.displayName(), s.status())),
            map(f.customers(), c -> new Views.FixtureCustomer(c.customerId(), c.displayName())),
            map(f.products(), p -> new Views.FixtureProduct(p.sku(), p.displayName())),
            map(f.stock(), s -> new Views.FixtureStock(s.siteId(), s.sku(), s.openingQuantity())),
            List.of(r.sourceStatus()));
    }

    // ---- actions (console-operator; the controller also requires scenario-operator) ----

    @POST
    @Path("/scenario-fixtures/seed")
    @Consumes(MediaType.APPLICATION_JSON)
    @RolesAllowed(ConsoleRoles.OPERATOR)
    public Views.SeedResult seed() {
        requireConfigured();
        UpSeed s = require(action("/internal/v1/fixtures/seed", Map.of(), SEED), "The scenario controller has no fixture seeding.");
        return new Views.SeedResult(s.created() == null ? 0 : s.created(), s.unchanged() == null ? 0 : s.unchanged());
    }

    @POST
    @Path("/scenarios/{name}/start")
    @Consumes(MediaType.APPLICATION_JSON)
    @RolesAllowed(ConsoleRoles.OPERATOR)
    public Response start(@PathParam("name") @Pattern(regexp = NAME) String name, @Valid StartScenario body) {
        requireConfigured();
        Map<String, Object> request = body == null || body.ttlSeconds() == null ? Map.of() : Map.of("ttlSeconds", body.ttlSeconds());
        UpstreamResponse<UpRun> r = action("/internal/v1/scenarios/" + name + "/start", request, RUN);
        return Response.status(202).entity(view(require(r, "No such scenario."))).build();
    }

    @POST
    @Path("/scenarios/{name}/stop")
    @Consumes(MediaType.APPLICATION_JSON)
    @RolesAllowed(ConsoleRoles.OPERATOR)
    public Views.ScenarioRun stop(@PathParam("name") @Pattern(regexp = NAME) String name) {
        requireConfigured();
        return view(require(action("/internal/v1/scenarios/" + name + "/stop", Map.of(), RUN), "No active run of this scenario."));
    }

    @POST
    @Path("/scenarios/{name}/reset")
    @Consumes(MediaType.APPLICATION_JSON)
    @RolesAllowed(ConsoleRoles.OPERATOR)
    public Views.ResetResult reset(@PathParam("name") @Pattern(regexp = NAME) String name) {
        requireConfigured();
        UpReset r = require(action("/internal/v1/scenarios/" + name + "/reset", Map.of(), RESET), "No such scenario.");
        return new Views.ResetResult(r.scenarioRunId(), r.resetId(), r.resetResult(), r.resetDetail());
    }

    @POST
    @Path("/scenario-runs/{scenarioRunId}/confirm")
    @Consumes(MediaType.APPLICATION_JSON)
    @RolesAllowed(ConsoleRoles.OPERATOR)
    public Views.ScenarioRun confirm(@PathParam("scenarioRunId") @Pattern(regexp = RUN_ID) String runId,
        @Valid @NotNull ConfirmStep body) {
        requireConfigured();
        return view(require(action("/internal/v1/runs/" + runId + "/confirm", Map.of("step", body.step()), RUN),
            "No such scenario run."));
    }

    // ---- helpers ----

    private <T> UpstreamResponse<T> action(String path, Object body, TypeReference<T> type) {
        return upstreams.post(Source.SCENARIO_CONTROLLER, path, token.forController(), correlation(), body, type,
            config.scenarioActionTimeout());
    }

    private static Map<String, String> correlation() {
        return Map.of("X-Correlation-Id", UUID.randomUUID().toString());
    }

    private void requireConfigured() {
        if (!upstreams.configured(Source.SCENARIO_CONTROLLER)) {
            throw new Problem.Failure(Problem.upstream(503, "Scenario controller not configured",
                "The console has no scenario controller URL.", "NOT_CONFIGURED", SOURCE));
        }
    }

    /** The upstream body, or a Problem that says plainly why not. The controller's own 4xx messages are shown. */
    static <T> T require(UpstreamResponse<T> r, String notFound) {
        if (r.ok()) {
            return r.body();
        }
        Optional<String> detail = Optional.ofNullable(r.problemDetail());
        throw new Problem.Failure(switch (r.status()) {
            case 404 -> Problem.upstream(404, "Not found", detail.orElse(notFound), "NOT_FOUND", SOURCE);
            case 400 -> Problem.upstream(400, "Request rejected", detail.orElse("The scenario controller rejected the request."),
                "UPSTREAM_REJECTED", SOURCE);
            case 409 -> Problem.upstream(409, "Not possible right now", detail.orElse("The scenario controller refused this now."),
                "SCENARIO_CONFLICT", SOURCE);
            case 401, 403 -> Problem.upstream(403, "Refused by the scenario controller", detail
                .filter(d -> !d.isBlank())
                .map(d -> d + ". Starting, stopping, resetting and seeding need the scenario-operator role on the scenario controller.")
                .orElse("You need the scenario-operator role on the scenario controller."), "SCENARIO_ROLE_REQUIRED", SOURCE);
            default -> Problem.upstream(503, "Scenario controller did not answer",
                "The outcome is unknown: " + r.sourceStatus().detail() + " Check the run list before trying again.",
                "UPSTREAM_UNAVAILABLE", SOURCE);
        });
    }

    /** A refusal of the person's token is reported as such, not as the console's credentials. */
    private static SourceStatus refusalAware(UpstreamResponse<?> r) {
        SourceStatus s = r.sourceStatus();
        if (s.status() == SourceStatus.State.NOT_AUTHORIZED) {
            return SourceStatus.of(Source.SCENARIO_CONTROLLER, SourceStatus.State.NOT_AUTHORIZED,
                "The scenario controller refused your session (HTTP " + r.status()
                    + "). You need a scenario-viewer or scenario-operator role on it.", s.latencyMs());
        }
        return s;
    }

    private static SourceStatus notConfigured() {
        return SourceStatus.of(Source.SCENARIO_CONTROLLER, SourceStatus.State.NOT_CONFIGURED,
            "The scenario controller (box1-docs#19) is not configured for this console.", null);
    }

    private static <A, B> List<B> map(List<A> in, Function<A, B> f) {
        return in == null ? List.of() : in.stream().map(f).toList();
    }

    static Views.Scenario view(UpScenario s) {
        return new Views.Scenario(s.name(), s.title(), s.description(), s.mechanism(), s.availability(), s.notPossibleReason(),
            s.defaultDurationSeconds(), s.maxDurationSeconds(), s.expectedObservation(), s.resetAction(),
            s.operatorSteps() == null ? List.of() : s.operatorSteps());
    }

    static Views.ScenarioAudit view(UpAudit a) {
        return new Views.ScenarioAudit(a.seq(), a.scenarioRunId(), a.scenario(), a.action(), a.outcome(), a.actor(),
            a.environment(), a.detail(), a.occurredAt(), a.stardate());
    }

    static Views.ScenarioRun view(UpRun r) {
        return new Views.ScenarioRun(r.scenarioRunId(), r.scenario(), r.title(), r.mode(), r.status(), r.detail(),
            r.operatorStep(), r.operatorStepId(), r.actor(), r.environment(), r.ttlSeconds(), r.correlationId(), r.startedAt(),
            r.startedStardate(), r.expiresAt(), r.endedAt(), r.resetResult(), r.resetDetail(), r.resetAt(),
            r.audit() == null ? null : r.audit().stream().map(ScenarioControlResource::view).toList());
    }
}
