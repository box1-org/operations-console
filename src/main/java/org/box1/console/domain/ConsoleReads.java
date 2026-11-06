package org.box1.console.domain;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.fasterxml.jackson.core.type.TypeReference;
import io.smallrye.config.ConfigMapping;
import io.smallrye.config.WithDefault;
import jakarta.enterprise.context.ApplicationScoped;
import org.box1.console.upstream.Payloads.UpAlert;
import org.box1.console.upstream.Payloads.UpFulfillment;
import org.box1.console.upstream.Payloads.UpInfo;
import org.box1.console.upstream.Payloads.UpOrder;
import org.box1.console.upstream.Payloads.UpPage;
import org.box1.console.upstream.Payloads.UpReservation;
import org.box1.console.upstream.Payloads.UpStock;
import org.box1.console.upstream.Payloads.UpTimelineEntry;
import org.box1.console.upstream.Source;
import org.box1.console.upstream.SourceStatus;
import org.box1.console.upstream.UpstreamResponse;
import org.box1.console.upstream.Upstreams;

/** Typed reads of each upstream's published API. Bounded: at most {@code maxPages} pages per list. */
@ApplicationScoped
public class ConsoleReads {
    private static final Pattern LINK = Pattern.compile("<([^>]*)>([^,]*)");
    private static final Pattern REL_NEXT = Pattern.compile(";\\s*rel\\s*=\\s*\"?([^\";]*)\"?");
    private static final Pattern SAFE_ID = Pattern.compile("^(ord|res|ful)_[A-Za-z0-9_-]{1,64}$");
    private static final TypeReference<List<UpOrder>> ORDERS = new TypeReference<>() { };
    private static final TypeReference<UpOrder> ORDER = new TypeReference<>() { };
    private static final TypeReference<List<UpTimelineEntry>> TIMELINE = new TypeReference<>() { };
    private static final TypeReference<UpReservation> RESERVATION = new TypeReference<>() { };
    private static final TypeReference<UpFulfillment> FULFILLMENT = new TypeReference<>() { };
    private static final TypeReference<List<UpStock>> STOCK = new TypeReference<>() { };
    private static final TypeReference<UpInfo> INFO = new TypeReference<>() { };
    private static final TypeReference<UpPage<UpAlert>> ALERTS = new TypeReference<>() { };
    static final int MAX_ALERTS = 100;

    private final Upstreams upstreams;
    private final Settings settings;

    public ConsoleReads(Upstreams upstreams, Settings settings) {
        this.upstreams = upstreams;
        this.settings = settings;
    }

    /** Console behaviour settings (decisions D-007, D-008, D-012, D-013). */
    @ConfigMapping(prefix = "console")
    public interface Settings {
        @WithDefault("none")
        String fulfillmentLink();

        @WithDefault("10m")
        Duration stuckThreshold();

        @WithDefault("2")
        int maxPages();

        @WithDefault("operations-console-dev")
        String environment();

        @WithDefault("https://asset-service-dev.apps.ocp.box1.org/console/")
        String telemetryConsoleUrl();

        Optional<String> publicOrigin();

        /**
         * Whether the signed-in user's access token is forwarded to upstreams. Off by default (security review SEC-1,
         * SEC-3): the public client carries no extra audiences, and every upstream the console reads accepts anonymous
         * reads today. Turning it on needs a client whose tokens are meant for those services (user decision O-9).
         */
        @WithDefault("false")
        boolean forwardUserToken();
    }

    public Settings settings() {
        return settings;
    }

    public record Listed<T>(List<T> items, boolean complete, SourceStatus status) {
    }

    /** Outcome of reading a Link header: no next page, a usable next query, or a next link that could not be used. */
    record Next(boolean present, Optional<String> query) {
    }

    private volatile CachedProbe telemetryProbe;

    private record CachedProbe(java.time.Instant at, SourceStatus status) {
    }

    /** The token to forward to an upstream that accepts one, per {@link Settings#forwardUserToken()}. */
    public Optional<String> forwardable(Optional<String> userToken) {
        return settings.forwardUserToken() ? userToken : Optional.empty();
    }

    public Listed<UpOrder> recentOrders() {
        return pages(Source.ORDER_SERVICE, "/api/v1/orders?limit=100", Optional.empty(), ORDERS);
    }

    public UpstreamResponse<UpOrder> order(String orderId) {
        return upstreams.get(Source.ORDER_SERVICE, "/api/v1/orders/" + id(orderId), Optional.empty(), ORDER);
    }

    public Listed<UpTimelineEntry> timeline(String orderId) {
        return pages(Source.ORDER_SERVICE, "/api/v1/orders/" + id(orderId) + "/timeline?limit=100", Optional.empty(), TIMELINE);
    }

    public UpstreamResponse<UpReservation> reservation(String reservationId, Optional<String> token) {
        return upstreams.get(Source.INVENTORY_SERVICE, "/api/v1/reservations/" + id(reservationId), token, RESERVATION);
    }

    public UpstreamResponse<UpFulfillment> fulfillment(String fulfillmentRequestId, Optional<String> token) {
        return upstreams.get(Source.FULFILLMENT_ADAPTER, "/api/fulfillments/" + id(fulfillmentRequestId), token, FULFILLMENT);
    }

    public Listed<UpStock> stock(Optional<String> token) {
        List<UpStock> all = new ArrayList<>();
        SourceStatus status = null;
        boolean complete = false;
        for (int page = 0; page < settings.maxPages(); page++) {
            UpstreamResponse<List<UpStock>> r = upstreams.get(Source.INVENTORY_SERVICE,
                "/api/v1/inventory?limit=100&offset=" + (page * 100), token, STOCK);
            status = r.sourceStatus();
            if (!r.ok()) {
                return new Listed<>(all, false, page == 0 ? status : degraded(status));
            }
            all.addAll(r.body());
            if (r.body().size() < 100) {
                complete = true;
                break;
            }
        }
        return new Listed<>(all, complete, status);
    }

