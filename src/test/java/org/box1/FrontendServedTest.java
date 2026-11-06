package org.box1;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

/** The Maven build packages the Vite output; Quarkus serves it from the classpath. */
@QuarkusTest
class FrontendServedTest {

    @Test
    void indexIsServedFromThePod() {
        given().when().get("/").then().statusCode(200)
            .body(containsString("<title>box1 Operations</title>"))
            .body(containsString("/assets/index-"));
    }
}
