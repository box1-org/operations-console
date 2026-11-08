package org.box1.console;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.absent;
import static com.github.tomakehurst.wiremock.client.WireMock.anyUrl;
import static com.github.tomakehurst.wiremock.client.WireMock.equalTo;
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
import static org.hamcrest.Matchers.nullValue;

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
import io.restassured.specification.RequestSpecification;
import org.box1.console.security.AiopsToken;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * The Assistant (box1-docs#101): the person's token goes to agentic-operations and nowhere else, its refusals and
 * typed states reach the page in plain words, suggested actions stay proposals, and nothing is invented when the
 * service does not answer.
 */
@QuarkusTest
@TestSecurity(user = "otto", roles = {"console-viewer"})
class AssistantTest {
    private static final String TOKEN = "header." + Base64.getUrlEncoder().withoutPadding().encodeToString(
        "{\"resource_access\":{\"agentic-operations\":{\"roles\":[\"aiops-analyst\",\"other\"]}}}"
            .getBytes(StandardCharsets.UTF_8)) + ".signature";
    private static final String INCIDENT = "inc_ord_demo1";
    private static final String ANALYSIS = "ana_0123456789abcdef0123456789abcdef";
    private static final String COMPLETED = """
        {"analysisId":"%s","incidentId":"%s","orderId":"ord_demo1","incidentType":"AWAITING_ERP_TOO_LONG",
         "status":"COMPLETED","statusDetail":null,"createdAt":"2026-11-06T19:00:00Z","completedAt":"2026-11-06T19:00:04Z",
         "summary":"The ERP has not acknowledged the shipment.",
         "findings":[{"statement":"Fulfillment is awaiting ERP acknowledgement","evidenceRefs":["ev_4"],"confidence":"HIGH"}],
         "unknowns":["Telemetry alerts are unavailable"],
         "suggestedActions":[{"type":"ROLLBACK_DEPLOYMENT","description":"Roll back fulfillment-adapter",
           "expectedEffect":"Restores the previous adapter","rollback":"Re-apply the current revision","executable":false}],
         "evidence":[{"ref":"ev_4","type":"FULFILLMENT","source":"fulfillment-adapter","timestamp":"2026-11-06T18:59:00Z",
           "retrievedAt":"2026-11-06T19:00:01Z","retrievalStatus":"OK","detail":"awaiting ERP","link":"fulfillment-adapter:ful_1",
           "truncated":false,"data":{"secret":"raw evidence is never passed on"}},
          {"ref":"ev_10","type":"LOGS","source":"logging","retrievalStatus":"UNAVAILABLE","detail":"no central logging",
           "truncated":false}],
         "model":{"modelId":"box1-coder","contextProfile":"32k","promptTokens":4718,"completionTokens":222},
         "quality":{"citedFindings":1,"unsupportedAssertions":0,"droppedActions":0}}""".formatted(ANALYSIS, INCIDENT);

    /** Stands in for a signed-in session whose access token agentic-operations accepts. */
    static class SessionToken extends AiopsToken {
        private final Optional<String> token;

        SessionToken(Optional<String> token) {
            super(null, null, null);
            this.token = token;
        }

        @Override
        public Optional<String> forService() {
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
        QuarkusMock.installMockForType(new SessionToken(Optional.of(TOKEN)), AiopsToken.class);
    }

    private static RequestSpecification console() {
        return given().header("X-Box1-Console", "1").contentType("application/json").body(Map.of());
    }

    @Test
    void statusReflectsThePersonsOwnAiopsRoles() {
        given().get("/api/v1/assistant").then().statusCode(200).body("configured", is(true))
            .body("canAnalyze", is(true)).body("canView", is(true)).body("roles", is(List.of("aiops-analyst")));
        QuarkusMock.installMockForType(new SessionToken(Optional.of("header.e30.signature")), AiopsToken.class);
        given().get("/api/v1/assistant").then().statusCode(200).body("canAnalyze", is(false)).body("canView", is(false));
    }

    @Test
    void startingAnAnalysisSendsThePersonsTokenToAgenticOperationsOnly() {
        UpstreamStubs.server.stubFor(post(urlPathEqualTo("/aiops/api/v1/ai/incidents/" + INCIDENT + "/analyze"))
            .willReturn(aResponse().withStatus(202).withHeader("Content-Type", "application/json")
                .withBody("{\"analysisId\":\"" + ANALYSIS + "\",\"status\":\"QUEUED\",\"location\":\"/x\"}")));
        console().post("/api/v1/assistant/incidents/" + INCIDENT + "/analyses").then().statusCode(202)
            .body("analysisId", is(ANALYSIS)).body("incidentId", is(INCIDENT)).body("status", is("QUEUED"));
        UpstreamStubs.server.verify(postRequestedFor(urlPathEqualTo("/aiops/api/v1/ai/incidents/" + INCIDENT + "/analyze"))
            .withHeader("Authorization", equalTo("Bearer " + TOKEN)).withHeader("X-Correlation-Id", matching(".+")));
        UpstreamStubs.server.verify(0, postRequestedFor(urlPathMatching("/(order|inventory|fulfillment|asset|scenario)/.*")));
    }

    @Test
    void anAnalysisIsPassedOnWithoutRawEvidenceAndActionsStayProposals() {
        UpstreamStubs.server.stubFor(get(urlPathEqualTo("/aiops/api/v1/ai/analyses/" + ANALYSIS)).willReturn(Fixtures.json(COMPLETED)));
        String body = given().get("/api/v1/assistant/analyses/" + ANALYSIS).then().statusCode(200)
            .body("status", is("COMPLETED")).body("finished", is(true))
            .body("findings[0].evidenceRefs", is(List.of("ev_4")))
            .body("suggestedActions", hasSize(1)).body("suggestedActions[0].executed", is(false))
            .body("evidence", hasSize(2)).body("evidence[1].retrievalStatus", is("UNAVAILABLE"))
            .body("model.promptTokens", is(4718)).body("quality.citedFindings", is(1))
            .extract().asString();
        org.junit.jupiter.api.Assertions.assertFalse(body.contains("raw evidence"), "untrusted evidence data is not passed on");
        org.junit.jupiter.api.Assertions.assertFalse(body.contains("executable"), body);
        UpstreamStubs.server.verify(getRequestedFor(urlPathEqualTo("/aiops/api/v1/ai/analyses/" + ANALYSIS))
            .withHeader("Authorization", equalTo("Bearer " + TOKEN)));
    }

    @Test
    void aQueuedAnalysisIsNotFinished() {
        UpstreamStubs.server.stubFor(get(urlPathEqualTo("/aiops/api/v1/ai/analyses/" + ANALYSIS)).willReturn(Fixtures.json(
            "{\"analysisId\":\"" + ANALYSIS + "\",\"status\":\"RUNNING\",\"findings\":[],\"evidence\":[]}")));
        given().get("/api/v1/assistant/analyses/" + ANALYSIS).then().statusCode(200).body("finished", is(false))
            .body("summary", nullValue()).body("suggestedActions", hasSize(0));
    }

    @Test
    void aModelOutageIsATypedStateNotADiagnosis() {
        UpstreamStubs.server.stubFor(get(urlPathEqualTo("/aiops/api/v1/ai/analyses/" + ANALYSIS)).willReturn(Fixtures.json(
            "{\"analysisId\":\"" + ANALYSIS + "\",\"status\":\"MODEL_UNAVAILABLE\",\"statusDetail\":\"model did not answer\"}")));
        given().get("/api/v1/assistant/analyses/" + ANALYSIS).then().statusCode(200).body("finished", is(true))
            .body("status", is("MODEL_UNAVAILABLE")).body("summary", nullValue()).body("findings", hasSize(0));
    }

    @Test
    void anExpiredAnalysisSaysSoAndIsNeverRegenerated() {
        UpstreamStubs.server.stubFor(get(urlPathEqualTo("/aiops/api/v1/ai/analyses/" + ANALYSIS))
            .willReturn(aResponse().withStatus(404).withHeader("Content-Type", "application/problem+json")
                .withBody("{\"code\":\"ANALYSIS_NOT_FOUND\",\"detail\":\"unknown\"}")));
        given().get("/api/v1/assistant/analyses/" + ANALYSIS).then().statusCode(404)
            .body("code", is("ANALYSIS_EXPIRED")).body("detail", containsString("never regenerated"));
        UpstreamStubs.server.verify(0, postRequestedFor(anyUrl()));
    }

    @Test
    void aFullModelQueueIsBusyWithRetryAfter() {
        UpstreamStubs.server.stubFor(post(urlPathMatching("/aiops/.*")).willReturn(aResponse().withStatus(429)
            .withHeader("Retry-After", "30").withHeader("Content-Type", "application/problem+json")
            .withBody("{\"code\":\"BUSY\",\"detail\":\"analysis queue is full\"}")));
        console().post("/api/v1/assistant/incidents/" + INCIDENT + "/analyses").then().statusCode(429)
            .header("Retry-After", "30").body("code", is("ASSISTANT_BUSY")).body("detail", is("analysis queue is full"));
    }

    @Test
    void anUnknownIncidentIsNotFound() {
        UpstreamStubs.server.stubFor(post(urlPathMatching("/aiops/.*")).willReturn(aResponse().withStatus(404)));
        console().post("/api/v1/assistant/incidents/" + INCIDENT + "/analyses").then().statusCode(404)
            .body("code", is("INCIDENT_NOT_FOUND"));
    }

    @Test
    void aRefusalNamesTheAiopsRole() {
        UpstreamStubs.server.stubFor(post(urlPathMatching("/aiops/.*")).willReturn(aResponse().withStatus(403)));
        console().post("/api/v1/assistant/incidents/" + INCIDENT + "/analyses").then().statusCode(403)
            .body("code", is("AIOPS_ROLE_REQUIRED")).body("detail", containsString("aiops-analyst"));
        UpstreamStubs.server.stubFor(get(urlPathMatching("/aiops/.*")).willReturn(aResponse().withStatus(401)));
        given().get("/api/v1/assistant/analyses/" + ANALYSIS).then().statusCode(403)
            .body("code", is("AIOPS_ROLE_REQUIRED")).body("detail", containsString("aiops-viewer"));
    }

    @Test
    void noAnswerIsUnavailableNotAnInventedResult() {
        UpstreamStubs.server.stubFor(get(urlPathMatching("/aiops/.*")).willReturn(aResponse().withFault(Fault.CONNECTION_RESET_BY_PEER)));
        given().get("/api/v1/assistant/analyses/" + ANALYSIS).then().statusCode(503).body("code", is("UPSTREAM_UNAVAILABLE"));
        UpstreamStubs.server.stubFor(post(urlPathMatching("/aiops/.*")).willReturn(aResponse().withStatus(500)));
        console().post("/api/v1/assistant/incidents/" + INCIDENT + "/analyses").then().statusCode(503)
            .body("code", is("UPSTREAM_UNAVAILABLE"));
    }

    @Test
    void invalidIdsAreRejectedBeforeAnyUpstreamCall() {
        console().post("/api/v1/assistant/incidents/inc_../analyses").then().statusCode(org.hamcrest.Matchers.oneOf(400, 404));
        console().post("/api/v1/assistant/incidents/inc_asset_1/analyses").then().statusCode(400);
        given().get("/api/v1/assistant/analyses/ana_nothex").then().statusCode(400);
        UpstreamStubs.server.verify(0, postRequestedFor(anyUrl()));
        UpstreamStubs.server.verify(0, getRequestedFor(anyUrl()));
    }

    @Test
    void startingAnAnalysisNeedsTheConsoleHeader() {
        given().contentType("application/json").body(Map.of()).post("/api/v1/assistant/incidents/" + INCIDENT + "/analyses")
            .then().statusCode(403).body("code", is("CONSOLE_HEADER_REQUIRED"));
        UpstreamStubs.server.verify(0, postRequestedFor(anyUrl()));
    }

    @Test
    void withoutASessionTokenNothingIsSentWithAnAuthorizationHeader() {
        QuarkusMock.installMockForType(new SessionToken(Optional.empty()), AiopsToken.class);
        UpstreamStubs.server.stubFor(get(urlPathMatching("/aiops/.*")).willReturn(aResponse().withStatus(401)));
        given().get("/api/v1/assistant/analyses/" + ANALYSIS).then().statusCode(403);
        UpstreamStubs.server.verify(getRequestedFor(urlPathMatching("/aiops/.*")).withHeader("Authorization", absent()));
    }

    // ---- chat (box1-docs#101) ----

    private static final String CONV = "conv_0123456789abcdef0123456789abcdef";

    @Test
    void startingAConversationSendsThePersonsTokenToAgenticOperationsOnly() {
        UpstreamStubs.server.stubFor(post(urlPathEqualTo("/aiops/api/v1/ai/conversations")).willReturn(aResponse()
            .withStatus(201).withHeader("Content-Type", "application/json").withBody("{\"conversationId\":\"" + CONV + "\"}")));
        console().post("/api/v1/assistant/conversations").then().statusCode(201).body("conversationId", is(CONV));
        UpstreamStubs.server.verify(postRequestedFor(urlPathEqualTo("/aiops/api/v1/ai/conversations"))
            .withHeader("Authorization", equalTo("Bearer " + TOKEN)));
    }

    @Test
    void aQuestionIsPassedOnAndQueued() {
        UpstreamStubs.server.stubFor(post(urlPathEqualTo("/aiops/api/v1/ai/conversations/" + CONV + "/messages"))
            .willReturn(aResponse().withStatus(202).withHeader("Content-Type", "application/json")
                .withBody("{\"conversationId\":\"" + CONV + "\",\"turnId\":\"turn_1\",\"status\":\"QUEUED\"}")));
        given().header("X-Box1-Console", "1").contentType("application/json").body(Map.of("text", "What is ord_1 doing?"))
            .post("/api/v1/assistant/conversations/" + CONV + "/messages").then().statusCode(202)
            .body("turnId", is("turn_1")).body("status", is("QUEUED"));
        UpstreamStubs.server.verify(postRequestedFor(urlPathEqualTo("/aiops/api/v1/ai/conversations/" + CONV + "/messages"))
            .withHeader("Authorization", equalTo("Bearer " + TOKEN))
            .withRequestBody(com.github.tomakehurst.wiremock.client.WireMock.equalToJson("{\"text\":\"What is ord_1 doing?\"}")));
    }

    @Test
    void questionsAreBoundedBeforeAnyUpstreamCall() {
        for (String text : new String[] {"", "   ", "x".repeat(2001)}) {
            given().header("X-Box1-Console", "1").contentType("application/json").body(Map.of("text", text))
                .post("/api/v1/assistant/conversations/" + CONV + "/messages").then().statusCode(400);
        }
        given().header("X-Box1-Console", "1").contentType("application/json").body(Map.of("text", "hi"))
            .post("/api/v1/assistant/conversations/conv_nothex/messages").then().statusCode(400);
        UpstreamStubs.server.verify(0, postRequestedFor(anyUrl()));
    }

    @Test
    void chatRefusalsAreTyped() {
        String path = "/aiops/api/v1/ai/conversations/" + CONV + "/messages";
        RequestSpecification ask = given().header("X-Box1-Console", "1").contentType("application/json").body(Map.of("text", "hi"));
        UpstreamStubs.server.stubFor(post(urlPathEqualTo(path)).willReturn(aResponse().withStatus(409)
            .withHeader("Content-Type", "application/problem+json").withBody("{\"code\":\"TURN_IN_PROGRESS\",\"detail\":\"still answering\"}")));
        ask.post("/api/v1/assistant/conversations/" + CONV + "/messages").then().statusCode(409).body("code", is("TURN_IN_PROGRESS"));
        UpstreamStubs.server.stubFor(post(urlPathEqualTo(path)).willReturn(aResponse().withStatus(409)
            .withHeader("Content-Type", "application/problem+json").withBody("{\"code\":\"CONVERSATION_FULL\",\"detail\":\"20 messages\"}")));
        given().header("X-Box1-Console", "1").contentType("application/json").body(Map.of("text", "hi"))
            .post("/api/v1/assistant/conversations/" + CONV + "/messages").then().statusCode(409).body("code", is("CONVERSATION_FULL"));
        UpstreamStubs.server.stubFor(post(urlPathEqualTo(path)).willReturn(aResponse().withStatus(429).withHeader("Retry-After", "30")));
        given().header("X-Box1-Console", "1").contentType("application/json").body(Map.of("text", "hi"))
            .post("/api/v1/assistant/conversations/" + CONV + "/messages").then().statusCode(429)
            .header("Retry-After", "30").body("code", is("ASSISTANT_BUSY"));
        UpstreamStubs.server.stubFor(post(urlPathEqualTo(path)).willReturn(aResponse().withStatus(404)));
        given().header("X-Box1-Console", "1").contentType("application/json").body(Map.of("text", "hi"))
            .post("/api/v1/assistant/conversations/" + CONV + "/messages").then().statusCode(404)
            .body("code", is("CONVERSATION_EXPIRED"));
        UpstreamStubs.server.stubFor(get(urlPathEqualTo("/aiops/api/v1/ai/conversations/" + CONV)).willReturn(aResponse().withStatus(403)));
        given().get("/api/v1/assistant/conversations/" + CONV).then().statusCode(403).body("code", is("AIOPS_ROLE_REQUIRED"));
    }

    @Test
    void aConversationShowsAnswersOnlyForAnsweredTurns() {
        UpstreamStubs.server.stubFor(get(urlPathEqualTo("/aiops/api/v1/ai/conversations/" + CONV)).willReturn(Fixtures.json("""
            {"conversationId":"%s","createdAt":"2026-11-08T10:00:00Z","turns":[
             {"turnId":"turn_1","question":"q1","status":"COMPLETED","answer":"ord_1 waits on the ERP",
              "steps":[{"tool":"get_order_timeline","target":"ord_1","decision":"ok","retrievalStatus":"OK","durationMs":12}],
              "model":{"modelId":"box1-coder","modelCalls":2,"toolCalls":1,"promptTokens":900,"completionTokens":40}},
             {"turnId":"turn_2","question":"q2","status":"MODEL_UNAVAILABLE","answer":"should not be shown","steps":[]},
             {"turnId":"turn_3","question":"q3","status":"RUNNING","steps":[]}]}""".formatted(CONV))));
        given().get("/api/v1/assistant/conversations/" + CONV).then().statusCode(200)
            .body("turns[0].answer", is("ord_1 waits on the ERP")).body("turns[0].finished", is(true))
            .body("turns[0].steps[0].tool", is("get_order_timeline")).body("turns[0].steps[0].target", is("ord_1"))
            .body("turns[0].model.toolCalls", is(1))
            .body("turns[1].answer", nullValue()).body("turns[1].finished", is(true))
            .body("turns[2].finished", is(false));
    }
}
