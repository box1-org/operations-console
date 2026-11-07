package org.box1.console;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.is;

import java.util.Map;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import io.quarkus.test.security.TestSecurity;
import org.junit.jupiter.api.Test;

/** Without token forwarding the Assistant says it is not connected instead of calling agentic-operations (box1-docs#101). */
@QuarkusTest
@TestProfile(AssistantNotConfiguredTest.NoForwarding.class)
@TestSecurity(user = "otto", roles = {"console-viewer"})
class AssistantNotConfiguredTest {
    public static class NoForwarding implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return Map.of("console.upstream.agentic-operations-forward-token", "false");
        }
    }

    @Test
    void theAssistantReportsItselfNotConfigured() {
        given().get("/api/v1/assistant").then().statusCode(200).body("configured", is(false)).body("canAnalyze", is(false));
        given().header("X-Box1-Console", "1").contentType("application/json").body(Map.of())
            .post("/api/v1/assistant/incidents/inc_ord_demo1/analyses").then().statusCode(503).body("code", is("NOT_CONFIGURED"));
        given().get("/api/v1/assistant/analyses/ana_0123456789abcdef0123456789abcdef").then().statusCode(503)
            .body("code", is("NOT_CONFIGURED"));
    }
}
