package org.box1.console.api;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import com.fasterxml.jackson.core.type.TypeReference;
import jakarta.annotation.security.RolesAllowed;
import jakarta.validation.constraints.Pattern;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.box1.console.security.AiopsToken;
import org.box1.console.security.ConsoleRoles;
import org.box1.console.upstream.Payloads.UpAnalysis;
import org.box1.console.upstream.Payloads.UpAnalysisSubmitted;
import org.box1.console.upstream.Payloads.UpEvidence;
import org.box1.console.upstream.Payloads.UpFinding;
import org.box1.console.upstream.Payloads.UpSuggestedAction;
import org.box1.console.upstream.Source;
import org.box1.console.upstream.UpstreamConfig;
import org.box1.console.upstream.UpstreamResponse;
import org.box1.console.upstream.Upstreams;

/**
 * The Assistant (box1-docs#101): a console-side chat over agentic-operations' incident analysis (box1-docs#20). The
 * console runs no model and holds no analyses; it starts an analysis and reads it back with the person's own token, so
 * agentic-operations' aiops-viewer/aiops-analyst roles decide what they may do and its audit names them. Suggested
 * actions are passed on as proposals only; there is no endpoint that executes one.
 */
@Path("/api/v1/assistant")
@Produces(MediaType.APPLICATION_JSON)
public class AssistantResource {
    /** The console's incident IDs for orders ({@code inc_<orderId>}), as agentic-operations accepts them. */
    static final String INCIDENT_ID = "^inc_ord_[A-Za-z0-9_-]{1,76}$";
    static final String ANALYSIS_ID = "^ana_[0-9a-f]{32}$";
    private static final String SOURCE = Source.AGENTIC_OPERATIONS.id();
    private static final List<String> WORKING = List.of("QUEUED", "RUNNING");

    private static final TypeReference<UpAnalysisSubmitted> SUBMITTED = new TypeReference<>() { };
    private static final TypeReference<UpAnalysis> ANALYSIS = new TypeReference<>() { };

    private final Upstreams upstreams;
    private final UpstreamConfig config;
    private final AiopsToken token;

    public AssistantResource(Upstreams upstreams, UpstreamConfig config, AiopsToken token) {
        this.upstreams = upstreams;
        this.config = config;
        this.token = token;
    }

    @GET
    @RolesAllowed({ConsoleRoles.VIEWER, ConsoleRoles.OPERATOR, ConsoleRoles.DEVELOPER})
    public Views.AssistantStatus status() {
        boolean configured = upstreams.configured(Source.AGENTIC_OPERATIONS) && config.agenticOperationsForwardToken();
        List<String> roles = configured ? token.roles() : List.of();
        boolean analyst = roles.contains(AiopsToken.ANALYST);
        return new Views.AssistantStatus(configured, analyst || roles.contains(AiopsToken.VIEWER), analyst, roles);
    }

    @POST
    @Path("/incidents/{incidentId}/analyses")
    @Consumes(MediaType.APPLICATION_JSON)
    @RolesAllowed({ConsoleRoles.VIEWER, ConsoleRoles.OPERATOR, ConsoleRoles.DEVELOPER})
    public Response analyze(@PathParam("incidentId") @Pattern(regexp = INCIDENT_ID) String incidentId) {
        requireConfigured();
        UpstreamResponse<UpAnalysisSubmitted> r = upstreams.post(Source.AGENTIC_OPERATIONS,
            "/api/v1/ai/incidents/" + incidentId + "/analyze", token.forService(),
            Map.of("X-Correlation-Id", UUID.randomUUID().toString()), null, SUBMITTED, config.assistantSubmitTimeout());
        if (r.status() == 429) {
            String retryAfter = r.headers() == null ? null : r.headers().firstValue("Retry-After").orElse(null);
            Problem busy = Problem.upstream(429, "The assistant is busy", Optional.ofNullable(r.problemDetail())
                .orElse("Other analyses are queued for the model. Try again shortly."), "ASSISTANT_BUSY", SOURCE);
            Response.ResponseBuilder out = Response.status(429).type(Problem.MEDIA_TYPE).entity(busy);
            if (retryAfter != null && retryAfter.matches("^[0-9]{1,4}$")) {
                out.header("Retry-After", retryAfter);
            }
            return out.build();
        }
        UpAnalysisSubmitted s = require(r, "No incident for this order: agentic-operations found no such order.",
            "INCIDENT_NOT_FOUND", "Starting an analysis needs the aiops-analyst role on agentic-operations.");
        if (s.analysisId() == null || !s.analysisId().matches(ANALYSIS_ID)) {
            throw new Problem.Failure(Problem.upstream(503, "Assistant did not answer",
                "agentic-operations returned no usable analysis ID.", "UPSTREAM_UNAVAILABLE", SOURCE));
        }
        return Response.status(202).entity(new Views.AnalysisSubmitted(s.analysisId(), incidentId, s.status())).build();
    }

