package org.box1.console;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItems;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.startsWith;
import static org.junit.jupiter.api.Assertions.assertFalse;

import java.util.List;
import java.util.Map;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.oidc.server.OidcWiremockTestResource;
import io.quarkus.test.security.TestSecurity;
import io.restassured.response.ValidatableResponse;
import org.box1.console.Contract.Op;
import org.junit.jupiter.api.Test;

/** Decision D-003: every role check is in the backend; anonymous calls get 401 and missing roles 403. */
@QuarkusTest
@QuarkusTestResource(value = OidcWiremockTestResource.class, restrictToAnnotatedClass = false)
@QuarkusTestResource(value = UpstreamStubs.class, restrictToAnnotatedClass = false)
class ConsoleSecurityTest {
    private static final Map<String, String> BODY = Map.of("customerId", "cust_demo_ada", "sku", "SKU-42", "siteId", "site_east");

    private static ValidatableResponse call(Op op, boolean withConsoleHeader) {
        var request = given().redirects().follow(false).header("Idempotency-Key", "k-1");
        if (withConsoleHeader) {
            request = request.header("X-Box1-Console", "1");
        }
        if ("POST".equals(op.method())) {
            return request.contentType("application/json").body(Map.of("customerId", "cust_demo_ada", "sku", "SKU-42",
                "quantity", 1, "siteId", "site_east")).post(op.concrete()).then();
        }
        return request.get(op.concrete()).then();
    }

    @Test
    void contractListsEveryConsoleOperation() {
        List<Op> ops = Contract.operations();
        assertFalse(ops.isEmpty());
        assertFalse(ops.stream().anyMatch(o -> !o.path().startsWith("/api/v1/")), "console API lives under /api/v1");
    }

    @Test
    void anonymousCallsToEveryConsoleApiPathGet401ProblemJson() {
        for (Op op : Contract.operations()) {
            call(op, true).statusCode(401).contentType(startsWith("application/problem+json"))
                .body("code", is("SESSION_REQUIRED")).header("Location", (String) null);
        }
    }

    @Test
    void anonymousPageNavigationRedirectsToKeycloak() {
        given().redirects().follow(false).accept("text/html").get("/orders/ord_1").then().statusCode(302)
            .header("Location", containsString("/realms/quarkus?response_type=code"))
            .header("Location", containsString("code_challenge_method=S256"));
    }

    @Test
    @TestSecurity(user = "nobody")
    void signedInWithoutRolesGets403OnEveryRoleProtectedPath() {
        for (Op op : Contract.operations()) {
            if (op.operationId().equals("getMe")) {
                continue;
            }
            call(op, true).statusCode(403).contentType(startsWith("application/problem+json")).body("code", is("ROLE_REQUIRED"));
        }
        given().get("/api/v1/me").then().statusCode(200).body("username", is("nobody")).body("roles", empty());
    }

    @Test
    @TestSecurity(user = "vera", roles = "console-viewer")
    void viewerCannotPlaceOrdersOrSeeDelivery() {
        given().header("X-Box1-Console", "1").header("Idempotency-Key", "k-1").contentType("application/json")
            .body(Map.of("customerId", "cust_demo_ada", "sku", "SKU-42", "quantity", 1, "siteId", "site_east"))
            .post("/api/v1/orders").then().statusCode(403).body("code", is("ROLE_REQUIRED"));
        given().get("/api/v1/delivery").then().statusCode(403);
        given().get("/api/v1/me").then().statusCode(200).body("roles", equalTo(List.of("console-viewer")));
    }

    @Test
    @TestSecurity(user = "otto", roles = {"console-operator", "unrelated-role"})
    void stateChangingCallsNeedTheConsoleHeaderJsonAndOwnOrigin() {
        given().header("Idempotency-Key", "k-1").contentType("application/json").body(BODY)
            .post("/api/v1/orders").then().statusCode(403).body("code", is("CONSOLE_HEADER_REQUIRED"));
        given().header("X-Box1-Console", "1").header("Idempotency-Key", "k-1").contentType("application/x-www-form-urlencoded")
            .formParam("customerId", "cust_demo_ada").post("/api/v1/orders").then().statusCode(403).body("code", is("JSON_REQUIRED"));
        // A sibling *.box1.org page is same-site (SameSite=Strict does not stop it); CORS refuses it outright.
        given().header("X-Box1-Console", "1").header("Idempotency-Key", "k-1").header("Origin", "https://asset-service-dev.apps.ocp.box1.org")
            .contentType("application/json").body(BODY).post("/api/v1/orders").then().statusCode(403);
        // An origin CORS admits for the public template API is still not the console.
        given().header("X-Box1-Console", "1").header("Idempotency-Key", "k-1").header("Origin", "https://developer-hub.apps.ocp.box1.org")
            .contentType("application/json").body(BODY).post("/api/v1/orders").then().statusCode(403).body("code", is("ORIGIN_MISMATCH"));
        // The console's own https origin, as the browser sends it through the edge Route, passes the guard (the
        // order service stub is absent, so the call reaches it and fails as unavailable rather than forbidden).
        given().header("X-Box1-Console", "1").header("Idempotency-Key", "k-1").header("Origin", "https://operations-console-dev.apps.ocp.box1.org")
            .contentType("application/json").body(Map.of("customerId", "cust_demo_ada", "sku", "SKU-42", "quantity", 1, "siteId", "site_east"))
            .post("/api/v1/orders").then().statusCode(503).body("code", is("UPSTREAM_UNAVAILABLE"));
        given().get("/api/v1/me").then().statusCode(200).body("roles", equalTo(List.of("console-operator")));
    }

    @Test
    void consoleHeaderIsNeverAllowedCrossOrigin() {
        given().header("Origin", "https://developer-hub.apps.ocp.box1.org").header("Access-Control-Request-Method", "POST")
            .header("Access-Control-Request-Headers", "x-box1-console").options("/api/v1/orders").then()
            .header("Access-Control-Allow-Headers", not(containsString("X-Box1-Console")))
            .header("Access-Control-Allow-Credentials", not(is("true")));
    }

    @Test
    void smokePathsStayPublicAndHardeningHeadersAreSet() {
        for (String path : new String[]{"/api/greetings", "/api/info", "/q/health/ready", "/q/openapi", "/q/metrics", "/signed-out.html"}) {
            given().get(path).then().statusCode(200).header("Content-Security-Policy", containsString("default-src 'self'"))
                .header("X-Frame-Options", "DENY").header("Cache-Control", "no-store");
        }
    }

    @Test
    void servedOpenApiIncludesTheConsoleContract() {
        given().accept("application/json").get("/q/openapi").then().statusCode(200)
            .body("info.title", is("operations-console REST API"))
            .body("paths.keySet()", hasItems("/api/v1/orders", "/api/v1/orders/{orderId}/summary", "/api/v1/me", "/api/greetings"));
    }
}