    /**
     * Active alerts from asset-service (box1-docs#80), newest first, at most {@value #MAX_ALERTS}. With a token, the
     * person's own telemetry-reader role decides the answer, so nothing is cached across people. Without one,
     * asset-service refuses the console; that refusal is cached for a minute so it does not repeat on every page load
     * (review OPS-6).
     */
    public Listed<UpAlert> activeAlerts(Optional<String> token) {
        if (token.isEmpty()) {
            CachedProbe cached = telemetryProbe;
            if (cached != null && cached.at().plusSeconds(60).isAfter(java.time.Instant.now())) {
                return new Listed<>(List.of(), false, cached.status());
            }
        }
        UpstreamResponse<UpPage<UpAlert>> r = upstreams.get(Source.ASSET_SERVICE,
            "/api/v1/alerts?status=ACTIVE&limit=" + MAX_ALERTS, token, ALERTS);
        SourceStatus s = r.sourceStatus();
        if (s.status() == SourceStatus.State.NOT_AUTHORIZED) {
            String detail;
            if (token.isEmpty()) {
                detail = "The console does not send your sign-in to asset-service, which refuses unsigned reads. "
                    + "Use the telemetry console instead.";
            } else if (r.status() == 403) {
                detail = "Your account does not hold asset-service's telemetry-reader role, so it does not show you alerts.";
            } else {
                detail = "asset-service did not accept your sign-in from the console (HTTP " + r.status() + "). "
                    + "Use the telemetry console instead.";
            }
            s = SourceStatus.of(Source.ASSET_SERVICE, s.status(), detail, s.latencyMs());
            if (token.isEmpty()) {
                telemetryProbe = new CachedProbe(java.time.Instant.now(), s);
            }
            return new Listed<>(List.of(), false, s);
        }
        if (!r.ok() || r.body() == null) {
            return new Listed<>(List.of(), false, s);
        }
        List<UpAlert> items = r.body().items() == null ? List.of() : r.body().items();
        boolean complete = r.body().nextCursor() == null;
        if (!complete && s.status() == SourceStatus.State.OK) {
            s = SourceStatus.of(Source.ASSET_SERVICE, SourceStatus.State.DEGRADED,
                "Only the newest " + items.size() + " active alerts are shown.", s.latencyMs());
        }
        return new Listed<>(items, complete, s);
    }

    public UpstreamResponse<UpInfo> info(Source source) {
        return upstreams.get(source, "/api/info", Optional.empty(), INFO);
    }

    /** The fulfillment request id for an order, per the configured link mode (decision D-008, gap G-1). */
    public Optional<String> fulfillmentRequestIdFor(String orderId) {
        if ("derived".equals(settings.fulfillmentLink()) && orderId.startsWith("ord_")) {
            return Optional.of("ful_" + orderId.substring("ord_".length()));
        }
        return Optional.empty();
    }

    private <T> Listed<T> pages(Source source, String first, Optional<String> token, TypeReference<List<T>> type) {
        List<T> all = new ArrayList<>();
        String next = first;
        String base = first.substring(0, first.indexOf('?'));
        SourceStatus status = null;
        for (int page = 0; page < settings.maxPages() && next != null; page++) {
            UpstreamResponse<List<T>> r = upstreams.get(source, next, token, type);
            status = r.sourceStatus();
            if (!r.ok()) {
                if (page == 0) {
                    return new Listed<>(List.of(), false, status);
                }
                return new Listed<>(all, false, degraded(status));
            }
            all.addAll(r.body());
            Next n = nextQuery(r);
            if (n.present() && n.query().isEmpty()) {
                return new Listed<>(all, false, status);
            }
            next = n.query().map(q -> base + "?" + q).orElse(null);
        }
        return new Listed<>(all, next == null, status);
    }

    /**
     * Reuses only the query string of a Link rel=next, so an upstream can never redirect the console elsewhere. A next
     * link that exists but cannot be used marks the list incomplete rather than complete (review ARCH-9).
     */
    static Next nextQuery(UpstreamResponse<?> response) {
        if (response.headers() == null) {
            return new Next(false, Optional.empty());
        }
        for (String header : response.headers().allValues("Link")) {
            Matcher link = LINK.matcher(header);
            while (link.find()) {
                Matcher rel = REL_NEXT.matcher(link.group(2));
                boolean isNext = false;
                while (rel.find()) {
                    for (String value : rel.group(1).trim().split("\\s+")) {
                        isNext |= "next".equalsIgnoreCase(value);
                    }
                }
                if (isNext) {
                    String target = link.group(1);
                    int q = target.indexOf('?');
                    String query = q >= 0 && q < target.length() - 1 ? target.substring(q + 1) : null;
                    boolean usable = query != null && query.matches("[A-Za-z0-9._~%&=+/-]+");
                    return new Next(true, usable ? Optional.of(query) : Optional.empty());
                }
            }
        }
        return new Next(false, Optional.empty());
    }

    private static SourceStatus degraded(SourceStatus failed) {
        return SourceStatus.of(failed.source(), SourceStatus.State.DEGRADED,
            "Only part of the list was read: " + failed.detail(), failed.latencyMs());
    }

    /** Ids are validated by pattern and URL-encoded before they become a path segment. */
    static String id(String value) {
        if (value == null || !SAFE_ID.matcher(value).matches()) {
            throw new IllegalArgumentException("invalid identifier");
        }
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
