package org.box1.console;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.is;
import static org.junit.jupiter.api.Assertions.assertEquals;

import java.io.InputStream;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.security.TestSecurity;
import org.junit.jupiter.api.Test;

/** The Maven-built front end is served from the pod, with SPA fallback and cache rules (decisions D-001, D-014). */
@QuarkusTest
class FrontendServingTest {
    static final String MARK_SHA256 = "11ccbb2dc79258163cc516ed398132ad320ebf9870c75da64cb8b6f2919762ea";

    @Test
    @TestSecurity(user = "vera", roles = "console-viewer")
    void indexDeepLinksAndAssetsAreServedWithCacheRules() {
        String index = given().accept("text/html").get("/").then().statusCode(200).header("Cache-Control", "no-store")
            .body(containsString("<title>box1 Operations</title>")).extract().asString();
        given().accept("text/html").get("/orders/ord_1").then().statusCode(200).header("Cache-Control", "no-store")
            .body(containsString("<title>box1 Operations</title>"));
        Matcher asset = Pattern.compile("/assets/[A-Za-z0-9_.-]+\\.js").matcher(index);
        org.junit.jupiter.api.Assertions.assertTrue(asset.find(), "index references a hashed script");
        given().get(asset.group()).then().statusCode(200).header("Cache-Control", "public, max-age=31536000, immutable");
        given().accept("text/html").get("/api/v1/no-such-thing").then().statusCode(404).body("code", is("NOT_FOUND"));
        given().accept("text/html").get("/q/no-such-thing").then().statusCode(404);
        given().get("/assets/missing.js").then().statusCode(404).header("Cache-Control", "no-store");
    }

    @Test
    void indexReferencesNoThirdPartyHost() {
        try (InputStream in = getClass().getResourceAsStream("/META-INF/resources/index.html")) {
            String html = new String(in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
            org.junit.jupiter.api.Assertions.assertFalse(html.matches("(?s).*(src|href)=\"(https?:)?//.*"), "no external hosts");
        } catch (java.io.IOException e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    void brandMarkIsTheUnmodifiedProjectAsset() throws Exception {
        byte[] served = given().get("/brand/box1-mark.png").then().statusCode(200).extract().asByteArray();
        assertEquals(MARK_SHA256, HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(served)));
    }
}
