package org.box1.console.web;

import java.util.regex.Pattern;

import io.vertx.core.http.HttpMethod;
import io.vertx.ext.web.Router;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Singleton;

/**
 * Client-side routes (for example /orders/ord_1) are served index.html so a reload or deep link works.
 * API, Quarkus, asset and file paths are never rewritten, so their 404s stay 404s (decision D-001).
 * Content-hashed assets are cached for a year; every other response is no-store.
 */
@Singleton
public class SpaFallback {
    static final Pattern CLIENT_ROUTE = Pattern.compile(
        "^/(?!api/|q/|assets/|brand/|callback|logout)[A-Za-z0-9/_-]*$");

    void install(@Observes Router router) {
        router.route().order(Integer.MIN_VALUE + 99).handler(context -> {
            boolean immutable = context.normalizedPath().startsWith("/assets/");
            context.addHeadersEndHandler(v -> context.response().headers().set("Cache-Control",
                immutable && context.response().getStatusCode() == 200 ? "public, max-age=31536000, immutable" : "no-store"));
            context.next();
        });
        router.get().order(Integer.MIN_VALUE + 100).handler(context -> {
            String path = context.normalizedPath();
            String accept = context.request().getHeader("Accept");
            if (context.request().method() == HttpMethod.GET && !"/".equals(path) && CLIENT_ROUTE.matcher(path).matches()
                && accept != null && accept.contains("text/html")) {
                context.reroute("/index.html");
            } else {
                context.next();
            }
        });
    }
}