    @GET
    @Path("/analyses/{analysisId}")
    @RolesAllowed({ConsoleRoles.VIEWER, ConsoleRoles.OPERATOR, ConsoleRoles.DEVELOPER})
    public Views.Analysis analysis(@PathParam("analysisId") @Pattern(regexp = ANALYSIS_ID) String analysisId) {
        requireConfigured();
        UpAnalysis a = require(upstreams.get(Source.AGENTIC_OPERATIONS, "/api/v1/ai/analyses/" + analysisId,
            token.forService(), ANALYSIS),
            "This analysis has expired, was evicted, or was lost when agentic-operations restarted. Analyses are never "
                + "regenerated; start a new one.", "ANALYSIS_EXPIRED",
            "Reading analyses needs the aiops-viewer or aiops-analyst role on agentic-operations.");
        return view(a);
    }

    // ---- helpers ----

    private void requireConfigured() {
        if (!upstreams.configured(Source.AGENTIC_OPERATIONS) || !config.agenticOperationsForwardToken()) {
            throw new Problem.Failure(Problem.upstream(503, "Assistant not configured",
                "The console is not connected to agentic-operations.", "NOT_CONFIGURED", SOURCE));
        }
    }

    /** The upstream body, or a Problem that says plainly why not. agentic-operations' own 4xx messages are shown. */
    private static <T> T require(UpstreamResponse<T> r, String notFound, String notFoundCode, String roleHint) {
        if (r.ok()) {
            return r.body();
        }
        Optional<String> detail = Optional.ofNullable(r.problemDetail()).filter(d -> !d.isBlank());
        throw new Problem.Failure(switch (r.status()) {
            case 404 -> Problem.upstream(404, "Not found", notFound, notFoundCode, SOURCE);
            case 400 -> Problem.upstream(400, "Request rejected", detail.orElse("agentic-operations rejected the request."),
                "UPSTREAM_REJECTED", SOURCE);
            case 401, 403 -> Problem.upstream(403, "Refused by agentic-operations",
                detail.map(d -> d + ". " + roleHint).orElse(roleHint), "AIOPS_ROLE_REQUIRED", SOURCE);
            default -> Problem.upstream(503, "Assistant did not answer",
                "agentic-operations is unavailable: " + r.sourceStatus().detail(), "UPSTREAM_UNAVAILABLE", SOURCE);
        });
    }

    static Views.Analysis view(UpAnalysis a) {
        return new Views.Analysis(a.analysisId(), a.incidentId(), a.orderId(), a.incidentType(), a.status(),
            a.status() != null && !WORKING.contains(a.status()), a.statusDetail(), a.createdAt(), a.completedAt(), a.summary(),
            list(a.findings()).stream().map(AssistantResource::view).toList(),
            list(a.unknowns()),
            list(a.suggestedActions()).stream().map(AssistantResource::view).toList(),
            list(a.evidence()).stream().map(AssistantResource::view).toList(),
            a.model() == null ? null : new Views.ModelInfo(a.model().modelId(), a.model().contextProfile(),
                a.model().promptTokens(), a.model().completionTokens()),
            a.quality() == null ? null : new Views.AnalysisQuality(zero(a.quality().citedFindings()),
                zero(a.quality().unsupportedAssertions()), zero(a.quality().droppedActions())));
    }

    private static Views.Finding view(UpFinding f) {
        return new Views.Finding(f.statement(), list(f.evidenceRefs()), f.confidence());
    }

    private static Views.SuggestedAction view(UpSuggestedAction s) {
        return new Views.SuggestedAction(s.type(), s.description(), s.expectedEffect(), s.rollback(), false);
    }

    private static Views.Evidence view(UpEvidence e) {
        return new Views.Evidence(e.ref(), e.type(), e.source(), e.timestamp(), e.retrievedAt(), e.retrievalStatus(),
            e.detail(), e.link(), Boolean.TRUE.equals(e.truncated()));
    }

    private static <T> List<T> list(List<T> in) {
        return in == null ? List.of() : in;
    }

    private static int zero(Integer i) {
        return i == null ? 0 : i;
    }
}
